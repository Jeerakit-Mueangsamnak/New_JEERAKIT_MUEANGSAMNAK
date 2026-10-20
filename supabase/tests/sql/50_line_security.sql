-- LINE Operations Center — Phase 03-A security checks (migration 20261008160000_line_operations_v1).
-- PREPARED, NOT RUN YET: it needs the LINE migration applied, which only happens inside the
-- throwaway container of supabase/tests/run_local.sh, and only once the owner allows it.
-- Uses the harness of 00_setup.sql (t.ok / t.err / t.err_admin / t.check, users by t.u()).
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------- server-only RPCs
SELECT t.err('LINE-SRV', 'signed-in member cannot call a server RPC (no grant)', 'owner',
    $q$select public.line_outbox_claim(5, 60)::text::jsonb$q$, 'permission denied');
SELECT t.err('LINE-SRV', 'signed-in member cannot read the OA credentials', 'owner',
    $q$select to_jsonb(public.line_channel_credentials())$q$, 'permission denied');
SELECT t.err('LINE-SRV', 'anon cannot call the webhook RPC', NULL,
    $q$select public.line_webhook_event('e-anon', 'U00000000000000000000000000000000', 'TEXT', 'x', NULL, now())$q$,
    'permission denied', 'anon');
-- Even with EXECUTE (postgres), an anon / authenticated JWT is refused by _line_require_server.
SELECT t.err_admin('LINE-SRV', 'a client JWT role is refused even without a grant check',
    $q$select set_config('request.jwt.claim.role', 'anon', true), public.line_outbox_claim(1, 60)$q$, 'server only');
SELECT set_config('request.jwt.claim.role', '', false);

-- ---------------------------------------------------------------- staff link + notice
SELECT t.set('line_staff_code', (t.ok('LINE-LINK', 'member creates a code for HIS OWN account', 'owner',
    $q$select public.line_link_code_create_staff()$q$)) ->> 'code');
SELECT t.check('LINE-LINK', 'the code itself is never stored',
    NOT EXISTS (SELECT 1 FROM public.line_link_codes WHERE code_hash = t.v('line_staff_code')));
SELECT public.line_webhook_event('e-own-1', 'U' || repeat('a', 32), 'FOLLOW', NULL, NULL, now());
SELECT t.check('LINE-LINK', 'typing the code links the staff LINE',
    public.line_link_code_consume('U' || repeat('a', 32), t.v('line_staff_code')) ->> 'result' = 'LINKED_STAFF');
SELECT t.check('LINE-LINK', 'the member gets an in-app notice about the new link',
    EXISTS (SELECT 1 FROM public.notifications WHERE event_type = 'LINE_LINKED' AND recipient_user_id = t.u('owner')));
SELECT t.check('LINE-LINK', 'a used code cannot link a second LINE',
    (SELECT public.line_webhook_event('e-own-2', 'U' || repeat('b', 32), 'FOLLOW', NULL, NULL, now())) IS NOT NULL
    AND public.line_link_code_consume('U' || repeat('b', 32), t.v('line_staff_code')) ->> 'result' IN ('INVALID', 'LOCKED'));

-- Shop-wide throttle: with enough recent failures every LINE account is told LOCKED. Done in a
-- sub-transaction so the fake failures are rolled back and later tests are unaffected.
DO $$
DECLARE
    v_result text;
BEGIN
    BEGIN
        INSERT INTO public.audit_logs (action, entity_type, channel, result, correlation_id)
        SELECT 'LINE_LINK_ATTEMPT', 'LINE_CONTACT', 'LINE', 'FAILED', gen_random_uuid() FROM generate_series(1, 30);
        PERFORM public.line_webhook_event('e-thr-1', 'U' || repeat('c', 32), 'FOLLOW', NULL, NULL, now());
        v_result := public.line_link_code_consume('U' || repeat('c', 32), '000000') ->> 'result';
        RAISE EXCEPTION 'ROLLBACK:%', v_result;
    EXCEPTION WHEN raise_exception THEN
        PERFORM t.check('LINE-LINK', 'shop-wide failures lock code guessing for every LINE account',
                        SQLERRM = 'ROLLBACK:LOCKED', SQLERRM);
    END;
END;
$$;

-- ---------------------------------------------------------------- customer link (OA 1:1 chat code)
-- Uses any active customer of the seed; skipped when the seed has none.
DO $$
DECLARE
    v_cust uuid;
    v_code text;
    v_r    jsonb;
BEGIN
    SELECT id INTO v_cust FROM public.customers WHERE active LIMIT 1;
    IF v_cust IS NULL THEN
        PERFORM t.check('LINE-CUST', 'SKIPPED: no active customer in the seed', true);
        RETURN;
    END IF;
    v_code := (t.ok('LINE-CUST', 'staff creates a code for one customer', 'owner',
                    format($q$select public.line_link_code_create_customer(%L::uuid)$q$, v_cust))) ->> 'code';
    PERFORM t.check('LINE-CUST', 'customer code is LINK- + 10 characters', v_code ~ '^LINK-[A-HJ-NP-Z2-9]{10}$', v_code);
    PERFORM public.line_webhook_event('e-cust-1', 'U' || repeat('d', 32), 'FOLLOW', NULL, NULL, now());
    v_r := public.line_link_code_consume('U' || repeat('d', 32), v_code);
    PERFORM t.check('LINE-CUST', 'the customer sending the code links that LINE', v_r ->> 'result' = 'LINKED_CUSTOMER', v_r::text);
    PERFORM t.check('LINE-CUST', 'the issuer gets an in-app notice',
        EXISTS (SELECT 1 FROM public.notifications WHERE event_type = 'LINE_LINKED' AND entity_id = v_cust));
    PERFORM public.line_webhook_event('e-cust-2', 'U' || repeat('e', 32), 'FOLLOW', NULL, NULL, now());
    PERFORM t.check('LINE-CUST', 'a used code cannot link a second LINE',
        public.line_link_code_consume('U' || repeat('e', 32), v_code) ->> 'result' IN ('INVALID', 'LOCKED'));
    PERFORM t.err('LINE-CUST', 'an already linked customer gets no new code', 'owner',
        format($q$select public.line_link_code_create_customer(%L::uuid)$q$, v_cust), 'LINE_CUSTOMER_ALREADY_LINKED');
END;
$$;

-- ---------------------------------------------------------------- outbound message shape
SELECT t.set('line_own_contact', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('a', 32)));
SELECT t.err('LINE-MSG', 'a screen cannot queue buttons / links (text only)', 'owner',
    format($q$select public.line_delivery_enqueue(%L::uuid, 'TEST', NULL, 'TEST',
        '[{"type":"template","altText":"x","template":{"type":"buttons","text":"x","actions":[{"type":"uri","label":"x","uri":"https://evil.example"}]}}]'::jsonb,
        'key-line-btn-1')$q$, t.v('line_own_contact')), 'LINE_MESSAGE_INVALID');
SELECT t.err('LINE-MSG', 'a text message without its text field is refused', 'owner',
    format($q$select public.line_delivery_enqueue(%L::uuid, 'TEST', NULL, 'TEST', '[{"type":"text"}]'::jsonb, 'key-line-txt-0')$q$,
           t.v('line_own_contact')), 'LINE_MESSAGE_INVALID');
SELECT t.check('LINE-MSG', 'server buttons: http (not https) links are refused',
    NOT public._line_messages_valid('[{"type":"template","altText":"x","template":{"type":"buttons","text":"x","actions":[{"type":"uri","label":"x","uri":"http://x"}]}}]'));
SELECT t.check('LINE-MSG', 'server buttons: postback with data is accepted',
    public._line_messages_valid('[{"type":"template","altText":"x","template":{"type":"buttons","text":"x","actions":[{"type":"postback","label":"รับงาน","data":"kind=task"}]}}]'));

-- ---------------------------------------------------------------- RLS / column grants
SELECT t.err('LINE-RLS', 'clients never read line_user_id', 'owner',
    $q$select to_jsonb(count(line_user_id)) from public.line_contacts$q$, 'permission denied');
SELECT t.err('LINE-RLS', 'clients never read link codes', 'owner',
    $q$select to_jsonb(count(*)) from public.line_link_codes$q$, 'permission denied');
SELECT t.check('LINE-RLS', 'a member without the LINE menu sees no one else''s LINE',
    (t.ok('LINE-RLS', 'nomenu reads line_contacts', 'nomenu',
          $q$select to_jsonb(count(*)) from public.line_contacts$q$))::int = 0);
SELECT t.err('LINE-RLS', 'clients cannot write line_deliveries directly', 'owner',
    $q$insert into public.line_deliveries (contact_id, source_type, template_key, messages, dedupe_key) values (gen_random_uuid(), 'TEST', 'TEST', '[]', 'x-direct-1')$q$,
    'permission denied');

-- ---------------------------------------------------------------- policies.line validation
SELECT t.err('LINE-POL', 'out-of-range number refused', 'owner',
    $q$select public.settings_update('{"policies":{"line":{"linkMaxFailures":99}}}'::jsonb, 'test')$q$, 'INVALID_POLICY: line.linkMaxFailures');
SELECT t.err('LINE-POL', 'unknown key refused', 'owner',
    $q$select public.settings_update('{"policies":{"line":{"secretToken":"x"}}}'::jsonb, 'test')$q$, 'INVALID_POLICY: line.secretToken');
SELECT t.err('LINE-POL', 'template with a placeholder the key does not have refused', 'owner',
    $q$select public.settings_update('{"policies":{"line":{"templates":{"TEST":"hi {ชื่อลูกค้า}"}}}}'::jsonb, 'test')$q$, 'INVALID_POLICY: line.templates.TEST');
SELECT t.err('LINE-POL', 'notify must be true/false per event type', 'owner',
    $q$select public.settings_update('{"policies":{"line":{"notify":{"PAYMENT_DUE":"yes"}}}}'::jsonb, 'test')$q$, 'INVALID_POLICY: line.notify.PAYMENT_DUE');
SELECT t.ok('LINE-POL', 'a valid LINE policy saves', 'owner',
    $q$select public.settings_update('{"policies":{"line":{"linkMaxFailures":5,"notify":{"PAYMENT_DUE":true},"templates":{"TEST":"ทดสอบ {ชื่อร้าน}"}}}}'::jsonb, 'test')$q$);
SELECT t.ok('LINE-POL', 'other Settings sections still save (line unchanged, not re-checked)', 'owner',
    $q$select public.settings_update('{"policies":{"allow_overpayment":false}}'::jsonb, 'test')$q$);

-- ---------------------------------------------------------------- Vault (skipped when the image has no Vault)
DO $$
BEGIN
    IF to_regnamespace('vault') IS NULL THEN
        PERFORM t.check('LINE-VAULT', 'SKIPPED: vault schema not installed in this database', true);
        RETURN;
    END IF;
    PERFORM t.err('LINE-VAULT', 'a non-owner cannot set credentials', 'cashier',
        $q$select public.line_channel_set('0123456789abcdef0123456789abcdef', NULL)$q$, 'FORBIDDEN');
    PERFORM t.ok('LINE-VAULT', 'owner sets secret + token', 'owner',
        $q$select public.line_channel_set('0123456789abcdef0123456789abcdef', 'token-aaaaaaaaaaaaaaaaaaaaaaaa')$q$);
    PERFORM t.ok('LINE-VAULT', 'owner changes only the token', 'owner',
        $q$select public.line_channel_set(NULL, 'token-bbbbbbbbbbbbbbbbbbbbbbbb')$q$);
    PERFORM t.check('LINE-VAULT', 'change updates in place: one row per name, new value, secret kept',
        (SELECT count(*) FROM vault.secrets WHERE name IN ('line_channel_secret', 'line_channel_access_token')) = 2
        AND (SELECT access_token FROM public.line_channel_credentials()) = 'token-bbbbbbbbbbbbbbbbbbbbbbbb'
        AND (SELECT channel_secret FROM public.line_channel_credentials()) = '0123456789abcdef0123456789abcdef');
    PERFORM t.check('LINE-VAULT', 'no value in the audit trail',
        NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action LIKE 'LINE_CHANNEL_%'
                     AND (after_data::text LIKE '%0123456789abcdef%' OR after_data::text LIKE '%token-%')));
    PERFORM t.err('LINE-VAULT', 'clear needs a reason', 'owner', $q$select public.line_channel_clear('')$q$, 'REASON');
    PERFORM t.ok('LINE-VAULT', 'owner clears', 'owner', $q$select public.line_channel_clear('test clear')$q$);
    PERFORM t.check('LINE-VAULT', 'clear removes the Vault rows; credentials read as empty',
        NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name IN ('line_channel_secret', 'line_channel_access_token'))
        AND (SELECT channel_secret IS NULL AND access_token IS NULL FROM public.line_channel_credentials()));
END;
$$;
