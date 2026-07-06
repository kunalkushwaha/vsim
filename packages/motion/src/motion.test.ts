import { describe, it, expect } from "vitest";
import { EASES, ease, cubicBezier } from "./ease.mjs";
import { Timeline, attr, fmt } from "./timeline.mjs";
import { cameraCue } from "./camera.mjs";

describe("ease presets", () => {
  it("all presets hit exact endpoints", () => {
    for (const [name, f] of Object.entries(EASES)) {
      expect(f(0), name).toBe(0);
      expect(f(1), name).toBe(1);
    }
  });

  it("bezier presets are monotonic over 200 samples", () => {
    for (const name of ["snappy", "floaty", "heavy", "mechanical"] as const) {
      const f = ease(name);
      let prev = 0;
      for (let i = 1; i <= 200; i++) {
        const v = f(i / 200);
        expect(v, `${name}@${i}`).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it("overshoot exceeds 1 mid-flight and settles at 1", () => {
    const f = ease("overshoot");
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => f(i / 100)));
    expect(peak).toBeGreaterThan(1.05);
    expect(f(1)).toBe(1);
  });

  it("cubicBezier is deterministic (same inputs, same curve)", () => {
    const a = cubicBezier(0.3, 0.9, 0.35, 1);
    const b = cubicBezier(0.3, 0.9, 0.35, 1);
    for (let i = 0; i <= 50; i++) expect(a(i / 50)).toBe(b(i / 50));
  });

  it("unknown preset names throw", () => {
    expect(() => ease("linear")).toThrow(/unknown ease/);
  });
});

describe("Timeline seek purity", () => {
  const build = () => {
    const log = new Map<string, number>();
    const tl = new Timeline(30);
    tl.cue({ start: 0, end: 30, from: 0, to: 100, ease: "snappy", apply: (v) => log.set("a", v) });
    tl.cue({ start: 15, end: 60, from: 5, to: -5, ease: "heavy", apply: (v) => log.set("b", v) });
    tl.cue({ start: 40, end: 90, ease: "hold", apply: (v) => log.set("c", v) });
    return { tl, log };
  };

  it("seek(f) is a pure function of the frame — any prior seek order gives identical values", () => {
    const fresh = build();
    const scrubbed = build();
    // scrub wildly first, then land on the same frames
    for (const f of [83, 2, 59, 90, 0, 44, 17]) scrubbed.tl.seek(f);
    for (const f of [0, 10, 29, 30, 45, 60, 75, 90]) {
      fresh.tl.seek(f);
      const a = new Map(fresh.log);
      scrubbed.tl.seek(f);
      expect(scrubbed.log, `frame ${f}`).toEqual(a);
    }
  });

  it("clamps before start and after end", () => {
    const { tl, log } = build();
    tl.seek(-10);
    expect(log.get("a")).toBe(0);
    tl.seek(500);
    expect(log.get("a")).toBe(100);
    expect(log.get("b")).toBe(-5);
  });

  it("tracks length and converts seconds to frames", () => {
    const { tl } = build();
    expect(tl.length).toBe(90);
    expect(tl.sec(2)).toBe(60);
    expect(tl.sec(0.5)).toBe(15);
  });

  it("rejects zero-length cues", () => {
    expect(() => new Timeline().cue({ start: 5, end: 5, apply: () => {} })).toThrow(/must be >/);
  });
});

describe("apply factories + camera", () => {
  const fakeEl = () => {
    const attrs = new Map<string, string>();
    return { attrs, setAttribute: (n: string, v: string) => attrs.set(n, v) };
  };

  it("attr formats deterministically (no float noise, no -0)", () => {
    const el = fakeEl();
    attr(el, "cy")(1.23456789);
    expect(el.attrs.get("cy")).toBe("1.235");
    attr(el, "cy")(-0);
    expect(el.attrs.get("cy")).toBe("0");
    expect(fmt(2)).toBe("2");
  });

  it("cameraCue tweens the viewBox four-vector", () => {
    const svg = fakeEl();
    const tl = new Timeline(30);
    cameraCue(tl, svg, { start: 0, end: 10, from: [0, 0, 100, 50], to: [20, 10, 50, 25], ease: "mechanical" });
    tl.seek(0);
    expect(svg.attrs.get("viewBox")).toBe("0 0 100 50");
    tl.seek(10);
    expect(svg.attrs.get("viewBox")).toBe("20 10 50 25");
    tl.seek(5);
    const mid = svg.attrs.get("viewBox")!.split(" ").map(Number);
    expect(mid[2]).toBeGreaterThan(50);
    expect(mid[2]).toBeLessThan(100);
  });
});
