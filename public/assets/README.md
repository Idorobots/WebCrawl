# WEBCRAWL asset pack

Individual PNG sprites based on your reference artwork. Start with `index.html` to browse the pack locally. No server is required.

## Contents

- Player: four idle orientations and 32 walking frames (eight directions, four frames each).
- Enemies: scout and heavy variants, plus three sentry designs and five boss designs, each with front/back/left/right files.
- Pickups: ten different weapons on pedestals, gold, crystal, and medkit.
- Props: three barrels, two ammo cases, terminal, crate, and five plants including four size/color/pot variations.
- UI: six nine-slice sets (panel, health bar, and button, each with an additional plain version), separate header decoration, and additional panels.
- Environment: 128-pixel floor/corridor grid, 15 corridor exit combinations, wall strips and corners, open/closed door modules, larger assembled art variants, and a repeating dark tech background.
- Effects: six individual generic explosion frames.
- Previews: contact sheets, walk/explosion GIFs, and an assembled room.

## Import

Use PNG alpha blending. Sprites have actual transparent pixels. Floor tiles, background textures, and filled UI centers intentionally contain opaque pixels. JPG/GIF previews have solid backgrounds and are not sprite assets.

Use nearest-neighbor filtering for the pixel-art appearance. All walking frames are 256 × 256 with a bottom-center anchor at (128,240). Start at 8 frames/second, repeating 01–04. These are independently generated poses; some directions have slight pose/proportion variation and can benefit from a final hand-animation pass. Idle poses are separate artwork and may need scale adjustment to match walking.

Sentry canvases are 256 × 256; boss canvases are 512 × 512. The `manifest.json` records dimensions and available anchors. Scale props and pickups to suit your world units; canvas size does not imply collision size. Define collision shapes separately.

Play explosion frames 01–06 once at roughly 12 fps. Each uses a 256 × 256 canvas and center anchor (128,128). Smoke was reconstructed with partial alpha to remove the painted checker pattern; no barrel is included.

## Resizable UI

Each UI set has nine independent files: four corners, four edges, and a center. Keep corners fixed. Stretch top/bottom horizontally, left/right vertically, and center in both dimensions. Read `manifest.json` → `ui` for exact borders and minimum dimensions. `source.png` is the combined master; `example_*.png` demonstrate resizing. Empty panel centers are transparent, so place a color fill underneath when desired.

## Room construction

Use `environment/tiles` for a 128 × 128 grid. Corridor filenames list open exits with N/E/S/W letters; openings span pixels 32–95 along each open edge. Match exits to adjacent tiles. Wall strips are 128 × 32 or 32 × 128; corners occupy 128 × 128 with transparent interiors. Open doors have transparent centers to overlay floors.

`environment/art_variants` contains larger illustrated assemblies. They are decorative alternatives, not interchangeable grid tiles. The dark tech texture repeats in both axes using a mirrored layout with matching opposite edges. The assembled-room preview demonstrates placement and scale, not a finished level.

## Known unfinished art

Six rear-view files need an art revision: `sentry_twin_back`, `boss_siege_back`, `boss_missile_back`, `boss_laser_back`, `boss_arc_back`, and `boss_fortress_back`. Their bodies include rear details, but some forward weapon/sensor details remain visible or ambiguous. They are retained as drafts so no generated work is lost. They are also flagged `needs_art_revision` in the manifest and labeled in the browser. Image generation reached its usage limit during the correction attempt.

All requested asset categories are represented. The six rear-view corrections above remain unfinished; transparency cleanup does not fix their viewing geometry.
