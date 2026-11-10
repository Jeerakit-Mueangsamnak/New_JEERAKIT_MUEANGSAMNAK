-- Owner 2026-11-05 (1.ค): "ส่งบิลทาง LINE" can send the bill as a Flex Card, not only as text.
-- line_bill_send (text) stays as it is. line_bill_send_card takes the card the server action
-- built (lib/line/flex.ts cardMessage) and queues it exactly like line_bill_send does:
--   - the recipient is resolved from the bill (a screen cannot point a bill at another LINE)
--   - the same checks as a screen send: linked, still a friend, menu bills + line, idempotent
--   - only text / flex messages, and a card from a screen carries no buttons or links
-- No table or data is changed by this migration.

CREATE OR REPLACE FUNCTION public.line_bill_send_card(p_bill_id uuid, p_messages jsonb, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_customer uuid;
    v_c        public.line_contacts%ROWTYPE;
    v_key      text;
    v_id       uuid;
    v_status   text;
    v_new      boolean := false;
BEGIN
    PERFORM public._require_active_member();
    PERFORM public._require_menu('bills', 'line');
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF NOT public._line_messages_valid(p_messages)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_messages) m WHERE m ->> 'type' NOT IN ('text', 'flex'))
       OR jsonb_path_exists(p_messages, 'strict $.**.action') THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;

    SELECT b.customer_id INTO v_customer FROM public.bills b WHERE b.id = p_bill_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_c FROM public.line_contacts c WHERE c.customer_id = v_customer AND c.status = 'LINKED';
    IF v_customer IS NULL OR v_c.id IS NULL THEN
        RAISE EXCEPTION 'LINE_CONTACT_NOT_LINKED' USING ERRCODE = '22023';
    END IF;
    IF NOT v_c.followed THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNREACHABLE' USING ERRCODE = '22023';
    END IF;

    v_key := 'U:' || auth.uid() || ':' || p_idempotency_key;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key, requested_by)
    VALUES (v_c.id, 'BILL', p_bill_id, 'BILL_CARD', p_messages, v_key, auth.uid())
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id, status INTO v_id, v_status;
    IF v_id IS NULL THEN
        SELECT id, status INTO v_id, v_status FROM public.line_deliveries WHERE dedupe_key = v_key;
    ELSE
        v_new := true;
        PERFORM public._audit('LINE_SEND', 'BILL', p_bill_id, NULL,
                              jsonb_build_object('delivery_id', v_id, 'contact_id', v_c.id, 'template', 'BILL_CARD'),
                              NULL, NULL, false, NULL, NULL, 'LINE');
    END IF;
    RETURN jsonb_build_object('delivery_id', v_id, 'status', v_status, 'duplicate', NOT v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.line_bill_send_card(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.line_bill_send_card(uuid, jsonb, text) TO authenticated;
