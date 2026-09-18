/* BW Fishing — small, edit-in-source config for the things most likely to change again.
   No build step: a plain script, loaded before app.js, exposed as window.BWF_CONFIG. */
window.BWF_CONFIG = {

  /* ---------- Tab labels ----------
     One entry per tab. Edit `label` to rename a tab everywhere it appears (nav bar,
     page heading, and its description card on the Introduction tab) — one line, no
     hunting through index.html. */
  TABS: [
    { id: 'intro',        label: 'Introduction' },
    { id: 'overview',     label: 'Dashboard' },
    { id: 'variants',     label: 'Process Variants' },
    { id: 'transactions', label: 'Transaction Details' },
    { id: 'sod',          label: 'Segregation of Duties' }
  ],

  /* ---------- Process Variants preset buttons ----------
     Each entry renders as a button in the panel above the variant list (in this
     order). `pick(variants)` receives the in-scope variant list (see `variantStats`
     in core.js — each variant has .key/.count/.acts/...) and returns the Set of
     variant keys that button should select. Add an entry here to add a button;
     no index.html edit needed. */
  PRESETS: [
    { id: 'all',   label: 'All',    pick: vs => new Set(vs.map(v => v.key)) },
    { id: 'top5',  label: 'Top 5',  pick: vs => new Set(vs.slice(0, 5).map(v => v.key)) },
    { id: 'top10', label: 'Top 10', pick: vs => new Set(vs.slice(0, 10).map(v => v.key)) }
  ]
};
