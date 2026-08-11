import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatAmountInput, parseAmountInput } from "@/lib/format";

type Props = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> & {
  /** Valor numérico em reais. */
  value: number;
  onValueChange: (value: number) => void;
};

/**
 * Campo de moeda pt-BR: digitação por centavos, exibindo sempre 1.234,56.
 * Evita o bug de "100,50" virar 10.050,00 ao reeditar um valor salvo.
 */
export function CurrencyInput({ value, onValueChange, ...rest }: Props) {
  const [text, setText] = useState(() => (value ? formatAmountInput(value) : ""));

  useEffect(() => {
    const current = parseAmountInput(text);
    if (Math.abs(current - (value || 0)) > 0.004) {
      setText(value ? formatAmountInput(value) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      {...rest}
      inputMode="numeric"
      value={text}
      placeholder={rest.placeholder ?? "0,00"}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 13);
        const next = digits ? Number(digits) / 100 : 0;
        setText(digits ? formatAmountInput(next) : "");
        onValueChange(next);
      }}
    />
  );
}