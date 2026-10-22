/**
 * @author MoShangHuaKai
 *
 * Hosts the same themed menu in a preloaded, independent transparent WebView.
 * The quota card never moves or resizes to make room for this popup.
 */
import { useCallback, useEffect, useState } from "react";
import { ContextMenu, type ContextMenuAction, type ContextMenuState } from "./ContextMenu";
import { setWidgetMenuOpen } from "../lib/bridge";

export function ContextMenuWindow() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const { invoke } = await import("@tauri-apps/api/core");
      const accept = (value: ContextMenuState | null) => {
        if (disposed || !value) return;
        setMenu((current) => !current || value.requestId >= current.requestId ? value : current);
      };
      unlisten = await listen<ContextMenuState>("context-menu-open", ({ payload }) => accept(payload));
      if (disposed) { unlisten(); return; }
      // The first right click may arrive before this preloaded page subscribes.
      // Reading the pending snapshot closes that startup delivery gap.
      accept(await invoke<ContextMenuState | null>("get_context_menu"));
    })().catch(() => setMenu(null));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!menu) return;
    let cancelled = false;
    let shown = false;
    const show = () => {
      if (shown || cancelled) return;
      shown = true;
      void import("@tauri-apps/api/core").then(({ invoke }) => {
        if (!cancelled) return invoke("show_context_menu", { requestId: menu.requestId });
      }).catch(() => setMenu(null));
    };
    // Two animation frames allow React layout effects and the compositor to
    // paint the hidden popup before Windows first presents its native surface.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        show();
      });
    });
    // Hidden WebViews may suspend animation frames. Keep opening bounded
    // without depending on an animation frame that Windows may never deliver.
    const fallback = window.setTimeout(show, 80);
    return () => { cancelled = true; window.cancelAnimationFrame(frame); window.clearTimeout(fallback); };
  }, [menu]);

  const close = useCallback(() => {
    if (!menu) return;
    setMenu(null);
    // Include this opening's ID so a delayed blur from the previous popup
    // cannot dismiss a newer right-click request.
    void setWidgetMenuOpen(false, menu).catch(() => undefined);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // Clicking another native window does not reliably produce a DOM blur in
    // WebView2. Native focus loss must also dismiss this standalone popup.
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().onFocusChanged(({ payload }) => {
        if (!payload) close();
      }))
      .then((value) => { if (disposed) value(); else unlisten = value; })
      .catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, [menu, close]);

  const dispatch = useCallback((action: ContextMenuAction) => {
    void import("@tauri-apps/api/event")
      .then(({ emitTo }) => emitTo("widget", "context-menu-action", action))
      .catch(() => undefined);
  }, []);

  if (!menu) return null;
  return <ContextMenu
    {...menu}
    visible
    onClose={close}
    onToggleVisibility={() => dispatch({ action: "visibility" })}
    onRefresh={() => dispatch({ action: "refresh" })}
    onOpenPreferences={() => dispatch({ action: "preferences" })}
    onToggleLock={() => dispatch({ action: "lock" })}
    onToggleLanguage={() => dispatch({ action: "language" })}
    onToggleAutostart={() => dispatch({ action: "autostart" })}
    onSelectTheme={(theme) => dispatch({ action: "theme", theme })}
    onQuit={() => dispatch({ action: "quit" })}
  />;
}
