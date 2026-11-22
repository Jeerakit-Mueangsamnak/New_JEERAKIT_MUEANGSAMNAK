-- LINE: what may be sent to whom, and what a new friendship may not bypass (2026-11-21, local database only).
--   1. Only plain wording from the shop reaches a friend the shop has NOT confirmed (and only what the shop typed;
--      no buttons). A bill, a document, a Flex card or personal data never goes to an unconfirmed friend — every such
--      message is refused / cancelled before the LINE API is called.
--   2. A "new friend" notice asked the OWNER only once per person per 15 minutes, whichever route the person takes
--      (form before adding the OA, then follow; unfollow, then add again). This stops a stranger from filling the
--      owner's notification list by adding/removing the OA.
-- The interaction rules themselves (limits, strikes, temporary or permanent suspension, restoring) are unchanged.
-- No cloud database, no LINE API, no existing row is deleted.

-- ----------------------------------------------------------------------------
-- 1. ONE definition of "may this contact receive this message right now"
--    (earlier migrations left two copies; the later one is kept and hardened)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._line_delivery_allowed(c public.line_contacts, p_source text, p_template text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT COALESCE(c.followed AND NOT public._line_scope_blocked(c.id, 'MESSAGES') AND CASE
        -- the shop's answers while a registration is being checked: plain text only (the outbox enforces it)
        WHEN p_source = 'REGISTER' THEN p_template IN ('REGISTER_WELCOME', 'REGISTER_NEED_INFO', 'REGISTER_APPROVED', 'REGISTER_REJECTED')
        -- the shop writes to any friend: plain text, never a bill, a card or a link (the database builds it)
        WHEN p_source = 'SHOP_MESSAGE' THEN p_template = 'SHOP_MESSAGE'
        -- everything else names a person, an amount or a place: the account must be confirmed first
        ELSE c.status = 'LINKED' AND NOT c.needs_review AND (
            (c.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.customers x WHERE x.id = c.customer_id AND x.active)) OR
            (c.profile_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles x WHERE x.id = c.profile_id AND x.status = 'ACTIVE')) OR
            (c.driver_code IS NOT NULL AND public._line_driver_active(c.driver_code)))
    END, false);
$$;
REVOKE ALL ON FUNCTION public._line_delivery_allowed(public.line_contacts, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. A word from the shop: plain text (a button or a card cannot carry a private link to a stranger)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.line_contact_message_send(p_contact_id uuid, p_text text, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c    public.line_contacts%ROWTYPE;
    v_text text := btrim(COALESCE(p_text, ''));
    v_id   uuid;
BEGIN
    PERFORM public._require_active_member();
    PERFORM public._require_menu('customers', 'bills', 'appointments', 'line');
    IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 120 THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF v_text = '' OR length(v_text) > 1000 THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    -- one plain text message, as the queue checks it for every other sender
    IF NOT public._line_messages_valid(jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text))) THEN
        RAISE EXCEPTION 'LINE_MESSAGE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_c FROM public.line_contacts WHERE id = p_contact_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    IF public._line_scope_blocked(v_c.id, 'MESSAGES') THEN RAISE EXCEPTION 'LINE_CONTACT_SUSPENDED' USING ERRCODE = '42501'; END IF;
    IF NOT v_c.followed THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNREACHABLE' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key, requested_by)
    VALUES (v_c.id, 'SHOP_MESSAGE', NULL, 'SHOP_MESSAGE', jsonb_build_array(jsonb_build_object('type', 'text', 'text', v_text)),
            'M:' || v_c.id || ':' || p_idempotency_key, auth.uid())
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
        PERFORM public._audit_line(auth.uid(), 'LINE_SHOP_MESSAGE', 'LINE_CONTACT', v_c.id, jsonb_build_object('length', length(v_text)));
    END IF;
    RETURN jsonb_build_object('delivery_id', v_id, 'duplicate', v_id IS NULL);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Adding the OA (again) never slips past a suspension or the new-friend cooldown
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.line_contact_follow(
    p_line_user_id text,
    p_display_name text,
    p_picture_url  text DEFAULT NULL,
    p_is_unblock   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_c       public.line_contacts%ROWTYPE;
    v_first   boolean;
    v_friend  jsonb := COALESCE(public._policy('line', '{}'::jsonb) -> 'friend', '{}'::jsonb);
    v_welcome boolean := COALESCE((v_friend ->> 'welcome')::boolean, true);
    v_notify  boolean := COALESCE((v_friend ->> 'notifyOwner')::boolean, false);
    v_owner   uuid;
BEGIN
    PERFORM public._line_require_server();
    SELECT * INTO v_c FROM public.line_contacts WHERE line_user_id = p_line_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'LINE_CONTACT_UNKNOWN' USING ERRCODE = 'P0002';
    END IF;
    v_first := v_c.followed_at IS NULL;

    UPDATE public.line_contacts
       SET display_name = COALESCE(NULLIF(left(btrim(COALESCE(p_display_name, '')), 200), ''), display_name),
           picture_url = CASE WHEN p_picture_url ~ '^https://' AND length(p_picture_url) <= 1000 THEN p_picture_url ELSE picture_url END,
           followed = true,
           followed_at = CASE WHEN p_is_unblock THEN COALESCE(followed_at, now()) ELSE now() END,
           register_status = CASE WHEN status = 'UNLINKED' AND (register_status IS NULL OR register_status = 'REJECTED')
                                 AND NOT p_is_unblock THEN 'WAITING' ELSE register_status END,
           register_customer_id = CASE WHEN status = 'UNLINKED' AND (register_status IS NULL OR register_status = 'REJECTED')
                                       AND NOT p_is_unblock THEN NULL ELSE register_customer_id END,
           updated_at = now()
     WHERE id = v_c.id
    RETURNING * INTO v_c;

    -- The owner hears about a person at most once per cooldown, however they add / remove / re-add the OA
    -- (policies.line.ownerNoticeCooldownMinutes, 15 by default). Unblocking says nothing; it is not a new friend.
    IF v_notify AND NOT p_is_unblock AND public._line_owner_notice_allowed(v_c.id) THEN
        SELECT p.id INTO v_owner FROM public.profiles p
         WHERE p.role = 'OWNER' AND p.status = 'ACTIVE' ORDER BY p.created_at LIMIT 1;
        IF v_owner IS NOT NULL THEN
            PERFORM public._notify('LINE_FRIEND_NEW:' || v_c.id || ':' || extract(epoch FROM v_c.followed_at)::bigint,
                                   'LINE_FRIEND_NEW', 'INFO', v_owner, NULL, 'LINE_CONTACT', v_c.id,
                                   CASE WHEN v_first THEN 'มีเพื่อนใหม่ใน LINE ร้าน' ELSE 'เพื่อนเดิมกลับมาเพิ่ม LINE ร้านอีกครั้ง' END,
                                   'ชื่อโปรไฟล์ ' || COALESCE(NULLIF(v_c.display_name, ''), 'ไม่ทราบชื่อ')
                                   || ' · ยังไม่ได้ยืนยันว่าเป็นใคร');
        END IF;
    END IF;

    RETURN jsonb_build_object('status', v_c.status, 'register_status', v_c.register_status,
                              'is_new', v_first, 'is_unblock', p_is_unblock,
                              -- a suspended person gets no welcome (the suspension outlives adding the OA again)
                              'send_welcome', v_welcome AND v_c.status <> 'LINKED' AND NOT p_is_unblock
                                              AND NOT public._line_scope_blocked(v_c.id, 'MESSAGES'));
END;
$$;
REVOKE ALL ON FUNCTION public.line_contact_follow(text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.line_contact_follow(text, text, text, boolean) TO service_role;
