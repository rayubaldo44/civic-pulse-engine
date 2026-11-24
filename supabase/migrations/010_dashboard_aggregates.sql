-- 010_dashboard_aggregates.sql
-- SQL-side aggregates for the dashboard hot paths. Previously the dashboard
-- load() pulled EVERY processed_content row (sentiment/topic labels) and every
-- review_records row into the server, re-aggregated in JS, then re-serialized
-- the raw rows into the SSR payload. These RPCs return only the small summary
-- arrays the UI needs — same house style as 009_performance_indexes.sql
-- (LANGUAGE sql STABLE SECURITY DEFINER, revoked from PUBLIC).

-- 1. Per-sentiment label counts across processed_content (all-time).
CREATE OR REPLACE FUNCTION public.get_sentiment_counts()
RETURNS TABLE (label text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT sentiment_label AS label, COUNT(*)::bigint AS count
    FROM public.processed_content
    WHERE sentiment_label IS NOT NULL
    GROUP BY sentiment_label
    ORDER BY count DESC;
$$;

REVOKE ALL ON FUNCTION public.get_sentiment_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sentiment_counts() TO authenticated;

-- 2. Per-topic counts across processed_content (all-time).
CREATE OR REPLACE FUNCTION public.get_topic_counts()
RETURNS TABLE (label text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT topic_label AS label, COUNT(*)::bigint AS count
    FROM public.processed_content
    WHERE topic_label IS NOT NULL
    GROUP BY topic_label
    ORDER BY count DESC;
$$;

REVOKE ALL ON FUNCTION public.get_topic_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_topic_counts() TO authenticated;

-- 3. Human-review accuracy tally: per (decision, rag_determination) counts.
--    A claim can be re-reviewed, so only the LATEST review per claim counts —
--    mirrors consolidateReviewRecords() in $lib/server/accuracy.ts
--    (reviewed_at DESC, id DESC tie-break, matching the JS "last wins")
--    then groups by decision x determination.
CREATE OR REPLACE FUNCTION public.get_review_tally()
RETURNS TABLE (decision text, rag_determination text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH latest AS (
        SELECT DISTINCT ON (rr.flagged_claim_id)
            rr.flagged_claim_id,
            rr.decision,
            rr.id
        FROM public.review_records rr
        ORDER BY rr.flagged_claim_id, rr.reviewed_at DESC, rr.id DESC
    )
    SELECT l.decision, fc.rag_determination, COUNT(*)::bigint AS count
    FROM latest l
    JOIN public.flagged_claims fc ON fc.id = l.flagged_claim_id
    GROUP BY l.decision, fc.rag_determination;
$$;

REVOKE ALL ON FUNCTION public.get_review_tally() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_review_tally() TO authenticated;

-- 4. Sidebar badges in a single round-trip. The layout load previously fired
--    TWO separate COUNT(*) head queries on every authenticated page visit.
CREATE OR REPLACE FUNCTION public.get_sidebar_badges(p_user_id uuid)
RETURNS TABLE (pending bigint, my_tasks bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        (SELECT COUNT(*) FROM public.flagged_claims WHERE status = 'Pending')::bigint AS pending,
        (
            SELECT COUNT(*) FROM public.civic_issues
            WHERE assigned_to = p_user_id
              AND status IN ('Open', 'In Progress', 'Under Review')
        )::bigint AS my_tasks;
$$;

REVOKE ALL ON FUNCTION public.get_sidebar_badges(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sidebar_badges(uuid) TO authenticated;