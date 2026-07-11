// `vsim surface` — the generate → look → revise loop for BAKED HTML ARTIFACTS
// (docs/plan-surface-pack.md stage 4). The AI designs a self-contained page; a strict lint
// (not zod — HTML isn't a schema) rejects anything that could break determinism or reach
// the network; the baker renders it; the designer reviews its own PNG and may revise once.
import { z } from "zod";

export const SurfaceDocSchema = z.object({
  /** Library name — becomes surfaces/<name>/ and the `art` id films reference. */
  name: z.string().regex(/^[a-z][a-z0-9-]{1,24}$/),
  size: z.tuple([z.number().int().min(128).max(1024), z.number().int().min(128).max(1024)]),
  /** One line describing the artwork (goes in the manifest). */
  description: z.string().max(160),
  html: z.string().min(40).max(20000),
});
export type SurfaceDoc = z.infer<typeof SurfaceDocSchema>;

/** The bundled deterministic font, relative to surfaces/<name>/source.html. */
export const SURFACE_FONT = "../../../motion/fonts/BebasNeue-Regular.ttf";

/**
 * Determinism + safety lint for surface HTML. Agent-readable errors, like the validators:
 * the artifact must be fully self-contained (no network, no scripts, no external files
 * except the bundled font) so the bake is a pure function of the committed source.
 */
export function checkSurfaceHtml(html: string): string[] {
  const errors: string[] = [];
  const ban = (re: RegExp, why: string) => { if (re.test(html)) errors.push(why); };
  ban(/<script\b/i, "no <script> — surfaces are static CSS artifacts");
  ban(/https?:\/\//i, "no external URLs — the bake must not touch the network");
  ban(/@import\b/i, "no @import — all CSS inline in the one file");
  ban(/<link\b/i, "no <link> — styles go in a <style> block");
  ban(/<iframe\b|<object\b|<embed\b|<video\b|<audio\b/i, "no embedded documents or media elements");
  ban(/\banimation(-\w+)?\s*:/i, "no CSS animations — a surface is one deterministic still");
  ban(/\btransition(-\w+)?\s*:/i, "no CSS transitions — a surface is one deterministic still");
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    const u = m[1]!.trim();
    if (u !== SURFACE_FONT && !u.startsWith("data:image/")) {
      errors.push(`url(${u}) — only the bundled font (${SURFACE_FONT}) or data:image/ URIs are allowed`);
    }
  }
  for (const m of html.matchAll(/\bsrc="([^"]+)"/gi)) {
    if (!m[1]!.startsWith("data:image/")) errors.push(`src="${m[1]}" — only data:image/ URIs may be embedded`);
  }
  return errors;
}

/** Validate a candidate SurfaceDoc: schema first, then the HTML lint. */
export function parseSurface(input: unknown): { doc: SurfaceDoc; errors?: undefined } | { doc?: undefined; errors: string[] } {
  const res = SurfaceDocSchema.safeParse(input);
  if (!res.success) return { errors: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const lint = checkSurfaceHtml(res.data.html);
  return lint.length ? { errors: lint } : { doc: res.data };
}
