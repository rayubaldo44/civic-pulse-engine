import { expect, vi } from 'vitest';
import type { RecordedCall } from './fake-supabase';
import { createFakeSupabase, type FakeSupabase } from './fake-supabase';

// Loosened handler signatures — kit's generated RequestHandler types brand
// events to a single route path, which shared test fixtures cannot satisfy.
export type RouteHandler = (event: IssueRouteEvent) => Response | Promise<Response>;

// Action handlers take the same loosened request-event shape plus formParse.
export type ActionHandler = (event: IssueRouteEvent) => Promise<unknown> | unknown;

// Structural subset of RequestEvent the route handlers actually consume.
// Kit brands each route's event type to its exact path, so tests invoke
// handlers through this loosened shape instead.
export interface IssueRouteEvent {
	locals: {
		safeGetSession: () => Promise<{ user: { id: string; email?: string } | null }>;
		supabase?: AuthSupabaseLike;
		_sessionResolved?: boolean;
	};
	url: URL;
	params: Record<string, string>;
	request: Request;
	cookies: CookieLike;
	getClientAddress: () => string;
	resolve?: (event: unknown, opts?: unknown) => Promise<Response>;
}

export interface CookieLike {
	set: ReturnType<typeof vi.fn>;
	get: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
	getAll: ReturnType<typeof vi.fn>;
}

export interface AuthSupabaseLike extends FakeSupabase {
	auth: {
		signInWithPassword: ReturnType<typeof vi.fn>;
		updateUser: ReturnType<typeof vi.fn>;
		signOut: ReturnType<typeof vi.fn>;
		exchangeCodeForSession: ReturnType<typeof vi.fn>;
		verifyOtp: ReturnType<typeof vi.fn>;
		getUserById: ReturnType<typeof vi.fn>;
	};
}

export const ACTOR_ID = 'actor-1';

type SessionOpt = {
	authenticated?: boolean;
	userId?: string;
	email?: string;
	/** Full user object override — replaces the id/email defaults entirely. */
	user?: Record<string, unknown>;
};

function makeCookies(): CookieLike {
	return {
		set: vi.fn(),
		get: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => [])
	};
}

// A service-client fake with an admin `auth` surface bolted on. The `from()`
// side delegates to the same query-builder fake used across the api tests.
export function makeAuthSupabase(
	config: Parameters<typeof createFakeSupabase>[0] = {}
): AuthSupabaseLike {
	const db = createFakeSupabase(config);
	return {
		...db,
		auth: {
			signInWithPassword: vi.fn(),
			updateUser: vi.fn(),
			signOut: vi.fn(),
			exchangeCodeForSession: vi.fn(),
			verifyOtp: vi.fn(),
			getUserById: vi.fn()
		}
	};
}

function makeLocals({ authenticated = true, userId = ACTOR_ID, email, user }: SessionOpt = {}) {
	const resolvedUser = (user ?? {
		id: userId,
		...(email ? { email } : {})
	}) as { id: string; email?: string };
	return {
		safeGetSession: async () => ({
			user: authenticated ? resolvedUser : null
		}),
		supabase: makeAuthSupabase()
	};
}

function baseEvent(path: string, session: SessionOpt = {}): IssueRouteEvent {
	return {
		locals: makeLocals(session),
		url: new URL(path, 'http://localhost'),
		params: extractParams(path),
		request: new Request(`http://localhost${path}`),
		cookies: makeCookies(),
		getClientAddress: () => '127.0.0.1'
	};
}

export function makeGetEvent(path = '/api/issues', session: SessionOpt = {}): IssueRouteEvent {
	return baseEvent(path, session);
}

export function makeJsonEvent(
	method: 'POST' | 'PATCH',
	path: string,
	body?: unknown,
	session: SessionOpt = {}
): IssueRouteEvent {
	const event = baseEvent(path, session);
	if (body !== undefined) {
		event.request = new Request(`http://localhost${path}`, {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	} else {
		event.request = new Request(`http://localhost${path}`, { method });
	}
	return event;
}

// FormData-backed event for form actions (login / set-password / logout).
export function makeFormEvent(
	path: string,
	fields: Record<string, string>,
	session: SessionOpt = {}
): IssueRouteEvent {
	const event = baseEvent(path, session);
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.append(key, value);
	event.request = new Request(`http://localhost${path}`, { method: 'POST', body: form });
	return event;
}

function extractParams(path: string): Record<string, string> {
	const review = path.match(
		/\/api\/issues\/([^/]+)\/resolution-rounds(?:\/([^/]+))?(?:\/review|\/reviewers\/([^/]+))?$/
	);
	if (review) {
		return {
			id: review[1],
			...(review[2] ? { roundId: review[2] } : {}),
			...(review[3] ? { reviewId: review[3] } : {})
		};
	}
	const match = path.match(/\/api\/issues(?:\/([^/]+))?(?:\/comments)?$/);
	if (!match?.[1]) return {};
	return { id: match[1] };
}

// Kit's session/route gates throw a SvelteKit Redirect. We assert its shape
// rather than using isRedirect(), whose class-identity check can break when
// kit is duplicated between the test runner and vite-transformed route modules.
export async function expectRedirect(
	handlerResult: unknown,
	{ status = 303, location }: { status?: number; location: string }
): Promise<void> {
	let caught: unknown = handlerResult;
	if (typeof (handlerResult as Promise<unknown>)?.then === 'function') {
		try {
			await Promise.resolve(handlerResult);
		} catch (err) {
			caught = err;
		}
	} else {
		try {
			// Route handlers that throw synchronously (common with redirect()).
			if (typeof handlerResult === 'function') void (handlerResult as () => unknown)();
		} catch (err) {
			caught = err;
		}
	}

	const redirect = caught as { status?: number; location?: string } | undefined;
	expect(redirect, `expected a SvelteKit redirect to ${location}`).toBeDefined();
	expect(typeof redirect?.status, 'redirect must carry a numeric status').toBe('number');
	expect(redirect?.status).toBe(status);
	expect(redirect?.location).toBe(location);
}

export async function expectLoginRedirect(
	handlerResult: Response | Promise<Response>
): Promise<void> {
	await expectRedirect(handlerResult, { location: '/login' });
}

// Convenience for asserting a recorded query's filters.
export function eqFilters(call: RecordedCall) {
	return call.filters.filter((f) => f.type === 'eq');
}

export function ilikeFilters(call: RecordedCall) {
	return call.filters.filter((f) => f.type === 'ilike');
}
