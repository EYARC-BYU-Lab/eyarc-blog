/* B W Fishing dashboards — process-mining engine (trimmed from Process Mining Lab core.js).
   Pure functions, no DOM: builds the event-log model, variants and the directly-follows graph. */
(function (g) {
'use strict';

const START = '__START__';
const END = '__END__';
const SEP = String.fromCharCode(0); // edge-key separator (never a literal NUL byte in source)

/* ---------- model ---------- */
/* data = window.BWF_DATA (see data.js). Returns
   { events[], cases: Map<id, case>, activities[], variants[], roles, hasTime } */
function buildModel(data) {
  const base = new Date(data.baseTime);
  const ren = data.renames || {};
  const actName = i => { const n = data.activities[i]; return ren[n] != null ? ren[n] : n; };
  const caseInfo = new Map();
  for (const [id, amount, custNo] of data.cases) {
    caseInfo.set(String(id), { amount, custNo, company: custNo != null ? (data.customers[custNo] || '') : '' });
  }
  const events = [];
  data.events.forEach((row, i) => {
    const [cid, ai, secs, emp] = row;
    const e = data.employees[emp] || [String(emp), null];
    events.push({
      case: String(cid), act: actName(ai), ts: new Date(base.getTime() + secs * 1000),
      emp, empName: e[0], roleId: e[1], role: e[1] != null ? (data.roles[e[1]] || String(e[1])) : '', ord: i
    });
  });

  const cases = new Map();
  for (const e of events) {
    let c = cases.get(e.case);
    if (!c) {
      const info = caseInfo.get(e.case) || { amount: null, custNo: null, company: '' };
      c = { id: e.case, events: [], amount: info.amount, custNo: info.custNo, company: info.company };
      cases.set(e.case, c);
    }
    c.events.push(e);
  }
  for (const c of cases.values()) {
    c.events.sort((x, y) => (x.ts - y.ts) || (x.ord - y.ord));
    c.trace = c.events.map(e => e.act);
    c.variantKey = c.trace.join('→');
    c.actSet = new Set(c.trace);
    c.start = c.events[0].ts;
    c.end = c.events[c.events.length - 1].ts;
    c.durMs = c.end - c.start;
  }

  const actMap = new Map();
  for (const c of cases.values()) {
    const seen = new Set();
    for (const a of c.trace) {
      let o = actMap.get(a);
      if (!o) { o = { name: a, count: 0, caseCount: 0 }; actMap.set(a, o); }
      o.count++;
      if (!seen.has(a)) { o.caseCount++; seen.add(a); }
    }
  }
  const activities = [...actMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const varMap = new Map();
  for (const c of cases.values()) {
    let v = varMap.get(c.variantKey);
    if (!v) { v = { key: c.variantKey, acts: c.trace.slice(), count: 0, durs: [], caseIds: [] }; varMap.set(c.variantKey, v); }
    v.count++;
    v.durs.push(c.durMs);
    v.caseIds.push(c.id);
  }
  /* sort by count desc; ties by shorter path then key, so the numbering is stable */
  const variants = [...varMap.values()].sort((a, b) => b.count - a.count || a.acts.length - b.acts.length || a.key.localeCompare(b.key));
  variants.forEach((v, i) => { v.rank = i + 1; v.avgDur = mean(v.durs); v.share = v.count / cases.size; });
  for (const v of variants) for (const id of v.caseIds) cases.get(id).variant = v.rank;

  const variantByKey = new Map(variants.map(v => [v.key, v]));
  return { events, cases, activities, variants, variantByKey, hasTime: true };
}

/* ---------- directly-follows graph ---------- */
function buildDFG(model, caseIds) {
  const nodes = new Map(), edges = new Map();
  const getN = n => { let o = nodes.get(n); if (!o) { o = { name: n, count: 0, caseCount: 0 }; nodes.set(n, o); } return o; };
  const getE = (f, t) => {
    const k = f + SEP + t;
    let o = edges.get(k);
    if (!o) { o = { key: k, from: f, to: t, freq: 0, caseCount: 0, durs: [] }; edges.set(k, o); }
    return o;
  };
  let totalCases = 0;
  for (const cid of caseIds) {
    const c = model.cases.get(cid);
    if (!c) continue;
    const evs = c.events;
    totalCases++;
    const seenN = new Set(), seenE = new Set();
    for (const e of evs) {
      const n = getN(e.act);
      n.count++;
      if (!seenN.has(e.act)) { n.caseCount++; seenN.add(e.act); }
    }
    const mark = e => { if (!seenE.has(e.key)) { e.caseCount++; seenE.add(e.key); } };
    const se = getE(START, evs[0].act); se.freq++; mark(se);
    for (let i = 0; i < evs.length - 1; i++) {
      const e = getE(evs[i].act, evs[i + 1].act);
      e.freq++;
      e.durs.push(evs[i + 1].ts - evs[i].ts);
      mark(e);
    }
    const ee = getE(evs[evs.length - 1].act, END); ee.freq++; mark(ee);
  }
  let maxNode = 0, maxEdgeCase = 0;
  for (const n of nodes.values()) maxNode = Math.max(maxNode, n.count);
  for (const e of edges.values()) maxEdgeCase = Math.max(maxEdgeCase, e.caseCount);
  return { nodes, edges, maxNode: maxNode || 1, maxEdgeCase: maxEdgeCase || 1, totalCases };
}

/* ---------- filters ---------- */
/* A filter is {type, not?, ...}:
   variants {keys:Set}   activity {act}   edge {from,to} (from may be START, to may be END)
   role {role}   employee {emp}   company {company}   case {id}   sod {act, role}
   `not: true` inverts the match (exclusion chip). Filters AND together. */
function traceHasEdge(trace, from, to) {
  if (from === START) return trace.length > 0 && trace[0] === to;
  if (to === END) return trace.length > 0 && trace[trace.length - 1] === from;
  for (let i = 0; i < trace.length - 1; i++) if (trace[i] === from && trace[i + 1] === to) return true;
  return false;
}
function matchFilter(c, f) {
  let m;
  switch (f.type) {
    case 'variants': m = f.keys.has(c.variantKey); break;
    case 'activity': m = c.actSet.has(f.act); break;
    case 'edge': m = traceHasEdge(c.trace, f.from, f.to); break;
    case 'role': m = c.events.some(e => e.role === f.role); break;
    case 'employee': m = c.events.some(e => e.emp === f.emp); break;
    case 'company': m = c.company === f.company; break;
    case 'case': m = c.id === String(f.id); break;
    case 'sod': m = c.events.some(e => e.act === f.act && e.role === f.role); break;
    default: m = true;
  }
  return f.not ? !m : m;
}
/* case ids matching every filter (optionally ignoring one filter type) */
function applyFilters(model, filters, skipType) {
  const out = new Set();
  const fs = (filters || []).filter(f => f.type !== skipType);
  for (const c of model.cases.values()) {
    let ok = true;
    for (const f of fs) if (!matchFilter(c, f)) { ok = false; break; }
    if (ok) out.add(c.id);
  }
  return out;
}
/* same-key test used by the chip toggles */
function sameFilter(a, b) {
  if (a.type !== b.type || !!a.not !== !!b.not) return false;
  switch (a.type) {
    case 'variants': return false;
    case 'activity': return a.act === b.act;
    case 'edge': return a.from === b.from && a.to === b.to;
    case 'role': return a.role === b.role;
    case 'employee': return a.emp === b.emp;
    case 'company': return a.company === b.company;
    case 'case': return String(a.id) === String(b.id);
    case 'sod': return a.act === b.act && a.role === b.role;
  }
  return false;
}

/* variants present in a case subset — global rank numbers, subset counts */
function variantStats(model, caseIds) {
  const m = new Map();
  for (const cid of caseIds) {
    const c = model.cases.get(cid);
    let v = m.get(c.variantKey);
    if (!v) {
      const g = model.variantByKey.get(c.variantKey);
      v = { key: c.variantKey, rank: g.rank, acts: g.acts, count: 0, durs: [], caseIds: [] };
      m.set(c.variantKey, v);
    }
    v.count++; v.durs.push(c.durMs); v.caseIds.push(c.id);
  }
  const out = [...m.values()].sort((a, b) => b.count - a.count || a.rank - b.rank);
  for (const v of out) { v.avgDur = mean(v.durs); v.medDur = median(v.durs); v.share = caseIds.size ? v.count / caseIds.size : 0; }
  return out;
}

/* ---------- statistics ---------- */
function mean(arr) {
  if (!arr || !arr.length) return null;
  let s = 0; for (const v of arr) s += v;
  return s / arr.length;
}
function median(arr) {
  if (!arr || !arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* KPI bundle for a set of case ids */
function summary(model, caseIds) {
  let events = 0, value = 0, denied = 0;
  const customers = new Set(), variants = new Set();
  for (const cid of caseIds) {
    const c = model.cases.get(cid);
    events += c.events.length;
    value += c.amount || 0;
    if (c.custNo != null) customers.add(c.custNo);
    variants.add(c.variantKey);
    if (c.trace.includes('Credit Denied')) denied++;
  }
  const n = caseIds.size;
  return {
    cases: n, events, value: Math.round(value * 100) / 100,
    customers: customers.size, variants: variants.size,
    avgEvents: n ? events / n : 0,
    deniedPct: n ? denied / n : 0
  };
}

/* activity counts over a case set, sorted desc */
function activityCounts(model, caseIds) {
  const m = new Map();
  for (const cid of caseIds) for (const a of model.cases.get(cid).trace) m.set(a, (m.get(a) || 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* activity × role cross-tab (Segregation of Duties) */
function activityByRole(model, caseIds, allRoles, allActs) {
  const roles = new Set(allRoles || []), acts = new Set(allActs || []), cells = new Map();
  for (const cid of caseIds) for (const e of model.cases.get(cid).events) {
    roles.add(e.role); acts.add(e.act);
    const k = e.act + SEP + e.role;
    cells.set(k, (cells.get(k) || 0) + 1);
  }
  const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // plain ordering: "IT Department" < "Inventory Clerks"
  const roleList = [...roles].sort(byCode);
  const actList = [...acts].sort(byCode);
  const rows = actList.map(a => ({ act: a, counts: roleList.map(r => cells.get(a + SEP + r) || 0) }));
  return { roles: roleList, rows };
}

/* ---------- formatting ---------- */
function fmtNum(n) { return Number(n).toLocaleString('en-US'); }
function fmtMoney(n) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPct(f, d) { return (100 * f).toFixed(d == null ? 2 : d) + '%'; }

/* duration display unit: 'auto' (coarse "4 d" / "12 h" / "53 min") or a fixed unit s | m | h | d */
let DUR_UNIT = 'auto';
const DUR_UNITS = { auto: 'Auto', s: 'Seconds', m: 'Minutes', h: 'Hours', d: 'Days' };
function setDurUnit(u) { DUR_UNIT = DUR_UNITS[u] ? u : 'auto'; }
function getDurUnit() { return DUR_UNIT; }
function fmtDur(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 0) ms = 0;
  if (DUR_UNIT !== 'auto') {
    const v = DUR_UNIT === 's' ? ms / 1000 : DUR_UNIT === 'm' ? ms / 60000 : DUR_UNIT === 'h' ? ms / 3600000 : ms / 86400000;
    const r = v >= 100 ? Math.round(v) : v >= 10 ? +v.toFixed(1) : +v.toFixed(2);
    return fmtNum(r) + ' ' + { s: 's', m: 'min', h: 'h', d: 'd' }[DUR_UNIT];
  }
  const s = ms / 1000, m = s / 60, h = m / 60, d = h / 24;
  if (d >= 1) return Math.round(d) + ' d';
  if (h >= 1) return Math.round(h) + ' h';
  if (m >= 1) return Math.round(m) + ' min';
  return Math.round(s) + ' s';
}
/* precise duration for tooltips: "3 d 16 h 38 min" */
function fmtDurLong(ms) {
  if (ms == null || isNaN(ms)) return '—';
  let s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [];
  if (d) parts.push(d + ' d');
  if (h) parts.push(h + ' h');
  if (m) parts.push(m + ' min');
  if (!parts.length) parts.push(s + ' s');
  return parts.join(' ');
}
const pad = n => String(n).padStart(2, '0');
function fmtDate(t) { return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); }
function fmtDateTime(t) { return fmtDate(t) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()); }
function fmtDateTimeSec(t) { return fmtDateTime(t) + ':' + pad(t.getSeconds()); }

g.PMCore = {
  START, END, SEP,
  buildModel, buildDFG, summary, activityCounts, activityByRole,
  traceHasEdge, matchFilter, applyFilters, sameFilter, variantStats,
  mean, median,
  setDurUnit, getDurUnit, DUR_UNITS,
  fmtNum, fmtMoney, fmtPct, fmtDur, fmtDurLong, fmtDate, fmtDateTime, fmtDateTimeSec
};
})(typeof window !== 'undefined' ? window : globalThis);
