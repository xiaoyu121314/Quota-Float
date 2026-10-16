import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { QuotaCard, QuotaOrb } from "./components/QuotaCard";
import { ContextMenu } from "./components/ContextMenu";
import { clearQuotaHistory, fetchSnapshots, getAutostartStatus, getPreferences, getQuotaHistory, hideWidget, isTauri, isWidgetVisible, listenContextMenuActions, listenDesktopEvents, openSettingsWindow, quitApplication, setAlwaysOnTop, setClickThrough, setWidgetExpanded, setWidgetMenuOpen, showWidget, startDragging, syncWidgetAppearance, updatePreferences } from "./lib/bridge";
import { needsFastRefresh, quotaTier } from "./lib/format";
import { normalizeLanguage } from "./lib/i18n";
import { mergeSnapshots } from "./lib/snapshots";
import { DESKTOP_PALETTES } from "./lib/desktopPalette";
import type { ProviderSnapshot, QuotaHistoryPoint, WidgetPreferences, WidgetTheme } from "./types";
import type { AppearancePreference, ContextMenuAction } from "./components/ContextMenu";

const DEFAULT_PREFS: WidgetPreferences = { locked: false, alwaysOnTop: true, stayExpanded: false, autoRotateSeconds: 12, language: "zh-CN", appearance: "light", opacity: 100, liquidGlassEnabled: false, customBackgroundImage: null };
const INITIAL_SNAPSHOT: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: null,
  shortWindow: null,
  weeklyWindow: null,
  resetCredits: null,
  resetCreditExpiresAt: [],
  tokenActivity: null,
  updatedAt: new Date().toISOString(),
  status: "unavailable",
  message: "Quota is loading.",
};

export default function App() {
  const [snapshots, setSnapshots] = useState<ProviderSnapshot[]>([]);
  const [quotaHistory, setQuotaHistory] = useState<QuotaHistoryPoint[]>([]);
  const [showRadar, setShowRadar] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULT_PREFS);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [compact, setCompact] = useState(true);
  const [consumingProviders, setConsumingProviders] = useState<Set<string>>(() => new Set());
  const [operationError, setOperationError] = useState<string | null>(null);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 });
  const contextMenuOpen = useRef(false);
  const contextMenuSequence = useRef(0);
  const contextMenuActionHandler = useRef<(action: ContextMenuAction) => void>(() => {});
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const failures = useRef(0);
  const previousPrimary = useRef(new Map<string, number>());
  const consumptionTimers = useRef(new Map<string, number>());
  const collapseTimer = useRef<number | null>(null);
  const hoverSequence = useRef(0);
  const language = normalizeLanguage(preferences.language);
  const operation = language === "zh-CN" ? {
    listenerFailed: "桌面事件监听启动失败。",
    settingsFailed: "设置保存失败，已恢复之前的状态。",
    alwaysOnTopFailed: "置顶状态切换失败。",
    expandFailed: "组件展开失败。",
    collapseFailed: "组件收起失败。",
    historyClearFailed: "趋势历史清空失败，请重试。",
  } : {
    listenerFailed: "Desktop event listener failed to start.",
    settingsFailed: "Settings could not be saved. Previous state restored.",
    alwaysOnTopFailed: "Always-on-top toggle failed.",
    expandFailed: "Widget expand failed.",
    collapseFailed: "Widget collapse failed.",
    historyClearFailed: "Could not clear trend history. Try again.",
  };
  const theme: WidgetTheme = preferences.appearance === "system" ? (systemDark ? "dark" : "light") : preferences.appearance;
  useEffect(() => {
    // This only reconciles the transparent-window safety inset after a theme
    // change. A platform refusal is non-fatal: the current widget geometry is
    // still usable and users should never see an internal resize error.
    void syncWidgetAppearance(theme).catch(() => undefined);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => setSystemDark(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const syncQuotaHistory = useCallback(() => {
    // History is a secondary read. A transient history-file failure must not
    // turn an otherwise valid quota response into a stale card.
    void getQuotaHistory().then(setQuotaHistory).catch(() => undefined);
  }, []);

  const refresh = useCallback(async (force = false) => {
    try {
      const values = await fetchSnapshots(force);
      syncQuotaHistory();
      const hasFailure = values.some((item) => item.status !== "ok");
      if (hasFailure) failures.current += 1;
      else failures.current = 0;
      for (const item of values) {
        const nextPrimary = item.shortWindow?.remainingPercent;
        const previous = previousPrimary.current.get(item.provider);
        if (nextPrimary !== undefined && previous !== undefined && nextPrimary < previous) {
          setConsumingProviders((current) => new Set(current).add(item.provider));
          const oldTimer = consumptionTimers.current.get(item.provider);
          if (oldTimer !== undefined) window.clearTimeout(oldTimer);
          const timer = window.setTimeout(() => {
            setConsumingProviders((current) => { const next = new Set(current); next.delete(item.provider); return next; });
            consumptionTimers.current.delete(item.provider);
          }, 5 * 60_000);
          consumptionTimers.current.set(item.provider, timer);
        }
        if (nextPrimary !== undefined) previousPrimary.current.set(item.provider, nextPrimary);
      }
      setSnapshots((current) => mergeSnapshots(current, values));
    } catch {
      failures.current += 1;
      setSnapshots((current) => current.length > 0
        ? current.map((item) => ({ ...item, status: "stale", message: "Refresh failed. Please try again later." }))
        : [{ provider: "codex", displayName: "CODEX", plan: null, shortWindow: null, weeklyWindow: null, resetCredits: null, resetCreditExpiresAt: [], tokenActivity: null, updatedAt: new Date().toISOString(), status: "unavailable", message: "Quota is temporarily unavailable. It will retry automatically." }]);
    }
  }, [syncQuotaHistory]);

  useEffect(() => {
    void refresh(true);
    syncQuotaHistory();
    void (async () => {
      const value = await getPreferences().catch(async () => {
        // A WebView can occasionally issue its first invoke while it is
        // resuming. Retry once, then retain the already-safe defaults without
        // showing a persistent warning on the quota card.
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        return getPreferences().catch(() => DEFAULT_PREFS);
      });
      setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) });
      const autostart = await getAutostartStatus().catch(() => false);
      setAutostartEnabled(autostart);
    })().catch(() => setPreferences(DEFAULT_PREFS));
    return () => {
      for (const timer of consumptionTimers.current.values()) window.clearTimeout(timer);
      consumptionTimers.current.clear();
      if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    };
  }, [refresh, syncQuotaHistory]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: () => void = () => {};
    void listenDesktopEvents({ onPreferences: (value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) }), onRefresh: () => void refresh(true) }).then((value) => {
      if (cancelled) value(); else cleanup = value;
    }).catch(() => setOperationError(operation.listenerFailed));
    return () => { cancelled = true; cleanup(); };
  }, [operation.listenerFailed, refresh]);

  const refreshMs = useMemo(() => {
    const backoff = failures.current === 0 ? 5 * 60_000 : Math.min(30 * 60_000, 30_000 * 2 ** (failures.current - 1));
    if (failures.current === 0 && snapshots.some((item) => item.status === "ok" && needsFastRefresh(item))) return 60_000;
    return backoff;
  }, [snapshots]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(id);
  }, [refresh, refreshMs]);

  useEffect(() => {
    const refreshWhenActive = () => { if (document.visibilityState === "visible") void refresh(true); };
    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [refresh]);

  useEffect(() => {
    if (hovered || snapshots.length < 2) return;
    const id = window.setInterval(() => setActiveIndex((value) => (value + 1) % snapshots.length), preferences.autoRotateSeconds * 1000);
    return () => window.clearInterval(id);
  }, [hovered, preferences.autoRotateSeconds, snapshots.length]);

  const current = snapshots[activeIndex % Math.max(1, snapshots.length)] ?? INITIAL_SNAPSHOT;

  const primaryPercent = current?.shortWindow?.remainingPercent ?? current?.weeklyWindow?.remainingPercent ?? null;
  const tier = quotaTier(primaryPercent);
  const paletteName = current.status === "unavailable" || current.status === "stale" || current.status === "signed_out"
    ? current.status
    : tier === "healthy" || tier === "caution" || tier === "critical" ? tier : null;
  // The production widget and design workbench share one explicit palette
  // source. Theme records are independent so light and dark cannot leak into
  // one another through CSS defaults or preview state.
  const cardStyle = paletteName ? DESKTOP_PALETTES[theme][paletteName] : undefined;
  // The image is carried as a CSS custom property so the expanded card and
  // compact orb share one value. The value is produced from a local file and
  // validated before it reaches this render path.
  const customBackgroundStyle = preferences.customBackgroundImage
    ? { "--custom-background-image": `url("${preferences.customBackgroundImage}")` }
    : {};
  const hasCustomBackground = Boolean(preferences.customBackgroundImage);
  const widgetStyle = {
    ...(cardStyle ?? {}),
    ...customBackgroundStyle,
    "--widget-opacity": `${preferences.opacity / 100}`,
  } as unknown as CSSProperties;

  const savePreferences = useCallback((next: WidgetPreferences) => {
    const previous = preferences;
    setPreferences(next);
    setOperationError(null);
    void updatePreferences(next).catch(() => { setPreferences(previous); setOperationError(operation.settingsFailed); });
  }, [operation.settingsFailed, preferences]);

  const handleClearHistory = useCallback(async () => {
    try {
      await clearQuotaHistory();
      setQuotaHistory([]);
      setOperationError(null);
    } catch (error) {
      setOperationError(operation.historyClearFailed);
      throw error;
    }
  }, [operation.historyClearFailed]);

  const handleHover = useCallback((value: boolean) => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setHovered(value);
    if (contextMenuOpen.current) return;
    if (!value && preferences.stayExpanded) return;
    if (value) void refresh(true);
    // A right click on an already expanded card only needs the popup. Calling
    // native expand again can trigger an unnecessary WebView surface repaint.
    if (value && !compact) return;
    if (value) {
      const sequence = ++hoverSequence.current;
      void setWidgetExpanded(true)
        .then(() => { if (hoverSequence.current === sequence) setCompact(false); })
        .catch(() => {
          setCompact(false);
          setOperationError(operation.expandFailed);
        });
      return;
    }
    const sequence = ++hoverSequence.current;
    collapseTimer.current = window.setTimeout(() => {
      if (hoverSequence.current !== sequence) return;
      setCompact(true);
      void setWidgetExpanded(false).catch(() => setOperationError(operation.collapseFailed));
    }, 180);
  }, [compact, operation.collapseFailed, operation.expandFailed, preferences.stayExpanded, refresh]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const { clientX: x, clientY: y } = event;
    if (contextMenuOpen.current && !isTauri()) {
      setContextMenu({ visible: true, x, y });
      return;
    }
    if (!contextMenuOpen.current) handleHover(true);
    contextMenuOpen.current = true;
    const sequence = ++contextMenuSequence.current;
    // Desktop menus live in a separate WebView. Browser previews continue to
    // use the existing portal without any native window or root offset change.
    void setWidgetMenuOpen(true, {
      requestId: sequence, x, y, language, appearance: preferences.appearance,
      locked: preferences.locked, autostart: autostartEnabled,
    }).then(() => {
      if (sequence !== contextMenuSequence.current) return;
      setContextMenu({ visible: true, x, y });
    }).catch(() => {
      contextMenuOpen.current = false;
      setOperationError(operation.expandFailed);
    });
  }, [handleHover, operation.expandFailed, language, preferences.appearance, preferences.locked, autostartEnabled]);

  const handleCloseContextMenu = useCallback((fromPopup = false) => {
    ++contextMenuSequence.current;
    contextMenuOpen.current = false;
    setContextMenu({ visible: false, x: 0, y: 0 });
    // A popup-close notification already hid its native window. Do not echo
    // another close command that could race with the next right-click request.
    if (!fromPopup) void setWidgetMenuOpen(false).catch(() => setOperationError(operation.collapseFailed));
    if (!hovered) handleHover(false);
  }, [handleHover, hovered, operation.collapseFailed]);

  const handleToggleVisibility = useCallback(async () => {
    const visible = await isWidgetVisible().catch(() => true);
    if (visible) {
      await hideWidget().catch(() => undefined);
    } else {
      await showWidget().catch(() => undefined);
    }
  }, []);

  const handleOpenPreferences = useCallback(() => {
    void openSettingsWindow().catch(() => undefined);
  }, []);

  const handleToggleLock = useCallback(() => {
    setOperationError(null);
    void setClickThrough(!preferences.locked)
      .then((value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) }))
      .catch(() => setOperationError(operation.settingsFailed));
  }, [operation.settingsFailed, preferences.locked]);

  const handleToggleLanguage = useCallback(() => {
    const next = preferences.language === "en" ? "zh-CN" : "en";
    savePreferences({ ...preferences, language: next });
  }, [preferences, savePreferences]);

  const handleToggleAutostart = useCallback(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const next = !autostartEnabled;
    try {
      await invoke("set_autostart_enabled", { enabled: next });
      setAutostartEnabled(next);
    } catch {
      // Autostart toggle is best-effort; the tray menu reflects the real state.
    }
  }, [autostartEnabled]);

  const handleSelectTheme = useCallback(
    (theme: AppearancePreference) => {
      savePreferences({ ...preferences, appearance: theme });
    },
    [preferences, savePreferences],
  );

  const handleQuit = useCallback(() => {
    void quitApplication().catch(() => undefined);
  }, []);

  useLayoutEffect(() => {
    // Keep a single native subscription while hover and preferences change.
    // Layout effects refresh the callback before another native event can use
    // stale hover state or fall into an unsubscribe/resubscribe delivery gap.
    contextMenuActionHandler.current = ({ action, theme: selectedTheme, requestId }) => {
      switch (action) {
        // Focus loss from an older opening can arrive after another right
        // click. It must not clear the new opening's collapse guard.
        case "close": if (requestId === contextMenuSequence.current) handleCloseContextMenu(true); break;
        case "visibility": void handleToggleVisibility(); break;
        case "refresh": void refresh(true); break;
        case "preferences": handleOpenPreferences(); break;
        case "lock": handleToggleLock(); break;
        case "language": handleToggleLanguage(); break;
        case "autostart": void handleToggleAutostart(); break;
        case "theme": if (selectedTheme) handleSelectTheme(selectedTheme); break;
        case "quit": handleQuit(); break;
      }
    };
  }, [handleCloseContextMenu, handleToggleVisibility, refresh, handleOpenPreferences, handleToggleLock, handleToggleLanguage, handleToggleAutostart, handleSelectTheme, handleQuit]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenContextMenuActions((action) => contextMenuActionHandler.current(action)).then((value) => {
      if (disposed) value(); else unlisten = value;
    }).catch(() => setOperationError(operation.listenerFailed));
    return () => { disposed = true; unlisten?.(); };
  }, [operation.listenerFailed]);

  useEffect(() => {
    if (!preferences.stayExpanded) return;
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
    setCompact(false);
    void setWidgetExpanded(true).catch(() => setOperationError(operation.expandFailed));
  }, [operation.expandFailed, preferences.stayExpanded]);

  if (compact) {
    return (
      <>
        <QuotaOrb snapshot={current} language={language} onDrag={() => startDragging()} onHover={handleHover} theme={theme} customBackground={hasCustomBackground} liquidGlassEnabled={preferences.liquidGlassEnabled} style={widgetStyle} onContextMenu={handleContextMenu} />
        <ContextMenu
          visible={contextMenu.visible && !isTauri()}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
          language={language}
          appearance={preferences.appearance}
          locked={preferences.locked}
          autostart={autostartEnabled}
          onToggleVisibility={handleToggleVisibility}
          onRefresh={() => refresh(true)}
          onOpenPreferences={handleOpenPreferences}
          onToggleLock={handleToggleLock}
          onToggleLanguage={handleToggleLanguage}
          onToggleAutostart={handleToggleAutostart}
          onSelectTheme={handleSelectTheme}
          onQuit={handleQuit}
        />
      </>
    );
  }

  return (
    <>
      <QuotaCard
        snapshot={current}
        preferences={preferences}
        providerCount={snapshots.length}
        onPrevious={() => setActiveIndex((value) => (value - 1 + snapshots.length) % snapshots.length)}
        onNext={() => setActiveIndex((value) => (value + 1) % snapshots.length)}
        onToggleStayExpanded={() => savePreferences({ ...preferences, stayExpanded: !preferences.stayExpanded })}
        onLock={() => { setOperationError(null); void setAlwaysOnTop(!preferences.alwaysOnTop).then((value) => setPreferences({ ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) })).catch(() => setOperationError(operation.alwaysOnTopFailed)); }}
        onDrag={() => startDragging()}
        onHover={handleHover}
        onRefresh={() => refresh(true)}
        history={quotaHistory}
        showRadar={showRadar}
        onToggleRadar={() => setShowRadar((value) => !value)}
        onClearHistory={handleClearHistory}
        isConsuming={consumingProviders.has(current.provider)}
        theme={theme}
        customBackground={hasCustomBackground}
        liquidGlassEnabled={preferences.liquidGlassEnabled}
        style={widgetStyle}
        notice={operationError}
        onContextMenu={handleContextMenu}
      />
      <ContextMenu
        visible={contextMenu.visible && !isTauri()}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={handleCloseContextMenu}
        language={language}
        appearance={preferences.appearance}
        locked={preferences.locked}
        autostart={autostartEnabled}
        onToggleVisibility={handleToggleVisibility}
        onRefresh={() => refresh(true)}
        onOpenPreferences={handleOpenPreferences}
        onToggleLock={handleToggleLock}
        onToggleLanguage={handleToggleLanguage}
        onToggleAutostart={handleToggleAutostart}
        onSelectTheme={handleSelectTheme}
        onQuit={handleQuit}
      />
    </>
  );
}
