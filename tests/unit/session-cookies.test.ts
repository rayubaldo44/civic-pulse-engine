import { describe, it, expect } from 'vitest';
import {
	isCookieDeletion,
	serializeCookie,
	toSessionCookieOptions
} from '../../src/lib/session-cookies';

describe('isCookieDeletion', () => {
	it('treats an empty value as a deletion', () => {
		expect(isCookieDeletion('', { maxAge: 34_560_000 })).toBe(true);
	});

	it('treats maxAge 0 as a deletion even with a value', () => {
		expect(isCookieDeletion('value', { maxAge: 0 })).toBe(true);
	});

	it('treats a populated cookie with a long lifetime as a write', () => {
		expect(isCookieDeletion('value', { maxAge: 34_560_000 })).toBe(false);
		expect(isCookieDeletion('value', {})).toBe(false);
	});
});

describe('toSessionCookieOptions', () => {
	it('strips maxAge and expires so the cookie dies with the browser', () => {
		const expires = new Date('2030-01-01T00:00:00Z');
		const result = toSessionCookieOptions('session-value', {
			path: '/',
			sameSite: 'lax',
			httpOnly: false,
			maxAge: 400 * 24 * 60 * 60,
			expires
		});

		expect(result).not.toHaveProperty('maxAge');
		expect(result).not.toHaveProperty('expires');
		expect(result.path).toBe('/');
		expect(result.sameSite).toBe('lax');
	});

	it('leaves deletions untouched so sign-out still clears the key', () => {
		const options = { path: '/', maxAge: 0 };
		expect(toSessionCookieOptions('', options)).toBe(options);
		expect(toSessionCookieOptions('x', { path: '/', maxAge: 0 })).toEqual({
			path: '/',
			maxAge: 0
		});
	});

	it('does not mutate the caller-supplied options object', () => {
		const options = { path: '/', maxAge: 100 };
		toSessionCookieOptions('value', options);
		expect(options.maxAge).toBe(100);
	});
});

describe('serializeCookie', () => {
	it('omits Max-Age when the lifetime was stripped', () => {
		const header = serializeCookie('sb-x-auth-token', 'abc', { path: '/', sameSite: 'lax' });
		expect(header).toBe('sb-x-auth-token=abc; Path=/; SameSite=Lax');
		expect(header).not.toContain('Max-Age');
	});

	it('still emits Max-Age for deletions', () => {
		const header = serializeCookie('sb-x-auth-token', '', { path: '/', maxAge: 0 });
		expect(header).toContain('Max-Age=0');
	});

	it('URI-encodes the value so a round-trip through getAll is lossless', () => {
		const header = serializeCookie('k', 'a=b; c', { path: '/' });
		expect(header).toBe('k=a%3Db%3B%20c; Path=/');
		expect(decodeURIComponent(header.slice('k='.length, header.indexOf(';')))).toBe('a=b; c');
	});

	it('emits flags and an expiry when present', () => {
		const header = serializeCookie('k', 'v', {
			path: '/',
			domain: 'example.com',
			secure: true,
			httpOnly: true,
			sameSite: 'strict',
			expires: new Date(Date.UTC(2030, 0, 1))
		});
		expect(header).toContain('Domain=example.com');
		expect(header).toContain('Secure');
		expect(header).toContain('HttpOnly');
		expect(header).toContain('SameSite=Strict');
		expect(header).toContain('Expires=Tue, 01 Jan 2030 00:00:00 GMT');
	});
});
