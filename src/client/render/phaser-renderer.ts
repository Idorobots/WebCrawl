import Phaser from "phaser";
import {
  ASSETS,
  BARREL_EXPLOSION_FRAMES,
  CAMERA_BOSS_PADDING,
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
import {
  ELLIPTICAL_LIGHT_PIPELINE,
  EllipticalLightPipeline,
} from "./elliptical-light-pipeline";

const textureKey = (asset: string): string => `asset:${asset}`;
const SEGMENT_SIZE = WORLD_GEOMETRY.segmentSize;
const FLOOR_TILE_SIZE = WORLD_GEOMETRY.floorTileSize;
const FLOOR_TILE_SCALE = FLOOR_TILE_SIZE / 128;
const HIDDEN_WORLD_ALPHA = 0.24;
const PORTAL_FRAME_MS = 125;
function supportedMaxLights(): number {
  const configured = Number(import.meta.env.VITE_MAX_LIGHTS);
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
  if (typeof document === "undefined") return 128;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl");
  if (!gl) return 128;
  const uniformVectors = Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  const capacity = Math.max(4, Math.floor((uniformVectors - 24) / 4));
  if (capacity >= 256) return 256;
  if (capacity >= 128) return 128;
  return capacity;
}

const MAX_LIGHTS = supportedMaxLights();
const MAX_BULLET_LIGHTS = Math.min(192, MAX_LIGHTS);
const AMBIENT_LIGHT_COLOR = 0x10283a;
const ENEMY_AURA_COLOR = 0xff344f;
const PICKUP_AURA_COLOR = 0x6fe7ff;
const PORTAL_DOWN_AURA_COLOR = 0xff4dff;
const PORTAL_UP_AURA_COLOR = 0x4da6ff;
const SHADOW_OFFSET_X = world(8);
const SHADOW_OFFSET_Y = world(10);
const FLASHLIGHT_MAX_RANGE = world(720);
const SHOW_DEBUG_GEOMETRY = import.meta.env.VITE_DEBUG_HITBOXES === "true";

interface WorldLight {
  light: Phaser.GameObjects.Light;
  baseIntensity: number;
  flickerAmount: number;
  flickerSeed: number;
}

function seededUnit(seed: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return ((value ^ value >>> 16) >>> 0) / 0xffffffff;
}

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
  private decorationShadows = new Map<string, Phaser.GameObjects.Image>();
  private objects: Phaser.GameObjects.Container[] = [];
  private lootSprites = new Map<string, Phaser.GameObjects.Image>();
  private portals = new Map<string, Phaser.GameObjects.Container>();
  private monsters = new Map<string, Phaser.GameObjects.Container>();
  private player: Phaser.GameObjects.Container | null = null;
  private cameraTarget: Phaser.GameObjects.Container | null = null;
  private playerSprite: Phaser.GameObjects.Image | null = null;
  private currentPlayer: Point = { x: 0, y: 0 };
  private currentCameraTarget: Point = { x: 0, y: 0 };
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
  private currentLightRoomId: number | null = null;
  private playerProtectionActive = false;
  private playerProtectionTintVisible = false;
  private playerDashTintActive = false;
  private lightingEnabled = false;
  private lightPipeline: EllipticalLightPipeline | null = null;
  private roomLights = new Map<number, WorldLight>();
  private corridorLights = new Map<string, WorldLight[]>();
  private bulletLights: Phaser.GameObjects.Light[] = [];
  private monsterAuras = new Map<string, Phaser.GameObjects.Light>();
  private lootAuras = new Map<string, Phaser.GameObjects.Light>();
  private portalAuras = new Map<string, Phaser.GameObjects.Light>();
  private activeEffectLights = new Set<Phaser.GameObjects.Light>();
  private decorationEffectLights = new Map<string, Phaser.GameObjects.Light>();
  private activeEffects = new Set<Phaser.GameObjects.Image>();
  private playerStateLight: Phaser.GameObjects.Light | null = null;

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

      override update(time: number): void {
        renderer.updateLighting(time);
      }
    }

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.host,
      transparent: true,
      render: {
        antialias: false,
        pixelArt: true,
        roundPixels: true,
        maxLights: MAX_LIGHTS,
        powerPreference: "high-performance",
      },
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
    this.lightingEnabled = scene.game.renderer.type === Phaser.WEBGL;
    this.host.dataset.lightingMode = this.lightingEnabled ? "webgl" : "disabled";
    if (this.lightingEnabled) {
      const webgl = scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
      this.lightPipeline = webgl.pipelines.add(
        ELLIPTICAL_LIGHT_PIPELINE,
        new EllipticalLightPipeline(scene.game),
      ) as EllipticalLightPipeline;
      scene.lights.enable().setAmbientColor(AMBIENT_LIGHT_COLOR);
      this.playerStateLight = scene.lights.addLight(0, 0, world(110), 0xb7e2ff, 0.48).setVisible(false);
      this.host.dataset.ambientLight = AMBIENT_LIGHT_COLOR.toString(16).padStart(6, "0");
      this.host.dataset.auraMode = "light2d";
      this.host.dataset.auraFlicker = "false";
      this.host.dataset.bulletGlowMode = "batched-light2d";
      this.host.dataset.bulletShape = "bar";
      this.host.dataset.flickerMode = "hard-60ms";
      this.host.dataset.flashlightColor = "ffffff";
      this.host.dataset.maxLights = String(MAX_LIGHTS);
      this.host.dataset.portalDownAuraColor = PORTAL_DOWN_AURA_COLOR.toString(16).padStart(6, "0");
      this.host.dataset.portalUpAuraColor = PORTAL_UP_AURA_COLOR.toString(16).padStart(6, "0");
    }
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
    this.currentLightRoomId = null;
    this.scene?.cameras.main.stopFollow().setDeadzone().resetFX();
    this.background?.destroy();
    this.background = null;
    this.destroyStaticObjects();
    this.bulletsGraphics?.clear();
    this.debugGraphics?.clear();
    this.destroyAll(this.decorations);
    this.decorationSprites.clear();
    this.decorationShadows.clear();
    this.destroyAll(this.objects);
    this.lootSprites.clear();
    this.destroyPortalObjects();
    for (const object of this.monsters.values()) object.destroy(true);
    this.monsters.clear();
    this.destroyLights(this.monsterAuras);
    this.destroyLights(this.lootAuras);
    this.destroyLights(this.portalAuras);
    for (const light of this.activeEffectLights) this.scene?.lights.removeLight(light);
    this.activeEffectLights.clear();
    for (const light of this.decorationEffectLights.values()) this.scene?.lights.removeLight(light);
    this.decorationEffectLights.clear();
    for (const effect of this.activeEffects) effect.destroy();
    this.activeEffects.clear();
    this.playerStateLight?.setVisible(false);
    this.setHostData("playerLight", "false");
    for (const light of this.bulletLights) light.setVisible(false);
    if (this.lightPipeline) this.lightPipeline.flashlight.active = false;
    this.player?.destroy(true);
    this.player = null;
    this.cameraTarget?.destroy(true);
    this.cameraTarget = null;
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
    delete this.host.dataset.flashlightActive;
    delete this.host.dataset.roomLights;
    delete this.host.dataset.corridorLights;
    delete this.host.dataset.bossRoomLights;
    delete this.host.dataset.flickeringLights;
    delete this.host.dataset.roomLightIntensities;
    delete this.host.dataset.roomLightRadii;
    delete this.host.dataset.enemyAuras;
    delete this.host.dataset.pickupAuras;
    delete this.host.dataset.bulletGlows;
    delete this.host.dataset.effectLights;
    delete this.host.dataset.sceneryShadows;
    delete this.host.dataset.monsterShadows;
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
    this.illuminate(this.background);

    for (const link of this.layout.links) {
      const visible = this.visited.has(link.source.id) || this.visited.has(link.target.id);
      this.renderCorridor(link, visible ? 1 : HIDDEN_WORLD_ALPHA);
      this.addCorridorLights(link, visible);
    }

    for (const room of this.layout.nodes) {
      const visible = this.visited.has(room.id);
      this.renderRoom(room, visible ? 1 : HIDDEN_WORLD_ALPHA);
      this.addRoomLight(room, visible);
    }
    this.refreshLocalLightVisibility(true);
  }

  private updateWorldVisibility(): void {
    const layout = this.layout;
    if (!layout) return;
    for (const room of layout.nodes) {
      const visible = this.visited.has(room.id);
      this.roomLayers.get(room.id)?.setAlpha(visible ? 1 : HIDDEN_WORLD_ALPHA);
    }
    for (const link of layout.links) {
      const visible = this.visited.has(link.source.id) || this.visited.has(link.target.id);
      this.corridorLayers.get(link.id)?.setAlpha(visible ? 1 : HIDDEN_WORLD_ALPHA);
    }
    this.refreshLocalLightVisibility(true);
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
    this.illuminate(floor);
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
      this.illuminate(detail);
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
      const floor = scene.add.tileSprite(left, top, length, width, textureKey(floorAsset)).setOrigin(0).setTileScale(FLOOR_TILE_SCALE);
      this.illuminate(floor);
      container.add(floor);
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
    const floor = scene.add.tileSprite(left, top, width, length, textureKey(floorAsset)).setOrigin(0).setTileScale(FLOOR_TILE_SCALE);
    this.illuminate(floor);
    container.add(floor);
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
    return this.illuminate(
      this.scene!.add.image(x, y, textureKey(asset)).setDisplaySize(SEGMENT_SIZE, SEGMENT_SIZE),
    );
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
    container.add(this.illuminate(scene.add.image(position.x, position.y, textureKey(asset)).setDisplaySize(
      horizontal ? SEGMENT_SIZE * WORLD_GEOMETRY.doorSpanSegments : SEGMENT_SIZE,
      horizontal ? SEGMENT_SIZE : SEGMENT_SIZE * WORLD_GEOMETRY.doorSpanSegments,
    )));
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
    for (const profile of this.roomLights.values()) this.scene?.lights.removeLight(profile.light);
    this.roomLights.clear();
    for (const profiles of this.corridorLights.values()) {
      for (const profile of profiles) this.scene?.lights.removeLight(profile.light);
    }
    this.corridorLights.clear();
    this.roomLayers.clear();
    this.corridorLayers.clear();
  }

  private addRoomLight(room: GraphNode, visible: boolean): void {
    if (!this.lightingEnabled || !this.scene) return;
    const seed = room.lootSeed + room.id * 101;
    const tier = Math.abs(room.id) % 3;
    const intensities = [0.38, 0.72, 1.18] as const;
    const radiusScales = [0.42, 0.55] as const;
    const colors = [0x5ca6df, 0x73cfff, 0x91b8ff] as const;
    const bossArena = room.tag === "script";
    const baseIntensity = bossArena ? 1.65 : intensities[tier]!;
    const radius = bossArena
      ? Math.max(room.width, room.height) * 0.82
      : tier === 2
        ? Math.max(room.width, room.height) * 1.05
        : Math.min(room.width, room.height) * radiusScales[tier]!;
    const color = bossArena ? 0xff3d42 : colors[tier]!;
    const flickerAmount = bossArena
      ? 0.08
      : Math.abs(room.id) % 4 === 2
        ? 0.16 + seededUnit(seed + 71) * 0.12
        : 0;
    const light = this.scene.lights.addLight(room.x, room.y, radius, color, baseIntensity);
    light.setVisible(visible);
    this.roomLights.set(room.id, { light, baseIntensity, flickerAmount, flickerSeed: seed });
  }

  private addCorridorLights(link: DungeonLayout["links"][number], visible: boolean): void {
    if (!this.lightingEnabled || !this.scene) return;
    const profiles: WorldLight[] = [];
    const bossAdjacent = link.source.tag === "script" || link.target.tag === "script";
    for (let segment = 1; segment < link.points.length; segment += 1) {
      const start = link.points[segment - 1]!;
      const end = link.points[segment]!;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const count = Math.max(1, Math.ceil(length / world(360)));
      for (let index = 0; index < count; index += 1) {
        const progress = (index + 0.5) / count;
        const seed = link.source.lootSeed + link.target.id * 131 + segment * 31 + index;
        const baseIntensity = bossAdjacent ? 0.82 : 0.46 + seededUnit(seed) * 0.26;
        const radius = Math.max(link.width * 0.95, length / count * 0.78);
        const light = this.scene.lights.addLight(
          start.x + (end.x - start.x) * progress,
          start.y + (end.y - start.y) * progress,
          radius,
          bossAdjacent ? 0xd94b52 : 0x5faed8,
          baseIntensity,
        ).setVisible(visible);
        profiles.push({
          light,
          baseIntensity,
          flickerAmount: seededUnit(seed + 53) < 0.22 ? 0.12 : 0,
          flickerSeed: seed,
        });
      }
    }
    this.corridorLights.set(link.id, profiles);
  }

  private updateWorldLightDataset(): void {
    const layout = this.layout;
    if (!layout) return;
    const visibleRooms = layout.nodes.filter(room => this.roomLights.get(room.id)?.light.visible);
    const visibleCorridors = layout.links.filter(link =>
      this.corridorLights.get(link.id)?.some(profile => profile.light.visible)
    );
    this.setHostData("roomLights", String(visibleRooms.length));
    this.setHostData("bossRoomLights", String(visibleRooms.filter(room => room.tag === "script").length));
    this.setHostData("corridorLights", String(visibleCorridors.reduce(
      (count, link) => count + (this.corridorLights.get(link.id)?.length ?? 0),
      0,
    )));
    this.setHostData("flickeringLights", String([
      ...this.roomLights.values(),
      ...[...this.corridorLights.values()].flat(),
    ].filter(profile => profile.light.visible && profile.flickerAmount > 0).length));
    this.setHostData("roomLightIntensities", [...this.roomLights.values()]
      .map(profile => profile.baseIntensity.toFixed(2))
      .join(","));
    this.setHostData("roomLightRadii", [...this.roomLights.values()]
      .map(profile => Math.round(profile.light.radius))
      .join(","));
    this.setHostData("bossRoomLightColor", "ff3d42");
  }

  private roomAt(position: Point): GraphNode | null {
    const rooms = this.layout?.nodes;
    if (!rooms?.length) return null;
    const containing = rooms.find(room =>
      position.x >= room.x - room.width / 2 &&
      position.x <= room.x + room.width / 2 &&
      position.y >= room.y - room.height / 2 &&
      position.y <= room.y + room.height / 2
    );
    if (containing) return containing;
    return rooms.reduce((nearest, room) => {
      const nearestDistance = (nearest.x - position.x) ** 2 + (nearest.y - position.y) ** 2;
      const roomDistance = (room.x - position.x) ** 2 + (room.y - position.y) ** 2;
      return roomDistance < nearestDistance ? room : nearest;
    });
  }

  private refreshLocalLightVisibility(force = false): void {
    const layout = this.layout;
    if (!layout || !this.lightingEnabled) return;
    const currentRoom = this.roomAt(this.currentPlayer);
    if (!currentRoom) return;
    if (!force && this.currentLightRoomId === currentRoom.id) return;
    this.currentLightRoomId = currentRoom.id;
    const localRooms = new Set<number>([currentRoom.id]);
    for (const link of layout.links) {
      if (link.source.id === currentRoom.id) localRooms.add(link.target.id);
      if (link.target.id === currentRoom.id) localRooms.add(link.source.id);
    }
    for (const [roomId, profile] of this.roomLights) profile.light.setVisible(localRooms.has(roomId));
    for (const link of layout.links) {
      const visible = link.source.id === currentRoom.id || link.target.id === currentRoom.id;
      for (const profile of this.corridorLights.get(link.id) ?? []) profile.light.setVisible(visible);
    }
    for (const light of this.lootAuras.values()) light.setVisible(true);
    for (const light of this.portalAuras.values()) light.setVisible(true);
    for (const light of this.monsterAuras.values()) light.setVisible(true);
    this.setHostData("localLightRooms", [...localRooms].join(","));
    this.setHostData("pickupAuras", String([
      ...this.lootAuras.values(),
      ...this.portalAuras.values(),
    ].filter(light => light.visible).length));
    this.setHostData("enemyAuras", String([...this.monsterAuras.values()].filter(light => light.visible).length));
    this.updateWorldLightDataset();
    this.syncBulletLights(this.currentBullets);
  }

  updateLighting(time: number): void {
    const profiles = [
      ...this.roomLights.values(),
      ...[...this.corridorLights.values()].flat(),
    ];
    const step = Math.floor(time / 60);
    for (const profile of profiles) {
      if (!profile.light.visible || profile.flickerAmount === 0) continue;
      const illuminated = seededUnit(profile.flickerSeed + step) > 0.34;
      profile.light.setIntensity(illuminated ? profile.baseIntensity : 0);
    }
  }

  private illuminate<T extends Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite>(object: T): T {
    if (this.lightingEnabled) object.setPipeline(ELLIPTICAL_LIGHT_PIPELINE);
    return object;
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

  private createShadow(asset: string): Phaser.GameObjects.Image {
    return this.illuminate(
      this.scene!.add.image(SHADOW_OFFSET_X, SHADOW_OFFSET_Y, textureKey(asset))
        .setName("shadow")
        .setTintFill(0x000000)
        .setAlpha(0.3),
    );
  }

  private createAuraLight(
    x: number,
    y: number,
    color: number,
    radius: number,
    intensity: number,
  ): Phaser.GameObjects.Light | null {
    if (!this.lightingEnabled || !this.scene) return null;
    return this.scene.lights.addLight(x, y, radius, color, intensity);
  }

  private destroyLights(lights: Map<string, Phaser.GameObjects.Light>): void {
    for (const light of lights.values()) this.scene?.lights.removeLight(light);
    lights.clear();
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
    this.decorationShadows.clear();
    for (const light of this.decorationEffectLights.values()) this.scene?.lights.removeLight(light);
    this.decorationEffectLights.clear();
    const scene = this.scene;
    if (!scene) return;
    for (const item of items) {
      if (!visited.has(item.roomId) || (item.destroyed && !item.visual.destroyed?.length)) continue;
      const state = this.decorationClip(item, performance.now());
      const asset = this.clipAsset(state.clip, state.elapsed);
      const sprite = this.illuminate(scene.add.image(0, 0, textureKey(asset)));
      const shadow = this.createShadow(asset);
      this.applyClip(sprite, state.clip, item.size, state.elapsed);
      this.applyClip(shadow, state.clip, item.size, state.elapsed);
      const container = scene.add.container(item.x, item.y, [shadow, sprite]).setDepth(item.destroyed ? 18 : 20);
      this.decorationSprites.set(item.id, sprite);
      this.decorationShadows.set(item.id, shadow);
      this.syncDecorationEffectLight(item, state);
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
    this.setHostData("sceneryShadows", String(this.decorationShadows.size));
    this.refreshLocalLightVisibility(true);
    this.renderDebugGeometry();
  }

  updateDecorationAnimations(items: readonly Decoration[], now: number): void {
    for (const item of items) {
      if (item.spawnAnimationStartedAt === undefined) continue;
      const sprite = this.decorationSprites.get(item.id);
      if (!sprite) continue;
      const state = this.decorationClip(item, now);
      this.applyClip(sprite, state.clip, item.size, state.elapsed);
      const shadow = this.decorationShadows.get(item.id);
      if (shadow) this.applyClip(shadow, state.clip, item.size, state.elapsed);
      this.syncDecorationEffectLight(item, state);
    }
  }

  private syncDecorationEffectLight(
    item: Decoration,
    state: { clip: SpriteClip; elapsed: number },
  ): void {
    const profile = state.clip.light;
    const active = Boolean(profile) && state.elapsed < state.clip.frames.length * state.clip.frameDurationMs;
    let light = this.decorationEffectLights.get(item.id);
    if (!this.lightingEnabled || !this.scene || !active || !profile) {
      if (light) this.scene?.lights.removeLight(light);
      this.decorationEffectLights.delete(item.id);
      this.updateEffectLightDataset();
      return;
    }
    if (!light) {
      light = this.scene.lights.addLight(
        item.x,
        item.y + item.hitOffsetY,
        Math.max(world(52), item.size * profile.radiusScale),
        profile.color,
        profile.intensity,
      );
      this.decorationEffectLights.set(item.id, light);
    }
    const duration = Math.max(1, state.clip.frames.length * state.clip.frameDurationMs);
    const progress = state.elapsed / duration;
    light.setIntensity(profile.intensity * (0.8 + Math.sin(progress * Math.PI) * 0.2));
    this.updateEffectLightDataset();
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
    this.destroyLights(this.lootAuras);
    this.syncPortals(stairs, visited);
    const scene = this.scene;
    if (!scene) return;
    for (const item of loot) {
      if (!visited.has(item.roomId)) continue;
      const auraRadius = item.kind === "weapon" ? world(112) : world(86);
      const lootAura = this.createAuraLight(
        item.x,
        item.y,
        PICKUP_AURA_COLOR,
        auraRadius,
        item.kind === "weapon" ? 0.72 : 0.58,
      );
      if (lootAura) this.lootAuras.set(item.id, lootAura);
      if (item.kind === "weapon" && item.weapon) {
        const definition = WEAPON_PICKUP_DEFINITIONS[item.weaponPlacement ?? "floor"];
        const visual = WEAPON_VISUAL_DEFINITIONS[item.weapon.kind];
        const yOffset = item.weaponPlacement === "pedestal"
          ? visual.pedestalYOffset
          : definition.yOffset;
        const sprite = this.illuminate(scene.add.image(0, yOffset, textureKey(weaponAsset(item.weapon.kind)))
          .setDisplaySize(definition.size, definition.size)
          .setOrigin(visual.origin.x, visual.origin.y));
        this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(25));
        continue;
      }
      const definition = item.kind === "weapon" ? undefined : LOOT_DEFINITIONS[item.kind];
      const asset = definition?.asset ?? lootAssets[item.kind];
      if (!asset || !definition) continue;
      const clip = this.lootClip(item, definition);
      if (clip) {
        const elapsed = this.lootAnimationElapsed(clip, performance.now());
        const sprite = this.illuminate(scene.add.image(0, 0, textureKey(this.clipAsset(clip, elapsed))));
        this.applyClip(sprite, clip, definition.size, elapsed);
        this.lootSprites.set(item.id, sprite);
        this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(25));
        continue;
      }
      const sprite = this.illuminate(scene.add.image(0, 0, textureKey(asset)).setDisplaySize(definition.size, definition.size));
      this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(25));
    }
    this.refreshLocalLightVisibility(true);
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
      const aura = this.portalAuras.get(id);
      if (aura) scene.lights.removeLight(aura);
      this.portalAuras.delete(id);
    }

    for (const stair of stairs) {
      if (!visible.has(stair.id)) continue;
      let container = this.portals.get(stair.id);
      if (!container) {
        const sprite = this.illuminate(scene.add.image(0, 0, textureKey(PORTAL_DEFINITION.frames[stair.type][0]))
          .setDisplaySize(PORTAL_DEFINITION.size, PORTAL_DEFINITION.size)
          .setOrigin(PORTAL_DEFINITION.origin.x, PORTAL_DEFINITION.origin.y)
          .setName("sprite"));
        container = scene.add.container(stair.x, stair.y, [sprite]).setDepth(24);
        container.setData("enabled", false);
        container.setData("animationToken", 0);
        this.portals.set(stair.id, container);
        const portalAura = this.createAuraLight(
          stair.x,
          stair.y,
          stair.type === "down" ? PORTAL_DOWN_AURA_COLOR : PORTAL_UP_AURA_COLOR,
          PORTAL_DEFINITION.size * 0.82,
          stair.enabled ? 0.82 : 0.3,
        );
        if (portalAura) this.portalAuras.set(stair.id, portalAura);
        this.animatePortal(container, stair.type, stair.enabled, true);
        continue;
      }
      container.setPosition(stair.x, stair.y);
      const aura = this.portalAuras.get(stair.id);
      if (aura) {
        aura.x = stair.x;
        aura.y = stair.y;
        aura.setIntensity(stair.enabled ? 0.82 : 0.3);
      }
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
    this.host.dataset.activeMinibosses = String(items.filter(item => item.active && item.miniboss && !item.dead).length);
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
        const aura = this.monsterAuras.get(id);
        if (aura) scene.lights.removeLight(aura);
        this.monsterAuras.delete(id);
      }
    }
    for (const item of items) {
      if (!visibleIds.has(item.id)) continue;
      let container = this.monsters.get(item.id);
      if (container && Boolean(container.getData("dead")) !== item.dead) {
        container.destroy(true);
        this.monsters.delete(item.id);
        const aura = this.monsterAuras.get(item.id);
        if (aura) scene.lights.removeLight(aura);
        this.monsterAuras.delete(item.id);
        container = undefined;
      }
      if (!container) {
        const frame = this.monsterFrame(item, performance.now());
        const assetKey = textureKey(frame.asset);
        const sprite = this.illuminate(scene.add.image(0, 0, assetKey).setName("sprite"));
        const shadow = this.createShadow(frame.asset);
        this.applyClip(sprite, frame.clip, item.size, frame.elapsed);
        this.applyClip(shadow, frame.clip, item.size, frame.elapsed);
        const barWidth = item.bossKind ? item.size * 0.68 : item.miniboss ? item.size * 0.72 : item.size * 0.6;
        const barY = monsterHealthBarY(item.size, item.visualKind);
        const children: Phaser.GameObjects.GameObject[] = [shadow, sprite];
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
          const barHeight = item.bossKind ? world(9) : item.miniboss ? world(7) : world(5);
          const fillHeight = item.bossKind ? world(7) : item.miniboss ? world(6) : world(5);
          const fillColor = item.bossKind ? 0xf09cff : item.miniboss ? 0xffc857 : item.speed === 0 ? 0xc07cff : 0xff6b6b;
          children.push(scene.add.rectangle(-barWidth / 2, barY, barWidth, barHeight, 0x071018).setOrigin(0, 0.5));
          children.push(scene.add.rectangle(-barWidth / 2, barY, barWidth, fillHeight, fillColor).setOrigin(0, 0.5).setName("hp"));
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
        if (!item.dead) {
          const auraRadius = item.radius + world(item.bossKind ? 110 : 64);
          const auraY = item.y + monsterVisualCenterOffsetY(item.size, item.visualKind);
          const aura = this.createAuraLight(
            item.x,
            auraY,
            ENEMY_AURA_COLOR,
            auraRadius,
            item.bossKind ? 1.05 : 0.62,
          );
          if (aura) this.monsterAuras.set(item.id, aura);
        }
      }
      container.setPosition(item.x, item.y);
      const sprite = container.getByName("sprite") as Phaser.GameObjects.Image;
      this.applyMonsterFrame(container, item, performance.now());
      const aura = this.monsterAuras.get(item.id);
      if (aura) {
        aura.x = item.x;
        aura.y = item.y + monsterVisualCenterOffsetY(item.size, item.visualKind);
      }
      const hp = container.getByName("hp") as Phaser.GameObjects.Rectangle | null;
      if (hp) hp.width = Number(container.getData("hpWidth") ?? world(40)) * Math.max(0, item.hp) / Math.max(1, item.maxHp);
      if (item === activeBoss) {
        this.host.dataset.activeBossDisplayWidth = String(sprite.displayWidth);
        this.host.dataset.activeBossDisplayHeight = String(sprite.displayHeight);
      }
    }
    this.updateMonsterAssetDataset();
    this.refreshLocalLightVisibility(true);
    this.setHostData("monsterShadows", String(this.monsters.size));
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
      this.applyMonsterFrame(container, item, now);
      assetChanged ||= previousAsset !== sprite.texture.key;
      const aura = this.monsterAuras.get(item.id);
      if (aura) {
        aura.x = item.x;
        aura.y = item.y + monsterVisualCenterOffsetY(item.size, item.visualKind);
      }
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

  private applyMonsterFrame(container: Phaser.GameObjects.Container, item: Monster, now: number): void {
    const frame = this.monsterFrame(item, now);
    const sprite = container.getByName("sprite") as Phaser.GameObjects.Image;
    this.applyClip(sprite, frame.clip, item.size, frame.elapsed);
    const shadow = container.getByName("shadow") as Phaser.GameObjects.Image | null;
    if (shadow) this.applyClip(shadow, frame.clip, item.size, frame.elapsed);
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
    this.bulletsGraphics ??= this.scene.add.graphics()
      .setDepth(40)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.bulletsGraphics.clear();
    for (const bullet of items) {
      const color = this.bulletColor(bullet);
      const radius = bullet.radius ?? DEFAULT_BULLET_SPEC.radius;
      const speed = Math.hypot(bullet.vx, bullet.vy);
      const trailLength = Math.min(world(78), Math.max(world(18), speed * 0.045));
      const tailX = bullet.x - bullet.vx / Math.max(1, speed) * trailLength;
      const tailY = bullet.y - bullet.vy / Math.max(1, speed) * trailLength;
      const headX = bullet.x + bullet.vx / Math.max(1, speed) * radius * 2;
      const headY = bullet.y + bullet.vy / Math.max(1, speed) * radius * 2;
      this.bulletsGraphics.lineStyle(Math.max(world(3), radius * 4.4), color, 0.08);
      this.bulletsGraphics.lineBetween(tailX, tailY, headX, headY);
      this.bulletsGraphics.lineStyle(Math.max(world(2), radius * 2.2), color, 0.3);
      this.bulletsGraphics.lineBetween(tailX, tailY, headX, headY);
      this.bulletsGraphics.lineStyle(Math.max(world(1), radius * 0.9), color, 1);
      this.bulletsGraphics.lineBetween(tailX, tailY, headX, headY);
    }
    this.syncBulletLights(items);
    this.setHostData("bulletGlows", String(items.length));
    this.setHostData("bulletShape", "bar");
    this.renderDebugGeometry();
  }

  private bulletColor(bullet: Bullet): number {
    if (bullet.style === "shockwave") return 0xffa34d;
    if (bullet.style === "boss") return 0xee78ff;
    if (bullet.owner === "enemy") return 0xff596e;
    return bullet.weaponKind ? WEAPON_COLORS[bullet.weaponKind] : 0x86fff0;
  }

  private syncBulletLights(items: readonly Bullet[]): void {
    if (!this.lightingEnabled || !this.scene) return;
    const lightCount = Math.min(items.length, MAX_BULLET_LIGHTS);
    while (this.bulletLights.length < lightCount) {
      this.bulletLights.push(this.scene.lights.addLight(0, 0, world(72), 0xffffff, 0.7).setVisible(false));
    }

    const selected: Array<{ bullet: Bullet; distanceSquared: number }> = [];
    for (const bullet of items) {
      const dx = bullet.x - this.currentPlayer.x;
      const dy = bullet.y - this.currentPlayer.y;
      const distanceSquared = dx * dx + dy * dy;
      if (selected.length < lightCount) {
        selected.push({ bullet, distanceSquared });
        continue;
      }
      let farthest = 0;
      for (let index = 1; index < selected.length; index += 1) {
        if (selected[index]!.distanceSquared > selected[farthest]!.distanceSquared) farthest = index;
      }
      if (distanceSquared < selected[farthest]!.distanceSquared) selected[farthest] = { bullet, distanceSquared };
    }

    for (let index = 0; index < this.bulletLights.length; index += 1) {
      const light = this.bulletLights[index]!;
      const entry = selected[index];
      if (!entry) {
        light.setVisible(false);
        continue;
      }
      const bullet = entry.bullet;
      const radius = bullet.radius ?? DEFAULT_BULLET_SPEC.radius;
      light.x = bullet.x;
      light.y = bullet.y;
      light.setColor(this.bulletColor(bullet));
      light.setRadius(Math.max(world(72), radius * 8));
      light.setIntensity(bullet.style === "shockwave" ? 1.05 : 0.72);
      light.setVisible(true);
    }
    this.setHostData("bulletLights", String(selected.length));
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
      this.playerSprite = this.illuminate(scene.add.image(0, 0, textureKey(asset))
        .setOrigin(clip.origin.x, clip.origin.y));
      this.applyClip(this.playerSprite, clip, PLAYER_SPEC.spriteSize, 0, asset);
      this.player = scene.add.container(position.x, position.y, [this.playerSprite]).setDepth(50);
    }
    this.player.setPosition(position.x, position.y);
    if (scene.textures.exists(textureKey(asset))) this.playerSprite!.setTexture(textureKey(asset));
    this.applyClip(this.playerSprite!, clip, PLAYER_SPEC.spriteSize, 0, asset);
    this.applyPlayerProtectionTint();
    this.syncPlayerStateLight();
    this.refreshLocalLightVisibility();
    this.renderDebugGeometry();
  }

  setPlayerProtection(active: boolean, tintVisible: boolean): void {
    this.playerProtectionActive = active;
    this.playerProtectionTintVisible = tintVisible;
    this.setHostData("playerInvulnerable", String(active));
    this.setHostData("playerProtectionTinted", String(active && tintVisible));
    this.applyPlayerProtectionTint();
    this.syncPlayerStateLight();
  }

  setPlayerDashTint(active: boolean): void {
    this.playerDashTintActive = active;
    this.setHostData("playerDashing", String(active));
    this.applyPlayerProtectionTint();
    this.syncPlayerStateLight();
  }

  private applyPlayerProtectionTint(): void {
    if (!this.playerSprite) return;
    if (this.playerDashTintActive) {
      this.playerSprite.setTint(0x4db3ff);
    } else if (this.playerProtectionActive && this.playerProtectionTintVisible) {
      this.playerSprite.setTint(0x78ff9b);
    } else {
      this.playerSprite.clearTint();
    }
  }

  private syncPlayerStateLight(): void {
    const light = this.playerStateLight;
    if (!light) return;
    light.x = this.currentPlayer.x;
    light.y = this.currentPlayer.y + PLAYER_SPEC.visualCenterOffsetY;
    light.setColor(this.playerDashTintActive ? 0x4db3ff : this.playerProtectionActive ? 0x78ff9b : 0xb7e2ff);
    light.setRadius(this.playerDashTintActive ? world(210) : this.playerProtectionActive ? world(150) : world(110));
    light.setIntensity(this.playerDashTintActive ? 1.3 : this.playerProtectionActive ? 0.8 : 0.48);
    light.setVisible(true);
    this.setHostData("playerLight", "true");
  }

  setFlashlightTarget(target: Point | null): void {
    const pipeline = this.lightPipeline;
    if (!pipeline || !target) {
      if (pipeline) pipeline.flashlight.active = false;
      this.setHostData("flashlightActive", "false");
      return;
    }
    const originX = this.currentPlayer.x;
    const originY = this.currentPlayer.y + PLAYER_SPEC.visualCenterOffsetY;
    const dx = target.x - originX;
    const dy = target.y - originY;
    const rawDistance = Math.hypot(dx, dy);
    if (rawDistance < 1) {
      pipeline.flashlight.active = false;
      this.setHostData("flashlightActive", "false");
      return;
    }
    const distance = Math.min(rawDistance, FLASHLIGHT_MAX_RANGE);
    const targetX = originX + dx / rawDistance * distance;
    const targetY = originY + dy / rawDistance * distance;
    const distanceRatio = distance / FLASHLIGHT_MAX_RANGE;
    pipeline.flashlight = {
      active: true,
      originX,
      originY,
      targetX,
      targetY,
      majorRadius: world(244) + world(156) * distanceRatio,
      minorRadius: world(224) + world(4) * distanceRatio,
      intensity: 1.48 - 0.28 * distanceRatio,
    };
    this.setHostData("flashlightActive", "true");
    this.setHostData("flashlightTargetX", String(Math.round(targetX)));
    this.setHostData("flashlightTargetY", String(Math.round(targetY)));
    this.setHostData("flashlightMajorRadius", String(Math.round(pipeline.flashlight.majorRadius)));
    this.setHostData("flashlightMinorRadius", String(Math.round(pipeline.flashlight.minorRadius)));
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

  private updateEffectLightDataset(): void {
    this.setHostData(
      "effectLights",
      String(this.activeEffectLights.size + this.decorationEffectLights.size),
    );
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
    const effect = scene.add.image(x, y, textureKey(clip.frames[0]!))
      .setDepth(55)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.activeEffects.add(effect);
    this.setHostData("lastEffect", clip.frames[0]!);
    this.setHostData("effectSpriteMode", "emissive");
    this.applyClip(effect, clip, baseSize);
    const profile = clip.light ?? { color: 0x8bdfff, radiusScale: 0.8, intensity: 0.9 };
    const light = this.lightingEnabled
      ? scene.lights.addLight(x, y, Math.max(world(52), baseSize * profile.radiusScale), profile.color, profile.intensity)
      : null;
    if (light) {
      this.activeEffectLights.add(light);
      this.updateEffectLightDataset();
    }
    let frameIndex = 0;
    scene.time.addEvent({
      delay: clip.frameDurationMs,
      repeat: clip.frames.length - 1,
      callback: () => {
        if (frameIndex >= clip.frames.length - 1) {
          effect.destroy();
          this.activeEffects.delete(effect);
          if (light) {
            scene.lights.removeLight(light);
            this.activeEffectLights.delete(light);
            this.updateEffectLightDataset();
          }
          return;
        }
        frameIndex += 1;
        this.applyClip(effect, clip, baseSize, frameIndex * clip.frameDurationMs);
        if (light) {
          const progress = frameIndex / Math.max(1, clip.frames.length - 1);
          light.setIntensity(profile.intensity * (1 - progress * 0.45));
        }
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

  setCameraTarget(position: Point, immediate = false): void {
    this.currentCameraTarget = { ...position };
    if (!this.scene) return;
    this.cameraTarget ??= this.scene.add.container(position.x, position.y);
    this.cameraTarget.setPosition(position.x, position.y);
    if (immediate && !this.cameraRoom) this.scene.cameras.main.centerOn(position.x, position.y);
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

    this.setCameraTarget(this.currentCameraTarget);
    camera.startFollow(this.cameraTarget!, false, CAMERA_FOLLOW_LERP, CAMERA_FOLLOW_LERP);
    camera.setDeadzone();
    if (immediate) {
      camera.setZoom(CAMERA_SCALE).centerOn(this.currentCameraTarget.x, this.currentCameraTarget.y);
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
    this.destroyLights(this.portalAuras);
  }
}
