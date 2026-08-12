CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.current_family_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT family_id FROM public.profiles WHERE id = auth.uid(); $$;

REVOKE ALL ON FUNCTION private.current_family_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_family_id() TO authenticated, service_role;

DROP POLICY "family scope" ON public.accounts;
CREATE POLICY "family scope" ON public.accounts FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.budget_items;
CREATE POLICY "family scope" ON public.budget_items FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.budgets;
CREATE POLICY "family scope" ON public.budgets FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.categories;
CREATE POLICY "family scope" ON public.categories FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.credit_card_invoices;
CREATE POLICY "family scope" ON public.credit_card_invoices FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.credit_cards;
CREATE POLICY "family scope" ON public.credit_cards FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.family_members;
CREATE POLICY "family scope" ON public.family_members FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.installment_groups;
CREATE POLICY "family scope" ON public.installment_groups FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.recurring_transactions;
CREATE POLICY "family scope" ON public.recurring_transactions FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.tags;
CREATE POLICY "family scope" ON public.tags FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.transaction_tags;
CREATE POLICY "family scope" ON public.transaction_tags FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());
DROP POLICY "family scope" ON public.transactions;
CREATE POLICY "family scope" ON public.transactions FOR ALL TO authenticated USING (family_id = private.current_family_id()) WITH CHECK (family_id = private.current_family_id());

DROP POLICY "own family" ON public.families;
CREATE POLICY "own family" ON public.families FOR SELECT TO authenticated USING (id = private.current_family_id());
DROP POLICY "update own family" ON public.families;
CREATE POLICY "update own family" ON public.families FOR UPDATE TO authenticated USING (id = private.current_family_id()) WITH CHECK (id = private.current_family_id());
CREATE POLICY "create own family" ON public.families FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY "own profile" ON public.profiles;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP FUNCTION IF EXISTS public.current_family_id();

CREATE OR REPLACE FUNCTION public.bootstrap_family(family_name text, owner_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
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
  INSERT INTO public.profiles(id, family_id, full_name)
  VALUES (uid, fid, owner_name)
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
END $function$;

REVOKE ALL ON FUNCTION public.bootstrap_family(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_family(text, text) TO authenticated;