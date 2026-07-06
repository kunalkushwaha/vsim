// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  connector, packetFlow, drawArrow, codeBlock, barChart, queue, title, stepChip,
  server, browserWindow, database, callout,
} from "./kit.mjs";

describe("connector arc-length math (no getTotalLength)", () => {
  it("straight line: exact length and endpoint positions", () => {
    const c = connector({ from: [0, 0], to: [30, 40] });
    expect(c.length).toBeCloseTo(50, 9);
    expect(c.posAt(0)).toEqual([0, 0]);
    expect(c.posAt(1)).toEqual([30, 40]);
    expect(c.posAt(0.5)[0]).toBeCloseTo(15, 9);
  });

  it("curved connector bends through the control point and stays monotonic in arc length", () => {
    const c = connector({ from: [0, 100], to: [200, 100], via: [100, 0] });
    const [, midY] = c.posAt(0.5);
    expect(midY).toBeLessThan(100); // pulled toward the control point
    let prevX = -1;
    for (let t = 0; t <= 1.001; t += 0.05) {
      const [x] = c.posAt(Math.min(t, 1));
      expect(x).toBeGreaterThanOrEqual(prevX - 1e-9); // this symmetric arc never doubles back
      prevX = x;
    }
  });

  it("clamps t outside [0,1]", () => {
    const c = connector({ from: [0, 0], to: [10, 0] });
    expect(c.posAt(-5)).toEqual([0, 0]);
    expect(c.posAt(5)).toEqual([10, 0]);
  });
});

describe("packetFlow + drawArrow", () => {
  it("packets ride the path, staggered, fading at the ends", () => {
    const c = connector({ from: [0, 0], to: [100, 0] });
    const f = packetFlow(c, { count: 2 });
    f.flow(0);
    expect(f.el.children[0]!.getAttribute("opacity")).toBe("0");
    f.flow(0.5);
    const lead = f.el.children[0]!;
    expect(Number(lead.getAttribute("cx"))).toBeCloseTo(50, 3);
    expect(Number(lead.getAttribute("opacity"))).toBeGreaterThan(0.9);
    const trail = f.el.children[1]!;
    expect(Number(trail.getAttribute("cx"))).toBeLessThan(50); // staggered behind
  });

  it("drawArrow reveals stroke by dashoffset and pops the head at the end", () => {
    const a = drawArrow({ from: [0, 0], to: [100, 0] });
    const path = a.el.children[0]!, head = a.el.children[1]!;
    a.draw(0);
    expect(Number(path.getAttribute("stroke-dashoffset"))).toBeCloseTo(100, 3);
    expect(head.getAttribute("opacity")).toBe("0");
    a.draw(1);
    expect(Number(path.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 3);
    expect(head.getAttribute("opacity")).toBe("1");
  });
});

describe("panels", () => {
  it("codeBlock types characters across lines and highlights a line", () => {
    const cb = codeBlock({ x: 0, y: 0, lines: ["abcd", "efgh"] });
    const texts = [...cb.el.querySelectorAll("text")];
    cb.type(0.5);
    expect(texts[0]!.textContent).toBe("abcd");
    expect(texts[1]!.textContent).toBe("");
    cb.type(1);
    expect(texts[1]!.textContent).toBe("efgh");
    cb.highlight(1);
    const hl = cb.el.querySelector("rect[opacity='1']");
    expect(hl).not.toBeNull();
  });

  it("barChart grows bars to their values; queue fills slots", () => {
    const ch = barChart({ y: 0, h: 100, values: [0.5, 1] });
    ch.grow(1);
    const bars = [...ch.el.querySelectorAll("rect")];
    expect(Number(bars[0]!.getAttribute("height"))).toBeCloseTo(50, 3);
    expect(Number(bars[1]!.getAttribute("height"))).toBeCloseTo(100, 3);

    const q = queue({ slots: 4 });
    q.fill(0.5);
    const cells = [...q.el.querySelectorAll("rect")].slice(1); // first rect is the rail
    const lit = cells.filter((c) => c.getAttribute("fill")!.includes("accent"));
    expect(lit.length).toBe(2);
  });

  it("title reveals words progressively; stepChip activates", () => {
    const t = title({ text: "A B C" });
    t.reveal(0.5);
    const parts = [...t.el.querySelectorAll("text")];
    expect(Number(parts[0]!.getAttribute("opacity"))).toBe(1);
    expect(Number(parts[2]!.getAttribute("opacity"))).toBe(0);

    const chip = stepChip({ n: 1, text: "go" });
    chip.activate(1);
    expect(chip.el.querySelector("circle")!.getAttribute("fill")).toContain("accent");
  });

  it("server states + browser URL typing + database flash + callout pop are cue-ready", () => {
    const sv = server({});
    sv.setState("err");
    expect(sv.el.querySelector("circle")!.getAttribute("fill")).toContain("hot");
    sv.shake(0.25);
    expect(sv.el.querySelector("g")!.getAttribute("transform")).toMatch(/translate\(/);

    const b = browserWindow({ url: "abc.dev" });
    b.typeUrl(0.5);
    expect(b.el.querySelector("text")!.textContent).toBe("abc.");

    const db = database({});
    db.flash(0.5);
    const ring = [...db.el.querySelectorAll("ellipse")].find((e) => e.getAttribute("stroke")?.includes("accent2"))!;
    expect(Number(ring.getAttribute("opacity"))).toBeCloseTo(1, 5);

    const c = callout({ x: 10, y: 10, text: "hi", anchor: [0, 0] });
    c.pop(0.5);
    expect(c.el.querySelectorAll("g")[0]!.getAttribute("transform")).toContain("scale(0.5)");
  });
});
