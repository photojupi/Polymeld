import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PromptAssembler } from "../src/state/prompt-assembler.js";
import { PipelineState } from "../src/state/pipeline-state.js";

function makeState() {
  const state = new PipelineState();
  state.project = { requirement: "할 일 앱 만들기", title: "TodoApp" };
  state.designDecisions = "React + Express + PostgreSQL";
  state.tasks = [{
    id: "task-1",
    title: "API 설계",
    description: "RESTful API 엔드포인트 설계",
    acceptance_criteria: ["CRUD 엔드포인트", "에러 핸들링"],
    code: 'const app = express();',
    review: "변수 네이밍 개선 필요",
    qa: "종합: PASS",
  }];
  return state;
}

// ─── forCoding ────────────────────────────────────────

describe("PromptAssembler.forCoding", () => {
  it("기본 동작: systemContext, taskDescription, acceptanceCriteria 반환", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    const result = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });

    assert.ok(result.systemContext.includes("TodoApp"));
    assert.equal(result.taskDescription, "RESTful API 엔드포인트 설계");
    assert.ok(result.acceptanceCriteria.includes("CRUD 엔드포인트"));
  });

  it("설계 결정이 systemContext에 포함", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    const result = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });

    assert.ok(result.systemContext.includes("React + Express"));
  });

  it("예산이 매우 작으면 설계 결정 생략 가능", () => {
    const assembler = new PromptAssembler({ maxChars: 100 });
    const state = makeState();
    state.designDecisions = "A".repeat(200);
    const result = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });

    // 프로젝트 섹션은 반드시 포함, 설계 결정은 절삭될 수 있음
    assert.ok(result.systemContext.includes("TodoApp"));
  });

  it("fix_guidance 메시지가 systemContext에 포함", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    state.addMessage({
      from: "tech_lead",
      to: "dev1",
      type: "fix_guidance",
      content: "에러 핸들링을 추가하세요",
      taskId: "task-1",
    });

    const result = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });
    assert.ok(result.systemContext.includes("에러 핸들링을 추가하세요"));
  });
});

// ─── forReview ────────────────────────────────────────

describe("PromptAssembler.forReview", () => {
  it("코드와 수용 기준 반환", () => {
    const assembler = new PromptAssembler();
    const state = makeState();
    const result = assembler.forReview(state, { taskId: "task-1" });

    assert.equal(result.code, "const app = express();");
    assert.ok(result.criteria.includes("CRUD 엔드포인트"));
  });

  it("이전 리뷰가 있으면 systemContext에 포함", () => {
    const assembler = new PromptAssembler();
    const state = makeState();
    const result = assembler.forReview(state, { taskId: "task-1" });

    assert.ok(result.systemContext.includes("변수 네이밍 개선 필요"));
  });

  it("태스크가 없으면 빈 문자열", () => {
    const assembler = new PromptAssembler();
    const state = makeState();
    const result = assembler.forReview(state, { taskId: "없는-태스크" });

    assert.equal(result.code, "");
    assert.equal(result.criteria, "");
  });
});

// ─── forQA ────────────────────────────────────────────

describe("PromptAssembler.forQA", () => {
  it("코드, 수용 기준, 태스크 설명 반환", () => {
    const assembler = new PromptAssembler();
    const state = makeState();
    const result = assembler.forQA(state, { taskId: "task-1" });

    assert.equal(result.code, "const app = express();");
    assert.ok(result.criteria.includes("CRUD 엔드포인트"));
    assert.equal(result.taskDescription, "RESTful API 엔드포인트 설계");
  });
});

// ─── _truncate ────────────────────────────────────────

describe("PromptAssembler._truncate", () => {
  it("예산 이내면 그대로 반환", () => {
    const assembler = new PromptAssembler();
    assert.equal(assembler._truncate("short", 100), "short");
  });

  it("예산 초과 시 절삭 + 표시", () => {
    const assembler = new PromptAssembler();
    const long = "A".repeat(200);
    const result = assembler._truncate(long, 50);
    assert.ok(result.length <= 50);
    assert.ok(result.includes("예산 내 절삭"));
  });

  it("null 입력 시 null 반환", () => {
    const assembler = new PromptAssembler();
    assert.equal(assembler._truncate(null, 100), null);
  });

  it("객체 입력 시 JSON.stringify 후 처리", () => {
    const assembler = new PromptAssembler();
    const result = assembler._truncate({ key: "value" }, 1000);
    assert.ok(result.includes('"key"'));
  });
});
