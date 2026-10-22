// @vitest-environment jsdom
/** @author MoShangHuaKai */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContextMenuWindow } from "./ContextMenuWindow";
import type { ContextMenuState } from "./ContextMenu";
import desktopConfig from "../../src-tauri/tauri.conf.json";

const api = vi.hoisted(() => ({
  pending: null as ContextMenuState | null,
  open: undefined as undefined | ((event: { payload: ContextMenuState }) => void),
  focus: undefined as undefined | ((event: { payload: boolean }) => void),
  invoke: vi.fn(async (command: string) => command === "get_context_menu" ? api.pending : undefined),
  emitTo: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: api.emitTo,
  listen: vi.fn(async (_name, callback) => { api.open = callback; return () => {}; }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async (callback: typeof api.focus) => { api.focus = callback; return () => {}; } }),
}));
vi.mock("../lib/bridge", () => ({ setWidgetMenuOpen: api.close }));

const menu: ContextMenuState = {
  requestId: 1, x: 40, y: 40, language: "zh-CN", appearance: "glacier", locked: false, autostart: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.pending = menu;
  api.open = undefined;
  api.focus = undefined;
  // Reproduce a hidden WebView that suspends rAF callbacks entirely.
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("preloads a hidden native window for the desktop menu route", () => {
  // The frontend and Rust commands require this window to exist at startup.
  // A component-only test cannot detect a missing native window declaration:
  // the widget still renders, but every desktop right click fails before the
  // menu page can receive its opening event.
  expect(desktopConfig.app.windows.find(({ label }) => label === "context-menu"))
    .toMatchObject({ url: "index.html?contextMenu", visible: false, transparent: true });
});

it("opens even when the hidden WebView suspends animation frames", async () => {
  await act(async () => { render(<ContextMenuWindow />); });
  expect(screen.getByText("主题")).toBeTruthy();
  expect(api.invoke).not.toHaveBeenCalledWith("show_context_menu", expect.anything());
  await act(async () => { vi.advanceTimersByTime(80); });
  expect(api.invoke).toHaveBeenCalledWith("show_context_menu", { requestId: 1 });
});

it("suppresses the browser menu when right-clicking outside the themed popup", async () => {
  await act(async () => { render(<ContextMenuWindow />); });
  const secondClick = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  document.body.dispatchEvent(secondClick);
  expect(secondClick.defaultPrevented).toBe(true);
  expect(document.querySelector(".ctx-menu")).not.toBeNull();
  expect(api.close).not.toHaveBeenCalled();
});

it("does not show a dismissed popup after its delayed paint callback", async () => {
  await act(async () => { render(<ContextMenuWindow />); });
  await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
  await act(async () => { vi.advanceTimersByTime(100); });
  expect(api.close).toHaveBeenCalledExactlyOnceWith(false, menu);
  expect(api.invoke).not.toHaveBeenCalledWith("show_context_menu", expect.anything());
});

it("cancels the previous opening when another right-click request arrives", async () => {
  await act(async () => { render(<ContextMenuWindow />); });
  await act(async () => { api.open?.({ payload: { ...menu, requestId: 2, x: 100 } }); });
  await act(async () => { vi.advanceTimersByTime(80); });
  expect(api.invoke).toHaveBeenCalledWith("show_context_menu", { requestId: 2 });
  expect(api.invoke).not.toHaveBeenCalledWith("show_context_menu", { requestId: 1 });
});

it("dispatches theme selection once and closes only its own opening", async () => {
  await act(async () => { render(<ContextMenuWindow />); });
  fireEvent.mouseEnter(screen.getByText("主题"));
  await act(async () => { fireEvent.click(screen.getByText("浅色")); });
  expect(api.close).toHaveBeenCalledExactlyOnceWith(false, menu);
  expect(api.emitTo).toHaveBeenCalledExactlyOnceWith("widget", "context-menu-action", { action: "theme", theme: "light" });
});

it("dismisses on native focus loss without waiting for DOM blur", async () => {
  await act(async () => { render(<ContextMenuWindow />); });
  await act(async () => { api.focus?.({ payload: false }); });
  expect(api.close).toHaveBeenCalledExactlyOnceWith(false, menu);
  expect(document.querySelector(".ctx-menu")).toBeNull();
});
