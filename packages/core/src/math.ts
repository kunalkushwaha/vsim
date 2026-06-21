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
};

export const DEG2RAD = Math.PI / 180;
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
