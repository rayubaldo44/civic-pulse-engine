<script lang="ts">
	// ── StatCard — dashboard KPI tile ────────────────────────────────────────
	// Renders one stat tile. The `featured` variant is used for the hero metric
	// (larger value, centered vertically so it can stretch to match a 2×2 group).
	// The Flagged Claims tile re-reads `pending` live so it keeps tracking the
	// layout-level flagged count.
	type StatIcon = 'users' | 'alert' | 'brain' | 'shield' | 'activity';

	type Stat = {
		label: string;
		value: string;
		sub: string;
		subColor: string;
		icon: string;
	};

	let {
		stat,
		pending = 0,
		featured = false,
		delay = 0
	}: { stat: Stat; pending?: number; featured?: boolean; delay?: number } = $props();

	const iconPaths: Record<StatIcon, string> = {
		users:
			'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
		alert:
			'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01',
		brain:
			'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
		shield:
			'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
		activity: 'M13 10V3L4 14h7v7l9-11h-7z'
	};

	const isFlagged = $derived(stat.icon === 'alert');
	const displayValue = $derived(isFlagged ? String(pending) : stat.value);
	const displaySub = $derived(
		isFlagged ? (pending === 0 ? 'Queue is clear' : 'Awaiting LGU review') : stat.sub
	);
	const iconClass = $derived(
		isFlagged ? (pending > 0 ? 'text-rose-500' : 'text-emerald-500') : 'text-signal-500'
	);
</script>

<div
	class="card card-hover card-pad {featured ? 'flex h-full flex-col justify-center' : ''}"
	style="animation-delay: {delay}ms"
>
	<div class="flex items-center justify-between pb-2">
		<span class="micro-label text-ink-muted dark:text-slate-400">{stat.label}</span>
		<svg
			class="{featured ? 'h-6 w-6' : 'h-4 w-4'} {iconClass}"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d={iconPaths[stat.icon as StatIcon]}
			/>
		</svg>
	</div>

	<div
		class="font-sans font-semibold text-ink tabular-nums dark:text-slate-100 {featured
			? 'text-5xl'
			: 'text-3xl'}"
	>
		{displayValue}
	</div>
	<p class="telemetry mt-1.5 text-xs {stat.subColor} {featured ? 'sm:text-sm' : ''}">
		{displaySub}
	</p>
</div>
