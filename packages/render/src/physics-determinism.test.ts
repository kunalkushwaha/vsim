import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { SceneRuntime, type SceneDocument } from "@vsim/core";
import { SoftwareEngine } from "@vsim/engine-software";
import { RapierPhysics } from "@vsim/physics-rapier";
import { scene } from "@vsim/authoring";

/** A small leaning tower that topples — enough motion to expose any nondeterminism. */
function build(): SceneDocument {
  const b = scene({ fps: 30, duration: 40, width: 80, height: 48, substeps: 4 })
    .material("g", { color: [0.16, 0.17, 0.22] })
    .material("b", { color: [0.4, 0.72, 0.95] })
    .light({ type: "ambient", intensity: 0.4 })
    .light({ type: "directional", intensity: 1.1, direction: [-0.4, -1, -0.5] })
    .mesh("ground", { geometry: { kind: "plane", size: [30, 30] }, material: "g" })
    .camera({ position: [6, 4.5, 8], lookAt: [0, 1.5, 0], fov: 45 })
    .gravity([0, -9.81, 0])
    .body("ground", { type: "fixed", collider: { shape: "plane" } });
  for (let i = 0; i < 5; i++) {
    b.mesh(`box${i}`, { geometry: { kind: "box", size: [1, 1, 1] }, material: "b", position: [i * 0.22, 0.55 + i * 1.02, 0] })
      .body(`box${i}`, { type: "dynamic", collider: { shape: "box", halfExtents: [0.5, 0.5, 0.5] }, friction: 0.6 });
  }
  return b.build();
}

const FRAMES = [10, 25, 39];

async function hashes(): Promise<Record<number, string>> {
  const doc = build();
  const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
  eng.init(doc);
  const phys = new RapierPhysics();
  const rt = new SceneRuntime(doc, { physics: phys });
  await rt.init();
  const out: Record<number, string> = {};
  const max = Math.max(...FRAMES);
  for (let f = 0; f <= max; f++) {
    eng.renderFrame(rt.computeFrameState(f));
    if (FRAMES.includes(f)) out[f] = createHash("sha256").update(Buffer.from(eng.readPixels())).digest("hex");
  }
  phys.dispose();
  return out;
}

describe("physics determinism", () => {
  it("simulates byte-identically across two independent runs", async () => {
    const a = await hashes();
    const b = await hashes();
    expect(a).toEqual(b);
  });
});
