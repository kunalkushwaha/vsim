// Wall-clock playback for the browser — because web animation does NOT run like a filmstrip.
//
// Recording is frame-INDEXED: the recorder steps seek(0), seek(1), … and every frame gets
// equal weight regardless of how long it takes to rasterize. Live playback is time-BASED:
// the display refreshes at 60/120/144 Hz, tabs throttle, devices stutter — so the player maps
// ELAPSED WALL-CLOCK TIME to a frame index and calls the same pure seek(f). Frames may be
// skipped or repeated on screen; the mapping, not the tick count, carries the tempo.
// (The naive `f++ per requestAnimationFrame` plays a 30 fps film at 2× on a 60 Hz screen.)

/**
 * Pure mapping: elapsed milliseconds → frame index at `fps`, clamped to [0, frames].
 * Exported separately so the arithmetic is unit-testable without a browser.
 * @param {number} elapsedMs @param {number} fps @param {number} frames
 * @param {boolean} [loop]
 */
export function frameAt(elapsedMs, fps, frames, loop = false) {
  const raw = Math.floor((elapsedMs / 1000) * fps);
  if (loop) return frames > 0 ? ((raw % (frames + 1)) + frames + 1) % (frames + 1) : 0;
  return Math.min(Math.max(raw, 0), frames);
}

/**
 * Drive a film { fps, frames, seek } from the wall clock via requestAnimationFrame.
 * Returns { play, pause, toggle, stop, seekTo, get playing }. Honors prefers-reduced-motion
 * by starting paused (the film is still fully scrubbable).
 *
 * @param {{fps: number, frames: number, seek: (f: number) => void}} film
 * @param {{loop?: boolean, onFrame?: (f: number) => void, autoplay?: boolean}} [opts]
 */
export function createPlayer(film, opts = {}) {
  const loop = opts.loop ?? true;
  let raf = /** @type {number | null} */ (null);
  let startedAt = 0; // wall-clock origin of the current run
  let pausedAt = 0; // film position (ms) while paused
  let lastFrame = -1;

  const show = (/** @type {number} */ f) => {
    if (f === lastFrame) return; // same frame this refresh — skip the DOM work
    lastFrame = f;
    film.seek(f);
    opts.onFrame?.(f);
  };

  const tick = (/** @type {number} */ now) => {
    show(frameAt(now - startedAt, film.fps, film.frames, loop));
    raf = requestAnimationFrame(tick);
  };

  const play = () => {
    if (raf !== null) return;
    startedAt = performance.now() - pausedAt;
    raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    if (raf === null) return;
    cancelAnimationFrame(raf);
    raf = null;
    pausedAt = performance.now() - startedAt;
  };
  const stop = () => {
    pause();
    pausedAt = 0;
    show(0);
  };
  const seekTo = (/** @type {number} */ f) => {
    pausedAt = (f / film.fps) * 1000;
    startedAt = performance.now() - pausedAt;
    show(Math.min(Math.max(f, 0), film.frames));
  };

  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if ((opts.autoplay ?? true) && !reduced) play();
  else show(0);

  return { play, pause, stop, seekTo, toggle: () => (raf === null ? play() : pause()), get playing() { return raf !== null; } };
}
