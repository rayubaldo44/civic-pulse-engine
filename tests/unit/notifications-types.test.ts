import { describe, it, expect, vi } from 'vitest';
import {
	DEFAULT_NOTIFICATION_PREFS,
	isChannelEnabled,
	isNotificationCategory,
	normalizeNotificationPrefs
} from '../../src/lib/types/notifications';
import {
	getCachedUnreadCount,
	invalidateNotifications,
	setCachedUnreadCount
} from '../../src/lib/server/notifications-cache';
import { formatRelative } from '../../src/lib/utils/format';

describe('isNotificationCategory', () => {
	it('accepts a known category', () => {
		expect(isNotificationCategory('trend_alert')).toBe(true);
		expect(isNotificationCategory('issue_peer_review')).toBe(true);
	});

	it('rejects unknown and non-string values', () => {
		expect(isNotificationCategory('flagged_claim')).toBe(false);
		expect(isNotificationCategory(42)).toBe(false);
		expect(isNotificationCategory(null)).toBe(false);
	});
});

describe('normalizeNotificationPrefs', () => {
	it('returns the defaults for null', () => {
		expect(normalizeNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
	});

	it('returns the defaults for a non-object', () => {
		expect(normalizeNotificationPrefs('nope')).toEqual(DEFAULT_NOTIFICATION_PREFS);
	});

	it('keeps valid booleans', () => {
		const result = normalizeNotificationPrefs({ in_app: false, email: false });
		expect(result.in_app).toBe(false);
		expect(result.email).toBe(false);
	});

	it('falls back to defaults for non-boolean channel flags', () => {
		// A crafted "in_app": "false" (string) must not be read as false.
		const result = normalizeNotificationPrefs({ in_app: 'false', email: 0 });
		expect(result.in_app).toBe(true);
		expect(result.email).toBe(true);
	});

	it('fills in a partial category entry', () => {
		const result = normalizeNotificationPrefs({
			categories: { trend_alert: { email: false } }
		});
		expect(result.categories.trend_alert).toEqual({ in_app: true, email: false });
	});

	it('ignores an unknown category key', () => {
		const result = normalizeNotificationPrefs({
			categories: { nonexistent: { in_app: false, email: false } }
		});
		expect(result.categories).not.toHaveProperty('nonexistent');
		expect(result.categories.trend_alert).toEqual({ in_app: true, email: true });
	});

	it('does not mutate the defaults when normalising', () => {
		const result = normalizeNotificationPrefs({ in_app: false });
		result.categories.trend_alert.email = false;

		expect(DEFAULT_NOTIFICATION_PREFS.in_app).toBe(true);
		expect(DEFAULT_NOTIFICATION_PREFS.categories.trend_alert.email).toBe(true);
	});
});

describe('isChannelEnabled', () => {
	it('honours an explicit per-category re-enable inside a live channel', () => {
		const prefs = normalizeNotificationPrefs({
			email: true,
			categories: { trend_alert: { email: true } }
		});
		expect(isChannelEnabled(prefs, 'trend_alert', 'email')).toBe(true);
	});

	it('lets the master switch mute a whole channel', () => {
		const prefs = normalizeNotificationPrefs({ email: false });
		expect(isChannelEnabled(prefs, 'trend_alert', 'email')).toBe(false);
	});

	it('mutes a channel even when a category opts back in', () => {
		// AND semantics: the master switch wins, so a global mute cannot be
		// accidentally undone by a stale per-category flag.
		const prefs = normalizeNotificationPrefs({
			email: false,
			categories: { trend_alert: { email: true } }
		});
		expect(isChannelEnabled(prefs, 'trend_alert', 'email')).toBe(false);
	});

	it('lets a category opt out of a live channel', () => {
		const optedOut = normalizeNotificationPrefs({
			email: true,
			categories: { trend_alert: { email: false } }
		});
		expect(isChannelEnabled(optedOut, 'trend_alert', 'email')).toBe(false);
		expect(isChannelEnabled(optedOut, 'trend_alert', 'in_app')).toBe(true);
	});

	it('returns false for every category when the master switch is off', () => {
		const prefs = normalizeNotificationPrefs({ in_app: false, email: false });
		expect(isChannelEnabled(prefs, 'trend_alert', 'in_app')).toBe(false);
		expect(isChannelEnabled(prefs, 'trend_alert', 'email')).toBe(false);
	});
});

describe('notifications-cache', () => {
	it('round-trips a count', () => {
		setCachedUnreadCount('user-1', 7);
		expect(getCachedUnreadCount('user-1')).toBe(7);
	});

	it('caches zero without treating it as a miss', () => {
		setCachedUnreadCount('user-zero', 0);
		expect(getCachedUnreadCount('user-zero')).toBe(0);
	});

	it('returns null for an unknown user', () => {
		expect(getCachedUnreadCount('nobody')).toBeNull();
	});

	it('never leaks a count across users', () => {
		setCachedUnreadCount('user-a', 3);
		setCachedUnreadCount('user-b', 9);
		expect(getCachedUnreadCount('user-a')).toBe(3);
		expect(getCachedUnreadCount('user-b')).toBe(9);
	});

	it('clears a single user on invalidate', () => {
		setCachedUnreadCount('user-1', 4);
		invalidateNotifications('user-1');
		expect(getCachedUnreadCount('user-1')).toBeNull();
	});

	it('expires an entry once the TTL elapses', async () => {
		vi.useFakeTimers();
		try {
			setCachedUnreadCount('user-ttl', 5);
			vi.advanceTimersByTime(44_000);
			expect(getCachedUnreadCount('user-ttl')).toBe(5);
			vi.advanceTimersByTime(2_000);
			expect(getCachedUnreadCount('user-ttl')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('formatRelative', () => {
	const now = new Date('2025-06-15T12:00:00Z');

	it('renders very recent timestamps as "just now"', () => {
		expect(formatRelative('2025-06-15T11:59:40Z', now)).toBe('just now');
	});

	it('renders minutes, hours, and days', () => {
		expect(formatRelative('2025-06-15T11:45:00Z', now)).toContain('15');
		expect(formatRelative('2025-06-15T09:00:00Z', now)).toContain('3');
		expect(formatRelative('2025-06-12T12:00:00Z', now)).toContain('3');
	});

	it('falls back to an absolute date beyond a week', () => {
		// A bare "60 days ago" is harder to act on than a date.
		const result = formatRelative('2025-04-01T12:00:00Z', now);
		expect(result).toMatch(/Apr/);
	});

	it('returns an empty string for an unparseable timestamp', () => {
		expect(formatRelative('not-a-date', now)).toBe('');
	});

	it('does not render a negative age for clock skew', () => {
		expect(formatRelative('2025-06-15T12:05:00Z', now)).toBe('just now');
	});
});
