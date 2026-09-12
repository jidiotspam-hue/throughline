# throughline backend — the YouTube engine

The self-hosted half of throughline's `/yt`. Runs **Invidious** (a YouTube
frontend) on this Mac and exposes it through a Cloudflare quick tunnel, so a
browser anywhere — including a locked-down Chromebook — can watch YouTube and
play full-length YouTube Music by opening `<your-worker>.workers.dev/yt`.

Why a Mac at home and not the Worker: YouTube blocks datacenter IPs, which is
every Cloudflare egress. A residential IP is the whole reason this works.

## Moving parts

| File | Role |
| --- | --- |
| `docker-compose.template.yml` | Invidious + companion + Postgres. Native arm64. Listens on `127.0.0.1:3000`. |
| `render.sh` | Fills the secrets from `.companion_key` / `.hmac_key` into `docker-compose.yml`. |
| `start.sh` | Boots colima → `docker compose up` → waits for :3000 → hands off to `tunnel.sh`. Also runs `caffeinate` so the Mac never sleeps while serving. |
| `tunnel.sh` | Opens an anonymous `cloudflared` quick tunnel to :3000, scrapes the assigned `*.trycloudflare.com` URL, and `PUT`s it to throughline `/yt/backend`. Restarts and re-registers on any exit. |
| `maintain.sh` | Every 6h: restart Invidious (upstream says at least daily). Daily: pull fresh images. |
| `com.throughline.backend.plist` | LaunchAgent: runs `start.sh` at login, keeps it alive. |
| `com.throughline.maintain.plist` | LaunchAgent: runs `maintain.sh` every 6h. |
| `bin/cloudflared` | Standalone binary (no Homebrew). |

Secrets (`.companion_key`, `.hmac_key`, `.update_key`) and the rendered
`docker-compose.yml` are git-ignored.

## How the Chromebook finds it

A quick tunnel gets a **new random hostname every time it starts**, so nobody
bookmarks it. `tunnel.sh` registers the live hostname with throughline (KV), and
`/yt` bounces the browser to it through throughline's own `/b/` proxy. The
Chromebook bookmark is always just `/yt`, and the network only ever sees
throughline.

**Registration is the proof of life.** cloudflared announces the hostname a few
seconds before the tunnel is actually connected (it answers 530 meanwhile), so
throughline fetches the URL from Cloudflare's side before accepting it and
returns 503 until it answers; `tunnel.sh` just retries. KV therefore never
holds a dead host, and the last good one survives a failed restart.

Don't try to probe the tunnel from this Mac: this home network returns
NXDOMAIN for `trycloudflare.com` (DNS filtering — even "via" 1.1.1.1), so the
hostname is unreachable *locally* while being perfectly reachable from
Cloudflare. Same reason the Chromebook must always go through `/yt`, never the
raw tunnel URL.

## Design decisions baked into the config

- **`domain:` left blank** — Invidious then emits *relative* links everywhere,
  which is what makes a rotating hostname work at all.
- **`https_only: true`, `hsts: false`** — secure cookies behind the https
  tunnel, without pinning a throwaway hostname for a year.
- **`local: true`, `quality: medium`** — media is served *from the instance*
  (never `googlevideo.com` directly) as progressive 360p MP4: the most
  proxy-survivable form. Bump `quality` to `dash` for higher resolution if the
  tunnel proves solid.
- **No `public_url` for the companion** — Invidious proxies it at its own
  `/companion/*`, so everything stays on one port and one hostname.
- **`check_tables: true`** — schema built from SQL inside the image; no git
  clone or bind mounts needed.

## Day-to-day

```bash
# is it up?
docker compose ps
cat current-url          # the live tunnel hostname
tail -f tunnel.log

# restart everything
launchctl kickstart -k gui/$(id -u)/com.throughline.backend

# update images now instead of waiting for the daily job
docker compose pull && docker compose up -d
```

If videos stop with "Sign in to confirm you're not a bot", YouTube has flagged
this IP: update images first (`docker compose pull`), then the public IP is the
next lever. Quick tunnels also refuse to start if `~/.cloudflared/config.yaml`
exists — don't create one.

## Limits

Quick tunnel: no uptime guarantee, ~200 in-flight requests, no SSE. Fine for
one person. Upgrade path: a named tunnel with a stable hostname if a domain is
ever added to the Cloudflare account. The Mac must stay on and awake.
