<script lang="ts">
	// Notification bell + dropdown panel.
	//
	// Self-contained: owns its own data fetching and open/close state so the
	// layout only has to place it. Mirrors IssueTracker.svelte's approach —
	// a widget that fetches what it needs rather than receiving props.
	//
	// IMPORTANT (CONTEXT.md): this panel is position:absolute, so NO ancestor
	// may carry a non-`none` transform or it becomes the containing block and
	// the panel detaches from the button. The entrance animation below
	// therefore ends at `transform: none`, not `translateY(0)` with
	// `fill-mode: both` — the latter is exactly the pattern that breaks the
	// Toast portal and any other fixed/absolute descendant.

	import { untrack } from 'svelte';
	import { startSummaryPolling } from '$lib/utils/summary-polling';
	import { goto } from '$app/navigation';
	import SidebarIcon from '$lib/components/SidebarIcon.svelte';
	import type { AppNotification } from '$lib/types/notifications';
	import { formatRelative } from '$lib/utils/format';

	interface Props {
		/** SSR-seeded unread count so the badge is correct on first paint. */
		initialUnread?: number;
		initialFetchedAt?: number;
		/** Poll cadence in ms. 0 disables polling (used in tests). */
		pollIntervalMs?: number;
	}

	let {
		initialUnread = 0,
		initialFetchedAt = Date.now(),
		pollIntervalMs = 60_000
	}: Props = $props();

	let unread = $state(untrack(() => initialUnread));
	let lastFetchedAt = untrack(() => initialFetchedAt);
	let feedRequest: Promise<void> | null = null;
	let items = $state<AppNotification[]>([]);
	let open = $state(false);
	let loading = $state(false);
	let loaded = $state(false);
	let root: HTMLElement | null = $state(null);
	let error = $state<string | null>(null);

	// Keep the badge honest if the layout re-seeds it (e.g. after a nav).
	$effect(() => {
		const seed = { unread: initialUnread, fetchedAt: initialFetchedAt };
		untrack(() => {
			if (seed.fetchedAt > lastFetchedAt) {
				unread = seed.unread;
				lastFetchedAt = seed.fetchedAt;
			}
		});
	});

	const SEVERITY_RAIL: Record<string, string> = {
		critical: 'bg-rose-500',
		warning: 'bg-amber-500',
		info: 'bg-signal-500'
	};

	const SEVERITY_TEXT: Record<string, string> = {
		critical: 'text-rose-600 dark:text-rose-400',
		warning: 'text-amber-600 dark:text-amber-400',
		info: 'text-signal-600 dark:text-signal-400'
	};

	const SEVERITY_LABEL: Record<string, string> = {
		critical: 'Critical',
		warning: 'Warning',
		info: 'Info'
	};

	async function readFeed(): Promise<void> {
		try {
			const res = await fetch('/api/notifications?limit=20');
			if (!res.ok) return;
			const body = (await res.json()) as {
				notifications?: AppNotification[];
				unread?: number;
				fetchedAt?: number;
			};
			items = body.notifications ?? [];
			if (typeof body.unread === 'number') unread = body.unread;
			error = null;
			loaded = true;
			lastFetchedAt = body.fetchedAt ?? Date.now();
		} catch {
			// Transient failure — keep whatever is on screen until the next tick.
		}
	}

	function fetchFeed(): Promise<void> {
		if (!feedRequest)
			feedRequest = readFeed().finally(() => {
				feedRequest = null;
			});
		return feedRequest;
	}

	async function openPanel(): Promise<void> {
		open = true;
		if (!loaded) {
			loading = true;
			await fetchFeed();
			loading = false;
		}
	}

	function close(): void {
		open = false;
	}

	async function markAllRead(): Promise<void> {
		try {
			const res = await fetch('/api/notifications/read', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ all: true })
			});
			if (!res.ok) return;
			const body = (await res.json()) as { unread?: number };
			unread = body.unread ?? 0;
			items = items.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }));
		} catch {
			// Non-fatal; the next poll reconciles.
		}
	}

	async function openItem(n: AppNotification): Promise<void> {
		if (!n.read_at) {
			// Optimistic: the row dims immediately, reconciled by the next poll.
			items = items.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i));
			if (unread > 0) unread--;
			try {
				await fetch('/api/notifications/read', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ids: [n.id] })
				});
			} catch {
				// Non-fatal.
			}
		}
		close();
		if (n.href) await goto(n.href);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			event.stopPropagation();
			close();
		}
	}

	$effect(() => {
		if (pollIntervalMs <= 0) return;

		// Poll only while the tab is visible. A backgrounded tab is exactly the
		// case where the catch-up sweep in the evaluator already covers us, so
		// ticking there would be wasted round-trips. Pattern mirrors
		// IssueTracker.svelte's guarded interval.
		return startSummaryPolling(() => lastFetchedAt, fetchFeed, pollIntervalMs);
	});
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:document
	onclick={(e) => {
		// Click-outside close. root is null until mounted, so guard it.
		if (open && root && !root.contains(e.target as Node)) close();
	}}
/>

<div class="relative" bind:this={root}>
	<button
		type="button"
		onclick={() => (open ? close() : openPanel())}
		class="flex w-full items-center justify-center rounded-md p-2.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
		title="Notifications"
		aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
		aria-haspopup="dialog"
		aria-expanded={open}
	>
		<span class="relative inline-flex">
			<SidebarIcon name="bell" class="h-4 w-4" />
			{#if unread > 0}
				<span
					class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white tabular-nums"
				>
					{unread > 99 ? '99+' : unread}
				</span>
			{/if}
		</span>
	</button>

	<!-- Announced when the count changes, without stealing focus. -->
	<p class="sr-only" aria-live="polite" role="status">
		{unread > 0
			? `${unread} unread notification${unread === 1 ? '' : 's'}`
			: 'No unread notifications'}
	</p>

	{#if open}
		<!-- Opens rightward (`left-full`), not leftward. The bell sits in the
		     sidebar's leftmost ~50px, so anchoring a w-80 panel to the button's
		     RIGHT edge (`right-0`) pushed ~276px of it past the viewport's left
		     edge — only 14% was reachable. `left-full` keeps the whole panel on
		     screen in both the expanded and collapsed sidebar. The app root is
		     `h-screen overflow-hidden`, so the panel needs no extra scroll guard
		     and cannot introduce a page-level horizontal scrollbar. -->
		<div
			role="dialog"
			aria-label="Notifications"
			class="absolute bottom-full left-full z-50 ml-2 w-80 origin-bottom-left overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
		>
			<div class="flex items-center justify-between border-b border-line px-4 py-3">
				<h2 class="text-sm font-semibold text-ink">Notifications</h2>
				{#if unread > 0}
					<button
						type="button"
						onclick={markAllRead}
						class="text-xs font-semibold text-signal-600 hover:text-signal-700 dark:text-signal-400 dark:hover:text-signal-300"
					>
						Mark all read
					</button>
				{/if}
			</div>

			<div class="max-h-96 overflow-y-auto">
				{#if loading && !loaded}
					<p class="px-4 py-8 text-center text-sm text-ink-muted">Loading…</p>
				{:else if items.length === 0}
					<div class="px-4 py-8 text-center">
						<p class="text-sm font-medium text-ink">Nothing new right now</p>
						<p class="mt-1 text-xs text-ink-muted">
							You'll be alerted when an issue topic's priority score spikes or a new topic takes the
							top spot.
						</p>
					</div>
				{:else}
					<ul class="divide-y divide-line">
						{#each items as n (n.id)}
							<li>
								<button
									type="button"
									onclick={() => openItem(n)}
									class="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 {n.read_at
										? 'opacity-60'
										: 'bg-signal-50/40'}"
								>
									<!-- Severity rail — the at-a-glance signal. -->
									<span
										class="mt-1 w-0.5 shrink-0 self-stretch rounded-full {SEVERITY_RAIL[
											n.severity
										] ?? SEVERITY_RAIL.info}"
									></span>
									<span class="min-w-0 flex-1">
										<span class="flex items-center gap-2">
											<span
												class="text-[10px] font-bold tracking-widest uppercase {SEVERITY_TEXT[
													n.severity
												] ?? SEVERITY_TEXT.info}"
											>
												{SEVERITY_LABEL[n.severity] ?? 'Info'}
											</span>
											{#if !n.read_at}
												<span class="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
											{/if}
										</span>
										<span class="mt-0.5 block text-sm font-semibold text-ink">{n.title}</span>
										{#if n.body}
											<span class="mt-0.5 block text-xs leading-relaxed text-ink-muted"
												>{n.body}</span
											>
										{/if}
										<span class="mt-1 block text-[11px] text-ink-faint">
											{formatRelative(n.created_at)}
										</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="border-t border-line bg-slate-50/60 px-4 py-2.5 text-center dark:bg-slate-800/40">
				<a
					href="/Authenticated/notifications"
					onclick={close}
					class="text-xs font-semibold text-signal-600 hover:text-signal-700 dark:text-signal-400 dark:hover:text-signal-300"
				>
					View all notifications
				</a>
			</div>
		</div>
	{/if}
</div>
