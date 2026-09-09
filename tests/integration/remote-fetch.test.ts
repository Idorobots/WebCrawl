// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../../src/server/config";
import { createRemoteRequester, fetchRemoteHtml } from "../../src/server/remote-fetch";

const servers: http.Server[] = [];
const config = (overrides: Partial<ServerConfig> = {}): ServerConfig => ({
  host: "127.0.0.1",
  port: 0,
  clientDirectory: "dist/client",
  maxResponseBytes: 32,
  requestTimeoutMs: 50,
  maxRedirects: 2,
  ...overrides,
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function upstream(handler: http.RequestListener): Promise<URL> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
}

describe("remote fetching", () => {
  it("validates every redirect and resolves relative locations", async () => {
    const requested: string[] = [];
    const body = await fetchRemoteHtml("https://example.com/start", config(), {
      lookup: async (hostname) => {
        expect(hostname).toBe("example.com");
        return [{ address: "93.184.216.34", family: 4 }];
      },
      request: async (url) => {
        requested.push(url.href);
        return requested.length === 1
          ? { statusCode: 302, headers: { location: "/next" }, body: Buffer.alloc(0) }
          : { statusCode: 200, headers: { "content-type": "text/html" }, body: Buffer.from("ok") };
      },
    });
    expect(requested).toEqual(["https://example.com/start", "https://example.com/next"]);
    expect(body.toString()).toBe("ok");
  });

  it("rejects oversized responses", async () => {
    const url = await upstream((_request, response) => response.end("x".repeat(64)));
    await expect(createRemoteRequester(config())(url)).rejects.toThrow("exceeded");
  });

  it("times out stalled responses", async () => {
    const url = await upstream(() => undefined);
    await expect(createRemoteRequester(config())(url)).rejects.toThrow("timed out");
  });

  it("rejects non-HTML content", async () => {
    await expect(fetchRemoteHtml("https://example.com", config(), {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      request: async () => ({
        statusCode: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: Buffer.from("{}"),
      }),
    })).rejects.toThrow("Target did not return HTML (application/json).");
  });
});
