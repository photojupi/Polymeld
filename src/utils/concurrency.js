// src/utils/concurrency.js
// Promise.allSettled 호환 동시성 제한 유틸리티

/**
 * Promise.allSettled + 동시성 제한
 * @param {Array} items - 처리할 항목 배열
 * @param {Function} fn - (item, index) => Promise
 * @param {number} concurrency - 최대 동시 실행 수
 * @param {number} batchDelayMs - 배치 간 쿨다운 (ms). 0이면 worker pool 방식, >0이면 명시적 배치+딜레이
 * @returns {Promise<PromiseSettledResult[]>}
 */
export async function pMapSettled(items, fn, concurrency = 3, batchDelayMs = 0) {
  if (items.length === 0) return [];
  const safeConc = Math.max(1, Math.floor(concurrency));
  const results = new Array(items.length);

  if (batchDelayMs > 0) {
    // 명시적 배치 + 쿨다운 (rate limit 방지)
    for (let start = 0; start < items.length; start += safeConc) {
      if (start > 0) await new Promise(r => setTimeout(r, batchDelayMs));
      const end = Math.min(start + safeConc, items.length);
      const batch = await Promise.allSettled(
        items.slice(start, end).map((item, j) => fn(item, start + j))
      );
      for (let j = 0; j < batch.length; j++) results[start + j] = batch[j];
    }
  } else {
    // worker pool 방식 (최대 처리량)
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < items.length) {
        const i = nextIndex++;
        try {
          results[i] = { status: "fulfilled", value: await fn(items[i], i) };
        } catch (reason) {
          results[i] = { status: "rejected", reason };
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(safeConc, items.length) }, () => worker())
    );
  }

  return results;
}
