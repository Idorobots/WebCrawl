import Phaser from "phaser";
import {
  ASSETS,
  BARREL_EXPLOSION_FRAMES,
  CAMERA_BOSS_PADDING,
  CAMERA_DEADZONE_HEIGHT,
  CAMERA_DEADZONE_WIDTH,
  CAMERA_FOLLOW_LERP,
  CAMERA_SCALE,
  CAMERA_TRANSITION_MS,
  DEBRIS_ASSETS,
  EFFECT_FRAMES,
  EXPLOSION_FRAMES,
  FLOOR_ASSETS,
  LOOT_RAM_FRAMES,
  MONSTER_FRAMES,
  PLAYER_DEFAULT_ASSETS,
  PLAYER_FRAMES,
  PORTAL_FRAMES,
  SCENERY_ASSETS,
  WEAPON_ASSETS,
  WORLD_SCALE,
  world,
} from "../config";
import { WEAPON_COLORS } from "../domain/weapons";
import {
  BOSS_DEFINITIONS,
  DEFAULT_BULLET_SPEC,
  LOOT_DEFINITIONS,
  monsterHealthBarY,
  monsterVisualCenterOffsetY,
  PLAYER_SPEC,
  PORTAL_DEFINITION,
  WEAPON_PICKUP_DEFINITIONS,
  WEAPON_VISUAL_DEFINITIONS,
  WORLD_GEOMETRY,
  weaponAsset,
  type LootDefinition,
} from "../domain/specs";
import type {
  Bullet,
  Decoration,
  DungeonLayout,
  GraphNode,
  LootItem,
  LootKind,
  Monster,
  MonsterAnimation,
  Point,
  SpriteClip,
  Stair,
} from "../types";

const textureKey = (asset: string): string => `asset:${asset}`;
const SEGMENT_SIZE = WORLD_GEOMETRY.segmentSize;
const FLOOR_TILE_SIZE = WORLD_GEOMETRY.floorTileSize;
const FLOOR_TILE_SCALE = FLOOR_TILE_SIZE / 128;
const HIDDEN_WORLD_ALPHA = 0.24;
const PORTAL_FRAME_MS = 125;
const SHOW_DEBUG_GEOMETRY = import.meta.env.VITE_DEBUG_HITBOXES === "true";

function assetPaths(...sources: unknown[]): string[] {
  const paths = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.startsWith("assets/")) paths.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  sources.forEach(visit);
  return [...paths];
}

export class PhaserRenderer {
  private game: Phaser.Game | null = null;
  private scene: Phaser.Scene | null = null;
  private layout: DungeonLayout | null = null;
  private visited = new Set<number>();
  private background: Phaser.GameObjects.TileSprite | null = null;
  private staticObjects: Phaser.GameObjects.GameObject[] = [];
  private roomLayers = new Map<number, Phaser.GameObjects.Container>();
  private corridorLayers = new Map<string, Phaser.GameObjects.Container>();
  private bulletsGraphics: Phaser.GameObjects.Graphics | null = null;
  private debugGraphics: Phaser.GameObjects.Graphics | null = null;
  private decorations: Phaser.GameObjects.Container[] = [];
  private decorationSprites = new Map<string, Phaser.GameObjects.Image>();
  private objects: Phaser.GameObjects.Container[] = [];
  private lootSprites = new Map<string, Phaser.GameObjects.Image>();
  private portals = new Map<string, Phaser.GameObjects.Container>();
  private monsters = new Map<string, Phaser.GameObjects.Container>();
  private player: Phaser.GameObjects.Container | null = null;
  private playerSprite: Phaser.GameObjects.Image | null = null;
  private currentPlayer: Point = { x: 0, y: 0 };
  private currentPlayerHp = 10;
  private currentPlayerMaxHp = 10;
  private currentPlayerAsset: string = PLAYER_DEFAULT_ASSETS.right;
  private currentDecorations: readonly Decoration[] = [];
  private currentStairs: readonly Stair[] = [];
  private currentLoot: readonly LootItem[] = [];
  private currentMonsters: readonly Monster[] = [];
  private currentBullets: readonly Bullet[] = [];
  private currentLootAssets: Partial<Record<LootKind, string>> = {};
  private cameraRoom: GraphNode | null = null;
  private cameraRoomId: number | null = null;
  private playerProtectionActive = false;
  private playerProtectionTintVisible = false;

  constructor(private readonly host: HTMLElement) {}

  start(): void {
    if (this.game) return;
    this.host.dataset.debugHitboxes = String(SHOW_DEBUG_GEOMETRY);
    const renderer = this;
    class DungeonScene extends Phaser.Scene {
      constructor() {
        super("dungeon");
      }

      preload(): void {
        const assets = assetPaths(
          ASSETS,
          BARREL_EXPLOSION_FRAMES,
          DEBRIS_ASSETS,
          EFFECT_FRAMES,
          EXPLOSION_FRAMES,
          FLOOR_ASSETS,
          LOOT_RAM_FRAMES,
          MONSTER_FRAMES,
          PLAYER_DEFAULT_ASSETS,
          PLAYER_FRAMES,
          PORTAL_FRAMES,
          SCENERY_ASSETS,
          WEAPON_ASSETS,
        );
        for (const asset of assets) this.load.image(textureKey(asset), asset);
      }

      create(): void {
        renderer.attach(this);
      }
    }

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.host,
      transparent: true,
      render: { antialias: false, pixelArt: true, roundPixels: true },
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: Math.max(1, this.host.clientWidth),
        height: Math.max(1, this.host.clientHeight),
      },
      scene: DungeonScene,
    });
  }

  private attach(scene: Phaser.Scene): void {
    this.scene = scene;
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.refreshCameraForResize, this);
    this.drawWorld();
    this.renderDecorations(this.currentDecorations, this.visited);
    this.renderObjects(this.currentStairs, this.currentLoot, this.visited, this.currentLootAssets);
    this.renderMonsters(this.currentMonsters);
    this.renderBullets(this.currentBullets);
    this.setPlayer(this.currentPlayer, this.currentPlayerHp, this.currentPlayerMaxHp, this.currentPlayerAsset);
    this.applyCameraMode(true);
    this.host.dataset.debugHitboxes = String(SHOW_DEBUG_GEOMETRY);
  }

  clear(): void {
    this.layout = null;
    this.cameraRoom = null;
    this.cameraRoomId = null;
    this.scene?.cameras.main.stopFollow().setDeadzone().resetFX();
    this.background?.destroy();
    this.background = null;
    this.destroyStaticObjects();
    this.bulletsGraphics?.clear();
    this.debugGraphics?.clear();
    this.destroyAll(this.decorations);
    this.decorationSprites.clear();
    this.destroyAll(this.objects);
    this.lootSprites.clear();
    this.destroyPortalObjects();
    for (const object of this.monsters.values()) object.destroy(true);
    this.monsters.clear();
    this.player?.destroy(true);
    this.player = null;
    this.playerSprite = null;
    this.currentDecorations = [];
    this.currentStairs = [];
    this.currentLoot = [];
    this.currentMonsters = [];
    this.currentBullets = [];
    delete this.host.dataset.rooms;
    delete this.host.dataset.corridors;
    delete this.host.dataset.availableWeapons;
    delete this.host.dataset.firstWeaponX;
    delete this.host.dataset.firstWeaponY;
    delete this.host.dataset.firstWeaponKind;
    delete this.host.dataset.firstLootX;
    delete this.host.dataset.firstLootY;
    delete this.host.dataset.firstLootKind;
    delete this.host.dataset.activePortals;
    delete this.host.dataset.weaponPedestals;
    delete this.host.dataset.monsterAssets;
    delete this.host.dataset.renderedMonsters;
  }

  setWorld(layout: DungeonLayout, visited: ReadonlySet<number>): void {
    this.layout = layout;
    this.visited = new Set(visited);
    this.host.dataset.rooms = String(layout.nodes.length);
    this.host.dataset.corridors = String(layout.links.length);
    const root = layout.nodes.find(room => room.isRoot);
    const firstExit = root ? layout.links.find(link => link.source.id === root.id) : undefined;
    if (firstExit) {
      this.host.dataset.firstExit = firstExit.direction;
      this.host.dataset.firstDoorX = String(Math.round(firstExit.points[0]!.x));
      this.host.dataset.firstDoorY = String(Math.round(firstExit.points[0]!.y));
    }
    this.drawWorld();
  }

  setFog(visited: ReadonlySet<number>): void {
    this.visited = new Set(visited);
    this.updateWorldVisibility();
  }

  private drawWorld(): void {
    const scene = this.scene;
    if (!scene || !this.layout) return;
    this.background?.destroy();
    this.background = null;
    this.destroyStaticObjects();
    const worldBounds = this.layout.nodes.reduce((bounds, room) => ({
      left: Math.min(bounds.left, room.x - room.width / 2),
      right: Math.max(bounds.right, room.x + room.width / 2),
      top: Math.min(bounds.top, room.y - room.height / 2),
      bottom: Math.max(bounds.bottom, room.y + room.height / 2),
    }), {
      left: Infinity,
      right: -Infinity,
      top: Infinity,
      bottom: -Infinity,
    });
    for (const link of this.layout.links) {
      for (const point of link.points) {
        worldBounds.left = Math.min(worldBounds.left, point.x - link.width / 2);
        worldBounds.right = Math.max(worldBounds.right, point.x + link.width / 2);
        worldBounds.top = Math.min(worldBounds.top, point.y - link.width / 2);
        worldBounds.bottom = Math.max(worldBounds.bottom, point.y + link.width / 2);
      }
    }
    const pad = world(384);
    const backgroundWidth = Math.max(world(1024), worldBounds.right - worldBounds.left + pad * 2);
    const backgroundHeight = Math.max(world(1024), worldBounds.bottom - worldBounds.top + pad * 2);
    this.background = scene.add.tileSprite(
      worldBounds.left - pad,
      worldBounds.top - pad,
      backgroundWidth,
      backgroundHeight,
      textureKey(ASSETS.backgroundTechTile),
    )
      .setOrigin(0)
      .setTileScale(WORLD_SCALE)
      .setScrollFactor(1)
      .setDepth(-10);

    for (const link of this.layout.links) {
      const visible = this.visited.has(link.source.id) || this.visited.has(link.target.id);
      this.renderCorridor(link, visible ? 1 : HIDDEN_WORLD_ALPHA);
    }

    for (const room of this.layout.nodes) {
      const visible = this.visited.has(room.id);
      this.renderRoom(room, visible ? 1 : HIDDEN_WORLD_ALPHA);
    }
  }

  private updateWorldVisibility(): void {
    const layout = this.layout;
    if (!layout) return;
    for (const room of layout.nodes) {
      this.roomLayers.get(room.id)?.setAlpha(this.visited.has(room.id) ? 1 : HIDDEN_WORLD_ALPHA);
    }
    for (const link of layout.links) {
      const visible = this.visited.has(link.source.id) || this.visited.has(link.target.id);
      this.corridorLayers.get(link.id)?.setAlpha(visible ? 1 : HIDDEN_WORLD_ALPHA);
    }
  }

  private renderRoom(room: GraphNode, alpha: number): void {
    const scene = this.scene;
    if (!scene) return;
    const left = room.x - room.width / 2;
    const top = room.y - room.height / 2;
    const container = this.rememberStatic(scene.add.container(0, 0).setDepth(-2).setAlpha(alpha));
    this.roomLayers.set(room.id, container);
    const floor = scene.add.tileSprite(left, top, room.width, room.height, textureKey(this.roomFloorAsset(room)))
      .setOrigin(0)
      .setTileScale(FLOOR_TILE_SCALE);
    container.add(floor);
    this.addRoomFloorDetails(container, room);
    const doors = this.roomDoors(room);
    this.addRoomWalls(container, room, doors);
    for (const door of doors) container.add(this.createDoor(door.position, door.side));
  }

  private renderCorridor(link: DungeonLayout["links"][number], alpha: number): void {
    const scene = this.scene;
    if (!scene) return;
    const container = this.rememberStatic(scene.add.container(0, 0).setDepth(-4).setAlpha(alpha));
    this.corridorLayers.set(link.id, container);
    for (let index = 1; index < link.points.length; index += 1) {
      const start = link.points[index - 1]!;
      const end = link.points[index]!;
      container.add(this.createCorridorSegment(start, end, link.width, link.source.lootSeed + index));
    }
  }

  private roomFloorAsset(room: GraphNode): string {
    if (room.isRoot) return ASSETS.floorPlain;
    if (room.tag === "script") return ASSETS.floorHex;
    return FLOOR_ASSETS[room.lootSeed % FLOOR_ASSETS.length] ?? ASSETS.floorPlain;
  }

  private addRoomFloorDetails(
    container: Phaser.GameObjects.Container,
    room: GraphNode,
  ): void {
    const scene = this.scene!;
    const columns = Math.max(1, Math.floor(room.width / FLOOR_TILE_SIZE));
    const rows = Math.max(1, Math.floor(room.height / FLOOR_TILE_SIZE));
    const count = Math.min(5, 2 + room.lootSeed % 4);
    const occupied = new Set<string>();
    let seed = room.lootSeed >>> 0;
    for (let index = 0; index < count; index += 1) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      const column = seed % columns;
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      const row = seed % rows;
      const key = `${column}:${row}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      const asset = FLOOR_ASSETS[(room.lootSeed + index * 5) % FLOOR_ASSETS.length] ?? ASSETS.floorHatch;
      const detail = scene.add.image(
        room.x - room.width / 2 + column * FLOOR_TILE_SIZE + FLOOR_TILE_SIZE / 2,
        room.y - room.height / 2 + row * FLOOR_TILE_SIZE + FLOOR_TILE_SIZE / 2,
        textureKey(asset),
      ).setDisplaySize(FLOOR_TILE_SIZE, FLOOR_TILE_SIZE);
      container.add(detail);
    }
  }

  private createCorridorSegment(start: Point, end: Point, width: number, seed: number): Phaser.GameObjects.Container {
    const scene = this.scene!;
    const container = scene.add.container(0, 0);
    const floorAsset = FLOOR_ASSETS[Math.abs(seed) % FLOOR_ASSETS.length] ?? ASSETS.floorTread;
    if (Math.abs(start.x - end.x) >= Math.abs(start.y - end.y)) {
      const left = Math.min(start.x, end.x);
      const length = Math.abs(end.x - start.x);
      const top = start.y - width / 2;
      container.add(scene.add.tileSprite(left, top, length, width, textureKey(floorAsset)).setOrigin(0).setTileScale(FLOOR_TILE_SCALE));
      const columns = Math.round(length / SEGMENT_SIZE);
      for (let column = 0; column < columns; column += 1) {
        const x = left + (column + 0.5) * SEGMENT_SIZE;
        container.add(this.createEnvironmentModule(x, top + SEGMENT_SIZE / 2, ASSETS.wallHorizontalTop));
        container.add(this.createEnvironmentModule(x, top + width - SEGMENT_SIZE / 2, ASSETS.wallHorizontalBottom));
      }
      return container;
    }
    const top = Math.min(start.y, end.y);
    const length = Math.abs(end.y - start.y);
    const left = start.x - width / 2;
    container.add(scene.add.tileSprite(left, top, width, length, textureKey(floorAsset)).setOrigin(0).setTileScale(FLOOR_TILE_SCALE));
    const rows = Math.round(length / SEGMENT_SIZE);
    for (let row = 0; row < rows; row += 1) {
      const y = top + (row + 0.5) * SEGMENT_SIZE;
      container.add(this.createEnvironmentModule(
        left + SEGMENT_SIZE / 2,
        y,
        ASSETS.wallVerticalLeft,
      ));
      container.add(this.createEnvironmentModule(
        left + width - SEGMENT_SIZE / 2,
        y,
        ASSETS.wallVerticalRight,
      ));
    }
    return container;
  }

  private createEnvironmentModule(x: number, y: number, asset: string): Phaser.GameObjects.Image {
    return this.scene!.add.image(x, y, textureKey(asset)).setDisplaySize(SEGMENT_SIZE, SEGMENT_SIZE);
  }

  private roomDoors(room: GraphNode): Array<{ position: Point; side: "N" | "E" | "S" | "W" }> {
    const doors: Array<{ position: Point; side: "N" | "E" | "S" | "W" }> = [];
    for (const link of this.layout?.links ?? []) {
      if (link.source.id === room.id) doors.push({
        position: this.roomDoorPosition(link.points[0]!, link.direction),
        side: link.direction,
      });
      if (link.target.id === room.id) doors.push({
        position: this.roomDoorPosition(link.points[link.points.length - 1]!, this.opposite(link.direction)),
        side: this.opposite(link.direction),
      });
    }
    return doors;
  }

  private roomDoorPosition(boundary: Point, side: "N" | "E" | "S" | "W"): Point {
    const inset = SEGMENT_SIZE / 2;
    return {
      x: boundary.x + (side === "W" ? inset : side === "E" ? -inset : 0),
      y: boundary.y + (side === "N" ? inset : side === "S" ? -inset : 0),
    };
  }

  private addRoomWalls(
    container: Phaser.GameObjects.Container,
    room: GraphNode,
    doors: ReadonlyArray<{ position: Point; side: "N" | "E" | "S" | "W" }>,
  ): void {
    const left = room.x - room.width / 2;
    const top = room.y - room.height / 2;
    const columns = Math.round(room.width / SEGMENT_SIZE);
    const rows = Math.round(room.height / SEGMENT_SIZE);
    const occupied = new Map<string, Set<number>>();
    for (const door of doors) {
      const horizontal = door.side === "N" || door.side === "S";
      const axisStart = horizontal ? left : top;
      const axisPosition = horizontal ? door.position.x : door.position.y;
      const startIndex = Math.round((axisPosition - axisStart) / SEGMENT_SIZE - 1);
      const cells = occupied.get(door.side) ?? new Set<number>();
      cells.add(startIndex);
      cells.add(startIndex + 1);
      occupied.set(door.side, cells);
    }
    const isDoorCell = (side: string, index: number): boolean => occupied.get(side)?.has(index) ?? false;

    container.add(this.createEnvironmentModule(left + SEGMENT_SIZE / 2, top + SEGMENT_SIZE / 2, ASSETS.wallCornerTopLeft));
    container.add(this.createEnvironmentModule(left + room.width - SEGMENT_SIZE / 2, top + SEGMENT_SIZE / 2, ASSETS.wallCornerTopRight));
    container.add(this.createEnvironmentModule(left + SEGMENT_SIZE / 2, top + room.height - SEGMENT_SIZE / 2, ASSETS.wallCornerBottomLeft));
    container.add(this.createEnvironmentModule(left + room.width - SEGMENT_SIZE / 2, top + room.height - SEGMENT_SIZE / 2, ASSETS.wallCornerBottomRight));

    for (let column = 1; column < columns - 1; column += 1) {
      const x = left + (column + 0.5) * SEGMENT_SIZE;
      if (!isDoorCell("N", column)) container.add(this.createEnvironmentModule(x, top + SEGMENT_SIZE / 2, ASSETS.wallHorizontalTop));
      if (!isDoorCell("S", column)) container.add(this.createEnvironmentModule(x, top + room.height - SEGMENT_SIZE / 2, ASSETS.wallHorizontalBottom));
    }
    for (let row = 1; row < rows - 1; row += 1) {
      const y = top + (row + 0.5) * SEGMENT_SIZE;
      if (!isDoorCell("W", row)) container.add(this.createEnvironmentModule(left + SEGMENT_SIZE / 2, y, ASSETS.wallVerticalLeft));
      if (!isDoorCell("E", row)) container.add(this.createEnvironmentModule(left + room.width - SEGMENT_SIZE / 2, y, ASSETS.wallVerticalRight));
    }
  }

  private createDoor(position: Point, side: "N" | "E" | "S" | "W"): Phaser.GameObjects.Container {
    const scene = this.scene!;
    const container = scene.add.container(0, 0);
    const horizontal = side === "N" || side === "S";
    const asset = ({
      N: ASSETS.doorOpenTop,
      E: ASSETS.doorOpenRight,
      S: ASSETS.doorOpenBottom,
      W: ASSETS.doorOpenLeft,
    } as const)[side];
    container.add(scene.add.image(position.x, position.y, textureKey(asset)).setDisplaySize(
      horizontal ? SEGMENT_SIZE * WORLD_GEOMETRY.doorSpanSegments : SEGMENT_SIZE,
      horizontal ? SEGMENT_SIZE : SEGMENT_SIZE * WORLD_GEOMETRY.doorSpanSegments,
    ));
    return container;
  }

  private opposite(direction: "N" | "E" | "S" | "W"): "N" | "E" | "S" | "W" {
    return ({ N: "S", E: "W", S: "N", W: "E" } as const)[direction];
  }

  private rememberStatic<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.staticObjects.push(object);
    return object;
  }

  private destroyStaticObjects(): void {
    for (const object of this.staticObjects) object.destroy();
    this.staticObjects.length = 0;
    this.roomLayers.clear();
    this.corridorLayers.clear();
  }

  private clipAsset(clip: SpriteClip, elapsedMs = 0): string {
    const rawIndex = Math.max(0, Math.floor(elapsedMs / clip.frameDurationMs));
    const frameIndex = clip.loop
      ? rawIndex % clip.frames.length
      : Math.min(clip.frames.length - 1, rawIndex);
    return clip.frames[frameIndex]!;
  }

  private applyClip(
    sprite: Phaser.GameObjects.Image,
    clip: SpriteClip,
    baseSize: number,
    elapsedMs = 0,
    assetOverride?: string,
  ): void {
    const asset = assetOverride ?? this.clipAsset(clip, elapsedMs);
    const key = textureKey(asset);
    const textureChanged = this.scene?.textures.exists(key) && sprite.texture.key !== key;
    if (textureChanged) sprite.setTexture(key);
    const height = baseSize * clip.sizeScale;
    const width = height * sprite.width / sprite.height;
    if (textureChanged || sprite.displayWidth !== width || sprite.displayHeight !== height) {
      sprite.setDisplaySize(width, height);
    }
    if (sprite.originX !== clip.origin.x || sprite.originY !== clip.origin.y) {
      sprite.setOrigin(clip.origin.x, clip.origin.y);
    }
  }

  private decorationClip(item: Decoration, now: number): { clip: SpriteClip; elapsed: number } {
    if (item.destroyed && item.visual.destroyed?.length) {
      const clips = item.visual.destroyed;
      return { clip: clips[(item.visualVariant ?? 0) % clips.length]!, elapsed: 0 };
    }
    const spawn = item.visual.animations?.spawn;
    if (spawn && item.spawnAnimationStartedAt !== undefined) {
      return { clip: spawn, elapsed: Math.max(0, now - item.spawnAnimationStartedAt) };
    }
    return { clip: item.visual.normal, elapsed: 0 };
  }

  private lootClip(item: LootItem, definition?: LootDefinition): SpriteClip | null {
    if (item.kind === "weapon" || !definition?.frames?.length) return null;
    return {
      frames: definition.frames,
      frameDurationMs: definition.frameDurationMs ?? 200,
      sizeScale: 1,
      origin: { x: 0.5, y: 0.5 },
      loop: true,
    };
  }

  private lootAnimationElapsed(clip: SpriteClip, now: number): number {
    return now % (clip.frames.length * clip.frameDurationMs);
  }

  renderDecorations(items: readonly Decoration[], visited: ReadonlySet<number>): void {
    this.currentDecorations = items;
    this.host.dataset.activeSpawners = String(items.filter(item =>
      item.spawner && !item.destroyed && visited.has(item.roomId)
    ).length);
    this.host.dataset.weaponPedestals = String(items.filter(item =>
      item.kind === "weapon-pedestal" && visited.has(item.roomId)
    ).length);
    this.destroyAll(this.decorations);
    this.decorationSprites.clear();
    const scene = this.scene;
    if (!scene) return;
    for (const item of items) {
      if (!visited.has(item.roomId) || (item.destroyed && !item.visual.destroyed?.length)) continue;
      const state = this.decorationClip(item, performance.now());
      const sprite = scene.add.image(0, 0, textureKey(this.clipAsset(state.clip, state.elapsed)));
      this.applyClip(sprite, state.clip, item.size, state.elapsed);
      const container = scene.add.container(item.x, item.y, [sprite]).setDepth(item.destroyed ? 18 : 20);
      this.decorationSprites.set(item.id, sprite);
      if (item.destructible && !item.destroyed && item.hp != item.maxHp) {
        const barWidth = Math.max(world(44), item.size * 0.62);
        const barY = -item.size * state.clip.origin.y - world(8);
        const bg = scene.add.rectangle(-barWidth / 2, barY, barWidth, world(5), 0x071018).setOrigin(0, 0.5);
        const hp = scene.add.rectangle(
          -barWidth / 2,
          barY,
          barWidth * Math.max(0, item.hp) / Math.max(1, item.maxHp),
          world(5),
          0x62e6c8,
        ).setOrigin(0, 0.5);
        container.add([bg, hp]);
      }
      this.decorations.push(container);
    }
    this.renderDebugGeometry();
  }

  updateDecorationAnimations(items: readonly Decoration[], now: number): void {
    for (const item of items) {
      if (item.spawnAnimationStartedAt === undefined) continue;
      const sprite = this.decorationSprites.get(item.id);
      if (!sprite) continue;
      const state = this.decorationClip(item, now);
      this.applyClip(sprite, state.clip, item.size, state.elapsed);
    }
  }

  renderObjects(
    stairs: readonly Stair[],
    loot: readonly LootItem[],
    visited: ReadonlySet<number>,
    lootAssets: Partial<Record<LootKind, string>>,
  ): void {
    this.currentStairs = stairs;
    this.currentLoot = loot;
    this.currentLootAssets = lootAssets;
    const visibleItems = loot.filter(item => visited.has(item.roomId));
    const byDistance = (left: LootItem, right: LootItem): number =>
      Math.hypot(left.x - this.currentPlayer.x, left.y - this.currentPlayer.y) -
      Math.hypot(right.x - this.currentPlayer.x, right.y - this.currentPlayer.y);
    const visibleWeapon = visibleItems
      .filter(item => item.kind === "weapon" && item.weapon)
      .sort(byDistance)[0];
    const visibleLoot = visibleItems
      .filter(item => item.kind !== "weapon")
      .sort(byDistance)[0];
    this.host.dataset.availableWeapons = String(visibleItems.filter(item => item.kind === "weapon").length);
    if (visibleWeapon?.weapon) {
      this.host.dataset.firstWeaponX = String(Math.round(visibleWeapon.x));
      this.host.dataset.firstWeaponY = String(Math.round(visibleWeapon.y));
      this.host.dataset.firstWeaponKind = visibleWeapon.weapon.kind;
    } else {
      delete this.host.dataset.firstWeaponX;
      delete this.host.dataset.firstWeaponY;
      delete this.host.dataset.firstWeaponKind;
    }
    if (visibleLoot) {
      this.host.dataset.firstLootX = String(Math.round(visibleLoot.x));
      this.host.dataset.firstLootY = String(Math.round(visibleLoot.y));
      this.host.dataset.firstLootKind = visibleLoot.kind;
    } else {
      delete this.host.dataset.firstLootX;
      delete this.host.dataset.firstLootY;
      delete this.host.dataset.firstLootKind;
    }
    this.destroyAll(this.objects);
    this.lootSprites.clear();
    this.syncPortals(stairs, visited);
    const scene = this.scene;
    if (!scene) return;
    for (const item of loot) {
      if (!visited.has(item.roomId)) continue;
      if (item.kind === "weapon" && item.weapon) {
        const definition = WEAPON_PICKUP_DEFINITIONS[item.weaponPlacement ?? "floor"];
        const visual = WEAPON_VISUAL_DEFINITIONS[item.weapon.kind];
        const yOffset = item.weaponPlacement === "pedestal"
          ? visual.pedestalYOffset
          : definition.yOffset;
        const sprite = scene.add.image(0, yOffset, textureKey(weaponAsset(item.weapon.kind)))
          .setDisplaySize(definition.size, definition.size)
          .setOrigin(visual.origin.x, visual.origin.y);
        this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(25));
        continue;
      }
      const definition = item.kind === "weapon" ? undefined : LOOT_DEFINITIONS[item.kind];
      const asset = definition?.asset ?? lootAssets[item.kind];
      if (!asset || !definition) continue;
      const clip = this.lootClip(item, definition);
      if (clip) {
        const elapsed = this.lootAnimationElapsed(clip, performance.now());
        const sprite = scene.add.image(0, 0, textureKey(this.clipAsset(clip, elapsed)));
        this.applyClip(sprite, clip, definition.size, elapsed);
        this.lootSprites.set(item.id, sprite);
        this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(25));
        continue;
      }
      const sprite = scene.add.image(0, 0, textureKey(asset)).setDisplaySize(definition.size, definition.size);
      this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(25));
    }
  }

  updateLootAnimations(items: readonly LootItem[], now: number): void {
    for (const item of items) {
      const sprite = this.lootSprites.get(item.id);
      if (!sprite) continue;
      const definition = item.kind === "weapon" ? undefined : LOOT_DEFINITIONS[item.kind];
      const clip = this.lootClip(item, definition);
      if (!clip || !definition) continue;
      this.applyClip(sprite, clip, definition.size, this.lootAnimationElapsed(clip, now));
    }
  }

  private syncPortals(stairs: readonly Stair[], visited: ReadonlySet<number>): void {
    const visible = new Set(stairs.filter(stair => visited.has(stair.roomId)).map(stair => stair.id));
    this.host.dataset.activePortals = String(visible.size);
    const scene = this.scene;
    if (!scene) return;
    for (const [id, container] of this.portals) {
      if (visible.has(id)) continue;
      container.destroy(true);
      this.portals.delete(id);
    }

    for (const stair of stairs) {
      if (!visible.has(stair.id)) continue;
      let container = this.portals.get(stair.id);
      if (!container) {
        const sprite = scene.add.image(0, 0, textureKey(PORTAL_DEFINITION.frames[stair.type][0]))
          .setDisplaySize(PORTAL_DEFINITION.size, PORTAL_DEFINITION.size)
          .setOrigin(PORTAL_DEFINITION.origin.x, PORTAL_DEFINITION.origin.y)
          .setName("sprite");
        container = scene.add.container(stair.x, stair.y, [sprite]).setDepth(24);
        container.setData("enabled", false);
        container.setData("animationToken", 0);
        this.portals.set(stair.id, container);
        this.animatePortal(container, stair.type, stair.enabled, true);
        continue;
      }
      container.setPosition(stair.x, stair.y);
      if (Boolean(container.getData("enabled")) !== stair.enabled) {
        this.animatePortal(container, stair.type, stair.enabled, false);
      }
    }
  }

  private animatePortal(
    container: Phaser.GameObjects.Container,
    type: Stair["type"],
    enabled: boolean,
    initial: boolean,
  ): void {
    const scene = this.scene!;
    const sprite = container.getByName("sprite") as Phaser.GameObjects.Image;
    const frames = PORTAL_DEFINITION.frames[type];
    const token = Number(container.getData("animationToken") ?? 0) + 1;
    container.setData("animationToken", token);
    container.setData("enabled", enabled);
    container.setAlpha(enabled ? 1 : 0.78);
    if (initial && !enabled) {
      sprite.setTexture(textureKey(frames[0]))
        .setDisplaySize(PORTAL_DEFINITION.size, PORTAL_DEFINITION.size)
        .setOrigin(PORTAL_DEFINITION.origin.x, PORTAL_DEFINITION.origin.y);
      return;
    }
    const sequence = enabled ? frames : [...frames].reverse();
    sequence.forEach((asset, index) => {
      scene.time.delayedCall(index * PORTAL_FRAME_MS, () => {
        if (!container.active || Number(container.getData("animationToken")) !== token) return;
        sprite.setTexture(textureKey(asset))
          .setDisplaySize(PORTAL_DEFINITION.size, PORTAL_DEFINITION.size)
          .setOrigin(PORTAL_DEFINITION.origin.x, PORTAL_DEFINITION.origin.y);
      });
    });
  }

  renderMonsters(items: readonly Monster[]): void {
    this.currentMonsters = items;
    this.host.dataset.activeMonsters = String(items.filter(item => item.active && !item.dead).length);
    this.host.dataset.activeBosses = String(items.filter(item => item.active && item.bossKind && !item.dead).length);
    const activeBoss = items.find(item => item.active && item.bossKind && !item.dead);
    if (activeBoss?.bossKind) {
      this.host.dataset.activeBossKind = activeBoss.bossKind;
      this.host.dataset.activeBossX = String(Math.round(activeBoss.x));
      this.host.dataset.activeBossY = String(Math.round(activeBoss.y));
      this.host.dataset.activeBossRoom = String(activeBoss.roomId);
      const arena = this.layout?.nodes.find(room => room.id === activeBoss.spawnRoomId);
      if (arena) {
        this.host.dataset.activeBossArenaLeft = String(arena.x - arena.width / 2 + activeBoss.radius);
        this.host.dataset.activeBossArenaRight = String(arena.x + arena.width / 2 - activeBoss.radius);
        this.host.dataset.activeBossArenaTop = String(arena.y - arena.height / 2 + activeBoss.radius);
        this.host.dataset.activeBossArenaBottom = String(arena.y + arena.height / 2 - activeBoss.radius);
      }
    } else {
      delete this.host.dataset.activeBossKind;
      delete this.host.dataset.activeBossX;
      delete this.host.dataset.activeBossY;
      delete this.host.dataset.activeBossRoom;
      delete this.host.dataset.activeBossArenaLeft;
      delete this.host.dataset.activeBossArenaRight;
      delete this.host.dataset.activeBossArenaTop;
      delete this.host.dataset.activeBossArenaBottom;
      delete this.host.dataset.activeBossDisplayWidth;
      delete this.host.dataset.activeBossDisplayHeight;
    }
    const scene = this.scene;
    if (!scene) return;
    const visibleIds = new Set(items.filter(item =>
      item.active && (!item.dead || item.deathAnimating || Boolean(item.visual.destroyed?.length))
    ).map(item => item.id));
    for (const [id, object] of this.monsters) {
      if (!visibleIds.has(id)) {
        object.destroy(true);
        this.monsters.delete(id);
      }
    }
    for (const item of items) {
      if (!visibleIds.has(item.id)) continue;
      let container = this.monsters.get(item.id);
      if (container && Boolean(container.getData("dead")) !== item.dead) {
        container.destroy(true);
        this.monsters.delete(item.id);
        container = undefined;
      }
      if (!container) {
        const frame = this.monsterFrame(item, performance.now());
        const assetKey = textureKey(frame.asset);
        const sprite = scene.add.image(0, 0, assetKey)
          .setName("sprite");
        this.applyClip(sprite, frame.clip, item.size, frame.elapsed);
        const barWidth = item.bossKind ? item.size * 0.68 : item.size * 0.6;
        const barY = monsterHealthBarY(item.size, item.visualKind);
        const children: Phaser.GameObjects.GameObject[] = [sprite];
        if (item.bossKind && !item.dead) {
          const color = BOSS_DEFINITIONS[item.bossKind].color;
          children.unshift(scene.add.circle(
            0,
            monsterVisualCenterOffsetY(item.size, item.visualKind),
            item.radius + world(11),
            color,
            0.16,
          )
            .setStrokeStyle(world(3), color, 0.8));
        }
        if (!item.dead) {
          children.push(scene.add.rectangle(-barWidth / 2, barY, barWidth, item.bossKind ? world(9) : world(5), 0x071018).setOrigin(0, 0.5));
          children.push(scene.add.rectangle(-barWidth / 2, barY, barWidth, item.bossKind ? world(7) : world(5), item.bossKind ? 0xf09cff : item.kind === "sentry" ? 0xc07cff : 0xff6b6b).setOrigin(0, 0.5).setName("hp"));
        }
        if (item.bossKind && !item.dead) {
          children.push(scene.add.text(0, barY - world(9), BOSS_DEFINITIONS[item.bossKind].label, {
            color: "#f7ddff", fontSize: `${world(11)}px`, fontStyle: "bold",
          }).setOrigin(0.5));
        }
        container = scene.add.container(item.x, item.y, children).setDepth(item.dead ? 18 : 30);
        container.setData("hpWidth", barWidth);
        container.setData("dead", item.dead);
        this.monsters.set(item.id, container);
      }
      container.setPosition(item.x, item.y);
      const sprite = container.getByName("sprite") as Phaser.GameObjects.Image;
      this.applyMonsterFrame(sprite, item, performance.now());
      const hp = container.getByName("hp") as Phaser.GameObjects.Rectangle | null;
      if (hp) hp.width = Number(container.getData("hpWidth") ?? world(40)) * Math.max(0, item.hp) / Math.max(1, item.maxHp);
      if (item === activeBoss) {
        this.host.dataset.activeBossDisplayWidth = String(sprite.displayWidth);
        this.host.dataset.activeBossDisplayHeight = String(sprite.displayHeight);
      }
    }
    this.updateMonsterAssetDataset();
    this.renderDebugGeometry();
  }

  updateMonsterPositions(items: readonly Monster[]): void {
    let assetChanged = false;
    const now = performance.now();
    for (const item of items) {
      const container = this.monsters.get(item.id);
      if (!container) continue;
      container.setPosition(item.x, item.y);
      const sprite = container.getByName("sprite") as Phaser.GameObjects.Image;
      const previousAsset = sprite.texture.key;
      this.applyMonsterFrame(sprite, item, now);
      assetChanged ||= previousAsset !== sprite.texture.key;
      const hp = container.getByName("hp") as Phaser.GameObjects.Rectangle | null;
      if (hp) hp.width = Number(container.getData("hpWidth") ?? world(40)) * Math.max(0, item.hp) / Math.max(1, item.maxHp);
      if (item.bossKind && item.active && !item.dead) {
        this.setHostData("activeBossX", String(Math.round(item.x)));
        this.setHostData("activeBossY", String(Math.round(item.y)));
        this.setHostData("activeBossDisplayWidth", String(sprite.displayWidth));
        this.setHostData("activeBossDisplayHeight", String(sprite.displayHeight));
      }
    }
    if (assetChanged) this.updateMonsterAssetDataset();
    this.renderDebugGeometry();
  }

  private updateMonsterAssetDataset(): void {
    this.setHostData("renderedMonsters", String(this.monsters.size));
    this.setHostData("monsterAssets", [...this.monsters.values()].flatMap(container => {
      const sprite = container.getByName("sprite") as Phaser.GameObjects.Image | null;
      return sprite ? [sprite.texture.key.replace(/^asset:/, "")] : [];
    }).join(","));
  }

  private applyMonsterFrame(sprite: Phaser.GameObjects.Image, item: Monster, now: number): void {
    const frame = this.monsterFrame(item, now);
    this.applyClip(sprite, frame.clip, item.size, frame.elapsed);
  }

  private monsterFrame(item: Monster, now: number): { asset: string; animation: MonsterAnimation; clip: SpriteClip; elapsed: number } {
    if (item.dead && item.visual.destroyed?.length) {
      const clip = item.visual.destroyed[item.seed % item.visual.destroyed.length]!;
      return { asset: clip.frames[0]!, animation: "normal", clip, elapsed: 0 };
    }
    const direction = item.moveDir ?? "down";
    const visual = item.visual.directions[direction] ?? item.visual.directions.down!;
    const attackElapsed = now - item.lastAttackAt;
    const attackAnimation = item.attackKind ?? "melee";
    const attackClip = visual[attackAnimation];
    if (attackClip && attackElapsed >= 0 && attackElapsed < attackClip.frames.length * attackClip.frameDurationMs) {
      return { asset: this.clipAsset(attackClip, attackElapsed), animation: attackAnimation, clip: attackClip, elapsed: attackElapsed };
    }
    if (item.moving && visual.walk) {
      return { asset: this.clipAsset(visual.walk, now), animation: "walk", clip: visual.walk, elapsed: now };
    }
    return { asset: visual.normal.frames[0]!, animation: "normal", clip: visual.normal, elapsed: 0 };
  }

  renderBullets(items: readonly Bullet[]): void {
    this.currentBullets = items;
    this.setHostData("bullets", String(items.length));
    if (!this.scene) return;
    this.bulletsGraphics ??= this.scene.add.graphics().setDepth(40);
    this.bulletsGraphics.clear();
    for (const bullet of items) {
      const color = bullet.style === "shockwave"
        ? 0xffa34d
        : bullet.style === "boss"
          ? 0xee78ff
          : bullet.owner === "enemy"
            ? 0xff596e
            : bullet.weaponKind
              ? WEAPON_COLORS[bullet.weaponKind]
              : 0x86fff0;
      this.bulletsGraphics.fillStyle(color, 1);
      this.bulletsGraphics.fillCircle(bullet.x, bullet.y, bullet.radius ?? DEFAULT_BULLET_SPEC.radius);
    }
    this.renderDebugGeometry();
  }

  setPlayer(position: Point, hp: number, maxHp: number, asset: string): void {
    this.currentPlayer.x = position.x;
    this.currentPlayer.y = position.y;
    this.currentPlayerHp = hp;
    this.currentPlayerMaxHp = maxHp;
    this.currentPlayerAsset = asset;
    this.setHostData("playerAsset", asset);
    this.setHostData("playerX", String(Math.round(position.x)));
    this.setHostData("playerY", String(Math.round(position.y)));
    const scene = this.scene;
    if (!scene) return;
    const clip = this.playerClipForAsset(asset);
    if (!this.player) {
      this.playerSprite = scene.add.image(0, 0, textureKey(asset))
        .setOrigin(clip.origin.x, clip.origin.y);
      this.applyClip(this.playerSprite, clip, PLAYER_SPEC.spriteSize, 0, asset);
      this.player = scene.add.container(position.x, position.y, [this.playerSprite]).setDepth(50);
    }
    this.player.setPosition(position.x, position.y);
    if (scene.textures.exists(textureKey(asset))) this.playerSprite!.setTexture(textureKey(asset));
    this.applyClip(this.playerSprite!, clip, PLAYER_SPEC.spriteSize, 0, asset);
    this.applyPlayerProtectionTint();
    this.renderDebugGeometry();
  }

  setPlayerProtection(active: boolean, tintVisible: boolean): void {
    this.playerProtectionActive = active;
    this.playerProtectionTintVisible = tintVisible;
    this.setHostData("playerInvulnerable", String(active));
    this.setHostData("playerProtectionTinted", String(active && tintVisible));
    this.applyPlayerProtectionTint();
  }

  private applyPlayerProtectionTint(): void {
    if (!this.playerSprite) return;
    if (this.playerProtectionActive && this.playerProtectionTintVisible) this.playerSprite.setTint(0x78ff9b);
    else this.playerSprite.clearTint();
  }

  private renderDebugGeometry(): void {
    if (!SHOW_DEBUG_GEOMETRY || !this.scene) return;
    const graphics = this.debugGraphics ??= this.scene.add.graphics().setDepth(70);
    graphics.clear();
    graphics.lineStyle(world(1), 0x69f7de, 0.9);
    graphics.strokeCircle(this.currentPlayer.x, this.currentPlayer.y + PLAYER_SPEC.visualCenterOffsetY, PLAYER_SPEC.radius);
    for (const monster of this.currentMonsters) {
      if (!monster.active || monster.dead) continue;
      graphics.lineStyle(world(1), 0xff5c77, 0.9);
      graphics.strokeCircle(
        monster.x,
        monster.y + monsterVisualCenterOffsetY(monster.size, monster.visualKind),
        monster.radius,
      );
    }
    for (const item of this.currentDecorations) {
      if (item.destroyed) continue;
      if (item.destructible && item.radius) {
        graphics.lineStyle(world(1), 0x8cf6ff, 0.85);
        graphics.strokeCircle(item.x, item.y + item.hitOffsetY, item.radius);
      }
      if (item.obstacle && item.footprint) {
        graphics.lineStyle(world(1), 0xffbd5d, 0.85);
        graphics.strokeCircle(item.x, item.y, item.footprint);
      }
    }
    graphics.lineStyle(world(1), 0xf8ef77, 0.9);
    for (const bullet of this.currentBullets) {
      graphics.strokeCircle(bullet.x, bullet.y, bullet.radius ?? DEFAULT_BULLET_SPEC.radius);
    }
  }

  setPlayerAsset(asset: string): void {
    this.currentPlayerAsset = asset;
    this.setHostData("playerAsset", asset);
    if (this.playerSprite && this.scene?.textures.exists(textureKey(asset))) {
      this.playerSprite.setTexture(textureKey(asset));
      this.applyClip(this.playerSprite, this.playerClipForAsset(asset), PLAYER_SPEC.spriteSize, 0, asset);
      this.applyPlayerProtectionTint();
    }
  }

  private setHostData(key: string, value: string): void {
    if (this.host.dataset[key] !== value) this.host.dataset[key] = value;
  }

  private playerClipForAsset(asset: string): SpriteClip {
    for (const directional of Object.values(PLAYER_SPEC.visual.directions)) {
      for (const clip of [directional.normal, directional.walk]) {
        if (clip?.frames.includes(asset)) return clip;
      }
    }
    return PLAYER_SPEC.visual.directions.down!.normal;
  }

  spawnEffect(clip: SpriteClip | undefined, x: number, y: number, baseSize: number): void {
    const scene = this.scene;
    if (!scene || !clip?.frames.length) return;
    const effect = scene.add.image(x, y, textureKey(clip.frames[0]!)).setDepth(55);
    this.applyClip(effect, clip, baseSize);
    let frameIndex = 0;
    scene.time.addEvent({
      delay: clip.frameDurationMs,
      repeat: clip.frames.length - 1,
      callback: () => {
        if (frameIndex >= clip.frames.length - 1) {
          effect.destroy();
          return;
        }
        frameIndex += 1;
        this.applyClip(effect, clip, baseSize, frameIndex * clip.frameDurationMs);
      },
    });
  }

  setCameraRoom(room: GraphNode | null, immediate = false): void {
    const bossRoom = room?.tag === "script" ? room : null;
    const nextRoomId = bossRoom?.id ?? null;
    this.cameraRoom = bossRoom;
    if (!immediate && nextRoomId === this.cameraRoomId) return;
    this.cameraRoomId = nextRoomId;
    this.applyCameraMode(immediate);
  }

  private applyCameraMode(immediate: boolean): void {
    const camera = this.scene?.cameras.main;
    if (!camera || !this.player) return;
    camera.resetFX();
    if (this.cameraRoom) {
      const zoom = this.bossRoomZoom(camera, this.cameraRoom);
      camera.stopFollow().setDeadzone();
      if (immediate) {
        camera.setZoom(zoom).centerOn(this.cameraRoom.x, this.cameraRoom.y);
      } else {
        camera.pan(this.cameraRoom.x, this.cameraRoom.y, CAMERA_TRANSITION_MS, "Sine.easeInOut", true);
        camera.zoomTo(zoom, CAMERA_TRANSITION_MS, "Sine.easeInOut", true);
      }
      return;
    }

    camera.startFollow(this.player, false, CAMERA_FOLLOW_LERP, CAMERA_FOLLOW_LERP);
    camera.setDeadzone(CAMERA_DEADZONE_WIDTH, CAMERA_DEADZONE_HEIGHT);
    if (immediate) {
      camera.setZoom(CAMERA_SCALE).centerOn(this.player.x, this.player.y);
    } else {
      camera.zoomTo(CAMERA_SCALE, CAMERA_TRANSITION_MS, "Sine.easeInOut", true);
    }
  }

  private bossRoomZoom(camera: Phaser.Cameras.Scene2D.Camera, room: GraphNode): number {
    return Math.min(
      CAMERA_SCALE,
      camera.width / (room.width + CAMERA_BOSS_PADDING * 2),
      camera.height / (room.height + CAMERA_BOSS_PADDING * 2),
    );
  }

  private refreshCameraForResize(): void {
    if (!this.cameraRoom) return;
    this.applyCameraMode(true);
  }

  worldPointAt(clientX: number, clientY: number): Point | null {
    const bounds = this.host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const camera = this.scene?.cameras.main;
    if (!camera) {
      return {
        x: this.currentPlayer.x + (clientX - bounds.left - bounds.width / 2) / CAMERA_SCALE,
        y: this.currentPlayer.y + (clientY - bounds.top - bounds.height / 2) / CAMERA_SCALE,
      };
    }
    const x = (clientX - bounds.left) * camera.width / bounds.width;
    const y = (clientY - bounds.top) * camera.height / bounds.height;
    const point = camera.getWorldPoint(x, y);
    return { x: point.x, y: point.y };
  }

  cameraState(): { x: number; y: number; zoom: number; bossRoomId: number | null } | null {
    const camera = this.scene?.cameras.main;
    if (!camera) return null;
    return {
      x: camera.midPoint.x,
      y: camera.midPoint.y,
      zoom: camera.zoom,
      bossRoomId: this.cameraRoomId,
    };
  }

  viewportSize(): { width: number; height: number } {
    return { width: Math.max(1, this.host.clientWidth), height: Math.max(1, this.host.clientHeight) };
  }

  private destroyAll(objects: Phaser.GameObjects.Container[]): void {
    for (const object of objects) object.destroy(true);
    objects.length = 0;
  }

  private destroyPortalObjects(): void {
    for (const object of this.portals.values()) object.destroy(true);
    this.portals.clear();
  }
}
