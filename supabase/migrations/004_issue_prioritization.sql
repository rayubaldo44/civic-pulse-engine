-- =============================================================================
-- 004_issue_prioritization.sql
-- Issue Prioritization feature — engagement signals + aggregation index + RLS
-- =============================================================================
-- Adds the two missing scoring inputs (engagement) to raw_content and an
-- index for topic/time-window aggregation over processed_content.
-- reaction_count / reply_count default to 0 until the Facebook ingestion
-- cron populates them; the priority formula degrades gracefully at 0.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Engagement counters on raw_content
-- ---------------------------------------------------------------------------
ALTER TABLE public.raw_content
  ADD COLUMN IF NOT EXISTS reaction_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reply_count    integer NOT NULL DEFAULT 0;

ALTER TABLE public.raw_content
  ADD CONSTRAINT chk_raw_content_reaction_nonneg CHECK (reaction_count >= 0),
  ADD CONSTRAINT chk_raw_content_reply_nonneg    CHECK (reply_count >= 0);

-- ---------------------------------------------------------------------------
-- 2. Index for per-topic time-window aggregation on processed_content
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_processed_content_topic_time
  ON public.processed_content (topic_label, processed_at)
  WHERE topic_label IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. RLS hardening
-- ---------------------------------------------------------------------------
-- These tables predate this repo's migration history; their policies were
-- managed directly in the Supabase dashboard. Idempotently ensure:
--   * RLS is enabled
--   * authenticated users may SELECT (LGU staff dashboards read aggregates)
--   * anon role may NOT read raw/processed public feedback
--
-- NOTE: no INSERT/UPDATE/DELETE policies are created here on purpose —
-- writes to these tables flow exclusively through service-role contexts
-- (Edge Functions, ingestion cron), which bypass RLS.

ALTER TABLE public.raw_content       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_select_raw_content ON public.raw_content;
CREATE POLICY auth_select_raw_content
  ON public.raw_content FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS auth_select_processed_content ON public.processed_content;
CREATE POLICY auth_select_processed_content
  ON public.processed_content FOR SELECT
  TO authenticated
  USING (true);
