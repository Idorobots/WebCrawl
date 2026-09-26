import { expect, test } from "@playwright/test";

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
  await expect(game).toHaveAttribute("data-rooms", /\d+/, { timeout: 30_000 });
  expect(Number(await game.getAttribute("data-rooms"))).toBeGreaterThan(30);
  await expect(page.getByText("SIGNAL LOST – PAGE UNREACHABLE")).toHaveCount(0);
  const backgrounds = await page.evaluate(() => {
    const scene = (window as Window & { __webcrawlScene?: {
      children: { list: Array<{ type: string; depth: number; width: number; height: number }> };
    } }).__webcrawlScene;
    return scene?.children.list.filter(item => item.type === "TileSprite" && item.depth === -10)
      .map(item => ({ width: item.width, height: item.height })) ?? [];
  });
  expect(backgrounds).toHaveLength(1);
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
});
