import { ASSETS } from "../config";
import type {
  Decoration,
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

export function lootKindForSeed(seed: number): LootKind {
  const kinds: LootKind[] = ["credit", "crystal", "core", "medkit"];
  return kinds[(seed >>> 3) % kinds.length] ?? "crystal";
}

export function sceneryDropKindForSeed(seed: number): LootKind | null {
  if (stableHash(`${seed}|drop`) % 100 >= 15) return null;

  const kindRoll = stableHash(`${seed}|drop-kind`) % 100;
  if (kindRoll < 30) return "medkit";

  const kinds: LootKind[] = ["credit", "crystal", "core"];
  return kinds[kindRoll % kinds.length] ?? "credit";
}

export function decorationSpecsForRoom(room: GraphNode): Decoration[] {
  const seed = stableHash(`${room.lootSeed}|decor`);
  const count = 3 + (seed % 3);
  const edgeX = Math.max(100, room.width / 2 - 70);
  const edgeY = Math.max(90, room.height / 2 - 70);
  const slots: Array<[number, number]> = [
    [-edgeX, -edgeY], [edgeX, -edgeY], [-edgeX, edgeY], [edgeX, edgeY], [-edgeX / 2, -edgeY],
    [edgeX / 2, -edgeY], [-edgeX / 2, edgeY], [edgeX / 2, edgeY], [-edgeX, -edgeY / 2], [edgeX, -edgeY / 2],
    [-edgeX, edgeY / 2], [edgeX, edgeY / 2],
  ];
  const obstacleTypes = [
    { kind: "plant", asset: ASSETS.decorPlant, obstacle: true, radius: 25, size: 56 },
    { kind: "barrel", asset: ASSETS.decorBarrel, obstacle: true, radius: 24, size: 52 },
    { kind: "crate", asset: ASSETS.decorCrate, obstacle: true, radius: 26, size: 54 },
    { kind: "terminal", asset: ASSETS.decorTerminal, obstacle: true, radius: 23, size: 50 },
  ];
  const debris = { kind: "debris", asset: ASSETS.decorDebris, obstacle: false, radius: 0, size: 42 };
  const slotSteps = [1, 5, 7, 11];
  const slotStep = slotSteps[(seed >>> 8) % slotSteps.length]!;

  return Array.from({ length: count }, (_, index) => {
    const itemSeed = stableHash(`${room.lootSeed}|decor|${index}`);
    const slot = slots[(seed + index * slotStep) % slots.length]!;
    const type = index >= 2 && itemSeed % 5 === 0
      ? debris
      : obstacleTypes[(itemSeed >>> 4) % obstacleTypes.length]!;
    const hp = type.obstacle ? 2 + ((itemSeed >>> 9) % 4) : 0;
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

export function decorationSpecsForCorridor(link: LayoutLink): Decoration[] {
  const seed = stableHash(`${link.source.lootSeed}|corridor|${link.target.id}|decor`);
  const count = 1 + (seed % 3);
  const assets = [ASSETS.decorDebris, ASSETS.decorTerminal, ASSETS.decorPlant];
  return Array.from({ length: count }, (_, index) => {
    const itemSeed = stableHash(`${seed}|${index}`);
    const position = pointAlongCorridor(
      link,
      (index + 1) / (count + 1),
      (index % 2 ? 1 : -1) * Math.min(18, link.width * 0.22),
    );
    return {
      id: `${link.id}::decor-${index}`,
      roomId: link.ownerRoomId,
      ...position,
      kind: index === 0 ? "debris" : "corridor-prop",
      asset: assets[itemSeed % assets.length]!,
      obstacle: false,
      radius: 0,
      size: 30 + (itemSeed % 14),
      maxHp: 0,
      hp: 0,
      destroyed: false,
      dropKind: null,
    };
  });
}

export function buildDecorations(
  layout: DungeonLayout,
  savedStates: ReadonlyMap<string, ObstacleState>,
): Decoration[] {
  return [
    ...layout.nodes.flatMap(decorationSpecsForRoom),
    ...layout.links.flatMap(decorationSpecsForCorridor),
  ].map((item) => {
    const state = savedStates.get(item.id);
    return { ...item, hp: state?.hp ?? item.hp, destroyed: state?.destroyed ?? false };
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

function monsterKindForSeed(seed: number): MonsterKind {
  if ((seed >>> 6) % 100 < 20) return "sentry";
  return ((seed >>> 7) % 100) < 38 ? "fast" : "slow";
}

export function monsterSpecsForRoom(room: GraphNode, floor = 1): Monster[] {
  if (room.isRoot || room.tag === "img") return [];
  const roomSeed = stableHash(`${room.lootSeed}|monsters`);

  const difficulty = floorDifficulty(floor);
  const count = monsterCountForRoom(room, floor);
  const offsets: Array<[number, number]> = [
    [-90, -55], [90, 55], [80, -65], [-80, 70], [0, -92],
  ];
  return Array.from({ length: count }, (_, index) => {
    const seed = stableHash(`${roomSeed}|${floor}|${index}`);
    const kind = monsterKindForSeed(seed);
    const fast = kind === "fast";
    const sentry = kind === "sentry";
    const offset = offsets[index % offsets.length]!;
    const hpBase = sentry ? 2 : 1;
    const hpBonus = Math.min(6, Math.floor(difficulty / 2));
    const speed = sentry ? 0 : (fast ? 150 : 80) + Math.min(95, difficulty * (fast ? 11 : 8));
    const attackDamage = (sentry ? 1 : 1 + ((seed >>> 19) % 2)) + Math.min(3, Math.floor(difficulty / 3));
    const attackCooldownMs = Math.max(420, (sentry ? 1500 : 1150) - difficulty * (sentry ? 70 : 35) + ((seed >>> 15) % 140));
    const projectileSpeed = sentry ? 220 + Math.min(260, difficulty * 18) : 0;
    const projectileRange = sentry ? 980 + Math.min(420, difficulty * 40) : 0;
    const attackRange = sentry ? 820 : 38 + Math.min(48, difficulty * 4);
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
}

export function monsterSpecsForCorridor(link: LayoutLink, floor = 1): Monster[] {
  if (link.source.isRoot) return [];
  const corridorSeed = stableHash(`${link.source.lootSeed}|corridor|${link.target.id}|monsters`);
  const count = corridorSeed % 3;
  const difficulty = floorDifficulty(floor);
  return Array.from({ length: count }, (_, index) => {
    const seed = stableHash(`${corridorSeed}|${floor}|${index}`);
    const kind = monsterKindForSeed(seed);
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
      speed: sentry ? 0 : (fast ? 150 : 80) + Math.min(95, difficulty * (fast ? 11 : 8)),
      fast,
      attackRange: sentry ? 820 : 38 + Math.min(48, difficulty * 4),
      attackDamage: 1 + Math.min(3, Math.floor(difficulty / 3)),
      attackCooldownMs: Math.max(420, (sentry ? 1500 : 1150) - difficulty * (sentry ? 70 : 35) + ((seed >>> 15) % 140)),
      projectileSpeed: sentry ? 220 + Math.min(260, difficulty * 18) : 0,
      projectileRange: sentry ? 980 + Math.min(420, difficulty * 40) : 0,
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

export function buildMonsters(
  layout: DungeonLayout,
  savedStates: ReadonlyMap<string, MonsterState>,
  visitedRooms: ReadonlySet<number>,
  floor = 1,
): Monster[] {
  const specs = [
    ...layout.nodes.flatMap(room => monsterSpecsForRoom(room, floor)),
    ...layout.links.flatMap(link => monsterSpecsForCorridor(link, floor)),
  ];
  return specs.map((spec) => {
    const saved = savedStates.get(spec.id);
    return {
      ...spec,
      hp: saved?.hp ?? spec.maxHp,
      dead: saved?.dead ?? false,
      active: saved?.active ?? visitedRooms.has(spec.spawnRoomId),
      droppedLoot: saved?.droppedLoot ?? false,
      dropId: saved?.dropId ?? null,
      dropX: saved?.dropX ?? null,
      dropY: saved?.dropY ?? null,
      dropKind: saved?.dropKind ?? null,
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
    [-160, -100], [160, -100], [-160, 100], [160, 100], [0, 135],
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
      x: room.x - ((itemsInRow - 1) * 64) / 2 + column * 64,
      y: room.y - ((rows - 1) * 62) / 2 + row * 62 + yOffset,
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
  }
  return { stairs, loot };
}
