import { describe, it, expect } from 'vitest';
import { buildTrendData } from '$lib/server/dashboard-trend';

const NOW = new Date('2026-08-23T10:15:00Z');

const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();
const daysAgo = (n: number) => hoursAgo(n * 24);

// Mirror of the module boundary rules so expected indices are not magic numbers.
const hourIdx = (iso: string) => {
	const r = new Date(iso);
	r.setMinutes(0, 0, 0);
	const base = new Date(NOW);
	base.setMinutes(0, 0, 0);
	return 11 - Math.round((base.getTime() - r.getTime()) / 3_600_000);
};

const dayIdx = (iso: string) => {
	const r = new Date(iso);
	r.setHours(0, 0, 0, 0);
	const base = new Date(NOW);
	base.setHours(0, 0, 0, 0);
	return 6 - Math.round((base.getTime() - r.getTime()) / 86_400_000);
};

const rec = (sentiment_label: string | null, iso: string) => ({
	sentiment_label,
	processed_at: iso
});

describe('buildTrendData', () => {
	describe('hourly mode', () => {
		it('buckets recent records by hour with correct sentiment mapping', () => {
			const data = buildTrendData(
				[
					rec('positive', hoursAgo(0.5)),
					rec('negative', hoursAgo(1.5)),
					rec('review', hoursAgo(2)),
					rec(null, hoursAgo(3))
				],
				NOW
			);

			expect(data.mode).toBe('hourly');
			expect(data.labels).toHaveLength(12);
			expect(data.positive).toHaveLength(12);
			expect(data.negative).toHaveLength(12);
			expect(data.neutral).toHaveLength(12);

			const pos = new Array(12).fill(0);
			const neg = new Array(12).fill(0);
			const neu = new Array(12).fill(0);
			pos[hourIdx(hoursAgo(0.5))]++;
			neg[hourIdx(hoursAgo(1.5))]++;
			neu[hourIdx(hoursAgo(2))]++;
			neu[hourIdx(hoursAgo(3))]++;

			expect(data.positive).toEqual(pos);
			expect(data.negative).toEqual(neg);
			expect(data.neutral).toEqual(neu);
		});

		it('ignores records older than the 12-hour window', () => {
			const data = buildTrendData(
				[rec('positive', hoursAgo(13)), rec('positive', hoursAgo(1))],
				NOW
			);

			expect(data.mode).toBe('hourly');
			expect(data.positive.reduce((a, b) => a + b, 0)).toBe(1);
		});

		it('places a record exactly at a bucket start into that bucket', () => {
			const onTheHour = new Date(NOW);
			onTheHour.setMinutes(0, 0, 0);
			const data = buildTrendData([rec('negative', onTheHour.toISOString())], NOW);

			expect(data.mode).toBe('hourly');
			expect(data.negative.reduce((a, b) => a + b, 0)).toBe(1);
			expect(data.negative[hourIdx(onTheHour.toISOString())]).toBe(1);
		});
	});

	describe('daily fallback', () => {
		it('uses 7 daily buckets when nothing falls in the last 12 hours', () => {
			const d1 = daysAgo(1);
			const d3OffBoundary = new Date(NOW.getTime() - 3 * 86_400_000 - 5 * 3_600_000).toISOString();
			const data = buildTrendData(
				[
					rec('positive', d1),
					rec('positive', d1),
					rec('negative', d1),
					rec('review', d3OffBoundary),
					rec('positive', daysAgo(6))
				],
				NOW
			);

			expect(data.mode).toBe('daily');
			expect(data.labels).toHaveLength(7);
			expect(data.positive).toHaveLength(7);
			expect(data.negative).toHaveLength(7);
			expect(data.neutral).toHaveLength(7);

			const pos = new Array(7).fill(0);
			const neg = new Array(7).fill(0);
			const neu = new Array(7).fill(0);
			pos[dayIdx(d1)] += 2;
			neg[dayIdx(d1)]++;
			neu[dayIdx(d3OffBoundary)]++;
			pos[dayIdx(daysAgo(6))]++;

			expect(data.positive).toEqual(pos);
			expect(data.negative).toEqual(neg);
			expect(data.neutral).toEqual(neu);
		});

		it('labels each bucket as its short date', () => {
			const data = buildTrendData([rec('positive', daysAgo(1))], NOW);

			expect(data.mode).toBe('daily');
			data.labels.forEach((label) => {
				expect(label).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
			});
		});
	});

	describe('empty', () => {
		it('returns empty arrays for no records', () => {
			const data = buildTrendData([], NOW);

			expect(data.mode).toBe('empty');
			expect(data.labels).toHaveLength(0);
			expect(data.positive).toHaveLength(0);
			expect(data.negative).toHaveLength(0);
			expect(data.neutral).toHaveLength(0);
		});

		it('returns empty when all records are older than 7 days', () => {
			const data = buildTrendData([rec('positive', daysAgo(8))], NOW);

			expect(data.mode).toBe('empty');
		});
	});

	it('works without an explicit now argument', () => {
		expect(() => buildTrendData([])).not.toThrow();
		expect(buildTrendData([]).mode).toBe('empty');
	});
});
