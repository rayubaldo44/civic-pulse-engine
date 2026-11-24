import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { logAudit, buildDetails } from '$lib/server/audit';
import { createFakeSupabase } from './helpers/fake-supabase';
import { ACTOR_ID } from './helpers/api';

function mockDb() {
	const db = createFakeSupabase({ queue: [{ data: null, error: null }] });
	getServiceSupabase.mockReturnValue(db);
	return db;
}

describe('logAudit', () => {
	beforeEach(() => vi.clearAllMocks());

	it('inserts the full payload with every optional field defaulted to null', async () => {
		const db = mockDb();

		await logAudit({ action: 'issue.create', actorId: ACTOR_ID, actorEmail: 'a@b.c' });

		const insert = db.callsFor('audit_logs').find((c) => c.verb === 'insert');
		expect(insert).toBeDefined();
		expect(insert?.payload).toEqual({
			action: 'issue.create',
			actor_id: ACTOR_ID,
			actor_email: 'a@b.c',
			details: null,
			resource_type: null,
			resource_id: null,
			ip_address: null,
			user_agent: null
		});
	});

	it('passes through supplied optional fields', async () => {
		const db = mockDb();

		await logAudit({
			action: 'claim.review',
			actorId: ACTOR_ID,
			actorEmail: 'a@b.c',
			details: '{"new_status":"Verified True"}',
			resourceType: 'claim',
			resourceId: 'fc-1',
			ipAddress: '127.0.0.1',
			userAgent: 'vitest/1'
		});

		const insert = db.callsFor('audit_logs').find((c) => c.verb === 'insert');
		expect(insert?.payload).toMatchObject({
			resource_type: 'claim',
			resource_id: 'fc-1',
			ip_address: '127.0.0.1',
			user_agent: 'vitest/1',
			details: '{"new_status":"Verified True"}'
		});
	});

	it('accepts a null actor id (system actions)', async () => {
		const db = mockDb();

		await logAudit({ action: 'system.cleanup', actorId: null, actorEmail: 'system' });

		const insert = db.callsFor('audit_logs').find((c) => c.verb === 'insert');
		const payload = insert?.payload as Record<string, unknown> | null;
		expect(payload?.actor_id).toBeNull();
		expect(payload?.actor_email).toBe('system');
	});

	it('swallows database failures instead of rejecting the caller', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const db = createFakeSupabase({
			match: () => ({ data: null, error: { message: 'relation does not exist' } })
		});
		getServiceSupabase.mockReturnValue(db);
		// Even when the service client itself throws, logAudit must resolve.
		getServiceSupabase.mockImplementationOnce(() => {
			throw new Error('service client failed');
		});

		await expect(
			logAudit({ action: 'x', actorId: null, actorEmail: 'system' })
		).resolves.toBeUndefined();
		expect(errSpy).toHaveBeenCalled();
	});
});

describe('buildDetails', () => {
	it('serializes a change map to a JSON string', () => {
		expect(buildDetails({ from: 'Open', to: 'In Progress' })).toBe(
			'{"from":"Open","to":"In Progress"}'
		);
	});
});
