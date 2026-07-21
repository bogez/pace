# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately via
**[GitHub's private vulnerability reporting](https://github.com/bogez/pace/security/advisories/new)**
(Security tab → "Report a vulnerability"). Do not open a public issue for anything that
could put users at risk before a fix exists.

You can expect an acknowledgment within a few days. This is a small volunteer project —
fixes ship as fast as one maintainer can responsibly make them, and reporters are credited
in the release notes unless they prefer otherwise.

## Scope

Pace's attack surface is deliberately tiny — no server, no accounts, no network calls
(see [TRUST.md](TRUST.md)) — but these are in scope:

- Anything that violates a TRUST.md commitment (e.g. code paths that could exfiltrate
  local data, or sensors reading files beyond what's documented)
- The integrity of the release pipeline (CI workflows, build inputs, published artifacts)
- The PWA's handling of locally stored data
- The tray app's Rust surface and its Tauri configuration

## Supported versions

Pre-1.0: only the latest release receives fixes.
