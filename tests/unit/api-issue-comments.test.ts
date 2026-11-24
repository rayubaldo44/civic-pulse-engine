import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { POST } from '../../src/routes/api/issues/[id]/comments/+server';
import { createFakeSupabase } from './helpers/fake-supabase';
import { ACTOR_ID, expectLoginRedirect, makeJsonEvent } from './helpers/api';
import type { RouteHandler } from './helpers/api';
const post = POST as unknown as RouteHandler;

function mockDb(config: Parameters<typeof createFakeSupabase>[0] = {}) {
	const db = createFakeSupabase(config);
	getServiceSupabase.mockReturnValue(db);
	return db;
}

const ISSUE_ID = '22222222-2222-2222-2222-222222222222';
const PATH = `/api/issues/${ISSUE_ID}/comments`;

const AUTHOR_JOIN = [
	{ id: 'c-1', body: 'Crew dispatched', author: { id: ACTOR_ID, full_name: 'Juana' } }
];

describe('POST /api/issues/[id]/comments', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getServiceSupabase.mockReset();
	});

	it('rejects unauthenticated comments', async () => {
		await expectLoginRedirect(post(makeJsonEvent('POST', PATH, {}, { authenticated: false })));
	});

	it('rejects malformed JSON bodies with 400', async () => {
		const event = makeJsonEvent('POST', PATH);
		event.request = new Request(`http://localhost${PATH}`, {
			method: 'POST',
			body: '{broken'
		});
		mockDb();

		const res = await post(event);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
	});

	it.each(['', '   ', null, 42])('rejects %j as a comment body', async (bodyValue) => {
		mockDb();

		const res = await post(makeJsonEvent('POST', PATH, { body: bodyValue }));

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: 'body is required and must not be empty'
		});
	});

	it('returns 404 when the parent issue does not exist', async () => {
		mockDb({ queue: [{ data: null, error: null }] });

		const res = await post(makeJsonEvent('POST', PATH, { body: 'hello' }));

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'Issue not found' });
	});

	it('creates the comment scoped to the issue and actor on 201', async () => {
		const db = mockDb({
			queue: [
				{ data: { id: ISSUE_ID }, error: null },
				{ data: AUTHOR_JOIN[0], error: null }
			]
		});

		const res = await post(makeJsonEvent('POST', PATH, { body: '  Crew dispatched  ' }));

		expect(res.status).toBe(201);
		expect(await res.json()).toEqual(AUTHOR_JOIN[0]);

		const insert = db.lastCall();
		expect(insert.verb).toBe('insert');
		expect(insert.table).toBe('issue_comments');
		expect(insert.payload).toEqual({
			issue_id: ISSUE_ID,
			author_id: ACTOR_ID,
			body: 'Crew dispatched'
		});
		expect(insert.select).toContain('author:profiles!issue_comments_author_id_fkey');
	});

	it('verifies the parent issue before inserting', async () => {
		const db = mockDb({
			queue: [
				{ data: { id: ISSUE_ID }, error: null },
				{ data: AUTHOR_JOIN[0], error: null }
			]
		});

		await post(makeJsonEvent('POST', PATH, { body: 'note' }));

		const [issueLookup] = db.callsFor('civic_issues');
		expect(issueLookup.terminal).toBe('maybeSingle');
		expect(issueLookup.filters).toEqual([{ type: 'eq', column: 'id', value: ISSUE_ID }]);
	});

	it('maps insert failures to a 500', async () => {
		mockDb({
			queue: [
				{ data: { id: ISSUE_ID }, error: null },
				{ data: null, error: { message: 'fk violated' } }
			]
		});

		const res = await post(makeJsonEvent('POST', PATH, { body: 'note' }));

		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'Unknown error' });
	});
});
