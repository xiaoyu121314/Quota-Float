/**
 * @author MoShangHuaKai
 *
 * Desktop preferences panel for settings that need continuous input instead
 * of a fixed tray-menu choice.
 */
import { useEffect, useState, type ChangeEvent } from "react";
import { getPreferences, listenDesktopEvents, setClickThrough, setWidgetBackgroundImage, setWidgetLiquidGlass, setWidgetOpacity } from "../lib/bridge";
import {
  isSupportedBackgroundType,
  MAX_BACKGROUND_FILE_BYTES,
  readImageAsDataUrl,
} from "../lib/backgroundImage";
import { BackgroundCropEditor } from "./BackgroundCropEditor";
import type { AppearancePreference, WidgetTheme } from "../types";

const DEFAULT_OPACITY = 100;

export function SettingsPanel() {
  const [appearance, setAppearance] = useState<AppearancePreference>("light");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  // Resolve system appearance at render time so OS changes and desktop theme
  // broadcasts share the same palette without persisting a second preference.
  const theme: WidgetTheme = appearance === "system" ? (systemDark ? "dark" : "light") : appearance;
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY);
  const [clickThrough, setClickThroughState] = useState(false);
  const [liquidGlassEnabled, setLiquidGlassEnabled] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [pendingBackgroundImage, setPendingBackgroundImage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clickThroughSaving, setClickThroughSaving] = useState(false);
  const [liquidGlassSaving, setLiquidGlassSaving] = useState(false);
  const [backgroundSaving, setBackgroundSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: () => void = () => {};
    void getPreferences().then((preferences) => {
      if (!cancelled) {
        setAppearance(preferences.appearance);
        setOpacity(preferences.opacity);
        setClickThroughState(preferences.locked);
        setLiquidGlassEnabled(preferences.liquidGlassEnabled);
        setBackgroundImage(preferences.customBackgroundImage);
        setReady(true);
      }
    }).catch(() => {
      if (!cancelled) {
        setError("无法读取当前设置。");
        setReady(true);
      }
    });
    void listenDesktopEvents({
      onPreferences: (preferences) => {
        setAppearance(preferences.appearance);
        setOpacity(preferences.opacity);
        setClickThroughState(preferences.locked);
        setLiquidGlassEnabled(preferences.liquidGlassEnabled);
        setBackgroundImage(preferences.customBackgroundImage);
      },
      onRefresh: () => undefined,
    }).then((unlisten) => {
      if (cancelled) unlisten(); else cleanup = unlisten;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    // The settings WebView is independent of the widget. Subscribe here too
    // so an already-open panel follows Windows light/dark changes immediately.
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => setSystemDark(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      setError(null);
      void setWidgetOpacity(opacity)
        .catch(() => setError("透明度保存失败，请重试。"))
        .finally(() => setSaving(false));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [opacity, ready]);

  const handleClickThroughChange = (nextValue: boolean) => {
    const previousValue = clickThrough;
    // Update the switch immediately so the setting feels responsive. The
    // native command persists the value and applies it to the widget window;
    // if either step fails, restore the last known value and keep the error
    // visible in the status line below the controls.
    setClickThroughState(nextValue);
    setClickThroughSaving(true);
    setError(null);
    void setClickThrough(nextValue)
      .then((preferences) => setClickThroughState(preferences.locked))
      .catch(() => {
        setClickThroughState(previousValue);
        setError("鼠标穿透设置保存失败，请重试。");
      })
      .finally(() => setClickThroughSaving(false));
  };

  const handleLiquidGlassChange = (nextValue: boolean) => {
    const previousValue = liquidGlassEnabled;
    // Apply the selected state immediately, then let the native command save
    // and broadcast it so both the compact orb and expanded card stay in sync.
    setLiquidGlassEnabled(nextValue);
    setLiquidGlassSaving(true);
    setError(null);
    void setWidgetLiquidGlass(nextValue)
      .then((preferences) => setLiquidGlassEnabled(preferences.liquidGlassEnabled))
      .catch(() => {
        setLiquidGlassEnabled(previousValue);
        setError("Liquid Glass 设置保存失败，请重试。");
      })
      .finally(() => setLiquidGlassSaving(false));
  };

  const handleBackgroundChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Clearing the input allows the user to pick the same image again after a
    // failed save or after removing it.
    input.value = "";
    if (!file) return;
    if (!isSupportedBackgroundType(file.type)) {
      setError("请选择 PNG、JPEG 或 WebP 图片。");
      return;
    }
    if (file.size > MAX_BACKGROUND_FILE_BYTES) {
      setError("背景图片不能超过 4 MB。");
      return;
    }

    setBackgroundSaving(true);
    setError(null);
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setPendingBackgroundImage(dataUrl);
    } catch {
      setError("背景图片读取失败，请重新选择。");
    } finally {
      setBackgroundSaving(false);
    }
  };

  const handleBackgroundApply = async (image: string) => {
    setBackgroundSaving(true);
    setError(null);
    try {
      const preferences = await setWidgetBackgroundImage(image);
      setBackgroundImage(preferences.customBackgroundImage);
      setPendingBackgroundImage(null);
    } catch {
      setError("背景图片保存失败，请重试。");
      throw new Error("background-save-failed");
    } finally {
      setBackgroundSaving(false);
    }
  };

  const handleBackgroundClear = async () => {
    if (!backgroundImage) return;
    setBackgroundSaving(true);
    setError(null);
    try {
      const preferences = await setWidgetBackgroundImage(null);
      setBackgroundImage(preferences.customBackgroundImage);
    } catch {
      setError("背景图片清除失败，请重试。");
    } finally {
      setBackgroundSaving(false);
    }
  };

  return (
    <main className={`settings-panel settings-panel--${theme}`}>
      <header className="settings-panel__header">
        <p className="settings-panel__eyebrow">QUOTA FLOAT · SETTINGS</p>
        <h1>偏好设置</h1>
        <p>透明度会实时作用于展开卡和折叠圆形。</p>
      </header>
      <section className="settings-section" aria-labelledby="opacity-title">
        <div className="settings-section__heading">
          <div>
            <h2 id="opacity-title">悬浮窗透明度</h2>
            <p>拖动滑块，可设置 0%–100% 的任意整数值。</p>
          </div>
          <output htmlFor="opacity-range">{opacity}%</output>
        </div>
        <label className="settings-range" htmlFor="opacity-range">
          <span className="sr-only">悬浮窗透明度</span>
          <input
            id="opacity-range"
            type="range"
            min="0"
            max="100"
            step="1"
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
        </label>
        <div className="settings-range__labels" aria-hidden="true"><span>0%</span><span>100%</span></div>
      </section>
      <section className="settings-section settings-section--background" aria-labelledby="background-title">
        <div className="settings-section__heading">
          <div className="settings-section__copy">
            <h2 id="background-title">自定义背景图片</h2>
            <p>图片会同时应用到展开卡和折叠悬浮球。</p>
          </div>
          <span className="settings-background__state" aria-live="polite">{backgroundImage ? "已设置" : "未设置"}</span>
        </div>
        <div
          className={`settings-background-preview${backgroundImage ? " settings-background-preview--has-image" : ""}`}
          style={backgroundImage ? { backgroundImage: `url("${backgroundImage}")` } : undefined}
          role="img"
          aria-label={backgroundImage ? "当前自定义背景图片预览" : "尚未设置背景图片"}
        >
          {!backgroundImage ? <span>未选择图片</span> : null}
        </div>
        <div className="settings-background__actions">
          <label className={`settings-file-button${backgroundSaving ? " settings-file-button--disabled" : ""}`}>
            <span>{backgroundSaving ? "保存中…" : "选择图片"}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={backgroundSaving} onChange={(event) => void handleBackgroundChange(event)} />
          </label>
          <button type="button" className="settings-background__clear" disabled={!backgroundImage || backgroundSaving} onClick={() => void handleBackgroundClear()}>清除图片</button>
        </div>
        <p className="settings-background__hint">支持 PNG、JPEG、WebP，单张不超过 4 MB；图片仅保存在本机。</p>
      </section>
      <section className="settings-section settings-section--click-through" aria-labelledby="click-through-title">
        <div className="settings-section__heading">
          <div className="settings-section__copy">
            <h2 id="click-through-title">鼠标穿透</h2>
            <p>开启后悬浮窗会忽略鼠标操作；可从托盘菜单取消锁定。</p>
          </div>
          <label className="settings-switch" htmlFor="click-through-toggle">
            <span className="sr-only">鼠标穿透</span>
            <input
              className="settings-switch__input"
              id="click-through-toggle"
              type="checkbox"
              checked={clickThrough}
              disabled={clickThroughSaving}
              onChange={(event) => handleClickThroughChange(event.target.checked)}
            />
            <span className="settings-switch__track" aria-hidden="true"><span /></span>
            <span className="settings-switch__state" aria-live="polite">{clickThrough ? "已开启" : "已关闭"}</span>
          </label>
        </div>
      </section>

      <section className="settings-section settings-section--liquid-glass" aria-labelledby="liquid-glass-title">
        <div className="settings-section__heading">
          <div className="settings-section__copy">
            <h2 id="liquid-glass-title">Liquid Glass</h2>
            <p>为展开卡和悬浮球添加透光模糊与玻璃高光效果。</p>
          </div>
          <label className="settings-switch" htmlFor="liquid-glass-toggle">
            <span className="sr-only">启用 Liquid Glass</span>
            <input
              className="settings-switch__input"
              id="liquid-glass-toggle"
              type="checkbox"
              checked={liquidGlassEnabled}
              disabled={!ready || liquidGlassSaving}
              onChange={(event) => handleLiquidGlassChange(event.target.checked)}
            />
            <span className="settings-switch__track" aria-hidden="true"><span /></span>
            <span className="settings-switch__state" aria-live="polite">{liquidGlassEnabled ? "已开启" : "已关闭"}</span>
          </label>
        </div>
      </section>

      <p className={`settings-status${error ? " settings-status--error" : ""}`} role={error ? "alert" : "status"}>
        {error ?? (saving || clickThroughSaving || liquidGlassSaving || backgroundSaving ? "正在保存…" : "已保存")}
      </p>
      {pendingBackgroundImage ? <BackgroundCropEditor image={pendingBackgroundImage} onCancel={() => setPendingBackgroundImage(null)} onApply={handleBackgroundApply} /> : null}
    </main>
  );
}
