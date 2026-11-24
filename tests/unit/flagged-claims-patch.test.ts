import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { PATCH } from '../../src/routes/Authenticated/flagged-claims/+server';
import { createFakeSupabase, type FakeResult } from './helpers/fake-supabase';
import { makeJsonEvent, expectLoginRedirect, ACTOR_ID, type RouteHandler } from './helpers/api';
const patch = PATCH as unknown as RouteHandler;

const PATH = '/Authenticated/flagged-claims';

function mockDb(
	overrides: {
		updateError?: boolean;
		claim?: { claim_text?: string; status?: string } | null;
		reviewInsertError?: boolean;
	} = {}
) {
	const db = createFakeSupabase({
		match: (call): FakeResult => {
			if (call.table === 'flagged_claims' && call.verb === 'update') {
				return overrides.updateError
					? { data: null, error: { message: 'update rejected' } }
					: { data: null, error: null };
			}
			if (call.table === 'flagged_claims' && call.verb === 'select') {
				return {
					data: overrides.claim ?? { claim_text: 'A curfew was announced', status: 'Pending' },
					error: null
				};
			}
			if (call.table === 'review_records' && call.verb === 'insert') {
				return overrides.reviewInsertError
					? { data: null, error: { message: 'audit skipped' } }
					: { data: null, error: null };
			}
			if (call.table === 'audit_logs') return { data: null, error: null };
			return { data: null, error: null };
		}
	});
	getServiceSupabase.mockReturnValue(db);
	return db;
}

describe('PATCH /Authenticated/flagged-claims', () => {
	beforeEach(() => vi.clearAllMocks());

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(
			patch(
				makeJsonEvent(
					'PATCH',
					PATH,
					{ id: 'fc-1', status: 'Verified True' },
					{ authenticated: false }
				)
			)
		);
	});

	it('rejects a malformed JSON body with 400', async () => {
		mockDb();
		const event = makeJsonEvent('PATCH', PATH);
		event.request = new Request(`http://localhost${PATH}`, { method: 'PATCH', body: '{broken' });

		const res = await patch(event);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: 'Invalid request body — expected { id: string, status: string }'
		});
	});

	it.each([
		['missing id', { status: 'Verified True' }],
		['invalid status', { id: 'fc-1', status: 'Bogus' }]
	])('rejects %s with 400', async (_label, body) => {
		mockDb();
		const res = await patch(makeJsonEvent('PATCH', PATH, body));
		expect(res.status).toBe(400);
	});

	it('maps an update failure to a 500', async () => {
		mockDb({ updateError: true });
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const res = await patch(makeJsonEvent('PATCH', PATH, { id: 'fc-1', status: 'Verified True' }));
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'Failed to update flagged claim status' });
		expect(errSpy).toHaveBeenCalledWith('[flagged_claims] PATCH update error:', 'update rejected');
	});

	it('persists a non-Pending review, records a review row, and audits', async () => {
		const db = mockDb({ claim: { claim_text: 'A curfew was announced', status: 'Pending' } });
		const event = makeJsonEvent('PATCH', PATH, { id: 'fc-1', status: 'Verified True' });

		const res = await patch(event);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true });

		const update = db.callsFor('flagged_claims').find((c) => c.verb === 'update');
		expect(update?.payload).toEqual({ status: 'Verified True' });
		expect(update?.filters).toEqual([{ type: 'eq', column: 'id', value: 'fc-1' }]);

		const review = db.callsFor('review_records').find((c) => c.verb === 'insert');
		expect(review?.payload).toMatchObject({
			flagged_claim_id: 'fc-1',
			reviewed_by: ACTOR_ID,
			decision: 'Verified True'
		});

		const audit = db.callsFor('audit_logs').find((c) => c.verb === 'insert');
		expect(audit?.payload).toMatchObject({
			action: 'claim.review',
			actor_id: ACTOR_ID,
			resource_type: 'claim',
			resource_id: 'fc-1',
			ip_address: '127.0.0.1'
		});
		expect(JSON.parse(String((audit?.payload as Record<string, unknown>)?.details))).toEqual({
			previous_status: 'Pending',
			new_status: 'Verified True',
			claim_text: 'A curfew was announced'
		});
	});

	it('skips the review_records row when reverting to Pending', async () => {
		const db = mockDb({ claim: { claim_text: 'X', status: 'Inconclusive' } });

		const res = await patch(makeJsonEvent('PATCH', PATH, { id: 'fc-1', status: 'Pending' }));

		expect(res.status).toBe(200);
		expect(db.callsFor('review_records')).toHaveLength(0);
		expect(db.callsFor('audit_logs').find((c) => c.verb === 'insert')).toBeDefined();
	});

	it('tolerates a failed review_records insert (best-effort audit)', async () => {
		const db = mockDb({ reviewInsertError: true });
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const res = await patch(makeJsonEvent('PATCH', PATH, { id: 'fc-1', status: 'Inconclusive' }));

		expect(res.status).toBe(200);
		expect(db.callsFor('review_records')).toHaveLength(1);
		expect(errSpy).toHaveBeenCalledWith(
			'[flagged_claims] PATCH audit insert skipped:',
			expect.anything()
		);
	});
});
