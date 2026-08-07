import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInvalidateFinance } from "@/lib/queries";

export function Onboarding({ defaultName }: { defaultName?: string | undefined }) {
  const [familyName, setFamilyName] = useState("");
  const [ownerName, setOwnerName] = useState(defaultName ?? "");
  const [loading, setLoading] = useState(false);
  const invalidate = useInvalidateFinance();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.rpc("bootstrap_family", {
      family_name: familyName,
      owner_name: ownerName || "Titular",
    });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível criar a família", { description: error.message });
      return;
    }
    toast.success("Família criada com o plano de contas padrão");
    invalidate();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6"
      >
        <div>
          <h1 className="text-xl font-semibold text-card-foreground">
            Vamos criar sua família
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Criaremos também o plano de contas padrão em português.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="family">Nome da família</Label>
          <Input
            id="family"
            required
            placeholder="Família Linhares"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="owner">Seu nome</Label>
          <Input
            id="owner"
            required
            placeholder="Wagner"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          Começar
        </Button>
      </form>
    </main>
  );
}