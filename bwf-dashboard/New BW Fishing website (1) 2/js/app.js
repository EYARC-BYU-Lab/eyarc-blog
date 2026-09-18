/* BW Fishing — Credit Approval and Internal Controls dashboards (app logic)
   One global filter list (S.filters) drives every tab; each filter renders as a chip
   in the breadcrumb bar and can be removed there. */
(function () {
'use strict';

const C = window.PMCore;
const D = window.BWF_DATA;
const CFG = window.BWF_CONFIG;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nameOf = x => x === C.START ? 'Start' : x === C.END ? 'End' : x;

/* ---------- state ---------- */
const S = {
  model: null,
  allIds: null,
  filters: [],               // global filters (see core.js matchFilter)
  baseIds: null,             // cases matching every filter except the variant selection
  ids: null,                 // cases matching every filter
  vList: [],                 // variants present in baseIds
  vSort: { col: 'count', dir: 'desc' },
  metric: 'cases',           // process-map edge labels: 'cases' | 'time'
  durUnit: 'auto',           // duration display unit (Avg time column + map time labels)
  panelCollapsed: false,
  map: null,
  dfg: null,                 // directly-follows graph currently drawn (counts shown in the map filter menu)
  mapDirty: true,
  tx: { rows: [], view: [], q: '', sort: { col: 'id', dir: 'asc' }, shown: 0 },
  sod: null
};
const PAGE = 300;

/* ---------- Process-map / variant-strip colours ----------
   Everything about step-type colouring lives in this one block:
     CAT_INFO  category id -> [legend label, hex fill] (node fills, strips, legend)
     CAT_RAW   raw (pre-rename) activity name -> category id
     CAT_INK   category id -> 'light' | 'dark' text colour for contrast on the fill
   To turn off colouring (single colour for every step), give every activity the
   same category, e.g.: set CAT_RAW = {} (catOf() then falls back to 'flow' for
   every activity) and pick 'flow's colour in CAT_INFO as the one colour to use. */
const CAT_INFO = {
  flow: ['Order, fulfilment & invoicing', '#0D65C7'],
  ok: ['Credit approved', '#6E9600'],
  deny: ['Credit denied', '#F2BA05'],
  cash: ['Cash receipt & deposit', '#85428E'],
  remit: ['Remittance handling', '#C2C2CE']
};
const CAT_RAW = {
  'Create Digital Sales Order': 'flow', 'Create Picking Ticket': 'flow', 'Record Picking of Inventory': 'flow',
  'Create Shipping Documents': 'flow', 'Review and Approve Sales Invoice': 'flow', 'Email Sales Invoices to Customer': 'flow',
  'Credit Approved': 'ok', 'Credit Denied': 'deny',
  'Receive Payment': 'cash', 'Print Bank Deposit Slip': 'cash', 'Match Deposit Slip and Bank Receipt': 'cash',
  'Scan and Save Remittance': 'remit', 'Shred Remittance': 'remit'
};
const CAT_INK = { flow: 'light', ok: 'light', deny: 'dark', cash: 'light', remit: 'dark' };
const CAT = {};
for (const raw of D.activities) CAT[(D.renames && D.renames[raw]) || raw] = CAT_RAW[raw] || 'flow';
const catOf = name => CAT[name] || 'flow';
const nodeColor = name => ({ fill: CAT_INFO[catOf(name)][1], ink: CAT_INK[catOf(name)] });

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  S.model = C.buildModel(D);
  S.allIds = new Set(S.model.cases.keys());
  S.sod = { roles: [...new Set(S.model.events.map(e => e.role))].sort(), acts: [...new Set(S.model.events.map(e => e.act))].sort() };
  document.title = D.title + ' — BW Fishing';
  $('appTitle').textContent = D.title;
  applyTabLabels();

  const first = S.model.events.reduce((a, e) => e.ts < a ? e.ts : a, S.model.events[0].ts);
  renderIntro(first);

  $('legendCats').innerHTML = Object.keys(CAT_INFO).map(k =>
    '<div class="legend-row"><span class="lg-node" style="background:' + CAT_INFO[k][1] + '"></span> ' + CAT_INFO[k][0] + '</div>').join('');
  $('stripLegend').innerHTML = Object.keys(CAT_INFO).map(k => '<span><i style="background:' + CAT_INFO[k][1] + '"></i>' + CAT_INFO[k][0] + '</span>').join('');

  wireTabs();
  wireExplorer();
  wireTransactions();
  wireCrumbs();
  recompute();

  const hash = location.hash.replace('#', '');
  switchTab(document.querySelector('.tab[data-view="' + hash + '"]') ? hash : 'intro');
});

/* ---------- tabs ---------- */
/* labels come from CFG.TABS (js/config.js): nav button, page <h2>, and the matching
   Introduction description card all read from the same config entry */
function applyTabLabels() {
  CFG.TABS.forEach(t => {
    const nav = document.querySelector('.tab[data-view="' + t.id + '"]');
    if (nav) nav.textContent = t.label;
    const h2 = document.querySelector('#view-' + t.id + ' h2');
    if (h2) h2.textContent = t.label;
    const card = document.querySelector('.term-card[data-tab="' + t.id + '"] b');
    if (card) card.textContent = t.label;
  });
}
function wireTabs() {
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.view)));
  window.addEventListener('hashchange', () => {
    const h = location.hash.replace('#', '');
    if (document.querySelector('.tab[data-view="' + h + '"]')) switchTab(h, true);
  });
  window.addEventListener('resize', () => { if (S.map && !$('view-variants').hidden) S.map.fit(); });
}
function switchTab(view, fromHash) {
  closeMapMenu();
  document.querySelectorAll('.tab').forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  if (!fromHash && location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  window.scrollTo(0, 0);
  if (view === 'variants') renderMap();
}

/* ---------- global filters ---------- */
function recompute() {
  S.baseIds = C.applyFilters(S.model, S.filters, 'variants');
  S.ids = C.applyFilters(S.model, S.filters);
  S.mapDirty = true;
  renderCrumbs();
  renderOverview();
  renderVariants();
  rebuildTx();
  renderSod();
  if (!$('view-variants').hidden) renderMap();
}
function findFilter(f) { return S.filters.findIndex(g => C.sameFilter(f, g)); }
function hasFilter(f) { return findFilter(f) >= 0; }
/* add a filter, or remove it if the identical one is already active (click again = off) */
function toggleFilter(f) {
  const i = findFilter(f);
  if (i >= 0) S.filters.splice(i, 1);
  else {
    /* keep and not-keep of the same thing are mutually exclusive */
    const j = findFilter(Object.assign({}, f, { not: !f.not }));
    if (j >= 0) S.filters.splice(j, 1);
    S.filters.push(f);
  }
  recompute();
}
function removeFilterAt(i) { S.filters.splice(i, 1); recompute(); }
function clearFilters() { S.filters = []; recompute(); }
/* set a filter to include (not=false) or exclude (not=true); the opposite of the same
   filter is dropped; a no-op if that exact filter is already active */
function setFilter(f, not) {
  const g = Object.assign({}, f, { not: !!not });
  if (hasFilter(g)) return;
  toggleFilter(g);
}
/* drop a filter whichever way (include or exclude) it is currently applied */
function removeFilter(f) {
  const i = findFilter(Object.assign({}, f, { not: false })), j = findFilter(Object.assign({}, f, { not: true }));
  const k = i >= 0 ? i : j;
  if (k >= 0) removeFilterAt(k);
}
/* flip a chip between include and exclude (the opposite of the same filter, if present, is dropped) */
function flipFilterAt(i) {
  const f = S.filters[i];
  if (!f || f.type === 'variants') return;
  const g = Object.assign({}, f, { not: !f.not });
  const j = findFilter(g);
  if (j >= 0) S.filters.splice(j, 1);
  S.filters[S.filters.indexOf(f)] = g;
  recompute();
}
function variantFilter() { return S.filters.find(f => f.type === 'variants') || null; }
function setVariantSelection(keys) {
  const present = S.vList.map(v => v.key);
  const sel = new Set(present.filter(k => keys.has(k)));
  const idx = S.filters.findIndex(f => f.type === 'variants');
  if (sel.size === present.length) { if (idx >= 0) S.filters.splice(idx, 1); }
  else {
    const f = { type: 'variants', keys: sel };
    if (idx >= 0) S.filters[idx] = f; else S.filters.push(f);
  }
  recompute();
}
function chipLabel(f) {
  switch (f.type) {
    case 'variants': {
      const ranks = [...f.keys].map(k => S.model.variantByKey.get(k).rank).sort((a, b) => a - b);
      return ['Variants', ranks.length === 0 ? 'none selected' : ranks.length <= 4 ? ranks.map(r => '#' + r).join(', ') : ranks.length + ' selected'];
    }
    case 'activity': return ['Activity', f.act];
    case 'edge': return [f.from === C.START ? 'Starts with' : f.to === C.END ? 'Ends with' : 'Path', f.from === C.START ? f.to : f.to === C.END ? f.from : f.from + ' → ' + f.to];
    case 'role': return ['Role', f.role];
    case 'employee': { const e = D.employees[f.emp]; return ['Employee', f.emp + (e ? ' · ' + e[0] : '')]; }
    case 'company': return ['Customer', f.company || '(no customer)'];
    case 'case': return ['Order', String(f.id)];
    case 'sod': return ['SoD', f.act + ' by ' + f.role];
  }
  return [f.type, ''];
}
function renderCrumbs() {
  const host = $('chips');
  if (!S.filters.length) {
    host.innerHTML = '<span class="chips-empty">None — click an activity, path, table value or cross-tab cell to add one · click a pill to flip it between include and exclude</span>';
  } else {
    host.innerHTML = S.filters.map((f, i) => {
      const [t, v] = chipLabel(f);
      const body = '<span class="t">' + (f.not ? 'not ' : '') + esc(t) + '</span><span class="v">' + esc(v) + '</span>';
      /* the pill body flips include ↔ exclude; the variant selection is a plain label (use the list to change it) */
      const pill = f.type === 'variants'
        ? '<span class="flip static" title="' + esc(v) + ' — use the variant list to change the selection">' + body + '</span>'
        : '<button class="flip" data-i="' + i + '" title="' + esc(v) + ' — click to ' + (f.not ? 'include instead of exclude' : 'exclude instead of include') + '">' + body + '</button>';
      return '<span class="chip' + (f.not ? ' not' : '') + '">' + pill +
        '<button class="x" data-i="' + i + '" aria-label="Remove filter" title="Remove filter">×</button></span>';
    }).join('');
  }
  $('clearFilters').hidden = !S.filters.length;
  $('crumbCount').textContent = C.fmtNum(S.ids.size) + ' of ' + C.fmtNum(S.allIds.size) + ' orders';
}
function wireCrumbs() {
  $('chips').addEventListener('click', ev => {
    const x = ev.target.closest('button.x');
    if (x) { removeFilterAt(+x.dataset.i); return; }
    const fl = ev.target.closest('button.flip');
    if (fl) flipFilterAt(+fl.dataset.i);
  });
  $('clearFilters').addEventListener('click', clearFilters);
}

/* ---------- process-map filter menu ----------
   Clicking an activity or connection on the map opens a small menu next to the pointer
   instead of filtering straight away: Include (keep only matching orders), Exclude
   (drop them) and, when one of those is already applied, Clear this filter. */
let mapMenu = null;
function closeMapMenu() { if (mapMenu) { mapMenu.remove(); mapMenu = null; } }
function filterPhrase(f) {
  if (f.type === 'activity') return 'orders with this activity';
  if (f.from === C.START) return 'orders that start with ' + f.to;
  if (f.to === C.END) return 'orders that end with ' + f.from;
  return 'orders taking this path';
}
function openMapMenu(f, ev) {
  closeMapMenu();
  tip(null);
  const inc = hasFilter(Object.assign({}, f, { not: false })), exc = hasFilter(Object.assign({}, f, { not: true }));
  const dfg = S.dfg;
  let title, stat = '';
  if (f.type === 'activity') {
    const n = dfg && dfg.nodes.get(f.act);
    title = f.act;
    if (n) stat = C.fmtNum(n.count) + (n.count === 1 ? ' event' : ' events') + ' · ' + C.fmtNum(n.caseCount) + ' of ' + C.fmtNum(dfg.totalCases) + ' orders in scope';
  } else {
    const e = dfg && dfg.edges.get(f.from + C.SEP + f.to);
    title = nameOf(f.from) + ' → ' + nameOf(f.to);
    if (e) stat = C.fmtNum(e.caseCount) + (e.caseCount === 1 ? ' order' : ' orders') + ' take this connection';
  }
  const what = filterPhrase(f);
  const m = document.createElement('div');
  m.className = 'menu map-menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = '<div class="menu-head"><b>' + esc(title) + '</b>' + (stat ? '<span>' + esc(stat) + '</span>' : '') + '</div>' +
    '<button class="keep' + (inc ? ' on' : '') + '" data-act="include" role="menuitem"><i>✓</i>Include — keep only ' + esc(what) + '</button>' +
    '<button class="drop' + (exc ? ' on' : '') + '" data-act="exclude" role="menuitem"><i>⊘</i>Exclude — remove ' + esc(what) + '</button>' +
    (inc || exc ? '<button class="remove" data-act="clear" role="menuitem"><i>×</i>Clear this filter</button>' : '');
  m.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    e.stopPropagation();
    const a = b.dataset.act;
    closeMapMenu();
    if (a === 'include') setFilter(f, false);
    else if (a === 'exclude') setFilter(f, true);
    else removeFilter(f);
  });
  m.addEventListener('mousedown', e => e.stopPropagation());
  document.body.appendChild(m);
  mapMenu = m;
  /* place next to the pointer, kept inside the viewport */
  const pad = 8, r = m.getBoundingClientRect();
  let x = ev.clientX + 6, y = ev.clientY + 6;
  if (x + r.width > window.innerWidth - pad) x = Math.max(pad, ev.clientX - r.width - 6);
  if (y + r.height > window.innerHeight - pad) y = Math.max(pad, ev.clientY - r.height - 6);
  m.style.left = x + 'px';
  m.style.top = y + 'px';
  const first = m.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}
document.addEventListener('mousedown', ev => { if (mapMenu && !mapMenu.contains(ev.target)) closeMapMenu(); });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeMapMenu(); });
window.addEventListener('resize', closeMapMenu);
document.addEventListener('wheel', ev => { if (mapMenu && !mapMenu.contains(ev.target)) closeMapMenu(); }, { passive: true });

/* ---------- Introduction ---------- */
function renderIntro(first) {
  const month = first.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  $('introLead').textContent = 'Process-mining dashboards for BW Fishing’s sales-order event log for ' + month +
    ' — every recorded step of every order, with its timestamp and the employee or system that performed it. Use the tabs to see how the order-to-cash process actually ran and whether the credit-approval and segregation-of-duties controls operated as designed.';
}

/* ---------- Dashboard ---------- */
function renderOverview() {
  const sum = C.summary(S.model, S.ids);
  $('kSales').textContent = C.fmtNum(sum.cases);
  $('kValue').textContent = '$' + C.fmtMoney(sum.value);
  $('kCust').textContent = C.fmtNum(sum.customers);
  $('kVariants').textContent = C.fmtNum(sum.variants);
  $('kAvg').textContent = sum.cases ? sum.avgEvents.toFixed(2) : '—';
  $('kDenied').textContent = sum.cases ? C.fmtPct(sum.deniedPct, 2) : '—';
  renderBarChart($('actChart'), C.activityCounts(S.model, S.ids));
}
function renderBarChart(host, rows) {
  const W = 1400, rowH = 30, left = 330, right = 40, top = 12, bottom = 34;
  const H = top + Math.max(rows.length, 1) * rowH + bottom;
  const max = rows.length ? Math.max(...rows.map(r => r.count)) : 1;
  const stepV = max > 1000 ? 500 : max > 400 ? 100 : max > 150 ? 50 : max > 40 ? 10 : max > 10 ? 5 : 1;
  const xmax = Math.max(stepV, Math.ceil(max / stepV) * stepV);
  const x = v => left + (W - left - right) * v / xmax;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Number of times each activity is performed');
  const mk = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); (p || svg).appendChild(e); return e; };
  const y0 = top, y1 = top + rows.length * rowH;
  for (let v = 0; v <= xmax; v += stepV) {
    mk('line', { x1: x(v), x2: x(v), y1: y0, y2: y1 + 4, class: v === 0 ? 'axis' : 'grid' });
    const t = mk('text', { x: x(v), y: y1 + 22, class: 'val' }); t.textContent = C.fmtNum(v);
  }
  rows.forEach((r, i) => {
    const cy = top + i * rowH + rowH / 2, bh = 18, x0 = x(0), x1 = x(r.count), rr = 4;
    const on = hasFilter({ type: 'activity', act: r.name }), ex = hasFilter({ type: 'activity', act: r.name, not: true });
    const g = mk('g', { class: 'bar-g' + (on ? ' sel' : '') + (ex ? ' ex' : '') });
    const lab = mk('text', { x: left - 14, y: cy, class: 'cat' }, g); lab.textContent = r.name;
    mk('line', { x1: left - 8, x2: left, y1: cy, y2: cy, class: 'tick' }, g);
    const w = Math.max(x1 - x0, rr);
    const d = 'M' + x0 + ',' + (cy - bh / 2) + ' h' + (w - rr) + ' a' + rr + ',' + rr + ' 0 0 1 ' + rr + ',' + rr +
      ' v' + (bh - 2 * rr) + ' a' + rr + ',' + rr + ' 0 0 1 -' + rr + ',' + rr + ' h-' + (w - rr) + ' z';
    mk('path', { d, class: 'bar' }, g);
    const vl = mk('text', { x: x1 + 8, y: cy, class: 'bar-val' }, g); vl.textContent = C.fmtNum(r.count);
    mk('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, class: 'bar-hit' }, g);
    const share = S.ids.size ? r.count / S.ids.size : 0;
    g.addEventListener('mousemove', ev => tip('<b>' + esc(r.name) + '</b><br>' + C.fmtNum(r.count) + ' times · in ' + C.fmtPct(share, 1) + ' of the ' + C.fmtNum(S.ids.size) + ' orders in scope' +
      '<br><i>' + (on ? 'click to remove this filter' : 'click to keep only orders with this activity · shift-click to exclude them') + '</i>', ev.clientX, ev.clientY));
    g.addEventListener('mouseleave', () => tip(null));
    g.addEventListener('click', ev => { tip(null); toggleFilter({ type: 'activity', act: r.name, not: !!ev.shiftKey }); });
  });
  host.innerHTML = '';
  host.appendChild(svg);
}

/* ---------- Process Variants ---------- */
function selectedKeys() {
  const vf = variantFilter();
  const present = S.vList.map(v => v.key);
  return new Set(vf ? present.filter(k => vf.keys.has(k)) : present);
}
function sortedVariants() {
  const vs = S.vList.slice();
  const { col, dir } = S.vSort;
  const k = dir === 'asc' ? 1 : -1;
  vs.sort((a, b) => {
    const av = col === 'tpt' ? a.avgDur : a.count, bv = col === 'tpt' ? b.avgDur : b.count;
    return k * (av - bv) || a.rank - b.rank;
  });
  return vs;
}
function strip(acts) {
  return '<span class="strip">' + acts.map(a => {
    const c = CAT_INFO[CAT[a] || 'flow'];
    return '<i style="background:' + c[1] + '" title="' + esc(a) + '"></i>';
  }).join('') + '</span>';
}
function renderVariants() {
  S.vList = C.variantStats(S.model, S.baseIds);
  const sel = selectedKeys();
  const base = S.baseIds.size;
  const tb = $('variantTable').querySelector('tbody');
  const solo = sel.size === 1;
  tb.innerHTML = sortedVariants().map(v => {
    const on = sel.has(v.key);
    return '<tr data-rank="' + v.rank + '" class="' + (on ? (solo ? 'solo' : '') : 'off') + '">' +
      '<td class="chk"><input type="checkbox" ' + (on ? 'checked' : '') + ' aria-label="Variant ' + v.rank + '"></td>' +
      '<td class="rank">#' + v.rank + '</td>' +
      '<td>' + strip(v.acts) + '</td>' +
      '<td class="num">' + C.fmtNum(v.count) + '</td>' +
      '<td><span class="cov"><span class="cov-bar"><i style="width:' + (base ? (100 * v.count / base).toFixed(1) : 0) + '%"></i></span><span class="cov-pct">' + (base ? Math.round(100 * v.count / base) : 0) + '%</span></span></td>' +
      '<td class="num">' + C.fmtDur(v.avgDur) + '</td></tr>';
  }).join('');
  document.querySelectorAll('.variant-table th.sortable').forEach(th => {
    th.classList.toggle('asc', th.dataset.sort === S.vSort.col && S.vSort.dir === 'asc');
    th.classList.toggle('desc', th.dataset.sort === S.vSort.col && S.vSort.dir === 'desc');
  });
  $('thTimeLabel').textContent = 'Avg time' + (S.durUnit === 'auto' ? '' : ' (' + { s: 's', m: 'min', h: 'h', d: 'd' }[S.durUnit] + ')');
  /* coverage */
  const n = S.ids.size;
  const frac = base ? n / base : 0;
  const circ = 2 * Math.PI * 38;
  $('donutRing').style.strokeDasharray = (frac * circ).toFixed(2) + ' ' + circ.toFixed(2);
  $('donutPct').textContent = Math.round(100 * frac) + '%';
  $('covCases').textContent = C.fmtNum(n) + ' of ' + C.fmtNum(base) + ' cases';
  $('covVariants').textContent = sel.size + ' of ' + S.vList.length + ' variants selected';
  $('veSub').textContent = C.fmtNum(S.model.variants.length) + ' variants in the full log · ' + C.fmtNum(S.vList.length) + ' in scope';
  const all = $('chkAll');
  all.checked = sel.size === S.vList.length && S.vList.length > 0;
  all.indeterminate = sel.size > 0 && sel.size < S.vList.length;
}
function renderMap() {
  if (!S.mapDirty) return;
  closeMapMenu();
  const dfg = C.buildDFG(S.model, S.ids);
  S.dfg = dfg;
  const selA = new Set(), exA = new Set(), selE = new Set(), exE = new Set();
  for (const f of S.filters) {
    if (f.type === 'activity') (f.not ? exA : selA).add(f.act);
    if (f.type === 'edge') (f.not ? exE : selE).add(f.from + C.SEP + f.to);
  }
  /* re-fit when the drawn graph changes (different nodes/edges); keep the view for filter highlights + metric toggles */
  const sig = [...dfg.edges.keys()].sort().join('|');
  const refit = sig !== S.mapSig;
  S.mapSig = sig;
  S.map = window.PMDiagram.render($('diagram'), dfg, {
    metric: S.metric, selA, exA, selE, exE, refit, nodeColor, topInset: 50,
    onZoom: k => { $('zoomPct').textContent = Math.round(k * 100) + '%'; },
    /* plain click opens the include / exclude menu; shift-click is a shortcut that excludes straight away */
    onNodeClick: (name, ev) => ev.shiftKey ? setFilter({ type: 'activity', act: name }, true) : openMapMenu({ type: 'activity', act: name }, ev),
    onEdgeClick: (e, ev) => ev.shiftKey ? setFilter({ type: 'edge', from: e.from, to: e.to }, true) : openMapMenu({ type: 'edge', from: e.from, to: e.to }, ev)
  });
  S.mapDirty = false;
}
function renderPresetButtons() {
  $('presetButtons').innerHTML = CFG.PRESETS.map(p =>
    '<button class="mini-btn" data-preset="' + esc(p.id) + '">' + esc(p.label) + '</button>').join('');
}
function wireExplorer() {
  const table = $('variantTable');
  const tb = table.querySelector('tbody');
  tb.addEventListener('click', ev => {
    const tr = ev.target.closest('tr');
    if (!tr) return;
    const v = S.vList.find(x => x.rank === +tr.dataset.rank);
    if (!v) return;
    const sel = selectedKeys();
    const isBox = ev.target.matches('input[type="checkbox"]');
    if (isBox || ev.ctrlKey || ev.metaKey) {          // toggle one
      if (sel.has(v.key)) sel.delete(v.key); else sel.add(v.key);
      setVariantSelection(sel);
    } else {                                           // solo (click again on the solo row = back to all)
      if (sel.size === 1 && sel.has(v.key)) setVariantSelection(new Set(S.vList.map(x => x.key)));
      else setVariantSelection(new Set([v.key]));
    }
  });
  tb.addEventListener('mousemove', ev => {
    const tr = ev.target.closest('tr');
    if (!tr) return;
    const v = S.vList.find(x => x.rank === +tr.dataset.rank);
    if (!v) return;
    tip('<b>Variant #' + v.rank + '</b> · ' + C.fmtNum(v.count) + ' cases · ' + v.acts.length + ' steps<br>' +
      'avg throughput ' + C.fmtDurLong(v.avgDur) + ' · median ' + C.fmtDurLong(v.medDur) +
      '<span class="path">' + v.acts.map((a, i) => (i + 1) + '. ' + esc(a)).join('<br>') + '</span>', ev.clientX, ev.clientY);
  });
  tb.addEventListener('mouseleave', () => tip(null));
  table.querySelector('th[data-sort="count"]').addEventListener('click', () => {
    S.vSort = { col: 'count', dir: S.vSort.col === 'count' && S.vSort.dir === 'desc' ? 'asc' : 'desc' };
    renderVariants();
  });
  /* Avg time header: a menu with sort direction + display unit */
  const thTime = $('thTime'), tMenu = $('timeMenu');
  const syncTimeMenu = () => {
    tMenu.querySelectorAll('[data-unit]').forEach(b => b.classList.toggle('on', b.dataset.unit === S.durUnit));
    tMenu.querySelectorAll('[data-tsort]').forEach(b => b.classList.toggle('on', S.vSort.col === 'tpt' && S.vSort.dir === b.dataset.tsort));
  };
  const closeTimeMenu = () => { tMenu.hidden = true; };
  thTime.addEventListener('click', ev => {
    if (ev.target.closest('.menu')) return;
    ev.stopPropagation();
    syncTimeMenu();
    tMenu.hidden = !tMenu.hidden;
  });
  tMenu.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    if (!b) return;
    ev.stopPropagation();
    if (b.dataset.tsort) { S.vSort = { col: 'tpt', dir: b.dataset.tsort }; renderVariants(); }
    if (b.dataset.unit) {
      S.durUnit = b.dataset.unit; C.setDurUnit(S.durUnit);
      renderVariants();
      if (S.metric === 'time') { S.mapDirty = true; renderMap(); }
    }
    closeTimeMenu();
  });
  document.addEventListener('mousedown', ev => { if (!tMenu.hidden && !thTime.contains(ev.target)) closeTimeMenu(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeTimeMenu(); });

  /* collapse / expand the variant list */
  const setCollapsed = on => {
    S.panelCollapsed = on;
    $('variantPanel').classList.toggle('collapsed', on);
    document.querySelector('.explorer-body').classList.toggle('collapsed', on);
    $('btnExpand').hidden = !on;
    setTimeout(() => { if (S.map) S.map.fit(); }, 220);
  };
  $('btnCollapse').addEventListener('click', () => setCollapsed(true));
  $('btnExpand').addEventListener('click', () => setCollapsed(false));
  $('chkAll').addEventListener('change', ev => setVariantSelection(ev.target.checked ? new Set(S.vList.map(v => v.key)) : new Set()));

  /* presets (config: CFG.PRESETS in js/config.js — add an entry there to add a button) */
  renderPresetButtons();
  $('presetButtons').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-preset]');
    if (!b) return;
    const preset = CFG.PRESETS.find(p => p.id === b.dataset.preset);
    if (preset) setVariantSelection(preset.pick(S.vList));
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { $('legendBox').hidden = true; $('btnLegend').setAttribute('aria-expanded', 'false'); } });

  /* metric toggle + map controls */
  document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    S.metric = b.dataset.metric;
    document.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x === b));
    S.mapDirty = true; renderMap();
  }));
  $('btnFit').addEventListener('click', () => S.map && S.map.fit());
  $('btnZoomIn').addEventListener('click', () => S.map && S.map.zoomBy(1.25));
  $('btnZoomOut').addEventListener('click', () => S.map && S.map.zoomBy(0.8));
  $('btnLegend').addEventListener('click', () => {
    const box = $('legendBox');
    box.hidden = !box.hidden;
    $('btnLegend').setAttribute('aria-expanded', box.hidden ? 'false' : 'true');
  });
}

/* ---------- Transaction Details ---------- */
function rebuildTx() {
  const rows = [];
  for (const cid of S.ids) {
    const c = S.model.cases.get(cid);
    for (const e of c.events) rows.push({
      id: +c.id, act: e.act, ts: e.ts, emp: e.emp, role: e.roleId, roleName: e.role, empName: e.empName,
      company: c.company, amount: c.amount
    });
  }
  rows.sort((a, b) => a.id - b.id || a.ts - b.ts);
  S.tx.rows = rows;
  applyTx();
}
function wireTransactions() {
  const scroll = $('txScroll');
  scroll.addEventListener('scroll', () => {
    if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 400) appendTxRows();
  });
  let t = null;
  $('txSearch').addEventListener('input', ev => {
    clearTimeout(t);
    t = setTimeout(() => { S.tx.q = ev.target.value.trim().toLowerCase(); applyTx(); }, 120);
  });
  document.querySelectorAll('#txTable th.sortable').forEach(th => th.addEventListener('click', () => {
    const col = th.dataset.col;
    S.tx.sort = { col, dir: S.tx.sort.col === col && S.tx.sort.dir === 'asc' ? 'desc' : 'asc' };
    applyTx();
  }));
  /* value clicks → filters (positional data-i/data-c, values never travel through attributes) */
  $('txTable').querySelector('tbody').addEventListener('click', ev => {
    const cell = ev.target.closest('.cell-link');
    if (!cell) return;
    const r = S.tx.view[+cell.dataset.i];
    if (!r) return;
    const f = txFilterFor(r, cell.dataset.c);
    if (f) { f.not = !!ev.shiftKey; toggleFilter(f); }
  });
}
function txFilterFor(r, col) {
  switch (col) {
    case 'id': return { type: 'case', id: r.id };
    case 'act': return { type: 'activity', act: r.act };
    case 'emp': case 'empName': return { type: 'employee', emp: r.emp };
    case 'role': return { type: 'role', role: r.roleName };
    case 'company': return { type: 'company', company: r.company };
  }
  return null;
}
/* value filters narrow the TABLE to matching rows (case membership is applied first, in rebuildTx) */
function rowMatches(r, f) {
  switch (f.type) {
    case 'case': return r.id === +f.id;
    case 'activity': return r.act === f.act;
    case 'employee': return r.emp === f.emp;
    case 'role': return r.roleName === f.role;
    case 'company': return r.company === f.company;
    case 'sod': return r.act === f.act && r.roleName === f.role;
  }
  return true;
}
function applyTx() {
  const { rows, q, sort } = S.tx;
  let view = rows;
  const rowFilters = S.filters.filter(f => !f.not && f.type !== 'variants' && f.type !== 'edge');
  if (rowFilters.length) view = view.filter(r => rowFilters.every(f => rowMatches(r, f)));
  if (q) {
    view = rows.filter(r =>
      String(r.id).includes(q) || r.act.toLowerCase().includes(q) || r.company.toLowerCase().includes(q) ||
      String(r.emp) === q || r.empName.toLowerCase().includes(q) || r.roleName.toLowerCase().includes(q));
  }
  const k = sort.dir === 'asc' ? 1 : -1;
  const cmp = {
    id: (a, b) => a.id - b.id, act: (a, b) => a.act.localeCompare(b.act), ts: (a, b) => a.ts - b.ts,
    emp: (a, b) => a.emp - b.emp, empName: (a, b) => a.empName.localeCompare(b.empName), role: (a, b) => a.role - b.role || a.roleName.localeCompare(b.roleName), company: (a, b) => a.company.localeCompare(b.company),
    amount: (a, b) => a.amount - b.amount
  }[sort.col];
  view = view.slice().sort((a, b) => k * cmp(a, b) || a.id - b.id || a.ts - b.ts);
  S.tx.view = view;
  S.tx.shown = 0;
  document.querySelectorAll('#txTable th.sortable').forEach(th => {
    th.classList.toggle('sorted', th.dataset.col === sort.col);
    th.classList.toggle('asc', th.dataset.col === sort.col && sort.dir === 'asc');
  });
  $('txTable').querySelector('tbody').innerHTML = '';
  $('txScroll').scrollTop = 0;
  appendTxRows();
  const seen = new Set();
  let value = 0;
  for (const r of view) if (!seen.has(r.id)) { seen.add(r.id); value += r.amount || 0; }
  $('soValue').textContent = '$' + C.fmtMoney(value);
  $('txCount').textContent = C.fmtNum(view.length) + (view.length === 1 ? ' row' : ' rows') + ' · ' + C.fmtNum(seen.size) + (seen.size === 1 ? ' order' : ' orders') +
    (rowFilters.length ? ' matching the filters' : '') + (q ? ' · search “' + q + '”' : '');
}
function appendTxRows() {
  const { view, shown, sort } = S.tx;
  if (shown >= view.length) return;
  const end = Math.min(view.length, shown + PAGE);
  const byCase = sort.col === 'id';
  const on = (type, key, val) => hasFilter(Object.assign({ type }, { [key]: val }));
  let html = '';
  for (let i = shown; i < end; i++) {
    const r = view[i];
    const startsCase = byCase && i > 0 && view[i - 1].id !== r.id;
    const link = (c, txt, active) => '<span class="cell-link' + (active ? ' on' : '') + '" data-i="' + i + '" data-c="' + c + '">' + txt + '</span>';
    html += '<tr' + (startsCase ? ' class="case-start"' : '') + '>' +
      '<td class="num">' + link('id', r.id, on('case', 'id', r.id)) + '</td>' +
      '<td>' + link('act', esc(r.act), on('activity', 'act', r.act)) + '</td>' +
      '<td class="num">' + C.fmtDateTime(r.ts) + '</td>' +
      '<td class="num">' + link('emp', r.emp, on('employee', 'emp', r.emp)) + '</td>' +
      '<td class="name" title="Employee ' + r.emp + '">' + link('empName', esc(r.empName), on('employee', 'emp', r.emp)) + '</td>' +
      '<td title="Role code ' + (r.role == null ? '' : r.role) + '">' + link('role', esc(r.roleName), on('role', 'role', r.roleName)) + '</td>' +
      '<td class="wrap" title="' + esc(r.company) + '">' + link('company', esc(r.company), on('company', 'company', r.company)) + '</td>' +
      '<td class="num">' + (r.amount == null ? '' : '$' + C.fmtMoney(r.amount)) + '</td></tr>';
  }
  $('txTable').querySelector('tbody').insertAdjacentHTML('beforeend', html);
  S.tx.shown = end;
}

/* ---------- Segregation of Duties ---------- */
function renderSod() {
  const { roles, rows } = C.activityByRole(S.model, S.ids, S.sod.roles, S.sod.acts);
  const onRole = r => hasFilter({ type: 'role', role: r }), onAct = a => hasFilter({ type: 'activity', act: a });
  let html = '<thead><tr><th class="corner"></th>' +
    roles.map((r, j) => '<th class="click' + (onRole(r) ? ' on' : '') + '" data-r="' + j + '" title="Click to keep only orders this role worked on">' + esc(r) + '</th>').join('') + '</tr></thead><tbody>';
  rows.forEach((row, i) => {
    html += '<tr><th class="rowh click' + (onAct(row.act) ? ' on' : '') + '" scope="row" data-a="' + i + '" title="Click to keep only orders with this activity">' + esc(row.act) + '</th>' +
      row.counts.map((n, j) => n
        ? '<td class="hit' + (hasFilter({ type: 'sod', act: row.act, role: roles[j] }) ? ' on' : '') + '" data-a="' + i + '" data-r="' + j + '" title="Click to keep only orders where ' + esc(roles[j]) + ' performed ' + esc(row.act) + '">' + C.fmtNum(n) + '</td>'
        : '<td></td>').join('') + '</tr>';
  });
  $('sodTable').innerHTML = html + '</tbody>';
  S.sod.cur = { roles, rows };
}
document.addEventListener('DOMContentLoaded', () => {
  $('sodTable').addEventListener('click', ev => {
    const t = ev.target.closest('td.hit, th.click');
    if (!t) return;
    const { roles, rows } = S.sod.cur;
    const not = !!ev.shiftKey;
    if (t.tagName === 'TD') toggleFilter({ type: 'sod', act: rows[+t.dataset.a].act, role: roles[+t.dataset.r], not });
    else if (t.dataset.a != null) toggleFilter({ type: 'activity', act: rows[+t.dataset.a].act, not });
    else toggleFilter({ type: 'role', role: roles[+t.dataset.r], not });
  });
});

/* ---------- shared tooltip ---------- */
let tipEl = null;
function tip(html, x, y) {
  if (!tipEl) tipEl = $('tooltip');
  if (!html) { tipEl.hidden = true; return; }
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const pad = 14, r = tipEl.getBoundingClientRect();
  let tx = x + pad, ty = y + pad;
  if (tx + r.width > window.innerWidth - 8) tx = x - r.width - pad;
  if (ty + r.height > window.innerHeight - 8) ty = y - r.height - pad;
  tipEl.style.left = tx + 'px';
  tipEl.style.top = ty + 'px';
}

window.BWF = { S, switchTab, toggleFilter, setFilter, removeFilter, flipFilterAt, clearFilters, setVariantSelection, recompute };
})();
