// src/models/model-selector.js
// 작업 유형에 따라 최적 모델을 런타임에 결정
// 페르소나 기본 모델은 폴백으로 유지

const OPERATION_AFFINITY = {
  breakdownTasks: { preferred: "claude",       reason: "reasoning/분석" },
  reviewCode:     { preferred: "claude",       reason: "analytical review" },
  writeCode:      { preferred: "codex",        reason: "code generation" },
  runQA:          { preferred: "codex",        reason: "systematic testing" },
  speak:          { preferred: null,           reason: "에이전트 기본값 사용" },
  generateImage:  { preferred: "gemini_image", reason: "multimodal" },
};

export class ModelSelector {
  /**
   * @param {Object} config - agent-team.config.yaml
   * @param {string[]} availableModels - 설치된 모델 키 목록
   */
  constructor(config, availableModels) {
    this.available = new Set(availableModels);
    this.overrides = config.model_selection || {};
  }

  /**
   * 작업에 최적인 모델 키 반환
   * @param {Object} params
   * @param {string} params.operation - 작업 유형 (writeCode, reviewCode 등)
   * @param {string} params.agentDefault - 에이전트 기본 모델 키
   * @returns {string} 선택된 모델 키
   */
  selectModel({ operation, agentDefault }) {
    // 1. 사용자 config 오버라이드
    const override = this.overrides[operation];
    if (override && this.available.has(override)) {
      return override;
    }

    // 2. 작업-모델 친화도
    const affinity = OPERATION_AFFINITY[operation];
    if (affinity?.preferred && this.available.has(affinity.preferred)) {
      return affinity.preferred;
    }

    // 3. 에이전트 기본값
    return agentDefault;
  }
}
