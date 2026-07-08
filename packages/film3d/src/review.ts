// The dailies: pure helpers for the director's review loop. The CLI renders one still per
// camera shot (pickReviewStills), shows them to the model, and parseReviewReply reads the
// verdict — KEEP, or a full revised Film3DDoc. Everything here is pure and unit-testable;
// the model call itself lives in generate.ts.
import type { Film3DDoc } from "./schema.js";

export interface ReviewStill {
  /** Film time to sample, in seconds. */
  sec: number;
  /** What the frame shows, for the review prompt ("follow shot at 3.5s, target fox"). */
  label: string;
}

const MAX_STILLS = 5;

/** Evenly thin a list down to `n` entries, keeping first and last. */
function thin<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))]!);
}

/**
 * One representative frame per camera segment (its midpoint), capped at MAX_STILLS.
 * A film with no shot list gets beat midpoints instead (the auto wide shot).
 */
export function pickReviewStills(doc: Film3DDoc): ReviewStill[] {
  const stills =
    doc.camera.length > 0
      ? doc.camera.map((s) => ({
          sec: s.at + s.dur / 2,
          label: `${s.shot} shot at ${(s.at + s.dur / 2).toFixed(1)}s${typeof s.target === "string" ? `, target ${s.target}` : ""}`,
        }))
      : doc.beats.map((b) => ({
          sec: (b.start + b.end) / 2,
          label: `wide shot at ${((b.start + b.end) / 2).toFixed(1)}s (beat "${b.id}")`,
        }));
  return thin(stills, MAX_STILLS);
}

/** Extract a JSON object from model text, tolerating ```json fences or surrounding prose. */
export function extractJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error(`expected a JSON object, got: ${text.slice(0, 200)}`);
  }
}

/** Read the reviewer's verdict: KEEP (possibly with prose around it), or a candidate document. */
export function parseReviewReply(text: string): { keep: true } | { keep: false; candidate: unknown } {
  const t = text.trim();
  if (/^`{0,3}\s*KEEP\b/i.test(t) || (!t.includes("{") && /\bKEEP\b/i.test(t))) return { keep: true };
  return { keep: false, candidate: extractJson(t) };
}
