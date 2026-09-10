/**
 * @author MoShangHuaKai
 *
 * The radar tests pin down its conservative forecasting contract. They use
 * fixed timestamps so a real clock cannot make an estimate intermittently
 * pass or fail.
 */
import { describe, expect, it } from "vitest";
import { calculateQuotaTrend } from "./quotaRadar";
import type { QuotaHistoryPoint } from "../types";

const NOW = new Date("2026-07-07T12:00:00Z");

function point(minutesAgo: number, short: number | null, weekly = 50): QuotaHistoryPoint {
  return {
    provider: "codex",
    capturedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    status: "ok",
    shortRemainingPercent: short,
    weeklyRemainingPercent: weekly,
  };
}

describe("quota radar trends", () => {
  it("keeps forecasting disabled until the sample count and span are sufficient", () => {
    const trend = calculateQuotaTrend([point(10, 80), point(0, 70)], "short", "24h", "2026-07-07T13:00:00Z", NOW);
    expect(trend.status).toBe("collecting");
    expect(trend.sampleCount).toBe(2);
    expect(trend.estimatedExhaustionAt).toBeNull();
  });

  it("calculates a decreasing burn rate and forecast before reset", () => {
    const trend = calculateQuotaTrend([point(20, 80), point(10, 70), point(0, 60)], "short", "24h", "2026-07-07T13:00:00Z", NOW);
    expect(trend.status).toBe("decreasing");
    expect(trend.burnRatePerHour).toBeCloseTo(60, 5);
    expect(trend.estimatedExhaustionAt).toBe("2026-07-07T13:00:00.000Z");
    expect(trend.willExhaustBeforeReset).toBe(true);
  });

  it("marks a slow trend as lasting through the next reset", () => {
    const trend = calculateQuotaTrend([point(20, 80), point(10, 79), point(0, 78)], "short", "24h", "2026-07-07T12:30:00Z", NOW);
    expect(trend.status).toBe("decreasing");
    expect(trend.willExhaustBeforeReset).toBe(false);
  });

  it("restarts analysis after a substantial upward correction", () => {
    const trend = calculateQuotaTrend([
      point(40, 80),
      point(30, 70),
      point(20, 95),
      point(10, 90),
      point(0, 85),
    ], "short", "24h", "2026-07-07T14:00:00Z", NOW);
    expect(trend.status).toBe("decreasing");
    expect(trend.sampleCount).toBe(3);
    expect(trend.analysisPoints[0].shortRemainingPercent).toBe(95);
    expect(trend.changePercent).toBe(-10);
  });

  it("filters invalid and older-than-30-day points", () => {
    const old = { ...point(0, 99), capturedAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString() };
    const invalid = { ...point(0, 98), capturedAt: "not-a-date" };
    const trend = calculateQuotaTrend([old, invalid, point(20, 80), point(10, 70), point(0, 60)], "short", "30d", null, NOW);
    expect(trend.points).toHaveLength(3);
    expect(trend.latestPercent).toBe(60);
  });
});
