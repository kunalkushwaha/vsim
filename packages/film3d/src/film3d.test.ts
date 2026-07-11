import { describe, it, expect } from "vitest";
import { listCharacters } from "@vsim/assets";
import { SceneRuntime } from "@vsim/core";
import { parseFilm3D, CHARACTERS, CHARACTER_IDS } from "./schema.js";
import { compileFilm3D } from "./compile.js";
import { narrationScript, DEFAULT_ELEVENLABS_VOICE } from "./narration.js";
import { pickReviewStills, parseReviewReply } from "./review.js";
import { isFilm3D, film3dToScene } from "./load.js";
import { parseCreature, creatureGeometry } from "./creature.js";
import { checkSurfaceHtml } from "./surface-gen.js";

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

describe("isFilm3D (shared sniff)", () => {
  it("recognizes the version tag", () => {
    expect(isFilm3D({ version: "film3d-1" })).toBe(true);
    expect(isFilm3D({ version: "0.1", meta: {} })).toBe(false);
  });

  it("recognizes a screenplay that omits the optional version field", () => {
    const { version, ...versionless } = { ...FILM, version: undefined } as Record<string, unknown>;
    expect(isFilm3D(versionless)).toBe(true);
    expect(parseFilm3D(versionless).doc).toBeDefined(); // and it really is valid
  });

  it("does not claim plain scene documents or junk", () => {
    expect(isFilm3D({ meta: { fps: 30 }, nodes: [], beats: [] })).toBe(false);
    expect(isFilm3D(null)).toBe(false);
    expect(isFilm3D("film3d")).toBe(false);
  });
});

describe("film3dToScene", () => {
  it("compiles raw film3d JSON and throws agent-readable errors on invalid input", async () => {
    const sceneDoc = await film3dToScene(FILM);
    expect(sceneDoc.meta.durationFrames).toBe(300);
    await expect(film3dToScene({ ...FILM, actors: [] })).rejects.toThrow(/unknown actor/);
  });
});

describe("narrationScript engines", () => {
  it("defaults to espeak, switches to elevenlabs with a default voice on request", () => {
    const { doc } = parseFilm3D({ ...FILM, beats: [{ ...FILM.beats[0], narration: "A fox." }, FILM.beats[1]] });
    expect(narrationScript(doc!)!.engine).toBe("espeak");
    const el = narrationScript(doc!, { engine: "elevenlabs" })!;
    expect(el.engine).toBe("elevenlabs");
    expect(el.elevenlabs!.voiceId).toBe(DEFAULT_ELEVENLABS_VOICE);
    expect(narrationScript(doc!, { engine: "elevenlabs", voiceId: "abc" })!.elevenlabs!.voiceId).toBe("abc");
  });
});

describe("set dressing props", () => {
  const DRESSED = {
    title: "Dressed set",
    set: "meadow",
    props: [
      { kind: "bush", id: "sh1", x: -2, z: -3 },
      { kind: "flowers", id: "fl1", x: 1, z: -1, radius: 1.2 },
      { kind: "stump", id: "st1", x: 3, z: -2 },
      { kind: "log", id: "lg1", x: -1, z: 1, length: 2, angle: 40 },
      { kind: "pond", id: "pd1", x: 5, z: 2, radius: 2 },
      { kind: "lantern", id: "ln1", x: 0, z: 3 },
    ],
    actors: [{ id: "fox", character: "fox", x: 4, z: -1 }],
    beats: [{ id: "b1", start: 0, end: 4 }],
  } as const;

  it("accepts every dressing kind and fills defaults", () => {
    const res = parseFilm3D(DRESSED);
    expect(res.errors).toBeUndefined();
    const byId = Object.fromEntries(res.doc!.props.map((p) => [p.id, p]));
    expect((byId.sh1 as { radius: number }).radius).toBe(0.6);
    expect((byId.lg1 as { angle: number }).angle).toBe(40);
  });

  it("compiles dressing into scene nodes the runtime accepts", async () => {
    const sceneDoc = await film3dToScene(DRESSED);
    const ids = new Set(sceneDoc.nodes.map((n) => n.id));
    for (const want of ["sh1__l0", "fl1__b0", "st1__face", "lg1__trunk", "pd1__surface", "ln1__flame"]) {
      expect(ids.has(want), `missing node ${want}`).toBe(true);
    }
    // The lantern pools real light: a decay-2 warm point light at head height.
    const lamp = sceneDoc.nodes.find((n) => n.id === "ln1__light") as { light?: { type: string; decay?: number } };
    expect(lamp?.light?.type).toBe("point");
    expect(lamp?.light?.decay).toBe(2);
    new SceneRuntime(sceneDoc).computeFrameState(60); // evaluates without throwing
  });

  it("dresses deterministically — identical JSON twice", async () => {
    expect(JSON.stringify(await film3dToScene(DRESSED))).toBe(JSON.stringify(await film3dToScene(DRESSED)));
  });
});

describe("id namespace guard", () => {
  it('rejects ids containing "__" — reserved for generated child nodes', () => {
    const res = parseFilm3D({ ...FILM, props: [{ kind: "rock", id: "r1__shore0", x: 0, z: 0 }] });
    expect(res.errors!.join("\n")).toMatch(/reserved for generated nodes/);
  });
});

describe("CreatureDoc", () => {
  const WOLF = {
    id: "testwolf", name: "Test Wolf", description: "A lean test canid.",
    bones: [
      { name: "hips", head: [0, -0.3, 0.6], tail: [0, 0, 0.62] },
      { name: "spine", head: [0, 0, 0.62], tail: [0, 0.35, 0.62], parent: "hips" },
      { name: "neck", head: [0, 0.35, 0.62], tail: [0, 0.5, 0.75], parent: "spine" },
      { name: "head", head: [0, 0.5, 0.75], tail: [0, 0.68, 0.78], parent: "neck" },
      { name: "tail", head: [0, -0.3, 0.58], tail: [0, -0.6, 0.5], parent: "hips" },
    ],
    legs: { front_y: 0.3, back_y: -0.25, sx: 0.1, top: 0.6, knee: 0.32, r_u: 0.045, r_l: 0.035 },
    parts: [
      { bone: "hips", kind: "cube", loc: [0, -0.15, 0.6], scale: [0.13, 0.18, 0.13] },
      { bone: "spine", kind: "cube", loc: [0, 0.15, 0.62], scale: [0.14, 0.24, 0.13] },
      { bone: "head", kind: "sphere", loc: [0, 0.58, 0.77], scale: [0.08, 0.1, 0.08] },
      { bone: "tail", kind: "cyl", loc: [0, -0.45, 0.54], scale: [0.03, 0.03, 0.14] },
    ],
    gaits: { walk: [0.32, -0.26], run: [0.7, -0.6] },
    runAt: 2.6, eye: 0.7, tint: [0.45, 0.45, 0.48],
  };

  it("accepts a valid creature and maps to the generator's table format", () => {
    const res = parseCreature(WOLF);
    expect(res.errors).toBeUndefined();
    const geo = creatureGeometry(res.doc!) as { bones: unknown[][]; parts: unknown[][]; legs: object };
    expect(geo.bones[0]).toEqual(["hips", [0, -0.3, 0.6], [0, 0, 0.62]]); // rootless = 3-tuple
    expect(geo.bones[1]![3]).toBe("hips");
    expect(geo.parts[0]).toEqual(["hips", "cube", [0, -0.15, 0.6], [0.13, 0.18, 0.13]]);
  });

  it("rejects missing torso bones, orphan bones, and bad legs with readable errors", () => {
    expect(parseCreature({ ...WOLF, bones: WOLF.bones.slice(0, 4) }).errors!.join("\n")).toMatch(/must include "tail"/);
    expect(parseCreature({ ...WOLF, bones: [...WOLF.bones.slice(0, 4), { name: "tail", head: [0, 0, 0.5], tail: [0, -0.3, 0.5] }] }).errors!.join("\n")).toMatch(/needs a parent/);
    expect(parseCreature({ ...WOLF, legs: { ...WOLF.legs, knee: 0.7 } }).errors!.join("\n")).toMatch(/knee must be below/);
    expect(parseCreature({ ...WOLF, parts: [{ bone: "wings", kind: "cube", loc: [0, 0, 0.5], scale: [0.1, 0.1, 0.1] }] }).errors!.join("\n")).toMatch(/unknown bone "wings"/);
  });
});

describe("surface props (sign + cutout)", () => {
  const DOC = {
    title: "Signage", set: "meadow",
    props: [
      { kind: "sign", id: "s1", x: 2, z: -1, art: "trail-sign", angle: 20 },
      { kind: "cutout", id: "c1", x: -2, z: -2, art: "star-cutout", height: 2 },
    ],
    actors: [{ id: "fox", character: "fox", x: 4, z: -1 }],
    beats: [{ id: "b1", start: 0, end: 4 }],
  } as const;

  it("validates art against the generated surface tables", () => {
    expect(parseFilm3D(DOC).errors).toBeUndefined();
    const bad = parseFilm3D({ ...DOC, props: [{ kind: "sign", id: "s1", x: 0, z: 0, art: "nope" }] });
    expect(bad.errors!.join("\n")).toMatch(/art/);
  });

  it("keeps the generated tables in sync with the surfaces manifest", async () => {
    const { listSurfaces } = await import("@vsim/assets");
    const metas = await listSurfaces();
    const { SURFACE_NAMES, CUTOUT_NAMES } = await import("./surfaces.js");
    expect([...SURFACE_NAMES].sort()).toEqual(metas.filter((m) => m.type !== "svg").map((m) => m.name).sort());
    expect([...CUTOUT_NAMES].sort()).toEqual(metas.filter((m) => m.type === "svg").map((m) => m.name).sort());
  });

  it("compiles a sign (textured board + posts) and a cutout (extruded meshes)", async () => {
    const sceneDoc = await film3dToScene(DOC);
    const ids = new Set(sceneDoc.nodes.map((n) => n.id));
    for (const want of ["s1__board", "s1__post_l", "s1__post_r", "c1__m0"]) {
      expect(ids.has(want), `missing ${want}`).toBe(true);
    }
    const board = sceneDoc.nodes.find((n) => n.id === "s1__board") as { mesh?: { geometry: { data?: { texture?: { width: number } } } } };
    expect(board.mesh?.geometry.data?.texture?.width).toBe(512); // the trail-sign bake
    new SceneRuntime(sceneDoc).computeFrameState(30);
  });
});

describe("checkSurfaceHtml (the artifact lint)", () => {
  const OK = `<!doctype html><style>@font-face{font-family:B;src:url("../../../motion/fonts/BebasNeue-Regular.ttf")}html,body{margin:0;width:512px;height:384px;overflow:hidden}body{background:linear-gradient(#fff,#eee)}</style><h1>HI</h1>`;
  it("accepts a self-contained artifact", () => expect(checkSurfaceHtml(OK)).toEqual([]));
  it("rejects scripts, network, animation, and foreign files", () => {
    expect(checkSurfaceHtml(`${OK}<script>x()</script>`).join()).toMatch(/no <script>/);
    expect(checkSurfaceHtml(OK.replace("HI", 'HI <img src="https://x.com/a.png">')).join()).toMatch(/no external URLs/);
    expect(checkSurfaceHtml(OK.replace("linear-gradient(#fff,#eee)", 'url("wood.png")')).join()).toMatch(/only the bundled font/);
    expect(checkSurfaceHtml(OK.replace("</style>", "h1{animation:spin 1s}</style>")).join()).toMatch(/no CSS animations/);
    expect(checkSurfaceHtml(OK + '<img src="data:image/png;base64,AA==">')).toEqual([]); // data URIs pass
    expect(checkSurfaceHtml(OK.replace('src:url', 'src:local("Impact"),url')).join()).toMatch(/no local\(/); // host fonts banned
  });
});
