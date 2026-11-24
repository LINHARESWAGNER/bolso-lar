-- Configuração e classificações de saúde financeira por família.
-- Sem migração ou atualização dos dados transacionais existentes.
CREATE TABLE public.financial_health_settings (
  family_id uuid PRIMARY KEY REFERENCES public.families(id) ON DELETE CASCADE,
  essential_max_pct numeric(6,2) NOT NULL DEFAULT 60 CHECK (essential_max_pct BETWEEN 0 AND 100),
  debt_healthy_pct numeric(6,2) NOT NULL DEFAULT 20 CHECK (debt_healthy_pct BETWEEN 0 AND 100),
  debt_critical_pct numeric(6,2) NOT NULL DEFAULT 30 CHECK (debt_critical_pct BETWEEN 0 AND 100 AND debt_critical_pct > debt_healthy_pct),
  investment_target_pct numeric(6,2) NOT NULL DEFAULT 20 CHECK (investment_target_pct BETWEEN 0 AND 100),
  reserve_target_months numeric(6,2) NOT NULL DEFAULT 6 CHECK (reserve_target_months > 0),
  card_max_pct numeric(6,2) NOT NULL DEFAULT 50 CHECK (card_max_pct BETWEEN 0 AND 100),
  budget_tolerance_pct numeric(6,2) NOT NULL DEFAULT 5 CHECK (budget_tolerance_pct BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.financial_health_essential_categories (
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  is_essential boolean NOT NULL,
  PRIMARY KEY(family_id, category_id)
);
CREATE TABLE public.financial_health_debt_groups (
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  installment_group_id uuid NOT NULL REFERENCES public.installment_groups(id) ON DELETE CASCADE,
  debt_kind text NOT NULL CHECK (debt_kind IN ('emprestimo','financiamento','cartao_parcelado','nao_divida')),
  PRIMARY KEY(family_id, installment_group_id)
);
-- Impede vínculo entre famílias distintas, mesmo se uma política for configurada incorretamente.
CREATE OR REPLACE FUNCTION public.validate_financial_health_family() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'financial_health_essential_categories' AND NOT EXISTS
    (SELECT 1 FROM public.categories WHERE id = NEW.category_id AND family_id = NEW.family_id AND parent_id IS NULL AND kind = 'despesa') THEN
    RAISE EXCEPTION 'Categoria deve ser raiz de despesa da mesma família';
  END IF;
  IF TG_TABLE_NAME = 'financial_health_debt_groups' AND NOT EXISTS
    (SELECT 1 FROM public.installment_groups WHERE id = NEW.installment_group_id AND family_id = NEW.family_id) THEN
    RAISE EXCEPTION 'Parcelamento não pertence à família';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_health_essential BEFORE INSERT OR UPDATE ON public.financial_health_essential_categories
FOR EACH ROW EXECUTE FUNCTION public.validate_financial_health_family();
CREATE TRIGGER validate_health_debt BEFORE INSERT OR UPDATE ON public.financial_health_debt_groups
FOR EACH ROW EXECUTE FUNCTION public.validate_financial_health_family();
ALTER TABLE public.financial_health_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_health_essential_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_health_debt_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "family scope" ON public.financial_health_settings FOR ALL TO authenticated
 USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
CREATE POLICY "family scope" ON public.financial_health_essential_categories FOR ALL TO authenticated
 USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
CREATE POLICY "family scope" ON public.financial_health_debt_groups FOR ALL TO authenticated
 USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_health_settings,
 public.financial_health_essential_categories, public.financial_health_debt_groups TO authenticated;
GRANT ALL ON public.financial_health_settings,
 public.financial_health_essential_categories, public.financial_health_debt_groups TO service_role;
