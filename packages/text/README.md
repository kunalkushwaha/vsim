# @vsim/text

Deterministic vector **text rasterizer** for vsim. Parses a bundled font with
[opentype.js](https://github.com/opentypejs/opentype.js), fills the glyph paths with a supersampled
scanline (nonzero winding), and returns a coverage bitmap — no platform font engine, so the same
text produces the **same pixels everywhere**. The renderers use it to composite screen-space text
overlays (titles / captions / lower-thirds) on top of the 3D, identically in draft and photoreal.

```ts
import { rasterizeText, measureText } from "@vsim/text";

const bmp = rasterizeText("Hello", 64); // { width, height, alpha: Uint8Array (0..255 coverage) }
const advance = measureText("Hello", 64); // px
```

## Bundled font

`fonts/DejaVuSans-Bold.ttf` — **DejaVu Sans Bold**, a free font (a Bitstream Vera / Arev derivative)
that is permissively licensed and freely redistributable. Full license: `fonts/LICENSE-DejaVu.txt`.
The DejaVu changes are in the public domain; the underlying Bitstream Vera fonts are © Bitstream, Inc.
and Tavmjong Bah, under a permissive, redistributable license.
