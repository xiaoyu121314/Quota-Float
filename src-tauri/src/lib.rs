mod codex;
mod history;
mod models;
mod token_activity;

use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use std::path::Path;

use chrono::Utc;
use history::{QuotaHistoryPoint, QuotaHistoryStore};
#[cfg(debug_assertions)]
use models::UsageWindow;
use models::{is_valid_custom_background_image, ProviderSnapshot, WidgetPreferences};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State,
    WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
#[cfg(not(target_os = "windows"))]
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_window_state::Builder as WindowStateBuilder;

#[cfg(target_os = "windows")]
use winreg::{
    enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, RegType::REG_BINARY},
    RegKey, RegValue,
};

// These are the light-theme visual dimensions. They deliberately do not vary
// by appearance: a theme changes colours only, while the native window keeps
// the same footprint as its CSS content.
const COLLAPSED_LOGICAL_SIZE: f64 = 72.0;
const EXPANDED_LOGICAL_SIZE: f64 = 306.0;
// Menus need their own transparent desktop space; the card stays 306px wide.
const MENU_SURFACE_WIDTH: f64 = 760.0;
const MENU_SURFACE_HEIGHT: f64 = 560.0;
const SETTINGS_WINDOW_LOGICAL_SIZE: f64 = 440.0;
const EDGE_SAFE_INSET_LOGICAL: f64 = 4.0;
const SNAP_THRESHOLD_LOGICAL: f64 = 24.0;
const POSITION_EPSILON: u32 = 2;

#[cfg(target_os = "windows")]
const AUTOSTART_WITH_CODEX_FLAG: &str = "--start-with-codex";

#[cfg(target_os = "windows")]
const FOLLOW_CODEX_FLAG: &str = "--follow-codex";

/// Image name of the Codex desktop client process inside the WindowsApps
/// package. Compared case-insensitively. Not platform-gated so the pure
/// matchers and their tests compile on every target.
const CODEX_PROCESS_IMAGE_NAME: &str = "chatgpt.exe";

/// Version-independent install prefix of the Codex desktop package under
/// WindowsApps. Distinguishes the Codex client from the plain ChatGPT desktop
/// app and survives Codex package updates.
const CODEX_IMAGE_PATH_PREFIX: &str = r"C:\Program Files\WindowsApps\OpenAI.Codex_";

/// Registry value name used for the Windows startup entry. Matches the
/// `productName` in tauri.conf.json.
#[cfg(target_os = "windows")]
const WINDOWS_AUTOSTART_VALUE_NAME: &str = "Quota Float";

#[cfg(target_os = "windows")]
const CODEX_POLL_INTERVAL: Duration = Duration::from_secs(1);

#[cfg(target_os = "windows")]
const FOLLOW_EXIT_CONFIRMATIONS: u32 = 2;

#[cfg(target_os = "windows")]
const WINDOWS_RUN_REGISTRY_KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";

#[cfg(target_os = "windows")]
const WINDOWS_STARTUP_APPROVED_REGISTRY_KEY: &str =
    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

#[cfg(target_os = "windows")]
const WINDOWS_STARTUP_APPROVED_ENABLED_VALUE: [u8; 12] = [
    0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

#[derive(Clone, Copy)]
enum HorizontalDock {
    Left,
    Right,
}

#[derive(Clone, Copy)]
enum VerticalDock {
    Top,
    Bottom,
}

#[derive(Clone, Copy, Default)]
struct DockState {
    horizontal: Option<HorizontalDock>,
    vertical: Option<VerticalDock>,
}

impl DockState {
    fn is_docked(self) -> bool {
        self.horizontal.is_some() || self.vertical.is_some()
    }
}

#[derive(Clone, Copy)]
struct WidgetRect {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

#[derive(Clone, Copy, Deserialize)]
struct WorkAreaPoint {
    x: i32,
    y: i32,
}

#[derive(Clone, Copy, Deserialize)]
struct WorkAreaSize {
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Deserialize)]
struct WorkAreaPayload {
    position: WorkAreaPoint,
    size: WorkAreaSize,
}

#[derive(Clone, Copy)]
enum WidgetMode {
    Collapsed,
    Expanded,
}

#[derive(Clone, Copy)]
struct WidgetGeometryState {
    mode: WidgetMode,
    dock: DockState,
    collapsed_rect: WidgetRect,
    expanded_rect: Option<WidgetRect>,
    user_moved_expanded: bool,
}

struct AppState {
    client: reqwest::Client,
    preferences: Mutex<WidgetPreferences>,
    preferences_path: PathBuf,
    quota_history: Mutex<QuotaHistoryStore>,
    fetch_lock: tokio::sync::Mutex<()>,
    snapshot_cache: Mutex<Option<(Instant, Vec<ProviderSnapshot>)>>,
    #[cfg(debug_assertions)]
    simulate_short_window_for_testing: Mutex<bool>,
    geometry: Mutex<Option<WidgetGeometryState>>,
    context_menu: Mutex<Option<ContextMenuPayload>>,
    drag_mode: Mutex<Option<WidgetMode>>,
    #[cfg(target_os = "windows")]
    follow_watcher: Mutex<Option<std::process::Child>>,
}

fn apply_short_window_test_override(
    _state: &AppState,
    #[allow(unused_mut)]
    mut snapshots: Vec<ProviderSnapshot>,
) -> Vec<ProviderSnapshot> {
    #[cfg(debug_assertions)]
    if _state
        .simulate_short_window_for_testing
        .lock()
        .map(|value| *value)
        .unwrap_or(false)
    {
        for snapshot in &mut snapshots {
            if snapshot.status == "ok" {
                snapshot.short_window = Some(UsageWindow {
                    remaining_percent: 88.0,
                    resets_at: Some((chrono::Utc::now() + chrono::Duration::hours(3)).to_rfc3339()),
                    window_seconds: 18_000,
                });
            }
        }
    }
    snapshots
}

async fn fetch_snapshots_uncached(state: &State<'_, AppState>) -> Vec<ProviderSnapshot> {
    let _guard = state.fetch_lock.lock().await;
    let values = vec![codex::fetch_snapshot(&state.client).await];
    if let Ok(mut cache) = state.snapshot_cache.lock() {
        *cache = Some((Instant::now(), values.clone()));
    }
    record_quota_history(state.inner(), &values);
    apply_short_window_test_override(state.inner(), values)
}

fn load_preferences(path: &PathBuf) -> WidgetPreferences {
    let parse = |candidate: &PathBuf| {
        fs::read_to_string(candidate)
            .ok()
            .and_then(|raw| serde_json::from_str::<WidgetPreferences>(&raw).ok())
    };
    if let Some(value) = parse(path) {
        return value.normalized();
    }
    let backup = path.with_extension("json.bak");
    if let Some(value) = parse(&backup) {
        eprintln!("preferences recovered from backup");
        return value.normalized();
    }
    WidgetPreferences::default()
}

fn preferences_lock(state: &AppState) -> MutexGuard<'_, WidgetPreferences> {
    state.preferences.lock().unwrap_or_else(|poisoned| {
        eprintln!("preferences lock was poisoned; recovering the last in-memory settings");
        poisoned.into_inner()
    })
}

fn quota_history_lock(state: &AppState) -> MutexGuard<'_, QuotaHistoryStore> {
    state.quota_history.lock().unwrap_or_else(|poisoned| {
        eprintln!("quota history lock was poisoned; recovering the in-memory history");
        poisoned.into_inner()
    })
}

fn record_quota_history(state: &AppState, snapshots: &[ProviderSnapshot]) {
    // History is best-effort. A local file-system problem must never hide a
    // valid quota response or turn the live card into a stale state.
    if quota_history_lock(state).record(snapshots, Utc::now()).is_err() {
        eprintln!("failed to persist quota history");
    }
}

fn persist_preferences(path: &PathBuf, value: &WidgetPreferences) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "failed to create settings directory".to_string())?;
    }
    let serialized =
        serde_json::to_vec_pretty(value).map_err(|_| "failed to serialize settings".to_string())?;
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let mut file = fs::File::create(&temporary)
        .map_err(|_| "failed to create temporary settings file".to_string())?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|_| "failed to write settings".to_string())?;
    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup).map_err(|_| "failed to back up settings".to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::rename(&backup, path);
        return Err(format!("failed to commit settings: {error}"));
    }
    Ok(())
}

#[tauri::command]
async fn get_snapshots(state: State<'_, AppState>) -> Result<Vec<ProviderSnapshot>, String> {
    const CACHE_TTL: Duration = Duration::from_secs(30);
    if let Ok(cache) = state.snapshot_cache.lock() {
        if let Some((time, values)) = &*cache {
            if time.elapsed() < CACHE_TTL {
                return Ok(apply_short_window_test_override(&state, values.clone()));
            }
        }
    }
    let _guard = match state.fetch_lock.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            if let Ok(cache) = state.snapshot_cache.lock() {
                if let Some((_, values)) = &*cache {
                    return Ok(apply_short_window_test_override(&state, values.clone()));
                }
            }
            return Ok(vec![ProviderSnapshot::failure(
                "unavailable",
                "Quota refresh is already running.",
            )]);
        }
    };
    if let Ok(cache) = state.snapshot_cache.lock() {
        if let Some((time, values)) = &*cache {
            if time.elapsed() < CACHE_TTL {
                return Ok(apply_short_window_test_override(&state, values.clone()));
            }
        }
    }
    let values = vec![codex::fetch_snapshot(&state.client).await];
    if let Ok(mut cache) = state.snapshot_cache.lock() {
        *cache = Some((Instant::now(), values.clone()));
    }
    record_quota_history(state.inner(), &values);
    Ok(apply_short_window_test_override(&state, values))
}

#[tauri::command]
async fn refresh_snapshots(state: State<'_, AppState>) -> Result<Vec<ProviderSnapshot>, String> {
    Ok(fetch_snapshots_uncached(&state).await)
}

#[tauri::command]
fn get_quota_history(state: State<'_, AppState>) -> Result<Vec<QuotaHistoryPoint>, String> {
    Ok(quota_history_lock(&state).points())
}

#[tauri::command]
fn clear_quota_history(state: State<'_, AppState>) -> Result<(), String> {
    quota_history_lock(&state).clear()
}

fn clamp_position_to_monitor(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor: &tauri::Monitor,
    safe_inset: i32,
) -> PhysicalPosition<i32> {
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let left = monitor_position.x;
    let top = monitor_position.y;
    let right = left + monitor_size.width as i32;
    let bottom = top + monitor_size.height as i32;
    PhysicalPosition::new(
        position
            .x
            .clamp(left - safe_inset, right - size.width as i32 + safe_inset),
        position
            .y
            .clamp(top - safe_inset, bottom - size.height as i32 + safe_inset),
    )
}

fn logical_to_physical(value: f64, scale_factor: f64) -> u32 {
    (value * scale_factor).round().max(1.0) as u32
}

fn safe_inset_for_current_appearance(state: &AppState, scale_factor: f64) -> u32 {
    let _ = state;
    logical_to_physical(EDGE_SAFE_INSET_LOGICAL, scale_factor)
}

fn window_size_for_visual_size(visual_size: u32, safe_inset: u32) -> u32 {
    visual_size + safe_inset * 2
}

fn widget_window_size(logical_visual_size: f64, scale_factor: f64, safe_inset: u32) -> u32 {
    window_size_for_visual_size(
        logical_to_physical(logical_visual_size, scale_factor),
        safe_inset,
    )
}

fn detect_dock(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor: &tauri::Monitor,
    threshold: i32,
    safe_inset: i32,
) -> DockState {
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let visible_left = position.x + safe_inset;
    let visible_top = position.y + safe_inset;
    let visible_right = position.x + size.width as i32 - safe_inset;
    let visible_bottom = position.y + size.height as i32 - safe_inset;
    let left_distance = (visible_left - monitor_position.x).abs();
    let top_distance = (visible_top - monitor_position.y).abs();
    let right_distance = (monitor_position.x + monitor_size.width as i32 - visible_right).abs();
    let bottom_distance = (monitor_position.y + monitor_size.height as i32 - visible_bottom).abs();
    let horizontal = if left_distance <= threshold || right_distance <= threshold {
        if left_distance <= right_distance {
            Some(HorizontalDock::Left)
        } else {
            Some(HorizontalDock::Right)
        }
    } else {
        None
    };
    let vertical = if top_distance <= threshold || bottom_distance <= threshold {
        if top_distance <= bottom_distance {
            Some(VerticalDock::Top)
        } else {
            Some(VerticalDock::Bottom)
        }
    } else {
        None
    };
    DockState {
        horizontal,
        vertical,
    }
}

fn snap_position(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    dock: DockState,
    monitor: &tauri::Monitor,
    safe_inset: i32,
) -> PhysicalPosition<i32> {
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let mut next = clamp_position_to_monitor(position, size, monitor, safe_inset);
    match dock.horizontal {
        Some(HorizontalDock::Left) => next.x = monitor_position.x - safe_inset,
        Some(HorizontalDock::Right) => {
            next.x = monitor_position.x + monitor_size.width as i32 - size.width as i32 + safe_inset
        }
        None => {}
    }
    match dock.vertical {
        Some(VerticalDock::Top) => next.y = monitor_position.y - safe_inset,
        Some(VerticalDock::Bottom) => {
            next.y =
                monitor_position.y + monitor_size.height as i32 - size.height as i32 + safe_inset
        }
        None => {}
    }
    next
}

fn expanded_position_in_bounds(
    collapsed: WidgetRect,
    expanded_size: PhysicalSize<u32>,
    dock: DockState,
    bounds_position: PhysicalPosition<i32>,
    bounds_size: PhysicalSize<u32>,
    safe_inset: i32,
) -> PhysicalPosition<i32> {
    let monitor_right = bounds_position.x + bounds_size.width as i32;
    let monitor_bottom = bounds_position.y + bounds_size.height as i32;
    let collapsed_left = collapsed.position.x + safe_inset;
    let collapsed_top = collapsed.position.y + safe_inset;
    let collapsed_right = collapsed.position.x + collapsed.size.width as i32 - safe_inset;
    let collapsed_bottom = collapsed.position.y + collapsed.size.height as i32 - safe_inset;
    let x = match dock.horizontal {
        Some(HorizontalDock::Left) => collapsed_left - safe_inset,
        Some(HorizontalDock::Right) => collapsed_right - expanded_size.width as i32 + safe_inset,
        None if collapsed_left + expanded_size.width as i32 - safe_inset > monitor_right => {
            collapsed_right - expanded_size.width as i32 + safe_inset
        }
        None => collapsed_left - safe_inset,
    };
    let y = match dock.vertical {
        Some(VerticalDock::Top) => collapsed_top - safe_inset,
        Some(VerticalDock::Bottom) => collapsed_bottom - expanded_size.height as i32 + safe_inset,
        None if collapsed_top + expanded_size.height as i32 - safe_inset > monitor_bottom => {
            collapsed_bottom - expanded_size.height as i32 + safe_inset
        }
        None => collapsed_top - safe_inset,
    };
    let min_x = bounds_position.x - safe_inset;
    let min_y = bounds_position.y - safe_inset;
    let max_x = (monitor_right - expanded_size.width as i32 + safe_inset).max(min_x);
    let max_y = (monitor_bottom - expanded_size.height as i32 + safe_inset).max(min_y);
    PhysicalPosition::new(x.clamp(min_x, max_x), y.clamp(min_y, max_y))
}

fn expanded_position(
    collapsed: WidgetRect,
    expanded_size: PhysicalSize<u32>,
    dock: DockState,
    monitor: &tauri::Monitor,
    work_area: Option<WorkAreaPayload>,
    safe_inset: i32,
) -> PhysicalPosition<i32> {
    let (bounds_position, bounds_size) = work_area
        .map(|area| {
            (
                PhysicalPosition::new(area.position.x, area.position.y),
                PhysicalSize::new(area.size.width, area.size.height),
            )
        })
        .unwrap_or_else(|| (*monitor.position(), *monitor.size()));
    expanded_position_in_bounds(
        collapsed,
        expanded_size,
        dock,
        bounds_position,
        bounds_size,
        safe_inset,
    )
}

fn collapsed_geometry_for_expand(
    current_position: PhysicalPosition<i32>,
    collapsed_size: PhysicalSize<u32>,
    monitor: &tauri::Monitor,
    threshold: i32,
    safe_inset: i32,
    previous: Option<WidgetGeometryState>,
) -> (WidgetRect, DockState) {
    if let Some(previous) = previous {
        let can_reuse_anchor = matches!(previous.mode, WidgetMode::Collapsed)
            || (matches!(previous.mode, WidgetMode::Expanded) && !previous.user_moved_expanded);
        if can_reuse_anchor {
            let position = if previous.dock.is_docked() {
                snap_position(
                    previous.collapsed_rect.position,
                    collapsed_size,
                    previous.dock,
                    monitor,
                    safe_inset,
                )
            } else {
                clamp_position_to_monitor(
                    previous.collapsed_rect.position,
                    collapsed_size,
                    monitor,
                    safe_inset,
                )
            };
            return (
                WidgetRect {
                    position,
                    size: collapsed_size,
                },
                previous.dock,
            );
        }
    }

    let current_collapsed = WidgetRect {
        position: clamp_position_to_monitor(current_position, collapsed_size, monitor, safe_inset),
        size: collapsed_size,
    };
    let dock = detect_dock(
        current_collapsed.position,
        collapsed_size,
        monitor,
        threshold,
        safe_inset,
    );
    let position = if dock.is_docked() {
        snap_position(
            current_collapsed.position,
            collapsed_size,
            dock,
            monitor,
            safe_inset,
        )
    } else {
        current_collapsed.position
    };
    (
        WidgetRect {
            position,
            size: collapsed_size,
        },
        dock,
    )
}

fn current_widget_rect(window: &tauri::WebviewWindow) -> Result<WidgetRect, String> {
    Ok(WidgetRect {
        position: window
            .outer_position()
            .map_err(|_| "failed to read widget position".to_string())?,
        size: window
            .outer_size()
            .map_err(|_| "failed to read widget size".to_string())?,
    })
}

fn monitor_and_scale(
    window: &tauri::WebviewWindow,
) -> Result<(Option<tauri::Monitor>, f64), String> {
    let monitor = window
        .current_monitor()
        .map_err(|_| "failed to read monitor".to_string())?;
    let scale_factor = monitor
        .as_ref()
        .map(|item| item.scale_factor())
        .unwrap_or(1.0);
    Ok((monitor, scale_factor))
}

fn infer_mode(rect: WidgetRect, collapsed_size: PhysicalSize<u32>) -> WidgetMode {
    if rect.size.width <= collapsed_size.width + POSITION_EPSILON
        && rect.size.height <= collapsed_size.height + POSITION_EPSILON
    {
        WidgetMode::Collapsed
    } else {
        WidgetMode::Expanded
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextMenuPayload {
    x: f64,
    y: f64,
    request_id: u64,
    language: String,
    appearance: String,
    locked: bool,
    autostart: bool,
}

/// Position a separate menu surface around the widget inside the work area.
/// This rectangle belongs exclusively to the popup: opening a menu must never
/// resize or reposition the visible card, even for one intermediate frame.
fn menu_surface_rect(original: WidgetRect, scale: f64, bounds: WorkAreaPayload) -> WidgetRect {
    let width = logical_to_physical(MENU_SURFACE_WIDTH, scale).min(bounds.size.width);
    let height = logical_to_physical(MENU_SURFACE_HEIGHT, scale).min(bounds.size.height);
    let centered_x = original.position.x - (width.saturating_sub(original.size.width) / 2) as i32;
    let centered_y = original.position.y - (height.saturating_sub(original.size.height) / 2) as i32;
    WidgetRect {
        position: PhysicalPosition::new(
            centered_x.clamp(bounds.position.x, bounds.position.x + (bounds.size.width - width) as i32),
            centered_y.clamp(bounds.position.y, bounds.position.y + (bounds.size.height - height) as i32),
        ),
        size: PhysicalSize::new(width, height),
    }
}

#[tauri::command]
fn set_widget_menu_open(
    open: bool,
    menu: Option<ContextMenuPayload>,
    work_area: Option<WorkAreaPayload>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let popup = app.get_webview_window("context-menu").ok_or("context menu window missing")?;
    if !open {
        let mut current = state.context_menu.lock().map_err(|_| "menu state unavailable")?;
        if let Some(request) = menu {
            if current.as_ref().map(|value| value.request_id) != Some(request.request_id) {
                return Ok(());
            }
        }
        let closed = current.take();
        drop(current);
        popup.hide().map_err(|error| error.to_string())?;
        if let Some(closed) = closed {
            let _ = app.emit_to("widget", "context-menu-action", serde_json::json!({
                "action": "close", "requestId": closed.request_id,
            }));
        }
        return Ok(());
    }
    let window = app.get_webview_window("widget").ok_or("widget window missing")?;
    let current = current_widget_rect(&window)?;
    let (monitor, scale) = monitor_and_scale(&window)?;
    let bounds = work_area.or_else(|| monitor.map(|monitor| WorkAreaPayload {
        position: WorkAreaPoint { x: monitor.position().x, y: monitor.position().y },
        size: WorkAreaSize { width: monitor.size().width, height: monitor.size().height },
    })).ok_or("menu monitor unavailable")?;
    let surface = menu_surface_rect(current, scale, bounds);
    let cursor = window.cursor_position().map_err(|error| error.to_string())?;
    let mut payload = menu.ok_or("context menu state missing")?;
    payload.x = (cursor.x - surface.position.x as f64) / scale;
    payload.y = (cursor.y - surface.position.y as f64) / scale;
    // Prepare the popup while hidden. Its WebView acknowledges a rendered
    // frame before show_context_menu makes it visible, avoiding blank flashes.
    popup.hide().map_err(|error| error.to_string())?;
    popup.set_size(surface.size).map_err(|error| error.to_string())?;
    popup.set_position(surface.position).map_err(|error| error.to_string())?;
    *state.context_menu.lock().map_err(|_| "menu state unavailable")? = Some(payload.clone());
    app.emit_to("context-menu", "context-menu-open", payload).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_context_menu(state: State<'_, AppState>) -> Result<Option<ContextMenuPayload>, String> {
    Ok(state.context_menu.lock().map_err(|_| "menu state unavailable")?.clone())
}

#[tauri::command]
fn show_context_menu(request_id: u64, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // A late paint acknowledgement must not resurrect a dismissed menu.
    let menu = state.context_menu.lock().map_err(|_| "menu state unavailable")?;
    if menu.as_ref().map(|value| value.request_id) != Some(request_id) {
        return Ok(());
    }
    let popup = app.get_webview_window("context-menu").ok_or("context menu window missing")?;
    popup.show().map_err(|error| error.to_string())?;
    popup.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn expand_widget(
    work_area: Option<WorkAreaPayload>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let current = current_widget_rect(&window)?;
    let (monitor, scale_factor) = monitor_and_scale(&window)?;
    let safe_inset = safe_inset_for_current_appearance(state.inner(), scale_factor);
    let collapsed_size = PhysicalSize::new(
        widget_window_size(COLLAPSED_LOGICAL_SIZE, scale_factor, safe_inset),
        widget_window_size(COLLAPSED_LOGICAL_SIZE, scale_factor, safe_inset),
    );
    let expanded_size = PhysicalSize::new(
        widget_window_size(EXPANDED_LOGICAL_SIZE, scale_factor, safe_inset),
        widget_window_size(EXPANDED_LOGICAL_SIZE, scale_factor, safe_inset),
    );
    let Some(monitor) = monitor else {
        window
            .set_size(expanded_size)
            .map_err(|_| "failed to resize widget".to_string())?;
        return Ok(());
    };
    let threshold = logical_to_physical(SNAP_THRESHOLD_LOGICAL, scale_factor) as i32;
    let previous = state.geometry.lock().ok().and_then(|value| *value);
    let (collapsed_rect, dock) = collapsed_geometry_for_expand(
        current.position,
        collapsed_size,
        &monitor,
        threshold,
        safe_inset as i32,
        previous,
    );
    let expanded_rect = WidgetRect {
        position: expanded_position(
            collapsed_rect,
            expanded_size,
            dock,
            &monitor,
            work_area,
            safe_inset as i32,
        ),
        size: expanded_size,
    };

    if let Ok(mut geometry) = state.geometry.lock() {
        *geometry = Some(WidgetGeometryState {
            mode: WidgetMode::Expanded,
            dock,
            collapsed_rect,
            expanded_rect: Some(expanded_rect),
            user_moved_expanded: false,
        });
    }

    window
        .set_position(expanded_rect.position)
        .map_err(|_| "failed to position widget".to_string())?;
    window
        .set_size(expanded_size)
        .map_err(|_| "failed to resize widget".to_string())
}

#[cfg(test)]
mod geometry_tests {
    use super::*;

    fn rect(x: i32, y: i32, size: u32) -> WidgetRect {
        WidgetRect {
            position: PhysicalPosition::new(x, y),
            size: PhysicalSize::new(size, size),
        }
    }

    #[test]
    fn window_size_includes_the_transparent_safe_inset() {
        assert_eq!(window_size_for_visual_size(72, 4), 80);
        assert_eq!(widget_window_size(306.0, 1.5, 6), 471);
    }

    #[test]
    fn menu_surface_preserves_room_at_screen_edges_and_negative_origins() {
        let bounds = WorkAreaPayload {
            position: WorkAreaPoint { x: -1920, y: 0 },
            size: WorkAreaSize { width: 1920, height: 1040 },
        };
        for original in [rect(-1920, 0, 314), rect(-314, 726, 314)] {
            let surface = menu_surface_rect(original, 1.0, bounds);
            assert_eq!(surface.size, PhysicalSize::new(760, 560));
            assert!(surface.position.x <= original.position.x);
            assert!(surface.position.y <= original.position.y);
            assert!(surface.position.x >= -1920);
            assert!(surface.position.x + surface.size.width as i32 <= 0);
            assert!(surface.position.y + surface.size.height as i32 <= 1040);
            assert!(surface.position.x + surface.size.width as i32 >= original.position.x + 314);
            assert!(surface.position.y + surface.size.height as i32 >= original.position.y + 314);
        }
    }

    #[test]
    fn menu_surface_scales_to_dpi_and_respects_small_work_areas() {
        let bounds = WorkAreaPayload {
            position: WorkAreaPoint { x: 0, y: 0 },
            size: WorkAreaSize { width: 1000, height: 700 },
        };
        let surface = menu_surface_rect(rect(300, 200, 471), 1.5, bounds);
        assert_eq!(surface.size, PhysicalSize::new(1000, 700));
        assert_eq!(surface.position, PhysicalPosition::new(0, 0));
    }

    #[test]
    fn expansion_stays_above_a_bottom_taskbar() {
        let position = expanded_position_in_bounds(
            rect(1844, 964, 80),
            PhysicalSize::new(314, 314),
            DockState {
                horizontal: Some(HorizontalDock::Right),
                vertical: Some(VerticalDock::Bottom),
            },
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1920, 1040),
            4,
        );
        assert_eq!(position, PhysicalPosition::new(1610, 730));
    }

    #[test]
    fn expansion_handles_negative_origin_work_areas() {
        let position = expanded_position_in_bounds(
            rect(-1284, -4, 80),
            PhysicalSize::new(314, 314),
            DockState {
                horizontal: Some(HorizontalDock::Left),
                vertical: Some(VerticalDock::Top),
            },
            PhysicalPosition::new(-1280, 0),
            PhysicalSize::new(1280, 984),
            4,
        );
        assert_eq!(position, PhysicalPosition::new(-1284, -4));
    }

    #[test]
    fn undocked_expansion_flips_inward_near_work_area_edges() {
        let position = expanded_position_in_bounds(
            rect(1750, 900, 80),
            PhysicalSize::new(314, 314),
            DockState::default(),
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1920, 1040),
            4,
        );
        assert_eq!(position, PhysicalPosition::new(1516, 666));
    }
}

#[cfg(all(test, target_os = "windows"))]
mod autostart_tests {
    use super::*;

    #[test]
    fn windows_startup_command_quotes_paths_with_spaces() {
        let executable = Path::new(r"C:\Program Files\Quota Float\quota-float.exe");

        assert_eq!(
            windows_autostart_command(executable),
            r#""C:\Program Files\Quota Float\quota-float.exe" --start-with-codex"#
        );
    }
}

#[tauri::command]
fn collapse_widget(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let current = current_widget_rect(&window)?;
    let (monitor, scale_factor) = monitor_and_scale(&window)?;
    let safe_inset = safe_inset_for_current_appearance(state.inner(), scale_factor);
    let collapsed_size = PhysicalSize::new(
        widget_window_size(COLLAPSED_LOGICAL_SIZE, scale_factor, safe_inset),
        widget_window_size(COLLAPSED_LOGICAL_SIZE, scale_factor, safe_inset),
    );
    let Some(monitor) = monitor else {
        window
            .set_size(collapsed_size)
            .map_err(|_| "failed to resize widget".to_string())?;
        return Ok(());
    };
    let threshold = logical_to_physical(SNAP_THRESHOLD_LOGICAL, scale_factor) as i32;
    let previous = state.geometry.lock().ok().and_then(|value| *value);
    let user_moved_expanded = previous
        .map(|value| value.user_moved_expanded)
        .unwrap_or(false);
    let candidate = if user_moved_expanded {
        current.position
    } else {
        previous
            .map(|value| value.collapsed_rect.position)
            .unwrap_or(current.position)
    };
    let dock = detect_dock(
        candidate,
        collapsed_size,
        &monitor,
        threshold,
        safe_inset as i32,
    );
    let next_position = if dock.is_docked() {
        snap_position(candidate, collapsed_size, dock, &monitor, safe_inset as i32)
    } else {
        clamp_position_to_monitor(candidate, collapsed_size, &monitor, safe_inset as i32)
    };
    let collapsed_rect = WidgetRect {
        position: next_position,
        size: collapsed_size,
    };
    if let Ok(mut geometry) = state.geometry.lock() {
        *geometry = Some(WidgetGeometryState {
            mode: WidgetMode::Collapsed,
            dock,
            collapsed_rect,
            expanded_rect: None,
            user_moved_expanded: false,
        });
    }
    window
        .set_size(collapsed_size)
        .map_err(|_| "failed to resize widget".to_string())?;
    window
        .set_position(next_position)
        .map_err(|_| "failed to position widget".to_string())
}

#[tauri::command]
fn begin_widget_drag(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let current = current_widget_rect(&window)?;
    let (_, scale_factor) = monitor_and_scale(&window)?;
    let safe_inset = safe_inset_for_current_appearance(state.inner(), scale_factor);
    let collapsed_size = PhysicalSize::new(
        widget_window_size(COLLAPSED_LOGICAL_SIZE, scale_factor, safe_inset),
        widget_window_size(COLLAPSED_LOGICAL_SIZE, scale_factor, safe_inset),
    );
    let mode = state
        .geometry
        .lock()
        .ok()
        .and_then(|value| *value)
        .map(|value| value.mode)
        .unwrap_or_else(|| infer_mode(current, collapsed_size));
    if let Ok(mut drag_mode) = state.drag_mode.lock() {
        *drag_mode = Some(mode);
    }
    Ok(())
}

#[tauri::command]
fn finish_widget_drag(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let current = current_widget_rect(&window)?;
    let (monitor, scale_factor) = monitor_and_scale(&window)?;
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let threshold = logical_to_physical(SNAP_THRESHOLD_LOGICAL, scale_factor) as i32;
    let safe_inset = safe_inset_for_current_appearance(state.inner(), scale_factor);
    let collapsed_size = PhysicalSize::new(
        widget_window_size(COLLAPSED_LOGICAL_SIZE, scale_factor, safe_inset),
        widget_window_size(COLLAPSED_LOGICAL_SIZE, scale_factor, safe_inset),
    );
    let expanded_size = PhysicalSize::new(
        widget_window_size(EXPANDED_LOGICAL_SIZE, scale_factor, safe_inset),
        widget_window_size(EXPANDED_LOGICAL_SIZE, scale_factor, safe_inset),
    );
    let mode = state
        .drag_mode
        .lock()
        .ok()
        .and_then(|mut value| value.take())
        .or_else(|| {
            state
                .geometry
                .lock()
                .ok()
                .and_then(|value| *value)
                .map(|value| value.mode)
        })
        .unwrap_or_else(|| infer_mode(current, collapsed_size));

    match mode {
        WidgetMode::Collapsed => {
            let dock = detect_dock(
                current.position,
                collapsed_size,
                &monitor,
                threshold,
                safe_inset as i32,
            );
            let next_position = if dock.is_docked() {
                snap_position(
                    current.position,
                    collapsed_size,
                    dock,
                    &monitor,
                    safe_inset as i32,
                )
            } else {
                clamp_position_to_monitor(
                    current.position,
                    collapsed_size,
                    &monitor,
                    safe_inset as i32,
                )
            };
            let collapsed_rect = WidgetRect {
                position: next_position,
                size: collapsed_size,
            };
            window
                .set_position(next_position)
                .map_err(|_| "failed to position widget".to_string())?;
            if let Ok(mut geometry) = state.geometry.lock() {
                *geometry = Some(WidgetGeometryState {
                    mode: WidgetMode::Collapsed,
                    dock,
                    collapsed_rect,
                    expanded_rect: None,
                    user_moved_expanded: false,
                });
            }
        }
        WidgetMode::Expanded => {
            let current_position = clamp_position_to_monitor(
                current.position,
                expanded_size,
                &monitor,
                safe_inset as i32,
            );
            let updated_rect = WidgetRect {
                position: current_position,
                size: expanded_size,
            };
            window
                .set_position(current_position)
                .map_err(|_| "failed to position widget".to_string())?;
            if let Ok(mut geometry) = state.geometry.lock() {
                if let Some(mut value) = *geometry {
                    value.mode = WidgetMode::Expanded;
                    value.expanded_rect = Some(updated_rect);
                    value.user_moved_expanded = true;
                    *geometry = Some(value);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn get_preferences(state: State<'_, AppState>) -> WidgetPreferences {
    // Preferences are always recoverable: an empty or invalid on-disk file
    // was normalized at startup, and a poisoned mutex is recovered above.
    // Do not turn a safe default into a user-facing startup error.
    preferences_lock(&state).clone()
}

#[tauri::command]
fn set_preferences(
    preferences: WidgetPreferences,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let preferences = preferences.normalized();
    persist_preferences(&state.preferences_path, &preferences)?;
    *preferences_lock(&state) = preferences;
    Ok(())
}

#[tauri::command]
fn set_widget_opacity(
    opacity: u8,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    let mut preferences = preferences_lock(&state).clone();
    preferences.opacity = opacity;
    let normalized = preferences.normalized();
    persist_preferences(&state.preferences_path, &normalized)?;
    *preferences_lock(&state) = normalized.clone();
    let _ = app.emit_to("widget", "preferences-changed", normalized.clone());
    let _ = app.emit_to("settings", "preferences-changed", normalized.clone());
    Ok(normalized)
}

#[tauri::command]
fn set_widget_liquid_glass(
    enabled: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    let mut next = preferences_lock(&state).clone();
    next.liquid_glass_enabled = enabled;
    let normalized = next.normalized();
    persist_preferences(&state.preferences_path, &normalized)?;
    *preferences_lock(&state) = normalized.clone();

    // The settings page and widget run in separate WebViews, so broadcast the
    // saved preference to both windows for immediate and consistent rendering.
    let _ = app.emit_to("widget", "preferences-changed", normalized.clone());
    let _ = app.emit_to("settings", "preferences-changed", normalized.clone());
    Ok(normalized)
}

#[tauri::command]
fn set_widget_background_image(
    custom_background_image: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    if custom_background_image
        .as_deref()
        .map(|value| !is_valid_custom_background_image(value))
        .unwrap_or(false)
    {
        return Err("unsupported or oversized background image".to_string());
    }

    let mut next = preferences_lock(&state).clone();
    next.custom_background_image = custom_background_image;
    let normalized = next.normalized();
    persist_preferences(&state.preferences_path, &normalized)?;
    *preferences_lock(&state) = normalized.clone();

    // The settings page and the widget are separate WebViews. Broadcasting the
    // complete normalized record keeps a newly selected or cleared image in
    // sync immediately, without requiring a restart or a second read command.
    let _ = app.emit_to("widget", "preferences-changed", normalized.clone());
    let _ = app.emit_to("settings", "preferences-changed", normalized.clone());
    Ok(normalized)
}

fn apply_lock(app: &AppHandle, locked: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    window
        .set_ignore_cursor_events(locked)
        .map_err(|_| "failed to toggle click-through".to_string())
}

fn normalize_settings_window_size(window: &tauri::WebviewWindow) -> Result<(), String> {
    // WindowState restores dimensions saved by an earlier build before the
    // configured window size is considered. Reapply the logical size whenever
    // the preferences view is used so old 300px-high state cannot hide the
    // second settings section or its status message.
    window
        .set_size(LogicalSize::new(
            SETTINGS_WINDOW_LOGICAL_SIZE,
            SETTINGS_WINDOW_LOGICAL_SIZE,
        ))
        .map_err(|error| format!("failed to size settings window: {error}"))
}

/// Refreshes the visible settings WebView after Windows updates the widget's
/// click-through window styles. The style change can leave the sibling
/// WebView's native child surface clipped until it receives a fresh `WM_SIZE`;
/// changing the height by one logical pixel and restoring it forces that
/// resize without changing the intended settings-window dimensions.
#[cfg(target_os = "windows")]
fn refresh_settings_window_after_click_through(app: &AppHandle) {
    let Some(window) = app.get_webview_window("settings") else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        return;
    }

    let expanded_height = SETTINGS_WINDOW_LOGICAL_SIZE + 1.0;
    if let Err(error) = window.set_size(LogicalSize::new(
        SETTINGS_WINDOW_LOGICAL_SIZE,
        expanded_height,
    )) {
        eprintln!("failed to refresh settings WebView size: {error}");
        return;
    }
    if let Err(error) = window.set_size(LogicalSize::new(
        SETTINGS_WINDOW_LOGICAL_SIZE,
        SETTINGS_WINDOW_LOGICAL_SIZE,
    )) {
        eprintln!("failed to restore settings WebView size: {error}");
    }
}

#[tauri::command]
fn set_widget_locked(
    locked: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    let previous = state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())?
        .clone();
    let mut next = previous.clone();
    next.locked = locked;
    persist_preferences(&state.preferences_path, &next)?;
    if let Err(error) = apply_lock(&app, locked) {
        let _ = persist_preferences(&state.preferences_path, &previous);
        return Err(error);
    }
    #[cfg(target_os = "windows")]
    refresh_settings_window_after_click_through(&app);

    *state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())? = next.clone();
    // Keep the widget chrome and an already-open preferences window in sync
    // when click-through is changed from either surface. The OS-level window
    // behavior has already been applied by `apply_lock` above.
    let _ = app.emit_to("widget", "preferences-changed", next.clone());
    let _ = app.emit_to("settings", "preferences-changed", next.clone());
    Ok(next)
}

#[tauri::command]
fn set_widget_always_on_top(
    always_on_top: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    let previous = state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())?
        .clone();
    let mut next = previous.clone();
    next.always_on_top = always_on_top;
    persist_preferences(&state.preferences_path, &next)?;
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    if let Err(error) = window.set_always_on_top(always_on_top) {
        let _ = persist_preferences(&state.preferences_path, &previous);
        return Err(format!("failed to toggle always-on-top: {error}"));
    }
    *state
        .preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())? = next.clone();
    let _ = app.emit_to("widget", "preferences-changed", next.clone());
    Ok(next)
}

#[tauri::command]
fn sync_widget_appearance(_appearance: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let current = current_widget_rect(&window)?;
    let (_, scale_factor) = monitor_and_scale(&window)?;
    let safe_inset = safe_inset_for_current_appearance(state.inner(), scale_factor);
    let expanded_threshold = logical_to_physical((COLLAPSED_LOGICAL_SIZE + EXPANDED_LOGICAL_SIZE) / 2.0, scale_factor);
    let visual_size = if current.size.width > expanded_threshold {
        EXPANDED_LOGICAL_SIZE
    } else {
        COLLAPSED_LOGICAL_SIZE
    };
    let side = widget_window_size(visual_size, scale_factor, safe_inset);
    window
        .set_size(PhysicalSize::new(side, side))
        .map_err(|_| "failed to resize widget for appearance".to_string())
}

#[tauri::command]
fn hide_widget(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    window.hide().map_err(|_| "failed to hide widget".to_string())
}

#[tauri::command]
fn show_widget(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    window.show().map_err(|_| "failed to show widget".to_string())?;
    window.set_focus().map_err(|_| "failed to focus widget".to_string())
}

#[tauri::command]
fn is_widget_visible(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    window.is_visible().map_err(|_| "failed to check visibility".to_string())
}

#[tauri::command]
fn open_settings_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("settings")
        .ok_or_else(|| "settings window missing".to_string())?;
    let _ = normalize_settings_window_size(&window);
    window.show().map_err(|_| "failed to show settings".to_string())?;
    window.set_focus().map_err(|_| "failed to focus settings".to_string())
}

#[tauri::command]
fn quit_application(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_autostart_status(app: AppHandle) -> bool {
    autostart_is_enabled(&app)
}

/// Writes the Windows login-start entry used by the CodeX companion mode.
///
/// The bundled autostart plugin delegates to `auto-launch`, whose Windows
/// implementation writes executable paths without surrounding quotes. Quota
/// Float is commonly installed under a path containing spaces, so Windows can
/// otherwise interpret only the first path segment as the executable and
/// silently skip the startup entry. Writing the value directly also lets us
/// create the per-user Run key when it is missing and mark the entry enabled in
/// Task Manager's StartupApproved state.
#[cfg(target_os = "windows")]
fn repair_windows_autostart_entry(app: &AppHandle) -> Result<(), String> {
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("failed to resolve Quota Float executable: {error}"))?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run_key, _) = hkcu
        .create_subkey(WINDOWS_RUN_REGISTRY_KEY)
        .map_err(|error| format!("failed to open Windows startup registry: {error}"))?;
    let command = windows_autostart_command(&current_exe);
    run_key
        .set_value(app.package_info().name.as_str(), &command)
        .map_err(|error| format!("failed to save Windows startup command: {error}"))?;

    let (startup_approved_key, _) = hkcu
        .create_subkey(WINDOWS_STARTUP_APPROVED_REGISTRY_KEY)
        .map_err(|error| format!("failed to open StartupApproved registry: {error}"))?;
    startup_approved_key
        .set_raw_value(
            app.package_info().name.as_str(),
            &RegValue {
                vtype: REG_BINARY,
                bytes: WINDOWS_STARTUP_APPROVED_ENABLED_VALUE.to_vec(),
            },
        )
        .map_err(|error| format!("failed to enable startup entry in Task Manager: {error}"))
}

/// Reads the same two Windows locations used by the startup registration so
/// the tray checkmark reflects both the Run value and a disabled Task Manager
/// startup entry.
#[cfg(target_os = "windows")]
fn windows_autostart_is_enabled(app: &AppHandle) -> bool {
    windows_autostart_entry_is_enabled(app.package_info().name.as_str())
}

/// Core of the enablement check, parameterized by the registry value name so
/// the tray, the repair path and the login watcher all test the same entry.
#[cfg(target_os = "windows")]
fn windows_autostart_entry_is_enabled(value_name: &str) -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(run_key) = hkcu.open_subkey_with_flags(WINDOWS_RUN_REGISTRY_KEY, KEY_READ) else {
        return false;
    };
    if run_key.get_value::<String, _>(value_name).is_err() {
        return false;
    }

    let Ok(startup_approved_key) = hkcu.open_subkey_with_flags(
        WINDOWS_STARTUP_APPROVED_REGISTRY_KEY,
        KEY_READ,
    ) else {
        return true;
    };
    let Ok(raw_value) = startup_approved_key.get_raw_value(value_name) else {
        return true;
    };
    raw_value
        .bytes
        .len()
        .checked_sub(8)
        .map(|start| raw_value.bytes[start..].iter().all(|byte| *byte == 0))
        .unwrap_or(true)
}

/// Disables the Windows companion entry without treating an already-removed
/// value as an error. The separate StartupApproved value is removed as well,
/// preventing stale Task Manager state from affecting a later enable action.
#[cfg(target_os = "windows")]
fn disable_windows_autostart_entry(app: &AppHandle) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(run_key) = hkcu.open_subkey_with_flags(WINDOWS_RUN_REGISTRY_KEY, KEY_SET_VALUE) {
        match run_key.delete_value(app.package_info().name.as_str()) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("failed to disable Windows startup: {error}"));
            }
        }
    }
    if let Ok(startup_approved_key) =
        hkcu.open_subkey_with_flags(WINDOWS_STARTUP_APPROVED_REGISTRY_KEY, KEY_SET_VALUE)
    {
        let _ = startup_approved_key.delete_value(app.package_info().name.as_str());
    }
    Ok(())
}

/// Builds a quoted Windows Run command that starts Quota Float in companion
/// mode. Keeping this formatting in one function prevents a path containing
/// spaces from being reintroduced when the startup setting is toggled again.
#[cfg(target_os = "windows")]
fn windows_autostart_command(executable: &Path) -> String {
    format!("\"{}\" {AUTOSTART_WITH_CODEX_FLAG}", executable.display())
}

/// Decision for the login-mode watcher on a single poll tick. The widget is
/// spawned only on a Codex appearance (including "already running when the
/// watcher starts"); while Codex keeps running the watcher never respawns, so
/// a manually closed widget stays closed until Codex restarts.
enum WatcherAction {
    SpawnWidget,
    KeepWaiting,
}

fn watcher_action(previous_running: Option<bool>, running: bool) -> WatcherAction {
    if running && previous_running != Some(true) {
        WatcherAction::SpawnWidget
    } else {
        WatcherAction::KeepWaiting
    }
}

fn image_name_is_codex(name: &str) -> bool {
    name.eq_ignore_ascii_case(CODEX_PROCESS_IMAGE_NAME)
}

/// A queried image path must live inside the Codex WindowsApps package. A
/// missing path (query failed) degrades to name-only matching and passes.
fn image_path_matches_codex(path: Option<&str>) -> bool {
    match path {
        None => true,
        Some(path) => path.len() >= CODEX_IMAGE_PATH_PREFIX.len()
            && path[..CODEX_IMAGE_PATH_PREFIX.len()].eq_ignore_ascii_case(CODEX_IMAGE_PATH_PREFIX),
    }
}

#[cfg(test)]
mod codex_follow_tests {
    use super::*;

    #[test]
    fn watcher_spawns_on_codex_appearance() {
        assert!(matches!(
            watcher_action(Some(false), true),
            WatcherAction::SpawnWidget
        ));
        assert!(matches!(
            watcher_action(None, true),
            WatcherAction::SpawnWidget
        ));
    }

    #[test]
    fn watcher_keeps_waiting_while_codex_stays_running() {
        assert!(matches!(
            watcher_action(Some(true), true),
            WatcherAction::KeepWaiting
        ));
    }

    #[test]
    fn watcher_never_spawns_while_codex_is_absent() {
        assert!(matches!(
            watcher_action(Some(false), false),
            WatcherAction::KeepWaiting
        ));
        assert!(matches!(
            watcher_action(Some(true), false),
            WatcherAction::KeepWaiting
        ));
        assert!(matches!(
            watcher_action(None, false),
            WatcherAction::KeepWaiting
        ));
    }

    #[test]
    fn codex_image_name_matches_case_insensitively() {
        assert!(image_name_is_codex("chatgpt.exe"));
        assert!(image_name_is_codex("ChatGPT.EXE"));
        assert!(!image_name_is_codex("chatgpt2.exe"));
        assert!(!image_name_is_codex("explorer.exe"));
    }

    #[test]
    fn codex_image_path_requires_windowsapps_package_prefix() {
        assert!(image_path_matches_codex(Some(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_26.908.9136.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe"
        )));
        assert!(image_path_matches_codex(Some(
            r"c:\program files\windowsapps\openai.codex_26.908.9136.0_x64__2p2nqsd0c76g0\app\chatgpt.exe"
        )));
        assert!(!image_path_matches_codex(Some(
            r"C:\Program Files\WindowsApps\OpenAI.ChatGPT-Desktop_1.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe"
        )));
        assert!(!image_path_matches_codex(Some(r"C:\Program Files\ChatGPT.exe")));
        assert!(!image_path_matches_codex(Some(r"C:\Program Files")));
        assert!(image_path_matches_codex(None));
    }
}

/// Samples whether a Codex desktop process is currently running.
///
/// Returns `None` when the process snapshot itself could not be taken; callers
/// treat that as "no information" and must not act on it, so a transient
/// snapshot failure can never spuriously spawn or kill the widget.
#[cfg(target_os = "windows")]
fn codex_running_state() -> Option<bool> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.ok()?;
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut found = false;
    unsafe {
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let length = entry
                    .szExeFile
                    .iter()
                    .position(|unit| *unit == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..length]);
                if image_name_is_codex(&name)
                    && image_path_matches_codex(process_image_path(entry.th32ProcessID).as_deref())
                {
                    found = true;
                    break;
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    Some(found)
}

/// Resolves the full image path of a process so Codex can be told apart from
/// the plain ChatGPT desktop app. `None` means the query failed and matching
/// must degrade to name-only.
#[cfg(target_os = "windows")]
fn process_image_path(pid: u32) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buffer = [0u16; 1024];
    let mut length = buffer.len() as u32;
    let query_result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR::from_raw(buffer.as_mut_ptr()),
            &mut length,
        )
    };
    let path = if query_result.is_ok() {
        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    } else {
        None
    };
    let _ = unsafe { CloseHandle(process) };
    path
}

/// Spawns a detached copy of this executable running in the given mode. The
/// window-less creation flag keeps debug builds (console subsystem) from
/// flashing a console window when launched at login or from the widget.
#[cfg(target_os = "windows")]
fn spawn_self_with_flag(flag: &str) -> std::io::Result<std::process::Child> {
    use std::os::windows::process::CommandExt;
    use windows::Win32::System::Threading::CREATE_NO_WINDOW;

    std::process::Command::new(std::env::current_exe()?)
        .arg(flag)
        .creation_flags(CREATE_NO_WINDOW.0)
        .spawn()
}

/// Body of the login-mode watcher process: a window-less loop that launches
/// the widget whenever Codex appears and self-terminates as soon as the
/// startup entry is removed or disabled in Task Manager. The registry check
/// runs every tick so even a watcher this process did not spawn (the login
/// launch) stops within one poll interval after the feature is switched off.
#[cfg(target_os = "windows")]
fn run_codex_watcher() {
    let mut previous_running: Option<bool> = None;
    loop {
        if !windows_autostart_entry_is_enabled(WINDOWS_AUTOSTART_VALUE_NAME) {
            return;
        }
        if let Some(running) = codex_running_state() {
            if matches!(
                watcher_action(previous_running, running),
                WatcherAction::SpawnWidget
            ) {
                match spawn_self_with_flag(FOLLOW_CODEX_FLAG) {
                    Ok(child) => {
                        eprintln!("Codex detected; spawned follow widget");
                        drop(child);
                    }
                    Err(error) => eprintln!("failed to spawn follow widget: {error}"),
                }
            }
            previous_running = Some(running);
        }
        std::thread::sleep(CODEX_POLL_INTERVAL);
    }
}

/// Starts (or replaces) the watcher process managed by this widget instance,
/// used when the startup setting is turned on from the tray or the settings
/// window so the feature takes effect without waiting for the next login.
#[cfg(target_os = "windows")]
fn spawn_follow_watcher(app: &AppHandle) -> Result<(), String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "app state missing".to_string())?;
    let mut watcher = state
        .follow_watcher
        .lock()
        .map_err(|_| "follow watcher state poisoned".to_string())?;
    if let Some(child) = watcher.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok(());
        }
    }
    let child = spawn_self_with_flag(AUTOSTART_WITH_CODEX_FLAG)
        .map_err(|error| format!("failed to start Codex follower: {error}"))?;
    *watcher = Some(child);
    Ok(())
}

/// Stops the watcher process spawned by this widget instance. Login-spawned
/// watchers are not children of this process; they exit on their own via the
/// registry self-check, so a missing tracked child is not an error here.
#[cfg(target_os = "windows")]
fn stop_follow_watcher(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(mut watcher) = state.follow_watcher.lock() else {
        return;
    };
    if let Some(mut child) = watcher.take() {
        if child.kill().is_ok() {
            let _ = child.wait();
        }
    }
}

/// Exits the whole widget process once Codex has verifiably disappeared on
/// two consecutive samples, so a single missed snapshot never kills the
/// widget while the user is working.
#[cfg(target_os = "windows")]
fn start_codex_exit_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut misses = 0u32;
        loop {
            std::thread::sleep(CODEX_POLL_INTERVAL);
            match codex_running_state() {
                Some(false) => {
                    misses += 1;
                    if misses >= FOLLOW_EXIT_CONFIRMATIONS {
                        eprintln!("Codex exited; Quota Float follows");
                        app.exit(0);
                        return;
                    }
                }
                Some(true) => misses = 0,
                None => {}
            }
        }
    });
}

/// Applies the "start with Codex" setting and makes it effective immediately:
/// enabling also starts the follower watcher for this session, disabling stops
/// the tracked watcher (login-spawned watchers exit on their own through the
/// registry self-check). Shared by the tray menu and the settings window.
fn apply_autostart_setting(app: &AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = if enabled {
        repair_windows_autostart_entry(app)
    } else {
        disable_windows_autostart_entry(app)
    };

    #[cfg(not(target_os = "windows"))]
    let result = if enabled {
        app.autolaunch()
            .enable()
            .map_err(|error| format!("failed to enable startup: {error}"))
    } else {
        app.autolaunch()
            .disable()
            .map_err(|error| format!("failed to disable startup: {error}"))
    };

    #[cfg(target_os = "windows")]
    match (enabled, &result) {
        (true, Ok(())) => {
            if let Err(error) = spawn_follow_watcher(app) {
                eprintln!("{error}");
            }
        }
        (false, Ok(())) => stop_follow_watcher(app),
        _ => {}
    }

    result
}

#[tauri::command]
fn set_autostart_enabled(enabled: bool, app: AppHandle) -> Result<(), String> {
    apply_autostart_setting(&app, enabled)
}

fn autostart_is_enabled(app: &AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_autostart_is_enabled(app)
    }

    #[cfg(not(target_os = "windows"))]
    {
        app.autolaunch().is_enabled().unwrap_or(false)
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
    let unlock = MenuItem::with_id(app, "unlock", "Unlock widget", true, None::<&str>)?;
    let language = MenuItem::with_id(
        app,
        "language",
        "Switch Language / 切换语言",
        true,
        None::<&str>,
    )?;
    let theme_system = CheckMenuItem::with_id(app, "theme-system", "Follow system", true, false, None::<&str>)?;
    let theme_dark = CheckMenuItem::with_id(app, "theme-dark", "Dark", true, false, None::<&str>)?;
    let theme_light = CheckMenuItem::with_id(app, "theme-light", "Light", true, false, None::<&str>)?;
    let theme_sakura = CheckMenuItem::with_id(app, "theme-sakura", "Sakura Night", true, false, None::<&str>)?;
    let theme_warm = CheckMenuItem::with_id(app, "theme-warm", "Warm Daily Orange", true, false, None::<&str>)?;
    let theme_city = CheckMenuItem::with_id(app, "theme-city", "City Dusk Purple", true, false, None::<&str>)?;
    let theme_home = CheckMenuItem::with_id(app, "theme-home", "Home Night", true, false, None::<&str>)?;
    let theme_naruto = CheckMenuItem::with_id(app, "theme-naruto", "Naruto · Six Paths", true, false, None::<&str>)?;
    let theme_yone = CheckMenuItem::with_id(app, "theme-yone", "Spirit Blossom · Yone", true, false, None::<&str>)?;
    let theme_glacier = CheckMenuItem::with_id(app, "theme-glacier", "Glacier Aurora", true, false, None::<&str>)?;
    let preferences_menu = MenuItem::with_id(app, "preferences", "Preferences / 偏好设置", true, None::<&str>)?;
    let theme = Submenu::with_items(
        app,
        "Theme / 主题",
        true,
        &[
            &theme_system,
            &theme_dark,
            &theme_light,
            &theme_sakura,
            &theme_warm,
            &theme_city,
            &theme_home,
            &theme_naruto,
            &theme_yone,
            &theme_glacier,
        ],
    )?;
    let autostart_enabled = autostart_is_enabled(app.handle());
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start with Codex",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    #[cfg(debug_assertions)]
    let test_short_window = CheckMenuItem::with_id(
        app,
        "debug-short-window",
        "Test: simulate 5-hour quota",
        true,
        false,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let initial_language = app
        .try_state::<AppState>()
        .and_then(|state| {
            state
                .preferences
                .lock()
                .ok()
                .map(|prefs| prefs.language.clone())
        })
        .unwrap_or_else(|| "zh-CN".into());
    let initial_appearance = app
        .try_state::<AppState>()
        .and_then(|state| state.preferences.lock().ok().map(|prefs| prefs.appearance.clone()))
        .unwrap_or_else(|| "system".into());
    let _ = theme_system.set_checked(initial_appearance == "system");
    let _ = theme_dark.set_checked(initial_appearance == "dark");
    let _ = theme_light.set_checked(initial_appearance == "light");
    let _ = theme_sakura.set_checked(initial_appearance == "sakura");
    let _ = theme_warm.set_checked(initial_appearance == "warm");
    let _ = theme_city.set_checked(initial_appearance == "city");
    let _ = theme_home.set_checked(initial_appearance == "home");
    let _ = theme_naruto.set_checked(initial_appearance == "naruto");
    let _ = theme_yone.set_checked(initial_appearance == "yone");
    let _ = theme_glacier.set_checked(initial_appearance == "glacier");
    if initial_language != "en" {
        let _ = show.set_text("显示 / 隐藏");
        let _ = refresh.set_text("立即刷新");
        let _ = unlock.set_text("解锁悬浮窗");
        let _ = language.set_text("Switch to English");
        let _ = theme.set_text("主题");
        let _ = theme_system.set_text("跟随系统");
        let _ = theme_dark.set_text("深色");
        let _ = theme_light.set_text("浅色");
        let _ = theme_sakura.set_text("樱花夜");
        let _ = theme_warm.set_text("温暖·日常橙");
        let _ = theme_city.set_text("城市·暮色紫");
        let _ = theme_home.set_text("居家·夜晚");
        let _ = theme_naruto.set_text("六道·鸣人");
        let _ = theme_yone.set_text("灵魂莲华·永恩");
        let _ = theme_glacier.set_text("冰川极光");
        let _ = preferences_menu.set_text("偏好设置");
        let _ = autostart.set_text("随 Codex 启动");
        let _ = quit.set_text("退出");
    }
    if initial_language == "en" {
        let _ = theme.set_text("Theme");
        let _ = theme_system.set_text("Follow system");
        let _ = theme_dark.set_text("Dark");
        let _ = theme_light.set_text("Light");
        let _ = theme_sakura.set_text("Sakura Night");
        let _ = theme_warm.set_text("Warm Daily Orange");
        let _ = theme_city.set_text("City Dusk Purple");
        let _ = theme_home.set_text("Home Night");
        let _ = theme_naruto.set_text("Naruto · Six Paths");
        let _ = theme_yone.set_text("Spirit Blossom · Yone");
        let _ = theme_glacier.set_text("Glacier Aurora");
        let _ = preferences_menu.set_text("Preferences");
    }
    #[cfg(debug_assertions)]
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &refresh,
            &preferences_menu,
            &unlock,
            &language,
            &autostart,
            &theme,
            &test_short_window,
            &quit,
        ],
    )?;
    #[cfg(not(debug_assertions))]
    let menu = Menu::with_items(
        app,
        &[&show, &refresh, &preferences_menu, &unlock, &language, &autostart, &theme, &quit],
    )?;
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .menu_on_left_click(false)
        .tooltip("Quota Float");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let autostart_menu = autostart.clone();
    let show_menu = show.clone();
    let refresh_menu = refresh.clone();
    let unlock_menu = unlock.clone();
    let language_menu = language.clone();
    let theme_menu = theme.clone();
    let theme_system_menu = theme_system.clone();
    let theme_dark_menu = theme_dark.clone();
    let theme_light_menu = theme_light.clone();
    let theme_sakura_menu = theme_sakura.clone();
    let theme_warm_menu = theme_warm.clone();
    let theme_city_menu = theme_city.clone();
    let theme_home_menu = theme_home.clone();
    let theme_naruto_menu = theme_naruto.clone();
    let theme_yone_menu = theme_yone.clone();
    let theme_glacier_menu = theme_glacier.clone();
    let preferences_menu_menu = preferences_menu.clone();
    let theme_system_state = theme_system.clone();
    let theme_dark_state = theme_dark.clone();
    let theme_light_state = theme_light.clone();
    let theme_sakura_state = theme_sakura.clone();
    let theme_warm_state = theme_warm.clone();
    let theme_city_state = theme_city.clone();
    let theme_home_state = theme_home.clone();
    let theme_naruto_state = theme_naruto.clone();
    let theme_yone_state = theme_yone.clone();
    let theme_glacier_state = theme_glacier.clone();
    let quit_menu = quit.clone();
    #[cfg(debug_assertions)]
    let test_short_window_menu = test_short_window.clone();
    builder
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("widget") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            "refresh" => {
                let _ = app.emit_to("widget", "refresh-requested", ());
            }
            "debug-short-window" =>
            {
                #[cfg(debug_assertions)]
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut enabled) = state.simulate_short_window_for_testing.lock() {
                        *enabled = !*enabled;
                        let _ = test_short_window_menu.set_checked(*enabled);
                        let _ = app.emit_to("widget", "refresh-requested", ());
                    }
                }
            }
            "unlock" => {
                let _ = apply_lock(app, false);
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut prefs) = state.preferences.lock() {
                        prefs.locked = false;
                        let _ = persist_preferences(&state.preferences_path, &prefs);
                        let _ = app.emit_to("widget", "preferences-changed", prefs.clone());
                    }
                }
            }
            "language" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut prefs) = state.preferences.lock() {
                        prefs.language = if prefs.language == "en" {
                            "zh-CN".into()
                        } else {
                            "en".into()
                        };
                        let normalized = prefs.clone().normalized();
                        *prefs = normalized.clone();
                        let _ = persist_preferences(&state.preferences_path, &normalized);
                        let english = normalized.language == "en";
                        let _ = show_menu.set_text(if english {
                            "Show / Hide"
                        } else {
                            "显示 / 隐藏"
                        });
                        let _ = refresh_menu.set_text(if english {
                            "Refresh now"
                        } else {
                            "立即刷新"
                        });
                        let _ = unlock_menu.set_text(if english {
                            "Unlock widget"
                        } else {
                            "解锁悬浮窗"
                        });
                        let _ = language_menu.set_text(if english {
                            "切换到中文"
                        } else {
                            "Switch to English"
                        });
                        let _ = theme_menu.set_text(if english { "Theme" } else { "主题" });
                        let _ = theme_system_menu.set_text(if english { "Follow system" } else { "跟随系统" });
                        let _ = theme_dark_menu.set_text(if english { "Dark" } else { "深色" });
                        let _ = theme_light_menu.set_text(if english { "Light" } else { "浅色" });
                        let _ = theme_sakura_menu.set_text(if english { "Sakura Night" } else { "樱花夜" });
                        let _ = theme_warm_menu.set_text(if english { "Warm Daily Orange" } else { "温暖·日常橙" });
                        let _ = theme_city_menu.set_text(if english { "City Dusk Purple" } else { "城市·暮色紫" });
                        let _ = theme_home_menu.set_text(if english { "Home Night" } else { "居家·夜晚" });
                        let _ = theme_naruto_menu.set_text(if english { "Naruto · Six Paths" } else { "六道·鸣人" });
                        let _ = theme_yone_menu.set_text(if english { "Spirit Blossom · Yone" } else { "灵魂莲华·永恩" });
                        let _ = theme_glacier_menu.set_text(if english { "Glacier Aurora" } else { "冰川极光" });
                        let _ = preferences_menu_menu.set_text(if english { "Preferences" } else { "偏好设置" });
                        let _ = autostart_menu.set_text(if english {
                            "Start with Codex"
                        } else {
                            "随 Codex 启动"
                        });
                        let _ = quit_menu.set_text(if english { "Quit" } else { "退出" });
                        let _ = app.emit_to("widget", "preferences-changed", normalized.clone());
                    }
                }
            }
            "preferences" => {
                if let Some(window) = app.get_webview_window("settings") {
                    if let Err(error) = normalize_settings_window_size(&window) {
                        eprintln!("{error}");
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "theme-system" | "theme-dark" | "theme-light" | "theme-sakura" | "theme-warm" | "theme-city" | "theme-home" | "theme-naruto" | "theme-yone" | "theme-glacier" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut prefs) = state.preferences.lock() {
                        prefs.appearance = match event.id.as_ref() {
                            "theme-dark" => "dark".into(),
                            "theme-light" => "light".into(),
                            "theme-sakura" => "sakura".into(),
                            "theme-warm" => "warm".into(),
                            "theme-city" => "city".into(),
                            "theme-home" => "home".into(),
                            "theme-naruto" => "naruto".into(),
                            "theme-yone" => "yone".into(),
                            "theme-glacier" => "glacier".into(),
                            _ => "system".into(),
                        };
                        let normalized = prefs.clone().normalized();
                        *prefs = normalized.clone();
                        if persist_preferences(&state.preferences_path, &normalized).is_ok() {
                            let _ = theme_system_state.set_checked(normalized.appearance == "system");
                            let _ = theme_dark_state.set_checked(normalized.appearance == "dark");
                            let _ = theme_light_state.set_checked(normalized.appearance == "light");
                            let _ = theme_sakura_state.set_checked(normalized.appearance == "sakura");
                            let _ = theme_warm_state.set_checked(normalized.appearance == "warm");
                            let _ = theme_city_state.set_checked(normalized.appearance == "city");
                            let _ = theme_home_state.set_checked(normalized.appearance == "home");
                            let _ = theme_naruto_state.set_checked(normalized.appearance == "naruto");
                            let _ = theme_yone_state.set_checked(normalized.appearance == "yone");
                            let _ = theme_glacier_state.set_checked(normalized.appearance == "glacier");
                            let _ = app.emit_to("widget", "preferences-changed", normalized.clone());
                        }
                    }
                }
            }
            "autostart" => {
                let enabled = autostart_is_enabled(app);
                match apply_autostart_setting(app, !enabled) {
                    Ok(()) => {
                        let _ = autostart_menu.set_checked(!enabled);
                    }
                    Err(error) => eprintln!("autostart update failed: {error}"),
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    #[cfg(target_os = "windows")]
    {
        // Login launches run as a window-less watcher only: no Tauri app is
        // built until Codex actually appears, so nothing shows up when Codex
        // is absent.
        if std::env::args().any(|arg| arg == AUTOSTART_WITH_CODEX_FLAG) {
            run_codex_watcher();
            return;
        }
        // A follow launch races Codex shutdown; if Codex is verifiably gone on
        // two samples, exit without ever creating a window.
        if std::env::args().any(|arg| arg == FOLLOW_CODEX_FLAG)
            && codex_running_state() == Some(false)
        {
            std::thread::sleep(Duration::from_millis(400));
            if codex_running_state() == Some(false) {
                return;
            }
        }
    }

    #[cfg(target_os = "windows")]
    let autostart_args = Some(vec![AUTOSTART_WITH_CODEX_FLAG]);
    #[cfg(not(target_os = "windows"))]
    let autostart_args: Option<Vec<&'static str>> = None;

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("widget") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            autostart_args,
        ))
        .plugin(WindowStateBuilder::default().with_denylist(&["context-menu"]).build())
        .setup(|app| {
            let data_dir = app.path().app_config_dir()?;
            let preferences_path = data_dir.join("preferences.json");
            let history_path = data_dir.join("quota-history.json");
            let preferences = load_preferences(&preferences_path);
            let quota_history = QuotaHistoryStore::load(history_path);
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("QuotaFloat/0.1")
                .build()
                .expect("static HTTP client configuration must be valid");
            app.manage(AppState {
                client,
                preferences: Mutex::new(preferences.clone()),
                preferences_path,
                quota_history: Mutex::new(quota_history),
                fetch_lock: tokio::sync::Mutex::new(()),
                snapshot_cache: Mutex::new(None),
                #[cfg(debug_assertions)]
                simulate_short_window_for_testing: Mutex::new(false),
                geometry: Mutex::new(None),
                context_menu: Mutex::new(None),
                drag_mode: Mutex::new(None),
                #[cfg(target_os = "windows")]
                follow_watcher: Mutex::new(None),
            });
            #[cfg(target_os = "windows")]
            {
                // Repair an existing enabled entry as well as newly enabled
                // entries, so users do not need to toggle the setting twice
                // after upgrading from the unquoted command implementation.
                if autostart_is_enabled(app.handle()) {
                    if let Err(error) = repair_windows_autostart_entry(app.handle()) {
                        eprintln!("failed to repair Windows startup command: {error}");
                    }
                }
                if std::env::args().any(|arg| arg == FOLLOW_CODEX_FLAG) {
                    // window-state restores the last saved visibility, which
                    // may be hidden; a follow launch must surface the widget.
                    if let Some(window) = app.get_webview_window("widget") {
                        let _ = window.show();
                    }
                    start_codex_exit_watcher(app.handle().clone());
                    let _ = app.emit_to("widget", "refresh-requested", ());
                }
            }
            if setup_tray(app).is_err() {
                eprintln!("tray setup failed; enabling taskbar fallback");
                if let Some(window) = app.get_webview_window("widget") {
                    let _ = window.set_skip_taskbar(false);
                }
            }
            if let Some(window) = app.get_webview_window("settings") {
                if let Err(error) = normalize_settings_window_size(&window) {
                    eprintln!("{error}");
                }
            }
            if preferences.locked {
                let _ = apply_lock(app.handle(), true);
            }
            if let Some(window) = app.get_webview_window("widget") {
                let _ = window.set_always_on_top(preferences.always_on_top);
                // A saved window position can be outside the active monitor while
                // iterating in development. Keep the test widget discoverable.
                #[cfg(debug_assertions)]
                {
                    let _ = window.center();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            #[cfg(debug_assertions)]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(800));
                    if let Some(window) = handle.get_webview_window("widget") {
                        let _ = window.set_position(PhysicalPosition::new(120, 120));
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshots,
            refresh_snapshots,
            get_quota_history,
            clear_quota_history,
            expand_widget,
            collapse_widget,
            set_widget_menu_open,
            get_context_menu,
            show_context_menu,
            begin_widget_drag,
            finish_widget_drag,
            get_preferences,
            set_preferences,
            set_widget_opacity,
            set_widget_liquid_glass,
            set_widget_background_image,
            set_widget_locked,
            set_widget_always_on_top,
            sync_widget_appearance,
            hide_widget,
            show_widget,
            is_widget_visible,
            open_settings_window,
            quit_application,
            get_autostart_status,
            set_autostart_enabled,
        ])
        .on_tray_icon_event(|app, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = app.get_webview_window("widget") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.label() == "context-menu" {
                    // Native close requests must release the widget's menu
                    // guard just like Escape or a click outside the popup.
                    let app = window.app_handle();
                    let _ = set_widget_menu_open(false, None, None, app.clone(), app.state());
                } else {
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Quota Float");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Resumed) {
            let _ = app_handle.emit_to("widget", "refresh-requested", ());
        }
    });
}
