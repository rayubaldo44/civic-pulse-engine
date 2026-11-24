-- ═══════════════════════════════════════════════════════════════════════════
-- Civic Pulse — Audit Log Schema (run all of this in the Supabase SQL Editor)
-- Idempotent: safe to run multiple times.
-- Creates the immutable audit_logs table + richer columns, triggers, RLS,
-- indexes, and seed rows.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Create the audit_logs table (if it doesn't exist) ─────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text        NOT NULL,
  actor_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email   text        NOT NULL DEFAULT 'system',
  details       text,
  resource_type text,
  resource_id   text,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Add richer columns to an existing table (no-op if already present) ─────
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS resource_id   text,
  ADD COLUMN IF NOT EXISTS ip_address    text,
  ADD COLUMN IF NOT EXISTS user_agent    text;

-- ── 3. Append-only immutability (blocks UPDATE and DELETE for ALL roles,
--      including the service role — fires before RLS) ─────────────────────────
CREATE OR REPLACE FUNCTION public.audit_logs_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable — modification is not permitted';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_immutable();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON public.audit_logs;
CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_immutable();

-- ── 4. Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- All authenticated users may INSERT (fire-and-forget audit writes).
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- Only admins may SELECT. No UPDATE/DELETE policies → denied for authenticated.
DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin" ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ── 5. Indexes for ORDER BY created_at, action text search, filtered lookups ──
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at  ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_text ON public.audit_logs USING gin (to_tsvector('english', action));
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id    ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource    ON public.audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address  ON public.audit_logs (ip_address);

-- ── 6. Seed initial system events (only if the table is currently empty) ──────
INSERT INTO public.audit_logs (action, actor_email, details)
SELECT 'System Boot',  'system', 'CivicPulse Engine initialized'
WHERE NOT EXISTS (SELECT 1 FROM public.audit_logs);

INSERT INTO public.audit_logs (action, actor_email, details)
SELECT 'Indexing',     'system', 'Document index rebuilt after startup'
WHERE NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'Indexing');

INSERT INTO public.audit_logs (action, actor_email, details)
SELECT 'Verification', 'system', 'RAG pipeline health check passed'
WHERE NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'Verification');
