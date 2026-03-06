import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Team } from "../src/agents/team.js";

// Team.normalizeRole 테스트를 위한 최소 mock
// Team constructor는 config.personas → Agent 인스턴스를 만드므로,
// normalizeRole에 필요한 this.agents 구조만 직접 구성
function createMockTeam() {
  const team = Object.create(Team.prototype);
  team.agents = {
    tech_lead: { role: "Tech Lead (팀장)", onDemand: false },
    ace_programmer: { role: "Ace Programmer", onDemand: false },
    creative_programmer: { role: "Creative Programmer", onDemand: false },
    qa: { role: "QA Engineer", onDemand: false },
    backend_dev: { role: "Backend Developer", onDemand: true },
    frontend_dev: { role: "Frontend Developer", onDemand: true },
    devops: { role: "DevOps Engineer", onDemand: true },
  };
  return team;
}

// ─── normalizeRole ─────────────────────────────────

describe("Team.normalizeRole", () => {
  const team = createMockTeam();

  it("1차: 정확한 ID 매칭", () => {
    assert.equal(team.normalizeRole("backend_dev"), "backend_dev");
    assert.equal(team.normalizeRole("tech_lead"), "tech_lead");
  });

  it("2차: id(role) 형식에서 ID 추출", () => {
    assert.equal(team.normalizeRole("backend_dev(Backend Developer)"), "backend_dev");
    assert.equal(team.normalizeRole("tech_lead(Tech Lead)"), "tech_lead");
  });

  it("3차: role 이름으로 역방향 매칭", () => {
    assert.equal(team.normalizeRole("Backend Developer"), "backend_dev");
    assert.equal(team.normalizeRole("QA Engineer"), "qa");
    assert.equal(team.normalizeRole("Tech Lead (팀장)"), "tech_lead");
  });

  it("4차: 부분 문자열 매칭 (3자 이상)", () => {
    assert.equal(team.normalizeRole("backend"), "backend_dev");
    assert.equal(team.normalizeRole("frontend"), "frontend_dev");
  });

  it("2자 이하 입력은 4차 매칭 건너뜀", () => {
    // "qa"는 2자이므로 4차 진입 안 됨. 하지만 1차에서 정확히 매칭됨
    assert.equal(team.normalizeRole("qa"), "qa");
    // "de"는 2자이므로 4차 건너뜀 → 원본 반환
    assert.equal(team.normalizeRole("de"), "de");
  });

  it("매칭 실패 시 원본 반환", () => {
    assert.equal(team.normalizeRole("unknown_role"), "unknown_role");
  });

  it("null/undefined 입력 처리", () => {
    assert.equal(team.normalizeRole(null), null);
    assert.equal(team.normalizeRole(undefined), undefined);
  });

  it("공백 포함 입력 trim 처리", () => {
    assert.equal(team.normalizeRole("  backend_dev  "), "backend_dev");
  });
});
