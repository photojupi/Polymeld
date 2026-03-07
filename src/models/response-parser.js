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

    // 1차: ```json ... ``` 코드블록 (대소문자 무시)
    const blockMatch = text.match(/```json\s*([\s\S]*?)```/i);
    if (blockMatch) {
      try {
        return JSON.parse(blockMatch[1].trim());
      } catch { /* fall through */ }
    }

    // 2차: ``` ... ``` 언어 태그 없는 코드블록
    const plainBlock = text.match(/```\s*\n([\s\S]*?)```/);
    if (plainBlock) {
      try {
        return JSON.parse(plainBlock[1].trim());
      } catch { /* fall through */ }
    }

    // 3차: 전체 텍스트를 JSON으로 파싱
    try {
      return JSON.parse(text.trim());
    } catch { /* fall through */ }

    // 4차: 텍스트에서 { 또는 [ 시작 위치를 찾아 뒤에서부터 파싱 시도
    for (const [open, close] of [['{', '}'], ['[', ']']]) {
      const start = text.indexOf(open);
      if (start === -1) continue;
      for (let end = text.lastIndexOf(close); end > start; end = text.lastIndexOf(close, end - 1)) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch { /* continue shrinking */ }
      }
    }

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
      const arr = json.tasks || (Array.isArray(json) ? json : null);
      if (arr && Array.isArray(arr)) {
        const tasks = arr.filter(t => t && typeof t === 'object' && !Array.isArray(t));
        if (tasks.length > 0) {
          return { success: true, tasks };
        }
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

    // 2차: 키워드 매칭 폴백 (AI가 어떤 언어로 응답하든 매칭하기 위해 모든 언어 키워드 포함)
    // "개선 필요" / "改善必要" / "需要改进" 제거: 리뷰 형식 헤더와 충돌 가능
    const lower = raw.toLowerCase();
    if (lower.includes("changes requested") || lower.includes("changes_requested") ||
        lower.includes("수정 필요") || lower.includes("수정이 필요") ||
        lower.includes("변경 요청") ||
        lower.includes("修正必要") || lower.includes("変更要求") ||
        lower.includes("需要修改") || lower.includes("修改请求")) {
      return { verdict: "CHANGES_REQUESTED", structured: false };
    }
    if (lower.includes("approved") ||
        lower.includes("승인") ||
        lower.includes("承認") ||
        lower.includes("批准") || lower.includes("已批准")) {
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

    // 2차: 키워드 매칭 폴백 (AI가 어떤 언어로 응답하든 매칭하기 위해 모든 언어 키워드 포함)
    const lower = raw.toLowerCase();
    if (lower.includes("종합: fail") || lower.includes("종합 판정: fail") ||
        lower.includes("결과: fail") || lower.includes("테스트 실패") ||
        lower.includes("overall: fail") || lower.includes("verdict: fail") || lower.includes("test failed") ||
        lower.includes("総合: fail") || lower.includes("総合判定: fail") || lower.includes("テスト失敗") ||
        lower.includes("综合: fail") || lower.includes("综合判定: fail") || lower.includes("测试失败")) {
      return { verdict: "FAIL", structured: false };
    }
    if (lower.includes("종합: pass") || lower.includes("종합 판정: pass") ||
        lower.includes("모든 테스트 통과") || lower.includes("전체 통과") ||
        lower.includes("overall: pass") || lower.includes("verdict: pass") || lower.includes("all tests passed") ||
        lower.includes("総合: pass") || lower.includes("全テスト合格") || lower.includes("全て通過") ||
        lower.includes("综合: pass") || lower.includes("所有测试通过") || lower.includes("全部通过")) {
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
