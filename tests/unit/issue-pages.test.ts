import { describe, it, expect, vi, afterEach } from 'vitest';
import { createIssuePages } from '$lib/utils/issue-pages.svelte';
import {
	ISSUE_STATUSES,
	type IssueColumns,
	type IssueListQuery,
	type IssuePage
} from '$lib/types/paged-issues';
const query: IssueListQuery = {
	page: 1,
	statuses: [],
	priorities: [],
	topics: [],
	q: '',
	sort: 'created_at',
	direction: 'desc',
	scope: 'all'
};
const page = (status = 'Open', n = 1): IssuePage => ({
	items: [{ id: `${status}-${n}`, status }] as any,
	total: 60,
	page: n,
	pageSize: 25,
	counts: { open: 60, mine: 30, critical: 2 }
});
const columns = Object.fromEntries(ISSUE_STATUSES.map((s) => [s, page(s)])) as IssueColumns;
afterEach(() => vi.unstubAllGlobals());
describe('issue pages', () => {
	it('loads more only in the requested column, retaining global totals', async () => {
		const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => page('Open', 2) });
		vi.stubGlobal('fetch', fetcher);
		const state = createIssuePages({ columns, table: null, query, view: 'board' });
		await state.loadMore('Open');
		expect(state.columns?.Open.items).toHaveLength(2);
		expect(state.columns?.Closed.items).toHaveLength(1);
		expect(state.columns?.Open.total).toBe(60);
		expect(fetcher.mock.calls[0][0]).toContain('page=2');
	});
	it('keeps readable data and a retryable error when a column fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
		const state = createIssuePages({ columns, table: null, query, view: 'board' });
		await state.loadMore('Open');
		expect(state.columns?.Open.items).toHaveLength(1);
		expect(state.error).toContain('Unable');
	});
	it('ignores a late load-more response after server navigation supplies new data', async () => {
		let resolve!: (value: any) => void;
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise((r) => (resolve = r)))
		);
		const state = createIssuePages({ columns, table: null, query, view: 'board' });
		const pending = state.loadMore('Open');
		state.seed({
			columns: null,
			table: page('Closed'),
			query: { ...query, q: 'new' },
			view: 'table'
		});
		resolve({ ok: true, json: async () => page('Open', 2) });
		await pending;
		expect(state.columns).toBeNull();
		expect(state.table?.items[0].id).toBe('Closed-1');
	});
});

describe('refresh consistency', () => {
	it('supersedes an earlier read when a mutation requests a refresh', async () => {
		const pending: ((value: any) => void)[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise((resolve) => pending.push(resolve)))
		);
		const state = createIssuePages({ columns: null, table: page(), query, view: 'table' });
		const beforeMutation = state.refresh();
		const afterMutation = state.refresh();
		expect(pending).toHaveLength(2);
		pending[0]({
			ok: true,
			json: async () => ({ ...page(), items: [{ id: 'stale-before-mutation' }] })
		});
		await beforeMutation;
		expect(state.table?.items[0].id).toBe('Open-1');
		expect(state.loading).toBe(true);
		let mutationFinished = false;
		void afterMutation.then(() => {
			mutationFinished = true;
		});
		await Promise.resolve();
		expect(mutationFinished).toBe(false);
		pending[1]({
			ok: true,
			json: async () => ({ ...page(), items: [{ id: 'fresh-after-mutation' }] })
		});
		expect(await afterMutation).toBe(true);
		expect(state.table?.items[0].id).toBe('fresh-after-mutation');
		expect(state.loading).toBe(false);
	});
	it('honors board status filters during refresh and rejects excluded load-more requests', async () => {
		const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => page('Open') });
		vi.stubGlobal('fetch', fetcher);
		const state = createIssuePages({
			columns,
			table: null,
			query: { ...query, statuses: ['Open'] },
			view: 'board'
		});
		await state.loadMore('Closed');
		expect(fetcher).not.toHaveBeenCalled();
		await state.refresh();
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(state.columns?.Closed.items).toEqual([]);
		expect(state.columns?.Closed.total).toBe(0);
		expect(state.columns?.Open.total).toBe(60);
	});
});
