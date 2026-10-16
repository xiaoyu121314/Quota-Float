import type { ProviderSnapshot, QuotaHistoryPoint, WidgetPreferences, WidgetTheme } from "../types";
import type { ContextMenuAction, ContextMenuState } from "../components/ContextMenu";

const defaultPreferences: WidgetPreferences = { locked: false, alwaysOnTop: true, stayExpanded: false, autoRotateSeconds: 12, language: "zh-CN", appearance: "light", opacity: 100, liquidGlassEnabled: false, customBackgroundImage: null };

function generateMockTokenActivity(): { daily: Array<{ startAt: string; tokenCount: number }>; totalTokens: number } {
  const daily: Array<{ startAt: string; tokenCount: number }> = [];
  const now = new Date();
  let totalTokens = 0;
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const baseCount = Math.floor(Math.random() * 500000) + 50000;
    const weekday = date.getDay();
    const multiplier = weekday === 0 || weekday === 6 ? 0.3 : 1;
    const tokenCount = Math.floor(baseCount * multiplier);
    totalTokens += tokenCount;
    daily.push({ startAt: date.toISOString().slice(0, 10), tokenCount });
  }
  return { daily, totalTokens };
}

const mockSnapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: new Date(Date.now() + 78 * 60_000).toISOString(), windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: new Date(Date.now() + 3.2 * 86_400_000).toISOString(), windowSeconds: 604_800 },
  resetCredits: 1,
  resetCreditExpiresAt: [new Date(Date.now() + 9 * 86_400_000).toISOString()],
  tokenActivity: generateMockTokenActivity(),
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};

// Browser previews need a small history so the radar can be inspected without
// starting a Tauri process. The desktop path reads the same shape from the
// privacy-filtered Rust store instead of manufacturing account data.
const mockHistory: QuotaHistoryPoint[] = Array.from({ length: 6 }, (_, index) => {
  const ageHours = 5 - index;
  return {
    provider: "codex",
    capturedAt: new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString(),
    status: "ok",
    shortRemainingPercent: 95 - index * 4.2,
    weeklyRemainingPercent: 62 - index * 4,
  };
});

let widgetTransition: Promise<void> = Promise.resolve();

function enqueueWidgetTransition(operation: () => Promise<void>): Promise<void> {
  const next = widgetTransition.then(operation, operation);
  widgetTransition = next.catch(() => undefined);
  return next;
}

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function fetchSnapshots(force = false): Promise<ProviderSnapshot[]> {
  if (!isTauri()) return [mockSnapshot];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProviderSnapshot[]>(force ? "refresh_snapshots" : "get_snapshots");
}

export async function getQuotaHistory(): Promise<QuotaHistoryPoint[]> {
  if (!isTauri()) return mockHistory;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<QuotaHistoryPoint[]>("get_quota_history");
}

export async function clearQuotaHistory(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_quota_history");
}

export async function getPreferences(): Promise<WidgetPreferences> {
  if (!isTauri()) return defaultPreferences;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("get_preferences");
}

export async function updatePreferences(value: WidgetPreferences): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_preferences", { preferences: value });
}

export async function setClickThrough(locked: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, locked };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_locked", { locked });
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, alwaysOnTop };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_always_on_top", { alwaysOnTop });
}

export async function syncWidgetAppearance(appearance: WidgetTheme): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("sync_widget_appearance", { appearance });
}

export async function setWidgetOpacity(opacity: number): Promise<WidgetPreferences> {
  const normalized = Math.min(100, Math.max(0, Math.round(opacity)));
  if (!isTauri()) return { ...defaultPreferences, opacity: normalized };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_opacity", { opacity: normalized });
}

/**
 * Save the user-selected image through a dedicated command so the native side
 * can persist it and notify both the widget and the settings window at once.
 */
export async function setWidgetBackgroundImage(image: string | null): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, customBackgroundImage: image };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_background_image", { customBackgroundImage: image });
}

/** Persist and broadcast the Liquid Glass preference to both desktop windows. */
export async function setWidgetLiquidGlass(enabled: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, liquidGlassEnabled: enabled };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_liquid_glass", { enabled });
}

export async function startDragging(): Promise<void> {
  if (!isTauri()) return;
  // Clicking the card dismisses its menu before dragging. Wait for that
  // queued restoration so native drag geometry never records the menu size.
  await widgetTransition;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { invoke } = await import("@tauri-apps/api/core");
  const currentWindow = getCurrentWindow();
  await invoke("begin_widget_drag");
  await currentWindow.startDragging();
  let previous = await currentWindow.outerPosition();
  let stableTicks = 0;
  let attempts = 0;
  const finishWhenStable = window.setInterval(() => {
    void currentWindow.outerPosition()
      .then((next) => {
        attempts += 1;
        const stable = Math.abs(next.x - previous.x) <= 1 && Math.abs(next.y - previous.y) <= 1;
        stableTicks = stable ? stableTicks + 1 : 0;
        previous = next;
        if (stableTicks >= 3 || attempts >= 25) {
          window.clearInterval(finishWhenStable);
          void invoke("finish_widget_drag").catch(() => undefined);
        }
      })
      .catch(() => {
        window.clearInterval(finishWhenStable);
        void invoke("finish_widget_drag").catch(() => undefined);
      });
  }, 80);
}

export function setWidgetExpanded(expanded: boolean): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return enqueueWidgetTransition(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    if (!expanded) {
      await invoke("collapse_widget");
      return;
    }
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const monitor = await currentMonitor().catch(() => null);
    const workArea = monitor ? {
      position: { x: monitor.workArea.position.x, y: monitor.workArea.position.y },
      size: { width: monitor.workArea.size.width, height: monitor.workArea.size.height },
    } : null;
    await invoke("expand_widget", { workArea });
  });
}

/** Open the dedicated menu window; the visible widget keeps its native bounds. */
export async function setWidgetMenuOpen(open: boolean, menu?: ContextMenuState): Promise<void> {
  if (!isTauri()) return;
  // Preserve ordering with orb expansion and subsequent collapse, but never
  // apply CSS compensation to the widget after a native window mutation.
  await enqueueWidgetTransition(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { currentMonitor } = await import("@tauri-apps/api/window");
    const monitor = open ? await currentMonitor().catch(() => null) : null;
    const workArea = monitor ? {
      position: { x: monitor.workArea.position.x, y: monitor.workArea.position.y },
      size: { width: monitor.workArea.size.width, height: monitor.workArea.size.height },
    } : null;
    await invoke("set_widget_menu_open", { open, menu: menu ?? null, workArea });
  });
}

/** Menu actions run in the widget so existing preference and quota logic is reused. */
export async function listenContextMenuActions(handler: (action: ContextMenuAction) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ContextMenuAction>("context-menu-action", ({ payload }) => handler(payload));
}

export async function hideWidget(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("hide_widget");
}

export async function showWidget(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_widget");
}

export async function isWidgetVisible(): Promise<boolean> {
  if (!isTauri()) return true;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("is_widget_visible");
}

export async function openSettingsWindow(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_settings_window");
}

export async function quitApplication(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("quit_application");
}

export async function getAutostartStatus(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("get_autostart_status");
}

export async function listenDesktopEvents(handlers: {
  onPreferences: (value: WidgetPreferences) => void;
  onRefresh: () => void;
}): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenPreferences = await listen<WidgetPreferences>("preferences-changed", (event) => handlers.onPreferences(event.payload));
  const unlistenRefresh = await listen("refresh-requested", handlers.onRefresh);
  return () => { unlistenPreferences(); unlistenRefresh(); };
}
