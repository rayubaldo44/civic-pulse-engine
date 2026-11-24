<script lang="ts">
	import { onMount } from 'svelte';
	import type { TopicPriority } from '$lib/utils/priority';

	interface PrioritiesResponse {
		range: { days: number; since: string };
		generatedAt: string;
		priorities: TopicPriority[];
	}

	const TOPIC_FILTERS = [
		{ value: '', label: 'All Topics' },
		{ value: 'Infrastructure', label: 'Road Repair' },
		{ value: 'Healthcare', label: 'Health Services' },
		{ value: 'Waste Management', label: 'Waste Collection' },
		{ value: 'Public Safety', label: 'Public Safety' },
		{ value: 'Other', label: 'Other' }
	];

	const RANGE_OPTIONS = [7, 30, 90];

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let priorities = $state<TopicPriority[]>([]);
	let rangeDays = $state(30);
	let topicFilter = $state('');
	let updatedAt = $state<string | null>(null);

	let requestSeq = 0;

	async function load(): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		loadError = null;

		try {
			const params = new URLSearchParams();
			if (topicFilter) params.set('topic', topicFilter);
			params.set('days', String(rangeDays));

			const res = await fetch(`/api/priorities?${params.toString()}`);
			if (!res.ok) throw new Error(`Request failed (${res.status})`);

			const data = (await res.json()) as PrioritiesResponse;
			if (seq !== requestSeq) return;

			priorities = data.priorities ?? [];
			updatedAt = data.generatedAt
				? new Date(data.generatedAt).toLocaleTimeString('en-PH', {
						hour: '2-digit',
						minute: '2-digit'
					})
				: null;
		} catch (e) {
			if (seq !== requestSeq) return;
			loadError = e instanceof Error ? e.message : 'Failed to load priorities';
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	function statusBadgeClass(status: TopicPriority['status']): string {
		switch (status) {
			case 'New':
				return 'border-signal-200 dark:border-signal-500/20 bg-signal-50 dark:bg-signal-500/10 text-signal-600 dark:text-signal-400';
			case 'Monitoring':
				return 'border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400';
			case 'Addressed':
				return 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
		}
	}

	// onMount runs client-side only — avoids SSR attempting a relative fetch.
	onMount(() => {
		void load();
	});
</script>

<div class="card">
	<!-- ── Header: Priority Score label + filters ──────────────────────────── -->
	<div
		class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4 dark:border-slate-800"
	>
		<div>
			<h3 class="text-base font-semibold text-ink">Priority Score</h3>
			<p class="mt-0.5 text-xs text-ink-faint">
				Frequency 40% · Negativity 35% · Engagement 25%
				{#if updatedAt}
					<span class="ml-1">· Updated {updatedAt}</span>
				{/if}
			</p>
		</div>

		<div class="flex items-center gap-2">
			<select
				aria-label="Filter by topic"
				bind:value={topicFilter}
				onchange={load}
				class="input w-auto px-2.5 py-1.5 text-xs"
			>
				{#each TOPIC_FILTERS as t (t.value)}
					<option value={t.value}>{t.label}</option>
				{/each}
			</select>

			<select
				aria-label="Time range"
				bind:value={rangeDays}
				onchange={load}
				class="input w-auto px-2.5 py-1.5 text-xs"
			>
				{#each RANGE_OPTIONS as d (d)}
					<option value={d}>Last {d} days</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- ── Ranked list ─────────────────────────────────────────────────────── -->
	<div class="p-6">
		{#if loading}
			<div class="space-y-3">
				{#each [1, 2, 3, 4] as i (i)}
					<div
						class="animate-pulse rounded-lg border border-gray-100 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800/50"
					>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<div class="h-8 w-8 rounded-full bg-gray-200 dark:bg-slate-700"></div>
								<div class="h-4 w-32 rounded bg-gray-200 dark:bg-slate-700"></div>
							</div>
							<div class="w-40 space-y-2">
								<div class="ml-auto h-4 w-16 rounded bg-gray-200 dark:bg-slate-700"></div>
								<div class="h-2 w-full rounded-full bg-gray-200 dark:bg-slate-700"></div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else if loadError}
			<div class="flex flex-col items-center justify-center gap-3 py-12 text-rose-400">
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
				<button
					type="button"
					onclick={load}
					class="text-xs font-medium text-signal-500 transition-colors hover:text-signal-600"
				>
					Retry
				</button>
			</div>
		{:else if priorities.length === 0}
			<div
				class="flex flex-col items-center justify-center gap-3 py-12 text-gray-300 dark:text-slate-600"
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
					<path
						d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
					/>
				</svg>
				<p class="text-sm font-medium text-gray-400 dark:text-slate-500">
					No issue activity in this range
				</p>
				<p class="text-xs text-gray-300 dark:text-slate-600">
					Processed comments will rank topics here as they arrive.
				</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each priorities as p (p.topic)}
					<div
						class="rounded-lg border border-gray-200 bg-white p-4 transition-all duration-200 hover:border-gray-300 hover:shadow-sm
					            dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
					>
						<div class="flex items-start justify-between gap-4">
							<!-- Left: rank badge + category -->
							<div class="flex min-w-0 items-center gap-3">
								<span
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full
									         bg-signal-600 text-sm font-semibold text-white dark:bg-signal-500"
								>
									{p.rank}
								</span>
								<span class="truncate text-sm font-medium text-ink dark:text-slate-200">
									{p.displayName}
								</span>
							</div>

							<!-- Right: status above, score bar + score beneath -->
							<div class="flex w-44 shrink-0 flex-col items-end gap-1.5">
								<span
									class="inline-flex items-center rounded-md border px-2 py-0.5
									             text-[11px] font-medium {statusBadgeClass(p.status)}"
								>
									{p.status}
								</span>

								<div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
									<div
										class="h-2 rounded-full bg-signal-500 transition-[width] duration-700 ease-out"
										style="width: {p.score}%"
									></div>
								</div>

								<span class="text-xs text-gray-500 dark:text-slate-400">Score: {p.score}</span>
							</div>
						</div>
					</div>
				{/each}

				<p class="pt-1 text-center text-xs text-gray-300 dark:text-slate-600">
					Ranked by weighted frequency, sentiment negativity, and engagement over the selected
					window.
				</p>
			</div>
		{/if}
	</div>
</div>
