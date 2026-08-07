
REVOKE ALL ON FUNCTION public.current_family_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bootstrap_family(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_family_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_family(text, text) TO authenticated;
