import { ENVIRONMENT_SEGMENT_SIZE, ROOM_HEIGHT, ROOM_WIDTH, world } from "../config";
import type {
  Decoration,
  BossKind,
  DungeonLayout,
  GraphNode,
  LayoutLink,
  LootItem,
  LootKind,
  Monster,
  MonsterState,
  ObstacleState,
  Point,
  Stair,
} from "../types";
import { stableHash } from "./hash";
import { pointInCorridor, pointInRoomFloor } from "./geometry";
import {
  BOSS_DEFINITIONS,
  DECORATION_DEFINITIONS,
  MAX_REGULAR_MONSTER_RADIUS,
  MONSTER_SPAWN_PROFILES,
  MONSTER_VISUAL_DEFINITIONS,
  PLAYER_SPEC,
  PORTAL_DEFINITION,
  REGULAR_MONSTER_DEFINITIONS,
  ROOM_SCENERY_THEMES,
  SCENERY_DEFINITIONS,
  WORLD_GEOMETRY,
  type DecorationDefinition,
  type RoomSceneryTheme,
  type WeightedDecorationDefinition,
} from "./specs";
import { weaponForRoom, type WeaponSource } from "./weapons";

export function lootKindForSeed(seed: number): LootKind {
  return lootKindForRoll((seed >>> 3) % 100);
}

function lootKindForRoll(roll: number): LootKind {
  if (roll < 30) return "credit";
  if (roll < 60) return "energy";
  if (roll < 80) return "core";
  if (roll < 95) return "medkit";
  return "crystal";
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
      weaponPlacement: index === 1 ? "floor" : undefined,
    };
  });
}

export function weaponLootForRoom(room: GraphNode, pageUrl: string): LootItem | null {
  if (room.isRoot || room.tag === "script") return null;
  const source: WeaponSource = room.isHidden ? "hidden" : "room";
  const chance = room.isHidden ? 100 : room.tag === "img" ? 25 : 10;
  if (stableHash(`${room.lootSeed}|weapon-drop`) % 100 >= chance) return null;
  const maxYOffset = Math.max(
    0,
    room.height / 2 - WORLD_GEOMETRY.wallThickness - PLAYER_SPEC.radius - world(10),
  );
  return {
    id: `${pageUrl}::${room.id}::weapon`,
    roomId: room.id,
    x: room.x,
    y: room.y - Math.min(world(135), maxYOffset),
    kind: "weapon",
    weapon: weaponForRoom(room, source),
    weaponPlacement: "pedestal",
  };
}

export function weaponPedestalForRoom(room: GraphNode, pageUrl: string): Decoration | null {
  const weapon = weaponLootForRoom(room, pageUrl);
  if (!weapon) return null;
  return {
    ...DECORATION_DEFINITIONS.pedestal,
    id: `${weapon.id}::pedestal`,
    roomId: room.id,
    x: weapon.x,
    y: weapon.y,
    visualVariant: room.lootSeed,
    maxHp: 0,
    hp: 0,
    destroyed: false,
    dropKind: null,
  };
}

export function sceneryDropKindForSeed(seed: number): LootKind | null {
  if (stableHash(`${seed}|drop`) % 100 >= 30) return null;

  return lootKindForRoll(stableHash(`${seed}|drop-kind`) % 100);
}

const ROOM_SCENERY_THEME_IDS = Object.keys(ROOM_SCENERY_THEMES) as RoomSceneryTheme[];

export function roomSceneryThemeForRoom(room: Pick<GraphNode, "lootSeed">): RoomSceneryTheme {
  return ROOM_SCENERY_THEME_IDS[
    stableHash(`${room.lootSeed}|scenery-theme`) % ROOM_SCENERY_THEME_IDS.length
  ]!;
}

function weightedDecoration(
  entries: readonly WeightedDecorationDefinition[],
  seed: number,
): DecorationDefinition {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = seed % totalWeight;
  for (const entry of entries) {
    if (roll < entry.weight) return entry.definition;
    roll -= entry.weight;
  }
  return entries[0]!.definition;
}

function roomDecorationSlots(room: GraphNode, seed: number): Point[] {
  const edgeClearance = WORLD_GEOMETRY.wallThickness + PLAYER_SPEC.radius + world(20);
  const edgeX = Math.max(world(70), room.width / 2 - edgeClearance);
  const edgeY = Math.max(world(65), room.height / 2 - edgeClearance);
  const horizontal = [-1, -0.5, 0, 0.5, 1].map(scale => ({ x: scale * edgeX, y: -edgeY }));
  const vertical = [-0.5, 0, 0.5].map(scale => ({ x: edgeX, y: scale * edgeY }));
  const groups: Point[][] = [
    horizontal,
    vertical,
    horizontal.map(point => ({ x: -point.x, y: edgeY })),
    vertical.map(point => ({ x: -edgeX, y: -point.y })),
    [-0.6, -0.2, 0.2, 0.6].map(scale => ({ x: scale * edgeX, y: -edgeY * 0.35 })),
    [-0.6, -0.2, 0.2, 0.6].map(scale => ({ x: -scale * edgeX, y: edgeY * 0.35 })),
  ];
  const start = seed % 4;
  const perimeter = [...groups.slice(start, 4), ...groups.slice(0, start), ...groups.slice(4)];
  if ((seed >>> 5) % 2) perimeter.forEach(group => group.reverse());
  return perimeter.flat().map(point => ({ x: room.x + point.x, y: room.y + point.y }));
}

function decorationFits(
  position: Point,
  definition: DecorationDefinition,
  room: GraphNode,
  placed: readonly Decoration[],
): boolean {
  const radius = Math.max(world(10), definition.footprint);
  const maxWeaponYOffset = Math.max(
    0,
    room.height / 2 - WORLD_GEOMETRY.wallThickness - PLAYER_SPEC.radius - world(10),
  );
  const interactionPoints = [
    { x: room.x, y: room.y - Math.min(world(135), maxWeaponYOffset) },
    ...lootPositions(room, 5),
    ...staircasePositions(
      room,
      room.hrefs.length + (room.isRoot ? 1 : 0),
      room.tag === "script" ? room.height * 0.24 : 0,
    ),
  ];
  const leavesInteractionsClear = !definition.obstacle || interactionPoints.every(point =>
    Math.hypot(position.x - point.x, position.y - point.y) >=
      radius + PLAYER_SPEC.radius + world(10)
  );
  const leavesRoomCenterClear = !definition.obstacle || Math.hypot(
    position.x - room.x,
    position.y - room.y,
  ) >= radius + MAX_REGULAR_MONSTER_RADIUS + world(20);
  return leavesRoomCenterClear && leavesInteractionsClear &&
    pointInRoomFloor(position.x, position.y, room, radius) && placed.every(item =>
    Math.hypot(position.x - item.x, position.y - item.y) >=
      radius + Math.max(world(10), item.footprint ?? 0) + world(8)
  );
}

export function decorationSpecsForRoom(room: GraphNode, floor = 1): Decoration[] {
  const seed = stableHash(`${room.lootSeed}|decor`);
  const difficulty = floorDifficulty(floor);
  const count = Math.max(5, Math.floor(roomSegmentArea(room) * sceneryDensityForFloor(floor))) + (seed % 3);
  const theme = ROOM_SCENERY_THEMES[roomSceneryThemeForRoom(room)];
  const slots = roomDecorationSlots(room, seed);
  const spawnerRate = Math.min(82, 12 + difficulty * 6);
  const spawnerRoomRoll = stableHash(`${room.lootSeed}|spawner-rate`) % 100;
  const expectedSpawners = roomSegmentArea(room) * spawnerDensityForFloor(floor);
  const minSpawnerCount = Math.max(0, Math.floor(expectedSpawners));
  const maxSpawnerCount = Math.max(minSpawnerCount, Math.min(4, Math.ceil(expectedSpawners)));
  let requestedSpawnerCount = 0;
  if (!room.isRoot && room.tag !== "img" && spawnerRoomRoll < spawnerRate) {
    requestedSpawnerCount = minSpawnerCount === maxSpawnerCount
      ? Math.max(1, minSpawnerCount)
      : minSpawnerCount + (stableHash(`${room.lootSeed}|spawner-count`) % (maxSpawnerCount - minSpawnerCount + 1));
  }
  const spawners: Decoration[] = [];
  for (let index = 0; index < requestedSpawnerCount; index += 1) {
    const itemSeed = stableHash(`${room.lootSeed}|spawner|${index}|${floor}`);
    const type = DECORATION_DEFINITIONS.spawner;
    const slotIndex = slots.findIndex(position => decorationFits(position, type, room, spawners));
    if (slotIndex < 0) break;
    const [position] = slots.splice(slotIndex, 1);
    const hp = 6 + difficulty + (itemSeed % 3);
    spawners.push({
      ...type,
      id: `${room.id}::spawner-${index}`,
      roomId: room.id,
      ...position!,
      visualVariant: itemSeed,
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
  const decorations: Decoration[] = [];
  for (let index = 0; index < count; index += 1) {
    const itemSeed = stableHash(`${room.lootSeed}|decor|${index}`);
    const usePrimary = itemSeed % 100 < theme.primaryPercent;
    let pool = usePrimary ? theme.primary : theme.accents;
    if (index < 4) {
      const blocking = pool.filter(entry => entry.definition.obstacle);
      pool = blocking.length
        ? blocking
        : [...theme.primary, ...theme.accents].filter(entry => entry.definition.obstacle);
    }
    const type = weightedDecoration(pool, itemSeed >>> 7);
    const slotIndex = slots.findIndex(position => decorationFits(position, type, room, [...spawners, ...decorations]));
    if (slotIndex < 0) continue;
    const [position] = slots.splice(slotIndex, 1);
    const hp = type.destructible ? 3 + ((itemSeed >>> 9) % 4) + Math.floor(difficulty / 3) : 0;
    decorations.push({
      ...type,
      id: `${room.id}::decor-${index}`,
      roomId: room.id,
      ...position!,
      visualVariant: itemSeed,
      maxHp: hp,
      hp,
      destroyed: false,
      dropKind: type.destructible ? sceneryDropKindForSeed(itemSeed) : null,
    });
  }

  return [...decorations, ...spawners];
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
  const expected = corridorSegmentLength(link) * sceneryDensityForFloor(floor);
  const count = Math.max(2, Math.floor(expected)) + (seed % 2);
  return Array.from({ length: count }, (_, index) => {
    const itemSeed = stableHash(`${seed}|${index}`);
    const position = pointAlongCorridor(
      link,
      index === 0 ? 0.5 : index === 1 ? 0.28 : 0.72,
      (index % 2 ? 1 : -1) * world(26),
    );
    const definition = SCENERY_DEFINITIONS[itemSeed % SCENERY_DEFINITIONS.length]!;
    const hp = definition.destructible ? 3 + (itemSeed % 3) + Math.floor(difficulty / 3) : 0;
    return {
      ...definition,
      id: `${link.id}::decor-${index}`,
      roomId: link.ownerRoomId,
      ...position,
      visualVariant: itemSeed,
      kind: "corridor-prop",
      obstacle: false,
      radius: definition.radius,
      footprint: 0,
      maxHp: hp,
      hp,
      destroyed: false,
      dropKind: definition.destructible ? sceneryDropKindForSeed(itemSeed) : null,
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
  return pointToSegmentDistance(item, door, approach) < (item.footprint ?? item.radius) + MAX_REGULAR_MONSTER_RADIUS + world(20);
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
      ...DECORATION_DEFINITIONS.debrisCircuit,
      kind: "doorway-debris",
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

const MONSTER_DENSITY_PER_SEGMENT = 0.16;
const MONSTER_DENSITY_PER_FLOOR = 0.03;
const SCENERY_DENSITY_PER_SEGMENT = 0.34;
const SCENERY_DENSITY_PER_FLOOR = 0.03;
const SPAWNER_DENSITY_PER_SEGMENT = 0.0625;
const SPAWNER_DENSITY_PER_FLOOR = 0.015;
const BOSS_ARENA_MONSTER_DENSITY_FACTOR = 0.6;

function roomSegmentArea(room: GraphNode): number {
  return room.width * room.height / (ENVIRONMENT_SEGMENT_SIZE * ENVIRONMENT_SEGMENT_SIZE);
}

function corridorSegmentLength(link: LayoutLink): number {
  let total = 0;
  for (let index = 1; index < link.points.length; index += 1) {
    const start = link.points[index - 1]!;
    const end = link.points[index]!;
    total += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return total / ENVIRONMENT_SEGMENT_SIZE;
}

function monsterDensityForFloor(floor: number): number {
  return MONSTER_DENSITY_PER_SEGMENT + floorDifficulty(floor) * MONSTER_DENSITY_PER_FLOOR;
}

function sceneryDensityForFloor(floor: number): number {
  return SCENERY_DENSITY_PER_SEGMENT + floorDifficulty(floor) * SCENERY_DENSITY_PER_FLOOR;
}

function spawnerDensityForFloor(floor: number): number {
  return SPAWNER_DENSITY_PER_SEGMENT + floorDifficulty(floor) * SPAWNER_DENSITY_PER_FLOOR;
}

function floorDifficulty(floor: number): number {
  return Math.max(0, floor - 1);
}

function monsterCountForRoom(room: GraphNode, floor: number, densityFactor = 1): number {
  const expected = roomSegmentArea(room) * monsterDensityForFloor(floor) * densityFactor;
  const minimum = Math.max(1, Math.floor(expected));
  const countSeed = stableHash(`${room.lootSeed}|monster-count|${floor}`);
  return minimum + (countSeed % 2);
}

function monsterKindForSeed(seed: number, difficulty = 0): "slow" | "fast" | "sentry" {
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
  const definition = BOSS_DEFINITIONS[bossKind];
  const visualKind = definition.visualKinds[seed % definition.visualKinds.length]!;
  const positionSeed = stableHash(`${room.lootSeed}|boss-position`);
  const xOffset = ((positionSeed % 3) - 1) * world(38);
  const yOffset = -room.height * 0.18 + (((positionSeed >>> 5) % 3) - 1) * world(14);
  return {
    id: `${room.id}::boss`,
    seed,
    kind: bossKind,
    visualKind,
    visual: MONSTER_VISUAL_DEFINITIONS[visualKind],
    bossKind,
    spawnRoomId: room.id,
    roomId: room.id,
    x: room.x + xOffset,
    y: room.y + yOffset,
    maxHp: definition.baseHp + difficulty * definition.hpPerDifficulty + (seed % definition.hpVariance),
    speed: definition.speed + Math.min(definition.maxSpeedBonus, difficulty * definition.speedPerDifficulty),
    fast: false,
    radius: definition.radius,
    size: definition.size,
    attackRange: definition.attackRange,
    attackDamage: definition.attackDamage + Math.floor(difficulty / definition.attackDamageDifficultyDivisor),
    attackCooldownMs: Math.max(
      definition.minAttackCooldownMs,
      definition.attackCooldownMs - difficulty * definition.cooldownReductionPerDifficulty,
    ),
    projectileSpeed: definition.projectileSpeed + difficulty * definition.projectileSpeedPerDifficulty,
    projectileRange: definition.projectileRange,
    dropsLoot: true,
    lastAttackAt: -Infinity,
    active: false,
    dead: false,
    moving: false,
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
}

function regularMonsterSpec(
  id: string,
  seed: number,
  roomId: number,
  position: Point,
  floor: number,
  profileName: keyof typeof MONSTER_SPAWN_PROFILES,
): Monster {
  const difficulty = floorDifficulty(floor);
  const kind = monsterKindForSeed(seed, difficulty);
  const definition = REGULAR_MONSTER_DEFINITIONS[kind];
  const profile = MONSTER_SPAWN_PROFILES[profileName];
  const visualKind = definition.visualKinds[seed % definition.visualKinds.length]!;
  const scaledPercent = (value: number, percent: number): number => Math.round(value * percent / 100);
  const speed = definition.speed + Math.min(definition.maxSpeedBonus, difficulty * definition.speedPerDifficulty);
  const attackRange = definition.attackRange + Math.min(
    definition.maxAttackRangeBonus,
    difficulty * definition.attackRangePerDifficulty,
  );
  const projectileSpeed = definition.projectileSpeed + Math.min(
    definition.maxProjectileSpeedBonus,
    difficulty * definition.projectileSpeedPerDifficulty,
  );
  const projectileRange = definition.projectileRange + Math.min(
    definition.maxProjectileRangeBonus,
    difficulty * definition.projectileRangePerDifficulty,
  );
  return {
    id,
    seed,
    kind,
    visualKind,
    visual: MONSTER_VISUAL_DEFINITIONS[visualKind],
    spawnRoomId: roomId,
    roomId,
    ...position,
    maxHp: definition.baseHp + profile.hpBonus + (seed >>> 11) % definition.hpVariance + Math.min(6, Math.floor(difficulty / 2)),
    hp: 1,
    speed: scaledPercent(speed, profile.speedPercent),
    fast: definition.fast,
    radius: definition.radius,
    size: definition.size,
    attackRange: scaledPercent(attackRange, profile.rangePercent),
    attackDamage: definition.attackDamage + (kind === "sentry" ? 0 : (seed >>> 19) % 2) + Math.min(3, Math.floor(difficulty / 3)),
    attackCooldownMs: Math.max(
      definition.minAttackCooldownMs,
      scaledPercent(
        definition.attackCooldownMs - difficulty * definition.cooldownReductionPerDifficulty + (seed >>> 15) % 140,
        profile.cooldownPercent,
      ),
    ),
    projectileSpeed,
    projectileRange,
    dropsLoot: profile.dropsLoot && ((seed >>> 23) % 100) < 72,
    lastAttackAt: -Infinity,
    active: false,
    dead: false,
    moving: false,
    path: [],
    pathIndex: 0,
    pathTargetRoomId: null,
    pathTargetX: position.x,
    pathTargetY: position.y,
    nextPathRefreshAt: 0,
  };
}

export function monsterSpecsForRoom(room: GraphNode, floor = 1, bossKind?: BossKind): Monster[] {
  if (room.isRoot || room.tag === "img") return [];
  const roomSeed = stableHash(`${room.lootSeed}|monsters`);
  const count = monsterCountForRoom(
    room,
    floor,
    room.tag === "script" ? BOSS_ARENA_MONSTER_DENSITY_FACTOR : 1,
  );
  const offsetScaleX = room.width / ROOM_WIDTH;
  const offsetScaleY = room.height / ROOM_HEIGHT;
  const offsets: Array<[number, number]> = room.tag === "script"
    ? [
      [-world(250), -world(20)], [world(250), -world(20)],
      [-world(220), world(150)], [world(220), world(150)], [0, world(190)],
    ]
    : [
      [-world(90), -world(55)], [world(90), world(55)], [world(80), -world(65)],
      [-world(80), world(70)], [0, -world(92)],
    ];
  const regularMonsters = Array.from({ length: count }, (_, index): Monster => {
    const seed = stableHash(`${roomSeed}|${floor}|${index}`);
    const [offsetX, offsetY] = offsets[index % offsets.length]!;
    return regularMonsterSpec(
      `${room.id}::monster-${index}`,
      seed,
      room.id,
      { x: room.x + offsetX * offsetScaleX, y: room.y + offsetY * offsetScaleY },
      floor,
      "room",
    );
  });
  return room.tag === "script"
    ? [bossSpecForRoom(room, floor, bossKind), ...regularMonsters]
    : regularMonsters;
}

export function monsterSpecsForCorridor(link: LayoutLink, floor = 1): Monster[] {
  if (link.source.isRoot) return [];
  const corridorSeed = stableHash(`${link.source.lootSeed}|corridor|${link.target.id}|monsters`);
  const expected = corridorSegmentLength(link) * monsterDensityForFloor(floor);
  const count = Math.max(0, Math.floor(expected)) + (corridorSeed % 2);
  return Array.from({ length: count }, (_, index) => {
    const seed = stableHash(`${corridorSeed}|${floor}|${index}`);
    const position = pointAlongCorridor(link, (index + 1) / (count + 1), 0);
    return regularMonsterSpec(`${link.id}::monster-${index}`, seed, link.ownerRoomId, position, floor, "room");
  });
}

export function monsterSpecForSpawner(spawner: Decoration, floor: number, index: number): Monster {
  const seed = stableHash(`${spawner.id}|reinforcement|${floor}|${index}`);
  return {
    ...regularMonsterSpec(
    `${spawner.id}::reinforcement-${index}`,
    seed,
    spawner.roomId,
    { x: spawner.x, y: spawner.y },
    floor,
    "spawner",
    ),
    spawnSourceId: spawner.id,
  };
}

export function monsterSpecForBossSummon(boss: Monster, floor: number, index: number): Monster {
  const seed = stableHash(`${boss.id}|summon|${floor}|${index}`);
  const angle = index * 2.399963;
  const kind = monsterKindForSeed(seed, floorDifficulty(floor));
  const distance = boss.radius + REGULAR_MONSTER_DEFINITIONS[kind].radius + world(30);
  return regularMonsterSpec(
    `${boss.id}::summon-${index}`,
    seed,
    boss.spawnRoomId,
    { x: boss.x + Math.cos(angle) * distance, y: boss.y + Math.sin(angle) * distance },
    floor,
    "summon",
  );
}

export function buildMonsters(
  layout: DungeonLayout,
  savedStates: ReadonlyMap<string, MonsterState>,
  visitedRooms: ReadonlySet<number>,
  floor = 1,
  decorations: readonly Decoration[] = [],
): Monster[] {
  const roomSpecs = layout.nodes.flatMap(room => monsterSpecsForRoom(room, floor));
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
  return specs.flatMap((spec) => {
    const saved = savedStates.get(spec.id);
    const desired = { x: saved?.x ?? spec.x, y: saved?.y ?? spec.y };
    const position = safeMonsterPosition(spec, desired, layout, decorations);
    if (!position) return [];
    const relocated = position.x !== desired.x || position.y !== desired.y;
    return [{
      ...spec,
      ...position,
      roomId: relocated ? spec.spawnRoomId : saved?.roomId ?? spec.roomId,
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
    }];
  });
}

export function monsterPositionIsClear(
  position: Point,
  radius: number,
  layout: DungeonLayout,
  decorations: readonly Decoration[],
  ignoredDecorationId?: string,
): boolean {
  const onFloor = layout.nodes.some(room => pointInRoomFloor(position.x, position.y, room, radius)) ||
    layout.links.some(link => pointInCorridor(position.x, position.y, link, radius));
  if (!onFloor) return false;
  return decorations.every(item =>
    item.id === ignoredDecorationId ||
    !item.obstacle ||
    item.destroyed ||
    Math.hypot(position.x - item.x, position.y - item.y) >= radius + (item.footprint ?? item.radius)
  );
}

function safeMonsterPosition(
  monster: Monster,
  desired: Point,
  layout: DungeonLayout,
  decorations: readonly Decoration[],
): Point | null {
  const room = layout.nodes.find(candidate => candidate.id === monster.spawnRoomId);
  const centers = [desired, ...(room ? [{ x: room.x, y: room.y }] : [])];
  const candidates: Point[] = [];
  const spacing = monster.radius + world(24);
  const angleOffset = (monster.seed % 12) / 12 * Math.PI * 2;
  for (const center of centers) {
    candidates.push(center);
    for (let ring = 1; ring <= 4; ring += 1) {
      for (let index = 0; index < 12; index += 1) {
        const angle = angleOffset + index / 12 * Math.PI * 2;
        candidates.push({
          x: center.x + Math.cos(angle) * spacing * ring,
          y: center.y + Math.sin(angle) * spacing * ring,
        });
      }
    }
  }
  return candidates.find(position =>
    monsterPositionIsClear(position, monster.radius, layout, decorations, monster.spawnSourceId)
  ) ?? null;
}

export function lootCountForRoom(room: GraphNode): number {
  const seed = stableHash(`${room.lootSeed}|loot-count`);
  if (room.tag === "img") return 3 + (seed % 5);
  if (seed % 100 >= 60) return 0;
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
  const capped = Math.min(8, Math.max(0, count));
  if (!capped) return [];
  const portalSize = PORTAL_DEFINITION.size;
  const horizontalSpacing = world(135);
  const verticalSpacing = world(115);
  const fittingColumns = Math.max(1, Math.floor((room.width - portalSize) / horizontalSpacing) + 1);
  const columns = Math.min(5, capped, fittingColumns);
  const rows = Math.ceil(capped / columns);
  return Array.from({ length: capped }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const itemsInRow = Math.min(columns, capped - row * columns);
    return {
      x: room.x - ((itemsInRow - 1) * horizontalSpacing) / 2 + column * horizontalSpacing,
      y: room.y - ((rows - 1) * verticalSpacing) / 2 + row * verticalSpacing + yOffset,
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
    const hrefs = room.hrefs.slice(0, room.isRoot ? 7 : 8);
    const positions = staircasePositions(
      room,
      hrefs.length + (room.isRoot ? 1 : 0),
      room.tag === "script" ? room.height * 0.24 : 0,
    );
    let positionIndex = 0;
    if (room.isRoot) {
      const position = positions[positionIndex++]!;
      stairs.push({
        id: `${pageUrl}::${room.id}::portal-up`,
        type: "up",
        roomId: room.id,
        url: previousUrl,
        enabled: Boolean(previousUrl),
        ...position,
      });
    }
    for (const [index, url] of hrefs.entries()) {
      const position = positions[positionIndex++]!;
      stairs.push({
        id: `${pageUrl}::${room.id}::portal-down-${index}`,
        type: "down",
        roomId: room.id,
        url,
        enabled: true,
        ...position,
      });
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
