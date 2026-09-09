export function normalizeUrl(raw: string): string {
  let value = raw.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  return new URL(value).href;
}

export async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, {
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) {
    let message = `Fetch failed (${response.status})`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based fallback for malformed error responses.
    }
    throw new Error(message);
  }
  return response.text();
}
