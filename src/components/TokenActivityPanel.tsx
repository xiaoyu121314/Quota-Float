/**
 * @author MoShangHuaKai
 *
 * Renders local Codex Token activity, supplied as daily aggregates by the
 * desktop process. An absent activity payload remains an explicit empty state.
 */
import { useMemo, useState } from "react";
import type { Language, TokenActivity, TokenActivityBucket, TokenActivityView } from "../types";

interface Props {
  activity: TokenActivity | null;
  language: Language;
}

type ActivityPoint = TokenActivityBucket & { date: Date; dateKey: string };
type HeatmapCell = ActivityPoint & { day: number; week: number };

type ActivityCopy = {
  tokenActivityTitle: string;
  tokenActivityDaily: string;
  tokenActivityWeekly: string;
  tokenActivityCumulative: string;
  tokenActivityUnavailable: string;
  tokenActivityNoData: string;
  tokenActivityHover: string;
  tokenActivityUsed: (date: string, count: string) => string;
  tokenActivityTotal: (count: string) => string;
  tokenActivityActiveDays: (count: number) => string;
  tokenActivityPeak: (date: string, count: string) => string;
};

const HEATMAP_DAYS = 365;
const MAX_TOKEN_COUNT = 9_000_000_000;

function formatTokenCount(value: number, language: Language): string {
  const safe = Math.max(0, Math.min(MAX_TOKEN_COUNT, Math.round(value)));
  if (language === "zh-CN") {
    if (safe >= 100_000_000) return `${(safe / 100_000_000).toFixed(1).replace(/\.0$/, "")} 亿`;
    if (safe >= 10_000) return `${(safe / 10_000).toFixed(1).replace(/\.0$/, "")} 万`;
  } else {
    if (safe >= 1_000_000_000) return `${(safe / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
    if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    if (safe >= 1_000) return `${(safe / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return new Intl.NumberFormat(language === "en" ? "en-US" : "zh-CN").format(safe);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDate(date: Date, language: Language): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeActivity(activity: TokenActivity | null): ActivityPoint[] {
  if (!activity) return [];
  const merged = new Map<string, ActivityPoint>();
  for (const item of activity.daily) {
    const timestamp = Date.parse(item.startAt);
    if (!Number.isFinite(timestamp) || !Number.isFinite(item.tokenCount) || item.tokenCount < 0) continue;
    const date = startOfUtcDay(new Date(timestamp));
    const key = dateKey(date);
    const existing = merged.get(key);
    const tokenCount = Math.min(MAX_TOKEN_COUNT, (existing?.tokenCount ?? 0) + Math.round(item.tokenCount));
    merged.set(key, { startAt: date.toISOString(), tokenCount, date, dateKey: key });
  }
  return [...merged.values()].sort((left, right) => left.date.getTime() - right.date.getTime());
}

function activityLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)));
}

function buildHeatmap(points: ActivityPoint[]): { cells: HeatmapCell[]; weeks: number } {
  const end = startOfUtcDay(new Date());
  const rawStart = new Date(end);
  rawStart.setUTCDate(rawStart.getUTCDate() - (HEATMAP_DAYS - 1));
  const start = new Date(rawStart);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const endGrid = new Date(end);
  endGrid.setUTCDate(endGrid.getUTCDate() + (6 - endGrid.getUTCDay()));
  const values = new Map(points.map((point) => [point.dateKey, point.tokenCount]));
  const max = Math.max(0, ...points.map((point) => point.tokenCount));
  const cells: HeatmapCell[] = [];
  for (const date = new Date(start); date <= endGrid; date.setUTCDate(date.getUTCDate() + 1)) {
    const current = new Date(date);
    const key = dateKey(current);
    const value = values.get(key) ?? 0;
    cells.push({
      startAt: current.toISOString(),
      tokenCount: value,
      date: current,
      dateKey: key,
      day: current.getUTCDay(),
      week: Math.floor((current.getTime() - start.getTime()) / (7 * 86_400_000)),
    });
  }
  return { cells, weeks: Math.ceil(cells.length / 7) };
}

function mondayKey(date: Date): string {
  const monday = startOfUtcDay(date);
  const offset = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - offset);
  return dateKey(monday);
}

function TokenTabs({ view, onChange, copy }: { view: TokenActivityView; onChange: (view: TokenActivityView) => void; copy: ActivityCopy }) {
  const tabs: Array<[TokenActivityView, string]> = [["daily", copy.tokenActivityDaily], ["weekly", copy.tokenActivityWeekly], ["cumulative", copy.tokenActivityCumulative]];
  return <div className="token-activity__tabs" role="tablist" aria-label={copy.tokenActivityTitle}>
    {tabs.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={view === value} className={view === value ? "is-active" : undefined} onClick={() => onChange(value)}>{label}</button>)}
  </div>;
}

function DailyHeatmap({ points, language, copy }: { points: ActivityPoint[]; language: Language; copy: ActivityCopy }) {
  const [hovered, setHovered] = useState<ActivityPoint | null>(null);
  const { cells, weeks } = useMemo(() => buildHeatmap(points), [points]);
  const max = Math.max(0, ...points.map((point) => point.tokenCount));
  const monthLabels = cells.filter((cell) => cell.date.getUTCDate() === 1).map((cell) => ({ key: cell.dateKey, label: new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", { month: "short" }).format(cell.date), left: (cell.week / Math.max(1, weeks - 1)) * 100 }));
  return <>
    <div className="token-activity__heatmap-wrap">
      <svg className="token-activity__heatmap" viewBox={`0 0 ${weeks * 4} 28`} role="img" aria-label={copy.tokenActivityTitle} preserveAspectRatio="none">
        {cells.map((cell) => <rect key={cell.dateKey} className={`token-activity__cell token-activity__cell--level-${activityLevel(cell.tokenCount, max)}`} x={cell.week * 4} y={cell.day * 4} width="3" height="3" rx=".8" tabIndex={0} aria-label={copy.tokenActivityUsed(formatDate(cell.date, language), formatTokenCount(cell.tokenCount, language))} onMouseEnter={() => setHovered(cell.tokenCount > 0 ? cell : null)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(cell.tokenCount > 0 ? cell : null)} onBlur={() => setHovered(null)} />)}
      </svg>
    </div>
    <div className="token-activity__months" aria-hidden="true">{monthLabels.map((month) => <span key={month.key} style={{ left: `${month.left}%` }}>{month.label}</span>)}</div>
    <p className="token-activity__tooltip" role="status">{hovered ? copy.tokenActivityUsed(formatDate(hovered.date, language), formatTokenCount(hovered.tokenCount, language)) : copy.tokenActivityHover}</p>
  </>;
}

function WeeklyActivity({ points, language, copy }: { points: ActivityPoint[]; language: Language; copy: ActivityCopy }) {
  const [hovered, setHovered] = useState<{ date: Date; tokenCount: number } | null>(null);
  const weekly = useMemo(() => {
    const grouped = new Map<string, { date: Date; tokenCount: number }>();
    for (const point of points) {
      const key = mondayKey(point.date);
      const date = new Date(`${key}T00:00:00Z`);
      const existing = grouped.get(key);
      grouped.set(key, { date, tokenCount: Math.min(MAX_TOKEN_COUNT, (existing?.tokenCount ?? 0) + point.tokenCount) });
    }
    return [...grouped.values()].sort((left, right) => left.date.getTime() - right.date.getTime()).slice(-52);
  }, [points]);
  const max = Math.max(0, ...weekly.map((item) => item.tokenCount));
  return <>
    <div className="token-activity__weekly-grid" role="list" aria-label={copy.tokenActivityWeekly}>
      {weekly.map((item) => <button key={item.date.toISOString()} type="button" role="listitem" className={`token-activity__cell token-activity__cell--level-${activityLevel(item.tokenCount, max)}`} aria-label={copy.tokenActivityUsed(formatDate(item.date, language), formatTokenCount(item.tokenCount, language))} onMouseEnter={() => setHovered(item.tokenCount > 0 ? item : null)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(item.tokenCount > 0 ? item : null)} onBlur={() => setHovered(null)} />)}
    </div>
    <p className="token-activity__tooltip" role="status">{hovered ? copy.tokenActivityUsed(formatDate(hovered.date, language), formatTokenCount(hovered.tokenCount, language)) : copy.tokenActivityHover}</p>
  </>;
}

export function TokenActivityPanel({ activity, language }: Props) {
  const [view, setView] = useState<TokenActivityView>("daily");
  const copy: ActivityCopy = language === "en" ? {
    tokenActivityTitle: "Token activity",
    tokenActivityDaily: "Daily",
    tokenActivityWeekly: "Weekly",
    tokenActivityCumulative: "Total",
    tokenActivityUnavailable: "No Codex token usage records found",
    tokenActivityNoData: "Local usage totals only; conversation text is not parsed",
    tokenActivityHover: "Hover or focus a cell for details",
    tokenActivityUsed: (date, count) => `${date}: ${count} tokens`,
    tokenActivityTotal: (count) => `${count} tokens total`,
    tokenActivityActiveDays: (count) => `${count} active days`,
    tokenActivityPeak: (date, count) => `Peak ${date} · ${count}`,
  } : {
    tokenActivityTitle: "Token 活动",
    tokenActivityDaily: "每日",
    tokenActivityWeekly: "每周",
    tokenActivityCumulative: "累计",
    tokenActivityUnavailable: "没有找到 Codex Token 用量记录",
    tokenActivityNoData: "仅汇总本地用量，不解析对话正文",
    tokenActivityHover: "悬停或聚焦格子查看详情",
    tokenActivityUsed: (date, count) => `${date} 使用了 ${count} 个 Token`,
    tokenActivityTotal: (count) => `累计 ${count} 个 Token`,
    tokenActivityActiveDays: (count) => `${count} 个活跃日`,
    tokenActivityPeak: (date, count) => `峰值 ${date} · ${count}`,
  };
  const points = useMemo(() => normalizeActivity(activity), [activity]);
  const total = activity?.totalTokens ?? points.reduce((sum, point) => Math.min(MAX_TOKEN_COUNT, sum + point.tokenCount), 0);
  const peak = points.reduce<ActivityPoint | null>((highest, point) => !highest || point.tokenCount > highest.tokenCount ? point : highest, null);
  const activeViewLabel = view === "daily" ? copy.tokenActivityDaily : view === "weekly" ? copy.tokenActivityWeekly : copy.tokenActivityCumulative;
  return <section className="token-activity" aria-label={copy.tokenActivityTitle}>
    <header className="token-activity__header">
      <h3>{copy.tokenActivityTitle}</h3>
      <TokenTabs view={view} onChange={setView} copy={copy} />
    </header>
    {activity && points.length > 0 ? <>
      {view === "daily" ? <DailyHeatmap points={points} language={language} copy={copy} /> : null}
      {view === "weekly" ? <WeeklyActivity points={points} language={language} copy={copy} /> : null}
      {view === "cumulative" ? <div className="token-activity__total"><strong>{formatTokenCount(total, language)}</strong><span>{copy.tokenActivityTotal(formatTokenCount(total, language))}</span><small>{copy.tokenActivityActiveDays(points.filter((point) => point.tokenCount > 0).length)}{peak ? ` · ${copy.tokenActivityPeak(formatDate(peak.date, language), formatTokenCount(peak.tokenCount, language))}` : ""}</small></div> : null}
    </> : <div className="token-activity__empty"><strong>{copy.tokenActivityUnavailable}</strong><span>{copy.tokenActivityNoData} · {activeViewLabel}</span></div>}
  </section>;
}
