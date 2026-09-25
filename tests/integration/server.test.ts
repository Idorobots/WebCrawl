// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWebCrawlServer } from "../../src/server/app";
import { loadServerConfig, type ServerConfig } from "../../src/server/config";
import type { RequestRemote } from "../../src/server/remote-fetch";

let directory: string;
const servers: ReturnType<typeof createWebCrawlServer>[] = [];

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "webcrawl-test-"));
  await fs.mkdir(path.join(directory, "assets"));
  await fs.writeFile(path.join(directory, "index.html"), "<!doctype html><html><head><title>WebCrawl</title></head></html>");
  await fs.copyFile(path.resolve("public/test-level.html"), path.join(directory, "test-level.html"));
  await fs.writeFile(path.join(directory, "assets", "app.js"), "export {};\n");
  await fs.writeFile(path.join(directory, "assets", "sprite.png"), Buffer.from([137, 80, 78, 71]));
  await fs.mkdir(path.join(directory, "sounds", "ui", "welcome"), { recursive: true });
  await fs.writeFile(path.join(directory, "sounds", "ui", "welcome", "ambient.mp3"), Buffer.from("ID3"));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await fs.rm(directory, { recursive: true, force: true });
});

async function start(request?: RequestRemote, debug = false): Promise<string> {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    clientDirectory: directory,
    debug,
    maxResponseBytes: 5 * 1024 * 1024,
    requestTimeoutMs: 12_000,
    maxRedirects: 5,
  };
  const server = createWebCrawlServer(config, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("WebCrawl server", () => {
  it("serves the built application and module assets", async () => {
    const baseUrl = await start();
    const index = await fetch(baseUrl);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const script = await fetch(`${baseUrl}/assets/app.js`);
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const sprite = await fetch(`${baseUrl}/assets/sprite.png`);
    expect(sprite.status).toBe(200);
    expect(sprite.headers.get("content-type")).toBe("image/png");
  });

  it("serves sound assets with the audio mime type", async () => {
    const baseUrl = await start();
    const sound = await fetch(`${baseUrl}/sounds/ui/welcome/ambient.mp3`);
    expect(sound.status).toBe(200);
    expect(sound.headers.get("content-type")).toBe("audio/mpeg");
  });

  it("serves the three-room test level at its public URL", async () => {
    const baseUrl = await start();
    const level = await fetch(`${baseUrl}/test-level.html?path=left`);
    expect(level.status).toBe(200);
    expect(level.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await level.text()).toContain('href="?path=right"');
    expect((await fetch(`${baseUrl}/another-level.html`)).status).toBe(404);
  });

  it("injects server debug mode into the client runtime config", async () => {
    const normalHtml = await (await fetch(await start())).text();
    expect(normalHtml).toContain('window.__WEBCRAWL_RUNTIME_CONFIG__={"debug":false}');

    const debugHtml = await (await fetch(await start(undefined, true))).text();
    expect(debugHtml).toContain('window.__WEBCRAWL_RUNTIME_CONFIG__={"debug":true}');
    expect(loadServerConfig({ DEBUG: "true" })).toMatchObject({ debug: true });
    expect(loadServerConfig({ DEBUG: "false" })).toMatchObject({ debug: false });
  });

  it("returns remote HTML and its final redirect URL through the API", async () => {
    const request: RequestRemote = async (url) => url.pathname === "/start"
      ? {
          statusCode: 302,
          headers: { location: "/article" },
          body: Buffer.alloc(0),
        }
      : {
          statusCode: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.from("<body>remote</body>"),
        };
    const baseUrl = await start(request);
    const response = await fetch(`${baseUrl}/api/fetch?url=${encodeURIComponent("https://example.com/start")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-webcrawl-final-url")).toBe("https://example.com/article");
    expect(await response.text()).toBe("<body>remote</body>");
  });

  it("retains API validation and not-found responses", async () => {
    const baseUrl = await start();
    expect((await fetch(`${baseUrl}/api/fetch`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/missing`)).status).toBe(404);
    const blocked = await fetch(`${baseUrl}/api/fetch?url=${encodeURIComponent("http://127.0.0.1")}`);
    expect(blocked.status).toBe(502);
    expect(await blocked.json()).toEqual({ error: "Private/internal network addresses are not allowed." });
  });
});
