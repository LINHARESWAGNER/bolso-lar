-- Investment portfolio, monthly confirmations, goals and emergency reserve.

CREATE TABLE public.investment_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL UNIQUE REFERENCES public.families(id) ON DELETE CASCADE,
  target_amount numeric(16,2) NOT NULL DEFAULT 1000000 CHECK (target_amount > 0),
  monthly_contribution numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_contribution >= 0),
  conservative_rate numeric(7,4) NOT NULL DEFAULT 6 CHECK (conservative_rate > -100),
  base_rate numeric(7,4) NOT NULL DEFAULT 10 CHECK (base_rate > -100),
  optimistic_rate numeric(7,4) NOT NULL DEFAULT 14 CHECK (optimistic_rate > -100),
  active_scenario text NOT NULL DEFAULT 'base' CHECK (active_scenario IN ('conservador','base','otimista')),
  reinvest_dividends boolean NOT NULL DEFAULT true,
  reserve_months numeric(5,2) NOT NULL DEFAULT 6 CHECK (reserve_months > 0),
  essential_monthly_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (essential_monthly_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.investment_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  institution text,
  category text NOT NULL DEFAULT 'renda_fixa' CHECK (category IN (
    'reserva_emergencia','renda_fixa','fundos','acoes','fiis','previdencia','cripto','outros'
  )),
  current_balance numeric(16,2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  balance_date date NOT NULL DEFAULT current_date,
  annual_rate numeric(7,4) CHECK (annual_rate > -100),
  monthly_contribution numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_contribution >= 0),
  is_emergency_reserve boolean NOT NULL DEFAULT false,
  liquidity text NOT NULL DEFAULT 'd_1' CHECK (liquidity IN ('imediata','d_1','d_2_mais','carencia')),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.investment_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  investment_id uuid NOT NULL REFERENCES public.investment_assets(id) ON DELETE CASCADE,
  movement_date date NOT NULL DEFAULT current_date,
  type text NOT NULL CHECK (type IN (
    'aporte','resgate','rendimento','dividendo','dividendo_reaplicado','ajuste'
  )),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.investment_monthly_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  reference_month date NOT NULL,
  planned_contribution numeric(14,2) NOT NULL DEFAULT 0 CHECK (planned_contribution >= 0),
  actual_contribution numeric(14,2) NOT NULL DEFAULT 0 CHECK (actual_contribution >= 0),
  reinvested_dividends numeric(14,2) NOT NULL DEFAULT 0 CHECK (reinvested_dividends >= 0),
  withdrawals numeric(14,2) NOT NULL DEFAULT 0 CHECK (withdrawals >= 0),
  ending_balance numeric(16,2) NOT NULL DEFAULT 0 CHECK (ending_balance >= 0),
  is_confirmed boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, reference_month),
  CHECK (reference_month = date_trunc('month', reference_month)::date)
);

CREATE INDEX investment_movements_family_date
  ON public.investment_movements(family_id, movement_date);
CREATE INDEX investment_monthly_records_family_month
  ON public.investment_monthly_records(family_id, reference_month);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_settings,
  public.investment_assets, public.investment_movements,
  public.investment_monthly_records TO authenticated;
GRANT ALL ON public.investment_settings, public.investment_assets,
  public.investment_movements, public.investment_monthly_records TO service_role;

ALTER TABLE public.investment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_monthly_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family scope" ON public.investment_settings FOR ALL TO authenticated
  USING (family_id = private.current_family_id())
  WITH CHECK (family_id = private.current_family_id());
CREATE POLICY "family scope" ON public.investment_assets FOR ALL TO authenticated
  USING (family_id = private.current_family_id())
  WITH CHECK (family_id = private.current_family_id());
CREATE POLICY "family scope" ON public.investment_movements FOR ALL TO authenticated
  USING (family_id = private.current_family_id())
  WITH CHECK (family_id = private.current_family_id());
CREATE POLICY "family scope" ON public.investment_monthly_records FOR ALL TO authenticated
  USING (family_id = private.current_family_id())
  WITH CHECK (family_id = private.current_family_id());

CREATE TRIGGER touch_investment_settings BEFORE UPDATE ON public.investment_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_investment_assets BEFORE UPDATE ON public.investment_assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_investment_movements BEFORE UPDATE ON public.investment_movements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_investment_monthly_records BEFORE UPDATE ON public.investment_monthly_records
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.register_investment_movement(
  target_investment_id uuid,
  movement_kind text,
  movement_amount numeric,
  occurred_on date,
  movement_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  fid uuid := private.current_family_id();
  current_amount numeric;
  delta numeric;
  movement_id uuid;
BEGIN
  IF fid IS NULL THEN RAISE EXCEPTION 'Família não encontrada'; END IF;
  IF movement_amount <= 0 THEN RAISE EXCEPTION 'O valor deve ser maior que zero'; END IF;
  IF movement_kind NOT IN ('aporte','resgate','rendimento','dividendo','dividendo_reaplicado') THEN
    RAISE EXCEPTION 'Tipo de movimentação inválido';
  END IF;

  SELECT current_balance INTO current_amount
  FROM public.investment_assets
  WHERE id = target_investment_id AND family_id = fid
  FOR UPDATE;
  IF current_amount IS NULL THEN RAISE EXCEPTION 'Investimento não encontrado'; END IF;

  delta := CASE
    WHEN movement_kind = 'resgate' THEN -movement_amount
    WHEN movement_kind = 'dividendo' THEN 0
    ELSE movement_amount
  END;
  IF current_amount + delta < 0 THEN
    RAISE EXCEPTION 'O resgate não pode deixar o investimento negativo';
  END IF;

  INSERT INTO public.investment_movements(
    family_id, investment_id, movement_date, type, amount, notes
  ) VALUES (
    fid, target_investment_id, occurred_on, movement_kind, movement_amount, movement_notes
  ) RETURNING id INTO movement_id;

  UPDATE public.investment_assets
  SET current_balance = current_amount + delta,
      balance_date = occurred_on
  WHERE id = target_investment_id;

  RETURN movement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_investment_movement(uuid, text, numeric, date, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_investment_movement(uuid, text, numeric, date, text)
  TO authenticated;
