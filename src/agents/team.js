// src/agents/team.js
// 팀 관리자 - 모든 에이전트를 오케스트레이션

import { Agent } from "./agent.js";

export class Team {
  constructor(config, modelAdapter) {
    this.config = config;
    this.adapter = modelAdapter;
    this.agents = {};
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

  getDevelopers() {
    return Object.entries(this.agents)
      .filter(([id]) => !["tech_lead", "qa"].includes(id))
      .map(([, agent]) => agent);
  }

  /**
   * 회의 진행 - 모든 에이전트가 순서대로 발언
   * @param {string} topic - 회의 주제
   * @param {string} context - 추가 컨텍스트
   * @param {object} options - { rounds: 토론 라운드 수, onSpeak: 콜백 }
   */
  async conductMeeting(topic, context = "", options = {}) {
    const rounds = options.rounds || this.config.pipeline?.max_discussion_rounds || 2;
    const onSpeak = options.onSpeak || (() => {});

    const meetingLog = {
      topic,
      timestamp: new Date().toISOString(),
      participants: this.getAllAgents().map((a) => `${a.name}(${a.role})`),
      rounds: [],
    };

    for (let round = 0; round < rounds; round++) {
      const roundLog = { round: round + 1, speeches: [] };
      const previousDiscussion = meetingLog.rounds
        .flatMap((r) => r.speeches)
        .map((s) => `**${s.agent} (${s.role})**: ${s.content}`)
        .join("\n\n---\n\n");

      // 첫 라운드: 팀장 → 나머지 → 팀장 정리
      // 이후 라운드: 자유 토론 → 팀장 정리
      const speakOrder =
        round === 0
          ? [this.lead, ...this.getDevelopers(), this.qa]
          : [...this.getDevelopers(), this.qa];

      for (const agent of speakOrder) {
        onSpeak({ phase: "speaking", agent: agent.name, round: round + 1 });

        const speech = await agent.speak(topic, context, previousDiscussion);
        roundLog.speeches.push(speech);

        onSpeak({ phase: "spoke", agent: agent.name, content: speech.content });
      }

      // 팀장 정리 (마지막 라운드 또는 매 라운드)
      if (round === rounds - 1) {
        onSpeak({ phase: "speaking", agent: this.lead.name, round: round + 1 });

        const allDiscussion = [
          ...meetingLog.rounds.flatMap((r) => r.speeches),
          ...roundLog.speeches,
        ]
          .map((s) => `**${s.agent} (${s.role})**: ${s.content}`)
          .join("\n\n---\n\n");

        const summary = await this.lead.speak(
          `지금까지의 논의를 종합하여 최종 결론과 액션 아이템을 정리해주세요.\n\n## 전체 논의 내용:\n${allDiscussion}`,
          context
        );

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
   */
  formatMeetingAsMarkdown(meetingLog, meetingType = "회의") {
    const lines = [];
    const typeEmoji = meetingType === "kickoff" ? "📋" : "🏗️";
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
          lines.push(`#### 💡 ${speech.agent} (${speech.role}) - 종합 정리 ${modelTag}\n`);
        } else {
          lines.push(`#### ${speech.agent} (${speech.role}) ${modelTag}\n`);
        }
        lines.push(speech.content);
        lines.push("");
      }
    }

    // 어떤 모델이 어떤 역할을 했는지 요약
    lines.push(`---\n`);
    lines.push(`### 🤖 모델 배정 현황\n`);
    lines.push(`| 페르소나 | 역할 | AI 모델 |`);
    lines.push(`|---------|------|---------|`);
    for (const agent of this.getAllAgents()) {
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

    if (!agent) {
      // fallback: 전문성이 가장 가까운 에이전트
      const allDevs = this.getDevelopers();
      return allDevs[0];
    }

    return agent;
  }
}
