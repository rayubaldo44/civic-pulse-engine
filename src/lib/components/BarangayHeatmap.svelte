<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import type { BarangayStat } from '../../routes/Authenticated/dashboard/+page.server';

	export let stats: BarangayStat[] = [];

	// Approximate centroids for Pulilan's 18 barangays (WGS84 decimal degrees)
	// Source: approximate positions based on Pulilan municipal layout.
	// Refine against official NAMRIA/LGU maps if higher accuracy is needed.
	const BARANGAY_COORDS: Record<string, [number, number]> = {
		Alagao: [14.882, 120.84],
		Aulaga: [14.925, 120.845],
		'Bagong Buhay': [14.922, 120.862],
		Balubad: [14.901, 120.838],
		Bambang: [14.895, 120.855],
		'Dampol 1st-A': [14.906, 120.865],
		'Dampol 2nd-A': [14.908, 120.867],
		'Dampol 2nd-B': [14.91, 120.87],
		'Dulong Malabon': [14.897, 120.862],
		Inaon: [14.899, 120.844],
		Lumbac: [14.892, 120.858],
		Lunt: [14.885, 120.848],
		Magnificat: [14.904, 120.873],
		Marinig: [14.911, 120.856],
		Niugan: [14.889, 120.851],
		Poblacion: [14.9028, 120.8514],
		Polo: [14.919, 120.854],
		Remlo: [14.887, 120.86]
	};

	const PULILAN_CENTER: [number, number] = [14.9028, 120.8514];

	// ── View toggle: live Leaflet map ⇄ barangay tile grid ──────────────────
	// Both containers stay mounted; we only swap visibility so the map keeps
	// its center/zoom. When returning to Map we invalidateSize() so Leaflet
	// re-measures the container after it stops being display:none.
	let view: 'map' | 'tiles' = 'map';

	async function setView(next: 'map' | 'tiles') {
		if (view === next) return;
		view = next;
		if (next === 'map') {
			await tick();
			map?.invalidateSize();
		}
	}

	// Shared intensity — mirrors the map heat layer so both views agree on
	// negativity ratio + flagging boost, always 0–1.
	function meanIntensity(stat: BarangayStat): number {
		return stat.total > 0 ? Math.min((stat.negative + stat.flagged * 0.5) / stat.total, 1.0) : 0;
	}

	// Heat ramp — same stops as the Leaflet gradient + the Low/High legend.
	const RAMP_STOPS: { t: number; r: number; g: number; b: number }[] = [
		{ t: 0, r: 120, g: 182, b: 155 },
		{ t: 0.2, r: 120, g: 182, b: 155 },
		{ t: 0.5, r: 245, g: 158, b: 11 },
		{ t: 0.75, r: 244, g: 63, b: 94 },
		{ t: 1, r: 159, g: 18, b: 57 }
	];

	function rampColor(intensity: number): string {
		const i = Math.min(Math.max(intensity, 0), 1);
		let prev = RAMP_STOPS[0];
		for (const stop of RAMP_STOPS) {
			if (i <= stop.t) {
				const span = stop.t - prev.t;
				const k = span === 0 ? 0 : (i - prev.t) / span;
				const channel = (from: number, to: number) =>
					Math.round(from + (to - from) * k)
						.toString(16)
						.padStart(2, '0');
				return `#${channel(prev.r, stop.r)}${channel(prev.g, stop.g)}${channel(prev.b, stop.b)}`;
			}
			prev = stop;
		}
		const last = RAMP_STOPS[RAMP_STOPS.length - 1];
		const hex = (v: number) => v.toString(16).padStart(2, '0');
		return `#${hex(last.r)}${hex(last.g)}${hex(last.b)}`;
	}

	type TileData = {
		name: string;
		total: number;
		intensity: number;
		color: string;
		hasData: boolean;
	};

	const barangayList: string[] = Object.keys(BARANGAY_COORDS).sort((a, b) => a.localeCompare(b));

	// Barangay tiles — recomputed whenever the server stats stream in.
	let tileData: TileData[] = [];
	$: {
		const statMap = new Map(stats.map((s) => [s.name, s]));
		tileData = barangayList.map((name) => {
			const stat = statMap.get(name);
			if (!stat || stat.total === 0) {
				return { name, total: 0, intensity: 0, color: 'var(--color-line)', hasData: false };
			}
			const intensity = meanIntensity(stat);
			return { name, total: stat.total, intensity, color: rampColor(intensity), hasData: true };
		});
	}

	let mapEl: HTMLDivElement;
	let map: import('leaflet').Map | null = null;

	onMount(async () => {
		// Guard: component may have been destroyed before async work finishes
		if (!mapEl) return;

		// Leaflet CSS is loaded lazily here (not statically at top) so the
		// page's initial CSS bundle stays lean until the map is actually shown.
		await import('leaflet/dist/leaflet.css');

		const L = (await import('leaflet')).default;

		// leaflet.heat mutates the global L directly — it does not use ESM imports.
		// Setting window.L before the import ensures the plugin attaches correctly.
		(window as any).L = L;
		await import('leaflet.heat');

		if (!mapEl) return; // re-check after await

		map = L.map(mapEl, { scrollWheelZoom: false, zoomControl: true }).setView(PULILAN_CENTER, 13);

		// Enable scroll-to-zoom only while the cursor is inside the map,
		// so the page can still scroll normally when hovering elsewhere.
		mapEl.addEventListener('mouseenter', () => map?.scrollWheelZoom.enable());
		mapEl.addEventListener('mouseleave', () => map?.scrollWheelZoom.disable());

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 19,
			attribution:
				'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
		}).addTo(map);

		if (stats.length === 0) return;

		const statMap = new Map(stats.map((s) => [s.name, s]));
		const points: [number, number, number][] = [];

		for (const [name, [lat, lng]] of Object.entries(BARANGAY_COORDS)) {
			const stat = statMap.get(name);
			if (!stat || stat.total === 0) continue;

			// Intensity: negativity ratio + flagging boost, always 0–1
			// (shared with the tile grid; min 0.15 keeps sparse areas visible)
			const intensity = Math.max(meanIntensity(stat), 0.15);

			// Spread points around the centroid proportional to mention count.
			// Cap at 20 per barangay to keep rendering fast.
			const count = Math.min(stat.total, 20);
			const jitter = 0.003; // ~300 m spread around centroid
			for (let i = 0; i < count; i++) {
				points.push([
					lat + (Math.random() - 0.5) * jitter,
					lng + (Math.random() - 0.5) * jitter,
					// Ensure a minimum 0.15 so low-activity barangays are still visible
					Math.max(intensity, 0.15)
				]);
			}
		}

		// @ts-expect-error — leaflet.heat extends L with no official TS types
		L.heatLayer(points, {
			radius: 35,
			blur: 30,
			maxZoom: 16,
			max: 1.0,
			// Calm (signal) → Amber (moderate) → Rose → Dark-rose (critical)
			gradient: { 0.2: '#78b69b', 0.5: '#f59e0b', 0.75: '#f43f5e', 1.0: '#9f1239' }
		}).addTo(map);
	});

	onDestroy(() => {
		map?.remove();
		map = null;
	});
</script>

<div class="card card-pad">
	<!-- Header -->
	<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
		<div>
			<h3 class="text-base font-semibold text-ink">Barangay Activity Heatmap</h3>
			<p class="text-sm text-ink-muted">
				Negative sentiment intensity per barangay · Pulilan, Bulacan
			</p>
		</div>

		<!-- Gradient legend -->
		<div class="flex flex-wrap items-center gap-3">
			<!-- View toggle: live map ⇄ tile grid -->
			<div class="segmented" role="group" aria-label="Heatmap view">
				<button
					type="button"
					class="segmented-btn {view === 'map' ? 'segmented-btn-active' : ''}"
					aria-pressed={view === 'map'}
					onclick={() => setView('map')}
				>
					Map
				</button>
				<button
					type="button"
					class="segmented-btn {view === 'tiles' ? 'segmented-btn-active' : ''}"
					aria-pressed={view === 'tiles'}
					onclick={() => setView('tiles')}
				>
					Tiles
				</button>
			</div>

			<!-- Gradient legend -->
			<div class="flex items-center gap-2 text-xs text-ink-muted">
				<span>Low</span>
				<div
					class="h-2 w-28 rounded-full"
					style="background: linear-gradient(to right, #78b69b, #f59e0b, #f43f5e, #9f1239)"
				></div>
				<span>High</span>
			</div>
		</div>
	</div>

	<!-- Map container — Leaflet needs an explicit height -->
	<div
		bind:this={mapEl}
		class="z-0 h-80 w-full overflow-hidden rounded-lg dark:bg-slate-900 {view === 'map'
			? ''
			: 'hidden'}"
	></div>

	<!-- Tile grid — all 18 barangays, colored by the same intensity ramp -->
	<div
		class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 {view === 'tiles' ? '' : 'hidden'}"
	>
		{#each tileData as tile (tile.name)}
			<div
				class="rounded-lg border border-line bg-surface p-3"
				style="background-color: {tile.hasData ? `${tile.color}1a` : 'transparent'}"
				title="{tile.name} — {tile.hasData ? `${tile.total.toLocaleString()} mentions` : 'no data'}"
			>
				<p class="truncate text-sm font-medium text-ink">{tile.name}</p>
				<p class="telemetry mt-0.5 text-xs {tile.hasData ? 'text-ink-muted' : 'text-ink-faint'}">
					{tile.hasData ? `${tile.total.toLocaleString()} mentions` : 'No data'}
				</p>
				<div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
					<div
						class="h-full rounded-full"
						style="width: {tile.hasData
							? Math.round(Math.max(tile.intensity * 100, 6))
							: 0}%; background-color: {tile.hasData ? tile.color : 'transparent'}"
					></div>
				</div>
			</div>
		{/each}
	</div>

	{#if stats.length === 0}
		<p class="mt-3 text-center text-xs text-ink-faint">
			No barangay mentions yet — comments referencing a Pulilan barangay by name will populate the
			heatmap.
		</p>
	{/if}
</div>

<style>
	:global(.dark) :global(.leaflet-tile-pane) {
		filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9);
	}
	:global(.dark) :global(.leaflet-popup-content-wrapper),
	:global(.dark) :global(.leaflet-popup-tip) {
		background: var(--color-surface);
		color: var(--color-ink);
	}
</style>
