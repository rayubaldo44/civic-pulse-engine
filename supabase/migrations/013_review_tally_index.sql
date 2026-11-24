-- 013_review_tally_index.sql
-- Composite index backing get_review_tally()'s DISTINCT ON
-- (migration 010 lines 57-64: ORDER BY flagged_claim_id, reviewed_at DESC, id DESC).
-- Previously only idx_review_records_flagged_claim_id (flagged_claim_id alone)
-- existed, so Postgres sorted each claim's reviews by reviewed_at DESC on the
-- fly for every dashboard load. This makes the DISTINCT ON a true index scan.
-- Additive + IF NOT EXISTS (house style, safe to re-run).

CREATE INDEX IF NOT EXISTS idx_review_records_claim_reviewed
    ON public.review_records (flagged_claim_id, reviewed_at DESC, id DESC);