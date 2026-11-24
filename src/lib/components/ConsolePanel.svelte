<script lang="ts">
	// ConsolePanel — a CSS/SVG "signal console" readout that demonstrates
	// the product's instrument character on the hero without needing the
	// app to be running. All values are illustrative; they frame the
	// dashboard/heatmap/review surfaces of the real app.
	let { class: className = '', flushed = false } = $props();

	const SENTIMENT = [
		{ label: 'Positive', pct: 38, tone: 'bg-signal-400' },
		{ label: 'Negative', pct: 27, tone: 'bg-rose-500' },
		{ label: 'Neutral', pct: 35, tone: 'bg-ink-faint' }
	];
</script>

<div class="bento-card {className} {flushed ? 'panel-flush' : 'h-full'}">
	<!-- Console header -->
	<div class="mb-3 flex items-center justify-between">
		<span class="font-mono text-[11px] font-semibold tracking-widest text-ink-faint uppercase"
			>Sample Analysis Console</span
		>
		<span
			class="flex items-center gap-1.5 font-mono text-[11px] text-signal-600 dark:text-signal-400"
		>
			<span class="relative inline-block h-1.5 w-1.5 rounded-full bg-signal-600">
				<span class="pulse-halo absolute inset-0 rounded-full bg-signal-600"></span>
			</span>
			SAMPLE
		</span>
	</div>

	<!-- KPI telemetry -->
	<div class="grid grid-cols-3 gap-3 border-y border-line py-3">
		{#each [{ num: '2,847', label: 'Comments' }, { num: '94.2%', label: 'Confidence' }, { num: '312', label: 'Flagged' }] as k (k.label)}
			<div>
				<div class="font-sans text-xl font-semibold tracking-tight text-ink tabular-nums">
					{k.num}
				</div>
				<div class="mt-0.5 font-mono text-[11px] tracking-widest text-ink-faint uppercase">
					{k.label}
				</div>
			</div>
		{/each}
	</div>

	<!-- Sentiment bars -->
	<div class="mt-3">
		<div class="mb-2 font-mono text-[11px] tracking-widest text-ink-faint uppercase">
			Sentiment Breakdown
		</div>
		<div class="flex h-3 overflow-hidden rounded-full">
			{#each SENTIMENT as s (s.label)}
				<div class={s.tone} style="width: {s.pct}%" title="{s.label}: {s.pct}%"></div>
			{/each}
		</div>
		<div class="mt-2 flex gap-3">
			{#each SENTIMENT as s (s.label)}
				<span class="font-mono text-[11px] text-ink-muted">
					{s.label}
					{s.pct}%
				</span>
			{/each}
		</div>
	</div>

	<!-- Sparkline chart -->
	<div class="mt-3">
		<div class="mb-2 font-mono text-[11px] tracking-widest text-ink-faint uppercase">
			Trending Topic — Waste Management
		</div>
		<svg
			class="w-full text-signal-600 dark:text-signal-400"
			viewBox="0 0 320 56"
			fill="none"
			aria-hidden="true"
		>
			<!-- grid -->
			<path
				d="M0 14 H320 M0 28 H320 M0 42 H320"
				stroke="currentColor"
				stroke-width="0.5"
				opacity="0.12"
			/>
			<!-- area fill -->
			<path
				d="M0 42 L30 37 L60 40 L90 29 L120 34 L150 24 L180 28 L210 19 L240 23 L270 14 L300 17 L320 10 L320 56 L0 56 Z"
				fill="color-mix(in srgb, currentColor 12%, transparent)"
			/>
			<!-- line -->
			<path
				d="M0 42 L30 37 L60 40 L90 29 L120 34 L150 24 L180 28 L210 19 L240 23 L270 14 L300 17 L320 10"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<!-- last point -->
			<circle cx="320" cy="10" r="3" fill="currentColor" />
			<circle cx="320" cy="10" r="6" fill="currentColor" opacity="0.2" />
		</svg>
	</div>

	<!-- Model telemetry -->
	<div class="mt-3 flex items-center justify-between border-t border-line pt-3">
		<span class="font-mono text-[11px] text-ink-faint"
			>Language analysis · Filipino multilingual</span
		>
		<span class="font-mono text-[11px] text-ink-faint">Sample readout</span>
	</div>
</div>
