#!/usr/bin/env node
/** Post-install environment report: tells you what output formats will work. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function probe(bin, args = ['-version']) {
  try { execFileSync(bin, args, { stdio: 'pipe' }); return true; } catch { return false; }
}

const results = [];
const sysFfmpeg = probe('ffmpeg');
results.push(['System ffmpeg (MP4/H.264, GIF, ProRes)', sysFfmpeg]);

let bundled = null;
try {
  const { default: pw } = await import('playwright');
  bundled = pw.registerdPath;
} catch { /* playwright not yet installed during first pass */ }
const pwFfmpeg = ['/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux'].find((p) => existsSync(p));
results.push(['Bundled ffmpeg (WebM/VP8 only)', Boolean(pwFfmpeg)]);
results.push(['Chromium for headless rendering', existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers') || probe('chromium', ['--version'])]);

const pad = (s) => s.padEnd(42, ' ');
console.log('\n  OBJ Render Studio — environment check');
console.log('  ' + '─'.repeat(52));
for (const [label, ok] of results) console.log(`  ${ok ? '✓' : '·'} ${pad(label)} ${ok ? '' : 'not found'}`);
if (!sysFfmpeg) {
  console.log('\n  Note: PNG sequences and WebM always work.');
  console.log('  For MP4 (H.264) install ffmpeg:');
  console.log('    macOS    brew install ffmpeg');
  console.log('    Ubuntu   sudo apt install ffmpeg');
  console.log('    Windows  winget install Gyan.FFmpeg');
}
console.log('\n  Run `npm start` to open the studio.\n');
