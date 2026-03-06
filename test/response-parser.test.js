import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ResponseParser } from "../src/models/response-parser.js";

// ─── parseTasks ───────────────────────────────────────

describe("ResponseParser.parseTasks", () => {
  it("JSON 코드블록에서 tasks 배열 추출", () => {
    const raw = `다음은 태스크입니다:
\`\`\`json
{
  "tasks": [
    { "title": "API 설계", "suitable_role": "backend_dev" },
    { "title": "UI 구현", "suitable_role": "frontend_dev" }
  ]
}
\`\`\``;
    const result = ResponseParser.parseTasks(raw);
    assert.equal(result.success, true);
    assert.equal(result.tasks.length, 2);
    assert.equal(result.tasks[0].title, "API 설계");
  });

  it("배열 형태 JSON 직접 전달", () => {
    const raw = JSON.stringify([
      { title: "태스크1" },
      { title: "태스크2" },
    ]);
    const result = ResponseParser.parseTasks(raw);
    assert.equal(result.success, true);
    assert.equal(result.tasks.length, 2);
  });

  it("파싱 실패 시 success: false 반환", () => {
    const result = ResponseParser.parseTasks("이건 JSON이 아닙니다");
    assert.equal(result.success, false);
    assert.equal(result.error, "JSON 파싱 실패");
  });

  it("빈 입력 처리", () => {
    assert.equal(ResponseParser.parseTasks("").success, false);
    assert.equal(ResponseParser.parseTasks(null).success, false);
  });
});

// ─── parseReviewVerdict ───────────────────────────────

describe("ResponseParser.parseReviewVerdict", () => {
  it("JSON verdict APPROVED", () => {
    const raw = '리뷰 내용...\n```json\n{ "verdict": "APPROVED" }\n```';
    const result = ResponseParser.parseReviewVerdict(raw);
    assert.equal(result.verdict, "APPROVED");
    assert.equal(result.structured, true);
  });

  it("JSON verdict CHANGES_REQUESTED", () => {
    const raw = '```json\n{ "verdict": "CHANGES_REQUESTED" }\n```';
    const result = ResponseParser.parseReviewVerdict(raw);
    assert.equal(result.verdict, "CHANGES_REQUESTED");
    assert.equal(result.structured, true);
  });

  it("키워드 '수정 필요' → CHANGES_REQUESTED", () => {
    const result = ResponseParser.parseReviewVerdict("이 부분은 수정 필요합니다.");
    assert.equal(result.verdict, "CHANGES_REQUESTED");
    assert.equal(result.structured, false);
  });

  it("키워드 '승인' → APPROVED", () => {
    const result = ResponseParser.parseReviewVerdict("코드를 승인합니다.");
    assert.equal(result.verdict, "APPROVED");
    assert.equal(result.structured, false);
  });

  it("애매한 경우 기본 APPROVED (무한루프 방지)", () => {
    const result = ResponseParser.parseReviewVerdict("코드가 괜찮아 보입니다.");
    assert.equal(result.verdict, "APPROVED");
  });
});

// ─── parseQAVerdict ───────────────────────────────────

describe("ResponseParser.parseQAVerdict", () => {
  it("JSON verdict FAIL", () => {
    const raw = '```json\n{ "verdict": "FAIL", "summary": "테스트 실패" }\n```';
    const result = ResponseParser.parseQAVerdict(raw);
    assert.equal(result.verdict, "FAIL");
    assert.equal(result.structured, true);
  });

  it("JSON verdict PASS", () => {
    const raw = '```json\n{ "verdict": "PASS" }\n```';
    const result = ResponseParser.parseQAVerdict(raw);
    assert.equal(result.verdict, "PASS");
    assert.equal(result.structured, true);
  });

  it("키워드 '종합: FAIL'", () => {
    const result = ResponseParser.parseQAVerdict("종합: FAIL - 여러 이슈 발견");
    assert.equal(result.verdict, "FAIL");
  });

  it("키워드 '모든 테스트 통과'", () => {
    const result = ResponseParser.parseQAVerdict("모든 테스트 통과했습니다.");
    assert.equal(result.verdict, "PASS");
  });

  it("이모지 카운트: ❌ >= ✅ → FAIL", () => {
    const result = ResponseParser.parseQAVerdict("결과:\n✅ 항목1\n❌ 항목2\n❌ 항목3");
    assert.equal(result.verdict, "FAIL");
  });

  it("이모지 카운트: ✅만 있으면 PASS", () => {
    const result = ResponseParser.parseQAVerdict("결과:\n✅ 항목1\n✅ 항목2");
    assert.equal(result.verdict, "PASS");
  });

  it("애매한 경우 기본 PASS", () => {
    const result = ResponseParser.parseQAVerdict("코드 품질이 양호합니다.");
    assert.equal(result.verdict, "PASS");
  });
});
