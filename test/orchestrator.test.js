import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { PipelineOrchestrator } from "../src/pipeline/orchestrator.js";
import { initI18n } from "../src/i18n/index.js";

before(async () => {
  await initI18n("ko");
});

// PipelineOrchestrator 순수 헬퍼 테스트를 위한 최소 mock
// 생성자를 우회하고 prototype 메서드만 사용
function createMockOrchestrator() {
  const orch = Object.create(PipelineOrchestrator.prototype);
  return orch;
}

// ─── _isImageTask ───────────────────────────────────

describe("PipelineOrchestrator._isImageTask", () => {
  const orch = createMockOrchestrator();

  it("title에 '이미지' 포함 → true", () => {
    assert.equal(orch._isImageTask({ title: "메인 이미지 제작" }), true);
  });

  it("description에 'icon' 포함 → true", () => {
    assert.equal(orch._isImageTask({ title: "에셋", description: "app icon design" }), true);
  });

  it("category에 'design' 포함 → true", () => {
    assert.equal(orch._isImageTask({ title: "작업", category: "design" }), true);
  });

  it("키워드 없음 → false", () => {
    assert.equal(orch._isImageTask({ title: "API 구현", description: "REST endpoint" }), false);
  });

  it("빈 태스크 → false", () => {
    assert.equal(orch._isImageTask({}), false);
  });

  it("logo, wireframe 키워드", () => {
    assert.equal(orch._isImageTask({ title: "로고 디자인" }), true);
    assert.equal(orch._isImageTask({ description: "wireframe 작성" }), true);
  });
});

// ─── _getReadyTasks ─────────────────────────────────

describe("PipelineOrchestrator._getReadyTasks", () => {
  const orch = createMockOrchestrator();

  const mockAgent = { id: "dev", name: "Dev" };

  it("의존성 없는 태스크 → 즉시 ready", () => {
    const tasks = [
      { id: "task-1", assignedAgent: mockAgent, dependencies: [] },
      { id: "task-2", assignedAgent: mockAgent },
    ];
    const ready = orch._getReadyTasks(tasks, new Set(), new Set());
    assert.equal(ready.length, 2);
  });

  it("의존성 충족 → ready", () => {
    const tasks = [
      { id: "task-1", assignedAgent: mockAgent, dependencies: [1] },
    ];
    const completed = new Set(["task-1"]); // task-1 자체는 이미 완료로 마킹
    // task-1이 task-1에 의존하면 자기참조 — 실제로는 발생하지 않지만, 이미 completed이므로 필터됨
    const tasks2 = [
      { id: "task-2", assignedAgent: mockAgent, dependencies: [1] },
    ];
    const ready = orch._getReadyTasks(tasks2, new Set(["task-1"]), new Set());
    assert.equal(ready.length, 1);
    assert.equal(ready[0].id, "task-2");
  });

  it("의존성 미충족 → 제외", () => {
    const tasks = [
      { id: "task-2", assignedAgent: mockAgent, dependencies: [1] },
    ];
    const ready = orch._getReadyTasks(tasks, new Set(), new Set());
    assert.equal(ready.length, 0);
  });

  it("실패 태스크에 의존 → 제외", () => {
    const tasks = [
      { id: "task-2", assignedAgent: mockAgent, dependencies: [1] },
    ];
    const ready = orch._getReadyTasks(tasks, new Set(), new Set(["task-1"]));
    assert.equal(ready.length, 0);
  });

  it("이미 완료된 태스크 → 제외", () => {
    const tasks = [
      { id: "task-1", assignedAgent: mockAgent },
    ];
    const ready = orch._getReadyTasks(tasks, new Set(["task-1"]), new Set());
    assert.equal(ready.length, 0);
  });

  it("assignedAgent 없는 태스크 → 제외", () => {
    const tasks = [
      { id: "task-1", assignedAgent: null },
    ];
    const ready = orch._getReadyTasks(tasks, new Set(), new Set());
    assert.equal(ready.length, 0);
  });

  it("이미 code가 있는 태스크 → 제외", () => {
    const tasks = [
      { id: "task-1", assignedAgent: mockAgent, code: "console.log('done')" },
    ];
    const ready = orch._getReadyTasks(tasks, new Set(), new Set());
    assert.equal(ready.length, 0);
  });
});

// ─── _parseFilePathsFromResponse ────────────────────

describe("PipelineOrchestrator._parseFilePathsFromResponse", () => {
  const orch = createMockOrchestrator();

  it("null → 빈 배열", () => {
    assert.deepEqual(orch._parseFilePathsFromResponse(null), []);
  });

  it("빈 문자열 → 빈 배열", () => {
    assert.deepEqual(orch._parseFilePathsFromResponse(""), []);
  });

  it("```lang filepath 패턴 추출", () => {
    const text = "다음 파일을 생성합니다:\n```javascript src/utils/helper.js\nconst x = 1;\n```";
    const result = orch._parseFilePathsFromResponse(text);
    assert.ok(result.includes("src/utils/helper.js"));
  });

  it("코드블록 내 // 주석 패턴 추출", () => {
    const text = "```js\n// src/api/router.js\nfunction route() {}\n```";
    const result = orch._parseFilePathsFromResponse(text);
    assert.ok(result.includes("src/api/router.js"));
  });

  it("코드블록 내 # 주석 패턴 추출", () => {
    const text = "```python\n# scripts/deploy.py\nimport os\n```";
    const result = orch._parseFilePathsFromResponse(text);
    assert.ok(result.includes("scripts/deploy.py"));
  });

  it("경로 없는 코드블록 → 빈 배열", () => {
    const text = "```javascript\nconst x = 1;\n```";
    const result = orch._parseFilePathsFromResponse(text);
    assert.equal(result.length, 0);
  });

  it("중복 경로 제거", () => {
    const text = "```js src/app.js\n// src/app.js\ncode\n```";
    const result = orch._parseFilePathsFromResponse(text);
    assert.equal(result.filter(p => p === "src/app.js").length, 1);
  });
});

// ─── _reviewNeedsFix / _qaNeedsFix ──────────────────

describe("PipelineOrchestrator._reviewNeedsFix", () => {
  const orch = createMockOrchestrator();

  it("CHANGES_REQUESTED → true", () => {
    assert.equal(orch._reviewNeedsFix("수정이 필요합니다. 다음을 변경하세요."), true);
  });

  it("APPROVED → false", () => {
    assert.equal(orch._reviewNeedsFix("코드가 승인되었습니다. 잘 작성됨."), false);
  });
});

describe("PipelineOrchestrator._qaNeedsFix", () => {
  const orch = createMockOrchestrator();

  it("FAIL → true", () => {
    assert.equal(orch._qaNeedsFix("종합: FAIL\n❌ 테스트 실패"), true);
  });

  it("PASS → false", () => {
    assert.equal(orch._qaNeedsFix("모든 테스트 통과\n✅ 성공"), false);
  });
});
