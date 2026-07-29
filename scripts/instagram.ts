/**
 * Shared Instagram fetching, used two ways:
 *   - scripts/fetch-story.ts writes the result to disk at build time (GitHub Pages)
 *   - serve.ts holds the result in memory and refreshes it on a timer (Railway)
 *
 * Nothing here touches the filesystem, so it is safe to call from a running server.
 */

export type StoryData = {
  hasStory: boolean;
  mediaType: "IMAGE" | "VIDEO";
  permalink: string;
  timestamp: string | null;
  width: number | null;
  height: number | null;
};

export type StoryMedia = {
  data: StoryData;
  poster: Uint8Array | null;
  video: Uint8Array | null;
  note: string;
};

export type InstagramConfig = {
  userId?: string;
  token?: string;
  source?: string;
  profileUrl?: string;
  graphVersion?: string;
};

export function configFromEnv(env = process.env): InstagramConfig {
  return {
    userId: env.IG_USER_ID,
    token: env.IG_ACCESS_TOKEN,
    source: env.IG_SOURCE ?? "reel",
    profileUrl: env.IG_PROFILE_URL ?? "https://www.instagram.com/marina_yastrebova_psy",
    graphVersion: env.GRAPH_VERSION ?? "v25.0",
  };
}

/**
 * Reads a JPEG's dimensions from its SOF marker. The Graph API does not report a
 * reel's size, and the tile's aspect ratio has to match the image exactly or the
 * media gets cropped — so we measure the bytes we just downloaded.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
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

function noMedia(profileUrl: string, note: string): StoryMedia {
  return {
    data: {
      hasStory: false,
      mediaType: "IMAGE",
      permalink: profileUrl,
      timestamp: null,
      width: null,
      height: null,
    },
    poster: null,
    video: null,
    note,
  };
}

/**
 * Returns the newest reel (or story) with its bytes. Throws only on a bad token or
 * a broken request — an account with nothing to show comes back as hasStory:false,
 * so a caller can keep serving whatever it already had.
 */
export async function fetchLatestMedia(config: InstagramConfig): Promise<StoryMedia> {
  const { userId, token, source, profileUrl = "", graphVersion } = config;
  if (!userId || !token) throw new Error("IG_USER_ID and IG_ACCESS_TOKEN are required");

  const wantsReel = source !== "story";

  // /media excludes stories entirely, so reels need the other endpoint. Both take
  // the same permissions, so no extra App Review either way.
  const fields = "id,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";
  const endpoint =
    `https://graph.facebook.com/${graphVersion}/${userId}/` +
    (wantsReel ? "media?limit=50&" : "stories?") +
    `fields=${fields}&access_token=${encodeURIComponent(token)}`;

  const response = await fetch(endpoint);
  const payload: any = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? response.statusText);
  }

  // Newest first. Videos expose a still via thumbnail_url.
  const latest = (payload.data ?? [])
    .filter((item: any) => (wantsReel ? item.media_product_type === "REELS" : true))
    .filter((item: any) => item.media_url || item.thumbnail_url)
    .sort((a: any, b: any) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];

  if (!latest) {
    return noMedia(profileUrl, wantsReel ? "No reels on the account" : "No live story right now");
  }

  const isVideo = latest.media_type === "VIDEO";
  const posterUrl = isVideo ? (latest.thumbnail_url ?? latest.media_url) : latest.media_url;
  const posterResponse = await fetch(posterUrl);

  if (!posterResponse.ok) {
    // The signed CDN URL is short-lived; a stale one is not worth failing over.
    return noMedia(profileUrl, `Could not download the still (HTTP ${posterResponse.status})`);
  }

  const poster = new Uint8Array(await posterResponse.arrayBuffer());
  const size = jpegSize(poster);

  let video: Uint8Array | null = null;
  let mediaType: "IMAGE" | "VIDEO" = "IMAGE";

  if (isVideo && latest.media_url) {
    const videoResponse = await fetch(latest.media_url);
    if (videoResponse.ok) {
      video = new Uint8Array(await videoResponse.arrayBuffer());
      mediaType = "VIDEO";
    }
  }

  return {
    data: {
      hasStory: true,
      mediaType,
      permalink: latest.permalink ?? profileUrl,
      timestamp: latest.timestamp,
      width: size?.width ?? null,
      height: size?.height ?? null,
    },
    poster,
    video,
    note: `${mediaType} ${wantsReel ? "reel" : "story"} from ${latest.timestamp}`,
  };
}
