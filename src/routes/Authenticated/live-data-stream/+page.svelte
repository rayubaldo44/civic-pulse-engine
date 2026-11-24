<script lang="ts">
	// +page.svelte — Live Data Stream
	// Displays processed_content joined to raw_content.
	// Client-side filtering on the loaded dataset (no extra round-trips).

	import { onMount } from 'svelte';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import type { PageData } from './$types';
	import LineChart from '$lib/components/LineChart.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { formatDateTime } from '$lib/utils/format';
	import type { DateFilterRange, TrendRangeId, TrendResponse } from '$lib/types/sentiment-trends';
	import { normalizeTopic } from '$lib/utils/priority';

	export let data: PageData;

	// ── Types ─────────────────────────────────────────────────────────────────
	// sentiment_label check: 'positive' | 'negative' | 'neutral' | 'review'
	type SentimentLabel = 'positive' | 'negative' | 'neutral' | 'review' | null;

	interface StreamItem {
		id: string;
		cleaned_text: string | null;
		sentiment_label: SentimentLabel;
		sentiment_score: number | null;
		topic_label: string | null;
		is_flagged: boolean;
		language: string | null;
		processed_at: string;
		// FK on processed_content side (many-to-one) → object
		raw_content: {
			source_platform: string | null;
			raw_text: string | null;
			created_at: string | null;
		} | null;
		// FK on flagged_claims side (one-to-many) → array
		flagged_claims: Array<{
			rag_determination: string | null;
			status: string;
		}>;
	}

	// ── Normalise server data ─────────────────────────────────────────────────
	// Guard against Supabase occasionally returning joins as arrays or null.
	// Reactive on purpose: `data` updates after every navigation and polling
	// refresh — a plain const would freeze the feed at its initial value.
	function normalizeStreamItems(items: any[]): StreamItem[] {
		return items.map((item) => ({
			...item,
			raw_content: Array.isArray(item.raw_content)
				? (item.raw_content[0] ?? null)
				: item.raw_content,
			flagged_claims: Array.isArray(item.flagged_claims)
				? item.flagged_claims
				: item.flagged_claims
					? [item.flagged_claims]
					: []
		}));
	}

	$: streamItems = normalizeStreamItems(data.streamItems ?? []);

	// Platform options derive from the loaded window's data — no hardcoded
	// list to fall out of sync with ingestion. (Only reflects platforms
	// present in the current limit-100 window; trend filtering is still
	// whitelist-gated server-side by /api/sentiment-trends.)
	$: platformOptions = [
		'',
		...new Set(
			streamItems.map((i) => i.raw_content?.source_platform).filter((p): p is string => !!p)
		)
	].map((v) => ({
		value: v,
		label: v === '' ? 'All Platforms' : v.charAt(0).toUpperCase() + v.slice(1)
	}));

	// ── Sentiment Overview (trend chart) ──────────────────────────────────────
	// TrendRangeId / TrendResponse come from $lib/types/sentiment-trends.ts
	// (shared with the server module — single source of truth).

	const RANGE_TABS: { id: TrendRangeId; label: string }[] = [
		{ id: 'live', label: 'Live' },
		{ id: 'weekly', label: 'Weekly' },
		{ id: 'monthly', label: 'Monthly' },
		{ id: 'yearly', label: 'Yearly' }
	];

	const TOPIC_FILTERS = [
		{ value: '', label: 'All Topics' },
		{ value: 'Infrastructure', label: 'Infrastructure' },
		{ value: 'Healthcare', label: 'Healthcare' },
		{ value: 'Waste Management', label: 'Waste Management' },
		{ value: 'Public Safety', label: 'Public Safety' },
		{ value: 'Other', label: 'Other' }
	];

	let trendRange: TrendRangeId = 'weekly';
	let trendTopic = '';
	let trendPlatform = '';
	let trend: TrendResponse | null = null;
	let trendLoading = true;
	let trendError: string | null = null;
	let trendMonthLabel = '';
	let requestSeq = 0;

	// ── Feed refresh (manual button + 60s polling) ───────────────────────────
	let lastRefreshedAt = new Date().toISOString();
	let refreshingFeed = false;

	async function refreshFeed(): Promise<void> {
		if (refreshingFeed) return;
		refreshingFeed = true;
		try {
			// Re-runs only the scoped 'live-stream:feed' load (+page.server.ts).
			await invalidate('live-stream:feed');
			lastRefreshedAt = new Date().toISOString();
		} finally {
			refreshingFeed = false;
		}
	}

	async function loadTrend(): Promise<void> {
		const seq = ++requestSeq;
		trendLoading = true;
		trendError = null;

		try {
			const params = new URLSearchParams({ range: trendRange });
			if (trendTopic) params.set('topic', trendTopic);
			if (trendPlatform) params.set('platform', trendPlatform);

			const res = await fetch(`/api/sentiment-trends?${params.toString()}`);
			if (!res.ok) throw new Error(`Request failed (${res.status})`);

			const payload = (await res.json()) as TrendResponse;
			if (seq !== requestSeq) return;

			trend = payload;
			if (payload.range === 'monthly') {
				trendMonthLabel = new Date(payload.generatedAt).toLocaleDateString('en-PH', {
					month: 'long',
					year: 'numeric'
				});
			}
		} catch (e) {
			if (seq !== requestSeq) return;
			trendError = e instanceof Error ? e.message : 'Failed to load trends';
		} finally {
			if (seq === requestSeq) trendLoading = false;
		}
	}

	function setTrendRange(id: TrendRangeId): void {
		if (trendRange === id) return;
		trendRange = id;
		void loadTrend();
	}

	function retryTrend(): void {
		void loadTrend();
	}

	onMount(() => {
		void loadTrend();
		// Auto-refresh: scoped invalidation keeps the poll lightweight.
		const pollTimer = setInterval(() => void refreshFeed(), 60_000);
		return () => clearInterval(pollTimer);
	});

	// Subtitle describing the active aggregation bucket
	$: trendSubtitle =
		trendRange === 'live'
			? 'Hourly breakdown — last 12 hours'
			: trendRange === 'weekly'
				? 'Daily breakdown — last 28 days'
				: trendRange === 'monthly'
					? `Daily breakdown — ${trendMonthLabel || 'current month'}`
					: 'Monthly breakdown — last 12 months';

	// ── Feed date filter ─────────────────────────────────────────────────────
	// DateFilterRange comes from $lib/types/sentiment-trends.ts (shared with
	// the server module). The URL is the source of truth: +page.server.ts
	// validates params and narrows the query; this component syncs its local
	// state from `data` after each navigation.
	const DATE_FILTER_TABS: { id: DateFilterRange; label: string }[] = [
		{ id: 'all', label: 'All' },
		{ id: 'weekly', label: 'Weekly' },
		{ id: 'monthly', label: 'Monthly' },
		{ id: 'yearly', label: 'Yearly' },
		{ id: 'custom', label: 'Custom' }
	];

	let dateRange: DateFilterRange = data.appliedRange ?? 'all';
	let dateFrom = data.appliedFrom ?? '';
	let dateTo = data.appliedTo ?? '';

	// Keep local state in sync when the URL changes out-of-band
	// (browser back/forward, cleared via goto).
	$: if (data.appliedRange !== dateRange) dateRange = data.appliedRange ?? 'all';
	$: if ((data.appliedFrom ?? '') !== dateFrom) dateFrom = data.appliedFrom ?? '';
	$: if ((data.appliedTo ?? '') !== dateTo) dateTo = data.appliedTo ?? '';

	async function applyDateFilter(next?: {
		range?: DateFilterRange;
		from?: string;
		to?: string;
	}): Promise<void> {
		const range = next?.range ?? dateRange;
		const from = next?.from ?? dateFrom;
		const to = next?.to ?? dateTo;

		const params = new URLSearchParams();
		if (range !== 'all') {
			params.set('range', range);
			if (range === 'custom' && from && to) {
				params.set('from', from);
				params.set('to', to);
			}
		}

		const qs = params.toString();
		await goto(qs ? `${page.url.pathname}?${qs}` : page.url.pathname, {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	}

	function setDateRange(id: DateFilterRange): void {
		if (id === dateRange) return;
		// Always navigate — even to bare ?range=custom before dates are picked
		// (server treats missing from/to as "all"). Keeping the URL as source of
		// truth prevents polling refreshes from snapping the pickers shut.
		void applyDateFilter({ range: id });
	}

	function onCustomDateChange(): void {
		if (dateFrom && dateTo) void applyDateFilter({ from: dateFrom, to: dateTo });
	}

	let searchTerm = '';
	let feedTopic = '';
	let filterPositive = true;
	let filterNeutral = true;
	let filterNegative = true;
	let flaggedOnly = false;
	let dropdownOpen = false;

	// ── Derived: filtered list ────────────────────────────────────────────────
	$: filteredItems = streamItems.filter((item) => {
		const q = searchTerm.toLowerCase().trim();

		// Search across cleaned text, topic, and platform
		const matchesSearch =
			q === '' ||
			(item.cleaned_text ?? '').toLowerCase().includes(q) ||
			(item.topic_label ?? '').toLowerCase().includes(q) ||
			(item.raw_content?.source_platform ?? '').toLowerCase().includes(q);

		// Topic filter — route raw labels through normalizeTopic because NLP
		// emits compound variants ("Infrastructure and Public Works"); exact
		// === on canonical values would match almost nothing. Same semantics
		// as the server-side filter in /api/sentiment-trends.
		const matchesTopic = !feedTopic || normalizeTopic(item.topic_label) === feedTopic;

		// Sentiment filter: 'review' is treated as neutral in the filter
		const sentimentKey = item.sentiment_label === 'review' ? 'neutral' : item.sentiment_label;
		const matchesSentiment =
			(filterPositive && sentimentKey === 'positive') ||
			(filterNeutral && (sentimentKey === 'neutral' || sentimentKey === null)) ||
			(filterNegative && sentimentKey === 'negative');

		const matchesFlagged = flaggedOnly ? item.is_flagged : true;

		return matchesSearch && matchesTopic && matchesSentiment && matchesFlagged;
	});

	$: hasActiveFilters =
		feedTopic !== '' ||
		flaggedOnly ||
		!filterPositive ||
		!filterNeutral ||
		!filterNegative ||
		dateRange !== 'all';

	// ── Style helpers ─────────────────────────────────────────────────────────
	function getSentimentColor(s: SentimentLabel): string {
		switch (s) {
			case 'positive':
				return 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20';
			case 'negative':
				return 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
			// 'review' and 'neutral' both render as neutral
			default:
				return 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700';
		}
	}

	function sentimentLabel(s: SentimentLabel): string {
		if (s === 'review') return 'Needs Review';
		if (!s) return 'Unknown';
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	// ── Filter helpers ────────────────────────────────────────────────────────
	async function clearFilters() {
		searchTerm = '';
		feedTopic = '';
		filterPositive = true;
		filterNeutral = true;
		filterNegative = true;
		flaggedOnly = false;
		dateFrom = '';
		dateTo = '';
		if (dateRange !== 'all') {
			await goto(page.url.pathname, { keepFocus: true, noScroll: true, replaceState: true });
		}
	}

	function handleWindowClick(e: MouseEvent) {
		if (!(e.target as HTMLElement).closest('.dropdown-root')) dropdownOpen = false;
	}
	function handleWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') dropdownOpen = false;
	}
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleWindowKeydown} />

<div class="animate-fade-in mx-auto max-w-7xl p-8">
	<!-- Header -->
	<div class="mb-8 shrink-0">
		<PageHeader
			icon="stream"
			title="Live Data Stream"
			subtitle={`Real-time feed from public civic channels · ${streamItems.length} records loaded`}
		>
			{#snippet right()}
				<div class="flex items-center gap-3">
					<span class="flex items-center gap-2">
						<span class="pulse-dot h-3 w-3 bg-emerald-500" aria-hidden="true"></span>
						<span class="telemetry text-emerald-600 dark:text-emerald-400">
							auto-refresh 60s · updated {formatDateTime(lastRefreshedAt)}
						</span>
					</span>
					<button
						type="button"
						on:click={() => void refreshFeed()}
						disabled={refreshingFeed}
						class="btn-secondary px-3 py-2 text-xs"
					>
						{refreshingFeed ? 'Refreshing…' : 'Refresh'}
					</button>
				</div>
			{/snippet}
		</PageHeader>
	</div>

	<!-- Real-Time Sentiment Overview -->
	<div class="card card-pad mb-6 shrink-0">
		<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
			<div>
				<h3 class="text-lg font-semibold text-gray-900 dark:text-slate-100">
					Real-Time Sentiment Overview
				</h3>
				<p class="text-sm text-gray-500 dark:text-slate-400">{trendSubtitle}</p>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<!-- Time-range toggle -->
				<div class="segmented" role="group">
					{#each RANGE_TABS as tab (tab.id)}
						<button
							type="button"
							aria-pressed={trendRange === tab.id}
							on:click={() => setTrendRange(tab.id)}
							class="rounded-md px-3 py-1.5 text-xs font-medium transition-all
								{trendRange === tab.id
								? 'bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-slate-200'
								: 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}"
						>
							{tab.label}
						</button>
					{/each}
				</div>

				<select
					aria-label="Filter by topic"
					bind:value={trendTopic}
					on:change={loadTrend}
					class="input w-auto px-2.5 py-1.5 text-xs [&_option]:bg-surface dark:[&_option]:bg-slate-800"
				>
					{#each TOPIC_FILTERS as t (t.value)}
						<option value={t.value}>{t.label}</option>
					{/each}
				</select>

				<select
					aria-label="Filter by platform"
					bind:value={trendPlatform}
					on:change={loadTrend}
					class="input w-auto px-2.5 py-1.5 text-xs [&_option]:bg-surface dark:[&_option]:bg-slate-800"
				>
					{#each platformOptions as p (p.value)}
						<option value={p.value}>{p.label}</option>
					{/each}
				</select>
			</div>
		</div>

		{#if trendLoading}
			<div
				class="h-64 animate-pulse rounded-lg border border-gray-100 bg-gray-50 dark:border-slate-800 dark:bg-slate-800/60"
				aria-hidden="true"
			></div>
		{:else if trendError}
			<div class="flex h-64 flex-col items-center justify-center gap-3 text-rose-400">
				<svg
					class="h-8 w-8"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="10" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01" />
				</svg>
				<p class="text-sm font-medium">{trendError}</p>
				<button
					type="button"
					on:click={retryTrend}
					class="text-xs font-medium text-signal-500 transition-colors hover:text-signal-600"
				>
					Retry
				</button>
			</div>
		{:else if !trend || trend.mode === 'empty'}
			<div
				class="flex h-64 flex-col items-center justify-center gap-3 text-gray-300 dark:text-slate-600"
			>
				<svg
					class="h-10 w-10"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.5"
						d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
					/>
				</svg>
				<p class="text-sm font-medium">No sentiment data in this period</p>
				<p class="text-xs">Processed comments will chart here as they arrive.</p>
			</div>
		{:else if trend}
			<LineChart
				labels={trend.labels}
				positive={trend.positive}
				negative={trend.negative}
				neutral={trend.neutral}
			/>
		{/if}
	</div>

	<!-- Search + Filters -->
	<div class="mb-6 flex flex-wrap items-center gap-4">
		<!-- Search -->
		<div class="relative min-w-0 flex-1">
			<svg
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				viewBox="0 0 24 24"
				aria-hidden="true"
			>
				<circle cx="11" cy="11" r="8" />
				<path d="m21 21-4.35-4.35" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
			<input
				type="search"
				placeholder="Search text, topic, platform..."
				bind:value={searchTerm}
				class="input rounded-xl py-2.5 pr-4 pl-10"
			/>
		</div>

		<!-- Feed topic filter (client-side over the loaded window) -->
		<select
			aria-label="Filter feed by topic"
			bind:value={feedTopic}
			class="input shrink-0 rounded-xl px-3 py-2.5 [&_option]:bg-surface dark:[&_option]:bg-slate-800"
		>
			{#each TOPIC_FILTERS as t (t.value)}
				<option value={t.value}>{t.label}</option>
			{/each}
		</select>

		<!-- Date range pills -->
		<div class="flex shrink-0 items-center gap-1.5" role="group">
			{#each DATE_FILTER_TABS as tab (tab.id)}
				<button
					type="button"
					aria-pressed={dateRange === tab.id}
					on:click={() => setDateRange(tab.id)}
					class="rounded-lg border px-3 py-2 text-xs font-medium transition-all
						{dateRange === tab.id
						? 'border-signal-200 bg-signal-50 text-signal-700 shadow-sm dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400'
						: 'border-line bg-surface text-ink-muted hover:bg-gray-50 hover:text-ink dark:border-slate-700 dark:bg-surface dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'}"
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<!-- Custom date inputs -->
		{#if dateRange === 'custom'}
			<div class="flex shrink-0 items-center gap-2" role="group" aria-label="Custom date range">
				<label class="flex items-center gap-1.5">
					<span class="micro-label">From</span>
					<input
						type="date"
						bind:value={dateFrom}
						on:change={onCustomDateChange}
						class="input px-2.5 py-2 dark:[&::-webkit-calendar-picker-indicator]:invert"
					/>
				</label>
				<span class="text-xs text-ink-faint">—</span>
				<label class="flex items-center gap-1.5">
					<span class="micro-label">To</span>
					<input
						type="date"
						bind:value={dateTo}
						on:change={onCustomDateChange}
						class="input px-2.5 py-2 dark:[&::-webkit-calendar-picker-indicator]:invert"
					/>
				</label>
			</div>
		{/if}

		<!-- Filter dropdown -->
		<div class="dropdown-root relative">
			<button
				type="button"
				aria-haspopup="true"
				aria-expanded={dropdownOpen}
				on:click|stopPropagation={() => (dropdownOpen = !dropdownOpen)}
				class="btn-secondary rounded-xl px-4 py-2.5"
			>
				<svg
					class="h-4 w-4"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<polygon
						points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				Filters
				{#if hasActiveFilters}
					<span
						class="ml-1 inline-flex items-center rounded bg-signal-600 px-1.5 py-0.5 text-[11px] leading-none font-bold text-white"
					>
						Active
					</span>
				{/if}
			</button>

			{#if dropdownOpen}
				<div
					role="menu"
					class="absolute top-full right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg"
				>
					<!-- Sentiment filters -->
					<label
						class="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-ink-muted transition-colors select-none hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
					>
						<input
							type="checkbox"
							bind:checked={filterPositive}
							on:mousedown|preventDefault
							class="h-3.5 w-3.5 rounded border-line accent-signal-600 dark:border-slate-600 dark:accent-signal-500"
						/>
						Positive Sentiment
					</label>
					<label
						class="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-ink-muted transition-colors select-none hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
					>
						<input
							type="checkbox"
							bind:checked={filterNeutral}
							on:mousedown|preventDefault
							class="h-3.5 w-3.5 rounded border-line accent-signal-600 dark:border-slate-600 dark:accent-signal-500"
						/>
						Neutral Sentiment
					</label>
					<label
						class="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-ink-muted transition-colors select-none hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
					>
						<input
							type="checkbox"
							bind:checked={filterNegative}
							on:mousedown|preventDefault
							class="h-3.5 w-3.5 rounded border-line accent-signal-600 dark:border-slate-600 dark:accent-signal-500"
						/>
						Negative Sentiment
					</label>

					<div class="mx-2 my-1 h-px bg-line" role="separator"></div>

					<label
						class="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-ink-muted transition-colors select-none hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
					>
						<input
							type="checkbox"
							bind:checked={flaggedOnly}
							on:mousedown|preventDefault
							class="h-3.5 w-3.5 rounded border-line accent-signal-600 dark:border-slate-600 dark:accent-signal-500"
						/>
						Show Flagged Only
					</label>
				</div>
			{/if}
		</div>
	</div>

	<!-- Load-error banner -->
	{#if data.loadError}
		<div
			class="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-5 py-3 dark:border-rose-500/20 dark:bg-rose-500/10"
			role="alert"
		>
			<p class="text-sm font-medium text-rose-700 dark:text-rose-400">{data.loadError}</p>
		</div>
	{/if}

	<!-- Feed -->
	<div class="relative rounded-xl border border-line bg-surface/70 backdrop-blur-sm">
		<div class="space-y-4 p-6">
			{#if filteredItems.length === 0}
				<div class="flex flex-col items-center py-12 text-center text-gray-400 dark:text-slate-400">
					<svg
						class="mb-3 h-8 w-8 opacity-20"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<polygon
							points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<p class="text-sm">No results match your filters.</p>
					<button
						type="button"
						on:click={clearFilters}
						class="mt-1 text-sm text-signal-500 underline underline-offset-2 transition-colors hover:text-signal-700 dark:text-signal-400 dark:hover:text-signal-300"
					>
						Clear filters
					</button>
				</div>
			{:else}
				{#each filteredItems as item (item.id)}
					<div
						class="overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition-all duration-300 hover:shadow-md
					{item.is_flagged ? 'border-rose-200 shadow-rose-50 dark:border-rose-500/20' : ''}"
					>
						<div class="p-5">
							<div class="flex items-start justify-between gap-4">
								<!-- Left: meta + content -->
								<div class="flex-1">
									<div class="mb-3 flex flex-wrap items-center gap-3">
										<!-- Platform badge -->
										{#if item.raw_content?.source_platform}
											<span
												class="inline-flex items-center rounded-md border border-line bg-gray-100 px-2 py-0.5 text-xs font-medium text-ink-muted capitalize"
											>
												{item.raw_content.source_platform}
											</span>
										{/if}
										<!-- Timestamp -->
										<span class="telemetry">
											{formatDateTime(item.processed_at)}
										</span>
										<!-- Language -->
										{#if item.language}
											<span
												class="inline-flex items-center rounded border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold tracking-wider text-ink-muted uppercase"
											>
												{item.language}
											</span>
										{/if}
									</div>

									<!-- Anonymized comment text -->
									<p class="text-base leading-relaxed text-ink">
										{item.cleaned_text ?? item.raw_content?.raw_text ?? '—'}
									</p>

									<!-- Flagged alert — shows RAG determination if available -->
									{#if item.is_flagged}
										{@const flagClaim = item.flagged_claims[0]}
										<div
											class="mt-4 flex gap-3 rounded-md border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/20 dark:bg-rose-500/10"
											role="alert"
										>
											<svg
												class="mt-0.5 h-5 w-5 shrink-0 text-rose-500"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												viewBox="0 0 24 24"
												aria-hidden="true"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
												/>
											</svg>
											<div>
												<p class="text-sm font-medium text-rose-600 dark:text-rose-400">
													Auto-flagged for potential misinformation
												</p>
												{#if flagClaim?.rag_determination}
													<p class="mt-0.5 text-xs text-ink-muted">
														RAG: <span class="font-medium">{flagClaim.rag_determination}</span>
														· Status: <span class="font-medium">{flagClaim.status}</span>
													</p>
												{/if}
											</div>
										</div>
									{/if}
								</div>

								<!-- Right: sentiment + topic -->
								<div class="flex w-36 shrink-0 flex-col items-end gap-2">
									<!-- Sentiment badge -->
									<span
										class="w-full rounded-lg border px-3 py-1.5 text-center text-xs font-semibold {getSentimentColor(
											item.sentiment_label
										)}"
									>
										{sentimentLabel(item.sentiment_label)}
									</span>

									<!-- Topic badge -->
									{#if item.topic_label}
										<span
											class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-signal-100 bg-signal-50 px-3 py-1.5 text-center text-xs font-medium text-signal-600 dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400"
										>
											<svg
												class="h-3 w-3 shrink-0"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												viewBox="0 0 24 24"
												aria-hidden="true"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
												/>
											</svg>
											<span class="truncate">{item.topic_label}</span>
										</span>
									{/if}

									<!-- Confidence score -->
									{#if item.sentiment_score !== null}
										<span class="telemetry text-[11px]">
											{(item.sentiment_score * 100).toFixed(0)}% confidence
										</span>
									{/if}
								</div>
							</div>
						</div>
					</div>
				{/each}

				<!-- Bottom indicator -->
				<div class="flex justify-center py-6">
					<div
						class="inline-flex items-center gap-2 rounded-full border border-dashed border-line bg-surface/60 px-5 py-2 text-sm text-ink-muted tabular-nums"
					>
						<svg
							class="h-4 w-4"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
						</svg>
						Showing {filteredItems.length} of {streamItems.length} records{dateRange !== 'all'
							? ' in date range'
							: ''} · auto-refreshes every minute
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
