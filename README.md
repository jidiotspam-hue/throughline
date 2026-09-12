# throughline

A web proxy that is its own front door. One Cloudflare Worker serves a small
UI, gates on a passphrase, and then fetches other sites on your browser's
behalf. The client is just a browser — nothing to install — so it runs on a
Chromebook with no Linux environment, or anything else with a URL bar.

## The three modes

| Route | What it does |
| --- | --- |
| `GET /` | The UI: a passphrase field, then an address bar. |
| `/b/<url>` | **Browsing.** Fetches the page and rewrites its links, assets and forms so navigation stays inside the proxy. Handles GET and POST. |
| `/raw?url=…` | The target's bytes, untouched. For a file or an API you call yourself. |
| `/cors?url=…` | Same as `/raw`, plus `Access-Control-Allow-Origin: *`. Noncredentialed use only. |

## How it holds together

- **Auth is a signed cookie.** `POST /login` checks the passphrase against the
  `PROXY_KEY` secret and sets a `Secure; HttpOnly; SameSite=Lax` cookie holding
  `expiry . HMAC(expiry, secret)`. Because every rewritten URL points back at
  the Worker's own origin, the cookie rides along on every sub-resource, iframe
  and form request automatically — no secret ever appears in a URL. A request to
  a proxy route without a valid cookie gets a bare **404**, so the site looks
  empty to anyone who does not have the key.
- **Only the public web is reachable.** `src/urls.js` (carried over from
  readline) rejects private and internal addresses in every spelling, and it is
  re-run on every redirect hop — so the proxy cannot be pointed at
  `169.254.169.254` or anything else inside the cloud fabric.
- **Bodies stream.** Nothing is buffered into memory except CSS small enough to
  rewrite; images, video, scripts and large files pass straight through.
- **Proxied cookies are namespaced per site.** A cookie `example.com` sets is
  reissued as `__tl_<hex(host)>_<name>` and only handed back to `example.com`, so
  two proxied sites' identically-named cookies never collide on the Worker's
  single origin.

## Deploy

```bash
cd worker
npx wrangler deploy                 # prints the workers.dev URL
npx wrangler secret put PROXY_KEY   # set the passphrase
```

Open the printed URL, enter the passphrase once, and use the address bar.

## `/yt` — YouTube and full-length music

The generic proxy can't *play* YouTube (MediaSource streams, signed CDN URLs, a
service worker, and YouTube blocking every datacenter IP — including
Cloudflare's). So `/yt` doesn't try. It bounces the browser, still through
`/b/`, to a **self-hosted Invidious** running on a Mac at home, whose
residential IP YouTube doesn't block. Invidious plays YouTube video *and*
full-length YouTube Music.

The Mac reaches the internet through an anonymous Cloudflare quick tunnel whose
hostname changes on every restart, so the Mac re-registers it with
`PUT /yt/backend` (gated by the `UPDATE_KEY` secret, stored in KV) and `/yt`
always points at the live one. The Chromebook bookmark is just `/yt`.

The backend — Invidious + companion + Postgres under Docker, the tunnel script,
LaunchAgents for auto-start and maintenance — lives in [`backend/`](backend/).

Apple Music full playback is **not** part of this and never can be through a
proxy: it's FairPlay DRM, origin-bound and login-gated, and we don't circumvent
DRM. YouTube Music covers "just music"; only 30-second Apple previews are
reachable without DRM.

## Honest limits

This is best-effort browsing, not a transparent browser. It does **not** handle
WebSockets, Server-Sent Events, or service workers; JavaScript that builds URLs
at runtime beyond what the injected fetch/XHR shim catches; cookies a page reads
via `document.cookie` across hosts; or sites that hard-block datacenter IPs.
Complex single-page apps may partly break.

`workers.dev` is itself categorised or blocked on some managed networks. A
**custom domain** on the same Cloudflare account is Cloudflare's recommended
production setup and the single biggest reduction in how visible this is —
point a route at the Worker and use that hostname instead.

## Testing

`test/blocker.js` is a local forward-proxy that refuses every destination with
`sorry, blocked`, for simulating a locked-down network. `test/run.sh` drives it:
it confirms direct access is blocked, then checks whether requests still get
through when they go via the deployed Worker. See `test/README.md`.
