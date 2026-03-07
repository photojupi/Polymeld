// src/github/client.js
// GitHub 연동 모듈 - Octokit 기반

import { Octokit } from "octokit";

/**
 * GitHub 미설정 시 사용하는 No-op 클라이언트
 * PipelineOrchestrator가 github 메서드를 호출해도 에러 나지 않음
 */
export class NoOpGitHub {
  async ensureLabels() {}
  async findOrCreateProject() {}
  async createIssue() { return { number: 0, node_id: "" }; }
  async addComment() {}
  async updateLabels() {}
  async closeIssue() {}
  async addIssueToProject() {}
  async ensureInitialCommit() {}
  async createBranch() {}
  async commitFile() {}
  async createPR() { return { number: 0 }; }
}

export class GitHubClient {
  constructor(token, repo) {
    this.octokit = new Octokit({ auth: token });
    const [owner, repoName] = repo.split("/");
    this.owner = owner;
    this.repo = repoName;
    this.projectNumber = null;
  }

  // ─── Labels ───────────────────────────────────────────

  async ensureLabels(labels) {
    for (const [name, color] of Object.entries(labels)) {
      try {
        await this.octokit.rest.issues.createLabel({
          owner: this.owner,
          repo: this.repo,
          name,
          color,
        });
      } catch (e) {
        if (e.status !== 422) throw e; // 422 = already exists
      }
    }
  }

  // ─── Issues ───────────────────────────────────────────

  async createIssue(title, body, labels = []) {
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      labels,
    });
    return data;
  }

  async addComment(issueNumber, body) {
    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });
    return data;
  }

  async updateLabels(issueNumber, addLabels = [], removeLabels = []) {
    // 현재 라벨 조회
    const { data: issue } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    const currentLabels = issue.labels.map((l) => l.name);
    const newLabels = currentLabels
      .filter((l) => !removeLabels.includes(l))
      .concat(addLabels);

    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      labels: [...new Set(newLabels)],
    });
  }

  async closeIssue(issueNumber) {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: "closed",
    });
  }

  // ─── Pull Requests ────────────────────────────────────

  async createPR(title, body, head, base = "main") {
    const { data } = await this.octokit.rest.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      head,
      base,
    });
    return data;
  }

  // ─── Projects (GraphQL) ───────────────────────────────

  async findOrCreateProject(projectName) {
    // owner 정보 조회 (user 또는 org)
    const ownerInfo = await this._resolveOwner();
    if (!ownerInfo) {
      console.warn("⚠️ GitHub owner를 찾을 수 없습니다. 프로젝트 보드를 건너뜁니다.");
      return null;
    }

    // 기존 프로젝트 찾기
    const existing = ownerInfo.projects.find((p) => p.title === projectName);
    if (existing) {
      this.projectNumber = existing.number;
      this.projectId = existing.id;
      await this._linkProjectToRepo(existing.id);
      return existing;
    }

    // 새 프로젝트 생성
    try {
      const { createProjectV2 } = await this.octokit.graphql(`
        mutation($ownerId: ID!, $title: String!) {
          createProjectV2(input: { ownerId: $ownerId, title: $title }) {
            projectV2 { id title number }
          }
        }
      `, {
        ownerId: ownerInfo.id,
        title: projectName,
      });
      this.projectNumber = createProjectV2.projectV2.number;
      this.projectId = createProjectV2.projectV2.id;
      await this._linkProjectToRepo(createProjectV2.projectV2.id);
      return createProjectV2.projectV2;
    } catch (e) {
      console.warn(
        "⚠️ 프로젝트 생성 실패:", e.message,
        "\n   → 토큰에 'project' scope가 있는지 확인하세요."
      );
      return null;
    }
  }

  /**
   * 프로젝트를 레포에 연결 (레포 Projects 탭에 표시되도록)
   */
  async _linkProjectToRepo(projectId) {
    try {
      const repoId = await this._getRepoId();
      await this.octokit.graphql(`
        mutation($projectId: ID!, $repositoryId: ID!) {
          linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
            repository { id }
          }
        }
      `, { projectId, repositoryId: repoId });
    } catch (e) {
      // 이미 연결된 경우 또는 권한 부족 → 무시
      if (!e.message?.includes("already linked")) {
        console.warn("⚠️ 프로젝트-레포 연결 실패:", e.message);
      }
    }
  }

  async _getRepoId() {
    const { repository } = await this.octokit.graphql(`
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) { id }
      }
    `, { owner: this.owner, name: this.repo });
    return repository.id;
  }

  async addIssueToProject(issueNodeId) {
    if (!this.projectId) return null;

    try {
      const { addProjectV2ItemById } = await this.octokit.graphql(`
        mutation($projectId: ID!, $contentId: ID!) {
          addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
            item { id }
          }
        }
      `, {
        projectId: this.projectId,
        contentId: issueNodeId,
      });
      return addProjectV2ItemById.item;
    } catch (e) {
      console.warn("프로젝트에 이슈 추가 실패:", e.message);
      return null;
    }
  }

  /**
   * owner가 user인지 organization인지 자동 판별하여 ID + 프로젝트 목록 반환
   * @returns {Promise<{id: string, type: string, projects: Array}>|null}
   */
  async _resolveOwner() {
    // 1차: user로 시도
    try {
      const { user } = await this.octokit.graphql(`
        query($login: String!) {
          user(login: $login) {
            id
            projectsV2(first: 20) {
              nodes { id title number }
            }
          }
        }
      `, { login: this.owner });
      if (user) {
        return { id: user.id, type: "user", projects: user.projectsV2.nodes };
      }
    } catch {
      // user가 아닐 수 있음 → org로 시도
    }

    // 2차: organization으로 시도
    try {
      const { organization } = await this.octokit.graphql(`
        query($login: String!) {
          organization(login: $login) {
            id
            projectsV2(first: 20) {
              nodes { id title number }
            }
          }
        }
      `, { login: this.owner });
      if (organization) {
        return { id: organization.id, type: "organization", projects: organization.projectsV2.nodes };
      }
    } catch {
      // org도 아님
    }

    return null;
  }

  // ─── Repository Initialization ─────────────────────────

  async ensureInitialCommit() {
    try {
      await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: "heads/main",
      });
      return;
    } catch (e) {
      if (e.status !== 409) throw e;
    }

    const { data: blob } = await this.octokit.rest.git.createBlob({
      owner: this.owner,
      repo: this.repo,
      content: Buffer.from(`# ${this.repo}\n`).toString("base64"),
      encoding: "base64",
    });

    const { data: tree } = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      tree: [{ path: "README.md", mode: "100644", type: "blob", sha: blob.sha }],
    });

    const { data: commit } = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: "Initial commit",
      tree: tree.sha,
      parents: [],
    });

    try {
      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: "refs/heads/main",
        sha: commit.sha,
      });
    } catch (e) {
      if (e.status !== 422) throw e;
    }
  }

  // ─── Branches ─────────────────────────────────────────

  async createBranch(branchName, baseBranch = "main") {
    try {
      const { data: ref } = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${baseBranch}`,
      });

      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${branchName}`,
        sha: ref.object.sha,
      });

      return branchName;
    } catch (e) {
      if (e.status === 422) return branchName; // already exists
      throw e;
    }
  }

  // ─── File Operations (for code commits) ───────────────

  async commitFile(branch, path, content, message) {
    // Get current commit SHA
    const { data: ref } = await this.octokit.rest.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
    });

    // Create blob
    const { data: blob } = await this.octokit.rest.git.createBlob({
      owner: this.owner,
      repo: this.repo,
      content: Buffer.from(content).toString("base64"),
      encoding: "base64",
    });

    // Get base tree
    const { data: commit } = await this.octokit.rest.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: ref.object.sha,
    });

    // Create tree
    const { data: tree } = await this.octokit.rest.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: commit.tree.sha,
      tree: [{ path, mode: "100644", type: "blob", sha: blob.sha }],
    });

    // Create commit
    const { data: newCommit } = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message,
      tree: tree.sha,
      parents: [ref.object.sha],
    });

    // Update reference
    await this.octokit.rest.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    return newCommit;
  }
}
