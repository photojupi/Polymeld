import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PipelineState } from "../src/state/pipeline-state.js";

// ─── 메시지 시스템 ────────────────────────────────────

describe("PipelineState 메시지", () => {
  it("addMessage: id 자동 증가", () => {
    const state = new PipelineState();
    const m1 = state.addMessage({ from: "a", to: "b", type: "test", content: "hello" });
    const m2 = state.addMessage({ from: "b", to: "a", type: "test", content: "world" });
    assert.equal(m1.id, 1);
    assert.equal(m2.id, 2);
    assert.equal(state.messages.length, 2);
  });

  it("getMessagesFor: to 필터", () => {
    const state = new PipelineState();
    state.addMessage({ from: "a", to: "b", type: "t1", content: "1" });
    state.addMessage({ from: "a", to: "c", type: "t1", content: "2" });
    state.addMessage({ from: "a", to: "b", type: "t2", content: "3" });

    const forB = state.getMessagesFor("b");
    assert.equal(forB.length, 2);
  });

  it("getMessagesFor: type + taskId 필터", () => {
    const state = new PipelineState();
    state.addMessage({ from: "a", to: "b", type: "fix", content: "1", taskId: "t1" });
    state.addMessage({ from: "a", to: "b", type: "fix", content: "2", taskId: "t2" });
    state.addMessage({ from: "a", to: "b", type: "review", content: "3", taskId: "t1" });

    const result = state.getMessagesFor("b", { type: "fix", taskId: "t1" });
    assert.equal(result.length, 1);
    assert.equal(result[0].content, "1");
  });

  it("broadcastMessage: to가 'all'로 설정", () => {
    const state = new PipelineState();
    const msg = state.broadcastMessage({ from: "a", type: "announce", content: "hi" });
    assert.equal(msg.to, "all");

    // 'all' 메시지는 모든 에이전트 조회에 포함
    const forB = state.getMessagesFor("b");
    assert.equal(forB.length, 1);
  });
});

// ─── findTask ─────────────────────────────────────────

describe("PipelineState.findTask", () => {
  it("id로 조회", () => {
    const state = new PipelineState();
    state.tasks = [{ id: "task-1", title: "API" }, { id: "task-2", title: "UI" }];
    assert.equal(state.findTask("task-1").title, "API");
  });

  it("title로 조회", () => {
    const state = new PipelineState();
    state.tasks = [{ id: "task-1", title: "API" }];
    assert.equal(state.findTask("API").id, "task-1");
  });

  it("없으면 undefined", () => {
    const state = new PipelineState();
    assert.equal(state.findTask("없는거"), undefined);
  });
});

// ─── toJSON / fromJSON 라운드트립 ─────────────────────

describe("PipelineState 직렬화", () => {
  it("toJSON → fromJSON 라운드트립", () => {
    const state = new PipelineState();
    state.project = { requirement: "앱 만들기", title: "MyApp" };
    state.kickoffSummary = "요약";
    state.designDecisions = "React + Node.js";
    state.tasks = [{ id: "t1", title: "초기 설정" }];
    state.addMessage({ from: "a", to: "b", type: "test", content: "hello" });
    state.github = { kickoffIssue: 1, designIssue: 2 };

    const json = state.toJSON();
    const restored = PipelineState.fromJSON(json);

    assert.deepEqual(restored.project, state.project);
    assert.equal(restored.kickoffSummary, "요약");
    assert.equal(restored.designDecisions, "React + Node.js");
    assert.equal(restored.tasks.length, 1);
    assert.equal(restored.messages.length, 1);
    assert.equal(restored.messages[0].content, "hello");
    assert.deepEqual(restored.github, { kickoffIssue: 1, designIssue: 2 });
  });

  it("toJSON: assignedAgent 인스턴스가 직렬화에서 제외되고 assignedAgentId는 보존", () => {
    const state = new PipelineState();
    const fakeAgent = { id: "ace_programmer", name: "한코딩", writeCode: () => {} };
    state.tasks = [
      { id: "t1", title: "API 구현", assignedAgentId: "ace_programmer", assignedAgent: fakeAgent },
      { id: "t2", title: "UI 구현", assignedAgentId: "creative_programmer" },
    ];
    state.completedTasks = [
      { id: "t0", title: "설정", assignedAgentId: "devops", assignedAgent: { id: "devops", writeCode: () => {} } },
    ];

    const json = state.toJSON();

    // assignedAgent가 직렬화에 포함되지 않아야 함
    assert.equal(json.tasks[0].assignedAgent, undefined);
    assert.equal(json.tasks[1].assignedAgent, undefined);
    assert.equal(json.completedTasks[0].assignedAgent, undefined);

    // assignedAgentId는 보존
    assert.equal(json.tasks[0].assignedAgentId, "ace_programmer");
    assert.equal(json.tasks[1].assignedAgentId, "creative_programmer");
    assert.equal(json.completedTasks[0].assignedAgentId, "devops");

    // fromJSON 후에도 assignedAgent가 없어야 재연결 가능
    const restored = PipelineState.fromJSON(json);
    assert.equal(restored.tasks[0].assignedAgent, undefined);
    assert.equal(restored.tasks[0].assignedAgentId, "ace_programmer");
  });

});
