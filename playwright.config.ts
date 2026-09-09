import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  webServer: {
    command: "npm run build && node dist/server/index.js",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
  },
});
