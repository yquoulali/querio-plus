import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// MV3 manifest. Mirrors the Querio RE findings (RE §1): no background service
// worker, no content scripts, no host permissions. A single DevTools page
// registers the panel at runtime.
//
// F1 (panel HTML build wiring): the panel page is a MANIFEST-REFERENCED HTML
// entry (`action.default_popup`), exactly like the reference reuses one
// manifest-referenced index.html as both popup and devtools panel. crxjs owns
// and rewrites manifest-referenced HTML into the build graph, so the panel
// asset is guaranteed to be emitted. devtools.ts passes the emitted built path
// to chrome.devtools.panels.create (resolved empirically after the first build
// and asserted by scripts/smoke-check.mjs).
//
// F5 (nit): no minimum_chrome_version — the reference declares none and nothing
// in the feature set is tied to a specific Chrome API minimum.
export default defineManifest({
  manifest_version: 3,
  name: 'Querio+',
  version: pkg.version,
  description: 'GraphQL & HTTP request inspector (DevTools panel).',
  // F3 (design-review F4 earlier): copy-only needs clipboardWrite; storage backs
  // persisted settings (theme, columns, preserve-log).
  permissions: ['storage', 'clipboardWrite'],
  devtools_page: 'src/devtools/devtools.html',
  action: {
    default_popup: 'index.html',
  },
  icons: {
    '16': 'icons/16.png',
    '48': 'icons/48.png',
    '128': 'icons/128.png',
  },
});
