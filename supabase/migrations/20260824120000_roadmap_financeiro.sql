-- Roadmap financeiro: classificação de despesas e orçamento variável por vigência.
-- Campos permanecem nulos nos dados antigos para evitar classificação arbitrária.
CREATE TYPE public.expense_nature AS ENUM ('fixo', 'variavel');

ALTER TABLE public.transactions
  ADD COLUMN expense_nature public.expense_nature;

ALTER TABLE public.recurring_transactions
  ADD COLUMN expense_nature public.expense_nature;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_expense_nature_check
  CHECK (type = 'despesa' OR expense_nature IS NULL);

ALTER TABLE public.recurring_transactions
  ADD CONSTRAINT recurring_expense_nature_check
  CHECK (type = 'despesa' OR expense_nature IS NULL);

CREATE TABLE public.variable_budget_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  monthly_amount numeric(14,2) NOT NULL DEFAULT 3500 CHECK (monthly_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_on <= ends_on),
  UNIQUE (family_id, starts_on, ends_on)
);

ALTER TABLE public.variable_budget_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "family scope" ON public.variable_budget_periods
  FOR ALL TO authenticated
  USING (family_id = private.current_family_id())
  WITH CHECK (family_id = private.current_family_id());

CREATE OR REPLACE FUNCTION public.prevent_overlapping_variable_budgets()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.variable_budget_periods p
    WHERE p.family_id = NEW.family_id
      AND p.id <> NEW.id
      AND daterange(p.starts_on, p.ends_on, '[]') && daterange(NEW.starts_on, NEW.ends_on, '[]')
  ) THEN
    RAISE EXCEPTION 'O período do orçamento se sobrepõe a outro período existente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_overlapping_variable_budgets
BEFORE INSERT OR UPDATE ON public.variable_budget_periods
FOR EACH ROW EXECUTE FUNCTION public.prevent_overlapping_variable_budgets();

CREATE OR REPLACE FUNCTION public.set_variable_budget_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_variable_budget_periods_updated_at
BEFORE UPDATE ON public.variable_budget_periods
FOR EACH ROW EXECUTE FUNCTION public.set_variable_budget_updated_at();
