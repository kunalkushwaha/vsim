import { describe, it, expect } from "vitest";
import { listModels } from "@vsim/assets";
import { SceneRuntime } from "@vsim/core";
import { parseFilm3D } from "./schema.js";
import { film3dToScene } from "./load.js";
import { ASSETKIT_MODELS, ASSETKIT_BUILDINGS, ASSETKIT_FLOWERS } from "./assetkit.js";
import { footprintHalf, flowerPatch, MAX_PATCH_MODELS, MAX_FILM_FLOWER_MODELS, STAGE_HALF } from "./assetkit-props.js";

/** A small Indian street: a haveli landmark at the back, marigolds along the path. */
const DOC = {
  title: "Diwali Lane", set: "dusk",
  props: [
    { kind: "building", id: "haveli", x: 0, z: -7, variant: "haveli" },
    { kind: "flowers", id: "bed", x: 2, z: -0.5, radius: 0.6, variant: "marigold" },
  ],
  actors: [{ id: "kid", character: "suited", x: -3, z: 1 }],
  beats: [{ id: "b1", start: 0, end: 3 }],
} as const;

type Node = { id: string; parent?: string; position?: number[]; scale?: number[]; mesh?: { geometry: { data?: { uvs?: number[]; texture?: unknown } } } };

describe("assetkit models in Film3D (docs/plan-film3d-assetkit.md)", () => {
  it("keeps the generated name table in sync with the assetkit manifest", async () => {
    const metas = (await listModels()).filter((m) => m.pack === "assetkit");
    const fresh = Object.fromEntries(metas.map((m) => [m.name, { kind: m.kind, size_m: m.size_m!.map((x) => Math.round(x * 1000) / 1000) }]));
    expect(ASSETKIT_MODELS, "stale packages/film3d/src/assetkit.ts — run `pnpm gen:assetkit`").toEqual(fresh);
    expect([...ASSETKIT_BUILDINGS].sort()).toEqual(metas.filter((m) => m.kind === "building").map((m) => m.name).sort());
    expect([...ASSETKIT_FLOWERS].sort()).toEqual(metas.filter((m) => m.kind === "flower").map((m) => m.name).sort());
  });

  it("accepts assetkit building + flower variants and fills scale defaults", () => {
    const r = parseFilm3D(DOC);
    expect(r.errors).toBeUndefined();
    const [h, f] = r.doc!.props as { scale?: number }[];
    expect(h!.scale).toBe(1);
    expect(f!.scale).toBe(1);
    const bad = parseFilm3D({ ...DOC, props: [{ kind: "flowers", id: "f", x: 0, z: 0, variant: "tulip" }] });
    expect(bad.errors!.join("\n")).toMatch(/variant/);
  });

  it("leaves procedural flowers and medieval buildings unchanged", async () => {
    const sceneDoc = await film3dToScene({ ...DOC, props: [
      { kind: "flowers", id: "f", x: 0, z: 0, radius: 0.8 },
      { kind: "building", id: "inn", x: -4, z: -6, variant: "tavern" },
    ] });
    const nodes = sceneDoc.nodes as Node[];
    expect(nodes.some((n) => n.id === "f__b0")).toBe(true);          // procedural blossom
    expect(nodes.some((n) => n.id === "f__f0")).toBe(false);
    expect(nodes.find((n) => n.id === "inn")!.scale![0]).toBeCloseTo(2.2); // KayKit MODEL_SCALE × 1
  });

  it("rejects a real-size building whose footprint leaves the ±14 stage, with a fix", () => {
    const bad = parseFilm3D({ ...DOC, props: [{ kind: "building", id: "haveli", x: 10, z: -7, variant: "haveli" }] });
    const msg = bad.errors!.join("\n");
    expect(msg).toMatch(/haveli.*off the ±14 stage/);
    expect(msg).toMatch(/move it to x=7\.1/); // 14 - 13.75/2
    // The suggested spot really fits; rotation and scale are part of the footprint.
    expect(parseFilm3D({ ...DOC, props: [{ kind: "building", id: "haveli", x: 7.1, z: -7, variant: "haveli" }] }).errors).toBeUndefined();
    expect(parseFilm3D({ ...DOC, props: [{ kind: "building", id: "haveli", x: 10, z: -7, variant: "haveli", scale: 0.5 }] }).errors).toBeUndefined();
    const [hx, hz] = footprintHalf("haveli", 90, 1);
    expect(hx).toBeCloseTo(11.521 / 2);
    expect(hz).toBeCloseTo(13.75 / 2);
    // Every printed suggestion must itself validate, at any angle/scale/edge (no outward rounding).
    for (const [x, z, angle, scale] of [[10, -7, 0, 1], [-13, 9, 33, 0.8], [13.9, -13.9, 71, 1.3], [-6.2, 12, 145, 1]] as const) {
      const m = parseFilm3D({ ...DOC, props: [{ kind: "building", id: "h", x, z, variant: "haveli", angle, scale }] }).errors?.join("\n").match(/move it to x=(-?[\d.]+), z=(-?[\d.]+)/);
      expect(m, `suggestion for ${x},${z},${angle},${scale}`).toBeTruthy();
      expect(parseFilm3D({ ...DOC, props: [{ kind: "building", id: "h", x: Number(m![1]), z: Number(m![2]), variant: "haveli", angle, scale }] }).errors).toBeUndefined();
    }
    // Medieval buildings keep their old rules (no footprint check at the stage edge).
    expect(parseFilm3D({ ...DOC, props: [{ kind: "building", id: "inn", x: 14, z: -7, variant: "tavern" }] }).errors).toBeUndefined();
  });

  it("lays out flower patches deterministically, inside the radius, capped per patch", () => {
    const a = flowerPatch("marigold", 1.2, 1);
    expect(a).toEqual(flowerPatch("marigold", 1.2, 1));
    expect(a.length).toBe(MAX_PATCH_MODELS);
    const foot = Math.max(ASSETKIT_MODELS.marigold!.size_m[0], ASSETKIT_MODELS.marigold!.size_m[2]);
    for (const f of a) expect(Math.hypot(f.x, f.z) + (foot * f.s) / 2).toBeLessThanOrEqual(1.2 + 1e-9); // jittered size included
    for (const f of flowerPatch("marigold", 0.9, 2.5)) expect(Math.hypot(f.x, f.z) + (foot * f.s) / 2).toBeLessThanOrEqual(0.9 + 1e-9);
    // A lotus is ~1 m across: a small patch holds just one, at the centre.
    expect(flowerPatch("lotus", 0.5, 1)).toEqual([expect.objectContaining({ x: 0, z: 0 })]);
  });

  it("caps the film's flower models to stay inside the triangle budget", () => {
    const patches = Array.from({ length: 5 }, (_, i) => ({ kind: "flowers", id: `p${i}`, x: -8 + i * 4, z: 2, radius: 1.5, variant: "marigold" }));
    const bad = parseFilm3D({ ...DOC, props: patches });
    expect(5 * MAX_PATCH_MODELS).toBeGreaterThan(MAX_FILM_FLOWER_MODELS);
    expect(bad.errors!.join("\n")).toMatch(/45 flower models — keep it ≤36/);
    expect(parseFilm3D({ ...DOC, props: patches.slice(0, 4) }).errors).toBeUndefined();
  });

  it("compiles a haveli at real size (scale 1) and a marigold patch of baked models", async () => {
    const sceneDoc = await film3dToScene(DOC);
    const nodes = sceneDoc.nodes as Node[];
    const haveli = nodes.find((n) => n.id === "haveli")!;
    expect(haveli.scale).toEqual([1, 1, 1]);
    expect(haveli.position).toEqual([0, 0, -7]);
    expect(haveli.mesh!.geometry.data!.uvs!.length).toBeGreaterThan(0);
    expect(haveli.mesh!.geometry.data!.texture).toBeDefined();
    const flowers = nodes.filter((n) => n.parent === "bed");
    expect(flowers.length).toBe(flowerPatch("marigold", 0.6, 1).length);
    expect(flowers.every((n) => n.mesh?.geometry.data?.texture)).toBe(true);
    new SceneRuntime(sceneDoc).computeFrameState(30);
    // `scale` multiplies the model's own size.
    const small = await film3dToScene({ ...DOC, props: [{ kind: "building", id: "haveli", x: 0, z: -7, variant: "haveli", scale: 0.5 }] });
    expect((small.nodes as Node[]).find((n) => n.id === "haveli")!.scale).toEqual([0.5, 0.5, 0.5]);
  });

  it("is deterministic — identical scene JSON twice", async () => {
    // Mesh payloads are the shared, cached GLB data — compare everything else.
    const skel = async () => JSON.stringify(await film3dToScene(DOC), (k, v) => (k === "data" ? undefined : v));
    expect(await skel()).toBe(await skel());
  });

  it("stage constant matches the schema's coordinate guard", () => {
    expect(STAGE_HALF).toBe(14);
    expect(parseFilm3D({ ...DOC, props: [{ kind: "flowers", id: "f", x: 15, z: 0, variant: "lotus" }] }).errors).toBeDefined();
  });
});
