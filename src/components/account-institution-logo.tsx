import { BankLogo, BANK_SUGGESTIONS } from "@/components/card-brand-logo";

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Apenas para contas; o catalogo compartilhado de cartoes continua intacto.
export const ACCOUNT_INSTITUTION_SUGGESTIONS = [
  ...BANK_SUGGESTIONS,
  "Ticket",
  "Espécie/Cash",
  "Gift Card",
];

const specialIcons: Record<string, { src: string; label: string }> = {
  ticket: { src: "/account-institutions/ticket.webp", label: "Ticket" },
  especiecash: { src: "/account-institutions/cash.webp", label: "Espécie/Cash" },
  especie: { src: "/account-institutions/cash.webp", label: "Espécie/Cash" },
  cash: { src: "/account-institutions/cash.webp", label: "Espécie/Cash" },
  dinheiro: { src: "/account-institutions/cash.webp", label: "Espécie/Cash" },
  giftcard: { src: "/account-institutions/gift-card.webp", label: "Gift Card" },
  gitfcard: { src: "/account-institutions/gift-card.webp", label: "Gift Card" },
};

export function isSpecialAccountInstitution(institution: string): boolean {
  return Boolean(specialIcons[normalize(institution)]);
}

export function AccountInstitutionLogo({
  institution,
  className = "h-12 w-12",
}: {
  institution: string;
  className?: string;
}) {
  const special = specialIcons[normalize(institution)];
  if (!special) {
    return <BankLogo issuer={institution || "Outra"} className={className} />;
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/10 ${className}`}
      title={special.label}
    >
      <img
        src={special.src}
        alt={special.label}
        loading="lazy"
        className={`h-full w-full ${special.src.endsWith("cash.webp") ? "object-cover" : "object-contain"}`}
      />
    </span>
  );
}
