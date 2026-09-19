import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { ServerConfig } from "./config.js";
import { fetchRemotePage, type RemoteFetchDependencies } from "./remote-fetch.js";
import { sendJson, serveAsset, serveIndex } from "./responses.js";

function requestUrl(request: IncomingMessage): URL | null {
  try {
    return new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
  } catch {
    return null;
  }
}

async function handleFetch(
  url: URL,
  response: ServerResponse,
  config: ServerConfig,
  dependencies: RemoteFetchDependencies,
): Promise<void> {
  const target = url.searchParams.get("url");
  if (!target) {
    sendJson(response, 400, { error: "Missing ?url= parameter." });
    return;
  }
  try {
    const parsed = new URL(target);
    const page = await fetchRemotePage(parsed.href, config, dependencies);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": page.html.length,
      "Cache-Control": "no-store",
      "X-WebCrawl-Final-Url": page.url,
    });
    response.end(page.html);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Could not fetch remote page.",
    });
  }
}

export function createRequestHandler(
  config: ServerConfig,
  dependencies: RemoteFetchDependencies = {},
): RequestListener {
  return (request, response) => {
    const url = requestUrl(request);
    if (!url) {
      sendJson(response, 400, { error: "Invalid request URL." });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/fetch") {
      void handleFetch(url, response, config, dependencies);
    } else if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      serveIndex(response, config.clientDirectory, config.debug);
    } else if (
      request.method === "GET" &&
      (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/"))
    ) {
      serveAsset(url.pathname, response, config.clientDirectory);
    } else {
      sendJson(response, 404, { error: "Not found." });
    }
  };
}
