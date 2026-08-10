import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Moon, Pencil, Plus, Sun, Trash2, X } from "lucide-react";
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
import { useTheme } from "@/components/theme-provider";
import {
  useCategories,
  useInvalidateFinance,
  useMembers,
  useProfile,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Finanças da Família" },
      { name: "description", content: "Família, membros, categorias e aparência do sistema." },
      { property: "og:title", content: "Configurações — Finanças da Família" },
      { property: "og:description", content: "Família, membros, categorias e aparência do sistema." },
    ],
  }),
  component: Configuracoes,
});

function Configuracoes() {
  return (
    <div>
      <PageHeader title="Configurações" subtitle="Família, membros, categorias e aparência" />
      <Tabs defaultValue="familia">
        <TabsList>
          <TabsTrigger value="familia">Família</TabsTrigger>
          <TabsTrigger value="membros">Membros</TabsTrigger>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="aparencia">Aparência</TabsTrigger>
        </TabsList>
        <TabsContent value="familia" className="mt-4"><FamilyPanel /></TabsContent>
        <TabsContent value="membros" className="mt-4"><MembersPanel /></TabsContent>
        <TabsContent value="categorias" className="mt-4"><CategoriesPanel /></TabsContent>
        <TabsContent value="aparencia" className="mt-4"><ThemePanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function ThemePanel() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "dark" as const, label: "Azul-noite (escuro)", icon: Moon },
    { value: "light" as const, label: "Claro", icon: Sun },
  ];
  return (
    <div className="max-w-md space-y-3 rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-medium text-card-foreground">Tema do sistema</p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setTheme(o.value)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-sm transition-colors ${
              theme === o.value
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            <o.icon className="h-4 w-4" />
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        A preferência fica salva neste navegador.
      </p>
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");

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

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    const { error } = await supabase
      .from("family_members")
      .update({ name: editName.trim(), role: editRole.trim() || null })
      .eq("id", id);
    if (error) toast.error("Não foi possível salvar");
    else {
      setEditingId(null);
      invalidate();
      toast.success("Membro atualizado");
    }
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
            {editingId === m.id ? (
              <>
                <Input
                  className="min-w-0 flex-1"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <Input
                  className="w-36"
                  placeholder="Papel"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                />
                <Button variant="ghost" size="icon" aria-label="Salvar" onClick={() => saveEdit(m.id)}>
                  <Check className="h-4 w-4 text-success" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Cancelar" onClick={() => setEditingId(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.role ?? "Membro"}</p>
                </div>
                <Switch checked={m.is_active} onCheckedChange={(v) => toggle(m.id, v)} />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Editar"
                  onClick={() => {
                    setEditingId(m.id);
                    setEditName(m.name);
                    setEditRole(m.role ?? "");
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => remove(m.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </>
            )}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

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

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    const { error } = await supabase
      .from("categories")
      .update({ name: editName.trim() })
      .eq("id", id);
    if (error) toast.error("Não foi possível renomear");
    else {
      setEditingId(null);
      invalidate();
      toast.success("Categoria atualizada");
    }
  }

  const renderRow = (id: string, label: string, muted?: boolean) => {
    if (editingId === id) {
      return (
        <div className="flex items-center gap-2 py-1">
          <Input
            className="h-8 min-w-0 flex-1"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          <Button variant="ghost" size="icon" aria-label="Salvar" onClick={() => saveEdit(id)}>
            <Check className="h-3.5 w-3.5 text-success" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Cancelar" onClick={() => setEditingId(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 py-1">
        <span
          className={`min-w-0 flex-1 truncate text-sm ${muted ? "text-muted-foreground" : "text-foreground"}`}
        >
          {label}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Editar"
          onClick={() => {
            setEditingId(id);
            setEditName(label);
          }}
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => remove(id)}>
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>
    );
  };

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
                    {renderRow(root.id, root.name)}
                    <ul className="ml-4 border-l border-border pl-3">
                      {categories
                        .filter((c) => c.parent_id === root.id)
                        .map((sub) => (
                          <li key={sub.id}>{renderRow(sub.id, sub.name, true)}</li>
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
