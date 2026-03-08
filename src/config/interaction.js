// src/config/interaction.js
// 인터랙션 모드 관리
// 사용자 확인 요청을 모드에 따라 자동/반자동/수동으로 처리

import inquirer from "inquirer";
import chalk from "chalk";
import { t } from "../i18n/index.js";

/**
 * 인터랙션 모드:
 *
 * - full-auto:  모든 확인을 자동으로 통과. 에러 발생 시에만 멈춤. (기본값)
 *
 * - semi-auto:  Phase 전환 시에만 확인. Phase 내부 세부사항은 자동 통과.
 *
 * - manual:     모든 확인 포인트에서 사용자 입력 대기.
 *               처음 사용하거나 세밀한 제어가 필요할 때.
 */

export class InteractionManager {
  constructor(mode = "full-auto", options = {}) {
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
      message: t("config.phaseComplete", { from: fromPhase, to: toPhase }),
      autoIn: ["full-auto"],
      askIn: ["semi-auto", "manual"],
      choices: [
        { name: t("config.choice.proceed"), value: "proceed" },
        { name: t("config.choice.retryPhase"), value: "retry" },
        { name: t("config.choice.abort"), value: "abort" },
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
        { name: t("config.choice.confirm"), value: "proceed" },
        { name: t("config.choice.edit"), value: "edit" },
        { name: t("config.choice.skip"), value: "skip" },
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
        { name: t("config.choice.continueProc"), value: "proceed" },
        { name: t("config.choice.retry"), value: "retry" },
        { name: t("config.choice.skip"), value: "skip" },
        { name: t("config.choice.stop"), value: "abort" },
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
        { name: t("config.choice.yes"), value: true },
        { name: t("config.choice.no"), value: false },
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
      message: t("config.additionalRound", { current: currentRound, max: maxRounds }),
      autoIn: ["full-auto", "semi-auto"],
      askIn: ["manual"],
      choices: [
        { name: t("config.choice.finishHere"), value: "proceed" },
        { name: t("config.choice.oneMoreRound"), value: "extend" },
        { name: t("config.choice.twoMoreRounds"), value: "extend2" },
      ],
      default: "proceed",
    });
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
          ? defaultVal ? t("config.choice.yes") : t("config.choice.no")
          : choices.find((c) => c.value === defaultVal)?.name || defaultVal;
      console.log(
        chalk.gray(`  ${t("config.autoSkip", { message, action: actionName })}`)
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
      chalk.yellow(`  ${t("config.timeoutLabel", { seconds: this.timeout, default: defaultVal })}`)
    );

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        decision.action = defaultVal;
        decision.auto = true;
        this.log.push(decision);
        console.log(chalk.gray(`  ${t("config.timeoutAction", { default: defaultVal })}`));
        resolve({ action: defaultVal });
      }, this.timeout * 1000);

      inquirer
        .prompt([
          {
            type: "list",
            name: "answer",
            message: t("config.timeoutPrompt", { message, seconds: this.timeout }),
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
    const lines = [`${t("config.decisionLogHeader")}\n`];
    lines.push(t("config.decisionLogTable"));
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
    console.log(chalk.cyan(`  ${t("config.modeChanged", { from: this.mode, to: mode })}`));
    this.mode = mode;
  }
}
