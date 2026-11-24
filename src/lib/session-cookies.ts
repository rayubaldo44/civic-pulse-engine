// src/lib/session-cookies.ts
//
// Auth cookies are scoped to the browser session, not to a 400-day lifetime.
//
// Why this file exists: @supabase/ssr hardcodes
// `maxAge: 400 * 24 * 60 * 60` in its own `setCookieOptions`, and it applies
// that value *after* spreading `options.cookieOptions` (see cookies.js in the
// package). Passing `cookieOptions` therefore cannot shorten the lifetime —
// the default always wins. The only way to get session cookies is to strip
// `maxAge`/`expires` on our side of the write, which is what these helpers do.
//
// Consequence: closing the browser drops the auth cookies, so the next visit
// is unauthenticated. That is the intended behaviour for this app. The
// logout beacon (src/routes/Authenticated/+layout.svelte) still runs on tab
// close so the refresh token is revoked server-side and an audit row is
// written — session cookies are the deterministic layer, the beacon is the
// best-effort one.
//
// Imported by both server and browser code, so it must NOT live under
// $lib/server/ (SvelteKit blocks client imports from there).

/** Cookie attributes Supabase SSR can attach to a cookie it writes. */
export interface CookieAttributes {
	path?: string;
	domain?: string;
	maxAge?: number;
	expires?: Date;
	secure?: boolean;
	httpOnly?: boolean;
	/** `false` is valid in the `cookie` package's SerializeOptions, hence boolean. */
	sameSite?: boolean | 'strict' | 'lax' | 'none';
	[key: string]: unknown;
}

/**
 * True when a cookie write is actually a deletion.
 *
 * The library encodes deletions as an empty value with `maxAge: 0`. Those
 * must keep their attributes — stripping `maxAge` from a deletion turns it
 * into a *set* of an empty cookie, which resurrects the key as a stub and
 * makes sign-out look like it half-worked.
 */
export function isCookieDeletion(value: string, options: CookieAttributes): boolean {
	return value === '' || options.maxAge === 0;
}

/**
 * Drop `maxAge`/`expires` so the browser treats the cookie as session-scoped
 * and discards it when the browser closes. Deletions pass through untouched.
 */
export function toSessionCookieOptions(value: string, options: CookieAttributes): CookieAttributes {
	if (isCookieDeletion(value, options)) return options;

	const { maxAge: _maxAge, expires: _expires, ...rest } = options;
	return rest;
}

/**
 * Serialize a cookie for `document.cookie`, skipping attributes the library
 * wants stripped. Deliberately hand-rolled rather than pulling in the `cookie`
 * package: that package is a transitive dependency of @supabase/ssr, not a
 * declared one, and importing it directly would be relying on a version we
 * don't control.
 */
export function serializeCookie(name: string, value: string, options: CookieAttributes): string {
	const parts = [`${name}=${encodeURIComponent(value)}`];

	if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
	if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
	if (options.domain) parts.push(`Domain=${options.domain}`);
	if (options.path) parts.push(`Path=${options.path}`);
	if (options.secure) parts.push('Secure');
	if (options.httpOnly) parts.push('HttpOnly');
	if (typeof options.sameSite === 'string') {
		const v = options.sameSite;
		parts.push(`SameSite=${v.charAt(0).toUpperCase()}${v.slice(1)}`);
	}
	// sameSite: false means "omit the attribute" — nothing to emit.

	return parts.join('; ');
}
