// src/github/client.js
// GitHub 연동 모듈 - Octokit 기반

import { Octokit } from "octokit";
import { t } from "../i18n/index.js";

/** Pipeline 6단계 → 빌트인 Status 3단계 매핑 */
const PIPELINE_TO_STATUS = {
  "Backlog":     "Todo",
  "Todo":        "Todo",
  "In Progress": "In Progress",
  "In Review":   "In Progress",
  "QA":          "In Progress",
  "Done":        "Done",
};

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
  async addIssueToProject() { return null; }
  async configureProjectStatuses() {}
  async setProjectItemStatus() {}
  async ensureInitialCommit() {}
  async createBranch() {}
  async commitFile() {}
  async createPR() { return { number: 0 }; }
  issueUrl() { return ""; }
  prUrl() { return ""; }
}

export class GitHubClient {
  constructor(token, repo) {
    this.octokit = new Octokit({ auth: token });
    const [owner, repoName] = repo.split("/");
    this.owner = owner;
    this.repo = repoName;
    this.projectNumber = null;
    this._knownLabels = new Set();
  }

  issueUrl(number) {
    return `https://github.com/${this.owner}/${this.repo}/issues/${number}`;
  }

  prUrl(number) {
    return `https://github.com/${this.owner}/${this.repo}/pull/${number}`;
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
      this._knownLabels.add(name);
    }
  }

  /**
   * 동적 라벨(assigned:xxx 등)이 없으면 자동 생성
   * _knownLabels 캐시로 중복 API 호출 방지
   */
  async _ensureDynamicLabels(labels) {
    const unknown = labels.filter((l) => !this._knownLabels.has(l));
    for (const name of unknown) {
      try {
        await this.octokit.rest.issues.createLabel({
          owner: this.owner,
          repo: this.repo,
          name,
          color: "ededed",
        });
        this._knownLabels.add(name);
      } catch (e) {
        if (e.status === 422) {
          this._knownLabels.add(name); // 이미 존재 → 캐시에 추가
        }
        // 다른 에러는 캐시에 추가하지 않음 (다음 호출 시 재시도)
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
    try {
      await this._ensureDynamicLabels(addLabels);

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
    } catch (e) {
      console.warn(t("github.updateLabelsFailed", { number: issueNumber, message: e.message }));
    }
  }

  async closeIssue(issueNumber) {
    try {
      await this.octokit.rest.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        state: "closed",
      });
    } catch (e) {
      console.warn(t("github.closeIssueFailed", { number: issueNumber, message: e.message }));
    }
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
      console.warn(t("github.ownerNotFound"));
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
        t("github.projectCreateFailed"), e.message,
        `\n   ${t("github.projectScopeHint")}`
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
        console.warn(t("github.projectLinkFailed"), e.message);
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

  async addIssueToProject(issueNodeId, statusName) {
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
      const item = addProjectV2ItemById.item;
      if (statusName && item) {
        await this.setProjectItemStatus(item.id, statusName);
      }
      return item;
    } catch (e) {
      console.warn("프로젝트에 이슈 추가 실패:", e.message);
      return null;
    }
  }

  /**
   * 커스텀 "Pipeline" SingleSelect 필드를 생성/캐시하여 칸반보드 6단계 컬럼으로 사용
   * 빌트인 Status 필드는 API로 옵션 추가 불가 → 커스텀 필드로 대체
   */
  async configureProjectStatuses() {
    if (!this.projectId) return;

    const FIELD_NAME = "Pipeline";
    const DESIRED = ["Backlog", "Todo", "In Progress", "In Review", "QA", "Done"];

    try {
      // 기존 필드 조회
      const { node } = await this.octokit.graphql(`
        query($projectId: ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              fields(first: 30) {
                nodes {
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    options { id name }
                  }
                }
              }
            }
          }
        }
      `, { projectId: this.projectId });

      let field = node.fields.nodes.find(f => f.name === FIELD_NAME);

      // Pipeline 필드가 없으면 생성
      if (!field) {
        const { createProjectV2Field } = await this.octokit.graphql(`
          mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
            createProjectV2Field(input: {
              projectId: $projectId
              name: $name
              dataType: $dataType
              singleSelectOptions: $options
            }) {
              projectV2Field {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options { id name }
                }
              }
            }
          }
        `, {
          projectId: this.projectId,
          name: FIELD_NAME,
          dataType: "SINGLE_SELECT",
          options: DESIRED.map(name => ({ name, color: "GRAY", description: "" })),
        });

        field = createProjectV2Field.projectV2Field;
        console.log(t("github.pipelineFieldCreated"));
      }

      // Pipeline 필드 ID + 옵션 ID 캐시
      this.statusFieldId = field.id;
      this.statusOptions = {};
      for (const opt of field.options) {
        if (DESIRED.includes(opt.name)) this.statusOptions[opt.name] = opt.id;
      }

      // 빌트인 Status 필드 캐시 (칸반보드 기본 뷰용)
      const builtinStatus = node.fields.nodes.find(f => f.name === "Status");
      if (builtinStatus) {
        this.builtinStatusFieldId = builtinStatus.id;
        this.builtinStatusOptions = {};
        for (const opt of builtinStatus.options) {
          this.builtinStatusOptions[opt.name] = opt.id;
        }
      }
    } catch (e) {
      console.warn(t("github.pipelineFieldFailed"), e.message);
    }
  }

  /**
   * 프로젝트 아이템의 Status 필드 값을 변경
   */
  async setProjectItemStatus(itemId, statusName) {
    if (!this.projectId || !this.statusFieldId || !this.statusOptions) return;
    const optionId = this.statusOptions[statusName];
    if (!optionId || !itemId) return;

    try {
      await this.octokit.graphql(`
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
          }) {
            projectV2Item { id }
          }
        }
      `, {
        projectId: this.projectId,
        itemId,
        fieldId: this.statusFieldId,
        optionId,
      });
    } catch (e) {
      console.warn("프로젝트 Status 업데이트 실패:", e.message);
    }

    // 빌트인 Status 필드 동기화 (칸반보드 기본 뷰 반영)
    const mappedStatus = PIPELINE_TO_STATUS[statusName];
    if (mappedStatus && this.builtinStatusFieldId && this.builtinStatusOptions) {
      const builtinOptionId = this.builtinStatusOptions[mappedStatus];
      if (builtinOptionId) {
        try {
          await this.octokit.graphql(`
            mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
              updateProjectV2ItemFieldValue(input: {
                projectId: $projectId
                itemId: $itemId
                fieldId: $fieldId
                value: { singleSelectOptionId: $optionId }
              }) {
                projectV2Item { id }
              }
            }
          `, {
            projectId: this.projectId,
            itemId,
            fieldId: this.builtinStatusFieldId,
            optionId: builtinOptionId,
          });
        } catch (e) {
          console.warn("빌트인 Status 동기화 실패:", e.message);
        }
      }
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
      if (e.status !== 409 && e.status !== 404) throw e;
    }

    // 빈 레포에서는 Git Data API(createBlob 등)가 동작하지 않으므로
    // Contents API를 사용하여 초기 커밋 생성
    await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path: "README.md",
      message: "Initial commit",
      content: Buffer.from(`# ${this.repo}\n`).toString("base64"),
    });
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
