/* Turning a page's own links back through the proxy.

   Every URL a browser would otherwise fetch straight from the target — a
   stylesheet, an image, the next page a link points at — has to be bent back
   onto /b/ so it comes through here too. Anything missed loads directly from
   the real host, which both breaks (the network may block it) and leaks (the
   host sees the browser). HTMLRewriter does this on the response stream, so a
   large page is never held in memory. */

const CSS_TRANSFORM_CAP = 2 * 1024 * 1024; // rewrite CSS under this; stream the rest untouched

/* /b/<absolute-url>. The target is glued on whole and left readable; only the
   few characters that would change how the path itself parses are encoded. */
export function proxyPath(origin, absolute) {
  return `${origin}/b/${encodeReadable(absolute)}`;
}

function encodeReadable(target) {
  return String(target).replace(/[\s"'<>`{}\\^|#?]/g, (c) => encodeURIComponent(c))
    .replace(/#/g, '%23'); // keep a real fragment/query on the target, not on our path
}

/* Resolve a possibly-relative URL against the page's final URL and, if it is
   http(s), route it through the proxy. Data/mailto/blob/etc. are left alone. */
function rewriteURL(value, base, origin) {
  if (!value) return value;
  const v = value.trim();
  if (/^(data|mailto|tel|javascript|blob|about|#):?/i.test(v) || v.startsWith('#')) return value;
  let abs;
  try {
    abs = new URL(v, base);
  } catch {
    return value;
  }
  if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return value;
  return proxyPath(origin, abs.toString());
}

/* srcset is a comma-separated list of "url descriptor" pairs. */
function rewriteSrcset(value, base, origin) {
  return value.split(',').map((part) => {
    const seg = part.trim();
    if (!seg) return seg;
    const sp = seg.indexOf(' ');
    const url = sp === -1 ? seg : seg.slice(0, sp);
    const desc = sp === -1 ? '' : seg.slice(sp);
    return rewriteURL(url, base, origin) + desc;
  }).join(', ');
}

/* CSS url(...) and @import "...". Used for <style> blocks, style="" attributes
   and standalone stylesheets. */
export function rewriteCSS(css, base, origin) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url(${q}${rewriteURL(u, base, origin)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${rewriteURL(u, base, origin)}${q}`);
}

/* The client-side half. document.cookie is namespaced the same way the Worker
   namespaces Set-Cookie, and fetch/XHR/form targets are pushed through /b/ so
   script-driven navigation stays inside the proxy. Best-effort by nature. */
function shim(origin, base) {
  return `<script>(function(){
  var O=${JSON.stringify(origin)},B=${JSON.stringify(base)};
  function abs(u){try{return new URL(u,B).toString()}catch(e){return null}}
  function px(u){if(u==null)return u;u=String(u);
    if(/^(data|mailto|tel|javascript|blob|about):/i.test(u)||u[0]=='#')return u;
    if(u.indexOf(O+'/b/')===0)return u;var a=abs(u);
    if(!a||!/^https?:/i.test(a))return u;return O+'/b/'+a}
  var of=window.fetch;
  window.fetch=function(i,init){try{if(typeof i==='string')i=px(i);
    else if(i&&i.url)i=new Request(px(i.url),i)}catch(e){}return of.call(this,i,init)};
  var op=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){try{u=px(u)}catch(e){}return op.apply(this,[m,u].concat([].slice.call(arguments,2)))};
  document.addEventListener('submit',function(e){var f=e.target;if(!f||!f.action)return;
    if(f.method&&f.method.toLowerCase()==='get')return; // GET forms are fine once action= is rewritten
    try{f.action=px(f.action)}catch(x){}},true);
}())</script>`;
}

/* Rewrite an HTML response stream. `base` is the target's final URL; `origin`
   is the Worker's own origin. */
export function rewriteHTML(response, base, origin) {
  const rewriter = new HTMLRewriter()
    .on('a, area', attr('href', base, origin))
    .on('img, source, input, track, embed', attr('src', base, origin))
    .on('img, source', srcsetAttr(base, origin))
    .on('script', attr('src', base, origin))
    .on('iframe, frame', attr('src', base, origin))
    .on('link', attr('href', base, origin))
    .on('form', attr('action', base, origin))
    .on('video, audio', attr('src', base, origin))
    .on('object', attr('data', base, origin))
    .on('[style]', styleAttr(base, origin))
    .on('style', cssBlock(base, origin))
    // Base tags would re-anchor every relative URL to the real host, undoing
    // the rewrite; drop them and let our own resolution stand.
    .on('base', { element(el) { el.remove(); } })
    // Inject the client-side shim as the first thing in <head>.
    .on('head', { element(el) { el.prepend(shim(origin, base), { html: true }); } });

  return rewriter.transform(response);
}

function attr(name, base, origin) {
  return {
    element(el) {
      const v = el.getAttribute(name);
      if (v != null) el.setAttribute(name, rewriteURL(v, base, origin));
      // srcset handled separately; integrity/nonce break once bytes change.
      el.removeAttribute('integrity');
      el.removeAttribute('nonce');
    },
  };
}

function srcsetAttr(base, origin) {
  return {
    element(el) {
      const v = el.getAttribute('srcset');
      if (v != null) el.setAttribute('srcset', rewriteSrcset(v, base, origin));
    },
  };
}

function styleAttr(base, origin) {
  return {
    element(el) {
      const v = el.getAttribute('style');
      if (v != null) el.setAttribute('style', rewriteCSS(v, base, origin));
    },
  };
}

function cssBlock(base, origin) {
  let buf = '';
  return {
    text(t) {
      buf += t.text;
      if (t.lastInTextNode) {
        t.replace(rewriteCSS(buf, base, origin), { html: false });
        buf = '';
      } else {
        t.remove();
      }
    },
  };
}

export { CSS_TRANSFORM_CAP };
