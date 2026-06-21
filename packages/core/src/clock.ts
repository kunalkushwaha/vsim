/**
 * Fixed-timestep clock. Time is measured in WHOLE FRAMES, never wall-clock seconds, so
 * there is zero float drift between a live preview and an offline render.
 *
 * `dt` (seconds per frame) is derived once from fps. Simulation always advances in equal
 * steps, optionally sub-stepped for stiffer physics. The same `advanceTo(n)` call sequence
 * produces the same world state every time.
 */
export interface ClockOptions {
  fps: number;
  /** Physics/sim sub-steps per frame. Higher = stabler sim, same visual frame rate. */
  substeps?: number;
}

export class Clock {
  readonly fps: number;
  readonly substeps: number;
  readonly dt: number; // seconds per frame
  readonly subDt: number; // seconds per sub-step
  private _frame = 0; // frame 0 = initial state (no stepping performed yet)

  constructor(opts: ClockOptions) {
    if (opts.fps <= 0) throw new Error("fps must be > 0");
    this.fps = opts.fps;
    this.substeps = Math.max(1, opts.substeps ?? 1);
    this.dt = 1 / this.fps;
    this.subDt = this.dt / this.substeps;
  }

  get frame(): number {
    return this._frame;
  }

  /** Seconds elapsed at the current frame. */
  get time(): number {
    return this._frame / this.fps;
  }

  /**
   * Advance to `targetFrame`, invoking `onStep` for every sub-step in between. Stepping is
   * always forward and frame-by-frame so simulation state stays deterministic; seeking
   * backwards requires a reset + replay (handled by the runtime).
   */
  advanceTo(targetFrame: number, onStep: (subDt: number) => void): void {
    if (targetFrame < this._frame) {
      throw new Error(
        `Clock only advances forward (have ${this._frame}, asked ${targetFrame}); reset to replay.`,
      );
    }
    while (this._frame < targetFrame) {
      for (let s = 0; s < this.substeps; s++) onStep(this.subDt);
      this._frame++;
    }
  }

  reset(): void {
    this._frame = 0;
  }
}
