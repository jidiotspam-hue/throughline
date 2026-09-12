/* Fetching someone else's page, for a proxy that streams rather than reads.

   readline's fetcher buffered a capped amount of text and pulled metadata out
   of it. A proxy is a different job: the bytes belong to the browser, whatever
   they are and however many, so this returns the live Response with its body
   stream intact and never calls .text()/.arrayBuffer(). The one thing kept
   whole from readline is the discipline of following redirects by hand and
   re-checking every hop against the SSRF guard. */

import { checkTarget, BadTarget } from './urls.js';

const MAX_REDIRECTS = 8;
const TIMEOUT_MS = 20000;

/* Chrome on macOS. A great many sites serve a stub or a 403 to anything that
   does not look like a browser, so this is the default identity unless the
   caller's own request already carried one. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* Request headers worth carrying from the browser to the target. The rest are
   dropped — hop-by-hop headers, our own cookie, and anything naming the Worker
   origin would only confuse the far end or leak where the request came from. */
const FORWARD_REQUEST_HEADERS = [
  'accept', 'accept-language', 'content-type', 'range', 'cookie',
];

export class FetchProblem extends Error {
  constructor(message, { status = 0, finalURL = '' } = {}) {
    super(message);
    this.status = status;
    this.finalURL = finalURL;
  }
}

/* Follows redirects by hand and returns the final live Response together with
   the URL it ended at. `redirect: 'follow'` would happily walk from a public
   host onto 169.254.169.254 with the decisive hop invisible by the time the
   body came back, so every Location is re-parsed and re-guarded here.

   `method`, `body`, and selected headers are preserved so a POSTed form
   reaches the target intact. Per the fetch spec a 301/302/303 turns the method
   to GET and drops the body; 307/308 keep both — mirrored below. */
export async function proxyFetch(target, { method = 'GET', headers = {}, body = null, follow = true } = {}) {
  let url = checkTarget(target);
  let curMethod = method.toUpperCase();
  let curBody = body;
  const chain = [url.toString()];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await attempt(url, curMethod, curBody, buildHeaders(url, headers));

    const location = res.status >= 300 && res.status < 400 && res.headers.get('location');
    // Browsing hands the redirect back to the browser (so it re-enters through
    // /b/, updating its URL and carrying per-hop cookies). /raw and /cors follow
    // to the final bytes. Either way each hop is re-guarded below.
    if (!location || !follow) {
      return { response: res, finalURL: url.toString(), chain };
    }

    // A redirect body is never read; free it before the next hop.
    res.body?.cancel().catch(() => {});

    let next;
    try {
      next = new URL(location, url);
    } catch {
      throw new FetchProblem('That page redirected somewhere unparseable.', { finalURL: url.toString() });
    }
    url = checkTarget(next.toString());
    chain.push(url.toString());

    if (res.status === 301 || res.status === 302 || res.status === 303) {
      if (curMethod !== 'HEAD') curMethod = 'GET';
      curBody = null;
    }
  }

  throw new FetchProblem('That page redirects in a loop.', { finalURL: url.toString() });
}

function buildHeaders(url, incoming) {
  const h = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const v = incoming[name] ?? incoming[name.toLowerCase()];
    if (v) h.set(name, v);
  }
  if (!h.has('accept')) {
    h.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
  }
  if (!h.has('accept-language')) h.set('accept-language', 'en-US,en;q=0.9');
  h.set('user-agent', incoming['user-agent'] || incoming['User-Agent'] || UA);
  return h;
}

async function attempt(url, method, body, headers) {
  try {
    return await fetch(url.toString(), {
      method,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers,
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new FetchProblem('That page took too long to answer.', { finalURL: url.toString() });
    }
    throw new FetchProblem(`Could not reach ${url.hostname}. Check the address, or the site may be down.`, {
      finalURL: url.toString(),
    });
  }
}

export { BadTarget };
