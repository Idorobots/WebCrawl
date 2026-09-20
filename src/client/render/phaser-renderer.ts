import Phaser from "phaser";
import {
  ASSETS,
  BARREL_EXPLOSION_FRAMES,
  CAMERA_FOLLOW_LERP,
  CAMERA_SCALE,
  CAMERA_TRANSITION_MS,
  DEBRIS_ASSETS,
  BASE_FLOOR_ASSETS,
  DAMAGED_FLOOR_ASSETS,
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
  monsterWalkElapsed,
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
  buildCorridorRenderPlan,
  type CorridorRenderPlan,
  type CorridorSegmentPlan,
} from "./corridor-render-plan";
import {
  ELLIPTICAL_LIGHT_PIPELINE,
  EllipticalLightPipeline,
} from "./elliptical-light-pipeline";

const textureKey = (asset: string): string => `asset:${asset}`;
const SEGMENT_SIZE = WORLD_GEOMETRY.segmentSize;
const FLOOR_TILE_SIZE = WORLD_GEOMETRY.floorTileSize;
const FLOOR_TILE_SCALE = FLOOR_TILE_SIZE / 128;
const HIDDEN_WORLD_ALPHA = 0.24;
const FLOOR_DAMAGE_CHANCE_PERCENT = 12;

type StaticObject =
  | Phaser.GameObjects.Image
  | Phaser.GameObjects.TileSprite
  | Phaser.GameObjects.Container
  | Phaser.GameObjects.Graphics
  | Phaser.GameObjects.Text;

const ROOM_FLOOR_DEPTH = -2;
const CORRIDOR_FLOOR_DEPTH = -4;
const CORRIDOR_MARKING_DEPTH = -1.75;
const DEBRIS_DEPTH = -1.5;
const Y_DEPTH_OFFSET = 4_000_000;
const SIDE_WALL_DEPTH = 7_000_000;
const OVERHEAD_DEPTH = 8_000_000;
const DEBUG_DEPTH = 12_000_000;
const yDepth = (y: number, bias = 0): number => Y_DEPTH_OFFSET + y + bias;

/**
 * Depth anchor per wall module:
 * - E/W walls always draw above actors.
 * - N walls anchor at their top edge so anything south of them draws in front.
 * - S walls anchor at their bottom edge (+1 to win boundary ties) so they stay in front.
 */
function wallDepth(asset: string, y: number): number {
  if (asset === ASSETS.wallVerticalLeft || asset === ASSETS.wallVerticalRight) return SIDE_WALL_DEPTH;
  if (asset === ASSETS.corridorCornerTopLeft || asset === ASSETS.corridorCornerTopRight) {
    return yDepth(y - SEGMENT_SIZE / 2);
  }
  if (asset === ASSETS.corridorCornerBottomLeft || asset === ASSETS.corridorCornerBottomRight) {
    return yDepth(y + SEGMENT_SIZE / 2, 1);
  }
  if (asset === ASSETS.wallHorizontalTop || asset === ASSETS.wallCornerTopLeft || asset === ASSETS.wallCornerTopRight) {
    return yDepth(y - SEGMENT_SIZE / 2);
  }
  return yDepth(y + SEGMENT_SIZE / 2, 1);
}

/**
 * Doors follow their wall's anchor: E/W always draw above actors, N doors
 * anchor at the module top edge, S doors at the bottom edge (+1 tie bias).
 */
function doorDepth(side: "N" | "E" | "S" | "W", y: number): number {
  if (side === "E" || side === "W") return SIDE_WALL_DEPTH;
  if (side === "N") return yDepth(y - SEGMENT_SIZE / 2);
  return yDepth(y + SEGMENT_SIZE / 2, 1);
}
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
  const capacity = Math.max(4, Math.floor((uniformVectors - 24) / 5));
  if (capacity >= 256) return 256;
  if (capacity >= 128) return 128;
  return capacity;
}

const MAX_LIGHTS = supportedMaxLights();
const MAX_BULLET_LIGHTS = Math.min(192, MAX_LIGHTS);
const BULLET_LIGHTS_ENABLED = import.meta.env.VITE_BULLET_LIGHTS !== "off";
const AMBIENT_LIGHT_COLOR = 0x07121c;
const ENEMY_AURA_COLOR = 0xff344f;
const PICKUP_AURA_COLOR = 0x6fe7ff;
const PORTAL_DOWN_AURA_COLOR = 0xff4dff;
const PORTAL_UP_AURA_COLOR = 0x4da6ff;
const SHADOW_OFFSET_X = world(8);
const SHADOW_OFFSET_Y = world(10);
const SHADOW_DISTANCE_SCALE = 0.09;
const SHADOW_MIN_DISTANCE = world(6);
const SHADOW_MAX_DISTANCE = world(26);
const EFFECT_LIGHT_FALLBACK = { color: 0x8bdfff, radiusScale: 0.8, intensity: 0.9 };
const FLASHLIGHT_MAX_RANGE = world(720);
const FLASHLIGHT_RADIUS_SCALE = 0.8;
const BOSS_CAMERA_SCALE = 0.75;
const FLICKER_BURST_INTERVAL_MS = 1_400;
const FLICKER_STEP_MS = 35;
const CORRIDOR_LIGHT_SPACING = world(240);
const CORRIDOR_LIGHT_CULL_CELL = CORRIDOR_LIGHT_SPACING / 2;
const SHOW_DEBUG_GEOMETRY = import.meta.env.VITE_DEBUG_HITBOXES === "true";

const STATION_AMBIENT_KEY = "station-ambient";
const STATION_AMBIENT_SRC = "sounds/ambient/station/space.mp3";
const STATION_AMBIENT_VOLUME = 0.45;
const STATION_AMBIENT_FADE_MS = 750;

const ONE_SHOT_SOUNDS: Readonly<Record<string, string>> = {
  "sfx-pickup-generic": "sounds/pickup/generic.mp3",
  "sfx-pickup-ram": "sounds/pickup/ram.mp3",
  "sfx-pickup-weapon": "sounds/pickup/weapon.mp3",
  "sfx-portal-up": "sounds/scenery/portal/teleport_up.mp3",
  "sfx-portal-down": "sounds/scenery/portal/teleport_down.mp3",
  "sfx-spawner-spawn": "sounds/scenery/spawner/spawn.mp3",
  "sfx-content-toggle": "sounds/scenery/content/toggle.mp3",
  "sfx-lights-flicker": "sounds/scenery/lights/flicker.mp3",
};
const ONE_SHOT_SFX_VOLUME = 0.3;
const FLICKER_SFX_VOLUME = 0.3;
const FLICKER_SOUND_MIN_INTERVAL_MS = 700;

const WEAPON_SHOT_SOUNDS: Readonly<Record<string, string>> = {
  "pulse-rifle": "sounds/shots/weapon/shot4.mp3",
  "byte-repeater": "sounds/shots/weapon/blaster.mp3",
  "scatter-array": "sounds/shots/weapon/shot1.mp3",
  "fork-driver": "sounds/shots/weapon/shot5.mp3",
  "trident": "sounds/shots/weapon/shot6.mp3",
  "needle-rail": "sounds/shots/weapon/blaster7.mp3",
  "packet-lobber": "sounds/shots/weapon/rocket.mp3",
  "cross-compiler": "sounds/shots/weapon/blaster2.mp3",
  "nova-cache": "sounds/shots/weapon/blaster10.mp3",
  "helix-emitter": "sounds/shots/weapon/blaster4.mp3",
  "sideband-projector": "sounds/shots/weapon/zap.mp3",
};
const ENEMY_SHOT_SOUNDS: Readonly<Record<string, string>> = {
  "shooter-light": "sounds/shots/weapon/blaster8.mp3",
  "shooter-heavy": "sounds/shots/weapon/blaster8.mp3",
  "sentry-light": "sounds/shots/weapon/blaster1.mp3",
  "sentry-heavy": "sounds/shots/weapon/blaster9.mp3",
  "sentry-scatter": "sounds/shots/weapon/blaster11.mp3",
  "packet-storm": "sounds/shots/weapon/blaster12.mp3",
  "fork-bomb": "sounds/shots/weapon/blaster12.mp3",
  "heap-titan": "sounds/shots/weapon/blaster9.mp3",
  "kimi-swarm": "sounds/shots/weapon/blaster8.mp3",
  "llama-herd": "sounds/shots/weapon/blaster11.mp3",
};
const DEFAULT_ENEMY_SHOT_SOUND = ENEMY_SHOT_SOUNDS["shooter-light"]!;
const DAMAGE_SOUNDS: readonly string[] = [
  "sounds/shots/damage/thud.mp3",
  "sounds/shots/damage/thud1.mp3",
  "sounds/shots/damage/thud2.mp3",
  "sounds/shots/damage/thud3.mp3",
  "sounds/shots/damage/thud4.mp3",
  "sounds/shots/damage/thud5.mp3",
  "sounds/shots/damage/thud6.mp3",
  "sounds/shots/damage/thud7.mp3",
  "sounds/shots/damage/thud8.mp3",
  "sounds/shots/damage/thud9.mp3",
  "sounds/shots/damage/thud10.mp3",
  "sounds/shots/damage/thud_heavy.mp3",
];
const EXPLOSION_SOUNDS: readonly string[] = [
  "sounds/effects/explosion/explosion.mp3",
  "sounds/effects/explosion/explosion1.mp3",
  "sounds/effects/explosion/explosion2.mp3",
  "sounds/effects/explosion/explosion3.mp3",
  "sounds/effects/explosion/explosion4.mp3",
  "sounds/effects/explosion/explosion5.mp3",
];
const COMBAT_SOUND_SOURCES: readonly string[] = [...new Set([
  ...Object.values(WEAPON_SHOT_SOUNDS),
  ...Object.values(ENEMY_SHOT_SOUNDS),
  ...DAMAGE_SOUNDS,
  ...EXPLOSION_SOUNDS,
])];
const SHOT_SFX_VOLUME = 0.1;
const ENEMY_SHOT_SFX_VOLUME = 0.1;
const DAMAGE_SFX_VOLUME = 0.1;
const EXPLOSION_SFX_VOLUME = 0.2;
const DAMAGE_SOUND_MIN_INTERVAL_MS = 80;
const EXPLOSION_SOUND_MIN_INTERVAL_MS = 120;

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length) % items.length]!;
}

interface WorldLight {
  light: Phaser.GameObjects.Light;
  baseIntensity: number;
  flickerAmount: number;
  flickerSeed: number;
  enabled: boolean;
  burstActive?: boolean;
  fullyLit?: boolean;
}

interface WorldBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface AreaLight extends Phaser.GameObjects.Light {
  areaSoftness?: number;
}

type EffectLightProfile = NonNullable<SpriteClip["light"]>;

interface KeyedEffect {
  effect: Phaser.GameObjects.Image;
  light: Phaser.GameObjects.Light | null;
  timer: Phaser.Time.TimerEvent | null;
  followPlayer: boolean;
}

function seededUnit(seed: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return ((value ^ value >>> 16) >>> 0) / 0xffffffff;
}

function roomIsBright(room: GraphNode): boolean {
  return room.isRoot || room.tag === "script" || Math.abs(room.id) % 2 === 0;
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
  private roomStatics = new Map<number, StaticObject[]>();
  private corridorStatics = new Map<string, StaticObject[]>();
  private bulletSprites = new Map<string, Phaser.GameObjects.Image>();
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
  private currentLightCullKey: string | null = null;
  private playerProtectionActive = false;
  private playerProtectionTintVisible = false;
  private playerDashTintActive = false;
  private lightingEnabled = false;
  private lightPipeline: EllipticalLightPipeline | null = null;
  private roomLights = new Map<number, WorldLight>();
  private corridorLights = new Map<string, WorldLight[]>();
  private lightProfiles: WorldLight[] = [];
  private floorMarkingTextures = new Set<string>();
  private floorMarkingTextureSerial = 0;
  private lastFlickerUpdate = -Infinity;
  private lastFlickerSoundAt = -Infinity;
  private lastDamageSoundAt = -Infinity;
  private lastExplosionSoundAt = -Infinity;
  private corridorBounds = new Map<string, WorldBounds>();
  private staticVisibility = new Map<StaticObject, boolean>();
  private bulletLights: Phaser.GameObjects.Light[] = [];
  private monsterAuras = new Map<string, Phaser.GameObjects.Light>();
  private lootAuras = new Map<string, Phaser.GameObjects.Light>();
  private portalAuras = new Map<string, Phaser.GameObjects.Light>();
  private activeEffectLights = new Set<Phaser.GameObjects.Light>();
  private decorationEffectLights = new Map<string, Phaser.GameObjects.Light>();
  private activeEffects = new Set<Phaser.GameObjects.Image>();
  private activeEffectTimers = new Set<Phaser.Time.TimerEvent>();
  private playerFollowingEffects = new Map<Phaser.GameObjects.Image, Phaser.GameObjects.Light | null>();
  private playerStateLight: Phaser.GameObjects.Light | null = null;
  private lastLootAnimationUpdate = -Infinity;
  private lastDecorationAnimationUpdate = -Infinity;
  private lastShadowOffsetUpdate = -Infinity;
  private keyedEffects = new Map<string, KeyedEffect>();
  private stationAmbient: Phaser.Sound.BaseSound | null = null;

  constructor(private readonly host: HTMLElement) {}

  start(options?: {
    onBootComplete?: () => void;
  }): void {
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
        this.load.audio(STATION_AMBIENT_KEY, STATION_AMBIENT_SRC);
        for (const [key, src] of Object.entries(ONE_SHOT_SOUNDS)) this.load.audio(key, src);
        for (const src of COMBAT_SOUND_SOURCES) this.load.audio(src, src);
      }

      create(): void {
        renderer.attach(this);
        options?.onBootComplete?.();
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
      this.host.dataset.bulletGlowMode = BULLET_LIGHTS_ENABLED ? "batched-light2d" : "off";
      this.host.dataset.bulletShape = "bar";
      this.host.dataset.flickerMode = "occasional-burst-35ms";
      this.host.dataset.flashlightColor = "ffffff";
      this.host.dataset.flashlightRadiusScale = String(FLASHLIGHT_RADIUS_SCALE);
      this.host.dataset.maxLights = String(MAX_LIGHTS);
      this.host.dataset.portalDownAuraColor = PORTAL_DOWN_AURA_COLOR.toString(16).padStart(6, "0");
      this.host.dataset.portalUpAuraColor = PORTAL_UP_AURA_COLOR.toString(16).padStart(6, "0");
    }
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.refreshCameraForResize, this);
    this.refreshFloorMarkingsAfterFontLoad();
    this.drawWorld();
    this.renderDecorations(this.currentDecorations, this.visited);
    this.renderObjects(this.currentStairs, this.currentLoot, this.visited, this.currentLootAssets);
    this.renderMonsters(this.currentMonsters);
    this.renderBullets(this.currentBullets);
    this.setPlayer(this.currentPlayer, this.currentPlayerHp, this.currentPlayerMaxHp, this.currentPlayerAsset);
    this.applyCameraMode(true);
    this.host.dataset.debugHitboxes = String(SHOW_DEBUG_GEOMETRY);
    (window as unknown as { __webcrawlScene?: Phaser.Scene }).__webcrawlScene = scene;
  }

  private refreshFloorMarkingsAfterFontLoad(): void {
    if (typeof document === "undefined" || !document.fonts) return;
    void document.fonts.load(`900 ${world(34)}px Prefix`).then(() => {
      // The first map can render while Prefix is still loading. Rebuild just
      // the static world so its canvas-backed floor textures use the real face.
      if (this.scene && this.layout) this.drawWorld();
    }).catch(() => undefined);
  }

  clear(): void {
    this.layout = null;
    this.cameraRoom = null;
    this.cameraRoomId = null;
    this.currentLightCullKey = null;
    this.scene?.cameras.main.stopFollow().setDeadzone().resetFX();
    this.background?.destroy();
    this.background = null;
    this.destroyStaticObjects();
    for (const object of this.bulletSprites.values()) object.destroy(true);
    this.bulletSprites.clear();
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
    for (const timer of this.activeEffectTimers) timer.remove();
    this.activeEffectTimers.clear();
    for (const effect of this.activeEffects) effect.destroy();
    this.activeEffects.clear();
    this.keyedEffects.clear();
    this.playerFollowingEffects.clear();
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
    delete this.host.dataset.fullRoomLights;
    delete this.host.dataset.rootRoomLightIntensity;
    delete this.host.dataset.bossRoomLightIntensity;
    delete this.host.dataset.enemyAuras;
    delete this.host.dataset.pickupAuras;
    delete this.host.dataset.bulletGlows;
    delete this.host.dataset.effectLights;
    delete this.host.dataset.followingEffects;
    delete this.host.dataset.followingEffectX;
    delete this.host.dataset.followingEffectY;
    delete this.host.dataset.sceneryShadows;
    delete this.host.dataset.monsterShadows;
  }

  playStationAmbient(): void {
    const scene = this.scene;
    if (!scene || !scene.cache.audio.exists(STATION_AMBIENT_KEY)) return;
    const sound = this.stationAmbient ??= scene.sound.add(STATION_AMBIENT_KEY, {
      loop: true,
      volume: 0,
    });
    scene.tweens.killTweensOf(sound);
    if (!sound.isPlaying && !sound.isPaused) sound.play();
    scene.tweens.add({
      targets: sound,
      volume: STATION_AMBIENT_VOLUME,
      duration: STATION_AMBIENT_FADE_MS,
      ease: "Linear",
    });
  }

  stopStationAmbient(): void {
    const scene = this.scene;
    const sound = this.stationAmbient;
    if (!scene || !sound) return;
    scene.tweens.killTweensOf(sound);
    scene.tweens.add({
      targets: sound,
      volume: 0,
      duration: STATION_AMBIENT_FADE_MS,
      ease: "Linear",
      onComplete: () => sound.stop(),
    });
  }

  playPickupSound(kind: "generic" | "ram" | "weapon"): void {
    this.playOneShot(`sfx-pickup-${kind}`);
  }

  playPortalSound(type: "up" | "down"): void {
    this.playOneShot(`sfx-portal-${type}`);
  }

  playSpawnerSpawnSound(): void {
    this.playOneShot("sfx-spawner-spawn");
  }

  playContentToggleSound(): void {
    this.playOneShot("sfx-content-toggle");
  }

  playWeaponShotSound(kind: string): void {
    this.playOneShot(WEAPON_SHOT_SOUNDS[kind] ?? WEAPON_SHOT_SOUNDS["pulse-rifle"]!, SHOT_SFX_VOLUME);
  }

  playEnemyShotSound(kind: string): void {
    this.playOneShot(ENEMY_SHOT_SOUNDS[kind] ?? DEFAULT_ENEMY_SHOT_SOUND, ENEMY_SHOT_SFX_VOLUME);
  }

  playDamageSound(): void {
    const now = performance.now();
    if (now - this.lastDamageSoundAt < DAMAGE_SOUND_MIN_INTERVAL_MS) return;
    this.lastDamageSoundAt = now;
    this.playOneShot(pickRandom(DAMAGE_SOUNDS), DAMAGE_SFX_VOLUME);
  }

  playExplosionSound(): void {
    const now = performance.now();
    if (now - this.lastExplosionSoundAt < EXPLOSION_SOUND_MIN_INTERVAL_MS) return;
    this.lastExplosionSoundAt = now;
    this.playOneShot(pickRandom(EXPLOSION_SOUNDS), EXPLOSION_SFX_VOLUME);
  }

  private playOneShot(key: string, volume = ONE_SHOT_SFX_VOLUME): void {
    // Never queue gameplay sounds while the tab is hidden; paused managers
    // would otherwise replay everything at once when it returns.
    if (document.hidden) return;
    const scene = this.scene;
    if (!scene || !scene.cache.audio.exists(key)) return;
    const sound = scene.sound.add(key, { volume });
    sound.play();
    sound.once(Phaser.Sound.Events.COMPLETE, () => sound.destroy());
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

    const corridorPlan = buildCorridorRenderPlan(this.layout, SEGMENT_SIZE);
    for (const link of this.layout.links) {
      const visible = this.visited.has(link.source.id) || this.visited.has(link.target.id);
      this.renderCorridor(link, corridorPlan, visible ? 1 : HIDDEN_WORLD_ALPHA);
      this.addCorridorLights(link, corridorPlan, visible);
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
      const alpha = this.visited.has(room.id) ? 1 : HIDDEN_WORLD_ALPHA;
      for (const object of this.roomStatics.get(room.id) ?? []) object.setAlpha(alpha);
    }
    for (const link of layout.links) {
      const alpha = this.visited.has(link.source.id) || this.visited.has(link.target.id) ? 1 : HIDDEN_WORLD_ALPHA;
      for (const object of this.corridorStatics.get(link.id) ?? []) object.setAlpha(alpha);
    }
    this.refreshLocalLightVisibility(true);
    this.updateStaticWorldVisibility();
  }

  private updateStaticWorldVisibility(): void {
    const camera = this.scene?.cameras.main;
    const layout = this.layout;
    if (!camera || !layout) return;

    const view = camera.worldView;
    const padding = world(128);
    const bounds: WorldBounds = {
      left: view.x - padding,
      right: view.x + view.width + padding,
      top: view.y - padding,
      bottom: view.y + view.height + padding,
    };
    const intersects = (candidate: WorldBounds): boolean =>
      candidate.right >= bounds.left &&
      candidate.left <= bounds.right &&
      candidate.bottom >= bounds.top &&
      candidate.top <= bounds.bottom;

    for (const room of layout.nodes) {
      for (const object of this.roomStatics.get(room.id) ?? []) this.setStaticVisible(object, intersects({
        left: room.x - room.width / 2,
        right: room.x + room.width / 2,
        top: room.y - room.height / 2,
        bottom: room.y + room.height / 2,
      }));
    }
    for (const link of layout.links) {
      for (const object of this.corridorStatics.get(link.id) ?? []) {
        this.setStaticVisible(object, intersects(this.corridorBounds.get(link.id) ?? {
          left: Infinity,
          right: -Infinity,
          top: Infinity,
          bottom: -Infinity,
        }));
      }
    }
  }

  private setStaticVisible(object: StaticObject | undefined, visible: boolean): void {
    if (!object || this.staticVisibility.get(object) === visible) return;
    object.setVisible(visible);
    this.staticVisibility.set(object, visible);
  }

  private renderRoom(room: GraphNode, alpha: number): void {
    const scene = this.scene;
    if (!scene) return;
    const left = room.x - room.width / 2;
    const top = room.y - room.height / 2;
    const floorContainer = this.rememberStatic(scene.add.container(0, 0).setDepth(ROOM_FLOOR_DEPTH).setAlpha(alpha));
    const floor = scene.add.tileSprite(left, top, room.width, room.height, textureKey(this.roomFloorAsset(room)))
      .setOrigin(0)
      .setTileScale(FLOOR_TILE_SCALE);
    this.illuminate(floor);
    floorContainer.add(floor);
    this.addRoomFloorDetails(floorContainer, room);
    this.addRoomFloorMarking(floorContainer, room);
    const statics: StaticObject[] = [floorContainer];
    const doors = this.roomDoors(room);
    for (const wall of this.addRoomWalls(room, doors)) {
      statics.push(this.rememberStatic(wall.setAlpha(alpha)));
    }
    for (const door of doors) {
      const doorObject = this.createDoor(door.position, door.side);
      statics.push(this.rememberStatic(doorObject.setAlpha(alpha).setDepth(doorDepth(door.side, door.position.y))));
    }
    this.roomStatics.set(room.id, statics);
  }

  private renderCorridor(
    link: DungeonLayout["links"][number],
    plan: CorridorRenderPlan,
    alpha: number,
  ): void {
    const scene = this.scene;
    if (!scene) return;
    const floorContainer = this.rememberStatic(scene.add.container(0, 0).setDepth(CORRIDOR_FLOOR_DEPTH).setAlpha(alpha));
    const markingContainer = this.rememberStatic(scene.add.container(0, 0).setDepth(CORRIDOR_MARKING_DEPTH).setAlpha(alpha));
    const statics: StaticObject[] = [floorContainer, markingContainer];
    this.corridorBounds.set(link.id, link.points.reduce<WorldBounds>((bounds, point) => ({
      left: Math.min(bounds.left, point.x - link.width / 2),
      right: Math.max(bounds.right, point.x + link.width / 2),
      top: Math.min(bounds.top, point.y - link.width / 2),
      bottom: Math.max(bounds.bottom, point.y + link.width / 2),
    }), {
      left: Infinity,
      right: -Infinity,
      top: Infinity,
      bottom: -Infinity,
    }));
    for (const segment of plan.segments.filter(candidate => candidate.ownerLinkId === link.id)) {
      const floor = this.createCorridorFloor(segment);
      this.illuminate(floor);
      floorContainer.add(floor);
    }
    for (const floorPlan of plan.junctionFloors.filter(candidate => candidate.ownerLinkId === link.id)) {
      const floor = this.createCorridorJunctionFloor(floorPlan.x, floorPlan.y, floorPlan.seed);
      this.illuminate(floor);
      floorContainer.add(floor);
    }
    for (const wall of plan.walls.filter(candidate => candidate.ownerLinkId === link.id)) {
      const asset = ({
        N: ASSETS.wallHorizontalTop,
        E: ASSETS.wallVerticalRight,
        S: ASSETS.wallHorizontalBottom,
        W: ASSETS.wallVerticalLeft,
      } as const)[wall.side];
      statics.push(this.rememberStatic(this.createEnvironmentModule(wall.x, wall.y, asset).setAlpha(alpha)));
    }
    for (const corner of plan.outerCorners.filter(candidate => candidate.ownerLinkId === link.id)) {
      const asset = ({
        "top-left": ASSETS.wallCornerTopLeft,
        "top-right": ASSETS.wallCornerTopRight,
        "bottom-left": ASSETS.wallCornerBottomLeft,
        "bottom-right": ASSETS.wallCornerBottomRight,
      } as const)[corner.kind];
      statics.push(this.rememberStatic(this.createEnvironmentModule(corner.x, corner.y, asset).setAlpha(alpha)));
    }
    for (const corner of plan.corners.filter(candidate => candidate.ownerLinkId === link.id)) {
      const asset = ({
        "top-left": ASSETS.corridorCornerTopLeft,
        "top-right": ASSETS.corridorCornerTopRight,
        "bottom-left": ASSETS.corridorCornerBottomLeft,
        "bottom-right": ASSETS.corridorCornerBottomRight,
      } as const)[corner.kind];
      statics.push(this.rememberStatic(this.createEnvironmentModule(corner.x, corner.y, asset).setAlpha(alpha)));
    }
    for (const marking of plan.markings.filter(candidate => candidate.ownerLinkId === link.id)) {
      this.addCorridorSegmentMarking(
        markingContainer,
        marking.start,
        marking.end,
        marking.position,
        marking.label,
        marking.lateralOffset,
      );
    }
    this.corridorStatics.set(link.id, statics);
  }

  private roomFloorAsset(room: GraphNode): string {
    if (room.isRoot) return ASSETS.floorPlain;
    if (room.tag === "script") return ASSETS.floorHex;
    return BASE_FLOOR_ASSETS[room.lootSeed % BASE_FLOOR_ASSETS.length] ?? ASSETS.floorPlain;
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
      const damaged = seed % 100 < FLOOR_DAMAGE_CHANCE_PERCENT;
      const asset = damaged
        ? DAMAGED_FLOOR_ASSETS[(seed >>> 8) % DAMAGED_FLOOR_ASSETS.length] ?? ASSETS.floorCracks
        : BASE_FLOOR_ASSETS[(room.lootSeed + index * 5) % BASE_FLOOR_ASSETS.length] ?? ASSETS.floorPlain;
      const detail = scene.add.image(
        room.x - room.width / 2 + column * FLOOR_TILE_SIZE + FLOOR_TILE_SIZE / 2,
        room.y - room.height / 2 + row * FLOOR_TILE_SIZE + FLOOR_TILE_SIZE / 2,
        textureKey(asset),
      ).setDisplaySize(FLOOR_TILE_SIZE, FLOOR_TILE_SIZE);
      this.illuminate(detail);
      container.add(detail);
    }
  }

  private addRoomFloorMarking(container: Phaser.GameObjects.Container, room: GraphNode): void {
    const rotated = (room.lootSeed >>> 1) % 4 === 0;
    const label = this.createFloorMarking(
      0,
      0,
      room.floorLabel,
      world(34),
      rotated ? Math.PI / 2 : 0,
    );
    const maxWidth = (rotated ? room.height : room.width) - world(128);
    if (label.displayWidth > maxWidth) label.setScale(maxWidth / label.displayWidth);
    const boundsWidth = rotated ? label.displayHeight : label.displayWidth;
    const boundsHeight = rotated ? label.displayWidth : label.displayHeight;
    const inset = world(24);
    const topLeft = (room.lootSeed & 1) === 0;
    const direction = topLeft ? -1 : 1;
    const targetX = room.x + direction * room.width * 0.2;
    const targetY = room.y + direction * room.height * 0.2;
    const minX = room.x - room.width / 2 + inset + boundsWidth / 2;
    const maxX = room.x + room.width / 2 - inset - boundsWidth / 2;
    const minY = room.y - room.height / 2 + inset + boundsHeight / 2;
    const maxY = room.y + room.height / 2 - inset - boundsHeight / 2;
    label.setPosition(
      Math.max(minX, Math.min(maxX, targetX)),
      Math.max(minY, Math.min(maxY, targetY)),
    );
    container.add(label);
  }

  private addCorridorSegmentMarking(
    container: Phaser.GameObjects.Container,
    start: Point,
    end: Point,
    position: Point,
    label: string,
    lateralOffset: number,
  ): void {
    const vertical = start.x === end.x;
    const pointsTowardStart = end.x < start.x || end.y > start.y;
    const text = label
      ? pointsTowardStart ? `< ${label}` : `${label} >`
      : pointsTowardStart ? "<" : ">";
    const marking = this.createFloorMarking(
      position.x + (vertical ? lateralOffset : 0),
      position.y + (vertical ? 0 : lateralOffset),
      text,
      world(25),
      vertical ? -Math.PI / 2 : 0,
    );
    if (marking.displayWidth > SEGMENT_SIZE) marking.setScale(SEGMENT_SIZE / marking.displayWidth);
    container.add(marking);
  }

  private createFloorMarking(
    x: number,
    y: number,
    text: string,
    fontSize: number,
    rotation = 0,
  ): Phaser.GameObjects.Image {
    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");
    if (!measureContext) throw new Error("Unable to create floor-marking texture.");
    const font = `900 ${fontSize}px Prefix, monospace`;
    measureContext.font = font;
    const metrics = measureContext.measureText(text);
    const padding = world(24);
    const inkWidth = Math.max(metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight);
    const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const width = Math.ceil(inkWidth + padding * 2);
    const height = Math.ceil(Math.max(fontSize * 1.45, inkHeight) + padding * 2);
    const key = `floor-marking:${this.floorMarkingTextureSerial++}`;
    const texture = this.scene!.textures.createCanvas(key, width, height);
    if (!texture) throw new Error("Unable to allocate floor-marking texture.");
    const context = texture.context;
    context.clearRect(0, 0, width, height);
    context.font = font;
    context.fillStyle = "rgba(236, 232, 219, 0.46)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, width / 2, height / 2);
    texture.refresh();
    this.floorMarkingTextures.add(key);
    return this.illuminate(this.scene!.add.image(x, y, key))
      .setOrigin(0.5)
      .setRotation(rotation);
  }

  private createCorridorFloor(segment: CorridorSegmentPlan): Phaser.GameObjects.TileSprite {
    const floorAsset = BASE_FLOOR_ASSETS[Math.abs(segment.seed) % BASE_FLOOR_ASSETS.length] ?? ASSETS.floorTread;
    if (segment.start.y === segment.end.y) {
      return this.createAlignedFloor(
        Math.min(segment.start.x, segment.end.x),
        segment.start.y - segment.width / 2,
        Math.abs(segment.end.x - segment.start.x),
        segment.width,
        floorAsset,
      );
    }
    return this.createAlignedFloor(
      segment.start.x - segment.width / 2,
      Math.min(segment.start.y, segment.end.y),
      segment.width,
      Math.abs(segment.end.y - segment.start.y),
      floorAsset,
    );
  }

  private createCorridorJunctionFloor(x: number, y: number, seed: number): Phaser.GameObjects.TileSprite {
    const floorAsset = BASE_FLOOR_ASSETS[Math.abs(seed) % BASE_FLOOR_ASSETS.length] ?? ASSETS.floorTread;
    return this.createAlignedFloor(
      x - SEGMENT_SIZE / 2,
      y - SEGMENT_SIZE / 2,
      SEGMENT_SIZE,
      SEGMENT_SIZE,
      floorAsset,
    );
  }

  private createAlignedFloor(
    left: number,
    top: number,
    width: number,
    height: number,
    asset: string,
  ): Phaser.GameObjects.TileSprite {
    return this.scene!.add.tileSprite(left, top, width, height, textureKey(asset))
      .setOrigin(0)
      .setTileScale(FLOOR_TILE_SCALE)
      .setTilePosition(left / FLOOR_TILE_SCALE, top / FLOOR_TILE_SCALE);
  }

  private createEnvironmentModule(x: number, y: number, asset: string): Phaser.GameObjects.Image {
    return this.illuminate(
      this.scene!.add.image(x, y, textureKey(asset))
        .setDisplaySize(SEGMENT_SIZE, SEGMENT_SIZE)
        .setDepth(wallDepth(asset, y)),
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
        position: this.roomDoorPosition(link.points[link.points.length - 1]!, link.targetDirection ?? this.opposite(link.direction)),
        side: link.targetDirection ?? this.opposite(link.direction),
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
    room: GraphNode,
    doors: ReadonlyArray<{ position: Point; side: "N" | "E" | "S" | "W" }>,
  ): Phaser.GameObjects.Image[] {
    const walls: Phaser.GameObjects.Image[] = [];
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

    walls.push(this.createEnvironmentModule(left + SEGMENT_SIZE / 2, top + SEGMENT_SIZE / 2, ASSETS.wallCornerTopLeft));
    walls.push(this.createEnvironmentModule(left + room.width - SEGMENT_SIZE / 2, top + SEGMENT_SIZE / 2, ASSETS.wallCornerTopRight));
    walls.push(this.createEnvironmentModule(left + SEGMENT_SIZE / 2, top + room.height - SEGMENT_SIZE / 2, ASSETS.wallCornerBottomLeft));
    walls.push(this.createEnvironmentModule(left + room.width - SEGMENT_SIZE / 2, top + room.height - SEGMENT_SIZE / 2, ASSETS.wallCornerBottomRight));

    for (let column = 1; column < columns - 1; column += 1) {
      const x = left + (column + 0.5) * SEGMENT_SIZE;
      if (!isDoorCell("N", column)) walls.push(this.createEnvironmentModule(x, top + SEGMENT_SIZE / 2, ASSETS.wallHorizontalTop));
      if (!isDoorCell("S", column)) walls.push(this.createEnvironmentModule(x, top + room.height - SEGMENT_SIZE / 2, ASSETS.wallHorizontalBottom));
    }
    for (let row = 1; row < rows - 1; row += 1) {
      const y = top + (row + 0.5) * SEGMENT_SIZE;
      if (!isDoorCell("W", row)) walls.push(this.createEnvironmentModule(left + SEGMENT_SIZE / 2, y, ASSETS.wallVerticalLeft));
      if (!isDoorCell("E", row)) walls.push(this.createEnvironmentModule(left + room.width - SEGMENT_SIZE / 2, y, ASSETS.wallVerticalRight));
    }
    return walls;
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
    for (const key of this.floorMarkingTextures) this.scene?.textures.remove(key);
    this.floorMarkingTextures.clear();
    for (const profile of this.roomLights.values()) this.scene?.lights.removeLight(profile.light);
    this.roomLights.clear();
    for (const profiles of this.corridorLights.values()) {
      for (const profile of profiles) this.scene?.lights.removeLight(profile.light);
    }
    this.corridorLights.clear();
    this.lightProfiles.length = 0;
    this.corridorBounds.clear();
    this.staticVisibility.clear();
    this.roomStatics.clear();
    this.corridorStatics.clear();
  }

  private addRoomLight(room: GraphNode, visible: boolean): void {
    if (!this.lightingEnabled || !this.scene) return;
    const seed = room.lootSeed + room.id * 101;
    const bossArena = room.tag === "script";
    const dimRoom = !roomIsBright(room);
    const dimRoomColors = [0x7ec8ff, 0x8edaff, 0xa6c8ff] as const;
    const roomRadius = Math.hypot(room.width, room.height) / 2;
    const dimCoverage = 0.1 + seededUnit(seed + 43) * 0.2;
    const brightCoverage = room.isRoot ? 0.9 : 0.6 + seededUnit(seed + 89) * 0.3;
    const baseIntensity = bossArena
      ? 1.35
      : dimRoom
        ? 0.3 + seededUnit(seed + 29) * 0.15
        : 0.82 + seededUnit(seed + 29) * 0.16;
    const radius = bossArena
      ? roomRadius * 0.9
      : dimRoom
        ? roomRadius * dimCoverage
        : roomRadius * brightCoverage;
    const color = bossArena
      ? 0xff3d42
      : dimRoom
        ? dimRoomColors[Math.abs(seed) % dimRoomColors.length]!
        : 0xf4fbff;
    const flickerAmount = !bossArena && Math.abs(room.id) % 4 === 2
      ? 0.16 + seededUnit(seed + 71) * 0.12
      : 0;
    const light = this.scene.lights.addLight(room.x, room.y, radius, color, baseIntensity) as AreaLight;
    light.areaSoftness = 1;
    light.setVisible(visible);
    const profile = {
      light,
      baseIntensity,
      flickerAmount,
      flickerSeed: seed,
      enabled: visible,
      fullyLit: !dimRoom,
    };
    this.roomLights.set(room.id, profile);
    this.lightProfiles.push(profile);
  }

  private addCorridorLights(
    link: DungeonLayout["links"][number],
    plan: CorridorRenderPlan,
    visible: boolean,
  ): void {
    if (!this.lightingEnabled || !this.scene) return;
    const profiles: WorldLight[] = [];
    const brightCorridor = roomIsBright(link.target);
    const bossCorridor = link.target.tag === "script";
    const baseIntensity = bossCorridor ? 0.78 : brightCorridor ? 0.76 : 0.24;
    const radius = Math.max(link.width * 1.15, CORRIDOR_LIGHT_SPACING * 0.8);
    const color = bossCorridor ? 0xd94b52 : brightCorridor ? 0xeaf8ff : 0x5f8ca8;
    const areaSoftness = brightCorridor ? 0.8 : 0.45;
    for (const segment of plan.segments.filter(candidate => candidate.ownerLinkId === link.id)) {
      const start = segment.start;
      const end = segment.end;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const count = Math.max(1, Math.ceil(length / CORRIDOR_LIGHT_SPACING));
      for (let index = 0; index < count; index += 1) {
        const progress = (index + 0.5) / count;
        const light = this.scene.lights.addLight(
          start.x + (end.x - start.x) * progress,
          start.y + (end.y - start.y) * progress,
          radius,
          color,
          baseIntensity,
        ) as AreaLight;
        light.areaSoftness = areaSoftness;
        light.setVisible(visible);
        const profile = {
          light,
          baseIntensity,
          flickerAmount: 0,
          flickerSeed: segment.seed,
          enabled: visible,
        };
        profiles.push(profile);
        this.lightProfiles.push(profile);
      }
    }
    this.corridorLights.set(link.id, profiles);
  }

  private updateWorldLightDataset(): void {
    const layout = this.layout;
    if (!layout) return;
    const visibleRooms = layout.nodes.filter(room => this.roomLights.get(room.id)?.enabled);
    const visibleCorridors = layout.links.filter(link =>
      this.corridorLights.get(link.id)?.some(profile => profile.enabled)
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
    ].filter(profile => profile.enabled && profile.flickerAmount > 0).length));
    this.setHostData("roomLightIntensities", [...this.roomLights.values()]
      .map(profile => profile.baseIntensity.toFixed(2))
      .join(","));
    this.setHostData("roomLightRadii", [...this.roomLights.values()]
      .map(profile => Math.round(profile.light.radius))
      .join(","));
    this.setHostData("fullRoomLights", String([...this.roomLights.values()]
      .filter(profile => profile.fullyLit).length));
    const root = layout.nodes.find(room => room.isRoot);
    const boss = layout.nodes.find(room => room.tag === "script");
    if (root) this.setHostData("rootRoomLightIntensity", this.roomLights.get(root.id)!.baseIntensity.toFixed(2));
    if (boss) this.setHostData("bossRoomLightIntensity", this.roomLights.get(boss.id)!.baseIntensity.toFixed(2));
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
    const cullKey = [
      currentRoom.id,
      Math.floor(this.currentPlayer.x / CORRIDOR_LIGHT_CULL_CELL),
      Math.floor(this.currentPlayer.y / CORRIDOR_LIGHT_CULL_CELL),
      this.visited.size,
    ].join(":");
    if (!force && this.currentLightCullKey === cullKey) return;
    this.currentLightCullKey = cullKey;
    const localRooms = new Set<number>([currentRoom.id]);
    for (const link of layout.links) {
      if (link.source.id === currentRoom.id) localRooms.add(link.target.id);
      if (link.target.id === currentRoom.id) localRooms.add(link.source.id);
    }
    for (const [roomId, profile] of this.roomLights) {
      profile.enabled = localRooms.has(roomId);
      profile.light.setVisible(profile.enabled && this.lightOnScreen(profile));
    }
    for (const link of layout.links) {
      const revealed = this.visited.has(link.source.id) || this.visited.has(link.target.id);
      for (const profile of this.corridorLights.get(link.id) ?? []) {
        profile.enabled = revealed;
        profile.light.setVisible(revealed && this.lightOnScreen(profile));
      }
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

  private cullLightsToView(): void {
    for (const profile of this.lightProfiles) {
      const visible = profile.enabled && this.lightOnScreen(profile);
      if (visible !== profile.light.visible) profile.light.setVisible(visible);
    }
  }

  private lightOnScreen(profile: WorldLight): boolean {
    const view = this.scene?.cameras.main.worldView;
    if (!view) return true;
    const light = profile.light;
    const pad = light.radius + world(96);
    return (
      light.x + pad >= view.x &&
      light.x - pad <= view.right &&
      light.y + pad >= view.y &&
      light.y - pad <= view.bottom
    );
  }

  updateLighting(time: number): void {
    this.updateStaticWorldVisibility();
    this.cullLightsToView();
    if (time - this.lastFlickerUpdate < FLICKER_STEP_MS) return;
    this.lastFlickerUpdate = time;
    for (const profile of this.lightProfiles) {
      if (!profile.light.visible || profile.flickerAmount === 0) continue;
      const shiftedTime = time + seededUnit(profile.flickerSeed + 17) * FLICKER_BURST_INTERVAL_MS;
      const burst = Math.floor(shiftedTime / FLICKER_BURST_INTERVAL_MS);
      const burstElapsed = shiftedTime % FLICKER_BURST_INTERVAL_MS;
      const burstDuration = 120 + seededUnit(profile.flickerSeed + burst * 977 + 31) * 160;
      const burstActive = seededUnit(profile.flickerSeed + burst * 977) < 0.3 && burstElapsed < burstDuration;
      if (burstActive && !profile.burstActive && time - this.lastFlickerSoundAt >= FLICKER_SOUND_MIN_INTERVAL_MS) {
        this.lastFlickerSoundAt = time;
        this.playOneShot("sfx-lights-flicker", FLICKER_SFX_VOLUME);
      }
      profile.burstActive = burstActive;
      const step = Math.floor(shiftedTime / FLICKER_STEP_MS);
      const illuminated = !burstActive || seededUnit(profile.flickerSeed + step * 31) > 0.42;
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
    return this.scene!.add.image(0, 0, textureKey(asset))
      .setName("shadow")
      .setTintFill(0x000000)
      .setAlpha(0.3);
  }

  private applyShadowOffset(shadow: Phaser.GameObjects.Image, x: number, y: number, size: number): void {
    const dx = x - this.currentPlayer.x;
    const dy = y - this.currentPlayer.y;
    const length = Math.hypot(dx, dy);
    if (length < world(1)) {
      shadow.setPosition(SHADOW_OFFSET_X, SHADOW_OFFSET_Y);
      return;
    }
    const distance = Math.min(SHADOW_MAX_DISTANCE, Math.max(SHADOW_MIN_DISTANCE, size * SHADOW_DISTANCE_SCALE));
    shadow.setPosition(dx / length * distance, dy / length * distance);
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
      if (item.contentTurningOff) {
        return {
          clip: {
            ...spawn,
            // The on frame is already visible before shutdown begins; reverse the
            // transition itself, then settle into the normal off frame.
            frames: [...spawn.frames.slice(0, -1)].reverse().concat(item.visual.normal.frames[0]!),
            holdLast: true,
          },
          elapsed: Math.max(0, now - item.spawnAnimationStartedAt),
        };
      }
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
      this.applyShadowOffset(shadow, item.x, item.y, item.size);
      const isDebris = item.destroyed ||
        item.kind === "debris" ||
        item.kind === "doorway-debris" ||
        item.definitionId.startsWith("debris");
      const container = scene.add.container(item.x, item.y, [shadow, sprite])
        .setDepth(isDebris ? DEBRIS_DEPTH : yDepth(item.y));
      this.decorationSprites.set(item.id, sprite);
      this.decorationShadows.set(item.id, shadow);
      this.syncDecorationEffectLight(item, state);
      if (item.destructible && !item.destroyed && item.hp != item.maxHp) {
        const barWidth = world(44);
        const barY = -item.size * state.clip.origin.y + (item.healthBarTop ?? 0) * item.size - world(8);
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
    if (now - this.lastDecorationAnimationUpdate < 50) return;
    this.lastDecorationAnimationUpdate = now;
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

  updateShadowOffsets(items: readonly Decoration[], now: number): void {
    if (now - this.lastShadowOffsetUpdate < 50) return;
    this.lastShadowOffsetUpdate = now;
    for (const item of items) {
      const shadow = this.decorationShadows.get(item.id);
      if (shadow) this.applyShadowOffset(shadow, item.x, item.y, item.size);
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
        this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(yDepth(item.y, 0.5)));
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
        this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(yDepth(item.y, 0.5)));
        continue;
      }
      const sprite = this.illuminate(scene.add.image(0, 0, textureKey(asset)).setDisplaySize(definition.size, definition.size));
      this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(yDepth(item.y, 0.5)));
    }
    this.refreshLocalLightVisibility(true);
  }

  updateLootAnimations(items: readonly LootItem[], now: number): void {
    if (now - this.lastLootAnimationUpdate < 100) return;
    this.lastLootAnimationUpdate = now;
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
        container = scene.add.container(stair.x, stair.y, [sprite]).setDepth(yDepth(stair.y));
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
        this.applyShadowOffset(shadow, item.x, item.y, item.size);
        const barWidth = item.bossKind ? item.size * 0.68 : item.miniboss ? item.size * 0.72 : world(44);
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
        container = scene.add.container(item.x, item.y, children).setDepth(yDepth(item.y, item.dead ? -1 : 0));
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
      container.setPosition(item.x, item.y).setDepth(yDepth(item.y, item.dead ? -1 : 0));
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
    if (this.monsters.size === 0) return;
    let assetChanged = false;
    const now = performance.now();
    for (const item of items) {
      const container = this.monsters.get(item.id);
      if (!container) continue;
      container.setPosition(item.x, item.y).setDepth(yDepth(item.y, item.dead ? -1 : 0));
      const sprite = container.getByName("sprite") as Phaser.GameObjects.Image;
      const previousAsset = sprite.texture.key;
      this.applyMonsterFrame(container, item, now);
      const shadow = container.getByName("shadow") as Phaser.GameObjects.Image | null;
      if (shadow) this.applyShadowOffset(shadow, item.x, item.y, item.size);
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
      const elapsed = monsterWalkElapsed(visual.walk, now, item.seed, item.speed);
      return { asset: this.clipAsset(visual.walk, elapsed), animation: "walk", clip: visual.walk, elapsed };
    }
    return { asset: visual.normal.frames[0]!, animation: "normal", clip: visual.normal, elapsed: 0 };
  }

  renderBullets(items: readonly Bullet[]): void {
    this.currentBullets = items;
    this.setHostData("bullets", String(items.length));
    const scene = this.scene;
    if (!scene) return;
    const visibleIds = new Set(items.map(item => item.id));
    for (const [id, object] of this.bulletSprites) {
      if (!visibleIds.has(id)) {
        object.destroy(true);
        this.bulletSprites.delete(id);
      }
    }
    for (const bullet of items) {
      let sprite = this.bulletSprites.get(bullet.id);
      if (!sprite) {
        sprite = this.createBulletSprite(bullet);
        this.bulletSprites.set(bullet.id, sprite);
      }
      sprite.setPosition(bullet.x, bullet.y).setDepth(yDepth(bullet.y + bullet.depthOffsetY));
      this.applyBulletSprite(sprite, bullet);
    }
    this.syncBulletLights(items);
    this.setHostData("bulletGlows", String(items.length));
    this.setHostData("bulletShape", "bar");
    this.renderDebugGeometry();
  }

  private createBulletSprite(bullet: Bullet): Phaser.GameObjects.Image {
    return this.scene!.add.image(bullet.x, bullet.y, textureKey(ASSETS.bullet))
      .setBlendMode(Phaser.BlendModes.ADD);
  }

  private applyBulletSprite(sprite: Phaser.GameObjects.Image, bullet: Bullet): void {
    const radius = bullet.radius ?? DEFAULT_BULLET_SPEC.radius;
    const speed = Math.hypot(bullet.vx, bullet.vy);
    const angle = speed > 0 ? Math.atan2(bullet.vy, bullet.vx) : 0;
    const trailLength = Math.min(world(78), Math.max(world(18), speed * 0.045));
    sprite.setTint(this.bulletColor(bullet));
    sprite.setDisplaySize(Math.max(world(12), radius * 9.2), (trailLength + radius * 2) * 1.25);
    sprite.setRotation(angle + Math.PI / 2);
  }

  bulletColor(bullet: Bullet): number {
    if (bullet.style === "shockwave") return 0xffa34d;
    if (bullet.style === "boss") return 0xee78ff;
    if (bullet.owner === "enemy") return 0xff596e;
    return bullet.weaponKind ? WEAPON_COLORS[bullet.weaponKind] : 0x86fff0;
  }

  private syncBulletLights(items: readonly Bullet[]): void {
    if (!BULLET_LIGHTS_ENABLED || !this.lightingEnabled || !this.scene) return;
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
      this.player = scene.add.container(position.x, position.y, [this.playerSprite]).setDepth(yDepth(position.y));
    }
    this.player.setPosition(position.x, position.y).setDepth(yDepth(position.y));
    this.syncPlayerFollowingEffects();
    if (scene.textures.exists(textureKey(asset))) this.playerSprite!.setTexture(textureKey(asset));
    this.applyClip(this.playerSprite!, clip, PLAYER_SPEC.spriteSize, 0, asset);
    this.applyPlayerProtectionTint();
    this.syncPlayerStateLight();
    this.refreshLocalLightVisibility();
    this.renderDebugGeometry();
  }

  setPlayerProtection(active: boolean, tintVisible: boolean): void {
    if (this.playerProtectionActive === active && this.playerProtectionTintVisible === tintVisible) return;
    this.playerProtectionActive = active;
    this.playerProtectionTintVisible = tintVisible;
    this.setHostData("playerInvulnerable", String(active));
    this.setHostData("playerProtectionTinted", String(active && tintVisible));
    this.applyPlayerProtectionTint();
    this.syncPlayerStateLight();
  }

  setPlayerDashTint(active: boolean): void {
    if (this.playerDashTintActive === active) return;
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
      axisX: dx / rawDistance,
      axisY: dy / rawDistance,
      majorRadius: (world(244) + world(156) * distanceRatio) * FLASHLIGHT_RADIUS_SCALE,
      minorRadius: (world(224) + world(4) * distanceRatio) * FLASHLIGHT_RADIUS_SCALE,
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
    const graphics = this.debugGraphics ??= this.scene.add.graphics().setDepth(DEBUG_DEPTH);
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
    if (this.currentPlayerAsset === asset) return;
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

  spawnEffect(
    clip: SpriteClip | undefined,
    x: number,
    y: number,
    baseSize: number,
    options: { key?: string; lightColor?: number; followPlayer?: boolean } = {},
  ): void {
    const scene = this.scene;
    if (!scene || !clip?.frames.length) return;
    const profile = clip.light ?? EFFECT_LIGHT_FALLBACK;
    const lightColor = options.lightColor ?? profile.color;
    const followPlayer = options.followPlayer ?? false;
    const key = options.key;
    const existing = key ? this.keyedEffects.get(key) : undefined;
    if (key && existing) {
      this.resetKeyedEffect(existing, clip, x, y, baseSize, profile, lightColor, followPlayer, key);
      return;
    }
    const effect = scene.add.image(x, y, textureKey(clip.frames[0]!))
      .setDepth(OVERHEAD_DEPTH)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.activeEffects.add(effect);
    this.setHostData("lastEffect", clip.frames[0]!);
    this.setHostData("effectSpriteMode", "emissive");
    this.applyClip(effect, clip, baseSize);
    const light = this.lightingEnabled
      ? scene.lights.addLight(x, y, Math.max(world(52), baseSize * profile.radiusScale), lightColor, profile.intensity)
      : null;
    if (light) {
      this.activeEffectLights.add(light);
      this.updateEffectLightDataset();
    }
    if (followPlayer) {
      this.playerFollowingEffects.set(effect, light);
      this.syncPlayerFollowingEffects();
    }
    const timer = this.startEffectAnimation(effect, clip, baseSize, profile, light, key);
    if (key) {
      this.keyedEffects.set(key, { effect, light, timer, followPlayer });
    }
  }

  private resetKeyedEffect(
    record: KeyedEffect,
    clip: SpriteClip,
    x: number,
    y: number,
    baseSize: number,
    profile: EffectLightProfile,
    lightColor: number,
    followPlayer: boolean,
    key: string,
  ): void {
    record.followPlayer = followPlayer;
    record.effect.setPosition(x, y);
    this.applyClip(record.effect, clip, baseSize);
    if (record.light) {
      record.light.x = x;
      record.light.y = y;
      record.light.setColor(lightColor);
      record.light.setRadius(Math.max(world(52), baseSize * profile.radiusScale));
      record.light.setIntensity(profile.intensity);
    }
    if (followPlayer) {
      this.playerFollowingEffects.set(record.effect, record.light);
      this.syncPlayerFollowingEffects();
    } else {
      this.playerFollowingEffects.delete(record.effect);
    }
    if (record.timer) {
      record.timer.remove();
      this.activeEffectTimers.delete(record.timer);
    }
    record.timer = this.startEffectAnimation(record.effect, clip, baseSize, profile, record.light, key);
  }

  private startEffectAnimation(
    effect: Phaser.GameObjects.Image,
    clip: SpriteClip,
    baseSize: number,
    profile: EffectLightProfile,
    light: Phaser.GameObjects.Light | null,
    key?: string,
  ): Phaser.Time.TimerEvent {
    const scene = this.scene!;
    let frameIndex = 0;
    const timer = scene.time.addEvent({
      delay: clip.frameDurationMs,
      repeat: clip.frames.length - 1,
      callback: () => {
        if (!effect.scene || !effect.active) {
          this.finishEffect(timer, effect, light, key);
          return;
        }
        if (frameIndex >= clip.frames.length - 1) {
          effect.destroy();
          this.finishEffect(timer, effect, light, key);
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
    this.activeEffectTimers.add(timer);
    return timer;
  }

  private finishEffect(
    timer: Phaser.Time.TimerEvent,
    effect: Phaser.GameObjects.Image,
    light: Phaser.GameObjects.Light | null,
    key?: string,
  ): void {
    timer.remove();
    this.activeEffectTimers.delete(timer);
    this.activeEffects.delete(effect);
    this.playerFollowingEffects.delete(effect);
    if (key) this.keyedEffects.delete(key);
    this.syncPlayerFollowingEffects();
    if (light) {
      this.scene?.lights.removeLight(light);
      this.activeEffectLights.delete(light);
      this.updateEffectLightDataset();
    }
  }

  private syncPlayerFollowingEffects(): void {
    for (const [effect, light] of this.playerFollowingEffects) {
      effect.setPosition(this.currentPlayer.x, this.currentPlayer.y);
      if (light) {
        light.x = this.currentPlayer.x;
        light.y = this.currentPlayer.y;
      }
    }
    this.setHostData("followingEffects", String(this.playerFollowingEffects.size));
    if (this.playerFollowingEffects.size === 0) {
      delete this.host.dataset.followingEffectX;
      delete this.host.dataset.followingEffectY;
      return;
    }
    this.setHostData("followingEffectX", String(Math.round(this.currentPlayer.x)));
    this.setHostData("followingEffectY", String(Math.round(this.currentPlayer.y)));
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
    if (
      !immediate &&
      this.cameraTarget &&
      this.currentCameraTarget.x === position.x &&
      this.currentCameraTarget.y === position.y
    ) return;
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
    this.setCameraTarget(this.currentCameraTarget);
    camera.startFollow(this.cameraTarget!, false, CAMERA_FOLLOW_LERP, CAMERA_FOLLOW_LERP);
    camera.setDeadzone();
    const zoom = this.cameraRoom ? BOSS_CAMERA_SCALE : CAMERA_SCALE;
    if (this.cameraRoom) {
      camera.setZoom(zoom);
      return;
    }
    if (immediate) {
      camera.setZoom(zoom).centerOn(this.currentCameraTarget.x, this.currentCameraTarget.y);
    } else {
      camera.zoomTo(zoom, CAMERA_TRANSITION_MS, "Sine.easeInOut", true);
    }
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

  isWithinMonsterActivityRange(x: number, y: number, screens = 2): boolean {
    const view = this.scene?.cameras.main.worldView;
    if (!view) return true;
    return (
      x >= view.x - view.width * screens &&
      x <= view.x + view.width * (screens + 1) &&
      y >= view.y - view.height * screens &&
      y <= view.y + view.height * (screens + 1)
    );
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
