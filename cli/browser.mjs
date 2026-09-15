import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Chromium discovery.
 *
 * Normally Playwright knows where its own browser is. But the browser bundle
 * and the Playwright package are versioned independently, so a container that
 * pre-installs one and an npm install that fetches the other can disagree. We
 * therefore try the normal launch first and, only if that fails, fall back to
 * any Chromium we can find on disk.
 *
 * The full `chrome` binary is preferred over `headless_shell`: the shell build
 * omits some GPU plumbing, and WebGL is the entire point here.
 */
export function findChromium() {
  const candidates = [];
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    join(process.env.HOME || '', '.cache/ms-playwright'),
    join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  ].filter(Boolean);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries = [];
    try { entries = readdirSync(root); } catch { continue; }
    // Prefer the full chromium build, and newer revisions first.
    const dirs = entries
      .filter((d) => d.startsWith('chromium'))
      .sort((a, b) => {
        const shellA = a.includes('headless_shell') ? 1 : 0;
        const shellB = b.includes('headless_shell') ? 1 : 0;
        if (shellA !== shellB) return shellA - shellB;
        return (parseInt(b.split('-').pop(), 10) || 0) - (parseInt(a.split('-').pop(), 10) || 0);
      });
    for (const d of dirs) {
      candidates.push(
        join(root, d, 'chrome-linux', 'chrome'),
        join(root, d, 'chrome-linux', 'headless_shell'),
        join(root, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        join(root, d, 'chrome-win', 'chrome.exe')
      );
    }
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome');
  return candidates.find((p) => existsSync(p)) || null;
}

export const LAUNCH_ARGS = [
  // Software WebGL fallback. Where a real GPU exists Chromium uses it and
  // these are harmless; where one does not, they are what make WebGL work
  // at all instead of silently returning a null context.
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-software-rasterizer=false',
  '--force-color-profile=srgb'
];

/** Launch Chromium, falling back to a discovered binary on version mismatch. */
export async function launchChromium(chromium, { extraArgs = [] } = {}) {
  const args = [...LAUNCH_ARGS, ...extraArgs];
  try {
    return { browser: await chromium.launch({ args }), source: 'playwright' };
  } catch (err) {
    const executablePath = findChromium();
    if (!executablePath) {
      throw new Error(
        `${err.message}\n\n  No Chromium could be found. Install one with:\n    npx playwright install chromium\n`
      );
    }
    return { browser: await chromium.launch({ args, executablePath }), source: executablePath };
  }
}
