# Measured usage from Claude Code's statusline

**Status:** accepted — designed and decided in
[#51](https://github.com/bogez/pace/issues/51). Implements the option there of
measured usage as the primary automatic source, with the transcript-parsing +
calibration pipeline ([calibration.md](calibration.md), #10–#14) demoted to a
fallback.

## What changed upstream

Claude Code passes JSON to the user's configured statusline script
([documented](https://code.claude.com/docs/en/statusline), "Available fields").
For Pro/Max subscribers it includes:

- `rate_limits.five_hour.used_percentage` / `rate_limits.seven_day.used_percentage`
  — 0–100, the same numbers `/usage` shows
- `rate_limits.five_hour.resets_at` / `rate_limits.seven_day.resets_at`
  — epoch **seconds** when each window resets

That is exactly the number Pace previously asked users to type, and exactly
what calibration exists to approximate.

## The pipeline

```
Claude Code ──stdin JSON──▶ sensors/statusline.mjs ──▶ ~/.pace/usage.json
                              (the bridge: tee + print      │
                               a pace summary line)         ├─▶ tray app auto-reads (read_usage_file)
                                                            └─▶ PWA import (paste / file picker)
                                     both land in app/measured.js → pace.measured.v1
```

- **The bridge** (`sensors/statusline.mjs`) tees `{generatedAt, rate_limits}`
  to the usage file and prints a one-line pace summary — the statusline itself
  becomes a pace meter. It must never break the statusline: any failure still
  prints a line and exits 0.
- **Parsing** (`app/measured.js`) is pure and accepts both the raw statusline
  document and the teed file. Windows can be independently absent. A raw paste
  has no timestamp, so it is stamped at import time.
- **Storage** is `pace.measured.v1` — `{ t, weekly: {pct, resetsAt}|null,
  session: {pct, resetsAt}|null }`.

## Source preference (extends #13's contract)

Manual check-ins and statusline snapshots are both **measured** — real
`/usage` numbers. Recency arbitrates between them; the manual form stays the
correction channel. The calibrated sensor estimate is used only when it is
newer than every measured reading, rendered in the estimated style as before,
and floored at the latest in-window measurement (usage is cumulative — see
calibration.md, "The check-in floor").

A measured snapshot renders in the **measured** style (no "≈", no dashed dot)
with its own source line ("Measured by Claude Code") and age line ("Measured
snapshot … ago") — the staleness grammar (#9) applies unchanged.

## Windows from `resets_at`

When a live weekly `resets_at` is known, the window is derived from it
(`windowFromReset`: the 168 h ending at the reset) instead of the configured
day-of-week anchor — the provider's own boundary, no setup, and correct for
accounts whose reset drifts. A snapshot whose own `resets_at` has passed
describes a finished week and is never used. The measured `five_hour` window
feeds the session line the same way, arbitrating with the manual entry by
recency.

## Calibration without typing

A measured weekly % is as real as a typed one, so importing a *new* snapshot
runs the same calibration act as a check-in (pairing with a sensor snapshot
≤ 3 h apart). Re-imports of the same snapshot (the tray re-reads the file on
a timer) never re-calibrate. Calibration thus keeps improving silently, and
the estimate fallback stays useful for machines without the bridge.

## Trust (TRUST.md commitment 1)

The statusline JSON is official, documented Claude Code behavior; the usage
file is a local file written by the user's own configuration. No token replay,
no undocumented endpoints — the community-known `claude.ai/api/oauth/usage`
endpoint is explicitly **not** used, being both undocumented and
token-replaying. The bridge is scanned by the trust suite: no network APIs,
writes only through allowlisted APIs, reads nothing but stdin.

## Known limitations

- **Pro/Max only** — API-key users have no `rate_limits`; the bridge prints a
  waiting line and the estimate/manual paths carry on.
- **Per-machine freshness** — the file updates only while Claude Code runs on
  that machine; usage from other devices or claude.ai chat appears only when
  the server-side percentage refreshes on the next local response. Staleness
  honesty covers the gap.
- **168 h assumption** — `resets_at` gives the window's end, not its length;
  Pace assumes the documented 7-day window. Accounts observed with shorter
  effective windows will show a compressed elapsed %; the delta still uses
  the same assumption consistently.
