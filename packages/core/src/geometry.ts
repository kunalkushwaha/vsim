import type { Geometry } from "./document.js";

/** CPU triangle mesh: flat arrays, indexed. Normals are per-vertex. */
export interface MeshData {
  positions: number[]; // x,y,z * n
  normals: number[];
  indices: number[];
}

/** Tessellate a primitive into triangles. (glTF meshes are loaded separately.) */
export function tessellate(geo: Geometry): MeshData {
  switch (geo.kind) {
    case "box": return box(geo.size);
    case "sphere": return sphere(geo.radius, geo.segments);
    case "plane": return planeXZ(geo.size);
    case "gltf": return { positions: [], normals: [], indices: [] }; // filled by loader
  }
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

/** Plane on the XZ ground plane, normal +Y, centered at origin. */
function planeXZ([w, d]: [number, number]): MeshData {
  const hw = w / 2, hd = d / 2;
  return {
    positions: [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    indices: [0, 2, 1, 0, 3, 2],
  };
}
