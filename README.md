# OBJ Render Studio

A physically based rendering environment for turning 3D models into images you can
actually use in design work.

Drop in an `.obj` with its `.mtl` and textures, art-direct the lighting and camera
the way a photographer would, and export a cut-out PNG, a print-resolution still, a
numbered frame sequence for your editor, a linear EXR for grading, or an interactive
page you can send to a client.

```bash
npm install
npm start          # opens the studio at http://127.0.0.1:5173
```

Then drag your model onto the viewport.

**No computer to hand?** The studio is a browser application — it runs on an
iPad, in Safari, with no install. See [Running it without a
computer](#running-it-without-a-computer).

---

## What this is for

The hard part of getting a good render out of a 3D file is not the geometry — it is
the **light**. This project is built around that: 25 lighting rigs drawn from real
photographic setups, every source movable, resizable and re-colourable, with the
specular highlight on a glossy surface being the actual shape of the actual softbox
you positioned.

Everything else — camera, materials, grade, output — exists to serve that.

---

## Quick start

### The studio

```bash
npm start
```

| | |
|---|---|
| **Load a model** | Drag the `.obj` **and** its `.mtl` and texture folder onto the viewport. Whole folders work. |
| **Orbit** | Drag |
| **Pan** | Shift + drag |
| **Spin the lights** | Alt + drag — the fastest way to hunt for a highlight |
| **Zoom** | Scroll |
| **Grid / framing guides** | <kbd>G</kbd> / <kbd>F</kbd> |
| **Toggle render engine** | <kbd>P</kbd> |
| **Play animation** | <kbd>Space</kbd> |
| **Render & save** | <kbd>Cmd/Ctrl</kbd> + <kbd>S</kbd> |

### The command line

The CLI drives the *same* engine inside a headless browser, so a 6K frame matches
the viewport exactly.

```bash
npm run build                                    # once

node cli/render.mjs --model chair.obj --preset golden-hour --size uhd-3840x2160
node cli/render.mjs --model watch.obj --animate turntable --duration 6 --format mp4
node cli/render.mjs --config hero.render.json --engine pathtrace --samples 512
node cli/render.mjs --model lamp.obj --angles eight-turn --background transparent
node cli/render.mjs --list                       # every preset key
```

See [docs/cli.md](docs/cli.md) for the full option list.

### Checking a change

```bash
npm run smoke
```

Loads the studio, verifies the interface builds and runs clean, then renders a
still and a transparent cut-out headlessly and inspects the resulting pixels —
that the subject is actually shaded, that the background is transparent, and that
the grounding shadow made it into the alpha channel.

---

## Running it without a computer

The studio needs a browser, not a toolchain, so it runs anywhere — including an
iPad. Only the command-line renderer needs Node.

Three ways to reach it:

| | How | Good for |
|---|---|---|
| **Locally** | `npm start` | Everything. The only route that supports EXR, GLB and the CLI. |
| **GitHub Pages** | Settings → Pages → Source: *GitHub Actions*. The included workflow builds and deploys on every push. | A permanent URL of your own, on any device. Private repos need a paid plan — otherwise drop the `dist` folder on [netlify.com/drop](https://app.netlify.com/drop). |
| **A hosted viewer** | A published page | Opening it immediately on a tablet. Saving goes through the host's prompt; EXR and GLB are not accepted there. |

### On an iPad

Works: the full studio, all 25 lighting rigs, the path tracer, and PNG / JPEG /
WebP / frame-sequence ZIP / interactive HTML / config exports.

- With a **mouse and keyboard** attached, everything behaves as on a desktop —
  scroll to zoom, shift-drag to pan, alt-drag to spin the lights, and the
  keyboard shortcuts all work.
- With **touch alone**: one finger orbits, two fingers pan and pinch-zoom, and
  the *Drag: camera / lights* button in the toolbar swaps what a single finger
  does — there being no alt key to hold.

Two limits worth knowing:

- **Keep renders at or below 2048px.** Safari caps how much memory a tab may
  hold, and the post-processing chain keeps several full-resolution HDR buffers
  — around 134 MB each at 4K. The studio warns before a render that would risk
  it, and refuses above 4096px. For poster sizes, use a computer.
- **No folder picking.** iOS has no directory upload, so select the `.obj`,
  its `.mtl` and its textures together in the file picker. Textures are matched
  by filename, so the folder structure does not matter.

The **command-line renderer does not run on iPad** — that means no MP4/GIF
encoding, no overnight batch renders, and no EXR. Frame sequences still export
from the browser as a ZIP, ready to assemble later.

---

## The two renderers

| | Real-time (raster) | Path traced |
|---|---|---|
| Speed | instant | seconds to minutes per frame |
| Lighting | image-based, pre-filtered | true global illumination |
| Shadows | shadow maps + contact shadows | real soft shadows from area lights |
| Glass | approximated | real refraction and absorption |
| Depth of field | post-process blur | real optical bokeh |
| Use it for | art direction, animation, most stills | the hero frame you deliver |

Art-direct in real time, then press <kbd>P</kbd> and let the path tracer converge on
the shot you are actually shipping. Both read the same config, so nothing shifts
when you switch.

**A GPU matters here.** The path tracer is a GPU workload; on a machine falling back
to software rendering it still produces correct images, just slowly.

---

## Lighting

25 rigs across five groups. Each is a real setup, not a colour preset:

**Studio** — Softbox · Three-Point · High Key · Low Key · Rembrandt · Clamshell ·
Split · Packshot White · Jewellery · Automotive Strips · Ring Light
**Indoor** — North Window · Warm Interior · Gallery
**Outdoor** — Golden Hour · Blue Hour · Overcast · Midday Sun · Backlit Sunset
**Stylised** — Neon · Duotone Gels · Teal & Orange · Silhouette · Flatlay
**Utility** — Technical

Every rig is fully editable: pick a light from the list and you get its power,
position, distance, physical size, diffusion, colour temperature, gel and shape.

The one control that matters most is **size relative to the subject**. A wide
softbox close in gives soft wraparound shadows; a small distant source gives hard
crisp ones. That is true here for the same reason it is true in a real studio —
shadow softness is computed from each source's angular size.

[docs/lighting.md](docs/lighting.md) goes through this properly.

---

## Cameras

16 shot presets from Three-Quarter Hero through true Isometric to Macro Detail, plus
direct control of:

- **Focal length on a named sensor** (12–300mm; full-frame, APS-C, Super 35, medium
  format, IMAX). Short lenses exaggerate depth, long lenses flatter — product work
  lives at 85–135mm.
- **Orbit / height / fill-frame**, which are resolution independent, so the same
  camera works at 1:1 and at 16:9.
- **Lens shift**, to keep verticals vertical without tilting the camera.
- **Depth of field** with a real f-stop and aperture-blade count.
- **Orthographic projection** for technical and isometric work.

---

## Materials

26 treatments, from `original` (respects your MTL exactly) through clay and
porcelain to polished metal, brushed metal, glass, frosted glass, carbon fibre,
iridescence, toon and X-ray.

Legacy `.mtl` materials are converted to physically based shading on load —
shininess becomes roughness, textures get the correct colour space. That single step
is usually the difference between an OBJ that looks flat and one that looks
photographed.

---

## Output

| Format | Notes |
|---|---|
| **PNG** | Lossless, real alpha channel. The default for design work. |
| **PNG + transparent** | Cut-out with the grounding shadow written into the alpha, so it composites over any colour in Photoshop or After Effects. |
| **JPEG / WebP** | Flattened; WebP keeps alpha. |
| **OpenEXR** | 32-bit linear, un-tone-mapped. Grade it in Resolve or Nuke without clipping. Path tracer only. |
| **PNG sequence** | Numbered frames in a ZIP, with the ffmpeg commands included. |
| **MP4 / WebM / GIF** | Assembled by the CLI. WebM keeps transparency. |
| **Interactive HTML** | One self-contained file with the model inside it. Opens from the desktop, no server. |
| **three.js project** | `index.html` + a commented `viewer.js` + `model.glb` + `config.json`, ready to fold into a site. |
| **GLB** | The configured scene as a 3D asset. |
| **`.render.json`** | The whole recipe in a few kilobytes. Diffable, and reproduces the image exactly. |

Resolution presets cover social, story, HD, 4K, DCI, A4/A3 at 300dpi, and poster
sizes — or set any size you like.

### Batch turnarounds

Render 4-view, 6-view, 8- or 16-step turnarounds, or a 5-shot art-directed hero set,
in one go.

---

## Animation

12 moves: turntable, camera orbit, orbit arc, dolly in/out, crane, light sweep,
exposure ramp, focus pull, rotate-and-reveal, pendulum, roughness sweep.

Every frame is a pure function of time, so frame 300 renders without rendering the
299 before it. That means deterministic output, resumable renders, and no drift.

For a perfect loop, use a turntable with `linear` easing — or turn on ping-pong and
any move loops seamlessly.

---

## Video encoding

PNG sequences and WebM always work. **MP4 (H.264) and GIF need a full `ffmpeg`**;
without one the frames are still written and the exact command to assemble them is
printed.

```
macOS    brew install ffmpeg
Ubuntu   sudo apt install ffmpeg
Windows  winget install Gyan.FFmpeg
```

---

## Supported input

| Format | Materials | Notes |
|---|---|---|
| **`.glb` / `.gltf`** | Full PBR | The best-supported format. Metallic-roughness, normal/AO/emissive maps, and the `KHR_materials_*` extensions — clearcoat, transmission, sheen, iridescence, anisotropy, volume — are all read and preserved. |
| **`.fbx`** | Converted to PBR | Geometry, materials, embedded textures, skeletons and animation clips. Legacy Phong materials are upgraded on load. |
| **`.obj` + `.mtl`** | Converted to PBR | The classic pairing. Textures are resolved by filename, so an MTL written on another machine with absolute Windows paths still finds its maps. |
| **`.dae`, `.3mf`** | Converted to PBR | Collada and 3MF. |
| **`.stl`, `.ply`** | None / vertex colours | Geometry only — STL carries no materials or UVs, so use a Material preset. PLY vertex colours are honoured. |
| **`.hdr` / `.exr`** | — | Environment maps, if you would rather use your own than the procedural rig. |

Verified against the Khronos sample assets: Damaged Helmet, ClearCoatTest and
TransmissionTest all render correctly, as does a rigged, animated Mixamo FBX.

### Animation carried inside the file

GLTF and FBX files often contain their own animation — a rigged character, a
mechanism, a camera move. Those clips are detected on load, listed by name and
duration, and play under the **Embedded Clip** animation type (or **Clip +
Turntable**, which orbits the camera at the same time). Pick a clip and the
timeline adopts its authored length, so it plays at the speed it was made at.

Without that, a file renders in its rest pose — which for a character means the
T-pose.

---

## Project layout

```
src/core/       the renderer — shared by the studio, the CLI and exports
  schema.js         RenderConfig: the single source of truth
  environment.js    procedural IBL built from the light rig
  lighting.js       light rig, shadow catchers
  contactShadows.js the soft pool that stops objects floating
  materials.js      MTL/Phong -> PBR conversion and overrides
  camera.js         framing, lenses, lens shift
  post.js           tone mapping, AO, bloom, grade, grain
  pathtracer.js     hero-quality rendering
  presets/          lighting, cameras, materials, looks, backdrops
src/app/        the studio interface
src/headless/   the RPC surface the CLI drives
cli/            offline renderer, static server, ffmpeg handling
templates/      the portable viewer used by HTML/three.js exports
docs/           lighting guide, CLI reference, research notes
```

One config object, one renderer, three consumers. That is what makes the viewport
WYSIWYG: there is no second code path that could drift from what you approved.

---

## Documentation

- [docs/lighting.md](docs/lighting.md) — how to light an object, and what each rig is for
- [docs/cli.md](docs/cli.md) — full command-line reference
- [docs/research.md](docs/research.md) — the approaches considered and why this one
