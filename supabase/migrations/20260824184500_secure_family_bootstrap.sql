-- bootstrap_family is the controlled entry point that creates the first
-- family, profile, member and default categories in one transaction. It must
-- bypass the family-scoped RLS policies because the user has no family yet.
ALTER FUNCTION public.bootstrap_family(text, text) SECURITY DEFINER;
ALTER FUNCTION public.bootstrap_family(text, text) SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.bootstrap_family(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_family(text, text) TO authenticated;
