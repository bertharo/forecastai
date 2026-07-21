/**
 * Spend period windows — calendar months when data is monthly grain,
 * rolling day windows when daily or finer.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

export type SpendGrain = "monthly" | "daily";

export type DashboardPeriod = {
  days: number;
  start: Date;
  end: Date;
  /** Inclusive display labels */
  label: string;
  grain: SpendGrain;
};

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows: T[] }).rows ?? []) as T[];
  }
  return [];
}

function formatDayRange(start: Date, endExclusive: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const last = new Date(endExclusive.getTime() - 1);
  return `${fmt.format(start)} – ${fmt.format(last)}`;
}

function formatMonthRange(start: Date, endExclusive: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const last = new Date(endExclusive.getTime() - 1);
  const a = fmt.format(start);
  const b = fmt.format(last);
  return a === b ? a : `${a} – ${b}`;
}

/**
 * Detect whether cost_records look monthly (day-of-month clustered on 1st or last).
 */
export function classifySpendGrainFromDays(daysOfMonth: number[]): SpendGrain {
  if (daysOfMonth.length === 0) return "daily";
  const monthlyish = daysOfMonth.filter((d) => d === 1 || d >= 28).length;
  return monthlyish / daysOfMonth.length >= 0.8 ? "monthly" : "daily";
}

export async function detectSpendGrain(orgId: string): Promise<SpendGrain> {
  const result = await db.execute(sql`
    select extract(day from (charge_period_start at time zone 'UTC'))::int as dom
    from cost_records
    where org_id = ${orgId}::uuid
    limit 500
  `);
  const rows = asRows<{ dom: number }>(result);
  return classifySpendGrainFromDays(rows.map((r) => Number(r.dom)));
}

/** Rolling UTC day window (exclusive end = tomorrow 00:00 UTC). */
export function rollingPeriod(days = 30, now = new Date()): DashboardPeriod {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return {
    days,
    start,
    end,
    label: formatDayRange(start, end),
    grain: "daily",
  };
}

/**
 * Snap to calendar-month boundaries.
 * `days` ≈ 30 → 1 month, 60 → 2 months, etc.
 */
export function calendarMonthPeriod(
  days = 30,
  now = new Date()
): DashboardPeriod {
  const monthCount = Math.max(1, Math.round(days / 30));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthCount - 1), 1)
  );
  return {
    days: monthCount * 30,
    start,
    end,
    label: formatMonthRange(start, end),
    grain: "monthly",
  };
}

export function periodForGrain(
  grain: SpendGrain,
  days = 30,
  now = new Date()
): DashboardPeriod {
  return grain === "monthly"
    ? calendarMonthPeriod(days, now)
    : rollingPeriod(days, now);
}

export async function resolveDashboardPeriod(
  orgId: string,
  days = 30,
  now = new Date()
): Promise<DashboardPeriod> {
  const grain = await detectSpendGrain(orgId);
  return periodForGrain(grain, days, now);
}
