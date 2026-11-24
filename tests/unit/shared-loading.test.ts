import { beforeEach, describe, expect, it, vi } from 'vitest';
const { service, audit, prefs } = vi.hoisted(() => ({
	service: vi.fn(),
	audit: vi.fn(),
	prefs: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase: service }));
vi.mock('$lib/server/audit', () => ({ logAudit: audit, buildDetails: JSON.stringify }));
vi.mock('$lib/server/notifications', () => ({ getPrefs: prefs, savePrefs: vi.fn() }));
import { load as layout } from '../../src/routes/Authenticated/+layout.server';
import { load as settings } from '../../src/routes/Authenticated/settings/+page.server';
import { actions as login } from '../../src/routes/login/+page.server';
import { invalidateBadges } from '$lib/server/badges-cache';
import { invalidateNotifications } from '$lib/server/notifications-cache';
import { expectRedirect } from './helpers/api';
const user = {
	id: 'parallel-user',
	email: 'staff@example.test',
	app_metadata: { role: 'analyst' }
};
beforeEach(() => {
	vi.clearAllMocks();
	invalidateBadges(user.id);
	invalidateNotifications(user.id);
});

describe('independent shared reads', () => {
	it('starts unread counts while the badge RPC is pending', async () => {
		let release!: (v: unknown) => void;
		let unreadStarted = false;
		const db = {
			rpc: () => ({
				maybeSingle: () =>
					new Promise((r) => {
						release = r;
					})
			}),
			from: () => ({
				select: () => ({
					eq: () => ({
						is: () => {
							unreadStarted = true;
							return Promise.resolve({ count: 3, error: null });
						}
					})
				})
			})
		};
		service.mockReturnValue(db);
		const pending = layout({
			locals: { safeGetSession: async () => ({ user }) },
			url: new URL('https://example.test/Authenticated/dashboard'),
			untrack: (fn: () => unknown) => fn()
		} as never);
		await vi.waitFor(() => expect(release).toBeTypeOf('function'));
		expect(unreadStarted).toBe(true);
		release({ data: { pending: 4, my_tasks: 2 }, error: null });
		expect(await pending).toMatchObject({
			pendingCount: 4,
			myTaskCount: 2,
			unreadCount: 3,
			badgesFetchedAt: expect.any(Number)
		});
	});
	it('starts settings preferences while the profile read is pending', async () => {
		let release!: (v: unknown) => void;
		prefs.mockResolvedValue({ in_app: true });
		const supabase = {
			from: () => ({
				select: () => ({
					eq: () => ({
						single: () =>
							new Promise((r) => {
								release = r;
							})
					})
				})
			})
		};
		const pending = settings({
			locals: { safeGetSession: async () => ({ user }), supabase }
		} as never);
		await vi.waitFor(() => expect(release).toBeTypeOf('function'));
		expect(prefs).toHaveBeenCalledWith(user.id);
		release({ data: { full_name: 'Staff' }, error: null });
		expect(await pending).toMatchObject({ fullName: 'Staff', notificationPrefs: { in_app: true } });
	});
	it('looks up legacy roles while awaiting the audit and still waits before redirecting', async () => {
		let release!: () => void;
		let roleRead = false;
		audit.mockImplementation(
			() =>
				new Promise<void>((r) => {
					release = r;
				})
		);
		const supabase = {
			auth: {
				signInWithPassword: async () => ({
					data: { user: { ...user, app_metadata: {} } },
					error: null
				})
			},
			from: () => ({
				select: () => ({
					eq: () => ({
						single: () => {
							roleRead = true;
							return Promise.resolve({ data: { role: 'admin' }, error: null });
						}
					})
				})
			})
		};
		const pending = login.default({
			request: new Request('https://example.test/login', {
				method: 'POST',
				body: new URLSearchParams({ email: user.email, password: 'test' })
			}),
			locals: { supabase },
			cookies: { set: vi.fn() },
			getClientAddress: () => '127.0.0.1'
		} as never);
		await vi.waitFor(() => expect(release).toBeTypeOf('function'));
		expect(roleRead).toBe(true);
		release();
		await expectRedirect(pending, { location: '/Authenticated/admin' });
	});
});
