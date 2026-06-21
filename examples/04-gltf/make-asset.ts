import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeGLB } from "@vsim/assets";
import type { MeshData } from "@vsim/core";

/** Generate a torus GLB so the glTF example is self-contained (stands in for a Blender export). */
function torus(R = 1, r = 0.4, segU = 64, segV = 32): MeshData {
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * Math.PI * 2;
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * Math.PI * 2;
      positions.push((R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u));
      normals.push(Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u));
    }
  }
  const stride = segV + 1;
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * stride + j, b = (i + 1) * stride + j;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, normals, indices };
}

const out = fileURLToPath(new URL("./model.glb", import.meta.url));
writeFileSync(out, writeGLB(torus()));
console.log(`✓ wrote ${out}`);
