import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const isBuild = process.argv.includes("build");

// Read PORT from env (artifact.toml injects PORT=5000); fall back to 5000 for local dev.
const port = Number(process.env.PORT || "5000");

if (!isBuild && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // React core — must be isolated so downstream chunks can share it without circular refs
          if (/node_modules\/(react|react-dom|scheduler|react-is|use-sync-external-store)\//.test(id)) return "react-vendor";
          if (id.includes("/@radix-ui/")) return "ui-radix";
          if (/\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return "ui-motion";
          if (id.includes("/@tanstack/")) return "query-vendor";
          if (id.includes("/lucide-react/")) return "icons";
          if (id.includes("/zod/") || id.includes("/react-hook-form/") || id.includes("/@hookform/")) return "forms";
          if (id.includes("/date-fns/")) return "date-fns";
          if (id.includes("/cmdk/") || id.includes("/sonner/") || id.includes("/vaul/")) return "ui-extras";
          if (id.includes("/wouter/")) return "router";
          // No catch-all — let Rollup group remaining node_modules into the app chunk
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        proxyTimeout: 60_000,
        timeout: 60_000,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === "ECONNREFUSED" || code === "ECONNRESET") {
              if (res && !res.headersSent) {
                res.writeHead(503, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Server is starting up, please try again in a moment." }));
              }
            }
          });
        },
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
