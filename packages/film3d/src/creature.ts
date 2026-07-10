// CreatureDoc — the screenplay trick applied to ASSETS: a species as a validated document.
// The AI authors bones/parts/gaits within hard bounds, make-animal.py compiles it to a
// rigged GLB, a turntable review loop lets the model see (and revise) its own creature, and
// registration adds it to the library + cast. It can propose an ugly creature; it cannot
// emit a broken one — and the committed doc regenerates the same GLB forever (MIT).
import { z } from "zod";

const c = z.number().min(-1.2).max(1.7); // bone/part coordinate bounds (Z-up build space)
const vec3 = z.tuple([c, c, c]);
const dim = z.number().min(0.012).max(0.6); // part half-extents: survive subsurf, stay animal-scale

export const CreatureDocSchema = z
  .object({
    version: z.literal("creature-1").default("creature-1"),
    /** Library id — lowercase, becomes `<id>.glb` and the castable character name. */
    id: z.string().regex(/^[a-z][a-z0-9-]{1,19}$/),
    name: z.string().max(40),
    /** One line of art direction — kept in the manifest description. */
    description: z.string().max(160),
    /** Torso chain + tail; four two-bone legs are generated from `legs`. */
    bones: z
      .array(z.object({ name: z.string().regex(/^[a-z][a-z_]{1,15}$/), head: vec3, tail: vec3, parent: z.string().optional() }))
      .min(5)
      .max(9),
    legs: z.object({
      front_y: c, back_y: c,
      sx: z.number().min(0.02).max(0.35),
      top: z.number().min(0.1).max(1.2),
      knee: z.number().min(0.07).max(1.0),
      r_u: z.number().min(0.015).max(0.14),
      r_l: z.number().min(0.012).max(0.12),
    }),
    legsBackR: z.number().min(0.015).max(0.16).optional(),
    parts: z
      .array(z.object({ bone: z.string(), kind: z.enum(["cube", "sphere", "cyl"]), loc: vec3, scale: z.tuple([dim, dim, dim]) }))
      .min(4)
      .max(24),
    /** (upper-leg swing, lower-leg curl) in radians per gait. */
    gaits: z.object({
      walk: z.tuple([z.number().min(0.1).max(0.9), z.number().min(-0.9).max(0)]),
      run: z.tuple([z.number().min(0.2).max(1.1), z.number().min(-1.1).max(0)]),
    }),
    /** Cast registration metadata (same meaning as CHARACTERS fields). */
    scale: z.number().min(0.3).max(1.6).default(1),
    runAt: z.number().min(0.8).max(4),
    /** Camera aim height ≈ the head, in world units after scaling. */
    eye: z.number().min(0.15).max(1.6),
    tint: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
  })
  .superRefine((doc, ctx) => {
    const names = new Set(doc.bones.map((b) => b.name));
    for (const req of ["hips", "spine", "neck", "head", "tail"]) {
      if (!names.has(req)) ctx.addIssue({ code: "custom", message: `bones must include "${req}"` });
    }
    if (names.size !== doc.bones.length) ctx.addIssue({ code: "custom", message: "bone names must be unique" });
    for (const b of doc.bones) {
      if (b.parent && !names.has(b.parent)) ctx.addIssue({ code: "custom", message: `bone "${b.name}": unknown parent "${b.parent}"` });
      if (b.name !== "hips" && !b.parent) ctx.addIssue({ code: "custom", message: `bone "${b.name}" needs a parent (only "hips" is the root)` });
    }
    for (const p of doc.parts) {
      if (!names.has(p.bone)) ctx.addIssue({ code: "custom", message: `part on unknown bone "${p.bone}" (legs get their meshes automatically)` });
    }
    if (doc.legs.knee >= doc.legs.top) ctx.addIssue({ code: "custom", message: "legs.knee must be below legs.top" });
    if (doc.legs.top - doc.legs.knee < 0.05 || doc.legs.knee < 0.06) ctx.addIssue({ code: "custom", message: "leg segments too short to animate (top-knee ≥ 0.05, knee ≥ 0.06)" });
  });

export type CreatureDoc = z.infer<typeof CreatureDocSchema>;

/** Validate a candidate CreatureDoc; agent-readable errors, like parseFilm3D. */
export function parseCreature(input: unknown): { doc: CreatureDoc; errors?: undefined } | { doc?: undefined; errors: string[] } {
  const res = CreatureDocSchema.safeParse(input);
  if (res.success) return { doc: res.data };
  return { errors: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}

/** The geometry table make-animal.py consumes (its external-JSON format). */
export function creatureGeometry(doc: CreatureDoc): Record<string, unknown> {
  return {
    bones: doc.bones.map((b) => (b.parent ? [b.name, b.head, b.tail, b.parent] : [b.name, b.head, b.tail])),
    legs: doc.legs,
    ...(doc.legsBackR !== undefined ? { legs_back_r: doc.legsBackR } : {}),
    parts: doc.parts.map((p) => [p.bone, p.kind, p.loc, p.scale]),
    gaits: doc.gaits,
  };
}
