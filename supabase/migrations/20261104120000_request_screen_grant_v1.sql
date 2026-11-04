-- ============================================================================
-- _request_screen grant (2026-11-04). Every "_" helper is internal: callable only from other database
-- functions, never directly by app users or the service key. 20261022150000 revoked it from
-- PUBLIC / anon / authenticated but not from service_role (Supabase grants new functions to it by
-- default). Only _audit and audit_log_failure call it, both SECURITY DEFINER, so nothing breaks.
-- No data is changed.
-- ============================================================================
REVOKE ALL ON FUNCTION public._request_screen() FROM service_role;
