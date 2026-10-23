/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

// F1 (panel HTML build wiring): `index.html` is the panel page and is referenced
// by the manifest (`action.default_popup`), so crxjs pulls it into the build
// graph and emits it. It is reused as the DevTools panel — the same proven
// pattern the reference uses (one manifest-referenced index.html as both popup
// and devtools panel). The DevTools page (src/devtools/devtools.html) is also
// manifest-referenced. No extra rollup input hack is needed; the panel asset is
// guaranteed to exist because it is a manifest entry. scripts/smoke-check.mjs
// asserts, after the build, that the emitted panel path the devtools code
// references actually exists in dist/.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
