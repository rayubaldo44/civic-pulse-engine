import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { load as loginLoad, actions as loginActions } from '../../src/routes/login/+page.server';
import {
	load as setPasswordLoad,
	actions as setPasswordActions
} from '../../src/routes/set-password/+page.server';
import { actions as logoutActions } from '../../src/routes/logout/+page.server';
import { GET as confirmGET } from '../../src/routes/auth/callback/confirm/+server';
import { createFakeSupabase, type FakeResult, type FakeSupabase } from './helpers/fake-supabase';
import {
	ACTOR_ID,
	makeGetEvent,
	expectRedirect,
	makeFormEvent,
	makeAuthSupabase,
	type AuthSupabaseLike
} from './helpers/api';

interface ActionResult {
	status?: number;
	type?: string;
	data?: Record<string, unknown>;
}

function authUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: ACTOR_ID,
		email: 'ana@pulilan.gov.ph',
		app_metadata: { role: 'analyst' },
		user_metadata: { full_name: 'Ana Reyes' },
		...overrides
	};
}

function mockSignIn(
	event: { locals: { supabase?: AuthSupabaseLike } },
	user: Record<string, unknown> | null
) {
	const supabase = event.locals.supabase as AuthSupabaseLike;
	supabase.auth.signInWithPassword.mockResolvedValue({
		data: { user, session: {} },
		error: null
	});
	return supabase;
}

describe('login/+page.server', () => {
	describe('load', () => {
		it('redirects to the dashboard when already signed in', async () => {
			await expectRedirect(loginLoad(makeGetEvent('/login') as never), {
				location: '/Authenticated/dashboard'
			});
		});

		it('surfaces the invalid-invite error flag', async () => {
			const result = (await loginLoad(
				makeGetEvent('/login?error=invalid_invite_link', { authenticated: false }) as never
			)) as unknown as { invalidInviteLink: boolean; passwordSet: boolean };
			expect(result).toEqual({ invalidInviteLink: true, passwordSet: false });
		});

		it('surfaces the password-set flag', async () => {
			const result = (await loginLoad(
				makeGetEvent('/login?password_set=1', { authenticated: false }) as never
			)) as unknown as { invalidInviteLink: boolean; passwordSet: boolean };
			expect(result).toEqual({ invalidInviteLink: false, passwordSet: true });
		});
	});

	describe('actions.default', () => {
		beforeEach(() => vi.clearAllMocks());

		it('rejects missing credentials with 400', async () => {
			const event = makeFormEvent('/login', {});
			const result = (await loginActions.default(event as never)) as unknown as ActionResult;
			expect(result.status).toBe(400);
			expect(result.data).toMatchObject({
				error: 'Enter both your official email and password.',
				email: ''
			});
		});

		it('returns a generic message on auth failure (never leaks the supabase error)', async () => {
			const event = makeFormEvent('/login', { email: 'a@b.c', password: 'wrong' });
			const supabase = mockSignIn(event, null);
			supabase.auth.signInWithPassword.mockResolvedValueOnce({
				data: { user: null, session: null },
				error: { message: 'Invalid login credentials (do not leak this)' }
			});

			const result = (await loginActions.default(event as never)) as unknown as ActionResult;
			expect(result.status).toBe(400);
			expect(result.data).toMatchObject({
				error: "We couldn't sign you in. Check your email and password, then try again.",
				email: 'a@b.c'
			});
		});

		it('routes admins to /Authenticated/admin from app_metadata', async () => {
			const event = makeFormEvent('/login', { email: 'a@b.c', password: 'pw' });
			mockSignIn(event, authUser({ app_metadata: { role: 'admin' } }));
			mockDb({ match: () => ({ data: null, error: null }) });

			await expectRedirect(loginActions.default(event as never), {
				location: '/Authenticated/admin'
			});
		});

		it('routes analysts to the dashboard', async () => {
			const event = makeFormEvent('/login', { email: 'a@b.c', password: 'pw' });
			mockSignIn(event, authUser({ app_metadata: { role: 'analyst' } }));
			mockDb({ match: () => ({ data: null, error: null }) });

			await expectRedirect(loginActions.default(event as never), {
				location: '/Authenticated/dashboard'
			});
		});

		it('falls back to the profiles role for legacy accounts', async () => {
			const event = makeFormEvent('/login', { email: 'a@b.c', password: 'pw' });
			// Legacy accounts have no app_metadata role — the action consults the
			// authenticated client's profiles table (locals.supabase), so that
			// client needs the profile fixture too.
			const supabase = makeAuthSupabase({
				match: (call) =>
					call.table === 'profiles' && call.verb === 'select'
						? { data: { role: 'admin' }, error: null }
						: { data: null, error: null }
			});
			event.locals.supabase = supabase;
			supabase.auth.signInWithPassword.mockResolvedValue({
				data: { user: authUser({ app_metadata: {} }), session: {} },
				error: null
			});
			mockDb({ match: () => ({ data: null, error: null }) });

			await expectRedirect(loginActions.default(event as never), {
				location: '/Authenticated/admin'
			});
		});

		it('writes an audit entry and the login marker cookie on success', async () => {
			const db = mockDb({ queue: [{ data: null, error: null }] });
			const event = makeFormEvent('/login', { email: 'a@b.c', password: 'pw' });
			mockSignIn(event, authUser({ app_metadata: { role: 'analyst' } }));

			await expectRedirect(loginActions.default(event as never), {
				location: '/Authenticated/dashboard'
			});

			const audit = db.callsFor('audit_logs').find((c) => c.verb === 'insert');
			expect(audit?.payload).toMatchObject({
				action: 'auth.login',
				actor_id: ACTOR_ID,
				actor_email: 'ana@pulilan.gov.ph',
				resource_type: 'auth',
				ip_address: '127.0.0.1'
			});
			expect(event.cookies.set).toHaveBeenCalledWith(
				'cp_login_logged',
				'1',
				expect.objectContaining({ httpOnly: true })
			);
		});
	});
});

describe('set-password/+page.server', () => {
	function mockSvc({
		passwordSet = false,
		flagCount = 1
	}: { passwordSet?: boolean; flagCount?: number } = {}) {
		const db = createFakeSupabase({
			match: (call): FakeResult => {
				if (call.table === 'profiles' && call.verb === 'select')
					return { data: { password_set: passwordSet }, error: null };
				if (call.table === 'profiles' && call.verb === 'update')
					return { data: null, error: null, count: flagCount };
				if (call.table === 'audit_logs') return { data: null, error: null };
				return { data: null, error: null };
			}
		});
		getServiceSupabase.mockReturnValue(db);
		return db;
	}

	describe('load', () => {
		it('redirects unauthenticated visitors to /login', async () => {
			await expectRedirect(
				setPasswordLoad(makeGetEvent('/set-password', { authenticated: false }) as never),
				{ location: '/login' }
			);
		});

		it('bounces fully-provisioned users to the dashboard', async () => {
			mockSvc({ passwordSet: true });
			await expectRedirect(setPasswordLoad(makeGetEvent('/set-password') as never), {
				location: '/Authenticated/dashboard'
			});
		});

		it('returns the masked email and full name for first-time setup', async () => {
			mockSvc({ passwordSet: false });
			const result = (await setPasswordLoad(
				makeGetEvent('/set-password', {
					user: {
						id: ACTOR_ID,
						email: 'ana@pulilan.gov.ph',
						user_metadata: { full_name: 'Ana Reyes' }
					}
				}) as never
			)) as unknown as {
				maskedEmail: string;
				fullName: string;
			};
			expect(result).toEqual({ maskedEmail: 'an•@pulilan.gov.ph', fullName: 'Ana Reyes' });
		});
	});

	describe('actions.default', () => {
		beforeEach(() => vi.clearAllMocks());

		it('rejects an expired invite session with 401', async () => {
			const event = makeFormEvent(
				'/set-password',
				{ password: 'x', confirm_password: 'x' },
				{ authenticated: false }
			);
			const result = (await setPasswordActions.default(event as never)) as unknown as ActionResult;
			expect(result.status).toBe(401);
			expect(String(result.data?.error)).toContain('invite session has expired');
		});

		it('rejects a session without a verified email', async () => {
			const event = makeFormEvent('/set-password', { password: 'x', confirm_password: 'x' });
			const result = (await setPasswordActions.default(event as never)) as unknown as ActionResult;
			expect(result.status).toBe(401);
		});

		it('surfaces the first password-policy failure', async () => {
			mockSvc();
			const event = makeFormEvent(
				'/set-password',
				{ password: 'short', confirm_password: 'short' },
				{ email: 'a@b.c' }
			);
			const result = (await setPasswordActions.default(event as never)) as unknown as ActionResult;
			expect(result.status).toBe(400);
			expect(result.data?.error).toBe('Password must be at least 12 characters.');
		});

		it('rejects a mismatched confirmation', async () => {
			mockSvc();
			const event = makeFormEvent(
				'/set-password',
				{ password: 'LongEnough1!', confirm_password: 'Different1!' },
				{ email: 'a@b.c' }
			);
			const result = (await setPasswordActions.default(event as never)) as unknown as ActionResult;
			expect(result.status).toBe(400);
			expect(result.data?.error).toBe('Passwords do not match.');
		});

		it('closes the already-provisioned race with 409', async () => {
			mockSvc({ passwordSet: true });
			const event = makeFormEvent(
				'/set-password',
				{ password: 'LongEnough1!', confirm_password: 'LongEnough1!' },
				{ email: 'a@b.c' }
			);
			const result = (await setPasswordActions.default(event as never)) as unknown as ActionResult;
			expect(result.status).toBe(409);
		});

		it('surfaces a password-update failure as 500', async () => {
			mockSvc();
			const event = makeFormEvent(
				'/set-password',
				{ password: 'LongEnough1!', confirm_password: 'LongEnough1!' },
				{ email: 'a@b.c' }
			);
			(event.locals.supabase as AuthSupabaseLike).auth.updateUser.mockResolvedValueOnce({
				data: { user: null },
				error: { message: 'token expired' }
			});

			const result = (await setPasswordActions.default(event as never)) as unknown as ActionResult;
			expect(result.status).toBe(500);
		});

		it('rejects a zero-row flag update as a concurrent double-submit', async () => {
			mockSvc({ passwordSet: false, flagCount: 0 });
			const event = makeFormEvent(
				'/set-password',
				{ password: 'LongEnough1!', confirm_password: 'LongEnough1!' },
				{ email: 'a@b.c' }
			);
			(event.locals.supabase as AuthSupabaseLike).auth.updateUser.mockResolvedValue({
				data: { user: {} },
				error: null
			});

			const result = (await setPasswordActions.default(event as never)) as unknown as ActionResult;
			expect(result.status).toBe(409);
		});

		it('updates the password, finalizes the flag, signs out, and redirects to login', async () => {
			mockSvc({ passwordSet: false, flagCount: 1 });
			const event = makeFormEvent(
				'/set-password',
				{ password: 'LongEnough1!', confirm_password: 'LongEnough1!' },
				{ email: 'a@b.c' }
			);
			const supabase = event.locals.supabase as AuthSupabaseLike;
			supabase.auth.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
			supabase.auth.signOut.mockResolvedValue({ error: null });

			await expectRedirect(setPasswordActions.default(event as never), {
				location: '/login?password_set=1'
			});

			expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'LongEnough1!' });
			expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
			const db = getServiceSupabase() as FakeSupabase;
			const flagUpdate = db.callsFor('profiles').find((c) => c.verb === 'update');
			expect(flagUpdate?.payload).toEqual({ password_set: true });
			expect(flagUpdate?.filters).toEqual([
				{ type: 'eq', column: 'id', value: ACTOR_ID },
				{ type: 'eq', column: 'password_set', value: false }
			]);
			expect(db.callsFor('audit_logs').find((c) => c.verb === 'insert')?.payload).toMatchObject({
				action: 'password_set'
			});
		});
	});
});

describe('logout/+page.server', () => {
	it('signs out, audits, and redirects to /login', async () => {
		const db = createFakeSupabase({ match: () => ({ data: null, error: null }) });
		getServiceSupabase.mockReturnValue(db);
		const event = makeGetEvent('/logout');
		const supabase = event.locals.supabase as AuthSupabaseLike;
		supabase.auth.signOut.mockResolvedValue({ error: null });

		await expectRedirect(logoutActions.default(event as never), { location: '/login' });

		expect(supabase.auth.signOut).toHaveBeenCalledOnce();
		expect(db.callsFor('audit_logs').find((c) => c.verb === 'insert')?.payload).toMatchObject({
			action: 'auth.logout',
			actor_id: ACTOR_ID
		});
	});
});

describe('auth/callback/confirm GET', () => {
	function confirmEvent(query: string) {
		const event = makeGetEvent(`/auth/callback/confirm${query}`);
		const supabase = event.locals.supabase as AuthSupabaseLike;
		return { event, supabase };
	}

	it('exchanges an authorization code into a session and lands on set-password', async () => {
		const { event, supabase } = confirmEvent('?code=abc123');
		supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });

		await expectRedirect(confirmGET(event as never), { location: '/set-password' });
		expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
	});

	it('rejects a failed code exchange as an invalid invite', async () => {
		const { event, supabase } = confirmEvent('?code=abc123');
		supabase.auth.exchangeCodeForSession.mockResolvedValue({
			data: { session: null },
			error: { message: 'bad' }
		});

		await expectRedirect(confirmGET(event as never), {
			location: '/login?error=invalid_invite_link'
		});
	});

	it('rejects a missing token_hash', async () => {
		const { event } = confirmEvent('?type=invite');
		await expectRedirect(confirmGET(event as never), {
			location: '/login?error=invalid_invite_link'
		});
	});

	it('rejects a non-invite OTP type', async () => {
		const { event } = confirmEvent('?token_hash=abc&type=magiclink');
		await expectRedirect(confirmGET(event as never), {
			location: '/login?error=invalid_invite_link'
		});
	});

	it('verifies a valid invite token and lands on set-password', async () => {
		const { event, supabase } = confirmEvent('?token_hash=invtok&type=invite');
		supabase.auth.verifyOtp.mockResolvedValue({ data: { user: {} }, error: null });

		await expectRedirect(confirmGET(event as never), { location: '/set-password' });
		expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({ type: 'invite', token_hash: 'invtok' });
	});

	it('reroutes an invalid invite token to the generic error', async () => {
		const { event, supabase } = confirmEvent('?token_hash=badtok&type=invite');
		supabase.auth.verifyOtp.mockResolvedValue({
			data: { user: null },
			error: { message: 'expired' }
		});

		await expectRedirect(confirmGET(event as never), {
			location: '/login?error=invalid_invite_link'
		});
	});
});

// Convenience — mockDb is used across the login/set-password blocks above.
function mockDb(config: Parameters<typeof createFakeSupabase>[0] = {}) {
	const db = createFakeSupabase(config);
	getServiceSupabase.mockReturnValue(db);
	return db;
}
