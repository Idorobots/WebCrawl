import { describe, expect, it } from "vitest";
import { resolveGeometry } from "../../src/client/domain/object-geometry";
import * as relative from "../../src/client/domain/specs";
import * as world from "../../src/client/domain/world-specs";

describe("size-relative object geometry", () => {
  it("preserves authored pixel tuning when resolving the original sizes", () => {
    expect(world.PLAYER_SPEC.visualOffset).toEqual({ x: 0, y: -60 });
    expect(world.PLAYER_SPEC.hitboxOffset).toEqual({ x: 0, y: -25 });
    expect(world.PLAYER_SPEC.hitboxRadii).toEqual({ x: 28, y: 28 });
    expect(world.PLAYER_SPEC.footprintRadii).toEqual({ x: 20, y: 20 });
    const manipulator = world.DECORATION_DEFINITIONS.roboticManipulator;
    expect(manipulator.visualOffset).toEqual({ x: -15, y: -40 });
    expect(manipulator.hitboxOffset).toEqual({ x: -5, y: -50 });
    expect(manipulator.hitboxRadii).toEqual({ x: 35, y: 50 });
    expect(manipulator.footprintRadii).toEqual({ x: 40, y: 25 });
    expect(world.BOSS_DEFINITIONS["glm-hunter"].destroyedVisualOffset).toEqual({ x: 0, y: -78.75 });
    expect(world.PORTAL_DEFINITION.visualOffset).toEqual({ x: 0, y: -30 });
    expect(world.PORTAL_DEFINITION.footprintRadii).toEqual({ x: 40, y: 25 });
    expect(world.LOOT_DEFINITIONS.medkit.footprintRadii).toEqual({ x: 20, y: 20 });
    expect(world.WEAPON_PICKUP_DEFINITIONS.floor.footprintRadii).toEqual({ x: 20, y: 20 });
  });

  it("scales both axes and wreck offsets with size, including actors with a larger sprite", () => {
    const definition = relative.REGULAR_MONSTER_DEFINITIONS["sentry-light"];
    const enlarged = resolveGeometry(definition, definition.size * 2);
    expect(enlarged.size).toBe(350);
    expect(enlarged.spriteSize).toBe(497);
    expect(enlarged.visualOffset).toEqual({ x: 0, y: -140 });
    expect(enlarged.hitboxOffset).toEqual({ x: 0, y: -40 });
    expect(enlarged.hitboxRadii).toEqual({ x: 80, y: 80 });
    expect(enlarged.footprintRadii).toEqual({ x: 70, y: 70 });
    expect(enlarged.destroyedVisualOffset).toEqual({ x: 0, y: -110.25 });
    expect(definition.size).toBe(175);
    expect(definition.visualOffset.y).toBe(-0.4);
    const resizedScenery = resolveGeometry({ ...relative.DECORATION_DEFINITIONS.heatExchanger, size: 320 });
    expect(resizedScenery.visualOffset).toEqual({ x: 10, y: -80 });
    expect(resizedScenery.hitboxOffset).toEqual({ x: 10, y: -60 });
    expect(resizedScenery.hitboxRadii).toEqual({ x: 100, y: 120 });
    expect(resizedScenery.footprintRadii).toEqual({ x: 70, y: 50 });
  });

  it("stores offsets and radii as ratios throughout every specification family", () => {
    const definitions = [
      relative.PLAYER_SPEC, relative.PORTAL_DEFINITION,
      ...Object.values(relative.REGULAR_MONSTER_DEFINITIONS),
      ...Object.values(relative.BOSS_DEFINITIONS),
      ...Object.values(relative.DECORATION_DEFINITIONS),
      ...Object.values(relative.LOOT_DEFINITIONS),
      ...Object.values(relative.WEAPON_PICKUP_DEFINITIONS),
    ];
    for (const definition of definitions) {
      for (const field of ["visualOffset", "destroyedVisualOffset", "hitboxOffset", "hitboxRadii", "footprintRadii"] as const) {
        if (!(field in definition)) continue;
        const point = (definition as Record<string, unknown>)[field] as { x: number; y: number };
        expect(Math.abs(point.x), field).toBeLessThanOrEqual(1);
        expect(Math.abs(point.y), field).toBeLessThanOrEqual(1);
      }
    }
  });

  it("uses resolved world geometry in every weighted scenery pool", () => {
    for (const theme of Object.values(world.ROOM_SCENERY_THEMES)) {
      for (const entry of [...theme.primary, ...theme.accents]) {
        const definition = Object.values(world.DECORATION_DEFINITIONS).find(item => item.definitionId === entry.definition.definitionId);
        expect(entry.definition).toBe(definition);
      }
    }
  });
});
