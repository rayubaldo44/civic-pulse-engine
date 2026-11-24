import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import type { Session } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import {
	serializeCookie,
	toSessionCookieOptions,
	type CookieAttributes
} from '$lib/session-cookies';
import type { LayoutLoad } from './$types';

/**
 * Browser cookie accessors for the Supabase client.
 *
 * @supabase/ssr's built-in document.cookie fallback writes auth cookies with a
 * hardcoded 400-day maxAge, so it must be replaced. The client's autoRefresh
 * (which runs on every token refresh) writes through this path — leaving the
 * default in place would silently re-persist the session on each refresh even
 * after the server-side hooks stopped doing so.
 */
function browserCookies() {
	return {
		getAll: () =>
			document.cookie
				.split('; ')
				.filter((pair) => pair.length > 0)
				.map((pair) => {
					const eq = pair.indexOf('=');
					if (eq === -1) return { name: pair, value: '' };
					const name = pair.slice(0, eq);
					const raw = pair.slice(eq + 1);
					// Values are URI-encoded on write (see serializeCookie), so they
					// must be decoded on read to round-trip. A malformed escape means
					// a foreign cookie sharing the prefix — surface it verbatim rather
					// than throwing inside the client's storage adapter.
					try {
						return { name, value: decodeURIComponent(raw) };
					} catch {
						return { name, value: raw };
					}
				}),
		setAll: (cookiesToSet: { name: string; value: string; options: CookieAttributes }[]) => {
			cookiesToSet.forEach(({ name, value, options }) => {
				document.cookie = serializeCookie(name, value, toSessionCookieOptions(value, options));
			});
		}
	};
}

export const load: LayoutLoad = async ({ data, depends }) => {
	depends('supabase:auth');

	const supabase = isBrowser()
		? createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				cookies: browserCookies()
			})
		: createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				cookies: {
					getAll() {
						return data.cookies;
					}
				}
			});

	// Only the browser client hydrates its own session from cookies. On the
	// server, hooks.server.ts already validated the session (and refreshed
	// the cookies); calling getSession() again would re-trigger the token
	// refresh and feed the single-use refresh-token rotation race. The
	// browser-side getSession() result is hydration-only and must never be
	// treated as authoritative identity — the verified identity is
	// `data.user` (populated via getUser() in hooks.server.ts).
	const session: Session | null = isBrowser()
		? (await supabase.auth.getSession()).data.session
		: null;

	return {
		supabase,
		session,
		user: data.user
	};
};
