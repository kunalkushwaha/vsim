// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { parseFilmDoc } from "./filmdoc.mjs";
import { buildFilm } from "../templates/explainer.mjs";
import { piecewiseCue, stateCue, Timeline } from "./timeline.mjs";

const VALID = {
  title: "TEST FILM",
  stage: [
    { kind: "title", id: "t", text: "TEST FILM", x: 300, y: 100 },
    { kind: "server", id: "api", x: 900, y: 200, label: "api" },
    { kind: "connector", id: "wire", from: [200, 300], to: [900, 240] },
    { kind: "packets", id: "req", along: "wire", count: 3 },
    { kind: "callout", id: "note", x: 500, y: 100, text: "hi", anchor: [600, 200] },
  ],
  beats: [
    {
      id: "one", start: 0, end: 5, caption: "First things first.",
      actions: [
        { target: "t", do: "reveal", at: 0.3, dur: 1.5 },
        { target: "t", do: "fadeOut", at: 3.5, dur: 1 },
      ],
    },
    {
      id: "two", start: 5, end: 12, caption: "Then the request happens.",
      actions: [
        { target: "req", do: "flow", at: 0.5, dur: 3, value: 2 },
        { target: "api", do: "state", at: 2, dur: 0.5, value: "busy" },
        { target: "api", do: "state", at: 5, dur: 0.5, value: "ok" },
        { target: "note", do: "pop", at: 3, dur: 1 },
      ],
    },
  ],
  camera: [{ at: 4.5, dur: 2, view: [400, 100, 800, 375] }],
};

describe("FilmDoc schema", () => {
  it("accepts a valid document and applies defaults", () => {
    const { doc, errors } = parseFilmDoc(VALID);
    expect(errors).toBeUndefined();
    expect(doc!.fps).toBe(30);
    expect(doc!.stage.find((e: any) => e.id === "req").color).toBe("accent");
  });

  it("rejects the failure modes an LLM actually produces", () => {
    const bad = (mut: (d: any) => void) => {
      const d = structuredClone(VALID);
      mut(d);
      return parseFilmDoc(d).errors ?? [];
    };
    expect(bad((d) => d.stage.push({ ...d.stage[1], kind: "server" }))).toEqual(
      expect.arrayContaining([expect.stringContaining("unique")]));
    expect(bad((d) => (d.stage[3].along = "api"))).toEqual(
      expect.arrayContaining([expect.stringContaining("must reference a connector")]));
    expect(bad((d) => (d.beats[1].start = 6))).toEqual(
      expect.arrayContaining([expect.stringContaining("contiguous")]));
    expect(bad((d) => d.beats[0].actions.push({ target: "api", do: "flow", at: 0, dur: 1 }))).toEqual(
      expect.arrayContaining([expect.stringContaining('not valid for server')]));
    expect(bad((d) => (d.beats[0].actions[0].target = "ghost"))).toEqual(
      expect.arrayContaining([expect.stringContaining("unknown entity")]));
    expect(bad((d) => (d.stage[0].id = "has space"))).toEqual(
      expect.arrayContaining([expect.stringContaining("must match")]));
  });
});

describe("explainer template interpreter", () => {
  const NS = "http://www.w3.org/2000/svg";
  const build = () => {
    const stage = document.createElementNS(NS, "svg");
    const cap = document.createElement("div");
    const { doc } = parseFilmDoc(VALID);
    return { film: buildFilm(doc, stage, cap), stage, cap };
  };

  it("mounts every entity and honors the reset (title hidden at f0, caption karaoke live)", () => {
    const { film, stage, cap } = build();
    film.seek(0);
    expect(stage.querySelectorAll("*").length).toBeGreaterThan(10);
    expect(cap.textContent).toContain("First things first.");
    // title words at reveal(0) are transparent
    const word = stage.querySelector("text[textLength]")!; // title words carry textLength
    expect(Number(word.getAttribute("opacity"))).toBe(0);
  });

  it("owner cues drive fade, state, flow, and camera from the document alone", () => {
    const { film, stage } = build();
    film.seek(45); // title mid-visible (reveal by ~1.8s, fadeOut from 3.5s)
    const word = stage.querySelector("text[textLength]")!;
    expect(Number(word.getAttribute("opacity"))).toBe(1);
    film.seek(160); // 5.33s: beat two — packets flowing
    // some packet dot must be visible mid-flow at ~6s
    film.seek(200);
    const dots = [...stage.querySelectorAll("circle")].filter((c) => c.getAttribute("opacity") !== "0" && c.getAttribute("cx"));
    expect(dots.length).toBeGreaterThan(0);
    // state flips at marker starts: busy from 7s, ok from 10s
    const led = [...stage.querySelectorAll("circle")].find((c) => c.getAttribute("fill")?.includes("muted") || c.getAttribute("fill")?.includes("warn") || c.getAttribute("fill")?.includes("ok"))!;
    film.seek(240); // 8s
    expect(led.getAttribute("fill")).toContain("warn");
    film.seek(330); // 11s
    expect(led.getAttribute("fill")).toContain("ok");
    // camera moved off the default viewBox during/after its segment
    film.seek(220);
    expect(stage.getAttribute("viewBox")).not.toBe("0 0 1280 600");
  });

  it("seek is pure: a scrambled seek history lands on identical DOM", () => {
    const a = build(), b = build();
    for (const f of [300, 12, 199, 0, 359, 40]) b.film.seek(f);
    for (const f of [0, 45, 160, 220, 300, 359]) {
      a.film.seek(f);
      b.film.seek(f);
      expect(b.stage.outerHTML, `frame ${f}`).toBe(a.stage.outerHTML);
    }
  });
});

describe("piecewiseCue / stateCue (library owners)", () => {
  it("piecewiseCue holds between segments and never lets them fight", () => {
    const vals: number[] = [];
    const tl = new Timeline(30);
    piecewiseCue(tl, (v) => vals.push(v), [
      { f0: 10, f1: 20, from: 0, to: 1, ease: "mechanical" },
      { f0: 40, f1: 50, from: 1, to: 0, ease: "mechanical" },
    ]);
    const at = (f: number) => { vals.length = 0; tl.seek(f); return vals[0]; };
    expect(at(0)).toBe(0);
    expect(at(30)).toBe(1); // holds after seg 1
    expect(at(100)).toBe(0); // holds after seg 2
    expect(at(15)).toBeGreaterThan(0);
    expect(at(15)).toBeLessThan(1);
  });

  it("stateCue applies the last marker at or before the frame", () => {
    const seen: string[] = [];
    const tl = new Timeline(30);
    stateCue(tl, (v) => seen.push(v), [
      { f: 0, value: "idle" }, { f: 60, value: "busy" }, { f: 120, value: "ok" },
    ]);
    const at = (f: number) => { seen.length = 0; tl.seek(f); return seen[0]; };
    expect(at(0)).toBe("idle");
    expect(at(59)).toBe("idle");
    expect(at(60)).toBe("busy");
    expect(at(500)).toBe("ok");
    expect(at(61)).toBe("busy"); // scrub back — still pure
  });
});
