// Quality gates for the retargeted mocap clip library (docs/plan-human-motion.md):
// scripts/blender/mocap/clips.json → retarget-clips.py → scripts/mocap-merge.mjs → library GLBs.
// Measured on the real runtime, on every MakeHuman body (they share one skeleton, not one size).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadCharacter } from "@vsim/assets";
import { scene } from "@vsim/authoring";
import { SceneRuntime } from "@vsim/core";

const SPEC = JSON.parse(readFileSync(new URL("../../../scripts/blender/mocap/clips.json", import.meta.url), "utf8")) as {
  clips: { name: string; loop?: boolean; travel?: boolean; ground?: string }[];
};
const BODIES = ["human", "man", "kid", "suited", "speaker"];
const FEET = ["foot_l", "foot_r", "ball_l", "ball_r"];

/** Per-frame world positions of a few joints while `clip` plays once from frame 0. */
async function track(body: string, clip: string, joints: string[]) {
  const { rig } = await loadCharacter(body, 30);
  const c = rig.clips.find((c) => c.id === clip)!;
  const doc = scene({ fps: 30, duration: Math.ceil(c.durationFrames) + 1, width: 32, height: 32 })
    .character("c", rig, { clip, loop: false })
    .camera({ position: [0, 1, 5], lookAt: [0, 1, 0] })
    .build();
  const rt = new SceneRuntime(doc);
  const rest = new SceneRuntime(scene({ fps: 30, duration: 2, width: 32, height: 32 })
    .character("c", { ...rig, clips: [] }).camera({ position: [0, 1, 5], lookAt: [0, 1, 0] }).build()).computeFrameState(0).nodes;
  const at = (nodes: { id: string; worldMatrix: number[] }[], j: string) => {
    const m = nodes.find((n) => new RegExp(`^c/${j}_\\d+$`).test(n.id))!.worldMatrix; return [m[12]!, m[13]!, m[14]!];
  };
  const frames = Array.from({ length: Math.round(c.durationFrames) }, (_, f) => { // round: durations arrive as 115.99999
    const nodes = rt.computeFrameState(f).nodes as { id: string; worldMatrix: number[] }[];
    return Object.fromEntries(joints.map((j) => [j, at(nodes, j)]));
  });
  return { frames, rest: Object.fromEntries(joints.map((j) => [j, at(rest as never, j)])) };
}

describe("mocap clip library (CMU → MakeHuman rigs)", () => {
  it("every MakeHuman body carries every clip in clips.json", async () => {
    for (const body of BODIES) {
      const { rig } = await loadCharacter(body, 30);
      const ids = rig.clips.map((c) => c.id);
      for (const c of SPEC.clips) expect(ids, `${body} lacks ${c.name}`).toContain(c.name);
    }
  });

  it("ground-locked clips keep a foot on the floor every frame, on every body", { timeout: 120_000 }, async () => {
    for (const body of BODIES) {
      for (const c of SPEC.clips.filter((c) => (c.ground ?? "lock") === "lock")) {
        const { frames, rest } = await track(body, c.name, FEET);
        const worst = Math.max(...frames.map((fr) => Math.abs(Math.min(...FEET.map((j) => fr[j]![1]! - rest[j]![1]!)))));
        expect(worst, `${body}/${c.name}: lowest foot contact off the floor by ${worst.toFixed(3)} m`).toBeLessThan(0.03);
      }
    }
  });

  it("clips play in place (films move the character) — except sit/stand travel", { timeout: 60_000 }, async () => {
    for (const c of SPEC.clips.filter((c) => !c.travel)) {
      const { frames } = await track("suited", c.name, ["pelvis"]);
      const drift = Math.max(...frames.map((fr) => Math.hypot(fr.pelvis![0]! - frames[0]!.pelvis![0]!, fr.pelvis![2]! - frames[0]!.pelvis![2]!)));
      expect(drift, `${c.name}: hips wander ${drift.toFixed(2)} m`).toBeLessThan(0.35); // body sway only
    }
  });

  it("looping clips close the loop — last frame meets the first without a pop", { timeout: 60_000 }, async () => {
    const joints = ["pelvis", "hand_l", "hand_r", "foot_l", "foot_r", "head"];
    for (const c of SPEC.clips.filter((c) => c.loop)) {
      const { frames } = await track("suited", c.name, joints);
      const first = frames[0]!, last = frames[frames.length - 1]!;
      const gaps = joints.map((j) => [j, Math.hypot(...[0, 1, 2].map((k) => last[j]![k]! - first[j]![k]!))] as const);
      const gap = Math.max(...gaps.map((g) => g[1]));
      const worstJoint = gaps.find((g) => g[1] === gap)![0];
      // The seam must look like one more frame of the motion around it — a pop is a jump many
      // frames' worth bigger than the steps on either side of the seam.
      const d = (a: Record<string, number[]>, b: Record<string, number[]>) => Math.max(...joints.map((j) => Math.hypot(...[0, 1, 2].map((k) => a[j]![k]! - b[j]![k]!))));
      const n = frames.length, local = Math.max(d(frames[1]!, first), d(last, frames[n - 2]!));
      expect(gap, `${c.name}: loop seam ${gap.toFixed(3)} m at ${worstJoint} vs neighbouring steps ${local.toFixed(3)} m`).toBeLessThan(Math.max(0.03, local * 2));
    }
  });

  it("sitting really sits: the hips drop by a chair's worth and come back up", async () => {
    const down = (await track("suited", "sit_down", ["pelvis"])).frames, up = (await track("suited", "stand_up", ["pelvis"])).frames;
    const y = (fr: Record<string, number[]>) => fr.pelvis![1]!;
    expect(y(down[0]!) - y(down[down.length - 1]!)).toBeGreaterThan(0.3);
    expect(y(up[up.length - 1]!) - y(up[0]!)).toBeGreaterThan(0.3);
  });
});
