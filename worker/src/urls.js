/* Which URLs we are willing to touch, and how a reader link is taken apart.

   This worker fetches whatever a stranger names, so the guard here is the
   whole security story. Everything is pure — no fetch, no globals — so it can
   be tested under plain `node --test`. */

const SCHEMES = new Set(['http:', 'https:']);

// Names that resolve somewhere on the machine or inside the cloud fabric.
const BLOCKED_NAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.onion'];

/* A hostname that is really an address can be written a dozen ways —
   127.0.0.1, 2130706433, 0x7f.1, 017700000001 — and every one of them reaches
   the loopback. Normalising to a 32-bit integer collapses all of them, which
   is the only way to block the set rather than the spelling. */
export function ipv4ToInt(host) {
  const parts = host.split('.');
  if (parts.length === 0 || parts.length > 4) return null;

  const nums = [];
  for (const part of parts) {
    if (part === '') return null;
    let n;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) n = parseInt(part, 16);
    else if (/^0[0-7]+$/.test(part)) n = parseInt(part, 8);
    else if (/^[0-9]+$/.test(part)) n = parseInt(part, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }

  // The last part absorbs every octet the earlier ones did not name, so
  // "10.1" is 10.0.0.1 and a bare "2130706433" is the whole address.
  const last = nums.pop();
  if (last >= 2 ** (8 * (4 - nums.length))) return null;
  if (nums.some((n) => n > 255)) return null;

  let value = last;
  for (let i = nums.length - 1, shift = 8 * (4 - nums.length); i >= 0; i--, shift += 8) {
    value += nums[i] * 2 ** shift;
  }
  return value >>> 0;
}

function isPrivateIPv4(value) {
  const oct = [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  const [a, b] = oct;
  return (
    a === 0 ||                              // 0.0.0.0/8, "this network"
    a === 10 ||                             // private
    a === 127 ||                            // loopback
    (a === 100 && b >= 64 && b <= 127) ||   // carrier-grade NAT
    (a === 169 && b === 254) ||             // link-local, incl. the metadata IP
    (a === 172 && b >= 16 && b <= 31) ||    // private
    (a === 192 && b === 0) ||               // IETF protocol assignments
    (a === 192 && b === 168) ||             // private
    (a === 198 && (b === 18 || b === 19)) ||// benchmarking
    a >= 224                                // multicast and reserved
  );
}

function isPrivateIPv6(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (/^f[cd]/.test(h)) return true;                 // unique local
  if (/^fe[89ab]/.test(h)) return true;              // link local
  /* ::ffff:127.0.0.1 smuggles a v4 address through a v6 literal — and the URL
     parser rewrites it to ::ffff:7f00:1 on the way in, so both spellings of
     the tail have to be understood. */
  const mapped = /^::ffff:(.+)$/.exec(h);
  if (mapped) {
    const tail = mapped[1];
    const v = tail.includes('.') ? ipv4ToInt(tail) : hexGroupsToInt(tail);
    return v === null || isPrivateIPv4(v);
  }
  return false;
}

function hexGroupsToInt(tail) {
  const groups = tail.split(':');
  if (groups.length > 2 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const [hi, lo] = groups.length === 2 ? groups : ['0', groups[0]];
  return ((parseInt(hi, 16) * 65536) + parseInt(lo, 16)) >>> 0;
}

/* Returns a URL object, or throws with a message meant for a human. */
export function checkTarget(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new BadTarget('That does not parse as a URL.');
  }

  if (!SCHEMES.has(url.protocol)) {
    throw new BadTarget(`Only http and https links can be read, not ${url.protocol.replace(':', '')}.`);
  }

  // Credentials in a URL are only ever an attempt to make the host read as
  // something it is not (https://music.apple.com@evil.example/).
  if (url.username || url.password) {
    throw new BadTarget('Links with a username or password in them are not read.');
  }

  const host = url.hostname.toLowerCase();
  if (!host) throw new BadTarget('That URL has no host.');

  if (BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new BadTarget('That host is not reachable from here.');
  }

  if (host.startsWith('[')) {
    if (isPrivateIPv6(host)) throw new BadTarget('That address is on a private network.');
  } else {
    const v4 = ipv4ToInt(host);
    if (v4 !== null && isPrivateIPv4(v4)) {
      throw new BadTarget('That address is on a private network.');
    }
    // A name with no dot cannot be public, so it is a search-domain lookup.
    if (v4 === null && !host.includes('.')) {
      throw new BadTarget('That host is not reachable from here.');
    }
  }

  return url;
}

export class BadTarget extends Error {}

/* Reserved query names. The raw form of a reader link glues the target on
   whole — query string and all — so our own options have to be spelled in a
   way no real site would use. */
export const RESERVED = ['__format', '__fresh'];

/* Pulls the target out of a reader request. Two shapes are accepted:

     /r/https://music.apple.com/us/album/x/1?i=2&__format=md
     /r?u=https%3A%2F%2Fmusic.apple.com%2F...&format=md

   The first reads well and is what people copy; the second is unambiguous
   and is what a script should build. */
export function parseReaderURL(requestURL) {
  const url = new URL(requestURL);
  const opts = { format: 'html', fresh: false };

  const explicit = url.searchParams.get('u') || url.searchParams.get('url');
  if (explicit) {
    opts.format = normaliseFormat(url.searchParams.get('__format') || url.searchParams.get('format'));
    opts.fresh = truthy(url.searchParams.get('__fresh') || url.searchParams.get('fresh'));
    return { target: explicit, ...opts };
  }

  let rest = url.pathname.replace(/^\/r\/?/, '');
  if (!rest) return { target: '', ...opts };

  // The path arrives percent-encoded per the URL spec; decoding gives back
  // whatever was appended, whether that was a raw or an encoded link.
  try { rest = decodeURIComponent(rest); } catch { /* keep the raw bytes */ }

  const params = new URLSearchParams(url.search);
  opts.format = normaliseFormat(params.get('__format'));
  opts.fresh = truthy(params.get('__fresh'));
  for (const name of RESERVED) params.delete(name);

  const query = params.toString();
  let target = query ? `${rest}?${query}` : rest;

  // A bare host is what people actually paste, so assume https rather than
  // rejecting it.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) target = `https://${target}`;

  return { target, ...opts };
}

function normaliseFormat(value) {
  const v = String(value || '').toLowerCase();
  return ['md', 'markdown', 'json', 'txt', 'text'].includes(v)
    ? ({ markdown: 'md', text: 'txt' }[v] || v)
    : 'html';
}

function truthy(value) {
  return value === '' || value === '1' || value === 'true';
}

/* The link we hand back. Kept raw and readable on purpose: the target stays
   legible inside it, so a person can see what they are about to share. */
export function readerLink(origin, target) {
  return `${origin.replace(/\/$/, '')}/r/${encodeReadable(target)}`;
}

/* Percent-encoding everything would turn the tail into noise. Encode only
   what would otherwise change how the reader link itself parses. */
function encodeReadable(target) {
  return String(target).replace(/[\s"'<>`{}\\^|]/g, (c) => encodeURIComponent(c));
}
