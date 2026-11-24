import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase, notifyIssueAssigned, notifyIssueStatusChanged } = vi.hoisted(() => ({
	getServiceSupabase: vi.fn(),
	notifyIssueAssigned: vi.fn(),
	notifyIssueStatusChanged: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));
vi.mock('$lib/server/notify', () => ({ notifyIssueAssigned, notifyIssueStatusChanged }));

import { GET, PATCH } from '../../src/routes/api/issues/[id]/+server';
import { createFakeSupabase, type FakeResult } from './helpers/fake-supabase';
import type { RouteHandler } from './helpers/api';
const get = GET as unknown as RouteHandler;
const patch = PATCH as unknown as RouteHandler;

import { ACTOR_ID, expectLoginRedirect, makeGetEvent, makeJsonEvent } from './helpers/api';

function mockDb(config: Parameters<typeof createFakeSupabase>[0] = {}) {
	const db = createFakeSupabase(config);
	getServiceSupabase.mockReturnValue(db);
	return db;
}

const ISSUE_ID = '11111111-1111-1111-1111-111111111111';
const PATH = `/api/issues/${ISSUE_ID}`;

const CURRENT: {
	id: string;
	title: string;
	status: string;
	priority: string;
	assigned_to: string | null;
} = {
	id: ISSUE_ID,
	title: 'Broken streetlight',
	status: 'Open',
	priority: 'High',
	assigned_to: null
};

const UPDATED_ROW = {
	id: ISSUE_ID,
	title: 'Broken streetlight',
	status: 'In Progress',
	priority: 'High',
	assigned_to: null,
	updated_at: '2026-08-02T00:00:00Z',
	resolved_at: null,
	assignee: null
};

describe('GET /api/issues/[id]', () => {
	beforeEach(() => vi.clearAllMocks());

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(get(makeGetEvent(PATH, { authenticated: false })));
	});

	it('returns 404 when the issue does not exist', async () => {
		mockDb({
			match: (call) =>
				call.table === 'civic_issues' && call.verb === 'select' ? { data: null } : { data: [] }
		});

		const res = await get(makeGetEvent(PATH));

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'Issue not found' });
	});

	it('aggregates comments and status history onto the payload', async () => {
		const issueRow = { ...CURRENT, updated_at: '2026-08-01T00:00:00Z', resolved_at: null };
		const comments = [{ id: 'c-1', body: 'Crew dispatched' }];
		const logs = [{ id: 'l-1', from_status: null, to_status: 'Open' }];
		mockDb({
			match: (call) => {
				if (call.table === 'civic_issues') return { data: issueRow };
				if (call.table === 'issue_comments') return { data: comments };
				if (call.table === 'issue_status_logs') return { data: logs };
				return { data: null };
			}
		});

		const res = await get(makeGetEvent(PATH));

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			id: ISSUE_ID,
			comments,
			status_logs: logs
		});
	});

	it('defaults missing comment/log collections to empty arrays', async () => {
		mockDb({
			match: (call) => (call.table === 'civic_issues' ? { data: CURRENT } : { data: null })
		});

		const res = await get(makeGetEvent(PATH));

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ comments: [], status_logs: [] });
	});

	it('hides other reviewers and their votes while a round is pending', async () => {
		mockDb({
			match: (call) => {
				if (call.table === 'civic_issues') return { data: CURRENT };
				if (call.table === 'profiles') return { data: { role: 'analyst' } };
				if (call.table === 'issue_resolution_rounds')
					return {
						data: [
							{
								id: 'round-1',
								round_number: 1,
								status: 'pending',
								evidence_links: ['https://example.test']
							}
						]
					};
				if (call.table === 'issue_resolution_reviews')
					return {
						data: [
							{
								id: 'mine',
								round_id: 'round-1',
								reviewer_id: ACTOR_ID,
								decision: 'approve',
								submitted_at: '2026-08-01T00:00:00Z',
								reviewer: { id: ACTOR_ID, full_name: 'Me' }
							},
							{
								id: 'other',
								round_id: 'round-1',
								reviewer_id: 'other-user',
								decision: 'request_changes',
								comment: 'Hidden feedback',
								submitted_at: '2026-08-01T00:00:00Z',
								reviewer: { id: 'other-user', full_name: 'Other' }
							}
						]
					};
				return { data: [] };
			}
		});

		const payload = await (await get(makeGetEvent(PATH))).json();
		const [mine, other] = payload.resolution_rounds[0].reviews;
		expect(mine).toMatchObject({ id: 'mine', decision: 'approve', is_mine: true });
		expect(other).toMatchObject({ id: null, reviewer: null, decision: null, comment: null });
		expect(payload.resolution_rounds[0].review_count).toBe(2);
	});

	it('maps database failures to a 500', async () => {
		mockDb({
			match: () => ({ data: null, error: { message: 'join exploded' } })
		});

		const res = await get(makeGetEvent(PATH));

		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'Unknown error' });
	});
});

describe('PATCH /api/issues/[id] — request hygiene', () => {
	beforeEach(() => vi.clearAllMocks());

	it('rejects unauthenticated updates', async () => {
		await expectLoginRedirect(patch(makeJsonEvent('PATCH', PATH, {}, { authenticated: false })));
	});

	it('rejects malformed JSON bodies with 400', async () => {
		const event = makeJsonEvent('PATCH', PATH);
		event.request = new Request(`http://localhost${PATH}`, {
			method: 'PATCH',
			body: '{nope'
		});
		getServiceSupabase.mockReturnValue(createFakeSupabase({}));

		const res = await patch(event);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
	});

	it('returns 404 when the issue does not exist', async () => {
		mockDb({ queue: [{ data: null, error: null }] });

		const res = await patch(makeJsonEvent('PATCH', PATH, { priority: 'Low' }));

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'Issue not found' });
	});

	it('locks ordinary edits while peer review is active', async () => {
		mockDb({ queue: [{ data: { ...CURRENT, status: 'Under Review' }, error: null }] });

		const res = await patch(makeJsonEvent('PATCH', PATH, { priority: 'Low' }));

		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'This issue is locked while peer review is active' });
	});

	it('treats a failed current-row fetch as 404 too', async () => {
		mockDb({ queue: [{ data: null, error: { message: 'timeout' } }] });

		const res = await patch(makeJsonEvent('PATCH', PATH, { priority: 'Low' }));

		expect(res.status).toBe(404);
	});
});

describe('PATCH /api/issues/[id] — field validation', () => {
	beforeEach(() => vi.clearAllMocks());

	function withCurrent(overrides: Partial<typeof CURRENT> = {}) {
		return mockDb({
			match: (call): FakeResult => {
				if (call.table === 'civic_issues' && call.verb === 'select')
					return { data: { ...CURRENT, ...overrides } };
				if (call.table === 'civic_issues' && call.verb === 'update')
					return { data: { ...UPDATED_ROW }, error: null };
				if (call.table === 'profiles') return { data: { id: 'staff-9' } };
				if (call.table === 'issue_status_logs' && call.verb === 'select')
					return { data: { id: 'log-7' } };
				if (call.table === 'issue_status_logs' && call.verb === 'update')
					return { data: null, error: null };
				return { data: null };
			}
		});
	}

	it('rejects an illegal transition with the exact adjacency-map message', async () => {
		withCurrent();

		const res = await patch(makeJsonEvent('PATCH', PATH, { status: 'Resolved' }));

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Invalid transition: Open → Resolved' });
	});

	it('allows every legal transition out of the current status', async () => {
		for (const target of ['In Progress', 'Closed']) {
			const db = withCurrent();

			const res = await patch(makeJsonEvent('PATCH', PATH, { status: target }));

			expect(res.status, `${CURRENT.status} → ${target} must be legal`).toBe(200);
			expect(db.callsFor('civic_issues').find((c) => c.verb === 'update')?.payload).toMatchObject({
				status: target
			});
		}
	});

	it('treats a same-status body as a no-op rather than an invalid transition', async () => {
		withCurrent();

		const res = await patch(makeJsonEvent('PATCH', PATH, { status: 'Open' }));

		// Status alone produces an empty patch → "No valid fields"
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'No valid fields to update' });
	});

	it('skips the no-op status but still applies other fields', async () => {
		const db = withCurrent();

		const res = await patch(makeJsonEvent('PATCH', PATH, { status: 'Open', priority: 'Critical' }));

		expect(res.status).toBe(200);
		expect(db.callsFor('civic_issues').find((c) => c.verb === 'update')?.payload).toEqual({
			priority: 'Critical'
		});
	});

	it('rejects priorities outside the whitelist', async () => {
		withCurrent();

		const res = await patch(makeJsonEvent('PATCH', PATH, { priority: 'Urgent' }));

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'Invalid priority value' });
	});

	it('rejects assignments to non-existent profiles', async () => {
		mockDb({
			match: (call) =>
				call.table === 'civic_issues' && call.verb === 'select' ? { data: CURRENT } : { data: null }
		});

		const res = await patch(makeJsonEvent('PATCH', PATH, { assigned_to: 'ghost-user' }));

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: 'assigned_to does not reference a valid user'
		});
	});

	it('allows explicitly unassigning without a profile lookup', async () => {
		const db = withCurrent({ assigned_to: 'staff-9' });

		const res = await patch(makeJsonEvent('PATCH', PATH, { assigned_to: null }));

		expect(res.status).toBe(200);
		expect(db.callsFor('profiles')).toHaveLength(0);
		expect(db.callsFor('civic_issues').find((c) => c.verb === 'update')?.payload).toEqual({
			assigned_to: null
		});
	});

	it('silently ignores non-string, non-null assigned_to values', async () => {
		withCurrent();

		const res = await patch(makeJsonEvent('PATCH', PATH, { assigned_to: 42 }));

		expect(res.status).toBe(400); // nothing valid left in the patch
		expect(await res.json()).toEqual({ error: 'No valid fields to update' });
	});

	it('trims description text before persisting', async () => {
		const db = withCurrent();

		await patch(makeJsonEvent('PATCH', PATH, { description: '  loose wires near the school  ' }));

		expect(db.callsFor('civic_issues').find((c) => c.verb === 'update')?.payload).toEqual({
			description: 'loose wires near the school'
		});
	});

	it('rejects bodies that produce no updatable fields', async () => {
		withCurrent();

		const res = await patch(makeJsonEvent('PATCH', PATH, {}));

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'No valid fields to update' });
	});

	it('maps update failures to a 500', async () => {
		mockDb({
			match: (call) =>
				call.table === 'civic_issues' && call.verb === 'select'
					? { data: CURRENT }
					: { data: null, error: { message: 'row locked' } }
		});

		const res = await patch(makeJsonEvent('PATCH', PATH, { priority: 'Low' }));

		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'Unknown error' });
	});
});

describe('PATCH /api/issues/[id] — status log correction & notifications', () => {
	beforeEach(() => vi.clearAllMocks());

	type Scenario = {
		current?: Partial<typeof CURRENT>;
		body: Record<string, unknown>;
		logRow?: { id: string } | null;
		logUpdateError?: boolean;
	};

	async function runPatch(scenario: Scenario) {
		const db = mockDb({
			match: (call): FakeResult => {
				if (call.table === 'civic_issues' && call.verb === 'select')
					return { data: { ...CURRENT, ...(scenario.current ?? {}) } };
				if (call.table === 'civic_issues' && call.verb === 'update')
					return { data: UPDATED_ROW, error: null };
				if (call.table === 'profiles') return { data: { id: 'staff-9' } };
				if (call.table === 'issue_status_logs' && call.verb === 'select')
					return { data: scenario.logRow === undefined ? { id: 'log-7' } : scenario.logRow };
				if (call.table === 'issue_status_logs' && call.verb === 'update')
					return scenario.logUpdateError
						? { data: null, error: { message: 'log write failed' } }
						: { data: null, error: null };
				return { data: null };
			}
		});
		const res = await patch(makeJsonEvent('PATCH', PATH, scenario.body));
		return { db, res };
	}

	it('corrects changed_by and stores the note on the newest log row', async () => {
		const { db, res } = await runPatch({
			body: { status: 'In Progress', note: 'crew en route' },
			logRow: { id: 'log-42' }
		});

		expect(res.status).toBe(200);

		const logSelect = db.callsFor('issue_status_logs')[0];
		expect(logSelect.filters).toContainEqual({
			type: 'eq',
			column: 'to_status',
			value: 'In Progress'
		});
		expect(logSelect.order).toEqual({ column: 'changed_at', options: { ascending: false } });
		expect(logSelect.limit).toBe(1);

		const logUpdate = db.callsFor('issue_status_logs')[1];
		expect(logUpdate.verb).toBe('update');
		expect(logUpdate.payload).toEqual({ changed_by: ACTOR_ID, note: 'crew en route' });
		expect(logUpdate.filters).toEqual([{ type: 'eq', column: 'id', value: 'log-42' }]);
	});

	it('stores a null note when none is supplied', async () => {
		const { db, res } = await runPatch({ body: { status: 'In Progress' } });

		expect(res.status).toBe(200);
		expect(db.callsFor('issue_status_logs')[1].payload).toEqual({
			changed_by: ACTOR_ID,
			note: null
		});
	});

	it('skips log correction when the trigger produced no matching row', async () => {
		const { db, res } = await runPatch({
			body: { status: 'In Progress' },
			logRow: null
		});

		expect(res.status).toBe(200);
		expect(db.callsFor('issue_status_logs')).toHaveLength(1); // select only
	});

	it('treats log-correction write failures as best-effort (no request failure)', async () => {
		const { db, res } = await runPatch({
			body: { status: 'In Progress' },
			logUpdateError: true
		});

		// Supabase error results resolve instead of throwing, and the handler
		// never inspects this one — pinning that behavior deliberately.
		expect(res.status).toBe(200);
		expect(db.callsFor('issue_status_logs')[1].verb).toBe('update');
	});

	it('emails a newly assigned staff member (not the actor)', async () => {
		await runPatch({
			body: { assigned_to: 'staff-9' },
			current: { assigned_to: null }
		});

		expect(notifyIssueAssigned).toHaveBeenCalledOnce();
		expect(notifyIssueAssigned).toHaveBeenCalledWith({
			issueId: ISSUE_ID,
			title: CURRENT.title,
			priority: 'High',
			assigneeId: 'staff-9',
			actorId: ACTOR_ID
		});
		expect(notifyIssueStatusChanged).not.toHaveBeenCalled();
	});

	it('uses the new priority in assignment emails when both change together', async () => {
		await runPatch({
			body: { assigned_to: 'staff-9', priority: 'Critical' },
			current: { assigned_to: null }
		});

		expect(notifyIssueAssigned).toHaveBeenCalledWith(
			expect.objectContaining({ priority: 'Critical' })
		);
	});

	it('never emails when reassigning to yourself', async () => {
		await runPatch({
			body: { assigned_to: ACTOR_ID },
			current: { assigned_to: null }
		});

		expect(notifyIssueAssigned).not.toHaveBeenCalled();
	});

	it('skips unassignment notifications', async () => {
		await runPatch({
			body: { assigned_to: null },
			current: { assigned_to: 'staff-9' }
		});

		expect(notifyIssueAssigned).not.toHaveBeenCalled();
	});

	it('emails the assignee on real status changes', async () => {
		await runPatch({
			body: { status: 'In Progress' },
			current: { assigned_to: 'staff-9' }
		});

		expect(notifyIssueStatusChanged).toHaveBeenCalledOnce();
		expect(notifyIssueStatusChanged).toHaveBeenCalledWith({
			issueId: ISSUE_ID,
			title: CURRENT.title,
			priority: 'High',
			toStatus: 'In Progress',
			assigneeId: 'staff-9',
			actorId: ACTOR_ID
		});
		expect(notifyIssueAssigned).not.toHaveBeenCalled();
	});

	it('prefers the assignment email when reassigning and changing status together', async () => {
		await runPatch({
			body: { status: 'In Progress', assigned_to: 'staff-9' },
			current: { assigned_to: null }
		});

		expect(notifyIssueAssigned).toHaveBeenCalledOnce();
		expect(notifyIssueStatusChanged).not.toHaveBeenCalled();
	});

	it('stays silent when the actor is the assignee', async () => {
		await runPatch({
			body: { status: 'Under Review' },
			current: { assigned_to: ACTOR_ID }
		});

		expect(notifyIssueStatusChanged).not.toHaveBeenCalled();
	});

	it('stays silent on status changes for unassigned issues', async () => {
		await runPatch({ body: { status: 'In Progress' }, current: { assigned_to: null } });

		expect(notifyIssueStatusChanged).not.toHaveBeenCalled();
	});
});
