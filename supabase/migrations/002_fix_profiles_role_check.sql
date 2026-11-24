-- 002_fix_profiles_role_check.sql
--
-- Reconciles the profiles.role CHECK constraint with application code.
--
-- WHY: the introspected live schema only allows ('reviewer', 'admin')
-- while every code path writes 'analyst' | 'admin' (admin panel invites,
-- role edits, login redirects). Invites would fail on the profiles upsert.
--
-- SAFETY / TRIPLE-CHECK NOTES:
--   1. Constraint name is NOT hardcoded for the drop — created directly in
--      the dashboard, so we look up every CHECK constraint on profiles
--      whose definition references "role" and drop each by its real name.
--   2. Order matters: rows are updated to 'analyst' AFTER dropping the old
--      constraint (updating 'reviewer' -> 'analyst' would violate it), and
--      BEFORE adding the new one (so existing data satisfies it).
--   3. Idempotent: re-running is a no-op (IF NOT EXISTS-style guard around
--      the new constraint, DROP ... IF EXISTS first).
--   4. Only values written anywhere in the app are 'analyst' and 'admin';
--      anything else found in data maps to the safe default 'analyst'.
--   5. Also fixes the column DEFAULT ('reviewer' in the dashboard-era
--      schema) — auth.users triggers that insert without naming role
--      depend on it; discovered via live invite testing.

BEGIN;

DO $$
DECLARE
	rec record;
BEGIN
	FOR rec IN
		SELECT conname
		FROM pg_constraint
		WHERE conrelid = 'public.profiles'::regclass
			AND contype = 'c'
			AND pg_get_constraintdef(oid) ILIKE 'CHECK %role%'
	LOOP
		EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', rec.conname);
	END LOOP;
END $$;

UPDATE public.profiles SET role = 'analyst' WHERE role <> 'admin';

-- The column default may still say 'reviewer' (dashboard-era schema).
-- auth.users triggers that insert without naming role rely on this default,
-- so leaving it stale breaks GoTrue user creation ("Database error saving
-- new user") even after the CHECK above is widened.
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'analyst';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.profiles'::regclass
			AND conname = 'profiles_role_check'
	) THEN
		ALTER TABLE public.profiles
			ADD CONSTRAINT profiles_role_check CHECK (role IN ('analyst', 'admin'));
	END IF;
END $$;

COMMIT;
