<script lang="ts">
	import type { Issue, IssueStatus } from '$lib/types/issues';
	import { priorityBadge } from '$lib/utils/badges';

	interface Props {
		issues: Issue[];
		onSelect: (issue: Issue) => void;
		totals?: Partial<Record<IssueStatus, number>>;
		loadingColumns?: Partial<Record<IssueStatus, boolean>>;
		onLoadMore?: (status: IssueStatus) => void;
	}

	let { issues, onSelect, totals, loadingColumns = {}, onLoadMore }: Props = $props();

	const COLUMNS: { status: IssueStatus; label: string; accent: string }[] = [
		{ status: 'Open', label: 'Open', accent: 'border-signal-400' },
		{ status: 'In Progress', label: 'In Progress', accent: 'border-amber-400' },
		{ status: 'Under Review', label: 'Under Review', accent: 'border-slate-400' },
		{ status: 'Resolved', label: 'Resolved', accent: 'border-emerald-400' },
		{ status: 'Closed', label: 'Closed', accent: 'border-slate-400' }
	];

	function byStatus(status: IssueStatus): Issue[] {
		return issues.filter((i) => i.status === status);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	function initials(name: string | null): string {
		if (!name) return '—';
		return name
			.split(' ')
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	function timeAgo(iso: string): string {
		const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
		if (secs < 60) return `${secs}s ago`;
		const mins = Math.floor(secs / 60);
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}
</script>

<div class="h-full overflow-x-auto">
	<div class="grid h-full min-w-[1125px] grid-cols-5 gap-4 p-6">
		{#each COLUMNS as col}
			{@const cards = byStatus(col.status)}

			<div
				class="flex flex-col overflow-hidden rounded-xl border border-line bg-gray-100/70 dark:border-slate-700 dark:bg-slate-800/40"
			>
				<!-- Column header -->
				<div class="flex items-center justify-between border-b-2 {col.accent} bg-surface px-4 py-3">
					<span class="text-sm font-semibold text-ink">{col.label}</span>
					<span
						class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500 tabular-nums dark:bg-slate-800 dark:text-slate-400"
					>
						{totals?.[col.status] ?? cards.length}
					</span>
				</div>

				<!-- Cards -->
				<div class="flex-1 space-y-2.5 overflow-y-auto p-3">
					{#each cards as issue (issue.id)}
						<button
							type="button"
							onclick={() => onSelect(issue)}
							class="w-full rounded-lg border border-line bg-surface p-3.5 text-left shadow-sm transition-all
							       duration-150 hover:-translate-y-0.5 hover:border-gray-300
							       hover:shadow-md focus-visible:ring-2 focus-visible:ring-signal-400/40 focus-visible:outline-none
							       dark:border-slate-700 dark:hover:border-slate-600"
						>
							<!-- Priority + topic row -->
							<div class="mb-2 flex flex-wrap items-center gap-1.5">
								<span
									class="inline-flex items-center rounded border px-1.5 py-0.5
								             text-[11px] font-bold tracking-wide uppercase
								             {priorityBadge(issue.priority)}"
								>
									{issue.priority}
								</span>
								{#if issue.topic}
									<span
										class="inline-flex items-center rounded border border-signal-100 bg-signal-50
								             px-1.5 py-0.5 text-[11px] font-medium text-signal-600 dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400"
									>
										{issue.topic}
									</span>
								{/if}
							</div>

							<!-- Title -->
							<p class="mb-3 line-clamp-2 text-sm leading-snug font-medium text-ink">
								{issue.title}
							</p>

							<!-- Footer: assignee avatar + time -->
							<div class="flex items-center justify-between">
								<div
									class="flex h-6 w-6 items-center justify-center rounded-full
								            bg-slate-200 text-[11px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300"
									title={issue.assignee?.full_name ?? 'Unassigned'}
								>
									{initials(issue.assignee?.full_name ?? null)}
								</div>
								<span class="text-[11px] text-slate-400 dark:text-slate-500"
									>{timeAgo(issue.created_at)}</span
								>
							</div>
						</button>
					{:else}
						<div
							class="flex flex-col items-center justify-center py-10 text-slate-300 dark:text-slate-600"
						>
							<svg class="mb-2 h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="1.5"
									d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
								/>
							</svg>
							<span class="text-xs">No issues</span>
						</div>
					{/each}
					{#if onLoadMore && cards.length < (totals?.[col.status] ?? 0)}
						<button
							type="button"
							class="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-muted hover:text-ink disabled:opacity-50"
							aria-label={`Load more ${col.status} issues`}
							disabled={loadingColumns[col.status]}
							onclick={() => onLoadMore?.(col.status)}
						>
							{loadingColumns[col.status] ? 'Loading…' : 'Load more'}
						</button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
