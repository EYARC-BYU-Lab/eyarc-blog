# BW Fishing — Credit Approval and Internal Controls dashboards

A self-contained, static process-mining dashboard for the BW Fishing (BWF) order-to-cash case.
Open `index.html` in any modern browser — no server, build step, upload or internet connection is
required (the Open Sans web font loads from Google Fonts when online and falls back to Segoe UI /
Arial offline).

## Pages

| Tab | What it shows |
|---|---|
| Introduction | Logo, a short description of the dataset, a plain-text description card for each tab, and the filtering how-to |
| Dashboard | KPI cards (sales, value, customers, variants, average activities per order, % credit denied) and the activity-frequency bar chart (click a bar to filter) |
| Process Variants | Variant list with step-type strips, cases, share and average throughput time; click a row to isolate a variant, tick boxes or Ctrl/⌘-click to combine, presets under All / Top 5 / Top 10; the *Avg time* header opens a menu for sort direction and the time unit (auto / s / min / h / d, also used by the map); the ‹ button collapses the list so the map gets the full width. The process map colours activities by step type (same colours as the strips), has a Cases / Avg. time toggle top-left and Legend + zoom top-right; click an activity or connection to open a small menu with **Include** (keep only matching orders), **Exclude** (drop them) and, once one is applied, **Clear this filter**; shift-click excludes straight away |
| Transaction Details | The 4,682-row event log with employee number, name and role name; search and click-to-sort; clicking an order, activity, employee, role or customer adds a global filter **and** narrows the table to just the matching rows; the "SO Value of Selected Items" total follows the rows shown |
| Segregation of Duties | Activities × employee-role cross-tab; click a cell, activity or role to filter |

## Filters

Every filter is global: it becomes a pill in the bar under the tabs and applies to every tab (KPIs, chart,
variant list, map, transaction table and its total, cross-tab). Click a pill to flip it between *include*
and *exclude* (a "not" filter), remove it with its ✕, or use *Clear all*. On the bar chart, table and
cross-tab, clicking the same thing again removes its filter and shift-click adds an exclusion filter
directly; on the process map a click opens the Include / Exclude menu instead. Filter types: variants,
activity, path (A → B, starts with, ends with), role, employee, customer, order, and SoD cell (activity
performed by role). The engine is `applyFilters` in `js/core.js`.

## Files

```
index.html          markup for all five tabs
css/styles.css      styling (EYARC 2026 design guidelines: Open Sans, navy #002E5D, yellow #FFE600, …)
js/config.js        small edit-in-source config: tab labels, Process Variants presets
js/data.js          the event log, embedded (generated from the EYCreditChecksCase*.xlsx files, shifted to January 2027)
js/core.js          engine: event-log model, variants, directly-follows graph, filters, KPIs, formatting
js/diagram.js       the SVG process map (dagre layout, pan/zoom, tooltips)
js/app.js           page logic: tabs, KPI cards, bar chart, variant table, map filter menu, transaction table, SoD pivot
js/vendor/dagre.js  graph-layout library (MIT), vendored so the site works offline
assets/bwf-logo.png        BW Fishing logo (Introduction page and browser-tab icon)
assets/bwf-logo-white.png  white version of the logo for the navy top bar
```

## Changing things

* **Activity labels** — edit `renames` at the top of `js/data.js`, e.g.
  `renames: { 'Email Sales Invoices to Customer': 'Email Invoice' }`. Every page picks it up. It is empty
  today, so activities show under their source names (the process starts with *Create Digital Sales Order*).
* **Title** — `title` in `js/data.js` (also shown in the browser tab).
* **Tab labels** — `TABS` in `js/config.js`; the nav bar, page heading and matching Introduction card all read from it.
* **Introduction text** — plain HTML in the `#view-intro` section of `index.html`; the four description cards are
  plain (non-clickable) cards — use the top nav to move between tabs.
* **Data** — regenerate `js/data.js` from the Excel files. The format is documented in the file header:
  `cases` = `[transactionId, amount, customerNumber]`, `events` = `[transactionId, activityIndex, secondsFromBase, employeeNumber]`.
  Dates: the source files are dated January 2021; the dashboards use `baseTime: 2027-01-01`, which is also a Friday,
  so every timestamp is exactly six years later and keeps its day of the week. `EYCreditChecksCaseActivities 2027.xlsx`
  and `Transaction Details 2027.csv` in the parent folder are the matching 2027 versions of the source data.
* **Variant presets** — `PRESETS` in `js/config.js`; each entry is a button (All / Top 5 / Top 10 today).
* **Step-strip colours** — `CAT_INFO` / `CAT_RAW` at the top of `js/app.js` (comment there shows how to collapse to one colour).
* **Map filter menu** — `openMapMenu` in `js/app.js` builds the Include / Exclude menu; `.map-menu` in `css/styles.css` styles it.
* **Logo** — replace `assets/bwf-logo.png` (black on transparent) and `assets/bwf-logo-white.png` (white on transparent).
