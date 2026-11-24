// ── Chart.js registration — single point of truth ─────────────────────────
//
// The dashboard only renders line + doughnut charts with category/linear
// scales, tooltips, and a legend. Registering exactly these pieces (instead
// of the full `registerables`) lets Rollup tree-shake the rest of Chart.js
// out of the bundle (~60-70% smaller chart chunk).

import {
	Chart,
	LineController,
	DoughnutController,
	CategoryScale,
	LinearScale,
	LineElement,
	PointElement,
	ArcElement,
	Filler,
	Tooltip,
	Legend
} from 'chart.js';

Chart.register(
	LineController,
	DoughnutController,
	CategoryScale,
	LinearScale,
	LineElement,
	PointElement,
	ArcElement,
	Filler,
	Tooltip,
	Legend
);

export { Chart };
