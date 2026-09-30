import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HttpProxyAgent } from "http-proxy-agent";

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

// One source, two builds. The swiss pages are the same files in both; only the
// entry and two aliases differ:
//
// | mode             | entry                        | @swiss/lib/host | @swiss/components/ui | /api goes to            | out          |
// |------------------|------------------------------|-----------------|----------------------|-------------------------|--------------|
// | (default)        | index.html, console shell    | console.ts      | rise                 | console, :8080          | dist/        |
// | `--mode swiss`   | modules/swiss/standalone     | standalone.ts   | shadcn               | swissd, $SWISSD         | dist-swiss/  |
const src = path.resolve(import.meta.dirname, "src");
const swissDir = path.join(src, "modules/swiss");

const egressProxy = process.env.http_proxy ?? process.env.HTTP_PROXY;
// const remote = 'http://127.0.0.1:8080';
const remote = process.env.SWISSD ?? 'http://172.28.44.16:32326';
// const remote = 'http://172.26.6.11:31488';

export default defineConfig(({ mode }) => {
  const swiss = mode === "swiss";
  const proxy: Record<string, string | ProxyOptions> = swiss
    ? // swissd's own login: its session cookie is host-only and plain-http here, so it rides the proxy.
      {
        "/api": {
          target: remote,
          changeOrigin: true,
          agent: egressProxy ? new HttpProxyAgent(egressProxy) : undefined,
        },
      }
    : { "/api": "http://localhost:8080", "/oauth": "http://localhost:8080" };
  return {
    root: swiss ? path.join(swissDir, "standalone") : undefined,
    plugins: [react(), tailwindcss(), ...(swiss ? [] : [keepDistEmbeddable()])],
    resolve: {
      // First match wins, so the specific ones go before @swiss.
      alias: [
        { find: /^@swiss\/lib\/host$/, replacement: path.join(swissDir, "lib/host", swiss ? "standalone.ts" : "console.ts") },
        { find: "@swiss/components/ui", replacement: path.join(swissDir, "components/ui", swiss ? "shadcn" : "rise") },
        { find: "@swiss", replacement: swissDir },
        { find: "@", replacement: src },
      ],
    },
    server: { proxy },
    build: {
      outDir: path.resolve(import.meta.dirname, swiss ? "dist-swiss" : "dist"),
      emptyOutDir: true,
      // swissd embeds this bundle in a binary pulled on every rollout; keep growth noticed.
      chunkSizeWarningLimit: swiss ? 400 : undefined,
    },
  };
});
