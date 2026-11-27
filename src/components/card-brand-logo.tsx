import { useState } from "react";

// Imagens carregadas sob demanda dos acervos públicos indicados pelo usuário.
// Sem cópia ou redistribuição dos SVGs; fallback textual quando indisponíveis.
const base = "https://raw.githubusercontent.com/Tgentil/Bancos-em-SVG/main/";
const source = (path: string) => base + path.split("/").map(encodeURIComponent).join("/");

export const BANK_SUGGESTIONS = [
  "Itaú", "Banco do Brasil", "Sicredi", "Mercado Pago", "Nubank", "Bradesco",
  "Santander", "Banco Inter", "Caixa", "PicPay", "C6 Bank", "Banco Pan", "Sicoob",
];
export const BRAND_SUGGESTIONS = ["Visa", "Mastercard", "Elo", "American Express", "Hipercard", "Diners Club", "Outra"];

const bankIcons: Record<string, string> = {
  itau: source("Itaú Unibanco S.A/itau-fundo-azul.svg"),
  bancodobrasil: source("Banco do Brasil S.A/banco-do-brasil-sem-fundo.svg"),
  bb: source("Banco do Brasil S.A/banco-do-brasil-sem-fundo.svg"),
  sicredi: source("Sicredi/logo-svg2.svg"),
  mercadopago: source("Mercado Pago/mercado-pago.svg"),
  nubank: source("Nu Pagamentos S.A/nubank-logo-2021.svg"),
  bradesco: source("Bradesco S.A/bradesco.svg"),
  santander: source("Banco Santander Brasil S.A/banco-santander-logo.svg"),
  bancointer: source("Banco Inter S.A/inter.svg"),
  inter: source("Banco Inter S.A/inter.svg"),
  caixa: source("Caixa Econômica Federal/caixa-economica-federal-X.svg"),
};
const paymentBase = "https://raw.githubusercontent.com/wallynm/payment-icon-svg/master/icons/";
const brandIcons: Record<string,string> = {
 visa: "visa.svg", mastercard: "mastercard.svg", elo: "elo.svg", americanexpress: "amex.svg",
 hipercard: "hipercard.svg", dinersclub: "diners.svg",
};
const normalize = (input: string) => input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function issuerForDisplay(institution: string | null, name: string) {
  if (institution?.trim()) return institution.trim();
  const plain = normalize(name);
  // Compatibilidade apenas visual para cadastros antigos: não altera o banco de dados.
  return BANK_SUGGESTIONS.find((bank) => plain.startsWith(normalize(bank))) ?? null;
}

function Mark({ name, src, className = "" }: { name: string; src?: string | undefined; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span title={name} className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted text-xs font-bold text-foreground ${className}`}>
      {src && !failed ? (
        <img src={src} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain p-1" />
      ) : <span aria-label={name}>{name.trim().slice(0, 2).toUpperCase()}</span>}
    </span>
  );
}
export function BankLogo({ issuer, className = "h-11 w-11" }: { issuer: string; className?: string }) {
  return <Mark key={normalize(issuer)} name={issuer} src={bankIcons[normalize(issuer)]} className={className} />;
}
export function BrandLogo({ brand, className = "h-7 w-12" }: { brand: string | null; className?: string }) {
  if (!brand) return null;
  const path = brandIcons[normalize(brand)];
  return <Mark key={normalize(brand)} name={brand} src={path ? paymentBase + path : undefined} className={className} />;
}
