import { defineConfig } from "vite";

// Dev: proxy /api/* to the Studio backend (pnpm studio:server) so the browser calls it same-origin.
export default defineConfig({
  server: { proxy: { "/api": "http://localhost:8787" } },
});
