import http, { type Server } from "node:http";
import type { ServerConfig } from "./config.js";
import { createRequestHandler } from "./request-handler.js";
import type { RemoteFetchDependencies } from "./remote-fetch.js";

export function createWebCrawlServer(
  config: ServerConfig,
  dependencies: RemoteFetchDependencies = {},
): Server {
  return http.createServer(createRequestHandler(config, dependencies));
}
