export function usd(n: number, opts?: { compact?: boolean; digits?: number }): string {
  if (opts?.compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts?.digits ?? 0,
  }).format(n);
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

/** Cost per million tokens: cost / tokens × 1e6. Null when tokens are missing/zero. */
export function costPerMillionTokens(cost: number, tokens: number): number | null {
  if (!Number.isFinite(cost) || !Number.isFinite(tokens) || tokens <= 0) return null;
  return (cost / tokens) * 1_000_000;
}

/** Display "$x.xx" or em dash when tokens are unavailable. */
export function formatCostPerMTokens(cost: number, tokens: number): string {
  const v = costPerMillionTokens(cost, tokens);
  if (v == null) return "—";
  return usd(v, { digits: 2 });
}
