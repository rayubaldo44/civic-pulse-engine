<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import type { Issue } from '$lib/types/issues';
	import { issueQueryParams, type IssueListQuery } from '$lib/types/paged-issues';
	import { createIssueState } from '$lib/utils/issues.svelte';
	import { createIssuePages } from '$lib/utils/issue-pages.svelte';
	import IssueBoard from '$lib/components/IssueBoard.svelte';
	import IssueTable from '$lib/components/IssueTable.svelte';
	import IssueSlideOver from '$lib/components/IssueSlideOver.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Pagination from '$lib/components/Pagination.svelte';

	let { data }: { data: PageData } = $props();
	const pages = createIssuePages(untrack(() => data.issueData));
	const ctx = createIssueState(
		[],
		untrack(() => data.staff.slice())
	);
	let myReviewIssueIds = $state(new Set(untrack(() => data.myReviewIssueIds)));
	$effect(() => {
		pages.seed(data.issueData);
		ctx.staff = data.staff.slice();
		myReviewIssueIds = new Set(data.myReviewIssueIds);
	});
	$effect(() => {
		ctx.issues = pages.items;
	});
	let view = $derived(data.issueData.view);
	let query = $derived(data.issueData.query);
	let mineOnly = $derived(query.scope === 'mine');
	let reviewsOnly = $derived(query.scope === 'reviews');
	let openCount = $derived(pages.counts.open);
	let mineCount = $derived(pages.counts.mine);
	let visibleIssues = $derived(pages.items);
	let totals = $derived(
		pages.columns
			? Object.fromEntries(
					Object.entries(pages.columns).map(([status, column]) => [status, column.total])
				)
			: {}
	);

	function navigate(next: IssueListQuery, nextView = view) {
		const params = issueQueryParams(next);
		params.set('view', nextView);
		return goto(`${page.url.pathname}?${params}`, { keepFocus: true, noScroll: true });
	}
	function handleUpdate(updated: Partial<Issue> & { id: string }) {
		ctx.handleUpdate(updated);
		void pages.refresh();
	}
	async function refetchDetail() {
		await ctx.refreshDetail();
		await pages.refresh();
	}
</script>

<div class="flex h-full flex-col">
	<!-- ── Page Header ───────────────────────────────────────────────────────── -->
	<div class="border-b border-line bg-surface px-8 py-5">
		<PageHeader
			icon="issues"
			title="Issue Tracker"
			subtitle="Prioritized civic issues and feedback tickets for Pulilan LGU."
		>
			{#snippet right()}
				<div class="flex items-center gap-3">
					{#if openCount > 0}
						<span
							class="rounded-full border border-signal-200 bg-signal-50 px-3 py-1 text-xs font-semibold text-signal-600 tabular-nums dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400"
						>
							{openCount} Open
						</span>
					{/if}

					<!-- My Tasks — filters board/table to issues assigned to me -->
					{#if data.userId}
						<button
							onclick={() => {
								void navigate({ ...query, page: 1, scope: mineOnly ? 'all' : 'mine' });
							}}
							class="rounded-full border px-3 py-1 text-xs font-semibold transition-colors dark:border-slate-600"
							class:border-signal-200={mineOnly}
							class:bg-signal-50={mineOnly}
							class:text-signal-600={mineOnly}
							class:border-line={!mineOnly}
							class:bg-surface={!mineOnly}
							class:text-ink-muted={!mineOnly}
						>
							My Tasks{mineCount > 0 ? ` · ${mineCount}` : ''}
						</button>
					{/if}
					<button
						onclick={() => {
							void navigate({ ...query, page: 1, scope: reviewsOnly ? 'all' : 'reviews' });
						}}
						class="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
						class:border-signal-200={reviewsOnly}
						class:bg-signal-50={reviewsOnly}
						class:text-signal-600={reviewsOnly}
						class:border-line={!reviewsOnly}
						class:bg-surface={!reviewsOnly}
						class:text-ink-muted={!reviewsOnly}
					>
						My Reviews{myReviewIssueIds.size ? ` · ${myReviewIssueIds.size}` : ''}
					</button>

					<!-- Manual refresh — pulls latest issues without a page reload -->
					<button
						onclick={() => void pages.refresh()}
						disabled={pages.loading}
						title="Refresh issues"
						aria-label="Refresh issues"
						class="rounded-md border border-line bg-surface p-1.5 text-ink-faint
						       transition-colors hover:bg-gray-50 hover:text-ink dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500 dark:hover:bg-slate-800/60 dark:hover:text-slate-300"
					>
						<svg
							class="h-4 w-4 {pages.loading ? 'animate-spin' : ''}"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<polyline points="23 4 23 10 17 10" />
							<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
						</svg>
					</button>

					<!-- Segmented control: Board / Table -->
					<div class="segmented">
						<button
							onclick={() => void navigate({ ...query, page: 1 }, 'board')}
							class="segmented-btn"
							class:segmented-btn-active={view === 'board'}
						>
							<svg
								class="h-3.5 w-3.5"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<rect x="3" y="3" width="7" height="18" rx="1" />
								<rect x="14" y="3" width="7" height="10" rx="1" />
								<rect x="14" y="17" width="7" height="4" rx="1" />
							</svg>
							Board
						</button>
						<button
							onclick={() => void navigate({ ...query, page: 1 }, 'table')}
							class="segmented-btn"
							class:segmented-btn-active={view === 'table'}
						>
							<svg
								class="h-3.5 w-3.5"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<line x1="8" y1="6" x2="21" y2="6" />
								<line x1="8" y1="12" x2="21" y2="12" />
								<line x1="8" y1="18" x2="21" y2="18" />
								<line x1="3" y1="6" x2="3.01" y2="6" />
								<line x1="3" y1="12" x2="3.01" y2="12" />
								<line x1="3" y1="18" x2="3.01" y2="18" />
							</svg>
							Table
						</button>
					</div>
				</div>
			{/snippet}
		</PageHeader>
	</div>

	<!-- ── Main content ──────────────────────────────────────────────────────── -->
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		{#if pages.error}
			<div
				role="alert"
				class="flex items-center justify-between gap-3 px-6 py-3 text-sm text-rose-700 dark:text-rose-300"
			>
				<span>{pages.error}</span><button class="underline" onclick={() => void pages.refresh()}
					>Retry</button
				>
			</div>
		{/if}
		{#if view === 'board'}
			<form
				class="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3"
				onsubmit={(event) => {
					event.preventDefault();
					const input = new FormData(event.currentTarget).get('q');
					void navigate({ ...query, page: 1, q: String(input ?? '') });
				}}
			>
				<label class="sr-only" for="board-search">Search all issues</label>
				<input
					id="board-search"
					name="q"
					value={query.q}
					placeholder="Search by title…"
					class="input w-64 py-1.5"
				/>
				<button class="btn-secondary" type="submit">Search</button>
			</form>
		{/if}
		<div class="min-h-0 flex-1 overflow-hidden">
			{#if view === 'board'}
				<IssueBoard
					issues={visibleIssues}
					onSelect={ctx.openIssue}
					{totals}
					loadingColumns={pages.loadingColumns}
					onLoadMore={(status) => void pages.loadMore(status)}
				/>
			{:else}
				<IssueTable
					issues={visibleIssues}
					onSelect={ctx.openIssue}
					serverQuery={query}
					total={pages.table?.total}
					onQueryChange={(next) => void navigate(next)}
				/>
			{/if}
		</div>
		{#if view === 'table' && pages.table}
			<div class="border-t border-line px-6">
				<Pagination
					page={pages.table.page}
					pageSize={pages.table.pageSize}
					total={pages.table.total}
				/>
			</div>
		{/if}
	</div>
</div>

<!-- ── SlideOver ─────────────────────────────────────────────────────────────── -->
<IssueSlideOver
	detail={ctx.slideDetail}
	loading={ctx.slideLoading}
	open={ctx.slideOpen}
	staff={ctx.staff}
	onClose={ctx.closeSlideOver}
	onUpdate={handleUpdate}
	onRefetch={refetchDetail}
	userId={data.userId}
	role={data.role}
	onReviewSubmitted={(issueId) => {
		myReviewIssueIds.delete(issueId);
		myReviewIssueIds = new Set(myReviewIssueIds);
		void pages.refresh();
	}}
/>
