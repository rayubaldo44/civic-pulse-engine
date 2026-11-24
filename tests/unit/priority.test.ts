import { describe, expect, it } from 'vitest';
import {
	computeTopicPriorities,
	deriveTopicStatus,
	normalizeTopic,
	MIN_SUPPORT,
	PRIORITY_WEIGHTS
} from '$lib/utils/priority';

function stats(
	topic: string,
	commentCount: number,
	negativeCount: number,
	engagementCount: number
) {
	return { topic, commentCount, negativeCount, engagementCount };
}

describe('computeTopicPriorities', () => {
	it('weights sum to 1', () => {
		const total =
			PRIORITY_WEIGHTS.frequency + PRIORITY_WEIGHTS.negativity + PRIORITY_WEIGHTS.engagement;
		expect(total).toBeCloseTo(1);
	});

	it('returns empty array for no input', () => {
		expect(computeTopicPriorities([])).toEqual([]);
	});

	it('ignores rows with zero comments', () => {
		const result = computeTopicPriorities([stats('Infrastructure', 0, 0, 0)]);
		expect(result).toEqual([]);
	});

	it('ranks the dominant topic first with the maximum score of 100', () => {
		const result = computeTopicPriorities([
			stats('Infrastructure', 30, 30, 100),
			stats('Healthcare', 3, 0, 0)
		]);

		expect(result[0].rank).toBe(1);
		expect(result[0].topic).toBe('Infrastructure');
		expect(result[0].score).toBe(100);
	});

	it('scores a fully negative topic at the negativity weight ceiling when frequency is maxed', () => {
		const result = computeTopicPriorities([
			stats('Infrastructure', 10, 10, 0),
			stats('Healthcare', 1, 1, 0)
		]);
		const top = result.find((r) => r.topic === 'Infrastructure')!;
		expect(top.score).toBe(
			Math.round(100 * PRIORITY_WEIGHTS.frequency + 100 * PRIORITY_WEIGHTS.negativity)
		);
	});

	it('gives zero engagement component when all engagement counts are zero', () => {
		const result = computeTopicPriorities([stats('Other', 5, 2, 0), stats('Healthcare', 4, 1, 0)]);
		for (const row of result) {
			expect(row.engagementComponent).toBe(0);
			expect(row.score).toBeLessThanOrEqual(
				Math.round(100 * (PRIORITY_WEIGHTS.frequency + PRIORITY_WEIGHTS.negativity))
			);
		}
	});

	it('breaks score ties by higher negativity, then frequency, then name', () => {
		const result = computeTopicPriorities([
			stats('Public Safety', 6, 3, 0),
			stats('Waste Management', 6, 4, 0),
			stats('Healthcare', 9, 3, 0),
			stats('Infrastructure', 6, 3, 0)
		]);

		expect(result.map((r) => r.topic)).toEqual([
			'Healthcare',
			'Waste Management',
			'Infrastructure',
			'Public Safety'
		]);
		expect(result.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
	});

	it('excludes topics below MIN_SUPPORT while any topic meets it', () => {
		const result = computeTopicPriorities([
			stats('Infrastructure', MIN_SUPPORT, 3, 0),
			stats('Healthcare', MIN_SUPPORT - 1, 2, 50)
		]);

		expect(result).toHaveLength(1);
		expect(result[0].topic).toBe('Infrastructure');
	});

	it('keeps low-volume topics when nothing clears MIN_SUPPORT (small datasets)', () => {
		const result = computeTopicPriorities([
			stats('Infrastructure', 2, 1, 0),
			stats('Healthcare', 1, 0, 0)
		]);

		expect(result).toHaveLength(2);
	});

	it('assigns consecutive ranks in sorted order and maps display names', () => {
		const result = computeTopicPriorities([
			stats('Waste Management', 8, 4, 10),
			stats('Infrastructure', 12, 6, 20)
		]);

		expect(result.map((r) => r.rank)).toEqual([1, 2]);
		expect(result[0].displayName).toBe('Road Repair');
		expect(result[1].displayName).toBe('Waste Collection');
	});
});

describe('normalizeTopic', () => {
	it('passes canonical topics through unchanged', () => {
		expect(normalizeTopic('Infrastructure')).toBe('Infrastructure');
		expect(normalizeTopic('Waste Management')).toBe('Waste Management');
		expect(normalizeTopic('Other')).toBe('Other');
	});

	it('maps observed NLP compound variants onto canonical topics', () => {
		expect(normalizeTopic('Public Safety and Peace and Order')).toBe('Public Safety');
		expect(normalizeTopic('Infrastructure and Public Works')).toBe('Infrastructure');
		expect(normalizeTopic('Healthcare and Medical Services')).toBe('Healthcare');
		expect(normalizeTopic('Waste Management and Sanitation')).toBe('Waste Management');
	});

	it('is case-insensitive for both canonical values and aliases', () => {
		expect(normalizeTopic('  infrastructure ')).toBe('Infrastructure');
		expect(normalizeTopic('HEALTH SERVICES')).toBe('Healthcare');
	});

	it('folds unknown labels, whitespace, and nulls into Other', () => {
		expect(normalizeTopic('Local Governance')).toBe('Other');
		expect(normalizeTopic('Environment')).toBe('Other');
		expect(normalizeTopic('   ')).toBe('Other');
		expect(normalizeTopic(null)).toBe('Other');
		expect(normalizeTopic(undefined)).toBe('Other');
	});
});

describe('deriveTopicStatus', () => {
	it('is New when no tickets exist', () => {
		expect(deriveTopicStatus([])).toBe('New');
	});

	it('is Monitoring while any ticket is active', () => {
		expect(deriveTopicStatus(['Open'])).toBe('Monitoring');
		expect(deriveTopicStatus(['Resolved', 'Open'])).toBe('Monitoring');
		expect(deriveTopicStatus(['In Progress'])).toBe('Monitoring');
		expect(deriveTopicStatus(['Under Review'])).toBe('Monitoring');
	});

	it('is Addressed only when every ticket is Resolved or Closed', () => {
		expect(deriveTopicStatus(['Resolved'])).toBe('Addressed');
		expect(deriveTopicStatus(['Closed', 'Resolved'])).toBe('Addressed');
	});
});
