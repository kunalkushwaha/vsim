/**
 * Deterministic seeded PRNG (mulberry32). The ONLY source of randomness allowed in the
 * runtime — global Math.random is banned (see lint rule) because it breaks reproducibility.
 *
 * Same seed → same sequence, on every platform. This is what makes
 * "preview == server render == N personalized variants" hold.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Avoid a zero state, which would collapse the generator.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Fork a child generator with a derived seed (for independent, reproducible streams). */
  fork(salt: number): Rng {
    return new Rng((this.state ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
  }
}
