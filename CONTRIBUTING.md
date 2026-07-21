# Contributing to Pace

Thanks for your interest! Pace is small on purpose, and its development process is part of
the product — the [charter](CHARTER.md) explains why.

## Ground rules

These are merge requirements, not suggestions:

1. **No sketchy data sources — ever.** Sensors must use official APIs, local files the
   user already owns, or manual input. PRs that scrape sessions, replay auth tokens, or
   poll undocumented endpoints will be closed. See [TRUST.md](TRUST.md).
2. **The engine stays dependency-free.** The pace math is plain ESM with no imports and no
   runtime packages. Churn belongs in sensors and shells.
3. **Never color alone.** Any UI change must keep a non-color channel (glyph, label,
   position) for every state.
4. **Estimates never impersonate measurements.** Anything computed from a sensor is
   visibly an estimate; anything stale is visibly stale.

## How work flows

1. **Every change starts as an issue.** Check the
   [existing issues](https://github.com/bogez/pace/issues) first — the roadmap backlog is
   already filed. For new ideas, open an issue and talk it through before writing code;
   for design questions, use the design-decision template. The issue trail is the
   project's design record.
2. **One branch and one PR per issue.** Branch from `main`, reference the issue in the PR
   (`Closes #N`).
3. **Tests come with the change**, not after. Engine behavior is pinned by tests; UI
   changes update the checks that guard them.
4. **CI must be green** and a maintainer reviews before merge.

## Running things locally

```sh
npm test
```

(That's it for now — the project is pre-alpha. This section grows as components land.)

## Good first contributions

- Weigh in on open [design-decision issues](https://github.com/bogez/pace/issues?q=is%3Aissue+is%3Aopen+label%3Adesign-decision)
  — e.g. calibration modeling (#10) or tray sensor wiring (#15)
- Zone-boundary opinions (green ±5, full red +25, full blue −50): open an issue with your
  reasoning
- Once M2 lands: accessibility review, provider window presets

## Conduct

Be kind. The [Code of Conduct](CODE_OF_CONDUCT.md) applies everywhere the project lives.
