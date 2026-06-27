import type { Geometry } from "./document.js";

/** A decoded RGBA image used as a base-color (albedo) texture. */
export interface Texture {
  width: number;
  height: number;
  /** RGBA8, length width*height*4, row 0 = top. */
  data: Uint8Array;
}

/** CPU triangle mesh: flat arrays, indexed. Normals are per-vertex. */
export interface MeshData {
  positions: number[]; // x,y,z * n
  normals: number[];
  indices: number[];
  /** Skinning attributes (optional): 4 joint indices and 4 weights per vertex. */
  joints?: number[];
  weights?: number[];
  /** Texture coordinates (u,v) per vertex — present when the mesh has a texture. */
  uvs?: number[];
  /** Base-color texture (albedo), sampled at `uvs` and multiplied with lighting. */
  texture?: Texture;
  /** Morph targets (blend shapes): per-target position deltas (x,y,z * n) added to `positions`,
   *  scaled by each target's weight. Drives facial expressions / lip-sync. */
  morphTargets?: { name?: string; deltas: number[] }[];
}

/** Tessellate a primitive into triangles. (glTF meshes are loaded separately.) */
export function tessellate(geo: Geometry): MeshData {
  switch (geo.kind) {
    case "box": return box(geo.size);
    case "sphere": return sphere(geo.radius, geo.segments);
    case "plane": return planeXZ(geo.size);
    case "cylinder": return cylinder(geo.radius, geo.height, geo.segments);
    case "cone": return cone(geo.radius, geo.height, geo.segments);
    case "gltf": return { positions: [], normals: [], indices: [] }; // filled by loader
    case "mesh": return geo.data; // inline mesh data carried in the document
  }
}

/** Cylinder: axis along Y, centered at origin (y ∈ [-h/2, h/2]). Side + both caps. */
function cylinder(r: number, h: number, seg: number): MeshData {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const hy = h / 2;
  // side: a ring of seg+1 vertices at top and bottom, radial normals
  for (let j = 0; j <= seg; j++) {
    const th = (2 * Math.PI * j) / seg, cx = Math.cos(th), cz = Math.sin(th);
    positions.push(r * cx, hy, r * cz); normals.push(cx, 0, cz);
    positions.push(r * cx, -hy, r * cz); normals.push(cx, 0, cz);
  }
  for (let j = 0; j < seg; j++) {
    const a = j * 2;
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  // caps: a center vertex + a fan, per cap
  const cap = (y: number, ny: number) => {
    const center = positions.length / 3;
    positions.push(0, y, 0); normals.push(0, ny, 0);
    for (let j = 0; j <= seg; j++) {
      const th = (2 * Math.PI * j) / seg;
      positions.push(r * Math.cos(th), y, r * Math.sin(th)); normals.push(0, ny, 0);
    }
    for (let j = 0; j < seg; j++) {
      const a = center + 1 + j;
      if (ny > 0) indices.push(center, a + 1, a);
      else indices.push(center, a, a + 1);
    }
  };
  cap(hy, 1); cap(-hy, -1);
  return { positions, normals, indices };
}

/** Cone: apex at top (y=h/2), base circle at bottom (y=-h/2), centered at origin. Side + base cap. */
function cone(r: number, h: number, seg: number): MeshData {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const hy = h / 2;
  const slant = Math.hypot(r, h);
  // side: base ring + apex; the side normal tilts up by r/slant (axial) and out by h/slant (radial)
  for (let j = 0; j <= seg; j++) {
    const th = (2 * Math.PI * j) / seg, cx = Math.cos(th), cz = Math.sin(th);
    positions.push(r * cx, -hy, r * cz); normals.push((h * cx) / slant, r / slant, (h * cz) / slant);
    positions.push(0, hy, 0); normals.push((h * cx) / slant, r / slant, (h * cz) / slant); // apex (per-sector normal)
  }
  for (let j = 0; j < seg; j++) {
    const a = j * 2;
    indices.push(a, a + 2, a + 1); // base[j], base[j+1], apex
  }
  // base cap (faces down)
  const center = positions.length / 3;
  positions.push(0, -hy, 0); normals.push(0, -1, 0);
  for (let j = 0; j <= seg; j++) {
    const th = (2 * Math.PI * j) / seg;
    positions.push(r * Math.cos(th), -hy, r * Math.sin(th)); normals.push(0, -1, 0);
  }
  for (let j = 0; j < seg; j++) {
    const a = center + 1 + j;
    indices.push(center, a, a + 1);
  }
  return { positions, normals, indices };
}

function box([sx, sy, sz]: [number, number, number]): MeshData {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // face: 4 corners (a,b,c,d ccw) + outward normal
  const face = (corners: number[][], n: number[]) => {
    const base = positions.length / 3;
    for (const c of corners) {
      positions.push(c[0]!, c[1]!, c[2]!);
      normals.push(n[0]!, n[1]!, n[2]!);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face([[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], [0, 0, 1]); // +Z
  face([[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], [0, 0, -1]); // -Z
  face([[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], [1, 0, 0]); // +X
  face([[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], [-1, 0, 0]); // -X
  face([[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], [0, 1, 0]); // +Y
  face([[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], [0, -1, 0]); // -Y
  return { positions, normals, indices };
}

function sphere(r: number, seg: number): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const rings = seg, sectors = seg * 2;
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings; // 0..PI
    for (let j = 0; j <= sectors; j++) {
      const theta = (2 * Math.PI * j) / sectors;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      positions.push(x * r, y * r, z * r);
      normals.push(x, y, z);
    }
  }
  const stride = sectors + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sectors; j++) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, normals, indices };
}

/**
 * Plane on the XZ ground plane, normal +Y, centered at origin. Subdivided into a grid so
 * per-vertex (Gouraud) lighting has enough vertices to look smooth across a large surface.
 * (The software renderer near-plane-clips, so subdivision is no longer needed to avoid huge
 * quads vanishing — it's purely a shading-quality choice now.)
 */
function planeXZ([w, d]: [number, number], seg = 32): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const hw = w / 2, hd = d / 2;
  for (let i = 0; i <= seg; i++) {
    for (let j = 0; j <= seg; j++) {
      positions.push(-hw + (i / seg) * w, 0, -hd + (j / seg) * d);
      normals.push(0, 1, 0);
    }
  }
  const stride = seg + 1;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  return { positions, normals, indices };
}
