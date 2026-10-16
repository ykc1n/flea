const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = t => `${Math.floor((t || 0)/60)}:${String(Math.floor((t || 0)%60)).padStart(2,'0')}`;
const pretty = s => String(s || '').replace(/^factory/,'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./, c => c.toUpperCase());
let offset = 0, total = 0, requestId = 0, current, playback, cursor = 0, serviceStatus;
async function api(path) { const res = await fetch(path); if (!res.ok) throw Error((await res.json()).error || `Request failed (${res.status})`); return res.json(); }
function player(p) { return `<div class="player">${p.rankIcon ? `<img class="rank" src="${esc(p.rankIcon)}" alt="Rank ${esc(p.rank)}" title="Zero-K rank ${esc(p.rank)}">` : ''}<span>${esc(p.name)}</span></div>`; }
function firstFactories(r) {
  const values = Object.values(r.firstFactories || {}).map(f => pretty(f.unit));
  return values.length ? [...new Set(values)].join(' / ') : 'Awaiting analysis';
}
function stateLabel(r) { return ({ready:'● ANALYZED',queued:'◷ QUEUED',processing:'◌ PROCESSING',blocked:'! BLOCKED',failed:'! BLOCKED'})[r.status] || r.status; }
async function loadStatus() {
  serviceStatus = await api('/api/status');
  const counts = serviceStatus.counts;
  const sum = Object.values(counts).reduce((a,b) => a+b,0);
  $('#stats').innerHTML = `<div><span>REPLAYS INDEXED</span><strong>${sum.toLocaleString()}</strong></div><div><span>ANALYSIS COMPLETE</span><strong>${(counts.ready || 0).toLocaleString()}</strong></div><div><span>IN THE QUEUE</span><strong>${((counts.queued || 0)+(counts.processing || 0)).toLocaleString()}</strong></div><div><span>DISCOVERY INTERVAL</span><strong>01<span> hour</span></strong></div>`;
  $('#sync-label').textContent = serviceStatus.states.last_scrape ? 'Archive synced · hourly discovery' : 'Waiting for first discovery';
}
async function loadReplays() {
  const id = ++requestId;
  const q = new URLSearchParams({q:$('#search').value, mode:$('#mode').value,status:$('#status').value,offset});
  try {
    const data = await api(`/api/replays?${q}`);
    if (id !== requestId) return;
    total = data.total;
    $('#result-count').textContent = total;
    $('#replays').innerHTML = data.items.length ? data.items.map(r => `<button class="replay-card" data-replay="${r.id}" aria-label="Open replay ${r.id}: ${esc(r.map)}"><div class="map-cover">${r.mapImage ? `<img loading="lazy" src="${esc(r.mapImage)}" alt="${esc(r.map)} minimap">` : ''}<div class="map-top"><span class="badge">${esc(r.mode)}</span><span class="badge">${r.players.length} PLAYERS</span></div><div class="map-bottom"><span class="map-name">${esc(r.map)}</span><span class="time">${clock(r.duration)}</span></div></div><div class="card-content"><div class="match-id">BATTLE / ${r.id}${r.demo ? ' · DEMONSTRATION' : ''}</div><div class="players">${player(r.players[0] || {name:'Unknown player'})}<span class="vs">VS</span>${player(r.players.find(p=>p.team!==r.players[0]?.team) || r.players[1] || {name:'AI / opponents'})}${r.players.length>2 ? `<span class="vs">+${r.players.length-2}</span>` : ''}</div><div class="factory-line"><span>↳ FIRST FACTORY</span><strong>${esc(firstFactories(r))}</strong></div><div class="card-footer"><span>${esc(r.rating)}</span><span class="state-${esc(r.status)}">${stateLabel(r)}</span></div></div></button>`).join('') : `<div class="empty"><h3>${$('#search').value || $('#mode').value || $('#status').value ? 'No matching replays' : 'Your archive starts here.'}</h3><p>${total ? 'Try another filter.' : 'Run the ingestion service to discover Zero-K battles. Search results will appear here.'}</p><code>npm run worker -- --once</code></div>`;
    $('#page-label').textContent = total ? `${offset+1}–${Math.min(offset+24,total)} of ${total}` : '0 replays';
    $('#previous').disabled = offset===0; $('#next').disabled=offset+24>=total;
  } catch(e) { $('#replays').innerHTML=`<div class="empty"><h3>Archive unavailable</h3><p>${esc(e.message)}</p><button class="button" id="retry-load">Try again</button></div>`; }
}
function show(view) {
  clearInterval(playback); playback=null;
  for (const name of ['explorer','detail','pipeline']) $(`#${name}`).hidden = name!==view;
  $('#breadcrumb').textContent=({explorer:'Replay explorer',detail:'Match analysis',pipeline:'Ingestion pipeline'})[view];
  document.querySelectorAll('.nav-link').forEach(el=>el.classList.toggle('active',view==='pipeline' ? el.id==='pipeline-nav' : el.id!=='pipeline-nav'));
}
async function route() {
  if (location.hash==='#pipeline') return pipeline();
  const match = location.hash.match(/^#replay\/(\d+)$/);
  if (match) return detail(match[1]);
  show('explorer'); await Promise.all([loadReplays(),loadStatus().catch(()=>{})]);
}
async function detail(id) {
  show('detail'); $('#detail').innerHTML='<div class="empty">Loading match…</div>';
  try {
    const r=await api(`/api/replays/${id}`); current=r; cursor=0;
    const a=r.analysis;
    $('#detail').innerHTML=`<div class="detail-head"><a class="back-button" href="#">← Replay archive</a><div class="detail-title"><div><span class="eyebrow orange">BATTLE / ${r.id}${r.demo ? ' · DEMONSTRATION DATA' : ''}</span><h1>${esc(r.map)}</h1><div class="muted">${esc(r.mode)} · ${r.players.length} players · ${clock(r.duration)} · ${esc(r.game)} · Engine ${esc(r.engine)}</div></div><div class="links"><a class="button" href="${esc(r.source)}" target="_blank" rel="noreferrer">Zero-K match ↗</a>${r.download ? `<a class="button" href="${esc(r.download)}">Download replay ↓</a>`:''}</div></div></div>${r.demo ? '<p class="notice">Illustrative telemetry for interface exploration. This is not a processed real match.</p>' : ''}<div class="detail-layout"><div><div class="panel"><h3>Battlefield <span class="muted">/ movement explorer</span></h3><div class="map-stage">${r.mapImage ? `<img src="${esc(r.mapImage)}" alt="${esc(r.map)} minimap">`:''}<canvas id="movement-map" width="800" height="800" aria-label="Unit positions and recent movement trails"></canvas></div>${a ? `<div class="play-controls"><button class="button" id="play" aria-label="Play timeline">▶</button><input type="range" id="scrubber" aria-label="Timeline position" min="0" max="${a.duration}" value="0" step="1"><time id="cursor">0:00</time><select id="speed" aria-label="Playback speed"><option value="1">1×</option><option value="5">5×</option><option value="20" selected>20×</option></select></div><p class="muted">Positions sampled every 5 seconds. Trails show the last 30 seconds.</p>`:''}</div></div><div><div class="panel"><h3>Players & opening factories</h3>${r.players.map(p=>{const team=a && Object.entries(a.players).find(([,v])=>String(v.lobbyId)===String(p.id) || v.name===p.name)?.[0]; const f=team && a.firstFactories[team]; return `<div class="roster-row">${player(p)}<div><span class="muted">TEAM ${p.team} · RANK ${esc(p.rank)}</span><br>${f ? `${esc(pretty(f.unit))} <span class="muted">at ${clock(f.time)}</span>`:'<span class="muted">Opening not yet analyzed</span>'}</div></div>`;}).join('')}</div><div class="panel spaced"><h3>Unit production</h3>${a ? `<label class="muted">Team <select id="production-team" aria-label="Production team"><option value="">All teams</option>${Object.entries(a.players).map(([k,v])=>`<option value="${esc(k)}">${esc(v.name)}</option>`).join('')}</select></label><div id="production"></div>`:`<p class="muted">Production counts will appear after engine analysis.</p>`}</div></div></div>${a ? `<div class="panel"><h3>Match timeline <span class="muted">/ select an event to jump to it</span></h3><div class="timeline-filters"><select id="event-type" aria-label="Event type"><option value="">All events</option><option value="finished">Units produced</option><option value="created">Construction started</option><option value="destroyed">Units lost</option><option value="team_died">Team eliminated</option></select><select id="event-team" aria-label="Event team"><option value="">All teams</option>${Object.entries(a.players).map(([k,v])=>`<option value="${esc(k)}">${esc(v.name)}</option>`).join('')}</select><label class="search"><input id="event-search" type="search" placeholder="Find a unit or event…" aria-label="Search timeline"></label><button class="button" id="export">Export events ↓</button></div><div id="event-count" class="muted"></div><div id="events" class="event-list"></div></div>`:`<div class="notice ${r.status==='blocked'?'blocked-notice':''}"><strong>${r.status==='blocked'?'Replay cannot currently be processed':r.status==='processing'?'Reconstructing the match':'This replay is waiting for engine analysis.'}</strong><p>${r.error ? esc(r.error) : 'Players, ranks, map, and download are available. The worker will populate the timeline, factory openings, and movement traces after a complete engine export.'}</p><a href="#pipeline">View pipeline status ↗</a></div>`}<div class="archive-note"><p>Source: Zero-K battle archive. Rank badges are the values exposed by the battle page; no rating estimates are invented.</p></div>`;
    if(a) { renderProduction(); renderEvents(); drawMap(); }
  } catch(e) { $('#detail').innerHTML=`<div class="empty"><h3>Could not open replay</h3><p>${esc(e.message)}</p><a href="#">← Back to archive</a></div>`; }
}
function renderProduction() {
  const chosen=$('#production-team').value, counts={};
  current.analysis.production.filter(p=>!chosen || p.team===chosen).forEach(p=>counts[p.unit]=(counts[p.unit]||0)+p.count);
  const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]), max=sorted[0]?.[1] || 1;
  $('#production').innerHTML=sorted.length ? sorted.map(([u,n])=>`<div class="production-row"><span>${esc(pretty(u))}</span><div class="bar-track"><div class="bar-fill" data-width="${n/max*100}"></div></div><span>${n}</span></div>`).join(''):'<p class="muted">No completed units recorded.</p>';
  document.querySelectorAll('[data-width]').forEach(el=>el.style.width=`${el.dataset.width}%`);
}
function renderEvents() {
  const type=$('#event-type').value,team=$('#event-team').value,q=$('#event-search').value.toLowerCase();
  const events=current.analysis.events.filter(e=>(!type || e.type===type)&&(!team || String(e.team)===team)&&(!q || JSON.stringify(e).toLowerCase().includes(q)));
  $('#event-count').textContent=`${events.length} events${events.length>1000 ? ' · first 1,000 shown; narrow the filters to explore more':''}`;
  $('#events').innerHTML=events.slice(0,1000).map(e=>`<button class="event" data-time="${e.time}"><time>${clock(e.time)}</time><span>${esc(e.name || pretty(e.unit) || (e.type==='game_over'?'Game over':'Team eliminated'))}<br><span class="event-type">${esc(e.type.toUpperCase().replace('_',' '))} ${e.team!=null ? ' · '+esc(current.analysis.players[String(e.team)]?.name || 'Team '+e.team):''}</span></span><span class="muted">${e.factory?'FACTORY':''}</span></button>`).join('') || '<p class="muted">No events match your filters.</p>';
}
function setCursor(t) {cursor=Math.min(current.analysis.duration,Math.max(0,t));$('#scrubber').value=cursor;$('#cursor').textContent=clock(cursor);drawMap();}
function drawMap() {
  const a=current.analysis,canvas=$('#movement-map'),ctx=canvas.getContext('2d'),w=a.meta.mapWidth,h=a.meta.mapHeight;
  ctx.clearRect(0,0,800,800);
  const colors=['#ddf69b','#e99666','#83c6e0','#c5a5e8','#f0d878'];
  for(const [id,points] of Object.entries(a.movements)) {
    const history=points.filter(p=>p.time<=cursor),latest=history.at(-1);
    if(!latest || cursor-latest.time>10 || a.events.some(e=>e.type==='destroyed'&&String(e.unitId)===id&&e.time<=cursor))continue;
    const tail=history.filter(p=>p.time>=cursor-30);
    ctx.strokeStyle=colors[Math.abs(latest.team)%colors.length];ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=2;ctx.globalAlpha=.65;ctx.beginPath();tail.forEach((p,i)=>i?ctx.lineTo(p.x/w*800,p.z/h*800):ctx.moveTo(p.x/w*800,p.z/h*800));ctx.stroke();ctx.globalAlpha=1;ctx.beginPath();ctx.arc(latest.x/w*800,latest.z/h*800,5,0,Math.PI*2);ctx.fill();
  }
}
async function pipeline() {
  show('pipeline');
  try { await loadStatus(); const s=serviceStatus;
    const storage = s.states.storage ? JSON.parse(s.states.storage) : null;
    $('#pipeline').innerHTML=`<div class="pipeline-section"><span class="eyebrow orange">FROM REPLAY TO RECONSTRUCTION</span><h1>Ingestion pipeline<span>.</span></h1><p class="subtitle">Hourly discovery. Durable jobs. Engine-derived insights.</p><div class="pipeline-steps"><div class="panel"><b>01 / DISCOVER</b><h3>Zero-K battle archive</h3><p>Discover recent replays every hour. Battle IDs prevent duplicate jobs.</p><p>Last discovery: ${esc(s.states.last_scrape || 'Not run yet')} UTC</p></div><div class="panel"><b>02 / RECONSTRUCT</b><h3>Matching game engine</h3><p>Replay each demo with a local telemetry widget to record unit lifecycle and movement.</p><p>${s.processorConfigured?'Analysis enabled':'Analysis disabled'} · Active battle: ${esc(s.active ?? 'None')}</p></div><div class="panel"><b>03 / ANALYZE</b><h3>Structured match data</h3><p>Derive opening factories, production counts, event timelines, and movement traces.</p><p>${s.counts.ready || 0} complete · ${s.counts.queued || 0} queued · ${s.counts.blocked || 0} blocked</p></div></div>${storage?`<div class="panel"><h3>Managed storage</h3><p>${(storage.usedBytes/1e9).toFixed(2)} GB / ${(storage.budgetBytes/1e9).toFixed(0)} GB · ${(storage.freeBytes/1e9).toFixed(1)} GB free</p><p>${esc(s.states.acquisition_pause || 'Acquisition can proceed')}</p></div>`:''}${s.states.scrape_error?`<p class="notice">Discovery error: ${esc(s.states.scrape_error)}</p>`:''}<div class="panel"><h3>Run the service</h3><p><code>npm run host</code></p><p class="muted">Exact engines, games, and maps download automatically into Flea’s own cache. Processing runs oldest first, one replay at a time. Blocked dependencies retry automatically; invalid or exhausted analysis needs an operator retry.</p><a class="button" href="https://github.com/ykc1n/flea#engine-setup" target="_blank" rel="noreferrer">Engine setup ↗</a></div></div>`;
  } catch(e) { $('#pipeline').innerHTML=`<div class="empty">${esc(e.message)}</div>`; }
}
let debounce;
$('#search').addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(()=>{offset=0;loadReplays();},180)});
for(const id of ['mode','status']) $('#'+id).addEventListener('change',()=>{offset=0;syncTabs();loadReplays()});
function syncTabs(){document.querySelectorAll('[data-mode]').forEach(el=>el.classList.toggle('selected',el.dataset.mode===$('#mode').value));}
document.addEventListener('click',e=>{
  const card=e.target.closest('[data-replay]');if(card)location.hash=`replay/${card.dataset.replay}`;
  const mode=e.target.closest('[data-mode]');if(mode){$('#mode').value=mode.dataset.mode;offset=0;syncTabs();loadReplays();}
  const event=e.target.closest('[data-time]');if(event)setCursor(Number(event.dataset.time));
  if(e.target.id==='pipeline-nav')location.hash='pipeline';
  if(['refresh','retry-load'].includes(e.target.id)){loadReplays();loadStatus().catch(()=>{});}
  if(e.target.id==='next'){offset+=24;loadReplays();}
  if(e.target.id==='previous'){offset=Math.max(0,offset-24);loadReplays();}
  if(e.target.id==='play'){
    if(playback){clearInterval(playback);playback=null;e.target.textContent='▶';}
    else{if(cursor>=current.analysis.duration)setCursor(0);e.target.textContent='Ⅱ';playback=setInterval(()=>{setCursor(cursor+Number($('#speed').value));if(cursor>=current.analysis.duration){clearInterval(playback);playback=null;$('#play').textContent='▶';}},1000);}
  }
  if(e.target.id==='export'){const blob=new Blob([JSON.stringify(current.analysis,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`flea-${current.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
});
document.addEventListener('change',e=>{if(e.target.id==='production-team')renderProduction();if(['event-type','event-team'].includes(e.target.id))renderEvents();});
document.addEventListener('input',e=>{if(e.target.id==='scrubber')setCursor(Number(e.target.value));if(e.target.id==='event-search')renderEvents();});
document.addEventListener('keydown',e=>{if(e.key==='/' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('#search').focus();}});
window.addEventListener('hashchange',route);route();
