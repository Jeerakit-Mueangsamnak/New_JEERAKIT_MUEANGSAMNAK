-- Owner 2026-11-11: the การเคลื่อนไหว table of a bill (ประวัติการทำรายการ/เอกสาร window) can be seen by
-- everyone who works with bills, not only the OWNER. audit_logs stays OWNER-only (RLS unchanged);
-- this read-only function returns just the rows of ONE bill, with the name of who did each step.
-- Same rows the app read before: entity_id = the bill, or after_data.bill_id = the bill.
-- No data is changed by this migration.

CREATE OR REPLACE FUNCTION public.bill_movements(p_bill_id uuid)
RETURNS TABLE (
    id             uuid,
    action         text,
    entity_type    text,
    entity_id      uuid,
    after_data     jsonb,
    amount         numeric,
    quantity       numeric,
    channel        text,
    correlation_id uuid,
    created_at     timestamptz,
    actor_name     text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    RETURN QUERY
    SELECT a.id, a.action, a.entity_type, a.entity_id, a.after_data, a.amount, a.quantity, a.channel,
           a.correlation_id, a.created_at,
           CASE WHEN a.actor_id IS NULL THEN 'ระบบ'
                ELSE COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.username), ''),
                              NULLIF(btrim(a.actor_name), ''), 'ผู้ใช้') END
      FROM public.audit_logs a
      LEFT JOIN public.profiles p ON p.id = a.actor_id
     WHERE a.entity_id = p_bill_id OR a.after_data ->> 'bill_id' = p_bill_id::text
     ORDER BY a.created_at, a.id;
END;
$$;

REVOKE ALL ON FUNCTION public.bill_movements(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.bill_movements(uuid) TO authenticated;
