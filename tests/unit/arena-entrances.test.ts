import { describe, expect, it } from "vitest";
import { BOSS_FIGHT_ACTIVATION_DELAY_MS, BOSS_FIGHT_DOOR_ENTRY_DISTANCE } from "../../src/client/config";
import {
  ARENA_ENTRANCE_KEEP_OUT_DISTANCE,
  arenaEntrances,
  entrancePositionsForRoom,
  isNearArenaEntrance,
  playerBeyondArenaDoors,
} from "../../src/client/domain/arena-entrances";
import type { DungeonLayout, GraphNode, LayoutLink } from "../../src/client/types";

function room(id: number, x: number): GraphNode {
  return {
    id, x, y: 0, parentId: null, tag: "div", depth: 0, hrefs: [], coalescedCount: 0,
    label: "Room", floorLabel: "Room", title: "Room", contentHtml: null,
    width: 200, height: 200, lootSeed: id, isRoot: id === 0, isHidden: false,
    parentSide: null, directionFromParent: null, shape: "rectangle", childCount: 0,
  };
}

function link(
  id: string,
  source: GraphNode,
  target: GraphNode,
  points: { x: number; y: number }[],
  direct = false,
): LayoutLink {
  return {
    id, source, target, direction: "E", ownerRoomId: source.id, width: 128,
    points, ...(direct ? { direct: true } : {}),
  };
}

describe("arena entrances", () => {
  it("reports the arena-side endpoint of a corridor link", () => {
    const approach = room(0, -300);
    const arena = room(1, 300);
    arena.isBossArena = true;
    const layout: DungeonLayout = {
      nodes: [approach, arena],
      links: [link("0-1", approach, arena, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }])],
      hiddenCount: 0,
    };

    const entrances = arenaEntrances(layout);
    expect(entrances).toEqual([{ arena, position: { x: 200, y: 0 } }]);
    expect(entrancePositionsForRoom(entrances, arena.id)).toEqual([{ x: 200, y: 0 }]);
    expect(entrancePositionsForRoom(entrances, approach.id)).toEqual([]);
  });

  it("reports the shared doorway of a direct link into the arena from either side", () => {
    const approach = room(0, -300);
    const arena = room(1, 300);
    arena.isBossArena = true;
    const door = { x: 64, y: 0 };
    const approachLayout: DungeonLayout = {
      nodes: [approach, arena],
      links: [link("0-1", approach, arena, [door], true)],
      hiddenCount: 0,
    };
    const arenaFirstLayout: DungeonLayout = {
      nodes: [arena, approach],
      links: [link("1-0", arena, approach, [door], true)],
      hiddenCount: 0,
    };

    expect(arenaEntrances(approachLayout)).toEqual([{ arena, position: door }]);
    expect(arenaEntrances(arenaFirstLayout)).toEqual([{ arena, position: door }]);
  });

  it("reports both sides of links between arenas but ignores ordinary links", () => {
    const first = room(0, -300);
    const second = room(1, 300);
    const arenaA = room(2, 900);
    const arenaB = room(3, 1500);
    arenaA.isBossArena = true;
    arenaB.isBossArena = true;
    const layout: DungeonLayout = {
      nodes: [first, second, arenaA, arenaB],
      links: [
        link("0-1", first, second, [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
        link("2-3", arenaA, arenaB, [{ x: 20, y: 0 }, { x: 30, y: 0 }]),
      ],
      hiddenCount: 0,
    };
    const entrances = arenaEntrances(layout);
    expect(entrances).toEqual([
      { arena: arenaA, position: { x: 20, y: 0 } },
      { arena: arenaB, position: { x: 30, y: 0 } },
    ]);
    expect(entrancePositionsForRoom(entrances, arenaB.id)).toEqual([{ x: 30, y: 0 }]);
    const sharedDoor = { x: 40, y: 0 };
    expect(arenaEntrances({ links: [link("shared", arenaA, arenaB, [sharedDoor], true)] })).toEqual([
      { arena: arenaA, position: sharedDoor },
      { arena: arenaB, position: sharedDoor },
    ]);
  });

  it("flags points within the keep-out distance of an entrance only", () => {
    const door = { x: 0, y: 0 };
    expect(isNearArenaEntrance([door], 0, 0)).toBe(true);
    expect(isNearArenaEntrance([door], ARENA_ENTRANCE_KEEP_OUT_DISTANCE - 1, 0)).toBe(true);
    expect(isNearArenaEntrance([door], ARENA_ENTRANCE_KEEP_OUT_DISTANCE + 1, 0)).toBe(false);
    expect(isNearArenaEntrance([], 0, 0)).toBe(false);
    expect(isNearArenaEntrance([door], 0, 0, 10)).toBe(true);
    expect(isNearArenaEntrance([door], 20, 0, 10)).toBe(false);
  });

  it("starts only beyond the configured radius of every arena door", () => {
    const doors = [{ x: 0, y: 0 }, { x: 300, y: 0 }];
    const distance = BOSS_FIGHT_DOOR_ENTRY_DISTANCE;
    expect(distance).toBe(100);
    expect(BOSS_FIGHT_ACTIVATION_DELAY_MS).toBe(200);
    expect(playerBeyondArenaDoors([], { x: 200, y: 0 }, distance)).toBe(false);
    expect(playerBeyondArenaDoors([doors[0]!], { x: distance, y: 0 }, distance)).toBe(false);
    expect(playerBeyondArenaDoors([doors[0]!], { x: distance + 1, y: 0 }, distance)).toBe(true);
    expect(playerBeyondArenaDoors(doors, { x: 220, y: 0 }, distance)).toBe(false);
    expect(playerBeyondArenaDoors(doors, { x: 150, y: 101 }, distance)).toBe(true);
  });
});
