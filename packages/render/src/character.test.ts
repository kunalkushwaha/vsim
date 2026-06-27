import { describe, it, expect } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mat4, quatFromEuler, type MeshData } from "@vsim/core";
import { scene, type CharacterRig } from "@vsim/authoring";
import { renderStill } from "./index.js";

/** A 2-joint "bar" rig: bottom edge → j0, top edge → j1; a clip bends j1 90° about Z over 0→10. */
function barRig(): CharacterRig {
  const rotZ90 = quatFromEuler(0, 0, Math.PI / 2);
  const mesh: MeshData = {
    positions: [-0.3, 0, 0, 0.3, 0, 0, 0.3, 2, 0, -0.3, 2, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
    joints: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    weights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  };
  return {
    mesh,
    joints: ["j0", "j1"],
    jointNodes: [
      { id: "j0", translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { id: "j1", parent: "j0", translation: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ],
    inverseBindMatrices: [mat4.identity(), mat4.invert(mat4.compose([0, 1, 0], [0, 0, 0, 1], [1, 1, 1]))],
    clips: [
      {
        id: "walk",
        durationFrames: 10,
        channels: [{ jointNodeId: "j1", path: "rotation", interpolation: "linear", times: [0, 10], values: [0, 0, 0, 1, ...rotZ90] }],
      },
    ],
  };
}

function buildScene() {
  return scene({ fps: 30, duration: 11, width: 64, height: 64, background: [0, 0, 0] })
    .material("m", { color: [0.9, 0.5, 0.3] })
    .light({ type: "ambient", intensity: 0.9 })
    .character("hero", barRig(), { clip: "walk", material: "m" })
    .camera({ position: [0, 1, 6], lookAt: [0, 1, 0], fov: 50 })
    .build();
}

async function stillBytes(frame: number): Promise<Buffer> {
  const doc = buildScene(); // self-contained: the rig mesh is inlined in the document
  const out = join(tmpdir(), `vsim-char-${frame}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await renderStill(doc, frame, out, {});
  const bytes = readFileSync(out);
  rmSync(out, { force: true });
  return bytes;
}

describe("authored character (author → render → skin)", () => {
  it("deforms: the walk pose renders differently from the rest pose", async () => {
    const rest = await stillBytes(0);
    const bent = await stillBytes(10);
    expect(rest.equals(bent)).toBe(false);
  });

  it("is deterministic: the same frame renders byte-identically across two runs", async () => {
    expect((await stillBytes(10)).equals(await stillBytes(10))).toBe(true);
  });
});
