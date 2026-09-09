#!/usr/bin/env node
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_PATH = path.join(PUBLIC_DIR, "index.html");

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function isPrivateAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true;
}

async function assertSafeTarget(url) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http:// and https:// URLs are allowed.");
  }

  if (url.username || url.password) {
    throw new Error("URLs containing embedded credentials are not allowed.");
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Local/internal hostnames are not allowed.");
  }

  // If the hostname is already an IP literal, validate it directly.
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Private/internal network addresses are not allowed.");
    }
    return;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Could not resolve the target hostname.");
  }

  if (!addresses.length) {
    throw new Error("Could not resolve the target hostname.");
  }

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error("Target resolves to a private/internal network address.");
    }
  }
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;

    const req = client.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": "HTML-Dungeon-Mapper/1.0 (+local development tool)",
          "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Encoding": "identity",
          "Connection": "close"
        }
      },
      (res) => {
        const chunks = [];
        let total = 0;

        res.on("data", (chunk) => {
          total += chunk.length;

          if (total > MAX_RESPONSE_BYTES) {
            req.destroy(new Error(`Response exceeded ${MAX_RESPONSE_BYTES / 1024 / 1024} MB limit.`));
            return;
          }

          chunks.push(chunk);
        });

        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("Remote request timed out."));
    });

    req.on("error", reject);
    req.end();
  });
}

async function fetchRemoteHtml(startUrl) {
  let current = new URL(startUrl);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await assertSafeTarget(current);

    const response = await requestOnce(current);

    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      if (!location) throw new Error("Remote server returned a redirect without a Location header.");

      if (redirects === MAX_REDIRECTS) {
        throw new Error("Too many redirects.");
      }

      current = new URL(location, current);
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Remote server returned HTTP ${response.statusCode}.`);
    }

    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error(`Target did not return HTML (${contentType.split(";")[0]}).`);
    }

    return response.body;
  }

  throw new Error("Too many redirects.");
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function serveAsset(requestPath, res) {
  let decoded;

  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    sendJson(res, 400, { error: "Invalid asset path." });
    return;
  }

  const relative = decoded.replace(/^\/+/, "");
  const assetPath = path.resolve(PUBLIC_DIR, relative);

  if (!assetPath.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
    sendJson(res, 403, { error: "Invalid asset path." });
    return;
  }

  fs.readFile(assetPath, (err, body) => {
    if (err) {
      sendJson(res, 404, { error: "Asset not found." });
      return;
    }

    const ext = path.extname(assetPath).toLowerCase();
    const contentType = {
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp"
    }[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": body.length,
      "Cache-Control": "public, max-age=3600"
    });
    res.end(body);
  });
}

function serveIndex(res) {
  fs.readFile(INDEX_PATH, (err, body) => {
    if (err) {
      sendJson(res, 500, { error: "Could not read public/index.html." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": body.length,
      "Cache-Control": "no-cache"
    });
    res.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  let requestUrl;

  try {
    requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    sendJson(res, 400, { error: "Invalid request URL." });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/fetch") {
    const target = requestUrl.searchParams.get("url");
    if (!target) {
      sendJson(res, 400, { error: "Missing ?url= parameter." });
      return;
    }

    try {
      const parsed = new URL(target);
      const html = await fetchRemoteHtml(parsed.href);

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": html.length,
        "Cache-Control": "no-store"
      });
      res.end(html);
    } catch (err) {
      sendJson(res, 502, {
        error: err && err.message ? err.message : "Could not fetch remote page."
      });
    }

    return;
  }

  if (req.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
    serveIndex(res);
    return;
  }

  if (req.method === "GET" && requestUrl.pathname.startsWith("/assets/")) {
    serveAsset(requestUrl.pathname, res);
    return;
  }

  sendJson(res, 404, { error: "Not found." });
});

server.listen(PORT, HOST, () => {
  console.log(`HTML Dungeon Mapper running at http://${HOST}:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
