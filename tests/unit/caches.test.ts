import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCachedBadges, setCachedBadges, invalidateBadges } from '$lib/server/badges-cache';
import { cachedDashboardQuery } from '$lib/server/dashboard-cache';

describe('badges-cache', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns a stored value before the TTL elapses', () => {
		setCachedBadges('user-1', { pending: 2, myTasks: 4 });
		expect(getCachedBadges('user-1')).toEqual({ pending: 2, myTasks: 4 });
	});

	it('expires entries after the 45s TTL', () => {
		setCachedBadges('user-1', { pending: 2, myTasks: 4 });
		vi.advanceTimersByTime(44_999);
		expect(getCachedBadges('user-1')).not.toBeNull();
		vi.advanceTimersByTime(2);
		expect(getCachedBadges('user-1')).toBeNull();
	});

	it('keys by user so counts never leak across accounts', () => {
		setCachedBadges('user-1', { pending: 2, myTasks: 4 });
		expect(getCachedBadges('user-2')).toBeNull();
	});

	it('invalidateBadges clears only the targeted user', () => {
		setCachedBadges('user-1', { pending: 1, myTasks: 1 });
		setCachedBadges('user-2', { pending: 9, myTasks: 9 });
		invalidateBadges('user-1');
		expect(getCachedBadges('user-1')).toBeNull();
		expect(getCachedBadges('user-2')).toEqual({ pending: 9, myTasks: 9 });
	});

	it('returns null for a never-cached user', () => {
		expect(getCachedBadges('ghost')).toBeNull();
	});
});

describe('dashboard-cache', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('serves the cached result within the TTL without re-running the query', async () => {
		const run = vi.fn(async () => ({ data: [{ n: 1 }], error: null }));

		const first = await cachedDashboardQuery<Array<{ n: number }>>('get_sentiment_counts', run);
		const second = await cachedDashboardQuery('get_sentiment_counts', run);

		expect(first).toEqual({ data: [{ n: 1 }], error: null });
		expect(second).toEqual(first);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('expires and re-runs after the TTL', async () => {
		const run = vi.fn(async () => ({ data: [1], error: null }));

		await cachedDashboardQuery('key-ttl', run);
		expect(run).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(45_001);
		await cachedDashboardQuery('key-ttl', run);

		expect(run).toHaveBeenCalledTimes(2);
	});

	it('never caches an errored result', async () => {
		const run = vi.fn(async () => ({ data: null, error: { message: 'rpc exploded' } }));

		const once = await cachedDashboardQuery('errored-key', run);
		const twice = await cachedDashboardQuery('errored-key', run);

		expect(once).toEqual({ data: null, error: { message: 'rpc exploded' } });
		expect(twice).toEqual(once);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('keys independently by rpc name', async () => {
		const runA = vi.fn(async () => ({ data: 'a', error: null }));
		const runB = vi.fn(async () => ({ data: 'b', error: null }));

		await cachedDashboardQuery('rpc-a', runA);
		await cachedDashboardQuery('rpc-b', runB);

		expect(runA).toHaveBeenCalledTimes(1);
		expect(runB).toHaveBeenCalledTimes(1);
	});
});
