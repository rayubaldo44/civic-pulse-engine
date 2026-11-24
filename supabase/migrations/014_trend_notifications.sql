-- ═══════════════════════════════════════════════════════════════════════════
-- 014_trend_notifications.sql
-- In-app notification store for trend alerts, plus the per-user snapshots the
-- lazy trend diff compares against.
--
-- Design notes:
--   * There is no scheduler in this project (no pg_cron, no Vercel cron, no
--     Realtime). Notifications are evaluated on read: each poll recomputes
--     topic priorities and diffs them against notification_snapshots.
--   * notifications is deliberately category-generic (category is a CHECK
--     list) so adding flagged_claim / issue_* later is a code change, not a
--     migration. Only 'trend_alert' is produced today.
--   * notification_prefs.categories is jsonb rather than 2xN boolean columns
--     for the same reason: the shape stays stable as categories are added.
--   * The partial UNIQUE index on (user_id, category, fingerprint) is what
--     makes re-evaluating the same crossing idempotent. The pure diff in
--     $lib/server/trend-diff.ts already suppresses repeats; this is the
--     database-level backstop, and it also makes a retune safe.
--
-- House style follows 012_api_window_aggregates.sql. Idempotent: safe to
-- re-run. Apply via the Supabase SQL editor or `npx supabase db push`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. notifications ────────────────────────────────────────────────────────
-- One row per recipient per event (fan-out happens at write time), so reads
-- are a trivial user-scoped SELECT with no joins.
CREATE TABLE IF NOT EXISTS public.notifications (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    category     text NOT NULL
                     CHECK (category IN ('trend_alert')),
    severity     text NOT NULL DEFAULT 'info'
                     CHECK (severity IN ('info', 'warning', 'critical')),
    title        text NOT NULL,
    body         text NOT NULL DEFAULT '',
    href         text,
    entity_type  text,
    entity_id    uuid,
    -- Dedupe key; NULL for categories that always create a row.
    fingerprint  text,
    read_at      timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Feed read: ORDER BY created_at DESC, id DESC with a user equality filter.
CREATE INDEX IF NOT EXISTS idx_notifications_user_feed
    ON public.notifications (user_id, created_at DESC, id DESC);

-- Unread badge count: index-only over the partial unread set.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON public.notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

-- Idempotent re-evaluation. NULL fingerprints are excluded so ordinary
-- notifications (which always want a fresh row) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_fingerprint
    ON public.notifications (user_id, category, fingerprint)
    WHERE fingerprint IS NOT NULL;

-- Retention: rows are pruned opportunistically by the evaluator (no cron
-- exists to do it on a schedule). This index serves that delete.
CREATE INDEX IF NOT EXISTS idx_notifications_read_created
    ON public.notifications (read_at, created_at)
    WHERE read_at IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Scoped to auth.uid() — deliberately tighter than the USING (true) SELECT
-- policies elsewhere in the schema, because a notification is private.
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy: every write goes through the service-role
-- client in $lib/server/notifications.ts, matching the posture 005_tighten_
-- issue_writes_rls.sql established for civic_issues.

-- ── 2. notification_prefs ───────────────────────────────────────────────────
-- Per-user channel toggles. Absent row = DEFAULT_NOTIFICATION_PREFS in
-- $lib/types/notifications.ts, so shipping this migration does not require
-- backfilling every profile.
CREATE TABLE IF NOT EXISTS public.notification_prefs (
    user_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    in_app      boolean NOT NULL DEFAULT true,
    email       boolean NOT NULL DEFAULT true,
    categories  jsonb NOT NULL DEFAULT '{"trend_alert":{"in_app":true,"email":true}}'::jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_prefs_select ON public.notification_prefs;
CREATE POLICY notification_prefs_select ON public.notification_prefs
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- Users upsert their own preferences directly; this is the one table where an
-- authenticated write policy is appropriate, and it is still uid-scoped.
DROP POLICY IF EXISTS notification_prefs_upsert ON public.notification_prefs;
CREATE POLICY notification_prefs_upsert ON public.notification_prefs
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS notification_prefs_update ON public.notification_prefs;
CREATE POLICY notification_prefs_update ON public.notification_prefs
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ── 3. notification_snapshots ───────────────────────────────────────────────
-- The caller's previous evaluation, per topic per window. Compound PK because
-- the same topic is tracked independently at 7 / 30 / 90 days, and a user who
-- joins later needs their own baseline rather than inheriting a global one
-- (which would make every topic look like it just spiked).
CREATE TABLE IF NOT EXISTS public.notification_snapshots (
    user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    window_days   smallint NOT NULL CHECK (window_days IN (7, 30, 90)),
    topic         text NOT NULL,
    score         smallint NOT NULL,
    rank          smallint NOT NULL,
    negativity    double precision NOT NULL DEFAULT 0,
    comment_count integer NOT NULL DEFAULT 0,
    captured_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, window_days, topic)
);

ALTER TABLE public.notification_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_snapshots_select ON public.notification_snapshots;
CREATE POLICY notification_snapshots_select ON public.notification_snapshots
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- ── 4. trend_alert_eval_state ──────────────────────────────────────────────
-- Single-row throttle for the catch-up sweep. Without it, alerts would only
-- ever be generated for users who happen to have a tab open — which is the one
-- case a "trend" alert does not need to serve. The first poller after a quiet
-- period evaluates on behalf of every active user instead, so alerts
-- accumulate for offline staff and their email preference has something to
-- deliver.
CREATE TABLE IF NOT EXISTS public.trend_alert_eval_state (
    id                  smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_evaluated_at   timestamptz NOT NULL DEFAULT '-infinity'::timestamptz
);

INSERT INTO public.trend_alert_eval_state (id, last_evaluated_at)
VALUES (1, '-infinity'::timestamptz)
ON CONFLICT (id) DO NOTHING;

-- Server-side only (throttle bookkeeping, never client-read). RLS stays
-- enabled with no policies so no authenticated role can touch it.

-- ── 5. enqueue_notification ─────────────────────────────────────────────────
-- Single write path for trend alerts: resolves the recipient's prefs, inserts
-- only if the in_app channel is enabled, and makes the fingerprint
-- idempotent. Service-role only — deliberately NOT granted to authenticated,
-- because it bypasses the notification_prefs RLS write policy.
CREATE OR REPLACE FUNCTION public.enqueue_notification(
    p_user_id      uuid,
    p_category     text,
    p_severity     text,
    p_title        text,
    p_body         text,
    p_href         text,
    p_fingerprint  text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_master_in_app boolean;
    v_category_in_app boolean;
    v_in_app boolean;
    v_id uuid;
BEGIN
    -- Same AND semantics as isChannelEnabled() in $lib/types/notifications.ts:
    -- the global in_app flag is a master switch, and the per-category flag
    -- rides on top of it. Keep the two implementations in step — a mismatch
    -- here means the SQL path writes rows the TypeScript path would refuse.
    SELECT in_app, (categories -> p_category ->> 'in_app')::boolean
    INTO v_master_in_app, v_category_in_app
    FROM public.notification_prefs
    WHERE user_id = p_user_id;

    -- No prefs row = defaults (both true).
    v_in_app := COALESCE(v_master_in_app, true)
                AND COALESCE(v_category_in_app, true);

    IF NOT v_in_app THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.notifications (
        user_id, category, severity, title, body, href, fingerprint
    )
    VALUES (
        p_user_id, p_category, p_severity, p_title, p_body, p_href, p_fingerprint
    )
    ON CONFLICT (user_id, category, fingerprint)
        WHERE fingerprint IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- REVOKE must name anon + authenticated explicitly, not just PUBLIC. Supabase's
-- default privileges grant EXECUTE on new public-schema functions to
-- `authenticated`, and REVOKE ... FROM PUBLIC does not strip that separate
-- grant. Without the explicit revokes this SECURITY DEFINER function would be
-- callable by any logged-in user with an arbitrary p_user_id — a cross-user
-- write primitive. Service-role callers bypass RLS but are not affected by
-- these revokes.
REVOKE ALL ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(uuid, text, text, text, text, text, text)
    TO service_role;

-- ── 6. claim_trend_evaluation_sweep ────────────────────────────────────────
-- Atomically reports whether this caller won the right to run the
-- catch-up sweep, and stamps last_evaluated_at. Using a conditional UPDATE
-- (rather than SELECT-then-UPDATE) means concurrent pollers cannot both win.
-- Returns true only for the single winner.
CREATE OR REPLACE FUNCTION public.claim_trend_evaluation_sweep(
    p_min_interval_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_claimed integer := 0;
BEGIN
    UPDATE public.trend_alert_eval_state
    SET last_evaluated_at = now()
    WHERE id = 1
      AND last_evaluated_at <= now() - make_interval(secs => p_min_interval_seconds);

    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    RETURN v_claimed > 0;
END;
$$;

-- Throttle bookkeeping — never client-readable or client-writable. Same
-- explicit anon/authenticated revokes as enqueue_notification: letting a
-- client call this would let it suppress the sweep by holding the lock.
REVOKE ALL ON FUNCTION public.claim_trend_evaluation_sweep(integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_trend_evaluation_sweep(integer)
    TO service_role;
