/**
 * Claude Code transcript parser — the pure core of the sensor (bogez/pace#11).
 *
 * A pure function of (file contents, window config): no filesystem, no clock,
 * no network, no storage. The CLI wrapper (claude-code.mjs) does enumeration
 * and I/O; this module does all the thinking, so fixtures can pin every
 * behavior — and so the tray app's Rust port (#15) has an exact,
 * CI-enforceable contract to match.
 *
 * Format knowledge, learned in the prototype and pinned by fixtures here:
 * - only `type:"assistant"` lines carry `message.usage`
 * - streaming rewrites duplicate lines for the same API message — dedupe by
 *   `message.id` (fall back to requestId+timestamp)
 * - token kinds: input_tokens, output_tokens, cache_creation_input_tokens,
 *   cache_read_input_tokens
 * - malformed lines, blank lines, and non-assistant records are skipped
 *   silently: transcripts are someone else's format, not ours to police
 */
import { WEIGHTS } from "./weights.mjs";

export const zeroAgg = () => ({
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  weighted: 0,
  count: 0,
});

/**
 * Aggregate usage events from transcript file contents.
 *
 * @param {Iterable<string>} texts - contents of .jsonl transcript files
 * @param {object} opts
 * @param {Date} opts.weekStart - start of the current weekly window; events
 *   before it are ignored
 * @param {Date} [opts.sessionStart] - start of the rolling session window;
 *   omit to skip session aggregation
 * @param {object} [opts.weights] - token weights (defaults to WEIGHTS)
 * @returns {{ week: object, session: object, byModel: Record<string, object>,
 *   hourly: Record<string, number>, events: number }}
 */
export function parseTranscripts(texts, { weekStart, sessionStart, weights = WEIGHTS }) {
  const seen = new Set();
  const week = zeroAgg();
  const session = zeroAgg();
  const byModel = {};
  const hourly = {};
  let events = 0;

  let fileIndex = 0;
  for (const text of texts) {
    fileIndex++;
    for (const line of text.split("\n")) {
      if (!line) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const m = o.message;
      const u = m?.usage;
      if (!u || o.type !== "assistant") continue;

      const key = m.id || `${o.requestId || fileIndex}:${o.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const t = new Date(o.timestamp);
      if (!(t >= weekStart)) continue;

      const rec = {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cacheWrite: u.cache_creation_input_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
      };
      rec.weighted =
        rec.input * weights.input +
        rec.output * weights.output +
        rec.cacheWrite * weights.cacheWrite +
        rec.cacheRead * weights.cacheRead;

      const add = (agg) => {
        for (const k of ["input", "output", "cacheWrite", "cacheRead", "weighted"]) agg[k] += rec[k];
        agg.count++;
      };
      add(week);
      if (sessionStart && t >= sessionStart) add(session);

      const model = m.model || "unknown";
      byModel[model] ??= zeroAgg();
      add(byModel[model]);

      const hour = String(o.timestamp).slice(0, 13);
      hourly[hour] = (hourly[hour] || 0) + rec.weighted;
      events++;
    }
  }

  return { week, session, byModel, hourly, events };
}
