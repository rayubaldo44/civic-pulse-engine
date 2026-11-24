<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { startSummaryPolling } from '$lib/utils/summary-polling';
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import LineChart from '$lib/components/LineChart.svelte';
	import DonutChart from '$lib/components/DonutChart.svelte';
	import IssuePrioritization from '$lib/components/IssuePrioritization.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import { ragBadgeClass, sentimentDot } from '$lib/utils/badges';
	import { formatDateTime } from '$lib/utils/format';

	export let data: PageData;
	onMount(() =>
		startSummaryPolling(
			() => data.summaryFetchedAt,
			() => invalidate('dashboard:summary')
		)
	);

	// Pending flagged-claims count comes from the /Authenticated layout server
	// load (already computed for the sidebar badge) — avoids a duplicate query.
	// Reactive ($:) so the stat card tracks changes; reading it eagerly inside a
	// plain const would freeze at the initial (undefined) value → "undefined".
	$: pendingCount = ($page.data?.pendingCount as number) ?? 0;

	// ── Bottom-section tabs ─────────────────────────────────────────────────
	let activeTab: 'heatmap' | 'prioritization' | 'tracker' = 'prioritization';

	const dashboardTabs = [
		{ id: 'heatmap', label: 'Barangay Heatmap' },
		{ id: 'prioritization', label: 'Issue Prioritization' },
		{ id: 'tracker', label: 'Issue Tracker' }
	] as const;

	// ── Streamed section shapes (top-level promises from the server load) ───
	type StatData = Awaited<PageData['statData']>;
	type ChartsData = Awaited<PageData['charts']>;

	// ── Stat cards ────────────────────────────────────────────────────────────
	// Built from the resolved statData stream. The Flagged Claims card re-reads
	// pendingCount live in the markup below so it keeps tracking the layout.
	function buildStats(sd: StatData, pending: number) {
		const total = sd.totalCount;
		const positive = sd.sentimentCounts['positive'] ?? 0;
		const positiveRate = total > 0 ? Math.round((positive / total) * 100) : 0;

		return [
			{
				label: 'Total Analyzed',
				value: total.toLocaleString(),
				sub: 'All-time processed comments',
				subColor: 'text-emerald-500',
				icon: 'users'
			},
			{
				label: 'Flagged Claims',
				value: String(pending),
				sub: pending === 0 ? 'Queue is clear' : 'Awaiting LGU review',
				subColor: pending > 0 ? 'text-rose-500' : 'text-emerald-500',
				icon: 'alert'
			},
			{
				label: 'Auto-Confidence',
				value: total > 0 ? `${sd.accuracyPct}%` : '—',
				sub: 'Est. from low-confidence flags',
				subColor: 'text-gray-400',
				icon: 'brain'
			},
			{
				label: 'Verified Accuracy',
				value: sd.verifiedAccuracy ? `${sd.verifiedAccuracy.agreementPct}%` : '—',
				sub: sd.verifiedAccuracy
					? `${sd.verifiedAccuracy.reviewed} human-reviewed claims`
					: 'No human reviews yet',
				subColor: 'text-gray-400',
				icon: 'shield'
			},
			{
				label: 'Positive Rate',
				value: total > 0 ? `${positiveRate}%` : '—',
				sub: `${positive.toLocaleString()} positive comments`,
				subColor: 'text-emerald-500',
				icon: 'activity'
			}
		];
	}

	// ── Sentiment breakdown rows ──────────────────────────────────────────────
	function buildSentimentRows(sd: StatData) {
		return [
			{ key: 'positive', label: 'Positive', bar: 'bg-emerald-400', text: 'text-emerald-600' },
			{ key: 'negative', label: 'Negative', bar: 'bg-rose-400', text: 'text-rose-600' },
			{ key: 'neutral', label: 'Neutral', bar: 'bg-slate-300', text: 'text-slate-500' },
			{ key: 'review', label: 'Needs Review', bar: 'bg-amber-300', text: 'text-amber-600' }
		].filter((r) => (sd.sentimentCounts[r.key] ?? 0) > 0);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	// Supabase returns the FK join as a single object (not array).
	// Safely extract topic and sentiment from the joined row.
	function getJoinedField(
		claim: Awaited<PageData['flaggedClaims']>[number],
		field: 'topic_label' | 'sentiment_label'
	): string | null {
		const pc = claim.processed_content;
		// Supabase v2 FK join returns object | null — never an array for many-to-one
		if (!pc || typeof pc !== 'object' || Array.isArray(pc)) return null;
		return (pc as Record<string, string | null>)[field] ?? null;
	}
</script>

<div class="animate-fade-in mx-auto max-w-7xl space-y-8 p-8">
	<!-- ── Page Header ─────────────────────────────────────────────────────── -->
	<PageHeader
		icon="dashboard"
		title="Intelligence Overview"
		subtitle="Real-time analysis of public sentiment and feedback across Pulilan."
	>
		{#snippet right()}
			{#await data.statData}
				<span class="telemetry animate-pulse text-slate-300 tabular-nums dark:text-slate-700"
					># ⠀</span
				>
			{:then statData}
				<span class="telemetry tabular-nums"
					># {statData.totalCount.toLocaleString()} processed · all-time</span
				>
			{/await}
		{/snippet}
	</PageHeader>

	<!-- ── Stat Cards ──────────────────────────────────────────────────────── -->
	{#await data.statData}
		<div role="status" aria-live="polite" class="grid grid-cols-1 gap-6 lg:grid-cols-3">
			<span class="sr-only">Loading dashboard metrics</span>
			<!-- Featured metric placeholder -->
			<div class="card card-pad animate-pulse lg:col-span-1">
				<div class="flex items-center justify-between pb-2">
					<div class="h-3 w-24 rounded bg-slate-100 dark:bg-slate-800/60"></div>
					<div class="h-4 w-4 rounded bg-slate-100 dark:bg-slate-800/60"></div>
				</div>
				<div class="h-12 w-32 rounded bg-slate-100 dark:bg-slate-800/60"></div>
				<div class="mt-2 h-3 w-32 rounded bg-slate-100 dark:bg-slate-800/60"></div>
			</div>
			<!-- Grouped metrics placeholder (2×2) -->
			<div class="grid grid-cols-2 gap-6 lg:col-span-2">
				{#each [0, 1, 2, 3] as i (i)}
					<div class="card card-pad animate-pulse" style="animation-delay: {i * 80}ms">
						<div class="flex items-center justify-between pb-2">
							<div class="h-3 w-24 rounded bg-slate-100 dark:bg-slate-800/60"></div>
							<div class="h-4 w-4 rounded bg-slate-100 dark:bg-slate-800/60"></div>
						</div>
						<div class="h-8 w-28 rounded bg-slate-100 dark:bg-slate-800/60"></div>
						<div class="mt-2 h-3 w-32 rounded bg-slate-100 dark:bg-slate-800/60"></div>
					</div>
				{/each}
			</div>
		</div>
	{:then statData}
		{@const stats = buildStats(statData, pendingCount)}
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
			<!-- Featured metric (most important) — stretches to match the 2×2 group -->
			<StatCard stat={stats[0]} pending={pendingCount} featured delay={0} />
			<!-- Grouped metrics (2×2) -->
			<div class="grid grid-cols-2 gap-6 lg:col-span-2">
				{#each stats.slice(1) as stat, i}
					<StatCard {stat} pending={pendingCount} delay={Math.min(i + 1, 3) * 60} />
				{/each}
			</div>
		</div>
	{/await}

	<!-- ── Charts Row ──────────────────────────────────────────────────────── -->
	{#await data.charts}
		<div role="status" aria-live="polite" class="grid grid-cols-1 gap-6 lg:grid-cols-3">
			<span class="sr-only">Loading charts</span>
			<!-- Trend chart placeholder -->
			<div class="card card-pad col-span-1 animate-pulse lg:col-span-2">
				<div class="mb-6 flex items-center justify-between">
					<div class="space-y-2">
						<div class="h-5 w-40 rounded bg-slate-100 dark:bg-slate-800/60"></div>
						<div class="h-4 w-56 rounded bg-slate-100 dark:bg-slate-800/60"></div>
					</div>
					<div class="h-3 w-24 rounded bg-slate-100 dark:bg-slate-800/60"></div>
				</div>
				<div class="h-56 rounded-lg bg-slate-100 dark:bg-slate-800/60"></div>
			</div>
			<!-- Donut chart placeholder -->
			<div class="card card-pad col-span-1 animate-pulse">
				<div class="mb-4 space-y-2">
					<div class="h-4 w-32 rounded bg-slate-100 dark:bg-slate-800/60"></div>
					<div class="h-3 w-44 rounded bg-slate-100 dark:bg-slate-800/60"></div>
				</div>
				<div class="mx-auto h-40 w-40 rounded-full bg-slate-100 dark:bg-slate-800/60"></div>
				<div class="mt-6 space-y-2">
					{#each [0, 1, 2] as i (i)}
						<div class="flex items-center gap-2">
							<div class="h-2 w-2 rounded-full bg-slate-100 dark:bg-slate-800/60"></div>
							<div class="h-2 flex-1 rounded bg-slate-100 dark:bg-slate-800/60"></div>
							<div class="h-2 w-10 rounded bg-slate-100 dark:bg-slate-800/60"></div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{:then chartsData}
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
			<!-- Sentiment Trend — Line Chart (2/3 width) -->
			<div class="card card-pad col-span-1 lg:col-span-2">
				<div class="mb-6 flex items-center justify-between">
					<div>
						<h3 class="text-lg font-semibold text-gray-900 dark:text-slate-100">
							Sentiment Trends
						</h3>
						<p class="text-sm text-gray-500 dark:text-slate-400">
							{chartsData.trendData.mode === 'daily'
								? 'Daily breakdown — last 7 days'
								: 'Hourly breakdown — last 12 hours'}
						</p>
					</div>
					<span class="telemetry">
						updated {new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })} PHT
					</span>
				</div>

				{#if chartsData.trendData.mode === 'empty'}
					<!-- Empty state -->
					<div
						class="flex h-64 flex-col items-center justify-center gap-3 text-gray-300 dark:text-slate-600"
					>
						<svg class="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
							/>
						</svg>
						<p class="text-sm font-medium">No activity in the last 7 days</p>
						<p class="text-xs text-gray-200 dark:text-slate-600">
							Trigger the GitHub Actions cron job to ingest comments
						</p>
					</div>
				{:else}
					<LineChart
						labels={chartsData.trendData.labels}
						positive={chartsData.trendData.positive}
						negative={chartsData.trendData.negative}
						neutral={chartsData.trendData.neutral}
					/>
				{/if}
			</div>

			<!-- Topic Distribution — Doughnut Chart (1/3 width) -->
			<div class="card card-pad col-span-1">
				<div class="mb-4">
					<h3 class="text-base font-semibold text-gray-900 dark:text-slate-100">
						Topic Distribution
					</h3>
					<p class="text-sm text-gray-500 dark:text-slate-400">
						{chartsData.totalCount.toLocaleString()} total comments
					</p>
				</div>

				{#if Object.keys(chartsData.topicCounts).length === 0}
					<div
						class="flex h-56 flex-col items-center justify-center gap-3 text-gray-300 dark:text-slate-600"
					>
						<svg class="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.5"
								d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
							/>
						</svg>
						<p class="text-sm">No topic data yet</p>
					</div>
				{:else}
					<DonutChart topicCounts={chartsData.topicCounts} />
				{/if}
			</div>
		</div>
	{/await}

	<!-- ── Sentiment Breakdown Bar ─────────────────────────────────────────── -->
	{#await data.statData}
		<div role="status" aria-live="polite" class="card card-pad">
			<span class="sr-only">Loading sentiment breakdown</span>
			<div class="mb-5 h-5 w-52 animate-pulse rounded bg-slate-100 dark:bg-slate-800/60"></div>
			<div class="space-y-3">
				{#each [0, 1, 2, 3] as i (i)}
					<div class="flex items-center gap-4">
						<div class="h-3 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800/60"></div>
						<div
							class="h-2 flex-1 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800/60"
						></div>
						<div class="h-3 w-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800/60"></div>
					</div>
				{/each}
			</div>
		</div>
	{:then statData}
		{@const totalCount = statData.totalCount}
		{@const sentimentRows = buildSentimentRows(statData)}
		{#if totalCount > 0 && sentimentRows.length > 0}
			<div class="card card-pad">
				<h3 class="mb-5 text-base font-semibold text-gray-900 dark:text-slate-100">
					Overall Sentiment Breakdown
				</h3>
				<div class="space-y-3">
					{#each sentimentRows as row}
						{@const count = statData.sentimentCounts[row.key] ?? 0}
						{@const pct = Math.round((count / totalCount) * 100)}
						<div class="flex items-center gap-4">
							<span class="w-28 shrink-0 text-sm text-gray-600 dark:text-slate-300"
								>{row.label}</span
							>
							<div class="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
								<div
									class="{row.bar} h-2 rounded-full transition-[width] duration-700 ease-out"
									style="width: {pct}%"
								></div>
							</div>
							<span class="w-20 text-right text-sm font-medium {row.text} shrink-0">
								{pct}%
								<span class="text-xs font-normal text-gray-400 dark:text-slate-500">({count})</span>
							</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/await}

	<!-- ── Dashboard Tabs: Heatmap | Prioritization | Tracker ─────────────── -->
	<div class="space-y-4">
		<div class="segmented w-full sm:w-auto">
			{#each dashboardTabs as tab (tab.id)}
				<button
					type="button"
					onclick={() => (activeTab = tab.id)}
					aria-pressed={activeTab === tab.id}
					class="segmented-btn flex-1 sm:flex-none {activeTab === tab.id
						? 'segmented-btn-active'
						: ''}"
				>
					{tab.label}
				</button>
			{/each}
		</div>

		{#if activeTab === 'heatmap'}
			{#await data.barangayStats}
				<div role="status" aria-live="polite" class="card card-pad animate-pulse">
					<span class="sr-only">Loading barangay heatmap</span>
					<div class="mb-4 h-5 w-40 rounded bg-slate-100 dark:bg-slate-800/60"></div>
					<div class="h-64 rounded-lg bg-slate-100 dark:bg-slate-800/60"></div>
				</div>
			{:then stats}
				{#await import('$lib/components/BarangayHeatmap.svelte')}
					<p role="status" class="card card-pad">Loading map…</p>
				{:then module}
					<svelte:component this={module.default} {stats} />
				{:catch}
					<p role="alert" class="card card-pad">
						Could not load the map. <button class="underline" onclick={() => location.reload()}
							>Reload page</button
						>
					</p>
				{/await}
			{/await}
		{:else if activeTab === 'prioritization'}
			<IssuePrioritization />
		{:else}
			{#await import('$lib/components/IssueTracker.svelte')}
				<p role="status" class="card card-pad">Loading issue tracker…</p>
			{:then module}
				<svelte:component this={module.default} />
			{:catch}
				<p role="alert" class="card card-pad">
					Could not load the issue tracker. <button
						class="underline"
						onclick={() => location.reload()}>Reload page</button
					>
				</p>
			{/await}
		{/if}
	</div>

	<!-- ── Priority Flagged Claims ─────────────────────────────────────────── -->
	{#await data.flaggedClaims}
		<div role="status" aria-live="polite" class="card card-pad animate-pulse">
			<span class="sr-only">Loading flagged claims</span>
			<div class="mb-6 flex items-center justify-between">
				<div class="space-y-2">
					<div class="h-5 w-48 rounded bg-slate-100 dark:bg-slate-800/60"></div>
					<div class="h-3 w-64 rounded bg-slate-100 dark:bg-slate-800/60"></div>
				</div>
				<div class="h-6 w-20 rounded-md bg-slate-100 dark:bg-slate-800/60"></div>
			</div>
			<div class="space-y-4">
				{#each [0, 1, 2] as i (i)}
					<div
						class="relative rounded-lg border border-slate-100 bg-slate-50/40 py-4 pr-4 pl-5
						       dark:border-slate-800 dark:bg-slate-800/20"
					>
						<div
							class="absolute top-0 bottom-0 left-0 w-1 rounded-l-lg bg-slate-200 dark:bg-slate-700"
						></div>
						<div class="mb-3 flex items-center gap-2">
							<div class="h-2 w-2 rounded-full bg-slate-200 dark:bg-slate-700"></div>
							<div class="h-5 w-24 rounded bg-slate-100 dark:bg-slate-800/60"></div>
							<div class="h-5 w-28 rounded bg-slate-100 dark:bg-slate-800/60"></div>
						</div>
						<div class="mb-3 h-4 w-3/4 rounded bg-slate-100 dark:bg-slate-800/60"></div>
						<div class="h-14 rounded-md bg-slate-100 dark:bg-slate-800/60"></div>
					</div>
				{/each}
			</div>
		</div>
	{:then flaggedClaims}
		<div class="card card-pad">
			<div class="mb-6 flex items-center justify-between">
				<div>
					<h3
						class="flex items-center gap-2 text-base font-semibold text-rose-600 dark:text-rose-400"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01"
							/>
						</svg>
						Priority Flagged Claims
					</h3>
					<p class="mt-0.5 text-sm text-gray-500 dark:text-slate-400">
						Recently detected claims awaiting LGU verification
					</p>
				</div>

				{#if pendingCount > 0}
					<span
						class="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2.5
						             py-1 text-xs font-medium text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400"
					>
						{pendingCount} Pending
					</span>
				{:else}
					<span
						class="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2.5
						             py-1 text-xs font-medium text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400"
					>
						All Clear
					</span>
				{/if}
			</div>

			{#if flaggedClaims.length === 0}
				<!-- Empty state -->
				<div
					class="flex flex-col items-center justify-center gap-3 py-12 text-gray-300 dark:text-slate-600"
				>
					<svg class="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<p class="text-sm font-medium">No pending flagged claims</p>
					<p class="text-xs text-gray-200 dark:text-slate-600">
						The misinformation review queue is clear
					</p>
				</div>
			{:else}
				<div class="space-y-4">
					{#each flaggedClaims as claim}
						{@const topic = getJoinedField(claim, 'topic_label')}
						{@const sentiment = getJoinedField(claim, 'sentiment_label')}

						<div
							class="relative rounded-lg border border-rose-200/60 bg-rose-50/40 py-4 pr-4
							            pl-5 transition-all duration-200
							            hover:bg-rose-50/70 hover:shadow-sm dark:border-rose-500/20 dark:bg-rose-500/5 dark:hover:bg-rose-500/10"
						>
							<!-- Left accent bar -->
							<div class="absolute top-0 bottom-0 left-0 w-1 rounded-l-lg bg-rose-500"></div>

							<div class="mb-2 flex flex-wrap items-start justify-between gap-2">
								<div class="flex flex-wrap items-center gap-2">
									<!-- Sentiment dot -->
									<span
										class="inline-block h-2 w-2 rounded-full {sentimentDot(sentiment)}
										             mt-0.5 shrink-0"
									></span>

									<!-- Topic badge -->
									{#if topic}
										<span
											class="inline-flex items-center rounded border border-gray-200 bg-white
											             px-2 py-0.5 text-xs font-medium text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
										>
											{topic}
										</span>
									{/if}

									<!-- RAG determination badge -->
									{#if claim.rag_determination}
										<span
											class="inline-flex items-center rounded border px-2 py-0.5
											             text-xs font-medium {ragBadgeClass(claim.rag_determination)}"
										>
											{claim.rag_determination}
										</span>
									{/if}
								</div>

								<span class="shrink-0 text-xs text-gray-400 dark:text-slate-500">
									{formatDateTime(claim.created_at)}
								</span>
							</div>

							<!-- Claim text -->
							<p class="mb-3 text-sm leading-relaxed font-medium text-gray-800 dark:text-slate-200">
								"{claim.claim_text}"
							</p>

							<!-- RAG evidence snippet -->
							{#if claim.rag_evidence_snippet}
								<div
									class="flex items-start gap-3 rounded-md border
									            border-gray-200/60 bg-white/80 p-3 dark:border-slate-700/60 dark:bg-slate-800/80"
								>
									<svg
										class="mt-0.5 h-4 w-4 shrink-0 text-signal-500"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
										/>
									</svg>
									<div>
										<span
											class="text-xs font-semibold tracking-wider text-gray-400 uppercase dark:text-slate-500"
										>
											RAG Evidence
										</span>
										<p class="mt-0.5 line-clamp-2 text-sm text-gray-600 dark:text-slate-400">
											{claim.rag_evidence_snippet}
										</p>
									</div>
								</div>
							{/if}
						</div>
					{/each}

					<!-- Link to full review queue if more than 3 pending -->
					{#if pendingCount > 3}
						<p class="pt-1 text-center text-sm text-gray-400 dark:text-slate-500">
							+{pendingCount - 3} more in the
							<a
								href="/Authenticated/flagged-claims"
								class="font-medium text-rose-500 hover:text-rose-600 hover:underline dark:text-rose-400 dark:hover:text-rose-300"
							>
								full review queue →
							</a>
						</p>
					{/if}
				</div>
			{/if}
		</div>
	{/await}
</div>
