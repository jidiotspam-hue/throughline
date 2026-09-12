#!/usr/bin/env node
'use strict';
/**
 * blocker.js — a "block everything" forward proxy.
 *
 * Simulates a locked-down network: refuses every destination by default,
 * except hostnames listed in the ALLOW env var (comma-separated), which
 * are proxied/tunneled normally.
 *
 * Usage:
 *   node blocker.js                # blocks everything, port 8100
 *   PORT=8100 ALLOW=example.com node blocker.js
 *
 * Also exports start(opts) -> server for programmatic use.
 */

const http = require('http');
const net = require('net');
const { URL } = require('url');

const BLOCK_BODY = 'sorry, blocked';

function parseAllowList(allowEnv) {
  return new Set(
    (allowEnv || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isAllowed(hostname, allowSet) {
  if (!hostname) return false;
  return allowSet.has(hostname.toLowerCase());
}

function start(opts = {}) {
  const port = opts.port !== undefined ? opts.port : (process.env.PORT ? Number(process.env.PORT) : 8100);
  const allowSet = opts.allow ? new Set(opts.allow.map((s) => s.toLowerCase())) : parseAllowList(process.env.ALLOW);

  const server = http.createServer((req, res) => {
    // Plain HTTP forward-proxy request. req.url is an absolute URL like
    // "http://example.com/path" when the client is configured to use this
    // as an HTTP proxy.
    let target;
    try {
      target = new URL(req.url);
    } catch (e) {
      // Not an absolute URL (maybe a direct hit on the proxy itself).
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad request');
      return;
    }

    const hostname = target.hostname;

    if (!isAllowed(hostname, allowSet)) {
      process.stderr.write(`BLOCK ${hostname}\n`);
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end(BLOCK_BODY);
      return;
    }

    process.stderr.write(`ALLOW ${hostname}\n`);

    const proxyReqOpts = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers: req.headers,
    };

    const proxyReq = http.request(proxyReqOpts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      res.end(`proxy error: ${err.message}`);
    });

    req.pipe(proxyReq);
  });

  server.on('connect', (req, clientSocket, head) => {
    // Avoid crashing the process if the client resets the connection
    // (e.g. right after we send a 403 and close).
    clientSocket.on('error', () => {});

    // CONNECT host:port HTTP/1.1  — used for HTTPS tunnels.
    const [hostname, portStr] = req.url.split(':');
    const targetPort = Number(portStr) || 443;

    if (!isAllowed(hostname, allowSet)) {
      process.stderr.write(`BLOCK ${hostname}\n`);
      // Use end() (not write()+destroy()) so the response is flushed to the
      // socket before the connection is torn down.
      clientSocket.end(
        'HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: ' +
          Buffer.byteLength(BLOCK_BODY) +
          '\r\nConnection: close\r\n\r\n' +
          BLOCK_BODY
      );
      return;
    }

    process.stderr.write(`ALLOW ${hostname}\n`);

    const serverSocket = net.connect(targetPort, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', () => {
      try {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      } catch (e) {
        /* ignore */
      }
      clientSocket.destroy();
    });

    clientSocket.on('error', () => {
      serverSocket.destroy();
    });
  });

  server.listen(port, () => {
    process.stderr.write(
      `blocker.js listening on port ${port}, ALLOW=[${[...allowSet].join(', ')}]\n`
    );
  });

  return server;
}

module.exports = { start, isAllowed, parseAllowList };

if (require.main === module) {
  start();
}
