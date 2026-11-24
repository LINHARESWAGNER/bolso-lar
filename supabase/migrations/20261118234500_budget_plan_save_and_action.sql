-- ============================================================
-- PDCA | ORCAMENTO APROVADO AUTOMATICAMENTE AO SALVAR
-- V1: original | V2+: correcao ou revisao Action
-- ============================================================

CREATE TABLE public.budget_plan_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES public.families(id)
        ON DELETE RESTRICT,
    reference_month date NOT NULL,
    version_number integer NOT NULL CHECK (version_number >= 1),
    change_kind text NOT NULL CHECK (
        change_kind IN ('original', 'erro_original', 'revisao')
    ),
    justification text,
    snapshot jsonb NOT NULL,
    created_by uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),

    UNIQUE (family_id, reference_month, version_number),

    CHECK (
        reference_month =
        date_trunc('month', reference_month)::date
    ),

    CHECK (jsonb_typeof(snapshot) = 'object'),

    CHECK (
        (version_number = 1 AND change_kind = 'original'
            AND justification IS NULL)
        OR
        (version_number > 1
            AND change_kind IN ('erro_original', 'revisao')
            AND length(btrim(justification)) >= 10)
    )
);

CREATE INDEX budget_plan_versions_lookup
ON public.budget_plan_versions (
    family_id, reference_month, version_number DESC
);

-- ============================================================
-- HISTORICO IMUTAVEL
-- ============================================================

CREATE FUNCTION public.prevent_budget_plan_history_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION
        'Historico aprovado: alteracao ou exclusao proibida.';
END;
$$;

CREATE TRIGGER budget_plan_history_immutable
BEFORE UPDATE OR DELETE ON public.budget_plan_versions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_budget_plan_history_change();

-- ============================================================
-- PROTEGER ORCAMENTOS JA APROVADOS
-- ============================================================

CREATE FUNCTION public.guard_approved_budget_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_budget_id uuid;
BEGIN
    IF current_user = (
        SELECT pg_catalog.pg_get_userbyid(p.proowner)
        FROM pg_catalog.pg_proc p
        WHERE p.oid =
          'public.save_budget_plan_version(date,jsonb,jsonb,integer,text,text)'::regprocedure
    ) THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP <> 'INSERT' THEN
        v_budget_id := OLD.budget_id;

        IF EXISTS (
            SELECT 1
            FROM public.budgets b
            JOIN public.budget_plan_versions v
              ON v.family_id = b.family_id
             AND v.reference_month = b.reference_month
            WHERE b.id = v_budget_id
        ) THEN
            RAISE EXCEPTION
                'Orcamento aprovado. Utilize a etapa Action.';
        END IF;
    END IF;

    IF TG_OP <> 'DELETE' THEN
        v_budget_id := NEW.budget_id;

        IF EXISTS (
            SELECT 1
            FROM public.budgets b
            JOIN public.budget_plan_versions v
              ON v.family_id = b.family_id
             AND v.reference_month = b.reference_month
            WHERE b.id = v_budget_id
        ) THEN
            RAISE EXCEPTION
                'Orcamento aprovado. Utilize a etapa Action.';
        END IF;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER guard_approved_budget_items
BEFORE INSERT OR UPDATE OR DELETE ON public.budget_items
FOR EACH ROW
EXECUTE FUNCTION public.guard_approved_budget_items();

CREATE FUNCTION public.guard_approved_budget_header()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF current_user = (
        SELECT pg_catalog.pg_get_userbyid(p.proowner)
        FROM pg_catalog.pg_proc p
        WHERE p.oid =
          'public.save_budget_plan_version(date,jsonb,jsonb,integer,text,text)'::regprocedure
    ) THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.budget_plan_versions
        WHERE family_id = OLD.family_id
          AND reference_month = OLD.reference_month
    ) THEN
        RAISE EXCEPTION
            'Orcamento aprovado. Utilize a etapa Action.';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER guard_approved_budget_header
BEFORE UPDATE OR DELETE ON public.budgets
FOR EACH ROW
EXECUTE FUNCTION public.guard_approved_budget_header();

-- ============================================================
-- RLS DO HISTORICO
-- ============================================================

ALTER TABLE public.budget_plan_versions
ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family read budget plan versions"
ON public.budget_plan_versions
FOR SELECT TO authenticated
USING (
    family_id = private.current_family_id()
);

REVOKE ALL ON public.budget_plan_versions
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.budget_plan_versions
TO authenticated;

GRANT ALL ON public.budget_plan_versions
TO service_role;

-- ============================================================
-- GRAVACAO ATOMICA:
-- 0 = PRIMEIRO SALVAMENTO / APROVACAO AUTOMATICA
-- 1+ = REVISAO PELO ACTION
--
-- p_items:
-- [
--   {"category_id":"uuid","amount":1500.00}
-- ]
--
-- p_context:
-- {
--   "income": 5000,
--   "fixed": 2000,
--   "variable": 3000
-- }
-- ============================================================

CREATE FUNCTION public.save_budget_plan_version(
    p_reference_month date,
    p_items jsonb,
    p_context jsonb,
    p_expected_version integer,
    p_change_kind text DEFAULT NULL,
    p_justification text DEFAULT NULL
)
RETURNS public.budget_plan_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_family uuid;
    v_user uuid;
    v_budget uuid;
    v_latest integer;
    v_next integer;
    v_kind text;
    v_items jsonb;
    v_result public.budget_plan_versions;
BEGIN
    v_family := private.current_family_id();
    v_user := auth.uid();

    IF v_family IS NULL OR v_user IS NULL THEN
        RAISE EXCEPTION 'Usuario nao autenticado.';
    END IF;

    IF p_reference_month IS NULL
       OR p_reference_month <>
          date_trunc('month', p_reference_month)::date THEN
        RAISE EXCEPTION 'Mes de referencia invalido.';
    END IF;

    IF p_items IS NULL
       OR jsonb_typeof(p_items) <> 'array'
       OR p_context IS NULL
       OR jsonb_typeof(p_context) <> 'object' THEN
        RAISE EXCEPTION 'Dados do orcamento invalidos.';
    END IF;

    IF NOT (
        p_context ? 'income'
        AND p_context ? 'fixed'
        AND p_context ? 'variable'
    )
    OR jsonb_typeof(p_context -> 'income') <> 'number'
    OR jsonb_typeof(p_context -> 'fixed') <> 'number'
    OR jsonb_typeof(p_context -> 'variable') <> 'number' THEN
        RAISE EXCEPTION 'Totais do planejamento incompletos.';
    END IF;

    -- Bloqueio transacional por familia.
    PERFORM 1
    FROM public.families
    WHERE id = v_family
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Familia nao encontrada.';
    END IF;

    SELECT COALESCE(MAX(version_number), 0)
    INTO v_latest
    FROM public.budget_plan_versions
    WHERE family_id = v_family
      AND reference_month = p_reference_month;

    IF p_expected_version IS NULL
       OR p_expected_version <> v_latest THEN
        RAISE EXCEPTION
            'Versao desatualizada. Atualize a pagina.';
    END IF;

    v_next := v_latest + 1;

    IF v_next = 1 THEN
        IF p_change_kind IS NOT NULL
           OR p_justification IS NOT NULL THEN
            RAISE EXCEPTION
                'Primeiro salvamento nao exige revisao.';
        END IF;

        v_kind := 'original';
    ELSE
        IF p_change_kind NOT IN ('erro_original', 'revisao')
           OR length(btrim(COALESCE(p_justification, ''))) < 10 THEN
            RAISE EXCEPTION
                'Action exige motivo e justificativa.';
        END IF;

        v_kind := p_change_kind;
    END IF;

    -- Validar IDs, categorias e valores.
    -- Duplicidades de categoria tambem sao proibidas.

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) item
        WHERE jsonb_typeof(item) <> 'object'
           OR NOT (item ? 'category_id')
           OR NOT (item ? 'amount')
           OR jsonb_typeof(item -> 'amount') <> 'number'
    ) THEN
        RAISE EXCEPTION 'Itens do orcamento invalidos.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_items)
            AS item(category_id uuid, amount numeric)
        LEFT JOIN public.categories c
          ON c.id = item.category_id
         AND c.family_id = v_family
         AND c.kind = 'despesa'
        WHERE item.category_id IS NULL
           OR item.amount IS NULL
           OR item.amount <= 0
           OR c.id IS NULL
    ) THEN
        RAISE EXCEPTION
            'Categoria ou valor nao permitido.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_items)
            AS item(category_id uuid, amount numeric)
        GROUP BY item.category_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Categoria repetida no orcamento.';
    END IF;

    -- Um orcamento legado deve ser incorporado explicitamente.
    -- Nunca substituir seus itens no primeiro salvamento.
    IF v_next = 1 AND EXISTS (
        SELECT 1
        FROM public.budgets b
        WHERE b.family_id = v_family
          AND b.reference_month = p_reference_month
    ) THEN
        RAISE EXCEPTION
            'Orcamento anterior encontrado. A incorporacao ao historico deve ser explicita.';
    END IF;
INSERT INTO public.budgets (
        family_id, reference_month
    )
    VALUES (
        v_family, p_reference_month
    )
    ON CONFLICT (family_id, reference_month)
    DO UPDATE SET
        updated_at = now()
    RETURNING id INTO v_budget;

    DELETE FROM public.budget_items
    WHERE budget_id = v_budget
      AND family_id = v_family;

    INSERT INTO public.budget_items (
        budget_id,
        family_id,
        category_id,
        amount
    )
    SELECT
        v_budget,
        v_family,
        item.category_id,
        item.amount
    FROM jsonb_to_recordset(p_items)
        AS item(category_id uuid, amount numeric);

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'category_id', category_id,
                'amount', amount
            )
            ORDER BY category_id
        ),
        '[]'::jsonb
    )
    INTO v_items
    FROM public.budget_items
    WHERE budget_id = v_budget
      AND family_id = v_family;

    INSERT INTO public.budget_plan_versions (
        family_id,
        reference_month,
        version_number,
        change_kind,
        justification,
        snapshot,
        created_by
    )
    VALUES (
        v_family,
        p_reference_month,
        v_next,
        v_kind,
        CASE
            WHEN v_next = 1 THEN NULL
            ELSE btrim(p_justification)
        END,
        p_context || jsonb_build_object(
            'budget_items', v_items,
            'variable', (
                SELECT COALESCE(SUM(amount), 0)
                FROM public.budget_items
                WHERE budget_id = v_budget
                  AND family_id = v_family
            )
        ),
        v_user
    )
    RETURNING * INTO v_result;

RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_budget_plan_version(
    date, jsonb, jsonb, integer, text, text
)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_budget_plan_version(
    date, jsonb, jsonb, integer, text, text
)
TO authenticated;

COMMENT ON TABLE public.budget_plan_versions IS
'Historico imutavel do planejamento salvo e revisoes via Action.';