import { ENVIRONMENT_SEGMENT_SIZE } from "../config";
import type {
  BossKind, Decoration, DungeonGraph, DungeonLayout, GraphNode, LayoutLink,
  LootItem, LootKind, MonsterKind, Point, WeaponKind,
} from "../types";
import { stableHash } from "./hash";
import { doorPositionForSlot } from "./layout";
import {
  BOSS_DEFINITIONS, DECORATION_DEFINITIONS, LOOT_DEFINITIONS,
  REGULAR_MONSTER_DEFINITIONS,
} from "./world-specs";
import { weaponForKind, weaponKinds } from "./weapons";

/** Positions are relative to the center of the room, so a template can be reused anywhere. */
export interface AuthoredRoomTemplate {
  width: number;
  height: number;
  decorations?: readonly (Point & { definition: keyof typeof DECORATION_DEFINITIONS })[];
  loot?: readonly (Point & { kind: LootKind; weaponKind?: WeaponKind })[];
  monsters?: readonly (Point & { kind: MonsterKind; miniboss?: boolean })[];
}

export type AuthoredRooms = ReadonlyMap<number, AuthoredRoomTemplate>;

export function authoredDecorations(room: GraphNode, template: AuthoredRoomTemplate): Decoration[] {
  return (template.decorations ?? []).map(({ definition, x, y }, index) => {
    const type = DECORATION_DEFINITIONS[definition];
    return {
      ...type,
      id: `${room.id}::authored-decor-${index}`,
      roomId: room.id,
      x: room.x + x,
      y: room.y + y,
      visualVariant: stableHash(`${room.lootSeed}|authored-decor|${index}`),
      maxHp: type.hp,
      destroyed: false,
      dropKind: null,
      ...(definition === "spawner" ? { spawner: true, spawnIntervalMs: 30_000, spawnedCount: 0 } : {}),
    };
  });
}

export function authoredLoot(room: GraphNode, template: AuthoredRoomTemplate, namespace: string): LootItem[] {
  return (template.loot ?? []).map(({ kind, weaponKind, x, y }, index) => ({
    id: `${namespace}::${room.id}::authored-loot-${index}`,
    roomId: room.id,
    x: room.x + x,
    y: room.y + y,
    kind,
    ...(weaponKind ? { weapon: weaponForKind(weaponKind), weaponPlacement: "floor" as const } : {}),
  }));
}

const GALLERY_COLUMNS = 14;
const GALLERY_WIDTH = ENVIRONMENT_SEGMENT_SIZE * 24;
const GALLERY_HEIGHT = ENVIRONMENT_SEGMENT_SIZE * 24;
const decorationKeys = Object.keys(DECORATION_DEFINITIONS) as Array<keyof typeof DECORATION_DEFINITIONS>;
const pickupKinds = Object.keys(LOOT_DEFINITIONS) as Array<keyof typeof LOOT_DEFINITIONS>;

const gallery: AuthoredRoomTemplate = {
  width: GALLERY_WIDTH,
  height: GALLERY_HEIGHT,
  decorations: decorationKeys.map((definition, index) => ({
    definition,
    x: (index % GALLERY_COLUMNS - (GALLERY_COLUMNS - 1) / 2) * 205,
    y: -1370 + Math.floor(index / GALLERY_COLUMNS) * 205,
  })),
  loot: [...pickupKinds.map(kind => ({ kind })), ...weaponKinds().map(weaponKind => ({
    kind: "weapon" as const, weaponKind,
  }))].map((pickup, index) => ({
    ...pickup,
    x: (index % 9 - 4) * 205,
    y: 420 + Math.floor(index / 9) * 205,
  })),
};

const enemyKinds = Object.keys(REGULAR_MONSTER_DEFINITIONS) as Array<keyof typeof REGULAR_MONSTER_DEFINITIONS>;
const bossKinds = Object.keys(BOSS_DEFINITIONS) as BossKind[];

/** A fully specified level; no DOM graph traversal or layout placement is involved. */
export function artDebugLevel(): { graph: DungeonGraph; layout: DungeonLayout; rooms: AuthoredRooms } {
  const templates: AuthoredRoomTemplate[] = [
    gallery,
    ...enemyKinds.map(kind => ({
      width: ENVIRONMENT_SEGMENT_SIZE * 4,
      height: ENVIRONMENT_SEGMENT_SIZE * 4,
      monsters: [{ kind, x: 0, y: -75 }],
    })),
    ...enemyKinds.map(kind => ({
      width: ENVIRONMENT_SEGMENT_SIZE * 4,
      height: ENVIRONMENT_SEGMENT_SIZE * 4,
      monsters: [{ kind, miniboss: true, x: 0, y: -75 }],
    })),
    ...bossKinds.map(kind => ({
      width: ENVIRONMENT_SEGMENT_SIZE * 8,
      height: ENVIRONMENT_SEGMENT_SIZE * 8,
      monsters: [{ kind, x: 0, y: -140 }],
    })),
  ];
  const nodes: GraphNode[] = templates.map((template, id) => {
    const monster = template.monsters?.[0];
    const isBossArena = !!monster && monster.kind in BOSS_DEFINITIONS;
    const label = monster ? `${monster.miniboss ? "Miniboss " : ""}${monster.kind}` : "Art gallery";
    return {
      id,
      parentId: id === 0 ? null : id - 1,
      x: 0,
      y: 0,
      tag: id === 0 ? "gallery" : isBossArena ? "boss" : monster?.miniboss ? "miniboss" : "enemy",
      depth: id,
      hrefs: [],
      coalescedCount: 0,
      label,
      floorLabel: label.toUpperCase(),
      title: label,
      contentHtml: null,
      width: template.width,
      height: template.height,
      lootSeed: id,
      isRoot: id === 0,
      isBossArena,
      isHidden: false,
      parentSide: id === 0 ? null : "W",
      directionFromParent: id === 0 ? null : "E",
      shape: "rectangle",
      childCount: id === templates.length - 1 ? 0 : 1,
    };
  });
  const links: LayoutLink[] = [];
  for (let id = 1; id < nodes.length; id += 1) {
    const source = nodes[id - 1]!;
    const target = nodes[id]!;
    target.x = source.x + (source.width + target.width) / 2;
    const door = doorPositionForSlot(source, "E", 0);
    links.push({
      id: `${source.id}->${target.id}`,
      source,
      target,
      direction: "E",
      targetDirection: "W",
      ownerRoomId: source.id,
      width: ENVIRONMENT_SEGMENT_SIZE * 2,
      points: [door, doorPositionForSlot(target, "W", 0)],
      direct: true,
    });
  }
  return {
    graph: { nodes, links: nodes.slice(1).map(node => ({ source: node.id - 1, target: node.id })),
      originalCount: nodes.length, coalescedCount: 0, truncated: false },
    layout: { nodes, links, hiddenCount: 0 },
    rooms: new Map(templates.map((template, id) => [id, template])),
  };
}
