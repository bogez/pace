# Pace — Project Charter

## Vision

**A pace meter for your AI subscription.** AI plans give you a usage percentage; Pace does
the math you'd otherwise do in your head and answers one question at a glance: *am I in the
zone?* Green means your burn matches your billing window. Red means you'll hit the cap
early. Blue means headroom you're leaving on the table. One glance, one color, no math.

## Who it's for

- **The rationer** — a Claude Pro/Max subscriber who budgets a weekly quota and wants to
  know "can I afford a heavy session tonight?" without arithmetic.
- **The agent runner** — a Claude Code user whose quota burns invisibly while agents work;
  they want ambient awareness, not another dashboard to check.
- *(Stretch, engine-level only for now)* — anyone with a quota that has a % and a reset
  window: other AI subscriptions, API spend budgets.

Built for Claude first; works for anything with a percentage and a reset.

## Goals (v1)

1. **PWA tracker** — the flagship: zero-install, works everywhere, value within one minute
   of opening it.
2. **Pace engine** — tiny, dependency-free, fully tested; the single source of truth for
   zone boundaries.
3. **Claude Code sensor** — automatic usage from local transcripts, with **calibration
   honesty**: estimates are labeled as estimates, staleness is visible, and a manual
   `/usage` check-in corrects the scale factor.
4. **Native tray app** — the colored dot in the menu bar/taskbar, built by public CI.
5. **Trust as a tested feature** — see Principles; claims are verifiable, some by CI.

## Non-goals

- **No scraping, ever.** No session scraping, auth-token replay, or polling of
  undocumented endpoints — even if it would make the product dramatically better. This is
  permanent, not a v1 cut.
- **No cloud, no accounts, no telemetry.** Pace never sees your data; there is no server
  to see it.
- **No monetization of users.** Platform tolls (signing certs, store fees) are
  sponsor-funded or waited out — never paywalled features.
- **Not a dashboard.** Pace is ambient. If a feature demands the user's attention rather
  than saving it, it doesn't belong.

## Principles

1. **Trust is verifiable, not asserted.** [TRUST.md](TRUST.md) lists concrete claims —
   zero network calls in the PWA, zero engine dependencies, all data local, complete
   uninstall — and CI enforces the ones a machine can check.
2. **Never color alone.** Every state carries a non-color channel (glyph, label).
   Accessibility is a merge requirement, not a follow-up.
3. **A confident wrong color is worse than no color.** Estimated values are visibly
   estimates; stale data is visibly stale.
4. **The engine stays boring.** Pure functions, no dependencies, behavior pinned by tests.
   All churn lives in sensors and shells.
5. **Decisions leave a trail.** Design choices happen in issues before code; the issue
   history is the design record. (The prototype's zone boundaries — green ±5, full red at
   +25, full blue at −50 — carry over as pinned-but-debatable defaults; changing them takes
   an issue, not a whim.)
6. **Leaving is easy.** Uninstall and data wipe are documented, complete, and verifiable.

## Definition of done (v1)

A stranger with no context can: open the PWA and get value in under a minute; install the
tray app despite the unsigned-installer warning because the docs earned their trust;
understand any design decision from the issue history; and leave completely, verifiably.

## Process

MIT licensed. Work flows brainstorm → charter → roadmap → issues → PRs; every PR
references an issue, carries tests, and merges only on green CI with maintainer review.
The prototype lives at [pace-concept](https://github.com/bogez/pace-concept) as an
archived reference; its lessons are recorded in its
[HANDOFF.md](https://github.com/bogez/pace-concept/blob/main/HANDOFF.md).
