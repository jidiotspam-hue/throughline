# throughline local test environment

Tools for exercising the deployed throughline worker
(`https://<your-worker>.workers.dev`) against a simulated
locked-down network. Everything here uses only Node built-in modules
and `curl` — no npm installs.

**This hits the live deployed throughline worker and needs internet access.**

## No terminal? Use the in-browser test bench instead

Everything here is for a machine with a terminal (a Mac, say). On a
Chromebook with no Linux environment there is no terminal to run these,
so the same demonstration is built into the worker itself at **`/demo`**
(the "test bench →" link on the home page): two toggles — a *simulated*
locked-down network and whether to use the proxy — that flip a result
between "sorry, blocked" and the real page, entirely in the browser.

The difference: `/demo`'s filter is *simulated* (a hosted page can't sit
behind your real network), whereas `run.sh` and `gui.js` below route
real traffic through `blocker.js`, a proxy that genuinely refuses every
destination. That's the rigorous proof; `/demo` is the clickable one.

## Files

- `blocker.js` — a local "block everything" forward proxy (simulates a
  locked-down network). Refuses every destination by default; only
  hostnames listed in the `ALLOW` env var (comma-separated) are let
  through, for both plain HTTP and HTTPS (`CONNECT`) traffic.
- `run.sh` — CLI proof: starts the blocker in block-all mode, shows
  direct access to example.com/wikipedia is blocked, then restarts the
  blocker allowing only `<your-worker>.workers.dev` and shows a
  request to `example.com` via throughline's `/raw` endpoint still gets
  through the same locked-down network.
- `gui.js` + `public/index.html` — a small local web app to interactively
  try a URL with a "Network filter" toggle (routes through blocker.js)
  and a "Use throughline proxy" toggle (routes through throughline's
  `/raw` endpoint).
- `README.md` — this file.

## Running the CLI proof

```
bash run.sh
```

It prints a PASS/FAIL table and exits non-zero if anything doesn't
behave as expected. It starts/stops `blocker.js` itself (no leftover
processes) and cleans up its temp cookie jar.

Note: for HTTPS destinations, curl issues a `CONNECT` to the proxy; when
the proxy refuses the tunnel with a non-2xx status, curl does not
surface the tunnel response body to stdout (verified against curl
8.7.1) — it aborts with exit code 56 and logs `CONNECT tunnel failed,
response 403` on stderr. `run.sh` treats that (or a literal `sorry,
blocked` body, which you do get for plain-HTTP proxying) as proof of a
block.

## Running the GUI

```
node gui.js
```

Then open http://localhost:8099 in a browser.

- `GUI_PORT` (default `8099`) — port for the GUI server.
- `BLOCKER_PORT` (default `8100`) — port for the blocker instance gui.js
  starts internally.

gui.js starts its own embedded `blocker.js` instance (allowing only
`<your-worker>.workers.dev`) and logs in to throughline once at
startup to get a cookie jar (`.gui-jar` in this directory). Toggle
"Network filter" and "Use throughline proxy" in the page, type a URL,
and click "Try it". With Filter ON, toggling the throughline proxy
OFF→ON should flip the result from blocked (red) to the real page
(green).

The backend API is `GET /try?url=<url>&filter=on|off&proxy=on|off`,
which shells out to `curl` server-side and returns JSON:
`{ ok, status, blocked, contentType, body }` (body capped to ~200KB).

## Running blocker.js standalone

```
PORT=8100 ALLOW=example.com,en.wikipedia.org node blocker.js
```

Then point any client at `http://localhost:8100` as its HTTP/HTTPS
proxy. Everything not in `ALLOW` gets a 403 with body `sorry, blocked`
(for plain HTTP) or a refused `CONNECT` tunnel (for HTTPS).
