/**
 * Minimal deterministic 3D math. Column-major 4x4 matrices (glMatrix/OpenGL layout):
 * translation lives in m[12], m[13], m[14]. All functions are pure and return new arrays.
 */

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w
export type Mat4 = number[]; // length 16, column-major

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  length: (a: Vec3): number => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
  normalize: (a: Vec3): Vec3 => {
    const l = v3.length(a);
    return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
};

/** Euler angles (radians, XYZ intrinsic order) → quaternion. */
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

export const quat = {
  normalize(q: Quat): Quat {
    const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    return l === 0 ? [0, 0, 0, 1] : [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  /** Shortest-path spherical interpolation. Deterministic; falls back to nlerp when near-parallel. */
  slerp(a: Quat, b: Quat, t: number): Quat {
    let bx = b[0], by = b[1], bz = b[2], bw = b[3];
    let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; } // shortest arc
    if (cos > 0.9995) {
      return quat.normalize([
        a[0] + (bx - a[0]) * t,
        a[1] + (by - a[1]) * t,
        a[2] + (bz - a[2]) * t,
        a[3] + (bw - a[3]) * t,
      ]);
    }
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sin;
    const wb = Math.sin(t * theta) / sin;
    return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
  },
};

export const mat4 = {
  identity: (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],

  multiply(a: Mat4, b: Mat4): Mat4 {
    const out = new Array<number>(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[0 * 4 + r]! * b[c * 4 + 0]! +
          a[1 * 4 + r]! * b[c * 4 + 1]! +
          a[2 * 4 + r]! * b[c * 4 + 2]! +
          a[3 * 4 + r]! * b[c * 4 + 3]!;
      }
    }
    return out;
  },

  /** Compose a transform from translation, rotation quaternion and scale. */
  compose(t: Vec3, q: Quat, s: Vec3): Mat4 {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const [sx, sy, sz] = s;
    return [
      (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
      (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
      (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
      t[0], t[1], t[2], 1,
    ];
  },

  /** Right-handed perspective, maps depth to [-1, 1] (OpenGL convention). */
  perspective(fovYRad: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovYRad / 2);
    const nf = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ];
  },

  /** Right-handed look-at view matrix. */
  lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
    const z = v3.normalize(v3.sub(eye, target));
    const x = v3.normalize(v3.cross(up, z));
    const y = v3.cross(z, x);
    return [
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1,
    ];
  },

  /** Transform a point (w=1). Returns clip-space [x, y, z, w]. */
  transformPoint(m: Mat4, p: Vec3): Vec4 {
    return [
      m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
      m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
      m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
      m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!,
    ];
  },

  /** Transform a direction (w=0), e.g. a normal under a rigid transform. */
  transformDir(m: Mat4, d: Vec3): Vec3 {
    return [
      m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2],
      m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2],
      m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2],
    ];
  },

  /** Extract the translation column. */
  getTranslation: (m: Mat4): Vec3 => [m[12]!, m[13]!, m[14]!],

  /** Weighted component-wise sum of matrices — linear-blend skinning. */
  blend(mats: Mat4[], weights: number[]): Mat4 {
    const out = new Array<number>(16).fill(0);
    for (let m = 0; m < mats.length; m++) {
      const w = weights[m]!;
      if (w === 0) continue;
      const mm = mats[m]!;
      for (let i = 0; i < 16; i++) out[i] = out[i]! + mm[i]! * w;
    }
    return out;
  },

  /** Full 4x4 inverse (column-major). Returns the identity if the matrix is singular. */
  invert(m: Mat4): Mat4 {
    const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
    const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
    const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
    const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (det === 0) return mat4.identity();
    const id = 1 / det;
    return [
      (a11 * b11 - a12 * b10 + a13 * b09) * id,
      (a02 * b10 - a01 * b11 - a03 * b09) * id,
      (a31 * b05 - a32 * b04 + a33 * b03) * id,
      (a22 * b04 - a21 * b05 - a23 * b03) * id,
      (a12 * b08 - a10 * b11 - a13 * b07) * id,
      (a00 * b11 - a02 * b08 + a03 * b07) * id,
      (a32 * b02 - a30 * b05 - a33 * b01) * id,
      (a20 * b05 - a22 * b02 + a23 * b01) * id,
      (a10 * b10 - a11 * b08 + a13 * b06) * id,
      (a01 * b08 - a00 * b10 - a03 * b06) * id,
      (a30 * b04 - a31 * b02 + a33 * b00) * id,
      (a21 * b02 - a20 * b04 - a23 * b00) * id,
      (a11 * b07 - a10 * b09 - a12 * b06) * id,
      (a00 * b09 - a01 * b07 + a02 * b06) * id,
      (a31 * b01 - a30 * b03 - a32 * b00) * id,
      (a20 * b03 - a21 * b01 + a22 * b00) * id,
    ];
  },
};

export const DEG2RAD = Math.PI / 180;
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
