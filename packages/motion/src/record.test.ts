import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { recordFrames } from "../record.mjs";

// The recorder's whole reason to exist: same page + same frame index ⇒ same pixels.
// Two independent browser sessions record the same harness frames; every PNG must hash
// identically — the web-animation equivalent of the 3D renderer's golden-frame suite.

const HARNESS = fileURLToPath(new URL("../harness/index.html", import.meta.url));
const FILM = fileURLToPath(new URL("../films/web-request/index.html", import.meta.url));
const CHROMIUM_ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
const hasChromium = existsSync(CHROMIUM_ROOT);

async function hashes(page: string, from: number, to: number): Promise<string[]> {
  const out: string[] = [];
  await recordFrames(page, { width: 640, height: 360, from, to }, {
    onFrame: (png) => {
      out.push(createHash("sha256").update(png).digest("hex"));
    },
  });
  return out;
}

describe.skipIf(!hasChromium)("deterministic recorder", () => {
  it("two independent recordings are byte-identical, frame for frame", async () => {
    const a = await hashes(HARNESS, 0, 24);
    const b = await hashes(HARNESS, 0, 24);
    expect(a.length).toBe(25);
    expect(b).toEqual(a);
    // and the animation actually animates — frames are not all the same image
    expect(new Set(a).size).toBeGreaterThan(10);
  }, 120_000);

  it("a real film page with custom @font-face fonts is also byte-identical", async () => {
    // text-heavy frames (title mid-reveal + karaoke caption) — the worst case for a
    // font-load race; the recorder must wait for document.fonts.ready.
    const a = await hashes(FILM, 28, 32);
    const b = await hashes(FILM, 28, 32);
    expect(b).toEqual(a);
  }, 120_000);

  it("respects frame ranges and reports meta", async () => {
    let meta: { fps: number; frames: number; from: number; to: number } | undefined;
    let n = 0;
    await recordFrames(HARNESS, { width: 320, height: 180, from: 10, to: 14 }, {
      onStart: (m) => {
        meta = m;
      },
      onFrame: () => {
        n++;
      },
    });
    expect(n).toBe(5);
    expect(meta).toMatchObject({ fps: 30, frames: 90, from: 10, to: 14 });
  }, 60_000);
});
