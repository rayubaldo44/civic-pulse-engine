-- 005_tighten_issue_writes_rls.sql
--
-- Closes M1 from the 2026-08-25 security review.
--
-- Problem: civic_issues, issue_comments, and issue_status_logs granted
-- INSERT/UPDATE to ALL authenticated users with USING(true)/WITH CHECK(true).
-- Status-transition adjacency rules (ALLOWED_TRANSITIONS), priority/topic
-- validation, and audit logging are enforced ONLY in application code
-- (src/routes/api/issues/*). Any staff member holding their JWT plus the
-- public anon key could PATCH rows directly via PostgREST, bypassing every
-- server-side rule — e.g. jumping an issue straight to 'Resolved' or forging
-- status logs.
--
-- Fix: drop the permissive authenticated write policies. Every app code path
-- that writes these tables already runs through the service-role client
-- ($lib/server/supabase.ts → getServiceSupabase()), which bypasses RLS, so
-- behavior is unchanged for legitimate traffic. Reads stay open to
-- authenticated users; deletes were already service-role-only. Tables keep
-- RLS enabled, so removed policies default-deny instead of opening access.
--
-- Verified against live pg_policies before writing (2026-08-25).

BEGIN;

-- civic_issues -----------------------------------------------------------------
DROP POLICY IF EXISTS "auth_insert_civic_issues" ON public.civic_issues;
DROP POLICY IF EXISTS "auth_update_civic_issues" ON public.civic_issues;

-- issue_comments ---------------------------------------------------------------
DROP POLICY IF EXISTS "auth_insert_issue_comments" ON public.issue_comments;
DROP POLICY IF EXISTS "auth_update_issue_comments" ON public.issue_comments;

-- issue_status_logs ------------------------------------------------------------
DROP POLICY IF EXISTS "auth_insert_issue_status_logs" ON public.issue_status_logs;
DROP POLICY IF EXISTS "auth_update_issue_status_logs" ON public.issue_status_logs;

COMMIT;

-- Post-apply sanity check: only SELECT (authenticated) + DELETE (service_role)
-- policies should remain on these three tables:
--
--   SELECT tablename, policyname, cmd, roles
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('civic_issues', 'issue_comments', 'issue_status_logs')
--   ORDER BY tablename, policyname;
