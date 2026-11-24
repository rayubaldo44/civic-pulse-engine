<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { chartColors, watchTheme, type ChartColors } from '$lib/charts/theme';

	// ── Props: pre-bucketed arrays passed from +page.server.ts ──────────────
	export let labels: string[] = [];
	export let positive: number[] = [];
	export let negative: number[] = [];
	export let neutral: number[] = [];

	let canvas: HTMLCanvasElement;
	let chart: import('chart.js').Chart | null = null;
	let activeColors: ChartColors = chartColors();

	function hexToRgba(hex: string, alpha: number): string {
		const m = hex.replace('#', '');
		const full =
			m.length === 3
				? m
						.split('')
						.map((c) => c + c)
						.join('')
				: m;
		const n = parseInt(full, 16);
		return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
	}

	function applyColors() {
		activeColors = chartColors();
		if (!chart) return;
		chart.options.scales!.x!.grid!.color = activeColors.grid;
		chart.options.scales!.y!.grid!.color = activeColors.grid;
		chart.options.scales!.x!.ticks!.color = activeColors.tick;
		chart.options.scales!.y!.ticks!.color = activeColors.tick;
		const legend = chart.options.plugins!.legend!.labels! as any;
		legend.color = activeColors.legend;
		const opts = chart.options as any;
		opts.font ??= {};
		opts.font.family = activeColors.fontFamily;
		const tooltip = chart.options.plugins!.tooltip as any;
		tooltip.backgroundColor = activeColors.tooltip.bg;
		tooltip.borderColor = activeColors.tooltip.border;
		tooltip.titleColor = activeColors.tooltip.title;
		tooltip.bodyColor = activeColors.tooltip.body;
		chart.data.datasets.forEach((d, i) => {
			if (i === 2) {
				const serial = d as unknown as { pointBackgroundColor?: string };
				serial.pointBackgroundColor = activeColors.series.neutral;
			}
		});
		chart.update('none');
	}

	// Dynamic import keeps Chart.js out of SSR bundle — prevents
	// "window is not defined" error during SvelteKit server render.
	onMount(async () => {
		const { Chart } = await import('$lib/charts/register');
		activeColors = chartColors();

		chart = new Chart(canvas, {
			type: 'line',
			data: {
				labels,
				datasets: [
					{
						label: 'Positive',
						data: positive,
						borderColor: activeColors.series.positive,
						backgroundColor: hexToRgba(activeColors.series.positive, 0.08),
						pointBackgroundColor: activeColors.series.positive,
						pointRadius: 3,
						pointHoverRadius: 6,
						borderWidth: 2,
						tension: 0.4,
						fill: true
					},
					{
						label: 'Negative',
						data: negative,
						borderColor: activeColors.series.negative,
						backgroundColor: hexToRgba(activeColors.series.negative, 0.08),
						pointBackgroundColor: activeColors.series.negative,
						pointRadius: 3,
						pointHoverRadius: 6,
						borderWidth: 2,
						tension: 0.4,
						fill: true
					},
					{
						label: 'Neutral',
						data: neutral,
						borderColor: activeColors.series.neutral,
						backgroundColor: hexToRgba(activeColors.series.neutral, 0.08),
						pointBackgroundColor: activeColors.series.neutral,
						pointRadius: 3,
						pointHoverRadius: 6,
						borderWidth: 2,
						tension: 0.4,
						fill: true
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: { mode: 'index', intersect: false },
				font: { family: activeColors.fontFamily },
				plugins: {
					legend: {
						position: 'bottom',
						labels: {
							usePointStyle: true,
							pointStyleWidth: 8,
							padding: 20,
							font: { size: 12, family: activeColors.fontFamily },
							color: activeColors.legend
						}
					},
					tooltip: {
						backgroundColor: activeColors.tooltip.bg,
						titleColor: activeColors.tooltip.title,
						bodyColor: activeColors.tooltip.body,
						padding: 12,
						cornerRadius: 8,
						borderColor: activeColors.tooltip.border,
						borderWidth: 1
					}
				},
				scales: {
					x: {
						// Chart.js v4: border.display replaces the v3 grid.drawBorder
						border: { display: false },
						grid: { color: activeColors.grid },
						ticks: {
							color: activeColors.tick,
							font: { size: 11, family: activeColors.fontFamily },
							maxRotation: 0,
							// Native thinning adapts to any bucket count (hourly 12,
							// daily 28–31, monthly 12) instead of skip-every-other.
							autoSkip: true,
							maxTicksLimit: 8
						}
					},
					y: {
						beginAtZero: true,
						border: { display: false },
						grid: { color: activeColors.grid },
						ticks: {
							color: activeColors.tick,
							font: { size: 11, family: activeColors.fontFamily },
							precision: 0
						}
					}
				}
			}
		});

		unwatch = watchTheme(applyColors);
	});

	let unwatch: (() => void) | null = null;

	onDestroy(() => {
		unwatch?.();
		chart?.destroy();
	});

	// Keep chart in sync if parent ever updates props reactively
	$: if (chart) {
		chart.data.labels = labels;
		chart.data.datasets[0].data = positive;
		chart.data.datasets[1].data = negative;
		chart.data.datasets[2].data = neutral;
		chart.update('none'); // skip animation on data refresh
	}
</script>

<div class="relative h-64 w-full">
	<canvas bind:this={canvas}></canvas>
</div>
