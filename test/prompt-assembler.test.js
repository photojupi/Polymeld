import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { initI18n } from "../src/i18n/index.js";
import { PromptAssembler } from "../src/state/prompt-assembler.js";
import { PipelineState } from "../src/state/pipeline-state.js";

before(async () => {
  await initI18n("ko");
});

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

// ─── kickoffSummary 통합 ─────────────────────────────

describe("kickoffSummary 통합", () => {
  it("forCoding: kickoffSummary가 systemContext에 포함", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    state.kickoffSummary = "프로젝트 목표: 생산성 도구 개발";
    const result = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });
    assert.ok(result.systemContext.includes("킥오프 요약"));
    assert.ok(result.systemContext.includes("생산성 도구"));
  });

  it("forCoding: kickoffSummary가 빈 문자열이면 섹션 미생성", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    state.kickoffSummary = "";
    const result = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });
    assert.ok(!result.systemContext.includes("킥오프 요약"));
  });

  it("forReview: kickoffSummary가 systemContext에 포함", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    state.kickoffSummary = "핵심 우려: 보안";
    const result = assembler.forReview(state, { taskId: "task-1" });
    assert.ok(result.systemContext.includes("핵심 우려: 보안"));
  });

  it("forFix: kickoffSummary가 systemContext에 포함", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    state.kickoffSummary = "MVP 범위 확정";
    const result = assembler.forFix(state, { agentId: "dev1", taskId: "task-1", feedbackSource: "review" });
    assert.ok(result.systemContext.includes("MVP 범위 확정"));
  });
});

// ─── Phase별 차등 예산 ─────────────────────────────────

describe("Phase별 차등 예산", () => {
  it("maxChars 미지정 시 forCoding은 forQA보다 큰 예산 사용", () => {
    const assembler = new PromptAssembler(); // maxChars 미지정 → Phase별 예산 활성화
    const state = makeState();
    state.designDecisions = "A".repeat(15000);

    const codingResult = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });
    const qaResult = assembler.forQA(state, { taskId: "task-1" });

    // coding(12000)은 QA(4000)보다 훨씬 긴 systemContext 허용
    assert.ok(codingResult.systemContext.length > qaResult.systemContext.length);
  });

  it("maxChars 지정 시 모든 Phase에 동일 예산 적용 (하위 호환)", () => {
    const assembler = new PromptAssembler({ maxChars: 3000 });
    const state = makeState();
    state.designDecisions = "A".repeat(15000);

    const result = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });
    assert.ok(result.systemContext.length <= 3000);
  });

  it("메서드 호출 시 maxChars 직접 전달하면 그 값 우선", () => {
    const assembler = new PromptAssembler(); // Phase별 예산 활성화
    const state = makeState();
    state.designDecisions = "A".repeat(15000);

    const result = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1", maxChars: 500 });
    assert.ok(result.systemContext.length <= 500);
  });
});

// ─── forCoding fix 사이클 분기 ─────────────────────────

describe("forCoding fix 사이클 분기", () => {
  it("fix 사이클에서 수정 지시가 코드베이스보다 앞에 배치", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    state.addMessage({
      from: "tech_lead",
      to: "dev1",
      type: "fix_guidance",
      content: "에러 핸들링 추가 필요",
      taskId: "task-1",
    });

    const result = assembler.forCoding(state, {
      agentId: "dev1",
      taskId: "task-1",
      codebaseContext: "기존 코드 내용...",
    });

    const fixIdx = result.systemContext.indexOf("팀장 수정 지시");
    const codebaseIdx = result.systemContext.indexOf("기존 코드베이스");

    // 수정 지시가 코드베이스보다 앞에 나옴
    assert.ok(fixIdx !== -1, "수정 지시 섹션이 존재해야 함");
    if (codebaseIdx !== -1) {
      assert.ok(fixIdx < codebaseIdx, "수정 지시가 코드베이스보다 앞에 위치해야 함");
    }
  });

  it("fix 사이클에서 이전 리뷰/QA 결과 포함", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    state.addMessage({
      from: "tech_lead",
      to: "dev1",
      type: "fix_guidance",
      content: "수정하세요",
      taskId: "task-1",
    });

    const result = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });
    assert.ok(result.systemContext.includes("이전 리뷰 결과"));
    assert.ok(result.systemContext.includes("변수 네이밍 개선 필요"));
  });

  it("최초 코딩에서는 킥오프 요약 포함, fix 사이클에서는 생략", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    state.kickoffSummary = "킥오프 내용";

    // 최초 코딩: 킥오프 포함
    const firstResult = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });
    assert.ok(firstResult.systemContext.includes("킥오프 요약"));

    // fix 사이클: 킥오프 생략 (수정 지시가 대신 들어감)
    state.addMessage({
      from: "tech_lead",
      to: "dev1",
      type: "fix_guidance",
      content: "수정 필요",
      taskId: "task-1",
    });
    const fixResult = assembler.forCoding(state, { agentId: "dev1", taskId: "task-1" });
    assert.ok(!fixResult.systemContext.includes("킥오프 요약"));
  });
});

// ─── forFix 수정 이력 ────────────────────────────────

describe("forFix 수정 이력", () => {
  it("최근 2개 수정 지시를 모두 포함", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    for (let i = 1; i <= 3; i++) {
      state.addMessage({
        from: "tech_lead",
        to: "dev1",
        type: "fix_guidance",
        content: `수정 지시 ${i}`,
        taskId: "task-1",
      });
    }

    const result = assembler.forFix(state, { agentId: "dev1", taskId: "task-1", feedbackSource: "review" });
    // 가장 오래된(1번)은 제외, 최근 2개(2, 3)만 포함
    assert.ok(!result.systemContext.includes("수정 지시 1"));
    assert.ok(result.systemContext.includes("수정 지시 2"));
    assert.ok(result.systemContext.includes("수정 지시 3"));
  });

  it("이전 수정 지시에 '이전' 라벨 표시", () => {
    const assembler = new PromptAssembler({ maxChars: 6000 });
    const state = makeState();
    state.addMessage({
      from: "tech_lead",
      to: "dev1",
      type: "fix_guidance",
      content: "첫 번째 지시",
      taskId: "task-1",
    });
    state.addMessage({
      from: "tech_lead",
      to: "dev1",
      type: "fix_guidance",
      content: "두 번째 지시",
      taskId: "task-1",
    });

    const result = assembler.forFix(state, { agentId: "dev1", taskId: "task-1", feedbackSource: "review" });
    assert.ok(result.systemContext.includes("이전 수정 지시"));
    assert.ok(result.systemContext.includes("현재 수정 지시"));
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
