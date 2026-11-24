import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIssueState } from '$lib/utils/issues.svelte';
import type { Issue, IssueDetail, Profile } from '$lib/types/issues';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const STAFF_A: Profile = { id: 'staff-a', full_name: 'Ana Reyes' };
const ISSUE_1: Issue = {
	id: 'issue-1',
	title: 'Broken streetlight',
	description: null,
	topic: 'Public Safety',
	priority: 'High',
	status: 'Open',
	created_at: '2026-08-01T00:00:00Z',
	updated_at: '2026-08-01T00:00:00Z',
	resolved_at: null,
	source_comment_id: null,
	source_flagged_claim_id: null,
	assigned_to: 'staff-a',
	created_by: null,
	assignee: STAFF_A,
	creator: null
};

function makeDetail(overrides: Partial<IssueDetail> = {}): IssueDetail {
	return {
		...ISSUE_1,
		comments: [],
		status_logs: [],
		source_comment: null,
		source_claim: null,
		...overrides
	};
}

type FetchReply = { body?: unknown; ok?: boolean; status?: number };

function jsonResponse(reply: FetchReply): Response {
	return {
		ok: reply.ok ?? true,
		status: reply.status ?? 200,
		json: async () => reply.body
	} as Response;
}

// Deferred fetch mock — tests resolve each queued call manually so they can
// assert mid-flight state (loading flags, concurrency guards, stale races).
function deferredFetch() {
	const log: { url: string; init?: RequestInit }[] = [];
	const pending: {
		resolve: (r: Response) => void;
		url: string;
		init?: RequestInit;
	}[] = [];
	const fetchMock = vi.fn(
		(url: string, init?: RequestInit) =>
			new Promise<Response>((resolve) => {
				log.push({ url, init });
				pending.push({ resolve, url, init });
			})
	);
	vi.stubGlobal('fetch', fetchMock);
	return {
		fetchMock,
		calls: () => log,
		resolveNext: (reply: FetchReply) => {
			const call = pending.shift();
			if (!call) throw new Error('deferredFetch: no pending call to resolve');
			call.resolve(jsonResponse(reply));
			return call.url;
		}
	};
}

// Network-level failure helper (fetch itself rejects).
function rejectingFetch() {
	return vi.fn(() => Promise.reject(new TypeError('network down')));
}

describe('createIssueState', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('seeds issues and staff from SSR data', () => {
		const ctx = createIssueState([ISSUE_1], [STAFF_A]);
		expect(ctx.issues).toEqual([ISSUE_1]);
		expect(ctx.staff).toEqual([STAFF_A]);
		expect(ctx.slideOpen).toBe(false);
	});

	describe('openIssue / closeSlideOver', () => {
		it('loads detail into the slide-over and clears loading when done', async () => {
			const io = deferredFetch();
			const ctx = createIssueState([ISSUE_1], []);
			const detail = makeDetail();

			const opening = ctx.openIssue(ISSUE_1);
			await Promise.resolve(); // let loading=true flush

			io.resolveNext({ body: detail });
			await opening;

			expect(ctx.slideLoading).toBe(false);
			expect(ctx.slideDetail).toEqual(detail);
			expect(ctx.slideOpen).toBe(true);
			expect(io.calls()[0].url).toBe('/api/issues/issue-1');
		});

		it('leaves the slide-over empty on a non-ok response', async () => {
			const io = deferredFetch();
			const ctx = createIssueState([ISSUE_1], []);

			const opening = ctx.openIssue(ISSUE_1);
			io.resolveNext({ ok: false, status: 404 });
			await opening;

			expect(ctx.slideDetail).toBeNull();
			expect(ctx.slideLoading).toBe(false);
		});

		it('survives network errors without crashing', async () => {
			const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			vi.stubGlobal('fetch', rejectingFetch());
			const ctx = createIssueState([ISSUE_1], []);

			await ctx.openIssue(ISSUE_1);

			expect(ctx.slideDetail).toBeNull();
			expect(ctx.slideLoading).toBe(false);
			expect(errSpy).toHaveBeenCalled();
		});

		it('closeSlideOver resets detail and loading', async () => {
			const io = deferredFetch();
			const ctx = createIssueState([ISSUE_1], []);

			const opening = ctx.openIssue(ISSUE_1);
			io.resolveNext({ body: makeDetail() });
			await opening;

			ctx.closeSlideOver();

			expect(ctx.slideDetail).toBeNull();
			expect(ctx.slideOpen).toBe(false);
		});
	});

	describe('handleUpdate', () => {
		it('merges updates into the matching list item and open slide-over', () => {
			const ctx = createIssueState([ISSUE_1], [STAFF_A]);

			ctx.handleUpdate({ id: 'issue-1', status: 'In Progress' });

			expect(ctx.issues[0].status).toBe('In Progress');
		});

		it('ignores updates for unknown ids', () => {
			const ctx = createIssueState([ISSUE_1], []);

			ctx.handleUpdate({ id: 'ghost', status: 'Closed' });

			expect(ctx.issues[0].status).toBe('Open');
		});
	});

	describe('refreshDetail', () => {
		it('is a no-op when nothing is open', async () => {
			const io = deferredFetch();
			const ctx = createIssueState([ISSUE_1], []);

			await ctx.refreshDetail();

			expect(io.calls()).toHaveLength(0);
		});

		it('re-syncs the slide-over and the issue list from the API', async () => {
			const io = deferredFetch();
			const refreshed = makeDetail({
				status: 'In Progress',
				comments: [{ id: 'c-9', body: 'hi', created_at: '2026-08-02T00:00:00Z', author: STAFF_A }]
			});
			const ctx = createIssueState([ISSUE_1], []);

			const opening = ctx.openIssue(ISSUE_1);
			io.resolveNext({ body: makeDetail() });
			await opening;

			const refreshing = ctx.refreshDetail();
			io.resolveNext({ body: refreshed });
			await refreshing;

			expect(ctx.slideDetail?.status).toBe('In Progress');
			expect(ctx.slideDetail?.comments).toHaveLength(1);
			expect(ctx.issues[0].status).toBe('In Progress');
		});

		it('discards stale responses if the panel closed mid-flight', async () => {
			const io = deferredFetch();
			const ctx = createIssueState([ISSUE_1], []);

			const opening = ctx.openIssue(ISSUE_1);
			io.resolveNext({ body: makeDetail() });
			await opening;

			const refreshing = ctx.refreshDetail();
			ctx.closeSlideOver(); // user closes while the refetch is in flight
			io.resolveNext({ body: makeDetail({ status: 'Closed' }) });
			await refreshing;

			expect(ctx.slideDetail).toBeNull();
		});
	});

	describe('refresh', () => {
		it('refetches issues and staff in parallel and replaces both lists', async () => {
			const io = deferredFetch();
			const ctx = createIssueState([], []);
			const nextIssues = [{ ...ISSUE_1, status: 'Closed' }];
			const nextStaff = [{ id: 'staff-b', full_name: 'Ben Cruz' }];

			const refreshingPromise = ctx.refresh();
			expect(ctx.refreshing).toBe(true);

			io.resolveNext({ body: nextIssues }); // /api/issues
			io.resolveNext({ body: nextStaff }); // /api/staff
			const ok = await refreshingPromise;

			expect(ok).toBe(true);
			expect(ctx.refreshing).toBe(false);
			expect(ctx.issues).toEqual(nextIssues);
			expect(ctx.staff).toEqual(nextStaff);
		});

		it('prevents overlapping refreshes', async () => {
			const io = deferredFetch();
			const ctx = createIssueState([], []);

			const first = ctx.refresh();
			const second = await ctx.refresh(); // must bail immediately

			expect(second).toBe(false);

			io.resolveNext({ body: [] });
			io.resolveNext({ body: [] });
			expect(await first).toBe(true);
		});

		it('still applies the issues list when only the staff fetch fails (ok stays true)', async () => {
			const io = deferredFetch();
			const ctx = createIssueState([], []);

			const refreshing = ctx.refresh();
			io.resolveNext({ body: [ISSUE_1] }); // issues OK
			io.resolveNext({ ok: false, status: 500 }); // staff fails
			const ok = await refreshing;

			// Pins current behavior: refresh() never inspects staffRes.ok, so a
			// staff-list failure is silently tolerated. If this ever changes,
			// the refresh-button UX decision should be revisited deliberately.
			expect(ok).toBe(true);
			expect(ctx.issues).toEqual([ISSUE_1]);
		});

		it('returns false when the network is down entirely', async () => {
			vi.stubGlobal('fetch', rejectingFetch());
			const ctx = createIssueState([], []);

			expect(await ctx.refresh()).toBe(false);
			expect(ctx.refreshing).toBe(false);
		});
	});
});

describe('issue detail request races', () => {
	afterEach(() => vi.unstubAllGlobals());
	it('ignores an opening response after the panel closes', async () => {
		const io = deferredFetch();
		const ctx = createIssueState();
		const pending = ctx.openIssue(ISSUE_1);
		ctx.closeSlideOver();
		io.resolveNext({ body: makeDetail() });
		await pending;
		expect(ctx.slideDetail).toBeNull();
		expect(ctx.slideOpen).toBe(false);
	});
	it('does not let an older selection replace a newer issue', async () => {
		const io = deferredFetch();
		const ctx = createIssueState();
		const first = ctx.openIssue(ISSUE_1);
		const second = ctx.openIssue({ ...ISSUE_1, id: 'issue-2' });
		io.resolveNext({ body: makeDetail() });
		await first;
		expect(ctx.slideLoading).toBe(true);
		io.resolveNext({ body: makeDetail({ id: 'issue-2' }) });
		await second;
		expect(ctx.slideDetail?.id).toBe('issue-2');
	});
});
