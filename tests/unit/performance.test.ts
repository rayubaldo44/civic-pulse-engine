import { describe, expect, it, vi, afterEach } from 'vitest';
import { createRequestTimings } from '$lib/server/timing';
import { cachedDashboardQuery } from '$lib/server/dashboard-cache';
import { getBadgesFetchedAt, setCachedBadges, invalidateBadges } from '$lib/server/badges-cache';
import {
	getUnreadFetchedAt,
	setCachedUnreadCount,
	invalidateNotifications
} from '$lib/server/notifications-cache';
import { summaryDelay } from '$lib/utils/summary-freshness';

afterEach(() => vi.useRealTimers());

describe('performance measurement', () => {
	it('measures completed operations without serializing independent work', async () => {
		let clock = 0;
		const timings = createRequestTimings(() => clock);
		let release!: (n: number) => void;
		const first = timings.measure(
			'db',
			() =>
				new Promise<number>((r) => {
					release = r;
				})
		);
		const second = timings.measure('auth', async () => {
			clock = 5;
			return 'verified';
		});
		expect(await second).toBe('verified');
		release(12);
		expect(await first).toBe(12);
		expect(timings.header()).toBe('auth;dur=5.0, db;dur=5.0');
	});
	it('records failures and propagates them', async () => {
		const t = createRequestTimings();
		await expect(
			t.measure('db', async () => {
				throw new Error('offline');
			})
		).rejects.toThrow('offline');
		expect(t.header()).toMatch(/^db;dur=\d+\.\d$/);
	});
});

describe('concurrent dashboard queries', () => {
	it('shares an in-flight query then reuses the successful result', async () => {
		let release!: (value: { data: number[]; error: null }) => void;
		const run = vi.fn(
			() =>
				new Promise<{ data: number[]; error: null }>((r) => {
					release = r;
				})
		);
		const first = cachedDashboardQuery('in-flight-success', run);
		const second = cachedDashboardQuery('in-flight-success', run);
		expect(run).toHaveBeenCalledTimes(1);
		release({ data: [4], error: null });
		expect(await first).toEqual(await second);
		expect(await cachedDashboardQuery('in-flight-success', run)).toEqual({
			data: [4],
			error: null
		});
		expect(run).toHaveBeenCalledTimes(1);
	});
	it('retries a rejected query instead of retaining a rejected in-flight promise', async () => {
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValue({ data: [5], error: null });
		await expect(cachedDashboardQuery('in-flight-retry', run)).rejects.toThrow('offline');
		expect(await cachedDashboardQuery('in-flight-retry', run)).toEqual({ data: [5], error: null });
	});
});

describe('summary freshness', () => {
	it('retains the original fetch time instead of resetting cache age on reads', () => {
		vi.useFakeTimers();
		vi.setSystemTime(100_000);
		setCachedBadges('timed-user', { pending: 1, myTasks: 2 }, 90_000);
		setCachedUnreadCount('timed-user', 3, 90_000);
		expect(getBadgesFetchedAt('timed-user')).toBe(90_000);
		expect(getUnreadFetchedAt('timed-user')).toBe(90_000);
		vi.advanceTimersByTime(35_000);
		expect(getBadgesFetchedAt('timed-user')).toBeNull();
		expect(getUnreadFetchedAt('timed-user')).toBeNull();
	});
	it('invalidates timestamps with user-scoped values', () => {
		setCachedBadges('invalidated-user', { pending: 1, myTasks: 1 });
		setCachedUnreadCount('invalidated-user', 1);
		invalidateBadges('invalidated-user');
		invalidateNotifications('invalidated-user');
		expect(getBadgesFetchedAt('invalidated-user')).toBeNull();
		expect(getUnreadFetchedAt('invalidated-user')).toBeNull();
	});
	it('refreshes according to data age rather than adding polling and server cache delays', () => {
		expect(summaryDelay(100_000, 100_000)).toBe(45_000);
		expect(summaryDelay(60_000, 100_000)).toBe(5_000);
		expect(summaryDelay(10_000, 100_000)).toBe(0);
		expect(summaryDelay(0, 100_000)).toBe(0);
	});
});
