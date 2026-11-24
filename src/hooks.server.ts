import { createServerClient } from '@supabase/ssr';
import { AuthApiError, type User } from '@supabase/supabase-js';
import { createRequestTimings } from '$lib/server/timing';
import { type Handle, redirect } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { env } from '$env/dynamic/private';
import { toSessionCookieOptions, type CookieAttributes } from '$lib/session-cookies';

// This hook runs on every request to the server
// Routes that require authentication
const PROTECTED_ROUTES = ['/Authenticated']; // covers all sub-routes
// Routes only accessible when NOT authenticated
const AUTH_ROUTES = ['/login'];

export const handle: Handle = async ({ event, resolve }) => {
	// The separate public showcase deployment serves only the synthetic pages.
	// It is configured without production database or integration credentials.
	if (env.DEMO_ONLY === 'true') {
		if (event.url.pathname === '/') redirect(307, '/demo');
		if (event.url.pathname !== '/demo') return new Response('Not found', { status: 404 });
	}

	// Headers the Supabase SSR client asks us to attach whenever it writes
	// auth cookies (Cache-Control: private, no-store, Expires: 0, Pragma:
	// no-cache). Without these, a CDN or reverse proxy can cache a response
	// carrying one user's Set-Cookie and serve it to another. Vercel sits in
	// front of this app in production, so they matter.
	let authResponseHeaders: Record<string, string> = {};
	const timings = createRequestTimings();
	event.locals.timings = timings;

	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		global: {
			fetch: (input, init) => {
				const url = new URL(
					typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
				);
				return timings.measure(
					url.pathname.startsWith('/auth/') ? 'supabase_auth' : 'supabase_db',
					() => fetch(input, init)
				);
			}
		},
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet, headers) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					// Supabase SSR hardcodes a 400-day maxAge and applies it after
					// merging cookieOptions, so its own options can't be trusted to
					// reflect intent. Strip the lifetime so the auth cookie dies with
					// the browser — see src/lib/session-cookies.ts. Deletions
					// (maxAge: 0) are left alone so sign-out still clears the key.
					const scoped = toSessionCookieOptions(value, options as CookieAttributes);
					event.cookies.set(name, value, { ...scoped, path: '/' });
				});
				if (headers) authResponseHeaders = { ...headers };
			}
		}
	});

	/**
	 * safeGetSession validates the token via getUser() instead of
	 * trusting the local session — required for secure server-side auth.
	 * Only the Auth-server-verified `user` is exposed; the raw session from
	 * getSession() is never propagated (it embeds an untrusted session.user).
	 * Result is memoized per-request so multiple layout/load callers
	 * don't each trigger separate Supabase HTTP round-trips.
	 *
	 * Session resolution never throws. When several requests race to rotate
	 * the same single-use refresh token (parallel pages/loads/fetches after
	 * the access token expires), Supabase rejects all but the first with
	 * "Invalid Refresh Token". Treat that as logged-out instead of crashing.
	 */
	await timings.measure('auth', async () => {
		if (!event.locals._sessionResolved) {
			let user: User | null = null;

			try {
				const {
					data: { session }
				} = await event.locals.supabase.auth.getSession();

				if (session) {
					const {
						data: { user: authedUser },
						error
					} = await event.locals.supabase.auth.getUser();
					// Only the Auth-server-verified identity is authoritative.
					if (!error) user = authedUser;
				}
			} catch (err) {
				// AuthApiError with status 400 → the refresh token was rejected
				// (revoked/rotated by a concurrent request). Clear the Supabase
				// cookies so the stale session can't retry forever, then hand the
				// request a null session → protected routes redirect to /login.
				// Non-auth errors (e.g. transient network failures) leave the
				// cookies intact so the next request can retry cleanly.
				if (err instanceof AuthApiError) {
					console.warn('[hooks] auth session error:', err.message);
					event.cookies
						.getAll()
						.filter((c) => c.name.startsWith('sb-'))
						.forEach(({ name }) => event.cookies.delete(name, { path: '/' }));
				}
			} finally {
				event.locals.safeGetSession = async () => ({ user });
				event.locals._sessionResolved = true;
			}
		}
	});
	const { user } = await event.locals.safeGetSession();
	const path = event.url.pathname;

	// Redirect unauthenticated users away from protected routes
	const isProtected = PROTECTED_ROUTES.some((r) => path.startsWith(r));
	if (isProtected && !user) {
		redirect(303, '/login');
	}

	// Redirect authenticated users away from /login
	const isAuthRoute = AUTH_ROUTES.some((r) => path.startsWith(r));
	if (isAuthRoute && user) {
		redirect(303, '/Authenticated/dashboard');
	}

	const response = await timings.measure('resolve', () =>
		resolve(event, {
			filterSerializedResponseHeaders(name) {
				return name === 'content-range' || name === 'x-supabase-api-version';
			}
		})
	);

	// Only override headers on responses that actually carried auth cookies.
	// Applying no-store to every response would needlessly disable caching for
	// static asset and public page requests.

	const headers = new Headers(response.headers);
	headers.set('Server-Timing', timings.header());
	if (user && (path.startsWith('/Authenticated') || path.startsWith('/api/'))) {
		headers.set('Cache-Control', 'private, no-store');
	}
	for (const [name, value] of Object.entries(authResponseHeaders)) {
		headers.set(name, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};
