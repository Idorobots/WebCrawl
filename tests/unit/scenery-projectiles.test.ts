import { describe, expect, it } from "vitest";
import { actorCollisionCenter, applyObstacleDamage, projectileHitsDecoration, sceneryBlocksProjectiles } from "../../src/client/domain/combat";
import { worldPoint } from "../../src/client/domain/object-geometry";
import { DECORATION_DEFINITIONS } from "../../src/client/domain/world-specs";
import type { Decoration } from "../../src/client/types";

function scenery(definition: keyof typeof DECORATION_DEFINITIONS): Decoration {
  const spec = DECORATION_DEFINITIONS[definition];
  return { ...spec, id: definition, roomId: 0, x: 100, y: 200, maxHp: spec.hp, destroyed: false, dropKind: null };
}

describe("scenery projectile collisions", () => {
  it.each(["barricade", "hydraulicSupport"] as const)("intercepts shots on the %s hitbox without taking damage", definition => {
    const item = scenery(definition);
    const center = actorCollisionCenter(item, worldPoint(item, "hitboxOffset"));
    const radii = worldPoint(item, "hitboxRadii");
    expect(sceneryBlocksProjectiles(item)).toBe(true);
    expect(projectileHitsDecoration(item, center, 6)).toBe(true);
    expect(projectileHitsDecoration(item, { x: center.x + radii.x + 7, y: center.y }, 6)).toBe(false);
    const hp = item.hp;
    expect(applyObstacleDamage(item, 1000)).toBe(false);
    expect(item).toMatchObject({ hp, destroyed: false, obstacle: true });
  });

  it("preserves collisions with destructible nonblocking props and ignores destroyed or nonsolid decorations", () => {
    const pipe = scenery("pipeManifold");
    expect(pipe.obstacle).toBe(false);
    expect(sceneryBlocksProjectiles(pipe)).toBe(true);
    expect(applyObstacleDamage(pipe, pipe.hp)).toBe(true);
    expect(sceneryBlocksProjectiles(pipe)).toBe(false);
    const nonsolid = { ...scenery("barricade"), obstacle: false };
    expect(sceneryBlocksProjectiles(nonsolid)).toBe(false);
  });
});
