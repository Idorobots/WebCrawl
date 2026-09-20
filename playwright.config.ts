import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// CI has no /usr/bin/chromium; fall back to the Playwright-managed browser
// installed by `playwright install chromium`. CHROMIUM_PATH still wins.
const localChromium = "/usr/bin/chromium";
const executablePath = process.env.CHROMIUM_PATH
  ?? (existsSync(localChromium) ? localChromium : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: {
      executablePath,
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "VITE_MAX_LIGHTS=4 VITE_LOADING_SCREEN=off npm run build && node dist/server/index.js",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
  },
});
