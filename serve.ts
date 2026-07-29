#!/usr/bin/env bun
/**
 * Static file server for the built site — what Railway (or any container host) runs.
 *
 * Railway injects PORT and expects the server on 0.0.0.0; binding to localhost
 * instead is what produces its "Application failed to respond" 502.
 */

import { resolve } from "node:path";
import { configFromEnv, fetchLatestMedia, type StoryMedia } from "./scripts/instagram.ts";

const ROOT = resolve("dist");
const port = Number(process.env.PORT ?? 3000);

/*
 * Live Instagram refresh.
 *
 * The built page has the last-committed reel baked in, which is all GitHub Pages can
 * do. Here there is a running process, so the reel is re-fetched on a timer and held
 * in memory. The page asks /story/data.json for it and swaps the media in; if this
 * ever fails the page simply keeps the version that shipped with the build.
 */
const igConfig = configFromEnv();
const refreshMinutes = Number(process.env.STORY_REFRESH_MINUTES ?? 60);
let cached: StoryMedia | null = null;
let lastRefresh = 0;

async function refreshStory() {
  if (!igConfig.userId || !igConfig.token) return;
  try {
    const media = await fetchLatestMedia(igConfig);
    // Keep the previous media if this run found nothing to show.
    if (media.poster) {
      cached = media;
      lastRefresh = Date.now();
      console.log(`[story] ${media.note}`);
    } else {
      console.log(`[story] ${media.note} — keeping the previous one`);
    }
  } catch (error) {
    // A dead token must not take the site down; the baked-in reel still serves.
    console.error(`[story] refresh failed: ${(error as Error).message}`);
  }
}

if (igConfig.userId && igConfig.token) {
  refreshStory();
  setInterval(refreshStory, refreshMinutes * 60_000);
  console.log(`Instagram refresh every ${refreshMinutes} min`);
} else {
  console.log("IG_USER_ID / IG_ACCESS_TOKEN not set — serving the reel baked into the build");
}

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

    // Stable URLs for the live reel, so the page never needs a rebuilt hashed name.
    if (pathname === "/story/data.json") {
      const body = cached ? { ...cached.data, refreshedAt: lastRefresh } : null;
      return Response.json(body, {
        status: body ? 200 : 204,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (pathname === "/story/media.jpg" && cached?.poster) {
      return new Response(cached.poster, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-cache" },
      });
    }

    if (pathname === "/story/media.mp4" && cached?.video) {
      return new Response(cached.video, {
        headers: { "Content-Type": "video/mp4", "Cache-Control": "no-cache" },
      });
    }

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
