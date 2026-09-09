import dns from "node:dns/promises";
import net from "node:net";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type LookupAddresses = (hostname: string) => Promise<ResolvedAddress[]>;

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [first = 0, second = 0] = parts;
  return first === 0 || first === 10 || first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) || first >= 224;
}

export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fc") || normalized.startsWith("fd") ||
    normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb");
}

export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  return family === 4 ? isPrivateIPv4(ip) : family === 6 ? isPrivateIPv6(ip) : true;
}

const defaultLookup: LookupAddresses = async (hostname) =>
  dns.lookup(hostname, { all: true, verbatim: true });

export async function assertSafeTarget(url: URL, lookup: LookupAddresses = defaultLookup): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing embedded credentials are not allowed.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Local/internal hostnames are not allowed.");
  }
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Private/internal network addresses are not allowed.");
    }
    return;
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new Error("Could not resolve the target hostname.");
  }
  if (!addresses.length) throw new Error("Could not resolve the target hostname.");
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Target resolves to a private/internal network address.");
  }
}
