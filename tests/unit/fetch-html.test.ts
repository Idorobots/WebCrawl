import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchHtml } from "../../src/client/api/fetch-html";
import { FETCH_MAX_BYTES } from "../../src/client/config";

interface MockResponseOptions {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  json?: unknown;
  url?: string;
}

interface MockResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  body: null;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

function mockResponse(options: MockResponseOptions = {}): MockResponse {
  const status = options.status ?? 200;
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    url: options.url ?? "",
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    body: null,
    text: async () => options.body ?? (options.json === undefined ? "" : JSON.stringify(options.json)),
    json: async () => {
      if (options.json === undefined) throw new Error("Response was not JSON.");
      return options.json;
    },
  };
}

const htmlResponse = (body = "<body>ok</body>"): MockResponse =>
  mockResponse({ headers: { "content-type": "text/html" }, body });

const envelopeResponse = (body = "<body>proxied</body>", status = 200): MockResponse =>
  mockResponse({
    headers: { "content-type": "application/json" },
    json: { status, headers: { "content-type": "text/html" }, body },
  });

const corsBlocked = async (): Promise<MockResponse> => {
  throw new TypeError("Failed to fetch");
};

type FetchHandler = (input: string, init: RequestInit | undefined) => Promise<MockResponse>;

let requests: Array<{ input: string; init: RequestInit | undefined }> = [];
let handlers: FetchHandler[] = [];

beforeEach(() => {
  requests = [];
  handlers = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input.toString();
    requests.push({ input: target, init });
    const handler = handlers.shift();
    if (!handler) throw new TypeError("Failed to fetch");
    return await handler(target, init);
  }) as typeof fetch;
});

afterEach(() => {
  delete (window as Window & { __WEBCRAWL_RUNTIME_CONFIG__?: unknown }).__WEBCRAWL_RUNTIME_CONFIG__;
});

describe("fetchHtml", () => {
  it("loads a page directly when the site allows CORS", async () => {
    handlers = [async () => htmlResponse("<body>direct</body>")];
    const outcome = await fetchHtml("https://example.com");
    expect(outcome).toEqual({ html: "<body>direct</body>", url: "https://example.com", via: "direct" });
    expect(requests.map((request) => request.input)).toEqual(["https://example.com"]);
  });

  it("falls back to the relay server when the direct fetch is CORS-blocked", async () => {
    handlers = [corsBlocked, async () => htmlResponse("<body>server</body>")];
    const outcome = await fetchHtml("https://example.com/start");
    expect(outcome).toEqual({ html: "<body>server</body>", url: "https://example.com/start", via: "server" });
    expect(requests[1]!.input).toContain("/api/fetch?url=");
    expect(requests[1]!.input).toContain("https%3A%2F%2Fexample.com%2Fstart");
  });

  it("uses the relay's final redirect URL", async () => {
    handlers = [
      corsBlocked,
      async () => mockResponse({
        headers: {
          "content-type": "text/html",
          "x-webcrawl-final-url": "https://example.com/article",
        },
        body: "<body>server</body>",
      }),
    ];
    const outcome = await fetchHtml("https://example.com/start");
    expect(outcome).toEqual({ html: "<body>server</body>", url: "https://example.com/article", via: "server" });
  });

  it("falls through a failed relay server to a public proxy envelope", async () => {
    handlers = [
      corsBlocked,
      async () => mockResponse({
        status: 502,
        headers: { "content-type": "application/json" },
        json: { error: "Remote server returned HTTP 500." },
      }),
      async () => envelopeResponse("<body>proxied</body>"),
    ];
    const outcome = await fetchHtml("https://example.com");
    expect(outcome).toEqual({ html: "<body>proxied</body>", url: "https://example.com", via: "proxy" });
    expect(requests[2]!.input).toBe("https://cors.io/?url=https%3A%2F%2Fexample.com");
  });

  it("reports every route when all of them fail", async () => {
    handlers = [corsBlocked, corsBlocked, corsBlocked];
    const error = await fetchHtml("https://example.com").catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("direct browser fetch");
    expect((error as Error).message).toContain("local relay server");
    expect((error as Error).message).toContain("cors.io");
  });

  it("treats non-HTML direct responses as a failed route", async () => {
    handlers = [
      async () => mockResponse({ headers: { "content-type": "application/json" }, body: "{}" }),
      async () => htmlResponse("<body>server</body>"),
    ];
    const outcome = await fetchHtml("https://example.com");
    expect(outcome).toEqual({ html: "<body>server</body>", url: "https://example.com", via: "server" });
  });

  it("treats non-2xx direct responses as a failed route", async () => {
    handlers = [
      async () => mockResponse({ status: 404, headers: { "content-type": "text/html" } }),
      async () => htmlResponse("<body>server</body>"),
    ];
    const outcome = await fetchHtml("https://example.com");
    expect(outcome.via).toBe("server");
  });

  it("falls through an oversized relay response to the public proxy", async () => {
    handlers = [
      corsBlocked,
      async () => mockResponse({
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": String(FETCH_MAX_BYTES + 1),
        },
        body: "<body>too big</body>",
      }),
      async () => envelopeResponse("<body>proxied</body>"),
    ];
    const outcome = await fetchHtml("https://example.com");
    expect(outcome).toEqual({ html: "<body>proxied</body>", url: "https://example.com", via: "proxy" });
  });

  it("honors a mirrored target status from the public proxy envelope", async () => {
    handlers = [corsBlocked, corsBlocked, async () => envelopeResponse("<body>gone</body>", 404)];
    const error = await fetchHtml("https://example.com").catch((value: unknown) => value);
    expect((error as Error).message).toContain("HTTP 404");
  });

  it("supports raw public proxies from the runtime config", async () => {
    (window as Window & {
      __WEBCRAWL_RUNTIME_CONFIG__?: { fetchProxies?: unknown };
    }).__WEBCRAWL_RUNTIME_CONFIG__ = {
      fetchProxies: [{ name: "rawtester", url: "https://raw.example/{url}" }],
    };
    handlers = [corsBlocked, corsBlocked, async () => htmlResponse("<body>raw</body>")];
    const outcome = await fetchHtml("https://example.com");
    expect(outcome).toEqual({ html: "<body>raw</body>", url: "https://example.com", via: "proxy" });
    expect(requests[2]!.input).toBe("https://raw.example/https%3A%2F%2Fexample.com");
  });

  it("ignores a malformed runtime proxy override", async () => {
    (window as Window & {
      __WEBCRAWL_RUNTIME_CONFIG__?: { fetchProxies?: unknown };
    }).__WEBCRAWL_RUNTIME_CONFIG__ = {
      fetchProxies: [{ name: "junk" }],
    };
    handlers = [corsBlocked, corsBlocked, async () => envelopeResponse("<body>defaults</body>")];
    const outcome = await fetchHtml("https://example.com");
    expect(outcome.via).toBe("proxy");
    expect(requests[2]!.input).toContain("cors.io");
  });

  it("passes an abortable signal with every attempt", async () => {
    handlers = [async (_input, init) => {
      const signal = init?.signal;
      expect(signal).toBeDefined();
      expect(signal).toHaveProperty("aborted");
      expect(signal).toHaveProperty("addEventListener");
      return htmlResponse("<body>direct</body>");
    }];
    await fetchHtml("https://example.com");
  });
});
