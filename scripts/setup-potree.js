#!/usr/bin/env node
/**
 * Downloads + builds the Potree develop branch (COPC-capable) and copies
 * the build artifacts into public/potree/ so the Express server can serve them.
 *
 * Run once: npm run setup
 * Re-run:   delete public/potree/ and run again
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const PUBLIC_POTREE = path.join(ROOT, 'public', 'potree');
const ZIP = path.join(VENDOR, 'potree-develop.zip');
const POTREE_ZIP_URL = 'https://github.com/potree/potree/archive/refs/heads/develop.zip';

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

if (fs.existsSync(PUBLIC_POTREE)) {
  console.log('public/potree/ already exists — skipping setup.');
  console.log('Delete it and re-run `npm run setup` to rebuild.');
  process.exit(0);
}

fs.mkdirSync(VENDOR, { recursive: true });

console.log('\n[1/4] Downloading Potree develop branch (~10 MB)…');
run(`curl -fsSL "${POTREE_ZIP_URL}" -o "${ZIP}"`);

console.log('\n[2/4] Extracting…');
run(`unzip -q "${ZIP}" -d "${VENDOR}"`);

const extracted = path.join(VENDOR, 'potree-develop');
if (!fs.existsSync(extracted)) {
  const dirs = fs.readdirSync(VENDOR).filter(d => d.startsWith('potree'));
  if (!dirs.length) { console.error('Could not find extracted Potree dir'); process.exit(1); }
  fs.renameSync(path.join(VENDOR, dirs[0]), extracted);
}

console.log('\n[3/4] Installing Potree deps + building (this takes ~2-3 min)…');
run('npm install', { cwd: extracted });

console.log('\n[4/4] Copying build artifacts to public/potree/…');
fs.mkdirSync(PUBLIC_POTREE, { recursive: true });
run(`cp -r "${path.join(extracted, 'build')}" "${path.join(PUBLIC_POTREE, 'build')}"`);
run(`cp -r "${path.join(extracted, 'libs')}" "${path.join(PUBLIC_POTREE, 'libs')}"`);

console.log('\nCleaning up vendor dir…');
run(`rm -rf "${VENDOR}"`);

console.log('\n✓ Potree ready. Run `npm start` to launch the server.\n');
