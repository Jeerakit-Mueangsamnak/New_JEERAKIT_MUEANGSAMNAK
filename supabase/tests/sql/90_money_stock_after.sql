-- Runs after the two-connection races in run_local.sh: checks each race, then report-level totals
-- over every bill the whole suite created (what the finance/report screens read).
\set ON_ERROR_STOP 1

-- ===================================================================== RACES (two connections at once)
SELECT t.check('M-RACE', r.tag || ': both calls really ran at the same time (time windows overlap)',
    (SELECT count(*) = 2 AND max(started) < min(finished) FROM t.conc c WHERE c.tag = r.tag), r.tag)
  FROM (SELECT DISTINCT tag FROM t.conc) r;

SELECT t.check('M-RACE', 'K1 same key twice: both answered, second is the replay, 1 payment, stock taken once',
    (SELECT count(*) FILTER (WHERE ok) = 2 AND count(*) FILTER (WHERE msg LIKE 'REPLAY %') = 1 FROM t.conc WHERE tag = 'K1')
    AND t.pay_count('dK1') = 1 AND (t.bill('dK1')).paid_amount = 10
    AND (SELECT count(DISTINCT sm.correlation_id) FROM public.stock_movements sm JOIN public.bill_lines l ON l.id = sm.source_id
          WHERE l.bill_id = t.v('dK1')::uuid AND sm.movement_type = 'RESERVE') = 1,
    (SELECT string_agg(who || ':' || ok || ':' || left(msg, 60), ' | ') FROM t.conc WHERE tag = 'K1'));
SELECT t.check('M-RACE', 'K2 two keys at once: exactly one confirms, the other gets BILL_NOT_DRAFT, 1 payment',
    (SELECT count(*) FILTER (WHERE ok) = 1 AND count(*) FILTER (WHERE NOT ok AND msg LIKE 'BILL_NOT_DRAFT%') = 1
       FROM t.conc WHERE tag = 'K2')
    AND t.pay_count('dK2') = 1 AND (t.bill('dK2')).paid_amount = 10,
    (SELECT string_agg(who || ':' || ok || ':' || left(msg, 60), ' | ') FROM t.conc WHERE tag = 'K2'));
SELECT t.check('M-RACE', 'K3 two receives of the full balance at once: one paid, the other OVERPAYMENT',
    (SELECT count(*) FILTER (WHERE ok) = 1 AND count(*) FILTER (WHERE NOT ok AND msg LIKE 'OVERPAYMENT%') = 1
       FROM t.conc WHERE tag = 'K3')
    AND t.pay_count('dK3') = 1 AND (t.bill('dK3')).paid_amount = 10 AND (t.bill('dK3')).balance_due = 0,
    (SELECT string_agg(who || ':' || ok || ':' || left(msg, 60), ' | ') FROM t.conc WHERE tag = 'K3'));
SELECT t.check('M-RACE', 'K5 two full refunds of one payment at once: one paid, the other refused, refunded 10 not 20',
    (SELECT count(*) FILTER (WHERE ok) = 1 AND count(*) FILTER (WHERE NOT ok AND msg LIKE 'REFUND_EXCEEDS%') = 1
       FROM t.conc WHERE tag = 'K5')
    AND (t.bill('dK5')).refunded_amount = 10
    AND (SELECT count(*) FROM public.refunds WHERE bill_id = t.v('dK5')::uuid AND status = 'PAID') = 1,
    (SELECT string_agg(who || ':' || ok || ':' || left(msg, 60), ' | ') FROM t.conc WHERE tag = 'K5'));
SELECT t.check('M-RACE', 'LAST unit sold from 2 connections: one confirmed, the other INSUFFICIENT_STOCK, never oversold',
    (SELECT count(*) FILTER (WHERE ok) = 1 AND count(*) FILTER (WHERE NOT ok AND msg LIKE 'INSUFFICIENT_STOCK%') = 1
       FROM t.conc WHERE tag = 'LAST')
    AND t.stock('pl', 'AVAILABLE') = 0 AND t.stock('pl', 'RESERVED') = 1
    AND (SELECT count(*) FROM public.bills WHERE id IN (t.v('dL1')::uuid, t.v('dL2')::uuid) AND status = 'CONFIRMED') = 1
    AND (SELECT count(*) FROM public.bills WHERE id IN (t.v('dL1')::uuid, t.v('dL2')::uuid) AND status = 'DRAFT') = 1,
    (SELECT string_agg(who || ':' || ok || ':' || left(msg, 60), ' | ') FROM t.conc WHERE tag = 'LAST'));

-- ===================================================================== REPORT TOTALS (every bill in the suite)
SELECT t.check('M-REPORT', 'every bill: paid = sum of completed payments, refunded = sum of paid refunds',
    NOT EXISTS (
        SELECT 1 FROM public.bills b
         WHERE b.paid_amount <> COALESCE((SELECT sum(amount) FROM public.payments p WHERE p.bill_id = b.id AND p.status = 'COMPLETED'), 0)
            OR b.refunded_amount <> COALESCE((SELECT sum(amount) FROM public.refunds r WHERE r.bill_id = b.id AND r.status = 'PAID'), 0)),
    (SELECT string_agg(COALESCE(bill_no, id::text), ',') FROM public.bills b
      WHERE b.paid_amount <> COALESCE((SELECT sum(amount) FROM public.payments p WHERE p.bill_id = b.id AND p.status = 'COMPLETED'), 0)
         OR b.refunded_amount <> COALESCE((SELECT sum(amount) FROM public.refunds r WHERE r.bill_id = b.id AND r.status = 'PAID'), 0)));
SELECT t.check('M-REPORT', 'no bill ever refunded more than it received',
    NOT EXISTS (SELECT 1 FROM public.bills WHERE refunded_amount > paid_amount));
SELECT t.check('M-REPORT', 'cash report: payments − refunds (money tables) = Σ bills (paid − refunded)',
    (SELECT COALESCE(sum(amount), 0) FROM public.payments WHERE status = 'COMPLETED')
      - (SELECT COALESCE(sum(amount), 0) FROM public.refunds WHERE status = 'PAID')
    = (SELECT sum(paid_amount - refunded_amount) FROM public.bills));
SELECT t.check('M-REPORT', 'refund ledger = refund table (amount and count)',
    (SELECT COALESCE(sum(amount), 0) FROM public.refunds WHERE status = 'PAID')
      = (SELECT COALESCE(sum(amount), 0) FROM public.finance_ledger_entries WHERE entry_type = 'REFUND')
    AND (SELECT count(*) FROM public.refunds WHERE status = 'PAID')
      = (SELECT count(*) FROM public.finance_ledger_entries WHERE entry_type = 'REFUND'));
SELECT t.check('M-REPORT', 'every open/closed bill: confirm-time revenue + VAT in the ledger = its grand total',
    NOT EXISTS (
        SELECT 1 FROM public.bills b
         WHERE b.status NOT IN ('DRAFT', 'CANCELLED', 'VOID')
           AND b.grand_total <> COALESCE((SELECT sum(e.amount * e.direction) FROM public.finance_ledger_entries e
                                           WHERE e.bill_id = b.id AND e.source_type = 'BILL_CONFIRM'
                                             AND e.entry_type IN ('REVENUE', 'VAT')), 0)),
    (SELECT string_agg(COALESCE(b.bill_no, b.id::text) || ' grand=' || b.grand_total, ',') FROM public.bills b
      WHERE b.status NOT IN ('DRAFT', 'CANCELLED', 'VOID')
        AND b.grand_total <> COALESCE((SELECT sum(e.amount * e.direction) FROM public.finance_ledger_entries e
                                        WHERE e.bill_id = b.id AND e.source_type = 'BILL_CONFIRM'
                                          AND e.entry_type IN ('REVENUE', 'VAT')), 0)));
SELECT t.check('M-REPORT', 'VAT report: VAT ledger per bill = the bill''s VAT amount',
    NOT EXISTS (
        SELECT 1 FROM public.bills b
         WHERE b.status NOT IN ('DRAFT', 'CANCELLED', 'VOID')
           AND b.vat_amount <> COALESCE((SELECT sum(e.amount * e.direction) FROM public.finance_ledger_entries e
                                          WHERE e.bill_id = b.id AND e.source_type = 'BILL_CONFIRM' AND e.entry_type = 'VAT'), 0)));
SELECT t.check('M-REPORT', 'drafts and cancelled bills carry no money and no confirm-time ledger',
    NOT EXISTS (SELECT 1 FROM public.bills b WHERE b.status IN ('DRAFT', 'CANCELLED')
                  AND (b.paid_amount <> 0 OR EXISTS (SELECT 1 FROM public.finance_ledger_entries e
                         WHERE e.bill_id = b.id AND e.source_type = 'BILL_CONFIRM' AND e.entry_type IN ('REVENUE', 'VAT')
                           AND NOT EXISTS (SELECT 1 FROM public.finance_ledger_entries r WHERE r.reverses_entry_id = e.id)))));
SELECT t.check('M-REPORT', 'a cancelled bill owes nothing; a void bill only shows money still to give back',
    NOT EXISTS (SELECT 1 FROM public.bills WHERE status = 'CANCELLED' AND balance_due <> 0)
    AND NOT EXISTS (SELECT 1 FROM public.bills WHERE status = 'VOID' AND balance_due <> -(paid_amount - refunded_amount)),
    (SELECT string_agg(status || ' confirmed=' || (confirmed_at IS NOT NULL) || ' balance=' || balance_due, ', ')
       FROM public.bills WHERE (status = 'CANCELLED' AND balance_due <> 0)
          OR (status = 'VOID' AND balance_due <> -(paid_amount - refunded_amount))));
SELECT t.check('M-REPORT', 'every VOID bill: confirm revenue and write-offs net to 0 in the ledger (reversals kept)',
    NOT EXISTS (
        SELECT 1 FROM public.bills b
         WHERE b.status = 'VOID'
           AND COALESCE((SELECT sum(e.amount * e.direction) FROM public.finance_ledger_entries e
                          WHERE e.bill_id = b.id
                            AND (e.source_type IN ('BILL_CONFIRM', 'WRITE_OFF')
                                 OR e.reverses_entry_id IN (SELECT id FROM public.finance_ledger_entries
                                                             WHERE source_type IN ('BILL_CONFIRM', 'WRITE_OFF')))), 0) <> 0));
SELECT t.check('M-REPORT', 'every ledger reversal points at one original of the same bill with the same amount, opposite sign',
    NOT EXISTS (SELECT 1 FROM public.finance_ledger_entries r JOIN public.finance_ledger_entries o ON o.id = r.reverses_entry_id
                 WHERE r.amount <> o.amount OR r.direction <> -o.direction OR r.bill_id IS DISTINCT FROM o.bill_id));
SELECT t.check('M-REPORT', 'rebuilding every bill from its records changes nothing (cached totals were right)',
    NOT EXISTS (
        SELECT 1 FROM public.bills b, LATERAL public.reconcile_bill(b.id) r
         WHERE b.status <> 'DRAFT' AND (r -> 'before') - 'updated_at' <> (r -> 'after') - 'updated_at'));
SELECT t.check('M-REPORT', 'stock: cached balances = movement history for every product/state',
    NOT EXISTS (SELECT 1 FROM public.reconcile_stock_balances()),
    (SELECT string_agg(product_id || '/' || stock_state || ' ' || cached || '≠' || ledger, ',') FROM public.reconcile_stock_balances()));
SELECT t.check('M-REPORT', 'stock never negative anywhere', NOT EXISTS (SELECT 1 FROM public.stock_balances WHERE quantity < 0));
SELECT t.check('M-REPORT', 'T-SALE stock adds up: opening 40 = available + reserved + sold',
    t.stock('ps', 'AVAILABLE') + t.stock('ps', 'RESERVED') + t.stock('ps', 'SOLD') = 40);
