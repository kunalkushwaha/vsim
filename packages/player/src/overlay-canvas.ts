import { rasterizeText, hasFont } from "@vsim/text";
import type { ResolvedTextOverlay } from "@vsim/core";

/** Linear RGB [0,1] → gamma-encoded 8-bit (matches the software framebuffer's encoding). */
function enc(c: number): number {
  return Math.round(Math.pow(Math.min(Math.max(c, 0), 1), 1 / 2.2) * 255);
}

export interface OverlayDraw {
  /** Tinted text image: RGBA, alpha = glyph coverage × overlay opacity. Place its top-left at dx,dy. */
  text: { rgba: Uint8ClampedArray; width: number; height: number; dx: number; dy: number };
  /** Optional background box (gamma color + combined alpha), drawn behind the text. */
  box?: { x: number; y: number; w: number; h: number; r: number; g: number; b: number; a: number };
}

/**
 * Resolve a text overlay to concrete pixels for a `w`×`h` frame — the pure layout + tint step shared
 * by the live preview. Mirrors the software compositor (same normalized position, alignment, gamma),
 * so the preview matches the render. Returns null for an invisible/empty overlay. Requires a font
 * (`setFont`); throws otherwise.
 */
export function overlayDraw(ov: ResolvedTextOverlay, w: number, h: number): OverlayDraw | null {
  if (ov.opacity <= 0 || !ov.text) return null;
  const bm = rasterizeText(ov.text, ov.size);
  const ax = ov.x * w, ay = ov.y * h;
  const left = ov.align === "center" ? ax - bm.width / 2 : ov.align === "right" ? ax - bm.width : ax;
  const top = ay - bm.height / 2;
  const r = enc(ov.color[0]), g = enc(ov.color[1]), b = enc(ov.color[2]);
  const rgba = new Uint8ClampedArray(bm.width * bm.height * 4);
  for (let i = 0; i < bm.alpha.length; i++) {
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = Math.round(bm.alpha[i]! * ov.opacity);
  }
  let box: OverlayDraw["box"];
  if (ov.box) {
    const pad = ov.box.padding;
    box = { x: left - pad, y: top - pad, w: bm.width + pad * 2, h: bm.height + pad * 2, r: enc(ov.box.color[0]), g: enc(ov.box.color[1]), b: enc(ov.box.color[2]), a: ov.box.opacity * ov.opacity };
  }
  return { text: { rgba, width: bm.width, height: bm.height, dx: Math.round(left), dy: Math.round(top) }, box };
}

/**
 * Paint text overlays onto a transparent 2D canvas stacked over the WebGL preview. No-op until a
 * font is loaded (`setFont`). The text uses the same deterministic rasterizer as the render.
 */
export function paintOverlays(canvas: HTMLCanvasElement, overlays: ResolvedTextOverlay[], w: number, h: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!hasFont()) return;
  for (const ov of overlays) {
    const d = overlayDraw(ov, w, h);
    if (!d) continue;
    if (d.box && d.box.a > 0) {
      ctx.globalAlpha = d.box.a;
      ctx.fillStyle = `rgb(${d.box.r},${d.box.g},${d.box.b})`;
      ctx.fillRect(d.box.x, d.box.y, d.box.w, d.box.h);
      ctx.globalAlpha = 1;
    }
    // Blit the tinted text via a scratch canvas so drawImage alpha-composites it over the box.
    const tmp = document.createElement("canvas");
    tmp.width = d.text.width; tmp.height = d.text.height;
    tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(d.text.rgba), d.text.width, d.text.height), 0, 0);
    ctx.drawImage(tmp, d.text.dx, d.text.dy);
  }
}
