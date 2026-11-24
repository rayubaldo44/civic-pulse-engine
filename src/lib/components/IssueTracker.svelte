<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { createIssueState } from '$lib/utils/issues.svelte';
	import { createIssuePages } from '$lib/utils/issue-pages.svelte';
	import type { IssueListQuery } from '$lib/types/paged-issues';
	import type { Issue, Profile } from '$lib/types/issues';
	import IssueBoard from '$lib/components/IssueBoard.svelte';
	import IssueTable from '$lib/components/IssueTable.svelte';
	import IssueSlideOver from '$lib/components/IssueSlideOver.svelte';

	let loading = $state(true);
	let view = $state<'board' | 'table'>('board');
	let query = $state<IssueListQuery>({
		page: 1,
		statuses: [],
		priorities: [],
		topics: [],
		q: '',
		sort: 'created_at',
		direction: 'desc',
		scope: 'all'
	});
	const pages = createIssuePages({
		columns: null,
		table: null,
		query: untrack(() => query),
		view: 'board'
	});
	const ctx = createIssueState();
	let elementRef: HTMLElement;
	let openCount = $derived(pages.counts.open);
	let criticalCount = $derived(pages.counts.critical);
	let loadError = $derived(pages.error);
	let totals = $derived(
		pages.columns
			? Object.fromEntries(
					Object.entries(pages.columns).map(([status, column]) => [status, column.total])
				)
			: {}
	);
	$effect(() => {
		ctx.issues = pages.items;
	});
	let queryVersion = 0;
	async function changeQuery(next: IssueListQuery, nextView = view) {
		const version = ++queryVersion;
		query = next;
		view = nextView;
		loading = true;
		pages.seed({ columns: null, table: null, query: next, view: nextView });
		await pages.refresh();
		if (version === queryVersion) loading = false;
	}
	function handleUpdate(updated: Partial<Issue> & { id: string }) {
		ctx.handleUpdate(updated);
		void pages.refresh();
	}
	async function refetchDetail() {
		await ctx.refreshDetail();
		await pages.refresh();
	}
	onMount(() => {
		async function poll() {
			const version = queryVersion;
			await pages.refresh();
			if (version === queryVersion) loading = false;
		}
		void poll();
		// Staff is needed by the detail editor, not on every issue poll.
		void fetch('/api/staff')
			.then(async (response) => {
				if (response.ok) ctx.staff = (await response.json()) as Profile[];
			})
			.catch(() => {});
		const interval = setInterval(() => {
			if (document.visibilityState === 'visible' && elementRef?.getClientRects().length)
				void poll();
		}, 60_000);
		return () => clearInterval(interval);
	});
</script>

<!-- ── Card shell ────────────────────────────────────────────────────────── -->
<div class="card" bind:this={elementRef}>
	<!-- ── Header ──────────────────────────────────────────────────────────── -->
	<div
		class="flex items-center justify-between border-b border-line px-6 py-4 dark:border-slate-800"
	>
		<div class="flex items-center gap-3">
			<h3 class="flex items-center gap-2 text-base font-semibold text-ink">
				<svg
					class="h-4 w-4 text-ink-faint"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
				Issue Tracker
			</h3>

			{#if !loading && !loadError}
				{#if openCount > 0}
					<span
						class="rounded-full border border-signal-200 bg-signal-50 px-2.5 py-0.5 text-[11px] font-semibold text-signal-600
					             tabular-nums dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400"
					>
						{openCount} Open
					</span>
				{/if}
				{#if criticalCount > 0}
					<span
						class="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600
					             tabular-nums dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400"
					>
						{criticalCount} Critical
					</span>
				{/if}
			{/if}
		</div>

		<div class="flex items-center gap-3">
			<!-- Board / Table segmented control -->
			<div class="segmented">
				<button
					onclick={() => void changeQuery({ ...query, page: 1 }, 'board')}
					class="segmented-btn {view === 'board' ? 'segmented-btn-active' : ''}"
					title="Board view"
				>
					<svg
						class="h-3 w-3"
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
					onclick={() => void changeQuery({ ...query, page: 1 }, 'table')}
					class="segmented-btn {view === 'table' ? 'segmented-btn-active' : ''}"
					title="Table view"
				>
					<svg
						class="h-3 w-3"
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

			<!-- Link to full page -->
			<a
				href="/Authenticated/issues"
				class="flex items-center gap-1 text-xs font-medium text-signal-600 transition-colors
				       hover:text-signal-700"
			>
				View All
				<svg
					class="h-3 w-3"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<line x1="5" y1="12" x2="19" y2="12" />
					<polyline points="12 5 19 12 12 19" />
				</svg>
			</a>
		</div>
	</div>

	{#if loadError && ctx.issues.length > 0}
		<div role="alert" class="flex justify-between gap-3 px-6 py-2 text-sm text-rose-600">
			<span>{loadError}</span><button class="underline" onclick={() => void pages.refresh()}
				>Retry</button
			>
		</div>
	{/if}
	<!-- ── Content area — fixed height so board columns scroll in-place ─────── -->
	<div class="h-[460px] overflow-hidden">
		{#if loading}
			<!-- Skeleton -->
			<div class="grid h-full grid-cols-5 gap-4 p-6">
				{#each [1, 2, 3, 4, 5] as col}
					<div
						class="animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60"
						style="animation-delay: {(col - 1) * 60}ms"
					>
						<div
							class="mx-0 h-10 rounded-t-xl border-b border-slate-200 bg-slate-200/60 dark:border-slate-700 dark:bg-slate-700/60"
						></div>
						<div class="space-y-2.5 p-3">
							{#each [1, 2, 3] as _}
								<div
									class="h-20 rounded-lg border border-slate-200/60 bg-white/70 dark:border-slate-700/60 dark:bg-slate-800/50"
								></div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else if loadError && ctx.issues.length === 0}
			<!-- Error state -->
			<div class="flex h-full flex-col items-center justify-center gap-3 text-rose-400">
				<svg
					class="h-8 w-8"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
				<p class="text-sm font-medium">{loadError}</p>
				<a href="/Authenticated/issues" class="text-xs text-signal-500 hover:underline"
					>Open full tracker →</a
				>
			</div>
		{:else if ctx.issues.length === 0}
			<!-- Empty state -->
			<div
				class="flex h-full flex-col items-center justify-center gap-3 text-gray-300 dark:text-slate-600"
			>
				<svg
					class="h-10 w-10"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.3"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M9 12h6m-3-3v6" />
					<circle cx="12" cy="12" r="10" />
				</svg>
				<p class="text-sm font-medium text-gray-400 dark:text-slate-500">No issues yet</p>
				<p class="text-xs text-gray-300 dark:text-slate-600">
					Escalate a flagged claim or
					<a href="/Authenticated/issues" class="text-signal-500 hover:underline">
						open the tracker
					</a>
					to create one.
				</p>
			</div>
		{:else if view === 'board'}
			<IssueBoard
				issues={ctx.issues}
				onSelect={ctx.openIssue}
				{totals}
				loadingColumns={pages.loadingColumns}
				onLoadMore={(status) => void pages.loadMore(status)}
			/>
		{:else}
			<div class="flex h-full min-h-0 flex-col">
				<div class="min-h-0 flex-1">
					<IssueTable
						issues={ctx.issues}
						onSelect={ctx.openIssue}
						serverQuery={query}
						total={pages.table?.total}
						onQueryChange={(next) => void changeQuery(next)}
					/>
				</div>
				{#if pages.table}
					<div
						class="flex justify-between gap-3 border-t border-line px-6 py-3 text-sm text-ink-muted"
					>
						<span>Page {pages.table.page} · {pages.table.total} issues</span>
						<div class="flex gap-4">
							{#if pages.table.page > 1}<button
									onclick={() => void changeQuery({ ...query, page: query.page - 1 })}
									>Previous</button
								>{/if}
							{#if pages.table.page * 25 < pages.table.total}<button
									onclick={() => void changeQuery({ ...query, page: query.page + 1 })}>Next</button
								>{/if}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- Slide-over lives outside the card so it can be fixed-position full-screen -->
<IssueSlideOver
	detail={ctx.slideDetail}
	loading={ctx.slideLoading}
	open={ctx.slideOpen}
	staff={ctx.staff}
	onClose={ctx.closeSlideOver}
	onUpdate={handleUpdate}
	onRefetch={refetchDetail}
	userId={null}
	role="analyst"
/>
