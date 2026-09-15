# Command-line renderer

The CLI drives the same engine as the studio, inside a headless browser. There is no
separate offline renderer that could drift, so a 6K frame from here matches what you
approved in the viewport.

```bash
npm run build                # once, and after any code change
node cli/render.mjs --help
node cli/render.mjs --list   # every preset key
```

## Input

| Option | Meaning |
|---|---|
| `--model <path>` | `.obj` `.glb` `.gltf` `.fbx` `.stl` `.ply` `.dae` `.3mf`. Sibling `.mtl` and textures are found automatically. |
| `--config <path>` | A `.render.json` saved from the studio. Every other option overrides it. |

## Look

| Option | Meaning |
|---|---|
| `--preset <key>` | Lighting rig — `studio-softbox`, `golden-hour`, `low-key`, … |
| `--camera <key>` | Shot — `three-quarter`, `iso-technical`, `macro-detail`, … |
| `--material <key>` | `original`, `clay`, `metal-polished`, `glass`, … |
| `--look <key>` | Grade — `clean`, `punchy`, `cinematic`, `noir`, … |
| `--backdrop <key>` | `transparent`, `white`, `cyc`, `plinth-gloss`, … |
| `--exposure <n>` | Exposure multiplier |
| `--azimuth <deg>` `--elevation <deg>` | Camera angle and height |
| `--focal <mm>` | Focal length |

## Output

| Option | Meaning |
|---|---|
| `--out <dir>` | Output directory (default `./renders`) |
| `--format <fmt>` | `png` `jpg` `webp` `exr` `png-sequence` `mp4` `webm` `gif` |
| `--size <preset>` | `square-2048`, `uhd-3840x2160`, `print-a4-300`, … |
| `--width` `--height` | Explicit pixel size |
| `--background <mode>` | `as-configured` · `transparent` · `white` · `black` |
| `--engine <e>` | `raster` or `pathtrace` |
| `--samples <n>` | Path tracer samples per pixel |
| `--name <str>` | Base filename |

## Animation

| Option | Meaning |
|---|---|
| `--animate <type>` | `turntable`, `camera-orbit`, `dolly-in`, `light-sweep`, … |
| `--duration <sec>` | Length (default 6) |
| `--fps <n>` | Frame rate (default 30) |
| `--frames <a-b>` | Render only this range, e.g. `0-59` or `30` |

Because each frame is a pure function of time, `--frames` lets you split a long
render across machines or resume an interrupted one. The frames are identical either
way.

## Batch

`--angles <set>` renders a turnaround: `four-view`, `six-view`, `eight-turn`,
`sixteen-turn`, `hero-set`.

---

## Recipes

**Print-resolution hero still**

```bash
node cli/render.mjs --model chair.obj \
  --preset studio-softbox --camera three-quarter --look product-crisp \
  --size print-a3-300 --engine pathtrace --samples 400
```

**Cut-out for a layout** — transparent, with the grounding shadow in the alpha

```bash
node cli/render.mjs --model bottle.obj \
  --preset product-white --background transparent --size square-4096
```

**Frame sequence for an edit**

```bash
node cli/render.mjs --model watch.obj \
  --animate turntable --duration 8 --fps 30 \
  --size hd-1920x1080 --format png-sequence
```

**MP4 straight out**

```bash
node cli/render.mjs --model watch.obj --animate orbit-arc --format mp4
```

**Turnaround sheet for a deck**

```bash
node cli/render.mjs --model part.obj --angles eight-turn \
  --material clay --look accurate --background white
```

**Linear EXR for grading**

```bash
node cli/render.mjs --model car.obj --engine pathtrace \
  --samples 800 --format exr --look log-for-grading
```

---

## Notes

**Every render writes a `.render.json` beside its output.** Feed it back with
`--config` to reproduce the image exactly, or load it in the studio to keep working.

**Video formats need ffmpeg.** PNG sequences and WebM always work. MP4 (H.264) and
GIF need a full `ffmpeg` on your PATH; without one, the frames are still written and
the exact assembly command is printed.

**A GPU matters.** Chromium falls back to software rendering when no GPU is
available. Raster stays usable; path tracing becomes slow. Correctness is unaffected.

**Chromium.** The CLI uses Playwright's browser, falling back to any Chromium it can
find if the versions disagree. If neither works: `npx playwright install chromium`.
