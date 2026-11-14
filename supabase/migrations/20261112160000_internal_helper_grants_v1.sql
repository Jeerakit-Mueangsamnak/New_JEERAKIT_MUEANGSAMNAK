-- 20261112160000_internal_helper_grants_v1
-- Owner 2026-11-12 ("จัดการแก้ไขให้เรียบร้อย"): internal "_" helpers added by later migrations (document snapshot,
-- product delete, bill void, list price) were left executable by anon / authenticated / service_role through the
-- default PUBLIC grant. They are used only inside the database (triggers and SECURITY DEFINER functions, which run
-- as the owner), so nobody outside needs to call them. Same rule as every other "_" helper: owner only.
-- Nothing else changes: the triggers and the functions that use them keep working.

DO $$
DECLARE
    f regprocedure;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure
          FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('_deleting_this_product', '_bill_snapshot', '_quotation_snapshot', '_bill_line_snapshot_guard',
                             '_line_product_snapshot', '_customer_snapshot', '_list_price', '_deleting_this_row',
                             '_bill_void_check')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
    END LOOP;
END;
$$;
