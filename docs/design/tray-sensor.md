# Tray sensor wiring: in-process Rust port

**Status:** accepted — argued and decided in
[#15](https://github.com/bogez/pace/issues/15) (see the thread). Implemented by
[#16](https://github.com/bogez/pace/issues/16) (tray shell) under the CI gate of
[#17](https://github.com/bogez/pace/issues/17).

## The problem

The tray app needs sensor data. The transcript parser exists in JavaScript
(`sensors/parse-transcripts.mjs`), but tray users can't be assumed to have Node — and the
options for getting parsed usage into a Rust/Tauri process trade user friction against
maintenance cost:

1. **Rust port of the parser** — zero runtime dependencies for users; the parsing logic
   exists twice.
2. **Bundle or shell out to Node** — single implementation; requires Node on the user's
   machine or bundling a runtime (installer size, AV-heuristic risk on Windows — see the
   prototype's unsigned-installer history in the pace-concept HANDOFF).
3. **Snapshot file written by a separately scheduled Node sensor** — loose coupling;
   staleness becomes the norm rather than the exception.

## The deciding constraint

Maintainer requirement from the fresh-start planning session (2026-07-21):

> **Installable versions must not require any manual processes** — no separately
> installed or separately running Node, no background scripts. The sensor runs
> in-process.

That eliminates option 2 outright and option 3 as a primary architecture (a snapshot file
produced by a separately running sensor *is* the manual process being ruled out).

## Decision

**Option 1: port the transcript parser to Rust, compiled into the tray app.**

## Consequences (the contract #16 implements)

- **The #11 fixture suite is the cross-implementation contract.** The Rust parser must
  produce identical aggregates to the JS parser against the same fixtures, enforced in
  CI, so the two implementations cannot drift. `parse-transcripts.mjs` was deliberately
  built as a pure function of (file contents, window config) so this comparison is exact.
- **The JS parser is the reference implementation.** The PWA and CLI tooling keep using
  it; Rust is a port, never a fork of behavior. Format knowledge (assistant-only usage
  lines, dedupe by `message.id`, silent skip of malformed lines) changes in JS first,
  gets a fixture, then propagates to Rust.
- **Manual `/usage` entry survives only as calibration** (per
  [calibration.md](./calibration.md) — occasional, self-correcting, honesty-labeled),
  never as an operating requirement of the tray app.

## Open question carried into #16

Whether the popover's calibration UI shares the PWA's storage schema
(`pace.calibration.v1`) so calibration is portable between shells. Leaning yes — the
popover reuses the PWA's rendering and localStorage model, so divergent schemas would be
a re-declared boundary.
