-- Owner decision 2026-10-26 (Master §4.1): a wrong sign-in password is simply refused; the app
-- keeps no attempt count and never locks the account. A forgotten password is reset with the
-- Supabase e-mail link. (The wait/lock ladder is the PIN's — Master §4.3.)
--
-- Removes the login counter of 20261024000000_rate_limit_server_side (never applied to Cloud and
-- never worked: its functions were granted to `authenticated` only, but they are called before
-- sign-in). Also removes the login-lock objects a local test database may have received from a
-- withdrawn draft on 2026-10-26; on any other database these statements do nothing.

DROP FUNCTION IF EXISTS public.rate_limit_is_locked(text);
DROP FUNCTION IF EXISTS public.rate_limit_record_failure(text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.rate_limit_clear(text);
DROP TABLE IF EXISTS public.rate_limit_entries;

DROP FUNCTION IF EXISTS public.login_guard_begin(uuid);
DROP FUNCTION IF EXISTS public.login_guard_finish(uuid, integer, text);
DROP FUNCTION IF EXISTS public.owner_unlock_login(uuid, text);
DROP FUNCTION IF EXISTS public.login_lock_recover_owner();
DROP FUNCTION IF EXISTS public._audit_login(text, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public._login_wait(integer);
DROP TABLE IF EXISTS public.login_lockouts;
