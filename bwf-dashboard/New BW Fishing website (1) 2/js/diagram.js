/* B W Fishing dashboards — interactive process map (dagre layout + hand-rolled SVG).
   Trimmed from Process Mining Lab diagram.js: layout, frequency coloring, tooltips,
   smooth pan/zoom (wheel, drag, double-click, touch pinch), fit + zoom controls. */
(function (g) {
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const NODE_W = 292, NODE_H = 58, TERM_W = 96, TERM_H = 30;

function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function lerpColor(a, b, t) {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return 'rgb(' + c.join(',') + ')';
}
/* frequency: EYARC light blue #B5E2FA → navy #002E5D */
function colorScale(t) { return lerpColor([214, 238, 252], [0, 46, 93], t); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let tipEl = null;
function tip(html, x, y) {
  if (!tipEl) tipEl = document.getElementById('tooltip');
  if (!tipEl) return;
  if (!html) { tipEl.hidden = true; return; }
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const pad = 14;
  const r = tipEl.getBoundingClientRect();
  let tx = x + pad, ty = y + pad;
  if (tx + r.width > window.innerWidth - 8) tx = x - r.width - pad;
  if (ty + r.height > window.innerHeight - 8) ty = y - r.height - pad;
  tipEl.style.left = tx + 'px';
  tipEl.style.top = ty + 'px';
}

function edgePath(points) {
  let d = 'M' + points[0].x + ',' + points[0].y;
  if (points.length === 2) return d + ' L' + points[1].x + ',' + points[1].y;
  for (let i = 1; i < points.length - 1; i++) {
    const c = points[i], n = points[i + 1];
    if (i === points.length - 2) d += ' Q' + c.x + ',' + c.y + ' ' + n.x + ',' + n.y;
    else d += ' Q' + c.x + ',' + c.y + ' ' + (c.x + n.x) / 2 + ',' + (c.y + n.y) / 2;
  }
  return d;
}

/* opts: { metric: 'cases'|'time', selA: Set<activity>, selE: Set<edgeKey>, exA: Set, exE: Set,
           nodeColor(name) -> { fill, ink: 'light'|'dark' }   (default: frequency shading),
           refit: bool (re-fit the view instead of keeping the previous pan/zoom), topInset: px reserved for controls,
           onZoom(k), onNodeClick(name, ev), onEdgeClick(edge, ev) } */
function render(container, dfg, opts) {
  const C = g.PMCore;
  opts = opts || {};
  if (container._pmCleanup) container._pmCleanup();
  container.innerHTML = '';
  if (!dfg.nodes.size) {
    container.innerHTML = '<div class="diagram-empty">No cases selected — tick a variant to draw the process.</div>';
    return { fit() {}, zoomBy() {}, zoom() { return 1; } };
  }

  /* ---- layout ---- */
  const gr = new dagre.graphlib.Graph({ multigraph: true });
  /* align 'UL' keeps the main path as a straight vertical spine; skips fan out to the side */
  gr.setGraph(Object.assign({ rankdir: 'TB', align: 'UL', nodesep: 28, ranksep: 44, marginx: 24, marginy: 18 }, opts.layout || {}));
  gr.setDefaultEdgeLabel(() => ({}));
  gr.setNode(C.START, { width: TERM_W, height: TERM_H });
  gr.setNode(C.END, { width: TERM_W, height: TERM_H });
  for (const n of dfg.nodes.values()) gr.setNode(n.name, { width: NODE_W, height: NODE_H });
  const edges = [...dfg.edges.values()];
  edges.forEach((e, i) => {
    if (e.from !== e.to) gr.setEdge(e.from, e.to, { width: 62, height: 24, labelpos: 'c' }, 'e' + i);
  });
  dagre.layout(gr);
  const gw = gr.graph().width || 400, gh = gr.graph().height || 300;

  /* performance scaling (avg wait on each connection) */
  const timeMode = opts.metric === 'time';
  const avgByKey = new Map();
  let maxAvg = 0;
  for (const e of edges) {
    const a = e.durs.length ? C.mean(e.durs) : null;
    avgByKey.set(e.key, a);
    if (a != null && a > maxAvg) maxAvg = a;
  }
  const selA = opts.selA || new Set(), selE = opts.selE || new Set();
  const exA = opts.exA || new Set(), exE = opts.exE || new Set();

  /* ---- svg scaffold ---- */
  const svg = el('svg', { class: 'pm-svg' }, container);
  const defs = el('defs', {}, svg);
  for (const [id, col] of [['arr', '#0D65C7'], ['arrSel', '#C99A00'], ['arrEx', '#F84725']]) {
    const m = el('marker', { id, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0,0 L10,5 L0,10 z', fill: col }, m);
  }
  const vp = el('g', {}, svg);
  const name = x => x === C.START ? 'Start' : x === C.END ? 'End' : x;
  let dragged = false;

  /* ---- edges ---- */
  edges.forEach((e, i) => {
    const grp = el('g', { class: 'pm-edge' + (selE.has(e.key) ? ' sel' : '') + (exE.has(e.key) ? ' ex' : '') }, vp);
    let d, lx, ly;
    if (e.from === e.to) { // self-loop (rework)
      const n = gr.node(e.from);
      const x = n.x + NODE_W / 2, y = n.y;
      d = 'M' + (x - 4) + ',' + (y - 14) + ' C' + (x + 66) + ',' + (y - 36) + ' ' + (x + 66) + ',' + (y + 36) + ' ' + (x - 4) + ',' + (y + 14);
      lx = x + 52; ly = y;
    } else {
      const ge = gr.edge(e.from, e.to, 'e' + i);
      d = edgePath(ge.points);
      lx = ge.x != null ? ge.x : (ge.points[0].x + ge.points[ge.points.length - 1].x) / 2;
      ly = ge.y != null ? ge.y : (ge.points[0].y + ge.points[ge.points.length - 1].y) / 2;
    }
    const isTerm = e.from === C.START || e.to === C.END;
    el('path', { d, class: 'edge-hit', fill: 'none' }, grp);
    const avg = avgByKey.get(e.key);
    const frac = (timeMode && maxAvg > 0) ? (avg != null ? avg / maxAvg : 0) : e.caseCount / dfg.maxEdgeCase;
    const w = 1.5 + 5.5 * frac;
    const marker = selE.has(e.key) ? 'arrSel' : exE.has(e.key) ? 'arrEx' : 'arr';
    el('path', { d, fill: 'none', class: 'edge-line' + (isTerm ? ' term' : '') + (timeMode ? ' time' : ''), 'stroke-width': w.toFixed(1), 'marker-end': 'url(#' + marker + ')' }, grp);
    const label = timeMode ? (avg != null ? C.fmtDur(avg) : '') : C.fmtNum(e.caseCount);
    if (label) {
      const lt = el('text', { x: lx, y: ly, class: 'edge-label' }, grp);
      lt.textContent = label;
      let bb;
      try { bb = lt.getBBox(); } catch (_) { bb = { x: lx - 14, y: ly - 8, width: 28, height: 16 }; }
      const bg = el('rect', { x: bb.x - 6, y: bb.y - 2.5, width: bb.width + 12, height: bb.height + 5, rx: 9, class: 'edge-label-bg' });
      grp.insertBefore(bg, lt);
    }
    const md = C.median(e.durs);
    grp.addEventListener('mousemove', ev => tip(
      '<b>' + esc(name(e.from)) + ' → ' + esc(name(e.to)) + '</b><br>' +
      C.fmtNum(e.caseCount) + ' cases · ' + C.fmtNum(e.freq) + ' occurrences' +
      (avg != null && !isTerm ? '<br>avg wait ' + C.fmtDurLong(avg) + ' · median ' + C.fmtDurLong(md) : '') +
      '<br><i>click to include or exclude cases taking this path</i>', ev.clientX, ev.clientY));
    grp.addEventListener('mouseleave', () => tip(null));
    grp.addEventListener('click', ev => { ev.stopPropagation(); if (dragged) return; if (opts.onEdgeClick) opts.onEdgeClick(e, ev); });
  });

  /* ---- activity nodes ---- */
  for (const n of dfg.nodes.values()) {
    const pos = gr.node(n.name);
    const grp = el('g', { class: 'pm-node' + (selA.has(n.name) ? ' sel' : '') + (exA.has(n.name) ? ' ex' : ''), transform: 'translate(' + (pos.x - NODE_W / 2) + ',' + (pos.y - NODE_H / 2) + ')' }, vp);
    const t = n.count / dfg.maxNode;
    const col = opts.nodeColor ? opts.nodeColor(n.name) : { fill: colorScale(t), ink: t > 0.55 ? 'light' : 'dark' };
    el('rect', { width: NODE_W, height: NODE_H, rx: 8, class: 'node-rect', fill: col.fill }, grp);
    const dark = col.ink === 'light';
    const t1 = el('text', { x: NODE_W / 2, y: 25, class: 'node-name' + (dark ? ' inv' : '') }, grp);
    t1.textContent = truncate(n.name, 36);
    const t2 = el('text', { x: NODE_W / 2, y: 45, class: 'node-count' + (dark ? ' inv' : '') }, grp);
    t2.textContent = C.fmtNum(n.count) + (n.count === 1 ? ' event' : ' events');
    grp.addEventListener('mousemove', ev => tip(
      '<b>' + esc(n.name) + '</b><br>' + C.fmtNum(n.count) + ' events · ' + C.fmtNum(n.caseCount) + ' of ' + C.fmtNum(dfg.totalCases) + ' cases' +
      '<br><i>click to include or exclude cases with this activity</i>', ev.clientX, ev.clientY));
    grp.addEventListener('mouseleave', () => tip(null));
    grp.addEventListener('click', ev => { ev.stopPropagation(); if (dragged) return; if (opts.onNodeClick) opts.onNodeClick(n.name, ev); });
  }

  /* ---- start / end terminals ---- */
  for (const [id, cls, txt] of [[C.START, 'start', 'Start'], [C.END, 'end', 'End']]) {
    const pos = gr.node(id);
    if (!pos) continue;
    const grp = el('g', { class: 'pm-term ' + cls, transform: 'translate(' + (pos.x - TERM_W / 2) + ',' + (pos.y - TERM_H / 2) + ')' }, vp);
    el('rect', { width: TERM_W, height: TERM_H, rx: TERM_H / 2 }, grp);
    const t = el('text', { x: TERM_W / 2, y: TERM_H / 2 + 5 }, grp);
    t.textContent = txt;
    grp.addEventListener('mousemove', ev => tip('<b>' + txt + '</b><br>' + C.fmtNum(dfg.totalCases) + ' cases', ev.clientX, ev.clientY));
    grp.addEventListener('mouseleave', () => tip(null));
  }

  /* ---- pan & zoom (smooth, animated; transform persists across re-renders) ---- */
  const state = container._pz || (container._pz = { x: 0, y: 0, k: 1, init: false });
  const notify = () => { if (opts.onZoom) opts.onZoom(state.k); };
  const apply = () => { vp.setAttribute('transform', 'translate(' + state.x + ',' + state.y + ') scale(' + state.k + ')'); notify(); };
  const fitTarget = () => {
    const cw = container.clientWidth || 800, ch = container.clientHeight || 600;
    const inset = opts.topInset || 0; // keep the graph below the floating controls
    const k = Math.min(cw / gw, (ch - inset) / gh, 1.3) * 0.96;
    return { k, x: (cw - gw * k) / 2, y: Math.max(inset + ((ch - inset) - gh * k) / 2, inset + 6) };
  };
  const fitNow = () => { Object.assign(state, fitTarget()); apply(); };
  if (!state.init || opts.refit) { fitNow(); state.init = true; } else apply();

  const target = { x: state.x, y: state.y, k: state.k };
  let gliding = 0;
  const syncTarget = () => { target.x = state.x; target.y = state.y; target.k = state.k; };
  const stopGlide = () => { if (gliding) { try { cancelAnimationFrame(gliding); } catch (_) { /* no rAF */ } gliding = 0; } };
  const glideStep = () => {
    gliding = 0;
    const dx = target.x - state.x, dy = target.y - state.y, dk = target.k - state.k;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(dk) < 0.002 * Math.max(state.k, 0.04)) {
      state.x = target.x; state.y = target.y; state.k = target.k;
      apply();
      return;
    }
    state.x += dx * 0.22; state.y += dy * 0.22; state.k += dk * 0.22;
    apply();
    schedule();
  };
  const schedule = () => {
    if (gliding) return;
    try { gliding = requestAnimationFrame(glideStep); }
    catch (_) { state.x = target.x; state.y = target.y; state.k = target.k; apply(); }
  };
  const zoomTowards = (f, cx, cy) => {
    const nk = Math.min(4, Math.max(0.05, target.k * f));
    f = nk / target.k;
    target.x = cx - (cx - target.x) * f;
    target.y = cy - (cy - target.y) * f;
    target.k = nk;
    schedule();
  };
  const fit = () => { Object.assign(target, fitTarget()); schedule(); };

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const px = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
    const dy = Math.max(-90, Math.min(90, px));
    const f = Math.exp(-dy * (e.ctrlKey ? 0.0030 : 0.0016));
    zoomTowards(f, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  svg.addEventListener('dblclick', e => {
    if (e.target.closest && e.target.closest('.pm-node, .pm-edge, .pm-term')) return;
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomTowards(1.7, e.clientX - r.left, e.clientY - r.top);
  });

  /* two-finger touch pinch */
  const ptrs = new Map();
  let pinch = null;
  const pinchInfo = () => {
    const [a, b] = [...ptrs.values()];
    const r = svg.getBoundingClientRect();
    return { d: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
  };
  svg.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      down = null; stopGlide();
      const p = pinchInfo();
      pinch = { d0: p.d, k0: state.k, x0: state.x, y0: state.y, mx0: p.mx, my0: p.my };
    }
  });
  svg.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || ptrs.size !== 2) return;
    dragged = true;
    const p = pinchInfo();
    const nk = Math.min(4, Math.max(0.05, pinch.k0 * (p.d / pinch.d0)));
    const f = nk / pinch.k0;
    state.k = nk;
    state.x = p.mx - (pinch.mx0 - pinch.x0) * f;
    state.y = p.my - (pinch.my0 - pinch.y0) * f;
    syncTarget(); apply();
  });
  const endPtr = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
  svg.addEventListener('pointerup', endPtr);
  svg.addEventListener('pointercancel', endPtr);

  let down = null;
  const onDown = e => { stopGlide(); syncTarget(); down = { x: e.clientX, y: e.clientY, sx: state.x, sy: state.y }; dragged = false; };
  const onMove = e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
    state.x = down.sx + dx; state.y = down.sy + dy;
    syncTarget(); apply();
  };
  const onUp = () => { down = null; setTimeout(() => { dragged = false; }, 0); };
  svg.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  container._pmCleanup = () => {
    stopGlide();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    tip(null);
  };

  return {
    fit,
    zoomBy: f => { const r = svg.getBoundingClientRect(); zoomTowards(f, (r.width || 800) / 2, (r.height || 600) / 2); },
    zoom: () => state.k
  };
}

g.PMDiagram = { render };
})(typeof window !== 'undefined' ? window : globalThis);
