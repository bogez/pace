# Pace tray app

The end-state vision ([#16](https://github.com/bogez/pace/issues/16)): a colored dot in
the menu bar/taskbar. One glance, one color, no math — and no app to open.

## Architecture

The popover **is** the web tracker: `build-ui.mjs` copies the PWA's files into `dist/`
unchanged, and `app/tray.js` (a no-op in the browser) bridges to Tauri. The division of
labor, per [docs/design/tray-sensor.md](../../docs/design/tray-sensor.md):

- **JS (shared with the PWA, all of it unit-tested):** windows, weights, calibration,
  pace math, colors, tooltip composition (`app/tray-format.js`). The tracker dispatches
  `pace:reading` events; the bridge forwards them to Rust.
- **Rust (`src-tauri`, deliberately tiny):** paint a runtime-generated RGBA dot +
  tooltip (`set_tray`), toggle the popover, and read `~/.claude/projects/**/*.jsonl`
  in-process (`read_sensor`, via the `pace-sensor` crate). Read-only, local, no network
  — the sensor runs in-process so installed versions need no separately-running
  anything.
- **`sensor-rs`:** the Rust port of `sensors/parse-transcripts.mjs`. The JS parser is
  the reference; `tests/parity.rs` pins this port to the same
  `test/fixtures/claude-code/expected.json` the JS suite asserts against, so the two
  implementations cannot drift.

Honesty carries to 16 pixels: the tooltip always has the direction glyph and state words
(never color alone), estimated readings read "≈ … (estimated)", and stale readings
desaturate the dot and say "probably".

## Develop

```sh
# parser parity suite (no system deps beyond cargo)
cd apps/tray/sensor-rs && cargo test

# run the tray app (needs the Tauri v2 toolchain; on Linux see the
# system packages in the release workflow)
cd apps/tray && npm install && npm run dev
```

Icons are generated at build time (`node ../../scripts/make-icon.mjs app-icon.png 1024
&& npx tauri icon app-icon.png`) — nothing binary is committed.

## Trust

Same commitments as everywhere else ([TRUST.md](../../TRUST.md)): reads local files
only, nothing leaves the machine, uninstalling removes one app and one local data
folder. Native builds are unsigned for now — see the README's warning section — and the
PWA remains the flagship.
