-- Pagamentos de fatura são saídas de uma conta bancária, não compras no cartão.
-- O vínculo com a fatura continua preservado em invoice_id.
UPDATE public.transactions
SET credit_card_id = NULL
WHERE type = 'pagamento_fatura'
  AND credit_card_id IS NOT NULL;

-- Impede que integrações ou versões antigas do aplicativo recriem a inconsistência.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_invoice_payment_without_card;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_invoice_payment_without_card
  CHECK (type <> 'pagamento_fatura' OR credit_card_id IS NULL);
