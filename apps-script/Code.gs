/**
 * reach check — a network probe you can actually run on a managed Chromebook.
 *
 * A locked-down device often blocks file://, so a downloaded HTML page cannot
 * run, and GitHub Pages may be blocked too. Apps Script gets around that: it
 * serves a real page from a Google origin, and the JavaScript in it runs in
 * YOUR browser on YOUR network — which is the only place a useful answer about
 * what your network blocks can come from.
 *
 * Deploy:  Deploy > New deployment > Web app
 *          Execute as: Me       Who has access: Only myself
 * Then open the /exec URL it gives you.
 */

function doGet() {
  return HtmlService.createHtmlOutput(PAGE)
    .setTitle('reach check')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Server-side fetch, for comparison. This runs from Google's network, NOT
 * yours, so a host that answers here but fails in the browser test above is
 * one your network is blocking rather than one that is down.
 */
function serverProbe(url) {
  try {
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: false,
      validateHttpsCertificates: true,
      headers: { 'User-Agent': 'Mozilla/5.0 reach-check' }
    });
    return { ok: true, code: res.getResponseCode() };
  } catch (err) {
    return { ok: false, code: 0, error: String(err).slice(0, 120) };
  }
}

var PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;margin:0;padding:20px;
 background:#f6f6f7;color:#18181b}
@media(prefers-color-scheme:dark){body{background:#0e0e11;color:#e8e8ea}}
h1{font-size:16px;margin:0 0 3px}
p.s{margin:0 0 16px;color:#71717a;font-size:13px}
textarea{width:100%;height:58px;padding:10px;border-radius:9px;border:1px solid #0003;
 font-family:ui-monospace,monospace;font-size:12px;background:#fff;color:inherit}
@media(prefers-color-scheme:dark){textarea{background:#17171b;border-color:#fff3}}
button{padding:11px 16px;border:0;border-radius:9px;background:#3f3f46;color:#fff;font-size:15px;
 cursor:pointer;font-family:inherit;margin-top:9px}
button.g{background:transparent;color:inherit;border:1px solid #0003}
ul{list-style:none;padding:0;margin:16px 0 0}
li{display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #0000001a;font-size:13px}
.m{width:1.4em;text-align:center;font-weight:700}
.u{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
 font-family:ui-monospace,monospace;font-size:12px}
.ok .m{color:#15803d}.no .m{color:#b91c1c}.wait .m{color:#71717a}
@media(prefers-color-scheme:dark){.ok .m{color:#86efac}.no .m{color:#fca5a5}}
.note{font-size:12px;color:#71717a;margin-top:14px}
#out{width:100%;height:150px;margin-top:10px;display:none}
</style></head><body>
<h1>reach check</h1>
<p class="s">Tests, from this browser on this network, which hosts you can actually open.</p>

<textarea id="extra" spellcheck="false" placeholder="extra URLs to test, one per line"></textarea>
<div>
  <button id="run">Run check</button>
  <button id="copy" class="g">Copy results</button>
</div>
<ul id="r"></ul>
<textarea id="out" spellcheck="false"></textarea>
<p class="note">A tick means your browser could open a connection to that host.
A cross usually means your network is blocking it. <b>example.com</b> is the
control: if that fails too, the test itself is being blocked, not those sites.</p>

<script>
var BUILTIN = [
  'https://example.com/',
  'https://parish-motorola-shaft-counters.trycloudflare.com/',
  'https://throughline.dropline.workers.dev/',
  'https://vercel.app/','https://deno.dev/','https://netlify.app/',
  'https://onrender.com/','https://pages.dev/','https://val.run/',
  'https://railway.app/','https://fly.dev/','https://glitch.me/',
  'https://invidious.nerdvpn.de/','https://inv.nadeko.net/'
];

function probe(url, ms) {
  return new Promise(function (resolve) {
    var done = false;
    var t = setTimeout(function(){ if(!done){done=true;resolve(false);} }, ms||9000);
    fetch(url, { mode:'no-cors', cache:'no-store' })
      .then(function(){ if(!done){done=true;clearTimeout(t);resolve(true);} })
      .catch(function(){ if(!done){done=true;clearTimeout(t);resolve(false);} });
  });
}

function list() {
  var out = BUILTIN.slice();
  document.getElementById('extra').value.split(/[\\s,]+/).forEach(function(v){
    v=v.trim(); if(!v) return;
    if(!/^https?:\\/\\//i.test(v)) v='https://'+v;
    out.push(v);
  });
  return out;
}

var results = [];

document.getElementById('run').onclick = async function () {
  var ul=document.getElementById('r'); ul.innerHTML=''; results=[];
  var urls=list(), rows=[];
  urls.forEach(function(u){
    var li=document.createElement('li'); li.className='wait';
    li.innerHTML='<span class="m">.</span><span class="u"></span>';
    li.querySelector('.u').textContent=u; ul.appendChild(li); rows.push(li);
  });
  for (var i=0;i<urls.length;i++){
    var ok = await probe(urls[i]);
    rows[i].className = ok?'ok':'no';
    rows[i].querySelector('.m').textContent = ok?'\\u2713':'\\u2717';
    results.push((ok?'OK   ':'BLOCK')+'  '+urls[i]);
  }
};

document.getElementById('copy').onclick = function(){
  var o=document.getElementById('out');
  o.style.display='block';
  o.value=results.join('\\n')||'(run the check first)';
  o.select();
  try{ document.execCommand('copy'); }catch(e){}
};
</script></body></html>`;
