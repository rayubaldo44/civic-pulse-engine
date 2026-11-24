-- =============================================================================
-- 001_civic_issues.sql
-- Issue Prioritization & Feedback Tracking — new tables, triggers, RLS
-- =============================================================================
-- NOTE: FKs reference the actual table names in this project:
--   processed_content  (spec said "processed_comments")
--   profiles           (spec said "users")
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. civic_issues
-- ---------------------------------------------------------------------------
CREATE TABLE public.civic_issues (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 TEXT        NOT NULL,
  description           TEXT,
  source_comment_id     UUID        REFERENCES public.processed_content(id) ON DELETE SET NULL,
  source_flagged_claim_id UUID      REFERENCES public.flagged_claims(id)    ON DELETE SET NULL,
  topic                 TEXT,
  priority              TEXT        NOT NULL DEFAULT 'Medium'
                                    CHECK (priority IN ('Critical','High','Medium','Low')),
  status                TEXT        NOT NULL DEFAULT 'Open'
                                    CHECK (status IN ('Open','In Progress','Under Review','Resolved','Closed')),
  assigned_to           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by            UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 2. issue_status_logs  — full audit trail of every status transition
-- ---------------------------------------------------------------------------
CREATE TABLE public.issue_status_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    UUID        NOT NULL REFERENCES public.civic_issues(id) ON DELETE CASCADE,
  changed_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  from_status TEXT,
  to_status   TEXT,
  note        TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. issue_comments  — internal staff discussion thread per issue
-- ---------------------------------------------------------------------------
CREATE TABLE public.issue_comments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id   UUID        NOT NULL REFERENCES public.civic_issues(id) ON DELETE CASCADE,
  author_id  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  body       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- INDEXES for common query patterns
-- ---------------------------------------------------------------------------
CREATE INDEX idx_civic_issues_status    ON public.civic_issues (status);
CREATE INDEX idx_civic_issues_priority  ON public.civic_issues (priority);
CREATE INDEX idx_civic_issues_topic     ON public.civic_issues (topic);
CREATE INDEX idx_civic_issues_source_comment ON public.civic_issues (source_comment_id);
CREATE INDEX idx_issue_status_logs_issue_id ON public.issue_status_logs (issue_id);
CREATE INDEX idx_issue_comments_issue_id    ON public.issue_comments    (issue_id);

-- ---------------------------------------------------------------------------
-- TRIGGER 1: auto-set updated_at on every UPDATE to civic_issues
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_civic_issue_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_civic_issues_updated_at
  BEFORE UPDATE ON public.civic_issues
  FOR EACH ROW
  EXECUTE FUNCTION public.set_civic_issue_updated_at();

-- ---------------------------------------------------------------------------
-- TRIGGER 2: auto-insert into issue_status_logs when status changes
--            Also sets resolved_at when transitioning to 'Resolved'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_civic_issue_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only fire when status actually changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.issue_status_logs (issue_id, changed_by, from_status, to_status)
    VALUES (NEW.id, NEW.assigned_to, OLD.status, NEW.status);

    -- Auto-stamp resolved_at when moving to Resolved
    IF NEW.status = 'Resolved' THEN
      NEW.resolved_at = now();
    END IF;
    -- Clear resolved_at if re-opened
    IF NEW.status = 'Open' THEN
      NEW.resolved_at = NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_civic_issues_status_log
  BEFORE UPDATE ON public.civic_issues
  FOR EACH ROW
  EXECUTE FUNCTION public.log_civic_issue_status_change();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE public.civic_issues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_status_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_comments     ENABLE ROW LEVEL SECURITY;

-- civic_issues: authenticated users can SELECT / INSERT / UPDATE
CREATE POLICY "auth_select_civic_issues"
  ON public.civic_issues FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "auth_insert_civic_issues"
  ON public.civic_issues FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_civic_issues"
  ON public.civic_issues FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- service_role only for DELETE
CREATE POLICY "service_delete_civic_issues"
  ON public.civic_issues FOR DELETE
  TO service_role
  USING (true);

-- issue_status_logs: authenticated SELECT / INSERT / UPDATE
CREATE POLICY "auth_select_issue_status_logs"
  ON public.issue_status_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "auth_insert_issue_status_logs"
  ON public.issue_status_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_issue_status_logs"
  ON public.issue_status_logs FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_delete_issue_status_logs"
  ON public.issue_status_logs FOR DELETE
  TO service_role
  USING (true);

-- issue_comments: authenticated SELECT / INSERT / UPDATE
CREATE POLICY "auth_select_issue_comments"
  ON public.issue_comments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "auth_insert_issue_comments"
  ON public.issue_comments FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "auth_update_issue_comments"
  ON public.issue_comments FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_delete_issue_comments"
  ON public.issue_comments FOR DELETE
  TO service_role
  USING (true);
