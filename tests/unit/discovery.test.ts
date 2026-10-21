import { describe, expect, it } from "vitest";
import { discoveriesAtPoint } from "../../src/client/domain/discovery";
import { WORLD_GEOMETRY } from "../../src/client/domain/world-specs";
import type { DungeonLayout, GraphNode } from "../../src/client/types";

const s = WORLD_GEOMETRY.segmentSize;
const source = { id: 0, x: -2 * s, y: 0, width: 4 * s, height: 4 * s } as GraphNode;
const target = { ...source, id: 1, x: 6 * s };
const layout: DungeonLayout = {
  nodes: [source, target], hiddenCount: 0,
  links: [{ id: "hall", source, target, direction: "E", targetDirection: "W", ownerRoomId: 0,
    width: 2 * s, points: [{ x: 0, y: 0 }, { x: 4 * s, y: 0 }] }],
};
const y = WORLD_GEOMETRY.verticalDoorPassableOffsetY;

describe("doorway discovery", () => {
  it("starts corridors undiscovered and reveals only the corridor at its entrance threshold", () => {
    const rooms = new Set([0]);
    const corridors = new Set<string>();
    expect(discoveriesAtPoint(layout, [], { x: -s / 2 - 1, y }, rooms, corridors))
      .toEqual({ rooms: [], corridors: [] });
    expect(discoveriesAtPoint(layout, [], { x: -s / 2, y }, rooms, corridors))
      .toEqual({ rooms: [], corridors: ["hall"] });
    expect(corridors.size).toBe(0);
  });

  it("keeps the destination hidden until approaching its door from a discovered corridor", () => {
    const rooms = new Set([0]);
    const corridors = new Set(["hall"]);
    expect(discoveriesAtPoint(layout, [], { x: 2 * s, y }, rooms, corridors).rooms).toEqual([]);
    expect(discoveriesAtPoint(layout, [], { x: 4 * s - s / 2, y }, rooms, corridors))
      .toEqual({ rooms: [target], corridors: [] });
    expect(discoveriesAtPoint(layout, [], { x: 4 * s, y }, rooms, new Set()).rooms).toEqual([]);
  });

  it("discovers corridors from either room and does not rediscover them", () => {
    expect(discoveriesAtPoint(layout, [], { x: 4 * s + s / 2, y }, new Set([1]), new Set()))
      .toEqual({ rooms: [], corridors: ["hall"] });
    expect(discoveriesAtPoint(layout, [], { x: 0, y }, new Set([0]), new Set(["hall"])))
      .toEqual({ rooms: [], corridors: [] });
  });

  it("does not expose a corridor just because both rooms are known", () => {
    expect(discoveriesAtPoint(layout, [], { x: source.x, y: 0 }, new Set([0, 1]), new Set()))
      .toEqual({ rooms: [], corridors: [] });
  });

  it("reveals crossing corridors without revealing their endpoint rooms", () => {
    expect(discoveriesAtPoint(layout,
      [{ point: { x: 2 * s, y: 0 }, linkIds: ["hall", "crossing"] }],
      { x: 2 * s, y: 0 }, new Set([0]), new Set(["hall"])))
      .toEqual({ rooms: [], corridors: ["crossing"] });
  });
});
