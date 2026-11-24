-- 009_performance_indexes.sql
-- Performance indexes for the analytics + issue-management hot paths.
-- These back the dashboard, live-data-stream ordering/filtering, the
-- sentiment/priorities aggregation APIs, and the sidebar badge count.
-- All use IF NOT EXISTS so they are safe to re-run.

-- 1. processed_content.processed_at — used by dashboard 7-day trend window,
--    live-data-stream ordering, sentiment-trends, and priorities.
CREATE INDEX IF NOT EXISTS idx_processed_content_processed_at
    ON public.processed_content (processed_at);

-- 2. flagged_claims.status — used by the sidebar badge/dashboard/flagged pages
--    for eq('status','Pending') filtering.
CREATE INDEX IF NOT EXISTS idx_flagged_claims_status
    ON public.flagged_claims (status);

-- 3. flagged_claims.created_at — used for ordering pending claims newest first.
CREATE INDEX IF NOT EXISTS idx_flagged_claims_created_at
    ON public.flagged_claims (created_at DESC);

-- 4. review_records.flagged_claim_id — FK from review_records to flagged_claims;
--    used by dashboard accuracy join and verified-claims. No supporting index
--    existed on the FK column (migration 008).
CREATE INDEX IF NOT EXISTS idx_review_records_flagged_claim_id
    ON public.review_records (flagged_claim_id);

-- 5. Dashboard barangay heatmap aggregate — computes per-barangay stats in SQL
--    (total mentions, negative sentiment count, flagged count) instead of the
--    server pulling every barangay-tagged row and aggregating in JS.
CREATE OR REPLACE FUNCTION public.get_barangay_stats()
RETURNS TABLE (
    name text,
    total bigint,
    negative bigint,
    flagged bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        pc.barangay_mention AS name,
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE pc.sentiment_label = 'negative')::bigint AS negative,
        COUNT(*) FILTER (WHERE pc.is_flagged)::bigint AS flagged
    FROM public.processed_content pc
    WHERE pc.barangay_mention IS NOT NULL
    GROUP BY pc.barangay_mention
    ORDER BY total DESC;
$$;

REVOKE ALL ON FUNCTION public.get_barangay_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_barangay_stats() TO authenticated;

-- 6. Issue status-change counts per issue — replaces the previous approach of
--    fetching the ENTIRE issue_status_logs table and counting in JS.
CREATE OR REPLACE FUNCTION public.get_status_change_counts()
RETURNS TABLE (
    issue_id uuid,
    change_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT isl.issue_id, COUNT(*)::bigint AS change_count
    FROM public.issue_status_logs isl
    GROUP BY isl.issue_id;
$$;

REVOKE ALL ON FUNCTION public.get_status_change_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_status_change_counts() TO authenticated;


