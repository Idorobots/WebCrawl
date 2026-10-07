import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMinimapGeometry, DISCOVERED_MINIMAP_VISIBILITY, MINIMAP_COLORS, minimapMarkers, MinimapRenderer,
} from "../../src/client/render/minimap";
import type { Direction, DungeonLayout, GraphNode, LootItem, Monster, Stair } from "../../src/client/types";
import { WORLD_GEOMETRY } from "../../src/client/domain/world-specs";

function room(id: number, x: number, y = 0): GraphNode {
  return {
    id, x, y, parentId: null, tag: "div", depth: 0, hrefs: [], coalescedCount: 0,
    label: "Room", floorLabel: "Room", title: "Room", contentHtml: null,
    width: 200, height: 200, lootSeed: id, isRoot: id === 0, isHidden: false,
    parentSide: null, directionFromParent: null, shape: "rectangle", childCount: 0,
  };
}

function floor(): DungeonLayout {
  const rooms = [room(0, -300), room(1, 300), room(2, 900, 600)];
  rooms[1]!.isBossArena = true;
  return {
    nodes: rooms,
    links: [{
      id: "0-1", source: rooms[0]!, target: rooms[1]!, direction: "E", ownerRoomId: 0,
      width: 100, points: [{ x: -200, y: 0 }, { x: 200, y: 0 }],
    }],
    hiddenCount: 0,
  };
}

function directFloor(direction: Direction): DungeonLayout {
  const vector = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } }[direction];
  const source = room(0, 0);
  const target = room(1, vector.x * 200, vector.y * 200);
  const door = { x: vector.x * 100, y: vector.y * 100 };
  return {
    nodes: [source, target], hiddenCount: 0,
    links: [{ id: "direct", source, target, direction, ownerRoomId: 0, width: 100, direct: true, points: [door, door] }],
  };
}

function drawingContext() {
  return {
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "", lineJoin: "",
    setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), arc: vi.fn(), clip: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    strokeRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillRect: vi.fn(),
  };
}

const pickup = (id: string, roomId: number, x: number, y = 0): LootItem => ({ id, roomId, x, y, kind: "credit" });
const portal = (id: string, roomId: number, type: "up" | "down"): Stair => ({
  id, roomId, type, x: 0, y: 0, url: null, enabled: false,
});
// Visibility only reads position, room membership and death state.
const monster = (id: string, roomId: number, x: number, dead = false, y = 0): Monster =>
  ({ id, roomId, x, y, dead, active: false } as Monster);

afterEach(() => vi.unstubAllGlobals());

describe("minimap geometry and visibility", () => {
  it("centers the entire discovered floor and fits room corners and corridor edges inside the circle", () => {
    const layout = floor();
    const geometry = buildMinimapGeometry(layout, new Set([0, 1, 2]), 300, 300);
    for (const node of layout.nodes) {
      for (const dx of [-node.width / 2, node.width / 2]) {
        for (const dy of [-node.height / 2, node.height / 2]) {
          const point = geometry.project({ x: node.x + dx, y: node.y + dy });
          expect(Math.hypot(point.x - 150, point.y - 150)).toBeLessThan(geometry.radius - 10);
        }
      }
    }
    expect(geometry.project({ x: 300, y: 300 })).toEqual({ x: 150, y: 150 });
    for (const point of layout.links[0]!.points) {
      const projected = geometry.project({ x: point.x, y: point.y + 50 });
      expect(Math.hypot(projected.x - 150, projected.y - 150)).toBeLessThan(geometry.radius);
    }
  });

  it("uses the same precise transform inside rooms and corridors without snapping to a room", () => {
    const geometry = buildMinimapGeometry(floor(), new Set([0, 1]), 300, 300);
    const points = [-300, -250, -100, 0, 100, 250, 300].map(x => geometry.project({ x, y: 0 }));
    for (let index = 1; index < points.length; index++) {
      expect(points[index]!.x).toBeGreaterThan(points[index - 1]!.x);
      expect(points[index]!.y).toBe(points[0]!.y);
    }
    expect(geometry.project({ x: 0, y: 0 })).toEqual(geometry.center);
    expect(geometry.project({ x: 40, y: 30 }).y - geometry.center.y).toBeCloseTo(30 * geometry.scale);
  });

  it("does not include unrevealed rooms in map bounds, while retaining discovered corridor connectors", () => {
    const layout = floor();
    const geometry = buildMinimapGeometry(layout, new Set([0]), 132, 132);
    expect(geometry.rooms.map(node => node.id)).toEqual([0]);
    expect(geometry.links).toHaveLength(1);
    const before = geometry.project({ x: -300, y: 0 });
    layout.nodes[2]!.x = 100_000;
    expect(buildMinimapGeometry(layout, new Set([0]), 132, 132).project({ x: -300, y: 0 })).toEqual(before);
    const empty = buildMinimapGeometry(layout, new Set(), 132, 132);
    expect(empty.rooms).toEqual([]);
    expect(Number.isFinite(empty.project({ x: 0, y: 0 }).x)).toBe(true);
  });

  it.each<Direction>(["N", "S", "E", "W"])("marks the actual shared doorway for a %s direct connection without revealing its destination", direction => {
    const layout = directFloor(direction);
    const vertical = direction === "E" || direction === "W";
    const door = layout.links[0]!.points[0]!;
    for (const roomId of [0, 1]) {
      const geometry = buildMinimapGeometry(layout, new Set([roomId]), 300, 300);
      expect(geometry.rooms.map(node => node.id)).toEqual([roomId]);
      expect(geometry.doors).toEqual([{
        position: { x: door.x, y: door.y + (vertical ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0) }, vertical,
      }]);
    }
    expect(buildMinimapGeometry(layout, new Set([0, 1]), 300, 300).doors).toHaveLength(1);
    expect(buildMinimapGeometry(layout, new Set(), 300, 300).doors).toEqual([]);
    expect(buildMinimapGeometry(floor(), new Set([0, 1]), 300, 300).doors).toEqual([]);
  });

  it("groups portals once per room and direction, including disabled portals, without exposing hidden rooms", () => {
    const geometry = buildMinimapGeometry(floor(), new Set([0, 1]), 300, 300);
    const stairs = [portal("a", 0, "down"), portal("b", 0, "down"), portal("c", 0, "up"), portal("d", 2, "down")];
    const markers = minimapMarkers(geometry, new Set([0, 1]), stairs, [], []);
    expect(markers.portals).toEqual([{ room: geometry.rooms[0], up: true, down: true }]);
  });

  it("tracks remaining pickups and living monsters at their actual revealed positions, including corridors", () => {
    const revealed = new Set([0]);
    const geometry = buildMinimapGeometry(floor(), revealed, 300, 300);
    const loot = [pickup("room", 0, -300), pickup("drop", 0, 0), pickup("hidden", 1, 300)];
    const monsters = [
      monster("alive", 0, -300), monster("dead", 0, -300, true), monster("corridor", 0, 0),
      monster("stale-room", 0, 300), monster("hidden", 2, 900, false, 600),
    ];
    expect(minimapMarkers(geometry, revealed, [], loot, monsters).pickups.map(item => item.id)).toEqual(["room", "drop"]);
    expect(minimapMarkers(geometry, revealed, [], loot, monsters).monsters.map(item => item.id)).toEqual(["alive", "corridor"]);
    monsters[0]!.dead = true;
    expect(minimapMarkers(geometry, revealed, [], loot.slice(1), monsters).pickups.map(item => item.id)).toEqual(["drop"]);
    expect(minimapMarkers(geometry, revealed, [], [], monsters).monsters.map(item => item.id)).toEqual(["corridor"]);
  });

  it("allows map visibility modifiers without altering discovery or showing dead monsters", () => {
    const layout = floor();
    const revealed = new Set([0]);
    const visibility = {
      ...DISCOVERED_MINIMAP_VISIBILITY,
      room: () => true,
      pickup: () => true,
      monster: () => true,
    };
    const geometry = buildMinimapGeometry(layout, revealed, 300, 300, visibility);
    const markers = minimapMarkers(geometry, revealed, [], [pickup("hidden", 2, 900, 600)],
      [monster("alive", 2, 900, false, 600), monster("dead", 2, 900, true, 600)], visibility);
    expect(geometry.rooms).toHaveLength(3);
    expect(markers.pickups).toHaveLength(1);
    expect(markers.monsters.map(item => item.id)).toEqual(["alive"]);
    expect([...revealed]).toEqual([0]);
  });
});

it("paints boss rooms red, portals as triangles and live dots, while caching geometry and resizing on demand", () => {
  const foreground = drawingContext();
  const background = drawingContext();
  const filledRooms: string[] = [];
  const fills: string[] = [];
  const corridorWidths: number[] = [];
  background.fillRect.mockImplementation(() => { filledRooms.push(background.fillStyle); });
  background.stroke.mockImplementation(() => { corridorWidths.push(background.lineWidth); });
  foreground.fill.mockImplementation(() => { fills.push(foreground.fillStyle); });
  const canvas = { width: 0, height: 0, clientWidth: 300, clientHeight: 300, getContext: () => foreground };
  const cachedCanvas = { width: 0, height: 0, getContext: () => background };
  vi.stubGlobal("document", { createElement: () => cachedCanvas });
  vi.stubGlobal("window", { devicePixelRatio: 2 });
  const renderer = new MinimapRenderer(canvas as unknown as HTMLCanvasElement);
  const layout = floor();
  const revealed = new Set([0, 1]);
  const stairs = [portal("a", 1, "down"), portal("b", 1, "down"), portal("c", 1, "up")];
  const loot = [pickup("loot", 0, -300)];
  const monsters = [monster("monster", 1, 300)];
  renderer.render(layout, revealed, stairs, loot, monsters, { x: 300, y: 30 });
  expect(filledRooms).toContain(MINIMAP_COLORS.boss);
  expect(corridorWidths[0]).toBeGreaterThan(4);
  expect(fills).toEqual([MINIMAP_COLORS.pickup, MINIMAP_COLORS.monster, MINIMAP_COLORS.upPortal, MINIMAP_COLORS.downPortal, MINIMAP_COLORS.player]);
  expect(foreground.closePath).toHaveBeenCalledTimes(2);
  expect(foreground.clip).toHaveBeenCalled();
  expect(foreground.arc.mock.calls.at(-1)?.slice(0, 2)).toEqual(Object.values(buildMinimapGeometry(layout, revealed, 300, 300).project({ x: 300, y: 30 })));
  expect(canvas.width).toBe(600);
  renderer.render(layout, revealed, stairs, [], [], { x: 0, y: 0 });
  expect(background.clearRect).toHaveBeenCalledTimes(1);
  expect(foreground.arc.mock.calls.at(-1)?.slice(0, 2)).toEqual([150, 150]);
  canvas.clientWidth = canvas.clientHeight = 132;
  renderer.render(layout, revealed, stairs, [], [], { x: 0, y: 0 });
  expect(canvas.width).toBe(264);
  expect(background.clearRect).toHaveBeenCalledTimes(2);
  revealed.add(2);
  renderer.render(layout, revealed, stairs, [], [], { x: 0, y: 0 });
  expect(background.clearRect).toHaveBeenCalledTimes(3);
});

it.each<Direction>(["E", "S"])("draws %s direct-room doors over the current-room border, readable at mobile scale", direction => {
  const foreground = drawingContext();
  const background = drawingContext();
  const strokes: Array<{ color: string; width: number }> = [];
  foreground.stroke.mockImplementation(() => { strokes.push({ color: foreground.strokeStyle, width: foreground.lineWidth }); });
  const canvas = { width: 0, height: 0, clientWidth: 132, clientHeight: 132, getContext: () => foreground };
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => background }) });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  const layout = directFloor(direction);
  const revealed = new Set([0, 1]);
  const geometry = buildMinimapGeometry(layout, revealed, 132, 132);
  const renderer = new MinimapRenderer(canvas as unknown as HTMLCanvasElement);
  renderer.render(layout, revealed, [], [], [], { x: 0, y: 0 });
  expect(strokes[0]).toEqual({ color: MINIMAP_COLORS.door, width: 2 });
  const start = foreground.moveTo.mock.calls[0]!;
  const end = foreground.lineTo.mock.calls[0]!;
  const position = geometry.project(geometry.doors[0]!.position);
  expect((start[0] + end[0]) / 2).toBeCloseTo(position.x);
  expect((start[1] + end[1]) / 2).toBeCloseTo(position.y);
  expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeGreaterThanOrEqual(3);
  expect(direction === "E" ? start[0] === end[0] : start[1] === end[1]).toBe(true);
  expect(foreground.strokeRect.mock.invocationCallOrder[0]).toBeLessThan(foreground.stroke.mock.invocationCallOrder[0]!);
});
