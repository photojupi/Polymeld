// src/pipeline/orchestrator.js
// 파이프라인 오케스트레이터 - 전체 Phase를 순서대로 실행
// PipelineState + PromptAssembler 기반 컨텍스트 관리
//
// Phase 로직은 phases/ 디렉토리에, 유틸리티는 helpers.js에 분리됨

import chalk from "chalk";
import { InteractionManager } from "../config/interaction.js";
import { t } from "../i18n/index.js";
import { printModelAssignment, relinkAgents } from "./helpers.js";
import { phaseCodebaseAnalysis, phasePlanning, phaseTaskBreakdown, phaseAssignment } from "./phases/planning.js";
import { phaseDevelopment } from "./phases/development.js";
import { phaseCodeReview, phaseQA } from "./phases/quality.js";
import { phasePR } from "./phases/delivery.js";

// 하위 호환: helpers에서 re-export (테스트에서 prototype 접근 시 필요)
export {
  isImageTask, formatMetaLine, printMeta,
  parseFilePathsFromResponse, getReadyTasks,
  reviewNeedsFix, qaNeedsFix,
} from "./helpers.js";


export class PipelineOrchestrator {
  /**
   * @param {import('../agents/team.js').Team} team
   * @param {import('../github/client.js').GitHubClient} github
   * @param {Object} config
   * @param {string} interactionMode
   * @param {Object} deps - 의존성
   * @param {import('../state/pipeline-state.js').PipelineState} deps.state
   * @param {import('../state/prompt-assembler.js').PromptAssembler} deps.assembler
   * @param {import('../workspace/local-workspace.js').LocalWorkspace|import('../workspace/noop-workspace.js').NoOpWorkspace} [deps.workspace]
   */
  constructor(team, github, config, interactionMode = "full-auto", { state, assembler, workspace, onPhaseSave }) {
    this.team = team;
    this.github = github;
    this.config = config;
    this.state = state;
    this.assembler = assembler;
    this.workspace = workspace;
    this.onPhaseSave = onPhaseSave || null;
    this.interaction = new InteractionManager(interactionMode, {
      timeout: config.pipeline?.auto_timeout || 0,
      defaultYes: true,
    });
    this._gitQueue = Promise.resolve();
  }

  async run(requirement, { isModification = false } = {}) {
    if (!this.state.project.requirement) {
      this.state.project.requirement = requirement;
    }
    const projectTitle = this.state.project.title;

    relinkAgents(this);

    const modeLabel = isModification ? t("pipeline.modeModification") : t("pipeline.modeNew");
    console.log(chalk.bold.cyan(`\n${t("pipeline.start", { mode: modeLabel })}\n`));
    console.log(chalk.gray(t("pipeline.project", { title: projectTitle })));
    console.log(chalk.gray(t("pipeline.requirement", { requirement })));
    console.log(chalk.gray(t("pipeline.interaction", { mode: this.interaction.mode }) + "\n"));

    printModelAssignment(this);

    // Phase 0: 코드베이스 분석 (수정 모드 + 로컬 워크스페이스)
    if (isModification && this.workspace?.isLocal) {
      await this._phase(t("pipeline.phase.codebaseAnalysis"), () => phaseCodebaseAnalysis(this, requirement), { phaseId: "codebaseAnalysis" });
    }

    // Phase 1-7
    await this._phase(t("pipeline.phase.planning"), () => phasePlanning(this), { phaseId: "planning" });
    await this._phase(t("pipeline.phase.taskBreakdown"), () => phaseTaskBreakdown(this), { phaseId: "taskBreakdown" });
    await this._phase(t("pipeline.phase.assignment"), () => phaseAssignment(this), { phaseId: "assignment" });
    await this._phase(t("pipeline.phase.development"), () => phaseDevelopment(this), { phaseId: "development" });
    await this._phase(t("pipeline.phase.codeReview"), () => phaseCodeReview(this), { phaseId: "codeReview" });
    await this._phase(t("pipeline.phase.qa"), () => phaseQA(this), { phaseId: "qa" });
    await this._phase(t("pipeline.phase.pr"), () => phasePR(this), { phaseId: "pr" });

    console.log(chalk.bold.green(`\n${t("pipeline.completed")}\n`));

    const decisionLog = this.interaction.getDecisionLog();
    console.log(chalk.gray(decisionLog));

    if (this.state.github.planningIssue && process.env.GITHUB_TOKEN) {
      await this.github.addComment(
        this.state.github.planningIssue,
        t("pipeline.pipelineCompleteComment", { mode: this.interaction.mode, log: decisionLog })
      );
      await this.github.closeIssue(this.state.github.planningIssue);
    }
  }

  async _phase(name, fn, { phaseId } = {}) {
    if (phaseId && this.state.isPhaseComplete(phaseId)) {
      console.log(chalk.gray(`\n${t("pipeline.phaseSkipped", { name })}`));
      return;
    }

    console.log(chalk.bold.yellow(`\n${"═".repeat(60)}`));
    console.log(chalk.bold.yellow(`  ${name}`));
    console.log(chalk.bold.yellow(`${"═".repeat(60)}\n`));

    const execute = async () => {
      try {
        await fn();
        return { skipped: false };
      } catch (error) {
        console.log(chalk.red(`\n${t("pipeline.phaseError", { message: error.message })}`));
        const { action } = await this.interaction.confirmWarning(
          t("pipeline.phaseErrorConfirm", { name, message: error.message }),
          "error"
        );
        if (action === "retry") return execute();
        if (action === "skip") return { skipped: true };
        if (action === "abort") throw new Error("Pipeline aborted by user");
        return { skipped: true };
      }
    };

    let result = await execute();

    const { action } = await this.interaction.confirmPhaseTransition(
      name,
      t("pipeline.nextPhase")
    );

    if (action === "retry") {
      result = await execute();
    } else if (action === "abort") {
      console.log(chalk.yellow(`\n${t("pipeline.pipelineAborted")}`));
      throw new Error("Pipeline aborted by user");
    }

    if (phaseId && !result?.skipped) {
      this.state.markPhaseComplete(phaseId);
      await this._saveCheckpoint();
    }
  }

  async _saveCheckpoint() {
    if (!this.onPhaseSave) return;
    try {
      await this.onPhaseSave();
    } catch (e) {
      console.log(chalk.yellow(`  ${t("pipeline.checkpointFailed", { message: e.message })}`));
    }
  }
}
