// src/lib/server/sentiment-trends.ts
// Pure helpers that aggregate processed_content rows into chart-ready trend
// series for the Sentiment Overview card on the Live Data Stream page.
//
// Ranges:
//   live    → delegates to dashboard-trend (hourly 12h, daily 7d fallback)
//   weekly  → daily buckets over the last 28 days
//   monthly → daily buckets over the current calendar month-to-date
//   yearly  → monthly buckets over the last 12 calendar months
//
// All date bucketing uses Asia/Manila civil time (UTC+8 year-round, no DST).
// Never bucket with raw UTC Date math — PH timestamps between 00:00–08:00 PHT
// fall on the previous UTC date, which would shift every early-morning comment
// into the wrong bucket.

import { buildTrendData } from '$lib/server/dashboard-trend';
// Shared constants/types live in $lib/types/sentiment-trends.ts (client-safe);
// re-exported here so existing imports from $lib/server keep working.
import {
	DATE_FILTER_RANGES,
	TREND_RANGES,
	type DateFilterRange,
	type TrendRangeId as TrendRange
} from '$lib/types/sentiment-trends';

export { DATE_FILTER_RANGES, TREND_RANGES };
export type { DateFilterRange, TrendRange };

export type TrendRecord = { processed_at: string; sentiment_label: string | null };

export type SentimentTrendMode = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'empty';

export type SentimentTrend = {
	labels: string[];
	positive: number[];
	negative: number[];
	neutral: number[];
	mode: SentimentTrendMode;
};

const DAY_MS = 86_400_000;
const MANILA_OFFSET_MS = 8 * 3_600_000; // UTC+8, no DST

// en-CA formats as ISO-like "YYYY-MM-DD" for the requested zone.
const civilDateFmt = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Asia/Manila',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/** Civil date in Manila as "YYYY-MM-DD". */
function manilaDateKey(d: Date): string {
	return civilDateFmt.format(d);
}

function keyToDayIndex(key: string): number {
	return Math.floor(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / DAY_MS);
}

function dayIndexToKey(idx: number): string {
	const d = new Date(idx * DAY_MS);
	return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** UTC instant of Manila midnight (00:00 PHT) for a civil day index. */
function manilaMidnightUtcMs(dayIdx: number): number {
	return dayIdx * DAY_MS - MANILA_OFFSET_MS;
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

/** "Aug 23" — matches the dashboard daily label style. */
function shortDateLabel(dayIdx: number): string {
	return new Date(dayIdx * DAY_MS).toLocaleDateString('en-PH', {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	});
}

/** "Sep '25" */
function monthLabel(year: number, month: number): string {
	const name = new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('en-PH', {
		month: 'short',
		timeZone: 'UTC'
	});
	return `${name} '${String(year).slice(2)}`;
}

type Buckets = { keys: string[]; labels: string[] };

function lastNDayBuckets(now: Date, n: number): Buckets {
	const todayIdx = keyToDayIndex(manilaDateKey(now));
	const keys: string[] = [];
	const labels: string[] = [];
	for (let i = n - 1; i >= 0; i--) {
		keys.push(dayIndexToKey(todayIdx - i));
		labels.push(shortDateLabel(todayIdx - i));
	}
	return { keys, labels };
}

function currentMonthDayBuckets(now: Date): Buckets {
	const key = manilaDateKey(now);
	const y = +key.slice(0, 4);
	const m = +key.slice(5, 7);
	const today = +key.slice(8, 10);
	const monthPrefix = `${y}-${pad2(m)}-`;
	const keys: string[] = [];
	const labels: string[] = [];
	for (let d = 1; d <= today; d++) {
		keys.push(monthPrefix + pad2(d));
		labels.push(shortDateLabel(keyToDayIndex(monthPrefix + pad2(d))));
	}
	return { keys, labels };
}

function last12MonthBuckets(now: Date): Buckets {
	const key = manilaDateKey(now);
	const y = +key.slice(0, 4);
	const m = +key.slice(5, 7);
	let sy = y;
	let sm = m - 11;
	if (sm < 1) {
		sm += 12;
		sy -= 1;
	}
	const keys: string[] = [];
	const labels: string[] = [];
	for (let i = 0; i < 12; i++) {
		const mm = sm + i;
		const ky = sy + Math.floor((mm - 1) / 12);
		const km = ((mm - 1) % 12) + 1;
		keys.push(`${ky}-${pad2(km)}`);
		labels.push(monthLabel(ky, km));
	}
	return { keys, labels };
}

function recordKey(d: Date, range: Exclude<TrendRange, 'live'>): string {
	const full = manilaDateKey(d);
	return range === 'yearly' ? full.slice(0, 7) : full;
}

/**
 * Earliest processed_at needed to fully populate a range's buckets,
 * as an ISO string for a `.gte('processed_at', since)` filter.
 * Live reuses the dashboard's 7-day fetch window so its daily fallback works.
 */
export function getSinceIso(range: TrendRange, now: Date = new Date()): string {
	switch (range) {
		case 'live':
			return new Date(now.getTime() - 7 * DAY_MS).toISOString();
		case 'weekly': {
			const todayIdx = keyToDayIndex(manilaDateKey(now));
			return new Date(manilaMidnightUtcMs(todayIdx - 27)).toISOString();
		}
		case 'monthly': {
			const key = manilaDateKey(now);
			const firstIdx = keyToDayIndex(`${key.slice(0, 7)}-01`);
			return new Date(manilaMidnightUtcMs(firstIdx)).toISOString();
		}
		case 'yearly': {
			const key = manilaDateKey(now);
			let sy = +key.slice(0, 4);
			let sm = +key.slice(5, 7) - 11;
			if (sm < 1) {
				sm += 12;
				sy -= 1;
			}
			const firstIdx = keyToDayIndex(`${sy}-${pad2(sm)}-01`);
			return new Date(manilaMidnightUtcMs(firstIdx)).toISOString();
		}
	}
}

const emptyTrend = (): SentimentTrend => ({
	labels: [],
	positive: [],
	negative: [],
	neutral: [],
	mode: 'empty'
});

/**
 * Aggregate records into chart series for the requested range.
 * Sentiment folding matches buildTrendData: positive / negative /
 * everything else (neutral, review, null) → neutral.
 * Returns mode 'empty' when no record lands inside the window.
 */
export function buildTrendSeries(
	records: TrendRecord[],
	range: TrendRange,
	now: Date = new Date()
): SentimentTrend {
	if (range === 'live') {
		const t = buildTrendData(records, now);
		if (t.mode === 'empty') return emptyTrend();
		return t;
	}

	const buckets =
		range === 'weekly'
			? lastNDayBuckets(now, 28)
			: range === 'monthly'
				? currentMonthDayBuckets(now)
				: last12MonthBuckets(now);

	const positive = new Array<number>(buckets.keys.length).fill(0);
	const negative = new Array<number>(buckets.keys.length).fill(0);
	const neutral = new Array<number>(buckets.keys.length).fill(0);

	const idxOf = new Map(buckets.keys.map((k, i) => [k, i] as const));

	let hits = 0;
	for (const r of records) {
		const idx = idxOf.get(recordKey(new Date(r.processed_at), range));
		if (idx === undefined) continue;
		hits++;
		if (r.sentiment_label === 'positive') positive[idx]++;
		else if (r.sentiment_label === 'negative') negative[idx]++;
		else neutral[idx]++;
	}

	if (hits === 0) return emptyTrend();

	return { labels: buckets.labels, positive, negative, neutral, mode: range };
}

export type TrendCountRow = {
	/** Manila civil day — 'YYYY-MM-DD' (SQL: to_char(processed_at + 8h)). */
	date_key: string;
	sentiment_label: string | null;
	count: number;
};

/**
 * Aggregates compact per-civil-day counts (from the get_sentiment_window_counts
 * RPC) into the same chart series buildTrendSeries produces from raw rows.
 * Bucket keys are exact match for the record path: daily ranges use the civil
 * 'YYYY-MM-DD' date_key directly; yearly folds to 'YYYY-MM'. Sentiment folding
 * is identical (positive / negative / everything else → neutral).
 */
export function buildTrendSeriesFromCounts(
	counts: TrendCountRow[],
	range: Exclude<TrendRange, 'live'>,
	now: Date = new Date()
): SentimentTrend {
	const buckets =
		range === 'weekly'
			? lastNDayBuckets(now, 28)
			: range === 'monthly'
				? currentMonthDayBuckets(now)
				: last12MonthBuckets(now);

	const positive = new Array<number>(buckets.keys.length).fill(0);
	const negative = new Array<number>(buckets.keys.length).fill(0);
	const neutral = new Array<number>(buckets.keys.length).fill(0);

	const idxOf = new Map(buckets.keys.map((k, i) => [k, i] as const));

	let hits = 0;
	for (const c of counts) {
		const key = range === 'yearly' ? c.date_key.slice(0, 7) : c.date_key;
		const idx = idxOf.get(key);
		if (idx === undefined) continue;
		hits += c.count;
		if (c.sentiment_label === 'positive') positive[idx] += c.count;
		else if (c.sentiment_label === 'negative') negative[idx] += c.count;
		else neutral[idx] += c.count;
	}

	if (hits === 0) return emptyTrend();

	return { labels: buckets.labels, positive, negative, neutral, mode: range };
}

// ── Feed date-window helpers ────────────────────────────────────────────────
// Used by the Live Data Stream +page.server.ts to narrow the feed query.
// DateFilterRange / DATE_FILTER_RANGES are re-exported from the top of this
// file (sourced from $lib/types/sentiment-trends.ts).

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a YYYY-MM-DD string is a real calendar date (no silent overflow). */
function isValidDateStr(s: string): boolean {
	const [y, m, d] = s.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

type DateWindow = {
	sinceIso: string | null;
	untilIso: string | null;
};

/**
 * Compute a server-side processed_at window from a user-selected filter.
 *
 * Presets are rolling windows (last 7 / 30 / 365 days from `now`).
 * Custom uses Manila civil-day bounds: `since` is Manila midnight of the
 * `from` date, `until` is Manila midnight of the day *after* `to` (so the
 * entire "to" day is included).
 *
 * Invalid inputs silently fall back to `all` (no bounds).
 * `from > to` is silently swapped.
 * Future dates are clamped to `now`.
 */
export function getDateWindow(
	range: DateFilterRange,
	from?: string | null,
	to?: string | null,
	now: Date = new Date()
): DateWindow {
	switch (range) {
		case 'weekly':
			return {
				sinceIso: new Date(now.getTime() - 7 * DAY_MS).toISOString(),
				untilIso: null
			};
		case 'monthly':
			return {
				sinceIso: new Date(now.getTime() - 30 * DAY_MS).toISOString(),
				untilIso: null
			};
		case 'yearly':
			return {
				sinceIso: new Date(now.getTime() - 365 * DAY_MS).toISOString(),
				untilIso: null
			};
		case 'custom': {
			if (
				!from ||
				!to ||
				!DATE_PARAM_RE.test(from) ||
				!DATE_PARAM_RE.test(to) ||
				!isValidDateStr(from) ||
				!isValidDateStr(to)
			) {
				return { sinceIso: null, untilIso: null };
			}

			// Swap if inverted
			let fromIdx = keyToDayIndex(from);
			let toIdx = keyToDayIndex(to);
			if (fromIdx > toIdx) {
				[fromIdx, toIdx] = [toIdx, fromIdx];
			}

			// Clamp future dates to now
			const todayIdx = keyToDayIndex(manilaDateKey(now));
			if (fromIdx > todayIdx) return { sinceIso: null, untilIso: null };
			if (toIdx > todayIdx) toIdx = todayIdx;

			// since = Manila midnight of from; until = Manila midnight of day after to
			return {
				sinceIso: new Date(manilaMidnightUtcMs(fromIdx)).toISOString(),
				untilIso: new Date(manilaMidnightUtcMs(toIdx + 1)).toISOString()
			};
		}
		case 'all':
		default:
			return { sinceIso: null, untilIso: null };
	}
}
