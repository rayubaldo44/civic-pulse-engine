-- Peer-reviewed issue resolution. All writes stay behind service-role RPCs so
-- clients cannot inspect blind votes or bypass the majority gate.

BEGIN;

CREATE TABLE public.issue_resolution_rounds (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id            uuid NOT NULL REFERENCES public.civic_issues(id) ON DELETE CASCADE,
    round_number        integer NOT NULL CHECK (round_number > 0),
    submitted_by        uuid NOT NULL REFERENCES public.profiles(id),
    resolution_summary  text NOT NULL CHECK (length(trim(resolution_summary)) > 0),
    actions_taken       text NOT NULL CHECK (length(trim(actions_taken)) > 0),
    observed_outcome    text NOT NULL CHECK (length(trim(observed_outcome)) > 0),
    evidence_links      jsonb NOT NULL CHECK (
        jsonb_typeof(evidence_links) = 'array' AND jsonb_array_length(evidence_links) > 0
    ),
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'passed', 'failed')),
    submitted_at        timestamptz NOT NULL DEFAULT now(),
    decided_at          timestamptz,
    UNIQUE (issue_id, round_number)
);

CREATE UNIQUE INDEX issue_resolution_one_pending
    ON public.issue_resolution_rounds (issue_id) WHERE status = 'pending';

CREATE TABLE public.issue_resolution_reviews (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id              uuid NOT NULL REFERENCES public.issue_resolution_rounds(id) ON DELETE CASCADE,
    reviewer_id           uuid NOT NULL REFERENCES public.profiles(id),
    decision              text CHECK (decision IN ('approve', 'request_changes')),
    actions_completed     boolean,
    evidence_sufficient   boolean,
    outcome_addresses_issue boolean,
    no_unresolved_blocker boolean,
    comment               text,
    assigned_at           timestamptz NOT NULL DEFAULT now(),
    due_at                timestamptz NOT NULL DEFAULT now() + interval '72 hours',
    submitted_at          timestamptz,
    reminder_sent_at      timestamptz,
    UNIQUE (round_id, reviewer_id)
);

CREATE INDEX issue_resolution_reviews_reviewer
    ON public.issue_resolution_reviews (reviewer_id, submitted_at, due_at);

ALTER TABLE public.issue_resolution_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_resolution_reviews ENABLE ROW LEVEL SECURITY;
-- Deliberately no client policies: blind review data is returned only through
-- the viewer-aware issue detail endpoint.

CREATE OR REPLACE FUNCTION public.start_issue_resolution_round(
    p_issue_id uuid,
    p_submitted_by uuid,
    p_resolution_summary text,
    p_actions_taken text,
    p_observed_outcome text,
    p_evidence_links jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_issue public.civic_issues%ROWTYPE;
    v_round_id uuid;
    v_round_number integer;
    v_count integer;
BEGIN
    SELECT * INTO v_issue FROM public.civic_issues WHERE id = p_issue_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Issue not found'; END IF;
    IF v_issue.status <> 'In Progress' THEN
        RAISE EXCEPTION 'Only In Progress issues can enter peer review';
    END IF;
    IF v_issue.assigned_to IS DISTINCT FROM p_submitted_by THEN
        RAISE EXCEPTION 'Only the assigned analyst can submit a resolution';
    END IF;
    IF trim(COALESCE(p_resolution_summary, '')) = ''
       OR trim(COALESCE(p_actions_taken, '')) = ''
       OR trim(COALESCE(p_observed_outcome, '')) = ''
       OR jsonb_typeof(p_evidence_links) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_evidence_links) = 0 THEN
        RAISE EXCEPTION 'Complete the resolution summary, actions, outcome, and evidence links';
    END IF;

    SELECT COALESCE(max(round_number), 0) + 1 INTO v_round_number
    FROM public.issue_resolution_rounds WHERE issue_id = p_issue_id;

    INSERT INTO public.issue_resolution_rounds (
        issue_id, round_number, submitted_by, resolution_summary,
        actions_taken, observed_outcome, evidence_links
    ) VALUES (
        p_issue_id, v_round_number, p_submitted_by, trim(p_resolution_summary),
        trim(p_actions_taken), trim(p_observed_outcome), p_evidence_links
    ) RETURNING id INTO v_round_id;

    WITH candidates AS (
        SELECT p.id,
               CASE WHEN p.role = 'analyst' THEN 0 ELSE 1 END AS role_rank,
               EXISTS (
                   SELECT 1
                   FROM public.issue_resolution_reviews previous_review
                   JOIN public.issue_resolution_rounds previous_round
                     ON previous_round.id = previous_review.round_id
                   WHERE previous_round.issue_id = p_issue_id
                     AND previous_review.reviewer_id = p.id
               ) AS reviewed_before,
               (SELECT count(*)
                FROM public.issue_resolution_reviews pending_review
                JOIN public.issue_resolution_rounds pending_round
                  ON pending_round.id = pending_review.round_id
                WHERE pending_review.reviewer_id = p.id
                  AND pending_review.submitted_at IS NULL
                  AND pending_round.status = 'pending') AS pending_count
        FROM public.profiles p
        WHERE p.password_set = true
          AND p.role IN ('analyst', 'admin')
          AND p.id <> v_issue.assigned_to
          AND (v_issue.created_by IS NULL OR p.id <> v_issue.created_by)
        ORDER BY role_rank, reviewed_before, pending_count, random()
        LIMIT 3
    )
    INSERT INTO public.issue_resolution_reviews (round_id, reviewer_id)
    SELECT v_round_id, id FROM candidates;

    SELECT count(*) INTO v_count
    FROM public.issue_resolution_reviews WHERE round_id = v_round_id;
    IF v_count <> 3 THEN
        RAISE EXCEPTION 'Three eligible reviewers are required';
    END IF;

    UPDATE public.civic_issues SET status = 'Under Review' WHERE id = p_issue_id;
    RETURN v_round_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_issue_resolution_review(
    p_round_id uuid,
    p_reviewer_id uuid,
    p_decision text,
    p_actions_completed boolean,
    p_evidence_sufficient boolean,
    p_outcome_addresses_issue boolean,
    p_no_unresolved_blocker boolean,
    p_comment text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_review public.issue_resolution_reviews%ROWTYPE;
    v_round public.issue_resolution_rounds%ROWTYPE;
    v_submitted integer;
    v_approvals integer;
    v_result text := 'pending';
BEGIN
    SELECT * INTO v_round FROM public.issue_resolution_rounds
    WHERE id = p_round_id FOR UPDATE;
    IF NOT FOUND OR v_round.status <> 'pending' THEN
        RAISE EXCEPTION 'Review round is closed';
    END IF;

    SELECT * INTO v_review FROM public.issue_resolution_reviews
    WHERE round_id = p_round_id AND reviewer_id = p_reviewer_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You are not assigned to this review'; END IF;
    IF v_review.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'Review already submitted'; END IF;
    IF p_decision NOT IN ('approve', 'request_changes') THEN
        RAISE EXCEPTION 'Invalid review decision';
    END IF;
    IF p_decision = 'approve' AND NOT (
        COALESCE(p_actions_completed, false)
        AND COALESCE(p_evidence_sufficient, false)
        AND COALESCE(p_outcome_addresses_issue, false)
        AND COALESCE(p_no_unresolved_blocker, false)
    ) THEN RAISE EXCEPTION 'Every criterion must pass before approval'; END IF;
    IF p_decision = 'request_changes' AND trim(COALESCE(p_comment, '')) = '' THEN
        RAISE EXCEPTION 'Explain what must change';
    END IF;

    UPDATE public.issue_resolution_reviews SET
        decision = p_decision,
        actions_completed = p_actions_completed,
        evidence_sufficient = p_evidence_sufficient,
        outcome_addresses_issue = p_outcome_addresses_issue,
        no_unresolved_blocker = p_no_unresolved_blocker,
        comment = NULLIF(trim(COALESCE(p_comment, '')), ''),
        submitted_at = now()
    WHERE id = v_review.id;

    SELECT count(*), count(*) FILTER (WHERE decision = 'approve')
    INTO v_submitted, v_approvals
    FROM public.issue_resolution_reviews
    WHERE round_id = p_round_id AND submitted_at IS NOT NULL;

    IF v_submitted = 3 THEN
        v_result := CASE WHEN v_approvals >= 2 THEN 'passed' ELSE 'failed' END;
        UPDATE public.issue_resolution_rounds
        SET status = v_result, decided_at = now()
        WHERE id = p_round_id;
        UPDATE public.civic_issues
        SET status = CASE WHEN v_result = 'passed' THEN 'Resolved' ELSE 'In Progress' END
        WHERE id = v_round.issue_id;
        UPDATE public.issue_status_logs SET
            changed_by = p_reviewer_id,
            note = CASE WHEN v_result = 'passed'
                THEN 'Resolved by peer-review majority.'
                ELSE 'Peer review requested changes.' END
        WHERE id = (
            SELECT id FROM public.issue_status_logs
            WHERE issue_id = v_round.issue_id
            ORDER BY changed_at DESC LIMIT 1
        );
    END IF;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_issue_resolution_reviewer(
    p_review_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_review public.issue_resolution_reviews%ROWTYPE;
    v_round public.issue_resolution_rounds%ROWTYPE;
    v_issue public.civic_issues%ROWTYPE;
    v_reviewer_id uuid;
BEGIN
    SELECT * INTO v_review FROM public.issue_resolution_reviews
    WHERE id = p_review_id FOR UPDATE;
    IF NOT FOUND OR v_review.submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Only an unsubmitted review can be reassigned';
    END IF;
    SELECT * INTO v_round FROM public.issue_resolution_rounds WHERE id = v_review.round_id;
    IF v_round.status <> 'pending' THEN RAISE EXCEPTION 'Review round is closed'; END IF;
    SELECT * INTO v_issue FROM public.civic_issues WHERE id = v_round.issue_id;

    SELECT p.id INTO v_reviewer_id
    FROM public.profiles p
    WHERE p.password_set = true
      AND p.role IN ('analyst', 'admin')
      AND p.id <> v_issue.assigned_to
      AND p.id <> v_review.reviewer_id
      AND (v_issue.created_by IS NULL OR p.id <> v_issue.created_by)
      AND NOT EXISTS (
          SELECT 1 FROM public.issue_resolution_reviews r
          WHERE r.round_id = v_round.id AND r.reviewer_id = p.id
      )
    ORDER BY CASE WHEN p.role = 'analyst' THEN 0 ELSE 1 END,
             (SELECT count(*) FROM public.issue_resolution_reviews pending
              JOIN public.issue_resolution_rounds round_ ON round_.id = pending.round_id
              WHERE pending.reviewer_id = p.id AND pending.submitted_at IS NULL
                AND round_.status = 'pending'),
             random()
    LIMIT 1;

    IF v_reviewer_id IS NULL THEN RAISE EXCEPTION 'No replacement reviewer is available'; END IF;
    UPDATE public.issue_resolution_reviews SET
        reviewer_id = v_reviewer_id,
        assigned_at = now(), due_at = now() + interval '72 hours', reminder_sent_at = NULL
    WHERE id = p_review_id;
    RETURN v_reviewer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_overdue_issue_reviews()
RETURNS TABLE (review_id uuid, reviewer_id uuid, issue_id uuid, issue_title text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    WITH claimed AS (
        UPDATE public.issue_resolution_reviews review
        SET reminder_sent_at = now()
        FROM public.issue_resolution_rounds round_, public.civic_issues issue
        WHERE round_.id = review.round_id
          AND issue.id = round_.issue_id
          AND round_.status = 'pending'
          AND review.submitted_at IS NULL
          AND review.reminder_sent_at IS NULL
          AND review.due_at <= now()
        RETURNING review.id, review.reviewer_id, issue.id, issue.title
    )
    SELECT * FROM claimed;
$$;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
    CHECK (category IN ('trend_alert', 'issue_peer_review'));
ALTER TABLE public.notification_prefs ALTER COLUMN categories SET DEFAULT
    '{"trend_alert":{"in_app":true,"email":true},"issue_peer_review":{"in_app":true,"email":true}}'::jsonb;

REVOKE ALL ON FUNCTION public.start_issue_resolution_round(uuid, uuid, text, text, text, jsonb)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_issue_resolution_review(uuid, uuid, text, boolean, boolean, boolean, boolean, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reassign_issue_resolution_reviewer(uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_overdue_issue_reviews()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_issue_resolution_round(uuid, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_issue_resolution_review(uuid, uuid, text, boolean, boolean, boolean, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reassign_issue_resolution_reviewer(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_overdue_issue_reviews() TO service_role;

-- Legacy Under Review rows have no auditable package or panel.
WITH moved AS (
    UPDATE public.civic_issues SET status = 'In Progress'
    WHERE status = 'Under Review' RETURNING id
)
UPDATE public.issue_status_logs log SET note = 'Returned for peer-review workflow migration.'
FROM moved WHERE log.issue_id = moved.id AND log.to_status = 'In Progress' AND log.note IS NULL;

COMMIT;
