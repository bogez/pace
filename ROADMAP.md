# Pace — Roadmap to v1.0

Organizing rule: **every milestone ends with something a real user can use**, and each has
an explicit exit gate so "done" is never a feeling. Versions track milestones. The
[issue tracker](https://github.com/bogez/pace/issues) holds the live backlog; labels
`m0-foundation` … `m5-release` map issues to milestones.

## M0 — Foundation *(no product code)*

The repo itself, done right before anything ships: charter, trust policy, community
health files, issue/PR templates ([#1](https://github.com/bogez/pace/issues/1)); CI that
runs tests on every PR plus branch protection ([#2](https://github.com/bogez/pace/issues/2)).

**Exit gate:** a stranger landing on the repo understands what's coming, why, and how to
participate — before any code exists.

## M1 — Engine `v0.1.0`

The tested, boring core: the prototype's pace math ported with behavior pinned, zone
boundaries defined once as data ([#3](https://github.com/bogez/pace/issues/3)), and the
test suite extended to boundaries, monotonicity, and forecast edge cases
([#4](https://github.com/bogez/pace/issues/4)).

**Exit gate:** CI green; every documented behavior has a pinning test; a reviewer can
change a boundary in exactly one place.

## M2 — PWA tracker `v0.2.0` — *the flagship*

Zero-install, value in under a minute: manual `/usage` check-ins with live pace and
forecast ([#5](https://github.com/bogez/pace/issues/5)), installability and offline
([#6](https://github.com/bogez/pace/issues/6)), trust claims become CI checks
([#7](https://github.com/bogez/pace/issues/7)), accessibility as a merge requirement
([#8](https://github.com/bogez/pace/issues/8)), and staleness made visible from day one
([#9](https://github.com/bogez/pace/issues/9)).

**Exit gate:** the definition-of-done stranger test, parts 1 (value in a minute) and
4 (leave verifiably), pass with a real person.

## M3 — Claude Code sensor + calibration `v0.3.0`

Automation with honesty: calibration model designed in an issue before code
([#10](https://github.com/bogez/pace/issues/10)), transcript parser ported with
fixture-based tests ([#11](https://github.com/bogez/pace/issues/11)), estimated vs.
measured visually distinct ([#13](https://github.com/bogez/pace/issues/13)), OTel
alternative investigated ([#14](https://github.com/bogez/pace/issues/14)).

**Exit gate:** the sensor estimate tracks real `/usage` within the agreed tolerance over a
full billing week — measured, not vibes ([#12](https://github.com/bogez/pace/issues/12)).
M4 work may start while this soaks, but v0.3.0 does not tag until it passes.

## M4 — Tray app `v0.4.0`

The colored dot, earned: sensor-wiring decision argued first
([#15](https://github.com/bogez/pace/issues/15)), minimal Tauri shell reusing the PWA's
rendering ([#16](https://github.com/bogez/pace/issues/16)), 4-platform installer CI
([#17](https://github.com/bogez/pace/issues/17)).

**Exit gate:** installers for Windows/macOS(×2)/Linux build green from a tag push; the dot
reflects live sensor data.

## M5 — `v1.0.0` — Ship it

Release engineering and the trust story, complete: README with the three-tier "Get Pace"
ladder and verified uninstall docs ([#18](https://github.com/bogez/pace/issues/18)),
versioning policy and CHANGELOG ([#19](https://github.com/bogez/pace/issues/19)), and the
full four-part stranger test with at least one person who isn't the maintainer, then
announce ([#20](https://github.com/bogez/pace/issues/20)).

**Exit gate:** tagged `v1.0.0`, four platforms, all trust claims verifiable.

## Post-v1 (parked, deliberately)

Each parked issue records its unpark conditions:
signed distribution ([#21](https://github.com/bogez/pace/issues/21)),
multi-provider profiles ([#22](https://github.com/bogez/pace/issues/22)),
Android widget ([#23](https://github.com/bogez/pace/issues/23)),
zone-change notifications ([#24](https://github.com/bogez/pace/issues/24)),
npm-publishing the engine ([#25](https://github.com/bogez/pace/issues/25)).
