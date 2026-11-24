<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { startSummaryPolling } from '$lib/utils/summary-polling';
	import { page, navigating } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import { createTabRegistry } from '$lib/tab-registry';
	import type { Snippet } from 'svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import BrandPulse from '$lib/components/BrandPulse.svelte';
	import SidebarIcon from '$lib/components/SidebarIcon.svelte';
	import NotificationBell from '$lib/components/NotificationBell.svelte';

	let { children }: { children: Snippet } = $props();

	// ── Role — resolved server-side; never trust client-supplied values ──────
	// $derived uses Svelte 5 runtime signal tracking: reading page.data.role
	// inside the expression automatically registers it as a dependency, so this
	// re-evaluates whenever the page store updates (e.g. after navigation).
	let role = $derived((page.data?.role ?? 'analyst') as 'admin' | 'analyst');

	// ── Auto-logout on last-tab / window close ───────────────────────────────
	//
	// Auth cookies are session-scoped (see src/lib/session-cookies.ts), so
	// closing the *browser* always logs the user out — that's the
	// deterministic layer and needs no JS. This block handles the case the
	// cookies can't: closing the *last tab* while the browser keeps running,
	// which also revokes the refresh token server-side and writes an
	// auth.logout audit row.
	//
	// Why pagehide:
	//   It fires when a document is being discarded, and — unlike
	//   beforeunload — never blocks or prompts. Crucially, SvelteKit
	//   client-side navigations do NOT fire pagehide at all: the document is
	//   never torn down. So there is no in-app navigation to disambiguate
	//   against. (The previous implementation gated on an `isNavigating`
	//   flag set by beforeNavigate and cleared inside pagehide — a bug,
	//   because nothing ever cleared it on an SPA navigation, so the beacon
	//   was suppressed forever after the user's first sidebar click.)
	//
	//   event.persisted === true means the page is entering the
	//   back/forward cache and may be restored — not a close, so skip it.
	//
	// Why sendBeacon and not fetch:
	//   Regular fetch() is cancelled by the browser on unload. sendBeacon()
	//   is designed for exactly this and is delivered after the page is gone.
	//
	// Multi-tab:
	//   Closing any one tab must not sign the user out of the others. Each tab
	//   registers a heartbeat key in localStorage; the closing tab removes its
	//   own and only sends the beacon if no other *fresh* key remains.
	//   Simultaneous closes of two tabs can race here — each may still see
	//   the other's key and neither beacons. That is acceptable: a full
	//   browser close drops the session cookies anyway, so the worst case is
	//   one extra login, never a stuck session.
	//
	// The key prefix and heartbeat intervals live in $lib/tab-registry.

	// Sidebar badges used to refresh on every navigation via the SSR layout
	// re-run. The layout no longer re-runs client-side, so top up the counts
	// here — throttled to 45s to mirror the old server TTL.
	beforeNavigate(() => {
		void refreshBadges();
	});

	// ── Live sidebar badge counts ────────────────────────────────────────────
	// SSR seeds these from the layout server load on full page loads; a 45s
	// throttled fetch (session-gated /api/sidebar-badges) keeps them fresh
	// between navigations without re-running the whole Authenticated SSR layout.
	let pendingCount = $state((page.data?.pendingCount as number) ?? 0);
	let myTaskCount = $state((page.data?.myTaskCount as number) ?? 0);
	let lastBadgeFetch = $state(untrack(() => (page.data?.badgesFetchedAt as number) ?? 0));
	let badgeRequestPending = false;
	$effect(() => {
		const seed = {
			pending: (page.data?.pendingCount as number) ?? 0,
			myTasks: (page.data?.myTaskCount as number) ?? 0,
			fetchedAt: (page.data?.badgesFetchedAt as number) ?? 0
		};
		untrack(() => {
			// Client navigation can carry the original layout seed again.
			// It must not replace a newer poll result with older counts.
			if (seed.fetchedAt > lastBadgeFetch) {
				pendingCount = seed.pending;
				myTaskCount = seed.myTasks;
				lastBadgeFetch = seed.fetchedAt;
			}
		});
	});
	const BADGE_TTL_MS = 45_000;

	async function refreshBadges(): Promise<void> {
		const now = Date.now();
		if (
			document.visibilityState !== 'visible' ||
			badgeRequestPending ||
			now - lastBadgeFetch < BADGE_TTL_MS
		)
			return;
		badgeRequestPending = true;
		try {
			const res = await fetch('/api/sidebar-badges');
			if (!res.ok) return;
			const b = (await res.json()) as { pending?: number; my_tasks?: number; fetchedAt?: number };
			pendingCount = b.pending ?? pendingCount;
			myTaskCount = b.my_tasks ?? myTaskCount;
			lastBadgeFetch = b.fetchedAt ?? Date.now();
		} catch {
			// Keep current counts and retry on the next scheduled tick.
		} finally {
			badgeRequestPending = false;
		}
	}

	onMount(() => {
		// Top up badge counts shortly after mount so they're fresh even if the
		// SSR layout load resolved more than 45s ago (e.g. after a long login).
		const stopPolling = startSummaryPolling(() => lastBadgeFetch, refreshBadges);

		// Announce this tab so a sibling tab closing can tell it isn't the last.
		const tabs = createTabRegistry(localStorage);
		const leaveTabs = tabs.join();

		function handlePageHide(event: PageTransitionEvent) {
			// persisted === true → entering bfcache, may be restored. Not a close.
			if (event.persisted) return;

			// Remove our stamp and check for survivors. Only the last tab out
			// revokes the session — otherwise closing one tab would sign the
			// user out of the dashboard+stream tabs they still have open.
			const wasLastTab = tabs.leave();
			if (!wasLastTab) return;

			// sendBeacon is fire-and-forget; the browser queues it reliably
			// even as this document is being destroyed.
			navigator.sendBeacon('/api/logout-beacon');
		}

		window.addEventListener('pagehide', handlePageHide);
		return () => {
			stopPolling();
			window.removeEventListener('pagehide', handlePageHide);
			leaveTabs();
		};
	});

	interface NavItem {
		label: string;
		href: string;
		badge?: number;
		icon: 'dashboard' | 'stream' | 'flagged' | 'verified' | 'docs' | 'issues' | 'reports' | 'admin';
	}

	// ── Nav items ────────────────────────────────────────────────────────────
	// $derived re-runs whenever `role` or `page` changes, rebuilding the nav
	// list (which controls whether the Admin Config link is shown).
	let navItems = $derived([
		{ label: 'Dashboard', href: '/Authenticated/dashboard', icon: 'dashboard' as const },
		{ label: 'Live Data Stream', href: '/Authenticated/live-data-stream', icon: 'stream' as const },
		{
			label: 'Flagged Claims',
			href: '/Authenticated/flagged-claims',
			icon: 'flagged' as const,
			badge: pendingCount
		},
		{ label: 'Verified Claims', href: '/Authenticated/verified-claims', icon: 'verified' as const },
		{ label: 'Reference Docs', href: '/Authenticated/reference-docs', icon: 'docs' as const },
		{
			label: 'Issue Tracker',
			href: '/Authenticated/issues',
			icon: 'issues' as const,
			badge: myTaskCount
		},
		{ label: 'Reports', href: '/Authenticated/reports', icon: 'reports' as const },
		...(role === 'admin'
			? [{ label: 'Admin Config', href: '/Authenticated/admin', icon: 'admin' as const }]
			: [])
	] satisfies NavItem[]);

	// $derived on page.url.pathname: Svelte 5 tracks the read at runtime, so
	// currentPath updates on every client-side navigation without needing a
	// store subscription or $: reactive label.
	let currentPath = $derived(page.url.pathname);

	// isActive reads `currentPath` — because currentPath is $derived, Svelte 5
	// tracks the read inside this function when it is called from the template,
	// making the nav item re-evaluate on every route change.
	function isActive(href: string): boolean {
		if (href === '/') return currentPath === '/';
		return currentPath.startsWith(href);
	}

	let collapsed = $state(false);
	let isLoginPage = $derived(currentPath === '/login');
</script>

<div class="flex h-screen overflow-hidden font-sans">
	<!-- Instant navigation feedback: shown while the SSR data pass for the next
	     page is in flight, so clicks never stall on a blank main area. -->
	{#if navigating.type}
		<div
			class="pointer-events-none fixed inset-x-0 top-0 z-60 h-0.5 animate-pulse bg-signal-500/70"
			aria-hidden="true"
		></div>
	{/if}
	{#if !isLoginPage}
		<!-- ══════════════════════════════════════════
		    SIDEBAR
		    ══════════════════════════════════════════ -->
		<aside
			class="flex shrink-0 flex-col border-r border-slate-200/80 bg-white shadow-sm transition-all duration-300 ease-in-out dark:border-slate-800 dark:bg-slate-900"
			class:w-64={!collapsed}
			class:w-16={collapsed}
		>
			<!-- ── Brand ──────────────────────────────── -->
			<div
				class="flex items-center gap-3 overflow-hidden border-b border-line px-4 py-5 dark:border-slate-800"
			>
				<!-- Civic Pulse brand mark -->
				<div
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-signal-100 bg-signal-50 text-signal-600 shadow-sm dark:border-signal-900/60 dark:bg-signal-950/60 dark:text-signal-400"
				>
					<img
						src="/img/civic-pulse-mark.png"
						alt=""
						class="h-6 w-6 object-contain dark:brightness-150"
						width="24"
						height="24"
					/>
				</div>

				{#if !collapsed}
					<div class="overflow-hidden">
						<p
							class="font-display text-xl leading-none whitespace-nowrap text-ink dark:text-slate-100"
						>
							Civic Pulse
						</p>
						<p
							class="mt-1.5 flex items-center gap-2 text-xs font-medium whitespace-nowrap text-slate-400 dark:text-slate-400"
						>
							<span>Pulilan LGU Engine</span>
							<!-- Role badge -->
							<span
								class="ml-1 rounded border border-signal-100 bg-signal-50 px-1.5 py-0.5 text-[11px] font-bold text-signal-600 uppercase dark:border-signal-900/60 dark:bg-signal-950/60 dark:text-signal-400"
							>
								{role}
							</span>
						</p>
						<!-- ECG pulse line under the wordmark -->
						<BrandPulse width="120" class="mt-2 -ml-1 opacity-60" />
					</div>
				{/if}
			</div>

			<!-- ── Nav Items ───────────────────────────── -->
			<nav class="flex-1 space-y-1 overflow-x-hidden overflow-y-auto px-3 py-4">
				{#each navItems as item}
					{@const active = isActive(item.href)}
					{@const isAdminLink = item.label === 'Admin Config'}
					<a
						href={item.href}
						class="group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-signal-400/40"
						class:bg-slate-800={active && isAdminLink}
						class:bg-signal-600={active && !isAdminLink}
						class:text-white={active}
						class:shadow-sm={active}
						class:text-slate-600={!active}
						class:hover:bg-slate-100={!active}
						class:hover:text-slate-900={!active}
						class:dark:text-slate-400={!active}
						class:dark:hover:bg-slate-800={!active}
						class:dark:hover:text-slate-100={!active}
						title={collapsed ? item.label : undefined}
					>
						<!-- Collapsed active indicator -->
						{#if active && collapsed}
							<span
								class="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-white"
							></span>
						{/if}

						<!-- Icon -->
						<span class="h-4 w-4 shrink-0">
							<SidebarIcon name={item.icon} class="h-4 w-4" />
						</span>

						<!-- Label + badge (expanded) -->
						{#if !collapsed}
							<span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
								>{item.label}</span
							>
							{#if item.badge}
								<!-- Active: white/20 tint over blue; inactive: rose pill -->
								<span
									class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums {active
										? 'bg-white/20 text-white'
										: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'}"
								>
									{item.badge}
								</span>
							{/if}
						{:else if item.badge}
							<!-- Dot badge when collapsed -->
							<span class="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500"></span>
						{/if}
					</a>
				{/each}
			</nav>

			<!-- ── System Status ───────────────────────── -->
			{#if !collapsed}
				<div class="card mx-3 mb-3 p-4">
					<div class="mb-2 flex items-center gap-2">
						<span class="pulse-dot bg-emerald-500"></span>
						<span class="micro-label text-ink-faint">System Status</span>
					</div>
					<p class="text-sm font-medium text-ink">NLP Engine Online</p>
					<p class="telemetry mt-1">Processing 12 feeds/min</p>
				</div>
			{:else}
				<div class="mb-4 flex justify-center">
					<span class="pulse-dot bg-emerald-500"></span>
				</div>
			{/if}

			<!-- ── Bottom Actions ──────────────────────── -->
			<div class="border-t border-slate-100 px-2 py-3 dark:border-slate-800">
				{#if !collapsed}
					<!-- Expanded: Notifications + Settings + Theme Toggle + Logout + Collapse — all equal icon buttons -->
					<div class="flex items-center gap-1">
						<!-- Notifications -->
						<div class="flex flex-1">
							<NotificationBell
								initialUnread={(page.data?.unreadCount as number) ?? 0}
								initialFetchedAt={(page.data?.unreadFetchedAt as number) ?? 0}
							/>
						</div>

						<!-- Settings -->
						<a
							href="/Authenticated/settings"
							class="flex flex-1 items-center justify-center rounded-md p-2.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
							title="Settings"
						>
							<svg
								class="h-4 w-4"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<circle cx="12" cy="12" r="3" />
								<path
									d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
								/>
							</svg>
						</a>

						<!-- Theme Toggle -->
						<ThemeToggle />

						<!-- Logout -->
						<form method="POST" action="/logout" class="flex flex-1">
							<button
								type="submit"
								title="Log out"
								class="flex w-full items-center justify-center rounded-md p-2.5 text-rose-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
							>
								<svg
									class="h-4 w-4"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
									<polyline points="16 17 21 12 16 7" />
									<line x1="21" y1="12" x2="9" y2="12" />
								</svg>
							</button>
						</form>

						<!-- Collapse -->
						<button
							onclick={() => (collapsed = true)}
							class="flex flex-1 items-center justify-center rounded-md p-2.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
							title="Collapse sidebar"
							aria-label="Collapse sidebar"
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
								<polyline points="11 17 6 12 11 7" />
								<polyline points="18 17 13 12 18 7" />
							</svg>
						</button>
					</div>
				{:else}
					<!-- Collapsed: Notifications + ThemeToggle + expand button, stacked.
					     A horizontal row here cannot fit: the sidebar is w-16 (64px)
					     less px-2 padding = 48px, but three 36px controls plus gaps
					     need ~116px. Stacking matches how the nav section collapses.

					     All three are deliberately the SAME box: a `w-9` wrapper around
					     a `flex w-full items-center justify-center p-2.5` button with a
					     centred 16px icon. Keep them identical — an earlier version
					     stripped the theme toggle's horizontal padding via a `!px-0`
					     override, which made it the odd one out visually. Note that a
					     16px <svg> has an intrinsic min-content width, so without the
					     `w-9` wrapper these buttons cannot shrink to fit a row. -->
					<div class="flex flex-col items-center gap-1">
						<div class="w-9">
							<NotificationBell
								initialUnread={(page.data?.unreadCount as number) ?? 0}
								initialFetchedAt={(page.data?.unreadFetchedAt as number) ?? 0}
							/>
						</div>
						<div class="w-9">
							<ThemeToggle />
						</div>
						<div class="w-9">
							<button
								onclick={() => (collapsed = false)}
								class="flex w-full items-center justify-center rounded-md p-2.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
								title="Expand sidebar"
								aria-label="Expand sidebar"
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
									<polyline points="13 17 18 12 13 7" />
									<polyline points="6 17 11 12 6 7" />
								</svg>
							</button>
						</div>
					</div>
				{/if}
			</div>
		</aside>
	{/if}

	<!-- ══════════════════════════════════════════
	    MAIN CONTENT SLOT
	    ══════════════════════════════════════════ -->
	<main class="flex-1 overflow-x-hidden overflow-y-auto" class:w-full={isLoginPage}>
		{@render children()}
	</main>
</div>
