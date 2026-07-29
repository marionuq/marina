#!/usr/bin/env bun
/**
 * One-off helper for wiring up the Instagram story tile.
 *
 *   bun run ig:setup
 *
 * With IG_ACCESS_TOKEN set it lists the Facebook Pages you manage and the numeric
 * Instagram Business Account id behind each one — that id is what IG_USER_ID wants.
 *
 * If FB_APP_ID and FB_APP_SECRET are also set, it first exchanges the token for a
 * long-lived one (~60 days) and prints it, plus any non-expiring Page tokens.
 */

const { IG_ACCESS_TOKEN, FB_APP_ID, FB_APP_SECRET, GRAPH_VERSION = "v25.0" } = process.env;
const API = `https://graph.facebook.com/${GRAPH_VERSION}`;

if (!IG_ACCESS_TOKEN) {
  console.error(
    "Set IG_ACCESS_TOKEN first — generate one in the Graph API Explorer with the\n" +
      "instagram_basic, pages_show_list and pages_read_engagement permissions.",
  );
  process.exit(1);
}

async function api(path: string, params: Record<string, string>) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await res_json(url);
  return res;
}

async function res_json(url: URL) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? response.statusText);
  return body;
}

let token = IG_ACCESS_TOKEN;

// 1. Trade the short-lived token for a long-lived one, if we have the app credentials.
if (FB_APP_ID && FB_APP_SECRET) {
  const exchanged = await api("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: FB_APP_ID,
    client_secret: FB_APP_SECRET,
    fb_exchange_token: token,
  });
  token = exchanged.access_token;
  const days = exchanged.expires_in ? Math.round(exchanged.expires_in / 86400) : "?";
  console.log(`Long-lived user token (expires in ~${days} days):\n${token}\n`);
} else {
  console.log("FB_APP_ID / FB_APP_SECRET not set — skipping long-lived token exchange.\n");
}

// 2. List Pages, and the Instagram account attached to each.
const pages = await api("me/accounts", { fields: "id,name,access_token", access_token: token });

if (!pages.data?.length) {
  console.log("No Facebook Pages returned for this token.\n");

  // An empty list is far more often a missing scope than a missing Page — the API
  // returns [] rather than an error. /me/permissions needs only the token itself.
  const perms = await api("me/permissions", { access_token: token });
  const granted = new Set(
    (perms.data ?? []).filter((p: any) => p.status === "granted").map((p: any) => p.permission),
  );

  const required = ["pages_show_list", "instagram_basic", "pages_read_engagement"];
  const missing = required.filter((p) => !granted.has(p));

  console.log("Permissions on this token:");
  for (const p of required) console.log(`  ${granted.has(p) ? "✓" : "✗"} ${p}`);

  if (missing.length) {
    console.log(`\nMissing: ${missing.join(", ")}`);
    console.log("Regenerate the token in the Graph API Explorer with those ticked —");
    console.log("without pages_show_list this list is always empty.");
  } else {
    const me = await api("me", { fields: "id,name", access_token: token });
    console.log(`\nScopes are fine, and this token belongs to: ${me.name} (${me.id})`);
    console.log("So the list is empty for one of these reasons, most likely the first:");
    console.log("  1. No Page was ticked in the login popup. pages_show_list only covers");
    console.log("     the Pages you select there — regenerate the token and choose the");
    console.log("     Page (or 'Opt in to all current and future Pages').");
    console.log(`  2. ${me.name} holds no role on the Page — check Page > Settings > Page access.`);
    console.log("  3. The Instagram account is not Business/Creator, or is not connected");
    console.log("     from the Page (Page > Settings > Linked accounts).");
  }
  process.exit(0);
}

for (const page of pages.data) {
  // instagram_business_account is the one /stories needs. connected_instagram_account
  // often fills in instead when the accounts are linked only via Accounts Center —
  // seeing that one but not the other pinpoints a half-finished link.
  const detail = await api(page.id, {
    fields: "instagram_business_account{id,username},connected_instagram_account{id,username}",
    access_token: token,
  });
  const business = detail.instagram_business_account;
  const connected = detail.connected_instagram_account;

  console.log(`Page: ${page.name} (${page.id})`);
  if (business) {
    console.log(`  IG_USER_ID=${business.id}      # @${business.username}`);
    console.log(`  Page token (does not expire):\n  ${page.access_token}`);
  } else if (connected) {
    console.log(`  connected_instagram_account: ${connected.id} (@${connected.username})`);
    console.log("  ...but instagram_business_account is empty, so /stories will not work.");
    console.log("  Reconnect from the Page: Settings > Linked accounts > Instagram.");
  } else {
    console.log("  no Instagram account linked to this Page at all");
  }
  console.log();
}

console.log("Put IG_USER_ID and IG_ACCESS_TOKEN in .env, then run: bun run story:build");
