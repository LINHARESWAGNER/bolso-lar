BEGIN;
ALTER TABLE public.investment_assets
  ADD COLUMN initial_balance numeric(16,2) NOT NULL DEFAULT 0 CHECK (initial_balance >= 0),
  ADD COLUMN plan_start_date date NOT NULL DEFAULT current_date,
  ADD COLUMN plan_end_date date,
  ADD COLUMN contribution_frequency text NOT NULL DEFAULT 'mensal'
    CHECK (contribution_frequency IN ('unico','mensal','semestral','anual')),
  ADD COLUMN reinvest_earnings boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT investment_plan_dates CHECK (plan_end_date IS NULL OR plan_end_date >= plan_start_date);

UPDATE public.investment_assets a SET
  initial_balance = greatest(0, a.current_balance - coalesce((SELECT sum(CASE WHEN m.type='resgate' THEN -m.amount WHEN m.type='dividendo' THEN 0 ELSE m.amount END) FROM public.investment_movements m WHERE m.investment_id=a.id),0)),
  plan_start_date = least(a.balance_date, coalesce((SELECT min(m.movement_date) FROM public.investment_movements m WHERE m.investment_id=a.id), a.balance_date)),
  plan_end_date = (a.balance_date + interval '20 years')::date;

-- Signed reconciliation is explicit and does not masquerade as earnings or deposits.
ALTER TABLE public.investment_movements DROP CONSTRAINT investment_movements_amount_check;
ALTER TABLE public.investment_movements ADD CONSTRAINT investment_movements_amount_check
  CHECK ((type='ajuste' AND amount <> 0) OR (type <> 'ajuste' AND amount > 0));
ALTER TABLE public.investment_monthly_records ADD COLUMN migrated_investment_id uuid REFERENCES public.investment_assets(id) ON DELETE SET NULL;

CREATE FUNCTION public.import_legacy_investment_tests(target_investment_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  fid uuid := private.current_family_id();
  asset public.investment_assets%ROWTYPE;
  closing public.investment_monthly_records%ROWTYPE;
  running numeric := 0;
  correction numeric;
  first_date date;
BEGIN
  SELECT * INTO asset FROM public.investment_assets WHERE id=target_investment_id AND family_id=fid FOR UPDATE;
  IF asset.id IS NULL THEN RAISE EXCEPTION 'Investimento não encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.investment_monthly_records WHERE family_id=fid AND is_confirmed AND migrated_investment_id IS NULL) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.investment_movements WHERE investment_id=asset.id) OR asset.current_balance <> 0 THEN
    RAISE EXCEPTION 'A importação de testes exige investimento sem saldo e sem operações para evitar duplicidade';
  END IF;
  FOR closing IN SELECT * FROM public.investment_monthly_records WHERE family_id=fid AND is_confirmed AND migrated_investment_id IS NULL ORDER BY reference_month FOR UPDATE LOOP
    first_date := coalesce(first_date, closing.reference_month);
    INSERT INTO public.investment_movements(family_id,investment_id,movement_date,type,amount,notes)
      SELECT fid,asset.id,closing.reference_month,v.kind,v.amount,'Importado do fechamento de teste ' || closing.id
      FROM (VALUES ('aporte',closing.actual_contribution),('dividendo_reaplicado',closing.reinvested_dividends),('resgate',closing.withdrawals)) v(kind,amount) WHERE v.amount>0;
    running := running + closing.actual_contribution + closing.reinvested_dividends - closing.withdrawals;
    correction := closing.ending_balance-running;
    IF correction <> 0 THEN
      INSERT INTO public.investment_movements(family_id,investment_id,movement_date,type,amount,notes)
        VALUES(fid,asset.id,closing.reference_month,'ajuste',correction,'Conciliação do saldo do fechamento de teste ' || closing.id);
    END IF;
    running := closing.ending_balance;
    UPDATE public.investment_monthly_records SET migrated_investment_id=asset.id WHERE id=closing.id;
  END LOOP;
  UPDATE public.investment_assets SET initial_balance=0,current_balance=running,plan_start_date=first_date,
    monthly_contribution=coalesce((SELECT monthly_contribution FROM public.investment_settings WHERE family_id=fid),asset.monthly_contribution),
    annual_rate=coalesce((SELECT CASE active_scenario WHEN 'otimista' THEN optimistic_rate WHEN 'conservador' THEN conservative_rate ELSE base_rate END FROM public.investment_settings WHERE family_id=fid),asset.annual_rate),
    balance_date=closing.reference_month WHERE id=asset.id;
END;
$$;
REVOKE ALL ON FUNCTION public.import_legacy_investment_tests(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_legacy_investment_tests(uuid) TO authenticated;

-- Enforce the invariant between opening balance and the operation ledger.
CREATE FUNCTION public.validate_investment_plan() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.investment_movements WHERE investment_id=NEW.id AND movement_date < NEW.plan_start_date) THEN
    RAISE EXCEPTION 'A data inicial não pode ser posterior a operações existentes';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_investment_plan BEFORE UPDATE OF plan_start_date ON public.investment_assets FOR EACH ROW EXECUTE FUNCTION public.validate_investment_plan();
CREATE FUNCTION public.validate_investment_operation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.investment_assets WHERE id=NEW.investment_id AND family_id=NEW.family_id) THEN RAISE EXCEPTION 'Investimento de outra família'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_investment_operation BEFORE INSERT OR UPDATE ON public.investment_movements FOR EACH ROW EXECUTE FUNCTION public.validate_investment_operation();
COMMIT;
