<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { chartColors, watchTheme, type ChartColors } from '$lib/charts/theme';

	export let topicCounts: Record<string, number> = {};

	let canvas: HTMLCanvasElement;
	let chart: any = null; // Use any for the chart instance to avoid type-hell during init

	let activeColors: ChartColors = chartColors();

	function buildChartData(counts: Record<string, number>) {
		const entries = Object.entries(counts)
			.filter(([k, v]) => v > 0 && k !== 'Unknown') // Filter out "Unknown" if you prefer
			.sort((a, b) => b[1] - a[1]);

		return {
			labels: entries.map(([k]) => k),
			values: entries.map(([, v]) => v),
			colors: entries.map((_, i) => activeColors.donut[i % activeColors.donut.length])
		};
	}

	function applyColors() {
		activeColors = chartColors();
		if (!chart) return;
		const { colors } = buildChartData(topicCounts);
		chart.data.datasets[0].backgroundColor = colors;
		chart.data.datasets[0].borderColor = activeColors.border;
		const legend = chart.options.plugins.legend.labels;
		legend.color = activeColors.legend;
		legend.font = { size: 12, family: activeColors.fontFamily };
		chart.update('none');
	}

	onMount(async () => {
		const { Chart } = await import('$lib/charts/register');
		activeColors = chartColors();

		const { labels, values, colors } = buildChartData(topicCounts);

		// If there's no data yet, don't build a blank chart
		if (labels.length === 0) return;

		chart = new Chart(canvas, {
			type: 'doughnut',
			data: {
				labels,
				datasets: [
					{
						data: values,
						backgroundColor: colors,
						borderColor: activeColors.border,
						borderWidth: 2,
						hoverOffset: 6
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				font: { family: activeColors.fontFamily },
				cutout: '70%',
				plugins: {
					legend: {
						position: 'bottom',
						labels: {
							usePointStyle: true,
							pointStyleWidth: 8,
							padding: 16,
							font: { size: 12, family: activeColors.fontFamily },
							color: activeColors.legend
						}
					},
					tooltip: {
						backgroundColor: activeColors.tooltip.bg,
						titleColor: activeColors.tooltip.title,
						bodyColor: activeColors.tooltip.body,
						padding: 10,
						cornerRadius: 8,
						borderColor: activeColors.tooltip.border,
						borderWidth: 1
					}
				}
			}
		});

		unwatch = watchTheme(applyColors);
	});

	let unwatch: (() => void) | null = null;

	// RE-RENDER TRIGGER: This watches topicCounts and updates the chart if it exists
	$: if (chart && topicCounts) {
		const { labels, values, colors } = buildChartData(topicCounts);
		chart.data.labels = labels;
		chart.data.datasets[0].data = values;
		chart.data.datasets[0].backgroundColor = colors;
		chart.update(); // Remove 'none' to see if animation triggers
	}

	onDestroy(() => {
		unwatch?.();
		if (chart) chart.destroy();
	});
</script>

<div class="relative h-64 w-full"><canvas bind:this={canvas}></canvas></div>
