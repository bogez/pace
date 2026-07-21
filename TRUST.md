# Trust policy

Pace's core differentiator is that its trustworthiness is **verifiable, not asserted**
(charter principle 1). This file lists the concrete commitments, how each one is verified,
and by whom. Commitments are permanent; verification tightens as components ship.

## Permanent commitments

These hold for every version, forever. A pull request that violates one will be closed,
per [CONTRIBUTING.md](CONTRIBUTING.md).

| # | Commitment | Verification |
|---|---|---|
| 1 | **No scraping, ever.** No session scraping, auth-token replay, or polling of undocumented endpoints. Data sources are official APIs, local files the user already owns, or manual input. | Human review of every PR touching sensors; the rule is a merge requirement. |
| 2 | **All data stays on your device.** No cloud, no accounts, no telemetry. There is no server that could see your data. | **CI-enforced** ([`test/trust.test.js`](test/trust.test.js)): the build fails on any network API (`fetch`, `XMLHttpRequest`, `WebSocket`, beacons) in shipped code or any page resource loading from an external origin. The service worker may `fetch` only same-origin shell files, and CI verifies its origin guard is present. |
| 3 | **The engine has zero dependencies.** The pace math is plain ESM with no imports and no runtime packages. | **CI-enforced** ([`test/trust.test.js`](test/trust.test.js)): the build fails if `package.json` gains `dependencies` or the engine gains an `import`. |
| 4 | **Leaving is easy and complete.** Uninstall steps and data locations are documented per platform, and "Clear all data" actually clears everything. | Clear-all-data: **CI-enforced** browser test ([`e2e/clear-data.spec.js`](e2e/clear-data.spec.js)) — after clicking it, localStorage is empty. Uninstall docs: verified by hand on each OS before release, with dates recorded ([#18](https://github.com/bogez/pace/issues/18)). |
| 5 | **Estimates never impersonate measurements.** Sensor-derived numbers are visibly estimates; stale data is visibly stale. | Staleness: **CI-enforced** browser tests ([`e2e/staleness.spec.js`](e2e/staleness.spec.js)) — check-in age always shown; past 24 h the meter degrades on every channel (desaturated dot, "probably", qualified forecast). Estimated vs. measured: **CI-enforced** browser tests ([`e2e/sensor-import.spec.js`](e2e/sensor-import.spec.js)) — sensor-derived numbers carry "≈", "(estimated)", a dashed dot, and a source line; a manual check-in always wins instantly; uncalibrated state never shows a percent. |
| 6 | **Binaries are built in public.** Native installers come from GitHub Actions runs on this repository — anyone can audit the code and watch the build that produced the download. | The release workflow and its run logs are public ([#17](https://github.com/bogez/pace/issues/17)). |

## Current status

The project is pre-alpha. Shipped so far: the engine and the tracker PWA
([bogez.github.io/pace](https://bogez.github.io/pace/)), both with their trust checks live
in CI (commitments 2–4). Commitments 1, 5, and 6 become machine- or process-enforced as
the sensor (M3) and native builds (M4) land — a component is not considered shipped until
its trust checks ship with it.

## Honest limitations

- Unsigned native installers trigger OS warnings (SmartScreen, Gatekeeper). That is the
  operating systems working as intended on software that hasn't paid for code signing. The
  README documents exactly what you'll see and why; if that makes you uncomfortable, the
  web app involves no installer at all. Signed distribution is a
  [parked milestone](https://github.com/bogez/pace/issues/21), sponsor-funded.
- Sensor estimates are approximations calibrated against what you type in from `/usage`.
  They can drift between calibrations; the UI is designed to make that drift visible
  rather than hide it.

## Reporting a violation

If you believe any commitment above is violated — in code, in docs, or in a release —
open an issue immediately, or use the private channel in [SECURITY.md](SECURITY.md) if
disclosure could put users at risk.
