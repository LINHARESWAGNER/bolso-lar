import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "./finance";

export const qk = {
  profile: ["profile"] as const,
  accounts: ["accounts"] as const,
  categories: ["categories"] as const,
  members: ["members"] as const,
  cards: ["cards"] as const,
  invoices: ["invoices"] as const,
  transactions: ["transactions"] as const,
  budgets: ["budgets"] as const,
  variableBudgets: ["variable-budgets"] as const,
  recurrences: ["recurrences"] as const,
  installments: ["installments"] as const,
};

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>) {
  const { data, error } = await p;
  if (error) throw error;
  return (data ?? []) as T;
}

export function useProfile() {
  return useQuery({
    queryKey: qk.profile,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*, families(*)")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      return data as
        (Tables["profiles"]["Row"] & { families: Tables["families"]["Row"] | null }) | null;
    },
  });
}

export const useAccounts = () =>
  useQuery({
    queryKey: qk.accounts,
    queryFn: () =>
      unwrap<Tables["accounts"]["Row"][]>(supabase.from("accounts").select("*").order("name")),
  });

export const useCategories = () =>
  useQuery({
    queryKey: qk.categories,
    queryFn: () =>
      unwrap<Tables["categories"]["Row"][]>(supabase.from("categories").select("*").order("name")),
  });

export const useMembers = () =>
  useQuery({
    queryKey: qk.members,
    queryFn: () =>
      unwrap<Tables["family_members"]["Row"][]>(
        supabase.from("family_members").select("*").order("name"),
      ),
  });

export const useCards = () =>
  useQuery({
    queryKey: qk.cards,
    queryFn: () =>
      unwrap<Tables["credit_cards"]["Row"][]>(
        supabase.from("credit_cards").select("*").order("name"),
      ),
  });

export const useInvoices = () =>
  useQuery({
    queryKey: qk.invoices,
    queryFn: () =>
      unwrap<Tables["credit_card_invoices"]["Row"][]>(
        supabase.from("credit_card_invoices").select("*").order("reference_month"),
      ),
  });

export const useTransactions = () =>
  useQuery({
    queryKey: qk.transactions,
    queryFn: () =>
      unwrap<Tables["transactions"]["Row"][]>(
        supabase
          .from("transactions")
          .select("*")
          .order("competence_date", { ascending: false })
          .limit(5000),
      ),
  });

export const useBudgets = () =>
  useQuery({
    queryKey: qk.budgets,
    queryFn: async () => {
      const { data, error } = await supabase.from("budgets").select("*, budget_items(*)");
      if (error) throw error;
      return (data ?? []) as (Tables["budgets"]["Row"] & {
        budget_items: Tables["budget_items"]["Row"][];
      })[];
    },
  });

export const useVariableBudgets = () =>
  useQuery({
    queryKey: qk.variableBudgets,
    queryFn: () =>
      unwrap<Tables["variable_budget_periods"]["Row"][]>(
        supabase.from("variable_budget_periods").select("*").order("starts_on"),
      ),
  });

export const useRecurrences = () =>
  useQuery({
    queryKey: qk.recurrences,
    queryFn: () =>
      unwrap<Tables["recurring_transactions"]["Row"][]>(
        supabase.from("recurring_transactions").select("*").order("description"),
      ),
  });

export const useInstallmentGroups = () =>
  useQuery({
    queryKey: qk.installments,
    queryFn: () =>
      unwrap<Tables["installment_groups"]["Row"][]>(
        supabase.from("installment_groups").select("*").order("created_at", { ascending: false }),
      ),
  });

/** Invalida os dados financeiros derivados após qualquer escrita. */
export function useInvalidateFinance() {
  const qc = useQueryClient();
  return () => {
    for (const key of Object.values(qk)) qc.invalidateQueries({ queryKey: key });
  };
}

export function useMutateFinance<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const invalidate = useInvalidateFinance();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate() });
}
