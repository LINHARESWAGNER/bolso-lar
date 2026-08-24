# Repository guidelines

- Preserve published Git history: do not force-push or rewrite shared commits.
- Keep `main` deployable and use feature branches for changes.
- Never commit database passwords, secret API keys, or local environment files.
- Apply database changes through versioned files in `supabase/migrations`.
