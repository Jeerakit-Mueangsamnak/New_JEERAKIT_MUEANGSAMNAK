-- Keep LINE webhook/LIFF RPCs server-only even when an earlier function migration
-- was recorded remotely but its functions are missing and must be recreated.
REVOKE ALL ON FUNCTION public.line_task_step(text, uuid, text, text, text[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_task_step(text, uuid, text, text, text[])
    TO service_role;

REVOKE ALL ON FUNCTION public.line_driver_job(text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_driver_job(text, uuid)
    TO service_role;

REVOKE ALL ON FUNCTION public._line_owner_id(text)
    FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.line_owner_finance_form(text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_owner_finance_form(text)
    TO service_role;

REVOKE ALL ON FUNCTION public.line_finance_entry(text, text, text, numeric, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_finance_entry(text, text, text, numeric, text, text)
    TO service_role;
