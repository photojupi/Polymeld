import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Team } from "../src/agents/team.js";

// Team.normalizeRole 테스트를 위한 최소 mock
// Team constructor는 config.personas → Agent 인스턴스를 만드므로,
// normalizeRole에 필요한 this.agents 구조만 직접 구성
function createMockTeam() {
  const team = Object.create(Team.prototype);
  team.agents = {
    tech_lead: { role: "Tech Lead (팀장)" },
    ace_programmer: { role: "Ace Programmer" },
    creative_programmer: { role: "Creative Programmer" },
    qa: { role: "QA Engineer" },
    designer: { role: "UX/Visual Designer" },
    ace_planner: { role: "Ace Planner" },
    security_expert: { role: "Security Expert" },
  };
  return team;
}

// ─── normalizeRole ─────────────────────────────────

describe("Team.normalizeRole", () => {
  const team = createMockTeam();

  it("1차: 정확한 ID 매칭", () => {
    assert.equal(team.normalizeRole("ace_programmer"), "ace_programmer");
    assert.equal(team.normalizeRole("tech_lead"), "tech_lead");
  });

  it("2차: id(role) 형식에서 ID 추출", () => {
    assert.equal(team.normalizeRole("ace_programmer(Ace Programmer)"), "ace_programmer");
    assert.equal(team.normalizeRole("tech_lead(Tech Lead)"), "tech_lead");
  });

  it("3차: role 이름으로 역방향 매칭", () => {
    assert.equal(team.normalizeRole("Ace Programmer"), "ace_programmer");
    assert.equal(team.normalizeRole("QA Engineer"), "qa");
    assert.equal(team.normalizeRole("Tech Lead (팀장)"), "tech_lead");
  });

  it("4차: 부분 문자열 매칭 (3자 이상)", () => {
    assert.equal(team.normalizeRole("designer"), "designer");
    assert.equal(team.normalizeRole("security"), "security_expert");
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
    assert.equal(team.normalizeRole("  ace_programmer  "), "ace_programmer");
  });
});

// ─── [CONCLUDE] 정규식 매칭 ──────────────────────────

describe("[CONCLUDE] 정규식 매칭", () => {
  // _checkMidRoundConclusion에서 사용하는 정규식을 직접 테스트
  const concludeRegex = /^\[CONCLUDE\]\s*([\s\S]*)/mi;

  function parseConclude(content) {
    const match = content.match(concludeRegex);
    if (!match) return null;
    return match[1].trim();
  }

  it("정상: [CONCLUDE]가 첫 줄에 위치", () => {
    const result = parseConclude("[CONCLUDE]\n## 최종 결론\n액션 아이템 정리");
    assert.equal(result, "## 최종 결론\n액션 아이템 정리");
  });

  it("전문 포함: [CONCLUDE]가 중간 줄에 위치", () => {
    const result = parseConclude("논의를 검토했습니다. 결론이 도출됐습니다.\n---\n[CONCLUDE]\n## 최종 결론");
    assert.equal(result, "## 최종 결론");
  });

  it("내용 없음: [CONCLUDE]만 존재", () => {
    const result = parseConclude("[CONCLUDE]");
    assert.equal(result, "");
  });

  it("오탐 방지: 인라인 [CONCLUDE] 언급은 매칭하지 않음", () => {
    const result = parseConclude("아직 [CONCLUDE]를 쓰기엔 이릅니다. 추가 논의가 필요합니다.");
    assert.equal(result, null);
  });

  it("대소문자 무시: [conclude]도 매칭", () => {
    const result = parseConclude("[conclude]\n결론 내용");
    assert.equal(result, "결론 내용");
  });
});
