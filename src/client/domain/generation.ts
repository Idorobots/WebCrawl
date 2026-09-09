import { ASSETS } from "../config";
import type {
  Decoration,
  DungeonLayout,
  GraphNode,
  LootItem,
  LootKind,
  Monster,
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

export function decorationSpecsForRoom(room: GraphNode): Decoration[] {
  const seed = stableHash(`${room.lootSeed}|decor`);
  const count = 1 + (seed % 3);
  const slots: Array<[number, number]> = [
    [-210, -120], [210, -120], [-210, 120], [210, 120], [0, -145], [0, 145],
  ];
  const types = [
    { kind: "debris", asset: ASSETS.decorDebris, obstacle: false, radius: 0, size: 42 },
    { kind: "plant", asset: ASSETS.decorPlant, obstacle: true, radius: 25, size: 56 },
    { kind: "barrel", asset: ASSETS.decorBarrel, obstacle: true, radius: 24, size: 52 },
    { kind: "crate", asset: ASSETS.decorCrate, obstacle: true, radius: 26, size: 54 },
    { kind: "terminal", asset: ASSETS.decorTerminal, obstacle: true, radius: 23, size: 50 },
  ];

  return Array.from({ length: count }, (_, index) => {
    const slot = slots[((seed >>> (index * 5)) + index * 2) % slots.length]!;
    const type = types[((seed >>> (index * 7 + 4)) + index) % types.length]!;
    const hp = type.obstacle ? 2 + ((seed >>> (index * 3 + 9)) % 4) : 0;
    return {
      id: `${room.id}::decor-${index}`,
      roomId: room.id,
      x: room.x + slot[0],
      y: room.y + slot[1],
      maxHp: hp,
      hp,
      destroyed: false,
      ...type,
    };
  });
}

export function buildDecorations(
  layout: DungeonLayout,
  savedStates: ReadonlyMap<string, ObstacleState>,
): Decoration[] {
  return layout.nodes.flatMap(decorationSpecsForRoom).map((item) => {
    const state = savedStates.get(item.id);
    return { ...item, hp: state?.hp ?? item.hp, destroyed: state?.destroyed ?? false };
  });
}

export function monsterSpecsForRoom(room: GraphNode): Monster[] {
  if (room.isRoot || room.tag === "img") return [];
  const roomSeed = stableHash(`${room.lootSeed}|monsters`);
  if ((roomSeed % 100) >= 72) return [];

  const count = 1 + (((roomSeed >>> 8) % 100) < 16 ? 1 : 0);
  const offsets: Array<[number, number]> = [[-68, -46], [68, 42]];
  return Array.from({ length: count }, (_, index) => {
    const seed = stableHash(`${roomSeed}|${index}`);
    const fast = ((seed >>> 7) % 100) < 32;
    const offset = offsets[index % offsets.length]!;
    return {
      id: `${room.id}::monster-${index}`,
      seed,
      spawnRoomId: room.id,
      roomId: room.id,
      x: room.x + offset[0],
      y: room.y + offset[1],
      maxHp: 1 + ((seed >>> 11) % 5),
      speed: fast ? 105 : 58,
      fast,
      attackDamage: 1 + ((seed >>> 19) % 2),
      attackCooldownMs: 1150 + ((seed >>> 15) % 750),
      dropsLoot: ((seed >>> 23) % 100) < 18,
      lastAttackAt: -Infinity,
      active: false,
      dead: false,
      hp: 1,
    };
  });
}

export function buildMonsters(
  layout: DungeonLayout,
  savedStates: ReadonlyMap<string, MonsterState>,
  visitedRooms: ReadonlySet<number>,
): Monster[] {
  return layout.nodes.flatMap((room) => monsterSpecsForRoom(room).map((spec) => {
    const saved = savedStates.get(spec.id);
    return {
      ...spec,
      hp: saved?.hp ?? spec.maxHp,
      dead: saved?.dead ?? false,
      active: saved?.active ?? visitedRooms.has(room.id),
      droppedLoot: saved?.droppedLoot ?? false,
      dropId: saved?.dropId ?? null,
      dropX: saved?.dropX ?? null,
      dropY: saved?.dropY ?? null,
      dropKind: saved?.dropKind ?? null,
    };
  }));
}

export function lootCountForRoom(room: GraphNode): number {
  const seed = room.lootSeed >>> 0;
  return room.tag === "img" ? 2 + (seed % 3) : (seed % 10) === 0 ? 1 : 0;
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
