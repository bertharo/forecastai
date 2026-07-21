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

/** Below this, a day's total looks like sync/demo noise rather than real activity. */
const MEANINGFUL_DAILY_SPEND_USD = 1;

/**
 * Most recent day with non-trivial total spend for this org, or null with no
 * such day. Deliberately not just MAX(charge_period_start): background
 * connectors (e.g. a daily demo-mode sync) can keep writing fractions of a
 * cent right up to "today" even when real, meaningful spend stopped weeks
 * ago — trusting the single latest row would anchor right back to a period
 * with nothing real in it.
 */
export async function getMostRecentSpendDate(orgId: string): Promise<Date | null> {
  const result = await db.execute(sql`
    select max(day) as max_day
    from (
      select (charge_period_start at time zone 'UTC')::date as day,
        sum(effective_cost) as daily_spend
      from cost_records
      where org_id = ${orgId}::uuid
      group by 1
    ) daily
    where daily_spend >= ${MEANINGFUL_DAILY_SPEND_USD}
  `);
  const rows = asRows<{ max_day: string | null }>(result);
  const raw = rows[0]?.max_day;
  return raw ? new Date(raw) : null;
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

/**
 * Resolves the dashboard window for this org, anchored at "now" when spend
 * is current, or at the most recent real spend date when it isn't — e.g. an
 * uploaded export whose last row is weeks or months old shouldn't read as
 * "no spend" just because the app's clock has moved past it.
 */
export async function resolveDashboardPeriod(
  orgId: string,
  days = 30,
  now = new Date()
): Promise<DashboardPeriod> {
  const [grain, mostRecent] = await Promise.all([
    detectSpendGrain(orgId),
    getMostRecentSpendDate(orgId),
  ]);
  const anchor = mostRecent && mostRecent.getTime() < now.getTime() ? mostRecent : now;
  return periodForGrain(grain, days, anchor);
}
