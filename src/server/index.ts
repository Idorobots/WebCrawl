#!/usr/bin/env node
import { createWebCrawlServer } from "./app.js";
import { loadServerConfig } from "./config.js";

const config = loadServerConfig();
const server = createWebCrawlServer(config);

server.listen(config.port, config.host, () => {
  console.log(`WebCrawl running at http://${config.host}:${config.port}`);
  console.log("Press Ctrl+C to stop.");
});
