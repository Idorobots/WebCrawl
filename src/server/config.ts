import path from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  clientDirectory: string;
  debug: boolean;
  maxResponseBytes: number;
  requestTimeoutMs: number;
  maxRedirects: number;
}

export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: environment.HOST || "127.0.0.1",
    port: Number(environment.PORT || 3000),
    clientDirectory: environment.CLIENT_DIR || path.resolve(process.cwd(), "dist/client"),
    debug: environment.DEBUG === "true",
    maxResponseBytes: 5 * 1024 * 1024,
    requestTimeoutMs: 12_000,
    maxRedirects: 5,
  };
}
