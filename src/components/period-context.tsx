import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type PeriodValue = {
  month: number;
  year: number;
  setMonth: (m: number) => void;
  setYear: (y: number) => void;
  shift: (delta: number) => void;
};

const PeriodContext = createContext<PeriodValue | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const value = useMemo<PeriodValue>(
    () => ({
      month,
      year,
      setMonth,
      setYear,
      shift: (delta: number) => {
        const d = new Date(year, month - 1 + delta, 1);
        setMonth(d.getMonth() + 1);
        setYear(d.getFullYear());
      },
    }),
    [month, year],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error("usePeriod deve ser usado dentro de PeriodProvider");
  return ctx;
}