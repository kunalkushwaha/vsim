import { rasterizeText } from "@vsim/text";
import type { ResolvedTextOverlay } from "@vsim/core";
import { Framebuffer, gammaRgb } from "./raster.js";

/**
 * Paint screen-space text overlays on top of a rendered frame. Position is normalized [0..1]
 * (origin top-left); `align` anchors horizontally and `y` is the line's vertical center. Text is
 * rasterized deterministically by @vsim/text and alpha-blended in gamma space (same as the
 * framebuffer), with an optional background box for lower-thirds / captions.
 */
export function compositeOverlays(fb: Framebuffer, overlays: ResolvedTextOverlay[], width: number, height: number): void {
  for (const ov of overlays) {
    if (ov.opacity <= 0 || !ov.text) continue;
    const bm = rasterizeText(ov.text, ov.size);
    const anchorX = ov.x * width;
    const anchorY = ov.y * height;
    const left = ov.align === "center" ? anchorX - bm.width / 2 : ov.align === "right" ? anchorX - bm.width : anchorX;
    const top = anchorY - bm.height / 2;
    if (ov.box) {
      const pad = ov.box.padding;
      fb.fillRectBlend(left - pad, top - pad, bm.width + pad * 2, bm.height + pad * 2, gammaRgb(ov.box.color), ov.box.opacity * ov.opacity);
    }
    fb.blitCoverage(bm.alpha, bm.width, bm.height, left, top, gammaRgb(ov.color), ov.opacity);
  }
}
