# Marina

Static site for Marina Yastrebova's child-psychology practice, built with Bun.

## Requirements

[Bun](https://bun.sh) 1.2 or newer:

```sh
brew install oven-sh/bun/bun
# or
curl -fsSL https://bun.sh/install | bash
```

There are no npm dependencies, so `bun install` is not needed.

## Development

```sh
bun run dev
```

Serves `index.html` at http://localhost:3000 with hot reloading. Bun bundles
`style.css` and `script.js` on the fly; edits to either reload the page.

Useful flags:

- `bun ./index.html --console` — stream browser console logs to the terminal
- while running: `o + Enter` opens the browser, `q + Enter` quits

## Production build

```sh
bun run build
```

Writes a minified, content-hashed bundle to `dist/`: the CSS and JS are minified
and the images in `images/` are copied and fingerprinted, with all paths in the
HTML rewritten to match. Deploy `dist/` to any static host.

## Deploying to GitHub Pages

This is the primary deployment. `.github/workflows/deploy.yml` builds on every push
to `main` and publishes `dist/` to Pages; `workflow_dispatch` lets you rebuild by hand
from the Actions tab.

One-time setup in the repo settings:

1. **Settings → Pages → Source: GitHub Actions.** Until this is set, the deploy job
   fails with `Failed to create deployment (status: 404)` — the workflow is fine, there
   is simply nowhere to deploy to.
2. **Settings → Pages → Custom domain: `yastrebovakids.pro`**, then tick *Enforce HTTPS*
   once the certificate is issued (it can take up to an hour).

The domain also lives in the `CNAME` file, which the workflow copies into `dist/`.
Both are needed: the repo setting drives GitHub's certificate provisioning, and the
file in the artifact is what stops each deploy from resetting the domain.

The repo must be public, or on a paid plan — Pages does not serve private repos on
the Free plan.

### DNS (Cloudflare)

Replace the Railway CNAME on the apex with GitHub's addresses:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

Cloudflare's CNAME flattening also works — a single `CNAME @ → marionuq.github.io`
— and is easier to keep current.

Set the records to **DNS only** (grey cloud). Proxying breaks GitHub's domain
verification, so the TLS certificate never provisions and the site stays on an HTTPS
error. Once *Enforce HTTPS* is on you may re-enable the proxy, but only with SSL/TLS
mode **Full (strict)**.

Keep the `_railway-verify` TXT record until Railway is shut down; it does not conflict.

## Deploying to Railway

Kept as a fallback while Pages beds in — not the primary deployment any more. Nothing
here needs to run for the Pages site to work; delete `Dockerfile`, `.dockerignore` and
`serve.ts` when you shut the Railway service down.

Railway serves a running container, not a folder of files, so `Dockerfile` builds
the site and `serve.ts` serves `dist/` on the port Railway injects.

1. Push this repo to GitHub.
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
3. That's it. Railpack does not detect Bun, so Railway falls back to the
   `Dockerfile`, which runs `bun run build` and then `bun run serve.ts`.
4. Settings → Networking → **Generate Domain** for a `*.up.railway.app` URL.

No start command or build command needs setting in the dashboard — the Dockerfile
defines both. `serve.ts` reads `PORT` and binds `0.0.0.0`, which is what Railway
requires; binding localhost instead is what causes "Application failed to respond".

`.dockerignore` keeps `.env` out of the image.

### Keeping the reel fresh on Railway

Set `IG_USER_ID` and `IG_ACCESS_TOKEN` as service variables and that is all —
`serve.ts` re-fetches the newest reel every hour and holds it in memory, serving it
from `/story/data.json`, `/story/media.jpg` and `/story/media.mp4`. The page asks for
that on load and swaps the media in. No rebuild, no redeploy, no commits.

`STORY_REFRESH_MINUTES` changes the interval (default `60`).

Without those variables the site still works: it serves whatever reel was baked in at
build time. Same if the token expires or Instagram is unreachable — the refresh logs
the failure and the previous reel keeps showing.

## Instagram tile

By default the tile shows the account's **latest reel** (`IG_SOURCE=reel`). Reels are
permanent, so a missed or failed run simply leaves the previous one in place.

Set `IG_SOURCE=story` to show the latest **story** instead. Stories expire after 24
hours, so that mode has to run at least daily or the tile goes stale.



The leftmost tile of the intro mosaic shows the account's latest Instagram story.
It is **baked in at build time**, not fetched by the browser: the Graph API needs
an access token, which cannot be shipped in a static page.

```sh
IG_USER_ID=... IG_ACCESS_TOKEN=... bun run story:build
```

`scripts/fetch-story.ts` calls `GET /{ig-user-id}/stories` and writes:

| file | contents |
| --- | --- |
| `images/story.jpg` | the still — the photo itself, or a video's poster frame |
| `images/story.mp4` | the video, or an empty file for photo stories |
| `story-data.js` | `window.STORY` — media type, permalink, timestamp |
| `story.json` | the same data, for reference |

Video stories get a play/pause button on the tile; photo stories don't, since there
is nothing to play. `images/story.mp4` must always exist — the build resolves the
`<video src>` at bundle time — which is why photo stories leave an empty file there.
`<video preload="none">` means the browser never requests it.

When no story is live the tile keeps its place and links to the profile, so the
layout never shifts and the build never breaks.

### Setup

1. The Instagram account must be **Business or Creator** and linked to a Facebook
   Page you have a role on.
2. At [developers.facebook.com/apps](https://developers.facebook.com/apps) create an
   app (type **Business**) and add the **Facebook Login for Business** product.
3. In the [Graph API Explorer](https://developers.facebook.com/tools/explorer/) pick
   your app, add the permissions `instagram_basic`, `pages_show_list` and
   `pages_read_engagement`, and click *Generate Access Token*. That gives a
   short-lived (~1 hour) token.
4. `cp .env.example .env`, put that token in `IG_ACCESS_TOKEN`, then run:

   ```sh
   bun run ig:setup
   ```

   It prints the numeric `IG_USER_ID` for each linked account. Add `FB_APP_ID` and
   `FB_APP_SECRET` (App Dashboard → Settings → Basic) and it will also exchange the
   token for a long-lived one (~60 days) and print the non-expiring Page tokens.
5. Fill in `IG_USER_ID` in `.env` and run `bun run story:build`.

`IG_USER_ID` is the **numeric** account id, not the `@handle` — the handle will not
work. `.env` is gitignored; the token is a credential, so keep it out of the repo.

**App Review:** while the app is in Development Mode the token only works for people
with a role on the app — fine for a build script you run yourself. Switching the app
to Live Mode requires Meta App Review for those permissions.

### Keeping it current

> **The tile is not on the page right now** — the markup was removed pending a decision
> on where to place it. The wiring in `script.js` is guarded and simply does nothing
> without it, and `deploy.yml` has no scheduled rebuild as a result. Re-add the cron
> when the tile goes back: on Pages a scheduled rebuild is the only way to refresh it,
> since the runtime `/story/data.json` fetch needs a server.


With `IG_SOURCE=reel` (the default) nothing expires, so the schedule only needs to be
often enough to pick up a new reel — daily is plenty. With `IG_SOURCE=story` it must
run at least daily, since **stories expire after 24 hours**, and hourly is typical.

Either way, run `bun run story:build` on a schedule and redeploy `dist/`.

`GRAPH_VERSION` defaults to `v25.0`; bump it when that version is retired.

## Structure

```
index.html            markup — the single entrypoint Bun bundles from
style.css             all styles; design tokens are the CSS variables in :root
script.js             certificate slider + story tile wiring
story.json            latest story metadata, refreshed by the fetch script
scripts/              build-time tooling
images/               photos, certificates, and the fetched story image
```

The site is still plain HTML/CSS/JS — Bun is the dev server and bundler, not a
framework.

`script.js` is deliberately a **classic script, not `type="module"`**. Browsers
block module scripts over `file://`, which silently disables all JS — the slider
included — when `index.html` is opened by double-clicking it. Keeping it classic
means the source files still work straight off disk.

Note that `dist/index.html` is different: Bun always emits `<script type="module">`
for the bundle, so the **built** site has to be served over http, not opened from
`file://`. Use `bun run dev` while working, and a static host for the build.
