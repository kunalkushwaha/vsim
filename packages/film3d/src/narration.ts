// Narration: per-beat spoken lines → the narrate.mjs spec (packages/motion/tools), the same
// timed-lines → TTS → WAV pipeline the 2D films use. This module only *plans* the narration
// (pure function of the document); the CLI runs the TTS and muxes the WAV, so @vsim/film3d
// stays free of child-process and filesystem concerns.
import type { Film3DDoc } from "./schema.js";

export interface NarrationSpec {
  fps: number;
  engine: "espeak";
  espeak: { voice: string; pitch: number; speed: number };
  lines: { at: number; text: string }[];
}

/** A slow, lower-pitched storyteller reads better over films than the 2D explainers' voice. */
const NARRATOR = { voice: "en+m3", pitch: 55, speed: 145 };

/** Small lead-in so the voice lands just after each cut, not on top of it. */
const LEAD_IN = 0.35;

/**
 * Build the narrate.mjs script for a film's spoken lines, or null when nothing is narrated.
 * Lines start `LEAD_IN` after their beat; the TTS engine determines real durations, and the
 * muxer's `-shortest` clips any tail past the film's end.
 */
export function narrationScript(doc: Film3DDoc): NarrationSpec | null {
  const lines = doc.beats
    .filter((b) => b.narration)
    .map((b) => ({ at: b.start + LEAD_IN, text: b.narration! }));
  if (lines.length === 0) return null;
  return { fps: doc.fps, engine: "espeak", espeak: NARRATOR, lines };
}
