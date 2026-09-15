#!/usr/bin/env node
'use strict';
/**
 * gui.js — interactive GUI/API to test fetching a URL with and without:
 *   - a "network filter" (routes through blocker.js, a locked-down network)
 *   - "throughline proxy" (routes through the deployed throughline worker)
 *
 * Serves public/index.html at / and a JSON API at /try.
 *
 * Env:
 *   GUI_PORT      - port for this server (default 8099)
 *   BLOCKER_PORT  - port for the embedded blocker.js instance (default 8100)
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { execFile } = require('child_process');

const { start: startBlocker } = require('./blocker.js');

const GUI_PORT = process.env.GUI_PORT ? Number(process.env.GUI_PORT) : 8099;
const BLOCKER_PORT = process.env.BLOCKER_PORT ? Number(process.env.BLOCKER_PORT) : 8100;

// Secrets come from ../config.env (gitignored), never from this file.
const CONFIG_PATH = path.join(__dirname, '..', 'config.env');
function loadConfig() {
  let txt = '';
  try { txt = fs.readFileSync(CONFIG_PATH, 'utf8'); }
  catch { console.error('missing config.env - copy config.env.example and fill it in'); process.exit(1); }
  const cfg = {};
  for (const line of txt.split('\n')) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (m) cfg[m[1]] = m[2].trim();
  }
  return cfg;
}
const CONFIG = loadConfig();
const BASE = CONFIG.THROUGHLINE_URL || (console.error('set THROUGHLINE_URL in config.env'), process.exit(1));
const PASSPHRASE = CONFIG.PASSPHRASE || (console.error('set PASSPHRASE in config.env'), process.exit(1));
const JAR_PATH = path.join(__dirname, '.gui-jar');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_BODY_BYTES = 200 * 1024; // ~200KB cap
const BLOCK_TEXT = 'sorry, blocked';

// --- Start the embedded "locked-down network" blocker, allowing only
// throughline's hostname through. This lets filter=on/proxy=on succeed
// while filter=on/proxy=off stays blocked.
const blockerServer = startBlocker({
  port: BLOCKER_PORT,
  allow: [new URL(BASE).hostname],
});

// --- Log in to throughline once at startup to create a cookie jar.
function login(cb) {
  execFile(
    'curl',
    ['-s', '-c', JAR_PATH, '-d', `key=${PASSPHRASE}`, `${BASE}/login`, '-o', '/dev/null'],
    (err) => {
      if (err) {
        console.error('login failed:', err.message);
      } else {
        console.error('logged in to throughline, cookie jar at', JAR_PATH);
      }
      if (cb) cb();
    }
  );
}

function tmpFile(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(8).toString('hex')}.tmp`);
}

function readCapped(filePath, maxBytes) {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      const len = Math.min(stat.size, maxBytes);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      return { text: buf.toString('utf8'), truncated: stat.size > maxBytes };
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    return { text: '', truncated: false };
  }
}

function parseStatusFromHeaders(headerText) {
  // Header file may contain multiple response blocks (e.g. a CONNECT
  // response followed by the tunneled response). Take the status code
  // from the LAST "HTTP/x.x NNN ..." status line.
  const matches = [...headerText.matchAll(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/gim)];
  if (matches.length === 0) return 0;
  return Number(matches[matches.length - 1][1]);
}

function parseContentTypeFromHeaders(headerText) {
  const matches = [...headerText.matchAll(/^content-type:\s*(.+)$/gim)];
  if (matches.length === 0) return '';
  return matches[matches.length - 1][1].trim();
}

function runTry(targetUrl, filterOn, proxyOn, done) {
  const bodyFile = tmpFile('gui-body');
  const headerFile = tmpFile('gui-headers');

  let curlUrl;
  if (proxyOn) {
    curlUrl = `${BASE}/raw?url=${encodeURIComponent(targetUrl)}`;
  } else {
    curlUrl = targetUrl;
  }

  const args = ['-s', '-o', bodyFile, '-D', headerFile, '-w', '%{http_code}', '--max-time', '15'];

  if (filterOn) {
    args.push('-x', `http://localhost:${BLOCKER_PORT}`, '--proxy-insecure');
  }
  if (proxyOn) {
    args.push('-b', JAR_PATH);
  }
  args.push(curlUrl);

  execFile('curl', args, { timeout: 20000 }, (err, stdout) => {
    const httpCodeFromW = (stdout || '').trim();
    const { text: headerText } = readCapped(headerFile, 64 * 1024);
    const { text: bodyText, truncated } = readCapped(bodyFile, MAX_BODY_BYTES);

    // Cleanup temp files.
    fs.unlink(bodyFile, () => {});
    fs.unlink(headerFile, () => {});

    let status = Number(httpCodeFromW);
    if (!status || httpCodeFromW === '000') {
      status = parseStatusFromHeaders(headerText);
    }

    const contentType = parseContentTypeFromHeaders(headerText);

    let body = bodyText;
    const curlFailed = !!err;
    let blocked = body.trim() === BLOCK_TEXT || curlFailed;

    if (blocked && !body) {
      // curl's CONNECT-tunnel handling discards the proxy's response body
      // on a failed tunnel, so there's nothing to show — synthesize the
      // block message for a consistent UI.
      body = BLOCK_TEXT;
    }

    const ok = !blocked && status >= 200 && status < 400;

    done({
      ok,
      status: status || 0,
      blocked,
      contentType,
      body: truncated ? body + '\n\n[...truncated]' : body,
    });
  });
}

function sendJson(res, statusCode, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^(\.\.[/\\])+/, ''));

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://localhost:${GUI_PORT}`);

  if (parsed.pathname === '/try') {
    const targetUrl = parsed.searchParams.get('url') || 'https://example.com';
    const filterOn = (parsed.searchParams.get('filter') || 'off') === 'on';
    const proxyOn = (parsed.searchParams.get('proxy') || 'off') === 'on';

    runTry(targetUrl, filterOn, proxyOn, (result) => {
      sendJson(res, 200, result);
    });
    return;
  }

  serveStatic(req, res, parsed.pathname);
});

login(() => {
  server.listen(GUI_PORT, () => {
    console.error(`gui.js listening on http://localhost:${GUI_PORT}`);
    console.error(`(embedded blocker on port ${BLOCKER_PORT}, ALLOW=${new URL(BASE).hostname})`);
  });
});

function shutdown() {
  server.close();
  blockerServer.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
