-- Dados anteriores à adoção da classificação não devem permanecer inconsistentes.
UPDATE public.transactions
SET expense_nature = 'fixo'
WHERE type = 'despesa'
  AND expense_nature IS NULL
  AND competence_date < DATE '2026-08-01';

-- Mantém coerentes também as configurações recorrentes antigas.
UPDATE public.recurring_transactions
SET expense_nature = 'fixo'
WHERE type = 'despesa'
  AND expense_nature IS NULL
  AND start_date < DATE '2026-08-01';
