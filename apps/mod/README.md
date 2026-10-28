# Pace kitchen — a Claude Code mod

Your usage pace, drawn as an 8-bit chef. The mood is `paceState()` in costume:
the same zones and the same words as every other Pace surface.

| Pace state | In the kitchen |
| :- | :- |
| ▼▼ cold | stove off, ice on the pot, chef dozing |
| ▼ cool | low blue flame, a wisp of steam |
| ● in the zone | golden dish, steady stir, a sparkle |
| ▲ warm | bubbling, chef starting to sweat |
| ▲▲ running hot | boiling over, grey steam |
| ▲▲ overheating | fire, black smoke, chef panicking |

It also tees each reading to `~/.pace/usage.json` (or `$PACE_USAGE_FILE`) in
the statusline bridge's format, so the tray picks up readings from Desktop
sessions too. That's its only write; no network, no model calls (enforced by
`test/trust.test.js`).

## Use

Requires Claude Code v2.1.287 or later. It works in the terminal and in the
Desktop app's Code tab.

```bash
claude --plugin-dir apps/mod                         # try it for one session
claude plugin marketplace add bogez/pace             # or install it
claude plugin install pace-kitchen@pace
```

- `/pace` toggles the kitchen pane
- `/pace <cold|cool|zone|warm|hot|burning>` previews a mood, `/pace live` goes back
- while Claude works, the spinner reads e.g. `Sauteing · pace ● in the zone…`

## Develop

- `lib/kitchen.js`: the pure half (mood mapping, sprites, Raster/Svg encoding). It's tested by `npm test` (`test/mod-kitchen.test.js`).
- `hooks/register.js`: the wiring. It's tested by `npm run test:mod` (`claude plugin test`).
- `lib/pace.js` is a copy of `src/pace.js`, because an installed plugin can't reach outside its directory. After you change the engine, run `cp src/pace.js apps/mod/lib/pace.js`; a test fails if the two drift apart.
