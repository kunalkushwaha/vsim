// The ONE place that decides "is this raw JSON a 3D screenplay?" — the CLI's scene loader
// and the Cycles baker both route through here, so the sniff/compile contract can't drift
// between the draft and photoreal paths.
import type { SceneDocument } from "@vsim/core";
import { parseFilm3D } from "./schema.js";
import { compileFilm3D } from "./compile.js";

/**
 * Film3DDoc sniff: the version tag when present; otherwise the screenplay shape (beats +
 * set, and no SceneDocument `meta`) — `version` is optional-with-default, so a valid film
 * may omit it entirely.
 */
export function isFilm3D(raw: unknown): boolean {
  const r = raw as { version?: unknown; beats?: unknown; set?: unknown; meta?: unknown } | null;
  if (typeof r?.version === "string") return r.version.startsWith("film3d");
  return !!r && r.meta === undefined && Array.isArray(r.beats) && typeof r.set === "string";
}

/** Validate + compile raw film3d JSON to a render-ready SceneDocument (agent-readable errors). */
export async function film3dToScene(raw: unknown): Promise<SceneDocument> {
  const res = parseFilm3D(raw);
  if (res.errors) throw new Error(`invalid Film3DDoc:\n  ${res.errors.join("\n  ")}`);
  return compileFilm3D(res.doc);
}
