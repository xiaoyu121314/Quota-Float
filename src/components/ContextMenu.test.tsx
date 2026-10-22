// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";
import { DESKTOP_PALETTES } from "../lib/desktopPalette";

function createProps() {
  return {
    visible: true, x: 94, y: 56, language: "zh-CN" as const,
    appearance: "dark" as const, locked: false, autostart: false,
    onClose: vi.fn(), onToggleVisibility: vi.fn(), onRefresh: vi.fn(),
    onOpenPreferences: vi.fn(), onToggleLock: vi.fn(), onToggleLanguage: vi.fn(),
    onToggleAutostart: vi.fn(), onSelectTheme: vi.fn(), onQuit: vi.fn(),
  };
}

function viewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function assertContained(selector: string) {
  const element = document.querySelector<HTMLElement>(selector)!;
  expect(element).not.toBeNull();
  expect(parseFloat(element.style.left)).toBeGreaterThanOrEqual(4);
  expect(parseFloat(element.style.top)).toBeGreaterThanOrEqual(4);
  expect(parseFloat(element.style.left) + element.offsetWidth).toBeLessThanOrEqual(window.innerWidth - 4);
  expect(parseFloat(element.style.top) + element.offsetHeight).toBeLessThanOrEqual(window.innerHeight - 4);
}

beforeEach(() => {
  viewport(760, 560);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return Math.min(this.classList.contains("ctx-submenu") ? 180 : 200, window.innerWidth - 8);
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return Math.min(this.classList.contains("ctx-submenu") ? 224 : 254, window.innerHeight - 8, parseFloat(this.style.maxHeight) || Infinity);
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.offsetHeight - 2;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("ctx-submenu") ? 222 : 252;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.matches(".ctx-menu, .ctx-submenu")) {
      return new DOMRect(parseFloat(this.style.left) || 0, parseFloat(this.style.top) || 0, this.offsetWidth, this.offsetHeight);
    }
    const menu = this.closest<HTMLElement>(".ctx-menu");
    return new DOMRect(parseFloat(menu?.style.left ?? "0") + 1, parseFloat(menu?.style.top ?? "0") + 187, 198, 30);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("context menu geometry", () => {
  it.each([[94, 56], [0, 0], [759, 0], [0, 559], [759, 559]])("keeps menus beside each other at %i,%i on the desktop surface", (x, y) => {
    render(<ContextMenu {...createProps()} x={x} y={y} />);
    fireEvent.mouseEnter(screen.getByText("主题"));
    assertContained(".ctx-menu");
    assertContained(".ctx-submenu");
    const parent = document.querySelector(".ctx-menu")!.getBoundingClientRect();
    const submenu = document.querySelector(".ctx-submenu")!.getBoundingClientRect();
    expect(submenu.right <= parent.left || submenu.left >= parent.right).toBe(true);
    expect(submenu.height).toBe(224);
    expect(document.querySelectorAll(".ctx-submenu .ctx-item")).toHaveLength(Object.keys(DESKTOP_PALETTES).length + 1);
  });

  it.each([[100, 304], [780, 596]])("places the submenu beside the parent when space is available at %i", (x, expectedLeft) => {
    viewport(1000, 800);
    render(<ContextMenu {...createProps()} x={x} y={100} />);
    fireEvent.mouseEnter(screen.getByText("主题"));
    expect(document.querySelector<HTMLElement>(".ctx-submenu")?.style.left).toBe(`${expectedLeft}px`);
    assertContained(".ctx-submenu");
  });

  it("keeps the submenu beside its parent when the screen height requires scrolling", () => {
    viewport(1000, 800);
    render(<ContextMenu {...createProps()} x={800} y={700} />);
    fireEvent.mouseEnter(screen.getByText("主题"));
    viewport(760, 200);
    fireEvent(window, new Event("resize"));
    assertContained(".ctx-menu");
    assertContained(".ctx-submenu");
  });
});

describe("context menu interaction", () => {
  it("does not close on right pointerdown before a menu reposition", () => {
    const props = createProps();
    render(<ContextMenu {...props} />);
    // jsdom does not implement PointerEvent's button property on its own.
    const event = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(event, "button", { value: 2 });
    fireEvent(document.body, event);
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it.each([
    { language: "zh-CN" as const, locked: false, label: "锁定悬浮窗" },
    { language: "zh-CN" as const, locked: true, label: "解锁悬浮窗" },
    { language: "en" as const, locked: false, label: "Lock widget" },
    { language: "en" as const, locked: true, label: "Unlock widget" },
  ])("shows $label and toggles the lock once", ({ language, locked, label }) => {
    const props = createProps();
    render(<ContextMenu {...props} language={language} locked={locked} />);
    fireEvent.click(screen.getByText(label));
    expect(props.onToggleLock).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["跟随系统", "system"], ["深色", "dark"], ["浅色", "light"],
    ["樱花夜", "sakura"], ["温暖·日常橙", "warm"],
    ["城市·暮色紫", "city"], ["居家·夜晚", "home"], ["六道·鸣人", "naruto"],
    ["灵魂莲华·永恩", "yone"],
    ["冰川极光", "glacier"],
    ["云间灵尾", "yunlin"],
  ])("keeps %s open on hover and selects it once", (label, theme) => {
    vi.useFakeTimers();
    const props = createProps();
    render(<ContextMenu {...props} />);
    fireEvent.mouseEnter(screen.getByText("主题"));
    fireEvent.mouseLeave(document.querySelector(".ctx-menu")!);
    act(() => vi.advanceTimersByTime(80));
    const item = screen.getByText(label);
    fireEvent.mouseEnter(item);
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector(".ctx-submenu")).not.toBeNull();
    fireEvent.click(item);
    expect(props.onSelectTheme).toHaveBeenCalledExactlyOnceWith(theme);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("renders both Yone menus in pink and selects the English theme label", () => {
    const props = createProps();
    render(<ContextMenu {...props} appearance="yone" language="en" />);
    fireEvent.mouseEnter(screen.getByText("Theme"));
    expect(document.querySelector(".ctx-menu.ctx-menu--yone")).not.toBeNull();
    expect(document.querySelector(".ctx-submenu.ctx-menu--yone")).not.toBeNull();
    fireEvent.click(screen.getByText("Spirit Blossom · Yone"));
    expect(props.onSelectTheme).toHaveBeenCalledExactlyOnceWith("yone");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the Glacier palette for both menus and selects the English theme label", () => {
    const props = createProps();
    render(<ContextMenu {...props} appearance="glacier" language="en" />);
    fireEvent.mouseEnter(screen.getByText("Theme"));
    expect(document.querySelector(".ctx-menu.ctx-menu--glacier")).not.toBeNull();
    expect(document.querySelector(".ctx-submenu.ctx-menu--glacier")).not.toBeNull();
    fireEvent.click(screen.getByText("Glacier Aurora"));
    expect(props.onSelectTheme).toHaveBeenCalledExactlyOnceWith("glacier");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the Yunlin palette for both menus and selects the English theme label", () => {
    const props = createProps();
    render(<ContextMenu {...props} appearance="yunlin" language="en" />);
    fireEvent.mouseEnter(screen.getByText("Theme"));
    expect(document.querySelector(".ctx-menu.ctx-menu--yunlin")).not.toBeNull();
    expect(document.querySelector(".ctx-submenu.ctx-menu--yunlin")).not.toBeNull();
    fireEvent.click(screen.getByText("Cloud Spirit Tails"));
    expect(props.onSelectTheme).toHaveBeenCalledExactlyOnceWith("yunlin");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("allows crossing the gap back to the parent before closing", () => {
    vi.useFakeTimers();
    render(<ContextMenu {...createProps()} />);
    fireEvent.mouseEnter(screen.getByText("主题"));
    fireEvent.mouseLeave(document.querySelector(".ctx-submenu")!);
    act(() => vi.advanceTimersByTime(80));
    fireEvent.mouseEnter(screen.getByText("主题"));
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector(".ctx-submenu")).not.toBeNull();
    fireEvent.mouseLeave(document.querySelector(".ctx-submenu")!);
    act(() => vi.advanceTimersByTime(200));
    expect(document.querySelector(".ctx-submenu")).toBeNull();
  });

  it("closes the submenu on Escape before closing the main menu", () => {
    const props = createProps();
    render(<ContextMenu {...props} />);
    fireEvent.click(screen.getByText("主题"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".ctx-submenu")).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("distinguishes submenu clicks from outside clicks", () => {
    const props = createProps();
    render(<ContextMenu {...props} />);
    fireEvent.mouseEnter(screen.getByText("主题"));
    fireEvent.pointerDown(screen.getByText("深色"));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not restore the submenu or its timer after reopening", () => {
    vi.useFakeTimers();
    const props = createProps();
    const { rerender } = render(<ContextMenu {...props} />);
    fireEvent.mouseEnter(screen.getByText("主题"));
    fireEvent.mouseLeave(document.querySelector(".ctx-submenu")!);
    rerender(<ContextMenu {...props} visible={false} />);
    rerender(<ContextMenu {...props} x={20} y={20} />);
    expect(document.querySelector(".ctx-submenu")).toBeNull();
    fireEvent.mouseEnter(screen.getByText("主题"));
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector(".ctx-submenu")).not.toBeNull();
  });

  it("allows passing another parent action on the way into the submenu", () => {
    vi.useFakeTimers();
    render(<ContextMenu {...createProps()} />);
    fireEvent.mouseEnter(screen.getByText("主题"));
    fireEvent.mouseEnter(screen.getByText("不随 Codex 启动"));
    act(() => vi.advanceTimersByTime(80));
    fireEvent.mouseEnter(screen.getByText("跟随系统"));
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector(".ctx-submenu")).not.toBeNull();
  });

  it("closes themes after hovering another action and preserves the action", () => {
    vi.useFakeTimers();
    const props = createProps();
    render(<ContextMenu {...props} />);
    fireEvent.mouseEnter(screen.getByText("主题"));
    fireEvent.mouseEnter(screen.getByText("立即刷新"));
    act(() => vi.advanceTimersByTime(200));
    expect(document.querySelector(".ctx-submenu")).toBeNull();
    fireEvent.click(screen.getByText("立即刷新"));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
