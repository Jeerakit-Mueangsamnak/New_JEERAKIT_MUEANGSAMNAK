-- Realtime only for the table the app listens to (owner 2026-11-20, egress list item 14).
--
-- The baseline put bills, bill_lines, notifications and stock_balances in the supabase_realtime publication, but
-- the app subscribes to notifications only (features/notifications/services/notification-storage.ts). Every
-- change to the other three was still decoded by Realtime and checked against RLS for nobody. They leave the
-- publication; notifications stays. Tables, data and permissions are not touched.
-- To listen to one of them again later, add it back: ALTER PUBLICATION supabase_realtime ADD TABLE public.<table>;
DO $$
DECLARE
    t text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RETURN;
    END IF;
    FOREACH t IN ARRAY ARRAY['bills', 'bill_lines', 'stock_balances'] LOOP
        IF EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;
