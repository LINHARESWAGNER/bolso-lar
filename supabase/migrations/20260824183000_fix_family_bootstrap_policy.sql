-- Allow an authenticated user without a family to create the family used by
-- bootstrap_family. Access after creation remains restricted by the SELECT and
-- UPDATE policies that use private.current_family_id().
DROP POLICY IF EXISTS "create own family" ON public.families;

CREATE POLICY "create own family"
ON public.families
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);
