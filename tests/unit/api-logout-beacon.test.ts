import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { POST } from '../../src/routes/api/logout-beacon/+server';
import { createFakeSupabase } from './helpers/fake-supabase';
import { makeGetEvent, makeAuthSupabase, ACTOR_ID, type RouteHandler } from './helpers/api';
const post = POST as unknown as RouteHandler;

function mockDb(config: Parameters<typeof createFakeSupabase>[0] = {}) {
	const db = createFakeSupabase(config);
	getServiceSupabase.mockReturnValue(db);
	return db;
}

describe('POST /api/logout-beacon', () => {
	beforeEach(() => vi.clearAllMocks());

	it('signs out a verified user locally and records an audit entry', async () => {
		const db = mockDb({ queue: [{ data: null, error: null }] });
		const event = makeGetEvent('/api/logout-beacon');
		const auth = makeAuthSupabase();
		event.locals.supabase = auth;
		auth.auth.signOut.mockResolvedValue({ error: null });

		const res = await post(event);

		expect(res.status).toBe(204);
		expect(await res.text()).toBe('');
		expect(auth.auth.signOut).toHaveBeenCalledOnce();
		expect(auth.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });

		const audit = db.callsFor('audit_logs').find((c) => c.verb === 'insert');
		expect(audit?.payload).toMatchObject({
			action: 'auth.logout',
			actor_id: ACTOR_ID,
			details: 'Tab closed — auto logout'
		});
	});

	it('ignores anonymous beacons and still returns 204', async () => {
		const db = mockDb({ queue: [{ data: null, error: null }] });
		const event = makeGetEvent('/api/logout-beacon', { authenticated: false });
		const auth = makeAuthSupabase();
		event.locals.supabase = auth;

		const res = await post(event);

		expect(res.status).toBe(204);
		expect(auth.auth.signOut).not.toHaveBeenCalled();
		expect(db.callsFor('audit_logs')).toHaveLength(0);
	});
});
