import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — untyped .mjs build helper (the same module the film scripts run)
import { narrationFor } from "./build-film.mjs";

const dirs: string[] = [];
/** A throwaway film dir seeded with the given files. */
function filmDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "vsim-film-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(body));
  return dir;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("narrationFor", () => {
  it("returns null when a film has no narration source (records silent)", () => {
    expect(narrationFor(filmDir({ "screenplay.json": { beats: [{ caption: "hi", start: 0 }] } }))).toBeNull();
  });

  it("prefers an explicit narration.json over any derivation", () => {
    const dir = filmDir({ "narration.json": { lines: [] }, "screenplay.json": { voice: true, beats: [{ caption: "x", start: 0 }] } });
    expect(narrationFor(dir)).toEqual({ file: "narration.json" });
  });

  it("derives lines from screenplay captions when voice is enabled, offset by leadIn", () => {
    const dir = filmDir({ "screenplay.json": {
      fps: 30, voice: { engine: "espeak", leadIn: 0.2 },
      beats: [{ caption: "First.", start: 0 }, { id: "gap" }, { caption: "  Second.  ", start: 8 }],
    } });
    const n = narrationFor(dir)!;
    expect(n.file).toBe("screenplay.json");
    expect(n.spec.engine).toBe("espeak");
    // captionless beats are skipped; text is trimmed; `at` = start + leadIn
    expect(n.spec.lines).toEqual([{ at: 0.2, text: "First." }, { at: 8.2, text: "Second." }]);
  });

  it("also derives from a filmdoc.json (the AI-generated explainer shape)", () => {
    const dir = filmDir({ "filmdoc.json": { voice: true, beats: [{ caption: "Generated.", start: 1 }] } });
    const n = narrationFor(dir)!;
    expect(n.file).toBe("filmdoc.json");
    expect(n.spec.lines).toEqual([{ at: 1.15, text: "Generated." }]); // default leadIn 0.15
  });

  it("stays silent if voice is on but no beat has a caption", () => {
    expect(narrationFor(filmDir({ "screenplay.json": { voice: true, beats: [{ id: "a" }, { id: "b" }] } }))).toBeNull();
  });
});
