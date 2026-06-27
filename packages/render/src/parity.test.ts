import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { SceneRuntime, type PhysicsAdapter, type SceneDocument } from "@vsim/core";
import { SoftwareEngine } from "@vsim/engine-software";
import { RapierPhysics } from "@vsim/physics-rapier";
import { Player } from "@vsim/player";
import { scene } from "@vsim/authoring";

/**
 * T-023 — preview == render parity.
 *
 * The player and the offline renderer share one SceneRuntime; only the output surface differs
 * (a canvas vs. an encoder). Pixel parity therefore holds *for a shared engine*: scrubbing the
 * player to frame N must produce exactly what the renderer writes for frame N, no matter the
 * access pattern (forward play, jump-scrub, or a backwards seek that replays physics from 0).
 *
 * We drive the player headlessly with the SoftwareEngine — the same backend the renderer uses —
 * so we can frame-hash both paths and assert byte-equality. (In production the player defaults to
 * the GPU ThreeEngine for fidelity; the determinism this test pins down lives in the runtime, which
 * is identical regardless of engine.)
 */

const hash = (px: Uint8ClampedArray) => createHash("sha256").update(Buffer.from(px)).digest("hex");

function animScene(): SceneDocument {
  return scene({ fps: 30, duration: 30, width: 96, height: 64, background: [0.04, 0.05, 0.08] })
    .material("c", { color: [0.9, 0.4, 0.4] })
    .light({ type: "ambient", intensity: 0.5 })
    .light({ type: "directional", intensity: 1.0, direction: [-0.5, -1, -0.4] })
    .mesh("cube", { geometry: { kind: "box", size: [1.4, 1.4, 1.4] }, material: "c" })
    .camera({ position: [3, 2, 4.5], lookAt: [0, 0, 0], fov: 45 })
    .animate("cube", "rotation.y", [{ frame: 0, value: 0 }, { frame: 29, value: Math.PI }])
    .build();
}

function physicsScene(): SceneDocument {
  const b = scene({ fps: 30, duration: 24, width: 80, height: 48, substeps: 4 })
    .material("g", { color: [0.16, 0.17, 0.22] })
    .material("b", { color: [0.4, 0.72, 0.95] })
    .light({ type: "ambient", intensity: 0.4 })
    .light({ type: "directional", intensity: 1.1, direction: [-0.4, -1, -0.5] })
    .mesh("ground", { geometry: { kind: "plane", size: [30, 30] }, material: "g" })
    .camera({ position: [6, 4.5, 8], lookAt: [0, 1.5, 0], fov: 45 })
    .gravity([0, -9.81, 0])
    .body("ground", { type: "fixed", collider: { shape: "plane" } });
  for (let i = 0; i < 4; i++) {
    b.mesh(`box${i}`, {
      geometry: { kind: "box", size: [1, 1, 1] },
      material: "b",
      position: [i * 0.22, 0.55 + i * 1.02, 0],
    }).body(`box${i}`, { type: "dynamic", collider: { shape: "box", halfExtents: [0.5, 0.5, 0.5] }, friction: 0.6 });
  }
  return b.build();
}

/** Offline render path: drive the runtime sequentially through the SoftwareEngine, hashing requested frames. */
async function renderHashes(
  doc: SceneDocument,
  frames: number[],
  makePhysics?: () => PhysicsAdapter,
): Promise<Record<number, string>> {
  const eng = new SoftwareEngine(doc.meta.width, doc.meta.height);
  eng.init(doc);
  const phys = makePhysics?.();
  const rt = new SceneRuntime(doc, { physics: phys });
  await rt.init();
  const out: Record<number, string> = {};
  const max = Math.max(...frames);
  for (let f = 0; f <= max; f++) {
    eng.renderFrame(rt.computeFrameState(f));
    if (frames.includes(f)) out[f] = hash(eng.readPixels());
  }
  phys?.dispose();
  return out;
}

describe("preview == render parity (T-023)", () => {
  it("player scrubbing matches the offline render frame-for-frame (animation)", async () => {
    const doc = animScene();
    const frames = [0, 7, 15, 22, 29];
    const golden = await renderHashes(doc, frames);

    const player = new Player(doc, { engine: new SoftwareEngine(doc.meta.width, doc.meta.height) });
    await player.init();
    // Scrambled order with backwards seeks exercises the reset-and-replay path.
    for (const f of [15, 0, 29, 7, 22, 0, 29]) {
      await player.seek(f);
      expect(player.currentFrame).toBe(f);
      expect(hash(player.engine.readPixels())).toBe(golden[f]);
    }
    player.dispose();
  });

  it("player scrubbing matches the offline render with deterministic physics", async () => {
    const doc = physicsScene();
    const frames = [0, 8, 16, 23];
    const golden = await renderHashes(doc, frames, () => new RapierPhysics());

    const player = new Player(doc, {
      engine: new SoftwareEngine(doc.meta.width, doc.meta.height),
      physics: new RapierPhysics(),
    });
    await player.init();
    // Backwards seeks force physics to rebuild from the document and replay deterministically.
    for (const f of [23, 8, 0, 16, 23, 0]) {
      await player.seek(f);
      expect(player.currentFrame).toBe(f);
      expect(hash(player.engine.readPixels())).toBe(golden[f]);
    }
    player.dispose();
  });
});
