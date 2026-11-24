import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));

import { GET } from '../../src/routes/api/priorities/+server';
import { createFakeSupabase, type FakeResult } from './helpers/fake-supabase';
import { makeGetEvent, expectLoginRedirect, type RouteHandler } from './helpers/api';
const get = GET as unknown as RouteHandler;

const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

interface RpcRow {
	topic_label: string | null;
	comment_count: number;
	negative_count: number;
	engagement_count?: number;
}

function mockDb(
	rpcStats: { rows?: RpcRow[] | null; error?: { message: string; code?: string } | null },
	opts: {
		civicIssues?: { topic: string | null; status: string }[] | null;
		legacyRows?: Record<string, unknown>[] | null;
		legacyError?: { message: string; code?: string } | null;
		basicRows?: RpcRow[] | null;
	} = {}
) {
	const db = createFakeSupabase({
		match: (call): FakeResult => {
			if (call.verb === 'rpc' && call.table === 'get_topic_window_stats_basic') {
				return { data: opts.basicRows as unknown[], error: null };
			}
			if (call.verb === 'rpc' && call.table === 'get_topic_window_stats') {
				return { data: rpcStats.rows as unknown[], error: rpcStats.error ?? null };
			}
			if (call.verb === 'select' && call.table === 'processed_content') {
				if (opts.legacyError && String(call.select ?? '').includes('raw_content'))
					return { data: null, error: opts.legacyError };
				return { data: opts.legacyRows ?? [], error: null };
			}
			if (call.verb === 'select' && call.table === 'civic_issues') {
				return { data: opts.civicIssues ?? [], error: null };
			}
			return { data: null, error: null };
		}
	});
	getServiceSupabase.mockReturnValue(db);
	return db;
}

describe('GET /api/priorities', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		warnSpy.mockClear();
		errSpy.mockClear();
	});

	it('redirects to /login when unauthenticated', async () => {
		await expectLoginRedirect(get(makeGetEvent('/api/priorities', { authenticated: false })));
	});

	it('aggregates RPC rows into ranked topics with derived statuses and engagement', async () => {
		const db = mockDb(
			{
				rows: [
					{
						topic_label: 'Public Safety and Peace and Order',
						comment_count: 8,
						negative_count: 4,
						engagement_count: 2
					},
					{
						topic_label: 'Infrastructure and Public Works',
						comment_count: 4,
						negative_count: 1,
						engagement_count: 3
					}
				]
			},
			{
				civicIssues: [
					{ topic: 'Public Safety', status: 'Open' },
					{ topic: 'Public Safety', status: 'Resolved' },
					{ topic: 'Infrastructure', status: 'Closed' }
				]
			}
		);

		const res = await get(makeGetEvent('/api/priorities?days=30'));
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('private, max-age=30, stale-while-revalidate=60');

		const body = (await res.json()) as {
			range: { days: number };
			engagementAvailable: boolean;
			priorities: Record<string, unknown>[];
		};
		expect(body.range.days).toBe(30);
		expect(body.engagementAvailable).toBe(true);

		expect(body.priorities).toHaveLength(2);
		expect(body.priorities[0]).toMatchObject({
			topic: 'Public Safety',
			displayName: 'Public Safety',
			rank: 1,
			score: 74,
			commentCount: 8,
			negativeCount: 4,
			engagementCount: 2,
			status: 'Monitoring' // has an active Open ticket
		});
		expect(body.priorities[1]).toMatchObject({
			topic: 'Infrastructure',
			rank: 2,
			score: 54,
			status: 'Addressed' // every ticket closed
		});

		// Compound NLP labels folded through normalizeTopic; window passed to the RPC.
		const rpcCall = db.callsFor('get_topic_window_stats')[0];
		expect(rpcCall.rpc?.args).toEqual({ p_since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });

		// civic_issues queried over the ranked canonical topics only.
		const issuesCall = db.callsFor('civic_issues')[0];
		expect(issuesCall.filters).toEqual([
			{ type: 'in', column: 'topic', value: ['Public Safety', 'Infrastructure'] }
		]);
	});

	it('falls back to the engagement-less RPC when migration 004 is missing (42703)', async () => {
		const db = mockDb(
			{
				rows: null,
				error: { code: '42703', message: 'column raw_content.reaction_count does not exist' }
			},
			{
				basicRows: [
					{ topic_label: 'Healthcare and Medical Services', comment_count: 5, negative_count: 2 }
				],
				civicIssues: []
			}
		);

		const res = await get(makeGetEvent('/api/priorities'));
		const body = (await res.json()) as {
			engagementAvailable: boolean;
			priorities: Record<string, unknown>[];
		};

		expect(res.status).toBe(200);
		expect(body.engagementAvailable).toBe(false);
		expect(body.priorities[0]).toMatchObject({
			topic: 'Healthcare',
			score: 54,
			engagementCount: 0,
			status: 'New'
		});
		expect(warnSpy).toHaveBeenCalled();
		expect(db.callsFor('get_topic_window_stats_basic')).toHaveLength(1);
	});

	it('backs off to a full-window row fetch when the RPC is missing (PGRST205)', async () => {
		const db = mockDb(
			{
				rows: null,
				error: { code: 'PGRST205', message: 'Could not find the function get_topic_window_stats' }
			},
			{
				legacyRows: [
					{
						topic_label: 'Waste Management and Sanitation',
						sentiment_label: 'negative',
						raw_content: { reaction_count: 10, reply_count: 2 }
					},
					{
						topic_label: 'Waste Management and Sanitation',
						sentiment_label: 'positive',
						raw_content: [{ reaction_count: 1, reply_count: 0 }]
					},
					{ topic_label: 'Local Governance', sentiment_label: 'negative', raw_content: null }
				],
				civicIssues: [{ topic: 'Waste Management', status: 'In Progress' }]
			}
		);

		const res = await get(makeGetEvent('/api/priorities'));
		const body = (await res.json()) as { priorities: Record<string, unknown>[] };

		expect(res.status).toBe(200);
		// Engagement normalised across object / single-element-array / null joins.
		expect(body.priorities[0]).toMatchObject({
			topic: 'Waste Management',
			score: 83,
			engagementCount: 13,
			status: 'Monitoring'
		});
		expect(body.priorities[1]).toMatchObject({ topic: 'Other', score: 55, engagementCount: 0 });

		const legacyQuery = db.callsFor('processed_content')[0];
		expect(legacyQuery.filters).toEqual([
			{ type: 'gte', column: 'processed_at', value: expect.any(String) },
			{ type: 'not', column: 'topic_label', operator: 'is', value: null }
		]);
		expect(legacyQuery.order).toEqual({ column: 'processed_at', options: { ascending: true } });
		expect(legacyQuery.select).toContain('raw_content');
	});

	it('retries without engagement columns when the legacy join itself 42703s', async () => {
		const db = mockDb(
			{ rows: null, error: { code: 'PGRST205', message: 'missing function' } },
			{
				legacyError: { code: '42703', message: 'raw_content.reaction_count missing' },
				legacyRows: [
					{ topic_label: 'Public Safety and Peace and Order', sentiment_label: 'negative' }
				],
				civicIssues: []
			}
		);

		const res = await get(makeGetEvent('/api/priorities'));
		const body = (await res.json()) as { engagementAvailable: boolean };

		expect(res.status).toBe(200);
		expect(body.engagementAvailable).toBe(false);
		const queries = db.callsFor('processed_content');
		expect(queries).toHaveLength(2);
		expect(queries[0].select).toContain('raw_content');
		expect(queries[1].select).not.toContain('raw_content');
	});

	it('filters ranked topics to the requested canonical topic', async () => {
		mockDb(
			{
				rows: [
					{
						topic_label: 'Public Safety and Peace and Order',
						comment_count: 8,
						negative_count: 2,
						engagement_count: 1
					},
					{
						topic_label: 'Infrastructure and Public Works',
						comment_count: 4,
						negative_count: 0,
						engagement_count: 0
					}
				]
			},
			{ civicIssues: [] }
		);

		const res = await get(makeGetEvent('/api/priorities?topic=Infrastructure'));
		const body = (await res.json()) as { priorities: Record<string, unknown>[] };

		expect(res.status).toBe(200);
		expect(body.priorities).toHaveLength(1);
		expect(body.priorities[0].topic).toBe('Infrastructure');
	});

	it('ignores an unknown topic filter rather than rejecting', async () => {
		mockDb(
			{
				rows: [{ topic_label: 'Other', comment_count: 3, negative_count: 1, engagement_count: 0 }]
			},
			{ civicIssues: [] }
		);

		const res = await get(makeGetEvent('/api/priorities?topic=NotATopic'));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { priorities: Record<string, unknown>[] };
		expect(body.priorities.map((p) => p.topic)).toContain('Other');
	});

	it('falls back to the 30-day default for days outside {7,30,90}', async () => {
		mockDb({ rows: [] }, { civicIssues: [] });

		for (const days of ['999', 'abc', '']) {
			const res = await get(makeGetEvent(`/api/priorities?days=${days}`));
			const body = (await res.json()) as { range: { days: number } };
			expect(body.range.days, `days=${days || '<missing>'}`).toBe(30);
		}
	});

	it('honours a valid 7-day window', async () => {
		mockDb({ rows: [] }, { civicIssues: [] });

		const res = await get(makeGetEvent('/api/priorities?days=7'));
		const body = (await res.json()) as { range: { days: number } };
		expect(body.range.days).toBe(7);
	});

	it('maps an unexpected RPC failure to a 500 (plain error objects degrade to generic)', async () => {
		mockDb({ rows: null, error: { message: 'rpc exploded' } });

		const res = await get(makeGetEvent('/api/priorities'));
		expect(res.status).toBe(500);
		// PostgrestError is a plain object (not an Error instance), so the
		// route's instanceof guard falls back to its generic message.
		expect(await res.json()).toEqual({ error: 'Unknown error' });
		expect(errSpy).toHaveBeenCalled();
	});
});
