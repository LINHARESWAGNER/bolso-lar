-- Vinculo explicito de continuidade entre recorrencias (sem inferencia por descricao).
-- Nao modifica registros existentes e nao insere vinculos automaticamente.
-- Nao alterar migracoes historicas ja aplicadas.

ALTER TABLE public.recurring_transactions
  ADD COLUMN predecessor_recurrence_id uuid NULL;

ALTER TABLE public.recurring_transactions
  ADD CONSTRAINT recurring_predecessor_fk
  FOREIGN KEY (predecessor_recurrence_id)
  REFERENCES public.recurring_transactions(id)
  ON DELETE RESTRICT;

-- Um periodo de recorrencia pode ter somente uma continuacao imediata.
CREATE UNIQUE INDEX recurring_predecessor_unique
  ON public.recurring_transactions (predecessor_recurrence_id)
  WHERE predecessor_recurrence_id IS NOT NULL;

CREATE INDEX recurring_family_predecessor_idx
  ON public.recurring_transactions (family_id, predecessor_recurrence_id);

-- Garante coerencia ao criar/editar o sucessor e ao editar uma recorrencia que ja tenha sucessor.
CREATE FUNCTION public.validate_recurring_continuation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  pred record;
  succ record;
BEGIN
  IF NEW.predecessor_recurrence_id IS NOT NULL THEN
    IF NEW.predecessor_recurrence_id = NEW.id THEN
      RAISE EXCEPTION 'Uma recorrencia nao pode ser continuacao dela mesma';
    END IF;

    SELECT r.id, r.family_id, r.type, r.start_date, r.end_date
      INTO pred
      FROM public.recurring_transactions AS r
      WHERE r.id = NEW.predecessor_recurrence_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recorrencia anterior nao encontrada';
    END IF;

    IF pred.family_id IS DISTINCT FROM NEW.family_id THEN
      RAISE EXCEPTION 'Recorrencias vinculadas devem pertencer a mesma familia';
    END IF;

    IF pred.type IS DISTINCT FROM NEW.type THEN
      RAISE EXCEPTION 'Recorrencias vinculadas devem ter o mesmo tipo';
    END IF;

    IF pred.end_date IS NULL THEN
      RAISE EXCEPTION 'Informe a data final da recorrencia anterior antes de vincular sua continuacao';
    END IF;

    IF pred.end_date >= NEW.start_date THEN
      RAISE EXCEPTION 'Periodos das recorrencias vinculadas nao podem se sobrepor';
    END IF;
  END IF;

  -- Protege continuacoes ja cadastradas se a recorrencia anterior for editada.
  FOR succ IN
    SELECT r.id, r.family_id, r.type, r.start_date
      FROM public.recurring_transactions AS r
      WHERE r.predecessor_recurrence_id = NEW.id
  LOOP
    IF NEW.family_id IS DISTINCT FROM succ.family_id
      OR NEW.type IS DISTINCT FROM succ.type THEN
      RAISE EXCEPTION 'A alteracao quebra a continuidade da recorrencia %', succ.id;
    END IF;

    IF NEW.end_date IS NULL OR NEW.end_date >= succ.start_date THEN
      RAISE EXCEPTION 'A data final da recorrencia anterior deve preceder o inicio da continuacao %', succ.id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_recurring_continuation_trigger
BEFORE INSERT OR UPDATE OF predecessor_recurrence_id, family_id, type, start_date, end_date
ON public.recurring_transactions
FOR EACH ROW
EXECUTE FUNCTION public.validate_recurring_continuation();

COMMENT ON COLUMN public.recurring_transactions.predecessor_recurrence_id IS
  'Vinculo definido explicitamente pelo usuario: recorrencia anterior do mesmo compromisso. NULL significa ausencia de vinculo, nao encerramento comprovado.';
