#!/usr/bin/env node

/**
 * Release script for Querio+.
 * Builds the extension, creates a versioned ZIP, and publishes to GitHub Releases.
 *
 * Usage:
 *   node scripts/release.mjs              # Uses version from package.json
 *   node scripts/release.mjs 1.2.0        # Uses specified version
 *   node scripts/release.mjs --dry-run    # Build and package only, don't publish
 *
 * Prerequisites:
 *   - GitHub CLI (gh) installed and authenticated: `gh auth login`
 *   - Clean working directory (no uncommitted changes)
 */

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');

// ANSI colors for output
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const versionArg = args.find((a) => !a.startsWith('--'));

function log(emoji, message) {
  console.log(`${emoji}  ${message}`);
}

function run(cmd, options = {}) {
  try {
    const result = execSync(cmd, { encoding: 'utf-8', cwd: rootDir, ...options });
    return result ? result.trim() : '';
  } catch (err) {
    if (!options.silent) {
      console.error(red(`Command failed: ${cmd}`));
      console.error(err.message);
    }
    throw err;
  }
}

function checkPrerequisites() {
  // Check gh CLI is installed
  try {
    run('gh --version', { silent: true });
  } catch {
    console.error(red('❌ GitHub CLI (gh) not found.'));
    console.error('   Install: https://cli.github.com/');
    console.error('   Then run: gh auth login');
    process.exit(1);
  }

  // Check gh is authenticated
  try {
    run('gh auth status', { silent: true });
  } catch {
    console.error(red('❌ GitHub CLI not authenticated.'));
    console.error('   Run: gh auth login');
    process.exit(1);
  }

  // Check for uncommitted changes (warning only)
  try {
    const status = run('git status --porcelain', { silent: true });
    if (status) {
      console.warn(yellow('⚠️  Working directory has uncommitted changes:'));
      console.warn(status.split('\n').map((l) => `   ${l}`).join('\n'));
      console.warn('');
    }
  } catch {
    // Ignore git errors
  }
}

function getVersion() {
  if (versionArg) {
    if (!/^\d+\.\d+\.\d+$/.test(versionArg)) {
      console.error(red('❌ Invalid version format. Expected: X.Y.Z (e.g., 1.0.0)'));
      process.exit(1);
    }
    return versionArg;
  }

  const pkgPath = join(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

function updateVersions(version) {
  // Update package.json
  const pkgPath = join(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  
  if (pkg.version !== version) {
    pkg.version = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    log('📝', `Updated package.json to version ${version}`);
  }

  // Update manifest.config.ts
  const manifestConfigPath = join(rootDir, 'manifest.config.ts');
  if (existsSync(manifestConfigPath)) {
    let manifestConfig = readFileSync(manifestConfigPath, 'utf-8');
    const versionRegex = /version:\s*['"][\d.]+['"]/;
    if (versionRegex.test(manifestConfig)) {
      manifestConfig = manifestConfig.replace(versionRegex, `version: '${version}'`);
      writeFileSync(manifestConfigPath, manifestConfig);
      log('📝', `Updated manifest.config.ts to version ${version}`);
    }
  }
}

function build() {
  log('🔨', 'Building extension...');
  const result = spawnSync('pnpm', ['build'], { stdio: 'inherit', cwd: rootDir });
  if (result.status !== 0) {
    console.error(red('❌ Build failed'));
    process.exit(1);
  }
  log('✅', green('Build successful'));
}

function runTests() {
  log('🧪', 'Running tests...');
  const result = spawnSync('pnpm', ['test'], { stdio: 'inherit', cwd: rootDir });
  if (result.status !== 0) {
    console.error(red('❌ Tests failed'));
    process.exit(1);
  }
  log('✅', green('All tests passed'));
}

function createZip(version) {
  const zipName = `querio-plus-v${version}.zip`;
  const zipPath = join(rootDir, zipName);

  // Remove existing ZIP if present
  if (existsSync(zipPath)) {
    unlinkSync(zipPath);
  }

  log('📦', `Creating ${zipName}...`);
  try {
    run(`cd "${distDir}" && zip -r "${zipPath}" .`);
  } catch {
    console.error(red('❌ Failed to create ZIP'));
    process.exit(1);
  }

  const stats = statSync(zipPath);
  const sizeKB = (stats.size / 1024).toFixed(1);
  log('✅', green(`Created ${zipName} (${sizeKB} KB)`));

  return { zipName, zipPath };
}

function generateReleaseNotes(version) {
  // Get the previous tag (second most recent if current version tag exists, otherwise most recent)
  let commits = '';
  let previousTag = '';
  
  try {
    // Get all tags sorted by version, newest first
    const allTags = run('git tag --sort=-v:refname', { silent: true });
    const tags = allTags ? allTags.split('\n').filter(t => t.trim()) : [];
    
    if (tags.length > 0) {
      // Find the previous tag (not the one we're about to create)
      const currentTag = `v${version}`;
      previousTag = tags.find(t => t !== currentTag) || '';
    }
    
    if (previousTag) {
      // Get commits between previous tag and HEAD
      commits = run(`git log ${previousTag}..HEAD --pretty=format:"- %s" --no-merges`, { silent: true });
    } else {
      // First release - this shouldn't include all history
      // Just get commits since the beginning but cap it
      commits = '- Initial release';
    }
  } catch {
    commits = '- Initial release';
  }

  // Filter out version bump commits from the changelog
  if (commits && commits !== '- Initial release') {
    const filteredCommits = commits
      .split('\n')
      .filter(line => !line.includes('chore: bump version'))
      .join('\n');
    commits = filteredCommits || '- Bug fixes and improvements';
  }

  const notes = `## Querio+ v${version}

${previousTag ? `### Changes since ${previousTag}` : '### What\'s New'}

${commits}

### Installation

1. Download \`querio-plus-v${version}.zip\` below
2. Unzip to a folder
3. Go to \`chrome://extensions\`
4. Enable "Developer mode"
5. Click "Load unpacked" and select the unzipped folder
`;

  return notes;
}

function publishRelease(version, zipPath, zipName) {
  const tag = `v${version}`;
  const title = `Querio+ ${tag}`;

  log('🚀', `Publishing release ${tag} to GitHub...`);

  // Check if tag/release already exists
  try {
    run(`gh release view ${tag}`, { silent: true });
    console.error(red(`❌ Release ${tag} already exists.`));
    console.error(`   Delete it first: gh release delete ${tag} --yes`);
    console.error(`   Or use a different version.`);
    process.exit(1);
  } catch {
    // Tag doesn't exist, good to proceed
  }

  // Generate release notes
  const notes = generateReleaseNotes(version);
  const notesFile = join(rootDir, '.release-notes.md');
  writeFileSync(notesFile, notes);

  try {
    // Create the release with the ZIP attached
    execSync(
      `gh release create "${tag}" "${zipPath}" --title "${title}" --notes-file "${notesFile}"`,
      { stdio: 'inherit', cwd: rootDir },
    );
    log('✅', green(`Published release ${tag}`));
    log('🔗', cyan(`https://github.com/yquoulali/querio-plus/releases/tag/${tag}`));
  } finally {
    // Clean up notes file
    if (existsSync(notesFile)) {
      unlinkSync(notesFile);
    }
  }
}

function commitVersionBump(version) {
  try {
    const status = run('git status --porcelain package.json manifest.config.ts', { silent: true });
    if (status) {
      run('git add package.json manifest.config.ts');
      run(`git commit -m "chore: bump version to ${version}"`);
      log('📝', `Committed version bump to ${version}`);
    }
  } catch {
    // Ignore commit errors
  }
}

// Main
console.log('');
console.log(bold('🎯 Querio+ Release Script'));
console.log('─'.repeat(40));

if (dryRun) {
  console.log(yellow('🔸 Dry run mode - will not publish to GitHub\n'));
}

checkPrerequisites();

const version = getVersion();
log('📋', `Version: ${cyan(version)}`);
console.log('');

// Update version in files
updateVersions(version);

// Run tests
runTests();
console.log('');

// Build
build();
console.log('');

// Create ZIP
const { zipName, zipPath } = createZip(version);
console.log('');

if (dryRun) {
  log('🔸', yellow('Dry run complete. Skipping GitHub publish.'));
  console.log('');
  console.log('To publish manually:');
  console.log(cyan(`  gh release create v${version} ${zipName} --title "Querio+ v${version}" --generate-notes`));
} else {
  // Commit version bump if changed
  commitVersionBump(version);

  // Publish to GitHub
  publishRelease(version, zipPath, zipName);
}

console.log('');
console.log(green(bold('✨ Done!')));
