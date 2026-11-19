-- ============================================================================
-- Change the customer of a confirmed bill (owner 2026-11-19, จัดการบิล › แก้ไขบิลเช่า):
--   * another saved customer → the bill becomes that customer's;
--   * a typed name that is not a saved customer → the bill becomes a guest bill (ลูกค้าทั่วไป, guest_name);
--   * the same customer → nothing changes (dates, goods, place … stay with the same customer).
-- The bill's customer snapshot is rebuilt from the new customer. Payments, deposits and stock follow the bill,
-- so they move with it. Audited (BILL_SET_CUSTOMER), no PIN — the same as bill_revise / bill_set_document_date.
-- Refused: bills that are not CONFIRMED / ACTIVE, credit bills (their credit was checked for the customer they
-- were opened for), bills in a เช่าต่อ chain (parent and child bills keep one customer), suspended customers.
-- ============================================================================

-- Snapshot guard: as in 20261116090000, except that bill_set_customer (app.bill_revise on, this transaction only)
-- may rebuild the customer snapshot / guest name of a confirmed bill.
CREATE OR REPLACE FUNCTION public._bill_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.customer_snapshot := CASE WHEN NEW.status <> 'DRAFT' THEN public._bill_customer_snapshot(NEW.customer_id, NEW.guest_name) END;
        RETURN NEW;
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status <> 'DRAFT' THEN
        NEW.customer_snapshot := public._bill_customer_snapshot(NEW.customer_id, NEW.guest_name);
        UPDATE public.bill_lines l
           SET product_sku = p.sku, product_name = p.name, unit_name = u.name
          FROM public.products p LEFT JOIN public.units u ON u.id = p.unit_id
         WHERE l.bill_id = NEW.id AND p.id = l.product_id;
    ELSIF OLD.status = 'DRAFT' THEN
        NEW.customer_snapshot := NULL;
    ELSIF public._bill_revising()
          AND (NEW.customer_id, NEW.guest_name) IS DISTINCT FROM (OLD.customer_id, OLD.guest_name) THEN
        NEW.customer_snapshot := public._bill_customer_snapshot(NEW.customer_id, NEW.guest_name);
    ELSIF NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot THEN
        RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE = '42501';
    ELSIF NEW.guest_name IS DISTINCT FROM OLD.guest_name THEN
        RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

/*
 * bill_set_customer(bill, customer, guest name): exactly one of customer / guest name.
 */
CREATE OR REPLACE FUNCTION public.bill_set_customer(p_bill_id uuid, p_customer_id uuid, p_guest_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bill     public.bills%ROWTYPE;
    v_customer public.customers%ROWTYPE;
    v_guest    text := NULLIF(btrim(COALESCE(p_guest_name, '')), '');
BEGIN
    PERFORM public._require_menu('pos', 'bills');
    IF p_customer_id IS NOT NULL THEN
        v_guest := NULL;
    ELSIF v_guest IS NULL THEN
        RAISE EXCEPTION 'CUSTOMER_REQUIRED' USING ERRCODE = '22023';
    ELSIF char_length(v_guest) > 200 THEN
        RAISE EXCEPTION 'GUEST_NAME_TOO_LONG' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_bill.status NOT IN ('CONFIRMED', 'ACTIVE') THEN
        RAISE EXCEPTION 'BILL_NOT_REVISABLE' USING ERRCODE = '23514';
    END IF;
    -- The same customer (or the same guest name): nothing to change.
    IF v_bill.customer_id IS NOT DISTINCT FROM p_customer_id
       AND (p_customer_id IS NOT NULL OR v_bill.guest_name IS NOT DISTINCT FROM v_guest) THEN
        RETURN jsonb_build_object('id', p_bill_id, 'customer_id', v_bill.customer_id, 'guest_name', v_bill.guest_name);
    END IF;
    IF v_bill.is_credit_bill THEN
        RAISE EXCEPTION 'BILL_CUSTOMER_LOCKED: credit bill' USING ERRCODE = '23514';
    END IF;
    IF v_bill.parent_bill_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.bills c WHERE c.parent_bill_id = p_bill_id) THEN
        RAISE EXCEPTION 'BILL_CUSTOMER_LOCKED: continuation' USING ERRCODE = '23514';
    END IF;
    IF p_customer_id IS NOT NULL THEN
        SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
        IF NOT v_customer.active THEN
            RAISE EXCEPTION 'CUSTOMER_INACTIVE' USING ERRCODE = '23514';
        END IF;
    END IF;

    PERFORM set_config('app.bill_revise', 'on', true);
    UPDATE public.bills SET customer_id = p_customer_id, guest_name = v_guest WHERE id = p_bill_id;
    PERFORM set_config('app.bill_revise', '', true);

    PERFORM public._audit('BILL_SET_CUSTOMER', 'BILL', p_bill_id,
                          jsonb_build_object('customer_id', v_bill.customer_id, 'guest_name', v_bill.guest_name,
                                             'customer_name', v_bill.customer_snapshot ->> 'name'),
                          jsonb_build_object('customer_id', p_customer_id, 'guest_name', v_guest,
                                             'customer_name', COALESCE(v_customer.name, v_guest)),
                          NULL, gen_random_uuid(), false, NULL);
    RETURN jsonb_build_object('id', p_bill_id, 'customer_id', p_customer_id, 'guest_name', v_guest);
END;
$$;
REVOKE ALL ON FUNCTION public.bill_set_customer(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bill_set_customer(uuid, uuid, text) TO authenticated;
