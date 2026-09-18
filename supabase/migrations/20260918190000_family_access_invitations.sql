-- Shared family access. The family owner authorizes an email and the invited
-- person joins the same family on their first authenticated session.

ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.families
  ALTER COLUMN owner_id SET DEFAULT auth.uid();

UPDATE public.families f
SET owner_id = COALESCE(
  (
    SELECT fm.user_id
    FROM public.family_members fm
    WHERE fm.family_id = f.id
      AND fm.user_id IS NOT NULL
      AND lower(COALESCE(fm.role, '')) = 'titular'
    ORDER BY fm.created_at
    LIMIT 1
  ),
  (
    SELECT p.id
    FROM public.profiles p
    WHERE p.family_id = f.id
    ORDER BY p.created_at
    LIMIT 1
  )
)
WHERE owner_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS family_members_one_user
  ON public.family_members(user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.family_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  role text,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT family_invitations_email_normalized CHECK (email = lower(btrim(email)))
);

CREATE UNIQUE INDEX IF NOT EXISTS family_invitations_pending_email
  ON public.family_invitations(family_id, email)
  WHERE accepted_at IS NULL;

ALTER TABLE public.family_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner reads family invitations" ON public.family_invitations;
CREATE POLICY "owner reads family invitations"
  ON public.family_invitations FOR SELECT TO authenticated
  USING (
    family_id = private.current_family_id()
    AND EXISTS (
      SELECT 1 FROM public.families f
      WHERE f.id = family_id AND f.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "owner deletes pending family invitations" ON public.family_invitations;
CREATE POLICY "owner deletes pending family invitations"
  ON public.family_invitations FOR DELETE TO authenticated
  USING (
    accepted_at IS NULL
    AND family_id = private.current_family_id()
    AND EXISTS (
      SELECT 1 FROM public.families f
      WHERE f.id = family_id AND f.owner_id = auth.uid()
    )
  );

GRANT SELECT, DELETE ON public.family_invitations TO authenticated;
GRANT ALL ON public.family_invitations TO service_role;

CREATE OR REPLACE FUNCTION public.invite_family_member(
  invitee_email text,
  invitee_name text,
  invitee_role text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  fid uuid;
  normalized_email text := lower(btrim(invitee_email));
  invitation_id uuid;
BEGIN
  SELECT p.family_id INTO fid
  FROM public.profiles p
  WHERE p.id = uid;

  IF uid IS NULL OR fid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.families f WHERE f.id = fid AND f.owner_id = uid
  ) THEN
    RAISE EXCEPTION 'Somente o proprietário pode gerenciar acessos';
  END IF;

  IF normalized_email = '' OR normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido';
  END IF;

  IF btrim(invitee_name) = '' THEN
    RAISE EXCEPTION 'Informe o nome da pessoa';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) = normalized_email AND p.family_id = fid
  ) THEN
    RAISE EXCEPTION 'Esta conta já possui acesso à família';
  END IF;

  INSERT INTO public.family_invitations(family_id, email, name, role, invited_by, expires_at)
  VALUES (fid, normalized_email, btrim(invitee_name), nullif(btrim(invitee_role), ''), uid, now() + interval '30 days')
  ON CONFLICT (family_id, email) WHERE accepted_at IS NULL
  DO UPDATE SET
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    invited_by = EXCLUDED.invited_by,
    expires_at = EXCLUDED.expires_at,
    created_at = now()
  RETURNING id INTO invitation_id;

  RETURN invitation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_family_invitation()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  user_email text;
  current_fid uuid;
  invitation public.family_invitations%ROWTYPE;
  member_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  SELECT lower(email) INTO user_email FROM auth.users WHERE id = uid;
  SELECT family_id INTO current_fid FROM public.profiles WHERE id = uid;

  SELECT * INTO invitation
  FROM public.family_invitations fi
  WHERE fi.email = user_email
    AND fi.accepted_at IS NULL
    AND fi.expires_at > now()
  ORDER BY fi.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF invitation.id IS NULL THEN
    RETURN current_fid;
  END IF;

  IF current_fid IS NOT NULL AND current_fid <> invitation.family_id THEN
    RAISE EXCEPTION 'Esta conta já pertence a outra família';
  END IF;

  INSERT INTO public.profiles(id, family_id, full_name, email)
  VALUES (uid, invitation.family_id, invitation.name, user_email)
  ON CONFLICT (id) DO UPDATE SET
    family_id = EXCLUDED.family_id,
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    email = EXCLUDED.email;

  SELECT id INTO member_id
  FROM public.family_members
  WHERE family_id = invitation.family_id
    AND lower(name) = lower(invitation.name)
    AND user_id IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF member_id IS NOT NULL THEN
    UPDATE public.family_members
    SET user_id = uid,
        role = COALESCE(role, invitation.role),
        is_active = true
    WHERE id = member_id;
  ELSE
    INSERT INTO public.family_members(family_id, user_id, name, role)
    VALUES (invitation.family_id, uid, invitation.name, invitation.role);
  END IF;

  UPDATE public.family_invitations
  SET accepted_by = uid, accepted_at = now()
  WHERE id = invitation.id;

  RETURN invitation.family_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_family_access()
RETURNS TABLE (
  user_id uuid,
  name text,
  role text,
  email text,
  is_owner boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  fid uuid;
BEGIN
  SELECT p.family_id INTO fid FROM public.profiles p WHERE p.id = uid;
  IF fid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT fm.user_id, fm.name, fm.role, p.email, (f.owner_id = fm.user_id)
  FROM public.family_members fm
  JOIN public.profiles p ON p.id = fm.user_id AND p.family_id = fid
  JOIN public.families f ON f.id = fid
  WHERE fm.family_id = fid AND fm.user_id IS NOT NULL
  ORDER BY (f.owner_id = fm.user_id) DESC, fm.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_family_access(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  fid uuid;
BEGIN
  SELECT p.family_id INTO fid FROM public.profiles p WHERE p.id = uid;
  IF fid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.families f WHERE f.id = fid AND f.owner_id = uid
  ) THEN
    RAISE EXCEPTION 'Somente o proprietário pode gerenciar acessos';
  END IF;
  IF target_user_id = uid THEN
    RAISE EXCEPTION 'O proprietário não pode remover o próprio acesso';
  END IF;

  UPDATE public.profiles SET family_id = NULL WHERE id = target_user_id AND family_id = fid;
  UPDATE public.family_members SET user_id = NULL WHERE user_id = target_user_id AND family_id = fid;
END;
$$;

REVOKE ALL ON FUNCTION public.invite_family_member(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_family_invitation() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_family_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_family_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_family_member(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_family_invitation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_family_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_family_access(uuid) TO authenticated;
