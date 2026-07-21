# Calibration: weighted tokens → estimated quota %

**Status:** accepted — designed and decided in
[#10](https://github.com/bogez/pace/issues/10) (see the thread for the discussion and a
plain-language summary). Implemented across [#11](https://github.com/bogez/pace/issues/11)
(sensor) and [#13](https://github.com/bogez/pace/issues/13) (surfacing); graded by the
[#12](https://github.com/bogez/pace/issues/12) soak test.

## The problem

Sensors measure **weighted tokens** (`W`, cumulative in the billing window). The quota is
an opaque **percentage** (`U`) that only `/usage` knows. There is no published exchange
rate and no official API — and Pace never scrapes (TRUST.md commitment 1).

## The model

One scale factor:

> **K = weighted tokens per quota percent.** Estimated % = W / K.

- Every manual `/usage` check-in while the sensor runs yields an observation
  `K_obs = W_now / U_now` (guarded: both must be > 0).
- Update by exponential moving average: `K ← ½·K_obs + ½·K`. With roughly daily
  check-ins this adapts within a few days without whipsawing on one noisy reading.
- Every observation is appended to a **calibration log** (timestamp, raw token component
  counts, `U`, `K_obs`), capped at ~30 entries. The log is what the soak test grades and
  what allows recomputation if the model changes.
- `K` persists across window resets (it is a property of how the provider prices usage,
  not of the current week); `W` resets with the window.

## Token weights — versioned, raw counts kept

```
WEIGHTS v1 = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }
```

Prototype values, mirroring API price relatives (cache reads dominate raw counts but cost
almost nothing). The stored calibration is tagged with the weights version, and the log
stores **raw component counts** rather than only the weighted sum — a pricing change bumps
the version and recomputes historical `K_obs` instead of starting blind.

## Confidence

Two ingredients, surfaced through the staleness grammar shipped in
[#9](https://github.com/bogez/pace/issues/9):

1. **Calibration age** — the same fresh (≤ 12 h) / aging (≤ 24 h) / stale tiers, because
   the failure mode is identical: the mapping drifts while the display stays confident.
2. **Dispersion** — if the latest `K_obs` deviates from `K` by more than 50%, the display
   reports "calibration unstable — check /usage" instead of silently averaging.

A sensor-derived estimate is **never rendered in the measured style** (TRUST.md
commitment 5); estimated vs. measured presentation is [#13](https://github.com/bogez/pace/issues/13)'s
contract.

## The zero state

Before the first calibration point, only what is truly known is shown: weighted tokens
and burn rate ("3.3M weighted this week, ~40k/h") with a prompt to enter `/usage` once.
**Never an invented percentage.**

## Storage (localStorage, versioned keys)

```jsonc
// pace.calibration.v1
{
  "K": 62000,
  "weightsVersion": 1,
  "log": [
    { "t": 1784600000000, "U": 53,
      "raw": { "input": 900000, "output": 350000, "cacheWrite": 400000, "cacheRead": 8000000 } }
  ]
}

// pace.sensor.v1 — latest sensor snapshot
{ "t": 1784600000000, "windowStart": 1784200000000,
  "raw": { "input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0 }, "weighted": 0 }
```

Migration = a new versioned key plus a one-time converter; old keys are removed after
migrating. The tray app (see [#15](https://github.com/bogez/pace/issues/15)) uses the same
schema so calibration is portable between shells.

## Known blind spot

Transcripts only see **Claude Code** usage. Chat on claude.ai burns quota invisibly;
calibration absorbs the user's average mix, but a chat-heavy burst skews the estimate
until the next check-in. This is documented user-facing, not hidden.

## Acceptance bar (the soak test, #12)

Estimated % within **±5 points** of actual `/usage` between daily calibrations over a
full billing week — the green zone's width. If that fails, the divergence pattern is
analyzed and this design comes back for revision before v0.3.0 tags.
