import { describe, expect, it } from "vitest";
import {
  calendarMonthPeriod,
  classifySpendGrainFromDays,
  periodForGrain,
  rollingPeriod,
} from "./period";

describe("classifySpendGrainFromDays", () => {
  it("detects monthly when days cluster on 1st/last", () => {
    expect(classifySpendGrainFromDays([1, 1, 1, 31, 1])).toBe("monthly");
  });

  it("detects daily when mid-month days dominate", () => {
    expect(classifySpendGrainFromDays([3, 7, 12, 18, 22])).toBe("daily");
  });
});

describe("periodForGrain", () => {
  it("uses rolling day labels for daily grain", () => {
    const now = new Date(Date.UTC(2026, 6, 21)); // Jul 21
    const p = periodForGrain("daily", 30, now);
    expect(p.grain).toBe("daily");
    expect(p.label).toMatch(/Jun/);
    expect(p.label).toMatch(/Jul/);
    expect(p.start.getUTCDate()).toBe(22); // Jun 22
    expect(p.start.getUTCMonth()).toBe(5);
  });

  it("snaps monthly grain to calendar month boundaries", () => {
    const now = new Date(Date.UTC(2026, 6, 21)); // Jul 21
    const p = periodForGrain("monthly", 30, now);
    expect(p.grain).toBe("monthly");
    expect(p.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(p.label).toBe("Jul 2026");
  });

  it("covers multiple months when days≈60", () => {
    const now = new Date(Date.UTC(2026, 6, 21));
    const p = calendarMonthPeriod(60, now);
    expect(p.start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(p.label).toBe("Jun 2026 – Jul 2026");
  });
});

describe("rollingPeriod", () => {
  it("matches exclusive-end trailing window", () => {
    const now = new Date(Date.UTC(2026, 6, 21));
    const p = rollingPeriod(30, now);
    expect(p.end.toISOString()).toBe("2026-07-22T00:00:00.000Z");
    expect(p.start.toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });
});
