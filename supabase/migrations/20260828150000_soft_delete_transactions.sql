ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS transactions_family_deleted_at_idx
  ON public.transactions (family_id, deleted_at);

