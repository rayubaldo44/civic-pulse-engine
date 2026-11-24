import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createServerClient, AuthApiError, testEnv } = vi.hoisted(() => {
	class AuthApiError extends Error {}
	return {
		createServerClient: vi.fn(),
		AuthApiError,
		testEnv: { DEMO_ONLY: 'false' }
	};
});

vi.mock('@supabase/ssr', () => ({ createServerClient }));
vi.mock('@supabase/supabase-js', () => ({ AuthApiError }));
vi.mock('$env/dynamic/private', () => ({ env: testEnv }));
vi.mock('$env/static/public', () => ({
	PUBLIC_SUPABASE_URL: 'https://db.example.supabase.co',
	PUBLIC_SUPABASE_ANON_KEY: 'anon_key'
}));

import { handle } from '../../src/hooks.server';
import { expectRedirect } from './helpers/api';

function serverClient() {
	return {
		auth: {
			getSession: vi.fn(),
			getUser: vi.fn()
		}
	};
}

function makeEvent(url: string, locals: Record<string, unknown> = {}) {
	const cookies = {
		getAll: vi.fn<() => { name: string; value: string }[]>(() => [
			{ name: 'sb-refresh-token', value: 'abc' }
		]),
		set: vi.fn(),
		delete: vi.fn(),
		get: vi.fn()
	};
	const event = {
		url: new URL(url),
		cookies,
		locals: { ...locals },
		request: new Request(url)
	};
	return { event, cookies };
}

function runHandle(event: ReturnType<typeof makeEvent>['event']) {
	const resolve = vi.fn(async () => new Response('resolved'));
	return {
		resolve,
		result: handle({ event, resolve } as unknown as Parameters<typeof handle>[0])
	};
}

describe('hooks.server handle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		testEnv.DEMO_ONLY = 'false';
	});

	it('redirects the demo deployment root to the synthetic showcase', async () => {
		testEnv.DEMO_ONLY = 'true';
		const { event } = makeEvent('https://app.example/');

		await expectRedirect(
			handle({ event, resolve: vi.fn() } as unknown as Parameters<typeof handle>[0]),
			{ status: 307, location: '/demo' }
		);
		expect(createServerClient).not.toHaveBeenCalled();
	});

	it('redirects unauthenticated visitors away from /Authenticated routes', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: null } });
		createServerClient.mockReturnValue(client);
		const { event } = makeEvent('https://app.example/Authenticated/dashboard');

		await expectRedirect(
			handle({ event, resolve: vi.fn() } as unknown as Parameters<typeof handle>[0]),
			{
				location: '/login'
			}
		);
		expect(client.auth.getSession).toHaveBeenCalled();
	});

	it('redirects authenticated users away from /login', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } });
		client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });
		createServerClient.mockReturnValue(client);
		const { event, cookies } = makeEvent('https://app.example/login');

		await expectRedirect(
			handle({ event, resolve: vi.fn() } as unknown as Parameters<typeof handle>[0]),
			{
				location: '/Authenticated/dashboard'
			}
		);
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('builds the supabase client from the public env vars', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } });
		client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });
		createServerClient.mockReturnValue(client);
		const { event } = makeEvent('https://app.example/Authenticated/dashboard');

		await runHandle(event);

		expect(createServerClient).toHaveBeenCalledWith(
			'https://db.example.supabase.co',
			'anon_key',
			expect.objectContaining({ cookies: expect.anything() })
		);
	});

	it('exposes the verified user on locals and lets the request through', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u-1' } } } });
		client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
		createServerClient.mockReturnValue(client);
		const { event } = makeEvent('https://app.example/Authenticated/dashboard');
		const { resolve, result } = runHandle(event);

		expect(await (await result).text()).toBe('resolved');
		expect(resolve).toHaveBeenCalledOnce();
		expect(event.locals._sessionResolved).toBe(true);
		const safeGetSession = event.locals.safeGetSession as () => Promise<{
			user: { id: string } | null;
		}>;
		expect(await safeGetSession()).toEqual({ user: { id: 'u-1' } });
	});

	it('adds anonymous timing durations and keeps authenticated responses private', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({
			data: { session: { user: { id: 'private-user' } } }
		});
		client.auth.getUser.mockResolvedValue({ data: { user: { id: 'private-user' } }, error: null });
		createServerClient.mockReturnValue(client);
		const { event } = makeEvent('https://app.example/Authenticated/dashboard');
		const response = await runHandle(event).result;
		expect(response.headers.get('server-timing')).toMatch(/auth;dur=/);
		expect(response.headers.get('server-timing')).toMatch(/resolve;dur=/);
		expect(response.headers.get('server-timing')).not.toContain('private-user');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('clears supabase cookies when the refresh token is rejected', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } });
		client.auth.getUser.mockRejectedValue(new AuthApiError('Invalid Refresh Token'));
		createServerClient.mockReturnValue(client);
		const { event, cookies } = makeEvent('https://app.example/Authenticated/dashboard');
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await expectRedirect(
			handle({ event, resolve: vi.fn() } as unknown as Parameters<typeof handle>[0]),
			{
				location: '/login'
			}
		);

		expect(cookies.delete).toHaveBeenCalledWith('sb-refresh-token', { path: '/' });
		expect(warnSpy).toHaveBeenCalledWith('[hooks] auth session error:', 'Invalid Refresh Token');
	});

	it('leaves cookies intact for non-auth errors', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } });
		client.auth.getUser.mockRejectedValue(new Error('network hang'));
		createServerClient.mockReturnValue(client);
		const { event, cookies } = makeEvent('https://app.example/Authenticated/dashboard');

		await expectRedirect(
			handle({ event, resolve: vi.fn() } as unknown as Parameters<typeof handle>[0]),
			{
				location: '/login'
			}
		);

		expect(cookies.delete).not.toHaveBeenCalled();
	});

	it('writes auth cookies without a lifetime so closing the browser logs out', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } });
		client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });
		createServerClient.mockReturnValue(client);
		const { event, cookies } = makeEvent('https://app.example/Authenticated/dashboard');

		await runHandle(event);

		const { setAll } = createServerClient.mock.calls[0][2].cookies;
		setAll(
			[
				{
					name: 'sb-ref-auth-token',
					value: 'session-value',
					// The 400-day default @supabase/ssr always applies.
					options: { path: '/', sameSite: 'lax', maxAge: 34_560_000 }
				}
			],
			{}
		);

		expect(cookies.set).toHaveBeenCalledWith(
			'sb-ref-auth-token',
			'session-value',
			expect.not.objectContaining({ maxAge: expect.anything() })
		);
		expect(cookies.set.mock.calls[0][2]).not.toHaveProperty('maxAge');
	});

	it('keeps maxAge 0 on auth cookie deletions so sign-out still clears them', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } });
		client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });
		createServerClient.mockReturnValue(client);
		const { event, cookies } = makeEvent('https://app.example/Authenticated/dashboard');

		await runHandle(event);

		const { setAll } = createServerClient.mock.calls[0][2].cookies;
		setAll([{ name: 'sb-ref-auth-token', value: '', options: { path: '/', maxAge: 0 } }], {});

		expect(cookies.set).toHaveBeenCalledWith(
			'sb-ref-auth-token',
			'',
			expect.objectContaining({ maxAge: 0 })
		);
	});

	it('forwards the no-store headers that come with auth cookie writes', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } });
		client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });
		createServerClient.mockReturnValue(client);
		const { event } = makeEvent('https://app.example/Authenticated/dashboard');

		// Invoke the registered setAll *before* awaiting, the way the Supabase
		// client does when a token refresh happens mid-request.
		const pending = runHandle(event);
		const { setAll } = createServerClient.mock.calls[0][2].cookies;
		setAll([{ name: 'sb-ref-auth-token', value: 'v', options: { path: '/', maxAge: 0 } }], {
			'cache-control': 'private, no-cache, no-store, must-revalidate, max-age=0'
		});

		const response = await pending.result;
		expect(response.headers.get('cache-control')).toContain('no-store');
	});

	it('leaves public response caching available when no auth cookies are written', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: null } });
		createServerClient.mockReturnValue(client);
		const { event } = makeEvent('https://app.example/');
		const response = await runHandle(event).result;
		expect(response.headers.get('cache-control')).toBeNull();
		expect(response.headers.get('server-timing')).toMatch(/auth;dur=/);
	});

	it('keeps authenticated page data private even without cookie writes', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } });
		client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });
		createServerClient.mockReturnValue(client);
		const { event } = makeEvent('https://app.example/Authenticated/dashboard');

		const { result } = runHandle(event);
		const response = await result;
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('reuses an already-resolved session within a request', async () => {
		const client = serverClient();
		client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } });
		client.auth.getUser.mockResolvedValue({ data: { user: { id: 'u' } }, error: null });
		createServerClient.mockReturnValue(client);
		const { event } = makeEvent('https://app.example/Authenticated/dashboard', {
			_sessionResolved: true,
			safeGetSession: async () => ({ user: { id: 'u-shared' } })
		});

		await runHandle(event);

		expect(client.auth.getSession).not.toHaveBeenCalled();
		const safeGetSession = event.locals.safeGetSession as () => Promise<{
			user: { id: string } | null;
		}>;
		expect(await safeGetSession()).toEqual({ user: { id: 'u-shared' } });
	});
});
