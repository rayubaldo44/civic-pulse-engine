import { describe, expect, it } from 'vitest';
import {
	computeClaimAccuracy,
	computeClaimAccuracyFromTally,
	consolidateReviewRecords,
	type ReviewRow,
	type ReviewTallyRow
} from '$lib/server/accuracy';

function row(
	flagged_claim_id: string,
	decision: string,
	rag_determination: string | null,
	reviewed_at = '2026-08-30T00:00:00Z'
): ReviewRow {
	return { flagged_claim_id, decision, reviewed_at, rag_determination };
}

describe('computeClaimAccuracy', () => {
	it('returns null for no usable reviews', () => {
		expect(computeClaimAccuracy([])).toBeNull();
		expect(computeClaimAccuracy([row('a', 'Pending', 'Supported')])).toBeNull();
		expect(computeClaimAccuracy([row('a', 'Verified True', null)])).toBeNull();
	});

	it('counts agreement across the three-class mapping', () => {
		const records = [
			row('a', 'Verified True', 'Supported'),
			row('b', 'Verified False', 'Refuted'),
			row('c', 'Inconclusive', 'Insufficient Evidence'),
			row('d', 'Verified True', 'Refuted') // mismatch
		];
		const acc = computeClaimAccuracy(records)!;
		expect(acc.reviewed).toBe(4);
		expect(acc.matched).toBe(3);
		expect(acc.agreementPct).toBe(75);
		expect(acc.byClass.Supported.precision).toBe(1);
		expect(acc.byClass.Supported.recall).toBe(0.5);
		expect(acc.byClass.Refuted.precision).toBe(0.5);
	});

	it('tolerates case/whitespace differences in determination', () => {
		const records = [
			row('a', 'Verified True', ' supported '),
			row('b', 'Verified False', 'Refuted'),
			row('c', 'Inconclusive', 'insufficient evidence')
		];
		const acc = computeClaimAccuracy(records)!;
		expect(acc.matched).toBe(3);
		expect(acc.agreementPct).toBe(100);
	});

	it('treats unparseable determinations as unusable for metrics', () => {
		const records = [row('a', 'Verified True', 'Seems likely'), row('b', 'Verified True', null)];
		expect(computeClaimAccuracy(records)).toBeNull();
	});

	it('ignores Pending rows even when a determination exists', () => {
		const records = [row('a', 'Pending', 'Supported'), row('b', 'Verified False', 'Refuted')];
		const acc = computeClaimAccuracy(records)!;
		expect(acc.reviewed).toBe(1);
		expect(acc.byClass.Refuted.recall).toBe(1);
	});
});

describe('consolidateReviewRecords', () => {
	it('keeps the latest decision per flagged claim', () => {
		const records = [
			row('a', 'Verified True', 'Supported', '2026-08-01T00:00:00Z'),
			row('a', 'Verified False', 'Refuted', '2026-08-02T00:00:00Z'),
			row('b', 'Verified True', 'Supported', '2026-08-01T00:00:00Z')
		];
		const deduped = consolidateReviewRecords(records);
		expect(deduped).toHaveLength(2);
		const claimA = deduped.find((r) => r.flagged_claim_id === 'a')!;
		expect(claimA.decision).toBe('Verified False');
		expect(claimA.rag_determination).toBe('Refuted');
	});

	it('treats equal timestamps as latest (last wins)', () => {
		const records = [row('a', 'Verified True', 'Supported'), row('a', 'Verified False', 'Refuted')];
		const deduped = consolidateReviewRecords(records);
		expect(deduped[0].decision).toBe('Verified False');
	});
});

function tally(decision: string, rag_determination: string | null, count = 1): ReviewTallyRow {
	return { decision, rag_determination, count };
}

describe('computeClaimAccuracyFromTally', () => {
	it('returns null for no usable tallies', () => {
		expect(computeClaimAccuracyFromTally([])).toBeNull();
		expect(computeClaimAccuracyFromTally([tally('Verified True', null)])).toBeNull();
		expect(computeClaimAccuracyFromTally([tally('Verified True', 'Not a class')])).toBeNull();
		expect(computeClaimAccuracyFromTally([tally('Verified True', 'Supported', 0)])).toBeNull();
	});

	it('matches computeClaimAccuracy on a per-claim expanded tally', () => {
		const records = [
			row('a', 'Verified True', 'Supported'),
			row('b', 'Verified False', 'Refuted'),
			row('c', 'Inconclusive', 'Insufficient Evidence'),
			row('d', 'Verified True', 'Refuted') // mismatch
		];
		const expandedTally = [
			tally('Verified True', 'Supported'),
			tally('Verified False', 'Refuted'),
			tally('Inconclusive', 'Insufficient Evidence'),
			tally('Verified True', 'Refuted')
		];
		expect(computeClaimAccuracyFromTally(expandedTally)).toEqual(computeClaimAccuracy(records));
	});

	it('weights by count', () => {
		// 3 × agree + 1 × mismatch — same numbers as the expanded tally above.
		const acc = computeClaimAccuracyFromTally([
			tally('Verified True', 'Supported', 3),
			tally('Verified True', 'Refuted')
		])!;
		expect(acc.reviewed).toBe(4);
		expect(acc.matched).toBe(3);
		expect(acc.agreementPct).toBe(75);
		expect(acc.byClass.Supported.recall).toBe(0.75);
		expect(acc.byClass.Refuted.precision).toBe(0);
	});

	it('tolerates case/whitespace differences in determination', () => {
		const acc = computeClaimAccuracyFromTally([
			tally('Verified True', ' supported '),
			tally('Verified False', 'Refuted'),
			tally('Inconclusive', 'insufficient evidence')
		])!;
		expect(acc.matched).toBe(3);
		expect(acc.agreementPct).toBe(100);
	});

	it('ignores Pending rows', () => {
		const acc = computeClaimAccuracyFromTally([
			tally('Pending', 'Supported'),
			tally('Verified False', 'Refuted')
		])!;
		expect(acc.reviewed).toBe(1);
		expect(acc.byClass.Refuted.recall).toBe(1);
	});
});
