import http from "node:http";
import https from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { ServerConfig } from "./config.js";
import { assertSafeTarget, type LookupAddresses } from "./target-policy.js";

export interface RemoteResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export type RequestRemote = (url: URL) => Promise<RemoteResponse>;

export function createRemoteRequester(config: ServerConfig): RequestRemote {
  return (url) => new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = client.request(url, {
      method: "GET",
      headers: {
        "User-Agent": "HTML-Dungeon-Mapper/1.0 (+local development tool)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "Accept-Encoding": "identity",
        Connection: "close",
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > config.maxResponseBytes) {
          fail(new Error(`Response exceeded ${config.maxResponseBytes / 1024 / 1024} MB limit.`));
          response.destroy();
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", fail);
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.setTimeout(config.requestTimeoutMs, () => {
      fail(new Error("Remote request timed out."));
      request.destroy();
    });
    request.on("error", fail);
    request.end();
  });
}

export interface RemoteFetchDependencies {
  lookup?: LookupAddresses;
  request?: RequestRemote;
}

export async function fetchRemoteHtml(
  startUrl: string,
  config: ServerConfig,
  dependencies: RemoteFetchDependencies = {},
): Promise<Buffer> {
  const request = dependencies.request ?? createRemoteRequester(config);
  let current = new URL(startUrl);
  for (let redirects = 0; redirects <= config.maxRedirects; redirects += 1) {
    await assertSafeTarget(current, dependencies.lookup);
    const response = await request(current);
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      if (!location) throw new Error("Remote server returned a redirect without a Location header.");
      if (redirects === config.maxRedirects) throw new Error("Too many redirects.");
      current = new URL(location, current);
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Remote server returned HTTP ${response.statusCode}.`);
    }
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    if (contentType && !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml")) {
      throw new Error(`Target did not return HTML (${contentType.split(";")[0]}).`);
    }
    return response.body;
  }
  throw new Error("Too many redirects.");
}
