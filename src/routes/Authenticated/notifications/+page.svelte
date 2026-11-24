<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import type { PageData } from './$types';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import {
		CATEGORY_LABELS,
		CATEGORY_ORDER,
		isNotificationCategory,
		type AppNotification,
		type NotificationCategory
	} from '$lib/types/notifications';
	import { formatDateTime, formatRelative } from '$lib/utils/format';

	let { data }: { data: PageData } = $props();

	let marking = $state(false);

	const SEVERITY_META: Record<
		string,
		{ label: string; rail: string; text: string; badge: string }
	> = {
		critical: {
			label: 'Critical',
			rail: 'bg-rose-500',
			text: 'text-rose-600 dark:text-rose-400',
			badge:
				'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
		},
		warning: {
			label: 'Warning',
			rail: 'bg-amber-500',
			text: 'text-amber-600 dark:text-amber-400',
			badge:
				'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
		},
		info: {
			label: 'Info',
			rail: 'bg-signal-500',
			text: 'text-signal-600 dark:text-signal-400',
			badge:
				'border-signal-200 bg-signal-50 text-signal-700 dark:border-signal-500/30 dark:bg-signal-500/10 dark:text-signal-300'
		}
	};

	const meta = (n: AppNotification) => SEVERITY_META[n.severity] ?? SEVERITY_META.info;

	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

	async function markAllRead(): Promise<void> {
		marking = true;
		try {
			await fetch('/api/notifications/read', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ all: true })
			});
			await invalidate('notifications:feed');
		} finally {
			marking = false;
		}
	}

	async function markOne(id: string): Promise<void> {
		await fetch('/api/notifications/read', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ids: [id] })
		});
		await invalidate('notifications:feed');
	}

	function hrefFor(
		filters: { category: NotificationCategory | null; unreadOnly: boolean },
		page: number
	): string {
		const params = new URLSearchParams();
		if (filters.category) params.set('category', filters.category);
		if (filters.unreadOnly) params.set('unread', '1');
		if (page > 1) params.set('page', String(page));
		const qs = params.toString();
		return qs ? `?${qs}` : '/Authenticated/notifications';
	}
</script>

<div class="p-6 lg:p-8">
	<div class="mb-8">
		<PageHeader
			icon="bell"
			title="Notifications"
			subtitle="Peer-review assignments, decisions, and topic trend alerts."
		/>
	</div>

	{#if data.unavailable}
		<div class="card card-pad">
			<h2 class="text-base font-semibold text-ink">Notifications aren't set up yet</h2>
			<p class="mt-2 text-sm text-ink-muted">
				The notifications store hasn't been created in this environment. Apply
				<code class="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs dark:bg-slate-800"
					>014_trend_notifications.sql</code
				> to Supabase and reload.
			</p>
		</div>
	{:else}
		<!-- ── Filters ─────────────────────────────────────────────────────── -->
		<div class="mb-5 flex flex-wrap items-center gap-3">
			<div class="segmented">
				<a
					href={hrefFor({ category: null, unreadOnly: data.filters.unreadOnly }, 1)}
					class="segmented-btn"
					class:segmented-btn-active={!data.filters.category}
				>
					All
				</a>
				{#each CATEGORY_ORDER as category (category)}
					<a
						href={hrefFor({ category, unreadOnly: data.filters.unreadOnly }, 1)}
						class="segmented-btn"
						class:segmented-btn-active={data.filters.category === category}
					>
						{CATEGORY_LABELS[category]}
					</a>
				{/each}
			</div>

			<label class="flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
				<input
					type="checkbox"
					checked={data.filters.unreadOnly}
					onchange={(e) =>
						goto(
							e.currentTarget.checked
								? '/Authenticated/notifications?unread=1'
								: '/Authenticated/notifications'
						)}
					class="rounded border-line text-signal-600 focus:ring-signal-300 dark:border-slate-600 dark:bg-slate-800"
				/>
				Unread only
			</label>

			<div class="ml-auto flex items-center gap-3">
				{#if data.unread > 0}
					<span class="telemetry">{data.unread} unread</span>
					<button
						type="button"
						onclick={markAllRead}
						disabled={marking}
						class="btn-secondary px-3 py-1.5 text-xs"
					>
						{marking ? 'Marking…' : 'Mark all read'}
					</button>
				{/if}
			</div>
		</div>

		<!-- ── Feed ────────────────────────────────────────────────────────── -->
		{#if data.notifications.length === 0}
			<div class="card card-pad text-center">
				<p class="text-sm font-semibold text-ink">No notifications match these filters</p>
				<p class="mx-auto mt-1.5 max-w-md text-sm text-ink-muted">
					Trend alerts appear here when a topic's priority score crosses a threshold, moves sharply,
					or takes the top spot. Scores are recalculated as you use the app, so a change that
					happened while you were away shows up on your next visit.
				</p>
			</div>
		{:else}
			<ul class="card divide-y divide-line overflow-hidden">
				{#each data.notifications as n (n.id)}
					{@const m = meta(n)}
					<li class="flex gap-4 p-5 {n.read_at === null ? 'bg-signal-50/30' : ''}">
						<span class="mt-1 w-1 shrink-0 self-stretch rounded-full {m.rail}"></span>

						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<span
									class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase {m.badge}"
								>
									{m.label}
								</span>
								{#if isNotificationCategory(n.category)}
									<span class="text-[10px] font-semibold tracking-widest text-ink-faint uppercase">
										{CATEGORY_LABELS[n.category]}
									</span>
								{/if}
								{#if n.read_at === null}
									<span class="h-1.5 w-1.5 rounded-full bg-rose-500" title="Unread"></span>
								{/if}
							</div>

							<h2 class="mt-2 text-sm font-semibold text-ink">{n.title}</h2>
							{#if n.body}
								<p class="mt-1 text-sm leading-relaxed text-ink-muted">{n.body}</p>
							{/if}

							<p class="mt-2 text-[11px] text-ink-faint">
								<time datetime={n.created_at} title={formatDateTime(n.created_at)}>
									{formatRelative(n.created_at)}
								</time>
							</p>
						</div>

						<div class="flex shrink-0 flex-col items-end gap-2">
							{#if n.href}
								<a href={n.href} class="btn-secondary px-3 py-1.5 text-xs">Open</a>
							{/if}
							{#if n.read_at === null}
								<button
									type="button"
									onclick={() => markOne(n.id)}
									class="text-[11px] font-semibold text-ink-muted hover:text-ink"
								>
									Mark read
								</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>

			<!-- ── Pagination ────────────────────────────────────────────────── -->
			{#if totalPages > 1}
				<nav class="mt-5 flex items-center justify-between" aria-label="Pagination">
					{#if data.page > 1}
						<a
							href={hrefFor(data.filters, data.page - 1)}
							class="btn-secondary px-3 py-1.5 text-xs"
						>
							← Previous
						</a>
					{:else}
						<span></span>
					{/if}

					<span class="telemetry">Page {data.page} of {totalPages}</span>

					{#if data.page < totalPages}
						<a
							href={hrefFor(data.filters, data.page + 1)}
							class="btn-secondary px-3 py-1.5 text-xs"
						>
							Next →
						</a>
					{:else}
						<span></span>
					{/if}
				</nav>
			{/if}
		{/if}
	{/if}
</div>
