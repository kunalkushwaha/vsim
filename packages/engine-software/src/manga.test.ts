import { describe, it, expect } from "vitest";
import { parseDocument, SceneRuntime } from "@vsim/core";
import { SoftwareEngine } from "./index.js";

const enc = (c: number) => Math.round(Math.pow(Math.min(Math.max(c, 0), 1), 1 / 2.2) * 255);

function build(style: "realistic" | "manga") {
  return parseDocument({
    meta: { durationFrames: 1, width: 64, height: 64, background: [0.5, 0.7, 0.95], style },
    materials: [{ id: "m", color: [0.8, 0.4, 0.3] }],
    nodes: [
      { id: "ball", mesh: { geometry: { kind: "sphere", radius: 1, segments: 24 }, materialId: "m" } },
      { id: "sun", light: { type: "directional", intensity: 1, direction: [-0.4, -0.6, -0.7] } },
      { id: "amb", light: { type: "ambient", intensity: 0.2 } },
      { id: "__camera", position: [0, 0, 4] },
    ],
    camera: { nodeId: "__camera", lookAt: [0, 0, 0] },
  });
}

function render(style: "realistic" | "manga"): Uint8ClampedArray {
  const doc = build(style);
  const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
  eng.init(doc);
  eng.renderFrame(new SceneRuntime(doc).computeFrameState(0));
  return eng.readPixels();
}

/** Distinct values of the red channel — a proxy for how many shading levels are present. */
function distinctReds(px: Uint8ClampedArray): number {
  const s = new Set<number>();
  for (let i = 0; i < px.length; i += 4) s.add(px[i]!);
  return s.size;
}

describe("manga (toon) mode", () => {
  it("renders differently from realistic", () => {
    expect(Buffer.from(render("realistic")).equals(Buffer.from(render("manga")))).toBe(false);
  });

  it("bands the shading: fewer distinct shades than the smooth Lambert render", () => {
    expect(distinctReds(render("manga"))).toBeLessThan(distinctReds(render("realistic")));
  });

  it("draws outline pixels around the silhouette", () => {
    const px = render("manga");
    const [or, og, ob] = [enc(0.04), enc(0.05), enc(0.08)];
    let found = false;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] === or && px[i + 1] === og && px[i + 2] === ob) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("is deterministic", () => {
    expect(Buffer.from(render("manga")).equals(Buffer.from(render("manga")))).toBe(true);
  });
});
