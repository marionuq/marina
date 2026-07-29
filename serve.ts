#!/usr/bin/env bun
/**
 * Static file server for the built site — what Railway (or any container host) runs.
 *
 * Railway injects PORT and expects the server on 0.0.0.0; binding to localhost
 * instead is what produces its "Application failed to respond" 502.
 */

import { resolve } from "node:path";

const ROOT = resolve("dist");
const port = Number(process.env.PORT ?? 3000);

// Bun's bundler fingerprints assets (index-kj7dxavh.css), so those can be cached
// forever. index.html must not be, or a deploy would not reach anyone.
const FINGERPRINTED = /-[a-z0-9]{8,}\.[a-z0-9]+$/i;

function cacheHeader(path: string) {
  return FINGERPRINTED.test(path)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(request) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    // resolve() collapses any ../ before we compare, so a crafted path cannot
    // escape dist/ and read arbitrary files off the container.
    const filePath = resolve(ROOT, `.${pathname}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}/`)) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file, { headers: { "Cache-Control": cacheHeader(filePath) } });
    }

    // Unknown path: hand back the page for a navigation, 404 for a missing asset.
    if (request.headers.get("accept")?.includes("text/html")) {
      const index = Bun.file(resolve(ROOT, "index.html"));
      if (await index.exists()) {
        return new Response(index, { status: 404, headers: { "Cache-Control": "no-cache" } });
      }
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Serving ./dist on http://${server.hostname}:${server.port}`);
