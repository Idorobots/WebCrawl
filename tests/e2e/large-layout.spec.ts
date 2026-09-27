import { expect, test } from "@playwright/test";
import { backgroundAssetForUrl } from "../../src/client/domain/background";
import { signageFontForUrl, SIGNAGE_FONTS, stationAmbientForUrl, STATION_AMBIENT_TRACKS } from "../../src/client/domain/level-style";

test("renders a dense level without allocating a level-sized background canvas", async ({ page }) => {
  test.setTimeout(90_000);
  const html = `<body><nav><ul>${Array.from({ length: 12 }, (_, index) =>
    `<li><a href="/nav-${index}">Navigation ${index}</a></li>`
  ).join("")}</ul></nav><main>${Array.from({ length: 20 }, (_, index) =>
    `<article id="entry-${index}"><h1>Article ${index}</h1><p>First paragraph.</p><p>Second paragraph.</p></article>`
  ).join("")}</main></body>`;
  await page.route("**/api/fetch?**", route => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.route("https://example.com/**", route => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto("/");
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.locator("#welcomeUrlInput").fill("https://example.com/dense");
  await page.getByRole("button", { name: "Go" }).click();

  const game = page.locator("#gameCanvas");
  const playingStationTracks = () => page.evaluate(() => {
    const scene = (window as Window & { __webcrawlScene?: {
      sound: { sounds: Array<{ key: string; isPlaying: boolean }> };
    } }).__webcrawlScene;
    return scene?.sound.sounds.filter(sound => sound.isPlaying && sound.key.startsWith("sounds/ambient/station/"))
      .map(sound => sound.key) ?? [];
  });
  await expect(game).toHaveAttribute("data-rooms", /\d+/, { timeout: 30_000 });
  await expect(game).toHaveAttribute("data-signage-font", signageFontForUrl("https://example.com/dense"));
  await expect(game).toHaveAttribute("data-station-ambient", stationAmbientForUrl("https://example.com/dense"));
  await expect.poll(playingStationTracks).toEqual([stationAmbientForUrl("https://example.com/dense")]);
  expect(await page.evaluate(font => document.fonts.check(`900 48px "${font}"`), signageFontForUrl("https://example.com/dense"))).toBe(true);
  const availableFonts = await page.evaluate(async fonts =>
    Promise.all(fonts.map(async font => (await document.fonts.load(`900 48px "${font}"`)).length)), [...SIGNAGE_FONTS]);
  expect(availableFonts.every(count => count > 0)).toBe(true);
  const cachedTracks = await page.evaluate(tracks => {
    const scene = (window as Window & { __webcrawlScene?: { cache: { audio: { exists: (key: string) => boolean } } } }).__webcrawlScene;
    return tracks.map(track => scene?.cache.audio.exists(track) ?? false);
  }, [...STATION_AMBIENT_TRACKS]);
  expect(cachedTracks).toEqual(STATION_AMBIENT_TRACKS.map(() => true));
  expect(Number(await game.getAttribute("data-rooms"))).toBeGreaterThan(30);
  await expect(page.getByText("SIGNAL LOST – PAGE UNREACHABLE")).toHaveCount(0);
  const backgrounds = await page.evaluate(() => {
    const scene = (window as Window & { __webcrawlScene?: {
      children: { list: Array<{ type: string; depth: number; width: number; height: number; displayTexture: { key: string } }> };
    } }).__webcrawlScene;
    return scene?.children.list.filter(item => item.type === "TileSprite" && item.depth === -10)
      .map(item => ({ width: item.width, height: item.height, texture: item.displayTexture.key })) ?? [];
  });
  expect(backgrounds).toHaveLength(1);
  expect(backgrounds[0]!.texture).toBe(`asset:${backgroundAssetForUrl("https://example.com/dense")}`);
  expect(backgrounds[0]!.width).toBeLessThan(5_000);
  expect(backgrounds[0]!.height).toBeLessThan(5_000);

  const shifted = await page.evaluate(async () => {
    const scene = (window as Window & { __webcrawlScene?: {
      cameras: { main: { stopFollow: () => { centerOn: (x: number, y: number) => void }; worldView: { x: number; y: number; width: number; height: number } } };
      children: { list: Array<{ type: string; depth: number; x: number; y: number; width: number; height: number }> };
    } }).__webcrawlScene!;
    scene.cameras.main.stopFollow().centerOn(25_000, 25_000);
    await new Promise(resolve => setTimeout(resolve, 150));
    const background = scene.children.list.find(item => item.type === "TileSprite" && item.depth === -10)!;
    const view = scene.cameras.main.worldView;
    return {
      background: { x: background.x, y: background.y, width: background.width, height: background.height },
      view: { x: view.x, y: view.y, width: view.width, height: view.height },
    };
  });
  expect(shifted.background.x).toBeGreaterThan(20_000);
  expect(shifted.background.x).toBeLessThan(shifted.view.x);
  expect(shifted.background.y).toBeLessThan(shifted.view.y);
  expect(shifted.background.x + shifted.background.width).toBeGreaterThan(shifted.view.x + shifted.view.width);
  expect(shifted.background.y + shifted.background.height).toBeGreaterThan(shifted.view.y + shifted.view.height);

  const otherUrl = "https://example.com/space";
  const backgroundTexture = () => page.evaluate(() => {
    const scene = (window as Window & { __webcrawlScene?: {
      children: { list: Array<{ type: string; depth: number; displayTexture: { key: string } }> };
    } }).__webcrawlScene;
    return scene?.children.list.find(item => item.type === "TileSprite" && item.depth === -10)?.displayTexture.key;
  });
  expect(backgroundAssetForUrl(otherUrl)).not.toBe(backgroundAssetForUrl("https://example.com/dense"));
  await page.evaluate(async url => {
    await (window as Window & { __webcrawlTest?: { navigate: (url: string) => Promise<void> } }).__webcrawlTest?.navigate(url);
  }, otherUrl);
  await expect.poll(backgroundTexture).toBe(`asset:${backgroundAssetForUrl(otherUrl)}`);
  await expect(game).toHaveAttribute("data-signage-font", signageFontForUrl(otherUrl));
  await expect(game).toHaveAttribute("data-station-ambient", stationAmbientForUrl(otherUrl));
  await expect.poll(playingStationTracks).toEqual([stationAmbientForUrl(otherUrl)]);
  expect(await page.evaluate(font => document.fonts.check(`900 48px "${font}"`), signageFontForUrl(otherUrl))).toBe(true);
  await page.evaluate(async () => {
    await (window as Window & { __webcrawlTest?: { goBack: () => Promise<void> } }).__webcrawlTest?.goBack();
  });
  await expect.poll(backgroundTexture).toBe(`asset:${backgroundAssetForUrl("https://example.com/dense")}`);
  await expect(game).toHaveAttribute("data-signage-font", signageFontForUrl("https://example.com/dense"));
  await expect(game).toHaveAttribute("data-station-ambient", stationAmbientForUrl("https://example.com/dense"));
  await expect.poll(playingStationTracks).toEqual([stationAmbientForUrl("https://example.com/dense")]);
});
