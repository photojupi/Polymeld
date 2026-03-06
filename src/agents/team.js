// src/agents/team.js
// 팀 관리자 - 모든 에이전트를 오케스트레이션
// PipelineState + PromptAssembler 기반 대화 루프

import { Agent } from "./agent.js";

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
    this._mobilizedOnDemand = new Set();
    this._initAgents();
  }

  _initAgents() {
    const personas = this.config.personas;
    for (const [id, persona] of Object.entries(personas)) {
      this.agents[id] = new Agent({ id, ...persona }, this.adapter);
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

  /**
   * 온디맨드 에이전트 소집
   * @param {string[]} agentIds - 소집할 에이전트 ID 배열
   */
  mobilize(agentIds) {
    for (const id of agentIds) {
      const agent = this.agents[id];
      if (agent && agent.onDemand) {
        this._mobilizedOnDemand.add(id);
      }
    }
  }

  /**
   * 현재 활성 에이전트 목록 (상시 + 소집된 온디맨드)
   */
  getActiveAgents() {
    return Object.entries(this.agents)
      .filter(([id, agent]) => !agent.onDemand || this._mobilizedOnDemand.has(id))
      .map(([, agent]) => agent);
  }

  /**
   * 소집된 온디맨드 에이전트 목록
   */
  getMobilizedAgents() {
    return [...this._mobilizedOnDemand].map(id => this.agents[id]).filter(Boolean);
  }

  getDevelopers() {
    return Object.entries(this.agents)
      .filter(([id, agent]) =>
        !["tech_lead", "qa"].includes(id) &&
        (!agent.onDemand || this._mobilizedOnDemand.has(id))
      )
      .map(([, agent]) => agent);
  }

  /**
   * 회의 진행 - 모든 에이전트가 순서대로 발언
   * PromptAssembler가 토큰 예산 내 맥락을 조립하고, PipelineState에 발언을 기록
   *
   * @param {string} topic - 회의 주제
   * @param {string} context - 추가 컨텍스트 (하위 호환용, 사용하지 않음)
   * @param {object} options - { rounds: 토론 라운드 수, onSpeak: 콜백 }
   */
  async conductMeeting(topic, context = "", options = {}) {
    const rounds = options.rounds || this.config.pipeline?.max_discussion_rounds || 2;
    const onSpeak = options.onSpeak || (() => {});

    const meetingLog = {
      topic,
      timestamp: new Date().toISOString(),
      participants: this.getActiveAgents().map((a) => `${a.name}(${a.role})`),
      rounds: [],
    };

    for (let round = 0; round < rounds; round++) {
      const roundLog = { round: round + 1, speeches: [] };

      // 첫 라운드: 팀장 -> 나머지 -> 팀장 정리
      // 이후 라운드: 자유 토론 -> 팀장 정리
      const speakOrder =
        round === 0
          ? [this.lead, ...this.getDevelopers(), this.qa]
          : [...this.getDevelopers(), this.qa];

      for (const agent of speakOrder) {
        onSpeak({ phase: "speaking", agent: agent.name, round: round + 1 });

        const contextBundle = this.assembler.forMeeting(this.state, { agentId: agent.id, topic });
        const speech = await agent.speak(topic, contextBundle);

        this.state.broadcastMessage({
          from: agent.id,
          type: "meeting_speech",
          content: speech.content,
        });

        roundLog.speeches.push(speech);

        onSpeak({ phase: "spoke", agent: agent.name, content: speech.content });
      }

      // 팀장 정리 (마지막 라운드)
      if (round === rounds - 1) {
        onSpeak({ phase: "speaking", agent: this.lead.name, round: round + 1 });

        const summaryBundle = this.assembler.forMeeting(this.state, {
          agentId: this.lead.id,
          topic,
          maxPreviousSpeeches: 20,
        });

        const summary = await this.lead.speak(
          `지금까지의 논의를 종합하여 최종 결론과 액션 아이템을 정리해주세요.`,
          summaryBundle
        );

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
        });
      }

      meetingLog.rounds.push(roundLog);
    }

    return meetingLog;
  }

  /**
   * 회의 로그를 마크다운으로 변환
   * meetingLog 구조를 유지하여 호환성 확보
   */
  formatMeetingAsMarkdown(meetingLog, meetingType = "회의") {
    const lines = [];
    const typeEmoji = meetingType === "kickoff" ? "\uD83D\uDCCB" : "\uD83C\uDFD7\uFE0F";
    const typeKor = meetingType === "kickoff" ? "킥오프 미팅" : "기술 설계 미팅";

    lines.push(`## ${typeEmoji} ${typeKor} 기록\n`);
    lines.push(`- **일시**: ${meetingLog.timestamp}`);
    lines.push(`- **참석자**: ${meetingLog.participants.join(", ")}`);
    lines.push(`- **안건**: ${meetingLog.topic}\n`);

    for (const round of meetingLog.rounds) {
      lines.push(`### 라운드 ${round.round}\n`);

      for (const speech of round.speeches) {
        const modelTag = `\`[${speech.model}]\``;
        if (speech.isSummary) {
          lines.push(`#### \uD83D\uDCA1 ${speech.agent} (${speech.role}) - 종합 정리 ${modelTag}\n`);
        } else {
          lines.push(`#### ${speech.agent} (${speech.role}) ${modelTag}\n`);
        }
        lines.push(speech.content);
        lines.push("");
      }
    }

    // 어떤 모델이 어떤 역할을 했는지 요약
    lines.push(`---\n`);
    lines.push(`### \uD83E\uDD16 모델 배정 현황\n`);
    lines.push(`| 페르소나 | 역할 | AI 모델 |`);
    lines.push(`|---------|------|---------|`);
    for (const agent of this.getActiveAgents()) {
      lines.push(`| ${agent.name} | ${agent.role} | ${agent.modelKey} |`);
    }

    return lines.join("\n");
  }

  /**
   * 가장 적합한 에이전트에게 태스크 배정
   */
  assignTask(task) {
    const suitableRole = task.suitable_role;
    const agent = this.agents[suitableRole];

    // 에이전트가 존재하고 활성(상시 또는 소집됨)인 경우 배정
    if (agent && (!agent.onDemand || this._mobilizedOnDemand.has(suitableRole))) {
      return agent;
    }

    // fallback: 활성 개발자 중 첫 번째, 없으면 팀장이 직접 처리
    const allDevs = this.getDevelopers();
    return allDevs[0] || this.lead;
  }
}
