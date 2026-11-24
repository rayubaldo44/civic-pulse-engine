<script lang="ts">
	// +page.svelte — Flagged Claims Review
	// Real data from +page.server.ts. PATCH calls +server.ts to persist to Supabase.
	// UI updates are optimistic — local state changes immediately, DB call is async.

	import type { PageData } from './$types';
	import { invalidate } from '$app/navigation';
	import Pagination from '$lib/components/Pagination.svelte';
	import { ragBadgeClass } from '$lib/utils/badges';
	import { formatDateTime } from '$lib/utils/format';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Toast from '$lib/components/Toast.svelte';

	export let data: PageData;

	// ── DB types (must match check constraints exactly) ───────────────────────
	// Exact values from: status = ANY (ARRAY['Pending','Verified False','Verified True','Inconclusive'])
	type DBStatus = 'Pending' | 'Verified False' | 'Verified True' | 'Inconclusive';

	// ── Local UI state (internal aliases for readability) ─────────────────────
	type ReviewState = 'pending' | 'false_claim' | 'verified_true' | 'skipped';
	type SuggestedAction = 'false_claim' | 'verified_true' | 'skipped' | null;

	interface FlaggedItem {
		id: string;
		claim_text: string;
		rag_determination: string | null;
		rag_evidence_snippet: string | null;
		status: DBStatus;
		source_platform: string | null;
		language: string | null;
		created_at: string;
		// Supabase returns these as objects (FK is on flagged_claims side = many-to-one)
		processed_content: {
			cleaned_text: string | null;
			sentiment_label: string | null;
			topic_label: string | null;
		} | null;
		lgu_documents: {
			title: string | null;
			document_type: string | null;
		} | null;
		// Local UI state, not from DB
		reviewState: ReviewState;
		escalated: boolean;
	}

	// ── Map DB → UI ──────────────────────────────────────────────────────────
	function dbToUI(status: DBStatus): ReviewState {
		switch (status) {
			case 'Verified False':
				return 'false_claim';
			case 'Verified True':
				return 'verified_true';
			case 'Inconclusive':
				return 'skipped';
			default:
				return 'pending';
		}
	}

	// ── Map UI → DB ──────────────────────────────────────────────────────────
	function uiToDB(state: ReviewState): DBStatus {
		switch (state) {
			case 'false_claim':
				return 'Verified False';
			case 'verified_true':
				return 'Verified True';
			case 'skipped':
				return 'Inconclusive';
			default:
				return 'Pending';
		}
	}

	// ── Initialise from server data ───────────────────────────────────────────
	let flaggedItems: FlaggedItem[] = [];
	$: flaggedItems = (data.flaggedItems ?? []).map((item: any) => ({
		...item,
		// Supabase may occasionally return joins as single-element arrays — guard both
		processed_content: Array.isArray(item.processed_content)
			? (item.processed_content[0] ?? null)
			: item.processed_content,
		lgu_documents: Array.isArray(item.lgu_documents)
			? (item.lgu_documents[0] ?? null)
			: item.lgu_documents,
		reviewState: dbToUI(item.status as DBStatus),
		escalated: false
	}));

	let toastRef: Toast;

	// ── Action handler ────────────────────────────────────────────────────────
	// 1. Updates local state immediately (optimistic)
	// 2. PATCHes the server to persist to Supabase
	async function handleAction(id: string, action: ReviewState, label: string) {
		// Save previous state for rollback on failure
		const prev = flaggedItems.find((i) => i.id === id)?.reviewState ?? 'pending';

		// Optimistic update
		flaggedItems = flaggedItems.map((item) =>
			item.id === id ? { ...item, reviewState: action } : item
		);
		toastRef?.show(action === 'pending' ? 'Reopened for review' : `Claim marked as: ${label}`);

		try {
			const res = await fetch('', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id, status: uiToDB(action) })
			});
			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				console.error('[flagged_claims] server error:', payload.error ?? res.status);
				flaggedItems = flaggedItems.map((item) =>
					item.id === id ? { ...item, reviewState: prev } : item
				);
			} else {
				await invalidate('claims:list');
			}
		} catch (err) {
			console.error('[flagged_claims] network error:', err);
			flaggedItems = flaggedItems.map((item) =>
				item.id === id ? { ...item, reviewState: prev } : item
			);
		}
	}

	// ── Escalate to Issue Tracker ─────────────────────────────────────────────
	async function escalateToIssue(item: FlaggedItem) {
		const rawText = item.processed_content?.cleaned_text ?? item.claim_text;
		const title = rawText.length > 80 ? rawText.slice(0, 77) + '...' : rawText;

		try {
			const res = await fetch('/api/issues', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title,
					source_flagged_claim_id: item.id,
					priority: 'High',
					description: item.rag_evidence_snippet ?? null
				})
			});

			if (res.ok) {
				flaggedItems = flaggedItems.map((i) => (i.id === item.id ? { ...i, escalated: true } : i));
				toastRef?.show('Escalated to Issue Tracker');
			} else {
				const payload = await res.json().catch(() => ({}));
				console.error('[flagged_claims] escalate error:', payload.error ?? res.status);
				toastRef?.show('Escalation failed — see console', '', true);
			}
		} catch (err) {
			console.error('[flagged_claims] escalate network error:', err);
			toastRef?.show('Escalation failed — network error', '', true);
		}
	}

	// ── Suggested next action (derived from RAG determination, no extra data) ──
	function suggestedAction(item: FlaggedItem): SuggestedAction {
		switch (item.rag_determination) {
			case 'Refuted':
				return 'false_claim';
			case 'Supported':
				return 'verified_true';
			case 'Insufficient Evidence':
				return 'skipped';
			default:
				return null;
		}
	}

	// Suggestion only applies to claims still in the review queue
	function suggestionFor(item: FlaggedItem): SuggestedAction {
		return item.reviewState === 'pending' ? suggestedAction(item) : null;
	}

	function suggestionLabel(action: SuggestedAction): string {
		switch (action) {
			case 'false_claim':
				return 'Mark False — RAG rated this Refuted';
			case 'verified_true':
				return 'Verify True — RAG rated this Supported';
			case 'skipped':
				return 'Skip — RAG found Insufficient Evidence';
			default:
				return '';
		}
	}

	// ── Derived ───────────────────────────────────────────────────────────────
	$: pendingCount = data.counts.Pending;

	// PostgreSQL orders the entire queue before selecting this page.
	$: sortedFlagged = flaggedItems;

	// ── Style helpers ─────────────────────────────────────────────────────────
	function cardClass(state: ReviewState): string {
		switch (state) {
			case 'pending':
				return 'border-amber-200/60 dark:border-amber-500/20';
			case 'false_claim':
				return 'border-rose-200/60 dark:border-rose-500/20';
			case 'verified_true':
				return 'border-emerald-200/60 dark:border-emerald-500/20';
			default:
				return 'border-gray-200/50 opacity-60 dark:border-slate-700/50';
		}
	}

	function bannerClass(state: ReviewState): string {
		switch (state) {
			case 'false_claim':
				return 'bg-rose-50 dark:bg-rose-500/15';
			case 'verified_true':
				return 'bg-emerald-50 dark:bg-emerald-500/15';
			default:
				return 'bg-gray-100 dark:bg-slate-800/60';
		}
	}

	function bannerTextClass(state: ReviewState): string {
		switch (state) {
			case 'false_claim':
				return 'text-rose-600 dark:text-rose-400';
			case 'verified_true':
				return 'text-emerald-600 dark:text-emerald-400';
			default:
				return 'text-gray-500 dark:text-slate-400';
		}
	}

	function statusLabel(state: ReviewState): string {
		switch (state) {
			case 'false_claim':
				return 'Marked as Verified False';
			case 'verified_true':
				return 'Verified as True';
			case 'skipped':
				return 'Marked Inconclusive';
			default:
				return '';
		}
	}

	function statusIcon(state: ReviewState): string {
		switch (state) {
			case 'false_claim':
				return 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z';
			case 'verified_true':
				return 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
			case 'skipped':
				return 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
			default:
				return '';
		}
	}

	function isSuggested(item: FlaggedItem, action: ReviewState): boolean {
		return suggestionFor(item) === action;
	}

	function sentimentChipClass(label: string): string {
		switch (label) {
			case 'negative':
				return 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400';
			case 'positive':
				return 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400';
			case 'neutral':
			case 'review':
				return 'border-gray-200 bg-gray-100 text-gray-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400';
			default:
				return '';
		}
	}
</script>

<div class="animate-fade-in mx-auto max-w-7xl space-y-8 p-8">
	<!-- Header -->
	<PageHeader
		icon="flagged"
		title="Flagged Claims Review"
		subtitle="Claims flagged by the RAG pipeline. Human verification required before any action is taken."
	>
		{#snippet right()}
			<div
				class="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2 shadow-sm"
			>
				<span class="pulse-dot {pendingCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}"></span>
				<span class="text-sm font-medium text-ink">{pendingCount} Pending Review</span>
			</div>
		{/snippet}
	</PageHeader>

	<form method="GET" class="flex flex-wrap items-end gap-3" aria-label="Filter flagged claims">
		<div class="min-w-48 flex-1">
			<label for="claims-search" class="mb-1 block text-sm text-ink-muted">Search claims</label
			><input
				id="claims-search"
				name="q"
				value={data.filters.q}
				class="input w-full"
				placeholder="Search claims, evidence, documents..."
			/>
		</div>
		<div>
			<label for="claims-status" class="mb-1 block text-sm text-ink-muted">Status</label><select
				id="claims-status"
				name="status"
				value={data.filters.status}
				class="input"
				><option value="all">All</option><option>Pending</option><option>Verified True</option
				><option>Verified False</option><option>Inconclusive</option></select
			>
		</div>
		<button type="submit" class="btn-primary">Search</button>
	</form>
	<Pagination {...data.pagination} />
	<!-- Claims list -->
	<div class="space-y-6">
		{#if sortedFlagged.length === 0}
			<div class="card border-dashed p-12 text-center">
				<svg
					class="mx-auto mb-4 h-12 w-12 text-signal-300 dark:text-signal-600"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				<h3 class="text-lg font-semibold text-ink">All Caught Up</h3>
				<p class="mt-2 text-sm text-ink-muted">No flagged claims pending review.</p>
			</div>
		{:else}
			{#each sortedFlagged as item (item.id)}
				<div class="card overflow-hidden {cardClass(item.reviewState)}">
					<!-- Pending bar: slim attention bar (no gradient) -->
					{#if item.reviewState === 'pending'}
						<div class="h-1.5 w-full bg-amber-500"></div>
						<!-- Actioned: inline status banner keeps the claim readable -->
					{:else}
						<div
							class="flex items-center justify-between gap-3 border-b border-line px-6 py-2.5 {bannerClass(
								item.reviewState
							)}"
						>
							<span
								class="flex items-center gap-2 text-xs font-semibold {bannerTextClass(
									item.reviewState
								)}"
							>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d={statusIcon(item.reviewState)}
									/>
								</svg>
								{statusLabel(item.reviewState)}
							</span>
							<!-- Undo reverts to 'Pending' in DB too -->
							<button
								type="button"
								on:click={() => handleAction(item.id, 'pending', 'Pending')}
								class="text-xs font-medium underline underline-offset-2 opacity-80 transition-opacity hover:opacity-100 {bannerTextClass(
									item.reviewState
								)}"
							>
								Undo
							</button>
						</div>
					{/if}

					<div class="p-6">
						<div class="flex flex-col gap-8 lg:flex-row">
							<!-- Left: The Claim -->
							<div class="flex-1 space-y-4">
								<div class="flex flex-wrap items-center gap-3">
									<!-- RAG determination badge -->
									{#if item.rag_determination}
										<span
											class="inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-bold tracking-wider uppercase {ragBadgeClass(
												item.rag_determination
											)}"
										>
											{item.rag_determination}
										</span>
									{/if}
									<!-- Source platform -->
									{#if item.source_platform}
										<span
											class="inline-flex items-center rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted capitalize"
										>
											{item.source_platform}
										</span>
									{/if}
									<!-- Language -->
									{#if item.language}
										<span
											class="inline-flex items-center rounded border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold tracking-wider text-ink-faint uppercase"
										>
											{item.language}
										</span>
									{/if}
									<!-- Timestamp (mono telemetry) -->
									<span
										class="flex items-center gap-1 font-mono text-xs text-ink-faint tabular-nums"
									>
										<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
											/>
										</svg>
										{formatDateTime(item.created_at)}
									</span>
								</div>

								<!-- Original anonymized comment text -->
								<div>
									<p class="micro-label mb-1.5">Anonymized Comment</p>
									<p class="max-w-prose font-display text-lg leading-relaxed text-ink italic">
										"{item.processed_content?.cleaned_text ?? item.claim_text}"
									</p>
								</div>

								<!-- Topic + Sentiment from processed_content -->
								{#if item.processed_content?.topic_label || item.processed_content?.sentiment_label}
									<div class="flex flex-wrap gap-2">
										{#if item.processed_content.topic_label}
											<span
												class="rounded-md border border-signal-100 bg-signal-50 px-2 py-1 text-xs font-medium text-signal-600 dark:border-signal-900/60 dark:bg-signal-950/60 dark:text-signal-400"
											>
												{item.processed_content.topic_label}
											</span>
										{/if}
										{#if item.processed_content.sentiment_label}
											<span
												class="rounded-md border px-2 py-1 text-xs capitalize {sentimentChipClass(
													item.processed_content.sentiment_label
												)}"
											>
												{item.processed_content.sentiment_label}
											</span>
										{/if}
									</div>
								{/if}
							</div>

							<!-- Right: Analysis & Actions -->
							<div class="flex flex-1 flex-col justify-between space-y-4">
								<div class="min-w-0 space-y-3">
									<p class="micro-label">RAG Analysis</p>
									<!-- Evidence snippet from matched LGU document -->
									{#if item.rag_evidence_snippet}
										<p class="border-l border-line pl-3 text-sm leading-relaxed text-ink-muted">
											{item.rag_evidence_snippet}
										</p>
									{:else}
										<p class="text-sm text-ink-muted">
											No matching evidence found in the reference documents.
										</p>
									{/if}
									<!-- Matched document info -->
									{#if item.lgu_documents?.title}
										<p
											class="flex items-center gap-1.5 text-xs font-medium text-signal-600 dark:text-signal-400"
										>
											<svg
												class="h-3.5 w-3.5 shrink-0"
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
											<span class="truncate">{item.lgu_documents.title}</span>
											{#if item.lgu_documents.document_type}
												<span class="font-normal text-ink-faint"
													>· {item.lgu_documents.document_type}</span
												>
											{/if}
										</p>
									{/if}
									<!-- Suggested next action, derived from RAG determination -->
									{#if suggestionFor(item)}
										{@const suggestion = suggestionFor(item)}
										<div
											class="flex items-center gap-2 rounded-md border border-line bg-gray-50 px-3 py-2 dark:bg-slate-800/60"
										>
											<svg
												class="h-3.5 w-3.5 shrink-0 text-signal-500"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 20v1H10v-1a3.374 3.374 0 00-1.415-1.544l-.548-.547z"
												/>
											</svg>
											<span class="text-xs text-ink-muted">
												<span class="font-semibold text-ink">Suggested:</span>
												{suggestionLabel(suggestion)}
											</span>
										</div>
									{/if}
								</div>

								<!-- Action buttons -->
								<div class="flex gap-3 pt-2">
									<button
										type="button"
										disabled={item.reviewState !== 'pending'}
										on:click={() => handleAction(item.id, 'false_claim', 'Verified False')}
										class="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-signal-400/40 disabled:cursor-not-allowed disabled:opacity-40 {isSuggested(
											item,
											'false_claim'
										)
											? 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-400 dark:hover:text-slate-950'
											: 'border border-line bg-surface text-ink hover:bg-gray-50 dark:hover:bg-slate-800'}"
									>
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
											/>
										</svg>
										Mark False
									</button>
									<button
										type="button"
										disabled={item.reviewState !== 'pending'}
										on:click={() => handleAction(item.id, 'verified_true', 'Verified True')}
										class="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-signal-400/40 disabled:cursor-not-allowed disabled:opacity-40 {isSuggested(
											item,
											'verified_true'
										)
											? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:hover:text-slate-950'
											: 'border border-line bg-surface text-ink hover:bg-gray-50 dark:hover:bg-slate-800'}"
									>
										<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
											/>
										</svg>
										Verify True
									</button>
									<button
										type="button"
										disabled={item.reviewState !== 'pending'}
										on:click={() => handleAction(item.id, 'skipped', 'Inconclusive')}
										class="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted transition-colors outline-none hover:bg-gray-100 hover:text-ink focus-visible:ring-2 focus-visible:ring-signal-400/40 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-100"
									>
										Skip
									</button>
									<button
										type="button"
										disabled={item.escalated || item.reviewState !== 'pending'}
										on:click={() => escalateToIssue(item)}
										class="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-signal-400/40 disabled:cursor-not-allowed disabled:opacity-40 {item.escalated
											? 'cursor-default bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
											: 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20'}"
										title={item.escalated
											? 'Already escalated'
											: 'Create an Issue Tracker ticket from this claim'}
									>
										{#if item.escalated}
											<svg
												class="h-3.5 w-3.5"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<path d="M20 6L9 17l-5-5" />
											</svg>
											Escalated
										{:else}
											<svg
												class="h-3.5 w-3.5"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<circle cx="12" cy="12" r="10" />
												<line x1="12" y1="8" x2="12" y2="12" />
												<line x1="12" y1="16" x2="12.01" y2="16" />
											</svg>
											Escalate
										{/if}
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			{/each}
		{/if}
	</div>
	<Pagination {...data.pagination} />
</div>

<Toast bind:this={toastRef} />

<style>
	.animate-fade-in {
		animation: fadeIn 0.5s ease-out both;
	}

	/* Opacity-only — see CONTEXT.md gotcha: transform on this wrapper would
	   trap position:fixed toasts to the document container. */
	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
