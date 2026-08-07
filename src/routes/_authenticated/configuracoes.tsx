import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/ui-bits";
import { brl, formatDateBR } from "@/lib/format";
import { FREQUENCY_LABEL } from "@/lib/finance";
import {
  useCategories,
  useInvalidateFinance,
  useMembers,
  useProfile,
  useRecurrences,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Finanças da Família" },
      { name: "description", content: "Família, membros, categorias e lançamentos recorrentes." },
      { property: "og:title", content: "Configurações — Finanças da Família" },
      { property: "og:description", content: "Família, membros, categorias e lançamentos recorrentes." },
    ],
  }),
  component: Configuracoes,
});

function Configuracoes() {
  return (
    <div>
      <PageHeader title="Configurações" subtitle="Família, membros, categorias e recorrências" />
      <Tabs defaultValue="familia">
        <TabsList>
          <TabsTrigger value="familia">Família</TabsTrigger>
          <TabsTrigger value="membros">Membros</TabsTrigger>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="recorrencias">Recorrências</TabsTrigger>
        </TabsList>
        <TabsContent value="familia" className="mt-4"><FamilyPanel /></TabsContent>
        <TabsContent value="membros" className="mt-4"><MembersPanel /></TabsContent>
        <TabsContent value="categorias" className="mt-4"><CategoriesPanel /></TabsContent>
        <TabsContent value="recorrencias" className="mt-4"><RecurrencesPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function FamilyPanel() {
  const { data: profile } = useProfile();
  const invalidate = useInvalidateFinance();
  const [name, setName] = useState<string | null>(null);
  const value = name ?? profile?.families?.name ?? "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile?.family_id) return;
    const { error } = await supabase
      .from("families")
      .update({ name: value })
      .eq("id", profile.family_id);
    if (error) toast.error("Não foi possível salvar");
    else {
      toast.success("Família atualizada");
      invalidate();
    }
  }

  return (
    <form onSubmit={save} className="max-w-md space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="space-y-2">
        <Label htmlFor="fn">Nome da família</Label>
        <Input id="fn" value={value} onChange={(e) => setName(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">
        Conta: {profile?.email ?? "—"}
      </p>
      <Button type="submit">Salvar</Button>
    </form>
  );
}

function MembersPanel() {
  const { data: members = [] } = useMembers();
  const { data: profile } = useProfile();
  const invalidate = useInvalidateFinance();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!profile?.family_id || !name.trim()) return;
    const { error } = await supabase.from("family_members").insert({
      family_id: profile.family_id,
      name: name.trim(),
      role: role.trim() || null,
    });
    if (error) toast.error("Não foi possível adicionar");
    else {
      setName("");
      setRole("");
      invalidate();
      toast.success("Membro adicionado");
    }
  }

  async function toggle(id: string, isActive: boolean) {
    await supabase.from("family_members").update({ is_active: isActive }).eq("id", id);
    invalidate();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("family_members").delete().eq("id", id);
    if (error) toast.error("Membro possui lançamentos vinculados");
    else invalidate();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-40 flex-1 space-y-2">
          <Label htmlFor="mn">Nome</Label>
          <Input id="mn" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="min-w-40 flex-1 space-y-2">
          <Label htmlFor="mr">Papel</Label>
          <Input id="mr" placeholder="pai, mãe, filho..." value={role} onChange={(e) => setRole(e.target.value)} />
        </div>
        <Button type="submit"><Plus className="mr-2 h-4 w-4" /> Adicionar</Button>
      </form>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
              <p className="text-xs text-muted-foreground">{m.role ?? "Membro"}</p>
            </div>
            <Switch checked={m.is_active} onCheckedChange={(v) => toggle(m.id, v)} />
            <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => remove(m.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoriesPanel() {
  const { data: categories = [] } = useCategories();
  const { data: profile } = useProfile();
  const invalidate = useInvalidateFinance();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"receita" | "despesa">("despesa");
  const [parent, setParent] = useState("none");

  const roots = categories.filter((c) => !c.parent_id);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!profile?.family_id || !name.trim()) return;
    const { error } = await supabase.from("categories").insert({
      family_id: profile.family_id,
      name: name.trim(),
      kind,
      parent_id: parent === "none" ? null : parent,
    });
    if (error) toast.error("Não foi possível criar a categoria");
    else {
      setName("");
      invalidate();
      toast.success("Categoria criada");
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) toast.error("Categoria em uso — desative-a em vez de excluir");
    else invalidate();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-40 flex-1 space-y-2">
          <Label htmlFor="cn2">Nome</Label>
          <Input id="cn2" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-40 space-y-2">
          <Label>Tipo</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "receita" | "despesa")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="despesa">Despesa</SelectItem>
              <SelectItem value="receita">Receita</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-52 space-y-2">
          <Label>Categoria pai</Label>
          <Select value={parent} onValueChange={setParent}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhuma (categoria raiz)</SelectItem>
              {roots
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit"><Plus className="mr-2 h-4 w-4" /> Adicionar</Button>
      </form>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(["despesa", "receita"] as const).map((k) => (
          <div key={k} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold capitalize text-card-foreground">{k}s</h2>
            <ul className="mt-3 space-y-1">
              {roots
                .filter((c) => c.kind === k)
                .map((root) => (
                  <li key={root.id}>
                    <div className="flex items-center gap-2 py-1">
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{root.name}</span>
                      <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => remove(root.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                    <ul className="ml-4 border-l border-border pl-3">
                      {categories
                        .filter((c) => c.parent_id === root.id)
                        .map((sub) => (
                          <li key={sub.id} className="flex items-center gap-2 py-0.5">
                            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                              {sub.name}
                            </span>
                            <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => remove(sub.id)}>
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecurrencesPanel() {
  const { data: recurrences = [] } = useRecurrences();
  const invalidate = useInvalidateFinance();

  async function toggle(id: string, isActive: boolean) {
    await supabase.from("recurring_transactions").update({ is_active: isActive }).eq("id", id);
    invalidate();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("recurring_transactions").delete().eq("id", id);
    if (error) toast.error("Não foi possível excluir");
    else invalidate();
  }

  if (recurrences.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nenhuma recorrência cadastrada. Marque “Repetir” ao criar um lançamento.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {recurrences.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{r.description}</p>
            <p className="text-xs text-muted-foreground">
              {FREQUENCY_LABEL[r.frequency]} · desde {formatDateBR(r.start_date)}
            </p>
          </div>
          <span className="shrink-0 text-sm font-medium text-foreground">{brl(Number(r.amount))}</span>
          <Switch checked={r.is_active} onCheckedChange={(v) => toggle(r.id, v)} />
          <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => remove(r.id)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </li>
      ))}
    </ul>
  );
}