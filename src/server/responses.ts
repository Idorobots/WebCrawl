import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  response.end(body);
}

export function serveAsset(requestPath: string, response: ServerResponse, clientDirectory: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    sendJson(response, 400, { error: "Invalid asset path." });
    return;
  }
  const relative = decoded.replace(/^\/+/, "");
  const assetPath = path.resolve(clientDirectory, relative);
  if (!assetPath.startsWith(`${path.resolve(clientDirectory)}${path.sep}`)) {
    sendJson(response, 403, { error: "Invalid asset path." });
    return;
  }
  fs.readFile(assetPath, (error, body) => {
    if (error) {
      sendJson(response, 404, { error: "Asset not found." });
      return;
    }
    const contentType = ({
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".map": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".mp3": "audio/mpeg",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    } as Record<string, string>)[path.extname(assetPath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": body.length,
      "Cache-Control": "public, max-age=3600",
    });
    response.end(body);
  });
}

export function serveIndex(response: ServerResponse, clientDirectory: string, debug: boolean): void {
  fs.readFile(path.join(clientDirectory, "index.html"), (error, body) => {
    if (error) {
      sendJson(response, 500, { error: "Could not read index.html." });
      return;
    }
    const runtimeConfig = `<script>window.__WEBCRAWL_RUNTIME_CONFIG__=${JSON.stringify({ debug })};</script>`;
    const html = body.toString("utf8");
    const rendered = Buffer.from(html.includes("</head>")
      ? html.replace("</head>", `${runtimeConfig}</head>`)
      : `${runtimeConfig}${html}`);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": rendered.length,
      "Cache-Control": "no-cache",
    });
    response.end(rendered);
  });
}
