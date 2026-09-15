# Examples

**`test-model/`** — a lathed test object with an `.mtl` and a diffuse texture.
Useful for checking that a change still renders correctly:

```bash
node cli/render.mjs --model examples/test-model/testobject.obj --preset studio-softbox
```

**`*.render.json`** — saved recipes. Load one in the studio, or render it directly:

```bash
node cli/render.mjs --config examples/cutout-transparent.render.json --model your-model.obj
```

A `.render.json` holds the entire look — lighting rig, camera, materials, grade and
output settings — in a few kilobytes. Keep one beside a model and you can reproduce
the exact image months later.
