import { describe, it, expect } from "vitest";
import { listCharacters } from "@vsim/assets";
import { SceneRuntime } from "@vsim/core";
import { parseFilm3D, CHARACTERS, CHARACTER_IDS } from "./schema.js";
import { compileFilm3D } from "./compile.js";
import { narrationScript } from "./narration.js";
import { pickReviewStills, parseReviewReply } from "./review.js";

/** A minimal valid film: a fox walks across a meadow, then surveys. */
const FILM = {
  title: "A Fox at Golden Hour",
  set: "meadow",
  props: [
    { kind: "tree", id: "t1", x: -5, z: -6 },
    { kind: "rock", id: "r1", x: 2, z: -2 },
  ],
  actors: [{ id: "fox", character: "fox", x: 4, z: -1 }],
  beats: [
    {
      id: "b1", start: 0, end: 6, caption: "A fox crosses the clearing.",
      actions: [{ do: "move", actor: "fox", to: [-3, 0.5], at: 0.5, dur: 4.5 }],
    },
    {
      id: "b2", start: 6, end: 10, caption: "It pauses to look around.",
      actions: [{ do: "play", actor: "fox", clip: "Survey", at: 0.5, dur: 3 }],
    },
  ],
  camera: [
    { at: 0, dur: 6, shot: "follow", target: "fox" },
    { at: 6, dur: 4, shot: "orbit", target: "fox", sweep: 60 },
  ],
} as const;

describe("Film3DDoc schema", () => {
  it("accepts a valid film and fills defaults", () => {
    const res = parseFilm3D(FILM);
    expect(res.errors).toBeUndefined();
    expect(res.doc!.fps).toBe(30);
    expect(res.doc!.version).toBe("film3d-1");
  });

  it("rejects non-contiguous beats", () => {
    const res = parseFilm3D({ ...FILM, beats: [{ ...FILM.beats[0], start: 1, end: 6 }] });
    expect(res.errors!.join("\n")).toMatch(/must start at 0s/);
  });

  it("rejects actions targeting unknown actors", () => {
    const res = parseFilm3D({
      ...FILM,
      beats: [{ id: "b1", start: 0, end: 4, actions: [{ do: "move", actor: "ghost", to: [0, 0], at: 0, dur: 2 }] }],
    });
    expect(res.errors!.join("\n")).toMatch(/unknown actor "ghost"/);
  });

  it("rejects clips the character does not have", () => {
    const res = parseFilm3D({
      ...FILM,
      beats: [{ id: "b1", start: 0, end: 4, actions: [{ do: "play", actor: "fox", clip: "Moonwalk", at: 0 }] }],
    });
    expect(res.errors!.join("\n")).toMatch(/no clip "Moonwalk"/);
    expect(res.errors!.join("\n")).toMatch(/Walk, Run, Survey/); // agent-readable suggestion
  });

  it("rejects duplicate ids across props and actors", () => {
    const res = parseFilm3D({ ...FILM, props: [{ kind: "rock", id: "fox", x: 0, z: 0 }] });
    expect(res.errors!.join("\n")).toMatch(/not unique/);
  });

  it("rejects camera segments that do not cover the film", () => {
    const res = parseFilm3D({ ...FILM, camera: [{ at: 0, dur: 3, shot: "wide" }] });
    expect(res.errors!.join("\n")).toMatch(/cover the whole film/);
  });

  it("rejects a follow shot aimed at a fixed point", () => {
    const res = parseFilm3D({ ...FILM, camera: [{ at: 0, dur: 10, shot: "follow", target: [0, 1, 0] }] });
    expect(res.errors!.join("\n")).toMatch(/follow shot needs an actor/);
  });

  it("keeps the CHARACTERS table in sync with the bundled library manifest", async () => {
    const manifest = await listCharacters();
    for (const id of CHARACTER_IDS) {
      const meta = manifest.find((c) => c.id === id);
      expect(meta, `character "${id}" missing from library manifest`).toBeDefined();
      expect([...CHARACTERS[id].clips].sort()).toEqual([...meta!.clips].sort());
      const axis: Record<string, readonly [number, number]> = { "+x": [1, 0], "-x": [-1, 0], "+z": [0, 1], "-z": [0, -1] };
      expect(CHARACTERS[id].faces).toEqual(axis[meta!.faces]);
    }
  });
});

describe("compileFilm3D", () => {
  it("compiles to a valid SceneDocument the runtime accepts", async () => {
    const { doc } = parseFilm3D(FILM);
    const sceneDoc = await compileFilm3D(doc!);
    expect(sceneDoc.meta.durationFrames).toBe(300); // 10s @ 30fps
    expect(sceneDoc.meta.width).toBe(960);
    // The runtime can evaluate frames across the whole film (cameras, clips, tracks resolve).
    const rt = new SceneRuntime(sceneDoc);
    for (const f of [0, 90, 200, 299]) expect(rt.computeFrameState(f).camera.position.length).toBe(3);
  });

  it("moves the actor along the move action and settles at the target", async () => {
    const { doc } = parseFilm3D(FILM);
    const sceneDoc = await compileFilm3D(doc!);
    const rt = new SceneRuntime(sceneDoc);
    // The runtime clock only advances forward — sample frames in ascending order.
    const worldX = (f: number) => {
      const st = rt.computeFrameState(f);
      const m = st.nodes.find((n) => n.id === "fox")!.worldMatrix;
      return m[12];
    };
    expect(worldX(0)).toBeCloseTo(4, 3); // start
    const mid = worldX(75); // mid-move, strictly between the endpoints
    expect(mid).toBeLessThan(4);
    expect(mid).toBeGreaterThan(-3);
    expect(worldX(299)).toBeCloseTo(-3, 2); // arrived (and holds)
  });

  it("crossfades gait clips around the move (walk during, idle after)", async () => {
    const { doc } = parseFilm3D(FILM);
    const sceneDoc = await compileFilm3D(doc!);
    const mesh = sceneDoc.nodes.find((n) => n.id === "fox__mesh")!;
    const clips = (mesh as any).clips as { clipId: string; startFrame?: number }[];
    const ids = clips.map((c) => c.clipId);
    // 7.2 units in 4.5s ≈ 1.6 u/s — past a fox's run threshold, so auto-gait picks Run.
    expect(ids).toContain("fox/Run");
    expect(ids.filter((id) => id === "fox/Survey").length).toBeGreaterThanOrEqual(2); // idle base + settle + play action
  });

  it("adds caption overlays with fade windows and a title card", async () => {
    const { doc } = parseFilm3D(FILM);
    const sceneDoc = await compileFilm3D(doc!);
    const overlays = (sceneDoc as any).overlays as { id: string; text: string }[];
    expect(overlays.map((o) => o.id)).toEqual(expect.arrayContaining(["__title", "__cap_b1", "__cap_b2"]));
    const rt = new SceneRuntime(sceneDoc);
    const capAt = (f: number) => rt.computeFrameState(f).overlays.find((o) => o.id === "__cap_b1")?.opacity ?? 0;
    expect(capAt(90)).toBeCloseTo(1, 3); // visible mid-beat
    expect(capAt(250)).toBeCloseTo(0, 3); // gone in beat 2
  });

  it("is deterministic — the same document compiles to identical JSON", async () => {
    const { doc } = parseFilm3D(FILM);
    const a = JSON.stringify(await compileFilm3D(doc!));
    const b = JSON.stringify(await compileFilm3D(doc!));
    expect(a).toBe(b);
  });

  it("synthesizes a wide shot when no camera is authored", async () => {
    const { doc } = parseFilm3D({ ...FILM, camera: [] });
    const sceneDoc = await compileFilm3D(doc!);
    expect((sceneDoc as any).shots.length).toBe(1);
    expect((sceneDoc as any).shots[0].startFrame).toBe(0);
    expect((sceneDoc as any).shots[0].endFrame).toBe(300);
  });

  it("builds the campfire set piece for dusk films", async () => {
    const { doc } = parseFilm3D({
      title: "Fireside",
      set: "dusk",
      props: [{ kind: "campfire", id: "fire", x: 0, z: 0 }],
      actors: [{ id: "fox", character: "fox", x: 1.5, z: -0.9 }],
      beats: [{ id: "b1", start: 0, end: 5 }],
    });
    const sceneDoc = await compileFilm3D(doc!);
    expect(sceneDoc.meta.tone).toBe("aces");
    const fireLight = sceneDoc.nodes.find((n) => n.id === "fire__light");
    expect((fireLight as any).light.decay).toBe(2);
    expect((sceneDoc as any).particles.map((p: any) => p.id)).toEqual(
      expect.arrayContaining(["fire__sparks", "fire__smoke"]),
    );
  });
});

describe("narrationScript", () => {
  it("returns null for a film with no narration", () => {
    const { doc } = parseFilm3D(FILM);
    expect(narrationScript(doc!)).toBeNull();
  });

  it("places narrated beats' lines just after each beat start, at the film's fps", () => {
    const { doc } = parseFilm3D({
      ...FILM,
      fps: 24,
      beats: [
        { ...FILM.beats[0], narration: "A fox crosses the clearing." },
        { ...FILM.beats[1] }, // silent beat — no line
      ],
    });
    const spec = narrationScript(doc!)!;
    expect(spec.fps).toBe(24);
    expect(spec.engine).toBe("espeak");
    expect(spec.lines).toEqual([{ at: 0.35, text: "A fox crosses the clearing." }]);
  });
});

describe("review helpers", () => {
  it("picks one still per camera segment, at its midpoint", () => {
    const { doc } = parseFilm3D(FILM);
    const stills = pickReviewStills(doc!);
    expect(stills.map((s) => s.sec)).toEqual([3, 8]);
    expect(stills[0]!.label).toMatch(/follow shot at 3.0s, target fox/);
  });

  it("falls back to beat midpoints when no camera is authored, capped at 5", () => {
    const beats = Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, start: i * 2, end: (i + 1) * 2 }));
    const { doc } = parseFilm3D({ ...FILM, beats, camera: [] });
    const stills = pickReviewStills(doc!);
    expect(stills.length).toBe(5);
    expect(stills[0]!.sec).toBe(1); // first beat kept
    expect(stills[4]!.sec).toBe(17); // last beat kept
  });

  it("reads KEEP verdicts, with or without surrounding prose", () => {
    expect(parseReviewReply("KEEP")).toEqual({ keep: true });
    expect(parseReviewReply("  keep\n")).toEqual({ keep: true });
    expect(parseReviewReply("The framing holds up — KEEP.")).toEqual({ keep: true });
  });

  it("reads a revised document, tolerating code fences", () => {
    const reply = "```json\n" + JSON.stringify(FILM) + "\n```";
    const res = parseReviewReply(reply);
    expect(res.keep).toBe(false);
    expect(parseFilm3D((res as { candidate: unknown }).candidate).doc).toBeDefined();
  });
});
