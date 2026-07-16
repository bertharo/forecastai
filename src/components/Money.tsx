import { usd } from "@/lib/format";

export function Money({
  value,
  compact,
  digits,
  className,
}: {
  value: number;
  compact?: boolean;
  digits?: number;
  className?: string;
}) {
  return (
    <span className={`mono ${className ?? ""}`}>{usd(value, { compact, digits })}</span>
  );
}
