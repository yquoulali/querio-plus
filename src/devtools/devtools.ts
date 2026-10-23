// The only code that runs in the devtools_page context. Its sole job is to register
// the DevTools panel (P1). F1 (panel HTML build wiring): the panel page is the
// MANIFEST-REFERENCED index.html (action.default_popup), reused as the devtools panel —
// the same proven pattern the reference uses (one manifest-referenced index.html as both
// popup and devtools panel). crxjs rewrites manifest-referenced HTML into the build graph
// and keeps the root index.html at a stable path, so the literal below resolves at runtime.
// scripts/smoke-check.mjs asserts, after the build, that this path exists in dist/.
const PANEL_PAGE = 'index.html';

try {
  chrome.devtools.panels.create('Querio+', '/icons/16.png', PANEL_PAGE);
} catch (e) {
  // The API is only present in a real DevTools context; guard for safety.
  console.error('Querio+ panel registration failed', e);
}

export {};
