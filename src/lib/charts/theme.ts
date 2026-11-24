// ── Chart theme — resolves DESIGN.md tokens at runtime so Chart.js stays
// theme-aware (warm paper/ink in light, deep-ink console in dark). Call
// chartColors() inside onMount; values update when the .dark class changes
// via ChartUpdater (see LineChart.svelte).

export function isDarkMode(): boolean {
	return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

function cssVar(name: string, fallback: string): string {
	if (typeof document === 'undefined') return fallback;
	const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return v || fallback;
}

export interface ChartColors {
	dark: boolean;
	grid: string;
	tick: string;
	legend: string;
	fontFamily: string;
	tooltip: {
		bg: string;
		border: string;
		title: string;
		body: string;
		label: string;
	};
	series: { positive: string; negative: string; neutral: string; signal: string };
	donut: string[];
	border: string;
}

export function chartColors(): ChartColors {
	const dark = isDarkMode();
	const tooltipBg = dark ? cssVar('--color-surface', '#121716') : '#232220';
	const tooltipText = dark ? cssVar('--color-ink', '#e7e9e7') : '#f4f2ee';

	return {
		dark,
		grid: cssVar('--color-line', '#e6e3dc'),
		tick: cssVar('--color-ink-muted', '#6b655d'),
		legend: cssVar('--color-ink-muted', '#6b655d'),
		fontFamily: cssVar('--font-sans', "'Public Sans', system-ui, sans-serif"),
		tooltip: {
			bg: tooltipBg,
			border: dark ? cssVar('--color-line', '#232a28') : 'rgba(255,255,255,0.08)',
			title: tooltipText,
			body: tooltipText,
			label: tooltipText
		},
		series: {
			positive: '#22c55e',
			negative: '#f43f5e',
			neutral: cssVar('--color-ink-faint', '#8a837b'),
			signal: cssVar('--color-signal-600', '#0d6b4d')
		},
		// Signal → emerald → amber → warm stone → rose → muted stone → neutral (semantic-first)
		donut: [
			cssVar('--color-signal-600', '#0d6b4d'),
			'#10b981',
			'#f59e0b',
			'#a8a29e',
			'#f43f5e',
			'#78716c',
			cssVar('--color-ink-faint', '#8a837b')
		],
		border: cssVar('--color-surface', '#ffffff')
	};
}

// Re-render hint helper: some chart instances need to redraw when the theme
// flips. This watcher fires `onChange` when `.dark` is toggled on <html>.
export function watchTheme(onChange: () => void): () => void {
	if (typeof document === 'undefined') return () => {};
	const target = document.documentElement;
	const observer = new MutationObserver(() => onChange());
	observer.observe(target, { attributes: true, attributeFilter: ['class'] });
	return () => observer.disconnect();
}
