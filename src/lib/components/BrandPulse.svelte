<script lang="ts">
	// ── BrandPulse — ECG heartbeat sweep line ───────────────────────────────
	// The "pulse" of the engine: a faint heartbeat trace with a bright head
	// advancing along the path. Uses offset-path (the path string below is
	// duplicated in the CSS property on the <svg>; keep them identical).
	// Subtle by design — one 7s sweep, never strobing.
	let { class: className = '', width = '120' } = $props();

	const ECG_PATH =
		'M2 12 L34 12 L37 8.5 L40 15.5 L44 12 L48 12 L52 4 L56 18.5 L60 12 L64 12 L118 12';
</script>

<svg
	aria-hidden="true"
	{width}
	height="24"
	viewBox="0 0 120 24"
	fill="none"
	style={`--ecg-path: path('${ECG_PATH}')`}
	class="ecg {className}"
>
	<polyline points={ECG_PATH} class="ecg-line" />
	<circle r="0.01" class="ecg-head" />
</svg>

<style>
	.ecg-line {
		fill: none;
		stroke: var(--color-signal-200);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	:global(.dark) .ecg-line {
		stroke: color-mix(in srgb, var(--color-signal-500) 42%, transparent);
	}
	.ecg-head {
		offset-path: var(--ecg-path);
		fill: var(--color-signal-600);
		animation: ecg-sweep 7s linear infinite;
	}
</style>
