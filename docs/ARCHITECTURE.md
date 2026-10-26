# Querio+ — Architecture

Technical documentation for the Querio+ Chrome DevTools extension: how capture works, the module
layout, the data model, and the design decisions worth knowing before changing the code.

For a feature overview, build steps, and the comparison to the original Querio, see the
[README](../README.md).

---

## 1. What it is, in one paragraph

Querio+ is a **Manifest V3 Chrome DevTools panel**. A tiny `devtools_page` script registers a
panel named "Querio+". The panel is a React app that attaches one listener to
`chrome.devtools.network.onRequestFinished`, classifies each finished request as GraphQL / HTTP /
ignored, parses it into one or more normalized `CapturedEntry` records, and renders a filterable,
searchable request list with a tabbed detail view. There is **no background service worker, no
content script, and no host permission** — the panel only sees traffic through the DevTools
network API while DevTools is open on the inspected page.

---

## 2. MV3 wiring and the panel bootstrap

```
manifest.config.ts  ──(@crxjs/vite-plugin)──►  dist/manifest.json
   devtools_page: src/devtools/devtools.html
   action.default_popup: index.html

src/devtools/devtools.ts
   chrome.devtools.panels.create("Querio+", "/icons/16.png", "index.html")
        │
        ▼
index.html  (the panel page — ALSO the manifest-referenced popup)
   loads  src/panel/main.tsx
        │
        ├─ applyTheme('system')         ← flash-avoidance, runs before React paints
        ├─ registerCapture()            ← the ONE onRequestFinished listener
        └─ createRoot(...).render(<App/>)
```

**Why `index.html` is the panel page.** `@crxjs/vite-plugin` only reliably emits and
path-rewrites HTML that the manifest references. The original Querio reuses one
manifest-referenced `index.html` as both the popup and the devtools panel; Querio+ does the same.
The runtime call `panels.create(..., "index.html")` resolves against the extension root, where
crxjs keeps `index.html` at a stable, unhashed path. `scripts/smoke-check.mjs` asserts this after
every build: it reads `dist/manifest.json`, confirms `devtools_page` resolves to an emitted file,
and confirms the panel HTML referenced by the devtools code exists in `dist/`.

**CSP note.** MV3's default CSP (`script-src 'self'`) blocks inline `<script>`. The theme
flash-avoidance therefore runs as the first statement of `main.tsx` (an external module script,
which CSP allows), not as an inline script in `index.html`. `index.html` carries a static
`data-theme="light"` default that React corrects on mount.

---

## 3. The capture pipeline

```
chrome.devtools.network.onRequestFinished
        │  raw HAR entry (untyped)
        ▼
normalizeHarEntry(entry)              panel/main.tsx
        │  wraps Chrome's CALLBACK getContent((content,encoding)=>…) into a Promise
        ▼
markSeen(entry)  ───── false ───►  drop (Chrome double-delivery; see §6)
        │ true
        ▼
classifyEntry(entry)                 capture/parse-entry.ts
        │
   graphql ─► parseGqlEntries(entry) ─► CapturedEntry[]   (one per split operation)
   http    ─► parseHttpEntry(entry)  ─► CapturedEntry
   ignored ─► (skipped)
        │
        ▼
store.add(...entries)                capture/store.ts   (bounded ring buffer, emits to React)
        │
        ▼  for GraphQL rows, opportunistically:
resolveGraphqlError(entry) ─► store.patch(id, {errorState, errorCount, size})
```

### 3.1 The `getContent` adapter (a real-world correctness fix)

Chrome's `Request.getContent` is **callback-based and returns `void`**:
`getContent((content, encoding) => …)`, where `encoding` is `''` for text or `'base64'` for
binary. Treating it as a promise (`await entry.getContent()`) yields `undefined`, so every body
comes back empty and JSON parsing fails. `normalizeHarEntry` in `panel/main.tsx` is the single
boundary that wraps the callback into a `Promise<[content, encoding]>`; everything downstream has
one contract. `makeBodyCache` (in `parse-entry.ts`) then base64-decodes binary bodies before
`JSON.parse`, and JSON-parses only when the response content-type is `application/json`.

### 3.2 Lazy, cached bodies

`parse-entry.ts` returns a per-entry `getResponseBody()` that fetches via the adapter **once** and
memoizes the result. HTTP rows stay fully lazy — a body is fetched only when the row is opened or
matched by a search that reaches it. GraphQL rows are fetched **opportunistically** right after
capture so the `errors[]` half of the error state can resolve (see §5).

---

## 4. The two pure cores (the testable heart)

Two modules contain all the GraphQL reasoning and are **pure** — no Chrome APIs, no network, never
throw. They are the most heavily tested code in the project.

### Core #1 — `capture/graphql-detect.ts` → `detectGraphQL(request)`

Decides whether a request carries a GraphQL operation and extracts its metadata. The heuristic
mirrors the reference exactly:

| content-type / method | query source |
|---|---|
| `application/json` + GET | `?query=` from decoded query params |
| `application/json` + POST | `parsedBody.query`; if the body is an **array**, `parsedBody[0].query` (→ `isBatch`) |
| `application/x-www-form-urlencoded` | `query` form param |

`isGraphQL` is true **iff** a non-empty query exists **and** `graphql.parse(query, {noLocation})`
does not throw. The single parse here also produces the operation's `type`
(query/mutation/subscription) and `rootFields` (root selection names, including aliases and inline
fragments). Operation-name precedence: transport `operationName` → AST definition name → first root
field → `undefined` (the first two are strict Querio parity; the root-field fallback is a declared
Querio+ improvement so anonymous operations still get a usable label).

### Core #2 — `capture/batch-split.ts` → `splitBatch(payload)`

Splits one GraphQL request payload into one `SplitOperation` per operation, each with a
`responseFor(fullResponse)` closure that returns that operation's response slice. It **never calls
`graphql.parse`** (the single-parse invariant — all parsing happened once in `detectGraphQL`).

Correlation strategy (a declared improvement over Querio's positional-only approach, which breaks
if the server reorders batched responses):

- **Non-batch** (single object) → one op, `responseFor(full) => full`.
- **Batch, all operations distinctly named** → `identity` mode:
  - probe (a): match response by `operationName`;
  - probe (b): match a single-key `response.data` whose key is one of the request op's root fields
    (only element 0 carries `rootFields`, per the single-parse invariant — later elements skip (b));
  - fallback: positional `full[index]`.
- **Batch, otherwise** → `position` mode: `full[index]`.

Variables are normalized: a JSON-string `variables` is parsed; on failure the raw string is kept
(a declared divergence from the reference, which drops the whole item) so the row still appears
with a "could not parse variables" note.

### The seam — `capture/parse-entry.ts`

Glues the two cores to the real HAR entry. It owns the **single JSON parse** of the POST body
(passed to `detectGraphQL` as `parsedBody` so it isn't parsed twice) and the **single decode path**
(`decodeURIComponent` on query/form params, exactly once). It builds `BatchInputOperation[]`,
calls `splitBatch`, and maps each `SplitOperation` to a `CapturedEntry`.

---

## 5. Data model and error state

`CapturedEntry` (in `types.ts`) is the single shape that flows from `parse-entry.ts` into the store
and drives the entire UI. GraphQL-only fields are `undefined` when `kind === 'http'`.

**Tri-state error flag** (`errorState: 'ok' | 'error' | 'pending'`):

- HTTP rows resolve synchronously: `status >= 400 || status === 0` → `error`, else `ok`.
- GraphQL rows start `pending`, then `resolveGraphqlError` fetches the body and sets `error` when
  the HTTP status is an error **or** the response has a non-empty `errors[]` array (with
  `errorCount`). The store re-emits on this patch, so the list/detail update reactively — the same
  mechanism used to backfill `size` from the body length when the HAR `content.size` was absent.

Error rows render red with an error-count badge (`!` for an HTTP-only error, the count for GraphQL
errors).

---

## 6. De-duplication (Chrome's double delivery)

Observed on real traffic: `chrome.devtools.network.onRequestFinished` fires **twice** for each
finished request — two near-identical HAR entries, one carrying `_connectionId` and the other not,
with `startedDateTime` ~1 ms apart and `time` differing by < 1 ms. There is no `_requestId` to key
on.

`capture/dedup.ts` collapses these **without hiding a genuine duplicate the page really sent
twice**. It keys on request identity (`method | url | bodyLength | status`) and treats two entries
as the same delivery only when their `startedDateTime` fall within a small window
(`DUP_WINDOW_MS = 150`). A request the page genuinely repeats arrives with a `startedDateTime`
separated by real time (far more than the window) and is kept as a separate row. If the timestamp
is unparseable, it does not dedup (fail open — showing a real request beats hiding one). The guard
resets on **Clear** and on **navigation**.

Accepted tradeoff: a byte-identical request fired twice within 150 ms would merge. That is rare and
strictly better than every request showing doubled; the window is a one-line constant.

---

## 7. State, store, and robustness bounds

`capture/store.ts` is a module-level store exposed to React via `useSyncExternalStore`. A snapshot
is an immutable array reference that changes on add / patch / clear, so backfills (size,
errorState) trigger re-renders.

Robustness limits that prevent a long or adversarial session from freezing the panel:

- **Store cap** — `MAX_ENTRIES = 5000`, a ring buffer dropping the oldest (import capped too).
- **JSON tree bounds** — `format/json-format.ts` `buildTree` caps at `MAX_CHILDREN = 1000` per
  branch and `MAX_DEPTH = 100`, with a visible "… N more / (depth limit)" marker. The depth guard
  also prevents a deep-recursion stack overflow on pathological payloads.
- **Capture listener is fail-safe** — a single malformed entry is caught and skipped, never killing
  the listener or dropping subsequent requests.
- **Import coercion** — `features/session.ts` coerces every critical field of an imported entry to
  a safe type and drops entries without a valid URL, so a hand-edited session file can't break
  filtering or rendering.

---

## 8. UI layer

- `panel/App.tsx` — top-level state (filter, search, theme, preserve-log, columns, column widths,
  split ratio, selection), the capture subscription, and the resizable list/detail split.
- `components/Toolbar.tsx` — filter inputs (name, type, status, URL), errors-only, body search,
  theme select, preserve-log, Columns dropdown, Export/Import, Clear.
- `components/RequestList.tsx` — the virtualizable table: a **Kind** badge column (color-coded
  GraphQL type or HTTP method), resizable columns (drag the border; double-click resets; widths
  persist), status dot, zebra striping, hover and selected-row accent.
- `components/RequestDetail.tsx` — tabs: General, Request headers, Query / Variables (GraphQL),
  Response. Copy-as-cURL / copy-operation / copy-response. Compare button to diff with another
  request. Lazily fetches the body when the Response tab opens.
- `components/JsonTree.tsx` — collapsible JSON tree over `buildTree`; renders a non-object value
  (e.g. a kept-raw invalid-variables string) as a single leaf.
- `components/GraphQLView.tsx` — pretty-printed query via `format/graphql-print.ts` (`graphql.print`).
- `components/DiffView.tsx` — structural diff tree showing added (+), removed (−), and changed (~)
  values with color-coded badges. Supports "Show unchanged" toggle.
- `components/DiffModal.tsx` — tabbed modal for comparing two requests: Response (JSON diff),
  Query (side-by-side text for GraphQL), Variables (JSON diff), Headers (JSON diff). Loads bodies
  lazily; closes on Escape or backdrop click.

**Settings** (`settings.ts`) persist to `chrome.storage.local`: theme, visible columns, per-column
widths, and the split ratio. The **Type** column is hidden by default (the Kind badge already
conveys operation type); it stays toggleable. `loadColumns` migrates older saved layouts by
surfacing newly-added default columns while preserving the user's order and selection.

---

## 9. Module map

```
manifest.config.ts            typed MV3 manifest (consumed by @crxjs/vite-plugin)
vite.config.ts                @crxjs + @vitejs/plugin-react + vitest config
index.html                    panel page (manifest-referenced; reused as popup + devtools panel)
scripts/smoke-check.mjs       post-build MV3 wiring assertion
src/
  devtools/devtools.{html,ts} registers the "Querio+" panel
  panel/
    main.tsx                  theme bootstrap + the single onRequestFinished listener + React mount
    App.tsx                   top-level state, capture subscription, resizable split
  capture/
    graphql-detect.ts         PURE CORE #1 — detectGraphQL
    batch-split.ts            PURE CORE #2 — splitBatch
    parse-entry.ts            the seam: single-parse, single-decode, HAR → CapturedEntry[]
    dedup.ts                  time-windowed double-delivery collapse
    content-type.ts           isContentType / getParamValue
    status-map.ts             numeric status → label
    store.ts                  bounded external store for useSyncExternalStore
  format/
    graphql-print.ts          graphql.print pretty-printer
    json-format.ts            buildTree (bounded) + formatJson
  features/
    filter.ts                 pure filter predicate (name/type/status/url/errors-only)
    search.ts                 pure full-text search (request + cached response bodies)
    copy.ts                   toCurl / copyOperation / copyResponse builders
    session.ts                export/import HAR-like session (with import coercion)
    diff.ts                   structural diff algorithm for comparing two JSON responses
  components/                 Toolbar, RequestList, RequestDetail, JsonTree, GraphQLView,
                              DiffView, DiffModal
  settings.ts                 chrome.storage-backed theme/columns/widths/split/preserve-log
  types.ts                    CapturedEntry, HarEntry, header/response shapes
test/                         vitest specs (see §10)
```

---

## 10. Testing

`pnpm test` runs vitest against the pure logic — the parts worth protecting from regression:

| Spec | Covers |
|---|---|
| `graphql-detect.spec.ts` | detection across GET/POST/form/batch/anonymous/encoded cases |
| `batch-split.spec.ts` | positional + identity correlation, 1..n rootFields, variables-parse-failure keep-raw |
| `parse-entry.spec.ts` | single-parse / single-decode seam, status map |
| `dedup.spec.ts` | double-delivery collapse vs. genuine repeat (time window), fail-open |
| `store.spec.ts` | add/patch/clear + ring-buffer cap |
| `json-format.spec.ts` | tree bounds (width + depth), circular-safe formatting |
| `filter.spec.ts` | filter predicate semantics |
| `session.spec.ts` | export/import round-trip + malformed-import coercion |
| `copy.spec.ts` | cURL / operation / response builders |
| `diff.spec.ts` | structural diff: added/removed/changed detection, nested paths, GraphQL-like structures |

The DOM/React components and the live DevTools behavior (loading into a panel, capturing real
traffic) are **not** unit-tested — that is a manual verification step.

---

## 11. Key design decisions (summary)

1. **No service worker / content script / host permission** — the DevTools network API is the only
   capture surface, matching the reference and keeping the permission surface minimal.
2. **Two pure cores + a thin seam** — all GraphQL reasoning is pure and testable; the seam owns the
   single parse and single decode; Chrome-specific glue lives only in `main.tsx` and `parse-entry`.
3. **Identity-first batch correlation** — fixes the reference's reorder bug while preserving
   positional parity for anonymous batches.
4. **Reimplementation, not a fork** — behavior was reconstructed from a reverse-engineering study
   and rebuilt on React + TypeScript; no Querio source is copied verbatim.
