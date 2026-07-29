#!/usr/bin/env bun
/**
 * Fetches the newest Instagram reel (or story) for the business account and writes:
 *
 *   images/story.jpg  the still — the poster frame for a reel or video story
 *   images/story.mp4  the video, or an empty file for a photo story
 *   story-data.js     window.STORY — media type, permalink, timestamp, dimensions
 *   story.json        the same data, for reference
 *
 * Then run `bun run build` and deploy.
 *
 * IG_SOURCE=reel (the default) uses /media filtered to media_product_type REELS.
 * Reels are permanent, so a missed run just leaves the previous reel in place.
 * IG_SOURCE=story uses /stories instead — those expire after 24 hours, so that
 * mode has to run at least daily to avoid going blank.
 *
 * Required env: IG_USER_ID, IG_ACCESS_TOKEN
 * Optional env: IG_SOURCE, IG_PROFILE_URL, GRAPH_VERSION
 */

const {
  // IG_USER_ID is the *numeric* Instagram Business Account id, not the @handle.
  // Run `bun run ig:setup` to look it up. Both of these come from .env (Bun loads
  // it automatically) — never hardcode the token, it is a credential.
  IG_USER_ID,
  IG_ACCESS_TOKEN,
  IG_SOURCE = "reel",
  IG_PROFILE_URL = "https://www.instagram.com/marina_yastrebova_psy",
  GRAPH_VERSION = "v25.0",
} = process.env;

const STORY_JSON = "story.json";
const STORY_DATA = "story-data.js";
const STORY_IMAGE = "images/story.jpg";
const STORY_VIDEO = "images/story.mp4";

/**
 * Reads a JPEG's dimensions from its SOF marker. The Graph API does not report a
 * story's size, and the tile's aspect ratio has to match the image exactly or the
 * story gets cropped — so we measure the bytes we just downloaded.
 */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];

    // Padding and standalone markers carry no length field.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }

    // SOF0-SOF15 hold the frame size; C4/C8/CC are other things in that range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }

    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

/** story-data.js is a classic script so script.js never has to become a module. */
async function writeStoryData(data: {
  hasStory: boolean;
  mediaType: string;
  permalink: string;
  timestamp: string | null;
  width?: number | null;
  height?: number | null;
}) {
  await Bun.write(STORY_JSON, JSON.stringify(data, null, 2) + "\n");
  await Bun.write(
    STORY_DATA,
    "// Rewritten by scripts/fetch-story.ts. A plain global so script.js can stay a\n" +
      "// classic script — an ES import here would break the page when opened via file://.\n" +
      `window.STORY = ${JSON.stringify(data, null, 2)};\n`,
  );
}

async function writeNoStory(reason: string) {
  await writeStoryData({
    hasStory: false,
    mediaType: "IMAGE",
    permalink: IG_PROFILE_URL,
    timestamp: null,
  });
  console.log(`${reason} — the tile will link to the profile instead.`);
}

if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
  console.error("Missing IG_USER_ID or IG_ACCESS_TOKEN. See the README for how to get them.");
  process.exit(1);
}

const wantsReel = IG_SOURCE !== "story";

// /media excludes stories entirely, so reels need the other endpoint. Both take the
// same permissions (instagram_basic + pages_read_engagement), so no extra App Review.
const fields =
  "id,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";
const endpoint =
  `https://graph.facebook.com/${GRAPH_VERSION}/${IG_USER_ID}/` +
  (wantsReel ? `media?limit=50&` : `stories?`) +
  `fields=${fields}&access_token=${encodeURIComponent(IG_ACCESS_TOKEN)}`;

const response = await fetch(endpoint);
const payload = await response.json();

if (!response.ok) {
  console.error(`Instagram API error: ${payload?.error?.message ?? response.statusText}`);
  process.exit(1);
}

// Newest first. Videos expose a still via thumbnail_url.
const candidates = (payload.data ?? [])
  .filter((item: any) => (wantsReel ? item.media_product_type === "REELS" : true))
  .filter((item: any) => item.media_url || item.thumbnail_url)
  .sort((a: any, b: any) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

const latest = candidates[0];

if (!latest) {
  await writeNoStory(wantsReel ? "No reels found on the account" : "No live story right now");
  process.exit(0);
}

const isVideo = latest.media_type === "VIDEO";

// The still always comes first — it is the poster as well as the photo-story image.
const posterUrl = isVideo ? (latest.thumbnail_url ?? latest.media_url) : latest.media_url;
const poster = await fetch(posterUrl);

if (!poster.ok) {
  // The signed CDN URL is short-lived; a stale one is not worth failing the build over.
  await writeNoStory(`Could not download story media (HTTP ${poster.status})`);
  process.exit(0);
}

const posterBytes = new Uint8Array(await poster.arrayBuffer());
await Bun.write(STORY_IMAGE, posterBytes);
const size = jpegSize(posterBytes);

// images/story.mp4 must always exist or the build cannot resolve the <video src>.
// For photo stories it is emptied — <video preload="none"> never requests it.
let mediaType = "IMAGE";

if (isVideo && latest.media_url) {
  const video = await fetch(latest.media_url);
  if (video.ok) {
    await Bun.write(STORY_VIDEO, await video.arrayBuffer());
    mediaType = "VIDEO";
  } else {
    console.log(`Video download failed (HTTP ${video.status}) — falling back to the still.`);
    await Bun.write(STORY_VIDEO, new Uint8Array());
  }
} else {
  await Bun.write(STORY_VIDEO, new Uint8Array());
}

await writeStoryData({
  hasStory: true,
  mediaType,
  permalink: latest.permalink ?? IG_PROFILE_URL,
  timestamp: latest.timestamp,
  width: size?.width ?? null,
  height: size?.height ?? null,
});

console.log(
  `Saved ${mediaType} ${wantsReel ? "reel" : "story"} from ${latest.timestamp} → ${STORY_IMAGE}`,
);
if (size) console.log(`  ${size.width}x${size.height} (ratio ${(size.width / size.height).toFixed(4)})`);
else console.log("  could not read dimensions — the tile falls back to 9/16");
if (mediaType === "VIDEO") console.log(`  video → ${STORY_VIDEO}`);
