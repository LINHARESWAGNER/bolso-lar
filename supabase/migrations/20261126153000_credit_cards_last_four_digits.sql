-- Identificação visual opcional do cartão: nunca armazenar número completo.
ALTER TABLE public.credit_cards
  ADD COLUMN IF NOT EXISTS last_four_digits text;

ALTER TABLE public.credit_cards
  DROP CONSTRAINT IF EXISTS credit_cards_last_four_digits_format_check;
ALTER TABLE public.credit_cards
  ADD CONSTRAINT credit_cards_last_four_digits_format_check
  CHECK (last_four_digits IS NULL OR last_four_digits ~ '^[0-9]{4}$');
