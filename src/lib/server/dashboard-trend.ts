// src/lib/server/dashboard-trend.ts
// Pure helpers that turn processed_content rows into chart-ready trend data.
// Hourly buckets when fresh data exists, daily fallback otherwise.

export type TrendRecord = { processed_at: string; sentiment_label: string | null };
export type TrendMode = 'hourly' | 'daily' | 'empty';

export type TrendData = {
	labels: string[];
	positive: number[];
	negative: number[];
	neutral: number[];
	mode: TrendMode;
};

type Bucket = { start: Date; end: Date };

function makeBuckets(
	count: number,
	label: (b: Bucket) => string,
	step: (d: Date, n: number) => void,
	now: Date
): { buckets: Bucket[]; labels: string[] } {
	const buckets: Bucket[] = [];
	const labels: string[] = [];
	for (let i = count - 1; i >= 0; i--) {
		const start = new Date(now);
		step(start, -i);
		const end = new Date(start);
		step(end, 1);
		buckets.push({ start, end });
		labels.push(label({ start, end }));
	}
	return { buckets, labels };
}

function tally(records: TrendRecord[], buckets: Bucket[]) {
	const positive = new Array<number>(buckets.length).fill(0);
	const negative = new Array<number>(buckets.length).fill(0);
	const neutral = new Array<number>(buckets.length).fill(0);

	for (const r of records) {
		const t = new Date(r.processed_at);
		const idx = buckets.findIndex((b) => t >= b.start && t < b.end);
		if (idx === -1) continue;
		if (r.sentiment_label === 'positive') positive[idx]++;
		else if (r.sentiment_label === 'negative') negative[idx]++;
		else neutral[idx]++; // neutral, review and null all fold here
	}
	return { positive, negative, neutral };
}

function hasHit(records: TrendRecord[], buckets: Bucket[]): boolean {
	return records.some((r) => {
		const t = new Date(r.processed_at);
		return buckets.some((b) => t >= b.start && t < b.end);
	});
}

export function buildTrendData(records: TrendRecord[], now: Date = new Date()): TrendData {
	const hourly = makeBuckets(
		12,
		(b) => b.start.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
		(d, n) => d.setHours(d.getHours() + n, 0, 0, 0),
		now
	);

	if (hasHit(records, hourly.buckets)) {
		return { labels: hourly.labels, ...tally(records, hourly.buckets), mode: 'hourly' };
	}

	const daily = makeBuckets(
		7,
		(b) => b.start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
		(d, n) => {
			d.setDate(d.getDate() + n);
			d.setHours(0, 0, 0, 0);
		},
		now
	);

	if (hasHit(records, daily.buckets)) {
		return { labels: daily.labels, ...tally(records, daily.buckets), mode: 'daily' };
	}

	return { labels: [], positive: [], negative: [], neutral: [], mode: 'empty' };
}
