// Image backdrop: use ANY illustration (JPG/PNG) as a city's base artifact. The image is
// decoded to RGBA and mapped onto an upright quad — a "postcard card" standing in the
// diorama, lit and shadowed like everything else. Drop `landmarks/<city>.jpg` (or .png)
// next to the SVGs and the scene picks it up automatically; images are user-supplied and
// gitignored (mind the artwork's license), the committed SVGs remain the fallback.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeImage } from "@vsim/assets";

export interface BackdropMesh {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  texture: { width: number; height: number; data: Uint8Array };
  /** Card width in world units (height is the scale you asked for). */
  width: number;
}

/** Find `landmarks/<name>.jpg|.jpeg|.png`; undefined when the city has no image drop-in. */
export function findBackdropImage(name: string): string | undefined {
  for (const ext of ["jpg", "jpeg", "png"]) {
    const p = fileURLToPath(new URL(`./landmarks/${name}.${ext}`, import.meta.url));
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** Build an upright textured quad, `height` world units tall, feet at y=0, facing +z. */
export function loadImageBackdrop(path: string, height: number): BackdropMesh {
  const bytes = new Uint8Array(readFileSync(path));
  const mime = path.endsWith(".png") ? "image/png" : "image/jpeg";
  const texture = decodeImage(bytes, mime);
  const w = (texture.width / texture.height) * height;
  const hw = w / 2;
  return {
    // Two triangles; uv (0,0) is the image's top-left, so the top edge gets v=0.
    positions: [-hw, height, 0, hw, height, 0, hw, 0, 0, -hw, 0, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    indices: [0, 1, 2, 0, 2, 3],
    texture,
    width: w,
  };
}
