# Pace

**A fuel gauge for your AI subscription.**

AI plans give you a usage percentage — but a raw number forces you to do math. *53% used…
on day 5… of a week that resets Thursday… is that good?* Pace does the math and answers
one question at a glance: **am I in the zone?**

- 🟢 **Green — in the zone.** Your usage matches where you are in the billing window.
- 🔴 **Toward red — burning too fast.** At this rate you hit the cap before the reset.
- 🔵 **Toward blue — headroom.** You're under pace; push harder if you want.

One glance, one color, no math.

## Status: pre-alpha, built in the open

**The tracker is live: [bogez.github.io/pace →](https://bogez.github.io/pace/)**
Nothing to install — set your reset day once, type in what `/usage` shows now and then,
and Pace keeps the color, delta, and forecast live between check-ins. All data stays in
your browser.

- 📱 **Phone:** open the link → browser menu → **Add to Home Screen** — it installs like
  an app, icon and all, and works offline.
- 💻 **Desktop:** open the link → the install icon in the address bar (Chrome/Edge) → a
  standalone window for your dock or taskbar.

**Landed so far:** the engine (below) and the tracker PWA, with the trust commitments
machine-enforced in CI ([TRUST.md](TRUST.md)). Still to come in M2: the accessibility pass
([#8](https://github.com/bogez/pace/issues/8)) and visible staleness
([#9](https://github.com/bogez/pace/issues/9)).

This repository is the deliberate rebuild of a validated
prototype — [pace-concept](https://github.com/bogez/pace-concept), which went from idea to
a working web app, tray app, and 4-platform installers in a single evening, and proved the
concept but skipped the process. This time the process is the point:

- **[CHARTER.md](CHARTER.md)** — what Pace is, who it's for, what it will never do
- **[TRUST.md](TRUST.md)** — concrete trust commitments and how each is verified
- **[ROADMAP.md](ROADMAP.md)** — six milestones from foundation to v1.0.0
- **[Issue tracker](https://github.com/bogez/pace/issues)** — every piece of work, with
  acceptance criteria, before any code; design decisions are argued in issues so the
  reasoning stays public

What's coming, in order: the tested pace engine (M1) → the zero-install PWA tracker, the
flagship (M2) → automatic usage from Claude Code transcripts, with honest calibration
(M3) → the native tray dot (M4) → v1.0.0 (M5).

## The engine

The whole product reduces to a small dependency-free module
([`src/pace.js`](src/pace.js)) — pure functions, behavior pinned by tests:

```js
import { paceDelta, paceColor, paceState, forecast, ZONES } from "./src/pace.js";

// 53% used, 112 hours into a 168-hour (weekly) window
const delta = paceDelta(53, 112, 168);   // → -13.7  (negative = headroom)
paceState(delta);                        // → { name: "cool", glyph: "▼" }
paceColor(delta);                        // → an rgb() between green and teal

forecast(53, 112, 168);
// → { projectedPct: 79.5, runsOut: false, ... }
// "At your average pace you'd end the week at 79% — you can afford to push."
```

Zone boundaries and colors are exported as data (`ZONES`, `PALETTE`) and defined nowhere
else — apps consume them, never re-declare them. The defaults (green zone ±5, full red at
+25, full blue at −50 — overuse ramps fast because overuse gets you cut off) are
deliberate and debatable: open an issue to argue.

## The one non-negotiable

Pace only uses data sources that are clearly legitimate: manual input, local files you
already own, and official APIs when they exist. **It will never scrape sessions, replay
auth tokens, or poll undocumented endpoints** — see [TRUST.md](TRUST.md). All data stays
on your device; there is no server.

## Following along / contributing

Watch the repo, or read [CONTRIBUTING.md](CONTRIBUTING.md) if you'd like to help. Design
discussions happen in the issues — opinions on the open
[design-decision issues](https://github.com/bogez/pace/issues?q=is%3Aissue+is%3Aopen+label%3Adesign-decision)
are welcome even if you never write a line of code.

## License

[MIT](LICENSE)
