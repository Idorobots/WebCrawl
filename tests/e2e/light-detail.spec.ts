import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { LIGHT_DETAIL_STORAGE_KEY } from "../../src/client/render/light-detail";

test.setTimeout(90_000);

test("lighting settings on the login screen persist and apply to the game", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Settings", exact: true });
  const dialog = page.getByRole("dialog", { name: "Settings" });
  const select = page.getByLabel("Light detail");
  await expect(dialog).toBeHidden();
  const cog = await button.boundingBox();
  const viewport = page.viewportSize();
  expect(cog).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(cog!.x).toBeGreaterThan(viewport!.width - 80);
  expect(cog!.y).toBeGreaterThan(viewport!.height - 80);
  await button.click();
  await expect(dialog).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(select).toHaveValue("low"); // Browser tests use VITE_MAX_LIGHTS=4.
  await select.selectOption("high");
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), LIGHT_DETAIL_STORAGE_KEY)).toBe("high");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Light detail")).toHaveValue("high");
  await expect(page.locator("#loginLayout")).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();

  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  await page.route("**/api/fetch?**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: fixture,
  }));
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeHidden();
  await page.locator("#welcomeUrlInput").fill("https://example.com/start");
  await page.getByRole("button", { name: "Go" }).click();
  const host = page.locator("#gameCanvas");
  await expect(host).toHaveAttribute("data-rooms", "6", { timeout: 30_000 });
  await expect(host).toHaveAttribute("data-light-detail", "high");
  await expect(host).toHaveAttribute("data-aura-mode", "light2d");
  const fps = page.locator("#debugFps");
  if (process.env.VITE_DEBUG === "true") {
    await expect(fps).toBeVisible();
    await expect(fps).toHaveText(/^[1-9]\d* FPS\s+Tick:/, { timeout: 10_000 });
  } else {
    await expect(fps).toBeHidden();
  }
});
