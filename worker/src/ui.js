/* The page served at /. Deliberately plain and unlabelled: no product name in
   the title, no mention of what it does, so a stray visitor or a scanner sees
   a bare form and nothing worth reporting. When the session cookie is valid it
   shows an address bar; otherwise a passphrase field that POSTs to /login. */

export function page({ authed }) {
  const body = authed ? addressBar() : loginForm();
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow">
<title>·</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;
  font:16px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;
  background:#f6f6f7;color:#18181b}
@media(prefers-color-scheme:dark){body{background:#0e0e11;color:#e8e8ea}}
main{width:min(560px,92vw);padding:28px}
form{display:flex;gap:8px}
input{flex:1;min-width:0;padding:12px 14px;font-size:16px;border:1px solid #0002;border-radius:10px;
  background:#fff;color:inherit}
@media(prefers-color-scheme:dark){input{background:#17171b;border-color:#fff2}}
button{padding:12px 18px;font-size:16px;border:0;border-radius:10px;background:#3f3f46;color:#fff;cursor:pointer}
button:hover{background:#27272a}
.err{margin:10px 2px 0;color:#b91c1c;font-size:14px;min-height:1em}
@media(prefers-color-scheme:dark){.err{color:#f87171}}
.dot{width:10px;height:10px;border-radius:50%;background:#3f3f46;margin:0 auto 22px}
</style></head><body><main>
<div class="dot"></div>
${body}
</main></body></html>`;
}

function loginForm() {
  return `<form method="POST" action="/login">
  <input type="password" name="key" autofocus autocomplete="current-password" placeholder="key" aria-label="key">
  <button type="submit">→</button>
</form>
<p class="err" id="e"></p>
<script>
if(location.search.indexOf('bad')>-1)document.getElementById('e').textContent='Wrong key.';
</script>`;
}

/* The in-browser test env. Two toggles and a URL; the result flips between
   "sorry, blocked" and the real page. Talks to /demo/try, which carries the
   same session cookie automatically. */
export function demoPage() {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow">
<title>· test</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;padding:24px;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;
  background:#f6f6f7;color:#18181b}
@media(prefers-color-scheme:dark){body{background:#0e0e11;color:#e8e8ea}}
main{max-width:760px;margin:0 auto}
h1{font-size:18px;margin:0 0 4px}
.sub{color:#71717a;font-size:13px;margin:0 0 20px}
.row{display:flex;gap:8px;margin-bottom:14px}
input[type=text]{flex:1;min-width:0;padding:11px 13px;font-size:15px;border:1px solid #0002;border-radius:9px;background:#fff;color:inherit}
@media(prefers-color-scheme:dark){input[type=text]{background:#17171b;border-color:#fff2}}
button{padding:11px 18px;font-size:15px;border:0;border-radius:9px;background:#3f3f46;color:#fff;cursor:pointer}
button:hover{background:#27272a}
.toggles{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.tog{flex:1;min-width:200px;border:1px solid #0002;border-radius:10px;padding:12px 14px;background:#fff;cursor:pointer;user-select:none}
@media(prefers-color-scheme:dark){.tog{background:#17171b;border-color:#fff2}}
.tog.on{border-color:#2563eb;box-shadow:inset 0 0 0 1px #2563eb}
.tog b{display:block}
.tog span{font-size:12px;color:#71717a}
.tog .state{float:right;font-size:12px;font-weight:600}
.tog.on .state{color:#2563eb}
.explain{font-size:13px;color:#52525b;margin:0 0 14px;min-height:1.4em}
@media(prefers-color-scheme:dark){.explain{color:#a1a1aa}}
.verdict{font-weight:700;padding:10px 14px;border-radius:9px;margin-bottom:10px;display:none}
.verdict.blocked{display:block;background:#fee2e2;color:#991b1b}
.verdict.ok{display:block;background:#dcfce7;color:#166534}
@media(prefers-color-scheme:dark){.verdict.blocked{background:#450a0a;color:#fca5a5}.verdict.ok{background:#052e16;color:#86efac}}
iframe,.text{width:100%;min-height:320px;border:1px solid #0002;border-radius:10px;background:#fff}
.text{padding:12px;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,monospace;overflow:auto;max-height:60vh}
.note{font-size:12px;color:#a1a1aa;margin-top:16px}
a{color:#2563eb}
</style></head><body><main>
<h1>test bench</h1>
<p class="sub">See what a locked-down network does to a link, with the proxy off and on. <a href="/">← back</a></p>

<div class="row">
  <input id="u" type="text" value="https://example.com" spellcheck="false" autocapitalize="off">
  <button onclick="go()">try it</button>
</div>

<div class="toggles">
  <div class="tog on" id="tf" onclick="tog('f')">
    <span class="state">ON</span><b>Network filter</b>
    <span>a locked-down network that blocks everything (simulated)</span>
  </div>
  <div class="tog" id="tp" onclick="tog('p')">
    <span class="state">OFF</span><b>Use throughline proxy</b>
    <span>route the request through this proxy instead of direct</span>
  </div>
</div>

<p class="explain" id="ex"></p>
<div class="verdict" id="v"></div>
<div id="out"></div>

<p class="note">The filter here is simulated — this page can't sit behind your real network, so "Network filter ON + proxy OFF" stands in for a site your network blocks. The rigorous version, which routes real traffic through a proxy that refuses everything, is <code>test/run.sh</code> in the repo.</p>

<script>
var st={f:true,p:false};
function tog(k){st[k]=!st[k];render();}
function render(){
  document.getElementById('tf').className='tog'+(st.f?' on':'');
  document.getElementById('tp').className='tog'+(st.p?' on':'');
  document.getElementById('tf').querySelector('.state').textContent=st.f?'ON':'OFF';
  document.getElementById('tp').querySelector('.state').textContent=st.p?'ON':'OFF';
  var e;
  if(st.f&&!st.p)e='Filter ON, proxy OFF → the network blocks direct access.';
  else if(st.f&&st.p)e='Filter ON, proxy ON → the request rides through throughline, which the filter lets past.';
  else if(!st.f&&!st.p)e='Filter OFF, proxy OFF → ordinary direct access.';
  else e='Filter OFF, proxy ON → direct access, but through the proxy anyway.';
  document.getElementById('ex').textContent=e;
}
async function go(){
  var u=document.getElementById('u').value.trim();if(!u)return;
  if(!/^https?:\\/\\//i.test(u))u='https://'+u;
  var v=document.getElementById('v'),out=document.getElementById('out');
  v.className='verdict';v.textContent='';out.innerHTML='<div class="text">…</div>';
  try{
    var r=await fetch('/demo/try?url='+encodeURIComponent(u)+'&filter='+(st.f?'on':'off')+'&proxy='+(st.p?'on':'off'));
    var d=await r.json();
    if(d.blocked){v.className='verdict blocked';v.textContent='⨯ blocked — '+(d.body||'sorry, blocked');out.innerHTML='';return;}
    v.className='verdict ok';v.textContent='✓ reachable — HTTP '+d.status+(d.via?' (via '+d.via+')':'');
    if(d.contentType&&d.contentType.indexOf('text/html')>-1){
      var f=document.createElement('iframe');f.setAttribute('sandbox','');f.srcdoc=d.body;out.innerHTML='';out.appendChild(f);
    }else{
      var t=document.createElement('div');t.className='text';t.textContent=d.body||'';out.innerHTML='';out.appendChild(t);
    }
  }catch(e){v.className='verdict blocked';v.textContent='error: '+e.message;out.innerHTML='';}
}
render();
</script>
</main></body></html>`;
}

function addressBar() {
  return `<form id="go" onsubmit="return nav(event)">
  <input id="u" type="text" inputmode="url" autofocus autocapitalize="off" autocorrect="off"
    spellcheck="false" placeholder="type a link or a search" aria-label="address">
  <button type="submit">go</button>
</form>
<p class="err" id="e"></p>
<p style="text-align:center;margin-top:18px"><a href="/demo" style="color:#71717a;font-size:13px">test bench →</a></p>
<script>
function nav(e){e.preventDefault();
  var v=document.getElementById('u').value.trim();if(!v)return false;
  var url;
  if(/^https?:\\/\\//i.test(v))url=v;
  else if(/^[a-z0-9.-]+\\.[a-z]{2,}(\\/|$|\\?|#)/i.test(v))url='https://'+v;
  else url='https://duckduckgo.com/?q='+encodeURIComponent(v);
  location.href='/b/'+url;return false}
</script>`;
}
