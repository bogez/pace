//! Cross-implementation parity: this Rust port must reproduce the JS parser's
//! output exactly against the committed fixtures (docs/design/tray-sensor.md).
//! `expected.json` is generated from the JS reference by
//! `scripts/gen-expected.mjs`; test/sensor.test.js pins the JS side to the
//! same file. If this test fails, the port drifted — fix Rust, not the JSON.

use pace_sensor::{iso_to_epoch_ms, parse_transcripts, Weights};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

const WEIGHTS_V1: Weights = Weights {
    input: 1.0,
    output: 5.0,
    cache_write: 1.25,
    cache_read: 0.1,
};

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../test/fixtures/claude-code")
}

/// Structural equality where numbers compare by f64 value: the JS-written file
/// holds `3500`, serde re-serializes the same quantity as `3500.0`.
fn same(a: &Value, b: &Value, path: &str) {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            assert_eq!(x.as_f64(), y.as_f64(), "number mismatch at {path}");
        }
        (Value::Object(x), Value::Object(y)) => {
            let mut xk: Vec<_> = x.keys().collect();
            let mut yk: Vec<_> = y.keys().collect();
            xk.sort();
            yk.sort();
            assert_eq!(xk, yk, "key mismatch at {path}");
            for k in xk {
                same(&x[k], &y[k], &format!("{path}.{k}"));
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            assert_eq!(x.len(), y.len(), "length mismatch at {path}");
            for (i, (xa, ya)) in x.iter().zip(y).enumerate() {
                same(xa, ya, &format!("{path}[{i}]"));
            }
        }
        _ => assert_eq!(a, b, "mismatch at {path}"),
    }
}

#[test]
fn rust_port_matches_js_reference_exactly() {
    let dir = fixture_dir();
    let expected: Value =
        serde_json::from_str(&fs::read_to_string(dir.join("expected.json")).unwrap()).unwrap();

    let texts: Vec<String> = expected["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| fs::read_to_string(dir.join(f.as_str().unwrap())).unwrap())
        .collect();

    // the same windows sensor.test.js and gen-expected.mjs use
    let week_start = iso_to_epoch_ms(expected["weekStart"].as_str().unwrap()).unwrap();
    let session_start = iso_to_epoch_ms(expected["sessionStart"].as_str().unwrap()).unwrap();

    let result = parse_transcripts(texts, week_start, Some(session_start), &WEIGHTS_V1);
    same(
        &serde_json::to_value(&result).unwrap(),
        &expected["result"],
        "result",
    );
}

#[test]
fn empty_input_yields_clean_zeros() {
    let r = parse_transcripts(Vec::<String>::new(), 0.0, None, &WEIGHTS_V1);
    assert_eq!(r.events, 0);
    assert_eq!(r.week.count, 0);
    assert_eq!(r.week.weighted, 0.0);
    assert!(r.by_model.is_empty());
    assert!(r.hourly.is_empty());
}

#[test]
fn weights_are_injectable_like_js() {
    // mirrors sensor.test.js "weights are injectable": flat weights over the
    // fixtures give the plain component sum
    let dir = fixture_dir();
    let texts = ["week-main.jsonl", "week-other.jsonl"]
        .iter()
        .map(|f| fs::read_to_string(dir.join(f)).unwrap())
        .collect::<Vec<_>>();
    let flat = Weights { input: 1.0, output: 1.0, cache_write: 1.0, cache_read: 1.0 };
    let week_start = iso_to_epoch_ms("2026-07-16T05:00:00.000Z").unwrap();
    let r = parse_transcripts(texts, week_start, None, &flat);
    assert_eq!(r.week.weighted, 3100.0 + 1300.0 + 400.0 + 10000.0);
}
