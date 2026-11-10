/* Project 545 Tracker — app.js
   Renders two data files:
     data/curated.json      hand-written analysis (legs, docs, timeline, money, cast…)
     data/fara/israel.json  DOJ FARA bulk data, filtered to Israel registrants, synced daily
*/
(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtD = iso => { if(!iso) return ''; const [y,m,d] = iso.split('-'); return `${m}/${d}/${y}`; };
const fmtMoney = n => '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
const money = s => { const m = String(s).replace(/[^0-9.]/g,''); return m ? Number(m) : 0; };
const draft = o => o && o.draft ? '<span class="draft" title="Read from post-August 2026 filings; pending hand verification">DRAFT</span>' : '';
const safeHash = h => { try { history.replaceState(null,'',h); } catch(e){} };
const todayISO = new Date().toISOString().slice(0,10);
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); };
const TYPE_BADGE = {
  'Registration Statement':'b-red','Exhibit AB':'b-blue','Exhibit C':'b-gray','Supplemental Statement':'b-purple',
  'Amendment':'b-amber','Short-Form':'b-gray','Informational Materials':'b-green'
};
const tb = t => `<span class="badge ${TYPE_BADGE[t]||'b-gray'}">${esc(t)}</span>`;

let C = null, F = null, D = {}, REG = {}, LEGBY = {};

/* ---------- boot ---------- */
Promise.all([
  fetch('data/curated.json').then(r => r.json()),
  fetch('data/fara/israel.json').then(r => r.json()).catch(() => null)
]).then(([c, f]) => {
  C = c; F = f;
  C.docs.forEach(d => D[d.id] = d);
  C.legs.forEach(l => LEGBY[l.fara] = l);
  if (F) F.registrants.forEach(r => REG[r.reg] = r);
  renderHeader(); renderDashboard(); renderFilingsSetup(); renderRegistrants();
  renderNetwork(); renderTimeline('all',''); renderMoney(); renderCast(); renderDocs('');
  renderUpdates(); renderArticles(); renderBeyond();
  $('#asof').textContent = C.asof;
  $('#asof2').textContent = F ? fmtD(F.synced_at.slice(0,10)) : 'unavailable';
  route();
});

/* ---------- helpers over the live data ---------- */
const allDocs = () => F ? F.registrants.flatMap(r => r.docs.map(d => ({...d, reg:r.reg, rname:r.name, leg:r.leg, tracked:r.tracked}))) : [];
const docLink = id => { const d = D[id]; return d ? `<a class="doclink" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>${draft(d)}` : ''; };
const docLinks = ids => (ids||[]).map(i => `<div>${docLink(i)}</div>`).join('');
const legHref = l => `#registrant=${l.fara}`;

/* ---------- header ---------- */
function renderHeader(){
  const legs = C.legs.length;
  const ordered = C.money.filter(m => /order/.test(m.basis)).reduce((s,m) => s + money(m.amount), 0);
  const received = C.money.filter(m => /receipts/.test(m.basis) && !/cumulative/.test(m.instrument)).reduce((s,m) => s + money(m.amount), 0);
  const stats = [
    ['#network', legs, 'Registered Legs'],
    ['#money', '$' + (ordered/1e6).toFixed(1) + 'M', 'Sworn Orders'],
    ['#money', '$' + (received/1e6).toFixed(1) + 'M', 'Sworn Receipts'],
  ];
  if (F) {
    const recent = allDocs().filter(d => d.date >= daysAgo(30)).length;
    stats.push(['#registrants', F.stats.israel_active_registrants, 'Active Israel Registrants']);
    stats.push(['#filings', F.stats.documents.toLocaleString(), 'Filings Indexed']);
    stats.push(['#filings=recent', recent, 'Filed in last 30 days']);
    $('#syncline').innerHTML = `<b>● Live</b> · DOJ FARA data synced ${esc(fmtD(F.synced_at.slice(0,10)))} · latest filing stamped ${esc(fmtD(F.stats.latest_filing))} · curated analysis as of ${esc(C.asof)}`;
  } else {
    $('#syncline').innerHTML = `Curated analysis as of ${esc(C.asof)} · live DOJ data unavailable`;
  }
  $('#stats').innerHTML = stats.map(([h,v,l]) => `<a class="stat" href="${h}"><b>${esc(v)}</b><span>${esc(l)}</span></a>`).join('');
}

/* ---------- dashboard ---------- */
function renderDashboard(){
  const box = $("#dashbox"); box.classList.remove("loading");
  if (!F) { box.innerHTML = '<p class="lede">Live DOJ data could not be loaded. The curated record is intact in the other tabs.</p>'; return; }
  const docs = allDocs().sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const recent = docs.filter(d => d.date >= daysAgo(45) && d.type !== 'Informational Materials').slice(0, 25);
  const im = docs.filter(d => d.date >= daysAgo(45) && d.type === 'Informational Materials');
  const imBy = {}; im.forEach(d => imBy[d.rname] = (imBy[d.rname]||0) + 1);
  // money leaderboard from curated sworn orders
  const byReg = {};
  C.money.forEach(m => { if (/order/.test(m.basis)) { const k = m.registrant.replace(/\s*\(\d+\)/,''); byReg[k] = Math.max(byReg[k]||0, money(m.amount)); } });
  const lead = Object.entries(byReg).sort((a,b) => b[1]-a[1]);
  const newest = F.registrants.filter(r => r.israel_active).sort((a,b) => (b.registered||'').localeCompare(a.registered||'')).slice(0,6);
  box.innerHTML = `
  <h2>Dashboard</h2>
  <p class="lede">What the record says today. The left column is DOJ's docket as of the last sync; the right column is the curated money and the newest registrants. Everything links to its filing.</p>
  <div class="grid2">
    <div>
      <div class="panel"><h3>Recent filings (45 days, excluding informational materials) <a class="more" href="#filings=recent">full database →</a></h3>
        <div class="feed">${recent.length ? recent.map(frow).join('') : '<div class="note">Nothing substantive stamped in the last 45 days.</div>'}</div>
      </div>
      <div class="panel"><h3>Informational materials, last 45 days</h3>
        ${Object.keys(imBy).length ? `<div class="feed">${Object.entries(imBy).sort((a,b)=>b[1]-a[1]).map(([n,c]) => `<div class="frow"><span class="d">${c} filings</span><span class="r">${esc(n)}</span><span class="t"></span></div>`).join('')}</div>` : '<div class="note">None.</div>'}
        <div class="note">Content filings under FARA §4(b): the campaign's own output, filed with DOJ. Browse them in <a href="#filings=type:Informational%20Materials">Filings</a>.</div>
      </div>
    </div>
    <div>
      <div class="panel"><h3>Sworn orders by registrant <a class="more" href="#money">money →</a></h3>
        <div class="feed">${lead.map(([n,v]) => `<div class="frow"><span class="d">${esc('$'+(v/1e6).toFixed(2)+'M')}</span><span class="r">${esc(n)}</span><span class="t"></span></div>`).join('')}</div>
        <div class="note">Contract values as filed. Receipts and disbursements are on the Money page.</div>
      </div>
      <div class="panel"><h3>Newest active Israel registrants <a class="more" href="#registrants">all →</a></h3>
        <div class="feed">${newest.map(r => `<div class="frow"><span class="d">${esc(fmtD(r.registered))}</span><span><span class="r"><a href="#registrant=${r.reg}">${esc(r.name)}</a></span>${r.leg ? ' <span class="badge b-red">Project 545</span>' : ''}<div class="m">${esc((r.principals.find(p=>p.israel)||{}).name||'')}</div></span><span class="t"><span class="badge b-gray">#${r.reg}</span></span></div>`).join('')}</div>
      </div>
      <div class="panel"><h3>The nine legs <a class="more" href="#network">pipeline →</a></h3>
        <div class="feed">${C.legs.map(l => { const r = REG[l.fara]; return `<div class="frow"><span class="d">#${l.fara}</span><span><span class="r"><a href="${legHref(l)}">${esc(l.n)}</a></span>${draft(l)}<div class="m">${esc(l.money)}</div></span><span class="t"><span class="m">${r ? esc(r.docs.length+' docs · last '+fmtD(r.latest_doc)) : ''}</span></span></div>`; }).join('')}</div>
      </div>
    </div>
  </div>`;
}
function frow(d){
  return `<div class="frow"><span class="d">${esc(fmtD(d.date))}</span><span><span class="r"><a href="#registrant=${d.reg}">${esc(d.rname)}</a></span>${d.leg?' <span class="badge b-red">545</span>':''}<div class="m">${esc(d.short_form || d.principal || '')}</div></span><span class="t">${tb(d.type)} <a href="${esc(d.url)}" target="_blank" rel="noopener" title="Open PDF">↗</a></span></div>`;
}

/* ---------- filings database ---------- */
const FS = { q:'', reg:'', type:'', scope:'all', since:'', sort:'date', dir:-1, shown:100 };
function renderFilingsSetup(){
  if (!F) { $('#ffilters').innerHTML = '<span class="note">Live data unavailable.</span>'; return; }
  const regs = F.registrants.slice().sort((a,b) => a.name.localeCompare(b.name));
  const types = [...new Set(allDocs().map(d => d.type))].sort();
  $('#ffilters').innerHTML = `
    <input id="fq" placeholder="Search registrant, principal, person, URL…" value="">
    <select id="fscope"><option value="all">All Israel registrants</option><option value="legs">Project 545 legs only</option><option value="beyond">Beyond 545 only</option></select>
    <select id="freg"><option value="">All registrants</option>${regs.map(r => `<option value="${r.reg}">${esc(r.name)} (#${r.reg})</option>`).join('')}</select>
    <select id="ftype"><option value="">All document types</option>${types.map(t => `<option>${esc(t)}</option>`).join('')}</select>
    <select id="fsince"><option value="">Any date</option><option value="${daysAgo(30)}">Last 30 days</option><option value="${daysAgo(90)}">Last 90 days</option><option value="2026-08-08">Since Aug 8, 2026 (post-snapshot)</option><option value="2026-01-01">2026</option><option value="2025-01-01">2025 onward</option></select>
    <span class="count" id="fcount"></span>`;
  const upd = () => { FS.q = $('#fq').value.toLowerCase(); FS.reg = $('#freg').value; FS.type = $('#ftype').value; FS.scope = $('#fscope').value; FS.since = $('#fsince').value; FS.shown = 100; renderFilings(); };
  ['#fq','#freg','#ftype','#fscope','#fsince'].forEach(s => $(s).addEventListener('input', upd));
  $('#fmore').addEventListener('click', () => { FS.shown += 200; renderFilings(); });
  renderFilings();
}
function filingsFiltered(){
  let rows = allDocs();
  if (FS.scope === 'legs') rows = rows.filter(d => d.leg);
  if (FS.scope === 'beyond') rows = rows.filter(d => !d.leg);
  if (FS.reg) rows = rows.filter(d => d.reg === FS.reg);
  if (FS.type) rows = rows.filter(d => d.type === FS.type);
  if (FS.since) rows = rows.filter(d => d.date >= FS.since);
  if (FS.q) rows = rows.filter(d => (d.rname+' '+(d.principal||'')+' '+(d.short_form||'')+' '+d.url+' '+d.type+' '+d.reg).toLowerCase().includes(FS.q));
  const k = FS.sort;
  rows.sort((a,b) => { const x = a[k]||'', y = b[k]||''; return (x < y ? -1 : x > y ? 1 : 0) * FS.dir || (b.date||'').localeCompare(a.date||''); });
  return rows;
}
function renderFilings(){
  if (!F) return;
  const rows = filingsFiltered();
  $('#fcount').textContent = `${rows.length.toLocaleString()} filings`;
  const head = [['date','Stamped'],['rname','Registrant'],['type','Type'],['principal','Principal / person'],['url','Document']];
  const th = head.map(([k,l]) => `<th class="sort" data-k="${k}">${l}${FS.sort===k?(FS.dir<0?' ▼':' ▲'):''}</th>`).join('');
  const body = rows.slice(0, FS.shown).map(d => `<tr>
    <td class="nw">${esc(fmtD(d.date))}${d.date > todayISO ? ' <span class="badge b-amber" title="DOJ stamp is in the future">?</span>' : ''}</td>
    <td><a href="#registrant=${d.reg}">${esc(d.rname)}</a> <span class="badge b-gray">#${d.reg}</span>${d.leg?' <span class="badge b-red">545</span>':''}</td>
    <td class="nw">${tb(d.type)}</td>
    <td>${esc(d.short_form || d.principal || '')}${d.country && d.country!=='ISRAEL' ? ` <span class="badge b-gray">${esc(d.country)}</span>` : ''}</td>
    <td class="nw"><a href="${esc(d.url)}" target="_blank" rel="noopener">PDF ↗</a></td></tr>`).join('');
  $('#ftable').innerHTML = `<tr>${th}</tr>${body || '<tr><td colspan="5">No filings match.</td></tr>'}`;
  $('#fmore').style.display = rows.length > FS.shown ? 'block' : 'none';
  $('#fmore').textContent = `Show more (${Math.min(FS.shown, rows.length)} of ${rows.length})`;
  $('#ftable').querySelectorAll('th.sort').forEach(h => h.onclick = () => { const k = h.dataset.k; if (FS.sort === k) FS.dir *= -1; else { FS.sort = k; FS.dir = k === 'date' ? -1 : 1; } renderFilings(); });
}
function setFilingsPreset(p){
  if (!F) return;
  const set = (id, v) => { const el = $(id); if (el) el.value = v; };
  set('#fq',''); set('#freg',''); set('#ftype',''); set('#fscope','all'); set('#fsince','');
  if (p === 'recent') set('#fsince', daysAgo(30));
  else if (p && p.startsWith('type:')) set('#ftype', decodeURIComponent(p.slice(5)));
  else if (p && p.startsWith('reg:')) set('#freg', p.slice(4));
  else if (p && p.startsWith('q:')) set('#fq', decodeURIComponent(p.slice(2)));
  $('#fq').dispatchEvent(new Event('input'));
}

/* ---------- registrants ---------- */
function renderRegistrants(sel){
  const box = $("#regbox"); box.classList.remove("loading");
  if (sel) return renderRegistrantDetail(sel);
  if (!F) { box.innerHTML = '<h2>Registrants</h2>' + C.legs.map(legCard).join(''); return; }
  const rs = F.registrants.slice().sort((a,b) => (b.israel_active - a.israel_active) || (b.leg - a.leg) || (b.registered||'').localeCompare(a.registered||''));
  const row = r => { const p = r.principals.filter(x => x.israel); const act = p.filter(x => x.active);
    return `<a class="rrow" href="#registrant=${r.reg}"><span class="num">#${r.reg}</span><span><span class="nm">${esc(r.name)}</span> ${r.leg?'<span class="badge b-red">Project 545</span>':r.tracked?'<span class="badge b-amber">Beyond 545</span>':''} ${r.israel_active?'':'<span class="badge b-gray">Israel principal terminated</span>'}<div class="pr">${esc((act[0]||p[0]||{}).name||'')}${p.length>1?` +${p.length-1} more`:''}</div></span><span class="st">${r.docs.length} docs · reg. ${esc(fmtD(r.registered))}<br>last filing ${esc(fmtD(r.latest_doc))}</span></a>`; };
  box.innerHTML = `<h2>Registrants</h2>
    <p class="lede">Every FARA registrant DOJ lists with an Israel-connected foreign principal active since 2023, from the bulk data as of ${esc(fmtD(F.synced_at.slice(0,10)))}. Project 545 legs in red; other Israel engagements documented in Beyond 545 in amber; the rest are listed from DOJ data without annotation. Tap any row for its curated analysis, principals, people, and full docket.</p>
    <div class="rlist">${rs.map(row).join('')}</div>`;
}
function legCard(l){
  return `<div class="rc" id="card-${l.id}"><span class="badge b-red">FARA ${l.fara}</span>${draft(l)}
   <h3 style="margin-top:8px"><a href="${legHref(l)}">${esc(l.n)}</a></h3>
   <div class="who">${esc(l.who)}</div><div class="who"><b>Route:</b> ${esc(l.route)}</div><div class="who"><b>Money:</b> ${esc(l.money)}</div>
   <ul>${l.facts.map(f => `<li class="${/\(flag\)/.test(f)?'flag':/\(compliant\)|\(lawful\)/.test(f)?'ok':/^NEW/.test(f)?'new':''}">${esc(f.replace(/ \((flag|compliant|lawful|draft)\)/g,''))}${/\(draft\)/.test(f)?'<span class="draft">DRAFT</span>':''}</li>`).join('')}</ul>
   ${docLinks(l.docs)}<div class="cs">${esc(l.comment)}</div></div>`;
}
function renderRegistrantDetail(reg){
  const box = $("#regbox"); box.classList.remove("loading");
  const r = REG[reg]; const l = LEGBY[reg]; const b = (C.beyond||[]).find(x => x.fara === reg);
  if (!r && !l) { box.innerHTML = `<h2>Registrant #${esc(reg)}</h2><p class="lede">Not in this dataset. <a href="https://efile.fara.gov/ords/fara/f?p=1235:11:::NO::P11_REG_NUMBER:${esc(reg)}" target="_blank" rel="noopener">Look it up at DOJ ↗</a></p>`; return; }
  const name = r ? r.name : l.n;
  let html = `<p><a href="#registrants">← All registrants</a></p>
    <div class="rhead"><h2>${esc(name)}</h2><span class="badge b-red">FARA #${esc(reg)}</span>${l?'<span class="badge b-red">Project 545 leg</span>':b?'<span class="badge b-amber">Beyond 545</span>':''}${r&&!r.israel_active?'<span class="badge b-gray">Israel principal terminated</span>':''}${draft(l)}</div>`;
  if (l) html += `<div class="panel"><h3>Curated analysis</h3>
      <div class="kv"><div>Who</div><div>${esc(l.who)}</div><div>Route</div><div>${esc(l.route)}</div><div>Money</div><div>${esc(l.money)}</div><div>Comment status</div><div style="color:var(--amber)">${esc(l.comment)}</div></div>
      <ul style="margin:12px 0 0 18px;font-size:14px">${l.facts.map(f => `<li class="${/\(flag\)/.test(f)?'flag':/\(compliant\)|\(lawful\)/.test(f)?'ok':/^NEW/.test(f)?'new':''}" style="margin:4px 0;color:${/\(flag\)/.test(f)?'var(--red)':/\(compliant\)|\(lawful\)/.test(f)?'var(--green)':/^NEW/.test(f)?'var(--amber)':'var(--mut)'}">${esc(f.replace(/ \((flag|compliant|lawful|draft)\)/g,''))}${/\(draft\)/.test(f)?'<span class="draft">DRAFT</span>':''}</li>`).join('')}</ul>
      <h3 style="margin-top:14px">Annotated documents</h3>${docLinks(l.docs)}</div>`;
  if (b) html += `<div class="panel"><h3>${esc(b.role)}${draft(b)}</h3><p style="font-size:14px;color:var(--mut)">${esc(b.text)}</p></div>`;
  if (r) {
    const sf = r.short_forms;
    const types = Object.entries(r.doc_counts).sort((a,b) => b[1]-a[1]);
    html += `<div class="grid2"><div class="panel"><h3>DOJ record</h3>
        <div class="kv"><div>Registered</div><div>${esc(fmtD(r.registered))}${r.terminated?` · terminated ${esc(fmtD(r.terminated))}`:''}</div>
        <div>Address</div><div>${esc([r.address,r.city,r.state,r.zip].filter(Boolean).join(', '))}</div>
        <div>Docket</div><div>${r.docs.length} documents · latest ${esc(fmtD(r.latest_doc))} · <a href="${esc(r.efile_url)}" target="_blank" rel="noopener">DOJ page ↗</a></div></div>
        <div class="typecounts">${types.map(([t,n]) => `<span class="badge ${TYPE_BADGE[t]||'b-gray'}">${esc(t)} · ${n}</span>`).join('')}</div>
      </div>
      <div class="panel"><h3>Foreign principals (${r.principals.length})</h3>
        <div class="feed">${r.principals.map(p => `<div class="frow"><span class="d">${esc(fmtD(p.registered))}</span><span><span class="r">${esc(p.name)}</span><div class="m">${esc(p.country)}${p.terminated?` · terminated ${esc(fmtD(p.terminated))}`:' · active'}</div></span><span class="t">${p.israel?'<span class="badge b-red">Israel</span>':''}</span></div>`).join('')}</div>
      </div></div>`;
    if (sf.length) html += `<div class="panel"><h3>Short-form registrants (${sf.length})</h3><div class="feed">${sf.slice(0,60).map(s => `<div class="frow"><span class="d">${esc(fmtD(s.date))}</span><span class="r">${esc(s.last)}, ${esc(s.first)}</span><span class="t">${s.terminated?`<span class="badge b-gray">terminated ${esc(fmtD(s.terminated))}</span>`:'<span class="badge b-green">active</span>'}</span></div>`).join('')}${sf.length>60?`<div class="note">${sf.length-60} more in DOJ's list.</div>`:''}</div></div>`;
    const nonIM = r.docs.filter(d => d.type !== 'Informational Materials');
    const im = r.docs.filter(d => d.type === 'Informational Materials');
    html += `<div class="panel"><h3>Docket: substantive filings (${nonIM.length}) <a class="more" href="#filings=reg:${r.reg}">open in database →</a></h3><div class="feed">${nonIM.slice(0,80).map(d => `<div class="frow"><span class="d">${esc(fmtD(d.date))}</span><span><span class="r">${esc(d.short_form || d.principal || d.type)}</span></span><span class="t">${tb(d.type)} <a href="${esc(d.url)}" target="_blank" rel="noopener">PDF ↗</a></span></div>`).join('')}${nonIM.length>80?`<div class="note">Showing 80 of ${nonIM.length}; the database has the rest.</div>`:''}</div></div>`;
    if (im.length) html += `<div class="panel"><h3>Informational materials (${im.length}) <a class="more" href="#filings=reg:${r.reg}">browse all →</a></h3><div class="note">First ${Math.min(im.length,12)} shown, newest first.</div><div class="feed">${im.slice(0,12).map(d => `<div class="frow"><span class="d">${esc(fmtD(d.date))}</span><span class="r">${esc(d.principal||'')}</span><span class="t"><a href="${esc(d.url)}" target="_blank" rel="noopener">PDF ↗</a></span></div>`).join('')}</div></div>`;
  }
  box.innerHTML = html;
}

/* ---------- network / pipeline ---------- */
function renderNetwork(){
  const gov = $('#tierGov'), hubs = $('#tierHubs'), legs = $('#tierLegs');
  const mfa = C.hubs.find(h => h.id === 'mfa');
  gov.innerHTML = `<div class="ncard gov" data-hub="mfa"><h3>${esc(mfa.n)}</h3><div class="meta">${esc(mfa.sub)}</div></div>`;
  hubs.innerHTML = C.hubs.filter(h => h.id !== 'mfa').map(h => `<div class="ncard" data-hub="${h.id}"><h3>${esc(h.n)}</h3><div class="meta">${esc(h.sub)}</div></div>`).join('');
  legs.innerHTML = C.legs.map(l => { const r = REG[l.fara]; return `<div class="ncard" data-leg="${l.id}">
    <span class="fara">FARA ${l.fara}</span>${draft(l)}<h3>${esc(l.n)}</h3><div class="meta">${esc(l.who)}</div>
    <div class="money">${esc(l.money)}</div><div class="route">${routeBadge(l.route)}</div>
    ${r ? `<div class="live">${r.docs.length} filings on docket · last ${esc(fmtD(r.latest_doc))}</div>` : ''}</div>`; }).join('');
  function select(id, isHub){
    document.querySelectorAll('.ncard.sel').forEach(c => c.classList.remove('sel'));
    const el = document.querySelector(`[data-${isHub?'hub':'leg'}="${id}"]`); if (el) el.classList.add('sel');
    const d = $('#detail');
    if (!isHub) {
      const l = C.legs.find(x => x.id === id); if (!l) return;
      d.innerHTML = `<h3>${esc(l.n)} <span class="fara">· FARA ${l.fara}</span>${draft(l)}</h3>
        <p><b>Who:</b> ${esc(l.who)}</p><p><b>Route:</b> ${esc(l.route)}</p><p><b>Money:</b> ${esc(l.money)}</p>
        ${l.facts.map(f => `<p class="${/\(flag\)/.test(f)?'flag':/\(compliant\)|\(lawful\)/.test(f)?'ok':/^NEW/.test(f)?'new':''}">• ${esc(f.replace(/ \((flag|compliant|lawful|draft)\)/g,''))}${/\(draft\)/.test(f)?'<span class="draft">DRAFT</span>':''}</p>`).join('')}
        ${docLinks(l.docs)}<div class="cstat">${esc(l.comment)}</div><p><a href="${legHref(l)}">Full registrant page with live docket →</a></p>`;
      safeHash('#network=leg-' + id);
    } else {
      const h = C.hubs.find(x => x.id === id); if (!h) return;
      d.innerHTML = `<h3>${esc(h.n)}</h3><p>${esc(h.detail)}</p>${docLinks(h.docs)}`;
      safeHash('#network=hub-' + id);
    }
    d.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
  $('#network').addEventListener('click', e => { const c = e.target.closest('.ncard'); if (!c) return; if (c.dataset.leg) select(c.dataset.leg,false); else if (c.dataset.hub) select(c.dataset.hub,true); });
  window._netSelect = select;
}
function routeBadge(route){
  const r = route.toLowerCase();
  if (r.includes('direct')) return '<span class="badge b-green">direct ministry</span>';
  if (r.includes('l.d.r.s')) return '<span class="badge b-amber">L.D.R.S. pipe</span>';
  if (r.includes('havas usa')) return '<span class="badge b-blue">Havas USA</span>';
  return '<span class="badge b-blue">Havas Frankfurt</span>';
}
window.flowGo = (kind, id) => { location.hash = '#network=' + kind + '-' + id; };

/* ---------- timeline ---------- */
const tlColors = {money:'#5aa2f7', reg:'#4ade80', flag:'#f0564a', press:'#f0a24a'};
function renderTimeline(filter, q){
  const box = $('#tlbox'); let html = ''; let open = false;
  C.timeline.forEach(ev => {
    if (ev.era) { if (open) html += '</div>'; html += `<div class="era">${esc(ev.era)}</div><div class="tl">`; open = true; return; }
    if (filter !== 'all' && ev.cat !== filter) return;
    if (q && !(ev.title + ' ' + ev.detail).toLowerCase().includes(q)) return;
    html += `<div class="tev"><span class="dot" style="background:${tlColors[ev.cat]}"></span><div class="d">${esc(ev.date)}</div><div class="t">${esc(ev.title)} <span class="exp">${ev.detail ? '▾' : ''}</span>${draft(ev)}</div><div class="x">${esc(ev.detail)}${docLinks(ev.docs)}</div></div>`;
  });
  if (open) html += '</div>';
  box.innerHTML = html;
}
$('#tf').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('#tf').querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); renderTimeline(b.dataset.c, ''); });
$('#tlbox').addEventListener('click', e => { const t = e.target.closest('.tev'); if (!t || e.target.closest('a')) return; t.classList.toggle('open'); });

/* ---------- money ---------- */
function renderMoney(){
  let rows = `<tr><th>Registrant</th><th>Instrument</th><th style="text-align:right">Amount</th><th>Basis</th><th>Source</th></tr>`;
  let ordered = 0, received = 0;
  C.money.forEach(m => {
    const v = money(m.amount);
    if (/order/.test(m.basis)) ordered += v;
    if (/receipts/.test(m.basis) && !/cumulative/.test(m.instrument)) received += v;
    rows += `<tr><td>${esc(m.registrant)}${draft(m)}</td><td>${esc(m.instrument)}</td><td class="amt">${esc(m.amount)}</td><td>${esc(m.basis)}</td><td>${docLink(m.doc)}</td></tr>`;
  });
  rows += `<tr class="total"><td>Sworn orders (contract values)</td><td></td><td class="amt">${fmtMoney(ordered)}</td><td colspan="2">sum of order rows</td></tr>`;
  rows += `<tr class="total"><td>Sworn receipts (money actually reported received)</td><td></td><td class="amt">${fmtMoney(received)}</td><td colspan="2">sum of receipt rows, excluding cumulative restatements</td></tr>`;
  $('#moneyT').innerHTML = rows;
}

/* ---------- cast / docs / updates / articles / beyond ---------- */
function renderCast(){
  $('#castbox').innerHTML = C.cast.map(p => `<div class="pcard"><h3>${esc(p.name)}</h3><span class="role">${esc(p.role)}</span>${draft(p)}<p>${esc(p.bio)}</p>${docLinks(p.docs)}</div>`).join('');
}
function renderDocs(q){
  const list = C.docs.filter(d => !q || (d.label + ' ' + d.note + ' ' + d.tags).toLowerCase().includes(q));
  $('#docbox').innerHTML = list.map(d => `<div class="docrow"><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>${draft(d)}<div class="why">${esc(d.note)}</div></div>`).join('') || '<div class="note">No annotated documents match. Try the <a href="#filings">Filings</a> database.</div>';
}
$('#docfilter').addEventListener('input', e => renderDocs(e.target.value.toLowerCase()));
function renderUpdates(){
  $('#upbox').innerHTML = C.updates.map(u => `<div class="uentry"><div class="d">${esc(u.date)}${draft(u)}</div><p>${u.text.includes('<a ') ? u.text : esc(u.text)}</p></div>`).join('');
}
function renderArticles(){
  $('#artbox').innerHTML = (C.articles||[]).map(a => `<div class="pcard"><h3>${esc(a.t)}</h3><span class="role">${esc(a.role)}</span><p>${esc(a.p)}</p><p><a href="${esc(a.url)}" target="_blank" rel="noopener">Read the article</a></p></div>`).join('');
}
function renderBeyond(){
  $('#beyondbox').innerHTML = (C.beyond||[]).map(b => { const r = REG[b.fara]; return `<div class="pcard"><h3><a href="#registrant=${b.fara}">${esc(b.n)}</a></h3><span class="role">${esc(b.role)}, FARA #${b.fara}</span>${draft(b)}<p>${esc(b.text)}</p>${r ? `<p class="note" style="margin:4px 0 0">Docket: ${r.docs.length} Israel-tagged or registrant-level filings · latest ${esc(fmtD(r.latest_doc))} · <a href="#registrant=${b.fara}">registrant page</a></p>` : ''}</div>`; }).join('');
}

/* ---------- global search ---------- */
function globalSearch(q){
  q = q.trim().toLowerCase();
  const out = [];
  if (q.length < 2) { $('#searchbox').innerHTML = ''; $('#searchlede').textContent = 'Type at least two characters.'; return; }
  C.legs.filter(l => (l.n+' '+l.who+' '+l.route+' '+l.facts.join(' ')).toLowerCase().includes(q)).forEach(l => out.push(['Leg', `<a href="${legHref(l)}">${esc(l.n)}</a> · FARA ${l.fara}`]));
  C.cast.filter(p => (p.name+' '+p.role+' '+p.bio).toLowerCase().includes(q)).forEach(p => out.push(['Cast', `<a href="#cast">${esc(p.name)}</a> · ${esc(p.role)}`]));
  C.docs.filter(d => (d.label+' '+d.note+' '+d.tags).toLowerCase().includes(q)).forEach(d => out.push(['Document', `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`]));
  C.timeline.filter(e => !e.era && (e.title+' '+e.detail).toLowerCase().includes(q)).forEach(e => out.push(['Timeline', `<a href="#timeline">${esc(e.date)}: ${esc(e.title)}</a>`]));
  if (F) {
    F.registrants.filter(r => (r.name+' '+r.reg+' '+r.principals.map(p=>p.name).join(' ')+' '+r.short_forms.map(s=>s.last+' '+s.first).join(' ')).toLowerCase().includes(q)).forEach(r => out.push(['Registrant', `<a href="#registrant=${r.reg}">${esc(r.name)}</a> · #${r.reg} · ${r.docs.length} docs`]));
    const fd = allDocs().filter(d => ((d.principal||'')+' '+(d.short_form||'')+' '+d.url).toLowerCase().includes(q));
    if (fd.length) out.push(['Filings', `<a href="#filings=q:${encodeURIComponent(q)}">${fd.length} filings match in the database →</a>`]);
  }
  $('#searchlede').textContent = `${out.length} results for "${q}"`;
  $('#searchbox').innerHTML = out.slice(0, 80).map(([k,h]) => `<div class="sr"><span class="k">${k}</span>${h}</div>`).join('') || '<div class="note">Nothing matched.</div>';
}
$('#q').addEventListener('input', e => { const v = e.target.value; if (!v) { showTab('dashboard'); return; } showTab('search'); globalSearch(v); });

/* ---------- routing ---------- */
function showTab(id){
  document.querySelectorAll('main section').forEach(s => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('nav a.tab').forEach(b => b.classList.toggle('active', b.dataset.s === id));
  window.scrollTo({top: 0});
}
function route(){
  const h = location.hash.replace('#','') || 'dashboard';
  const [tab, sel] = h.split('=');
  if (tab === 'registrant') { showTab('registrants'); renderRegistrants(sel); return; }
  const known = ['dashboard','filings','registrants','network','timeline','money','cast','docs','updates','articles','beyond','method'];
  // legacy hashes from the August site
  const legacy = {regs:'registrants'};
  const t = known.includes(tab) ? tab : (legacy[tab] || 'dashboard');
  showTab(t);
  if (t === 'registrants') renderRegistrants();
  if (t === 'filings' && sel) setFilingsPreset(sel);
  if (t === 'network' && sel) { const [kind, id] = sel.split('-'); if (window._netSelect && id) window._netSelect(id, kind === 'hub'); }
}
window.addEventListener('hashchange', route);
})();
