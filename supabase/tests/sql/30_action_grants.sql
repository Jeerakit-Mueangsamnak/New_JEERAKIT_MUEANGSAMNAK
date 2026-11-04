-- Rule tests for member action grants (migration 20261007131509_member_action_grants.sql):
-- menu -> action grant -> PIN, USER default DENY, OWNER full, only the OWNER grants, audited.
\set ON_ERROR_STOP 1

-- ===================================================================== GRANT / REVOKE
SELECT t.err('A-GRANT', 'a USER cannot grant actions to themself', 'cashier',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['REFUND'], 'me')$q$, t.u('cashier')), 'OWNER only');
SELECT t.err('A-GRANT', 'a USER cannot write the grants table directly', 'cashier',
    format($q$insert into public.member_action_grants (user_id, action_code, granted_by) values (%L::uuid, 'REFUND', %L::uuid)$q$,
           t.u('cashier'), t.u('owner')), 'permission denied');
SELECT t.err('A-GRANT', 'an OWNER has every action already', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['REFUND'], 'x')$q$, t.u('owner')), 'OWNER_HAS_ALL_ACTIONS');
SELECT t.err('A-GRANT', 'unknown action refused', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY['DELETE_EVERYTHING'], 'x')$q$, t.u('cashier')), 'UNKNOWN_ACTION');
SELECT t.ok('A-GRANT', 'owner revokes every action from the cashier', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY[]::text[], 'test revoke')$q$, t.u('cashier')));
SELECT t.check('A-GRANT', 'revoke is audited with before and after',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'MEMBER_ACTIONS_CHANGE' AND entity_id = t.u('cashier')
             AND reason = 'test revoke' AND jsonb_array_length(after_data -> 'actions') = 0
             AND jsonb_array_length(before_data -> 'actions') = 6));
SELECT t.ok('A-GRANT', 'an empty reason is accepted (owner 2026-10-22)', 'owner',
    format($q$select public.owner_set_member_actions(%L::uuid, ARRAY[]::text[], '')$q$, t.u('cashier')));
SELECT t.check('A-GRANT', 'that change is audited with the automatic reason',
    EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'MEMBER_ACTIONS_CHANGE' AND entity_id = t.u('cashier')
             AND reason = 'บันทึกอัตโนมัติ'));
SELECT t.check('A-GRANT', 'the cashier sees only their own grants (none)',
    (t.exec_as(t.u('cashier'), 'authenticated', $q$select to_jsonb(count(*)) from public.member_action_grants$q$))::text = '0');

-- ===================================================================== EVERY ACTIVE MEMBER (owner 2026-10-26)
-- Grants no longer gate any action: _require_action only asks for an ACTIVE member, and every
-- ACTIVE member holds every menu except member management. Nothing here changes shop data.
SELECT t.ok('A-ALL', 'a USER with no grant passes every risky-action check', 'nomenu',
    $q$select to_jsonb(count(*)) from unnest(ARRAY['REFUND','BILL_VOID','PRODUCT_PRICE_CHANGE','STOCK_ADJUST','EXPENSE','WRITE_OFF']) c,
       lateral (select public._require_action(c)) x$q$, 'postgres');
SELECT t.err('A-ALL', 'a member waiting for approval is refused', 'pending',
    $q$select public._require_action('REFUND')$q$, 'FORBIDDEN', 'postgres');
SELECT t.err('A-ALL', 'a suspended member is refused', 'suspended',
    $q$select public._require_action('EXPENSE')$q$, 'FORBIDDEN', 'postgres');
SELECT t.check('A-ALL', 'a USER with no menu grants holds every menu but member management',
    (t.exec_as(t.u('nomenu'), 'authenticated',
        $q$select jsonb_build_object('finance', public.has_menu('finance'), 'settings', public.has_menu('settings'),
                                     'pos', public.has_menu('pos'), 'members', public.has_menu('members'))$q$)
     = '{"finance": true, "settings": true, "pos": true, "members": false}'::jsonb));
SELECT t.check('A-ALL', 'a member waiting for approval holds no menu',
    (t.exec_as(t.u('pending'), 'authenticated', $q$select to_jsonb(public.has_menu('pos'))$q$))::text = 'false');
SELECT t.err('A-ALL', 'member management stays OWNER-only (approve / suspend)', 'cashier',
    format($q$select public.owner_set_member_status(%L::uuid, 'ACTIVE', 'x')$q$, t.u('pending')), 'OWNER');
SELECT t.check('A-ALL', 'the audit log stays OWNER read-only (a USER sees no row)',
    (t.exec_as(t.u('nomenu'), 'authenticated', $q$select to_jsonb(count(*)) from public.audit_logs$q$))::text = '0'
    AND (SELECT count(*) FROM public.audit_logs) > 0);
SELECT t.check('A-ALL', 'a USER sees the names of every member (member_directory) but not their e-mail',
    (t.exec_as(t.u('nomenu'), 'authenticated', $q$select to_jsonb(count(*)) from public.member_directory()$q$))::int
       = (SELECT count(*) FROM public.profiles));
