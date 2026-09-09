# WebCrawl

WebCrawl turns a remote page's HTML structure into a deterministic sci-fi dungeon. Explore rooms generated from DOM elements, follow links to descend through floors, collect loot, and fight robots.

## Requirements

- Node.js 22.13 or newer
- npm

## Development

Install dependencies and start the API server and Vite development server:

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` requests to the backend on port 3000.

Optional backend environment variables:

```bash
PORT=8080 HOST=0.0.0.0 npm run dev
```

If `PORT` is changed in development, update the proxy target in `vite.config.ts` as well.

## Production

Compile the browser application and Node server, then start the compiled server:

```bash
npm run build
npm start
```

Open `http://127.0.0.1:3000`. Production output is written to `dist/client` and `dist/server`.

The production server accepts these optional environment variables:

- `PORT`: listening port, default `3000`
- `HOST`: listening address, default `127.0.0.1`
- `CLIENT_DIR`: browser build directory, default `dist/client`

## Quality Checks

```bash
npm run typecheck
npm test
npm run build
```

Run all three with `npm run check`.

The browser smoke test uses Playwright to drive the system Chromium installation:

```bash
npm run test:e2e
```

The devcontainer installs Chromium at `/usr/bin/chromium`. Set `CHROMIUM_PATH` when Chromium is installed elsewhere:

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

## Controls

- Arrow keys: move and face the player
- Space: fire the pulse rifle
- Escape: close the tactical map if it is open
- Walk onto a down portal: visit that room's link
- Walk onto the root room's up portal: return to the previous page

## Architecture

The browser application is composed from typed modules under `src/client`:

- `api`: communication with the same-origin fetch endpoint
- `domain`: deterministic graph generation, layout, content generation, geometry, and pathfinding
- `storage`: browser persistence adapters
- `app.ts`: game state, rendering orchestration, input, and the animation loop
- `main.ts`: browser composition entry point

The backend is under `src/server`:

- `target-policy.ts`: URL, DNS, and private-network validation
- `remote-fetch.ts`: bounded HTTP fetching and redirect handling
- `request-handler.ts`: API and static-file routing
- `app.ts`: injectable HTTP server factory
- `index.ts`: production process entry point

Shared game entities are modeled in `src/client/types.ts`, while gameplay constants and asset manifests live in `src/client/config.ts`.

## Remote Fetching

The backend fetches remote HTML to avoid browser CORS restrictions. It rejects embedded credentials, localhost and internal hostnames, and private-network addresses. Redirect targets are validated independently. Responses are limited to 5 MB, requests time out after 12 seconds, and at most five redirects are followed.

Some sites block automated requests, require authentication, or only create useful DOM content after running JavaScript. WebCrawl currently maps the server-returned HTML and does not run remote scripts.
