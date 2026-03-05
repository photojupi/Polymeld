// src/config/interaction.js
// 인터랙션 모드 관리
// 사용자 확인 요청을 모드에 따라 자동/반자동/수동으로 처리

import inquirer from "inquirer";
import chalk from "chalk";

/**
 * 인터랙션 모드:
 * 
 * - full-auto:  모든 확인을 자동으로 통과. CI/CD나 배치 실행에 적합.
 *               에러 발생 시에만 멈춤.
 * 
 * - semi-auto:  Phase 전환 시에만 확인. Phase 내부 세부사항은 자동 통과.
 *               대부분의 사용에 권장.
 * 
 * - manual:     모든 확인 포인트에서 사용자 입력 대기.
 *               처음 사용하거나 세밀한 제어가 필요할 때.
 */

export class InteractionManager {
  constructor(mode = "semi-auto", options = {}) {
    this.mode = mode;
    this.timeout = options.timeout || 0;        // auto-proceed timeout (초)
    this.defaultYes = options.defaultYes ?? true; // 타임아웃 시 기본값
    this.onSkip = options.onSkip || (() => {});  // 자동 스킵 시 콜백
    this.log = [];                                // 모든 결정을 기록
  }

  /**
   * Phase 전환 확인
   * semi-auto: 확인 요청
   * full-auto: 자동 통과
   * manual: 확인 요청
   */
  async confirmPhaseTransition(fromPhase, toPhase) {
    return this._confirm({
      level: "phase",
      message: `${fromPhase} 완료. ${toPhase}로 진행할까요?`,
      autoIn: ["full-auto"],
      askIn: ["semi-auto", "manual"],
      choices: [
        { name: "진행", value: "proceed" },
        { name: "이 Phase 다시 실행", value: "retry" },
        { name: "수정 후 계속", value: "edit" },
        { name: "파이프라인 중단", value: "abort" },
      ],
      default: "proceed",
    });
  }

  /**
   * Phase 내부 세부 확인 (예: 태스크 분해 결과 확인)
   * semi-auto: 자동 통과
   * full-auto: 자동 통과
   * manual: 확인 요청
   */
  async confirmDetail(message, options = {}) {
    return this._confirm({
      level: "detail",
      message,
      autoIn: ["full-auto", "semi-auto"],
      askIn: ["manual"],
      choices: options.choices || [
        { name: "확인", value: "proceed" },
        { name: "수정", value: "edit" },
        { name: "건너뛰기", value: "skip" },
      ],
      default: "proceed",
    });
  }

  /**
   * 경고성 확인 (에러/이슈 발생 시)
   * full-auto에서도 멈출 수 있음
   * severity: "warning" | "error"
   */
  async confirmWarning(message, severity = "warning") {
    const isError = severity === "error";

    return this._confirm({
      level: "warning",
      message: `${isError ? "❌" : "⚠️"} ${message}`,
      autoIn: isError ? [] : ["full-auto"],  // 에러는 항상 멈춤
      askIn: isError
        ? ["full-auto", "semi-auto", "manual"]
        : ["semi-auto", "manual"],
      choices: [
        { name: "계속 진행", value: "proceed" },
        { name: "재시도", value: "retry" },
        { name: "건너뛰기", value: "skip" },
        { name: "중단", value: "abort" },
      ],
      default: isError ? "abort" : "proceed",
    });
  }

  /**
   * 단순 Y/N 확인
   */
  async confirmYesNo(message) {
    return this._confirm({
      level: "yesno",
      message,
      autoIn: ["full-auto", "semi-auto"],
      askIn: ["manual"],
      choices: [
        { name: "예", value: true },
        { name: "아니오", value: false },
      ],
      default: true,
    });
  }

  /**
   * 회의 라운드 추가 여부
   * manual에서만 추가 라운드 요청 가능
   */
  async confirmAdditionalRound(currentRound, maxRounds) {
    if (currentRound < maxRounds) {
      // 설정된 라운드 수 이내면 자동 진행
      return { action: "proceed" };
    }

    return this._confirm({
      level: "detail",
      message: `${currentRound}라운드 완료 (설정: ${maxRounds}). 추가 토론 라운드를 진행할까요?`,
      autoIn: ["full-auto", "semi-auto"],
      askIn: ["manual"],
      choices: [
        { name: "여기서 마무리", value: "proceed" },
        { name: "1라운드 더", value: "extend" },
        { name: "2라운드 더", value: "extend2" },
      ],
      default: "proceed",
    });
  }

  /**
   * 코드 리뷰 결과에 따른 처리
   */
  async confirmReviewResult(reviewContent) {
    const hasChangesRequested = reviewContent
      .toLowerCase()
      .includes("changes requested");

    if (hasChangesRequested) {
      return this._confirm({
        level: "detail",
        message: "코드 리뷰에서 수정이 요청되었습니다. 어떻게 처리할까요?",
        autoIn: ["full-auto"],   // full-auto면 자동 수정
        askIn: ["semi-auto", "manual"],
        choices: [
          { name: "자동 수정 후 재리뷰", value: "fix" },
          { name: "수정 없이 진행", value: "proceed" },
          { name: "수동으로 수정", value: "manual" },
        ],
        default: "fix",
      });
    }

    return { action: "proceed" };
  }

  /**
   * QA 실패 시 처리
   */
  async confirmQAFailure(qaResult) {
    const hasFail =
      qaResult.toLowerCase().includes("fail") &&
      !qaResult.toLowerCase().includes("no fail");

    if (hasFail) {
      return this._confirm({
        level: "warning",
        message: "QA 테스트 실패. 어떻게 처리할까요?",
        autoIn: [],  // QA 실패는 항상 확인
        askIn: ["full-auto", "semi-auto", "manual"],
        choices: [
          { name: "자동 수정 후 재테스트", value: "fix" },
          { name: "실패한 채로 진행", value: "proceed" },
          { name: "해당 태스크 건너뛰기", value: "skip" },
          { name: "파이프라인 중단", value: "abort" },
        ],
        default: "fix",
      });
    }

    return { action: "proceed" };
  }

  // ─── 내부 구현 ─────────────────────────────────────────

  async _confirm({ level, message, autoIn, askIn, choices, default: defaultVal }) {
    const decision = {
      level,
      message,
      mode: this.mode,
      timestamp: new Date().toISOString(),
      action: null,
      auto: false,
    };

    // 자동 통과 모드인지 확인
    if (autoIn.includes(this.mode)) {
      decision.action = defaultVal;
      decision.auto = true;
      this.log.push(decision);

      // 자동 통과 시 표시
      const actionName =
        typeof defaultVal === "boolean"
          ? defaultVal ? "예" : "아니오"
          : choices.find((c) => c.value === defaultVal)?.name || defaultVal;
      console.log(
        chalk.gray(`  ⏩ [auto] ${message} → ${actionName}`)
      );

      this.onSkip(decision);
      return { action: defaultVal };
    }

    // 타임아웃 모드
    if (this.timeout > 0) {
      return this._confirmWithTimeout(message, choices, defaultVal, decision);
    }

    // 수동 확인
    if (choices.length === 2 && typeof choices[0].value === "boolean") {
      // Y/N 질문
      const { answer } = await inquirer.prompt([
        {
          type: "confirm",
          name: "answer",
          message,
          default: defaultVal,
        },
      ]);
      decision.action = answer;
      this.log.push(decision);
      return { action: answer };
    }

    // 선택형 질문
    const { answer } = await inquirer.prompt([
      {
        type: "list",
        name: "answer",
        message,
        choices,
        default: defaultVal,
      },
    ]);
    decision.action = answer;
    this.log.push(decision);
    return { action: answer };
  }

  async _confirmWithTimeout(message, choices, defaultVal, decision) {
    console.log(
      chalk.yellow(`  ⏱️  ${this.timeout}초 후 자동 진행 (기본: ${defaultVal})`)
    );

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        decision.action = defaultVal;
        decision.auto = true;
        this.log.push(decision);
        console.log(chalk.gray(`  ⏩ [timeout] → ${defaultVal}`));
        resolve({ action: defaultVal });
      }, this.timeout * 1000);

      inquirer
        .prompt([
          {
            type: "list",
            name: "answer",
            message: `${message} (${this.timeout}초 후 자동 진행)`,
            choices,
            default: defaultVal,
          },
        ])
        .then(({ answer }) => {
          clearTimeout(timer);
          decision.action = answer;
          this.log.push(decision);
          resolve({ action: answer });
        });
    });
  }

  /**
   * 결정 로그를 마크다운으로 출력
   */
  getDecisionLog() {
    const lines = ["## 🤖 자동화 결정 로그\n"];
    lines.push("| 시간 | 레벨 | 질문 | 결정 | 자동 |");
    lines.push("|------|------|------|------|------|");

    for (const d of this.log) {
      const time = d.timestamp.split("T")[1].split(".")[0];
      const auto = d.auto ? "✅" : "👤";
      lines.push(
        `| ${time} | ${d.level} | ${d.message.substring(0, 40)} | ${d.action} | ${auto} |`
      );
    }

    return lines.join("\n");
  }

  /**
   * 모드 변경 (실행 중에도 가능)
   */
  setMode(mode) {
    console.log(chalk.cyan(`  🔄 인터랙션 모드 변경: ${this.mode} → ${mode}`));
    this.mode = mode;
  }
}
