import { describe, it, expect } from "vitest";
import { Rng } from "./rng.js";

describe("Rng", () => {
  it("is deterministic for the same seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    const a = Array.from({ length: 5 }, (_, i) => new Rng(1).next());
    const b = new Rng(2);
    expect(a[0]).not.toEqual(b.next());
  });

  it("produces floats in [0,1)", () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("int() respects inclusive bounds", () => {
    const r = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const x = r.int(3, 6);
      expect(x).toBeGreaterThanOrEqual(3);
      expect(x).toBeLessThanOrEqual(6);
    }
  });

  it("fork() gives a reproducible independent stream", () => {
    const seq1 = new Rng(5).fork(1).next();
    const seq2 = new Rng(5).fork(1).next();
    expect(seq1).toEqual(seq2);
  });
});
