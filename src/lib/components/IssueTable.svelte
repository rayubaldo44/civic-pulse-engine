<script lang="ts">
	import type { Issue, IssueStatus, Priority } from '$lib/types/issues';
	import type { IssueListQuery } from '$lib/types/paged-issues';
	import { priorityBadge } from '$lib/utils/badges';

	interface Props {
		issues: Issue[];
		onSelect: (issue: Issue) => void;
		serverQuery?: IssueListQuery;
		onQueryChange?: (query: IssueListQuery) => void;
		total?: number;
	}

	let { issues, onSelect, serverQuery, onQueryChange, total }: Props = $props();

	// ── Filter state ──────────────────────────────────────────────────────────
	const ALL_STATUSES: IssueStatus[] = ['Open', 'In Progress', 'Under Review', 'Resolved', 'Closed'];
	const ALL_PRIORITIES: Priority[] = ['Critical', 'High', 'Medium', 'Low'];
	const ALL_TOPICS = ['Infrastructure', 'Healthcare', 'Waste Management', 'Public Safety', 'Other'];

	let selStatuses = $state(new Set<IssueStatus>());
	let selPriorities = $state(new Set<Priority>());
	let selTopics = $state(new Set<string>());
	let search = $state('');

	function toggle<T>(set: Set<T>, val: T): Set<T> {
		const next = new Set(set);
		next.has(val) ? next.delete(val) : next.add(val);
		return next;
	}

	// Selected-pill language: signal tint = active, neutral surface = inactive.
	const PILL_ACTIVE =
		'border-signal-200 bg-signal-50 text-signal-700 dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400';
	const PILL_INACTIVE = 'border-line bg-surface text-ink-muted';

	// ── Sort state ────────────────────────────────────────────────────────────
	type SortCol = 'title' | 'topic' | 'priority' | 'status' | 'created_at';
	let sortCol = $state<SortCol>('created_at');
	let sortDir = $state<'asc' | 'desc'>('desc');

	function setSort(col: SortCol) {
		if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortCol = col;
			sortDir = 'asc';
		}
	}

	// Keep controls synchronized on back/forward and server navigation. The
	// paged mode sends filters to the server; it never filters one batch locally.
	$effect(() => {
		if (!serverQuery) return;
		selStatuses = new Set(serverQuery.statuses);
		selPriorities = new Set(serverQuery.priorities);
		selTopics = new Set(serverQuery.topics);
		search = serverQuery.q;
		sortCol = serverQuery.sort;
		sortDir = serverQuery.direction;
	});
	$effect(() => {
		if (!serverQuery || !onQueryChange) return;
		const next: IssueListQuery = {
			...serverQuery,
			page: 1,
			statuses: [...selStatuses],
			priorities: [...selPriorities],
			topics: [...selTopics],
			q: search.trim(),
			sort: sortCol,
			direction: sortDir
		};
		const same =
			JSON.stringify({ ...next, page: 1 }) === JSON.stringify({ ...serverQuery, page: 1 });
		if (same) return;
		const callback = onQueryChange;
		const timer = setTimeout(() => callback(next), 250);
		return () => clearTimeout(timer);
	});
	// ── Derived filtered + sorted rows ────────────────────────────────────────
	const PRIORITY_ORDER: Record<Priority, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

	let rows = $derived.by(() => {
		if (serverQuery) return issues;
		const q = search.trim().toLowerCase();
		let filtered = issues.filter((i) => {
			if (selStatuses.size > 0 && !selStatuses.has(i.status)) return false;
			if (selPriorities.size > 0 && !selPriorities.has(i.priority)) return false;
			if (selTopics.size > 0 && !selTopics.has(i.topic ?? '')) return false;
			if (q && !i.title.toLowerCase().includes(q)) return false;
			return true;
		});

		return filtered.sort((a, b) => {
			let cmp = 0;
			switch (sortCol) {
				case 'title':
					cmp = a.title.localeCompare(b.title);
					break;
				case 'topic':
					cmp = (a.topic ?? '').localeCompare(b.topic ?? '');
					break;
				case 'priority':
					cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
					break;
				case 'status':
					cmp = a.status.localeCompare(b.status);
					break;
				case 'created_at':
					cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
					break;
			}
			return sortDir === 'asc' ? cmp : -cmp;
		});
	});

	// ── Helpers ───────────────────────────────────────────────────────────────
	function shortId(id: string): string {
		return id.slice(0, 8).toUpperCase();
	}

	function statusBadge(s: IssueStatus): string {
		switch (s) {
			case 'Open':
				return 'bg-signal-50 dark:bg-signal-500/10 text-signal-600 dark:text-signal-400';
			case 'In Progress':
				return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400';
			case 'Under Review':
				return 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300';
			case 'Resolved':
				return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
			case 'Closed':
				return 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400';
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-PH', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function sortIcon(col: SortCol): string {
		if (sortCol !== col) return '↕';
		return sortDir === 'asc' ? '↑' : '↓';
	}
</script>

<div class="flex h-full flex-col overflow-hidden">
	<!-- ── Filter Bar ─────────────────────────────────────────────────────────── -->
	<div class="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
		<!-- Search -->
		<input bind:value={search} placeholder="Search by title…" class="input w-48 py-1.5" />

		<!-- Status pills -->
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs font-medium text-slate-400">Status:</span>
			{#each ALL_STATUSES as s}
				<button
					onclick={() => (selStatuses = toggle(selStatuses, s))}
					class="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors select-none {selStatuses.has(
						s
					)
						? PILL_ACTIVE
						: PILL_INACTIVE}"
					aria-pressed={selStatuses.has(s)}>{s}</button
				>
			{/each}
		</div>

		<!-- Priority pills -->
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs font-medium text-slate-400">Priority:</span>
			{#each ALL_PRIORITIES as p}
				<button
					onclick={() => (selPriorities = toggle(selPriorities, p))}
					class="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors select-none {selPriorities.has(
						p
					)
						? PILL_ACTIVE
						: PILL_INACTIVE}"
					aria-pressed={selPriorities.has(p)}>{p}</button
				>
			{/each}
		</div>

		<!-- Topic pills -->
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-xs font-medium text-slate-400">Topic:</span>
			{#each ALL_TOPICS as t}
				<button
					onclick={() => (selTopics = toggle(selTopics, t))}
					class="rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors select-none {selTopics.has(
						t
					)
						? PILL_ACTIVE
						: PILL_INACTIVE}"
					aria-pressed={selTopics.has(t)}>{t}</button
				>
			{/each}
		</div>

		{#if selStatuses.size || selPriorities.size || selTopics.size || search}
			<button
				onclick={() => {
					selStatuses = new Set();
					selPriorities = new Set();
					selTopics = new Set();
					search = '';
				}}
				class="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600"
				>Clear all</button
			>
		{/if}

		<span class="ml-auto text-xs text-slate-400"
			>{total ?? rows.length} issue{(total ?? rows.length) === 1 ? '' : 's'}</span
		>
	</div>

	<!-- ── Table ──────────────────────────────────────────────────────────────── -->
	<div class="flex-1 overflow-auto">
		<table class="w-full text-sm">
			<thead
				class="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"
			>
				<tr
					class="text-left text-xs font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500"
				>
					<th class="w-24 px-5 py-3">ID</th>
					<th class="px-5 py-3">
						<button
							onclick={() => setSort('title')}
							class="flex items-center gap-1 hover:text-slate-600"
						>
							Title <span class="tabular-nums">{sortIcon('title')}</span>
						</button>
					</th>
					<th class="px-5 py-3">
						<button
							onclick={() => setSort('topic')}
							class="flex items-center gap-1 hover:text-slate-600"
						>
							Topic <span>{sortIcon('topic')}</span>
						</button>
					</th>
					<th class="px-5 py-3">
						<button
							onclick={() => setSort('priority')}
							class="flex items-center gap-1 hover:text-slate-600"
						>
							Priority <span>{sortIcon('priority')}</span>
						</button>
					</th>
					<th class="px-5 py-3">
						<button
							onclick={() => setSort('status')}
							class="flex items-center gap-1 hover:text-slate-600"
						>
							Status <span>{sortIcon('status')}</span>
						</button>
					</th>
					<th class="px-5 py-3">Assigned</th>
					<th class="px-5 py-3">
						<button
							onclick={() => setSort('created_at')}
							class="flex items-center gap-1 hover:text-slate-600"
						>
							Created <span>{sortIcon('created_at')}</span>
						</button>
					</th>
					<th class="px-5 py-3 text-right">Actions</th>
				</tr>
			</thead>

			<tbody class="divide-y divide-line bg-surface">
				{#each rows as issue (issue.id)}
					<tr class="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
						<td class="px-5 py-3 font-mono text-xs text-slate-400 dark:text-slate-500"
							>{shortId(issue.id)}</td
						>
						<td class="max-w-xs px-5 py-3">
							<span class="line-clamp-2 font-medium text-slate-800 dark:text-slate-200"
								>{issue.title}</span
							>
						</td>
						<td class="px-5 py-3">
							{#if issue.topic}
								<span
									class="rounded border border-signal-100 bg-signal-50 px-2 py-0.5 text-xs font-medium text-signal-600 dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400"
								>
									{issue.topic}
								</span>
							{:else}
								<span class="text-slate-300 dark:text-slate-600">—</span>
							{/if}
						</td>
						<td class="px-5 py-3">
							<span
								class="rounded border px-2 py-0.5 text-xs font-semibold {priorityBadge(
									issue.priority
								)}"
							>
								{issue.priority}
							</span>
						</td>
						<td class="px-5 py-3">
							<span
								class="rounded-full px-2.5 py-0.5 text-xs font-medium {statusBadge(issue.status)}"
							>
								{issue.status}
							</span>
						</td>
						<td class="px-5 py-3 text-xs text-slate-500 dark:text-slate-400">
							{#if issue.assignee?.full_name}
								{issue.assignee.full_name}
							{:else}
								<span class="text-slate-300 dark:text-slate-600">Unassigned</span>
							{/if}
						</td>
						<td class="px-5 py-3 text-xs whitespace-nowrap text-slate-400 dark:text-slate-500">
							{formatDate(issue.created_at)}
						</td>
						<td class="px-5 py-3">
							<div class="flex items-center justify-end gap-2">
								<button
									onclick={() => onSelect(issue)}
									class="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium
								       text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
								>
									View
								</button>
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td
							colspan="8"
							class="px-5 py-16 text-center text-sm text-slate-400 dark:text-slate-500"
						>
							No issues match the current filters.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
