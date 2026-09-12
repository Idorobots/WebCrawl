# WEBCRAWL complete sprite pack

Start with `index.html` to browse assets locally. `manifest.json` is the authoritative runtime index; its paths are relative to the archive root that contains this `assets` directory. Load the JSON files directly in your engine or use them to generate engine-specific resources. Every runtime asset has a stable ID, path, dimensions, alpha range, visible bounds, anchor and SHA-256 checksum.

## Layout

- player: normalized idle and eight-direction walking sprites.
- enemies: seven mobile enemies with four-direction walk, melee and shooting cycles, plus three sentries with four-direction shooting cycles.
- scenery, debris and pickups: destructible room props, persistent debris, ammo, pedestal-ready weapons and other pickups.
- environment: floor tiles, compatible wall modules, static horizontal/vertical doors and the repeating tech background.
- portals: up/down inactive, activation and active sprites.
- effects: explosion, barrel explosion, healing, teleport, damage and flame-free plant destruction.
- ui: six nine-slice sets, masters and decorations.
- manifests: generated clips, UI slicing, current environment data, validation results and an empty legacy inventory.

## Animation and placement

Animation manifests list ordered asset IDs, fps and looping behavior. Each asset ID resolves through the root manifest. Suggested timing is adjustable. Walk cycles loop at 8 fps; attacks and effects play once. Portal activation holds the last frame and is not a seamless active-idle loop. Static states use fps 0.

Player movement and enemy walk/attack frames use 512 x 512 canvases with anchor (256,464). Draw at `world_position - anchor_px`. Scout, heavy and bosses retain distinct size classes. Suggested anchors are explicitly marked. Some generated poses retain mechanical/proportion variations.

Use straight PNG alpha blending and nearest-neighbor filtering. Floors and filled UI centers may intentionally be opaque. Define collision shapes and gameplay triggers separately from visible bounds. All foreground frames retain real transparency.

## Rooms, crates and UI

Floors use a 128-pixel grid and current walls use 64-pixel thickness. Angled wall modules are decorative assemblies, not interchangeable grid tiles. The tech background repeats in both axes.

Crates and their matching debris use 256-pixel canvases. Portal ground anchor is (256,448). Use per-asset metadata rather than assuming a universal prop origin.

For nine-slice UI, keep corners fixed, stretch horizontal/vertical edges along their length, and stretch the center in both axes. Exact pieces, borders and minimum sizes are in manifests/ui.json. Do not apply master-image border dimensions to the already-separated pieces.

The generated root manifest supersedes historical notes and source manifests. This archive contains individual sprites, not a texture atlas; pack an atlas in your engine if needed.

## Latest expansion

Robot spawner: dormant, charging, discharge and ready states. Spawn the enemy at the manifest spawn anchor; discharge frame index 2 is the suggested spawn event. New debris is persistent floor scenery, including barrel, plant, crate, robot and generic scrap piles.

Lab, control room and boss arena each have nine scenery props. Standalone weapons now have exactly 192 pixels of visible width on a 256 × 256 canvas, centered at (128,128); this standardizes pickup display size, not physical weapon dimensions.

The environment expansion adds plain and damaged floors, diagonal pieces, bends and rotated junctions. These are authored wall art modules requiring visual end alignment, not guaranteed seamless autotiles. Acute wall pieces and animated doors are intentionally absent from the current pack.

Barrel explosion is a separate eight-frame effect including a rising smoke cloud and sparks, played once at 12 fps. Other explosion and plant-break effects remain available.

All seven mobile enemies have four-frame melee and shooting cycles for front/back/left/right; three sentries have shooting only. No diagonal attack directions. Play once at 8 fps; suggested hit/projectile events use zero-based frame index 2. Muzzle flashes are artwork; gameplay projectiles/hitboxes are separate. All new attack frames have real alpha, shared 512-pixel canvases and palette normalization for armor. Generated anatomy/pose detail can vary slightly, especially between static, walking and attack states.
