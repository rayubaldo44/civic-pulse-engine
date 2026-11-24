<script lang="ts">
	import type { PageData } from './$types';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Toast from '$lib/components/Toast.svelte';

	let { data }: { data: PageData } = $props();

	let toastRef: Toast;

	// ── Pagination ────────────────────────────────────────────────────────────
	let totalPages = $derived(Math.ceil(data.total / data.pageSize));

	function pageUrl(p: number) {
		const params = new URLSearchParams({
			action: data.filters.action,
			actor: data.filters.actor,
			details: data.filters.details,
			resource_type: data.filters.resourceType,
			page: String(p)
		});
		return `?${params.toString()}`;
	}

	// ── Action badge colour ───────────────────────────────────────────────────
	function actionColour(action: string): string {
		const a = action.toLowerCase();
		if (a.includes('boot') || a.includes('start'))
			return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400';
		if (a.includes('index') || a.includes('embed'))
			return 'bg-signal-50 text-signal-700 dark:bg-signal-500/10 dark:text-signal-400';
		if (a.includes('verif') || a.includes('check'))
			return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
		if (a.includes('error') || a.includes('fail'))
			return 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400';
		if (a.includes('login') || a.includes('auth'))
			return 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400';
		return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
	}
</script>

<Toast bind:this={toastRef} />

<!-- ── Page Shell ─────────────────────────────────────────────────────────── -->
<div class="p-6 lg:p-8">
	<!-- Header -->
	<div class="mb-8">
		<PageHeader
			icon="reports"
			title="Reports &amp; Audit Log"
			subtitle="Export data and review the immutable system event log."
		/>
	</div>

	<!-- ══════════════════════════════════════════════════════════════════════
	     EXPORT SECTION
	     ══════════════════════════════════════════════════════════════════════ -->
	<section class="card card-pad mb-8">
		<h2 class="mb-1 text-base font-semibold text-slate-700 dark:text-slate-300">Export Reports</h2>
		<p class="mb-5 text-xs text-slate-400 dark:text-slate-500">
			Reports are generated server-side from live data.
		</p>

		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<!-- Weekly Summary PDF -->
			<a
				href="/api/reports/weekly-summary"
				onclick={() => toastRef?.show('Download started — check your downloads folder')}
				class="group card flex flex-col gap-3 p-5 transition-all duration-200 hover:border-signal-300 hover:shadow-md dark:hover:border-signal-500/40"
				download
			>
				<span
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-signal-50 text-signal-700 transition-colors group-hover:bg-signal-100 dark:bg-signal-500/10 dark:text-signal-400 dark:group-hover:bg-signal-500/20"
				>
					<svg
						class="h-5 w-5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
						<polyline points="14 2 14 8 20 8" />
						<line x1="16" y1="13" x2="8" y2="13" />
						<line x1="16" y1="17" x2="8" y2="17" />
						<line x1="10" y1="9" x2="8" y2="9" />
					</svg>
				</span>
				<div>
					<p class="text-sm font-semibold text-slate-700 dark:text-slate-300">Weekly Summary</p>
					<p class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">PDF · Last 7 days</p>
				</div>
				<span class="mt-auto inline-flex items-center gap-1 text-xs font-medium text-signal-600">
					Download PDF
					<svg
						class="h-3.5 w-3.5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<polyline points="7 10 12 15 17 10" />
						<line x1="12" y1="15" x2="12" y2="3" />
					</svg>
				</span>
			</a>

			<!-- Flagged Claims CSV -->
			<a
				href="/api/reports/flagged-claims"
				onclick={() => toastRef?.show('Download started — check your downloads folder')}
				class="group card flex flex-col gap-3 p-5 transition-all duration-200 hover:border-amber-300 hover:shadow-md dark:hover:border-amber-600/50"
				download
			>
				<span
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600 transition-colors group-hover:bg-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:group-hover:bg-amber-900/60"
				>
					<svg
						class="h-5 w-5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
						/>
						<line x1="12" y1="9" x2="12" y2="13" />
						<line x1="12" y1="17" x2="12.01" y2="17" />
					</svg>
				</span>
				<div>
					<p class="text-sm font-semibold text-slate-700 dark:text-slate-300">Flagged Claims</p>
					<p class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">CSV · All records</p>
				</div>
				<span class="mt-auto inline-flex items-center gap-1 text-xs font-medium text-amber-600">
					Download CSV
					<svg
						class="h-3.5 w-3.5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<polyline points="7 10 12 15 17 10" />
						<line x1="12" y1="15" x2="12" y2="3" />
					</svg>
				</span>
			</a>

			<!-- Issue Tracker CSV -->
			<a
				href="/api/reports/issues"
				onclick={() => toastRef?.show('Download started — check your downloads folder')}
				class="group card flex flex-col gap-3 p-5 transition-all duration-200 hover:border-emerald-300 hover:shadow-md dark:hover:border-emerald-600/50"
				download
			>
				<span
					class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 transition-colors group-hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:group-hover:bg-emerald-900/60"
				>
					<svg
						class="h-5 w-5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="8" x2="12" y2="12" />
						<line x1="12" y1="16" x2="12.01" y2="16" />
					</svg>
				</span>
				<div>
					<p class="text-sm font-semibold text-slate-700 dark:text-slate-300">Issue Tracker</p>
					<p class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
						CSV · All issues + status history
					</p>
				</div>
				<span class="mt-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
					Download CSV
					<svg
						class="h-3.5 w-3.5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<polyline points="7 10 12 15 17 10" />
						<line x1="12" y1="15" x2="12" y2="3" />
					</svg>
				</span>
			</a>

			<!-- Full System Audit XLSX — admin only -->
			{#if data.role === 'admin'}
				<a
					href="/api/reports/audit"
					onclick={() => toastRef?.show('Download started — check your downloads folder')}
					class="group card flex flex-col gap-3 bg-gray-50/70 p-5 transition-all duration-200 dark:bg-slate-800/40"
					download
				>
					<span
						class="flex h-10 w-10 items-center justify-center rounded-lg bg-signal-50 text-signal-700 transition-colors group-hover:bg-signal-100 dark:bg-signal-500/10 dark:text-signal-400 dark:group-hover:bg-signal-500/20"
					>
						<svg
							class="h-5 w-5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
						</svg>
					</span>
					<div>
						<p class="text-sm font-semibold text-slate-700 dark:text-slate-300">
							Full System Audit
						</p>
						<p class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">XLSX · Admin only</p>
					</div>
					<span class="mt-auto inline-flex items-center gap-1 text-xs font-medium text-signal-600">
						Download XLSX
						<svg
							class="h-3.5 w-3.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="7 10 12 15 17 10" />
							<line x1="12" y1="15" x2="12" y2="3" />
						</svg>
					</span>
				</a>
			{:else}
				<!-- Greyed-out placeholder for analysts -->
				<div class="card flex flex-col gap-3 border-dashed p-5 opacity-50">
					<span
						class="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800/60 dark:text-slate-500"
					>
						<svg
							class="h-5 w-5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
							<path d="M7 11V7a5 5 0 0 1 10 0v4" />
						</svg>
					</span>
					<div>
						<p class="text-sm font-semibold text-slate-500 dark:text-slate-400">
							Full System Audit
						</p>
						<p class="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Admin access required</p>
					</div>
				</div>
			{/if}
		</div>
	</section>

	<!-- ══════════════════════════════════════════════════════════════════════
	     AUDIT LOG — admin only
	     ══════════════════════════════════════════════════════════════════════ -->
	{#if data.role === 'admin'}
		<section class="card mb-8 overflow-hidden">
			<!-- Section header -->
			<div
				class="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800"
			>
				<div>
					<h2 class="text-base font-semibold text-slate-700 dark:text-slate-300">Audit Log</h2>
					<p class="mt-0.5 text-xs text-slate-400 tabular-nums dark:text-slate-500">
						{data.total.toLocaleString()} event{data.total === 1 ? '' : 's'} · append-only · immutable
					</p>
				</div>
				<span
					class="rounded-full bg-signal-50 px-3 py-1 text-[11px] font-semibold tracking-wide text-signal-700 uppercase dark:bg-signal-500/10 dark:text-signal-400"
				>
					Admin View
				</span>
			</div>

			<!-- Filter bar -->
			<form
				method="GET"
				class="flex flex-wrap gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800"
			>
				<input
					name="action"
					value={data.filters.action}
					placeholder="Filter by Action…"
					maxlength="200"
					class="input w-auto px-3 py-2"
				/>
				<input
					name="actor"
					value={data.filters.actor}
					placeholder="Filter by User…"
					maxlength="200"
					class="input w-auto px-3 py-2"
				/>
				<input
					name="details"
					value={data.filters.details}
					placeholder="Filter by Details…"
					maxlength="200"
					class="input w-auto px-3 py-2"
				/>
				<select
					name="resource_type"
					value={data.filters.resourceType}
					class="input w-auto px-3 py-2"
				>
					<option value="">All resource types</option>
					<option value="document">Document</option>
					<option value="category">Category</option>
					<option value="issue">Issue</option>
					<option value="claim">Claim</option>
					<option value="config">Config</option>
					<option value="service">Service</option>
					<option value="personnel">Personnel</option>
					<option value="profile">Profile</option>
					<option value="auth">Auth</option>
				</select>
				<input type="hidden" name="page" value="1" />
				<button type="submit" class="btn-primary"> Search </button>
				{#if data.filters.action || data.filters.actor || data.filters.details || data.filters.resourceType}
					<a href="?" class="btn-secondary"> Clear </a>
				{/if}
			</form>

			<!-- Table -->
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr
							class="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-semibold tracking-wider text-slate-400 uppercase dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400"
						>
							<th class="px-6 py-3">Action</th>
							<th class="px-6 py-3">User</th>
							<th class="px-6 py-3">Resource</th>
							<th class="px-6 py-3">Details</th>
							<th class="px-6 py-3">IP</th>
							<th class="px-6 py-3 text-right">Timestamp</th>
						</tr>
					</thead>
					<tbody>
						{#each data.logs as log, i}
							<tr
								class="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
								style="animation: fadeIn 150ms ease {i * 30}ms both"
							>
								<td class="px-6 py-3">
									<span
										class="rounded-full px-2.5 py-1 text-xs font-semibold {actionColour(
											log.action
										)}"
									>
										{log.action}
									</span>
								</td>
								<td class="px-6 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
									{log.actor_email}
								</td>
								<td class="px-6 py-3">
									{#if log.resource_type}
										<span
											class="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400"
										>
											{log.resource_type}
											{#if log.resource_id}
												<span class="font-mono text-slate-400">
													{log.resource_id.slice(0, 8)}
												</span>
											{/if}
										</span>
									{:else}
										<span class="text-xs text-slate-300 dark:text-slate-600">—</span>
									{/if}
								</td>
								<td class="max-w-xs px-6 py-3 text-slate-600 dark:text-slate-300">
									<span class="line-clamp-2">{log.details ?? '—'}</span>
								</td>
								<td class="px-6 py-3 font-mono text-xs text-slate-400 dark:text-slate-500">
									{log.ip_address ?? '—'}
								</td>
								<td
									class="px-6 py-3 text-right text-xs whitespace-nowrap text-slate-400 tabular-nums dark:text-slate-500"
								>
									{new Date(log.created_at).toLocaleString()}
								</td>
							</tr>
						{:else}
							<tr>
								<td
									colspan="6"
									class="px-6 py-12 text-center text-sm text-slate-400 dark:text-slate-500"
								>
									No audit events match the current filters.
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Pagination -->
			{#if totalPages > 1}
				<div
					class="flex items-center justify-between border-t border-slate-100 px-6 py-4 dark:border-slate-800"
				>
					<span class="text-xs text-slate-400 tabular-nums dark:text-slate-500">
						Page {data.page} of {totalPages} · {data.total.toLocaleString()} events
					</span>
					<div class="flex gap-2">
						{#if data.page > 1}
							<a
								href={pageUrl(data.page - 1)}
								class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60"
							>
								← Prev
							</a>
						{/if}
						{#if data.page < totalPages}
							<a
								href={pageUrl(data.page + 1)}
								class="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60"
							>
								Next →
							</a>
						{/if}
					</div>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
