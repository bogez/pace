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
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};

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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_tray, read_sensor])
        .setup(|app| {
            let quit = MenuItemBuilder::with_id("quit", "Quit Pace").build(app)?;
            let menu = MenuBuilder::new(app).item(&quit).build()?;

            TrayIconBuilder::with_id("pace")
                .icon(dot_icon(137, 135, 129)) // gray until first data
                .tooltip("Pace — no data yet")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // left-click toggles the popover window
                    if let TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the popover hides it instead of quitting
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Pace")
}
