<script lang="ts">
	import { onMount } from 'svelte';
	import type { Issue, IssueDetail, IssueComment, Profile, Priority } from '$lib/types/issues';
	import { priorityBadge, ragBadgeClass, sentimentDot } from '$lib/utils/badges';
	import { formatDateTime } from '$lib/utils/format';
	import { ISSUE_TRANSITIONS } from '$lib/types/issues';

	interface Props {
		detail: IssueDetail | null;
		loading: boolean;
		open: boolean;
		staff: Profile[];
		onClose: () => void;
		onUpdate: (patch: Partial<Issue> & { id: string }) => void;
		onRefetch?: () => Promise<void> | void;
		userId?: string | null;
		role?: 'admin' | 'analyst';
		onReviewSubmitted?: (issueId: string) => void;
	}

	let {
		detail,
		loading,
		open,
		staff,
		onClose,
		onUpdate,
		onRefetch,
		userId = null,
		role = 'analyst',
		onReviewSubmitted
	}: Props = $props();

	// ── Local comment state (appended optimistically after POST) ──────────────
	let localComments = $state<IssueComment[]>([]);
	let newCommentText = $state('');
	let submitting = $state(false);
	let patchError = $state<string | null>(null);
	let commentError = $state<string | null>(null);
	let resolutionSummary = $state('');
	let actionsTaken = $state('');
	let observedOutcome = $state('');
	let evidenceLinks = $state('');
	let reviewChecks = $state([false, false, false, false]);
	let reviewComment = $state('');
	let reviewBusy = $state(false);
	let reviewError = $state<string | null>(null);

	// Reset local state whenever a new issue is opened
	$effect(() => {
		if (detail) {
			localComments = [...detail.comments];
			newCommentText = '';
			patchError = null;
			commentError = null;
			resolutionSummary = '';
			actionsTaken = '';
			observedOutcome = '';
			evidenceLinks = '';
			reviewChecks = [false, false, false, false];
			reviewComment = '';
			reviewError = null;
		}
	});

	let currentRound = $derived(detail?.resolution_rounds?.[0] ?? null);
	let myReview = $derived(currentRound?.reviews.find((review) => review.is_mine) ?? null);
	let canSubmitResolution = $derived(
		Boolean(detail && userId && detail.status === 'In Progress' && detail.assigned_to === userId)
	);

	async function submitResolution() {
		if (!detail || reviewBusy) return;
		reviewBusy = true;
		reviewError = null;
		try {
			const res = await fetch(`/api/issues/${detail.id}/resolution-rounds`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					resolution_summary: resolutionSummary,
					actions_taken: actionsTaken,
					observed_outcome: observedOutcome,
					evidence_links: evidenceLinks.split(/\s+/).filter(Boolean)
				})
			});
			const payload = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) throw new Error(payload.error ?? 'Could not start peer review');
			onUpdate({ id: detail.id, status: 'Under Review' });
			await onRefetch?.();
		} catch (err) {
			reviewError = err instanceof Error ? err.message : 'Could not start peer review';
		} finally {
			reviewBusy = false;
		}
	}

	async function submitReview(decision: 'approve' | 'request_changes') {
		if (!detail || !currentRound || reviewBusy) return;
		reviewBusy = true;
		reviewError = null;
		try {
			const res = await fetch(
				`/api/issues/${detail.id}/resolution-rounds/${currentRound.id}/review`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						decision,
						actions_completed: reviewChecks[0],
						evidence_sufficient: reviewChecks[1],
						outcome_addresses_issue: reviewChecks[2],
						no_unresolved_blocker: reviewChecks[3],
						comment: reviewComment
					})
				}
			);
			const payload = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) throw new Error(payload.error ?? 'Could not submit review');
			onReviewSubmitted?.(detail.id);
			await onRefetch?.();
		} catch (err) {
			reviewError = err instanceof Error ? err.message : 'Could not submit review';
		} finally {
			reviewBusy = false;
		}
	}

	async function reassignReviewer(reviewId: string) {
		if (!detail || !currentRound || reviewBusy) return;
		reviewBusy = true;
		reviewError = null;
		try {
			const res = await fetch(
				`/api/issues/${detail.id}/resolution-rounds/${currentRound.id}/reviewers/${reviewId}`,
				{ method: 'PATCH' }
			);
			const payload = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) throw new Error(payload.error ?? 'Could not reassign reviewer');
			await onRefetch?.();
		} catch (err) {
			reviewError = err instanceof Error ? err.message : 'Could not reassign reviewer';
		} finally {
			reviewBusy = false;
		}
	}

	// ── Keyboard: Escape closes the panel ─────────────────────────────────────
	onMount(() => {
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape' && open) onClose();
		}
		document.addEventListener('keydown', onKeydown);
		return () => document.removeEventListener('keydown', onKeydown);
	});

	// ── PATCH helper ──────────────────────────────────────────────────────────
	async function patch(fields: Record<string, unknown>): Promise<boolean> {
		if (!detail) return false;
		patchError = null;
		try {
			const res = await fetch(`/api/issues/${detail.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(fields)
			});
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as { error?: string };
				patchError = payload.error ?? 'Update failed';
				return false;
			}
			const updated = (await res.json()) as Partial<Issue> & { id: string };
			onUpdate(updated);
			// Status changes insert a log row server-side — refresh so the
			// Status History timeline reflects it immediately
			if (fields.status !== undefined) void onRefetch?.();
			return true;
		} catch {
			patchError = 'Network error';
			return false;
		}
	}

	// ── Comment submit ────────────────────────────────────────────────────────
	async function submitComment() {
		if (!detail || !newCommentText.trim()) return;
		submitting = true;
		commentError = null;
		try {
			const res = await fetch(`/api/issues/${detail.id}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ body: newCommentText.trim() })
			});
			if (res.ok) {
				const comment = (await res.json()) as IssueComment;
				localComments = [...localComments, comment];
				newCommentText = '';
			} else {
				const payload = (await res.json().catch(() => ({}))) as { error?: string };
				commentError = payload.error ?? 'Failed to post comment';
			}
		} catch {
			commentError = 'Network error — comment not posted';
		} finally {
			submitting = false;
		}
	}

	// ── Display helpers ───────────────────────────────────────────────────────
	function initials(name: string | null): string {
		if (!name) return '?';
		return name
			.split(' ')
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	}

	// Local selectors mirror the current detail so they update immediately on open
	let localPriority = $derived(detail?.priority ?? 'Medium');
	let localStatus = $derived(detail?.status ?? 'Open');
	let localAssignedTo = $derived(detail?.assigned_to ?? '');

	// Status dropdown only offers the current status (no-op) + legal transitions
	let statusOptions = $derived(
		detail ? [...new Set([detail.status, ...(ISSUE_TRANSITIONS[detail.status] ?? [])])] : []
	);

	const PRIORITIES: Priority[] = ['Critical', 'High', 'Medium', 'Low'];
</script>

<!-- ── Overlay ──────────────────────────────────────────────────────────────── -->
<div
	role="presentation"
	class="fixed inset-0 z-40 bg-slate-900/40 transition-opacity duration-300"
	class:opacity-100={open}
	class:opacity-0={!open}
	class:pointer-events-none={!open}
	onclick={onClose}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
></div>

<!-- ── Panel ───────────────────────────────────────────────────────────────── -->
<div
	class="fixed top-0 right-0 z-50 flex h-full w-[380px] flex-col border-l border-slate-200 bg-white
	    shadow-xl transition-transform duration-300 ease-in-out dark:border-slate-700 dark:bg-slate-900"
	class:translate-x-0={open}
	class:translate-x-full={!open}
	role="dialog"
	aria-modal="true"
	aria-label="Issue details"
>
	<!-- Header -->
	<div
		class="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800"
	>
		<h2 class="text-base font-semibold text-ink">Issue Details</h2>
		<button
			onclick={onClose}
			class="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
			aria-label="Close panel"
		>
			<svg
				class="h-4 w-4"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<line x1="18" y1="6" x2="6" y2="18" />
				<line x1="6" y1="6" x2="18" y2="18" />
			</svg>
		</button>
	</div>

	<!-- Body -->
	<div class="flex-1 overflow-y-auto">
		<!-- ── Loading skeleton ───────────────────────────────────────────────── -->
		{#if loading}
			<div class="animate-pulse space-y-4 p-5">
				<div class="h-5 w-3/4 rounded bg-slate-100 dark:bg-slate-800/60"></div>
				<div class="h-4 w-full rounded bg-slate-100 dark:bg-slate-800/60"></div>
				<div class="h-4 w-2/3 rounded bg-slate-100 dark:bg-slate-800/60"></div>
				<div class="mt-6 h-24 rounded-lg bg-slate-100 dark:bg-slate-800/60"></div>
				<div class="h-8 rounded bg-slate-100 dark:bg-slate-800/60"></div>
				<div class="h-8 rounded bg-slate-100 dark:bg-slate-800/60"></div>
			</div>
		{:else if detail}
			<!-- ── Title & description ─────────────────────────────────────────── -->
			<div class="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
				<div class="mb-1 flex flex-wrap items-center gap-2">
					<span
						class="inline-flex items-center rounded border px-1.5 py-0.5
					             text-[11px] font-bold tracking-wide uppercase
					             {priorityBadge(detail.priority)}"
					>
						{detail.priority}
					</span>
					{#if detail.topic}
						<span
							class="inline-flex items-center rounded border border-signal-100 bg-signal-50
						             px-1.5 py-0.5 text-[11px] font-medium text-signal-600 dark:border-signal-500/20 dark:bg-signal-500/10 dark:text-signal-400"
						>
							{detail.topic}
						</span>
					{/if}
					<span class="ml-auto font-mono text-[11px] text-slate-300 dark:text-slate-600">
						{detail.id.slice(0, 8).toUpperCase()}
					</span>
				</div>
				<h3 class="mb-1 text-sm leading-snug font-semibold text-ink">
					{detail.title}
				</h3>
				{#if detail.description}
					<p class="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
						{detail.description}
					</p>
				{/if}
			</div>

			<!-- ── NLP Evidence ────────────────────────────────────────────────── -->
			{#if detail.source_comment || detail.source_claim}
				<div class="space-y-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
					<p
						class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500"
					>
						NLP Evidence
					</p>

					{#if detail.source_comment}
						{@const sc = detail.source_comment}
						<div
							class="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50"
						>
							{#if sc.cleaned_text}
								<p
									class="line-clamp-3 text-xs leading-relaxed text-slate-600 italic dark:text-slate-300"
								>
									"{sc.cleaned_text}"
								</p>
							{/if}
							<div class="flex flex-wrap items-center gap-2">
								{#if sc.sentiment_label}
									<span
										class="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"
									>
										<span class="h-1.5 w-1.5 rounded-full {sentimentDot(sc.sentiment_label)}"
										></span>
										{sc.sentiment_label}
									</span>
								{/if}
								{#if sc.topic_label}
									<span class="text-[11px] text-slate-400 dark:text-slate-500"
										>· {sc.topic_label}</span
									>
								{/if}
								<!-- Facebook icon placeholder (source_platform not on source_comment join) -->
								<span class="ml-auto">
									<svg class="h-3.5 w-3.5 text-signal-500" fill="currentColor" viewBox="0 0 24 24">
										<path
											d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
										/>
									</svg>
								</span>
							</div>
						</div>
					{/if}

					{#if detail.source_claim}
						{@const claim = detail.source_claim}
						<div class="rounded-lg border p-3 {ragBadgeClass(claim.rag_determination)}">
							<p class="mb-1 text-[11px] font-bold tracking-wide uppercase opacity-70">
								Flagged Claim · {claim.rag_determination ?? 'Unknown'}
							</p>
							<p class="line-clamp-3 text-xs leading-relaxed">"{claim.claim_text}"</p>
						</div>
					{/if}
				</div>
			{/if}

			<!-- ── Peer resolution review ───────────────────────────────────────── -->
			{#if currentRound || canSubmitResolution}
				<section class="space-y-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
					<div class="flex items-center justify-between gap-3">
						<h4 class="text-sm font-semibold text-ink">Peer resolution review</h4>
						{#if currentRound}
							<span
								class="rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums
								{currentRound.status === 'passed'
									? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
									: currentRound.status === 'failed'
										? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
										: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'}"
							>
								{currentRound.status === 'pending'
									? `${currentRound.review_count}/3 received`
									: currentRound.status}
							</span>
						{/if}
					</div>

					{#if reviewError}
						<p
							class="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
						>
							{reviewError}
						</p>
					{/if}

					{#if currentRound}
						<div class="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
							<div>
								<p class="text-[11px] font-semibold text-slate-400 uppercase">Resolution</p>
								<p class="mt-1 text-sm text-ink">{currentRound.resolution_summary}</p>
							</div>
							<div>
								<p class="text-[11px] font-semibold text-slate-400 uppercase">Actions taken</p>
								<p class="mt-1 text-xs leading-relaxed text-ink-muted">
									{currentRound.actions_taken}
								</p>
							</div>
							<div>
								<p class="text-[11px] font-semibold text-slate-400 uppercase">Observed outcome</p>
								<p class="mt-1 text-xs leading-relaxed text-ink-muted">
									{currentRound.observed_outcome}
								</p>
							</div>
							<div class="flex flex-wrap gap-2">
								{#each currentRound.evidence_links as link, index}
									<a
										class="text-xs font-medium text-signal-600 underline underline-offset-2 dark:text-signal-400"
										href={link}
										target="_blank"
										rel="noreferrer"
									>
										Evidence {index + 1}
									</a>
								{/each}
							</div>
						</div>

						{#if currentRound.status === 'pending'}
							<div
								class="flex gap-1.5"
								aria-label={`${currentRound.review_count} of 3 reviews received`}
							>
								{#each [0, 1, 2] as seat}
									<span
										class="h-1.5 flex-1 rounded-full {seat < currentRound.review_count
											? 'bg-signal-500'
											: 'bg-slate-200 dark:bg-slate-700'}"
									></span>
								{/each}
							</div>

							{#if myReview && !myReview.submitted_at}
								<fieldset class="space-y-2">
									<legend class="mb-2 text-xs font-semibold text-ink"
										>Independent review checklist</legend
									>
									{#each ['The proposed actions were completed', 'The evidence supports completion', 'The outcome addresses the issue', 'No unresolved blocker remains'] as label, index}
										<label class="flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
											<input
												type="checkbox"
												bind:checked={reviewChecks[index]}
												class="mt-0.5 rounded border-line text-signal-600 focus:ring-signal-500"
											/>
											<span>{label}</span>
										</label>
									{/each}
								</fieldset>
								<label class="block">
									<span class="label">Review note</span>
									<textarea
										bind:value={reviewComment}
										class="input mt-1 min-h-20 w-full resize-y"
										placeholder="Required when requesting changes"></textarea>
								</label>
								<div class="grid grid-cols-2 gap-2">
									<button
										class="btn btn-secondary"
										disabled={reviewBusy || !reviewComment.trim()}
										onclick={() => void submitReview('request_changes')}>Request changes</button
									>
									<button
										class="btn btn-primary"
										disabled={reviewBusy || reviewChecks.some((checked) => !checked)}
										onclick={() => void submitReview('approve')}>Approve</button
									>
								</div>
							{:else if myReview?.submitted_at}
								<p
									class="rounded-md bg-signal-50 px-3 py-2 text-xs text-signal-700 dark:bg-signal-500/10 dark:text-signal-300"
								>
									Your review is recorded. Other decisions stay hidden until all three reviewers
									submit.
								</p>
							{/if}

							{#if role === 'admin'}
								<div class="space-y-2">
									{#each currentRound.reviews.filter((review) => review.reviewer) as review}
										<div class="flex items-center gap-2 text-xs text-ink-muted">
											<span class="min-w-0 flex-1 truncate"
												>{review.reviewer?.full_name ?? 'Reviewer'}</span
											>
											<span
												>{review.submitted_at
													? 'Submitted'
													: review.is_overdue
														? 'Overdue'
														: 'Pending'}</span
											>
											{#if review.is_overdue && review.id}
												<button
													class="btn btn-ghost px-2 py-1 text-xs"
													disabled={reviewBusy}
													onclick={() => void reassignReviewer(review.id!)}>Reassign</button
												>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						{:else}
							<div class="space-y-2">
								{#each currentRound.reviews as review}
									<div class="rounded-lg border border-line p-3">
										<div class="flex items-center justify-between gap-2 text-xs">
											<span class="font-semibold text-ink"
												>{review.reviewer?.full_name ?? 'Reviewer'}</span
											>
											<span
												class={review.decision === 'approve' ? 'text-emerald-600' : 'text-rose-600'}
												>{review.decision === 'approve' ? 'Approved' : 'Requested changes'}</span
											>
										</div>
										{#if review.comment}<p class="mt-2 text-xs text-ink-muted">
												{review.comment}
											</p>{/if}
									</div>
								{/each}
							</div>
						{/if}
					{/if}

					{#if (detail.resolution_rounds?.length ?? 0) > 1}
						<details class="rounded-lg border border-line px-3 py-2">
							<summary class="cursor-pointer text-xs font-semibold text-ink">
								Earlier review rounds
							</summary>
							<div class="mt-3 space-y-3">
								{#each detail.resolution_rounds?.slice(1) ?? [] as round}
									<div class="border-t border-line pt-3 first:border-0 first:pt-0">
										<div class="flex justify-between text-xs">
											<span class="font-semibold text-ink">Round {round.round_number}</span>
											<span class="text-ink-muted capitalize">{round.status}</span>
										</div>
										<p class="mt-1 text-xs text-ink-muted">{round.resolution_summary}</p>
										{#each round.reviews as review}
											<p class="mt-1 text-[11px] text-ink-faint">
												{review.reviewer?.full_name ?? 'Reviewer'} · {review.decision === 'approve'
													? 'Approved'
													: 'Requested changes'}{review.comment ? ` — ${review.comment}` : ''}
											</p>
										{/each}
									</div>
								{/each}
							</div>
						</details>
					{/if}

					{#if canSubmitResolution}
						<form
							class="space-y-3"
							onsubmit={(event) => {
								event.preventDefault();
								void submitResolution();
							}}
						>
							<p class="text-xs leading-relaxed text-ink-muted">
								Submit evidence for three independent reviewers. Their votes stay blind until the
								round closes.
							</p>
							<label class="block"
								><span class="label">Resolution summary</span><textarea
									required
									bind:value={resolutionSummary}
									class="input mt-1 min-h-16 w-full resize-y"></textarea></label
							>
							<label class="block"
								><span class="label">Actions taken</span><textarea
									required
									bind:value={actionsTaken}
									class="input mt-1 min-h-20 w-full resize-y"></textarea></label
							>
							<label class="block"
								><span class="label">Observed outcome</span><textarea
									required
									bind:value={observedOutcome}
									class="input mt-1 min-h-20 w-full resize-y"></textarea></label
							>
							<label class="block"
								><span class="label">Evidence links</span><textarea
									required
									bind:value={evidenceLinks}
									class="input mt-1 min-h-16 w-full resize-y"
									placeholder="One http(s) link per line"></textarea></label
							>
							<button class="btn btn-primary w-full" disabled={reviewBusy}
								>{reviewBusy
									? 'Assigning reviewers…'
									: currentRound?.status === 'failed'
										? 'Revise and resubmit'
										: 'Submit for peer review'}</button
							>
						</form>
					{/if}
				</section>
			{/if}

			<!-- ── Controls ───────────────────────────────────────────────────── -->
			<div class="space-y-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
				<p
					class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500"
				>
					Manage
				</p>

				{#if patchError}
					<p
						class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400"
					>
						{patchError}
					</p>
				{/if}

				<!-- Priority -->
				<div class="flex items-center gap-3">
					<label
						for="slide-priority"
						class="w-24 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400"
					>
						Priority
					</label>
					<select
						id="slide-priority"
						disabled={detail.status === 'Under Review'}
						value={localPriority}
						onchange={async (e) => {
							const el = e.currentTarget as HTMLSelectElement;
							const ok = await patch({ priority: el.value });
							if (!ok && detail) el.value = detail.priority;
						}}
						class="input flex-1 px-2.5 py-1.5 text-xs"
					>
						{#each PRIORITIES as p}
							<option value={p}>{p}</option>
						{/each}
					</select>
				</div>

				<!-- Status -->
				<div class="flex items-center gap-3">
					<label
						for="slide-status"
						class="w-24 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400"
					>
						Status
					</label>
					<select
						id="slide-status"
						disabled={detail.status === 'Under Review'}
						value={localStatus}
						onchange={async (e) => {
							const el = e.currentTarget as HTMLSelectElement;
							const ok = await patch({ status: el.value });
							if (!ok && detail) el.value = detail.status;
						}}
						class="input flex-1 px-2.5 py-1.5 text-xs"
					>
						{#each statusOptions as s}
							<option value={s}>{s}</option>
						{/each}
					</select>
				</div>

				<!-- Assigned To -->
				<div class="flex items-center gap-3">
					<label
						for="slide-assignee"
						class="w-24 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400"
					>
						Assigned To
					</label>
					<select
						id="slide-assignee"
						disabled={detail.status === 'Under Review'}
						value={localAssignedTo}
						onchange={async (e) => {
							const el = e.currentTarget as HTMLSelectElement;
							const ok = await patch({ assigned_to: el.value || null });
							if (!ok && detail) el.value = detail.assigned_to ?? '';
						}}
						class="input flex-1 px-2.5 py-1.5 text-xs"
					>
						<option value="">Unassigned</option>
						{#each staff as person}
							<option value={person.id}>{person.full_name ?? person.id.slice(0, 8)}</option>
						{/each}
					</select>
				</div>

				<p class="text-right text-[11px] text-slate-300 dark:text-slate-600">
					{detail.status === 'Under Review'
						? 'Locked until peer review closes'
						: 'Changes save automatically'}
				</p>
			</div>

			<!-- ── Status History ─────────────────────────────────────────────── -->
			{#if detail.status_logs.length > 0}
				<div class="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
					<p
						class="mb-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500"
					>
						Status History
					</p>
					<ol class="space-y-3">
						{#each detail.status_logs as log}
							<li class="flex items-start gap-3">
								<div
									class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center
								            rounded-full bg-slate-100 text-[11px] font-bold text-slate-500 dark:bg-slate-800/60 dark:text-slate-400"
								>
									{initials(log.actor?.full_name ?? null)}
								</div>
								<div>
									<p class="text-xs text-slate-700 dark:text-slate-300">
										<span class="font-medium">{log.from_status ?? '—'}</span>
										<span class="mx-1 text-slate-400 dark:text-slate-500">→</span>
										<span class="font-medium">{log.to_status}</span>
									</p>
									{#if log.note}
										<p class="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{log.note}</p>
									{/if}
									<p class="mt-0.5 text-[11px] text-slate-300 dark:text-slate-600">
										{formatDateTime(log.changed_at)}
									</p>
								</div>
							</li>
						{/each}
					</ol>
				</div>
			{/if}

			<!-- ── Comments Thread ────────────────────────────────────────────── -->
			<div class="px-5 py-4">
				<p
					class="mb-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500"
				>
					Internal Comments ({localComments.length})
				</p>

				{#if localComments.length > 0}
					<div class="mb-4 space-y-3">
						{#each localComments as comment (comment.id)}
							<div class="flex gap-2.5">
								<div
									class="flex h-6 w-6 shrink-0 items-center justify-center
								            rounded-full bg-signal-100 text-[11px] font-bold text-signal-600 dark:bg-signal-500/15 dark:text-signal-400"
								>
									{initials(comment.author?.full_name ?? null)}
								</div>
								<div class="flex-1">
									<div class="flex items-center gap-2">
										<span class="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
											{comment.author?.full_name ?? 'Staff'}
										</span>
										<span class="text-[11px] text-slate-300 dark:text-slate-600">
											{formatDateTime(comment.created_at)}
										</span>
									</div>
									<p class="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
										{comment.body}
									</p>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="mb-4 text-xs text-slate-300 dark:text-slate-600">No comments yet.</p>
				{/if}

				<!-- Comment input -->
				{#if detail.status === 'Under Review'}
					<p class="rounded-md bg-slate-50 px-3 py-2 text-xs text-ink-muted dark:bg-slate-800/50">
						Comments are locked so reviewers can decide independently.
					</p>
				{:else}
					<div class="space-y-2">
						{#if commentError}
							<p
								class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400"
							>
								{commentError}
							</p>
						{/if}
						<textarea
							bind:value={newCommentText}
							placeholder="Add an internal comment…"
							rows="3"
							class="input resize-none text-xs"></textarea>
						<button
							onclick={submitComment}
							disabled={submitting || !newCommentText.trim()}
							class="btn-primary w-full px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
						>
							{submitting ? 'Posting…' : 'Post Comment'}
						</button>
					</div>
				{/if}
			</div>
		{:else if !loading}
			<!-- Empty state — open=true but detail not loaded yet (edge case) -->
			<div class="flex h-full items-center justify-center p-8 text-slate-300 dark:text-slate-600">
				<p class="text-sm">No issue selected.</p>
			</div>
		{/if}
	</div>
	<!-- /body -->
</div>
