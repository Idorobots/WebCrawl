# WebCrawl

A tiny dependency-free Node.js app that serves the D3 dungeon mapper and fetches remote HTML through the same server.

## Run

Requires Node.js 18+.

```bash
node server.js
```

Then open:

http://127.0.0.1:3000

Optional environment variables:

```bash
PORT=8080 HOST=0.0.0.0 node server.js
```

The backend includes basic protections against fetching localhost/private-network addresses, checks redirects, limits remote responses to 5 MB, and times requests out after 12 seconds.

Some websites may still block automated/server-side requests, require authentication, or render their useful DOM only after JavaScript executes. Those cases would require a headless browser such as Playwright.


## Game controls

- Arrow keys move the player avatar.
- Walk onto a down staircase to visit that link/page.
- Walk onto the up staircase in the green starting room to return to the previous page.
- Walk onto crown loot in image rooms to collect it.


## Doorway movement

Rooms are packed close together and the short corridors between them act as wide walkable doorways. The doorway hitboxes overlap the room interiors slightly so the player can cross thresholds smoothly.


## Starting staircase

The green starting room always contains a staircase. When there is navigation history it is an active up staircase back to the previous page. On the initial page it is shown as an inactive entrance marker.


## Camera, fog of war, and minimap

- The viewport follows the player with a short smooth transition.
- The camera is zoomed so the current room fills most of the viewport while neighboring rooms remain partly visible.
- Unvisited rooms are hidden; corridors remain visible.
- Once a room is entered, it remains revealed.
- Press `M` to toggle a minimap modal containing only revealed rooms and the corridors between them.
- The current room is highlighted on the minimap.
- Staircases are placed near the center of their room to keep doorways clear.


## Persistent floor discovery

- Corridors are only revealed once both rooms they connect have been visited.
- Revealed rooms are stored per page/floor for the lifetime of the app session.
- Returning to a previous page restores the rooms and corridors already discovered there.
- The minimap includes small staircase icons for revealed up/down staircases.


## Revealed exits

As soon as a room is discovered, all corridors leading out of that room are shown. The connected room remains hidden until the player actually enters it.


## Minimap toggle fix

Press `M` once to open the minimap. Press `M` again or `Esc` to close it. Holding `M` no longer rapidly toggles the modal because repeated keydown events are ignored.


## Return rooms and minimap parity

- The minimap now shows the same revealed exit corridors as the main view, including corridors leading from discovered rooms into unexplored space.
- The player's current position is shown as `@` on the minimap.
- Descending a staircase records the room on the current floor. Using the up staircase returns the player to that room when the previous floor is restored.


## Deterministic loot

- Image (`<img>`) rooms contain 2–4 loot items, determined by a stable hash of the HTML node.
- Roughly 10% of other rooms contain one loot item, also determined by the node hash.
- Loot placement is deterministic for a given page/node and individual items stay collected during the app session.
- The post-coalescing room limit is now 100 rooms.


## Monsters and combat

- About 72% of eligible rooms contain monsters; the green starting room and `<img>` loot rooms never do.
- Monster count, HP (1–5), speed class, melee damage, attack cooldown, and loot-drop chance are deterministic from the room's HTML-derived hash.
- Monsters only activate when their room is revealed, then chase the player through corridors connecting revealed rooms.
- Fast monsters move about twice as quickly as slow monsters.
- The player has 10 HP. Arrow keys set facing and move; Space performs a 90-degree melee sweep in front of the player.
- Player attacks have a short cooldown; monster melee attacks have a longer deterministic cooldown.
- Slain monsters have an 18% deterministic chance to drop one loot item.
- Monster HP/death/drop state persists per page/floor for the session.


## Gun combat

- Press `Space` to fire an unlimited bullet in the direction the player is facing.
- Bullets travel through walkable rooms and doorways, stop at walls, and disappear after a maximum range.
- A bullet damages the first active monster it hits for 1 HP.
- The gun has a short fire cooldown but no ammunition limit.


## Alien-dungeon visual pass

- The astronaut, robot enemies, loot, and room props now use custom sci-fi sprite graphics rather than emoji/text glyphs.
- Every room receives 1–3 deterministic props based on the HTML-derived room hash.
- Crates, barrels, alien plants, and terminals are solid obstacles for the player, monsters, and bullets; debris is decorative only.
- The player has both a HUD health meter and an overhead health bar.
- Death records the run's loot score to browser `localStorage` and shows the top five scores.
- The death report also shows total robot kills, fast-drone kills, heavy-drone kills, and shots fired.


## Animated visual pass

- Rooms now use a cohesive alien-station floor treatment with inner shells, corner emitters, stronger doorways, and corridor lighting.
- Player movement uses four directional animation states (`up`, `down`, `left`, `right`), and firing has four matching recoil animations.
- Robot sprites animate while idle/moving, mirror naturally when moving left/right, and play a death animation before disappearing.
- Solid props have deterministic 2–5 HP and can be destroyed by repeated gunfire. Destruction plays an explosion animation and persists on that floor.
- Staircases were restyled as glowing up/down station portals.
- The two generated visual mockups are bundled in `public/assets/ui_mockup_1.png` and `public/assets/ui_mockup_2.png` as project references.


## v15 fix

- Restored the missing deterministic `lootCountForRoom()` and `lootPositions()` helpers that caused all page loads to fail.
- The default URL is now `https://blog.idorobots.org`.


## v16 directional player + larger rooms

- Added explicit player-facing sprite assets for up/down/left/right and the renderer now switches assets whenever facing changes.
- Player movement and firing animation state now uses the same directional asset, removing the previous facing/animation mismatch.
- Rooms are now 600×400 px (2× the previous dimensions), with adjusted spacing, loot positions, and prop locations.
- Entering a revealed corridor immediately reveals the connected destination room, so blocked entrances can no longer prevent discovery.
- Camera scale was adjusted for the larger rooms so the current room and portions of neighbors remain visible.


## v17 player art / explosion / medkit fix

- Replaced the up-facing player art with a new full-body **back view** astronaut asset (`player_up.svg`).
- Replaced the down-facing player art with a new full-body **front view** astronaut asset (`player_down.svg`).
- Both new assets include visible legs/boots and directionally aimed weapons while preserving the white-armor / cyan-tech visual language.
- Fixed obstacle explosions so their world-space position is not overwritten by the CSS scale/rotation animation; explosions now occur exactly where the destroyed obstacle stood.
- Health-pack loot now restores up to 5 missing HP when collected, without exceeding the 10 HP maximum.


## v18 WebCrawl UI and art pass

- The game is now branded **WebCrawl** with the tagline **Explore • Loot • Survive** and the line **The Web is deeper than you think...**
- Startup now opens on a dedicated welcome screen with flavour text and URL entry; the dungeon is not loaded until **Begin Crawl** is pressed.
- The in-game top bar shows the WebCrawl identity and the currently visited URL.
- A minimap is permanently visible in a right-side HUD alongside rooms discovered, floor, loot, kills, shots, and survival time.
- Player HP/status, loot, kills, unlimited-ammo weapon state, floor, and room count are shown in the bottom HUD.
- The `M` key still opens the larger tactical map overlay.
- Replaced the mixed player artwork with a coherent four-direction pixel-art sprite set extracted from the generated player-direction concept.
- Fixed monster death animation placement by animating the monster sprite inside its translated world-position group, matching the obstacle-explosion positioning fix.
- Bundled **7 generated UI mockups** plus the player direction reference under `public/assets/mockups/`.


## v19 HUD / stairs cleanup

- Removed duplicate loot/kills and floor/room counters from the bottom HUD; those values remain in the right-side stats panel.
- Removed the verbose map-status text from the top bar. Map diagnostics now go to the browser console.
- `M` no longer opens a separate tactical-map modal because the minimap is permanently visible in the HUD.
- Health packs now restore exactly 1 HP, capped at 10.
- Rooms can display multiple link staircases in a centered grid, with at most 10 staircases total per room. The root reserves one slot for the up/entrance staircase.


## v20 crash fix and supplied astronaut animation

- Fixed the `killsCountEl is null` crash caused by the v19 bottom-HUD cleanup.
- Fixed the same latent issue for the removed `lootCountEl`.
- Moved **THE WEB IS DEEPER THAN YOU THINK...** below the welcome URL input.
- Included the supplied astronaut sprite sheet unchanged as `public/assets/player_sprite_sheet.png`.
- Extracted 20 walk frames and 16 shooting frames into `public/assets/player_frames/`.
- The live player now uses those supplied frames for directional walking and shooting.


## v21 supplied individual astronaut frames

The player animation now uses the individual PNG assets from the supplied
`astronaut_individual_frames` pack directly. No sprite-sheet cropping is done
at runtime or during this build.

- North -> player up
- South -> player down
- East -> player right
- West -> player left
- 6 walk frames per direction
- 4 shoot frames per direction

The original asset archive is also bundled as
`public/assets/astronaut_individual_frames.zip`, and its supplied
`manifest.json` is preserved under `public/assets/player_frames/`.


## v22 half-size player rendering

- The supplied individual astronaut PNG frames are kept completely unchanged.
- The live player is rendered at exactly 50% of the supplied frame canvas size:
  150×200 source frames render at 75×100 in the game.
- Aspect ratio is preserved with `xMidYMid meet`.
- The player collision radius was reduced from 13 to 7 to better match the smaller visual size.
- Shooting recoil no longer applies any extra scale transform, so animation frames retain a consistent size and proportion.


## v23 death screen + breadth-first dungeon generation

- Restored the death/high-score modal. The crash was caused by the old death path
  touching a HUD element that no longer exists after the UI redesign; that access
  is now guarded and the modal is explicitly opened.
- DOM element selection is now breadth-first instead of depth-first, so rooms are
  populated evenly outward from the `<body>` hub.
- If a room cannot be rendered because it overlaps an existing room, that room is
  hidden but its descendants are flattened toward the nearest rendered ancestor.
- Links found anywhere inside a hidden subtree are promoted to that rendered
  ancestor, so hidden geometry no longer makes reachable URLs disappear.


## v24 BFS runtime fix

- Added the missing `collectLinks()` helper used by the breadth-first DOM
  traversal. Anchor URLs are resolved against the current page and only
  HTTP/HTTPS destinations become staircases.
- Removed the accidental call to nonexistent `coalesceDeepLeaves()`.
- The BFS generator now uses the existing `coalesceLeaves()` routine, which
  already removes the deepest surviving leaves first and promotes their links.
- Surviving graph links are rebuilt after coalescing.
