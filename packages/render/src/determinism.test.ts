import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SceneRuntime, type SceneDocument } from "@vsim/core";
import { SoftwareEngine } from "@vsim/engine-software";
import { scene } from "@vsim/authoring";

/** A compact, fully deterministic scene (animation only, no physics). */
function buildScene(): SceneDocument {
  return scene({ fps: 30, duration: 60, width: 160, height: 90, background: [0.04, 0.05, 0.08] })
    .material("c", { color: [0.9, 0.4, 0.4] })
    .material("floor", { color: [0.15, 0.16, 0.2] })
    .light({ type: "ambient", intensity: 0.4 })
    .light({ type: "directional", intensity: 1.1, direction: [-0.5, -1, -0.4] })
    .mesh("floor", { geometry: { kind: "plane", size: [20, 20] }, material: "floor", position: [0, -1, 0] })
    .mesh("cube", { geometry: { kind: "box", size: [1.4, 1.4, 1.4] }, material: "c" })
    .camera({ position: [3, 2, 4.5], lookAt: [0, 0, 0], fov: 45 })
    .animate("cube", "rotation.y", [{ frame: 0, value: 0 }, { frame: 60, value: Math.PI * 2 }])
    .build();
}

const FRAMES = [0, 15, 30, 45, 59];

async function frameHashes(doc: SceneDocument): Promise<Record<number, string>> {
  const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
  eng.init(doc);
  const rt = new SceneRuntime(doc);
  await rt.init();
  const out: Record<number, string> = {};
  const max = Math.max(...FRAMES);
  for (let f = 0; f <= max; f++) {
    eng.renderFrame(rt.computeFrameState(f));
    if (FRAMES.includes(f)) {
      out[f] = createHash("sha256").update(Buffer.from(eng.readPixels())).digest("hex");
    }
  }
  return out;
}

describe("determinism", () => {
  it("produces byte-identical frames across two independent runs", async () => {
    const a = await frameHashes(buildScene());
    const b = await frameHashes(buildScene());
    expect(a).toEqual(b);
  });

  it("matches the committed golden-frame hashes", async () => {
    const goldenPath = fileURLToPath(new URL("./__golden__.json", import.meta.url));
    const current = await frameHashes(buildScene());
    if (!existsSync(goldenPath) || process.env.UPDATE_GOLDEN) {
      writeFileSync(goldenPath, JSON.stringify(current, null, 2) + "\n");
    }
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    expect(current).toEqual(golden);
  });
});
