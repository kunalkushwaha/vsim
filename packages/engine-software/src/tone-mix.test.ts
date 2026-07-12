import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

// tone.mix crossfades linear↔ACES output. The 0/1 fast paths must be byte-identical to
// the static meta.tone renders; the midpoint must land strictly between them.
const mk = (tone: "none" | "aces", mix?: number) => parseDocument({
  meta: { durationFrames: 2, width: 32, height: 32, background: [0, 0, 0], tone },
  materials: [{ id: "hot", color: [0, 0, 0], emissive: [3, 2, 1] }],
  nodes: [
    { id: "sq", mesh: { geometry: { kind: "plane", size: [1.5, 1.5] }, materialId: "hot" }, rotation: [Math.PI / 2, 0, 0] },
    { id: "cam", position: [0, 0, 3] },
  ],
  camera: { nodeId: "cam", lookAt: [0, 0, 0], fov: 45 },
  ...(mix !== undefined
    ? { animation: [{ target: { environment: true, path: "tone.mix" }, keyframes: [{ frame: 0, value: mix }, { frame: 1, value: mix }] }] }
    : {}),
});

const render = (tone: "none" | "aces", mix?: number) => {
  const eng = new SoftwareEngine(32, 32, { supersample: 1, shadows: false });
  eng.init(mk(tone, mix));
  eng.renderFrame(new SceneRuntime(mk(tone, mix)).computeFrameState(0));
  return eng.readPixels();
};

describe("tone.mix", () => {
  it("0 and 1 reproduce the static tonemaps byte-for-byte; 0.5 lies between", () => {
    const linear = render("none");
    const aces = render("aces");
    expect(Buffer.from(linear).equals(Buffer.from(aces))).toBe(false); // sanity: they differ
    expect(Buffer.from(render("none", 0)).equals(Buffer.from(linear))).toBe(true);
    expect(Buffer.from(render("none", 1)).equals(Buffer.from(aces))).toBe(true); // mix overrides meta
    const half = render("none", 0.5);
    // Blue channel (emissive 1.0): linear clips to 255, ACES compresses to ~230 — the
    // blend must sit strictly between. (Red at emissive 3 clips under BOTH tonemaps.)
    const px = (b: Uint8ClampedArray) => b[(16 * 32 + 16) * 4 + 2]!;
    const lo = Math.min(px(linear), px(aces)), hi = Math.max(px(linear), px(aces));
    expect(px(half)).toBeGreaterThan(lo);
    expect(px(half)).toBeLessThan(hi);
  });
});
