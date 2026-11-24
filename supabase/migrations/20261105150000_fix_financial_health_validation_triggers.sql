-- Separa as validações de categorias essenciais e grupos de dívida.
-- A função anterior acessava campos de tabelas diferentes por meio de NEW,
-- provocando erro ao salvar uma categoria essencial.

DROP TRIGGER IF EXISTS validate_health_essential
  ON public.financial_health_essential_categories;

DROP TRIGGER IF EXISTS validate_health_debt
  ON public.financial_health_debt_groups;

DROP FUNCTION IF EXISTS public.validate_financial_health_family();

CREATE FUNCTION public.validate_financial_health_essential_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.categories
    WHERE id = NEW.category_id
      AND family_id = NEW.family_id
      AND parent_id IS NULL
      AND kind = 'despesa'
  ) THEN
    RAISE EXCEPTION 'Categoria deve ser raiz de despesa da mesma família';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.validate_financial_health_debt_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.installment_groups
    WHERE id = NEW.installment_group_id
      AND family_id = NEW.family_id
  ) THEN
    RAISE EXCEPTION 'Parcelamento não pertence à família';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_health_essential
BEFORE INSERT OR UPDATE
ON public.financial_health_essential_categories
FOR EACH ROW
EXECUTE FUNCTION public.validate_financial_health_essential_category();

CREATE TRIGGER validate_health_debt
BEFORE INSERT OR UPDATE
ON public.financial_health_debt_groups
FOR EACH ROW
EXECUTE FUNCTION public.validate_financial_health_debt_group();

