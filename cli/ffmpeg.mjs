import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * ffmpeg discovery.
 *
 * Playwright ships a deliberately minimal ffmpeg (VP8/WebM and PNG only, no
 * H.264), which is enough for WebM but cannot make an MP4. We therefore prefer
 * a real system ffmpeg and fall back to the bundled one, reporting honestly
 * which formats are actually available rather than failing at the last step.
 */
export function findFFmpeg() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return { path: process.env.FFMPEG_PATH, kind: 'system', full: true };
  }
  for (const bin of ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg']) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'pipe' });
      return { path: bin, kind: 'system', full: true };
    } catch { /* keep looking */ }
  }
  const bundled = [
    '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux',
    ...globSafe()
  ].find((p) => p && existsSync(p));
  if (bundled) return { path: bundled, kind: 'bundled', full: false };
  return null;
}

function globSafe() {
  try {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const { readdirSync } = require('node:fs');
    return readdirSync(base)
      .filter((d) => d.startsWith('ffmpeg'))
      .map((d) => `${base}/${d}/ffmpeg-linux`);
  } catch { return []; }
}

export const CODEC_SUPPORT = {
  mp4: (ff) => ff?.full === true,
  webm: () => true,
  gif: (ff) => ff?.full === true,
  prores: (ff) => ff?.full === true
};

/** Assemble a PNG sequence into a video. */
export async function encodeVideo({ ffmpeg, pattern, fps, output, format, quality = 17, transparent = false, onLog }) {
  const args = ['-y', '-framerate', String(fps), '-i', pattern];

  switch (format) {
    case 'mp4':
      // yuv420p and even dimensions are what makes an MP4 play everywhere.
      args.push(
        '-c:v', 'libx264', '-preset', 'slow', '-crf', String(quality),
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-movflags', '+faststart'
      );
      break;
    case 'webm':
      args.push(
        '-c:v', ffmpeg.full ? 'libvpx-vp9' : 'libvpx',
        '-pix_fmt', transparent ? 'yuva420p' : 'yuv420p',
        '-crf', String(quality + 7), '-b:v', '0'
      );
      break;
    case 'gif':
      args.push('-vf', `fps=${fps},scale=iw:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`);
      break;
    case 'prores':
      args.push('-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le');
      break;
    default:
      throw new Error(`Unknown video format "${format}".`);
  }

  args.push(output);
  onLog?.(`ffmpeg ${args.join(' ')}`);
  const { stderr } = await run(ffmpeg.path, args, { maxBuffer: 32 * 1024 * 1024 });
  return stderr;
}
