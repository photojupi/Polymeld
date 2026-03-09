import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GitHubClient, NoOpGitHub } from "../src/github/client.js";

// ─── NoOpGitHub ─────────────────────────────────────

describe("NoOpGitHub", () => {
  const noop = new NoOpGitHub();

  it("모든 async 메서드가 에러 없이 실행", async () => {
    await noop.ensureLabels();
    await noop.findOrCreateProject();
    await noop.addComment(1, "body");
    await noop.updateLabels(1);
    await noop.closeIssue(1);
    await noop.addIssueToProject("id");
    await noop.configureProjectStatuses();
    await noop.setProjectItemStatus("id", "Done");
    await noop.ensureInitialCommit();
    await noop.createBranch("branch");
    await noop.commitFile("branch", "path", "content", "msg");
  });

  it("createIssue → { number: 0, node_id: '' }", async () => {
    const result = await noop.createIssue("title", "body");
    assert.equal(result.number, 0);
    assert.equal(result.node_id, "");
  });

  it("createPR → { number: 0 }", async () => {
    const result = await noop.createPR("title", "body", "branch");
    assert.equal(result.number, 0);
  });

  it("issueUrl → 빈 문자열", () => {
    assert.equal(noop.issueUrl(1), "");
  });

  it("prUrl → 빈 문자열", () => {
    assert.equal(noop.prUrl(1), "");
  });
});

// ─── GitHubClient 생성자 ────────────────────────────

function createMockClient() {
  const client = Object.create(GitHubClient.prototype);
  client.owner = "test-owner";
  client.repo = "test-repo";
  client._knownLabels = new Set();
  client._defaultBranch = null;
  client.octokit = {
    rest: {
      issues: {
        create: async (params) => ({ data: { number: 42, node_id: "NODE42", ...params } }),
        createLabel: async () => ({}),
        createComment: async (params) => ({ data: { id: 1, ...params } }),
        get: async () => ({ data: { labels: [{ name: "existing" }] } }),
        update: async () => ({}),
      },
      pulls: {
        create: async (params) => ({ data: { number: 10, ...params } }),
      },
      repos: {
        get: async () => ({ data: { default_branch: "main" } }),
      },
      git: {
        getRef: async () => ({ data: { object: { sha: "abc123" } } }),
        createRef: async () => ({}),
      },
    },
    graphql: async () => ({}),
  };
  return client;
}

describe("GitHubClient 생성자", () => {
  it("owner/repo를 올바르게 파싱", () => {
    const client = new GitHubClient("token", "my-org/my-repo");
    assert.equal(client.owner, "my-org");
    assert.equal(client.repo, "my-repo");
  });

  it("issueUrl 포맷", () => {
    const client = createMockClient();
    assert.equal(client.issueUrl(5), "https://github.com/test-owner/test-repo/issues/5");
  });

  it("prUrl 포맷", () => {
    const client = createMockClient();
    assert.equal(client.prUrl(3), "https://github.com/test-owner/test-repo/pull/3");
  });
});

// ─── ensureLabels ───────────────────────────────────

describe("GitHubClient.ensureLabels", () => {
  it("라벨 생성 후 _knownLabels에 캐시", async () => {
    const client = createMockClient();
    await client.ensureLabels({ bug: "ff0000", feature: "00ff00" });
    assert.ok(client._knownLabels.has("bug"));
    assert.ok(client._knownLabels.has("feature"));
  });

  it("422 에러(이미 존재) 무시", async () => {
    const client = createMockClient();
    client.octokit.rest.issues.createLabel = async () => {
      const err = new Error("already exists");
      err.status = 422;
      throw err;
    };
    // 에러 없이 완료되어야 함
    await client.ensureLabels({ existing: "aaa" });
    assert.ok(client._knownLabels.has("existing"));
  });

  it("422가 아닌 에러는 throw", async () => {
    const client = createMockClient();
    client.octokit.rest.issues.createLabel = async () => {
      const err = new Error("server error");
      err.status = 500;
      throw err;
    };
    await assert.rejects(() => client.ensureLabels({ bad: "000" }));
  });
});

// ─── _ensureDynamicLabels ───────────────────────────

describe("GitHubClient._ensureDynamicLabels", () => {
  it("이미 캐시된 라벨은 API 호출 건너뜀", async () => {
    const client = createMockClient();
    client._knownLabels.add("known");
    let callCount = 0;
    client.octokit.rest.issues.createLabel = async () => { callCount++; return {}; };
    await client._ensureDynamicLabels(["known", "new-one"]);
    assert.equal(callCount, 1); // "new-one"만 호출
    assert.ok(client._knownLabels.has("new-one"));
  });

  it("422 에러 시 캐시에 추가 (이미 존재)", async () => {
    const client = createMockClient();
    client.octokit.rest.issues.createLabel = async () => {
      const err = new Error("exists");
      err.status = 422;
      throw err;
    };
    await client._ensureDynamicLabels(["already-there"]);
    assert.ok(client._knownLabels.has("already-there"));
  });
});

// ─── createIssue ────────────────────────────────────

describe("GitHubClient.createIssue", () => {
  it("이슈 생성 후 data 반환", async () => {
    const client = createMockClient();
    const result = await client.createIssue("Test Issue", "body", ["bug"]);
    assert.equal(result.number, 42);
    assert.equal(result.node_id, "NODE42");
  });
});

// ─── addComment ─────────────────────────────────────

describe("GitHubClient.addComment", () => {
  it("코멘트 생성 후 data 반환", async () => {
    const client = createMockClient();
    const result = await client.addComment(1, "comment body");
    assert.equal(result.id, 1);
  });
});

// ─── updateLabels ───────────────────────────────────

describe("GitHubClient.updateLabels", () => {
  it("기존 라벨에서 제거 + 추가 후 업데이트", async () => {
    const client = createMockClient();
    let updatedLabels;
    client.octokit.rest.issues.update = async (params) => {
      updatedLabels = params.labels;
    };
    await client.updateLabels(1, ["new-label"], ["existing"]);
    assert.ok(updatedLabels.includes("new-label"));
    assert.ok(!updatedLabels.includes("existing"));
  });

  it("에러 시 throw하지 않고 warn만", async () => {
    const client = createMockClient();
    client.octokit.rest.issues.get = async () => { throw new Error("fail"); };
    // 에러 없이 완료 (console.warn만)
    await client.updateLabels(1, ["a"], ["b"]);
  });
});

// ─── closeIssue ─────────────────────────────────────

describe("GitHubClient.closeIssue", () => {
  it("이슈 닫기 호출", async () => {
    const client = createMockClient();
    let closedState;
    client.octokit.rest.issues.update = async (params) => {
      closedState = params.state;
    };
    await client.closeIssue(5);
    assert.equal(closedState, "closed");
  });

  it("에러 시 throw하지 않고 warn만", async () => {
    const client = createMockClient();
    client.octokit.rest.issues.update = async () => { throw new Error("fail"); };
    await client.closeIssue(5);
  });
});

// ─── createPR ───────────────────────────────────────

describe("GitHubClient.createPR", () => {
  it("PR 생성 후 data 반환", async () => {
    const client = createMockClient();
    const result = await client.createPR("PR Title", "body", "feature/x");
    assert.equal(result.number, 10);
  });
});

// ─── createBranch ───────────────────────────────────

describe("GitHubClient.createBranch", () => {
  it("브랜치 생성 후 이름 반환", async () => {
    const client = createMockClient();
    const result = await client.createBranch("feature/new");
    assert.equal(result, "feature/new");
  });

  it("422(이미 존재) 에러 시 이름 반환", async () => {
    const client = createMockClient();
    client.octokit.rest.git.createRef = async () => {
      const err = new Error("exists");
      err.status = 422;
      throw err;
    };
    const result = await client.createBranch("existing-branch");
    assert.equal(result, "existing-branch");
  });

  it("422가 아닌 에러는 throw", async () => {
    const client = createMockClient();
    client.octokit.rest.git.createRef = async () => {
      const err = new Error("server error");
      err.status = 500;
      throw err;
    };
    await assert.rejects(() => client.createBranch("bad-branch"));
  });
});
