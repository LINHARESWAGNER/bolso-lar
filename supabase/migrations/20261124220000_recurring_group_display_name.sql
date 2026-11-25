-- Etapa 5F | Gestão da Família | Persistência do nome de compromissos agrupados.
-- Aplicar somente no Supabase de HOMOLOGAÇÃO inicialmente.
-- Migração aditiva: não altera os valores, as datas, os pagamentos ou os vínculos atuais.
ALTER TABLE public.recurring_transactions
  ADD COLUMN IF NOT EXISTS group_display_name text;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recurring_transactions'::regclass
      AND conname = 'recurring_transactions_group_display_name_length_chk'
  ) THEN
    ALTER TABLE public.recurring_transactions
      ADD CONSTRAINT recurring_transactions_group_display_name_length_chk
      CHECK (group_display_name IS NULL OR
             (length(btrim(group_display_name)) BETWEEN 1 AND 100));
  END IF;
END
$migration$;

COMMENT ON COLUMN public.recurring_transactions.group_display_name IS
  'Nome de exibição da cadeia de recorrências na raiz do predecessor_recurrence_id; sincronizado entre dispositivos.';

-- Conserva o RLS já habilitado e as políticas existentes de recurring_transactions.
-- Não criar política anônima, não alterar permissões nem gravar dados financeiros.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'recurring_transactions'
  AND column_name = 'group_display_name';
