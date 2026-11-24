import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServiceSupabase, logAudit, notifyAssigned, notifyOutcome } = vi.hoisted(() => ({
	getServiceSupabase: vi.fn(),
	logAudit: vi.fn(),
	notifyAssigned: vi.fn(),
	notifyOutcome: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));
vi.mock('$lib/server/audit', () => ({ logAudit, buildDetails: JSON.stringify }));
vi.mock('$lib/server/notify', () => ({
	notifyIssuePeerReviewAssigned: notifyAssigned,
	notifyIssueReviewOutcome: notifyOutcome
}));

import { POST as startRound } from '../../src/routes/api/issues/[id]/resolution-rounds/+server';
import { POST as submitReview } from '../../src/routes/api/issues/[id]/resolution-rounds/[roundId]/review/+server';
import { createFakeSupabase } from './helpers/fake-supabase';
import { makeJsonEvent, type RouteHandler } from './helpers/api';

const ISSUE_ID = '11111111-1111-1111-1111-111111111111';
const ROUND_ID = '22222222-2222-2222-2222-222222222222';

describe('issue peer review API', () => {
	beforeEach(() => vi.clearAllMocks());

	it('requires complete resolution evidence before creating a round', async () => {
		const res = await (startRound as unknown as RouteHandler)(
			makeJsonEvent('POST', `/api/issues/${ISSUE_ID}/resolution-rounds`, {
				resolution_summary: 'Fixed',
				actions_taken: 'Replaced fixture',
				observed_outcome: 'Light works',
				evidence_links: ['not-a-url']
			})
		);

		expect(res.status).toBe(400);
		expect(getServiceSupabase).not.toHaveBeenCalled();
	});

	it('starts a round through the transactional RPC', async () => {
		const db = createFakeSupabase({
			match: (call) => {
				if (call.table === 'start_issue_resolution_round') return { data: ROUND_ID };
				if (call.table === 'civic_issues')
					return { data: { title: 'Streetlight', priority: 'High' } };
				if (call.table === 'issue_resolution_reviews') return { data: [] };
				return { data: null };
			}
		});
		getServiceSupabase.mockReturnValue(db);

		const res = await (startRound as unknown as RouteHandler)(
			makeJsonEvent('POST', `/api/issues/${ISSUE_ID}/resolution-rounds`, {
				resolution_summary: 'Fixed',
				actions_taken: 'Replaced fixture',
				observed_outcome: 'Light works',
				evidence_links: ['https://example.test/evidence']
			})
		);

		expect(res.status).toBe(201);
		expect(db.callsFor('start_issue_resolution_round')[0].rpc?.args).toMatchObject({
			p_issue_id: ISSUE_ID,
			p_evidence_links: ['https://example.test/evidence']
		});
	});

	it('does not allow approval with a failed rubric item', async () => {
		const res = await (submitReview as unknown as RouteHandler)(
			makeJsonEvent('POST', `/api/issues/${ISSUE_ID}/resolution-rounds/${ROUND_ID}/review`, {
				decision: 'approve',
				actions_completed: true,
				evidence_sufficient: false,
				outcome_addresses_issue: true,
				no_unresolved_blocker: true
			})
		);

		expect(res.status).toBe(400);
		expect(getServiceSupabase).not.toHaveBeenCalled();
	});

	it('records a complete independent vote through the RPC', async () => {
		const db = createFakeSupabase({
			match: (call) => {
				if (call.table === 'submit_issue_resolution_review') return { data: 'pending' };
				if (call.table === 'issue_resolution_rounds') return { data: { issue_id: ISSUE_ID } };
				return { data: null };
			}
		});
		getServiceSupabase.mockReturnValue(db);

		const res = await (submitReview as unknown as RouteHandler)(
			makeJsonEvent('POST', `/api/issues/${ISSUE_ID}/resolution-rounds/${ROUND_ID}/review`, {
				decision: 'approve',
				actions_completed: true,
				evidence_sufficient: true,
				outcome_addresses_issue: true,
				no_unresolved_blocker: true
			})
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ result: 'pending' });
		expect(db.callsFor('submit_issue_resolution_review')).toHaveLength(1);
	});
});
