/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhaserRenderer } from "../../src/client/render/phaser-renderer";
import {
  buildWallFootprints, closedDoorFootprint, wallBlocksSegment, wallHitboxes, wallHitBySegment,
  WALL_HITBOX_SHIFT_Y, WallRectIndex, type WallRect,
} from "../../src/client/domain/wall-collision";
import { DEFAULT_BULLET_SPEC, PLAYER_SPEC, WORLD_GEOMETRY } from "../../src/client/domain/world-specs";
import type { DoorModulePlan } from "../../src/client/render/corridor-render-plan";
import type { DungeonLayout, GraphNode } from "../../src/client/types";

vi.mock("phaser", () => ({ default: {
  Renderer: { WebGL: { Pipelines: { LightPipeline: class {} } } },
} }));
vi.mock("../../src/client/render/light-capacity", () => ({ supportedMaxLights: () => 4 }));

const s = WORLD_GEOMETRY.segmentSize;

afterEach(() => vi.useRealTimers());

describe("solid door leaves", () => {
  it.each(["N", "E", "S", "W"] as const)("blocks movement and swept bullets through a %s door", side => {
    const footprint = closedDoorFootprint({ side, position: { x: 0, y: 0 } });
    const vertical = side === "E" || side === "W";
    const y = vertical ? WORLD_GEOMETRY.verticalDoorPassableOffsetY : 0;
    const from = vertical ? { x: -s, y } : { x: 0, y: -s };
    const to = vertical ? { x: s, y } : { x: 0, y: s };
    expect(wallBlocksSegment(from, to, PLAYER_SPEC.footprintRadii, new WallRectIndex([footprint]))).toBe(true);
    const bulletRadii = { x: DEFAULT_BULLET_SPEC.radius, y: DEFAULT_BULLET_SPEC.radius };
    expect(wallBlocksSegment(from, to, bulletRadii, new WallRectIndex(wallHitboxes([footprint])))).toBe(true);
    expect(wallBlocksSegment(to, from, bulletRadii, new WallRectIndex(wallHitboxes([footprint])))).toBe(true);
  });

  it.each(["E", "S"] as const)("keeps the %s security-door frame solid and damages only the closed wing", side => {
    const door = { side, position: { x: 512, y: -384 } };
    const model = { id: "security-door", linkId: "hall", hp: 18, maxHp: 18, destroyed: false };
    const layout: DungeonLayout = { nodes: [], links: [], hiddenCount: 0 };
    const jambs = buildWallFootprints(layout, [door]);
    const entry = { door, halves: [], open: false, passable: false,
      security: { model, threatened: false } };
    const collision = vi.fn<(rects: WallRect[]) => void>();
    const visitedCorridors = new Set([model.linkId]);
    const renderer = Object.assign(Object.create(PhaserRenderer.prototype), {
      layout, scene: {}, doors: [entry], securityDoors: new Map([[model.id, entry]]),
      visitedCorridors, onDoorCollisionChanged: collision,
    }) as Pick<PhaserRenderer, "updateSecurityDoor"> & { updateDoors(animate: boolean): void };

    const across = (offset: number, shift = 0): [typeof door.position, typeof door.position] => {
      const { x, y } = door.position;
      return side === "E" ? [{ x: x - s, y: y + offset + shift }, { x: x + s, y: y + offset + shift }] :
        [{ x: x + offset, y: y - s + shift }, { x: x + offset, y: y + s + shift }];
    };
    const movesThrough = (offset: number) => !wallBlocksSegment(...across(offset), PLAYER_SPEC.footprintRadii,
      new WallRectIndex([...jambs, ...collision.mock.lastCall![0]]));
    const hits = (offset: number) => wallHitBySegment(...across(offset, WALL_HITBOX_SHIFT_Y),
      { x: DEFAULT_BULLET_SPEC.radius, y: DEFAULT_BULLET_SPEC.radius },
      new WallRectIndex(wallHitboxes([...collision.mock.lastCall![0], ...jambs])));
    const expectSolidJambs = () => {
      for (const offset of [-s * 0.75, s * 0.75]) {
        expect(movesThrough(offset)).toBe(false);
        expect(hits(offset)).toBeDefined();
        expect(hits(offset)?.securityDoorId).toBeUndefined();
      }
    };

    renderer.updateDoors(false);
    expectSolidJambs();
    expect(movesThrough(0)).toBe(true);
    expect(hits(0)).toBeUndefined();

    visitedCorridors.clear();
    renderer.updateDoors(false);
    expectSolidJambs();
    expect(movesThrough(0)).toBe(false);
    expect(hits(0)?.securityDoorId).toBe(model.id);
    const seam = side === "E" ? jambs[1]!.y - door.position.y : jambs[1]!.x - door.position.x;
    expect(hits(seam)).toBeDefined();
    expect(hits(seam)?.securityDoorId).toBeUndefined();

    model.hp = 0;
    model.destroyed = true;
    renderer.updateSecurityDoor(model.id, false, false);
    expectSolidJambs();
    expect(movesThrough(0)).toBe(true);
    expect(hits(0)).toBeUndefined();
  });

  it("animates and plays sound when a security door seals, reopens, or is destroyed", () => {
    vi.useFakeTimers();
    const door = { side: "E", position: { x: 0, y: 0 } };
    const model = { id: "security-door", linkId: "hall", hp: 18, maxHp: 18, destroyed: false };
    const half = { setTexture: vi.fn(), setAlpha: vi.fn() };
    const entry = { door, halves: [half], open: false, passable: false, locked: false,
      security: { model, threatened: false } };
    const playOneShot = vi.fn();
    const renderer = Object.assign(Object.create(PhaserRenderer.prototype), {
      layout: { nodes: [], links: [], hiddenCount: 0 },
      scene: { time: { delayedCall: (delay: number, callback: () => void) => {
        const timer = setTimeout(callback, delay);
        return { remove: () => clearTimeout(timer) };
      } } },
      doors: [entry], securityDoors: new Map([[model.id, entry]]),
      visitedCorridors: new Set([model.linkId]), playOneShot,
    }) as Pick<PhaserRenderer, "updateSecurityDoor" | "updateSecurityDoorDamage"> & { updateDoors(animate: boolean): void };

    renderer.updateDoors(false);
    expect(playOneShot).not.toHaveBeenCalled();
    renderer.updateSecurityDoor(model.id, true, false);
    expect(playOneShot).toHaveBeenLastCalledWith("sfx-door-close");
    expect(entry.passable).toBe(false);
    vi.advanceTimersByTime(100);
    expect(half.setTexture.mock.lastCall?.[0]).toMatch(/_interim_1\.png$/);
    vi.advanceTimersByTime(200);
    expect(half.setTexture.mock.lastCall?.[0]).toMatch(/_closed\.png$/);

    renderer.updateSecurityDoor(model.id, false, false);
    expect(playOneShot).toHaveBeenLastCalledWith("sfx-door-open");
    vi.advanceTimersByTime(300);
    expect(entry.passable).toBe(true);

    renderer.updateSecurityDoor(model.id, true, false);
    vi.advanceTimersByTime(300);
    model.hp = 0;
    model.destroyed = true;
    renderer.updateSecurityDoorDamage(model.id);
    expect(playOneShot).toHaveBeenLastCalledWith("sfx-door-open");
    vi.advanceTimersByTime(100);
    expect(half.setTexture.mock.lastCall?.[0]).toMatch(/_interim_2\.png$/);
    renderer.updateDoors(true); // Fog refresh while opening must not skip the animation.
    renderer.updateSecurityDoor(model.id, true, false);
    vi.advanceTimersByTime(100);
    expect(half.setTexture.mock.lastCall?.[0]).toMatch(/_interim_1\.png$/);
    expect(entry.passable).toBe(false);
    vi.advanceTimersByTime(100);
    expect(half.setTexture.mock.lastCall?.[0]).toMatch(/_open\.png$/);
    expect(entry.passable).toBe(true);
    expect(playOneShot.mock.calls).toEqual([["sfx-door-close"], ["sfx-door-open"], ["sfx-door-close"], ["sfx-door-open"]]);
  });

  it("keeps collision throughout both interim frames and releases it only on the open frame", () => {
    vi.useFakeTimers();
    const door: DoorModulePlan = { side: "E", position: { x: 0, y: 0 } };
    const source = { id: 0 } as GraphNode;
    const target = { id: 1 } as GraphNode;
    const half = { setTexture: vi.fn(), setAlpha: vi.fn() };
    const collision = vi.fn<(rects: WallRect[]) => void>();
    const playOneShot = vi.fn();
    // Exercise the real renderer transition with a deterministic scene clock.
    const renderer = Object.assign(Object.create(PhaserRenderer.prototype), {
      layout: { nodes: [source, target], links: [{ id: "hall", source, target,
        points: [door.position, { x: 4 * s, y: 0 }] }], hiddenCount: 0 } as DungeonLayout,
      scene: { time: { delayedCall: (delay: number, callback: () => void) => setTimeout(callback, delay) } },
      visited: new Set([0]), visitedCorridors: new Set<string>(), doorTimers: [],
      doors: [{ door, roomId: 0, halves: [half, half], open: false, passable: false }],
      onDoorCollisionChanged: collision,
      playOneShot,
    }) as { updateDoors(animate: boolean): void; visitedCorridors: Set<string> };

    renderer.updateDoors(false);
    expect(playOneShot).not.toHaveBeenCalled();
    expect(collision.mock.lastCall?.[0]).toEqual([closedDoorFootprint(door)]);
    renderer.visitedCorridors.add("hall");
    renderer.updateDoors(true);
    expect(playOneShot).toHaveBeenCalledExactlyOnceWith("sfx-door-open");
    expect(collision.mock.lastCall?.[0]).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(half.setTexture.mock.lastCall?.[0]).toMatch(/_interim_2\.png$/);
    expect(collision.mock.lastCall?.[0]).toHaveLength(1);
    // Fog updates must not release a door that's already opening.
    renderer.updateDoors(true);
    vi.advanceTimersByTime(100);
    expect(half.setTexture.mock.lastCall?.[0]).toMatch(/_interim_1\.png$/);
    expect(collision.mock.lastCall?.[0]).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(half.setTexture.mock.lastCall?.[0]).toMatch(/_open\.png$/);
    expect(collision.mock.lastCall?.[0]).toEqual([]);
    renderer.updateDoors(true);
    expect(collision.mock.lastCall?.[0]).toEqual([]);
    expect(playOneShot).toHaveBeenCalledTimes(1);
  });
});
