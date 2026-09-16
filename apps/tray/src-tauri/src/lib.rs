//! Pace tray app — the shell around the pace engine (bogez/pace#16).
//!
//! The frontend (the PWA, rebuilt into ../dist) computes the pace delta,
//! color, and state, then calls `set_tray` below. Rust's jobs are exactly two:
//! paint the tray dot / toggle the popover, and read local Claude Code
//! transcripts via the pace-sensor crate (`read_sensor`) — the in-process
//! sensor decided in docs/design/tray-sensor.md. Everything else stays in JS,
//! shared with the web app, where it is testable.
//!
//! Read-only, fully local: no network, no credentials, nothing leaves the
//! machine (TRUST.md commitments 1 & 2).

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItem, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager, Wry,
};

/// The tray menu's show/hide entry, kept in app state so its label can follow
/// the popover's real visibility. On Linux the menu is the only way to reach
/// the window, so a one-way "Show Pace" would leave the window's X as the only
/// way to dismiss it — the tray has to offer both halves of the toggle.
struct ToggleItem(MenuItem<Wry>);

fn set_toggle_label(app: &tauri::AppHandle, visible: bool) {
    if let Some(item) = app.try_state::<ToggleItem>() {
        let _ = item.0.set_text(if visible { "Hide Pace" } else { "Show Pace" });
    }
}

/// Show the popover if hidden, hide it if shown — the same gesture the
/// left-click toggle gives macOS and Windows.
fn toggle_popover(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            set_toggle_label(app, false);
        } else {
            show_popover(app);
        }
    }
}

/// Render a filled circle (the pace dot) as an RGBA icon at runtime.
fn dot_icon(r: u8, g: u8, b: u8) -> Image<'static> {
    const S: usize = 32;
    let mut buf = vec![0u8; S * S * 4];
    let c = (S as f32 - 1.0) / 2.0;
    let radius = S as f32 / 2.0 - 2.0;
    for y in 0..S {
        for x in 0..S {
            let dx = x as f32 - c;
            let dy = y as f32 - c;
            let dist = (dx * dx + dy * dy).sqrt();
            // 1px anti-aliased edge
            let alpha = ((radius - dist + 0.5).clamp(0.0, 1.0) * 255.0) as u8;
            let i = (y * S + x) * 4;
            buf[i] = r;
            buf[i + 1] = g;
            buf[i + 2] = b;
            buf[i + 3] = alpha;
        }
    }
    Image::new_owned(buf, S as u32, S as u32)
}

/// Called by the frontend whenever the pace reading changes. The tooltip must
/// already carry the non-color channel (glyph + state words + honesty
/// qualifiers) — never color alone, not even on 16 pixels.
#[tauri::command]
fn set_tray(app: tauri::AppHandle, r: u8, g: u8, b: u8, tooltip: String) {
    if let Some(tray) = app.tray_by_id("pace") {
        let _ = tray.set_icon(Some(dot_icon(r, g, b)));
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

/// Read the measured-usage file the statusline bridge tees to
/// `~/.pace/usage.json` (sensors/statusline.mjs, bogez/pace#51). Returns
/// None when absent. Read-only here — the bridge is the only writer; the
/// frontend parses and validates (app/measured.js stays the source of truth).
#[tauri::command]
fn read_usage_file() -> Option<String> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    let path = std::path::PathBuf::from(home).join(".pace").join("usage.json");
    std::fs::read_to_string(path).ok()
}

/// Parse local Claude Code transcripts into the same aggregate shape as
/// `sensors/parse-transcripts.mjs`. The frontend supplies the window starts
/// and weights (its `window.js` / `weights.mjs` remain the source of truth);
/// Rust only enumerates, reads, and counts.
#[tauri::command]
fn read_sensor(
    week_start_ms: f64,
    session_start_ms: Option<f64>,
    weights: pace_sensor::Weights,
) -> serde_json::Value {
    let root = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
        .unwrap_or_default()
        .join(".claude");
    let (texts, files) = pace_sensor::read_transcript_texts(&root, week_start_ms);
    let result = pace_sensor::parse_transcripts(texts, week_start_ms, session_start_ms, &weights);
    let mut v = serde_json::to_value(result).unwrap_or_default();
    v["files"] = files.into();
    v
}

/// Bring the popover up. The window is an ordinary taskbar window, so if the
/// WM declines to raise or focus it, it is still recoverable by normal means —
/// no always-on-top or restacking tricks here.
fn show_popover(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        set_toggle_label(app, true);
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_tray, read_sensor, read_usage_file])
        .setup(|app| {
            // The menu is the ONLY interaction surface on Linux: tray click
            // events are never emitted there (tray-icon/libayatana-appindicator
            // exposes a menu and nothing else), and `show_menu_on_left_click`
            // is documented "Linux: Unsupported" — the menu opens on either
            // button. So "Show Pace" has to live in the menu, or a Linux user
            // gets a dot they can never open.
            let toggle = MenuItemBuilder::with_id("toggle", "Show Pace").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit Pace").build(app)?;
            let menu = MenuBuilder::new(app).item(&toggle).separator().item(&quit).build()?;
            app.manage(ToggleItem(toggle.clone()));

            TrayIconBuilder::with_id("pace")
                .icon(dot_icon(137, 135, 129)) // gray until first data
                .tooltip("Pace — no data yet")
                .menu(&menu)
                // macOS/Windows: left-click toggles the popover directly (below),
                // so the menu stays on right-click. No-op on Linux.
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_popover(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click toggles the popover. Never fires on Linux —
                    // that platform goes through the "Show Pace" menu item.
                    if let TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_popover(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Deliberately NOT hiding on `Focused(false)`: the window holds
            // native controls (the reset <select>s, the number inputs), and a
            // GTK dropdown takes focus while it is open. Dismissing on blur
            // tears the popover down mid-interaction and makes those controls
            // impossible to use. The window earns its keep in the taskbar
            // instead — see `skipTaskbar` in tauri.conf.json.
            //
            // Closing the popover hides it instead of quitting the app.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
                set_toggle_label(window.app_handle(), false);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Pace")
}
