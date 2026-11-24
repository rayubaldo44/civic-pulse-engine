export const SUMMARY_TTL_MS = 45_000;

/** Schedule from the source read time, not the time a cached response arrived. */
export function summaryDelay(fetchedAt: number, now = Date.now()): number {
	return Math.max(0, Math.min(SUMMARY_TTL_MS, fetchedAt + SUMMARY_TTL_MS - now));
}
