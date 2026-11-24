import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase, notifyIssueAssigned, notifyIssueStatusChanged } = vi.hoisted(() => ({
	getServiceSupabase: vi.fn(),
	notifyIssueAssigned: vi.fn(),
	notifyIssueStatusChanged: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));
vi.mock('$lib/server/notify', () => ({ notifyIssueAssigned, notifyIssueStatusChanged }));

import { GET, POST } from '../../src/routes/api/issues/+server';
import { createFakeSupabase, type FakeResult } from './helpers/fake-supabase';
import type { RouteHandler } from './helpers/api';
const get = GET as unknown as RouteHandler;
const post = POST as unknown as RouteHandler;

import { ACTOR_ID, expectLoginRedirect, makeGetEvent, makeJsonEvent } from './helpers/api';

function mockDb(config: Parameters<typeof createFakeSupabase>[0] = {}) {
	const db = createFakeSupabase(config);
	getServiceSupabase.mockReturnValue(db);
	return db;
}

const ROW = {
	id: 'issue-1',
	title: 'Broken streetlight',
	priority: 'High',
	status: 'Open',
	created_at: '2026-08-01T00:00:00Z'
};

describe('GET /api/issues', () => {
	beforeEach(() => vi.clearAllMocks());

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(get(makeGetEvent('/api/issues', { authenticated: false })));
	});

	it('returns the issue list as JSON (200)', async () => {
		mockDb({ queue: [{ data: [ROW], error: null }] });

		const res = await get(makeGetEvent('/api/issues?status=Open&q=light'));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([ROW]);
	});

	it('forwards whitelisted query filters into the query', async () => {
		const db = mockDb({ queue: [{ data: [], error: null }] });

		await get(makeGetEvent('/api/issues?status=Open&priority=High&topic=Infrastructure&q=road'));

		const call = db.lastCall();
		expect(call.filters).toEqual([
			{ type: 'eq', column: 'status', value: 'Open' },
			{ type: 'eq', column: 'priority', value: 'High' },
			{ type: 'eq', column: 'topic', value: 'Infrastructure' },
			{ type: 'ilike', column: 'title', value: '%road%' }
		]);
	});

	it('ignores non-whitelisted filter params instead of rejecting', async () => {
		const db = mockDb({ queue: [{ data: [], error: null }] });

		const res = await get(makeGetEvent('/api/issues?status=Bogus&topic=NotATopic'));

		expect(res.status).toBe(200);
		expect(db.lastCall().filters).toEqual([]);
	});

	it('maps supabase failures to a 500', async () => {
		// Supabase errors are plain objects (not Error instances), so the
		// route's instanceof guard degrades them to its generic fallback.
		mockDb({ queue: [{ data: null, error: { message: 'boom' } }] });

		const res = await get(makeGetEvent());

		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'Unknown error' });
	});
});

describe('POST /api/issues', () => {
	beforeEach(() => vi.clearAllMocks());

	function insertResult(data: FakeResult['data'] = { id: 'new-issue' }): FakeResult {
		return { data, error: null };
	}

	it('rejects unauthenticated creates', async () => {
		await expectLoginRedirect(
			post(makeJsonEvent('POST', '/api/issues', {}, { authenticated: false }))
		);
	});

	it('rejects malformed JSON bodies with 400', async () => {
		const event = makeJsonEvent('POST', '/api/issues');
		event.request = new Request('http://localhost/api/issues', {
			method: 'POST',
			body: '{not json'
		});

		const res = await post(event);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
	});

	it('requires a title', async () => {
		for (const title of ['', '   ']) {
			const res = await post(makeJsonEvent('POST', '/api/issues', { title }));
			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({ error: 'title is required' });
		}
	});

	it('rejects topics outside the canonical whitelist', async () => {
		const res = await post(
			makeJsonEvent('POST', '/api/issues', {
				title: 'x',
				topic: 'Public Safety and Peace and Order'
			})
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Invalid topic value' });
	});

	it('creates an Open issue with defaults on 201', async () => {
		const created = { id: 'new-issue', title: 'Flooded road', priority: 'Medium', status: 'Open' };
		const db = mockDb({ queue: [insertResult(created), { data: null }] });

		const res = await post(
			makeJsonEvent('POST', '/api/issues', {
				title: '  Flooded road  ',
				description: 'Water everywhere'
			})
		);

		expect(res.status).toBe(201);
		expect(await res.json()).toEqual(created);

		const insert = db.callsFor('civic_issues').find((c) => c.verb === 'insert')!;
		expect(insert.verb).toBe('insert');
		expect(insert.terminal).toBe('single');
		expect(insert.payload).toMatchObject({
			title: 'Flooded road',
			description: 'Water everywhere',
			topic: null,
			priority: 'Medium',
			status: 'Open',
			source_comment_id: null,
			source_flagged_claim_id: null,
			assigned_to: null,
			created_by: ACTOR_ID
		});
	});

	it('coerces invalid priority values to Medium instead of rejecting', async () => {
		const db = mockDb({ queue: [insertResult(), { data: null }] });

		await post(makeJsonEvent('POST', '/api/issues', { title: 'x', priority: 'Urgent' }));

		expect(db.callsFor('civic_issues').find((c) => c.verb === 'insert')?.payload).toMatchObject({
			priority: 'Medium'
		});
	});

	it('keeps a valid priority as provided', async () => {
		const db = mockDb({ queue: [insertResult(), { data: null }] });

		await post(makeJsonEvent('POST', '/api/issues', { title: 'x', priority: 'Critical' }));

		expect(db.callsFor('civic_issues').find((c) => c.verb === 'insert')?.payload).toMatchObject({
			priority: 'Critical'
		});
	});

	it('carries escalation source ids through to the insert', async () => {
		const db = mockDb({
			queue: [insertResult(), { data: null }]
		});

		await post(
			makeJsonEvent('POST', '/api/issues', {
				title: 'Escalated claim',
				source_comment_id: 'pc-1',
				source_flagged_claim_id: 'fc-1'
			})
		);

		expect(db.callsFor('civic_issues').find((c) => c.verb === 'insert')?.payload).toMatchObject({
			source_comment_id: 'pc-1',
			source_flagged_claim_id: 'fc-1'
		});
	});

	it('validates assigned_to against profiles before inserting', async () => {
		mockDb({ queue: [{ data: null, error: null }] }); // profile miss

		const res = await post(
			makeJsonEvent('POST', '/api/issues', { title: 'x', assigned_to: 'ghost-user' })
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: 'assigned_to does not reference a valid user'
		});
	});

	it('notifies a valid assignee after creating the issue', async () => {
		const db = mockDb({
			queue: [
				{ data: { id: 'staff-9' }, error: null },
				insertResult({ id: 'new-issue', priority: 'High' }),
				{ data: null }
			]
		});

		const res = await post(
			makeJsonEvent('POST', '/api/issues', {
				title: 'Fix pump',
				priority: 'High',
				assigned_to: 'staff-9'
			})
		);

		expect(res.status).toBe(201);
		expect(db.callsFor('profiles')[0].terminal).toBe('maybeSingle');
		expect(notifyIssueAssigned).toHaveBeenCalledOnce();
		expect(notifyIssueAssigned).toHaveBeenCalledWith({
			issueId: 'new-issue',
			title: 'Fix pump',
			priority: 'High',
			assigneeId: 'staff-9',
			actorId: ACTOR_ID
		});
		expect(notifyIssueStatusChanged).not.toHaveBeenCalled();
	});

	it('skips notifications for unassigned creates', async () => {
		mockDb({ queue: [insertResult(), { data: null }] });

		await post(makeJsonEvent('POST', '/api/issues', { title: 'x' }));

		expect(notifyIssueAssigned).not.toHaveBeenCalled();
	});

	it('maps insert failures to a 500', async () => {
		mockDb({ queue: [{ data: null, error: { message: 'constraint violated' } }] });

		const res = await post(makeJsonEvent('POST', '/api/issues', { title: 'x' }));

		expect(res.status).toBe(500);
		// Plain-object PostgrestError falls through the instanceof guard.
		expect(await res.json()).toEqual({ error: 'Unknown error' });
	});
});
