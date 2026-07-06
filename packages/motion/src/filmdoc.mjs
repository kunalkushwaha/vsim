// FilmDoc — a 2D explainer film as a validated DOCUMENT, mirroring vsim's core thesis:
// the AI (or a human) authors data, zod rejects anything malformed, and a generic template
// interprets it deterministically. The model can suggest a bad film; it cannot emit an
// invalid one, and it never touches the render loop.
import { z } from "zod";

const vec4 = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** Stage entities — one per kit primitive the template knows how to build. */
export const EntitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("title"), id: z.string(), text: z.string(), x: z.number(), y: z.number(), size: z.number().default(48), color: z.string().default("ink") }),
  z.object({ kind: z.literal("server"), id: z.string(), x: z.number(), y: z.number(), label: z.string().default("server") }),
  z.object({ kind: z.literal("database"), id: z.string(), x: z.number(), y: z.number(), label: z.string().default("db") }),
  z.object({ kind: z.literal("queue"), id: z.string(), x: z.number(), y: z.number(), slots: z.number().int().min(2).max(12).default(6), label: z.string().default("queue") }),
  z.object({ kind: z.literal("browser"), id: z.string(), x: z.number(), y: z.number(), w: z.number().default(360), h: z.number().default(240), url: z.string().default("example.com") }),
  z.object({ kind: z.literal("cloud"), id: z.string(), x: z.number(), y: z.number(), w: z.number().default(300), h: z.number().default(200), label: z.string().default("cloud") }),
  z.object({
    kind: z.literal("connector"), id: z.string(),
    from: z.tuple([z.number(), z.number()]), to: z.tuple([z.number(), z.number()]),
    via: z.tuple([z.number(), z.number()]).optional(),
    dashed: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("packets"), id: z.string(),
    /** id of the connector the packets ride. */
    along: z.string(),
    /** true = travel to→from (a response path) without authoring a second connector. */
    reverse: z.boolean().default(false),
    count: z.number().int().min(1).max(8).default(3),
    color: z.enum(["accent", "accent2", "ok", "warn", "hot"]).default("accent"),
  }),
  z.object({ kind: z.literal("code"), id: z.string(), x: z.number(), y: z.number(), w: z.number().default(280), lines: z.array(z.string()).min(1).max(8) }),
  z.object({ kind: z.literal("callout"), id: z.string(), x: z.number(), y: z.number(), text: z.string(), anchor: z.tuple([z.number(), z.number()]) }),
  z.object({ kind: z.literal("chart"), id: z.string(), x: z.number(), y: z.number(), w: z.number().default(180), h: z.number().default(100), values: z.array(z.number().min(0).max(1)).min(2).max(8) }),
]);

/** What an action may do, per entity kind (validated in refine below). */
export const ACTION_KINDS = /** @type {const} */ ({
  title: ["reveal", "fadeIn", "fadeOut"],
  server: ["state", "pulse", "shake", "fadeIn", "fadeOut"],
  database: ["flash", "fadeIn", "fadeOut"],
  queue: ["fill", "fadeIn", "fadeOut"],
  browser: ["typeUrl", "fadeIn", "fadeOut"],
  cloud: ["fadeIn", "fadeOut"],
  connector: ["fadeIn", "fadeOut"],
  packets: ["flow"],
  code: ["type", "highlight", "fadeIn", "fadeOut"],
  callout: ["pop", "unpop"],
  chart: ["grow", "fadeIn", "fadeOut"],
});

export const ActionSchema = z.object({
  /** Entity id this action drives. */
  target: z.string(),
  do: z.enum(["reveal", "fadeIn", "fadeOut", "state", "pulse", "shake", "flash", "fill", "typeUrl", "flow", "type", "highlight", "pop", "unpop", "grow"]),
  /** Start/end in seconds RELATIVE to the beat's start. */
  at: z.number().min(0),
  dur: z.number().positive().default(1),
  /** do:"state" → "ok"|"busy"|"err"|"idle" · do:"fill" → 0..1 target · do:"highlight" → line index · do:"flow"/"pulse" → repeat cycles. */
  value: z.union([z.string(), z.number()]).optional(),
});

export const BeatSchema = z.object({
  id: z.string(),
  start: z.number().min(0),
  end: z.number().positive(),
  caption: z.string(),
  actions: z.array(ActionSchema).default([]),
});

export const FilmDocSchema = z
  .object({
    version: z.literal("film-1").default("film-1"),
    fps: z.number().int().min(12).max(60).default(30),
    title: z.string(),
    /** Stage coordinate space is 1280×600; entities are laid out in it directly. */
    stage: z.array(EntitySchema).min(1),
    beats: z.array(BeatSchema).min(1),
    /** Camera segments over the stage viewBox; between segments the camera holds. */
    camera: z
      .array(z.object({ at: z.number().min(0), dur: z.number().positive().default(2), view: vec4 }))
      .default([]),
  })
  .superRefine((doc, ctx) => {
    const ids = new Map(doc.stage.map((e) => [e.id, e.kind]));
    if (ids.size !== doc.stage.length) ctx.addIssue({ code: "custom", message: "stage entity ids must be unique" });
    for (const e of doc.stage) {
      if (!/^[a-zA-Z][\w-]*$/.test(e.id)) ctx.addIssue({ code: "custom", message: `entity id "${e.id}" must match [a-zA-Z][\w-]*` });
    }
    for (const e of doc.stage) {
      if (e.kind === "packets" && ids.get(e.along) !== "connector") {
        ctx.addIssue({ code: "custom", message: `packets "${e.id}": along="${e.along}" must reference a connector` });
      }
    }
    let prevEnd = 0;
    for (const b of doc.beats) {
      if (b.start !== prevEnd) ctx.addIssue({ code: "custom", message: `beat "${b.id}" must start at ${prevEnd}s (beats are contiguous)` });
      if (b.end <= b.start) ctx.addIssue({ code: "custom", message: `beat "${b.id}" must end after it starts` });
      prevEnd = b.end;
      for (const a of b.actions) {
        const kind = ids.get(a.target);
        if (!kind) {
          ctx.addIssue({ code: "custom", message: `beat "${b.id}": action targets unknown entity "${a.target}"` });
          continue;
        }
        const allowed = /** @type {readonly string[]} */ (ACTION_KINDS[kind]);
        if (!allowed.includes(a.do)) {
          ctx.addIssue({ code: "custom", message: `beat "${b.id}": "${a.do}" is not valid for ${kind} "${a.target}" (allowed: ${allowed.join(", ")})` });
        }
        if (b.start + a.at + a.dur > b.end + 3) {
          ctx.addIssue({ code: "custom", message: `beat "${b.id}": action ${a.do}@${a.target} overruns the beat by >3s` });
        }
      }
    }
  });

/** Validate a candidate FilmDoc; returns { doc } or { errors } with agent-readable messages. @param {unknown} input */
export function parseFilmDoc(input) {
  const res = FilmDocSchema.safeParse(input);
  if (res.success) return { doc: res.data };
  return { errors: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}
