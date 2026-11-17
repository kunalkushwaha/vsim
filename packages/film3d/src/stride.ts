// Natural ground speed of a gait clip, measured from the rig itself: skin the mesh's lowest
// vertices every frame and average how fast the planted ones slide backward relative to the
// character (feet in stance move at -v). Rig-agnostic — works for bipeds, quadrupeds and birds.
// Used by tests to keep CHARACTERS[*].walk/run.stride honest (compile.ts plays gait clips at
// travel speed / stride so feet don't skate).
import { loadCharacter } from "@vsim/assets";
import { scene } from "@vsim/authoring";
import { SceneRuntime } from "@vsim/core";

export async function measureStride(character: string, clip: string, scale: number, faces: readonly [number, number]): Promise<number> {
  const { rig } = await loadCharacter(character, 30);
  const c = rig.clips.find((k) => k.id === clip);
  if (!c) throw new Error(`${character} has no clip ${clip}`);
  const doc = scene({ fps: 30, duration: Math.round(c.durationFrames) + 2, width: 16, height: 16 })
    .character("c", rig, { clip, loop: true, scale: [scale, scale, scale] })
    .camera({ position: [0, 1, 5], lookAt: [0, 1, 0] })
    .build();
  const rt = new SceneRuntime(doc);
  // Contact candidates: the lowest 4% of ALL the rig's meshes at rest (bodies can be split into
  // shirt / trousers / shoes), grouped into feet by their dominant joint.
  const meshes = rig.meshes ?? [rig.mesh];
  const all = meshes.flatMap((m, mi) => Array.from({ length: m.positions.length / 3 }, (_, i) => ({ m, mi, i, y: m.positions[i * 3 + 1]! })));
  const cut = [...all].sort((a, b) => a.y - b.y)[Math.floor(all.length * 0.04)]!.y;
  const feet = new Map<number, typeof all>();
  for (const v of all.filter((v) => v.y <= cut)) {
    const W = v.m.weights!, J = v.m.joints!;
    let k = 0; for (let q = 1; q < 4; q++) if (W[v.i * 4 + q]! > W[v.i * 4 + k]!) k = q;
    const j = J[v.i * 4 + k]!;
    if (!feet.has(j)) feet.set(j, []);
    feet.get(j)!.push(v);
  }
  const skin = (M: number[][], v: (typeof all)[number]) => {
    const P = v.m.positions, J = v.m.joints!, W = v.m.weights!, out = [0, 0, 0];
    const p = [P[v.i * 3]!, P[v.i * 3 + 1]!, P[v.i * 3 + 2]!];
    for (let k = 0; k < 4; k++) {
      const w = W[v.i * 4 + k]!; if (!w) continue;
      const m = M[J[v.i * 4 + k]!]!;
      for (let r = 0; r < 3; r++) out[r] = out[r]! + w * (m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!);
    }
    return out;
  };
  const N = Math.round(c.durationFrames);
  // The runtime clock only advances: pose every frame once, in order.
  const mats = Array.from({ length: N + 1 }, (_, f) =>
    (rt.computeFrameState(f).nodes as { id: string; skin?: { jointMatrices: number[][] } }[]).find((x) => x.id === "c__mesh")!.skin!.jointMatrices);
  // Per contact VERTEX (not "the lowest point", which rolls heel→toe and hides the slide): while
  // a vertex is in strict contact — within 5 mm (or 5% of its lift) of its own lowest height —
  // its backward velocity is the travel speed. The median of those samples ignores the fast,
  // low swing just before heel strike that would drag a mean down.
  const samples: number[] = [];
  for (const vs of feet.values()) {
    for (const v of vs) {
      const t = mats.map((M) => skin(M, v));
      const ys = t.map((p) => p[1]!), lo = Math.min(...ys), range = Math.max(...ys) - lo;
      const tol = Math.max(0.005, 0.05 * range);
      for (let f = 1; f <= N; f++) {
        if (Math.max(t[f]![1]!, t[f - 1]![1]!) - lo > tol) continue;
        samples.push(-((t[f]![0]! - t[f - 1]![0]!) * faces[0] + (t[f]![2]! - t[f - 1]![2]!) * faces[1]) * 30);
      }
    }
  }
  samples.sort((a, b) => a - b);
  return samples.length ? samples[Math.floor(samples.length / 2)]! : 0;
}
