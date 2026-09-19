import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        manualChunks: (id) => id.includes("node_modules/phaser/") ? "phaser" : undefined,
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
