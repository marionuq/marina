#!/usr/bin/env bun
/**
 * Diagnoses IG_ACCESS_TOKEN: what kind of token it is, which permissions it carries,
 * when it expires, and whether it can actually reach the stories endpoint.
 *
 *   bun run ig:check
 *
 * /stories needs a USER token with instagram_basic + pages_read_engagement.
 * A Page token fails with "(#190) This call requires user access token".
 */

const { IG_USER_ID, FB_APP_ID, FB_APP_SECRET, GRAPH_VERSION = "v25.0" } = process.env;
const API = `https://graph.facebook.com/${GRAPH_VERSION}`;

// A token can be passed as an argument, so a candidate (a Page or System User token)
// can be tried without touching .env:  bun run ig:check <token>
const IG_ACCESS_TOKEN = process.argv[2] ?? process.env.IG_ACCESS_TOKEN;

if (!IG_ACCESS_TOKEN) {
  console.error("Set IG_ACCESS_TOKEN in .env, or pass one: bun run ig:check <token>");
  process.exit(1);
}

async function get(path: string, params: Record<string, string>) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url);
  return { ok: response.ok, body: await response.json() };
}

// 1. Who does this token identify? Works for both user and Page tokens.
const me = await get("me", { fields: "id,name", access_token: IG_ACCESS_TOKEN });

if (!me.ok) {
  console.log(`✗ Token rejected: ${me.body?.error?.message}`);
  console.log("  Generate a fresh one in the Graph API Explorer.");
  process.exit(1);
}

console.log(`Token identifies: ${me.body.name} (${me.body.id})`);

// A Page node has `category`; asking a user for it fails with #100, so the error
// itself is the signal. debug_token below reports the type outright when available.
const probe = await get("me", { fields: "category", access_token: IG_ACCESS_TOKEN });
if (probe.ok && probe.body.category) {
  console.log("✗ This is a PAGE token — /stories needs a USER token.");
} else {
  console.log("✓ This is a USER token.");
}

// 2. Granted scopes. /me/permissions works with just the token — no app secret.
const perms = await get("me/permissions", { access_token: IG_ACCESS_TOKEN });
if (perms.ok) {
  const granted = new Set(
    (perms.body.data ?? []).filter((p: any) => p.status === "granted").map((p: any) => p.permission),
  );
  console.log("Permissions:");
  for (const needed of ["instagram_basic", "pages_show_list", "pages_read_engagement"]) {
    console.log(`  ${granted.has(needed) ? "✓" : "✗"} ${needed}`);
  }
}

// 3. Expiry, which does need the app credentials.
if (FB_APP_ID && FB_APP_SECRET) {
  const debug = await get("debug_token", {
    input_token: IG_ACCESS_TOKEN,
    access_token: `${FB_APP_ID}|${FB_APP_SECRET}`,
  });
  const d = debug.body?.data;
  if (d) {
    const expiry = d.expires_at ? new Date(d.expires_at * 1000).toISOString() : "never";
    console.log(`Type: ${d.type}   valid: ${d.is_valid}   expires: ${expiry}`);
  }
} else {
  console.log("(set FB_APP_ID / FB_APP_SECRET to also see scopes and expiry)");
}

// 4. The endpoints the build script uses. /media backs IG_SOURCE=reel (the default),
//    /stories backs IG_SOURCE=story. A token only needs the one you actually use.
if (IG_USER_ID) {
  const media = await get(`${IG_USER_ID}/media`, {
    fields: "id,media_product_type",
    limit: "50",
    access_token: IG_ACCESS_TOKEN,
  });

  if (media.ok) {
    const reels = (media.body.data ?? []).filter((m: any) => m.media_product_type === "REELS");
    console.log(`✓ /media works — ${media.body.data?.length ?? 0} item(s), ${reels.length} reel(s).`);
    if (!reels.length) console.log("  no reels yet, so the tile falls back to the profile link");
  } else {
    console.log(`✗ /media failed: ${media.body?.error?.message}`);
  }

  const stories = await get(`${IG_USER_ID}/stories`, { fields: "id", access_token: IG_ACCESS_TOKEN });
  if (stories.ok) {
    console.log(`✓ /stories works — ${stories.body.data?.length ?? 0} live story item(s).`);
  } else {
    console.log(`✗ /stories failed: ${stories.body?.error?.message}`);
    console.log("  A (#190) here means either a Page token (this endpoint wants a user");
    console.log("  token) or an IG_USER_ID that is really a Page id — try: bun run ig:setup");
  }
} else {
  console.log("(set IG_USER_ID to test the endpoints themselves)");
}
