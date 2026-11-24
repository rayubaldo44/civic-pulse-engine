import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
const { getCachedBadges } = vi.hoisted(() => ({ getCachedBadges: vi.fn() }));
const { setCachedBadges } = vi.hoisted(() => ({ setCachedBadges: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));
vi.mock('$lib/server/badges-cache', () => ({
	getCachedBadges,
	setCachedBadges,
	getBadgesFetchedAt: () => Date.now()
}));

import { GET } from '../../src/routes/api/sidebar-badges/+server';
import { createFakeSupabase, type FakeResult } from './helpers/fake-supabase';
import { makeGetEvent, expectLoginRedirect, type RouteHandler } from './helpers/api';

const get = GET as unknown as RouteHandler;

function mockDb(opts: {
	rpcResults?: Array<{ pending?: number; my_tasks?: number } | null>;
	rpcError?: { message: string; code?: string } | null;
}) {
	const results = opts.rpcResults ?? [{ pending: 0, my_tasks: 0 }];
	let callIndex = 0;

	const db = createFakeSupabase({
		match: (call): FakeResult => {
			const idx = callIndex++;
			const result = results[Math.min(idx, results.length - 1)] ?? { pending: 0, my_tasks: 0 };
			return {
				data: { pending: result.pending ?? 0, my_tasks: result.my_tasks ?? 0 },
				error: idx === 0 ? (opts.rpcError ?? null) : null
			};
		}
	});
	getServiceSupabase.mockReturnValue(db);
	return db;
}

describe('GET /api/sidebar-badges', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Clear any cached badges so each test starts fresh
		getCachedBadges.mockReturnValue(null);
	});

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(get(makeGetEvent('/api/sidebar-badges', { authenticated: false })));
	});

	it('returns pending and my_tasks counts from the RPC', async () => {
		mockDb({ rpcResults: [{ pending: 5, my_tasks: 3 }] });

		const res = await get(makeGetEvent('/api/sidebar-badges'));
		expect(res.status).toBe(200);

		const body = (await res.json()) as { pending: number; my_tasks: number };
		expect(body.pending).toBe(5);
		expect(body.my_tasks).toBe(3);
		expect(setCachedBadges).toHaveBeenCalled();
	});

	it('falls back to zeros when the RPC returns null data', async () => {
		mockDb({ rpcResults: [null] });

		const res = await get(makeGetEvent('/api/sidebar-badges'));
		expect(res.status).toBe(200);

		const body = (await res.json()) as { pending: number; my_tasks: number };
		expect(body.pending).toBe(0);
		expect(body.my_tasks).toBe(0);
		// Route still caches the fallback zeros (no error, just null data)
		expect(setCachedBadges).toHaveBeenCalledWith(
			expect.any(String),
			{ pending: 0, myTasks: 0 },
			expect.any(Number)
		);
	});

	it('returns a retryable error instead of replacing readable counts with false zeros', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockDb({ rpcResults: [null], rpcError: { message: 'query failed' } });

		const res = await get(makeGetEvent('/api/sidebar-badges'));
		expect(res.status).toBe(503);

		const body = (await res.json()) as { error: string };
		expect(body.error).toBe('Unable to refresh sidebar counts.');
		expect(errSpy).toHaveBeenCalled();
		expect(setCachedBadges).not.toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it('passes the user id to the RPC', async () => {
		mockDb({ rpcResults: [{ pending: 1, my_tasks: 2 }] });

		const db = mockDb({ rpcResults: [{ pending: 1, my_tasks: 2 }] });
		await get(makeGetEvent('/api/sidebar-badges'));
		const rpcCalls = db.callsFor('get_sidebar_badges');
		expect(rpcCalls.length).toBeGreaterThan(0);
		const rpcCall = rpcCalls[0];
		expect(rpcCall.rpc?.args).toEqual({ p_user_id: expect.any(String) });
	});
});
