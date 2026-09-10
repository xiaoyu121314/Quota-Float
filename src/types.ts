export type ProviderId = "codex" | "claude";
export type SnapshotStatus = "ok" | "stale" | "loading" | "unavailable" | "signed_out";
export type Language = "zh-CN" | "en";
export type QuotaRadarRange = "24h" | "7d" | "30d";

/**
 * The deliberately small persisted record used by the quota radar.
 *
 * This is not a copy of ProviderSnapshot: no plan, reset-credit metadata,
 * account identifier, message, token, or raw backend payload is retained.
 */
export interface QuotaHistoryPoint {
  provider: ProviderId;
  capturedAt: string;
  status: "ok";
  shortRemainingPercent: number | null;
  weeklyRemainingPercent: number | null;
}

export type QuotaTrendStatus = "collecting" | "steady" | "decreasing";

export interface QuotaTrend {
  status: QuotaTrendStatus;
  points: QuotaHistoryPoint[];
  analysisPoints: QuotaHistoryPoint[];
  sampleCount: number;
  spanMs: number;
  latestPercent: number | null;
  changePercent: number | null;
  burnRatePerHour: number | null;
  estimatedExhaustionAt: string | null;
  willExhaustBeforeReset: boolean | null;
}
/**
 * Visual themes that can be selected from the desktop tray menu.
 *
 * `sakura`, `warm`, `city`, and `home` are first-class themes rather than
 * dark-mode overrides so their palettes and persisted selections stay
 * independent from the built-in themes.
 */
export type WidgetTheme = "light" | "dark" | "sakura" | "warm" | "city" | "home";
export type AppearancePreference = "system" | WidgetTheme;
export interface UsageWindow {
  remainingPercent: number;
  resetsAt: string | null;
  windowSeconds: number;
}

export interface ProviderSnapshot {
  provider: ProviderId;
  displayName: string;
  plan: string | null;
  shortWindow: UsageWindow | null;
  weeklyWindow: UsageWindow | null;
  resetCredits: number | null;
  resetCreditExpiresAt?: string[];
  updatedAt: string;
  status: SnapshotStatus;
  message: string | null;
}

export interface WidgetPreferences {
  locked: boolean;
  alwaysOnTop: boolean;
  stayExpanded: boolean;
  pinnedProvider: ProviderId | null;
  autoRotateSeconds: number;
  language: Language;
  appearance: AppearancePreference;
  opacity: number;
}
