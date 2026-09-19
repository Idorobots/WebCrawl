import {
  FETCH_MAX_BYTES,
  FETCH_TIMEOUT_MS,
  type PublicFetchProxy,
  PUBLIC_FETCH_PROXIES,
} from "../config";

const HTML_ACCEPT = "text/html,application/xhtml+xml";
const MAX_BYTES_LABEL = `${FETCH_MAX_BYTES / 1024 / 1024} MB`;

export type FetchRoute = "direct" | "server" | "proxy";

export interface FetchOutcome {
  html: string;
  url: string;
  via: FetchRoute;
}

interface FetchedHtml {
  html: string;
  url: string;
}

export function normalizeUrl(raw: string): string {
  let value = raw.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  return new URL(value).href;
}

export async function fetchHtml(url: string): Promise<FetchOutcome> {
  const failures: string[] = [];
  const record = (label: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${label}: ${message}`);
  };

  const direct = await tryRoute(() => fetchDirect(url), "direct browser fetch", record);
  if (direct) return { ...direct, via: "direct" };

  const server = await tryRoute(() => fetchViaServer(url), "local relay server", record);
  if (server) return { ...server, via: "server" };

  const proxy = await fetchViaProxies(url, record);
  if (proxy) return { ...proxy, via: "proxy" };

  throw new Error(
    "The page could not be fetched from any route. " +
    failures.join(" · ") +
    " The site may block cross-origin requests (CORS), and the relay server and public fetch services could not retrieve the page."
  );
}

function proxyList(): readonly PublicFetchProxy[] {
  const config = (window as Window & {
    __WEBCRAWL_RUNTIME_CONFIG__?: { fetchProxies?: unknown };
  }).__WEBCRAWL_RUNTIME_CONFIG__;
  const value = config?.fetchProxies;
  if (!Array.isArray(value)) return PUBLIC_FETCH_PROXIES;
  const proxies = value.filter((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const proxy = entry as Partial<PublicFetchProxy>;
    return (
      typeof proxy.name === "string" &&
      typeof proxy.url === "string" &&
      proxy.url.includes("{url}") &&
      (proxy.parse === undefined || proxy.parse === "raw" || proxy.parse === "json")
    );
  });
  return proxies.length > 0 ? (proxies as PublicFetchProxy[]) : PUBLIC_FETCH_PROXIES;
}

async function tryRoute<T>(
  run: () => Promise<T>,
  label: string,
  record: (label: string, error: unknown) => void,
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    record(label, error);
    return null;
  }
}

async function fetchViaProxies(
  url: string,
  record: (label: string, error: unknown) => void,
): Promise<FetchedHtml | null> {
  for (const proxy of proxyList()) {
    const html = await tryRoute(
      () => fetchViaProxy(proxy, url),
      `public proxy "${proxy.name}"`,
      record,
    );
    if (html) return html;
  }
  return null;
}

function fetchDirect(url: string): Promise<FetchedHtml> {
  return withAttempt(async (controller) => {
    const response = await fetch(url, {
      mode: "cors",
      headers: { Accept: HTML_ACCEPT },
      signal: controller.signal,
    });
    assertHttpOk(response, "Remote server");
    assertHtmlContentType(response.headers.get("content-type"));
    return { html: await readBodyChecked(response, controller), url: response.url || url };
  });
}

function fetchViaServer(url: string): Promise<FetchedHtml> {
  return withAttempt(async (controller) => {
    const response = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, {
      headers: { Accept: HTML_ACCEPT },
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `Relay server answered HTTP ${response.status}.`;
      try {
        const body = await response.json() as { error?: string };
        if (typeof body.error === "string") message = body.error;
      } catch {
        // Keep the status-based fallback for malformed error responses.
      }
      throw new Error(message);
    }
    return {
      html: await readBodyChecked(response, controller),
      url: response.headers.get("X-WebCrawl-Final-Url") || url,
    };
  });
}

function fetchViaProxy(proxy: PublicFetchProxy, url: string): Promise<FetchedHtml> {
  const target = proxy.url.replace("{url}", encodeURIComponent(url));
  return withAttempt(async (controller) => {
    const response = await fetch(target, {
      headers: { Accept: HTML_ACCEPT },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Proxy answered HTTP ${response.status}.`);
    if (proxy.parse === "json") return { html: await readJsonEnvelope(response, controller), url };
    assertHtmlContentType(response.headers.get("content-type"));
    return { html: await readBodyChecked(response, controller), url };
  });
}

async function readJsonEnvelope(
  response: Response,
  controller: AbortController,
): Promise<string> {
  const text = await readBodyChecked(response, controller);
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error("Proxy returned an unreadable envelope.");
  }
  const parsed = envelope as {
    status?: unknown;
    headers?: Record<string, string | null>;
    body?: unknown;
  };
  if (typeof parsed.status === "number" && (parsed.status < 200 || parsed.status >= 300)) {
    throw new Error(`Target returned HTTP ${parsed.status}.`);
  }
  if (parsed.headers) {
    const raw = parsed.headers["content-type"] ?? parsed.headers["Content-Type"];
    assertHtmlContentType(raw ? String(raw) : null);
  }
  if (typeof parsed.body !== "string") {
    throw new Error("Proxy returned an unreadable envelope.");
  }
  return parsed.body;
}

async function readBodyChecked(
  response: Response,
  controller: AbortController,
): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > FETCH_MAX_BYTES) {
    controller.abort();
    throw new Error(`Response exceeded the ${MAX_BYTES_LABEL} limit.`);
  }
  if (!response.body) return response.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let sniffedBinary = false;
  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > FETCH_MAX_BYTES) {
      controller.abort();
      throw new Error(`Response exceeded the ${MAX_BYTES_LABEL} limit.`);
    }
    if (!sniffedBinary && value.includes(0)) {
      controller.abort();
      throw new Error("Target returned binary data rather than HTML.");
    }
    sniffedBinary = true;
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return await new Blob([combined]).text();
}

function assertHttpOk(response: Response, label: string): void {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
}

function assertHtmlContentType(contentType: string | null): void {
  if (!contentType) return;
  const value = contentType.toLowerCase();
  if (!value.includes("text/html") && !value.includes("application/xhtml+xml")) {
    throw new Error(`Target did not return HTML (${value.split(";")[0]}).`);
  }
}

function withAttempt<T>(run: (controller: AbortController) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return run(controller).finally(() => clearTimeout(timer));
}
