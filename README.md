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

**Nothing here is usable yet.** This repository is the deliberate rebuild of a validated
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
