// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { fetchSnapshots, getPreferences, isTauri, listenContextMenuActions, setClickThrough, setWidgetExpanded, setWidgetMenuOpen, syncWidgetAppearance, updatePreferences } from "./lib/bridge";

vi.mock("./lib/bridge", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lib/bridge")>();
  return {
    ...original,
    isTauri: vi.fn(original.isTauri),
    listenContextMenuActions: vi.fn(original.listenContextMenuActions),
    setWidgetMenuOpen: vi.fn(original.setWidgetMenuOpen),
    fetchSnapshots: vi.fn(original.fetchSnapshots),
    getPreferences: vi.fn(original.getPreferences),
    setClickThrough: vi.fn(original.setClickThrough),
    setWidgetExpanded: vi.fn(async () => {}),
    syncWidgetAppearance: vi.fn(async () => {}),
    updatePreferences: vi.fn(async () => {}),
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("expands for a right click on the orb and prevents collapse while its menu is open", async () => {
  await act(async () => { render(<App />); });
  expect(document.querySelector(".quota-orb")).not.toBeNull();
  await act(async () => {
    fireEvent.contextMenu(document.querySelector("main")!, { clientX: 40, clientY: 40 });
  });
  expect(setWidgetExpanded).toHaveBeenCalledWith(true);
  expect(document.querySelector(".quota-card")).not.toBeNull();
  fireEvent.mouseLeave(document.querySelector("main")!);
  act(() => vi.advanceTimersByTime(500));
  expect(setWidgetExpanded).not.toHaveBeenCalledWith(false);
  expect(document.querySelector(".quota-card")).not.toBeNull();
  expect(document.querySelector(".ctx-menu")).not.toBeNull();
  fireEvent.pointerDown(document.body);
  act(() => vi.advanceTimersByTime(200));
  expect(document.querySelector(".ctx-menu")).toBeNull();
  expect(document.querySelector(".quota-orb")).not.toBeNull();
  expect(setWidgetExpanded).toHaveBeenCalledWith(false);
});

it("does not resize an already expanded card for a right click", async () => {
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.mouseEnter(document.querySelector("main")!); });
  expect(document.querySelector(".quota-card")).not.toBeNull();
  vi.mocked(setWidgetExpanded).mockClear();
  await act(async () => {
    fireEvent.contextMenu(document.querySelector("main")!, { clientX: 40, clientY: 40 });
  });
  expect(setWidgetExpanded).not.toHaveBeenCalled();
  expect(document.querySelector(".ctx-menu")).not.toBeNull();
});

it.each([
  { language: "zh-CN" as const, message: "右键菜单打开失败，请重试。" },
  { language: "en" as const, message: "Context menu could not be opened. Try again." },
])("reports a native menu failure in $language and clears it after retry", async ({ language, message }) => {
  vi.mocked(getPreferences).mockResolvedValueOnce({ ...await getPreferences(), language });
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(setWidgetMenuOpen).mockRejectedValueOnce(new Error("context menu window missing"));
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.mouseEnter(document.querySelector("main")!); });
  await act(async () => {
    fireEvent.contextMenu(document.querySelector("main")!, { clientX: 40, clientY: 40 });
  });
  expect(screen.getByText(message)).toBeTruthy();
  expect(document.querySelector(".quota-card")).not.toBeNull();
  await act(async () => {
    fireEvent.contextMenu(document.querySelector("main")!, { clientX: 40, clientY: 40 });
  });
  expect(screen.queryByText(message)).toBeNull();
  expect(vi.mocked(setWidgetMenuOpen).mock.calls.filter(([open]) => open)).toHaveLength(2);
  // A successful retry must also restore the guard that keeps the card open
  // while its native menu owns focus outside the widget's WebView.
  fireEvent.mouseLeave(document.querySelector("main")!);
  act(() => vi.advanceTimersByTime(300));
  expect(setWidgetExpanded).not.toHaveBeenCalledWith(false);
});

it("ignores an old popup-close notification after another native right click", async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.mouseEnter(document.querySelector("main")!); });
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      fireEvent.contextMenu(document.querySelector("main")!, { clientX: 40, clientY: 40 });
    });
  }
  const openings = vi.mocked(setWidgetMenuOpen).mock.calls.filter(([open]) => open);
  const oldId = openings[0][1]!.requestId;
  const newId = openings[1][1]!.requestId;
  expect(newId).toBeGreaterThan(oldId);
  expect(document.querySelector(".ctx-menu")).toBeNull();
  const notify = vi.mocked(listenContextMenuActions).mock.calls.at(-1)![0];
  await act(async () => { notify({ action: "close", requestId: oldId }); });
  fireEvent.mouseLeave(document.querySelector("main")!);
  act(() => vi.advanceTimersByTime(300));
  expect(setWidgetExpanded).not.toHaveBeenCalledWith(false);
  await act(async () => { notify({ action: "close", requestId: newId }); });
  act(() => vi.advanceTimersByTime(300));
  expect(setWidgetExpanded).toHaveBeenCalledWith(false);
});

it.each([
  { theme: "naruto", label: "六道·鸣人", progressEnd: "#FFD45A" },
  { theme: "yone", label: "灵魂莲华·永恩", progressEnd: "#8466B4" },
  { theme: "glacier", label: "冰川极光", progressEnd: "#5BAFB5" },
  { theme: "yunlin", label: "云间灵尾", progressEnd: "#EFB0D8" },
])("selects $theme from the menu and keeps its palette after collapsing", async ({ theme, label, progressEnd }) => {
  await act(async () => { render(<App />); });
  await act(async () => {
    fireEvent.contextMenu(document.querySelector("main")!, { clientX: 40, clientY: 40 });
  });
  fireEvent.mouseEnter(screen.getByText("主题"));
  await act(async () => { fireEvent.click(screen.getByText(label)); });
  expect(updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ appearance: theme }));
  expect(syncWidgetAppearance).toHaveBeenLastCalledWith(theme);
  const card = document.querySelector<HTMLElement>(`.quota-card--theme-${theme}`)!;
  expect(card).not.toBeNull();
  expect(card.style.getPropertyValue("--progress-end")).toBe(progressEnd);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("74");
  fireEvent.mouseLeave(card);
  act(() => vi.advanceTimersByTime(500));
  const orb = document.querySelector<HTMLElement>(`.quota-orb--theme-${theme}`)!;
  expect(orb).not.toBeNull();
  expect(orb.style.getPropertyValue("--progress-end")).toBe(progressEnd);
  expect(Boolean(orb.querySelector(".quota-ring"))).toBe(theme === "yone" || theme === "glacier" || theme === "yunlin");
});

it.each([
  { appearance: "naruto" as const, stayExpanded: false },
  { appearance: "naruto" as const, stayExpanded: true },
  { appearance: "yone" as const, stayExpanded: false },
  { appearance: "yone" as const, stayExpanded: true },
  { appearance: "glacier" as const, stayExpanded: false },
  { appearance: "glacier" as const, stayExpanded: true },
  { appearance: "yunlin" as const, stayExpanded: false },
  { appearance: "yunlin" as const, stayExpanded: true },
])("loads a persisted $appearance theme with stayExpanded=$stayExpanded", async ({ appearance, stayExpanded }) => {
  vi.mocked(getPreferences).mockResolvedValueOnce({ ...await getPreferences(), appearance, stayExpanded });
  await act(async () => { render(<App />); });
  expect(document.querySelector(`.quota-${stayExpanded ? "card" : "orb"}--theme-${appearance}`)).not.toBeNull();
  expect(syncWidgetAppearance).toHaveBeenLastCalledWith(appearance);
});

it.each((["yone", "glacier", "yunlin"] as const).flatMap((appearance) => [-5, 0, 8, 35, 74, 100, 110].map((remainingPercent) => ({ appearance, remainingPercent }))))("renders the $appearance quota ring for $remainingPercent percent", async ({ appearance, remainingPercent }) => {
  const [snapshot] = await fetchSnapshots();
  vi.mocked(fetchSnapshots).mockResolvedValueOnce([{ ...snapshot, shortWindow: { ...snapshot.shortWindow!, remainingPercent } }]);
  vi.mocked(getPreferences).mockResolvedValueOnce({ ...await getPreferences(), appearance });
  await act(async () => { render(<App />); });
  const expected = Math.min(100, Math.max(0, remainingPercent));
  expect(document.querySelector(".quota-ring__value")?.getAttribute("stroke-dasharray")).toBe(`${expected} 100`);
  expect(document.querySelector(".orb-metric span")?.textContent).toBe(String(expected));
});

it.each(["yone", "glacier", "yunlin"] as const)("uses the weekly quota for the %s ring when the short window is missing", async (appearance) => {
  const [snapshot] = await fetchSnapshots();
  vi.mocked(fetchSnapshots).mockResolvedValueOnce([{ ...snapshot, shortWindow: null }]);
  vi.mocked(getPreferences).mockResolvedValueOnce({ ...await getPreferences(), appearance });
  await act(async () => { render(<App />); });
  expect(document.querySelector(".quota-ring__value")?.getAttribute("stroke-dasharray")).toBe("42 100");
  expect(document.querySelector(".orb-weekly-badge")?.textContent).toBe("W");
});

it.each((["yone", "glacier", "yunlin"] as const).flatMap((appearance) => (["unavailable", "stale", "signed_out", "loading"] as const).map((status) => ({ appearance, status }))))("hides the $appearance quota ring for $status data", async ({ appearance, status }) => {
  const [snapshot] = await fetchSnapshots();
  vi.mocked(fetchSnapshots).mockResolvedValueOnce([{ ...snapshot, status }]);
  vi.mocked(getPreferences).mockResolvedValueOnce({ ...await getPreferences(), appearance });
  await act(async () => { render(<App />); });
  expect(document.querySelector(".quota-ring")).toBeNull();
  expect(document.querySelector(".orb-unavailable")).not.toBeNull();
});

it("cancels an already scheduled collapse when opening the menu", async () => {
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.mouseEnter(document.querySelector("main")!); });
  fireEvent.mouseLeave(document.querySelector("main")!);
  await act(async () => {
    fireEvent.contextMenu(document.querySelector("main")!, { clientX: 300, clientY: 300 });
  });
  act(() => vi.advanceTimersByTime(500));
  expect(setWidgetExpanded).not.toHaveBeenCalledWith(false);
  expect(document.querySelector(".quota-card")).not.toBeNull();
  expect(document.querySelector(".ctx-menu")).not.toBeNull();
});

it.each([
  { locked: false, stayExpanded: false },
  { locked: true, stayExpanded: false },
  { locked: false, stayExpanded: true },
  { locked: true, stayExpanded: true },
])("toggles click-through both ways from locked=$locked, stayExpanded=$stayExpanded", async ({ locked, stayExpanded }) => {
  const preferences = { ...await getPreferences(), locked, stayExpanded };
  vi.mocked(getPreferences).mockResolvedValueOnce(preferences);
  vi.mocked(setClickThrough)
    .mockResolvedValueOnce({ ...preferences, locked: !locked })
    .mockResolvedValueOnce(preferences);
  await act(async () => { render(<App />); });
  expect(document.querySelector(stayExpanded ? ".quota-card" : ".quota-orb")).not.toBeNull();
  await act(async () => {
    fireEvent.contextMenu(document.querySelector("main")!, { clientX: 40, clientY: 40 });
  });
  await act(async () => { fireEvent.click(screen.getByText(locked ? "解锁悬浮窗" : "锁定悬浮窗")); });
  expect(setClickThrough).toHaveBeenCalledExactlyOnceWith(!locked);
  expect(document.querySelector(".ctx-menu")).toBeNull();
  expect(Boolean(document.querySelector(".card-actions"))).toBe(locked);
  await act(async () => {
    fireEvent.contextMenu(document.querySelector("main")!, { clientX: 40, clientY: 40 });
  });
  await act(async () => { fireEvent.click(screen.getByText(locked ? "锁定悬浮窗" : "解锁悬浮窗")); });
  expect(setClickThrough).toHaveBeenNthCalledWith(2, locked);
  expect(document.querySelector(".ctx-menu")).toBeNull();
  expect(Boolean(document.querySelector(".card-actions"))).toBe(!locked);
});

it.each([false, true])("preserves locked=%s when the click-through command fails", async (locked) => {
  vi.mocked(getPreferences).mockResolvedValueOnce({ ...await getPreferences(), locked });
  vi.mocked(setClickThrough).mockRejectedValueOnce(new Error("failed to toggle click-through"));
  await act(async () => { render(<App />); });
  await act(async () => {
    fireEvent.contextMenu(document.querySelector("main")!, { clientX: 40, clientY: 40 });
  });
  const label = locked ? "解锁悬浮窗" : "锁定悬浮窗";
  await act(async () => { fireEvent.click(screen.getByText(label)); });
  expect(setClickThrough).toHaveBeenCalledExactlyOnceWith(!locked);
  expect(screen.getByText("设置保存失败，已恢复之前的状态。")).toBeTruthy();
  expect(Boolean(document.querySelector(".card-actions"))).toBe(!locked);
  await act(async () => {
    fireEvent.contextMenu(document.querySelector("main")!, { clientX: 40, clientY: 40 });
  });
  expect(screen.getByText(label)).toBeTruthy();
});
