import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  calls: [] as string[],
  invoke: vi.fn(async (command: string, args?: { open?: boolean }): Promise<unknown> => {
    api.calls.push(`start:${command}`);
    await Promise.resolve();
    api.calls.push(`end:${command}`);
    if (command === "set_widget_menu_open") return { x: 0, y: 0 };
  }),
  currentMonitor: vi.fn(async () => ({
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ currentMonitor: api.currentMonitor }));

beforeEach(() => {
  vi.clearAllMocks();
  api.calls.length = 0;
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
});

describe("widget transitions", () => {
  it("passes the monitor work area to the Rust expansion command", async () => {
    const { setWidgetExpanded } = await import("./bridge");
    await setWidgetExpanded(true);
    expect(api.invoke).toHaveBeenCalledWith("expand_widget", {
      workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
    });
  });

  it("serializes rapid expand and collapse requests", async () => {
    const { setWidgetExpanded } = await import("./bridge");
    await Promise.all([setWidgetExpanded(true), setWidgetExpanded(false)]);
    expect(api.calls).toEqual([
      "start:expand_widget",
      "end:expand_widget",
      "start:collapse_widget",
      "end:collapse_widget",
    ]);
  });

  it("opens the separate menu in order without moving the widget root", async () => {
    const setProperty = vi.fn();
    vi.stubGlobal("document", { documentElement: { style: { setProperty } } });
    const { setWidgetExpanded, setWidgetMenuOpen } = await import("./bridge");
    await Promise.all([
      setWidgetExpanded(true), setWidgetMenuOpen(true),
      setWidgetMenuOpen(false), setWidgetExpanded(false),
    ]);
    expect(api.calls).toEqual([
      "start:expand_widget", "end:expand_widget",
      "start:set_widget_menu_open", "end:set_widget_menu_open",
      "start:set_widget_menu_open", "end:set_widget_menu_open",
      "start:collapse_widget", "end:collapse_widget",
    ]);
    expect(setProperty).not.toHaveBeenCalled();
  });

  it.each([false, true])("passes click-through=%s to the desktop command", async (locked) => {
    const { setClickThrough } = await import("./bridge");
    await setClickThrough(locked);
    expect(api.invoke).toHaveBeenCalledWith("set_widget_locked", { locked });
  });

  it("passes the selected background data URL to the desktop command", async () => {
    const { setWidgetBackgroundImage } = await import("./bridge");
    const image = "data:image/png;base64,aGVsbG8=";
    await setWidgetBackgroundImage(image);
    expect(api.invoke).toHaveBeenCalledWith("set_widget_background_image", { customBackgroundImage: image });
  });

  it("loads and clears quota history through the desktop commands", async () => {
    const { clearQuotaHistory, getQuotaHistory } = await import("./bridge");
    await getQuotaHistory();
    await clearQuotaHistory();
    expect(api.invoke).toHaveBeenNthCalledWith(1, "get_quota_history");
    expect(api.invoke).toHaveBeenNthCalledWith(2, "clear_quota_history");
  });
});
