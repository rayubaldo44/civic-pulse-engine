-- ═══════════════════════════════════════════════════════════════════════════
-- 012_api_window_aggregates.sql
-- SQL-side aggregation for the two API endpoints that previously transferred
-- EVERY row in the window (7/30/90 days for priorities, up to year-long for
-- sentiment-trends) into the serverless lambda and aggregated in JS.
-- Returns only compact per-label / per-day counts; normalization + bucketing
-- still happens in $lib (single source of truth). Same house style as
-- 009/010 (LANGUAGE sql STABLE SECURITY DEFINER, revoked from PUBLIC).
-- Requires 004 (reaction_count/reply_count) for the engagement variant.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Covering index for window scans ──────────────────────────────────────
-- The sentiment/priority aggregates read (processed_at >= p_since) plus the
-- sentiment_label/topic_label/raw_content_id columns. INCLUDE columns make the
-- window scan an index-only scan (no heap fetch per row).
CREATE INDEX IF NOT EXISTS idx_processed_content_window_covering
    ON public.processed_content (processed_at)
    INCLUDE (topic_label, sentiment_label, raw_content_id);

-- ── 2. Priorities: per-topic_label window stats (+ engagement) ───────────────
-- Returns one row per raw topic_label within the [p_since, now) window.
-- The handler re-normalizes these compact labels via normalizeTopic().
CREATE OR REPLACE FUNCTION public.get_topic_window_stats(p_since timestamptz)
RETURNS TABLE (
    topic_label text,
    comment_count bigint,
    negative_count bigint,
    engagement_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        pc.topic_label,
        COUNT(*)::bigint,
        COUNT(*) FILTER (WHERE pc.sentiment_label = 'negative')::bigint,
        (COALESCE(SUM(rc.reaction_count), 0) + COALESCE(SUM(rc.reply_count), 0))::bigint
    FROM public.processed_content pc
    JOIN public.raw_content rc ON rc.id = pc.raw_content_id
    WHERE pc.processed_at >= p_since
      AND pc.topic_label IS NOT NULL
    GROUP BY pc.topic_label;
$$;

REVOKE ALL ON FUNCTION public.get_topic_window_stats(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_topic_window_stats(timestamptz) TO authenticated;

-- ── 3. Priorities fallback: same window without engagement ──────────────────
-- Used when migration 004 (reaction_count/reply_count) has not been applied —
-- mirrors the JS-side 42703 graceful degradation in GET /api/priorities.
CREATE OR REPLACE FUNCTION public.get_topic_window_stats_basic(p_since timestamptz)
RETURNS TABLE (
    topic_label text,
    comment_count bigint,
    negative_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        pc.topic_label,
        COUNT(*)::bigint,
        COUNT(*) FILTER (WHERE pc.sentiment_label = 'negative')::bigint
    FROM public.processed_content pc
    WHERE pc.processed_at >= p_since
      AND pc.topic_label IS NOT NULL
    GROUP BY pc.topic_label;
$$;

REVOKE ALL ON FUNCTION public.get_topic_window_stats_basic(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_topic_window_stats_basic(timestamptz) TO authenticated;

-- ── 4. Sentiment trends: per-civil-day × sentiment × topic × platform counts ─
-- civil_date is the Manila civil day: processed_at + 8h (UTC+8, no DST) then
-- to_char 'YYYY-MM-DD' — identical to manilaDateKey() in $lib. The handler
-- filters by normalized topic / platform, then buckets via
-- buildTrendSeriesFromCounts() (weekly/monthly → daily, yearly → YYYY-MM).
-- This feeds the live card's weekly/monthly/yearly ranges; 'live' stays on
-- the bounded 7-day row fetch (server-TZ hourly bucketing, not SQL-able).
CREATE OR REPLACE FUNCTION public.get_sentiment_window_counts(p_since timestamptz)
RETURNS TABLE (
    civil_date text,
    sentiment_label text,
    topic_label text,
    source_platform text,
    count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        to_char(pc.processed_at + interval '8 hours', 'YYYY-MM-DD') AS civil_date,
        pc.sentiment_label,
        pc.topic_label,
        rc.source_platform,
        COUNT(*)::bigint AS count
    FROM public.processed_content pc
    JOIN public.raw_content rc ON rc.id = pc.raw_content_id
    WHERE pc.processed_at >= p_since
    GROUP BY 1, 2, 3, 4;
$$;

REVOKE ALL ON FUNCTION public.get_sentiment_window_counts(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sentiment_window_counts(timestamptz) TO authenticated;

-- ── 5. Dashboard exact total in a single round-trip ─────────────────────────
-- Replaces the previous head-count query (`select('*', { count: 'exact',
-- head: true })`) that ran count(*) on every dashboard load. Same count,
-- one PostgREST call. (A trigger-maintained counter is the future upgrade
-- if processed_content grows large.)
CREATE OR REPLACE FUNCTION public.get_analytics_totals()
RETURNS TABLE (total bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COUNT(*)::bigint FROM public.processed_content;
$$;

REVOKE ALL ON FUNCTION public.get_analytics_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_analytics_totals() TO authenticated;