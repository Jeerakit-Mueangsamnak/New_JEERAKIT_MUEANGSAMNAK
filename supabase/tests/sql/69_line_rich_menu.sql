-- Rule tests for supabase/migrations/20261121120000_line_rich_menu_v1.sql (owner 2026-11-21):
-- which chat menu a person should have comes only from what the shop CONFIRMED; the list of people to fix never has a
-- friend who blocked the OA; a failure waits 15 minutes; a kind with no published menu is not asked for; only the
-- owner sees the status and only the server publishes. Runs after 68_line_catalog.sql.
\set ON_ERROR_STOP 1

-- people: m1 stranger (general), m2 typed a phone only (still general), m3 confirmed customer, m4 confirmed staff,
-- m5 friend who blocked the OA
SELECT public.line_webhook_event('e-rm-' || n, 'U' || repeat('1', 31) || n, 'FOLLOW', NULL, NULL, now())
  FROM unnest(ARRAY['1','2','3','4','5']) AS n;
SELECT public.line_contact_follow('U' || repeat('1', 31) || n, 'เมนู ' || n) FROM unnest(ARRAY['1','2','3','4','5']) AS n;
SELECT public.line_self_register('U' || repeat('1', 31) || '2', 'พิมพ์เบอร์เฉยๆ', '0899123002');
SELECT t.set('rm_cust', t.ok('RICH-MENU', 'owner adds a customer', 'owner',
    $q$select public.customer_create('{"name":"ลูกค้า เมนูไลน์","phone":"089-912-3003","address":"อุตรดิตถ์"}'::jsonb)$q$) ->> 'id');
SELECT t.set('rm_c3', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('1', 31) || '3'));
SELECT t.ok('RICH-MENU', 'the shop confirms m3 as that customer', 'owner',
    format($q$select public.line_contact_register_by_shop(%L::uuid, 'ลูกค้า เมนูไลน์', '0899123003')$q$, t.v('rm_c3')));
SELECT t.set('rm_c4', (SELECT id::text FROM public.line_contacts WHERE line_user_id = 'U' || repeat('1', 31) || '4'));
-- m4 becomes confirmed staff. Set up directly: the link-code route is throttled shop-wide after the earlier tests
-- (that throttle is tested in 50_line_security.sql); here only the menu rule matters.
UPDATE public.line_contacts SET status = 'LINKED', profile_id = t.u('finance'), linked_at = now() WHERE id = t.v('rm_c4')::uuid;
SELECT public.line_webhook_event('e-rm-u5', 'U' || repeat('1', 31) || '5', 'UNFOLLOW', NULL, NULL, now());

-- 1. who should have which menu (only what the shop confirmed)
SELECT t.check('RICH-MENU', 'a stranger and someone who only typed a phone are general; a confirmed customer / staff have their own',
    (SELECT bool_and(CASE right(line_user_id, 1) WHEN '1' THEN public._line_rich_menu_kind(c) = 'GENERAL'
                                                 WHEN '2' THEN public._line_rich_menu_kind(c) = 'GENERAL'
                                                 WHEN '3' THEN public._line_rich_menu_kind(c) = 'CUSTOMER'
                                                 WHEN '4' THEN public._line_rich_menu_kind(c) = 'STAFF' END)
       FROM public.line_contacts c WHERE line_user_id LIKE 'U' || repeat('1', 31) || '_' AND right(line_user_id, 1) IN ('1','2','3','4')));

-- 2. nothing to do while no menu is published except taking a personal menu away from nobody
SELECT t.check('RICH-MENU', 'no menu published: nobody is asked for a kind that has no published menu',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p WHERE p ->> 'kind' <> 'GENERAL'));
SELECT t.check('RICH-MENU', '... and nobody of this test has a personal menu to take away',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p WHERE p ->> 'line_user_id' LIKE 'U' || repeat('1', 31) || '_'));

-- 3. publishing the customer menu makes the customer pending, not the others; the id must look like LINE's
SELECT t.err('RICH-MENU', 'the app roles cannot save a menu id', 'owner',
    $q$select public.line_rich_menu_save('CUSTOMER', 'richmenu-00000000000000000000000000000001', null)$q$, 'permission denied');
SELECT t.err_admin('RICH-MENU', 'a made-up menu id is refused',
    $q$select public.line_rich_menu_save('CUSTOMER', 'not-a-menu', null)$q$, 'line_rich_menus_id_check');
SELECT t.err_admin('RICH-MENU', 'an unknown kind is refused',
    $q$select public.line_rich_menu_save('VIP', 'richmenu-00000000000000000000000000000001', null)$q$, 'line_rich_menus_kind_check');
SELECT t.check('RICH-MENU', 'saving the customer menu: no old menu to delete',
    public.line_rich_menu_save('CUSTOMER', 'richmenu-00000000000000000000000000000001', t.u('owner')) IS NULL);
SELECT t.check('RICH-MENU', 'the published ids are listed by kind',
    public.line_rich_menu_published() = '{"CUSTOMER": "richmenu-00000000000000000000000000000001"}'::jsonb);
SELECT t.check('RICH-MENU', 'now the confirmed customer of this test is pending, with the kind to link, and nobody else of this test is',
    (SELECT count(*) = 1 AND bool_and(p ->> 'kind' = 'CUSTOMER' AND p ->> 'id' = t.v('rm_c3'))
       FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p WHERE p ->> 'line_user_id' LIKE 'U' || repeat('1', 31) || '_'));

-- 4. a failed try waits; a good one is done and not listed again
SELECT public.line_rich_menu_mark(t.v('rm_c3')::uuid, 'CUSTOMER', false);
SELECT t.check('RICH-MENU', 'a failed try: the person waits 15 minutes (not listed again now)',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p WHERE p ->> 'id' = t.v('rm_c3')));
UPDATE public.line_contacts SET rich_menu_at = now() - interval '16 minutes' WHERE id = t.v('rm_c3')::uuid;
SELECT t.check('RICH-MENU', '... and is listed again after the wait',
    EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p WHERE p ->> 'id' = t.v('rm_c3')));
SELECT public.line_rich_menu_mark(t.v('rm_c3')::uuid, 'CUSTOMER', true);
SELECT t.check('RICH-MENU', 'linked: done, not listed again',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p WHERE p ->> 'id' = t.v('rm_c3'))
    AND (SELECT rich_menu_kind FROM public.line_contacts WHERE id = t.v('rm_c3')::uuid) = 'CUSTOMER');

-- 5. the shop takes the link away: the person goes back to the default menu (GENERAL), once
SELECT t.ok('RICH-MENU', 'the shop unlinks the customer', 'owner', format($q$select public.line_contact_unlink(%L::uuid, 'ผูกผิดคน')$q$, t.v('rm_c3')));
SELECT t.check('RICH-MENU', 'that person now should have the general menu: listed, from the customer menu',
    EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p
             WHERE p ->> 'id' = t.v('rm_c3') AND p ->> 'kind' = 'GENERAL' AND p ->> 'from_kind' = 'CUSTOMER'));
SELECT public.line_rich_menu_mark(t.v('rm_c3')::uuid, 'GENERAL', true);
SELECT t.check('RICH-MENU', '... done: not listed again',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p WHERE p ->> 'id' = t.v('rm_c3')));

-- 6. staff has no published menu: not asked for; after it is published, asked for
SELECT t.check('RICH-MENU', 'the staff member is not asked for while the staff menu is not published',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p WHERE p ->> 'id' = t.v('rm_c4')));
SELECT public.line_rich_menu_save('STAFF', 'richmenu-00000000000000000000000000000002', t.u('owner'));
SELECT t.check('RICH-MENU', 'published: the staff member is asked for',
    EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p WHERE p ->> 'id' = t.v('rm_c4') AND p ->> 'kind' = 'STAFF'));

-- 7. a friend who blocked the OA is never touched, even when their kind changed
SELECT t.check('RICH-MENU', 'the friend who blocked the OA is never listed',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p
                 WHERE p ->> 'line_user_id' = 'U' || repeat('1', 31) || '5'));
SELECT t.check('RICH-MENU', '... nor looked up for a just-added friend (not a follower)',
    public.line_rich_menu_for_user('U' || repeat('1', 31) || '5') IS NULL);
SELECT t.check('RICH-MENU', 'a follower is looked up with the kind they should have',
    (public.line_rich_menu_for_user('U' || repeat('1', 31) || '4') ->> 'kind') = 'STAFF');

-- 8. publishing again returns the old id (to delete at LINE) and tells the people of that kind again
SELECT public.line_rich_menu_mark(t.v('rm_c4')::uuid, 'STAFF', true);
SELECT t.check('RICH-MENU', 'saving the staff menu again gives back the old id',
    public.line_rich_menu_save('STAFF', 'richmenu-00000000000000000000000000000003', t.u('owner')) = 'richmenu-00000000000000000000000000000002');
SELECT t.check('RICH-MENU', '... and the staff member is pending again (the new menu has to be linked)',
    EXISTS (SELECT 1 FROM jsonb_array_elements(public.line_rich_menu_pending(500)) p WHERE p ->> 'id' = t.v('rm_c4') AND p ->> 'kind' = 'STAFF'));
SELECT t.check('RICH-MENU', 'clearing a menu gives back its id',
    public.line_rich_menu_clear('STAFF', t.u('owner')) = 'richmenu-00000000000000000000000000000003');
SELECT t.check('RICH-MENU', '... and forgets it', NOT (public.line_rich_menu_published() ? 'STAFF'));
SELECT t.check('RICH-MENU', '... clearing a menu that is not there gives nothing', public.line_rich_menu_clear('DRIVER', t.u('owner')) IS NULL);

-- 9. the owner's status; the tables and functions are not for the app roles
SELECT t.check('RICH-MENU', 'the owner sees the four kinds, published or not, with the people on each',
    (SELECT jsonb_array_length(r) = 4 AND r -> 1 ->> 'kind' = 'CUSTOMER' AND (r -> 1 ->> 'published_at') IS NOT NULL AND r -> 2 ->> 'kind' = 'STAFF' AND (r -> 2 ->> 'published_at') IS NULL
       FROM (SELECT t.exec_as(t.u('owner'), 'authenticated', 'select public.line_rich_menu_status()') AS r) x));
SELECT t.err('RICH-MENU', 'a member who is not the owner cannot see it', 'cashier', $q$select public.line_rich_menu_status()$q$, 'OWNER only');
SELECT t.err('RICH-MENU', 'no signed-in browser reads the menu table', 'owner', $q$select * from public.line_rich_menus$q$, 'permission denied');
SELECT t.err('RICH-MENU', 'no signed-in browser asks who needs a menu', 'owner', $q$select public.line_rich_menu_pending(10)$q$, 'permission denied');
SELECT t.check('RICH-MENU', 'publishing and clearing are in the audit trail',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'LINE_RICH_MENU_PUBLISH') AND EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'LINE_RICH_MENU_CLEAR'));
