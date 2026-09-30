-- Remove public/anonymous access to operational and financial records.
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statement_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated bills read" ON public.bills;
DROP POLICY IF EXISTS "Allow authenticated bills write" ON public.bills;
DROP POLICY IF EXISTS "Allow authenticated bills select" ON public.bills;
DROP POLICY IF EXISTS "Allow authenticated bills insert" ON public.bills;
DROP POLICY IF EXISTS "Allow authenticated bills update" ON public.bills;
CREATE POLICY "Bill managers can read bills" ON public.bills
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'OWNER')
    OR EXISTS (SELECT 1 FROM public.permissions WHERE permissions.user_id = auth.uid() AND permissions.can_manage_bills)
  );
CREATE POLICY "Authenticated users can create bills" ON public.bills
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update bills" ON public.bills
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow authenticated payment_batches read" ON public.payment_batches;
DROP POLICY IF EXISTS "Allow authenticated payment_batches write" ON public.payment_batches;
DROP POLICY IF EXISTS "Allow authenticated payment_batches select" ON public.payment_batches;
CREATE POLICY "Owners can read payment batches" ON public.payment_batches
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'OWNER')
    OR EXISTS (SELECT 1 FROM public.permissions WHERE permissions.user_id = auth.uid() AND permissions.can_manage_finance)
  );

DROP POLICY IF EXISTS "Allow authenticated statement_transactions read" ON public.statement_transactions;
DROP POLICY IF EXISTS "Allow authenticated statement_transactions write" ON public.statement_transactions;
DROP POLICY IF EXISTS "Allow authenticated statement_transactions select" ON public.statement_transactions;
DROP POLICY IF EXISTS "Allow authenticated insert statement_transactions" ON public.statement_transactions;
CREATE POLICY "Owners can read statement transactions" ON public.statement_transactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'OWNER')
    OR EXISTS (SELECT 1 FROM public.permissions WHERE permissions.user_id = auth.uid() AND permissions.can_manage_finance)
  );
CREATE POLICY "Authenticated users can record statement transactions" ON public.statement_transactions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow authenticated audit_logs read" ON public.audit_logs;
DROP POLICY IF EXISTS "Allow authenticated audit_logs write" ON public.audit_logs;
DROP POLICY IF EXISTS "Allow authenticated insert audit_logs" ON public.audit_logs;
CREATE POLICY "Authenticated users can read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'OWNER')
    OR EXISTS (SELECT 1 FROM public.permissions WHERE permissions.user_id = auth.uid() AND permissions.can_manage_finance)
  );
CREATE POLICY "Authenticated users can create audit logs" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON TABLE public.bills, public.payment_batches, public.statement_transactions, public.audit_logs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.bills TO authenticated;
GRANT SELECT ON TABLE public.payment_batches TO authenticated;
GRANT SELECT, INSERT ON TABLE public.statement_transactions TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_logs TO authenticated;

-- Store the complete non-secret business configuration centrally.
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS config_json JSONB;
REVOKE ALL ON TABLE public.system_settings FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.system_settings TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'system_settings'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_settings;
  END IF;
END;
$$;

-- Serialize stock checks and movement insertion on the product row so separate
-- devices cannot both consume the same remaining stock.
CREATE OR REPLACE FUNCTION public.record_stock_movement_atomic(
  p_id UUID,
  p_product_id TEXT,
  p_type TEXT,
  p_quantity INTEGER,
  p_reference_id TEXT,
  p_reference_type TEXT,
  p_remark TEXT,
  p_actor_display_name TEXT,
  p_created_at TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stock_quantity INTEGER;
  v_sold INTEGER;
  v_lost INTEGER;
  v_damaged INTEGER;
  v_rented INTEGER;
  v_available INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: Sign-in is required to record stock movements';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: Quantity must be greater than zero';
  END IF;
  IF p_type NOT IN ('RECEIVE', 'RENT', 'SALE', 'RETURN', 'DAMAGE', 'LOST', 'ADJUSTMENT') THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT: Unsupported stock movement type';
  END IF;

  SELECT stock_quantity INTO v_stock_quantity
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product % does not exist', p_product_id;
  END IF;

  SELECT
    COALESCE(SUM(quantity) FILTER (WHERE type = 'SALE'), 0)::INTEGER,
    COALESCE(SUM(quantity) FILTER (WHERE type = 'LOST'), 0)::INTEGER,
    COALESCE(SUM(quantity) FILTER (WHERE type = 'DAMAGE'), 0)::INTEGER,
    GREATEST(
      0,
      COALESCE(SUM(quantity) FILTER (WHERE type = 'RENT'), 0)
      - COALESCE(SUM(quantity) FILTER (WHERE type IN ('RETURN', 'DAMAGE', 'LOST')), 0)
    )::INTEGER
  INTO v_sold, v_lost, v_damaged, v_rented
  FROM public.stock_movements
  WHERE product_id = p_product_id;

  v_available := GREATEST(0, v_stock_quantity - v_sold - v_lost - v_damaged - v_rented);

  IF p_type IN ('SALE', 'RENT') AND p_quantity > v_available THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: Requested %, available %', p_quantity, v_available;
  END IF;
  IF p_type IN ('RETURN', 'DAMAGE', 'LOST') AND p_quantity > v_rented THEN
    RAISE EXCEPTION 'INVALID_RETURN: Quantity exceeds currently rented stock';
  END IF;

  INSERT INTO public.stock_movements (
    id, product_id, type, quantity, reference_id, reference_type,
    remark, actor_user_id, actor_display_name, created_at
  ) VALUES (
    p_id, p_product_id, p_type, p_quantity, p_reference_id, p_reference_type,
    p_remark, auth.uid()::TEXT, COALESCE(NULLIF(p_actor_display_name, ''), 'ผู้ใช้งาน'), p_created_at
  );

  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_movement_atomic(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_movement_atomic(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
