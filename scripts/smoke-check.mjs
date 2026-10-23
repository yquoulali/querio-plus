// F1 BUILD SMOKE CHECK (top acceptance criterion).
// After `vite build`, assert the MV3 wiring is coherent in dist/:
//   1. dist/manifest.json exists and is MV3 with name "Querio+".
//   2. manifest.devtools_page points to an emitted file that exists in dist/.
//   3. the devtools bundle references a panel page, and that panel HTML exists in dist/.
//   4. action.default_popup resolves to an emitted file.
// Exits non-zero (failing `pnpm build`) if any assertion fails.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

function fail(msg) {
  console.error(`✗ smoke-check: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

if (!existsSync(dist)) fail('dist/ does not exist — did vite build run?');

const manifestPath = join(dist, 'manifest.json');
if (!existsSync(manifestPath)) fail('dist/manifest.json missing');

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  fail(`dist/manifest.json is not valid JSON: ${e.message}`);
}

if (manifest.manifest_version !== 3) fail(`manifest_version is ${manifest.manifest_version}, expected 3`);
if (manifest.name !== 'Querio+') fail(`name is "${manifest.name}", expected "Querio+"`);
ok(`manifest.json is MV3 and named "${manifest.name}"`);

// 2. devtools_page resolves to an emitted file.
const devtoolsPage = manifest.devtools_page;
if (!devtoolsPage) fail('manifest.devtools_page is missing');
const devtoolsPagePath = join(dist, devtoolsPage);
if (!existsSync(devtoolsPagePath)) fail(`devtools_page "${devtoolsPage}" does not exist in dist/`);
ok(`devtools_page resolves to emitted file: ${devtoolsPage}`);

// 4. action.default_popup resolves to an emitted file.
const popup = manifest.action && manifest.action.default_popup;
if (!popup) fail('manifest.action.default_popup is missing');
if (!existsSync(join(dist, popup))) fail(`action.default_popup "${popup}" does not exist in dist/`);
ok(`action.default_popup resolves to emitted file: ${popup}`);

// 3. Find the panel page the devtools code references and assert it exists in dist/.
// The devtools HTML loads a JS module; that module calls panels.create(..., <panelPage>).
// We read the emitted devtools HTML, find its script, then scan that script for the
// panel page literal, and finally confirm the referenced HTML exists in dist/.
const devtoolsHtml = readFileSync(devtoolsPagePath, 'utf8');
const scriptMatch = devtoolsHtml.match(/src=["']([^"']+\.js)["']/);
if (!scriptMatch) fail('could not find a <script src> in the emitted devtools HTML');

// Resolve the script path relative to the devtools HTML location in dist/.
const devtoolsDir = dirname(devtoolsPagePath);
let scriptRel = scriptMatch[1].replace(/^\.?\//, '');
let scriptPath = join(devtoolsDir, scriptRel);
if (!existsSync(scriptPath)) {
  // crxjs may emit the script at the dist root; try that.
  scriptPath = join(dist, scriptRel);
}
if (!existsSync(scriptPath)) fail(`devtools script "${scriptMatch[1]}" not found in dist/`);
ok(`devtools script emitted: ${scriptRel}`);

const scriptSrc = readFileSync(scriptPath, 'utf8');

// The panel page passed to panels.create is a quoted .html literal. Collect candidates.
const htmlLiterals = [...scriptSrc.matchAll(/["'`]([^"'`]*\.html)["'`]/g)].map((m) => m[1]);
if (htmlLiterals.length === 0) {
  fail('no .html literal found in the devtools script (panels.create panel page)');
}

// At least one referenced panel HTML must exist in dist/.
let panelFound = null;
for (const lit of htmlLiterals) {
  const rel = lit.replace(/^\.?\//, '');
  if (existsSync(join(dist, rel))) {
    panelFound = rel;
    break;
  }
}
if (!panelFound) {
  fail(
    `none of the panel HTML literals referenced by the devtools code exist in dist/: ${htmlLiterals.join(', ')}`,
  );
}
ok(`panel HTML referenced by devtools code exists in dist/: ${panelFound}`);

// Sanity: list the top-level html files emitted (helps the reviewer).
const htmls = readdirSync(dist).filter((f) => f.endsWith('.html'));
ok(`dist/ emitted HTML files: ${htmls.join(', ') || '(none at root)'}`);

console.log('✓ smoke-check passed: MV3 wiring is coherent and the panel asset is present.');
