// src/lib/server/notifications-cache.ts
//
// Short-TTL in-process cache for the unread notification count, mirroring
// badges-cache.ts. The bell's badge is read on every 60s poll, so caching it
// keeps the poll to a single indexed COUNT instead of a row fetch per tick.
//
// Same constraints as badges-cache: TTL only, keyed by user id (a count must
// never leak across accounts), per-instance memory on Vercel so counts may lag
// up to the TTL across lambdas. Mutation endpoints call
// invalidateNotifications() to clear the local copy immediately.
//
// Server-only (lives under $lib/server/) so Vite blocks any client import.

const TTL_MS = 45_000;

interface CacheEntry {
	value: number;
	expiresAt: number;
	fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedUnreadCount(userId: string): number | null {
	const entry = cache.get(userId);
	if (!entry) return null;
	if (entry.expiresAt <= Date.now()) {
		cache.delete(userId);
		return null;
	}
	return entry.value;
}

export function getUnreadFetchedAt(userId: string): number | null {
	return getCachedUnreadCount(userId) !== null ? cache.get(userId)!.fetchedAt : null;
}

export function setCachedUnreadCount(userId: string, value: number, fetchedAt = Date.now()): void {
	cache.set(userId, { value, fetchedAt, expiresAt: fetchedAt + TTL_MS });
}

export function invalidateNotifications(userId: string): void {
	cache.delete(userId);
}
