// src/lib/server/badges-cache.ts
//
// Short-TTL in-process cache for the sidebar badge counts (pending flagged
// claims + my open tasks). The /Authenticated layout load used to fire two
// COUNT(*) queries on EVERY page visit and every client-side navigation.
//
// Design constraints:
//   - TTL only (45s) — never leaves a stale entry outside the window.
//   - Keyed by user id, so "my tasks" never leaks across accounts by accident.
//   - Per-instance memory on serverless (Vercel). Counts may lag up to TTL
//     across lambdas; mutation endpoints call invalidateBadges() to clear the
//     local copy immediately. Slight staleness is acceptable for a badge.
//
// Server-only (lives under $lib/server/) so Vite blocks any client import.

const TTL_MS = 45_000;

export interface BadgeCounts {
	pending: number;
	myTasks: number;
}

interface CacheEntry {
	value: BadgeCounts;
	expiresAt: number;
	fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedBadges(userId: string): BadgeCounts | null {
	const entry = cache.get(userId);
	if (!entry) return null;
	if (entry.expiresAt <= Date.now()) {
		cache.delete(userId);
		return null;
	}
	return entry.value;
}

export function getBadgesFetchedAt(userId: string): number | null {
	return getCachedBadges(userId) ? cache.get(userId)!.fetchedAt : null;
}

export function setCachedBadges(userId: string, value: BadgeCounts, fetchedAt = Date.now()): void {
	cache.set(userId, { value, fetchedAt, expiresAt: fetchedAt + TTL_MS });
}

export function invalidateBadges(userId: string): void {
	cache.delete(userId);
}
