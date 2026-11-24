// src/lib/server/dashboard-cache.ts
//
// Short-TTL in-process cache for the dashboard's expensive all-time aggregate
// RPCs (get_sentiment_counts, get_topic_counts, get_analytics_totals,
// get_barangay_stats, get_review_tally). These re-scan processed_content /
// review_records on every dashboard load and were previously never cached.
//
// Design constraints:
//   - TTL only (45s) — a stale entry never outlives the window.
//   - Keyed by RPC name, NOT user — the aggregates are global, so a single
//     instance's cache serves every account (unlike the user-scoped badges).
//   - Per-instance memory on serverless (Vercel); results may lag up to TTL
//     across lambdas. Slight staleness is acceptable for the analytics shell
//     (matches the badges-cache TTL philosophy).
//   - Only successful reads are stored — errors never poison the cache.
//
// Server-only (lives under $lib/server/) so Vite blocks any client import.

const TTL_MS = 45_000;

interface CacheEntry {
	value: unknown;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<{ data: unknown; error: { message: string } | null }>>();

function getCachedDashboard<T>(key: string): T | null {
	const entry = cache.get(key);
	if (!entry) return null;
	if (entry.expiresAt <= Date.now()) {
		cache.delete(key);
		return null;
	}
	return entry.value as T;
}

function setCachedDashboard<T>(key: string, value: T, fetchedAt: number): void {
	cache.set(key, { value, expiresAt: fetchedAt + TTL_MS });
}

/**
 * Run a dashboard aggregate query, serving a cached copy within the TTL.
 * Returns the same `{ data, error }` shape PostgREST resolves so callers can
 * treat the result identically whether it came from the cache or the network.
 */
export function cachedDashboardQuery<T>(
	key: string,
	run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ data: T | null; error: { message: string } | null }> {
	const cached = getCachedDashboard<{ data: T | null; error: { message: string } | null }>(key);
	if (cached) return Promise.resolve(cached);
	const pending = inFlight.get(key);
	if (pending) return pending as Promise<{ data: T | null; error: { message: string } | null }>;
	const fetchedAt = Date.now();
	const result = Promise.resolve(run())
		.then((result) => {
			if (!result.error) setCachedDashboard(key, result, fetchedAt);
			return result;
		})
		.finally(() => inFlight.delete(key));
	inFlight.set(key, result);
	return result as Promise<{ data: T | null; error: { message: string } | null }>;
}

/** Oldest successful summary read, so polling and server TTL do not compound. */
export function getDashboardFetchedAt(): number {
	const times = [...cache.values()].map((entry) => entry.expiresAt - TTL_MS);
	return times.length ? Math.min(Date.now(), ...times) : Date.now();
}
