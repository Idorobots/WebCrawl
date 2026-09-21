import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 720 },
  hasTouch: true,
  isMobile: true,
});

test.setTimeout(90_000);

async function startMobileGame(page: Page): Promise<void> {
  const fixture = fs.readFileSync(path.resolve("tests/fixtures/page.html"), "utf8");
  await page.route("https://example.com/**", route => route.fulfill({
    status: 200,
    headers: { "access-control-allow-origin": "*" },
    contentType: "text/html",
    body: fixture,
  }));
  await page.route("**/api/fetch?**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: fixture,
  }));
  await page.goto("/");
  await expect(page.locator("#welcomeScreen")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.locator("#welcomeUrlInput").fill("https://example.com/start");
  await page.getByRole("button", { name: "Go" }).click();
  await expect(page.locator("#gameCanvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#gameCanvas")).toHaveAttribute("data-rooms", "6", { timeout: 30_000 });
}

test("centers the flashlight on the player before any input", async ({ page }) => {
  await startMobileGame(page);

  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-flashlight-active", "true");
  await expect.poll(async () => {
    const targetX = Number(await game.getAttribute("data-flashlight-target-x"));
    const playerX = Number(await game.getAttribute("data-player-x"));
    return Math.abs(targetX - playerX);
  }).toBeLessThanOrEqual(1);
});

test("auto-scrolls the prompt body to follow the typing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#welcomeScreen")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.locator("#promptLayout.open")).toBeVisible();

  await expect.poll(async () => page.evaluate(() => {
    const body = document.querySelector<HTMLElement>("#welcomePromptBody")!;
    return body.scrollHeight > body.clientHeight;
  }), { timeout: 10_000 }).toBe(true);

  await expect.poll(async () => page.evaluate(() => {
    const body = document.querySelector<HTMLElement>("#welcomePromptBody")!;
    return body.scrollTop;
  }), { timeout: 10_000 }).toBeGreaterThan(0);

  await expect.poll(async () => page.evaluate(() => {
    const body = document.querySelector<HTMLElement>("#welcomePromptBody")!;
    const caret = body.querySelector<HTMLElement>(".welcome-caret-float");
    if (!caret) return true;
    const caretRect = caret.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return caretRect.bottom <= bodyRect.bottom + 1 && caretRect.top >= bodyRect.top - 1;
  }), { timeout: 10_000 }).toBe(true);
});

test("does not fire when tapping the viewport but still drags the flashlight", async ({ page }) => {
  await startMobileGame(page);

  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-shots-fired", "0");

  const bounds = await page.locator("#gameViewport").boundingBox();
  if (!bounds) throw new Error("Game viewport unavailable");
  await page.touchscreen.tap(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.4);

  await expect(game).toHaveAttribute(
    "data-player-asset",
    /assets\/player\/(?:idle\/player_right\.png|walk\/(?:E|NE)\/walk_(?:E|NE)_\d{2}\.png)/,
  );

  await page.waitForTimeout(300);
  await expect(game).toHaveAttribute("data-shots-fired", "0");
});

test("places the url caret at the end when tapped on mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#welcomeScreen")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.locator("#welcomeUrlInput")).toBeVisible();

  await expect.poll(() => page.evaluate(() => document.fullscreenElement == null), { timeout: 5_000 })
    .toBe(true);

  await page.touchscreen.tap(195, 400);
  await page.waitForTimeout(400);

  const lineBox = await page.locator(".welcome-url-line").boundingBox();
  if (!lineBox) throw new Error("URL line unavailable");
  await page.touchscreen.tap(lineBox.x + lineBox.width - 20, lineBox.y + lineBox.height / 2);
  await page.waitForTimeout(200);

  const state = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#welcomeUrlInput");
    const caret = document.querySelector<HTMLElement>(".welcome-url-caret");
    if (!input || !caret) throw new Error("URL input or caret unavailable");
    return {
      focused: document.activeElement === input,
      selection: input.selectionStart,
      length: input.value.length,
      caretVisible: getComputedStyle(caret).visibility,
      inputWidth: Math.round(input.getBoundingClientRect().width),
      lineClientWidth: input.parentElement?.clientWidth ?? 0,
    };
  });
  expect(state.focused).toBe(true);
  expect(state.selection).toBe(state.length);
  expect(state.caretVisible).toBe("visible");
  expect(state.inputWidth).toBeGreaterThan(state.lineClientWidth * 0.5);

  await page.setViewportSize({ width: 390, height: 540 });
  await page.waitForTimeout(400);
  const keyboardState = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#welcomeUrlInput");
    if (!input) throw new Error("URL input unavailable");
    const rect = input.getBoundingClientRect();
    return {
      innerHeight: window.innerHeight,
      inputTop: Math.round(rect.top),
      inputBottom: Math.round(rect.bottom),
    };
  });
  expect(keyboardState.inputTop).toBeGreaterThanOrEqual(0);
  expect(keyboardState.inputBottom).toBeLessThanOrEqual(keyboardState.innerHeight);

  await page.keyboard.type("x");
  const after = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#welcomeUrlInput");
    if (!input) throw new Error("URL input unavailable");
    return { value: input.value, selection: input.selectionStart };
  });
  expect(after.value.endsWith("x")).toBe(true);
  expect(after.selection).toBe(after.value.length);
});

test("fires with the aim stick", async ({ page }) => {
  await startMobileGame(page);

  const game = page.locator("#gameCanvas");
  await expect(game).toHaveAttribute("data-shots-fired", "0");

  const cdp = await page.context().newCDPSession(page);
  const stick = await page.locator("#aimStick").boundingBox();
  if (!stick) throw new Error("Aim stick unavailable");
  const centerX = stick.x + stick.width / 2;
  const centerY = stick.y + stick.height / 2;

  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: centerX, y: centerY, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: centerX + 40, y: centerY, id: 1 }],
  });

  await expect.poll(async () => Number(await game.getAttribute("data-shots-fired")))
    .toBeGreaterThanOrEqual(1);

  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
});
