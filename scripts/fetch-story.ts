#!/usr/bin/env bun
/**
 * Build-time fetch. Writes the newest Instagram reel (or story) to disk:
 *
 *   images/story.jpg  the still — the poster frame for a reel or video story
 *   images/story.mp4  the video, or an empty file when there is none
 *   story-data.js     window.STORY — media type, permalink, timestamp, dimensions
 *   story.json        the same data, for reference
 *
 * Then run `bun run build` and deploy. This is the path GitHub Pages uses, where
 * there is no server; on Railway serve.ts refreshes the same data at runtime.
 *
 * IG_SOURCE=reel (the default) uses /media filtered to media_product_type REELS.
 * Reels are permanent, so a missed run just leaves the previous reel in place.
 * IG_SOURCE=story uses /stories, which expire after 24 hours.
 *
 * Required env: IG_USER_ID, IG_ACCESS_TOKEN
 * Optional env: IG_SOURCE, IG_PROFILE_URL, GRAPH_VERSION
 */

import { configFromEnv, fetchLatestMedia, type StoryData } from "./instagram.ts";

const STORY_JSON = "story.json";
const STORY_DATA = "story-data.js";
const STORY_IMAGE = "images/story.jpg";
const STORY_VIDEO = "images/story.mp4";

const config = configFromEnv();

if (!config.userId || !config.token) {
  console.error("Missing IG_USER_ID or IG_ACCESS_TOKEN. See the README for how to get them.");
  process.exit(1);
}

/** story-data.js is a classic script so script.js never has to become a module. */
async function writeStoryData(data: StoryData) {
  await Bun.write(STORY_JSON, JSON.stringify(data, null, 2) + "\n");
  await Bun.write(
    STORY_DATA,
    "// Rewritten by scripts/fetch-story.ts. A plain global so script.js can stay a\n" +
      "// classic script — an ES import here would break the page when opened via file://.\n" +
      `window.STORY = ${JSON.stringify(data, null, 2)};\n`,
  );
}

let media;
try {
  media = await fetchLatestMedia(config);
} catch (error) {
  console.error(`Instagram API error: ${(error as Error).message}`);
  process.exit(1);
}

await writeStoryData(media.data);

if (!media.poster) {
  console.log(`${media.note} — the tile will link to the profile instead.`);
  process.exit(0);
}

await Bun.write(STORY_IMAGE, media.poster);
// images/story.mp4 must always exist or the build cannot resolve the <video src>.
// With no video it is emptied — <video preload="none"> never requests it.
await Bun.write(STORY_VIDEO, media.video ?? new Uint8Array());

const { width, height } = media.data;
console.log(`Saved ${media.note} → ${STORY_IMAGE}`);
if (width && height) console.log(`  ${width}x${height} (ratio ${(width / height).toFixed(4)})`);
else console.log("  could not read dimensions — the tile falls back to 9/16");
if (media.video) console.log(`  video → ${STORY_VIDEO}`);
