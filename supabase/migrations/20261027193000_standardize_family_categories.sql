-- Use the current Família Linhares category tree as the default template.
-- Existing categories and their transaction links are preserved: only missing
-- category paths are added to each family.

CREATE TABLE IF NOT EXISTS private.default_category_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES private.default_category_templates(id) ON DELETE CASCADE,
  source_category_id uuid NOT NULL UNIQUE,
  name text NOT NULL,
  kind public.category_kind NOT NULL,
  color text,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.default_category_templates FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.default_category_templates TO service_role;

DO $snapshot$
DECLARE
  source_family_id constant uuid := '9eb4f16d-f530-4ae1-b5c8-9fb0d9788832';
  source_count integer;
  template_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.categories child
    JOIN public.categories parent ON parent.id = child.parent_id
    WHERE child.family_id = source_family_id
      AND parent.parent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Default category source contains more than two hierarchy levels';
  END IF;

  INSERT INTO private.default_category_templates (
    source_category_id, name, kind, color, icon, is_active
  )
  SELECT id, name, kind, color, icon, is_active
  FROM public.categories
  WHERE family_id = source_family_id
    AND parent_id IS NULL
  ON CONFLICT (source_category_id) DO NOTHING;

  INSERT INTO private.default_category_templates (
    parent_id, source_category_id, name, kind, color, icon, is_active
  )
  SELECT template_parent.id, child.id, child.name, child.kind,
         child.color, child.icon, child.is_active
  FROM public.categories child
  JOIN private.default_category_templates template_parent
    ON template_parent.source_category_id = child.parent_id
  WHERE child.family_id = source_family_id
    AND child.parent_id IS NOT NULL
  ON CONFLICT (source_category_id) DO NOTHING;

  SELECT count(*) INTO source_count
  FROM public.categories
  WHERE family_id = source_family_id;

  SELECT count(*) INTO template_count
  FROM private.default_category_templates;

  IF source_count = 0 OR template_count <> source_count THEN
    RAISE EXCEPTION
      'Default category snapshot incomplete: source %, template %',
      source_count, template_count;
  END IF;
END
$snapshot$;

CREATE OR REPLACE FUNCTION private.merge_default_categories(target_family_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $function$
DECLARE
  root_template record;
  child_template record;
  target_parent_id uuid;
  target_child_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.families WHERE id = target_family_id) THEN
    RAISE EXCEPTION 'Family % does not exist', target_family_id;
  END IF;

  FOR root_template IN
    SELECT *
    FROM private.default_category_templates
    WHERE parent_id IS NULL
    ORDER BY kind, lower(btrim(name)), id
  LOOP
    target_parent_id := NULL;

    SELECT id INTO target_parent_id
    FROM public.categories
    WHERE family_id = target_family_id
      AND parent_id IS NULL
      AND kind = root_template.kind
      AND lower(btrim(name)) = lower(btrim(root_template.name))
    ORDER BY created_at, id
    LIMIT 1;

    IF target_parent_id IS NULL THEN
      INSERT INTO public.categories (
        family_id, name, kind, color, icon, is_active
      ) VALUES (
        target_family_id, root_template.name, root_template.kind,
        root_template.color, root_template.icon, root_template.is_active
      )
      RETURNING id INTO target_parent_id;
    END IF;

    FOR child_template IN
      SELECT *
      FROM private.default_category_templates
      WHERE parent_id = root_template.id
      ORDER BY lower(btrim(name)), id
    LOOP
      target_child_id := NULL;

      SELECT id INTO target_child_id
      FROM public.categories
      WHERE family_id = target_family_id
        AND parent_id = target_parent_id
        AND kind = child_template.kind
        AND lower(btrim(name)) = lower(btrim(child_template.name))
      ORDER BY created_at, id
      LIMIT 1;

      IF target_child_id IS NULL THEN
        INSERT INTO public.categories (
          family_id, parent_id, name, kind, color, icon, is_active
        ) VALUES (
          target_family_id, target_parent_id, child_template.name,
          child_template.kind, child_template.color, child_template.icon,
          child_template.is_active
        );
      END IF;
    END LOOP;
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION private.merge_default_categories(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.merge_default_categories(uuid) TO service_role;

DO $merge_existing_families$
DECLARE
  family_row record;
BEGIN
  FOR family_row IN SELECT id FROM public.families ORDER BY created_at, id
  LOOP
    PERFORM private.merge_default_categories(family_row.id);
  END LOOP;
END
$merge_existing_families$;

CREATE OR REPLACE FUNCTION public.bootstrap_family(family_name text, owner_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $function$
DECLARE
  fid uuid;
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT family_id INTO fid
  FROM public.profiles
  WHERE id = uid;

  IF fid IS NOT NULL THEN
    RETURN fid;
  END IF;

  INSERT INTO public.families(name)
  VALUES (family_name)
  RETURNING id INTO fid;

  INSERT INTO public.profiles(id, family_id, full_name)
  VALUES (uid, fid, owner_name)
  ON CONFLICT (id) DO UPDATE
    SET family_id = EXCLUDED.family_id,
        full_name = EXCLUDED.full_name;

  INSERT INTO public.family_members(family_id, user_id, name, role)
  VALUES (fid, uid, owner_name, 'Titular');

  PERFORM private.merge_default_categories(fid);

  RETURN fid;
END
$function$;

REVOKE ALL ON FUNCTION public.bootstrap_family(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_family(text, text) TO authenticated;

