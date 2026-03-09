// src/agents/team.js
// 팀 관리자 - 모든 에이전트를 오케스트레이션
// PipelineState + PromptAssembler 기반 대화 루프

import { Agent } from "./agent.js";
import { t } from "../i18n/index.js";

export class Team {
  /**
   * @param {Object} config - 설정 객체
   * @param {Object} modelAdapter - ModelAdapter 인스턴스
   * @param {Object} deps - 의존성
   * @param {import('../state/pipeline-state.js').PipelineState} deps.state
   * @param {import('../state/prompt-assembler.js').PromptAssembler} deps.assembler
   */
  constructor(config, modelAdapter, { state, assembler }) {
    this.config = config;
    this.adapter = modelAdapter;
    this.state = state;
    this.assembler = assembler;
    this.agents = {};
    this._initAgents();
  }

  _initAgents() {
    const personas = this.config.personas || {};
    const defaultThinking = this.config.pipeline?.thinking_budget;
    for (const [id, persona] of Object.entries(personas)) {
      const merged = { id, ...persona };
      // 페르소나에 thinking_budget이 없으면 pipeline 기본값 사용
      if (merged.thinking_budget == null && defaultThinking != null) {
        merged.thinking_budget = defaultThinking;
      }
      this.agents[id] = new Agent(merged, this.adapter);
    }
  }

  get lead() {
    return this.agents.tech_lead;
  }

  get qa() {
    return this.agents.qa;
  }

  getAgent(id) {
    return this.agents[id];
  }

  getAllAgents() {
    return Object.values(this.agents);
  }

  /**
   * 이미지 생성 가능한 에이전트 목록 반환
   */
  getImageAgents() {
    return Object.values(this.agents).filter(a => a.canGenerateImages);
  }

  getActiveAgents() {
    return Object.values(this.agents);
  }

  /**
   * 팀장 AI가 프롬프트를 한 줄 제목으로 요약
   * 한 번 생성되면 캐시하여 이후 미팅에서 재사용
   * @param {string} topic - 사용자가 입력한 프롬프트/요구사항
   * @returns {Promise<string>} 한 줄 요약 제목
   */
  async generateTitle(topic) {
    if (this._cachedTitle) return this._cachedTitle;

    const response = await this.adapter.chat(
      this.lead.modelKey,
      t("agent.generateTitlePrompt"),
      topic,
      { thinkingBudget: 0 }
    );

    const cleaned = response.trim().split("\n")[0].trim().replace(/^["']|["']$/g, "");
    this._cachedTitle = cleaned || topic.substring(0, 50);
    return this._cachedTitle;
  }

  getDevelopers() {
    return Object.entries(this.agents)
      .filter(([id]) => !["tech_lead", "qa"].includes(id))
      .map(([, agent]) => agent);
  }

  /**
   * 회의 진행 - 모든 에이전트가 순서대로 발언
   * PromptAssembler가 토큰 예산 내 맥락을 조립하고, PipelineState에 발언을 기록
   *
   * @param {string} topic - 회의 주제
   * @param {string} context - 추가 컨텍스트 (하위 호환용, 사용하지 않음)
   * @param {object} options - { rounds: 토론 라운드 수, onSpeak: 콜백, onStream: 실시간 출력 콜백 }
   */
  async conductMeeting(topic, context = "", options = {}) {
    const rounds = Math.max(1, options.rounds || 2);
    const onSpeak = options.onSpeak || (() => {});
    const onStream = options.onStream;

    const meetingLog = {
      topic,
      timestamp: new Date().toISOString(),
      participants: this.getActiveAgents().map((a) => `${a.name}(${a.role})`),
      rounds: [],
    };

    for (let round = 0; round < rounds; round++) {
      const roundLog = { round: round + 1, speeches: [] };
      const isLastRound = round === rounds - 1;

      onSpeak({ phase: "round_start", round: round + 1, totalRounds: rounds });

      // 첫 라운드: 팀장 -> 나머지 -> 팀장 정리
      // 이후 라운드: 자유 토론 -> 팀장 결론 확인 또는 정리
      const speakOrder =
        round === 0
          ? [this.lead, ...this.getDevelopers(), this.qa]
          : [...this.getDevelopers(), this.qa];

      for (const agent of speakOrder) {
        onSpeak({ phase: "speaking", agent: agent.name, round: round + 1 });

        const isLead = agent.id === this.lead.id;
        const contextBundle = this.assembler.forMeeting(this.state, { agentId: agent.id, topic });
        if (!isLead) contextBundle.allowPass = true;

        const speech = await agent.speak(topic, contextBundle, {
          onData: onStream ? (chunk) => onStream({ agent: agent.name, chunk }) : undefined,
        });

        // 빈 응답 → broadcastMessage 스킵, 회의록에만 기록
        if (!speech.content.trim()) {
          onSpeak({ phase: "empty_response", agent: agent.name });
          roundLog.speeches.push({
            agent: agent.name,
            role: agent.role,
            model: speech.model,
            content: t("agent.noResponse"),
            isEmpty: true,
          });
          continue;
        }

        // [PASS] 응답이면 broadcastMessage 스킵, 회의록에만 기록
        if (/^\[PASS\]/i.test(speech.content.trim())) {
          onSpeak({ phase: "passed", agent: agent.name, meta: speech.meta });
          roundLog.speeches.push({
            agent: agent.name,
            role: agent.role,
            model: speech.model,
            content: "[PASS]",
            isPassed: true,
          });
          continue;
        }

        // [SPEAK] 접두사 + 근거 요약 줄 제거
        const speakMatch = speech.content.trim().match(/^\[SPEAK\]\s*\n.*\n([\s\S]*)$/i);
        if (speakMatch) {
          speech.content = speakMatch[1].trim();
        }

        this.state.broadcastMessage({
          from: agent.id,
          type: "meeting_speech",
          content: speech.content,
        });

        roundLog.speeches.push(speech);

        onSpeak({ phase: "spoke", agent: agent.name, content: speech.content, meta: speech.meta });
      }

      // 중간 라운드: 팀장 결론 확인 (결론 시 조기 종료)
      let shouldBreak = false;
      if (!isLastRound) {
        shouldBreak = await this._checkMidRoundConclusion({ topic, roundLog, onSpeak, onStream, rounds });
      }

      // 팀장 정리 (마지막 라운드)
      if (isLastRound) {
        await this._conductFinalSummary({ topic, roundLog, onSpeak, onStream });
      }

      meetingLog.rounds.push(roundLog);
      if (shouldBreak) break;
    }

    return meetingLog;
  }

  /**
   * 회의 로그를 마크다운으로 변환
   * meetingLog 구조를 유지하여 호환성 확보
   */
  formatMeetingAsMarkdown(meetingLog) {
    const lines = [];
    const typeEmoji = "\uD83D\uDCCB";
    const typeLabel = t("agent.meetingMarkdown.planning");

    lines.push(`## ${t("agent.meetingMarkdown.record", { emoji: typeEmoji, type: typeLabel })}\n`);
    lines.push(`- ${t("agent.meetingMarkdown.datetime", { time: meetingLog.timestamp })}`);
    lines.push(`- ${t("agent.meetingMarkdown.participants", { list: meetingLog.participants.join(", ") })}`);
    lines.push(`- ${t("agent.meetingMarkdown.agenda", { topic: meetingLog.topic })}\n`);

    for (const round of meetingLog.rounds) {
      lines.push(`${t("agent.meetingMarkdown.round", { number: round.round })}\n`);

      for (const speech of round.speeches) {
        if (speech.isPassed) {
          lines.push(`#### ${speech.agent} (${speech.role}) ${t("agent.meetingMarkdown.passSuffix")}\n`);
          continue;
        }
        if (speech.isEmpty) {
          lines.push(`#### ${speech.agent} (${speech.role}) ${t("agent.meetingMarkdown.emptyResponseSuffix")}\n`);
          continue;
        }
        const modelTag = `\`[${speech.model}]\``;
        if (speech.isSummary) {
          lines.push(`#### ${t("agent.meetingMarkdown.summaryLabel", { agent: speech.agent, role: speech.role, model: modelTag })}\n`);
        } else {
          lines.push(`#### ${speech.agent} (${speech.role}) ${modelTag}\n`);
        }
        lines.push(speech.content);
        lines.push("");
      }
    }

    // 어떤 모델이 어떤 역할을 했는지 요약
    lines.push(`---\n`);
    lines.push(`${t("agent.meetingMarkdown.modelAssignment")}\n`);
    lines.push(t("agent.meetingMarkdown.tableHeader"));
    lines.push(`|---------|------|---------|`);
    for (const agent of this.getActiveAgents()) {
      lines.push(`| ${agent.name} | ${agent.role} | ${agent.modelKey} |`);
    }

    return lines.join("\n");
  }

  /**
   * AI 응답의 suitable_role을 에이전트 ID로 정규화
   * @param {string} role - AI가 반환한 role 문자열
   * @returns {string} 정규화된 에이전트 ID (매칭 실패 시 원본 반환)
   */
  normalizeRole(role) {
    if (!role) return role;
    const trimmed = role.trim();

    // 1차: 정확한 ID 매칭
    if (this.agents[trimmed]) return trimmed;

    // 2차: "id(role)" 형식에서 ID 추출
    const parenMatch = trimmed.match(/^([a-z_]+)\s*\(/);
    if (parenMatch && this.agents[parenMatch[1]]) return parenMatch[1];

    // 3차: role 이름으로 역방향 매칭
    const lower = trimmed.toLowerCase();
    for (const [id, agent] of Object.entries(this.agents)) {
      if (agent.role.toLowerCase() === lower) return id;
    }

    // 4차: 부분 문자열 매칭 (최소 3자 이상, ID가 입력을 포함하는 방향만)
    if (lower.length >= 3) {
      for (const id of Object.keys(this.agents)) {
        if (id.includes(lower)) return id;
      }
    }

    return role;
  }

  /**
   * 가장 적합한 에이전트에게 태스크 배정
   */
  assignTask(task) {
    const roleId = this.normalizeRole(task.suitable_role);
    const agent = this.agents[roleId];
    if (agent) return agent;

    // fallback: 개발자 중 첫 번째, 없으면 팀장이 직접 처리
    const allDevs = this.getDevelopers();
    return allDevs[0] || this.lead;
  }

  // ─── conductMeeting 내부 헬퍼 ──────────────────────────

  /**
   * 중간 라운드에서 팀장의 결론 확인
   * @returns {Promise<boolean>} shouldBreak - true면 회의 조기 종료
   */
  async _checkMidRoundConclusion({ topic, roundLog, onSpeak, onStream, rounds }) {
    onSpeak({ phase: "speaking", agent: this.lead.name, round: roundLog.round });

    const checkBundle = this.assembler.forMeeting(this.state, {
      agentId: this.lead.id,
      topic,
      maxPreviousSpeeches: 10,
    });

    const checkResponse = await this.lead.speak(
      t("agent.concludeInstruction", { round: roundLog.round, totalRounds: rounds }),
      checkBundle,
      { onData: onStream ? (chunk) => onStream({ agent: this.lead.name, chunk }) : undefined }
    );

    const content = checkResponse.content.trim();

    if (!content) {
      // 빈 응답 방어
      onSpeak({ phase: "empty_response", agent: this.lead.name });
      roundLog.speeches.push({
        agent: this.lead.name,
        role: this.lead.role,
        model: checkResponse.model,
        content: t("agent.noResponse"),
        isEmpty: true,
      });
      return false;
    }

    // m 플래그: LLM이 전문(preamble) 뒤에 [CONCLUDE]를 쓸 경우를 방어적으로 허용
    const concludeMatch = content.match(/^\[CONCLUDE\]\s*([\s\S]*)/mi);
    if (concludeMatch) {
      const stripped = concludeMatch[1].trim();
      if (stripped.length > 0) {
        // 결론 도출 → 종합 정리로 기록, 조기 종료
        this.state.broadcastMessage({ from: this.lead.id, type: "meeting_speech", content: stripped });
        roundLog.speeches.push({ ...checkResponse, content: stripped, isSummary: true });
        onSpeak({ phase: "summary", agent: this.lead.name, content: stripped, meta: checkResponse.meta });
        return true;
      }
      // [CONCLUDE]만 있고 내용 없음
      onSpeak({ phase: "empty_response", agent: this.lead.name });
      roundLog.speeches.push({
        agent: this.lead.name,
        role: this.lead.role,
        model: checkResponse.model,
        content: t("agent.noResponse"),
        isEmpty: true,
      });
      return false;
    }

    // 결론 안 냄 → 방향 제시 발언으로 기록
    this.state.broadcastMessage({ from: this.lead.id, type: "meeting_speech", content });
    roundLog.speeches.push(checkResponse);
    onSpeak({ phase: "spoke", agent: this.lead.name, content, meta: checkResponse.meta });
    return false;
  }

  /**
   * 마지막 라운드 팀장 정리
   */
  async _conductFinalSummary({ topic, roundLog, onSpeak, onStream }) {
    onSpeak({ phase: "speaking", agent: this.lead.name, round: roundLog.round });

    const summaryBundle = this.assembler.forMeeting(this.state, {
      agentId: this.lead.id,
      topic,
      maxPreviousSpeeches: 20,
    });

    const summary = await this.lead.speak(
      t("agent.summaryInstruction"),
      summaryBundle,
      { onData: onStream ? (chunk) => onStream({ agent: this.lead.name, chunk }) : undefined }
    );

    if (!summary.content.trim()) {
      // 빈 응답 방어
      onSpeak({ phase: "empty_response", agent: this.lead.name });
      roundLog.speeches.push({
        agent: this.lead.name,
        role: this.lead.role,
        model: summary.model,
        content: t("agent.noResponse"),
        isEmpty: true,
        isSummary: true,
      });
    } else {
      this.state.broadcastMessage({
        from: this.lead.id,
        type: "meeting_speech",
        content: summary.content,
      });

      roundLog.speeches.push({ ...summary, isSummary: true });
      onSpeak({
        phase: "summary",
        agent: this.lead.name,
        content: summary.content,
        meta: summary.meta,
      });
    }
  }
}
