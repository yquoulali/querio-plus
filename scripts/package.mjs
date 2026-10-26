#!/usr/bin/env node

/**
 * Package script for Chrome Web Store submission.
 * Creates a versioned ZIP file from the dist/ folder.
 *
 * Usage:
 *   node scripts/package.mjs          # Uses version from package.json
 *   node scripts/package.mjs 1.2.3    # Uses specified version
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');

// Get version from CLI arg or package.json
function getVersion() {
  const cliVersion = process.argv[2];
  if (cliVersion) {
    if (!/^\d+\.\d+\.\d+$/.test(cliVersion)) {
      console.error('❌ Invalid version format. Expected: X.Y.Z (e.g., 1.0.0)');
      process.exit(1);
    }
    return cliVersion;
  }

  const pkgPath = join(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

// Check if dist/ exists
if (!existsSync(distDir)) {
  console.error('❌ dist/ folder not found. Run "pnpm build" first.');
  process.exit(1);
}

// Check if manifest.json exists in dist/
const manifestPath = join(distDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('❌ dist/manifest.json not found. Run "pnpm build" first.');
  process.exit(1);
}

const version = getVersion();
const zipName = `querio-plus-v${version}.zip`;
const zipPath = join(rootDir, zipName);

// Remove existing ZIP if present
if (existsSync(zipPath)) {
  unlinkSync(zipPath);
  console.log(`🗑️  Removed existing ${zipName}`);
}

// Verify manifest version matches
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
if (manifest.version !== version) {
  console.warn(`⚠️  Warning: manifest.json version (${manifest.version}) differs from package version (${version})`);
  console.warn('   Update manifest.config.ts if needed.');
}

// Create ZIP
console.log(`📦 Packaging dist/ → ${zipName}`);
try {
  execSync(`cd "${distDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });
} catch (err) {
  console.error('❌ Failed to create ZIP:', err.message);
  process.exit(1);
}

// Report size
const { statSync } = await import('node:fs');
const stats = statSync(zipPath);
const sizeKB = (stats.size / 1024).toFixed(1);

console.log(`✅ Created ${zipName} (${sizeKB} KB)`);
console.log('');
console.log('Next steps:');
console.log('1. Go to https://chrome.google.com/webstore/devconsole');
console.log('2. Click "Add new item" or update existing');
console.log(`3. Upload ${zipName}`);
