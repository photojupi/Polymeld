// src/github/client.js
// GitHub 연동 모듈 - Octokit 기반

import { Octokit } from "octokit";

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
    // 기존 프로젝트 찾기
    const { user } = await this.octokit.graphql(`
      query($login: String!) {
        user(login: $login) {
          projectsV2(first: 20) {
            nodes { id title number }
          }
        }
      }
    `, { login: this.owner }).catch(() => ({ user: null }));

    if (user) {
      const existing = user.projectsV2.nodes.find(
        (p) => p.title === projectName
      );
      if (existing) {
        this.projectNumber = existing.number;
        this.projectId = existing.id;
        return existing;
      }
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
        ownerId: await this._getOwnerId(),
        title: projectName,
      });
      this.projectNumber = createProjectV2.projectV2.number;
      this.projectId = createProjectV2.projectV2.id;
      return createProjectV2.projectV2;
    } catch (e) {
      console.warn("프로젝트 생성 실패 (권한 부족 가능):", e.message);
      return null;
    }
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

  async _getOwnerId() {
    const { user } = await this.octokit.graphql(`
      query($login: String!) {
        user(login: $login) { id }
      }
    `, { login: this.owner });
    return user.id;
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
