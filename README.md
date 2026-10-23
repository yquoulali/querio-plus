# Querio+

A Manifest V3 Chrome **DevTools panel** that captures Fetch + XHR traffic in the inspected
page, detects and pretty-prints **GraphQL** operations (including batched arrays split into
individual operations correlated to their responses), and presents a filterable, searchable
request list with a tabbed detail view.

Querio+ is an **original reimplementation** (React 18 + TypeScript) informed by the behavior of
[Querio](https://github.com/enkot/querio) (`enkot/querio`, MIT). No Querio source is copied
verbatim — the behavior was reconstructed from a reverse-engineering study and reimplemented from
scratch on a different stack. See **Attribution** below.

## What it is

- **DevTools panel "Querio+"** — registered by a tiny `devtools_page` script. No background
  service worker, no content scripts, no host permissions.
- **Live capture** via `chrome.devtools.network.onRequestFinished` with lazy `getContent()` body
  retrieval (bodies are fetched on demand and cached per entry; GraphQL rows are fetched
  opportunistically so error state can resolve).
- **GraphQL detection** using Querio's verified heuristic: JSON+GET reads `?query=`, JSON+POST
  parses the body (array → first element's `query`), form-urlencoded reads the `query` param, and
  a final `graphql.parse` validation gate.
- **Batch splitting** — a JSON-array GraphQL payload becomes one row per operation with a
  `count/length in Batch` badge, correlated to its response slice.

## How it compares to Querio

| Capability | Querio | Querio+ |
|---|---|---|
| MV3 DevTools panel | ✅ "Querio" | ✅ "Querio+" |
| Intercept Fetch + XHR (`onRequestFinished`, lazy `getContent`) | ✅ | ✅ |
| GraphQL detection (json GET/POST/batch, form-urlencoded, `graphql.parse` gate) | ✅ | ✅ |
| Split batched arrays into individual ops | ✅ (positional correlation) | ✅ **identity-first, positional fallback** (fixes the reorder bug) |
| GraphQL query pretty-print | Prettier `graphql` parser | `graphql.print` (equivalent intent, not byte-identical) |
| JSON response pretty-print | ✅ | ✅ (collapsible tree) |
| HTML/XML response pretty-print | ✅ (Prettier plugins) | ❌ dropped (raw passthrough) |
| Request detail tabs (General / Headers / Query+Variables / Response) | ✅ | ✅ |
| Theme System/Light/Dark | ✅ (`localStorage`) | ✅ (`chrome.storage`) |
| **Filtering toolbar** (name, type, status, URL, errors-only) | ❌ | ✅ |
| **GraphQL error surfacing** (red rows + error-count badge) | partial (`isError`) | ✅ tri-state (`ok`/`error`/`pending`) |
| **Full-text body search** | ❌ | ✅ (cached bodies + fetch-on-demand) |
| **Collapsible JSON tree** | ✅ (editor) | ✅ (in-house tree) |
| **Copy as cURL / operation / response** | copy buttons | ✅ cURL + operation + response |
| **Export / import session** (HAR-like JSON) | ❌ | ✅ |
| **Clear / preserve-log** | ❌ | ✅ |
| **Configurable columns** | ❌ | ✅ (persisted) |

### Two declared divergences from Querio

1. **GraphQL pretty-printing uses `graphql.print`**, not Prettier's graphql parser. Output is
   canonical 2-space GraphQL — equivalent in intent, not byte-identical (no line-width reflow).
   This drops the heavy Prettier dependency chain.
2. **HTML/XML response pretty-printing is dropped** (raw passthrough). The focus is GraphQL/JSON;
   the native Network panel already renders HTML/XML.

### Declared improvement over parity

- **Anonymous operation labels**: Querio shows no name for anonymous operations. Querio+ falls
  back to the first root field name so anonymous ops still get a usable list label. (Transport
  `operationName` → AST definition name is strict parity; the root-field fallback is the addition.)
- **On a variables-parse failure Querio+ keeps the operation and the raw string** (rendered as a
  single leaf with a "could not parse variables" note), instead of silently dropping the batch
  item like the reference.

## Build & scripts

Requires **pnpm** and Node 24.

```bash
pnpm install     # installs exact-pinned deps, frozen by pnpm-lock.yaml
pnpm dev         # Vite watch build for load-unpacked development
pnpm build       # production build -> dist/  (runs tsc, vite build, and the MV3 smoke check)
pnpm typecheck   # tsc --noEmit (strict)
pnpm test        # vitest run (pure cores + seam + features)
```

> The first install needs network access to the npm registry. `esbuild`'s build script is allowed
> via `pnpm-workspace.yaml` (`allowBuilds: esbuild: true`, the pnpm 11 replacement for
> `onlyBuiltDependencies`); a clean install must finish with no `ERR_PNPM_IGNORED_BUILDS` warning.

## Load unpacked in Chrome

1. `pnpm build` to produce `dist/`.
2. Open `chrome://extensions`.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select the `dist/` folder.
5. Open **DevTools** on any page (F12), then select the **Querio+** tab.
6. Trigger Fetch/XHR traffic in the inspected page — GraphQL and HTTP requests appear in the list.

> Loading into a live DevTools panel and interacting with real traffic is a **manual** step that
> cannot be automated here. The build, type, test, and MV3 wiring checks are automated (see
> `.agents/tasks/querio-plus/verification.md`).

## Project layout

```
manifest.config.ts            typed MV3 manifest (consumed by @crxjs/vite-plugin)
vite.config.ts                @crxjs + @vitejs/plugin-react + vitest config
index.html                    the panel page (manifest-referenced; reused as popup + devtools panel)
scripts/smoke-check.mjs        post-build MV3 wiring assertion
src/
  devtools/devtools.{html,ts}  registers the "Querio+" panel
  panel/{main.tsx,App.tsx}     React app + the single onRequestFinished listener
  capture/                     graphql-detect (pure core #1), batch-split (pure core #2),
                               parse-entry (the seam), content-type, status-map, store
  format/                      graphql-print, json-format (buildTree)
  features/                    filter, search, copy, session
  components/                  Toolbar, RequestList, RequestDetail, JsonTree, GraphQLView
  settings.ts                  chrome.storage-backed theme/columns/preserve-log
test/                          vitest specs for the two cores, the seam, filter, and session
```

## Attribution

Querio+ is an improved reimplementation informed by **Querio — GraphQL and HTTP requests
inspector** by enkot ([enkot/querio](https://github.com/enkot/querio), MIT License). The original
Querio is Vue + VueUse + UnoCSS; Querio+ is an independent React + TypeScript codebase. Querio's
behavior was studied and reconstructed (see the reverse-engineering report in the task artifacts),
and reimplemented from that behavioral specification — not derived from Querio's source. Icon
assets are reused from the original (binary assets, not source code). Thanks to the Querio author
for the original idea and the MIT-licensed reference.
