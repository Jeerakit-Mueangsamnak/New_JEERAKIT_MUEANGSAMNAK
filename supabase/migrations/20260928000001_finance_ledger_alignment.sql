-- Migration: Finance Ledger Alignment
-- Purpose:
-- 1) Align refund RPC references with the actual statement_transactions schema.
-- 2) Preserve immutable/append-only ledger semantics.

ALTER TABLE public.statement_transactions
  ADD COLUMN IF NOT EXISTS original_tx_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'statement_transactions_original_tx_id_fkey'
      AND conrelid = 'public.statement_transactions'::regclass
  ) THEN
    ALTER TABLE public.statement_transactions
      ADD CONSTRAINT statement_transactions_original_tx_id_fkey
      FOREIGN KEY (original_tx_id)
      REFERENCES public.statement_transactions(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_statement_transactions_original_tx_id
  ON public.statement_transactions(original_tx_id);

CREATE INDEX IF NOT EXISTS idx_statement_transactions_correlation_id
  ON public.statement_transactions(correlation_id);

-- The client-facing financial ledger remains append-only.
-- SELECT and INSERT privileges/policies are established by earlier migrations.
REVOKE UPDATE, DELETE ON TABLE public.statement_transactions FROM authenticated;
