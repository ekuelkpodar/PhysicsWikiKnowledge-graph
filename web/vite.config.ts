/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Relative base + HashRouter => works on GitHub Pages under any repo path.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@deck.gl") || id.includes("@luma.gl") || id.includes("@math.gl")) return "deck";
          if (id.includes("sigma") || id.includes("graphology")) return "graph";
          if (id.includes("@observablehq/plot") || id.includes("/d3")) return "charts";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
