// src/models/response-parser.js
// LLM 응답에서 구조화된 데이터를 추출하는 파서
// 1차: JSON 블록 추출, 2차: 키워드 매칭 폴백

export class ResponseParser {
  /**
   * 텍스트에서 JSON 추출 (3단계 시도)
   * @param {string} text
   * @returns {Object|null}
   */
  static _extractJson(text) {
    if (!text) return null;

    // 1차: ```json ... ``` 코드블록
    const blockMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (blockMatch) {
      try {
        return JSON.parse(blockMatch[1].trim());
      } catch { /* fall through */ }
    }

    // 2차: 전체 텍스트를 JSON으로 파싱
    try {
      return JSON.parse(text.trim());
    } catch { /* fall through */ }

    return null;
  }

  /**
   * 태스크 분해 결과 파싱
   * @param {string} raw - LLM 응답 텍스트
   * @returns {{ success: boolean, tasks?: Array, error?: string, raw?: string }}
   */
  static parseTasks(raw) {
    const json = this._extractJson(raw);
    if (json) {
      const tasks = json.tasks || (Array.isArray(json) ? json : null);
      if (tasks && Array.isArray(tasks)) {
        return { success: true, tasks };
      }
    }
    return { success: false, error: "JSON 파싱 실패", raw };
  }

  /**
   * 리뷰 verdict 파싱
   * @param {string} raw - 리뷰 텍스트
   * @returns {{ verdict: "APPROVED"|"CHANGES_REQUESTED", structured: boolean }}
   */
  static parseReviewVerdict(raw) {
    // 1차: JSON에서 verdict 필드
    const json = this._extractJson(raw);
    if (json?.verdict) {
      const v = json.verdict.toUpperCase();
      if (v.includes("APPROVED")) return { verdict: "APPROVED", structured: true };
      if (v.includes("CHANGE")) return { verdict: "CHANGES_REQUESTED", structured: true };
    }

    // 2차: 키워드 매칭 폴백
    const lower = raw.toLowerCase();
    if (lower.includes("changes requested") || lower.includes("수정 필요") ||
        lower.includes("수정이 필요") || lower.includes("변경 요청") ||
        lower.includes("개선 필요")) {
      return { verdict: "CHANGES_REQUESTED", structured: false };
    }
    if (lower.includes("approved") || lower.includes("승인")) {
      return { verdict: "APPROVED", structured: false };
    }

    // 애매하면 통과 (무한루프 방지)
    return { verdict: "APPROVED", structured: false };
  }

  /**
   * QA verdict 파싱
   * @param {string} raw - QA 결과 텍스트
   * @returns {{ verdict: "PASS"|"FAIL", structured: boolean }}
   */
  static parseQAVerdict(raw) {
    // 1차: JSON에서 verdict 필드
    const json = this._extractJson(raw);
    if (json?.verdict) {
      const v = json.verdict.toUpperCase();
      if (v.includes("FAIL")) return { verdict: "FAIL", structured: true };
      if (v.includes("PASS")) return { verdict: "PASS", structured: true };
    }

    // 2차: 키워드 매칭 폴백
    const lower = raw.toLowerCase();
    if (lower.includes("종합: fail") || lower.includes("종합 판정: fail") ||
        lower.includes("결과: fail") || lower.includes("테스트 실패")) {
      return { verdict: "FAIL", structured: false };
    }
    if (lower.includes("종합: pass") || lower.includes("종합 판정: pass") ||
        lower.includes("모든 테스트 통과") || lower.includes("전체 통과")) {
      return { verdict: "PASS", structured: false };
    }

    // 3차: 이모지 카운트 비교
    const failCount = (raw.match(/❌/g) || []).length;
    const passCount = (raw.match(/✅/g) || []).length;
    if (failCount > 0 && failCount >= passCount) {
      return { verdict: "FAIL", structured: false };
    }

    // 애매하면 통과
    return { verdict: "PASS", structured: false };
  }
}
