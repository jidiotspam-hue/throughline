/**
 * reach check — find out what this network actually allows.
 *
 * A managed Chromebook blocks file://, so a downloaded page cannot run, and
 * GitHub Pages may be blocked too. Apps Script serves a real page from a
 * Google origin, while the JavaScript still runs in YOUR browser on YOUR
 * network — the only place a truthful answer can come from.
 *
 * Deploy > New deployment > Web app.  Execute as: Me.  Access: Only myself.
 */

function doGet() {
  return HtmlService.createHtmlOutput(PAGE).setTitle('reach check');
}

var PAGE = `<!DOCTYPE html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font:15px/1.5 system-ui,-apple-system,sans-serif;padding:16px;margin:0}
h3{margin:0 0 10px}
li{list-style:none;padding:6px 0;border-bottom:1px solid #0002;font-family:monospace;font-size:12px}
.ok{color:#15803d}.no{color:#b91c1c}
textarea{width:100%;height:90px;font-family:monospace;font-size:12px;padding:8px}
button{padding:10px 16px;font-size:15px;margin:8px 8px 0 0}
p{color:#666;font-size:12px}
</style>
<h3>reach check</h3>
<textarea id="x" placeholder="extra URLs to test, one per line"></textarea>
<button onclick="run()">Run check</button><button onclick="cp()">Copy results</button>
<ul id="r"></ul>
<textarea id="o" placeholder="results appear here"></textarea>
<p>example.com is the control. If it fails too, the test is blocked, not the sites.</p>
<script>
var L=['https://example.com/','https://trycloudflare.com/',
'https://throughline.dropline.workers.dev/','https://vercel.app/','https://deno.dev/',
'https://netlify.app/','https://onrender.com/','https://pages.dev/','https://val.run/',
'https://railway.app/','https://fly.dev/','https://invidious.nerdvpn.de/',
'https://inv.nadeko.net/','https://yewtu.be/','https://piped.video/'];
function p(u){return new Promise(function(r){var d=0,t=setTimeout(function(){if(!d){d=1;r(0)}},9000);
fetch(u,{mode:'no-cors',cache:'no-store'}).then(function(){if(!d){d=1;clearTimeout(t);r(1)}})
.catch(function(){if(!d){d=1;clearTimeout(t);r(0)}})})}
var out=[];
async function run(){var ul=document.getElementById('r');ul.innerHTML='';out=[];
var a=L.concat(document.getElementById('x').value.split(/[\\s,]+/).filter(Boolean)
.map(function(v){return /^https?:/.test(v)?v:'https://'+v}));
for(var i=0;i<a.length;i++){var li=document.createElement('li');
li.textContent='... '+a[i];ul.appendChild(li);
var ok=await p(a[i]);li.className=ok?'ok':'no';
li.textContent=(ok?'\\u2713 ':'\\u2717 ')+a[i];
out.push((ok?'OK    ':'BLOCK ')+a[i])}}
function cp(){var o=document.getElementById('o');o.value=out.join('\\n');
o.select();try{document.execCommand('copy')}catch(e){}}
</script>`;
