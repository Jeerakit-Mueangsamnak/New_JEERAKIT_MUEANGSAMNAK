DO $$
DECLARE
  table_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'products',
      'stock_movements',
      'product_categories',
      'units',
      'customers',
      'bills',
      'quotations',
      'quotation_items',
      'appointments',
      'statement_transactions',
      'reservations',
      'backorders'
    ]
    LOOP
      IF to_regclass(format('public.%I', table_name)) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = table_name
         )
      THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
      END IF;
    END LOOP;
  END IF;
END
$$;
