// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { TokenActivity } from "../types";
import { TokenActivityPanel } from "./TokenActivityPanel";

afterEach(cleanup);

it.each<TokenActivity | null>([
  null,
  { daily: [], totalTokens: null },
  { daily: [{ startAt: "invalid", tokenCount: 100 }], totalTokens: 100 },
  { daily: [{ startAt: "2026-09-25", tokenCount: -1 }], totalTokens: null },
])("keeps unavailable API data empty in every view: %j", (activity) => {
  const { container } = render(<TokenActivityPanel activity={activity} language="zh-CN" />);
  for (const name of ["每日", "每周", "累计"]) {
    const tab = screen.getByRole("tab", { name });
    fireEvent.click(tab);
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("额度接口未返回可用的 Token 统计")).toBeTruthy();
    expect(screen.getByText(`仅展示接口数据，不读取本地会话 · ${name}`)).toBeTruthy();
    expect(container.querySelector("svg, .token-activity__weekly-grid, .token-activity__total")).toBeNull();
    expect(screen.queryByText(/等待/)).toBeNull();
  }
});

it("explains the API-only boundary in English", () => {
  render(<TokenActivityPanel activity={null} language="en" />);
  expect(screen.getByText("No Codex token usage records found")).toBeTruthy();
  expect(screen.getByText("API data only; local sessions are not read · Daily")).toBeTruthy();
});

it("renders API buckets across views and returns to empty when they disappear", () => {
  const today = new Date().toISOString().slice(0, 10);
  const activity: TokenActivity = {
    daily: [{ startAt: today, tokenCount: 100 }, { startAt: today, tokenCount: 200 }],
    totalTokens: 300,
  };
  const { container, rerender } = render(<TokenActivityPanel activity={activity} language="zh-CN" />);
  expect(screen.getByRole("img", { name: "Token 活动" })).toBeTruthy();
  const cell = container.querySelector('[aria-label$="使用了 300 个 Token"]')!;
  expect(cell).not.toBeNull();
  fireEvent.mouseEnter(cell);
  expect(screen.getByRole("status").textContent).toContain("使用了 300 个 Token");
  fireEvent.click(screen.getByRole("tab", { name: "每周" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  fireEvent.mouseEnter(screen.getByRole("listitem"));
  expect(screen.getByRole("status").textContent).toContain("使用了 300 个 Token");
  fireEvent.click(screen.getByRole("tab", { name: "累计" }));
  expect(screen.getByText("累计 300 个 Token")).toBeTruthy();
  expect(screen.getByText(/1 个活跃日/)).toBeTruthy();
  rerender(<TokenActivityPanel activity={null} language="zh-CN" />);
  expect(screen.getByText("额度接口未返回可用的 Token 统计")).toBeTruthy();
  expect(container.querySelector(".token-activity__total")).toBeNull();
});

it("distinguishes a valid zero count from unavailable data", () => {
  render(<TokenActivityPanel activity={{ daily: [{ startAt: new Date().toISOString(), tokenCount: 0 }], totalTokens: 0 }} language="zh-CN" />);
  expect(screen.getByRole("img")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "累计" }));
  expect(screen.getByText("累计 0 个 Token")).toBeTruthy();
  expect(screen.getByText(/0 个活跃日/)).toBeTruthy();
});
