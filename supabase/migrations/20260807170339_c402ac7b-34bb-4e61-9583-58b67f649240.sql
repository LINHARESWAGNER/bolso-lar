
-- ENUMS
CREATE TYPE public.account_type AS ENUM ('corrente','digital','poupanca','dinheiro','carteira','investimento','outros');
CREATE TYPE public.category_kind AS ENUM ('receita','despesa');
CREATE TYPE public.transaction_type AS ENUM ('receita','despesa','transferencia','pagamento_fatura');
CREATE TYPE public.transaction_status AS ENUM ('previsto','pendente','pago','atrasado','cancelado');
CREATE TYPE public.recurrence_frequency AS ENUM ('semanal','mensal','bimestral','trimestral','semestral','anual');
CREATE TYPE public.invoice_status AS ENUM ('aberta','fechada','paga');

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- FAMILIES
CREATE TABLE public.families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id uuid REFERENCES public.families(id) ON DELETE SET NULL,
  full_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.current_family_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT family_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE TABLE public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  role text,
  color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  institution text,
  type public.account_type NOT NULL DEFAULT 'corrente',
  initial_balance numeric(14,2) NOT NULL DEFAULT 0,
  initial_balance_date date NOT NULL DEFAULT current_date,
  color text,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  include_in_cash boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind public.category_kind NOT NULL,
  color text,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  institution text,
  brand text,
  credit_limit numeric(14,2) NOT NULL DEFAULT 0,
  closing_day int NOT NULL DEFAULT 1,
  due_day int NOT NULL DEFAULT 10,
  payment_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_card_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  credit_card_id uuid NOT NULL REFERENCES public.credit_cards(id) ON DELETE CASCADE,
  reference_month date NOT NULL,
  closing_date date NOT NULL,
  due_date date NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'aberta',
  paid_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credit_card_id, reference_month)
);

CREATE TABLE public.recurring_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  description text NOT NULL,
  type public.transaction_type NOT NULL,
  amount numeric(14,2) NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  frequency public.recurrence_frequency NOT NULL DEFAULT 'mensal',
  start_date date NOT NULL,
  end_date date,
  occurrences int,
  day_of_month int,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.installment_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  description text NOT NULL,
  total_amount numeric(14,2) NOT NULL,
  installments int NOT NULL,
  first_due_date date NOT NULL,
  credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  description text NOT NULL,
  type public.transaction_type NOT NULL,
  amount numeric(14,2) NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES public.credit_card_invoices(id) ON DELETE SET NULL,
  member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  competence_date date NOT NULL DEFAULT current_date,
  due_date date,
  paid_date date,
  status public.transaction_status NOT NULL DEFAULT 'pendente',
  notes text,
  transfer_group_id uuid,
  transfer_role text,
  recurring_id uuid REFERENCES public.recurring_transactions(id) ON DELETE SET NULL,
  installment_group_id uuid REFERENCES public.installment_groups(id) ON DELETE CASCADE,
  installment_number int,
  installment_total int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_family_comp ON public.transactions (family_id, competence_date);
CREATE INDEX idx_tx_family_paid ON public.transactions (family_id, paid_date);
CREATE INDEX idx_tx_invoice ON public.transactions (invoice_id);

CREATE TABLE public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  reference_month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, reference_month)
);

CREATE TABLE public.budget_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, category_id)
);

CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, name)
);

CREATE TABLE public.transaction_tags (
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

-- GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.families, public.profiles, public.family_members,
  public.accounts, public.categories, public.credit_cards, public.credit_card_invoices,
  public.recurring_transactions, public.installment_groups, public.transactions,
  public.budgets, public.budget_items, public.tags, public.transaction_tags TO authenticated;
GRANT ALL ON public.families, public.profiles, public.family_members,
  public.accounts, public.categories, public.credit_cards, public.credit_card_invoices,
  public.recurring_transactions, public.installment_groups, public.transactions,
  public.budgets, public.budget_items, public.tags, public.transaction_tags TO service_role;

-- RLS
ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_card_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "own family" ON public.families FOR SELECT TO authenticated
  USING (id = public.current_family_id());
CREATE POLICY "update own family" ON public.families FOR UPDATE TO authenticated
  USING (id = public.current_family_id()) WITH CHECK (id = public.current_family_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['family_members','accounts','categories','credit_cards','credit_card_invoices',
    'recurring_transactions','installment_groups','transactions','budgets','budget_items','tags','transaction_tags']
  LOOP
    EXECUTE format(
      'CREATE POLICY "family scope" ON public.%I FOR ALL TO authenticated USING (family_id = public.current_family_id()) WITH CHECK (family_id = public.current_family_id())', t);
    EXECUTE format(
      'CREATE TRIGGER touch_%1$s BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t);
  END LOOP;
END $$;

CREATE TRIGGER touch_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_families BEFORE UPDATE ON public.families FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- BOOTSTRAP
CREATE OR REPLACE FUNCTION public.bootstrap_family(family_name text, owner_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fid uuid;
  uid uuid := auth.uid();
  parent uuid;
  rec record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT family_id INTO fid FROM public.profiles WHERE id = uid;
  IF fid IS NOT NULL THEN RETURN fid; END IF;

  INSERT INTO public.families(name) VALUES (family_name) RETURNING id INTO fid;
  INSERT INTO public.profiles(id, family_id, full_name, email)
  VALUES (uid, fid, owner_name, (SELECT email FROM auth.users WHERE id = uid))
  ON CONFLICT (id) DO UPDATE SET family_id = fid, full_name = owner_name;

  INSERT INTO public.family_members(family_id, user_id, name, role)
  VALUES (fid, uid, owner_name, 'Titular');

  FOR rec IN SELECT * FROM (VALUES
    ('despesa','Moradia', ARRAY['Aluguel','Condomínio','Energia','Água','Internet','Manutenção']),
    ('despesa','Alimentação', ARRAY['Supermercado','Restaurante','Delivery']),
    ('despesa','Transporte', ARRAY['Combustível','Manutenção','Seguro','Aplicativos','Estacionamento']),
    ('despesa','Saúde', ARRAY['Plano de saúde','Farmácia','Consultas']),
    ('despesa','Educação', ARRAY['Escola','Cursos','Material escolar']),
    ('despesa','Lazer', ARRAY['Viagens','Cinema','Passeios']),
    ('despesa','Assinaturas', ARRAY['Streaming','Aplicativos','Serviços']),
    ('receita','Salário', ARRAY[]::text[]),
    ('receita','Pró-labore', ARRAY[]::text[]),
    ('receita','Freelance', ARRAY[]::text[]),
    ('receita','Rendimentos', ARRAY[]::text[]),
    ('receita','Aluguéis', ARRAY[]::text[]),
    ('receita','Outras receitas', ARRAY[]::text[])
  ) AS v(kind, name, subs)
  LOOP
    INSERT INTO public.categories(family_id, name, kind)
    VALUES (fid, rec.name, rec.kind::public.category_kind) RETURNING id INTO parent;
    IF array_length(rec.subs,1) > 0 THEN
      INSERT INTO public.categories(family_id, parent_id, name, kind)
      SELECT fid, parent, s, rec.kind::public.category_kind FROM unnest(rec.subs) AS s;
    END IF;
  END LOOP;

  RETURN fid;
END $$;

GRANT EXECUTE ON FUNCTION public.bootstrap_family(text, text) TO authenticated;
