-- Nova evolução: preservar intactas as migrações de 14:00, 15:00 e 15:10.
-- Mantém nao_divida (legado) para não alterar dados existentes.
ALTER TABLE public.financial_health_debt_groups
  DROP CONSTRAINT IF EXISTS financial_health_debt_groups_debt_kind_check;
ALTER TABLE public.financial_health_debt_groups
  ADD CONSTRAINT financial_health_debt_groups_debt_kind_check
  CHECK (debt_kind IN (
    'emprestimo', 'financiamento', 'compra_parcelada', 'imposto_taxa_parcelada',
    'acordo_renegociacao', 'outro_compromisso', 'nao_considerar',
    'cartao_parcelado', 'nao_divida'
  ));

-- Função específica, sem substituir a validação de parcelamentos das migrações anteriores.
CREATE OR REPLACE FUNCTION public.validate_health_essential_category_family()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.categories
    WHERE id = NEW.category_id AND family_id = NEW.family_id AND kind = 'despesa'
  ) THEN
    RAISE EXCEPTION 'Categoria deve ser de despesa e pertencer à mesma família';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_health_essential ON public.financial_health_essential_categories;
CREATE TRIGGER validate_health_essential
BEFORE INSERT OR UPDATE ON public.financial_health_essential_categories
FOR EACH ROW EXECUTE FUNCTION public.validate_health_essential_category_family();
