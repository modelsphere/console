import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// emptyOutDir wipes dist on every build, and that takes the .gitkeep with it --
// the one file //go:embed all:dist needs in a fresh checkout. Losing it is
// silent: the build still works, but `git add -A` then stages the deletion and
// the next clone cannot `go build`. So put it back when the bundle closes.
function keepDistEmbeddable(): Plugin {
  return {
    name: "keep-dist-embeddable",
    apply: "build",
    closeBundle() {
      const dir = path.resolve(import.meta.dirname, "dist");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, ".gitkeep"), "");
    },
  };
}

// The SPA is served by console from web/dist, same-origin, so /api, /oauth are
// proxied to the running BFF in dev.
//
// UI_KIT picks which set of components the swiss module's pages compile against:
// `rise` (the default) adapts them onto @riseaicloud/ui, `shadcn` uses the ones
// swiss ships. The pages are the same files either way -- they import
// @swiss/components/ui/*, and only this alias decides where that lands. The
// shell is Rise in both builds; this swaps the module, not console's chrome.
const uiKit = process.env.UI_KIT === "shadcn" ? "shadcn" : "rise";

export default defineConfig({
  plugins: [react(), tailwindcss(), keepDistEmbeddable()],
  resolve: {
    alias: {
      // Longest prefix first: vite tries these in order.
      "@swiss/components/ui": path.resolve(
        import.meta.dirname,
        `src/modules/swiss/components/ui/${uiKit}`,
      ),
      "@swiss": path.resolve(import.meta.dirname, "src/modules/swiss"),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/oauth": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
