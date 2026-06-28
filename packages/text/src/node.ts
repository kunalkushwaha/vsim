// Node entry: read the bundled font from disk and register it, then re-export the rasterizer.
// Importing this module has the side effect of loading the default font, so Node callers (the
// software renderer, the Cycles overlay step) can just `import { rasterizeText } from "@vsim/text/node"`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setFont, hasFont } from "./index.js";

if (!hasFont()) {
  const p = fileURLToPath(new URL("../fonts/DejaVuSans-Bold.ttf", import.meta.url));
  setFont(readFileSync(p));
}

export * from "./index.js";
