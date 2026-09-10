/**
 * @author MoShangHuaKai
 *
 * Desktop preferences panel for settings that need continuous input instead
 * of a fixed tray-menu choice.
 */
import { useEffect, useState } from "react";
import { getPreferences, listenDesktopEvents, setClickThrough, setWidgetOpacity } from "../lib/bridge";

const DEFAULT_OPACITY = 100;

export function SettingsPanel() {
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY);
  const [clickThrough, setClickThroughState] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clickThroughSaving, setClickThroughSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: () => void = () => {};
    void getPreferences().then((preferences) => {
      if (!cancelled) {
        setOpacity(preferences.opacity);
        setClickThroughState(preferences.locked);
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
        setOpacity(preferences.opacity);
        setClickThroughState(preferences.locked);
      },
      onRefresh: () => undefined,
      onUpdate: () => undefined,
    }).then((unlisten) => {
      if (cancelled) unlisten(); else cleanup = unlisten;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup();
    };
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

  return (
    <main className="settings-panel">
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

      <p className={`settings-status${error ? " settings-status--error" : ""}`} role={error ? "alert" : "status"}>
        {error ?? (saving || clickThroughSaving ? "正在保存…" : "已保存")}
      </p>
    </main>
  );
}
