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

function addressBar() {
  return `<form id="go" onsubmit="return nav(event)">
  <input id="u" type="text" inputmode="url" autofocus autocapitalize="off" autocorrect="off"
    spellcheck="false" placeholder="type a link or a search" aria-label="address">
  <button type="submit">go</button>
</form>
<p class="err" id="e"></p>
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
