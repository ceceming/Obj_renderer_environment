# Lighting

Lighting is where a render is won or lost. Geometry and materials set a ceiling on
how good an image *can* look; the light decides how good it actually is.

This guide covers how the system works, then how to use it.

---

## How light works here

Two systems cooperate.

**The environment** supplies almost all the illumination. It is built — not loaded —
from your light rig: a gradient sky dome, an optional sun, and one emissive surface
per softbox, rendered into a cube map and pre-filtered.

Building it rather than shipping HDRI files buys three things:

- every source stays movable, resizable, re-colourable and animatable;
- the specular highlight on a glossy surface is the **actual shape** of the actual
  softbox you placed, which is the single biggest tell of a real photograph;
- the whole look travels in a 4 KB JSON file instead of a 40 MB `.hdr`.

You can still load your own `.hdr` or `.exr` when you want one.

**A few real lights** supply what an environment cannot: cast shadows and crisp
directional definition. They run at a fraction of full strength so the two systems
sum to one correct exposure rather than double-counting.

The path tracer works differently — see the end of this document.

---

## The one control that matters most

**Source size relative to the subject.**

A 4×4 softbox at 2.6 units away produces gentle wraparound shadows with soft edges.
A 0.3-unit source at the same distance produces hard, crisp, graphic ones. Nothing
else you change will affect the character of the image as much.

This is not a stylistic setting — shadow softness is computed from each source's
angular size as seen from the subject, exactly as in reality. The sun is hard because
it is 0.53° wide; an overcast sky is soft because it is 180° wide.

Two practical consequences:

- **To soften a shadow**: make the source bigger, or move it closer. Both increase
  angular size.
- **To harden one**: make it smaller, or move it further away.

---

## Intensity is power, not brightness

A light's `intensity` is its total **power**, the way photographers and Blender think
about it — not its surface brightness.

This is why growing a softbox softens its shadow without also making the shot
brighter: the same power is spread over a larger area. It is also why a small hard
spot needs a smaller number than a big soft box to read at the same level.

---

## The rigs

### Studio

| Rig | What it does | Reach for it when |
|---|---|---|
| **Studio Softbox** | Big key camera-left, large fill opposite, subtle top | You want something that just works |
| **Three-Point** | Key / fill / backlight at textbook angles | Form needs to read clearly against the background |
| **High Key** | Wraparound light from every side, near-zero shadow | E-commerce, catalogue, anything bright and clean |
| **Low Key** | One hard key, almost no fill, deep falloff to black | Drama; shape carried by the highlight edge |
| **Rembrandt** | 45° up and across, triangle of light on the shadow side | Sculptural objects worth modelling |
| **Clamshell** | Big source above, bright bounce below | Cosmetics; glossy and symmetric |
| **Split** | Single source at 90°, half lit half black | Graphic, severe, silhouette-forward |
| **Packshot White** | Pure white sweep, even light, tiny contact shadow | Cut-out PNGs and marketplace listings |
| **Jewellery** | Many small hard sources | Faceted and polished surfaces that need glints |
| **Automotive Strips** | Long narrow sources | Curved bodywork; draws continuous highlight lines |
| **Ring Light** | On-axis circular source | Flat, modern, distinctive round catchlight |

### Indoor

| Rig | What it does |
|---|---|
| **North Window** | One large soft window, warm room bounce opposite. The classic still life. |
| **Warm Interior** | Tungsten practicals, pooled and warm, with cool window spill. |
| **Gallery** | Narrow overhead spots on neutral grey. The object glows, the room falls away. |

### Outdoor

| Rig | What it does |
|---|---|
| **Golden Hour** | Low warm sun, long soft shadows, cool sky fill. Universally flattering. |
| **Blue Hour** | Sun below the horizon. Deep blue ambient, no direct key. |
| **Overcast** | The whole sky is one softbox. Zero harsh shadow, true colours. |
| **Midday Sun** | Small, high, brutal. Crisp black shadows, blown highlights. |
| **Backlit Sunset** | Sun behind the subject. Blazing rim, silhouette body. |

### Stylised

**Neon** (magenta/cyan on near-black) · **Duotone Gels** (complementary sources from
opposite sides, colour doing the modelling) · **Teal & Orange** (the blockbuster
grade, done in-camera) · **Silhouette** (bright background, nothing on the front) ·
**Flatlay** (even overhead, pairs with the top-down camera).

### Utility

**Technical** — completely even, colour-neutral, shadow-free. Not pretty, accurate.

---

## Working method

A reliable order:

1. **Pick a rig** close to the mood you want. Do not start from scratch.
2. **Set the overall level** so the brightest part of the subject is just below
   clipping. Use *Overall level*, not exposure — it keeps the ratios intact.
3. **Rotate the rig** (alt-drag in the viewport) until the highlights fall where you
   want them. This is usually the highest-value thirty seconds you will spend.
4. **Adjust the key-to-fill ratio** for contrast. 2:1 is soft and commercial, 4:1 is
   a natural default, 8:1 and above is dramatic.
5. **Tune the key's size** for shadow character.
6. **Only then** touch exposure and grade.

If an image is not working, the fix is almost always in steps 3–5, not in the grade.

---

## Key-to-fill

The ratio between the key light and the fill is what "contrast" actually means in
lighting terms.

| Ratio | Reads as |
|---|---|
| 1:1 – 2:1 | Soft, commercial, friendly |
| 3:1 – 4:1 | Natural. Most product work. |
| 6:1 – 8:1 | Dramatic, editorial |
| 12:1+ | Low key, moody, graphic |

---

## Colour temperature

Every light has a Kelvin value and an optional gel.

| Kelvin | Source |
|---|---|
| 1800–2200 | Candle, firelight |
| 2700–3200 | Tungsten, warm domestic |
| 4000–4500 | Cool white fluorescent, gallery |
| 5600 | Daylight, studio strobe |
| 6500 | Overcast noon — neutral here |
| 7500–9000 | Open shade, blue hour |

Mixing temperatures is a technique, not a mistake: a warm key against a cool rim
separates a subject from its background more convincingly than brightness alone.

---

## Shadows

Three systems, each doing a different job:

**Shadow maps** give the cast shadow — the shape thrown onto the ground. Softness
follows source size. Resolution is adjustable; raise it if edges look chunky on a
large render.

**Contact shadows** give the dark pool immediately under the object. This is
computed by projecting the subject's depth from below, so it is view-independent and
free of shadow acne. It is also what stops a render looking like the object is
floating — almost every "floating object" problem is fixed by turning this up.

**The shadow catcher** is an invisible ground plane that receives shadows without
being visible itself. Keep it on for transparent output: it is what puts the shadow
into the alpha channel.

### Shadows in transparent PNGs

With a transparent background, both shadow systems write into the alpha channel as
near-black pixels at partial opacity. Dropped into Photoshop over any colour, the
object stays grounded instead of hovering.

*Keep shadow in alpha* controls this; *Alpha shadow strength* scales it.

---

## Lighting for a material

Different surfaces need different rigs.

| Surface | What it needs | Try |
|---|---|---|
| Matte / clay | Directional modelling; almost any rig works | Three-Point, Rembrandt |
| Glossy plastic | Large sources so highlights read as shapes | Studio Softbox, Clamshell |
| Polished metal | Something *worth reflecting* — metal shows the rig, not itself | Automotive Strips, Jewellery |
| Brushed metal | Sources perpendicular to the brush direction | Automotive Strips |
| Glass | Bright background to refract, dark surround for edge definition | Backlit Sunset, Low Key |
| Fabric | Grazing light to catch the sheen | Split, Window |
| Dark products | Strong rim separation, or they vanish | Low Key with rim boosted |
| White products | Restrained key, generous fill, or they blow out | High Key, Packshot |

The metal case is worth repeating: a mirror-finish object is almost entirely a
reflection of its surroundings. Lighting it means *arranging what it reflects*.

---

## Path tracing

The path tracer is fed the same rig, but differently: each softbox becomes a real
analytic area light it samples directly, and the environment carries the sky alone.

The reason is convergence. Given one combined environment map, a path tracer has to
find small bright regions by chance, and until it does the image is black with
scattered fireflies. Sampling the lights explicitly converges in a fraction of the
samples and gives clean soft shadows.

What you gain: true light bounces (colour bleeding between surfaces), real
refraction through glass, real optical bokeh, and shadows that are correct rather
than approximated.

What it costs: time. Budget 64 samples for a preview, 256 for a clean still, and
1000+ for glass and caustics.

Reversed face winding — common in exported OBJ files — makes ray-traced objects
render black where raster shading hides the problem. The loader detects it and warns,
and the path tracer forces double-sided materials so it does not bite you.
