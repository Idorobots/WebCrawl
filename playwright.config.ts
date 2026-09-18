import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "VITE_MAX_LIGHTS=4 VITE_LOADING_SCREEN=off npm run build && node dist/server/index.js",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
  },
});
