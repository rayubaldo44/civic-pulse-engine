import { describe, it, expect, vi, beforeEach } from 'vitest';
const { getServiceSupabase } = vi.hoisted(() => ({ getServiceSupabase: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ getServiceSupabase }));
import { readIssueQuery, listIssuePage, listIssueBoard } from '$lib/server/paged-issues';
import { GET } from '../../src/routes/api/issues/paged/+server';
import { createRequestTimings } from '$lib/server/timing';
import { makeGetEvent, expectRedirect } from './helpers/api';

const result = {
	items: [{ id: 'issue-126', title: 'Far beyond the first page' }],
	total: 126,
	page: 6,
	pageSize: 25,
	counts: { open: 126, mine: 3, critical: 2 }
};
beforeEach(() => vi.clearAllMocks());
describe('paged issue queries', () => {
	it('whitelists filter/sort inputs and rejects partial or unsafe pages', () => {
		expect(
			readIssueQuery(
				new URLSearchParams(
					'page=2x&status=Open&status=bogus&priority=High&sort=title&direction=asc&scope=mine&q= bridge '
				)
			)
		).toMatchObject({
			page: 1,
			statuses: ['Open'],
			priorities: ['High'],
			sort: 'title',
			direction: 'asc',
			scope: 'mine',
			q: 'bridge'
		});
	});
	it('sends page six and server filters together and keeps the all-record total', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
		getServiceSupabase.mockReturnValue({ rpc });
		expect(
			await listIssuePage(
				readIssueQuery(new URLSearchParams('page=6&q=bridge&scope=reviews&sort=priority')),
				'user-a'
			)
		).toEqual(result);
		expect(rpc).toHaveBeenCalledWith(
			'get_issue_page',
			expect.objectContaining({
				p_page: 6,
				p_q: 'bridge',
				p_scope: 'reviews',
				p_user_id: 'user-a',
				p_sort: 'priority'
			})
		);
	});
	it('requests a separate first page for every board status in parallel', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
		getServiceSupabase.mockReturnValue({ rpc });
		const board = await listIssueBoard(readIssueQuery(new URLSearchParams()), 'user-a');
		expect(Object.keys(board)).toHaveLength(5);
		expect(rpc.mock.calls.map((args) => args[1].p_statuses)).toEqual([
			['Open'],
			['In Progress'],
			['Under Review'],
			['Resolved'],
			['Closed']
		]);
		expect(rpc.mock.calls.every((args) => args[1].p_page === 1)).toBe(true);
	});
	it('surfaces failed queries instead of a successful empty list', async () => {
		getServiceSupabase.mockReturnValue({
			rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } })
		});
		await expect(listIssuePage(readIssueQuery(new URLSearchParams()), 'u')).rejects.toThrow(
			'database unavailable'
		);
	});
});
describe('GET paged issues', () => {
	it('redirects an unauthenticated request', async () => {
		await expectRedirect(
			GET(makeGetEvent('/api/issues/paged', { authenticated: false }) as never),
			{ location: '/login' }
		);
		expect(getServiceSupabase).not.toHaveBeenCalled();
	});
	it('returns bounded page metadata and private response headers', async () => {
		getServiceSupabase.mockReturnValue({
			rpc: vi.fn().mockResolvedValue({ data: result, error: null })
		});
		const res = await GET(makeGetEvent('/api/issues/paged?page=6') as never);
		expect(await res.json()).toEqual(result);
		expect(res.headers.get('cache-control')).toBe('private, no-store');
	});
});

describe('board status filters', () => {
	it('keeps selected table statuses when requesting board pages', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
		getServiceSupabase.mockReturnValue({ rpc });
		const board = await listIssueBoard(
			readIssueQuery(new URLSearchParams('status=Open')),
			'user-a'
		);
		expect(rpc).toHaveBeenCalledTimes(1);
		expect(board.Open.total).toBe(126);
		expect(board.Closed.total).toBe(0);
		expect(board.Closed.items).toEqual([]);
		expect(board.Closed.counts).toEqual(result.counts);
	});
});

describe('issue request timing', () => {
	it('records a named DB duration without query data', async () => {
		getServiceSupabase.mockReturnValue({
			rpc: vi.fn().mockResolvedValue({ data: result, error: null })
		});
		const event = makeGetEvent('/api/issues/paged?q=private-query');
		const timings = createRequestTimings();
		Object.assign(event.locals, { timings });
		await GET(event as never);
		expect(timings.header()).toMatch(/^issues_db;dur=\d+\.\d$/);
		expect(timings.header()).not.toContain('private-query');
	});
});
