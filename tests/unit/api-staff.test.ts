import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { GET } from '../../src/routes/api/staff/+server';
import { createFakeSupabase } from './helpers/fake-supabase';
import { makeGetEvent, expectLoginRedirect, type RouteHandler } from './helpers/api';
const get = GET as unknown as RouteHandler;

function mockDb(config: Parameters<typeof createFakeSupabase>[0] = {}) {
	const db = createFakeSupabase(config);
	getServiceSupabase.mockReturnValue(db);
	return db;
}

describe('GET /api/staff', () => {
	beforeEach(() => vi.clearAllMocks());

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(get(makeGetEvent('/api/staff', { authenticated: false })));
	});

	it('returns profiles ordered by name as JSON', async () => {
		const staff = [
			{ id: 'u1', full_name: 'Ana Reyes' },
			{ id: 'u2', full_name: 'Ben Cruz' }
		];
		mockDb({ queue: [{ data: staff, error: null }] });

		const res = await get(makeGetEvent('/api/staff'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(staff);

		const call = getServiceSupabase().lastCall();
		expect(call.table).toBe('profiles');
		expect(call.select).toContain('id');
		expect(call.select).toContain('full_name');
		expect(call.order).toEqual({ column: 'full_name', options: undefined });
	});

	it('defaults a null dataset to an empty array', async () => {
		mockDb({ queue: [{ data: null, error: null }] });

		const res = await get(makeGetEvent('/api/staff'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	it('maps a query failure to a 500 with the supabase message', async () => {
		mockDb({ queue: [{ data: null, error: { message: 'db exploded' } }] });

		const res = await get(makeGetEvent('/api/staff'));
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'db exploded' });
	});
});
