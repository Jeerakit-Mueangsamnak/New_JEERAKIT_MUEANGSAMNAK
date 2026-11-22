-- Local fixtures only; never send LINE. Run after 70_line_hardening.sql.
\set ON_ERROR_STOP 1
SELECT t.set('abuse_policies_before',(SELECT policies::text FROM public.store_settings WHERE singleton));
UPDATE public.store_settings
   SET policies=jsonb_set(policies,'{line}',COALESCE(policies->'line','{}') || '{"friend":{"notifyOwner":true}}')
                || jsonb_build_object('delivery_drivers',jsonb_build_array(
                     jsonb_build_object('id','D931','name','คนขับฟอร์ม','active',true)));
INSERT INTO public.line_contacts(line_user_id,followed)
SELECT 'U' || lpad(to_hex(71000 + n),32,'0'),true FROM generate_series(1,6) n;
SELECT t.set('abuse_uid','U' || lpad(to_hex(71001),32,'0'));
SELECT t.set('abuse_id',(SELECT id::text FROM public.line_contacts WHERE line_user_id=t.v('abuse_uid')));
SELECT t.err('LINE-ABUSE',who || ' cannot suspend',who,
 format($q$select public.line_contact_restriction_set(%L,'ALL',NULL,'fixture')$q$,t.v('abuse_id')),'FORBIDDEN')
FROM unnest(ARRAY['cashier','nomenu','finance','pending','suspended']) who;
SELECT t.err('LINE-ABUSE','anon cannot suspend','owner',
 format($q$select public.line_contact_restriction_set(%L,'ALL',NULL,'fixture')$q$,t.v('abuse_id')),'permission denied','anon');
SELECT t.err('LINE-ABUSE','staff cannot read suspension reasons','cashier',
 format($q$select public.line_contact_restrictions(%L)$q$,t.v('abuse_id')),'FORBIDDEN');
SELECT t.err('LINE-ABUSE','client cannot bypass interaction guard','owner',
 format($q$select public.line_interaction_check(%L,'CATALOG','fixture')$q$,t.v('abuse_uid')),'permission denied');
SELECT t.ok('LINE-ABUSE','owner permanently suspends inquiries','owner',
 format($q$select public.line_contact_restriction_set(%L,'INQUIRY',NULL,'fixture permanent')$q$,t.v('abuse_id')));
SELECT t.check('LINE-ABUSE','inquiries blocked before product lookup',
 public.line_interaction_check(t.v('abuse_uid'),'INQUIRY','p1')->>'result'='SUSPENDED');
SELECT t.check('LINE-ABUSE','catalog remains available with inquiry-only suspension',
 (public.line_interaction_check(t.v('abuse_uid'),'CATALOG','c1')->>'allowed')::boolean);
SELECT t.check('LINE-ABUSE','re-follow does not erase suspension',
 (public.line_contact_follow(t.v('abuse_uid'),'fixture',NULL,false) IS NOT NULL)
 AND public._line_scope_blocked(t.v('abuse_id')::uuid,'INQUIRY'));
SELECT t.check('LINE-ABUSE','unblock does not erase suspension',
 (public.line_contact_follow(t.v('abuse_uid'),'fixture',NULL,true) IS NOT NULL)
 AND public._line_scope_blocked(t.v('abuse_id')::uuid,'INQUIRY'));
SELECT t.ok('LINE-ABUSE','owner restores inquiries','owner',
 format($q$select public.line_contact_restriction_set(%L,'INQUIRY',NULL,'fixture restore',true)$q$,t.v('abuse_id')));
SELECT t.check('LINE-ABUSE','restored account can inquire immediately',
 (public.line_interaction_check(t.v('abuse_uid'),'INQUIRY','p1')->>'allowed')::boolean);
SELECT t.check('LINE-ABUSE','same click suppressed',
 public.line_interaction_check(t.v('abuse_uid'),'INQUIRY','p1')->>'result'='DUPLICATE');
SELECT t.check('LINE-ABUSE','five inquiries allowed in five minutes',
 (SELECT bool_and((public.line_interaction_check(t.v('abuse_uid'),'INQUIRY','p'||n)->>'allowed')::boolean) FROM generate_series(2,5)n));
SELECT t.check('LINE-ABUSE','sixth inquiry rate-limited',public.line_interaction_check(t.v('abuse_uid'),'INQUIRY','p6')->>'result'='RATE_LIMITED');
SELECT t.check('LINE-ABUSE','second violation remains rate-limited',public.line_interaction_check(t.v('abuse_uid'),'INQUIRY','p7')->>'result'='RATE_LIMITED');
SELECT t.check('LINE-ABUSE','third violation auto-suspends inquiry scope',public.line_interaction_check(t.v('abuse_uid'),'INQUIRY','p8')->>'result'='SUSPENDED');
SELECT t.check('LINE-ABUSE','auto suspension has reason, time and system actor',
 (SELECT source='ABUSE' AND created_by IS NULL AND reason<>'' AND until_at>now()+interval '14 minutes' AND until_at<=now()+interval '16 minutes'
 FROM public.line_contact_restrictions WHERE contact_id=t.v('abuse_id')::uuid AND scope='INQUIRY'));
SELECT t.check('LINE-ABUSE','owner notice is deduplicated across follow and registration',
 NOT public._line_owner_notice_allowed(t.v('abuse_id')::uuid));
SELECT t.set('abuse_id2',(SELECT id::text FROM public.line_contacts WHERE line_user_id='U'||lpad(to_hex(71002),32,'0')));
SELECT t.ok('LINE-ABUSE','owner suspends registration only','owner',
 format($q$select public.line_contact_restriction_set(%L,'REGISTER',now()+interval '15 minutes','fixture register')$q$,t.v('abuse_id2')));
SELECT t.check('LINE-ABUSE','suspended registration does not query or create customer',
 public.line_self_register('U'||lpad(to_hex(71002),32,'0'),'fixture','0817100002')->>'result'='SUSPENDED');
SELECT t.check('LINE-ABUSE','suspended link consume refused',
 public.line_link_code_consume('U'||lpad(to_hex(71002),32,'0'),'123456')->>'result'='SUSPENDED');
SELECT t.ok('LINE-ABUSE','owner restores registration','owner',
 format($q$select public.line_contact_restriction_set(%L,'REGISTER',NULL,'fixture restore',true)$q$,t.v('abuse_id2')));
SELECT t.check('LINE-ABUSE','first registration pending only',
 public.line_self_register('U'||lpad(to_hex(71002),32,'0'),'fixture','0817100002')->>'result'='PENDING');
SELECT t.set('abuse_reg_before',(SELECT count(*)::text FROM public.audit_logs WHERE action='LINE_REGISTER' AND entity_id=t.v('abuse_id2')::uuid));
SELECT t.check('LINE-ABUSE','identical registration is idempotent',
 (public.line_self_register('U'||lpad(to_hex(71002),32,'0'),'fixture','0817100002')->>'duplicate')::boolean);
SELECT t.check('LINE-ABUSE','duplicate registration creates no audit or owner alert',
 (SELECT count(*)::text=t.v('abuse_reg_before') FROM public.audit_logs WHERE action='LINE_REGISTER' AND entity_id=t.v('abuse_id2')::uuid));
SELECT t.check('LINE-ABUSE','changed registration within five minutes is blocked',
 public.line_self_register('U'||lpad(to_hex(71002),32,'0'),'changed','0817100003')->>'result'='RATE_LIMITED');
SELECT t.ok('LINE-ABUSE','owner asks for correction','owner',
 format($q$select public.line_contact_register_need_info(%L,'please correct')$q$,t.v('abuse_id2')));
SELECT t.check('LINE-ABUSE','requested correction can be submitted immediately',
 public.line_self_register('U'||lpad(to_hex(71002),32,'0'),'changed','0817100003')->>'result'='PENDING');
SELECT t.set('abuse_id3',(SELECT id::text FROM public.line_contacts WHERE line_user_id='U'||lpad(to_hex(71003),32,'0')));
SELECT t.check('LINE-ABUSE','twelve ordinary clicks allowed per minute',
 (SELECT bool_and((public.line_interaction_check('U'||lpad(to_hex(71003),32,'0'),'CATALOG','key'||n)->>'allowed')::boolean) FROM generate_series(1,12)n));
SELECT t.check('LINE-ABUSE','thirteenth click refused',public.line_interaction_check('U'||lpad(to_hex(71003),32,'0'),'CATALOG','key13')->>'result'='RATE_LIMITED');
SELECT t.check('LINE-ABUSE','another account retains its own quota',
 (public.line_interaction_check('U'||lpad(to_hex(71004),32,'0'),'CATALOG','key13')->>'allowed')::boolean);
SELECT t.ok('LINE-ABUSE','owner blocks every usage','owner',
 format($q$select public.line_contact_restriction_set(%L,'ALL',NULL,'fixture all')$q$,t.v('abuse_id3')));
SELECT t.check('LINE-ABUSE','all suspension blocks every scope',
 (SELECT bool_and(public._line_scope_blocked(t.v('abuse_id3')::uuid,s)) FROM unnest(ARRAY['REGISTER','CATALOG','INQUIRY','WORK','MESSAGES'])s));
SELECT t.check('LINE-ABUSE','new follow cannot send welcome after ALL suspension',
 NOT (public.line_contact_follow('U'||lpad(to_hex(71003),32,'0'),'fixture',NULL,true)->>'send_welcome')::boolean);
SELECT t.check('LINE-ABUSE','suspended worker cannot accept, progress or read job',
 public.line_task_postback('U'||lpad(to_hex(71003),32,'0'),gen_random_uuid(),'ACCEPT')->>'result'='SUSPENDED'
 AND public.line_task_step('U'||lpad(to_hex(71003),32,'0'),gen_random_uuid(),'LOAD',NULL,NULL)->>'result'='SUSPENDED'
 AND public.line_driver_job('U'||lpad(to_hex(71003),32,'0'),gen_random_uuid())->>'result'='SUSPENDED');
SELECT t.check('LINE-ABUSE','suspended owner finance endpoint refuses',
 public.line_owner_finance_form('U'||lpad(to_hex(71003),32,'0'))->>'result'='SUSPENDED');
UPDATE public.line_tasks
   SET status='CANCELLED', cancelled_at=now(), cancel_reason='fixture cancelled'
 WHERE id=t.v('lf_task')::uuid;
SELECT t.check('LINE-JOB','cancelled job details are not disclosed',
 public.line_driver_job(t.v('u931'),t.v('lf_task')::uuid)->>'result'='INVALID_STATE');
UPDATE public.line_tasks
   SET status='ACCEPTED', cancelled_at=NULL, cancel_reason=NULL
 WHERE id=t.v('lf_task')::uuid;
UPDATE public.appointments
   SET work_order=jsonb_set(work_order,'{driver,id}','"D999"'::jsonb)
 WHERE id=t.v('lf_apt')::uuid;
SELECT t.check('LINE-JOB','driver without the current appointment no longer sees job details',
 public.line_driver_job(t.v('u931'),t.v('lf_task')::uuid)->>'result'='INVALID_STATE');
UPDATE public.appointments
   SET work_order=jsonb_set(work_order,'{driver,id}','"D931"'::jsonb)
 WHERE id=t.v('lf_apt')::uuid;
-- Queued before restriction, leased, then restricted before push.
SELECT t.set('abuse_msg_contact',(SELECT id::text FROM public.line_contacts WHERE line_user_id='U'||lpad(to_hex(71004),32,'0')));
SELECT t.set('abuse_delivery',public.line_outbox_enqueue_register(t.v('abuse_msg_contact')::uuid,'REGISTER_WELCOME','[{"type":"text","text":"fixture"}]','abuse-delivery')->>'delivery_id');
DO $$ BEGIN PERFORM public.line_outbox_claim(100,60); END $$;
SELECT t.ok('LINE-ABUSE','owner suspends receiving messages after claim','owner',
 format($q$select public.line_contact_restriction_set(%L,'MESSAGES',NULL,'fixture receive')$q$,t.v('abuse_msg_contact')));
SELECT t.check('LINE-ABUSE','pre-push recheck cancels restricted recipient',NOT public.line_delivery_ready(t.v('abuse_delivery')::uuid));
SELECT t.ok('LINE-ABUSE','owner uses a temporary catalog suspension','owner',
 format($q$select public.line_contact_restriction_set(%L,'CATALOG',now()+interval '1 minute','fixture temporary')$q$,t.v('abuse_msg_contact')));
UPDATE public.line_contact_restrictions SET until_at=now()-interval '1 second' WHERE contact_id=t.v('abuse_msg_contact')::uuid AND scope='CATALOG';
SELECT t.check('LINE-ABUSE','expired scope resumes without changing another restriction',
 NOT public._line_scope_blocked(t.v('abuse_msg_contact')::uuid,'CATALOG') AND public._line_scope_blocked(t.v('abuse_msg_contact')::uuid,'MESSAGES'));
SELECT t.set('catalog_rev',public.line_catalog_revision());
UPDATE public.products SET name=name WHERE id=(SELECT id FROM public.products LIMIT 1);
SELECT t.check('LINE-CACHE','product/size name invalidates catalog',(public.line_catalog_revision()::bigint)>t.v('catalog_rev')::bigint);
SELECT t.set('catalog_rev',public.line_catalog_revision());
UPDATE public.products SET rental_price=rental_price WHERE id=(SELECT id FROM public.products LIMIT 1);
SELECT t.check('LINE-CACHE','price invalidates catalog',(public.line_catalog_revision()::bigint)>t.v('catalog_rev')::bigint);
SELECT t.set('catalog_rev',public.line_catalog_revision());
UPDATE public.products SET line_listed=line_listed WHERE id=(SELECT id FROM public.products LIMIT 1);
SELECT t.check('LINE-CACHE','publication invalidates catalog',(public.line_catalog_revision()::bigint)>t.v('catalog_rev')::bigint);
SELECT t.err_admin('LINE-ABUSE','invalid spam setting refused',$q$select public._line_policy_check('{"interactionMaxPerMinute":0}')$q$,'INVALID_POLICY');
SELECT t.err_admin('LINE-ABUSE','wrong auto-suspend type refused',$q$select public._line_policy_check('{"abuseAutoSuspend":"yes"}')$q$,'INVALID_POLICY');
DO $$ BEGIN PERFORM public.line_outbox_claim(100,60); END $$;
SELECT t.ok('LINE-ABUSE','owner suspends message reception after lease','owner',
 format($q$select public.line_contact_restriction_set(%L,'MESSAGES',NULL,'fixture stop push')$q$,t.v('abuse_msg_contact')));
SELECT t.check('LINE-ABUSE','last-moment check cancels lease before push',NOT public.line_delivery_ready(t.v('abuse_delivery')::uuid));
SELECT t.check('LINE-ABUSE','cancelled lease never records SENT',
 (SELECT status='CANCELLED' AND last_error_code='CONTACT_UNREACHABLE' FROM public.line_deliveries WHERE id=t.v('abuse_delivery')::uuid));
SELECT t.set('abuse_id5',(SELECT id::text FROM public.line_contacts WHERE line_user_id='U'||lpad(to_hex(71005),32,'0')));
SELECT t.ok('LINE-ABUSE','temporary suspension records actor and expiry','owner',
 format($q$select public.line_contact_restriction_set(%L,'CATALOG',now()+interval '15 minutes','fixture temporary')$q$,t.v('abuse_id5')));
UPDATE public.line_contact_restrictions SET until_at=now()-interval '1 second' WHERE contact_id=t.v('abuse_id5')::uuid;
SELECT t.check('LINE-ABUSE','expired suspension releases without deleting its record',
 NOT public._line_scope_blocked(t.v('abuse_id5')::uuid,'CATALOG') AND EXISTS(SELECT 1 FROM public.line_contact_restrictions WHERE contact_id=t.v('abuse_id5')::uuid));
SELECT t.ok('LINE-ABUSE','inquiry-only restriction before account binding','owner',
 format($q$select public.line_contact_restriction_set(%L,'INQUIRY',NULL,'fixture keep on bind')$q$,t.v('abuse_id5')));
WITH c AS(INSERT INTO public.customers(name,phone,address,created_by) VALUES('Local binding fixture','0817100005','Local test fixture',t.u('owner')) RETURNING id)
SELECT t.set('abuse_customer',id::text) FROM c;
SELECT t.set('abuse_code',t.ok('LINE-ABUSE','owner issues customer code','owner',
 format($q$select public.line_link_code_create_customer(%L)$q$,t.v('abuse_customer')))->>'code');
SELECT t.check('LINE-ABUSE','binding does not erase unrelated restriction',
 public.line_link_code_consume('U'||lpad(to_hex(71005),32,'0'),t.v('abuse_code'))->>'result'='LINKED_CUSTOMER'
 AND public._line_scope_blocked(t.v('abuse_id5')::uuid,'INQUIRY'));
SELECT t.check('LINE-ABUSE','unreviewed binding cannot receive internal data',
 (SELECT needs_review AND NOT public._line_delivery_allowed(c,'BILL','BILL_CARD') FROM public.line_contacts c WHERE id=t.v('abuse_id5')::uuid));
UPDATE public.store_settings SET policies=t.v('abuse_policies_before')::jsonb WHERE singleton;
