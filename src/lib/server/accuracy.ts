// src/lib/server/accuracy.ts
//
// Human-verified accuracy metrics for the RAG fact-check pipeline.
//
// Ground truth comes from review_records: LGU staff review each flagged claim
// and record a decision (Verified True / Verified False / Inconclusive). The
// RAG determination (Supported / Refuted / Insufficient Evidence) is compared
// against that human decision using an agreement map:
//
//   Verified True        ↔ Supported
//   Verified False       ↔ Refuted
//   Inconclusive         ↔ Insufficient Evidence
//
// Pure module (no Supabase imports) so it is unit-testable in isolation. The
// dashboard load() fetches rows and passes them in.

export type RagDetermination = 'Supported' | 'Refuted' | 'Insufficient Evidence';

export type ReviewDecision = 'Verified True' | 'Verified False' | 'Inconclusive';

export interface ReviewRow {
	flagged_claim_id: string;
	decision: string;
	reviewed_at: string;
	/** RAG determination on the claim at review time (may be null). */
	rag_determination: string | null;
}

export interface ClassAccuracy {
	/** Rows where RAG predicted this class. */
	predicted: number;
	/** Rows where predicted class agreed with the human decision. */
	agreement: number;
	/** Rows where the human decision's ground-truth class was this. */
	actual: number;
	/** agreement / predicted — null when nothing predicted this class. */
	precision: number | null;
	/** agreement / actual — null when no ground truth for this class. */
	recall: number | null;
}

/**
 * Aggregated per-(decision, determination) counts — the shape returned by the
 * `get_review_tally` RPC. Each row already reflects the LATEST review per
 * flagged claim (dedup done in SQL), so the JS side only re-weights by count.
 */
export interface ReviewTallyRow {
	decision: string;
	rag_determination: string | null;
	count: number;
}

export interface ClaimAccuracy {
	/** Distinct reviewed flags with a parseable determination. */
	reviewed: number;
	/** Rows whose determination matched the human decision. */
	matched: number;
	/** round(100 × matched / reviewed) — null when reviewed is 0. */
	agreementPct: number | null;
	byClass: Record<RagDetermination, ClassAccuracy>;
}

export const RAG_DETERMINATIONS: readonly RagDetermination[] = [
	'Supported',
	'Refuted',
	'Insufficient Evidence'
];

export const DECISION_TO_CLASS: Record<ReviewDecision, RagDetermination> = {
	'Verified True': 'Supported',
	'Verified False': 'Refuted',
	Inconclusive: 'Insufficient Evidence'
};

function toDetermination(value: string | null | undefined): RagDetermination | null {
	if (!value) return null;
	const key = value.trim().toLowerCase();
	if (key === 'supported') return 'Supported';
	if (key === 'refuted') return 'Refuted';
	if (key === 'insufficient evidence' || key === 'insufficient') return 'Insufficient Evidence';
	return null;
}

/**
 * Keep only the most recent review decision per flagged claim. A claim can be
 * re-reviewed (Pending → decision → Pending → new decision), so counting every
 * review_record would double-count stale decisions.
 */
export function consolidateReviewRecords(records: ReviewRow[]): ReviewRow[] {
	const latest = new Map<string, ReviewRow>();
	for (const record of records) {
		const prev = latest.get(record.flagged_claim_id);
		if (!prev || record.reviewed_at >= prev.reviewed_at) {
			latest.set(record.flagged_claim_id, record);
		}
	}
	return [...latest.values()];
}

// Shared accumulator so the raw-row path and the SQL-tally path can never drift.
// `usable` must contain only rows with a parseable determination AND a decision
// that maps to a ground-truth class. Returned null when it is empty.
function accumulateAccuracy(
	usable: { decision: string; rag_determination: string | null; weight: number }[]
): ClaimAccuracy | null {
	const byClass: Record<RagDetermination, ClassAccuracy> = {
		Supported: { predicted: 0, agreement: 0, actual: 0, precision: null, recall: null },
		Refuted: { predicted: 0, agreement: 0, actual: 0, precision: null, recall: null },
		'Insufficient Evidence': {
			predicted: 0,
			agreement: 0,
			actual: 0,
			precision: null,
			recall: null
		}
	};

	let reviewed = 0;
	let matched = 0;
	for (const row of usable) {
		const prediction = toDetermination(row.rag_determination) as RagDetermination;
		const truth = DECISION_TO_CLASS[row.decision as ReviewDecision];

		reviewed += row.weight;
		byClass[prediction].predicted += row.weight;
		byClass[truth].actual += row.weight;
		if (prediction === truth) {
			byClass[prediction].agreement += row.weight;
			matched += row.weight;
		}
	}

	if (reviewed === 0) return null;

	for (const cls of RAG_DETERMINATIONS) {
		const acc = byClass[cls];
		acc.precision = acc.predicted > 0 ? acc.agreement / acc.predicted : null;
		acc.recall = acc.actual > 0 ? acc.agreement / acc.actual : null;
	}

	return {
		reviewed,
		matched,
		agreementPct: reviewed > 0 ? Math.round((matched / reviewed) * 100) : null,
		byClass
	};
}

/**
 * Compute human-verified accuracy of RAG determinations from raw review rows.
 * Returns null when no usable (determination + non-Pending decision) reviews
 * exist yet, so callers degrade gracefully to "no human reviews yet".
 */
export function computeClaimAccuracy(records: ReviewRow[]): ClaimAccuracy | null {
	const distinct = consolidateReviewRecords(records).filter((r) => r.decision !== 'Pending');
	return accumulateAccuracy(
		distinct
			.filter(
				(r) =>
					toDetermination(r.rag_determination) && DECISION_TO_CLASS[r.decision as ReviewDecision]
			)
			.map((r) => ({ ...r, weight: 1 }))
	);
}

/**
 * Same metrics as `computeClaimAccuracy`, but fed by the `get_review_tally`
 * RPC — per-(decision, determination) counts already deduped to each claim's
 * latest review. Enables the dashboard to stop shipping raw review rows.
 */
export function computeClaimAccuracyFromTally(tally: ReviewTallyRow[]): ClaimAccuracy | null {
	return accumulateAccuracy(
		tally
			.filter(
				(row) =>
					row.decision !== 'Pending' &&
					row.count > 0 &&
					toDetermination(row.rag_determination) &&
					DECISION_TO_CLASS[row.decision as ReviewDecision]
			)
			.map((row) => ({
				decision: row.decision,
				rag_determination: row.rag_determination,
				weight: row.count
			}))
	);
}
