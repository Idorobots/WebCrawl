import {
  ASSETS,
  EFFECT_FRAMES,
  MONSTER_FRAMES,
  PORTAL_FRAMES,
  WEAPON_ASSETS,
  world,
  type EffectKind,
  type MonsterFrameSet,
} from "../config";
import type {
  BossKind,
  LootKind,
  MonsterAnimation,
  MonsterKind,
  MonsterVisualKind,
  RoomShape,
  WeaponKind,
  WeaponPlacement,
} from "../types";

export const WORLD_GEOMETRY = {
  tileSize: world(128),
  wallThickness: world(64),
  corridorHalfWidth: world(160),
  maxCorridorLength: world(823),
  roomCollisionMargin: world(4),
  spatialCellSize: world(366),
  pathGridStep: world(13),
  pathLineStep: world(17),
  pathBoundsPadding: world(129),
} as const;

export const ROOM_DEFINITIONS: Record<RoomShape | "boss", { width: number; height: number }> = {
  rectangle: { width: world(580), height: world(400) },
  wide: { width: world(720), height: world(360) },
  tall: { width: world(460), height: world(560) },
  capsule: { width: world(640), height: world(380) },
  octagon: { width: world(580), height: world(460) },
  boss: { width: world(900), height: world(650) },
};

export const PLAYER_SPEC = {
  radius: world(36),
  spriteSize: world(190),
  spriteOrigin: { x: 0.5, y: 0.6875 },
  muzzleDistance: world(21),
  speed: world(457),
  maxHp: 10,
} as const;

export const DEFAULT_BULLET_SPEC = {
  radius: world(6),
  maxDistance: world(1_029),
} as const;

interface MonsterDefinition {
  kind: MonsterKind;
  visualKinds: readonly MonsterVisualKind[];
  fast: boolean;
  radius: number;
  size: number;
  baseHp: number;
  hpVariance: number;
  speed: number;
  speedPerDifficulty: number;
  maxSpeedBonus: number;
  attackRange: number;
  attackRangePerDifficulty: number;
  maxAttackRangeBonus: number;
  attackDamage: number;
  attackCooldownMs: number;
  cooldownReductionPerDifficulty: number;
  minAttackCooldownMs: number;
  projectileSpeed: number;
  projectileSpeedPerDifficulty: number;
  maxProjectileSpeedBonus: number;
  projectileRange: number;
  projectileRangePerDifficulty: number;
  maxProjectileRangeBonus: number;
}

export const REGULAR_MONSTER_DEFINITIONS: Record<"slow" | "fast" | "sentry", MonsterDefinition> = {
  slow: {
    kind: "slow",
    visualKinds: ["heavy"],
    fast: false,
    radius: world(63),
    size: world(228.75),
    baseHp: 1,
    hpVariance: 6,
    speed: world(80),
    speedPerDifficulty: world(8),
    maxSpeedBonus: world(95),
    attackRange: world(38),
    attackRangePerDifficulty: world(4),
    maxAttackRangeBonus: world(48),
    attackDamage: 1,
    attackCooldownMs: 1_150,
    cooldownReductionPerDifficulty: 35,
    minAttackCooldownMs: 420,
    projectileSpeed: 0,
    projectileSpeedPerDifficulty: 0,
    maxProjectileSpeedBonus: 0,
    projectileRange: 0,
    projectileRangePerDifficulty: 0,
    maxProjectileRangeBonus: 0,
  },
  fast: {
    kind: "fast",
    visualKinds: ["scout"],
    fast: true,
    radius: world(46),
    size: world(171.25),
    baseHp: 1,
    hpVariance: 6,
    speed: world(150),
    speedPerDifficulty: world(11),
    maxSpeedBonus: world(95),
    attackRange: world(38),
    attackRangePerDifficulty: world(4),
    maxAttackRangeBonus: world(48),
    attackDamage: 1,
    attackCooldownMs: 1_150,
    cooldownReductionPerDifficulty: 35,
    minAttackCooldownMs: 420,
    projectileSpeed: 0,
    projectileSpeedPerDifficulty: 0,
    maxProjectileSpeedBonus: 0,
    projectileRange: 0,
    projectileRangePerDifficulty: 0,
    maxProjectileRangeBonus: 0,
  },
  sentry: {
    kind: "sentry",
    visualKinds: ["sentry-ballistic", "sentry-twin", "sentry-energy"],
    fast: false,
    radius: world(57),
    size: world(200),
    baseHp: 2,
    hpVariance: 5,
    speed: 0,
    speedPerDifficulty: 0,
    maxSpeedBonus: 0,
    attackRange: world(820),
    attackRangePerDifficulty: 0,
    maxAttackRangeBonus: 0,
    attackDamage: 1,
    attackCooldownMs: 1_500,
    cooldownReductionPerDifficulty: 70,
    minAttackCooldownMs: 420,
    projectileSpeed: world(220),
    projectileSpeedPerDifficulty: world(18),
    maxProjectileSpeedBonus: world(260),
    projectileRange: world(980),
    projectileRangePerDifficulty: world(40),
    maxProjectileRangeBonus: world(420),
  },
};

export const MONSTER_SPAWN_PROFILES = {
  room: { hpBonus: 0, speedPercent: 100, rangePercent: 100, cooldownPercent: 100, dropsLoot: true },
  spawner: { hpBonus: 1, speedPercent: 110, rangePercent: 105, cooldownPercent: 90, dropsLoot: false },
  summon: { hpBonus: 1, speedPercent: 112, rangePercent: 95, cooldownPercent: 94, dropsLoot: false },
} as const;

interface BossDefinition {
  kind: BossKind;
  visualKind: MonsterVisualKind;
  label: string;
  color: number;
  radius: number;
  size: number;
  baseHp: number;
  hpPerDifficulty: number;
  hpVariance: number;
  speed: number;
  speedPerDifficulty: number;
  maxSpeedBonus: number;
  attackRange: number;
  attackDamage: number;
  attackDamageDifficultyDivisor: number;
  attackCooldownMs: number;
  cooldownReductionPerDifficulty: number;
  minAttackCooldownMs: number;
  projectileSpeed: number;
  projectileSpeedPerDifficulty: number;
  projectileRange: number;
}

export const BOSS_DEFINITIONS: Record<BossKind, BossDefinition> = {
  "packet-storm": {
    kind: "packet-storm",
    visualKind: "boss-arc",
    label: "PACKET STORM",
    color: 0xd975ff,
    radius: world(64),
    size: world(310),
    baseHp: 42,
    hpPerDifficulty: 8,
    hpVariance: 12,
    speed: world(72),
    speedPerDifficulty: world(3),
    maxSpeedBonus: world(38),
    attackRange: world(1_200),
    attackDamage: 1,
    attackDamageDifficultyDivisor: 4,
    attackCooldownMs: 1_150,
    cooldownReductionPerDifficulty: 45,
    minAttackCooldownMs: 620,
    projectileSpeed: world(190),
    projectileSpeedPerDifficulty: world(14),
    projectileRange: world(1_100),
  },
  "fork-bomb": {
    kind: "fork-bomb",
    visualKind: "boss-missile",
    label: "FORK BOMB",
    color: 0x55e3cf,
    radius: world(70),
    size: world(337.5),
    baseHp: 54,
    hpPerDifficulty: 9,
    hpVariance: 15,
    speed: world(64),
    speedPerDifficulty: world(3),
    maxSpeedBonus: world(36),
    attackRange: world(1_000),
    attackDamage: 1,
    attackDamageDifficultyDivisor: 4,
    attackCooldownMs: 1_650,
    cooldownReductionPerDifficulty: 55,
    minAttackCooldownMs: 800,
    projectileSpeed: world(235),
    projectileSpeedPerDifficulty: world(15),
    projectileRange: world(1_000),
  },
  "heap-titan": {
    kind: "heap-titan",
    visualKind: "boss-fortress",
    label: "HEAP TITAN",
    color: 0xff8b4d,
    radius: world(78),
    size: world(393.75),
    baseHp: 92,
    hpPerDifficulty: 14,
    hpVariance: 22,
    speed: world(48),
    speedPerDifficulty: world(4),
    maxSpeedBonus: world(52),
    attackRange: world(70),
    attackDamage: 4,
    attackDamageDifficultyDivisor: 2,
    attackCooldownMs: 1_250,
    cooldownReductionPerDifficulty: 35,
    minAttackCooldownMs: 650,
    projectileSpeed: world(155),
    projectileSpeedPerDifficulty: world(8),
    projectileRange: world(230),
  },
};

interface MonsterVisualDefinition {
  frames: MonsterFrameSet;
  displayScales: Record<"idle" | "walk" | "attack", number>;
  contentHalfHeight: number;
  origins: {
    idle: { x: number; y: number };
    walk: { x: number; y: number };
    attack: { x: number; y: number };
  };
}

export const MONSTER_VISUAL_DEFINITIONS: Record<MonsterVisualKind, MonsterVisualDefinition> = {
  scout: {
    frames: MONSTER_FRAMES.scout,
    displayScales: { idle: 0.5, walk: 1, attack: 0.48 },
    contentHalfHeight: 0.2,
    origins: { idle: { x: 0.5, y: 0.59 }, walk: { x: 0.5, y: 0.72 }, attack: { x: 0.5, y: 0.56 } },
  },
  heavy: {
    frames: MONSTER_FRAMES.heavy,
    displayScales: { idle: 0.61, walk: 1, attack: 0.64 },
    contentHalfHeight: 0.22,
    origins: { idle: { x: 0.5, y: 0.62 }, walk: { x: 0.5, y: 0.68 }, attack: { x: 0.5, y: 0.56 } },
  },
  "sentry-ballistic": {
    frames: MONSTER_FRAMES.sentryBallistic,
    displayScales: { idle: 1, walk: 1, attack: 1.42 },
    contentHalfHeight: 0.44,
    origins: { idle: { x: 0.5, y: 0.5 }, walk: { x: 0.5, y: 0.5 }, attack: { x: 0.5, y: 0.49 } },
  },
  "sentry-twin": {
    frames: MONSTER_FRAMES.sentryTwin,
    displayScales: { idle: 1, walk: 1, attack: 1.34 },
    contentHalfHeight: 0.35,
    origins: { idle: { x: 0.5, y: 0.6 }, walk: { x: 0.5, y: 0.6 }, attack: { x: 0.5, y: 0.48 } },
  },
  "sentry-energy": {
    frames: MONSTER_FRAMES.sentryEnergy,
    displayScales: { idle: 1, walk: 1, attack: 1.2 },
    contentHalfHeight: 0.44,
    origins: { idle: { x: 0.5, y: 0.5 }, walk: { x: 0.5, y: 0.5 }, attack: { x: 0.5, y: 0.47 } },
  },
  "boss-arc": {
    frames: MONSTER_FRAMES.bossArc,
    displayScales: { idle: 1, walk: 1, attack: 0.91 },
    contentHalfHeight: 0.36,
    origins: { idle: { x: 0.5, y: 0.55 }, walk: { x: 0.5, y: 0.55 }, attack: { x: 0.5, y: 0.59 } },
  },
  "boss-missile": {
    frames: MONSTER_FRAMES.bossMissile,
    displayScales: { idle: 1, walk: 1, attack: 0.93 },
    contentHalfHeight: 0.38,
    origins: { idle: { x: 0.5, y: 0.53 }, walk: { x: 0.5, y: 0.53 }, attack: { x: 0.5, y: 0.57 } },
  },
  "boss-fortress": {
    frames: MONSTER_FRAMES.bossFortress,
    displayScales: { idle: 1, walk: 1, attack: 0.97 },
    contentHalfHeight: 0.38,
    origins: { idle: { x: 0.5, y: 0.53 }, walk: { x: 0.5, y: 0.53 }, attack: { x: 0.5, y: 0.56 } },
  },
};

export function monsterDisplaySize(
  size: number,
  visualKind: MonsterVisualKind,
  animation: MonsterAnimation,
): number {
  return size * MONSTER_VISUAL_DEFINITIONS[visualKind].displayScales[animation];
}

export function monsterHealthBarY(size: number, visualKind: MonsterVisualKind): number {
  return -size * MONSTER_VISUAL_DEFINITIONS[visualKind].contentHalfHeight - world(8);
}

export interface DecorationDefinition {
  definitionId: string;
  kind: string;
  asset: string;
  obstacle: boolean;
  radius: number;
  footprint: number;
  size: number;
  origin: { x: number; y: number };
}

const decoration = (
  id: string,
  kind: string,
  asset: string,
  size: number,
  radius = 0,
  footprint = 0,
  origin = { x: 0.5, y: 0.5 },
): DecorationDefinition => ({ definitionId: id, kind, asset, obstacle: radius > 0, radius, footprint, size, origin });

export const DECORATION_DEFINITIONS = {
  plantViolet: decoration("plant-violet", "plant", ASSETS.decorPlant, world(93), world(19), world(10)),
  plantGreen: decoration("plant-green", "plant", ASSETS.decorPlantGreen, world(93), world(19), world(10)),
  plantMagenta: decoration("plant-magenta", "plant", ASSETS.decorPlantMagenta, world(88), world(18), world(9)),
  plantTeal: decoration("plant-teal", "plant", ASSETS.decorPlantTeal, world(65), world(14), world(7)),
  plantAmber: decoration("plant-amber", "plant", ASSETS.decorPlantAmber, world(65), world(14), world(7)),
  barrelRed: decoration("barrel-red", "barrel", ASSETS.decorBarrel, world(82), world(16), world(9)),
  barrelCoolant: decoration("barrel-coolant", "barrel", ASSETS.decorBarrelCoolant, world(82), world(16), world(9)),
  barrelHazard: decoration("barrel-hazard", "barrel", ASSETS.decorBarrelHazard, world(82), world(16), world(9)),
  crateCargo: decoration("crate-cargo", "crate", ASSETS.decorCrateCargo, world(70), world(14), world(10)),
  crateArmored: decoration("crate-armored", "crate", ASSETS.decorCrateArmored, world(70), world(14), world(10)),
  crateAmmo: decoration("crate-ammo", "crate", ASSETS.decorCrateAmmo, world(70), world(14), world(10)),
  crateMedical: decoration("crate-medical", "crate", ASSETS.decorCrateMedical, world(70), world(14), world(10)),
  terminal: decoration("terminal", "terminal", ASSETS.decorTerminal, world(93), world(16), world(9)),
  spawner: decoration("monster-spawner", "monster-spawner", ASSETS.decorTerminal, world(93), world(20), world(13)),
  debris: decoration("debris", "debris", ASSETS.decorDebris, world(76), 0, 0, { x: 0.5, y: 0.5 }),
  pedestal: decoration("weapon-pedestal", "weapon-pedestal", ASSETS.pedestal, world(108), 0, 0, { x: 0.512, y: 0.693 }),
} as const;

export const OBSTACLE_DEFINITIONS: readonly DecorationDefinition[] = [
  DECORATION_DEFINITIONS.plantViolet,
  DECORATION_DEFINITIONS.plantGreen,
  DECORATION_DEFINITIONS.plantMagenta,
  DECORATION_DEFINITIONS.plantTeal,
  DECORATION_DEFINITIONS.plantAmber,
  DECORATION_DEFINITIONS.barrelRed,
  DECORATION_DEFINITIONS.barrelCoolant,
  DECORATION_DEFINITIONS.barrelHazard,
  DECORATION_DEFINITIONS.crateCargo,
  DECORATION_DEFINITIONS.crateArmored,
  DECORATION_DEFINITIONS.crateAmmo,
  DECORATION_DEFINITIONS.crateMedical,
  DECORATION_DEFINITIONS.terminal,
];

export const SCENERY_DEFINITIONS: readonly DecorationDefinition[] = [
  DECORATION_DEFINITIONS.debris,
  { ...DECORATION_DEFINITIONS.plantViolet, definitionId: "scenery-plant-violet", obstacle: false, radius: 0, footprint: 0 },
  { ...DECORATION_DEFINITIONS.plantGreen, definitionId: "scenery-plant-green", obstacle: false, radius: 0, footprint: 0 },
  { ...DECORATION_DEFINITIONS.plantMagenta, definitionId: "scenery-plant-magenta", obstacle: false, radius: 0, footprint: 0 },
  { ...DECORATION_DEFINITIONS.plantTeal, definitionId: "scenery-plant-teal", obstacle: false, radius: 0, footprint: 0 },
  { ...DECORATION_DEFINITIONS.plantAmber, definitionId: "scenery-plant-amber", obstacle: false, radius: 0, footprint: 0 },
];

export const MAX_REGULAR_MONSTER_RADIUS = Math.max(
  ...Object.values(REGULAR_MONSTER_DEFINITIONS).map(definition => definition.radius),
);

export const LOOT_DEFINITIONS: Record<Exclude<LootKind, "weapon">, { asset: string; size: number; pickupRadius: number }> = {
  credit: { asset: ASSETS.lootCredit, size: world(50), pickupRadius: world(33) },
  crystal: { asset: ASSETS.lootCrystal, size: world(63), pickupRadius: world(33) },
  core: { asset: ASSETS.lootCore, size: world(63), pickupRadius: world(33) },
  medkit: { asset: ASSETS.lootMedkit, size: world(63), pickupRadius: world(33) },
};

export const WEAPON_PICKUP_DEFINITIONS: Record<WeaponPlacement, { size: number; yOffset: number; pickupRadius: number }> = {
  pedestal: { size: world(92), yOffset: 0, pickupRadius: world(40) },
  floor: { size: world(74), yOffset: 0, pickupRadius: world(36) },
};

export const WEAPON_VISUAL_DEFINITIONS: Record<WeaponKind, { asset: string; origin: { x: number; y: number }; pedestalYOffset: number }> = {
  "pulse-rifle": { asset: WEAPON_ASSETS["pulse-rifle"], origin: { x: 0.5, y: 0.77 }, pedestalYOffset: -world(39) },
  "byte-repeater": { asset: WEAPON_ASSETS["byte-repeater"], origin: { x: 0.5, y: 0.744 }, pedestalYOffset: -world(41) },
  "scatter-array": { asset: WEAPON_ASSETS["scatter-array"], origin: { x: 0.5, y: 0.801 }, pedestalYOffset: -world(36) },
  "fork-driver": { asset: WEAPON_ASSETS["fork-driver"], origin: { x: 0.5, y: 0.77 }, pedestalYOffset: -world(39) },
  trident: { asset: WEAPON_ASSETS.trident, origin: { x: 0.5, y: 0.768 }, pedestalYOffset: -world(39) },
  "needle-rail": { asset: WEAPON_ASSETS["needle-rail"], origin: { x: 0.5, y: 0.836 }, pedestalYOffset: -world(32) },
  "packet-lobber": { asset: WEAPON_ASSETS["packet-lobber"], origin: { x: 0.5, y: 0.777 }, pedestalYOffset: -world(38) },
  "cross-compiler": { asset: WEAPON_ASSETS["cross-compiler"], origin: { x: 0.5, y: 0.771 }, pedestalYOffset: -world(38) },
  "nova-cache": { asset: WEAPON_ASSETS["nova-cache"], origin: { x: 0.5, y: 0.762 }, pedestalYOffset: -world(39) },
  "helix-emitter": { asset: WEAPON_ASSETS["helix-emitter"], origin: { x: 0.5, y: 0.744 }, pedestalYOffset: -world(41) },
  "sideband-projector": { asset: WEAPON_ASSETS["sideband-projector"], origin: { x: 0.5, y: 0.656 }, pedestalYOffset: -world(49) },
};

export const PORTAL_DEFINITION = {
  frames: PORTAL_FRAMES,
  size: world(150),
  contactRadius: { x: world(38), y: world(34) },
  origin: { x: 0.5, y: 0.875 },
  contactOffset: { x: 0, y: -world(56) },
} as const;

export const EFFECT_DEFINITIONS: Record<EffectKind, { frames: readonly string[]; size: number; origin: { x: number; y: number } }> = {
  damage: { frames: EFFECT_FRAMES.damage, size: world(72), origin: { x: 0.5, y: 0.5 } },
  healing: { frames: EFFECT_FRAMES.healing, size: world(112), origin: { x: 0.5, y: 0.5 } },
  plantBreak: { frames: EFFECT_FRAMES.plantBreak, size: world(132), origin: { x: 0.5, y: 0.5 } },
  teleport: { frames: EFFECT_FRAMES.teleport, size: PORTAL_DEFINITION.size, origin: { x: 0.5, y: 0.5 } },
};

export const EXPLOSION_SIZE = world(118);

export function weaponAsset(kind: WeaponKind): string {
  return WEAPON_VISUAL_DEFINITIONS[kind].asset;
}
