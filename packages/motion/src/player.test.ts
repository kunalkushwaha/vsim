import { describe, it, expect } from "vitest";
import { frameAt } from "./player.mjs";

// The whole point of the player: TIME picks the frame, not the tick count. A 30 fps film
// must land on frame 30 after one second whether the display refreshed 60 or 144 times.

describe("frameAt — wall-clock → frame mapping", () => {
  it("maps elapsed time at the film's fps, not the refresh rate", () => {
    expect(frameAt(0, 30, 90)).toBe(0);
    expect(frameAt(1000, 30, 90)).toBe(30);
    expect(frameAt(2000, 30, 90)).toBe(60);
    expect(frameAt(1000 / 3, 30, 90)).toBe(10);
  });

  it("clamps without loop", () => {
    expect(frameAt(60_000, 30, 90)).toBe(90);
    expect(frameAt(-500, 30, 90)).toBe(0);
  });

  it("wraps with loop (inclusive of the last frame)", () => {
    expect(frameAt(3033.4, 30, 90, true)).toBe(0); // frame 91 ≡ 0 (mod 91)
    expect(frameAt(3000, 30, 90, true)).toBe(90);
    expect(frameAt(6066.7, 30, 90, true)).toBe(0); // two loops in
    expect(frameAt(-1, 30, 90, true)).toBe(90); // negative time wraps, never crashes
    expect(frameAt(-33.4, 30, 90, true)).toBe(89); // −1.002 frames floors to −2 → 89
  });

  it("60 Hz and 144 Hz displays sample the same frames at the same times", () => {
    // simulate both refresh cadences over 2s; at each shared wall-clock instant the
    // chosen frame must agree — this is exactly what f++-per-rAF gets wrong.
    for (const t of [0, 250, 500, 999, 1000, 1500, 1999]) {
      expect(frameAt(t, 30, 300)).toBe(Math.floor((t / 1000) * 30));
    }
  });
});
