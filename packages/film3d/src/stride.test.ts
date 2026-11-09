// Stride matching (docs/plan-human-motion.md §A): gait clips play at travel speed / stride so
// planted feet don't skate. The table values are measured from the rigs, never hand-tuned.
import { describe, it, expect } from "vitest";
import { loadCharacter } from "@vsim/assets";
import { CHARACTERS, CHARACTER_IDS } from "./schema.js";
import { film3dToScene } from "./load.js";
import { GAIT_RATE } from "./compile.js";
import { measureStride } from "./stride.js";

describe("stride matching", () => {
  it("every declared stride matches the clip's ground speed measured from the rig (±10%)", { timeout: 300_000 }, async () => {
    let checked = 0;
    for (const id of CHARACTER_IDS) {
      const info = CHARACTERS[id];
      const { meta } = await loadCharacter(id, 30);
      for (const gait of ["walk", "run"] as const) {
        const g = info[gait] as { clip: string; stride?: number };
        if (!g.stride) continue;
        const measured = await measureStride(id, g.clip, meta.scale * info.scale, info.faces);
        expect(Math.abs(measured - g.stride) / g.stride, `${id} ${gait}: table ${g.stride}, measured ${measured.toFixed(2)}`).toBeLessThan(0.1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4); // suited + fox, walk + run
  });

  it("plays the walk at travel speed / stride, clamped, and leaves stride-less rigs at 1×", async () => {
    const film = (character: string, to: number, dur: number, gait?: "walk" | "run") => ({
      title: "", set: "studio",
      actors: [{ id: "a", character, x: -4, z: 0 }],
      beats: [{ id: "b", start: 0, end: dur + 1, actions: [{ do: "move", actor: "a", to: [to, 0], at: 0, dur, ...(gait ? { gait } : {}) }] }],
    });
    const rateOf = async (doc: unknown, clip: string) => {
      const sd = await film3dToScene(doc);
      const mesh = sd.nodes.find((n) => n.id === "a__mesh") as { clips?: { clipId: string; speed?: number }[] };
      return mesh.clips!.find((c) => c.clipId === `a/${clip}`)!.speed;
    };
    // 4 units in 4 s = 1 m/s; the mocap walk's natural pace is 1.41 m/s → play at ~0.71×.
    expect(await rateOf(film("suited", 0, 4), "walk")).toBeCloseTo(1 / 1.41, 3);
    // A stroll far below the clip's pace clamps (no slow-motion moonwalk).
    expect(await rateOf(film("suited", -3, 4), "walk")).toBe(GAIT_RATE[0]);
    // Running: 10 units in 3.5 s ≈ 2.86 m/s on a 3.5 m/s run → ~0.82×.
    expect(await rateOf(film("suited", 6, 3.5, "run"), "run")).toBeCloseTo((10 / 3.5) / 3.5, 3);
    // Rigs without a measured stride keep the clip's own rate.
    expect(await rateOf(film("knight", 0, 4), "Walking_A") ?? 1).toBe(1); // the scene schema defaults speed to 1
  });

  it("picks the run once the walk would have to play faster than it can stay planted", async () => {
    const info = CHARACTERS.suited;
    // runAt × 0.7 is the switch speed; at it, the walk must still be inside the rate clamp.
    const switchSpeed = info.runAt * 0.7;
    expect(switchSpeed / info.walk.stride).toBeLessThanOrEqual(GAIT_RATE[1]);
    expect(switchSpeed / info.run.stride).toBeGreaterThanOrEqual(GAIT_RATE[0]);
  });
});

describe("one-shot clips and the seated state", () => {
  const film = (actions: unknown[], end = 12) => ({
    title: "", set: "studio",
    props: [{ kind: "bench", id: "bench", x: 0, z: -0.45 }],
    actors: [{ id: "a", character: "suited", x: 0, z: 0 }],
    beats: [{ id: "b", start: 0, end, actions }],
  });

  it("sit_down plays once, then the actor rests seated until stand_up", async () => {
    const sd = await film3dToScene(film([
      { do: "play", actor: "a", clip: "sit_down", at: 0.5, dur: 1.5 },
      { do: "play", actor: "a", clip: "sit_talk", at: 3, dur: 2 },
      { do: "play", actor: "a", clip: "stand_up", at: 6, dur: 1 },
    ]));
    const clips = (sd.nodes.find((n) => n.id === "a__mesh") as { clips: { clipId: string; loop?: boolean; startFrame: number }[] }).clips;
    const seq = clips.map((c) => `${c.clipId.slice(2)}${c.loop === false ? "(once)" : ""}@${c.startFrame}`);
    expect(seq).toEqual(["idle@0", "sit_down(once)@15", "sit@60", "sit_talk@90", "sit@150", "stand_up(once)@180", "idle@210"]);
  });

  it("rejects walking off while seated, double sits and standing up from standing", async () => {
    const { parseFilm3D } = await import("./schema.js");
    const err = (actions: unknown[]) => parseFilm3D(film(actions)).errors?.join("\n") ?? "";
    expect(err([{ do: "play", actor: "a", clip: "sit_down", at: 0, dur: 1.5 }, { do: "move", actor: "a", to: [3, 0], at: 3, dur: 2 }])).toMatch(/is seated .* play "stand_up" before moving/);
    expect(err([{ do: "play", actor: "a", clip: "sit_down", at: 0, dur: 1.5 }, { do: "play", actor: "a", clip: "sit_down", at: 3, dur: 1.5 }])).toMatch(/already seated/);
    expect(err([{ do: "play", actor: "a", clip: "stand_up", at: 0, dur: 1 }])).toMatch(/isn't seated/);
    expect(err([{ do: "play", actor: "a", clip: "sit_down", at: 0, dur: 1.5 }, { do: "play", actor: "a", clip: "talk", at: 3, dur: 2 }])).toMatch(/"talk" is a standing clip/);
    expect(err([{ do: "play", actor: "a", clip: "sit_down", at: 0, dur: 1.5 }, { do: "play", actor: "a", clip: "stand_up", at: 3, dur: 1 }, { do: "move", actor: "a", to: [3, 0], at: 5, dur: 2 }])).toBe("");
  });
});
