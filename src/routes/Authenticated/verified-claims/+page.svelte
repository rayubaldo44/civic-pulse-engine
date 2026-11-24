<script lang="ts">
	// +page.svelte — Verified Claims archive
	// Shows all reviewed claims with status filter and text search, plus actions:
	// copy text, re-open to the review queue, and escalate to the Issue Tracker.

	import type { PageData } from './$types';
	import { untrack } from 'svelte';
	import { invalidate } from '$app/navigation';
	import Pagination from '$lib/components/Pagination.svelte';
	import { ragBadgeClass } from '$lib/utils/badges';
	import { formatDateTime } from '$lib/utils/format';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Toast from '$lib/components/Toast.svelte';

	let { data }: { data: PageData } = $props();

	type DBStatus = 'Verified False' | 'Verified True' | 'Inconclusive';

	interface LinkedIssue {
		id: string;
		title: string;
		status: string;
	}

	interface VerifiedItem {
		id: string;
		claim_text: string;
		rag_determination: string | null;
		rag_evidence_snippet: string | null;
		status: DBStatus;
		source_platform: string | null;
		language: string | null;
		created_at: string;
		processed_content: {
			cleaned_text: string | null;
			sentiment_label: string | null;
			topic_label: string | null;
		} | null;
		lgu_documents: {
			title: string | null;
			document_type: string | null;
		} | null;
		linked_issue: LinkedIssue | null;
	}

	let items = $state<VerifiedItem[]>(untrack(() => data.verifiedItems as VerifiedItem[]));
	$effect(() => {
		items = data.verifiedItems as VerifiedItem[];
	});

	let statusFilter = $derived(data.filters.status);
	let searchQuery = $derived(data.filters.q);
	let filteredItems = $derived(items);
	let trueCount = $derived(data.counts['Verified True']);
	let falseCount = $derived(data.counts['Verified False']);
	let inconclusiveCount = $derived(data.counts.Inconclusive);

	// ── Feedback ─────────────────────────────────────────────────────────────
	let toastRef: Toast;

	// ── Re-open / revert to Pending ───────────────────────────────────────────
	// Reuses the same PATCH endpoint as the flagged-claims page's "Undo Action".
	async function revertToPending(id: string) {
		if (!window.confirm('Re-open this claim back to the review queue?')) return;

		try {
			const res = await fetch('/Authenticated/flagged-claims', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id, status: 'Pending' })
			});

			if (res.ok) {
				// Remove immediately (optimistic) — status no longer "verified"
				items = items.filter((i) => i.id !== id);
				toastRef?.show('Claim reopened for review');
				await invalidate('claims:list');
			} else {
				const payload = await res.json().catch(() => ({}));
				console.error('[verified_claims] revert error:', payload.error ?? res.status);
				toastRef?.show('Could not reopen claim', '', true);
			}
		} catch (err) {
			console.error('[verified_claims] revert network error:', err);
			toastRef?.show('Reopen failed — network error', '', true);
		}
	}

	// ── Escalate to Issue Tracker ────────────────────────────────────────────
	// Mirrors flagged-claims escalateToIssue(); links the claim as issue evidence.
	async function escalateToIssue(item: VerifiedItem) {
		if (item.linked_issue) return;
		if (!window.confirm('Create an Issue Tracker ticket from this claim?')) return;

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
				const created = await res.json().catch(() => null);
				const newIssue = created ?? null;
				items = items.map((i) =>
					i.id === item.id
						? {
								...i,
								linked_issue: newIssue?.id
									? {
											id: newIssue.id,
											title: newIssue.title ?? title,
											status: newIssue.status ?? 'Open'
										}
									: { id: 'created', title, status: 'Open' }
							}
						: i
				);
				toastRef?.show('Escalated to Issue Tracker');
				await invalidate('claims:list');
			} else {
				const payload = await res.json().catch(() => ({}));
				console.error('[verified_claims] escalate error:', payload.error ?? res.status);
				toastRef?.show('Escalation failed', '', true);
			}
		} catch (err) {
			console.error('[verified_claims] escalate network error:', err);
			toastRef?.show('Escalation failed — network error', '', true);
		}
	}

	// ── Copy claim text ──────────────────────────────────────────────────────
	async function copyClaim(item: VerifiedItem) {
		const rawText = item.processed_content?.cleaned_text ?? item.claim_text;
		try {
			await navigator.clipboard.writeText(rawText);
			toastRef?.show('Claim text copied');
		} catch (err) {
			console.error('[verified_claims] copy error:', err);
			toastRef?.show('Copy failed', '', true);
		}
	}

	// ── Style helpers ─────────────────────────────────────────────────────────
	function topBarClass(status: DBStatus): string {
		switch (status) {
			case 'Verified True':
				return 'bg-emerald-500';
			case 'Verified False':
				return 'bg-rose-500';
			case 'Inconclusive':
				return 'bg-gray-300 dark:bg-slate-600';
		}
	}

	function cardBorderClass(status: DBStatus): string {
		switch (status) {
			case 'Verified True':
				return 'border-emerald-200/60 dark:border-emerald-500/20';
			case 'Verified False':
				return 'border-rose-200/60 dark:border-rose-500/20';
			case 'Inconclusive':
				return 'border-gray-200/50 opacity-60 dark:border-slate-700/50';
		}
	}

	function statusBadgeClass(status: DBStatus): string {
		switch (status) {
			case 'Verified True':
				return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/20';
			case 'Verified False':
				return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/20';
			case 'Inconclusive':
				return 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-500/15 dark:text-slate-400 dark:border-slate-500/20';
		}
	}

	function statusIcon(status: DBStatus): string {
		switch (status) {
			case 'Verified True':
				return 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
			case 'Verified False':
				return 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z';
			case 'Inconclusive':
				return 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
		}
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
		icon="verified"
		title="Verified Claims"
		subtitle="All human-reviewed claims. Review decisions are final and auditable."
	>
		{#snippet right()}
			<div
				class="flex items-center gap-4 rounded-lg border border-line bg-surface px-4 py-2 shadow-sm"
			>
				<div class="flex items-center gap-1.5 text-xs font-medium text-ink-muted tabular-nums">
					<span class="h-2 w-2 rounded-full bg-emerald-500"></span>
					{trueCount} True
				</div>
				<div class="flex items-center gap-1.5 text-xs font-medium text-ink-muted tabular-nums">
					<span class="h-2 w-2 rounded-full bg-rose-500"></span>
					{falseCount} False
				</div>
				<div class="flex items-center gap-1.5 text-xs font-medium text-ink-muted tabular-nums">
					<span class="h-2 w-2 rounded-full bg-gray-300 dark:bg-slate-600"></span>
					{inconclusiveCount} Inconclusive
				</div>
			</div>
		{/snippet}
	</PageHeader>

	<!-- Filters -->
	<form
		method="GET"
		class="flex flex-col gap-3 sm:flex-row sm:items-center"
		aria-label="Filter verified claims"
	>
		<!-- Status filter -->
		<div class="flex items-center gap-2">
			<label for="status-filter" class="text-sm font-medium text-ink-muted"> Status: </label>
			<select
				id="status-filter"
				name="status"
				value={statusFilter}
				class="input w-auto px-3 py-1.5 text-sm font-medium"
			>
				<option value="all">All ({trueCount + falseCount + inconclusiveCount})</option>
				<option value="Verified True">Verified True ({trueCount})</option>
				<option value="Verified False">Verified False ({falseCount})</option>
				<option value="Inconclusive">Inconclusive ({inconclusiveCount})</option>
			</select>
		</div>

		<!-- Search -->
		<div class="relative flex-1">
			<svg
				class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
			<input
				type="text"
				name="q"
				value={searchQuery}
				placeholder="Search claims, evidence, documents..."
				class="input w-full py-1.5 pr-4 pl-9"
			/>
		</div>
		<button type="submit" class="btn-primary">Search</button>
	</form>
	<Pagination {...data.pagination} />

	<!-- Claims list -->
	<div class="space-y-6">
		{#if filteredItems.length === 0}
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
				<h3 class="text-lg font-semibold text-ink">
					{items.length === 0 ? 'No Verified Claims Yet' : 'No Matching Claims'}
				</h3>
				<p class="mt-2 text-sm text-ink-muted">
					{items.length === 0
						? 'Claims will appear here once you review them in Flagged Claims.'
						: 'Try adjusting your filters or search query.'}
				</p>
			</div>
		{:else}
			{#each filteredItems as item (item.id)}
				<div class="card overflow-hidden {cardBorderClass(item.status)}">
					<!-- Colour bar -->
					<div class="h-1.5 w-full {topBarClass(item.status)}"></div>

					<div class="p-6">
						<div class="flex flex-col gap-8 lg:flex-row">
							<!-- Left: The Claim -->
							<div class="flex-1 space-y-4">
								<div class="flex flex-wrap items-center gap-3">
									<!-- Status badge -->
									<span
										class="inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 text-xs font-bold tracking-wider uppercase {statusBadgeClass(
											item.status
										)}"
									>
										<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d={statusIcon(item.status)}
											/>
										</svg>
										{item.status}
									</span>
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

								<!-- Topic + Sentiment -->
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

							<!-- Right: RAG Analysis -->
							<div class="flex flex-1 flex-col space-y-4">
								<div class="min-w-0 space-y-3">
									<p class="micro-label">RAG Analysis</p>
									{#if item.rag_evidence_snippet}
										<p class="border-l border-line pl-3 text-sm leading-relaxed text-ink-muted">
											{item.rag_evidence_snippet}
										</p>
									{:else}
										<p class="text-sm text-ink-muted">No matching evidence on record.</p>
									{/if}
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
								</div>

								<!-- Actions -->
								<div class="flex flex-wrap gap-2 pt-2">
									<!-- Copy -->
									<button
										type="button"
										onclick={() => copyClaim(item)}
										title="Copy claim text"
										class="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-gray-50 hover:text-ink dark:hover:bg-slate-800 dark:hover:text-slate-100"
									>
										<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
											/>
										</svg>
										Copy
									</button>

									<!-- Re-open / revert -->
									<button
										type="button"
										onclick={() => revertToPending(item.id)}
										title="Send back to the pending review queue"
										class="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
									>
										<svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
											/>
										</svg>
										Re-open
									</button>

									<!-- Escalate / View linked issue -->
									{#if item.linked_issue}
										<a
											href="/Authenticated/issues"
											title="View the linked issue in the Issue Tracker"
											class="inline-flex items-center gap-1.5 rounded-lg border border-signal-200 bg-signal-50 px-3 py-1.5 text-xs font-medium text-signal-700 transition-colors hover:bg-signal-100 dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400 dark:hover:bg-signal-500/20"
										>
											<svg
												class="h-3.5 w-3.5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													stroke-width="2"
													d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
												/>
											</svg>
											View Issue
										</a>
									{:else}
										<button
											type="button"
											onclick={() => escalateToIssue(item)}
											title="Create an Issue Tracker ticket from this claim"
											class="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
										>
											<svg
												class="h-3.5 w-3.5"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<circle cx="12" cy="12" r="10" />
												<line x1="12" y1="8" x2="12" y2="12" />
												<line x1="12" y1="16" x2="12.01" y2="16" />
											</svg>
											Escalate
										</button>
									{/if}
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

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
