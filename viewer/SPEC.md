# House plan spec (viewer input format)

The canonical format is the JSON Schema shared with the Architect bot:
**`/workspace/architecture/plan-schema.json`** (a copy lives in `scripts/plan-schema.json`).
This file explains it and how the viewer reads it. Do not change the schema here: change it at the source.

Validate any plan with `npm run validate` (all files in `public/plans/`) or
`node scripts/validate.mjs path/to/plan.json`. That runs the schema check plus id cross-references.

## Conventions

* **Units: metres.** `meta.units` is `"m"`. The loader also converts `mm`, `cm` and `ft` if a plan arrives in those.
* **Plan coordinates** are `[x, y]` on the ground plane: **x = east, y = north**. The origin is whatever `meta.origin` says (for the cozy 3-bed: the south-west corner of the site).
* **Heights** are measured from each level's `elevation` (finished floor level).
* **Walls are centrelines.** The wall's `thickness` is split equally on both sides of the `start` → `end` line.
* **Opening `offset`** is the distance along the wall centreline from `start` to the **near edge** of the opening.
* **Angles are in degrees.** Stair `direction` is a compass bearing (0 = +y/north, 90 = +x/east). Furniture `rotation` turns counter-clockwise in plan; at 0 the front of an item faces +y.
* **Polygons** are `[[x,y], ...]` with at least 3 points. They don't need to be closed and can go either way round (the viewer makes them counter-clockwise).

## Top level

```jsonc
{
  "version": "1.0",
  "meta":   { "name": "...", "units": "m", "origin": "south-west corner of site", "northAngleDeg": 0, "pdf": "..." },
  "site":   { "boundary": [[0,0],[20,0],[20,30],[0,30]], "features": [ ... ] },   // optional
  "levels": [ ... ],      // required
  "walls":  [ ... ],      // required
  "openings": [ ... ],
  "rooms":  [ ... ],      // required
  "stairs": [ ... ],
  "roof":   { ... },
  "furniture": [ ... ]    // optional placeholders
}
```

| Object | Fields (required in **bold**) | Defaults used by the viewer |
|---|---|---|
| level | **id**, **elevation**, name, height, slabThickness | name = id, height 2.7, slab 0.2. If elevation is missing it is stacked above the level below |
| wall | **id**, **level**, **start**, **end**, thickness, height, exterior, material | thickness 0.23 for exterior walls and 0.11 for interior ones; height = level height; exterior false |
| opening | **id**, **wall**, **type**, **offset**, **width**, height, sill, swing | door / sliding_door / garage_door / opening: height 2.1, sill 0; window: height 1.2, sill 0.9 |
| room | **id**, **level**, **name**, **polygon**, type, floorMaterial, outdoor | floor `tile` (`concrete` for a garage); outdoor = true for patio, stoep, deck, balcony and carport types |
| stairs | **id**, **fromLevel**, **toLevel**, **start**, **direction**, **width**, **run**, steps | steps = rise / 0.175 |
| roof | type (`gable`, `hip`, `flat`, `skillion`), pitchDeg, overhang, ridgeDirection (`x`/`y`), material, outline | flat; pitchDeg 30 (2 for flat); overhang 0.6; ridge along the longer side; outline from the exterior walls |
| site feature | **id**, **type**, **polygon**, name, elevation, depth, height, material | elevation 0; pool depth 1.5; boundary wall 1.8 high; fence 1.2; planter 0.4 |
| furniture | **type**, **room**, **position** (centre), rotation, size `[w,d,h]` | size taken from the per-type table in `src/loader.js` |

### Opening types
`door` (hinged; the viewer draws the leaf open 90° into the room, using `swing` for the hinge side),
`sliding_door` (aluminium stacker: one end panel is drawn slid open, normally the panel nearest the wall end; it switches to the other end only if furniture blocks that one),
`garage_door` (closed panel), `window` (frame, mullions and glass; you can't walk through it), `opening` (an empty void).

### Site feature types
`pool` (recessed and tiled, with water at −0.12 m, `depth`, and a 300 mm coping; you can't walk in),
`lawn`, `garden` (grass; a garden also gets shrubs, grasses and trees along its edges),
`patio`, `deck` (timber, raised to `elevation`), `paving`, `driveway`, `planter` (a raised bed at `height`),
`boundary_wall` / `fence`. There are two encodings:
(a) **footprint**: a thin closed rectangle (≤ 0.6 m wide) is the wall's plan outline and is extruded to `height` (Rev B uses one feature per segment, with real gate gaps);
(b) **centreline**: any other polygon is read as a wall/fence run along its edges, and gaps are left automatically where a driveway or path crosses it (fallback).

### Materials (free text, matched by keyword)
* walls: `face_brick` / `brick`, `plaster_white` / `plaster` (default), `grey` / `charcoal`, `timber` / `cladding`, `concrete` / `stone`. Interior faces of exterior walls are always white plaster.
* floors: `tile`, `wood` / `timber` / `laminate`, `carpet`, `concrete`, `pavers`. A `wood` floor in an outdoor patio becomes `timber_deck`.
* site: `timber` / `timber_deck`, `concrete slabs`, `pavers`, `gravel`, `concrete`.
* roof: `ibr` / `corrugated` / `sheet` (metal), `concrete_tile` / `tile`, `slate`.

### Viewer extensions (optional, outside the schema, allowed because the schema doesn't forbid extra properties)
* `roof.parapetHeight` (default 0.45 m on flat roofs when `overhang` ≤ 0.15 or the material mentions "parapet") and `roof.parapet: false`.
* `opening.offsetFrom: "center"`, for plans that measure the offset to the opening's centre.
* `site.features[].closed: false`, for an open fence or wall polyline.

## How the loader adapts plans

`src/loader.js` (`normalizePlan`) never edits the source file. It fills in defaults and accepts common aliases
(`floors`, `from`/`to`, `pitch`, `floor_material`, `{x,y}` points, compass words for `direction`, a wrapper `{plan:{...}}`).
It also adjusts geometry:
* clamps openings that run past the end of their wall or above its top, and warns about overlapping openings;
* turns wall-hugging furniture so its back is to the nearest wall, and turns sofas to face the TV;
* trims long items (counters, wardrobes and so on) that block a doorway, and warns about other doorway clashes. This is a fallback: Rev B needs no trimming;
* fills the small gaps between room polygons (for example under walls) with a slab under each room, 120 mm bigger all round;
* runs exterior walls up through the floor slab of the level above;
* draws short stand-alone wall sections (≤ 0.6 m long and ≤ 2.5 × their thickness, no openings, e.g. 150 × 150 patio posts) as true columns with no corner extensions;
* stops walls that continue in a collinear wall (e.g. W3a → W3b) at the shared point, so a brick face changes to plaster exactly there with no overlap;
* adds posts under roof corners that have no wall beneath (covered patios). This is a fallback that is skipped when the plan has its own post walls;
* cuts stairwell holes in the upper floor and in the ceiling below, and puts a glass balustrade around the hole.

Everything it changes is listed under **Notes (n)** in the toolbar and in the browser console.

## Example (abridged)

```json
{
  "meta": { "name": "Tiny", "units": "m" },
  "levels": [{ "id": "ground", "elevation": 0, "height": 2.7 }],
  "walls": [
    { "id": "W1", "level": "ground", "start": [0,0], "end": [6,0], "exterior": true },
    { "id": "W2", "level": "ground", "start": [6,0], "end": [6,4], "exterior": true, "material": "face_brick" },
    { "id": "W3", "level": "ground", "start": [6,4], "end": [0,4], "exterior": true },
    { "id": "W4", "level": "ground", "start": [0,4], "end": [0,0], "exterior": true }
  ],
  "openings": [
    { "id": "D1", "wall": "W1", "type": "door", "offset": 2.5, "width": 0.9 },
    { "id": "SD1", "wall": "W3", "type": "sliding_door", "offset": 1.0, "width": 3.0 }
  ],
  "rooms": [{ "id": "r1", "level": "ground", "name": "Studio", "polygon": [[0.115,0.115],[5.885,0.115],[5.885,3.885],[0.115,3.885]], "floorMaterial": "wood" }],
  "roof": { "type": "flat", "overhang": 0 },
  "site": { "features": [{ "id": "p", "type": "pool", "polygon": [[1,6],[5,6],[5,8.5],[1,8.5]], "depth": 1.4 }] }
}
```

Plans in this repo: `public/plans/cozy-3-bed.json` (the Architect's plan, loaded by default), `sample.json` (a single-storey 3-bed with a hip roof, pool and fence), and `test-two-storey.json` (stairs, gable roof). `public/plans/index.json` lists the plans in the picker.
