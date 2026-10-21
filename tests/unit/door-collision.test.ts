/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhaserRenderer } from "../../src/client/render/phaser-renderer";
import { closedDoorFootprint, wallBlocksSegment, wallHitboxes, WallRectIndex, type WallRect } from "../../src/client/domain/wall-collision";
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
