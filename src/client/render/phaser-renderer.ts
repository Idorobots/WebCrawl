import Phaser from "phaser";
import {
  ASSETS,
  BARREL_EXPLOSION_FRAMES,
  CAMERA_SCALE,
  DEBRIS_ASSETS,
  EFFECT_FRAMES,
  EXPLOSION_FRAMES,
  FLOOR_ASSETS,
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
const TILE_SIZE = WORLD_GEOMETRY.tileSize;
const WALL_THICKNESS = WORLD_GEOMETRY.wallThickness;
const HIDDEN_WORLD_ALPHA = 0.24;
const PORTAL_FRAME_MS = 125;
const SHOW_DEBUG_GEOMETRY = import.meta.env.VITE_DEBUG_HITBOXES === "true";

interface WallTileDefinition {
  asset: string;
  crop?: { x: number; y: number; width: number; height: number };
}

const HORIZONTAL_WALL_TILES: readonly WallTileDefinition[] = [
  { asset: ASSETS.wallPlainHorizontal, crop: { x: 23, y: 96, width: 209, height: 64 } },
  { asset: ASSETS.wallBrokenHorizontal, crop: { x: 21, y: 95, width: 214, height: 66 } },
];

const VERTICAL_WALL_TILES: readonly WallTileDefinition[] = [
  { asset: ASSETS.wallPlainVertical, crop: { x: 96, y: 44, width: 64, height: 167 } },
];

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
  private portals = new Map<string, Phaser.GameObjects.Container>();
  private monsters = new Map<string, Phaser.GameObjects.Container>();
  private player: Phaser.GameObjects.Container | null = null;
  private playerSprite: Phaser.GameObjects.Image | null = null;
  private currentPlayer: Point = { x: 0, y: 0 };
  private currentPlayerHp = 10;
  private currentPlayerMaxHp = 10;
  private currentPlayerAsset: string = PLAYER_DEFAULT_ASSETS.right;
  private currentDecorations: Decoration[] = [];
  private currentStairs: Stair[] = [];
  private currentLoot: LootItem[] = [];
  private currentMonsters: Monster[] = [];
  private currentBullets: Bullet[] = [];
  private currentLootAssets: Partial<Record<LootKind, string>> = {};

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
    scene.cameras.main.setZoom(CAMERA_SCALE);
    this.drawWorld();
    this.renderDecorations(this.currentDecorations, this.visited);
    this.renderObjects(this.currentStairs, this.currentLoot, this.visited, this.currentLootAssets);
    this.renderMonsters(this.currentMonsters);
    this.renderBullets(this.currentBullets);
    this.setPlayer(this.currentPlayer, this.currentPlayerHp, this.currentPlayerMaxHp, this.currentPlayerAsset);
    this.centerCamera(this.currentPlayer);
    this.host.dataset.debugHitboxes = String(SHOW_DEBUG_GEOMETRY);
  }

  clear(): void {
    this.layout = null;
    this.background?.destroy();
    this.background = null;
    this.destroyStaticObjects();
    this.bulletsGraphics?.clear();
    this.debugGraphics?.clear();
    this.destroyAll(this.decorations);
    this.decorationSprites.clear();
    this.destroyAll(this.objects);
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
      .setTileScale(WORLD_SCALE);
    const maskGraphics = this.rememberStatic(scene.add.graphics().setVisible(false));
    maskGraphics.fillStyle(0xffffff, 1);
    this.drawRoom(maskGraphics, room, false);
    const mask = maskGraphics.createGeometryMask();
    floor.setMask(mask);
    container.add(floor);
    this.addRoomFloorDetails(container, room, mask);
    if (room.shape === "capsule" || room.shape === "octagon") this.addShapedWallFrame(container, room);
    else this.addWallFrame(container, left, top, room.width, room.height, room.lootSeed);
    for (const link of this.layout?.links ?? []) {
      if (link.source.id === room.id) container.add(this.createDoor(link.points[0]!, link.direction));
      if (link.target.id === room.id) container.add(this.createDoor(link.points[link.points.length - 1]!, this.opposite(link.direction)));
    }
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
    for (let index = 1; index < link.points.length - 1; index += 1) {
      container.add(this.createCorridorJunction(link.points[index]!, link.width));
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
    mask: Phaser.Display.Masks.GeometryMask,
  ): void {
    const scene = this.scene!;
    const columns = Math.max(1, Math.floor(room.width / TILE_SIZE));
    const rows = Math.max(1, Math.floor(room.height / TILE_SIZE));
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
        room.x - room.width / 2 + column * TILE_SIZE + TILE_SIZE / 2,
        room.y - room.height / 2 + row * TILE_SIZE + TILE_SIZE / 2,
        textureKey(asset),
      ).setDisplaySize(TILE_SIZE, TILE_SIZE).setMask(mask);
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
      container.add(scene.add.tileSprite(left, top, length, width, textureKey(floorAsset)).setOrigin(0).setTileScale(WORLD_SCALE));
      container.add(this.createWallTile(left, top, length, WALL_THICKNESS, seed, false).setOrigin(0));
      container.add(this.createWallTile(left, top + width - WALL_THICKNESS, length, WALL_THICKNESS, seed + 1, false).setOrigin(0));
      return container;
    }
    const top = Math.min(start.y, end.y);
    const length = Math.abs(end.y - start.y);
    const left = start.x - width / 2;
    container.add(scene.add.tileSprite(left, top, width, length, textureKey(floorAsset)).setOrigin(0).setTileScale(WORLD_SCALE));
    container.add(this.createWallTile(left, top, WALL_THICKNESS, length, seed, true).setOrigin(0));
    container.add(this.createWallTile(left + width - WALL_THICKNESS, top, WALL_THICKNESS, length, seed + 1, true).setOrigin(0));
    return container;
  }

  private createCorridorJunction(point: Point, width: number): Phaser.GameObjects.Container {
    const scene = this.scene!;
    const left = point.x - width / 2;
    const top = point.y - width / 2;
    const container = scene.add.container(0, 0);
    container.add(scene.add.tileSprite(left, top, width, width, textureKey(ASSETS.floorPlate)).setOrigin(0).setTileScale(WORLD_SCALE));
    return container;
  }

  private wallAsset(seed: number, vertical: boolean): WallTileDefinition {
    const assets = vertical ? VERTICAL_WALL_TILES : HORIZONTAL_WALL_TILES;
    return assets[Math.abs(seed) % assets.length] ?? assets[0]!;
  }

  private createWallTile(
    x: number,
    y: number,
    width: number,
    height: number,
    seed: number,
    vertical: boolean,
  ): Phaser.GameObjects.TileSprite {
    const definition = this.wallAsset(seed, vertical);
    const key = textureKey(definition.asset);
    let frame: string | undefined;
    if (definition.crop) {
      const { x: cropX, y: cropY, width: cropWidth, height: cropHeight } = definition.crop;
      frame = `wall:${cropX}:${cropY}:${cropWidth}:${cropHeight}`;
      const texture = this.scene!.textures.get(key);
      if (!texture.has(frame)) texture.add(frame, 0, cropX, cropY, cropWidth, cropHeight);
    }
    return this.scene!.add.tileSprite(x, y, width, height, key, frame).setTileScale(WORLD_SCALE);
  }

  private addWallFrame(
    container: Phaser.GameObjects.Container,
    left: number,
    top: number,
    width: number,
    height: number,
    seed: number,
  ): void {
    const innerWidth = Math.max(0, width - TILE_SIZE * 2);
    const innerHeight = Math.max(0, height - TILE_SIZE * 2);
    if (innerWidth > 0) {
      container.add(this.createWallTile(left + TILE_SIZE, top, innerWidth, WALL_THICKNESS, seed, false).setOrigin(0));
      container.add(this.createWallTile(left + TILE_SIZE, top + height - WALL_THICKNESS, innerWidth, WALL_THICKNESS, seed + 1, false).setOrigin(0));
    }
    if (innerHeight > 0) {
      container.add(this.createWallTile(left, top + TILE_SIZE, WALL_THICKNESS, innerHeight, seed + 2, true).setOrigin(0));
      container.add(this.createWallTile(left + width - WALL_THICKNESS, top + TILE_SIZE, WALL_THICKNESS, innerHeight, seed + 3, true).setOrigin(0));
    }
    this.addCorner(container, left, top, 0);
    this.addCorner(container, left + width - TILE_SIZE, top, Math.PI / 2);
    this.addCorner(container, left, top + height - TILE_SIZE, -Math.PI / 2);
    this.addCorner(container, left + width - TILE_SIZE, top + height - TILE_SIZE, Math.PI);
  }

  private addCorner(container: Phaser.GameObjects.Container, left: number, top: number, rotation: number): void {
    const corner = this.scene!.add.image(
      left + TILE_SIZE / 2,
      top + TILE_SIZE / 2,
      textureKey(ASSETS.wallCorner),
    ).setDisplaySize(TILE_SIZE, TILE_SIZE).setOrigin(0.5).setRotation(rotation);
    container.add(corner);
  }

  private addShapedWallFrame(container: Phaser.GameObjects.Container, room: GraphNode): void {
    const points = this.roomBoundaryPoints(room);
    for (let index = 0; index < points.length; index += 1) {
      this.addWallSegment(container, points[index]!, points[(index + 1) % points.length]!, room.lootSeed + index);
    }
  }

  private roomBoundaryPoints(room: GraphNode): Point[] {
    const left = room.x - room.width / 2;
    const right = room.x + room.width / 2;
    const top = room.y - room.height / 2;
    const bottom = room.y + room.height / 2;
    if (room.shape === "octagon") {
      const cut = Math.min(room.width, room.height) * 0.18;
      return [
        { x: left + cut, y: top }, { x: right - cut, y: top },
        { x: right, y: top + cut }, { x: right, y: bottom - cut },
        { x: right - cut, y: bottom }, { x: left + cut, y: bottom },
        { x: left, y: bottom - cut }, { x: left, y: top + cut },
      ];
    }

    const radius = Math.min(room.width, room.height) / 2;
    const steps = 8;
    const points: Point[] = [];
    if (room.width >= room.height) {
      const rightCenter = { x: right - radius, y: room.y };
      const leftCenter = { x: left + radius, y: room.y };
      for (let index = 0; index <= steps; index += 1) {
        const angle = -Math.PI / 2 + Math.PI * index / steps;
        points.push({ x: rightCenter.x + Math.cos(angle) * radius, y: rightCenter.y + Math.sin(angle) * radius });
      }
      for (let index = 0; index <= steps; index += 1) {
        const angle = Math.PI / 2 + Math.PI * index / steps;
        points.push({ x: leftCenter.x + Math.cos(angle) * radius, y: leftCenter.y + Math.sin(angle) * radius });
      }
      return points;
    }

    const topCenter = { x: room.x, y: top + radius };
    const bottomCenter = { x: room.x, y: bottom - radius };
    for (let index = 0; index <= steps; index += 1) {
      const angle = Math.PI + Math.PI * index / steps;
      points.push({ x: topCenter.x + Math.cos(angle) * radius, y: topCenter.y + Math.sin(angle) * radius });
    }
    for (let index = 0; index <= steps; index += 1) {
      const angle = Math.PI * index / steps;
      points.push({ x: bottomCenter.x + Math.cos(angle) * radius, y: bottomCenter.y + Math.sin(angle) * radius });
    }
    return points;
  }

  private addWallSegment(container: Phaser.GameObjects.Container, start: Point, end: Point, seed: number): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const x = (start.x + end.x) / 2;
    const y = (start.y + end.y) / 2;
    if (Math.abs(dx) < 0.5) {
      container.add(this.createWallTile(x, y, WALL_THICKNESS, length, seed, true).setOrigin(0.5));
      return;
    }
    const wall = this.createWallTile(x, y, length, WALL_THICKNESS, seed, false).setOrigin(0.5);
    wall.setRotation(Math.atan2(dy, dx));
    container.add(wall);
  }

  private createDoor(position: Point, side: "N" | "E" | "S" | "W"): Phaser.GameObjects.Container {
    const scene = this.scene!;
    const container = scene.add.container(0, 0);
    if (side === "N" || side === "S") {
      container.add(scene.add.tileSprite(position.x, position.y, TILE_SIZE, WALL_THICKNESS, textureKey(ASSETS.floorPlain)).setOrigin(0.5).setTileScale(WORLD_SCALE));
      container.add(scene.add.image(position.x, position.y, textureKey(ASSETS.doorOpenHorizontal)).setDisplaySize(TILE_SIZE, WALL_THICKNESS).setOrigin(0.5));
      return container;
    }
    container.add(scene.add.tileSprite(position.x, position.y, WALL_THICKNESS, TILE_SIZE, textureKey(ASSETS.floorPlain)).setOrigin(0.5).setTileScale(WORLD_SCALE));
    container.add(scene.add.image(position.x, position.y, textureKey(ASSETS.doorOpenVertical)).setDisplaySize(WALL_THICKNESS, TILE_SIZE).setOrigin(0.5));
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

  private drawRoom(graphics: Phaser.GameObjects.Graphics, room: GraphNode, stroke: boolean): void {
    const left = room.x - room.width / 2;
    const top = room.y - room.height / 2;
    if (room.shape === "capsule") {
      const radius = Math.min(room.width, room.height) / 2;
      graphics.fillRoundedRect(left, top, room.width, room.height, radius);
      if (stroke) graphics.strokeRoundedRect(left, top, room.width, room.height, radius);
      return;
    }
    if (room.shape === "octagon") {
      const cut = Math.min(room.width, room.height) * 0.18;
      const points = [
        new Phaser.Math.Vector2(left + cut, top), new Phaser.Math.Vector2(left + room.width - cut, top),
        new Phaser.Math.Vector2(left + room.width, top + cut), new Phaser.Math.Vector2(left + room.width, top + room.height - cut),
        new Phaser.Math.Vector2(left + room.width - cut, top + room.height), new Phaser.Math.Vector2(left + cut, top + room.height),
        new Phaser.Math.Vector2(left, top + room.height - cut), new Phaser.Math.Vector2(left, top + cut),
      ];
      graphics.fillPoints(points, true);
      if (stroke) graphics.strokePoints(points, true);
      return;
    }
    graphics.fillRect(left, top, room.width, room.height);
    if (stroke) graphics.strokeRect(left, top, room.width, room.height);
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
    if (this.scene?.textures.exists(key) && sprite.texture.key !== key) sprite.setTexture(key);
    const height = baseSize * clip.sizeScale;
    sprite.setDisplaySize(height * sprite.width / sprite.height, height).setOrigin(clip.origin.x, clip.origin.y);
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

  renderDecorations(items: readonly Decoration[], visited: ReadonlySet<number>): void {
    this.currentDecorations = items.map(item => ({ ...item }));
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
    this.currentStairs = stairs.map(item => ({ ...item }));
    this.currentLoot = loot.map(item => ({ ...item }));
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
      const sprite = scene.add.image(0, 0, textureKey(asset)).setDisplaySize(definition.size, definition.size);
      this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(25));
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
    this.currentMonsters = items.map(item => ({ ...item }));
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
          children.unshift(scene.add.circle(0, 0, item.radius + world(11), color, 0.16)
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
    for (const item of items) {
      const container = this.monsters.get(item.id);
      if (!container) continue;
      container.setPosition(item.x, item.y);
      const sprite = container.getByName("sprite") as Phaser.GameObjects.Image;
      this.applyMonsterFrame(sprite, item, performance.now());
      const hp = container.getByName("hp") as Phaser.GameObjects.Rectangle | null;
      if (hp) hp.width = Number(container.getData("hpWidth") ?? world(40)) * Math.max(0, item.hp) / Math.max(1, item.maxHp);
      if (item.bossKind && item.active && !item.dead) {
        this.host.dataset.activeBossX = String(Math.round(item.x));
        this.host.dataset.activeBossY = String(Math.round(item.y));
        this.host.dataset.activeBossDisplayWidth = String(sprite.displayWidth);
        this.host.dataset.activeBossDisplayHeight = String(sprite.displayHeight);
      }
    }
    this.updateMonsterAssetDataset();
    this.renderDebugGeometry();
  }

  private updateMonsterAssetDataset(): void {
    this.host.dataset.renderedMonsters = String(this.monsters.size);
    this.host.dataset.monsterAssets = [...this.monsters.values()].flatMap(container => {
      const sprite = container.getByName("sprite") as Phaser.GameObjects.Image | null;
      return sprite ? [sprite.texture.key.replace(/^asset:/, "")] : [];
    }).join(",");
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
    this.currentBullets = items.map(item => ({ ...item }));
    this.host.dataset.bullets = String(items.length);
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
    this.currentPlayer = { ...position };
    this.currentPlayerHp = hp;
    this.currentPlayerMaxHp = maxHp;
    this.currentPlayerAsset = asset;
    this.host.dataset.playerAsset = asset;
    this.host.dataset.playerX = String(Math.round(position.x));
    this.host.dataset.playerY = String(Math.round(position.y));
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
    this.renderDebugGeometry();
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
    this.host.dataset.playerAsset = asset;
    if (this.playerSprite && this.scene?.textures.exists(textureKey(asset))) {
      this.playerSprite.setTexture(textureKey(asset));
      this.applyClip(this.playerSprite, this.playerClipForAsset(asset), PLAYER_SPEC.spriteSize, 0, asset);
    }
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

  centerCamera(position: Point): void {
    this.currentPlayer = { ...position };
    this.scene?.cameras.main.centerOn(position.x, position.y);
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
