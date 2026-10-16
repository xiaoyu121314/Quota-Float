/**
 * @author MoShangHuaKai
 *
 * Compact, inline trend view for the expanded quota card. It intentionally
 * uses SVG instead of a chart dependency so the widget stays lightweight and
 * the visual remains available in the browser design preview.
 */
import { Minus, Trash, TrendDown, TrendUp } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { clampPercent, formatDateTime, formatResetTime } from "../lib/format";
import { calculateQuotaTrend, formatRadarDuration, getRadarPercent } from "../lib/quotaRadar";
import { copy, normalizeLanguage } from "../lib/i18n";
import type { Language, ProviderSnapshot, QuotaHistoryPoint, QuotaRadarRange, QuotaTrend } from "../types";
import { TokenActivityPanel } from "./TokenActivityPanel";

type RadarCopy = {
  radarTitle: string;
  radarClearHistory: string;
  radarClearConfirm: string;
  radarCleared: string;
  radarClearFailed: string;
  radarClearCancel: string;
  radarClearNow: string;
  radarShortWindow: string;
  radarWeeklyWindow: string;
  radarCurrentShort: string;
  radarCurrentWeekly: string;
  radarCurrentUnavailable: string;
  radarRange24h: string;
  radarRange7d: string;
  radarRange30d: string;
  radarNoData: string;
  radarCollecting: (count: number) => string;
  radarStable: string;
  radarBurnRate: (rate: number) => string;
  radarForecast: (duration: string) => string;
  radarCanReachReset: string;
  radarChange: (delta: number) => string;
};

interface Props {
  snapshot: ProviderSnapshot;
  history: QuotaHistoryPoint[];
  language: Language;
  onClearHistory?: () => Promise<void>;
}

const RANGE_OPTIONS: Array<{ value: QuotaRadarRange; labelKey: "radarRange24h" | "radarRange7d" | "radarRange30d" }> = [
  { value: "24h", labelKey: "radarRange24h" },
  { value: "7d", labelKey: "radarRange7d" },
  { value: "30d", labelKey: "radarRange30d" },
];

function displayPercent(value: number | null): string {
  return value === null ? "--" : `${Math.round(value)}%`;
}

function displayDelta(value: number | null, t: RadarCopy): string {
  if (value === null) return t.radarNoData;
  return t.radarChange(Math.round(value));
}

function summaryFor(trend: QuotaTrend, language: Language, t: RadarCopy): string {
  if (trend.points.length === 0) return t.radarNoData;
  if (trend.status === "collecting") return t.radarCollecting(trend.sampleCount);
  if (trend.status === "decreasing" && trend.estimatedExhaustionAt) {
    if (trend.willExhaustBeforeReset === false) return t.radarCanReachReset;
    const remaining = Date.parse(trend.estimatedExhaustionAt) - Date.now();
    return t.radarForecast(formatRadarDuration(remaining, language));
  }
  return t.radarStable;
}

function CurrentQuotaSummary({ snapshot, language, t }: { snapshot: ProviderSnapshot; language: Language; t: RadarCopy }) {
  const short = snapshot.shortWindow ? clampPercent(snapshot.shortWindow.remainingPercent) : null;
  const weekly = snapshot.weeklyWindow ? clampPercent(snapshot.weeklyWindow.remainingPercent) : null;
  const displayPercent = short ?? weekly;
  const displayWindow = snapshot.shortWindow ?? snapshot.weeklyWindow;
  const displayingWeeklyAsPrimary = short === null && weekly !== null;
  const label = displayingWeeklyAsPrimary ? t.radarCurrentWeekly : t.radarCurrentShort;
  return <section className="quota-radar__current" aria-label={label}>
    <div className="quota-radar__current-head">
      <span>{label}</span>
      <strong>{displayPercent === null ? "--" : displayPercent}<small>{displayPercent === null ? "" : "%"}</small></strong>
    </div>
    {displayPercent !== null ? <div className="quota-radar__current-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayPercent}><span style={{ width: `${displayPercent}%` }} /></div> : <p className="quota-radar__current-empty">{t.radarCurrentUnavailable}</p>}
    <p className="quota-radar__current-reset">{formatResetTime(displayWindow?.resetsAt ?? null, new Date(), language)}{displayWindow?.resetsAt ? ` · ${formatDateTime(displayWindow.resetsAt, language)}` : ""}</p>
  </section>;
}

function Sparkline({ points, window, label, className }: { points: QuotaHistoryPoint[]; window: "short" | "weekly"; label: string; className: string }) {
  const values = points.flatMap((point) => {
    const timestamp = Date.parse(point.capturedAt);
    const percent = getRadarPercent(point, window);
    return Number.isFinite(timestamp) && percent !== null ? [{ percent }] : [];
  });
  if (values.length === 0) return <div className={`quota-radar__sparkline quota-radar__sparkline--empty ${className}`} aria-label={label} role="img" />;
  const width = 240;
  const height = 34;
  const xStep = values.length > 1 ? width / (values.length - 1) : width;
  const path = values.map(({ percent }, index) => {
    const x = index * xStep;
    const y = height - (percent / 100) * (height - 4) - 2;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  const last = values[values.length - 1];
  const lastX = (values.length - 1) * xStep;
  const lastY = height - (last.percent / 100) * (height - 4) - 2;
  return (
    <svg className={`quota-radar__sparkline ${className}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
      <path d={path} vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="2.5" />
    </svg>
  );
}

function TrendMetric({ title, trend, window, language, t, secondary = false }: { title: string; trend: QuotaTrend; window: "short" | "weekly"; language: Language; t: RadarCopy; secondary?: boolean }) {
  const statusIcon = trend.status === "decreasing" ? <TrendDown weight="bold" /> : trend.status === "steady" ? <Minus weight="bold" /> : <TrendUp weight="bold" />;
  const status = trend.status === "decreasing" && trend.burnRatePerHour !== null
    ? t.radarBurnRate(Number(trend.burnRatePerHour.toFixed(1)))
    : summaryFor(trend, language, t);
  return (
    <article className={`quota-radar__metric${secondary ? " quota-radar__metric--weekly" : " quota-radar__metric--primary"}`}>
      <header>
        <span>{title}</span>
        <strong>{displayPercent(trend.latestPercent)}</strong>
        <small>{displayDelta(trend.changePercent, t)}</small>
      </header>
      <Sparkline points={trend.points} window={window} label={`${title} ${displayPercent(trend.latestPercent)}`} className="quota-radar__sparkline-line" />
      <p><i aria-hidden="true">{statusIcon}</i>{status}</p>
    </article>
  );
}

export function QuotaRadarPanel({ snapshot, history, language: requestedLanguage, onClearHistory }: Props) {
  const language = normalizeLanguage(requestedLanguage);
  const [range, setRange] = useState<QuotaRadarRange>("24h");
  const [clearing, setClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState("");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const clearConfirmRef = useRef<HTMLDivElement>(null);
  const t = copy[language];
  const shortTrend = calculateQuotaTrend(history.filter((point) => point.provider === snapshot.provider), "short", range, snapshot.shortWindow?.resetsAt ?? null);
  const weeklyTrend = calculateQuotaTrend(history.filter((point) => point.provider === snapshot.provider), "weekly", range, snapshot.weeklyWindow?.resetsAt ?? null);

  useEffect(() => {
    if (!confirmingClear) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !clearConfirmRef.current?.contains(event.target)) setConfirmingClear(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [confirmingClear]);

  const requestClearHistory = () => {
    if (!onClearHistory || history.length === 0 || clearing) return;
    setClearMessage("");
    setConfirmingClear(true);
  };

  const clearHistory = async () => {
    if (!onClearHistory || history.length === 0 || clearing) return;
    setClearing(true);
    setClearMessage("");
    try {
      await onClearHistory();
      setClearMessage(t.radarCleared);
      setConfirmingClear(false);
    } catch {
      setClearMessage(t.radarClearFailed);
      setConfirmingClear(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="quota-radar" aria-label={t.radarTitle} onMouseDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <header className="quota-radar__header">
        <div>
          <p className="quota-radar__eyebrow">{t.radarTitle}</p>
          <strong>{snapshot.displayName}</strong>
        </div>
        <div className="quota-radar__clear-wrap" ref={clearConfirmRef}>
          <button type="button" className="quota-radar__clear" onClick={requestClearHistory} disabled={clearing || history.length === 0} aria-label={t.radarClearHistory} title={t.radarClearHistory}>
            <Trash />
          </button>
          {confirmingClear ? <div className="quota-radar__clear-confirm" role="alertdialog" aria-label={t.radarClearConfirm} onMouseDown={(event) => event.stopPropagation()}>
            <p>{t.radarClearConfirm}</p>
            <div>
              <button type="button" onClick={() => setConfirmingClear(false)}>{t.radarClearCancel}</button>
              <button type="button" className="is-danger" onClick={() => void clearHistory()} disabled={clearing}>{t.radarClearNow}</button>
            </div>
          </div> : null}
        </div>
      </header>
      <CurrentQuotaSummary snapshot={snapshot} language={language} t={t} />
      <div className="quota-radar__scroll" tabIndex={0} aria-label={t.radarTitle}>
        <div className="quota-radar__ranges" role="tablist" aria-label={t.radarTitle}>
          {RANGE_OPTIONS.map((option) => (
            <button key={option.value} type="button" role="tab" aria-selected={range === option.value} className={range === option.value ? "is-active" : undefined} onClick={() => setRange(option.value)}>
              {t[option.labelKey]}
            </button>
          ))}
        </div>
        <div className="quota-radar__metrics">
          <TrendMetric title={t.radarShortWindow} trend={shortTrend} window="short" language={language} t={t} />
          <TrendMetric title={t.radarWeeklyWindow} trend={weeklyTrend} window="weekly" language={language} t={t} secondary />
        </div>
        <p className="quota-radar__summary" role="status">{summaryFor(snapshot.shortWindow ? shortTrend : weeklyTrend, language, t)}</p>
        <TokenActivityPanel activity={snapshot.tokenActivity} language={language} />
        {clearMessage ? <p className="quota-radar__message" role="status">{clearMessage}</p> : null}
      </div>
    </section>
  );
}
