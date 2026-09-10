/**
 * @author MoShangHuaKai
 *
 * Pure quota-radar calculations. The input is already privacy-filtered
 * history, so this module never needs access to tokens or raw API payloads.
 */
import type { QuotaHistoryPoint, QuotaRadarRange, QuotaTrend } from "../types";

const RANGE_MILLISECONDS: Record<QuotaRadarRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const MIN_SAMPLE_COUNT = 3;
const MIN_ANALYSIS_SPAN_MS = 10 * 60 * 1000;
const MIN_REAL_DROP_PERCENT = 1;
const RESET_CORRECTION_PERCENT = 3;

type RadarWindow = "short" | "weekly";

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function percentFor(point: QuotaHistoryPoint, window: RadarWindow): number | null {
  const value = window === "short" ? point.shortRemainingPercent : point.weeklyRemainingPercent;
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

export function getRadarPercent(point: QuotaHistoryPoint, window: RadarWindow): number | null {
  return percentFor(point, window);
}

function pointsForWindow(points: QuotaHistoryPoint[], window: RadarWindow, range: QuotaRadarRange, nowMs: number): QuotaHistoryPoint[] {
  const cutoff = nowMs - RANGE_MILLISECONDS[range];
  return points
    .map((point) => ({ point, timestamp: parseTimestamp(point.capturedAt) }))
    .filter(({ point, timestamp }) => point.status === "ok" && timestamp !== null && timestamp >= cutoff && timestamp <= nowMs && percentFor(point, window) !== null)
    .sort((left, right) => left.timestamp! - right.timestamp!)
    .map(({ point }) => point);
}

function analysisSegment(points: QuotaHistoryPoint[], window: RadarWindow): QuotaHistoryPoint[] {
  let start = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = percentFor(points[index - 1], window);
    const current = percentFor(points[index], window);
    if (previous !== null && current !== null && current - previous >= RESET_CORRECTION_PERCENT) {
      // A reset or server-side correction makes the earlier slope invalid.
      // Start analysis after the latest upward correction instead of blending
      // two different quota windows into one misleading prediction.
      start = index;
    }
  }
  return points.slice(start);
}

function regressionSlopePerHour(points: QuotaHistoryPoint[], window: RadarWindow): number | null {
  if (points.length < 2) return null;
  const firstTimestamp = parseTimestamp(points[0].capturedAt);
  if (firstTimestamp === null) return null;
  const values = points.flatMap((point) => {
    const timestamp = parseTimestamp(point.capturedAt);
    const percent = percentFor(point, window);
    return timestamp === null || percent === null ? [] : [{ x: (timestamp - firstTimestamp) / 3_600_000, y: percent }];
  });
  if (values.length < 2) return null;
  const meanX = values.reduce((sum, value) => sum + value.x, 0) / values.length;
  const meanY = values.reduce((sum, value) => sum + value.y, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (const value of values) {
    numerator += (value.x - meanX) * (value.y - meanY);
    denominator += (value.x - meanX) ** 2;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function emptyTrend(points: QuotaHistoryPoint[]): QuotaTrend {
  return {
    status: "collecting",
    points,
    analysisPoints: points,
    sampleCount: points.length,
    spanMs: 0,
    latestPercent: points.length > 0 ? null : null,
    changePercent: null,
    burnRatePerHour: null,
    estimatedExhaustionAt: null,
    willExhaustBeforeReset: null,
  };
}

/**
 * Calculates a conservative trend from one quota window.
 *
 * Forecasting intentionally requires several points over a meaningful span
 * and a real net decrease. This keeps the UI honest when the app has just
 * started, a quota has reset, or a backend correction moves the value up.
 */
export function calculateQuotaTrend(
  history: QuotaHistoryPoint[],
  window: RadarWindow,
  range: QuotaRadarRange,
  resetAt: string | null = null,
  now = new Date(),
): QuotaTrend {
  const nowMs = now.getTime();
  const points = Number.isFinite(nowMs) ? pointsForWindow(history, window, range, nowMs) : [];
  if (points.length === 0) return emptyTrend(points);

  const latestPercent = percentFor(points[points.length - 1], window);
  const analysisPoints = analysisSegment(points, window);
  const firstAnalysisPercent = percentFor(analysisPoints[0], window);
  const latestAnalysisPercent = percentFor(analysisPoints[analysisPoints.length - 1], window);
  const firstTimestamp = parseTimestamp(analysisPoints[0]?.capturedAt ?? "");
  const latestTimestamp = parseTimestamp(analysisPoints[analysisPoints.length - 1]?.capturedAt ?? "");
  const spanMs = firstTimestamp !== null && latestTimestamp !== null ? Math.max(0, latestTimestamp - firstTimestamp) : 0;
  const changePercent = firstAnalysisPercent !== null && latestAnalysisPercent !== null
    ? latestAnalysisPercent - firstAnalysisPercent
    : null;
  const enoughSamples = analysisPoints.length >= MIN_SAMPLE_COUNT && spanMs >= MIN_ANALYSIS_SPAN_MS;
  if (!enoughSamples || firstAnalysisPercent === null || latestAnalysisPercent === null) {
    return { ...emptyTrend(points), analysisPoints, sampleCount: analysisPoints.length, spanMs, latestPercent, changePercent };
  }

  const slope = regressionSlopePerHour(analysisPoints, window);
  const isRealDecrease = typeof changePercent === "number" && changePercent <= -MIN_REAL_DROP_PERCENT && slope !== null && slope < 0;
  if (!isRealDecrease) {
    return {
      ...emptyTrend(points),
      status: "steady",
      analysisPoints,
      sampleCount: analysisPoints.length,
      spanMs,
      latestPercent,
      changePercent,
    };
  }

  const burnRatePerHour = -slope!;
  const latestPointTime = latestTimestamp ?? nowMs;
  const hoursToExhaustion = latestAnalysisPercent <= 0 ? 0 : latestAnalysisPercent / burnRatePerHour;
  const estimatedExhaustionAt = new Date(latestPointTime + hoursToExhaustion * 3_600_000).toISOString();
  const resetTimestamp = resetAt ? parseTimestamp(resetAt) : null;
  const exhaustionTimestamp = parseTimestamp(estimatedExhaustionAt);
  return {
    status: "decreasing",
    points,
    analysisPoints,
    sampleCount: analysisPoints.length,
    spanMs,
    latestPercent,
    changePercent,
    burnRatePerHour,
    estimatedExhaustionAt,
    willExhaustBeforeReset: resetTimestamp !== null && exhaustionTimestamp !== null
      ? exhaustionTimestamp <= resetTimestamp
      : null,
  };
}

export function formatRadarDuration(milliseconds: number, language: "zh-CN" | "en"): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (language === "en") {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分钟`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}
