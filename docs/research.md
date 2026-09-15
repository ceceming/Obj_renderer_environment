# Research notes: how to build this, and why

A record of the approaches considered and the reasoning behind what was built.

---

## The problem

Take an `.obj` with materials, give someone photographic control over lighting and
camera, and produce output usable in graphic design, motion work and the web. Visual
quality is the priority.

Three things had to be decided: the renderer, how lighting is specified, and how
offline output stays faithful to what you approved on screen.

---

## 1. The renderer

### Options

**Blender + Cycles, driven headlessly.** The highest ceiling: production path tracer,
OSL, denoising, real cameras. Rejected — it is a ~400 MB dependency, needs a Python
bridge, has no interactive web viewport, and puts a heavyweight install between the
user and their first render. It is the right answer for a studio pipeline, not for
"drop a file in and look at it".

**A native renderer (Mitsuba, LuxCore, PBRT).** Physically excellent, ecosystem-poor.
No interactive preview, awkward material import, and every one of them would need a
custom UI built on top anyway.

**three.js (WebGL2).** Runs anywhere with a browser, imports OBJ/MTL/GLTF/FBX/STL/PLY
natively, has a mature PBR material model (`MeshPhysicalMaterial`: clearcoat, sheen,
transmission, iridescence, anisotropy), modern tone mapping including AgX, and a full
post-processing stack. Interactive by nature.

**WebGPU.** The future, and `WebGPURenderer` exists — but it is still gaining
coverage, and WebGL2 loses nothing that matters here today. Easy to migrate later
since the scene graph is shared.

### Decision

**three.js WebGL2 for interaction, `three-gpu-pathtracer` for the hero frame.**

This is the combination that gets both properties that matter: instant feedback while
art-directing, and true global illumination when it counts. The path tracer is built
on the same scene graph and materials, so switching engines does not change the look —
it refines it.

Verified in practice: the real-time renderer produces a correctly exposed, correctly
coloured product shot; the path tracer produces the same image with real bounce
lighting.

---

## 2. How lighting is specified

This was the most consequential decision.

### Options

**Ship a library of HDRI files.** What most viewers do. Photographically real and
immediately good-looking — but the light is *baked*. You cannot move a softbox,
resize it, change its colour temperature or animate it. And good HDRIs are 20–80 MB
each, so a useful library is a multi-gigabyte download.

**Classic three-point lighting with point/spot/directional lights.** Fully
controllable, tiny, but wrong-looking: analytic lights produce pinpoint specular
highlights, while every real photograph shows the *shape* of the source reflected in
the surface. Rendering glossy products this way is exactly why CG reads as CG.

**Synthesise the environment from an editable rig.**

### Decision

**Procedural IBL built from an area-light rig.**

The environment is generated at runtime from a gradient sky, an optional sun, and one
emissive surface per softbox, rendered to a cube map and PMREM-filtered. That gives:

- the controllability of analytic lights;
- the specular behaviour of an HDRI — the highlight on a glossy surface is the actual
  rectangle you positioned;
- shadow softness derived from each source's true angular size;
- a complete look stored in ~4 KB of JSON.

Users can still load their own `.hdr`/`.exr`; everything else keeps working.

### What this cost to get right

Three calibration problems, each of which produced a plausible-but-wrong image:

**The environment was ~10× too hot.** Preset intensities were authored as readable
numbers and used directly as radiance. Every channel saturated and AgX — which
deliberately desaturates highlights — bleached everything to white. Symptom: a red
object rendering as a white one. Fixed by calibrating against a known-albedo white
clay reference until a lit white surface landed at ~200 sRGB with no clipping.

**A "studio" sky dome painted near-white is an enormous uniform light.** It delivered
more irradiance than every softbox combined, so every rig rendered flat regardless of
its settings. A real studio is a dark room with bright sources in it; studio sky
modes are now dim and stand in for wall bounce, while outdoor modes stay at full
strength because outdoors the sky genuinely is the light.

**Intensity had to mean power, not surface brightness.** With radiance semantics,
resizing a softbox changed the exposure, and small sources — a gallery spot, a
jewellery glint — delivered almost nothing. Switching to power (`radiance = power /
area`, as photographers and Blender treat it) made the size controls behave: growing
a box softens its shadow without brightening the shot. Existing presets were migrated
by exact arithmetic so the verified looks were preserved under the new semantics.

None of these were visible as errors — each produced an image that looked like a
deliberate choice. They were found by measuring, not by looking.

---

## 3. Keeping offline output faithful

### Options

**Reimplement rendering server-side.** Two codebases, guaranteed to drift. The
viewport becomes a rough guide rather than a proof.

**Screen-capture the viewport.** Faithful, but capped at screen resolution.

**Run the same engine headless.** Chosen.

### Decision

The CLI launches headless Chromium, loads the same built application, and drives it
through a small RPC surface. One `RenderConfig` object, one renderer, three consumers
(studio, CLI, exported viewer).

A 6K frame from the command line is the viewport composition at a different pixel
count — not an approximation of it.

**Animation is a pure function of time.** Frame *n* is computed from the animation
curve alone, never from frame *n−1*. So renders are deterministic, resumable, and
splittable across machines, and grain does not crawl between frames.

---

## 4. Smaller decisions worth recording

**Tone mapping: AgX as the default.** ACES is familiar but noticeably shifts hue in
saturated highlights. AgX desaturates bright areas the way film does, which keeps
coloured products believable when a highlight rolls off. Khronos Neutral is offered
for colour-critical work, ACES for a cinematic look.

**Grade before the tone map, finish after it.** Exposure, white balance and
lift/gamma/gain run in linear HDR so highlights roll off instead of clipping. Grain,
vignette, chromatic aberration and sharpening run after, in display space, because
that is where those artefacts physically occur.

**Bloom thresholds must sit above diffuse white.** A threshold below 1.0 makes a
plain white backdrop bloom and flood the subject — which looked like a lighting
problem and was not. Only genuine highlights should glow.

**Contact shadows as a separate system.** Shadow maps alone leave objects looking
like they hover. Projecting the subject's depth from below gives a view-independent
grounding pool with no shadow acne, and — importantly — it writes into the alpha
channel, so a transparent PNG stays grounded over any background.

**Transparent output needed colour clamped to coverage.** Bloom deposits light into
pixels the subject barely covers; composited over a background that reads as a bright
halo instead of a soft shadow. Capping brightness at each pixel's own alpha fixes it
without touching opaque pixels.

**Legacy MTL must be upgraded, carefully.** `MTLLoader` produces `MeshPhongMaterial`,
which cannot respond correctly to an IBL. Converting shininess to roughness and
tagging textures with the right colour space is usually the difference between a dull
OBJ and a photographed one. One tempting inference had to be rejected: a bright
neutral `Ks` looks like metal, but `Ks 0.9 0.9 0.9` is what most exporters emit by
default — treating it as metalness turns every ordinary OBJ into a mirror and throws
away its base colour. Classic MTL cannot express metal at all, so dielectric is the
only safe default.

**Texture resolution must be extension-aware.** Matching texture filenames loosely is
necessary — MTL files routinely carry absolute Windows paths — but matching across
extensions lets a `.mtl` answer a request for a `.png`, or hijack the model's own
URL. Exact match first, then same-extension fuzzy match, then same-stem texture
match.

**Reversed winding is common and breaks ray tracing silently.** Raster shading uses
supplied vertex normals and hides inside-out faces; a path tracer respects geometric
winding and renders such an object as a black silhouette. The loader now detects and
warns, and the tracer forces double-sided materials.

**Float32 textures are not reliably filterable.** Linear filtering of 32-bit float
textures requires `OES_texture_float_linear`, which many drivers — including software
rasterisers — do not provide. Where it is missing the sampler returns garbage and the
path trace comes out flat and unlit. Half float is effectively universal and loses
nothing perceptible.

---

## 4a. Two defects found by testing other formats

Both were invisible while only OBJ was being tested, and both had been shipped.

**The exposure calibration was measured against back-faces.** The white-clay
reference used to set the light levels was rendered *before* the test model's
reversed face winding was found and fixed. Raster shading uses the supplied
vertex normals and happily shades an inside-out mesh, so the calibration
measured the far wall of the object rather than the near one, and settled on a
level roughly three times too hot. Nothing looked obviously wrong afterwards
because the models in use were dark or saturated — a red body, a gold metal —
where overexposure reads as "bright and glossy". A white surface is what exposes
it: white clay came out as a featureless silhouette, 77% of it clipped.

The fix was to re-run the calibration on correct geometry and, more usefully, to
make the measurement honest: `cli/calib.mjs` now renders the reference on a
transparent background and uses the alpha channel to measure the *subject only*,
reporting the brightness distribution and clipped fraction rather than a couple
of hand-placed probe points that could miss the peaks entirely.

**"Original" materials were not original.** Every extended PBR property —
clearcoat, transmission, sheen, iridescence, anisotropy, IOR, volume — was
written from the UI's default on every material rebuild. For an OBJ this is
harmless, because classic MTL cannot express any of them. For a GLTF it silently
discarded whatever the file authored: the Khronos TransmissionTest rendered as
a grid of opaque balls.

The fix is that a control only takes effect once it differs from its default, or
when a material preset asks for it explicitly; otherwise the authored value
stands. The general lesson is that a UI default and "no opinion" are not the same
value, and conflating them quietly destroys data.

---

## 5. What was deliberately left out

**Denoising (OIDN/OptiX).** Would cut path-trace times substantially. There is no
mature WebAssembly build; the honest alternatives are more samples or the raster
engine. Worth revisiting.

**Volumetrics and caustic-heavy scenes.** The path tracer supports basic fog volumes;
neither is a priority for product visualisation.

**Retargeting and animation authoring.** Embedded clips play, and can be
rendered frame by frame, but there is no timeline editing, blending or
retargeting. That is a DCC tool's job.

**Mesh editing and UV work.** Out of scope — this is a rendering environment, not a
DCC tool.

**WebGPU.** No functional gain today. The scene graph is shared, so migration is a
renderer swap rather than a rewrite.

---

## References

- [three.js](https://threejs.org/) — renderer, loaders, post-processing
- [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) — path tracing on `three-mesh-bvh`
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) — BVH acceleration
- [three.js path tracer example](https://threejs.org/examples/webgl_renderer_pathtracer.html)
- [Khronos PBR Neutral tone mapper](https://github.com/KhronosGroup/ToneMapping)
- [Blender Cycles](https://www.cycles-renderer.org/) — the reference for offline quality
