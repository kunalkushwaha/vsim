import { v3, quat, type Quat, type Vec3 } from "./math.js";
import type { Clip, ClipChannel } from "./document.js";

/** A sampled local transform override for one joint at one frame. */
export interface JointPose {
  translation?: Vec3;
  rotation?: Quat;
  scale?: Vec3;
}

/**
 * Sample every channel of a clip at `localFrame` and collect the per-joint TRS overrides.
 * Pure and frame-based → deterministic. The runtime applies these onto the joint nodes before FK.
 */
export function evaluateClip(clip: Clip, localFrame: number): Map<string, JointPose> {
  const out = new Map<string, JointPose>();
  for (const ch of clip.channels) {
    const value = sampleChannel(ch, localFrame);
    let pose = out.get(ch.jointNodeId);
    if (!pose) {
      pose = {};
      out.set(ch.jointNodeId, pose);
    }
    if (ch.path === "translation") pose.translation = value as Vec3;
    else if (ch.path === "scale") pose.scale = value as Vec3;
    else pose.rotation = value as Quat;
  }
  return out;
}

const IDENTITY_BY_PATH = {
  translation: [0, 0, 0],
  scale: [1, 1, 1],
  rotation: [0, 0, 0, 1],
} as const;

/** Sample one channel at a frame. Returns a vec3 (translation/scale) or quat (rotation). */
export function sampleChannel(ch: ClipChannel, frame: number): number[] {
  const times = ch.times;
  const n = times.length;
  const stride = ch.path === "rotation" ? 4 : 3;
  if (n === 0) return [...IDENTITY_BY_PATH[ch.path]];

  // Clamp outside the keyframe range (hold the endpoints).
  if (frame <= times[0]!) return pointOf(ch, 0, stride);
  if (frame >= times[n - 1]!) return pointOf(ch, n - 1, stride);

  // Find segment [i, i+1] with times[i] <= frame < times[i+1].
  let i = 0;
  while (i < n - 1 && times[i + 1]! <= frame) i++;
  const t0 = times[i]!, t1 = times[i + 1]!;
  const dt = t1 - t0;
  const u = dt === 0 ? 0 : (frame - t0) / dt;

  if (ch.interpolation === "step") return pointOf(ch, i, stride);
  if (ch.interpolation === "cubicspline") return cubic(ch, i, stride, u, dt);

  // linear
  const a = pointOf(ch, i, stride);
  const b = pointOf(ch, i + 1, stride);
  if (ch.path === "rotation") return quat.slerp(a as Quat, b as Quat, u);
  return v3.lerp(a as Vec3, b as Vec3, u);
}

/**
 * Read keyframe `i`'s value. LINEAR/STEP store one value per key (`stride` floats); CUBICSPLINE
 * stores [inTangent, value, outTangent] (`3*stride`), so the value sits at the middle.
 */
function pointOf(ch: ClipChannel, i: number, stride: number): number[] {
  const off = ch.interpolation === "cubicspline" ? i * 3 * stride + stride : i * stride;
  return ch.values.slice(off, off + stride);
}

/**
 * glTF CUBICSPLINE: each key stores [inTangent, value, outTangent], each `stride` wide, so a key
 * spans `3*stride`. Hermite-interpolate between key i and i+1. (Rotations are interpolated
 * component-wise then renormalized, per the glTF spec.)
 */
function cubic(ch: ClipChannel, i: number, stride: number, u: number, dt: number): number[] {
  const span = 3 * stride;
  const p0 = ch.values.slice(i * span + stride, i * span + 2 * stride); // value of key i
  const m0 = ch.values.slice(i * span + 2 * stride, i * span + 3 * stride); // outTangent of key i
  const p1 = ch.values.slice((i + 1) * span + stride, (i + 1) * span + 2 * stride); // value of key i+1
  const m1 = ch.values.slice((i + 1) * span, (i + 1) * span + stride); // inTangent of key i+1

  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const out = new Array<number>(stride);
  for (let k = 0; k < stride; k++) {
    out[k] = h00 * p0[k]! + h10 * dt * m0[k]! + h01 * p1[k]! + h11 * dt * m1[k]!;
  }
  return ch.path === "rotation" ? quat.normalize(out as Quat) : out;
}
