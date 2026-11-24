-- 003_add_profiles_password_set.sql
--
-- Adds password_set to profiles so /set-password can be restricted to
-- invited users who have not yet completed first-time setup:
--   - false (default): invite link was sent, password not chosen yet.
--     Only these users may use /set-password, which lets them set a
--     password WITHOUT providing their current one.
--   - true: normal users are redirected away, preventing a logged-in
--     user from bypassing the current-password check on /settings.
--
-- Backfill: GoTrue stores an empty encrypted_password for invited users
-- who have not accepted their invite yet, so anyone with real
-- credentials today is marked as already having set a password.

BEGIN;

ALTER TABLE public.profiles
	ADD COLUMN IF NOT EXISTS password_set boolean NOT NULL DEFAULT false;

UPDATE public.profiles p
SET password_set = true
FROM auth.users u
WHERE u.id = p.id
	AND u.encrypted_password IS NOT NULL
	AND u.encrypted_password <> '';

COMMIT;
