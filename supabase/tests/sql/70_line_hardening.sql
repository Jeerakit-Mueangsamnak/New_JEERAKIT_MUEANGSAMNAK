-- Owner-only account management and public/private outbox separation. Local test harness only.
\set ON_ERROR_STOP 1
WITH c AS (INSERT INTO public.line_contacts (line_user_id, followed, status, register_status, typed_name, typed_phone)
    VALUES ('U' || replace(gen_random_uuid()::text, '-', ''), true, 'UNLINKED', 'PENDING', 'Hardening fixture', '0817000001') RETURNING id)
SELECT t.set('hard_owner_contact', id::text) FROM c;
SELECT t.err('LINE-HARDEN', who || ' cannot ' || cmd, who, statement, 'FORBIDDEN')
FROM unnest(ARRAY['cashier','nomenu','finance','pending','suspended']) who
CROSS JOIN LATERAL (VALUES
    ('issue driver code', $q$select public.line_link_code_create_driver('D001')$q$),
    ('approve', format($q$select public.line_contact_register_approve(%L::uuid)$q$, t.v('hard_owner_contact'))),
    ('reject', format($q$select public.line_contact_reject(%L::uuid, 'test')$q$, t.v('hard_owner_contact'))),
    ('register by shop', format($q$select public.line_contact_register_by_shop(%L::uuid, 'test', '0817000001')$q$, t.v('hard_owner_contact'))),
    ('review', format($q$select public.line_contact_review_ok(%L::uuid)$q$, t.v('hard_owner_contact'))),
    ('unlink', format($q$select public.line_contact_unlink(%L::uuid, 'test')$q$, t.v('hard_owner_contact'))),
    ('request more data', format($q$select public.line_contact_register_need_info(%L::uuid, 'test')$q$, t.v('hard_owner_contact'))),
    ('issue customer code', format($q$select public.line_link_code_create_customer(%L::uuid)$q$, t.v('pp_cust'))),
    ('issue customer invite', format($q$select public.line_invite_create('CUSTOMER', %L)$q$, t.v('pp_cust')))
) AS x(cmd, statement);
SELECT t.check('LINE-HARDEN', 'owner approves the request',
    (t.ok('LINE-HARDEN', 'owner approval', 'owner', format($q$select public.line_contact_register_approve(%L::uuid)$q$, t.v('hard_owner_contact'))) ->> 'result') = 'LINKED_CUSTOMER');
SELECT t.ok('LINE-HARDEN', 'owner unlinks the customer', 'owner', format($q$select public.line_contact_unlink(%L::uuid, 'fixture')$q$, t.v('hard_owner_contact')));
WITH c AS (INSERT INTO public.line_contacts (line_user_id, followed, status, register_status)
    VALUES ('U' || replace(gen_random_uuid()::text, '-', ''), true, 'UNLINKED', 'NEED_INFO') RETURNING id)
SELECT t.set('hard_public_contact', id::text) FROM c;
SELECT t.set('hard_public_delivery', public.line_outbox_enqueue_register(t.v('hard_public_contact')::uuid, 'REGISTER_NEED_INFO',
    '[{"type":"text","text":"fixture: request more information"}]'::jsonb, 'hard-public-' || gen_random_uuid()::text) ->> 'delivery_id');
SELECT t.err_admin('LINE-HARDEN', 'registration outbox cannot disguise a bill template',
    format($q$select public.line_outbox_enqueue_register(%L::uuid, 'BILL_CARD', '[{"type":"text","text":"fixture"}]', 'hard-no-bill')$q$, t.v('hard_public_contact')), 'LINE_MESSAGE_INVALID');
SELECT t.err_admin('LINE-HARDEN', 'registration outbox cannot contain a Flex bill/document',
    format($q$select public.line_outbox_enqueue_register(%L::uuid, 'REGISTER_APPROVED', '[{"type":"flex","altText":"fixture","contents":{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"fixture"}]}}}]', 'hard-no-flex')$q$, t.v('hard_public_contact')), 'LINE_MESSAGE_INVALID');
SELECT t.set('hard_shop_delivery', t.ok('LINE-HARDEN', 'general contact is queued for an unlinked friend', 'cashier',
    format($q$select public.line_contact_message_send(%L::uuid, 'fixture: general contact', 'hard-general-0001')$q$, t.v('hard_public_contact'))) ->> 'delivery_id');
WITH d AS (INSERT INTO public.line_deliveries (contact_id, source_type, source_id, template_key, messages, dedupe_key)
    VALUES (t.v('hard_public_contact')::uuid, 'BILL', gen_random_uuid(), 'BILL_CARD', '[{"type":"text","text":"private fixture"}]', 'hard-private-' || gen_random_uuid()::text) RETURNING id)
SELECT t.set('hard_private_delivery', id::text) FROM d;
DO $$ BEGIN PERFORM public.line_outbox_claim(100, 60); END $$;
SELECT t.check('LINE-HARDEN', 'unlinked friend registration answer reaches the sending lease',
    (SELECT status = 'SENDING' FROM public.line_deliveries WHERE id = t.v('hard_public_delivery')::uuid));
SELECT t.check('LINE-HARDEN', 'unlinked friend general message reaches the sending lease',
    (SELECT status = 'SENDING' FROM public.line_deliveries WHERE id = t.v('hard_shop_delivery')::uuid));
SELECT t.check('LINE-HARDEN', 'unlinked friend private bill is cancelled before any send',
    (SELECT status = 'CANCELLED' AND last_error_code = 'CONTACT_UNREACHABLE' FROM public.line_deliveries WHERE id = t.v('hard_private_delivery')::uuid));
SELECT public.line_outbox_complete(t.v('hard_public_delivery')::uuid, 'SENT', 200, NULL, 'local-mock-fixture', NULL);
SELECT t.check('LINE-HARDEN', 'successful local mock outcome is stored once',
    (SELECT status = 'SENT' AND attempts = 1 FROM public.line_deliveries WHERE id = t.v('hard_public_delivery')::uuid));
SELECT t.check('LINE-HARDEN', 'no internal bill helper is exposed to API roles', NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND left(p.proname, 1) = '_'
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE'))));

-- Failed public registration/general contact remains retryable while the friend is unlinked.
UPDATE public.line_deliveries SET status='FAILED', sent_at=NULL, last_http_status=500, last_error_code='FIXTURE_FAILURE'
WHERE id=t.v('hard_public_delivery')::uuid;
SELECT t.ok('LINE-HARDEN','owner retries a public answer to an unlinked friend','owner',
 format($q$select public.line_delivery_retry(%L::uuid)$q$,t.v('hard_public_delivery')));
SELECT t.check('LINE-HARDEN','public retry returns to pending',
 (SELECT status='PENDING' FROM public.line_deliveries WHERE id=t.v('hard_public_delivery')::uuid));