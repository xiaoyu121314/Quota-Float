import { Check, CaretRight } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Language, WidgetTheme } from "../types";
import { copy, normalizeLanguage } from "../lib/i18n";

export type AppearancePreference = "system" | WidgetTheme;

/** Serializable snapshot shared with the independent desktop menu WebView. */
export interface ContextMenuState {
  requestId: number;
  x: number;
  y: number;
  language: Language;
  appearance: AppearancePreference;
  locked: boolean;
  autostart: boolean;
}

export type ContextMenuAction = {
  action: "close" | "visibility" | "refresh" | "preferences" | "lock" | "language" | "autostart" | "theme" | "quit";
  theme?: AppearancePreference;
  requestId?: number;
};

interface ContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  language: Language;
  appearance: AppearancePreference;
  locked: boolean;
  autostart: boolean;
  onToggleVisibility: () => void;
  onRefresh: () => void;
  onOpenPreferences: () => void;
  onToggleLock: () => void;
  onToggleLanguage: () => void;
  onToggleAutostart: () => void;
  onSelectTheme: (theme: AppearancePreference) => void;
  onQuit: () => void;
}

type Position = { left: number; top: number };
const MENU_MARGIN = 4;
const SUBMENU_GAP = 4;

function clampToViewport(value: number, size: number, viewport: number): number {
  return Math.max(MENU_MARGIN, Math.min(value, viewport - size - MENU_MARGIN));
}

function ThemeSubmenu({
  anchor,
  parentPosition,
  onEnter,
  onLeave,
  onSelect,
  language,
  appearance,
  isLight,
}: {
  anchor: HTMLDivElement | null;
  parentPosition: Position;
  onEnter: () => void;
  onLeave: () => void;
  onSelect: (theme: AppearancePreference) => void;
  language: Language;
  appearance: AppearancePreference;
  isLight: boolean;
}) {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<(Position & { maxHeight: number }) | null>(null);
  const labels = copy[normalizeLanguage(language)];
  const themes: { key: AppearancePreference; label: string }[] = [
    { key: "system", label: labels.ctxThemeSystem },
    { key: "dark", label: labels.ctxThemeDark },
    { key: "light", label: labels.ctxThemeLight },
    { key: "sakura", label: labels.ctxThemeSakura },
    { key: "warm", label: labels.ctxThemeWarm },
    { key: "city", label: labels.ctxThemeCity },
    { key: "home", label: labels.ctxThemeHome },
    { key: "naruto", label: labels.ctxThemeNaruto },
    { key: "yone", label: labels.ctxThemeYone },
    { key: "glacier", label: labels.ctxThemeGlacier },
  ];

  useLayoutEffect(() => {
    const updatePosition = () => {
      if (!anchor || !submenuRef.current) return;
      const rect = anchor.getBoundingClientRect();
      // A scrolling parent reserves a scrollbar gutter. Use the full menu
      // edge for horizontal placement so the submenu never covers that gutter.
      const parentRect = anchor.closest(".ctx-menu")?.getBoundingClientRect() ?? rect;
      const submenu = submenuRef.current;
      const { width, height } = submenu.getBoundingClientRect();
      const contentHeight = submenu.scrollHeight + height - submenu.clientHeight;
      const rightSide = parentRect.right + SUBMENU_GAP;
      const leftSide = parentRect.left - width - SUBMENU_GAP;
      const rightSpace = window.innerWidth - MENU_MARGIN - rightSide;
      const leftSpace = parentRect.left - SUBMENU_GAP - MENU_MARGIN;
      const preferredLeft = rightSpace >= width || rightSpace >= leftSpace ? rightSide : leftSide;
      // The desktop uses an independent transparent menu surface, so the
      // submenu can stay beside its parent and use the full screen height.
      // Do not shorten it to the space above/below the theme row, which made
      // the list overlap other actions and forced unnecessary scrolling.
      const maxHeight = Math.min(contentHeight, window.innerHeight - MENU_MARGIN * 2);
      setPosition({
        left: preferredLeft,
        top: clampToViewport(rect.top, maxHeight, window.innerHeight),
        maxHeight,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [anchor, parentPosition, language]);

  return createPortal(
    <div
      ref={submenuRef}
      className={`ctx-submenu${isLight ? " ctx-menu--light" : ""}${appearance === "yone" ? " ctx-menu--yone" : ""}${appearance === "glacier" ? " ctx-menu--glacier" : ""}`}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, maxHeight: position?.maxHeight, visibility: position ? "visible" : "hidden" }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onContextMenu={(event) => event.preventDefault()}
    >
      {themes.map(({ key, label }) => (
        <div key={key} className="ctx-item" onClick={() => onSelect(key)}>
          <span>{label}</span>
          <span className="ctx-item__trailing">
            {appearance === key ? <Check weight="bold" size={14} /> : null}
          </span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export const ContextMenu = memo(function ContextMenu({
  visible,
  x,
  y,
  onClose,
  language,
  appearance,
  locked,
  autostart,
  onToggleVisibility,
  onRefresh,
  onOpenPreferences,
  onToggleLock,
  onToggleLanguage,
  onToggleAutostart,
  onSelectTheme,
  onQuit,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const themeItemRef = useRef<HTMLDivElement>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ left: x, top: y });
  const closeTimer = useRef<number | null>(null);
  const labels = copy[normalizeLanguage(language)];
  const isLight = appearance === "light" || appearance === "glacier" || (appearance === "system" && !window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closeSubmenu = useCallback(() => {
    clearCloseTimer();
    setThemeOpen(false);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setThemeOpen(false);
      closeTimer.current = null;
    }, 180);
  }, [clearCloseTimer]);

  const openSubmenu = () => {
    clearCloseTimer();
    setThemeOpen(true);
  };

  useLayoutEffect(() => {
    if (!visible) return;
    const updatePosition = () => {
      if (!menuRef.current) return;
      const { width, height } = menuRef.current.getBoundingClientRect();
      setPosition({
        left: clampToViewport(x, width, window.innerWidth),
        top: clampToViewport(y, height, window.innerHeight),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [visible, x, y, language]);

  useEffect(() => {
    closeSubmenu();
    return clearCloseTimer;
  }, [visible, x, y, closeSubmenu, clearCloseTimer]);

  useEffect(() => {
    if (!visible) return;
    const handlePointerDown = (event: PointerEvent) => {
      // A new right click repositions the menu. Closing on its pointerdown
      // would first hide the window and then reopen it on contextmenu.
      if (event.button === 2) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".ctx-menu, .ctx-submenu")) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (themeOpen) closeSubmenu();
        else onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", onClose);
    };
  }, [visible, onClose, themeOpen, closeSubmenu]);

  if (!visible) return null;

  const select = (action: () => void) => {
    closeSubmenu();
    onClose();
    action();
  };
  const actions = [
    { key: "toggleVisibility", label: labels.ctxToggleVisibility, action: onToggleVisibility },
    { key: "refresh", label: labels.ctxRefresh, action: onRefresh },
    { key: "preferences", label: labels.ctxPreferences, action: onOpenPreferences },
    { key: "toggleLock", label: locked ? labels.ctxUnlock : labels.ctxLock, action: onToggleLock },
    { key: "language", label: labels.ctxSwitchLanguage, action: onToggleLanguage },
    { key: "autostart", label: autostart ? labels.ctxAutostartOn : labels.ctxAutostartOff, action: onToggleAutostart, checked: autostart },
  ];

  return (
    <>
      {createPortal(
        <div
          ref={menuRef}
          className={`ctx-menu${isLight ? " ctx-menu--light" : ""}${appearance === "yone" ? " ctx-menu--yone" : ""}${appearance === "glacier" ? " ctx-menu--glacier" : ""}`}
          style={position}
          onMouseLeave={scheduleClose}
          onMouseEnter={clearCloseTimer}
          onContextMenu={(event) => event.preventDefault()}
        >
          {actions.map(({ key, label, action, checked }) => (
            <div key={key} className="ctx-item" onMouseEnter={scheduleClose} onClick={() => select(action)}>
              <span>{label}</span>
              <span className="ctx-item__trailing">{checked ? <Check weight="bold" size={14} /> : null}</span>
            </div>
          ))}
          <div
            ref={themeItemRef}
            className={`ctx-item ctx-item--has-sub${themeOpen ? " ctx-item--active" : ""}`}
            onMouseEnter={openSubmenu}
            onClick={openSubmenu}
          >
            <span>{labels.ctxTheme}</span>
            <span className="ctx-item__trailing"><CaretRight size={14} /></span>
          </div>
          <div className="ctx-item" onMouseEnter={scheduleClose} onClick={() => select(onQuit)}>
            <span>{labels.ctxQuit}</span>
            <span className="ctx-item__trailing" />
          </div>
        </div>,
        document.body,
      )}
      {themeOpen ? (
        <ThemeSubmenu
          anchor={themeItemRef.current}
          parentPosition={position}
          onEnter={clearCloseTimer}
          onLeave={scheduleClose}
          onSelect={(theme) => select(() => onSelectTheme(theme))}
          language={language}
          appearance={appearance}
          isLight={isLight}
        />
      ) : null}
    </>
  );
});
