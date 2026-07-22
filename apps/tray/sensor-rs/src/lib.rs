//! Claude Code transcript parser — Rust port of `sensors/parse-transcripts.mjs`
//! (decision: docs/design/tray-sensor.md, bogez/pace#15).
//!
//! The JS parser is the reference implementation; this is a port, never a fork
//! of behavior. Both are pinned to `test/fixtures/claude-code/expected.json`
//! (tests/parity.rs here, test/sensor.test.js there) so they cannot drift.
//! Format knowledge changes in JS first, gets a fixture, then propagates here.
//!
//! Behavior ported line-for-line, including order of operations:
//! - only `type:"assistant"` lines with `message.usage` count
//! - dedupe by `message.id`, falling back to `requestId:timestamp` (then
//!   file-index:timestamp), *before* the window check — a duplicate seen once
//!   outside the window stays seen
//! - events before `weekStart` (or with unparseable timestamps) are skipped
//! - weighted sum uses the same term order as JS so f64 results are identical
//! - hourly buckets key on the first 13 chars of the raw timestamp string
//! - malformed lines, non-assistant records, usage-less messages: skipped
//!   silently — transcripts are someone else's format, not ours to police
//!
//! Known divergence (documented, deliberate): JS `new Date()` accepts
//! ISO 8601 date-times *without* a UTC offset and interprets them as local
//! time. This port requires an explicit offset (`Z` or `±HH:MM`) and skips
//! events without one. Claude Code transcripts always write `Z` timestamps.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

/* ---------------- types ---------------- */

/// Token weights, deserialized straight from the JS `WEIGHTS` object.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Weights {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
}

/// Mirror of the JS `zeroAgg()` shape.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agg {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
    pub weighted: f64,
    pub count: u64,
}

impl Agg {
    fn add(&mut self, input: f64, output: f64, cache_write: f64, cache_read: f64, weighted: f64) {
        self.input += input;
        self.output += output;
        self.cache_write += cache_write;
        self.cache_read += cache_read;
        self.weighted += weighted;
        self.count += 1;
    }
}

/// Mirror of the JS `parseTranscripts()` return value.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    pub week: Agg,
    pub session: Agg,
    pub by_model: BTreeMap<String, Agg>,
    pub hourly: BTreeMap<String, f64>,
    pub events: u64,
}

/* ---------------- timestamp parsing ---------------- */

/// Days between 1970-01-01 and y-m-d in the proleptic Gregorian calendar
/// (Howard Hinnant's `days_from_civil`).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn digits(s: &str, n: usize) -> Option<i64> {
    if s.len() < n || !s.as_bytes()[..n].iter().all(u8::is_ascii_digit) {
        return None;
    }
    s[..n].parse().ok()
}

/// ISO 8601 date-time with explicit offset → epoch milliseconds.
/// Returns None for anything it can't fully account for (the JS parser's
/// `Invalid Date` → the event is skipped).
pub fn iso_to_epoch_ms(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let year = digits(s, 4)?;
    if b.get(4) != Some(&b'-') {
        return None;
    }
    let month = digits(&s[5..], 2)?;
    if b.get(7) != Some(&b'-') {
        return None;
    }
    let day = digits(&s[8..], 2)?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if b.get(10) != Some(&b'T') {
        return None;
    }
    let hour = digits(&s[11..], 2)?;
    if b.get(13) != Some(&b':') {
        return None;
    }
    let min = digits(&s[14..], 2)?;
    if b.get(16) != Some(&b':') {
        return None;
    }
    let sec = digits(&s[17..], 2)?;
    if hour > 23 || min > 59 || sec > 59 {
        return None;
    }
    let mut i = 19;
    let mut ms = 0i64;
    if b.get(i) == Some(&b'.') {
        let frac_start = i + 1;
        let mut frac_end = frac_start;
        while frac_end < b.len() && b[frac_end].is_ascii_digit() {
            frac_end += 1;
        }
        if frac_end == frac_start {
            return None;
        }
        // first three fractional digits are milliseconds; the rest truncate
        let frac = &s[frac_start..frac_end.min(frac_start + 3)];
        ms = frac.parse::<i64>().ok()? * 10i64.pow(3 - frac.len() as u32);
        i = frac_end;
    }
    let offset_min: i64 = match b.get(i) {
        Some(&b'Z') if i + 1 == b.len() => 0,
        Some(&sign @ (b'+' | b'-')) => {
            let oh = digits(&s[i + 1..], 2)?;
            if b.get(i + 3) != Some(&b':') {
                return None;
            }
            let om = digits(&s[i + 4..], 2)?;
            if i + 6 != b.len() || oh > 23 || om > 59 {
                return None;
            }
            let v = oh * 60 + om;
            if sign == b'-' {
                -v
            } else {
                v
            }
        }
        _ => return None,
    };
    let days = days_from_civil(year, month, day);
    Some(
        (days * 86_400_000 + hour * 3_600_000 + min * 60_000 + sec * 1000 + ms
            - offset_min * 60_000) as f64,
    )
}

/* ---------------- parsing ---------------- */

/// JS truthiness for the id/requestId/model fields: a non-empty string (or a
/// non-zero number, stringified the way a JS template literal would).
fn truthy_str(v: Option<&serde_json::Value>) -> Option<String> {
    match v {
        Some(serde_json::Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(serde_json::Value::Number(n)) if n.as_f64() != Some(0.0) => Some(n.to_string()),
        _ => None,
    }
}

/// The raw timestamp as JS `String(o.timestamp)` would render it — used for
/// dedupe keys and hourly bucket names, independent of parseability.
fn raw_ts(v: Option<&serde_json::Value>) -> String {
    match v {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        Some(serde_json::Value::Null) => "null".into(),
        _ => "undefined".into(),
    }
}

fn num(v: Option<&serde_json::Value>) -> f64 {
    v.and_then(serde_json::Value::as_f64).unwrap_or(0.0)
}

/// Aggregate usage events from transcript file contents.
/// Port of `parseTranscripts(texts, { weekStart, sessionStart, weights })`;
/// window starts are epoch milliseconds.
pub fn parse_transcripts(
    texts: impl IntoIterator<Item = String>,
    week_start_ms: f64,
    session_start_ms: Option<f64>,
    weights: &Weights,
) -> ParseResult {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = ParseResult::default();

    let mut file_index = 0u64;
    for text in texts {
        file_index += 1;
        for line in text.split('\n') {
            if line.is_empty() {
                continue;
            }
            let Ok(o) = serde_json::from_str::<serde_json::Value>(line) else {
                continue;
            };
            if o.get("type").and_then(|t| t.as_str()) != Some("assistant") {
                continue;
            }
            let Some(m) = o.get("message") else { continue };
            let Some(u) = m.get("usage").filter(|u| !u.is_null()) else {
                continue;
            };

            let ts = raw_ts(o.get("timestamp"));
            let key = truthy_str(m.get("id")).unwrap_or_else(|| {
                let rid = truthy_str(o.get("requestId")).unwrap_or_else(|| file_index.to_string());
                format!("{rid}:{ts}")
            });
            if !seen.insert(key) {
                continue;
            }

            // epoch ms: ISO string or a JS-style numeric timestamp
            let t = match o.get("timestamp") {
                Some(serde_json::Value::String(s)) => iso_to_epoch_ms(s),
                Some(serde_json::Value::Number(n)) => n.as_f64(),
                _ => None,
            };
            let Some(t) = t else { continue };
            if !(t >= week_start_ms) {
                continue;
            }

            let input = num(u.get("input_tokens"));
            let output = num(u.get("output_tokens"));
            let cache_write = num(u.get("cache_creation_input_tokens"));
            let cache_read = num(u.get("cache_read_input_tokens"));
            // same term order as the JS parser — f64 addition is not
            // associative, and parity means bit-identical sums
            let weighted = input * weights.input
                + output * weights.output
                + cache_write * weights.cache_write
                + cache_read * weights.cache_read;

            out.week.add(input, output, cache_write, cache_read, weighted);
            if session_start_ms.is_some_and(|s| t >= s) {
                out.session.add(input, output, cache_write, cache_read, weighted);
            }

            let model = truthy_str(m.get("model")).unwrap_or_else(|| "unknown".into());
            out.by_model
                .entry(model)
                .or_default()
                .add(input, output, cache_write, cache_read, weighted);

            let hour: String = ts.chars().take(13).collect();
            *out.hourly.entry(hour).or_insert(0.0) += weighted;
            out.events += 1;
        }
    }
    out
}

/* ---------------- filesystem wrapper (the tray's I/O edge) ---------------- */

/// Read-only enumeration of `<root>/projects/**/*.jsonl`, skipping files last
/// modified before the window — the port of the CLI wrapper's file loop.
/// Nothing here writes, and nothing leaves the machine (TRUST.md).
pub fn read_transcript_texts(root: &std::path::Path, week_start_ms: f64) -> (Vec<String>, u64) {
    let mut texts = Vec::new();
    let mut stack = vec![root.join("projects")];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "jsonl") {
                let fresh = e
                    .metadata()
                    .and_then(|md| md.modified())
                    .ok()
                    .and_then(|mt| mt.duration_since(std::time::UNIX_EPOCH).ok())
                    .is_some_and(|d| d.as_millis() as f64 >= week_start_ms);
                if !fresh {
                    continue;
                }
                if let Ok(text) = std::fs::read_to_string(&p) {
                    texts.push(text);
                }
            }
        }
    }
    let files = texts.len() as u64;
    (texts, files)
}

/* ---------------- unit tests (timestamp math) ---------------- */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_ms_matches_js_date() {
        // values cross-checked against JS `Date.parse`
        assert_eq!(iso_to_epoch_ms("1970-01-01T00:00:00.000Z"), Some(0.0));
        assert_eq!(iso_to_epoch_ms("2026-07-16T05:00:00.000Z"), Some(1784178000000.0));
        assert_eq!(iso_to_epoch_ms("2026-07-18T10:00:01.000Z"), Some(1784368801000.0));
        assert_eq!(iso_to_epoch_ms("2026-07-18T10:00:00Z"), Some(1784368800000.0));
        assert_eq!(iso_to_epoch_ms("2026-07-18T12:00:00.5+02:00"), Some(1784368800500.0));
        assert_eq!(iso_to_epoch_ms("2026-07-18T08:30:00-01:30"), Some(1784368800000.0));
        assert_eq!(iso_to_epoch_ms("2024-02-29T00:00:00Z"), Some(1709164800000.0));
    }

    #[test]
    fn bad_timestamps_are_invalid() {
        for s in [
            "",
            "not a date",
            "2026-07-18",
            "2026-07-18T10:00:00",     // no offset: divergence documented above
            "2026-13-01T00:00:00Z",    // month out of range
            "2026-07-18T24:00:00Z",    // hour out of range
            "2026-07-18T10:00:00.Z",   // empty fraction
            "2026-07-18T10:00:00+0200", // malformed offset
        ] {
            assert_eq!(iso_to_epoch_ms(s), None, "{s:?} should be invalid");
        }
    }
}
