import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

const { evaluateTrendsWithSweep } = vi.hoisted(() => ({
	evaluateTrendsWithSweep: vi.fn()
}));
vi.mock('$lib/server/trend-evaluator', () => ({ evaluateTrendsWithSweep }));

const { getCachedUnreadCount, setCachedUnreadCount } = vi.hoisted(() => ({
	getCachedUnreadCount: vi.fn(),
	setCachedUnreadCount: vi.fn()
}));
vi.mock('$lib/server/notifications-cache', () => ({
	getCachedUnreadCount,
	getUnreadFetchedAt: () => Date.now(),
	setCachedUnreadCount,
	invalidateNotifications: vi.fn()
}));

const { listNotifications, countUnread, markRead, markAllRead, getPrefs, savePrefs } = vi.hoisted(
	() => ({
		listNotifications: vi.fn(),
		countUnread: vi.fn(),
		markRead: vi.fn(),
		markAllRead: vi.fn(),
		getPrefs: vi.fn(),
		savePrefs: vi.fn()
	})
);
vi.mock('$lib/server/notifications', () => ({
	listNotifications,
	countUnread,
	markRead,
	markAllRead,
	getPrefs,
	savePrefs,
	pruneReadNotifications: vi.fn()
}));

const { logAudit } = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('$lib/server/audit', () => ({ logAudit, buildDetails: (p: unknown) => JSON.stringify(p) }));

import { GET } from '../../src/routes/api/notifications/+server';
import { PATCH as markReadHandler } from '../../src/routes/api/notifications/read/+server';
import {
	GET as getPrefsHandler,
	PATCH as patchPrefsHandler
} from '../../src/routes/api/notification-prefs/+server';
import { createFakeSupabase } from './helpers/fake-supabase';
import { makeGetEvent, makeJsonEvent, expectRedirect, type RouteHandler } from './helpers/api';

const getNotifications = GET as unknown as RouteHandler;
const patchRead = markReadHandler as unknown as RouteHandler;
const getPrefsRoute = getPrefsHandler as unknown as RouteHandler;
const patchPrefs = patchPrefsHandler as unknown as RouteHandler;

describe('GET /api/notifications', () => {
	beforeEach(() => vi.clearAllMocks());

	it('redirects to /login when unauthenticated', async () => {
		await expectRedirect(
			getNotifications(makeGetEvent('/api/notifications', { authenticated: false })),
			{
				status: 303,
				location: '/login'
			}
		);
	});

	it('returns notifications and unread count', async () => {
		evaluateTrendsWithSweep.mockResolvedValue({ alertsCreated: 0 });
		listNotifications.mockResolvedValue({
			notifications: [
				{
					id: 'n1',
					title: 'Test',
					severity: 'info',
					category: 'trend_alert',
					body: '',
					href: null,
					entity_type: null,
					entity_id: null,
					read_at: null,
					created_at: '2025-01-01T00:00:00Z'
				}
			],
			unread: 1
		});
		getCachedUnreadCount.mockReturnValue(5);

		const res = await getNotifications(makeGetEvent('/api/notifications'));
		const body = (await res.json()) as Record<string, unknown>;

		expect(res.status).toBe(200);
		expect(body.unread).toBe(5); // from cache, not countUnread
		expect(body.notifications).toHaveLength(1);
		expect(evaluateTrendsWithSweep).toHaveBeenCalledWith('actor-1');
	});

	it('falls back to countUnread when cache misses', async () => {
		evaluateTrendsWithSweep.mockResolvedValue({ alertsCreated: 0 });
		listNotifications.mockResolvedValue({ notifications: [], unread: 0 });
		getCachedUnreadCount.mockReturnValue(null);
		countUnread.mockResolvedValue(3);

		const res = await getNotifications(makeGetEvent('/api/notifications?limit=50'));
		const body = (await res.json()) as Record<string, unknown>;

		expect(res.status).toBe(200);
		expect(body.unread).toBe(3);
		expect(countUnread).toHaveBeenCalledWith('actor-1');
	});

	it('ignores an invalid limit param (falls back to 20)', async () => {
		evaluateTrendsWithSweep.mockResolvedValue({ alertsCreated: 0 });
		listNotifications.mockResolvedValue({ notifications: [], unread: 0 });
		getCachedUnreadCount.mockReturnValue(0);

		await getNotifications(makeGetEvent('/api/notifications?limit=999'));

		expect(listNotifications).toHaveBeenCalledWith('actor-1', 20, false);
	});
});

describe('PATCH /api/notifications/read', () => {
	beforeEach(() => vi.clearAllMocks());

	it('redirects to /login when unauthenticated', async () => {
		await expectRedirect(
			patchRead(
				makeJsonEvent('PATCH', '/api/notifications/read', { all: true }, { authenticated: false })
			),
			{ status: 303, location: '/login' }
		);
	});

	it('marks all read', async () => {
		markAllRead.mockResolvedValue(5);
		countUnread.mockResolvedValue(0);

		const res = await patchRead(makeJsonEvent('PATCH', '/api/notifications/read', { all: true }));
		const body = (await res.json()) as Record<string, unknown>;

		expect(res.status).toBe(200);
		expect(markAllRead).toHaveBeenCalledWith('actor-1');
		expect(body.success).toBe(true);
		expect(body.updated).toBe(5);
	});

	it('marks specific ids read', async () => {
		markRead.mockResolvedValue(2);
		countUnread.mockResolvedValue(1);

		const res = await patchRead(
			makeJsonEvent('PATCH', '/api/notifications/read', {
				ids: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002']
			})
		);
		const body = (await res.json()) as Record<string, unknown>;

		expect(res.status).toBe(200);
		expect(markRead).toHaveBeenCalledWith('actor-1', [
			'00000000-0000-0000-0000-000000000001',
			'00000000-0000-0000-0000-000000000002'
		]);
		expect(body.updated).toBe(2);
	});

	it('rejects invalid uuid ids', async () => {
		const res = await patchRead(
			makeJsonEvent('PATCH', '/api/notifications/read', {
				ids: ['not-a-uuid']
			})
		);
		const body = (await res.json()) as Record<string, unknown>;
		expect(res.status).toBe(400);
		expect(body.error).toContain('UUID');
	});

	it('rejects empty body', async () => {
		const res = await patchRead(makeJsonEvent('PATCH', '/api/notifications/read', {}));
		const body = (await res.json()) as Record<string, unknown>;
		expect(res.status).toBe(400);
	});
});

describe('GET /api/notification-prefs', () => {
	beforeEach(() => vi.clearAllMocks());

	it('redirects to /login when unauthenticated', async () => {
		await expectRedirect(
			getPrefsRoute(makeGetEvent('/api/notification-prefs', { authenticated: false })),
			{ status: 303, location: '/login' }
		);
	});

	it('returns defaults when no prefs row exists', async () => {
		getPrefs.mockResolvedValue({
			in_app: true,
			email: true,
			categories: { trend_alert: { in_app: true, email: true } }
		});

		const res = await getPrefsRoute(makeGetEvent('/api/notification-prefs'));
		const body = (await res.json()) as Record<string, unknown>;

		expect(res.status).toBe(200);
		expect(body.in_app).toBe(true);
		expect(body.email).toBe(true);
	});
});

describe('PATCH /api/notification-prefs', () => {
	beforeEach(() => vi.clearAllMocks());

	it('redirects to /login when unauthenticated', async () => {
		await expectRedirect(
			patchPrefs(
				makeJsonEvent(
					'PATCH',
					'/api/notification-prefs',
					{ in_app: false },
					{ authenticated: false }
				)
			),
			{ status: 303, location: '/login' }
		);
	});

	it('saves partial prefs update', async () => {
		const currentPrefs = {
			in_app: true,
			email: true,
			categories: { trend_alert: { in_app: true, email: true } }
		};
		getPrefs.mockResolvedValue(currentPrefs);
		savePrefs.mockResolvedValue({
			in_app: false,
			email: true,
			categories: { trend_alert: { in_app: true, email: false } }
		});

		const res = await patchPrefs(
			makeJsonEvent('PATCH', '/api/notification-prefs', {
				in_app: false,
				categories: { trend_alert: { email: false } }
			})
		);
		const body = (await res.json()) as Record<string, unknown>;

		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(savePrefs).toHaveBeenCalledWith(
			'actor-1',
			expect.objectContaining({
				in_app: false,
				categories: expect.objectContaining({
					trend_alert: expect.objectContaining({ email: false, in_app: true })
				})
			})
		);
		expect(logAudit).toHaveBeenCalled();
	});
});
