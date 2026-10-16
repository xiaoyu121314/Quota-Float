import { ArrowClockwise, ArrowDown, ArrowUp, ArrowsInSimple, ArrowsOutSimple, ChartLineUp, ClockCounterClockwise, CloudSlash, Info, PushPin, PushPinSlash, SignIn, WarningCircle } from "@phosphor-icons/react";
import { memo, type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { clampPercent, formatDateTime, formatResetDateTime, formatResetTime, quotaTier } from "../lib/format";
import { copy, normalizeLanguage } from "../lib/i18n";
import type { Language, ProviderSnapshot, QuotaHistoryPoint, WidgetPreferences, WidgetTheme } from "../types";
import { ProviderMark } from "./ProviderMark";
import { QuotaRadarPanel } from "./QuotaRadarPanel";

interface Props {
  snapshot: ProviderSnapshot;
  preferences: WidgetPreferences;
  providerCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onLock: () => void;
  onToggleStayExpanded: () => void;
  onDrag: () => void;
  onHover: (hovered: boolean) => void;
  onRefresh?: () => void;
  isConsuming?: boolean;
  notice?: ReactNode;
  initialShowCreditTip?: boolean;
  history?: QuotaHistoryPoint[];
  showRadar?: boolean;
  onToggleRadar?: () => void;
  onClearHistory?: () => Promise<void>;
  theme?: WidgetTheme;
  customBackground?: boolean;
  liquidGlassEnabled?: boolean;
  style?: CSSProperties;
  onContextMenu?: (event: React.MouseEvent) => void;
}

function StatusIcon({ status, expired = false }: { status: ProviderSnapshot["status"]; expired?: boolean }) {
  if (status === "signed_out") return <SignIn weight="duotone" />;
  if (status === "stale" || expired) return <ClockCounterClockwise weight="duotone" />;
  if (status === "unavailable") return <CloudSlash weight="duotone" />;
  return <WarningCircle weight="duotone" />;
}

function localizedBackendMessage(message: string | null, language: Language): string | null {
  if (!message) return null;
  if (language === "en") return message;
  const normalized = message.toLowerCase();
  if (normalized.includes("sign in") || normalized.includes("login")) return "Codex 登录已失效，请重新登录。";
  if (normalized.includes("rate limited")) return "请求过于频繁，将稍后自动重试。";
  if (normalized.includes("network")) return "网络不可用，将自动重试。";
  if (normalized.includes("format")) return "额度响应格式已变化。";
  if (normalized.includes("missing the 5h")) return "额度响应缺少 5 小时窗口。";
  if (normalized.includes("refresh is already running")) return "额度正在刷新，请稍候。";
  return message;
}

export const QuotaCard = memo(function QuotaCard({
  snapshot,
  preferences,
  providerCount,
  onPrevious,
  onNext,
  onLock,
  onToggleStayExpanded,
  onDrag,
  onHover,
  onRefresh,
  isConsuming = false,
  notice = null,
  initialShowCreditTip = false,
  history = [],
  showRadar = false,
  onToggleRadar,
  onClearHistory,
  theme,
  customBackground = false,
  liquidGlassEnabled = false,
  style,
  onContextMenu,
}: Props) {
  const [showCreditTip, setShowCreditTip] = useState(initialShowCreditTip);
  const creditPopoverRef = useRef<HTMLDivElement>(null);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];
  const primary = snapshot.shortWindow ? clampPercent(snapshot.shortWindow.remainingPercent) : null;
  const weekly = snapshot.weeklyWindow ? clampPercent(snapshot.weeklyWindow.remainingPercent) : null;
  const displayPercent = primary ?? weekly;
  const displayWindow = snapshot.shortWindow ?? snapshot.weeklyWindow;
  const displayingWeeklyAsPrimary = primary === null && weekly !== null;
  const staleAge = Date.now() - new Date(snapshot.updatedAt).getTime();
  const staleExpired = snapshot.status === "stale" && staleAge > 30 * 60_000;
  const available = snapshot.status === "ok" || (snapshot.status === "stale" && !staleExpired);
  const tier = quotaTier(displayPercent);
  const indicatorState = isConsuming ? "active" : snapshot.status === "ok" ? "ok" : snapshot.status === "stale" ? "stale" : "error";
  const indicatorLabel = isConsuming
    ? t.active
    : snapshot.status === "ok"
      ? t.dataSynced
      : snapshot.status === "stale"
        ? t.dataStale
        : snapshot.status === "signed_out"
          ? t.notSignedIn
          : t.unavailableStatus;
  const message = localizedBackendMessage(snapshot.message, language);
  const creditExpirations = useMemo(() => (snapshot.resetCreditExpiresAt ?? []).map((value, index) => {
    return t.creditItem(index, formatDateTime(value, language));
  }), [language, snapshot.resetCreditExpiresAt, t]);

  useEffect(() => {
    if (!showCreditTip) return;

    let disposed = false;
    let unlistenNativeFocus: (() => void) | null = null;

    // The reset list is a transient popover. Keep the trigger and its content
    // inside one DOM boundary so a pointer on any other part of the widget
    // closes it, while interacting with the list itself remains possible.
    const closeCreditTip = () => setShowCreditTip(false);
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && creditPopoverRef.current?.contains(event.target)) return;
      closeCreditTip();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    // A desktop widget can lose focus when the user clicks another window;
    // that native-window transition does not always produce a document
    // pointer event. Subscribe to Tauri's native focus event for that path.
    window.addEventListener("blur", closeCreditTip);
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().onFocusChanged(({ payload }) => {
          if (!payload) closeCreditTip();
        }))
        .then((unlisten) => {
          if (disposed) unlisten(); else unlistenNativeFocus = unlisten;
        })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("blur", closeCreditTip);
      unlistenNativeFocus?.();
    };
  }, [showCreditTip]);

  return (
    <main
      className={`quota-card quota-card--${snapshot.status} quota-card--${tier}${theme ? ` quota-card--theme-${theme}` : ""}${customBackground ? " quota-card--custom-background" : ""}${liquidGlassEnabled ? " quota-card--liquid-glass" : ""}`}
      style={style}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onContextMenu={onContextMenu}
      onClickCapture={(event) => {
        if (showCreditTip && !(event.target instanceof Node && creditPopoverRef.current?.contains(event.target))) setShowCreditTip(false);
      }}
      onMouseDown={(event) => { if (event.button === 0) void onDrag(); }}
    >
      <div className="aurora" aria-hidden="true" />
      <span className="sr-only" aria-live="polite">{available && displayPercent !== null ? (displayingWeeklyAsPrimary ? t.weeklyAvailableLabel(displayPercent) : t.availableLabel(displayPercent)) : message}</span>
      {notice ? <div className="operation-notice" role="status">{notice}</div> : null}
      <header className="card-header">
        <div>
          <p className="eyebrow">{`${snapshot.displayName} · ${snapshot.plan ?? t.accountFallback}`}</p>
          {!showRadar && snapshot.status !== "stale" ? <p className="updated">{displayingWeeklyAsPrimary ? t.weeklyShortRemaining : t.shortRemaining}</p> : null}
        </div>
        {!preferences.locked ? (
          <nav className="card-actions" aria-label={t.controls} onMouseDown={(event) => event.stopPropagation()}>
            {providerCount > 1 ? <button onClick={onPrevious} aria-label={t.servicePrevious}><ArrowUp /></button> : null}
            {providerCount > 1 ? <button onClick={onNext} aria-label={t.serviceNext}><ArrowDown /></button> : null}
            <span className={`usage-indicator usage-indicator--${indicatorState}`} role="status" aria-label={indicatorLabel} title={indicatorLabel}><i /></span>
            {onToggleRadar ? <button className={showRadar ? "radar-button radar-button--active" : "radar-button"} onClick={onToggleRadar} aria-pressed={showRadar} aria-label={showRadar ? t.radarToggleOff : t.radarToggleOn} title={showRadar ? t.radarToggleOff : t.radarToggleOn}><ChartLineUp /></button> : null}
            <button className={preferences.stayExpanded ? "expand-button expand-button--active" : "expand-button"} onClick={onToggleStayExpanded} aria-pressed={preferences.stayExpanded} aria-label={preferences.stayExpanded ? t.keepExpandedOff : t.keepExpandedOn} title={preferences.stayExpanded ? t.keepExpandedOff : t.keepExpandedOn}>
              {preferences.stayExpanded ? <ArrowsInSimple weight="bold" /> : <ArrowsOutSimple />}
            </button>
            <button className={preferences.alwaysOnTop ? "pin-button pin-button--active" : "pin-button"} onClick={onLock} aria-pressed={preferences.alwaysOnTop} aria-label={preferences.alwaysOnTop ? t.pinOff : t.pinOn} title={preferences.alwaysOnTop ? t.pinOff : t.pinOn}>
              {preferences.alwaysOnTop ? <PushPin weight="fill" /> : <PushPinSlash />}
            </button>
          </nav>
        ) : null}
      </header>

      {showRadar ? (
        <QuotaRadarPanel snapshot={snapshot} history={history} language={language} onClearHistory={onClearHistory} />
      ) : available && displayPercent !== null ? (
        <>
          <section className="primary-metric" aria-label={displayingWeeklyAsPrimary ? t.weeklyAvailableLabel(displayPercent) : t.availableLabel(displayPercent)}>
            <span>{displayPercent}</span><small>%</small>
          </section>
          <div className="progress" role="progressbar" aria-label={displayingWeeklyAsPrimary ? t.weeklyAvailableLabel(displayPercent) : t.availableLabel(displayPercent)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayPercent}><span style={{ width: `${displayPercent}%` }} /></div>
          <p className="reset-time">{formatResetTime(displayWindow?.resetsAt ?? null, new Date(), language)}{displayWindow?.resetsAt ? ` · ${formatDateTime(displayWindow.resetsAt, language)}` : ""}</p>
          <footer className="card-footer">
            <div className="weekly-metric">
              {displayingWeeklyAsPrimary ? <p className="weekly-note"><Info weight="bold" aria-hidden="true" />{t.shortWindowUnavailable}</p> : <p>{t.weeklyUntil(formatResetDateTime(snapshot.weeklyWindow?.resetsAt ?? null, language))}</p>}
              <strong className={displayingWeeklyAsPrimary ? "weekly-value--unavailable" : undefined}>{displayingWeeklyAsPrimary ? "--" : weekly ?? "--"}<small>{displayingWeeklyAsPrimary || weekly === null ? "" : "%"}</small></strong>
              <div className="reset-credit-popover" ref={creditPopoverRef}>
                <div className="reset-credit-row" onMouseDown={(event) => event.stopPropagation()}>
                  <span>{snapshot.resetCredits === null ? t.resetCreditUnknown : t.resetCredits(snapshot.resetCredits)}</span>
                  {snapshot.resetCredits !== null && snapshot.resetCredits > 0 ? (
                    <button type="button" className="reset-credit-button" onClick={() => setShowCreditTip((value) => !value)} aria-expanded={showCreditTip} aria-label={t.view}>{t.view}</button>
                  ) : null}
                </div>
                {showCreditTip ? (
                  <div className="reset-credit-tip" role="status" onMouseDown={(event) => event.stopPropagation()}>
                    {creditExpirations.length > 0 ? creditExpirations.map((item) => <p key={item}>{item}</p>) : <p>{t.noCreditExpiration}</p>}
                  </div>
                ) : null}
              </div>
            </div>
            <ProviderMark />
          </footer>
        </>
      ) : (
        <section className="error-state" aria-live="polite">
          <div className="status-icon" aria-hidden="true"><StatusIcon status={snapshot.status} expired={staleExpired} /></div>
          <strong>{snapshot.status === "signed_out" ? t.signedInRequired : staleExpired ? t.staleExpired : t.temporarilyUnavailable}</strong>
          <p>{message ?? t.errorUnavailable}</p>
          {snapshot.status === "stale" ? (
            <button type="button" className="error-refresh-button" onMouseDown={(event) => event.stopPropagation()} onClick={onRefresh} disabled={!onRefresh} aria-label={t.refreshQuota}>
              <ArrowClockwise />
              <span>{t.refresh}</span>
            </button>
          ) : null}
        </section>
      )}
    </main>
  );
});

export const QuotaOrb = memo(function QuotaOrb({ snapshot, onDrag, onHover, language = "zh-CN", theme, customBackground = false, liquidGlassEnabled = false, style, onContextMenu }: Pick<Props, "snapshot" | "onDrag" | "onHover" | "theme" | "customBackground" | "liquidGlassEnabled" | "style" | "onContextMenu"> & { language?: Language }) {
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const activeLanguage = normalizeLanguage(language);
  const t = copy[activeLanguage];
  const primary = snapshot.shortWindow ? clampPercent(snapshot.shortWindow.remainingPercent) : null;
  const weekly = snapshot.weeklyWindow ? clampPercent(snapshot.weeklyWindow.remainingPercent) : null;
  const displayPercent = primary ?? weekly;
  const displayingWeeklyAsPrimary = primary === null && weekly !== null;
  const tier = quotaTier(displayPercent);
  const available = snapshot.status === "ok" && displayPercent !== null;
  useEffect(() => {
    idleTimer.current = window.setTimeout(() => setIdle(true), 2000);
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, []);

  const handleMouseEnter = () => {
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    setIdle(false);
    onHover(true);
  };

  return (
    <main
      className={`quota-orb quota-card--${snapshot.status} quota-card--${tier}${theme ? ` quota-orb--theme-${theme}` : ""}${customBackground ? " quota-orb--custom-background" : ""}${liquidGlassEnabled ? " quota-orb--liquid-glass" : ""}${displayingWeeklyAsPrimary ? " quota-orb--weekly" : ""}${idle ? " quota-orb--idle" : ""}`}
      style={style}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => onHover(false)}
      onContextMenu={onContextMenu}
      onMouseDown={(event) => { if (event.button === 0) void onDrag(); }}
      aria-label={available ? (displayingWeeklyAsPrimary ? t.weeklyAvailableLabel(displayPercent!) : t.availableLabel(displayPercent!)) : localizedBackendMessage(snapshot.message, activeLanguage) ?? t.unavailableStatus}
    >
      <div className="aurora" aria-hidden="true" />
      {/* 永恩与冰川极光复用同一额度环；弧长使用已限界的主额度，
          缺少短周期时自然跟随周额度，异常数据不绘制误导性的进度。 */}
      {(theme === "yone" || theme === "glacier") && available ? (
        <svg className="quota-ring" viewBox="0 0 72 72" aria-hidden="true">
          <circle className="quota-ring__track" cx="36" cy="36" r="31" />
          <circle className="quota-ring__value" cx="36" cy="36" r="31" pathLength="100" strokeDasharray={`${displayPercent} 100`} transform="rotate(-90 36 36)" />
        </svg>
      ) : null}
      {available && displayingWeeklyAsPrimary ? (
        <span className="orb-weekly-badge" aria-hidden="true">
          <svg viewBox="0 0 55 17" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.3687 52.2894C13.0674 47.8486 17 38.4172 17 27.5C17 16.5828 13.0674 7.15141 7.3687 2.71063C3.88364 -0.00516105 0 3.58172 0 8L0 47C0 51.4183 3.88364 55.0052 7.3687 52.2894Z" fill="currentColor" transform="matrix(0 1 -1 0 55 0)" />
          </svg>
          <b>W</b>
        </span>
      ) : null}
      {available ? (
        <section className="orb-metric">
          <span>{displayPercent}</span>
          <small>%</small>
        </section>
      ) : (
        <section className="orb-unavailable">
          <StatusIcon status={snapshot.status} />
        </section>
      )}
    </main>
  );
});
