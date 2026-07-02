#!/usr/bin/env node
/**
 * Renders assets/icon/app-icon.svg into PNG sizes + electron/icon.icns (macOS).
 * Uses qlmanage + sips (built into macOS).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'assets/icon/app-icon.svg');

if (process.platform !== 'darwin') {
  console.error('generate-icons.mjs currently requires macOS (qlmanage + iconutil).');
  process.exit(1);
}

function renderPng(size, outPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitwall-icon-'));
  const thumbPath = path.join(tmpDir, `${path.basename(svgPath)}.png`);

  try {
    execFileSync('qlmanage', ['-t', '-s', String(size), '-o', tmpDir, svgPath], {
      stdio: 'pipe',
    });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.copyFileSync(thumbPath, outPath);
    execFileSync('sips', ['-z', String(size), String(size), outPath], { stdio: 'pipe' });
    console.log(`wrote ${path.relative(root, outPath)} (${size}px)`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const outputs = [
  [16, path.join(root, 'apps/client/public/favicon-16.png')],
  [32, path.join(root, 'apps/client/public/favicon-32.png')],
  [180, path.join(root, 'apps/client/public/apple-touch-icon.png')],
  [512, path.join(root, 'apps/client/public/icon-512.png')],
  [1024, path.join(root, 'electron/icon.png')],
];

for (const [size, out] of outputs) {
  renderPng(size, out);
}

fs.mkdirSync(path.join(root, 'apps/client/public'), { recursive: true });
fs.copyFileSync(svgPath, path.join(root, 'apps/client/public/favicon.svg'));

const iconsetDir = path.join(root, 'assets/icon/icon.iconset');
fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });

const iconset = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

for (const [name, size] of iconset) {
  renderPng(size, path.join(iconsetDir, name));
}

const icnsPath = path.join(root, 'electron/icon.icns');
execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' });
console.log(`wrote ${path.relative(root, icnsPath)}`);
