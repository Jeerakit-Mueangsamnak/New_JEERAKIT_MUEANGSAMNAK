-- ============================================================================
-- Customer edit refreshes open documents (owner 2026-11-25, choice ก):
--   * editing a customer's name / code / phones / address / tax id updates the customer copy
--     (customer_snapshot) on that customer's bills still in work (CONFIRMED / ACTIVE) and on
--     quotations still open (not CONVERTED / REJECTED);
--   * finished bills (CLOSED / CANCELLED / VOID) keep the copy they were finished with.
--   * guest bills (guest_name, no customer) are not touched.
-- Also refreshes the open bills that already hold an old copy (2 bills on Cloud at writing).
-- ============================================================================

-- Snapshot guard: as in 20261119104511, plus the customer refresh below (app.customer_refresh on,
-- this transaction only) may rebuild the copy of a bill still in work for the same customer.
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
    ELSIF COALESCE(current_setting('app.customer_refresh', true), '') = 'on'
          AND OLD.status IN ('CONFIRMED', 'ACTIVE') AND NEW.status = OLD.status
          AND OLD.customer_id IS NOT NULL
          AND (NEW.customer_id, NEW.guest_name) IS NOT DISTINCT FROM (OLD.customer_id, OLD.guest_name) THEN
        NEW.customer_snapshot := public._bill_customer_snapshot(NEW.customer_id, NEW.guest_name);
    ELSIF NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot THEN
        RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE = '42501';
    ELSIF NEW.guest_name IS DISTINCT FROM OLD.guest_name THEN
        RAISE EXCEPTION 'BILL_SNAPSHOT_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

-- AFTER UPDATE on customers: when a field kept in the copy changed, refresh the open documents.
CREATE OR REPLACE FUNCTION public._customer_refresh_open_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF (NEW.name, NEW.customer_code, NEW.phone, NEW.contact_details ->> 'phone2', NEW.address, NEW.tax_id)
       IS NOT DISTINCT FROM
       (OLD.name, OLD.customer_code, OLD.phone, OLD.contact_details ->> 'phone2', OLD.address, OLD.tax_id) THEN
        RETURN NULL;
    END IF;

    PERFORM set_config('app.customer_refresh', 'on', true);
    UPDATE public.bills b
       SET customer_snapshot = public._bill_customer_snapshot(b.customer_id, b.guest_name)
     WHERE b.customer_id = NEW.id AND b.status IN ('CONFIRMED', 'ACTIVE')
       AND b.customer_snapshot IS DISTINCT FROM public._bill_customer_snapshot(b.customer_id, b.guest_name);
    PERFORM set_config('app.customer_refresh', '', true);

    -- _quotation_snapshot rebuilds the copy of an open quotation on any update.
    UPDATE public.quotations q
       SET customer_snapshot = public._customer_snapshot(q.customer_id)
     WHERE q.customer_id = NEW.id AND q.status NOT IN ('CONVERTED', 'REJECTED')
       AND q.customer_snapshot IS DISTINCT FROM public._customer_snapshot(q.customer_id);
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._customer_refresh_open_documents() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_customers_refresh_open_documents ON public.customers;
CREATE TRIGGER trg_customers_refresh_open_documents
    AFTER UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public._customer_refresh_open_documents();

-- Open bills / quotations that already hold an old copy.
DO $$
BEGIN
    PERFORM set_config('app.customer_refresh', 'on', true);
    UPDATE public.bills b
       SET customer_snapshot = public._bill_customer_snapshot(b.customer_id, b.guest_name)
     WHERE b.customer_id IS NOT NULL AND b.status IN ('CONFIRMED', 'ACTIVE')
       AND b.customer_snapshot IS DISTINCT FROM public._bill_customer_snapshot(b.customer_id, b.guest_name);
    PERFORM set_config('app.customer_refresh', '', true);

    UPDATE public.quotations q
       SET customer_snapshot = public._customer_snapshot(q.customer_id)
     WHERE q.customer_id IS NOT NULL AND q.status NOT IN ('CONVERTED', 'REJECTED')
       AND q.customer_snapshot IS DISTINCT FROM public._customer_snapshot(q.customer_id);
END;
$$;
