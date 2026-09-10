import { ASSETS, MONSTER_RADIUS, WORLD_SCALE } from "../config";
import type {
  Decoration,
  BossKind,
  DungeonLayout,
  GraphNode,
  LayoutLink,
  LootItem,
  LootKind,
  Monster,
  MonsterKind,
  MonsterState,
  ObstacleState,
  Point,
  Stair,
} from "../types";
import { stableHash } from "./hash";
import { weaponForRoom, type WeaponSource } from "./weapons";

const world = (value: number): number => Math.round(value * WORLD_SCALE);
const obstacleScale = (value: number): number => Math.round(world(value) * 0.37125);
const DECOR_OBSTACLE_SIZE = obstacleScale(272);
const DECOR_PROP_SIZE = world(76);

export function lootKindForSeed(seed: number): LootKind {
  const kinds: LootKind[] = ["credit", "crystal", "core", "medkit"];
  return kinds[(seed >>> 3) % kinds.length] ?? "crystal";
}

export function bossLootDrops(
  monster: Monster,
  floorIdentity: string,
  floor: number,
  sourceRoom?: Pick<GraphNode, "tag" | "title" | "lootSeed">,
): LootItem[] {
  if (!monster.bossKind) return [];
  const count = 8 + Math.min(8, Math.floor(floor / 2));
  const x = monster.dropX ?? monster.x;
  const y = monster.dropY ?? monster.y;
  const weaponRoom = sourceRoom ?? {
    tag: "script",
    title: `<script> ${monster.bossKind}`,
    lootSeed: monster.seed,
  };
  return Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    const radius = world(46 + (index % 2) * 28);
    return {
      id: `${floorIdentity}::${monster.id}::boss-drop-${index}`,
      roomId: monster.roomId,
      x: x + Math.cos(angle) * radius,
      y: y + Math.sin(angle) * radius,
      kind: index === 0 ? "medkit" : index === 1 ? "weapon" : index % 3 === 0 ? "core" : lootKindForSeed(monster.seed + index * 7_919),
      weapon: index === 1 ? weaponForRoom(weaponRoom, "boss") : undefined,
    };
  });
}

export function weaponLootForRoom(room: GraphNode, pageUrl: string): LootItem | null {
  if (room.isRoot || room.tag === "script") return null;
  const source: WeaponSource = room.isHidden ? "hidden" : "room";
  const chance = room.isHidden ? 100 : room.tag === "img" ? 25 : 10;
  if (stableHash(`${room.lootSeed}|weapon-drop`) % 100 >= chance) return null;
  return {
    id: `${pageUrl}::${room.id}::weapon`,
    roomId: room.id,
    x: room.x,
    y: room.y - Math.min(world(135), room.height * 0.3),
    kind: "weapon",
    weapon: weaponForRoom(room, source),
  };
}

export function sceneryDropKindForSeed(seed: number): LootKind | null {
  if (stableHash(`${seed}|drop`) % 100 >= 15) return null;

  const kindRoll = stableHash(`${seed}|drop-kind`) % 100;
  if (kindRoll < 30) return "medkit";

  const kinds: LootKind[] = ["credit", "crystal", "core"];
  return kinds[kindRoll % kinds.length] ?? "credit";
}

export function decorationSpecsForRoom(room: GraphNode, floor = 1): Decoration[] {
  const seed = stableHash(`${room.lootSeed}|decor`);
  const difficulty = floorDifficulty(floor);
  const count = 5 + (seed % 3) + Math.min(4, Math.floor(difficulty / 2));
  const edgeX = Math.max(world(100), room.width / 2 - world(70));
  const edgeY = Math.max(world(90), room.height / 2 - world(70));
  const slots: Array<[number, number]> = [
    [-edgeX, -edgeY], [edgeX, -edgeY], [-edgeX, edgeY], [edgeX, edgeY], [-edgeX / 2, -edgeY],
    [edgeX / 2, -edgeY], [-edgeX / 2, edgeY], [edgeX / 2, edgeY], [-edgeX, -edgeY / 2], [edgeX, -edgeY / 2],
    [-edgeX, edgeY / 2], [edgeX, edgeY / 2],
  ];
  const obstacleTypes = [
    { kind: "plant", asset: ASSETS.decorPlant, obstacle: true, radius: obstacleScale(52), footprint: obstacleScale(26), size: DECOR_OBSTACLE_SIZE },
    { kind: "plant", asset: ASSETS.decorPlantGreen, obstacle: true, radius: obstacleScale(52), footprint: obstacleScale(26), size: DECOR_OBSTACLE_SIZE },
    { kind: "plant", asset: ASSETS.decorPlantMagenta, obstacle: true, radius: obstacleScale(48), footprint: obstacleScale(24), size: DECOR_OBSTACLE_SIZE },
    { kind: "plant", asset: ASSETS.decorPlantTeal, obstacle: true, radius: obstacleScale(40), footprint: obstacleScale(20), size: DECOR_OBSTACLE_SIZE },
    { kind: "plant", asset: ASSETS.decorPlantAmber, obstacle: true, radius: obstacleScale(40), footprint: obstacleScale(20), size: DECOR_OBSTACLE_SIZE },
    { kind: "barrel", asset: ASSETS.decorBarrel, obstacle: true, radius: obstacleScale(44), footprint: obstacleScale(22), size: DECOR_OBSTACLE_SIZE },
    { kind: "barrel", asset: ASSETS.decorBarrelCoolant, obstacle: true, radius: obstacleScale(44), footprint: obstacleScale(22), size: DECOR_OBSTACLE_SIZE },
    { kind: "barrel", asset: ASSETS.decorBarrelHazard, obstacle: true, radius: obstacleScale(44), footprint: obstacleScale(22), size: DECOR_OBSTACLE_SIZE },
    { kind: "crate", asset: ASSETS.decorCrate, obstacle: true, radius: obstacleScale(50), footprint: obstacleScale(25), size: DECOR_OBSTACLE_SIZE },
    { kind: "terminal", asset: ASSETS.decorTerminal, obstacle: true, radius: obstacleScale(42), footprint: obstacleScale(21), size: DECOR_OBSTACLE_SIZE },
  ];
  const sceneryAssets = [
    ASSETS.decorDebris,
    ASSETS.decorPlant,
    ASSETS.decorPlantGreen,
    ASSETS.decorPlantMagenta,
    ASSETS.decorPlantTeal,
    ASSETS.decorPlantAmber,
  ];
  const slotSteps = [1, 5, 7, 11];
  const slotStep = slotSteps[(seed >>> 8) % slotSteps.length]!;

  const decorations = Array.from({ length: count }, (_, index): Decoration => {
    const itemSeed = stableHash(`${room.lootSeed}|decor|${index}`);
    const slot = slots[(seed + index * slotStep) % slots.length]!;
    const type = index >= 2 && itemSeed % 5 === 0
      ? {
        kind: "debris",
        asset: sceneryAssets[(itemSeed >>> 5) % sceneryAssets.length]!,
        obstacle: false,
        radius: 0,
        footprint: 0,
        size: DECOR_PROP_SIZE,
      }
      : obstacleTypes[(itemSeed >>> 4) % obstacleTypes.length]!;
    const hp = type.obstacle ? 3 + ((itemSeed >>> 9) % 4) + Math.floor(difficulty / 3) : 0;
    return {
      id: `${room.id}::decor-${index}`,
      roomId: room.id,
      x: room.x + slot[0],
      y: room.y + slot[1],
      maxHp: hp,
      hp,
      destroyed: false,
      dropKind: type.obstacle ? sceneryDropKindForSeed(itemSeed) : null,
      ...type,
    };
  });

  if (room.isRoot || room.tag === "img") return decorations;
  const spawnerRate = Math.min(82, 12 + difficulty * 6);
  const spawnerRoomRoll = stableHash(`${room.lootSeed}|spawner-rate`) % 100;
  const maxSpawnerCount = Math.min(4, 1 + Math.floor(difficulty / 3));
  const spawnerCount = spawnerRoomRoll < spawnerRate
    ? 1 + (stableHash(`${room.lootSeed}|spawner-count`) % maxSpawnerCount)
    : 0;
  const spawnerSlots: Array<[number, number]> = [
    [-edgeX, edgeY * 0.65],
    [edgeX, -edgeY * 0.65],
    [0, edgeY],
    [0, -edgeY],
  ];
  for (let index = 0; index < spawnerCount; index += 1) {
    const itemSeed = stableHash(`${room.lootSeed}|spawner|${index}|${floor}`);
    const slot = spawnerSlots[index]!;
    const hp = 6 + difficulty + (itemSeed % 3);
    decorations.push({
      id: `${room.id}::spawner-${index}`,
      roomId: room.id,
      x: room.x + slot[0],
      y: room.y + slot[1],
      kind: "monster-spawner",
      asset: ASSETS.decorTerminal,
      obstacle: true,
      radius: obstacleScale(52),
      footprint: obstacleScale(26),
      size: DECOR_OBSTACLE_SIZE,
      maxHp: hp,
      hp,
      destroyed: false,
      dropKind: "core",
      spawner: true,
      spawnIntervalMs: Math.max(2_800, 7_000 - difficulty * 500),
      spawnLimit: Math.min(7, 2 + Math.floor(difficulty / 2)),
      spawnedCount: 0,
    });
  }
  return decorations;
}

function pointAlongCorridor(link: LayoutLink, fraction: number, lateral = 0): Point {
  const lengths = link.points.slice(1).map((point, index) =>
    Math.hypot(point.x - link.points[index]!.x, point.y - link.points[index]!.y)
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = total * Math.max(0, Math.min(1, fraction));
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (remaining > length && index < lengths.length - 1) {
      remaining -= length;
      continue;
    }
    const start = link.points[index]!;
    const end = link.points[index + 1]!;
    const t = length ? remaining / length : 0;
    const normalX = length ? -(end.y - start.y) / length : 0;
    const normalY = length ? (end.x - start.x) / length : 0;
    return {
      x: start.x + (end.x - start.x) * t + normalX * lateral,
      y: start.y + (end.y - start.y) * t + normalY * lateral,
    };
  }
  return { ...link.points[link.points.length - 1]! };
}

export function decorationSpecsForCorridor(link: LayoutLink, floor = 1): Decoration[] {
  const seed = stableHash(`${link.source.lootSeed}|corridor|${link.target.id}|decor`);
  const difficulty = floorDifficulty(floor);
  const count = 2 + (seed % 2);
  const assets = [
    ASSETS.decorDebris,
    ASSETS.decorPlant,
    ASSETS.decorPlantGreen,
    ASSETS.decorPlantMagenta,
    ASSETS.decorPlantTeal,
    ASSETS.decorPlantAmber,
  ];
  return Array.from({ length: count }, (_, index) => {
    const itemSeed = stableHash(`${seed}|${index}`);
    const obstacle = index === 0;
    const position = pointAlongCorridor(
      link,
      index === 0 ? 0.5 : index === 1 ? 0.28 : 0.72,
      (index % 2 ? 1 : -1) * Math.min(world(26), link.width * 0.24),
    );
    const hp = obstacle ? 3 + (itemSeed % 3) + Math.floor(difficulty / 3) : 0;
    return {
      id: `${link.id}::decor-${index}`,
      roomId: link.ownerRoomId,
      ...position,
      kind: obstacle ? "corridor-obstacle" : "corridor-prop",
      asset: obstacle ? ASSETS.decorCrate : assets[itemSeed % assets.length]!,
      obstacle,
      radius: obstacle ? obstacleScale(92) : 0,
      footprint: obstacle ? obstacleScale(25) : 0,
      size: obstacle ? DECOR_OBSTACLE_SIZE : DECOR_PROP_SIZE,
      maxHp: hp,
      hp,
      destroyed: false,
      dropKind: obstacle ? sceneryDropKindForSeed(itemSeed) : null,
    };
  });
}

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function blocksDoorApproach(item: Decoration, room: GraphNode, door: Point): boolean {
  if (!item.obstacle) return false;
  const dx = room.x - door.x;
  const dy = room.y - door.y;
  const distance = Math.hypot(dx, dy);
  const approach = {
    x: door.x + dx / distance * Math.min(world(140), distance),
    y: door.y + dy / distance * Math.min(world(140), distance),
  };
  return pointToSegmentDistance(item, door, approach) < item.radius + MONSTER_RADIUS + world(20);
}

function clearRoomDoorways(items: Decoration[], room: GraphNode, doors: readonly Point[]): Decoration[] {
  if (!doors.length) return items;
  const spawnerCandidates: Point[] = [
    { x: room.x - room.width * 0.27, y: room.y - room.height * 0.27 },
    { x: room.x + room.width * 0.27, y: room.y + room.height * 0.27 },
    { x: room.x - room.width * 0.27, y: room.y + room.height * 0.27 },
    { x: room.x + room.width * 0.27, y: room.y - room.height * 0.27 },
    { x: room.x, y: room.y + room.height * 0.32 },
    { x: room.x, y: room.y - room.height * 0.32 },
  ];
  return items.map(item => {
    if (!doors.some(door => blocksDoorApproach(item, room, door))) return item;
    if (item.spawner) {
      const position = spawnerCandidates.find(candidate =>
        !doors.some(door => blocksDoorApproach({ ...item, ...candidate }, room, door))
      );
      if (position) return { ...item, ...position };
    }
    return {
      ...item,
      kind: "doorway-debris",
      asset: ASSETS.decorDebris,
      obstacle: false,
      radius: 0,
      footprint: 0,
      size: DECOR_PROP_SIZE,
      maxHp: 0,
      hp: 0,
      dropKind: null,
      spawner: false,
      spawnLimit: undefined,
      spawnedCount: undefined,
    };
  });
}

export function buildDecorations(
  layout: DungeonLayout,
  savedStates: ReadonlyMap<string, ObstacleState>,
  floor = 1,
): Decoration[] {
  const doorsByRoom = new Map<number, Point[]>();
  for (const link of layout.links) {
    const sourceDoors = doorsByRoom.get(link.source.id) ?? [];
    sourceDoors.push(link.points[0]!);
    doorsByRoom.set(link.source.id, sourceDoors);
    const targetDoors = doorsByRoom.get(link.target.id) ?? [];
    targetDoors.push(link.points[link.points.length - 1]!);
    doorsByRoom.set(link.target.id, targetDoors);
  }
  const roomItems = layout.nodes.flatMap(room => clearRoomDoorways(
    decorationSpecsForRoom(room, floor),
    room,
    doorsByRoom.get(room.id) ?? [],
  ));
  return [
    ...roomItems,
    ...layout.links.flatMap(link => decorationSpecsForCorridor(link, floor)),
  ].map((item) => {
    const state = savedStates.get(item.id);
    return {
      ...item,
      hp: state?.hp ?? item.hp,
      destroyed: state?.destroyed ?? false,
      spawnedCount: state?.spawnedCount ?? item.spawnedCount,
    };
  });
}

export function buildSceneryDrops(
  decorations: readonly Decoration[],
  pageUrl: string,
  collectedLoot: ReadonlySet<string>,
): LootItem[] {
  return decorations.flatMap((item) => {
    if (!item.destroyed || !item.dropKind) return [];

    const id = `${pageUrl}::${item.id}::scenery-drop`;
    if (collectedLoot.has(id)) return [];

    return [{
      id,
      roomId: item.roomId,
      x: item.x,
      y: item.y,
      kind: item.dropKind,
    }];
  });
}

function floorDifficulty(floor: number): number {
  return Math.max(0, floor - 1);
}

function monsterCountForRoom(room: GraphNode, floor: number): number {
  const difficulty = floorDifficulty(floor);
  const min = Math.min(5, 2 + Math.floor(difficulty / 2));
  const max = Math.min(5, min + 1);
  const countSeed = stableHash(`${room.lootSeed}|monster-count|${floor}`);
  return min + (countSeed % (max - min + 1));
}

function monsterKindForSeed(seed: number, difficulty = 0): MonsterKind {
  if ((seed >>> 6) % 100 < Math.min(42, 20 + difficulty * 3)) return "sentry";
  return ((seed >>> 7) % 100) < 38 ? "fast" : "slow";
}

const BOSS_KINDS: BossKind[] = ["packet-storm", "fork-bomb", "heap-titan"];

export function bossKindForRoom(room: GraphNode): BossKind {
  return BOSS_KINDS[stableHash(`${room.lootSeed}|boss-kind`) % BOSS_KINDS.length]!;
}

export function bossSpecForRoom(
  room: GraphNode,
  floor = 1,
  bossKind: BossKind = bossKindForRoom(room),
): Monster {
  const difficulty = floorDifficulty(floor);
  const seed = stableHash(`${room.lootSeed}|boss|${floor}`);
  const common = {
    id: `${room.id}::boss`,
    seed,
    kind: bossKind,
    bossKind,
    spawnRoomId: room.id,
    roomId: room.id,
    x: room.x,
    y: room.y - world(24),
    fast: false,
    dropsLoot: true,
    lastAttackAt: -Infinity,
    active: false,
    dead: false,
    hp: 1,
    path: [] as Point[],
    pathIndex: 0,
    pathTargetRoomId: null,
    pathTargetX: room.x,
    pathTargetY: room.y,
    nextPathRefreshAt: 0,
    attackSequence: 0,
    summonedCount: 0,
  };
  if (bossKind === "packet-storm") {
    return {
      ...common,
      maxHp: 42 + difficulty * 8 + (seed % 12),
      speed: world(72 + Math.min(38, difficulty * 3)),
      radius: world(72),
      size: world(276),
      attackRange: world(1_200),
      attackDamage: 1 + Math.floor(difficulty / 4),
      attackCooldownMs: Math.max(620, 1_150 - difficulty * 45),
      projectileSpeed: world(190 + difficulty * 14),
      projectileRange: world(1_100),
    };
  }
  if (bossKind === "fork-bomb") {
    return {
      ...common,
      maxHp: 54 + difficulty * 9 + (seed % 15),
      speed: world(64 + Math.min(36, difficulty * 3)),
      radius: world(78),
      size: world(300),
      attackRange: world(1_000),
      attackDamage: 1 + Math.floor(difficulty / 4),
      attackCooldownMs: Math.max(800, 1_650 - difficulty * 55),
      projectileSpeed: world(235 + difficulty * 15),
      projectileRange: world(1_000),
    };
  }
  return {
    ...common,
    maxHp: 92 + difficulty * 14 + (seed % 22),
    speed: world(48 + Math.min(52, difficulty * 4)),
    radius: world(90),
    size: world(350),
    attackRange: world(70),
    attackDamage: 4 + Math.floor(difficulty / 2),
    attackCooldownMs: Math.max(650, 1_250 - difficulty * 35),
    projectileSpeed: world(155 + difficulty * 8),
    projectileRange: world(230),
  };
}

export function monsterSpecsForRoom(room: GraphNode, floor = 1, bossKind?: BossKind): Monster[] {
  if (room.isRoot || room.tag === "img") return [];
  const roomSeed = stableHash(`${room.lootSeed}|monsters`);

  const difficulty = floorDifficulty(floor);
  const count = monsterCountForRoom(room, floor);
  const offsets: Array<[number, number]> = [
    [-world(90), -world(55)], [world(90), world(55)], [world(80), -world(65)],
    [-world(80), world(70)], [0, -world(92)],
  ];
  const regularMonsters = Array.from({ length: count }, (_, index): Monster => {
    const seed = stableHash(`${roomSeed}|${floor}|${index}`);
    const kind = monsterKindForSeed(seed, difficulty);
    const fast = kind === "fast";
    const sentry = kind === "sentry";
    const offset = offsets[index % offsets.length]!;
    const hpBase = sentry ? 2 : 1;
    const hpBonus = Math.min(6, Math.floor(difficulty / 2));
    const speed = sentry ? 0 : world((fast ? 150 : 80) + Math.min(95, difficulty * (fast ? 11 : 8)));
    const attackDamage = (sentry ? 1 : 1 + ((seed >>> 19) % 2)) + Math.min(3, Math.floor(difficulty / 3));
    const attackCooldownMs = Math.max(420, (sentry ? 1500 : 1150) - difficulty * (sentry ? 70 : 35) + ((seed >>> 15) % 140));
    const projectileSpeed = sentry ? world(220 + Math.min(260, difficulty * 18)) : 0;
    const projectileRange = sentry ? world(980 + Math.min(420, difficulty * 40)) : 0;
    const attackRange = sentry ? world(820) : world(38 + Math.min(48, difficulty * 4));
    return {
      id: `${room.id}::monster-${index}`,
      seed,
      kind,
      spawnRoomId: room.id,
      roomId: room.id,
      x: room.x + offset[0],
      y: room.y + offset[1],
      maxHp: hpBase + ((seed >>> 11) % (sentry ? 5 : 6)) + hpBonus,
      speed,
      fast,
      radius: sentry ? 88 : fast ? 80 : 96,
      size: sentry ? 240 : fast ? 224 : 272,
      attackRange,
      attackDamage,
      attackCooldownMs,
      projectileSpeed,
      projectileRange,
      dropsLoot: ((seed >>> 23) % 100) < 18,
      lastAttackAt: -Infinity,
      active: false,
      dead: false,
      hp: 1,
      path: [],
      pathIndex: 0,
      pathTargetRoomId: null,
      pathTargetX: room.x,
      pathTargetY: room.y,
      nextPathRefreshAt: 0,
    };
  });
  return room.tag === "script"
    ? [bossSpecForRoom(room, floor, bossKind), ...regularMonsters]
    : regularMonsters;
}

export function monsterSpecsForCorridor(link: LayoutLink, floor = 1): Monster[] {
  if (link.source.isRoot) return [];
  const corridorSeed = stableHash(`${link.source.lootSeed}|corridor|${link.target.id}|monsters`);
  const count = corridorSeed % 3;
  const difficulty = floorDifficulty(floor);
  return Array.from({ length: count }, (_, index) => {
    const seed = stableHash(`${corridorSeed}|${floor}|${index}`);
    const kind = monsterKindForSeed(seed, difficulty);
    const fast = kind === "fast";
    const sentry = kind === "sentry";
    const position = pointAlongCorridor(link, (index + 1) / (count + 1), 0);
    const hpBase = sentry ? 2 : 1;
    const hpBonus = Math.min(6, Math.floor(difficulty / 2));
    return {
      id: `${link.id}::monster-${index}`,
      seed,
      kind,
      spawnRoomId: link.ownerRoomId,
      roomId: link.ownerRoomId,
      ...position,
      maxHp: hpBase + ((seed >>> 11) % (sentry ? 5 : 6)) + hpBonus,
      hp: 1,
      speed: sentry ? 0 : world((fast ? 150 : 80) + Math.min(95, difficulty * (fast ? 11 : 8))),
      fast,
      radius: sentry ? 88 : fast ? 80 : 96,
      size: sentry ? 240 : fast ? 224 : 272,
      attackRange: sentry ? world(820) : world(38 + Math.min(48, difficulty * 4)),
      attackDamage: 1 + Math.min(3, Math.floor(difficulty / 3)),
      attackCooldownMs: Math.max(420, (sentry ? 1500 : 1150) - difficulty * (sentry ? 70 : 35) + ((seed >>> 15) % 140)),
      projectileSpeed: sentry ? world(220 + Math.min(260, difficulty * 18)) : 0,
      projectileRange: sentry ? world(980 + Math.min(420, difficulty * 40)) : 0,
      dropsLoot: ((seed >>> 23) % 100) < 18,
      lastAttackAt: -Infinity,
      active: false,
      dead: false,
      path: [],
      pathIndex: 0,
      pathTargetRoomId: null,
      pathTargetX: position.x,
      pathTargetY: position.y,
      nextPathRefreshAt: 0,
    };
  });
}

export function monsterSpecForSpawner(spawner: Decoration, floor: number, index: number): Monster {
  const difficulty = floorDifficulty(floor);
  const seed = stableHash(`${spawner.id}|reinforcement|${floor}|${index}`);
  const kind = monsterKindForSeed(seed, difficulty);
  const fast = kind === "fast";
  const sentry = kind === "sentry";
  const offsets: Array<[number, number]> = [[world(64), 0], [-world(64), 0], [0, world(64)], [0, -world(64)]];
  const offset = offsets[index % offsets.length]!;
  const hpBase = sentry ? 3 : 2;
  return {
    id: `${spawner.id}::reinforcement-${index}`,
    seed,
    kind,
    spawnRoomId: spawner.roomId,
    roomId: spawner.roomId,
    x: spawner.x + offset[0],
    y: spawner.y + offset[1],
    maxHp: hpBase + ((seed >>> 11) % 5) + Math.min(7, Math.floor(difficulty / 2)),
    hp: 1,
    speed: sentry ? 0 : world((fast ? 165 : 92) + Math.min(110, difficulty * (fast ? 12 : 9))),
    fast,
    radius: sentry ? 88 : fast ? 80 : 96,
    size: sentry ? 240 : fast ? 224 : 272,
    attackRange: sentry ? world(860) : world(42 + Math.min(52, difficulty * 4)),
    attackDamage: 1 + Math.min(4, Math.floor(difficulty / 2)),
    attackCooldownMs: Math.max(380, (sentry ? 1_350 : 1_000) - difficulty * 45 + ((seed >>> 15) % 120)),
    projectileSpeed: sentry ? world(250 + Math.min(280, difficulty * 20)) : 0,
    projectileRange: sentry ? world(1_020 + Math.min(460, difficulty * 45)) : 0,
    dropsLoot: false,
    lastAttackAt: -Infinity,
    active: false,
    dead: false,
    path: [],
    pathIndex: 0,
    pathTargetRoomId: null,
    pathTargetX: spawner.x,
    pathTargetY: spawner.y,
    nextPathRefreshAt: 0,
  };
}

export function monsterSpecForBossSummon(boss: Monster, floor: number, index: number): Monster {
  const difficulty = floorDifficulty(floor);
  const seed = stableHash(`${boss.id}|summon|${floor}|${index}`);
  const kind = monsterKindForSeed(seed, difficulty);
  const fast = kind === "fast";
  const sentry = kind === "sentry";
  const angle = index * 2.399963;
  const distance = boss.radius + world(58);
  return {
    id: `${boss.id}::summon-${index}`,
    seed,
    kind,
    spawnRoomId: boss.spawnRoomId,
    roomId: boss.spawnRoomId,
    x: boss.x + Math.cos(angle) * distance,
    y: boss.y + Math.sin(angle) * distance,
    maxHp: 2 + (seed % 4) + Math.min(5, Math.floor(difficulty / 2)),
    hp: 1,
    speed: sentry ? 0 : world((fast ? 170 : 95) + Math.min(100, difficulty * 9)),
    fast,
    radius: sentry ? 88 : fast ? 80 : 96,
    size: sentry ? 240 : fast ? 224 : 272,
    attackRange: sentry ? world(760) : world(40 + Math.min(42, difficulty * 3)),
    attackDamage: 1 + Math.min(3, Math.floor(difficulty / 3)),
    attackCooldownMs: Math.max(450, (sentry ? 1_400 : 1_050) - difficulty * 40),
    projectileSpeed: sentry ? world(235 + difficulty * 16) : 0,
    projectileRange: sentry ? world(900 + difficulty * 32) : 0,
    dropsLoot: false,
    lastAttackAt: -Infinity,
    active: false,
    dead: false,
    path: [],
    pathIndex: 0,
    pathTargetRoomId: null,
    pathTargetX: boss.x,
    pathTargetY: boss.y,
    nextPathRefreshAt: 0,
  };
}

export function buildMonsters(
  layout: DungeonLayout,
  savedStates: ReadonlyMap<string, MonsterState>,
  visitedRooms: ReadonlySet<number>,
  floor = 1,
  decorations: readonly Decoration[] = [],
): Monster[] {
  const scriptRooms = layout.nodes.filter(room => room.tag === "script");
  const rosterOffset = stableHash(`${layout.nodes.find(room => room.isRoot)?.lootSeed ?? 0}|boss-roster`) % BOSS_KINDS.length;
  const bossKindsByRoom = new Map(scriptRooms.map((room, index) => [
    room.id,
    BOSS_KINDS[(rosterOffset + index) % BOSS_KINDS.length]!,
  ]));
  const roomSpecs = layout.nodes.flatMap(room => monsterSpecsForRoom(room, floor, bossKindsByRoom.get(room.id)));
  const bossSummons = roomSpecs
    .filter(monster => monster.bossKind === "fork-bomb")
    .flatMap(boss => Array.from(
      { length: savedStates.get(boss.id)?.summonedCount ?? 0 },
      (_, index) => monsterSpecForBossSummon(boss, floor, index),
    ));
  const specs = [
    ...roomSpecs,
    ...layout.links.flatMap(link => monsterSpecsForCorridor(link, floor)),
    ...decorations
      .filter(item => item.spawner)
      .flatMap(item => Array.from(
        { length: item.spawnedCount ?? 0 },
        (_, index) => monsterSpecForSpawner(item, floor, index),
      )),
    ...bossSummons,
  ];
  return specs.map((spec) => {
    const saved = savedStates.get(spec.id);
    return {
      ...spec,
      x: saved?.x ?? spec.x,
      y: saved?.y ?? spec.y,
      roomId: saved?.roomId ?? spec.roomId,
      hp: saved?.hp ?? spec.maxHp,
      dead: saved?.dead ?? false,
      active: saved?.active ?? visitedRooms.has(spec.spawnRoomId),
      droppedLoot: saved?.droppedLoot ?? false,
      dropId: saved?.dropId ?? null,
      dropX: saved?.dropX ?? null,
      dropY: saved?.dropY ?? null,
      dropKind: saved?.dropKind ?? null,
      attackSequence: saved?.attackSequence ?? spec.attackSequence,
      summonedCount: saved?.summonedCount ?? spec.summonedCount,
    };
  });
}

export function lootCountForRoom(room: GraphNode): number {
  const seed = stableHash(`${room.lootSeed}|loot-count`);
  if (room.tag === "img") return 3 + (seed % 3);
  if (seed % 100 >= 30) return 0;
  return 1 + ((seed >>> 8) % 2);
}

export function lootPositions(room: GraphNode, count: number): Point[] {
  if (!count) return [];
  const offsets: Array<[number, number]> = [
    [-world(160), -world(100)], [world(160), -world(100)],
    [-world(160), world(100)], [world(160), world(100)], [0, world(135)],
  ];
  return Array.from({ length: count }, (_, index) => {
    const offset = offsets[index % offsets.length]!;
    return { x: room.x + offset[0], y: room.y + offset[1] };
  });
}

export function staircasePositions(room: GraphNode, count: number, yOffset = 0): Point[] {
  const capped = Math.min(10, Math.max(0, count));
  if (!capped) return [];
  const columns = Math.min(5, capped);
  const rows = Math.ceil(capped / columns);
  return Array.from({ length: capped }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const itemsInRow = Math.min(columns, capped - row * columns);
    return {
      x: room.x - ((itemsInRow - 1) * world(64)) / 2 + column * world(64),
      y: room.y - ((rows - 1) * world(62)) / 2 + row * world(62) + yOffset,
    };
  });
}

export function buildInteractiveObjects(
  layout: DungeonLayout,
  pageUrl: string,
  previousUrl: string | null,
  collectedLoot: ReadonlySet<string>,
): { stairs: Stair[]; loot: LootItem[] } {
  const stairs: Stair[] = [];
  const loot: LootItem[] = [];

  for (const room of layout.nodes) {
    const hrefs = room.hrefs.slice(0, room.isRoot ? 9 : 10);
    const positions = staircasePositions(room, hrefs.length + (room.isRoot ? 1 : 0));
    let positionIndex = 0;
    if (room.isRoot) {
      const position = positions[positionIndex++]!;
      stairs.push({
        type: "up",
        roomId: room.id,
        url: previousUrl,
        enabled: Boolean(previousUrl),
        ...position,
      });
    }
    for (const url of hrefs) {
      const position = positions[positionIndex++]!;
      stairs.push({ type: "down", roomId: room.id, url, enabled: true, ...position });
    }

    const count = lootCountForRoom(room);
    const spots = lootPositions(room, count);
    for (let index = 0; index < count; index += 1) {
      const id = `${pageUrl}::${room.id}::loot-${index}`;
      if (collectedLoot.has(id)) continue;
      const position = spots[index]!;
      loot.push({
        id,
        roomId: room.id,
        ...position,
        kind: lootKindForSeed(stableHash(`${room.lootSeed}|loot|${index}`)),
      });
    }
    const weaponLoot = weaponLootForRoom(room, pageUrl);
    if (weaponLoot && !collectedLoot.has(weaponLoot.id)) loot.push(weaponLoot);
  }
  return { stairs, loot };
}
