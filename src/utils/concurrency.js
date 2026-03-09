// src/utils/concurrency.js
// Promise.allSettled 호환 동시성 제한 유틸리티

/**
 * Promise.allSettled + 동시성 제한
 * @param {Array} items - 처리할 항목 배열
 * @param {Function} fn - (item, index) => Promise
 * @param {number} concurrency - 최대 동시 실행 수
 * @returns {Promise<PromiseSettledResult[]>}
 */
export async function pMapSettled(items, fn, concurrency = 3) {
  if (items.length === 0) return [];
  const safeConc = Math.max(1, Math.floor(concurrency));
  const results = new Array(items.length);
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
  return results;
}
