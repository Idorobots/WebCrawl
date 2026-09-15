import {
  ASSETS,
  BARREL_EXPLOSION_FRAMES,
  DEBRIS_ASSETS,
  ENVIRONMENT_SEGMENT_SIZE,
  EFFECT_FRAMES,
  EXPLOSION_FRAMES,
  MONSTER_FRAMES,
  PLAYER_FRAMES,
  PORTAL_FRAMES,
  SCENERY_ASSETS,
  WEAPON_ASSETS,
  world,
  type MonsterFrameSet,
} from "../config";
import type {
  ActorVisualDefinition,
  BossKind,
  LootKind,
  MonsterAnimation,
  MonsterKind,
  MonsterVisualKind,
  ObjectVisualDefinition,
  PlayerDirection,
  RoomShape,
  SpriteClip,
  SpriteDirection,
  WeaponKind,
  WeaponPlacement,
} from "../types";

const clip = (
  frames: readonly string[],
  sizeScale = 1,
  origin = { x: 0.5, y: 0.5 },
  frameDurationMs = 100,
  options: Pick<SpriteClip, "loop" | "holdLast" | "eventFrame"> = {},
): SpriteClip => ({ frames, sizeScale, origin, frameDurationMs, ...options });

const damageEffect = (sizeScale = 0.4): SpriteClip =>
  clip(EFFECT_FRAMES.damage, sizeScale, { x: 0.5, y: 0.5 });
const explosionEffect = (sizeScale = 0.8): SpriteClip =>
  clip(EXPLOSION_FRAMES, sizeScale, { x: 0.5, y: 0.5 }, 1_000 / 12);
const robotDebris = (sizeScale: number): readonly SpriteClip[] => [
  clip([DEBRIS_ASSETS.robotTorso], sizeScale, { x: 0.5, y: 0.9375 }),
  clip([DEBRIS_ASSETS.robotLimbs], sizeScale, { x: 0.5, y: 0.9375 }),
];

export const WORLD_GEOMETRY = {
  segmentSize: ENVIRONMENT_SEGMENT_SIZE,
  floorTileSize: world(64),
  doorSpanSegments: 2,
  doorOpeningWidth: ENVIRONMENT_SEGMENT_SIZE * 1.25,
  topWallCollisionDepth: ENVIRONMENT_SEGMENT_SIZE / 2,
  wallThickness: world(64),
  corridorHalfWidth: ENVIRONMENT_SEGMENT_SIZE,
  maxCorridorLength: ENVIRONMENT_SEGMENT_SIZE * 12,
  roomCollisionMargin: world(4),
  spatialCellSize: world(366),
  pathGridStep: world(13),
  pathLineStep: world(17),
  pathBoundsPadding: world(129),
} as const;

export const ROOM_DEFINITIONS: Record<RoomShape | "boss", { width: number; height: number }> = {
  rectangle: { width: ENVIRONMENT_SEGMENT_SIZE * 4, height: ENVIRONMENT_SEGMENT_SIZE * 4 },
  wide: { width: ENVIRONMENT_SEGMENT_SIZE * 8, height: ENVIRONMENT_SEGMENT_SIZE * 4 },
  tall: { width: ENVIRONMENT_SEGMENT_SIZE * 4, height: ENVIRONMENT_SEGMENT_SIZE * 8 },
  capsule: { width: ENVIRONMENT_SEGMENT_SIZE * 4, height: ENVIRONMENT_SEGMENT_SIZE * 4 },
  octagon: { width: ENVIRONMENT_SEGMENT_SIZE * 4, height: ENVIRONMENT_SEGMENT_SIZE * 4 },
  boss: { width: ENVIRONMENT_SEGMENT_SIZE * 8, height: ENVIRONMENT_SEGMENT_SIZE * 8 },
};

const PLAYER_ORIGIN = { x: 0.5, y: 0.90625 };
const PLAYER_WALK_ORIGIN = { x: 0.5, y: 0.90625 };
const PLAYER_VISUAL: ActorVisualDefinition = {
  directions: Object.fromEntries(
    Object.entries(PLAYER_FRAMES).map(([direction, frames]) => [direction, {
      normal: clip(frames.normal, 1, PLAYER_ORIGIN),
      walk: clip(frames.walk, 1, PLAYER_WALK_ORIGIN, 125, { loop: true }),
    }]),
  ) as Record<PlayerDirection, ActorVisualDefinition["directions"][string]>,
  effects: {
    damage: clip(EFFECT_FRAMES.damage, 72 / 190),
    healing: clip(EFFECT_FRAMES.healing, 112 / 190),
    teleport: clip(EFFECT_FRAMES.teleport, 150 / 190),
  },
};

export const PLAYER_SPEC = {
  radius: world(36),
  spriteSize: world(190),
  visualCenterOffsetY: -world(38),
  visual: PLAYER_VISUAL,
  muzzleDistance: world(21),
  speed: world(457),
  maxHp: 10,
} as const;

export const DEFAULT_BULLET_SPEC = {
  radius: world(6),
  maxDistance: world(1_029),
} as const;

export const CRYSTAL_INVULNERABILITY_DURATION_MS = 10_000;
export const CRYSTAL_INVULNERABILITY_BLINK_START_MS = 2_000;

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
    projectileSpeed: world(185),
    projectileSpeedPerDifficulty: world(10),
    maxProjectileSpeedBonus: world(120),
    projectileRange: world(510),
    projectileRangePerDifficulty: world(20),
    maxProjectileRangeBonus: world(180),
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
    projectileSpeed: world(230),
    projectileSpeedPerDifficulty: world(12),
    maxProjectileSpeedBonus: world(145),
    projectileRange: world(450),
    projectileRangePerDifficulty: world(18),
    maxProjectileRangeBonus: world(160),
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
  visualKinds: readonly MonsterVisualKind[];
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
    visualKinds: ["boss-arc", "boss-laser"],
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
    attackRange: world(70),
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
    visualKinds: ["boss-missile", "boss-siege"],
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
    attackRange: world(76),
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
    visualKinds: ["boss-fortress"],
    label: "HEAP TITAN",
    color: 0xff8b4d,
    radius: world(78),
    size: world(393.75),
    baseHp: 160,
    hpPerDifficulty: 20,
    hpVariance: 30,
    speed: world(48),
    speedPerDifficulty: world(4),
    maxSpeedBonus: world(52),
    attackRange: world(70),
    attackDamage: 4,
    attackDamageDifficultyDivisor: 2,
    attackCooldownMs: 1_250,
    cooldownReductionPerDifficulty: 35,
    minAttackCooldownMs: 650,
    projectileSpeed: world(210),
    projectileSpeedPerDifficulty: world(10),
    projectileRange: world(780),
  },
};

export const HEAP_TITAN_WAVE = {
  initialDelayMs: 1_200,
  baseIntervalMs: 2_200,
  floorReductionMs: 60,
  minIntervalMs: 1_000,
  bulletCount: 12,
  enragedBulletCount: 18,
} as const;

export interface MonsterVisualDefinition extends ActorVisualDefinition {
  contentHalfHeight: number;
  healthBarHeight: number;
}

function monsterVisual(
  frames: MonsterFrameSet,
  sizeScale: number,
  origin: { x: number; y: number },
  contentHalfHeight: number,
  debrisScale = 0.72,
  healthBarHeight = contentHalfHeight,
): MonsterVisualDefinition {
  const directions = Object.fromEntries(
    Object.entries(frames).map(([direction, directionalFrames]) => [direction, {
      normal: clip(directionalFrames.normal, sizeScale, origin),
      ...(directionalFrames.walk
        ? { walk: clip(directionalFrames.walk, sizeScale, origin, 125, { loop: true }) }
        : {}),
      ...(directionalFrames.melee
        ? { melee: clip(directionalFrames.melee, sizeScale, origin, 125, { eventFrame: 2 }) }
        : {}),
      ...(directionalFrames.ranged
        ? { ranged: clip(directionalFrames.ranged, sizeScale, origin, 125, { eventFrame: 2 }) }
        : {}),
    }]),
  ) as Record<SpriteDirection, ActorVisualDefinition["directions"][string]>;
  return {
    directions,
    effects: { damage: damageEffect(0.32), destroy: explosionEffect(0.78) },
    destroyed: robotDebris(debrisScale),
    contentHalfHeight,
    healthBarHeight,
  };
}

export const MONSTER_VISUAL_DEFINITIONS: Record<MonsterVisualKind, MonsterVisualDefinition> = {
  scout: monsterVisual(MONSTER_FRAMES.scout, 1, { x: 0.5, y: 0.90625 }, 0.2, 0.72, 0.42),
  heavy: monsterVisual(MONSTER_FRAMES.heavy, 1, { x: 0.5, y: 0.90625 }, 0.22, 0.72, 0.42),
  "sentry-ballistic": monsterVisual(MONSTER_FRAMES.sentryBallistic, 1.42, { x: 0.5, y: 0.90625 }, 0.44),
  "sentry-twin": monsterVisual(MONSTER_FRAMES.sentryTwin, 1.34, { x: 0.5, y: 0.90625 }, 0.35),
  "sentry-energy": monsterVisual(MONSTER_FRAMES.sentryEnergy, 1.2, { x: 0.5, y: 0.90625 }, 0.44),
  "boss-arc": monsterVisual(MONSTER_FRAMES.bossArc, 1, { x: 0.5, y: 0.90625 }, 0.36, 0.5),
  "boss-missile": monsterVisual(MONSTER_FRAMES.bossMissile, 1, { x: 0.5, y: 0.90625 }, 0.38, 0.5),
  "boss-fortress": monsterVisual(MONSTER_FRAMES.bossFortress, 1, { x: 0.5, y: 0.90625 }, 0.38, 0.45),
  "boss-laser": monsterVisual(MONSTER_FRAMES.bossLaser, 1, { x: 0.5, y: 0.90625 }, 0.36, 0.5),
  "boss-siege": monsterVisual(MONSTER_FRAMES.bossSiege, 1, { x: 0.5, y: 0.90625 }, 0.36, 0.5),
};

export function monsterDisplaySize(
  size: number,
  visualKind: MonsterVisualKind,
  animation: MonsterAnimation,
): number {
  const direction = MONSTER_VISUAL_DEFINITIONS[visualKind].directions.down!;
  return size * (direction[animation] ?? direction.normal).sizeScale;
}

export function monsterHealthBarY(size: number, visualKind: MonsterVisualKind): number {
  return -size * MONSTER_VISUAL_DEFINITIONS[visualKind].healthBarHeight - world(8);
}

export function monsterVisualCenterOffsetY(size: number, visualKind: MonsterVisualKind): number {
  return -size * MONSTER_VISUAL_DEFINITIONS[visualKind].contentHalfHeight;
}

export interface DecorationDefinition {
  definitionId: string;
  kind: string;
  visual: ObjectVisualDefinition;
  destructible: boolean;
  obstacle: boolean;
  radius: number;
  hitOffsetY: number;
  footprint: number;
  size: number;
  origin: { x: number; y: number };
}

const decoration = (
  id: string,
  kind: string,
  asset: string,
  size: number,
  {
    radius = 0,
    footprint = 0,
    obstacle = footprint > 0,
    origin = { x: 0.5, y: 0.9375 },
    hitOffsetY = -size * 0.4,
    debris = [],
    destroy,
  }: {
    radius?: number;
    footprint?: number;
    obstacle?: boolean;
    origin?: { x: number; y: number };
    hitOffsetY?: number;
    debris?: readonly string[];
    destroy?: SpriteClip;
  } = {},
): DecorationDefinition => {
  const destructible = debris.length > 0;
  return {
    definitionId: id,
    kind,
    visual: {
      normal: clip([asset], 1, origin),
      destroyed: debris.map(debrisAsset => clip([debrisAsset], 1.18, { x: 0.5, y: 0.9375 })),
      animations: destructible ? { damage: damageEffect(0.55), destroy } : undefined,
    },
    destructible,
    obstacle,
    radius,
    hitOffsetY,
    footprint,
    size,
    origin,
  };
};

const plantDebris = [
  DEBRIS_ASSETS.plantGreenPot,
  DEBRIS_ASSETS.plantMagentaPot,
  DEBRIS_ASSETS.plantDryLeaves,
  DEBRIS_ASSETS.plantRoots,
] as const;
const circuitDebris = [DEBRIS_ASSETS.genericCircuit, DEBRIS_ASSETS.genericMetal] as const;
const plantBreak = clip(EFFECT_FRAMES.plantBreak, 1.45, { x: 0.5, y: 0.5 });
const barrelExplosion = clip(BARREL_EXPLOSION_FRAMES, 2.8, { x: 0.5, y: 0.84375 }, 1_000 / 12);
const objectExplosion = explosionEffect(1.5);
const sceneryOrigin = { x: 0.5, y: 0.9375 };
const blockingScenery = (id: string, asset: string, size = world(145), radius = world(28)): DecorationDefinition =>
  decoration(id, "machinery", asset, size, {
    radius,
    footprint: radius * 0.72,
    debris: circuitDebris,
    destroy: objectExplosion,
  });
const lowScenery = (id: string, asset: string, size = world(105), radius = world(24)): DecorationDefinition =>
  decoration(id, "scenery", asset, size, {
    radius,
    hitOffsetY: -size * 0.25,
    obstacle: false,
    debris: circuitDebris,
    destroy: objectExplosion,
  });

export const DECORATION_DEFINITIONS = {
  plantViolet: decoration("plant-violet", "plant", SCENERY_ASSETS.plantViolet, world(93), { radius: world(19), footprint: world(10), origin: { x: 0.5, y: 0.975 }, debris: plantDebris, destroy: plantBreak }),
  plantGreen: decoration("plant-green", "plant", SCENERY_ASSETS.plantGreen, world(93), { radius: world(19), footprint: world(10), origin: { x: 0.5, y: 0.975 }, debris: plantDebris, destroy: plantBreak }),
  plantMagenta: decoration("plant-magenta", "plant", SCENERY_ASSETS.plantMagenta, world(88), { radius: world(18), footprint: world(9), debris: plantDebris, destroy: plantBreak }),
  plantTeal: decoration("plant-teal", "plant", SCENERY_ASSETS.plantTeal, world(65), { radius: world(14), footprint: world(7), origin: { x: 0.5, y: 0.941 }, debris: plantDebris, destroy: plantBreak }),
  plantAmber: decoration("plant-amber", "plant", SCENERY_ASSETS.plantAmber, world(65), { radius: world(14), footprint: world(7), origin: { x: 0.5, y: 0.941 }, debris: plantDebris, destroy: plantBreak }),
  barrelRed: decoration("barrel-red", "barrel", SCENERY_ASSETS.barrelRed, world(82), { radius: world(16), footprint: world(9), origin: { x: 0.5, y: 0.917 }, debris: [DEBRIS_ASSETS.barrelRedCrushed, DEBRIS_ASSETS.barrelRedShards], destroy: barrelExplosion }),
  barrelCoolant: decoration("barrel-coolant", "barrel", SCENERY_ASSETS.barrelCoolant, world(82), { radius: world(16), footprint: world(9), origin: { x: 0.5, y: 0.917 }, debris: [DEBRIS_ASSETS.barrelCoolantRuptured], destroy: barrelExplosion }),
  barrelHazard: decoration("barrel-hazard", "barrel", SCENERY_ASSETS.barrelHazard, world(82), { radius: world(16), footprint: world(9), origin: { x: 0.5, y: 0.917 }, debris: [DEBRIS_ASSETS.barrelHazardBands], destroy: barrelExplosion }),
  crateCargo: decoration("crate-cargo", "crate", SCENERY_ASSETS.crateCargo, world(70), { radius: world(14), footprint: world(10), debris: [DEBRIS_ASSETS.crateCargo], destroy: objectExplosion }),
  crateArmored: decoration("crate-armored", "crate", SCENERY_ASSETS.crateArmored, world(70), { radius: world(14), footprint: world(10), debris: [DEBRIS_ASSETS.crateArmored], destroy: objectExplosion }),
  crateAmmo: decoration("crate-ammo", "crate", SCENERY_ASSETS.crateAmmo, world(70), { radius: world(14), footprint: world(10), debris: [DEBRIS_ASSETS.crateAmmo], destroy: objectExplosion }),
  crateMedical: decoration("crate-medical", "crate", SCENERY_ASSETS.crateMedical, world(70), { radius: world(14), footprint: world(10), debris: [DEBRIS_ASSETS.crateMedical], destroy: objectExplosion }),
  terminal: decoration("terminal", "terminal", SCENERY_ASSETS.terminal, world(93), { radius: world(16), footprint: world(9), origin: { x: 0.5, y: 0.967 }, debris: circuitDebris, destroy: objectExplosion }),
  specimenTank: blockingScenery("specimen-tank", SCENERY_ASSETS.specimenTank, world(155), world(28)),
  researchBench: blockingScenery("research-bench", SCENERY_ASSETS.researchBench, world(135), world(35)),
  analyzer: blockingScenery("analyzer", SCENERY_ASSETS.analyzer, world(145), world(31)),
  reagentRack: lowScenery("reagent-rack", SCENERY_ASSETS.reagentRack),
  refrigerator: blockingScenery("refrigerator", SCENERY_ASSETS.refrigerator, world(145), world(27)),
  roboticManipulator: blockingScenery("robotic-manipulator", SCENERY_ASSETS.roboticManipulator, world(145), world(31)),
  pipeValve: lowScenery("pipe-valve", SCENERY_ASSETS.pipeValve, world(95)),
  pipeElbow: lowScenery("pipe-elbow", SCENERY_ASSETS.pipeElbow, world(115)),
  coiledCables: lowScenery("coiled-cables", SCENERY_ASSETS.coiledCables, world(90)),
  monitorBank: blockingScenery("monitor-bank", SCENERY_ASSETS.monitorBank, world(125), world(33)),
  serverRack: blockingScenery("server-rack", SCENERY_ASSETS.serverRack, world(145), world(26)),
  radarDisplay: blockingScenery("radar-display", SCENERY_ASSETS.radarDisplay, world(130), world(31)),
  operatorTerminal: blockingScenery("operator-terminal", SCENERY_ASSETS.operatorTerminal, world(140), world(31)),
  communicationsCabinet: blockingScenery("communications-cabinet", SCENERY_ASSETS.communicationsCabinet, world(145), world(26)),
  hologramTable: blockingScenery("hologram-table", SCENERY_ASSETS.hologramTable, world(125), world(34)),
  conduitJunction: lowScenery("conduit-junction", SCENERY_ASSETS.conduitJunction, world(82)),
  powerCabinet: blockingScenery("power-cabinet", SCENERY_ASSETS.powerCabinet, world(145), world(29)),
  floorCables: lowScenery("floor-cables", SCENERY_ASSETS.floorCables, world(78)),
  reactorPylon: blockingScenery("reactor-pylon", SCENERY_ASSETS.reactorPylon, world(165), world(32)),
  coolantPump: blockingScenery("coolant-pump", SCENERY_ASSETS.coolantPump, world(130), world(34)),
  energyCapacitor: blockingScenery("energy-capacitor", SCENERY_ASSETS.energyCapacitor, world(155), world(30)),
  barricade: blockingScenery("barricade", SCENERY_ASSETS.barricade, world(105), world(36)),
  maintenanceRack: blockingScenery("maintenance-rack", SCENERY_ASSETS.maintenanceRack, world(125), world(33)),
  hydraulicSupport: blockingScenery("hydraulic-support", SCENERY_ASSETS.hydraulicSupport, world(150), world(31)),
  pipeManifold: lowScenery("pipe-manifold", SCENERY_ASSETS.pipeManifold, world(95)),
  damagedFuseCabinet: blockingScenery("damaged-fuse-cabinet", SCENERY_ASSETS.damagedFuseCabinet, world(120), world(31)),
  cableTrunk: lowScenery("cable-trunk", SCENERY_ASSETS.cableTrunk, world(85)),
  spawner: {
    ...blockingScenery("monster-spawner", SCENERY_ASSETS.spawnerDormant, world(205), world(34)),
    kind: "monster-spawner",
    hitOffsetY: -world(40),
    visual: {
      normal: clip([SCENERY_ASSETS.spawnerDormant], 1, { x: 0.5, y: 0.90625 }),
      destroyed: circuitDebris.map(asset => clip([asset], 0.68, sceneryOrigin)),
      animations: {
        damage: damageEffect(0.4),
        destroy: explosionEffect(0.72),
        spawn: clip([
          SCENERY_ASSETS.spawnerDormant,
          SCENERY_ASSETS.spawnerCharging,
          SCENERY_ASSETS.spawnerDischarge,
          SCENERY_ASSETS.spawnerReady,
        ], 1, { x: 0.5, y: 0.90625 }, 125, { holdLast: true, eventFrame: 2 }),
      },
    },
  },
  debrisCircuit: decoration("debris-circuit", "debris", DEBRIS_ASSETS.genericCircuit, world(90), { origin: sceneryOrigin }),
  debrisMetal: decoration("debris-metal", "debris", DEBRIS_ASSETS.genericMetal, world(90), { origin: sceneryOrigin }),
  pedestal: decoration("weapon-pedestal", "weapon-pedestal", ASSETS.pedestal, world(108), { origin: { x: 0.5, y: 0.898 } }),
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
  DECORATION_DEFINITIONS.specimenTank,
  DECORATION_DEFINITIONS.researchBench,
  DECORATION_DEFINITIONS.analyzer,
  DECORATION_DEFINITIONS.refrigerator,
  DECORATION_DEFINITIONS.roboticManipulator,
  DECORATION_DEFINITIONS.monitorBank,
  DECORATION_DEFINITIONS.serverRack,
  DECORATION_DEFINITIONS.radarDisplay,
  DECORATION_DEFINITIONS.operatorTerminal,
  DECORATION_DEFINITIONS.communicationsCabinet,
  DECORATION_DEFINITIONS.hologramTable,
  DECORATION_DEFINITIONS.powerCabinet,
  DECORATION_DEFINITIONS.reactorPylon,
  DECORATION_DEFINITIONS.coolantPump,
  DECORATION_DEFINITIONS.energyCapacitor,
  DECORATION_DEFINITIONS.barricade,
  DECORATION_DEFINITIONS.maintenanceRack,
  DECORATION_DEFINITIONS.hydraulicSupport,
  DECORATION_DEFINITIONS.damagedFuseCabinet,
];

export const SCENERY_DEFINITIONS: readonly DecorationDefinition[] = [
  DECORATION_DEFINITIONS.debrisCircuit,
  DECORATION_DEFINITIONS.debrisMetal,
  DECORATION_DEFINITIONS.reagentRack,
  DECORATION_DEFINITIONS.pipeValve,
  DECORATION_DEFINITIONS.pipeElbow,
  DECORATION_DEFINITIONS.coiledCables,
  DECORATION_DEFINITIONS.conduitJunction,
  DECORATION_DEFINITIONS.floorCables,
  DECORATION_DEFINITIONS.pipeManifold,
  DECORATION_DEFINITIONS.cableTrunk,
];

export type RoomSceneryTheme = "lab" | "control" | "arena";

export interface WeightedDecorationDefinition {
  definition: DecorationDefinition;
  weight: number;
}

export interface RoomSceneryThemeDefinition {
  primary: readonly WeightedDecorationDefinition[];
  accents: readonly WeightedDecorationDefinition[];
  primaryPercent: number;
}

const weighted = (
  definition: DecorationDefinition,
  weight = 1,
): WeightedDecorationDefinition => ({ definition, weight });

export const ROOM_SCENERY_THEMES: Readonly<Record<RoomSceneryTheme, RoomSceneryThemeDefinition>> = {
  lab: {
    primaryPercent: 78,
    primary: [
      weighted(DECORATION_DEFINITIONS.crateMedical, 6),
      weighted(DECORATION_DEFINITIONS.specimenTank, 2),
      weighted(DECORATION_DEFINITIONS.researchBench, 2),
      weighted(DECORATION_DEFINITIONS.analyzer, 2),
      weighted(DECORATION_DEFINITIONS.refrigerator, 2),
      weighted(DECORATION_DEFINITIONS.roboticManipulator),
      weighted(DECORATION_DEFINITIONS.reagentRack),
      weighted(DECORATION_DEFINITIONS.pipeValve),
      weighted(DECORATION_DEFINITIONS.coiledCables),
    ],
    accents: [
      weighted(DECORATION_DEFINITIONS.barrelCoolant, 2),
      weighted(DECORATION_DEFINITIONS.plantGreen),
      weighted(DECORATION_DEFINITIONS.crateCargo),
      weighted(DECORATION_DEFINITIONS.debrisCircuit),
    ],
  },
  control: {
    primaryPercent: 78,
    primary: [
      weighted(DECORATION_DEFINITIONS.terminal, 3),
      weighted(DECORATION_DEFINITIONS.monitorBank, 2),
      weighted(DECORATION_DEFINITIONS.serverRack, 2),
      weighted(DECORATION_DEFINITIONS.radarDisplay),
      weighted(DECORATION_DEFINITIONS.operatorTerminal, 2),
      weighted(DECORATION_DEFINITIONS.communicationsCabinet),
      weighted(DECORATION_DEFINITIONS.hologramTable),
      weighted(DECORATION_DEFINITIONS.conduitJunction),
      weighted(DECORATION_DEFINITIONS.powerCabinet),
      weighted(DECORATION_DEFINITIONS.floorCables),
    ],
    accents: [
      weighted(DECORATION_DEFINITIONS.crateArmored, 2),
      weighted(DECORATION_DEFINITIONS.crateAmmo, 2),
      weighted(DECORATION_DEFINITIONS.plantViolet),
      weighted(DECORATION_DEFINITIONS.debrisCircuit),
    ],
  },
  arena: {
    primaryPercent: 78,
    primary: [
      weighted(DECORATION_DEFINITIONS.reactorPylon, 2),
      weighted(DECORATION_DEFINITIONS.coolantPump, 2),
      weighted(DECORATION_DEFINITIONS.energyCapacitor, 2),
      weighted(DECORATION_DEFINITIONS.barricade, 3),
      weighted(DECORATION_DEFINITIONS.maintenanceRack),
      weighted(DECORATION_DEFINITIONS.hydraulicSupport),
      weighted(DECORATION_DEFINITIONS.pipeManifold),
      weighted(DECORATION_DEFINITIONS.damagedFuseCabinet),
      weighted(DECORATION_DEFINITIONS.cableTrunk),
    ],
    accents: [
      weighted(DECORATION_DEFINITIONS.barrelHazard, 3),
      weighted(DECORATION_DEFINITIONS.crateAmmo, 2),
      weighted(DECORATION_DEFINITIONS.crateArmored),
      weighted(DECORATION_DEFINITIONS.debrisMetal),
    ],
  },
};

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

export function weaponAsset(kind: WeaponKind): string {
  return WEAPON_VISUAL_DEFINITIONS[kind].asset;
}
