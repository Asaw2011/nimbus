// Adam's stats dashboard, served at /dash. Asks for the DASH_KEY, keeps it in
// this tab only (sessionStorage), and reads /v1/stats. No libraries, no
// external requests (the page's CSP allows only this Worker).
// No backticks inside: this whole page is one template literal.

export const DASH_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nimbus Stats</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1b1f24;--mute:#667085;--line:#e4e7ec;--bar:#3b6fd8;--bar2:#9ab6ee;--ok:#2e7d4f}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--card:#1b1e23;--ink:#e8eaed;--mute:#98a2b3;--line:#2b3038;--bar:#6f9bff;--bar2:#3a4f7a;--ok:#5cc489}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:0 0 10px;color:var(--mute);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.sub{color:var(--mute);margin:0 0 20px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.kpi b{display:block;font-size:26px;font-variant-numeric:tabular-nums}.kpi span{color:var(--mute);font-size:12px}
.two{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:5px 6px;border-bottom:1px solid var(--line);text-align:left}
th{color:var(--mute);font-weight:600;font-size:12px}td.n,th.n{text-align:right}
.hbar{height:8px;background:var(--bar);border-radius:4px;min-width:2px}
svg text{fill:var(--mute);font-size:10px}
form{display:flex;gap:8px;flex-wrap:wrap}input{flex:1;min-width:200px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}
button{padding:8px 14px;border:0;border-radius:8px;background:var(--bar);color:#fff;cursor:pointer}
.err{color:#d14343;margin-top:8px}.note{color:var(--mute);font-size:12px}
</style></head><body><main>
<h1>Nimbus usage</h1>
<p class="sub">Anonymous daily counts. Random install IDs, fixed event words, no flow content.</p>
<div id="login" class="card"><form id="f"><input id="k" type="password" placeholder="Dashboard key" autocomplete="current-password"><button>Open</button></form><div id="err" class="err"></div></div>
<div id="out" hidden></div>
<script>
var $=function(s){return document.querySelector(s)};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function key(){try{return sessionStorage.getItem("k")||""}catch(e){return""}}
async function load(k){
  var r=await fetch("/v1/stats",{headers:{authorization:"Bearer "+k}});
  if(!r.ok){$("#err").textContent=r.status===401?"Wrong key.":"Could not load ("+r.status+").";return}
  try{sessionStorage.setItem("k",k)}catch(e){}
  $("#login").hidden=true;render(await r.json());
}
$("#f").onsubmit=function(e){e.preventDefault();load($("#k").value.trim())};
if(key())load(key());
function kpi(v,l){return '<div class="card kpi"><b>'+esc(v)+'</b><span>'+esc(l)+'</span></div>'}
function days(rows,field){
  var m={};rows.forEach(function(r){m[r.day]=r[field]||0});
  var out=[];for(var i=29;i>=0;i--){var d=new Date(Date.now()-i*864e5).toISOString().slice(0,10);out.push({day:d,v:m[d]||0})}
  return out;
}
function chart(pts){
  var W=960,H=150,max=Math.max(1,Math.max.apply(null,pts.map(function(p){return p.v}))),bw=W/pts.length;
  var s='<svg viewBox="0 0 '+W+' '+(H+18)+'" width="100%" role="img">';
  pts.forEach(function(p,i){var h=Math.round(p.v/max*H);
    s+='<rect x="'+(i*bw+2)+'" y="'+(H-h)+'" width="'+(bw-4)+'" height="'+h+'" rx="2" fill="var(--bar)"><title>'+p.day+': '+p.v+'</title></rect>';
    if(i%5===0||i===pts.length-1)s+='<text x="'+(i*bw+bw/2)+'" y="'+(H+13)+'" text-anchor="middle">'+p.day.slice(5)+'</text>'});
  s+='<text x="2" y="10">'+max+'</text></svg>';return s;
}
function bars(rows,label){
  var max=Math.max(1,Math.max.apply(null,rows.map(function(r){return r.users})));
  return '<table><tr><th>'+label+'</th><th class="n">Users</th><th style="width:40%"></th></tr>'+rows.map(function(r){
    return '<tr><td>'+esc(r.k)+'</td><td class="n">'+r.users+'</td><td><div class="hbar" style="width:'+(r.users/max*100)+'%"></div></td></tr>'}).join("")+'</table>';
}
function detail(p){try{var o=JSON.parse(p);return Object.keys(o).map(function(k){return esc(k)+": "+esc(o[k])}).join(", ")||"-"}catch(e){return"-"}}
function render(d){
  var a=d.active||{},rt=d.retention||{};
  var ret=rt.cohort?Math.round(rt.back/rt.cohort*100)+"%":"-";
  var h='<div class="grid">'+kpi(a.dau||0,"Active today")+kpi(a.wau||0,"Active, last 7 days")+kpi(a.mau||0,"Active, last 30 days")+kpi(a.ever||0,"Installs ever")+kpi(ret,"Back in week 2 ("+(rt.cohort||0)+" new)")+'</div>';
  h+='<div class="card"><h2>Daily active installs</h2>'+chart(days(d.daily,"users"))+'</div>';
  h+='<div class="two"><div class="card"><h2>Flows opened per day</h2>'+chart(days(d.daily,"flows"))+'</div>';
  h+='<div class="card"><h2>New installs per day</h2>'+chart(days(d.fresh,"installs"))+'</div></div>';
  h+='<div class="two"><div class="card"><h2>Versions, last 7 days</h2>'+bars(d.versions,"Version")+'</div><div class="card"><h2>OS, last 30 days</h2>'+bars(d.oses,"OS")+'</div></div>';
  var names={flow_open:"Flows opened",flow_close:"Flow length",feature:"Features used",send:"Sent to doc",sync:"Partner sync",setup:"Setup at launch"};
  var groups={};(d.events||[]).forEach(function(e){(groups[e.ev]=groups[e.ev]||[]).push(e)});
  h+='<div class="two">';
  Object.keys(names).forEach(function(ev){var g=groups[ev];if(!g)return;
    h+='<div class="card"><h2>'+names[ev]+', last 30 days</h2><table><tr><th>Detail</th><th class="n">Times</th><th class="n">Users</th></tr>'+g.map(function(e){
      return '<tr><td>'+detail(e.props)+'</td><td class="n">'+e.uses+'</td><td class="n">'+e.users+'</td></tr>'}).join("")+'</table></div>'});
  h+='</div><p class="note">Days are UTC. "Users" = distinct anonymous installs.</p>';
  $("#out").innerHTML=h;$("#out").hidden=false;
}
</script></main></body></html>`;
