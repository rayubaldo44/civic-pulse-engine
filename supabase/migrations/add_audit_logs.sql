-- ── Audit Logs ────────────────────────────────────────────────────────────────
-- Append-only log of system and user actions.
-- Immutability is enforced at the trigger level so even the service role
-- cannot UPDATE or DELETE rows after they are written.

CREATE TABLE public.audit_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text        NOT NULL,
  actor_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text        NOT NULL DEFAULT 'system',
  details     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Block UPDATE and DELETE at the database level.
-- Triggers fire before RLS, so this applies to every database role
-- including the service role that the application uses.
CREATE OR REPLACE FUNCTION public.audit_logs_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable — modification is not permitted';
END;
$$;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_immutable();

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_immutable();

-- RLS — all authenticated users may INSERT; only admins may SELECT.
-- No UPDATE or DELETE policies are defined, so those operations are
-- denied for the authenticated role on top of the trigger guard above.
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_insert" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "audit_logs_select_admin" ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Index to support ORDER BY created_at DESC and filtered searches.
CREATE INDEX idx_audit_logs_created_at  ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_action_text ON public.audit_logs USING gin (to_tsvector('english', action));

-- Seed initial system events so the log is never empty on first boot.
INSERT INTO public.audit_logs (action, actor_email, details) VALUES
  ('System Boot',  'system', 'CivicPulse Engine initialized'),
  ('Indexing',     'system', 'Document index rebuilt after startup'),
  ('Verification', 'system', 'RAG pipeline health check passed');
