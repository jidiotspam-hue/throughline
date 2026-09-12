/* throughline — a proxy that is its own front door.

   One Worker does everything: it serves its UI at /, gates on a passphrase, and
   then fetches other people's pages on the browser's behalf. Three shapes:

     /raw?url=…   the bytes, untouched, for a file or an API you call yourself
     /cors?url=…  the same, plus a wildcard CORS header (noncredentialed only)
     /b/<url>     browsing — HTML is rewritten so links and assets stay in here

   Nothing is stored. The passphrase lives as a Worker secret; a signed cookie
   is the only session state, and it is verifiable without a database. The SSRF
   guard from urls.js is the whole security story for what may be fetched, and
   it is re-run on every redirect hop inside fetch.js. */

import { checkTarget, BadTarget } from './urls.js';
import { proxyFetch, FetchProblem } from './fetch.js';
import { rewriteHTML, rewriteCSS, proxyPath, CSS_TRANSFORM_CAP } from './rewrite.js';
import { page, demoPage } from './ui.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE = 'tl';
const TARGET_COOKIE_PREFIX = '__tl_'; // per-site cookies from proxied pages

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname;

    try {
      // These handlers are awaited rather than returned bare: a returned
      // promise rejects outside this try/catch, and the error escapes as an
      // unhandled 1101 instead of becoming a clean 400/502.
      if (path === '/login' && request.method === 'POST') return await login(request, env, origin);

      // The Mac backend registers its current tunnel URL here. Not cookie-gated
      // (a script has no session) — it carries the UPDATE_KEY header instead.
      if (path === '/yt/backend' && request.method === 'PUT') return await registerBackend(request, env);

      if (path === '/' || path === '/index.html') {
        const authed = await validSession(request, env);
        return html(page({ authed }), { store: false });
      }

      // Everything past here is a proxy route and is gated. An unauthenticated
      // request gets a bare 404 — the site looks empty to anyone without the key.
      if (!(await validSession(request, env))) return notFound();

      if (path === '/yt') return await ytRedirect(env, origin);

      if (path === '/demo') return html(demoPage(), { store: false });
      if (path === '/demo/try') return await demoTry(url);

      if (path === '/raw') return await passthrough(url, { cors: false });
      if (path === '/cors') {
        if (request.method === 'OPTIONS') return corsPreflight();
        return await passthrough(url, { cors: true });
      }
      if (path === '/b' || path.startsWith('/b/')) return await browse(request, url, origin);

      return notFound();
    } catch (err) {
      return problem(err);
    }
  },
};

/* ── auth ─────────────────────────────────────────────────────────────── */

async function login(request, env, origin) {
  const form = await request.formData();
  const given = String(form.get('key') || '');
  const secret = env.PROXY_KEY || '';
  if (!secret || !timingSafeEqual(given, secret)) {
    return redirect(`${origin}/?bad=1`);
  }
  const token = await mintToken(Date.now() + SESSION_TTL_MS, secret);
  return new Response(null, {
    status: 303,
    headers: {
      location: `${origin}/`,
      'set-cookie': `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; ` +
        'HttpOnly; Secure; SameSite=Lax',
    },
  });
}

async function validSession(request, env) {
  const secret = env.PROXY_KEY || '';
  if (!secret) return false;
  const token = readCookie(request, COOKIE);
  if (!token) return false;
  return verifyToken(token, secret);
}

/* token = base64url(expiryMs) . base64url(HMAC-SHA256(expiryMs, secret)).
   The expiry is in the clear and signed, so it cannot be pushed forward without
   the secret, and no server-side store is needed to know when it lapses. */
async function mintToken(expiry, secret) {
  const exp = String(expiry);
  const sig = await hmac(exp, secret);
  return `${b64url(new TextEncoder().encode(exp))}.${b64url(sig)}`;
}

async function verifyToken(token, secret) {
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  let expStr;
  try {
    expStr = new TextDecoder().decode(unb64url(token.slice(0, dot)));
  } catch {
    return false;
  }
  const expiry = Number(expStr);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  const want = b64url(await hmac(expStr, secret));
  return timingSafeEqual(token.slice(dot + 1), want);
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

function timingSafeEqual(a, b) {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/* ── /raw and /cors ───────────────────────────────────────────────────── */

async function passthrough(url, { cors }) {
  const target = url.searchParams.get('url') || url.searchParams.get('u');
  if (!target) return notFound();
  checkTarget(target);
  const { response, finalURL } = await proxyFetch(target);

  const headers = filteredResponseHeaders(response.headers);
  // A raw fetch carries no session, so a wildcard is safe here — and it is only
  // ever a wildcard, never a reflected origin with credentials.
  if (cors) headers.set('access-control-allow-origin', '*');
  headers.set('x-throughline-final', finalURL);

  return new Response(response.body, { status: response.status, headers });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'content-type, range',
      'access-control-max-age': '86400',
    },
  });
}

/* ── /demo — an in-browser version of the test env ────────────────────────

   The local test/ harness routes real traffic through a forward-proxy that
   refuses everything, which is the rigorous proof. But that needs a terminal.
   This is the same idea made clickable in a browser, for a Chromebook that has
   none: two toggles — a *simulated* locked-down network, and whether to go
   through the proxy — and it shows the outcome flip from "sorry, blocked" to
   the real page. The filter is simulated because this Worker cannot itself sit
   behind the viewer's network; the honesty is stated in the UI. */

async function demoTry(url) {
  const target = url.searchParams.get('url') || '';
  const filterOn = url.searchParams.get('filter') === 'on';
  const proxyOn = url.searchParams.get('proxy') === 'on';

  if (!target) return json({ ok: false, status: 0, blocked: false, body: 'Type a URL first.' });

  // The point of the demo: behind the filter, only the proxy gets through.
  // Direct + filter on → the locked network refuses it.
  if (filterOn && !proxyOn) {
    return json({ ok: false, status: 403, blocked: true, contentType: 'text/plain', body: 'sorry, blocked' });
  }

  try {
    checkTarget(target); // proxy and direct both honour the SSRF guard
    const { response, finalURL } = await proxyFetch(target, { follow: true });
    const ctype = (response.headers.get('content-type') || '').toLowerCase();
    const isText = /text\/|json|xml|javascript|svg/.test(ctype);
    let body;
    if (isText) {
      body = (await response.text()).slice(0, 200 * 1024);
    } else {
      body = `[${ctype || 'binary'}] — ${finalURL}`;
    }
    return json({
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      blocked: false,
      contentType: ctype,
      via: proxyOn ? 'proxy' : 'direct',
      finalURL,
      body,
    });
  } catch (err) {
    return json({ ok: false, status: 502, blocked: false, body: err.message || 'Could not fetch that.' });
  }
}

/* ── /yt — the self-hosted YouTube backend ────────────────────────────────

   The engine is Invidious on the user's Mac, reached through a Cloudflare quick
   tunnel whose hostname changes on every restart. Rather than bake that moving
   hostname into a bookmark, the Chromebook always opens /yt; the Mac keeps KV
   pointed at the live tunnel via PUT /yt/backend, and /yt bounces to it through
   the existing /b/ browsing proxy. */

async function registerBackend(request, env) {
  const key = env.UPDATE_KEY || '';
  if (!key || !timingSafeEqual(request.headers.get('x-update-key') || '', key)) {
    return notFound(); // wrong/absent token looks like nothing is here
  }
  const backend = (await request.text()).trim();
  try {
    checkTarget(backend); // must be a public http(s) host — SSRF guard applies
  } catch {
    return new Response('bad backend url', { status: 400 });
  }
  if (!env.YT) return new Response('KV not bound', { status: 500 });

  // Registration is the proof of life. cloudflared announces a hostname a few
  // seconds before its edge connections are up (it answers 530 meanwhile), and
  // the Mac can't probe the hostname itself — its network doesn't even resolve
  // trycloudflare.com. So probe from here, the same vantage /b/ fetches from,
  // and refuse to store a host until it really answers. The script retries.
  // One good answer is not enough: while the tunnel's 4 edge connections are
  // still coming up, requests flap between edges that reach it and edges that
  // answer 530. Require several consecutive successes so a half-connected
  // tunnel is refused rather than stored.
  const PROBES = 4;
  for (let i = 0; i < PROBES; i++) {
    let probe;
    try {
      probe = await fetch(backend, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'throughline-probe' },
      });
    } catch {
      return new Response('backend not reachable yet', { status: 503 });
    }
    probe.body?.cancel().catch(() => {});
    if (probe.status >= 400) {
      return new Response(`backend answered ${probe.status} on probe ${i + 1}/${PROBES}`, { status: 503 });
    }
    if (i < PROBES - 1) await new Promise((r) => setTimeout(r, 400));
  }

  await env.YT.put('yt_backend', backend);
  return new Response('ok', { status: 200 });
}

async function ytRedirect(env, origin) {
  const backend = env.YT ? await env.YT.get('yt_backend') : null;
  if (!backend) {
    return html(
      '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>body{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:15vh auto;padding:0 24px;color:#18181b}' +
      '@media(prefers-color-scheme:dark){body{background:#0e0e11;color:#e8e8ea}}</style>' +
      '<h1>backend offline</h1><p>The YouTube engine has not checked in. Is the Mac awake, ' +
      'with the containers and the tunnel running?</p><p><a href="/">← home</a></p>',
      { store: false },
    );
  }
  // Bounce through the browsing proxy so the network only ever sees throughline.
  return redirect(proxyPath(origin, backend.replace(/\/$/, '') + '/'));
}

/* ── /b/<url> browsing ────────────────────────────────────────────────── */

async function browse(request, url, origin) {
  const target = targetFromPath(url);
  if (!target) return notFound();
  const targetURL = checkTarget(target);

  // Only this site's cookies go upstream, un-namespaced.
  const cookieHeader = upstreamCookies(request, targetURL.hostname);

  const reqHeaders = passHeaders(request);
  if (cookieHeader) reqHeaders.cookie = cookieHeader;

  const method = request.method;
  const body = method === 'GET' || method === 'HEAD' ? null : request.body;

  const { response, finalURL } = await proxyFetch(target, { method, headers: reqHeaders, body, follow: false });
  const finalURLObj = new URL(finalURL);

  const status = response.status;
  const outHeaders = filteredResponseHeaders(response.headers);

  // Redirects: bend Location back through /b/ so a 302 never escapes onto the
  // real host, and re-guard the destination.
  if (status >= 300 && status < 400 && response.headers.get('location')) {
    const loc = response.headers.get('location');
    let next;
    try { next = checkTarget(new URL(loc, finalURL).toString()); }
    catch { return problem(new BadTarget('That page redirected somewhere it should not.')); }
    outHeaders.set('location', proxyPath(origin, next.toString()));
    rewriteSetCookies(response.headers, outHeaders, finalURLObj.hostname);
    return new Response(null, { status, headers: outHeaders });
  }

  rewriteSetCookies(response.headers, outHeaders, finalURLObj.hostname);

  const ctype = (response.headers.get('content-type') || '').toLowerCase();

  if (ctype.includes('text/html') || ctype.includes('application/xhtml')) {
    stripFramingHeaders(outHeaders);
    const rewritten = rewriteHTML(response, finalURL, origin);
    return new Response(rewritten.body, { status, headers: outHeaders });
  }

  if (ctype.includes('text/css')) {
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > CSS_TRANSFORM_CAP) {
      return new Response(response.body, { status, headers: outHeaders }); // too big to rewrite; stream as-is
    }
    const css = await response.text();
    if (css.length > CSS_TRANSFORM_CAP) {
      return new Response(css, { status, headers: outHeaders });
    }
    const out = rewriteCSS(css, finalURL, origin);
    outHeaders.delete('content-length');
    return new Response(out, { status, headers: outHeaders });
  }

  // Everything else — images, scripts, fonts, media, JSON — streams untouched.
  // For media the body is byte-identical to upstream, so restore content-length
  // when it is safe (no content-encoding was applied — the runtime decompresses
  // those, which would make the declared length wrong). A correct content-length
  // is what lets a <video>/<audio> element seek and play a progressive stream;
  // range/content-range are already carried through by the header filter.
  if (!response.headers.get('content-encoding')) {
    const len = response.headers.get('content-length');
    if (len) outHeaders.set('content-length', len);
  }
  return new Response(response.body, { status, headers: outHeaders });
}

/* /b/https://example.com/x?y=1 — the target is the rest of the path plus our
   own query string, so options never collide with the site's. */
function targetFromPath(url) {
  let rest = url.pathname.replace(/^\/b\/?/, '');
  if (!rest) return '';
  try { rest = decodeURIComponent(rest); } catch { /* keep raw */ }
  if (url.search) rest += url.search;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(rest)) rest = `https://${rest}`;
  return rest;
}

/* ── cookies, namespaced per target host ──────────────────────────────── */

/* Upstream Set-Cookie → browser: rename to __tl_<hex(host)>_<name> so two
   proxied sites' identically-named cookies cannot clobber each other on the
   Worker's single origin. Domain is dropped; Path is forced under /b/. */
function rewriteSetCookies(srcHeaders, outHeaders, host) {
  const raw = typeof srcHeaders.getSetCookie === 'function'
    ? srcHeaders.getSetCookie()
    : [];
  const list = raw.length ? raw : (srcHeaders.get('set-cookie') ? [srcHeaders.get('set-cookie')] : []);
  const prefix = TARGET_COOKIE_PREFIX + hexHost(host) + '_';
  for (const sc of list) {
    const rewritten = renameSetCookie(sc, prefix);
    if (rewritten) outHeaders.append('set-cookie', rewritten);
  }
}

function renameSetCookie(setCookie, prefix) {
  const eq = setCookie.indexOf('=');
  const semi = setCookie.indexOf(';');
  if (eq < 0) return null;
  const name = setCookie.slice(0, eq).trim();
  if (!name || name.startsWith(TARGET_COOKIE_PREFIX)) return null; // never wrap our own
  const valueEnd = semi < 0 ? setCookie.length : semi;
  const value = setCookie.slice(eq + 1, valueEnd);

  const attrs = semi < 0 ? [] : setCookie.slice(semi + 1).split(';');
  const kept = ['Path=/b/', 'Secure'];
  let sameSite = 'SameSite=Lax';
  let httpOnly = false;
  for (const a of attrs) {
    const t = a.trim();
    const lower = t.toLowerCase();
    if (lower.startsWith('domain=')) continue;      // drop — scope to the Worker
    if (lower.startsWith('path=')) continue;         // replaced with /b/
    if (lower === 'secure') continue;                // always set
    if (lower.startsWith('samesite=')) { sameSite = t; continue; }
    if (lower === 'httponly') { httpOnly = true; continue; }
    kept.push(t); // Max-Age / Expires and anything else pass through
  }
  kept.push(sameSite);
  if (httpOnly) kept.push('HttpOnly');
  return `${prefix}${name}=${value}; ${kept.join('; ')}`;
}

/* Browser Cookie → upstream: pick out only this host's namespaced cookies and
   restore their original names. Our own session cookie and other sites' cookies
   are left behind. */
function upstreamCookies(request, host) {
  const jar = request.headers.get('cookie');
  if (!jar) return '';
  const prefix = TARGET_COOKIE_PREFIX + hexHost(host) + '_';
  const out = [];
  for (const pair of jar.split(';')) {
    const p = pair.trim();
    if (!p.startsWith(prefix)) continue;
    out.push(p.slice(prefix.length));
  }
  return out.join('; ');
}

function hexHost(host) {
  let out = '';
  for (const ch of new TextEncoder().encode(host.toLowerCase())) {
    out += ch.toString(16).padStart(2, '0');
  }
  return out;
}

/* ── header hygiene ───────────────────────────────────────────────────── */

/* Hop-by-hop and encoding headers that only make sense between the target and
   us must not be forwarded to the browser — the runtime has already decoded the
   body, so a stale content-encoding/length would make it unreadable. */
const DROP_RESPONSE_HEADERS = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection',
  'keep-alive', 'set-cookie', 'set-cookie2', 'strict-transport-security',
  'public-key-pins', 'report-to', 'nel',
]);

function filteredResponseHeaders(src) {
  const h = new Headers();
  for (const [k, v] of src) {
    if (DROP_RESPONSE_HEADERS.has(k.toLowerCase())) continue;
    h.set(k, v);
  }
  return h;
}

function stripFramingHeaders(h) {
  h.delete('content-security-policy');
  h.delete('content-security-policy-report-only');
  h.delete('x-frame-options');
}

/* Request headers worth carrying upstream. Cookie is rebuilt separately. */
function passHeaders(request) {
  const out = {};
  for (const name of ['accept', 'accept-language', 'content-type', 'range', 'user-agent']) {
    const v = request.headers.get(name);
    if (v) out[name] = v;
  }
  return out;
}

/* ── responses ────────────────────────────────────────────────────────── */

function html(body, { store }) {
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': store ? 'public, max-age=3600' : 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function json(body) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { location } });
}

// A single shape for "there is nothing here", used both for real 404s and for
// unauthenticated proxy requests, so the two are indistinguishable.
function notFound() {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

function problem(err) {
  if (err instanceof BadTarget) return new Response(err.message, { status: 400 });
  if (err instanceof FetchProblem) {
    return new Response(err.message, { status: err.status && err.status >= 400 ? err.status : 502 });
  }
  return new Response('Something went wrong.', { status: 502 });
}

function readCookie(request, name) {
  const jar = request.headers.get('cookie');
  if (!jar) return '';
  for (const pair of jar.split(';')) {
    const p = pair.trim();
    if (p.startsWith(name + '=')) return p.slice(name.length + 1);
  }
  return '';
}

/* ── base64url ────────────────────────────────────────────────────────── */

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
