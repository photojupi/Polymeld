import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  isImageTask,
  getReadyTasks,
  parseFilePathsFromResponse,
  reviewNeedsFix,
  qaNeedsFix,
} from "../src/pipeline/orchestrator.js";
import { initI18n } from "../src/i18n/index.js";

before(async () => {
  await initI18n("ko");
});

// ─── isImageTask ────────────────────────────────────

describe("isImageTask", () => {
  it("title에 '이미지' 포함 → true", () => {
    assert.equal(isImageTask({ title: "메인 이미지 제작" }), true);
  });

  it("description에 'icon' 포함 → true", () => {
    assert.equal(isImageTask({ title: "에셋", description: "app icon design" }), true);
  });

  it("category에 'design' 포함 → true", () => {
    assert.equal(isImageTask({ title: "작업", category: "design" }), true);
  });

  it("키워드 없음 → false", () => {
    assert.equal(isImageTask({ title: "API 구현", description: "REST endpoint" }), false);
  });

  it("빈 태스크 → false", () => {
    assert.equal(isImageTask({}), false);
  });

  it("logo, wireframe 키워드", () => {
    assert.equal(isImageTask({ title: "로고 디자인" }), true);
    assert.equal(isImageTask({ description: "wireframe 작성" }), true);
  });
});

// ─── getReadyTasks ──────────────────────────────────

describe("getReadyTasks", () => {
  const mockAgent = { id: "dev", name: "Dev" };

  it("의존성 없는 태스크 → 즉시 ready", () => {
    const tasks = [
      { id: "task-1", assignedAgent: mockAgent, dependencies: [] },
      { id: "task-2", assignedAgent: mockAgent },
    ];
    const ready = getReadyTasks(tasks, new Set(), new Set());
    assert.equal(ready.length, 2);
  });

  it("의존성 충족 → ready", () => {
    const tasks2 = [
      { id: "task-2", assignedAgent: mockAgent, dependencies: [1] },
    ];
    const ready = getReadyTasks(tasks2, new Set(["task-1"]), new Set());
    assert.equal(ready.length, 1);
    assert.equal(ready[0].id, "task-2");
  });

  it("의존성 미충족 → 제외", () => {
    const tasks = [
      { id: "task-2", assignedAgent: mockAgent, dependencies: [1] },
    ];
    const ready = getReadyTasks(tasks, new Set(), new Set());
    assert.equal(ready.length, 0);
  });

  it("실패 태스크에 의존 → 제외", () => {
    const tasks = [
      { id: "task-2", assignedAgent: mockAgent, dependencies: [1] },
    ];
    const ready = getReadyTasks(tasks, new Set(), new Set(["task-1"]));
    assert.equal(ready.length, 0);
  });

  it("이미 완료된 태스크 → 제외", () => {
    const tasks = [
      { id: "task-1", assignedAgent: mockAgent },
    ];
    const ready = getReadyTasks(tasks, new Set(["task-1"]), new Set());
    assert.equal(ready.length, 0);
  });

  it("assignedAgent 없는 태스크 → 제외", () => {
    const tasks = [
      { id: "task-1", assignedAgent: null },
    ];
    const ready = getReadyTasks(tasks, new Set(), new Set());
    assert.equal(ready.length, 0);
  });

  it("이미 code가 있는 태스크 → 제외", () => {
    const tasks = [
      { id: "task-1", assignedAgent: mockAgent, code: "console.log('done')" },
    ];
    const ready = getReadyTasks(tasks, new Set(), new Set());
    assert.equal(ready.length, 0);
  });
});

// ─── parseFilePathsFromResponse ─────────────────────

describe("parseFilePathsFromResponse", () => {
  it("null → 빈 배열", () => {
    assert.deepEqual(parseFilePathsFromResponse(null), []);
  });

  it("빈 문자열 → 빈 배열", () => {
    assert.deepEqual(parseFilePathsFromResponse(""), []);
  });

  it("```lang filepath 패턴 추출", () => {
    const text = "다음 파일을 생성합니다:\n```javascript src/utils/helper.js\nconst x = 1;\n```";
    const result = parseFilePathsFromResponse(text);
    assert.ok(result.includes("src/utils/helper.js"));
  });

  it("코드블록 내 // 주석 패턴 추출", () => {
    const text = "```js\n// src/api/router.js\nfunction route() {}\n```";
    const result = parseFilePathsFromResponse(text);
    assert.ok(result.includes("src/api/router.js"));
  });

  it("코드블록 내 # 주석 패턴 추출", () => {
    const text = "```python\n# scripts/deploy.py\nimport os\n```";
    const result = parseFilePathsFromResponse(text);
    assert.ok(result.includes("scripts/deploy.py"));
  });

  it("경로 없는 코드블록 → 빈 배열", () => {
    const text = "```javascript\nconst x = 1;\n```";
    const result = parseFilePathsFromResponse(text);
    assert.equal(result.length, 0);
  });

  it("중복 경로 제거", () => {
    const text = "```js src/app.js\n// src/app.js\ncode\n```";
    const result = parseFilePathsFromResponse(text);
    assert.equal(result.filter(p => p === "src/app.js").length, 1);
  });
});

// ─── reviewNeedsFix / qaNeedsFix ────────────────────

describe("reviewNeedsFix", () => {
  it("CHANGES_REQUESTED → true", () => {
    assert.equal(reviewNeedsFix("수정이 필요합니다. 다음을 변경하세요."), true);
  });

  it("APPROVED → false", () => {
    assert.equal(reviewNeedsFix("코드가 승인되었습니다. 잘 작성됨."), false);
  });
});

describe("qaNeedsFix", () => {
  it("FAIL → true", () => {
    assert.equal(qaNeedsFix("종합: FAIL\n❌ 테스트 실패"), true);
  });

  it("PASS → false", () => {
    assert.equal(qaNeedsFix("모든 테스트 통과\n✅ 성공"), false);
  });
});
