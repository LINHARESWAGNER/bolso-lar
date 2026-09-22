-- Preserve manually registered operations when associating old monthly test totals.
CREATE OR REPLACE FUNCTION public.import_legacy_investment_tests(target_investment_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  fid uuid := private.current_family_id();
  asset public.investment_assets%ROWTYPE;
  closing public.investment_monthly_records%ROWTYPE;
  item record;
  existing numeric;
  running numeric;
  correction numeric;
  first_date date;
BEGIN
  SELECT * INTO asset FROM public.investment_assets WHERE id=target_investment_id AND family_id=fid FOR UPDATE;
  IF asset.id IS NULL THEN RAISE EXCEPTION 'Investimento não encontrado'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.investment_monthly_records WHERE family_id=fid AND is_confirmed AND migrated_investment_id IS NULL) THEN RETURN; END IF;
  FOR closing IN SELECT * FROM public.investment_monthly_records WHERE family_id=fid AND is_confirmed AND migrated_investment_id IS NULL ORDER BY reference_month FOR UPDATE LOOP
    first_date := coalesce(first_date,closing.reference_month);
    FOR item IN SELECT * FROM (VALUES ('aporte',closing.actual_contribution),('dividendo_reaplicado',closing.reinvested_dividends),('resgate',closing.withdrawals)) v(kind,amount) LOOP
      SELECT coalesce(sum(amount),0) INTO existing FROM public.investment_movements WHERE investment_id=asset.id AND type=item.kind AND date_trunc('month',movement_date)::date=closing.reference_month;
      IF existing > item.amount THEN RAISE EXCEPTION 'Há operações maiores que o fechamento em %. Revise antes de importar.',closing.reference_month; END IF;
      IF item.amount > existing THEN
        INSERT INTO public.investment_movements(family_id,investment_id,movement_date,type,amount,notes)
        VALUES(fid,asset.id,closing.reference_month,item.kind,item.amount-existing,'Importado do fechamento de teste '||closing.id);
      END IF;
    END LOOP;
    SELECT asset.initial_balance+coalesce(sum(CASE WHEN type='resgate' THEN -amount WHEN type='dividendo' THEN 0 ELSE amount END),0) INTO running FROM public.investment_movements WHERE investment_id=asset.id AND movement_date < closing.reference_month+interval '1 month';
    correction := closing.ending_balance-running;
    IF correction<>0 THEN
      INSERT INTO public.investment_movements(family_id,investment_id,movement_date,type,amount,notes)
      VALUES(fid,asset.id,(closing.reference_month+interval '1 month - 1 day')::date,'ajuste',correction,'Conciliação do saldo do fechamento de teste '||closing.id);
    END IF;
    UPDATE public.investment_monthly_records SET migrated_investment_id=asset.id WHERE id=closing.id;
  END LOOP;
  UPDATE public.investment_assets SET
    current_balance=asset.initial_balance+coalesce((SELECT sum(CASE WHEN type='resgate' THEN -amount WHEN type='dividendo' THEN 0 ELSE amount END) FROM public.investment_movements WHERE investment_id=asset.id),0),
    plan_start_date=least(first_date,asset.plan_start_date),
    monthly_contribution=coalesce((SELECT monthly_contribution FROM public.investment_settings WHERE family_id=fid),asset.monthly_contribution),
    annual_rate=coalesce((SELECT CASE active_scenario WHEN 'otimista' THEN optimistic_rate WHEN 'conservador' THEN conservative_rate ELSE base_rate END FROM public.investment_settings WHERE family_id=fid),asset.annual_rate),
    balance_date=(SELECT max(movement_date) FROM public.investment_movements WHERE investment_id=asset.id)
  WHERE id=asset.id;
END; $$;
