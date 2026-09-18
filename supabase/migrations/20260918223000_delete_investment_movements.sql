-- Delete an investment movement while atomically reversing its effect on the
-- investment balance.

CREATE OR REPLACE FUNCTION public.delete_investment_movement(target_movement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  fid uuid := private.current_family_id();
  movement_record public.investment_movements%ROWTYPE;
  current_amount numeric;
  original_delta numeric;
BEGIN
  IF fid IS NULL THEN RAISE EXCEPTION 'Família não encontrada'; END IF;

  SELECT * INTO movement_record
  FROM public.investment_movements
  WHERE id = target_movement_id AND family_id = fid;
  IF movement_record.id IS NULL THEN RAISE EXCEPTION 'Movimentação não encontrada'; END IF;

  SELECT current_balance INTO current_amount
  FROM public.investment_assets
  WHERE id = movement_record.investment_id AND family_id = fid
  FOR UPDATE;
  IF current_amount IS NULL THEN RAISE EXCEPTION 'Investimento não encontrado'; END IF;

  original_delta := CASE
    WHEN movement_record.type = 'resgate' THEN -movement_record.amount
    WHEN movement_record.type = 'dividendo' THEN 0
    ELSE movement_record.amount
  END;

  IF current_amount - original_delta < 0 THEN
    RAISE EXCEPTION 'A exclusão deixaria o investimento com saldo negativo';
  END IF;

  DELETE FROM public.investment_movements WHERE id = movement_record.id;
  UPDATE public.investment_assets
  SET current_balance = current_amount - original_delta
  WHERE id = movement_record.investment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_investment_movement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_investment_movement(uuid) TO authenticated;
