import { describe, it, expect } from 'vitest';
import { buildTrendSeries, getSinceIso } from '$lib/server/sentiment-trends';
import type { TrendRange } from '$lib/server/sentiment-trends';

// Fixed anchor: 2026-08-23 10:15 UTC = 2026-08-23 18:15 Manila (same civil date)
const NOW = new Date('2026-08-23T10:15:00Z');

const DAY_MS = 86_400_000;
const MANILA_OFFSET_MS = 8 * 3_600_000;

/** Manila midnight (UTC) for a Manila civil date. */
function manilaMidnightUtc(ymd: string): Date {
	const [y, m, d] = ymd.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d) - MANILA_OFFSET_MS);
}

/** Record helper. */
const rec = (sentiment_label: string | null, processed_at: string) => ({
	sentiment_label,
	processed_at
});

// ── getSinceIso ──────────────────────────────────────────────────────────────
describe('getSinceIso', () => {
	it('live: 7 days before now', () => {
		const since = new Date(getSinceIso('live', NOW));
		expect(since.toISOString()).toBe(new Date(NOW.getTime() - 7 * DAY_MS).toISOString());
	});

	it('weekly: Manila midnight of 27 days ago', () => {
		const since = new Date(getSinceIso('weekly', NOW));
		// Aug 23 - 27 = Jul 27. Manila midnight of Jul 27 = UTC Jul 26 16:00
		expect(since.toISOString()).toBe(manilaMidnightUtc('2026-07-27').toISOString());
	});

	it('monthly: first day of current Manila month', () => {
		const since = new Date(getSinceIso('monthly', NOW));
		expect(since.toISOString()).toBe(manilaMidnightUtc('2026-08-01').toISOString());
	});

	it('yearly: first day of month 11 months ago', () => {
		const since = new Date(getSinceIso('yearly', NOW));
		// Aug 2026 - 11 = Sep 2025
		expect(since.toISOString()).toBe(manilaMidnightUtc('2025-09-01').toISOString());
	});

	it('yearly: wraps year boundary (Dec → previous year)', () => {
		const dec = new Date('2026-12-15T12:00:00Z');
		const since = new Date(getSinceIso('yearly', dec));
		// Dec 2026 - 11 = Jan 2026
		expect(since.toISOString()).toBe(manilaMidnightUtc('2026-01-01').toISOString());
	});
});

// ── buildTrendSeries — live ──────────────────────────────────────────────────
describe('buildTrendSeries — live', () => {
	it('delegates to dashboard-trend hourly mode when recent data exists', () => {
		const data = buildTrendSeries(
			[rec('positive', '2026-08-23T09:00:00Z'), rec('negative', '2026-08-23T08:30:00Z')],
			'live',
			NOW
		);

		expect(data.mode).toBe('hourly');
		expect(data.labels).toHaveLength(12);
		expect(data.positive).toHaveLength(12);
	});

	it('returns mode empty for no records', () => {
		const data = buildTrendSeries([], 'live', NOW);
		expect(data.mode).toBe('empty');
		expect(data.labels).toHaveLength(0);
	});
});

// ── buildTrendSeries — weekly ────────────────────────────────────────────────
describe('buildTrendSeries — weekly', () => {
	it('produces 28 daily buckets', () => {
		const data = buildTrendSeries([rec('positive', '2026-08-23T05:00:00Z')], 'weekly', NOW);

		expect(data.mode).toBe('weekly');
		expect(data.labels).toHaveLength(28);
		expect(data.positive).toHaveLength(28);
		expect(data.negative).toHaveLength(28);
		expect(data.neutral).toHaveLength(28);
	});

	it('today is the last bucket', () => {
		const data = buildTrendSeries([rec('positive', '2026-08-23T05:00:00Z')], 'weekly', NOW);

		expect(data.positive[27]).toBe(1);
	});

	it('records outside the 28-day window are ignored', () => {
		const old = '2026-07-26T05:00:00Z'; // before Jul 27 = outside window
		const data = buildTrendSeries([rec('negative', old)], 'weekly', NOW);

		expect(data.negative.every((v) => v === 0)).toBe(true);
	});

	it('returns empty mode when no records land in the window', () => {
		const data = buildTrendSeries([], 'weekly', NOW);
		expect(data.mode).toBe('empty');
	});

	it('buckets a record at Manila midnight into the correct day', () => {
		// 2026-08-23 00:00 Manila = 2026-08-22 16:00 UTC
		const atMidnight = manilaMidnightUtc('2026-08-23').toISOString();
		const data = buildTrendSeries([rec('neutral', atMidnight)], 'weekly', NOW);

		// Should land in today's bucket (index 27)
		expect(data.neutral[27]).toBe(1);
	});
});

// ── buildTrendSeries — monthly ───────────────────────────────────────────────
describe('buildTrendSeries — monthly', () => {
	it('produces one bucket per day so far in the month', () => {
		const data = buildTrendSeries([rec('positive', '2026-08-20T05:00:00Z')], 'monthly', NOW);

		expect(data.mode).toBe('monthly');
		// Aug 1..23 = 23 buckets
		expect(data.labels).toHaveLength(23);
	});

	it('records before the 1st of the month are ignored', () => {
		const data = buildTrendSeries([rec('negative', '2026-07-31T05:00:00Z')], 'monthly', NOW);

		expect(data.mode).toBe('empty');
	});

	it('aggregates multiple records on the same day', () => {
		const data = buildTrendSeries(
			[
				rec('positive', '2026-08-20T04:00:00Z'),
				rec('negative', '2026-08-20T05:00:00Z'),
				rec('review', '2026-08-20T06:00:00Z')
			],
			'monthly',
			NOW
		);

		// Aug 20 = index 19 (0-based, day 20 of month)
		expect(data.positive[19]).toBe(1);
		expect(data.negative[19]).toBe(1);
		expect(data.neutral[19]).toBe(1); // review folds to neutral
	});

	it('records after today in the same month are outside the bucket set', () => {
		// Aug 23 10:15 UTC is the current time; a record at Aug 24 is in the future
		const data = buildTrendSeries([rec('positive', '2026-08-24T05:00:00Z')], 'monthly', NOW);

		expect(data.mode).toBe('empty');
	});
});

// ── buildTrendSeries — yearly ────────────────────────────────────────────────
describe('buildTrendSeries — yearly', () => {
	it('produces 12 monthly buckets', () => {
		const data = buildTrendSeries([rec('positive', '2026-08-15T05:00:00Z')], 'yearly', NOW);

		expect(data.mode).toBe('yearly');
		expect(data.labels).toHaveLength(12);
		expect(data.positive).toHaveLength(12);
	});

	it('labels include both current and previous year months', () => {
		const data = buildTrendSeries([rec('positive', '2026-08-15T05:00:00Z')], 'yearly', NOW);

		// Sep '25 through Aug '26
		expect(data.labels[0]).toMatch(/^Sep '25$/);
		expect(data.labels[11]).toMatch(/^Aug '26$/);
	});

	it('records from >12 months ago are ignored', () => {
		const data = buildTrendSeries([rec('negative', '2025-08-15T05:00:00Z')], 'yearly', NOW);

		expect(data.mode).toBe('empty');
	});

	it('records from exactly 12 months ago land in the first bucket', () => {
		// Sep 1 2025 → first bucket (index 0)
		const data = buildTrendSeries([rec('positive', '2025-09-15T05:00:00Z')], 'yearly', NOW);

		expect(data.positive[0]).toBe(1);
	});

	it('aggregates all records within a calendar month', () => {
		const data = buildTrendSeries(
			[
				rec('positive', '2026-07-01T00:00:00Z'),
				rec('positive', '2026-07-15T12:00:00Z'),
				rec('negative', '2026-07-28T23:00:00Z')
			],
			'yearly',
			NOW
		);

		// Jul '26 = index 10
		expect(data.positive[10]).toBe(2);
		expect(data.negative[10]).toBe(1);
	});
});

// ── buildTrendSeriesFromCounts (RPC compact counts) ─────────────────────────
// These mirror the weekly/monthly/yearly record-based tests, but consume the
// per-civil-day counts returned by get_sentiment_window_counts (date_key is
// the Manila civil day 'YYYY-MM-DD').
import { buildTrendSeriesFromCounts } from '$lib/server/sentiment-trends';

describe('buildTrendSeriesFromCounts — weekly', () => {
	it('aggregates counts into the last daily bucket', () => {
		const data = buildTrendSeriesFromCounts(
			[
				{ date_key: '2026-08-23', sentiment_label: 'positive', count: 3 },
				{ date_key: '2026-08-23', sentiment_label: 'negative', count: 2 },
				{ date_key: '2026-08-23', sentiment_label: 'review', count: 1 }
			],
			'weekly',
			NOW
		);

		expect(data.mode).toBe('weekly');
		expect(data.labels).toHaveLength(28);
		expect(data.positive[27]).toBe(3);
		expect(data.negative[27]).toBe(2);
		expect(data.neutral[27]).toBe(1); // review folds to neutral
	});

	it('ignores days outside the 28-day window', () => {
		const data = buildTrendSeriesFromCounts(
			[{ date_key: '2026-07-26', sentiment_label: 'negative', count: 5 }],
			'weekly',
			NOW
		);

		expect(data.mode).toBe('empty');
	});

	it('folds null sentiment into neutral', () => {
		const data = buildTrendSeriesFromCounts(
			[{ date_key: '2026-08-23', sentiment_label: null, count: 2 }],
			'weekly',
			NOW
		);

		expect(data.neutral[27]).toBe(2);
	});
});

describe('buildTrendSeriesFromCounts — monthly', () => {
	it('buckets a mid-month civil day at its 0-based day index', () => {
		const data = buildTrendSeriesFromCounts(
			[{ date_key: '2026-08-20', sentiment_label: 'positive', count: 4 }],
			'monthly',
			NOW
		);

		expect(data.mode).toBe('monthly');
		expect(data.labels).toHaveLength(23); // Aug 1..23
		expect(data.positive[19]).toBe(4);
	});

	it('ignores dates before the 1st of the month', () => {
		const data = buildTrendSeriesFromCounts(
			[{ date_key: '2026-07-31', sentiment_label: 'negative', count: 1 }],
			'monthly',
			NOW
		);

		expect(data.mode).toBe('empty');
	});
});

describe('buildTrendSeriesFromCounts — yearly', () => {
	it('folds civil days into their YYYY-MM bucket', () => {
		const data = buildTrendSeriesFromCounts(
			[
				{ date_key: '2026-07-02', sentiment_label: 'positive', count: 2 },
				{ date_key: '2026-07-28', sentiment_label: 'negative', count: 1 }
			],
			'yearly',
			NOW
		);

		// Jul '26 = index 10
		expect(data.positive[10]).toBe(2);
		expect(data.negative[10]).toBe(1);
	});

	it('ignores dates older than 12 months', () => {
		const data = buildTrendSeriesFromCounts(
			[{ date_key: '2025-08-15', sentiment_label: 'negative', count: 1 }],
			'yearly',
			NOW
		);

		expect(data.mode).toBe('empty');
	});
});

describe('buildTrendSeriesFromCounts matches record path', () => {
	it('produces identical series to buildTrendSeries for the same data', () => {
		const records = [
			rec('positive', '2026-08-20T04:00:00Z'), // 12:00 PHT Aug 20
			rec('positive', '2026-08-20T00:00:00Z'), // 08:00 PHT Aug 20 — same civil day
			rec('negative', '2026-08-22T05:00:00Z'),
			rec('review', '2026-08-23T05:00:00Z')
		];

		const fromRows = buildTrendSeries(records, 'weekly', NOW);

		const counts = [
			{ date_key: '2026-08-20', sentiment_label: 'positive', count: 2 },
			{ date_key: '2026-08-22', sentiment_label: 'negative', count: 1 },
			{ date_key: '2026-08-23', sentiment_label: 'review', count: 1 }
		];
		const fromCounts = buildTrendSeriesFromCounts(counts, 'weekly', NOW);

		expect(fromCounts).toEqual(fromRows);
	});
});

// ── Sentiment folding ────────────────────────────────────────────────────────
describe('sentiment folding', () => {
	it('review folds into neutral', () => {
		const data = buildTrendSeries([rec('review', '2026-08-23T05:00:00Z')], 'weekly', NOW);
		expect(data.neutral[27]).toBe(1);
	});

	it('null folds into neutral', () => {
		const data = buildTrendSeries([rec(null, '2026-08-23T05:00:00Z')], 'weekly', NOW);
		expect(data.neutral[27]).toBe(1);
	});

	it('positive and negative are not misclassified', () => {
		const data = buildTrendSeries(
			[rec('positive', '2026-08-23T05:00:00Z'), rec('negative', '2026-08-23T06:00:00Z')],
			'weekly',
			NOW
		);
		expect(data.positive[27]).toBe(1);
		expect(data.negative[27]).toBe(1);
		expect(data.neutral[27]).toBe(0);
	});
});

// ── Timezone edge case ──────────────────────────────────────────────────────
describe('PH timezone edge cases', () => {
	it('a record at 00:30 Manila is bucketed into the correct Manila date', () => {
		// 2026-08-23 00:30 Manila = 2026-08-22 16:30 UTC
		const iso = manilaMidnightUtc('2026-08-23');
		iso.setMinutes(iso.getMinutes() + 30);

		const data = buildTrendSeries([rec('positive', iso.toISOString())], 'weekly', NOW);

		// Aug 23 is index 27 in the weekly view
		expect(data.positive[27]).toBe(1);
	});

	it('a record at 23:59 Manila is bucketed into the same-day Manila date', () => {
		// 2026-08-22 23:59 Manila = 2026-08-22 15:59 UTC
		const iso = manilaMidnightUtc('2026-08-23');
		iso.setMinutes(iso.getMinutes() - 1);

		const data = buildTrendSeries([rec('negative', iso.toISOString())], 'weekly', NOW);

		// Aug 22 = index 26 in the weekly view
		expect(data.negative[26]).toBe(1);
	});
});

// ── getDateWindow (feed date filter) ─────────────────────────────────────────
import { getDateWindow } from '$lib/server/sentiment-trends';

describe('getDateWindow', () => {
	it('all: no bounds', () => {
		expect(getDateWindow('all', undefined, undefined, NOW)).toEqual({
			sinceIso: null,
			untilIso: null
		});
	});

	it('weekly: rolling 7 days before now', () => {
		const w = getDateWindow('weekly', undefined, undefined, NOW);
		expect(w.untilIso).toBeNull();
		expect(new Date(w.sinceIso!).toISOString()).toBe(
			new Date(NOW.getTime() - 7 * DAY_MS).toISOString()
		);
	});

	it('monthly: rolling 30 days before now', () => {
		const m = getDateWindow('monthly', undefined, undefined, NOW);
		expect(m.untilIso).toBeNull();
		expect(new Date(m.sinceIso!).toISOString()).toBe(
			new Date(NOW.getTime() - 30 * DAY_MS).toISOString()
		);
	});

	it('yearly: rolling 365 days before now', () => {
		const y = getDateWindow('yearly', undefined, undefined, NOW);
		expect(y.untilIso).toBeNull();
		expect(new Date(y.sinceIso!).toISOString()).toBe(
			new Date(NOW.getTime() - 365 * DAY_MS).toISOString()
		);
	});

	it('custom same-day: full Manila day inclusive', () => {
		const w = getDateWindow('custom', '2026-08-23', '2026-08-23', NOW);
		// since = Aug 23 00:00 PHT = Aug 22 16:00 UTC
		expect(w.sinceIso).toBe(manilaMidnightUtc('2026-08-23').toISOString());
		// until = Aug 24 00:00 PHT = Aug 23 16:00 UTC
		expect(w.untilIso).toBe(manilaMidnightUtc('2026-08-24').toISOString());
	});

	it('custom multi-day range spans both bounds', () => {
		const w = getDateWindow('custom', '2026-08-01', '2026-08-15', NOW);
		expect(w.sinceIso).toBe(manilaMidnightUtc('2026-08-01').toISOString());
		expect(w.untilIso).toBe(manilaMidnightUtc('2026-08-16').toISOString());
	});

	it('custom inverted dates are swapped', () => {
		const w = getDateWindow('custom', '2026-08-15', '2026-08-01', NOW);
		expect(w.sinceIso).toBe(manilaMidnightUtc('2026-08-01').toISOString());
		expect(w.untilIso).toBe(manilaMidnightUtc('2026-08-16').toISOString());
	});

	it('custom future range clamps to today', () => {
		const w = getDateWindow('custom', '2026-09-01', '2026-09-30', NOW);
		// from > today → no window at all
		expect(w.sinceIso).toBeNull();
		expect(w.untilIso).toBeNull();
	});

	it('custom partially-future range clamps "to" to today', () => {
		const w = getDateWindow('custom', '2026-08-20', '2026-09-30', NOW);
		expect(w.sinceIso).toBe(manilaMidnightUtc('2026-08-20').toISOString());
		// until = midnight after today (Aug 24)
		expect(w.untilIso).toBe(manilaMidnightUtc('2026-08-24').toISOString());
	});

	it('invalid date strings fall back to all', () => {
		expect(getDateWindow('custom', 'garbage', '2026-08-23', NOW)).toEqual({
			sinceIso: null,
			untilIso: null
		});
		expect(getDateWindow('custom', '2026-13-45', '2026-08-23', NOW)).toEqual({
			sinceIso: null,
			untilIso: null
		});
		expect(getDateWindow('custom', '', '', NOW)).toEqual({ sinceIso: null, untilIso: null });
	});

	it('missing custom params fall back to all', () => {
		expect(getDateWindow('custom', undefined, undefined, NOW)).toEqual({
			sinceIso: null,
			untilIso: null
		});
	});
});
