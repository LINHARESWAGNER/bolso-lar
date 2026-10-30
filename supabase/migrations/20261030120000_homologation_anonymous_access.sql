-- Local/homologation-only access for UX review without user authentication.
-- This migration is inert unless the session explicitly enables the guard:
--   SET app.homologation_bypass_auth = 'on';

DO $migration$
DECLARE
  target_family_id constant uuid := '9eb4f16d-f530-4ae1-b5c8-9fb0d9788832';
  table_row record;
BEGIN
  IF current_setting('app.homologation_bypass_auth', true) IS DISTINCT FROM 'on' THEN
    RAISE NOTICE 'Skipping homologation-only anonymous access policies';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.families WHERE id = target_family_id) THEN
    RAISE EXCEPTION 'Homologation family % does not exist', target_family_id;
  END IF;

  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.families TO anon';
  EXECUTE 'DROP POLICY IF EXISTS homologation_anon_access ON public.families';
  EXECUTE format(
    'CREATE POLICY homologation_anon_access ON public.families FOR ALL TO anon USING (id = %L::uuid) WITH CHECK (id = %L::uuid)',
    target_family_id,
    target_family_id
  );

  FOR table_row IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'family_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('profiles', 'family_invitations')
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO anon',
      table_row.table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS homologation_anon_access ON public.%I',
      table_row.table_name
    );
    EXECUTE format(
      'CREATE POLICY homologation_anon_access ON public.%I FOR ALL TO anon USING (family_id = %L::uuid) WITH CHECK (family_id = %L::uuid)',
      table_row.table_name,
      target_family_id,
      target_family_id
    );
  END LOOP;
END
$migration$;
