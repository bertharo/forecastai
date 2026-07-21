import { db } from "@/db";
import * as s from "@/db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export type DailySpendPoint = { day: string; spend: number };

const MAX_HISTORY_DAYS = 180;

/**
 * Anchors on the last real cost_records date (not "today") — real/demo data
 * often ends before the app's current date, which is why period-anchored
 * pages break on this kind of data. Returns null for an org with no spend.
 */
export async function getSpendAnchorAndDaily(
  orgId: string,
  opts?: { providerKey?: string | null; focusSkuId?: string | null }
): Promise<{ anchor: Date; daily: DailySpendPoint[] } | null> {
  const [anchorRow] = await db
    .select({ max: sql<string | null>`max(${s.costRecords.chargePeriodStart})` })
    .from(s.costRecords)
    .where(eq(s.costRecords.orgId, orgId));

  const anchorRaw = anchorRow?.max;
  if (!anchorRaw) return null;
  const anchor = new Date(anchorRaw);

  const historyStart = new Date(anchor);
  historyStart.setUTCDate(historyStart.getUTCDate() - MAX_HISTORY_DAYS);

  const providerFilter = opts?.providerKey
    ? sql`exists (
        select 1 from providers p
        where p.id = ${s.costRecords.providerId} and p.key = ${opts.providerKey}
      )`
    : sql`true`;
  const modelFilter = opts?.focusSkuId
    ? eq(s.costRecords.focusSkuId, opts.focusSkuId)
    : sql`true`;

  const rows = await db
    .select({
      day: sql<string>`(${s.costRecords.chargePeriodStart})::date`,
      spend: sql<string>`coalesce(sum(${s.costRecords.effectiveCost}), 0)`,
    })
    .from(s.costRecords)
    .where(
      and(
        eq(s.costRecords.orgId, orgId),
        gte(s.costRecords.chargePeriodStart, historyStart),
        lte(s.costRecords.chargePeriodStart, anchor),
        providerFilter,
        modelFilter
      )
    )
    .groupBy(sql`(${s.costRecords.chargePeriodStart})::date`)
    .orderBy(sql`(${s.costRecords.chargePeriodStart})::date`);

  return {
    anchor,
    daily: rows.map((r) => ({ day: String(r.day), spend: Number(r.spend) })),
  };
}

/** Fills gaps between the first data day and the anchor with zero-spend days. */
function densify(daily: DailySpendPoint[], anchor: Date): DailySpendPoint[] {
  if (daily.length === 0) return [];
  const byDay = new Map(daily.map((d) => [d.day, d.spend]));
  const first = new Date(daily[0].day + "T00:00:00Z");
  const out: DailySpendPoint[] = [];
  for (let d = new Date(first); d <= anchor; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, spend: byDay.get(key) ?? 0 });
  }
  return out;
}

export function fitLinearTrend(series: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
} {
  const n = series.length;
  if (n < 2) {
    const mean = n === 1 ? series[0].y : 0;
    return { slope: 0, intercept: mean };
  }
  const sumX = series.reduce((a, p) => a + p.x, 0);
  const sumY = series.reduce((a, p) => a + p.y, 0);
  const sumXY = series.reduce((a, p) => a + p.x * p.y, 0);
  const sumXX = series.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export type ForecastPoint = { day: string; p10: number; p50: number; p90: number };

/**
 * Simple historical-trend extrapolation: OLS fit on daily spend, projected
 * forward from the anchor, with a CV-based P10/P90 band — same band formula
 * computeBudgetStatus already uses (src/lib/budgets/status.ts).
 */
export function projectSpendTrend(opts: {
  daily: DailySpendPoint[];
  anchor: Date;
  horizonDays: number;
}): ForecastPoint[] {
  const dense = densify(opts.daily, opts.anchor);
  if (dense.length === 0) return [];

  const series = dense.map((d, i) => ({ x: i, y: d.spend }));
  const { slope, intercept } = fitLinearTrend(series);

  const values = dense.map((d) => d.spend);
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1)
      : (mean * 0.15) ** 2;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0.15;
  const band = Math.min(0.45, Math.max(0.08, cv * 1.28));

  const startIndex = dense.length; // day after the last historical point
  const points: ForecastPoint[] = [];
  for (let i = 0; i < opts.horizonDays; i++) {
    const day = new Date(opts.anchor);
    day.setUTCDate(day.getUTCDate() + i + 1);
    const p50 = Math.max(0, intercept + slope * (startIndex + i));
    points.push({
      day: day.toISOString().slice(0, 10),
      p10: Math.max(0, p50 * (1 - band)),
      p50,
      p90: p50 * (1 + band),
    });
  }
  return points;
}

/** Monthly totals from a daily series — used for the real-data "history" table. */
export function monthlyTotals(daily: DailySpendPoint[]): { month: string; spend: number }[] {
  const byMonth = new Map<string, number>();
  for (const d of daily) {
    const month = d.day.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + d.spend);
  }
  return [...byMonth.entries()]
    .map(([month, spend]) => ({ month, spend }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
