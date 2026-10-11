import { describe, expect, it } from "vitest";
import { directArenaDoorLinks } from "../../src/client/render/arena-door-lights";
import type { DungeonLayout, GraphNode, LayoutLink } from "../../src/client/types";

function room(id: number, x: number): GraphNode {
  return {
    id, x, y: 0, parentId: null, tag: "div", depth: 0, hrefs: [], coalescedCount: 0,
    label: "Room", floorLabel: "Room", title: "Room", contentHtml: null,
    width: 200, height: 200, lootSeed: id, isRoot: id === 0, isHidden: false,
    parentSide: null, directionFromParent: null, shape: "rectangle", childCount: 0,
  };
}

function link(id: string, source: GraphNode, target: GraphNode, direct: boolean): LayoutLink {
  return {
    id, source, target, direction: "E", ownerRoomId: source.id, width: 128,
    points: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
    ...(direct ? { direct: true } : {}),
  };
}

describe("direct arena door links", () => {
  it("finds a direct link into a boss arena and names the approach room", () => {
    const entrance = room(0, -300);
    const arena = room(1, 300);
    arena.isBossArena = true;
    const layout: DungeonLayout = { nodes: [entrance, arena], links: [link("0-1", entrance, arena, true)], hiddenCount: 0 };

    const doors = directArenaDoorLinks(layout);
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ arena, approach: entrance, door: { x: 0, y: 0 } });
  });

  it("ignores corridor connections and direct links with no arena", () => {
    const entrance = room(0, -300);
    const arena = room(1, 300);
    arena.isBossArena = true;
    const neighbor = room(2, 900);
    const layout: DungeonLayout = {
      nodes: [entrance, arena, neighbor],
      links: [
        link("0-1", entrance, arena, false),
        link("0-2", entrance, neighbor, true),
      ],
      hiddenCount: 0,
    };
    expect(directArenaDoorLinks(layout)).toEqual([]);
  });
});
