import { describe, expect, it } from "vitest";
import { monsterSpecForSceneryAmbush, sceneryAmbushOutcome } from "../../src/client/domain/generation";
import { DECORATION_DEFINITIONS } from "../../src/client/domain/world-specs";

const floor = "https://example.com/warehouse::floor-1";
const outcomesFor = (definitionId: string, count: number, depth = 1, destructible = true) =>
  Array.from({ length: count }, (_, index) => sceneryAmbushOutcome({
    id: `room-${index}::${definitionId}-0`, definitionId, destructible,
  }, floor, depth));

describe("scenery ambush outcomes", () => {
  it.each(["sealed-escape-capsule", "lifeboat-pod", "cargo-shelf", "crate-armored", "crate-ammo", "crate-medical"])(
    "rolls both a monster and a powerup for %s across different props",
    definitionId => expect(new Set(outcomesFor(definitionId, 500))).toEqual(new Set(["monster", "powerup", null])),
  );

  it.each([[1, 5], [2, 7], [6, 15], [60, 98]])("scales floor %i to about %i%% monsters while reserving 2%% for powerups", (depth, percent) => {
    const outcomes = outcomesFor("cargo-shelf", 20_000, depth);
    const frequency = (result: string) => outcomes.filter(outcome => outcome === result).length / outcomes.length;
    expect(Math.abs(frequency("monster") - percent / 100)).toBeLessThan(0.008);
    expect(Math.abs(frequency("powerup") - 0.02)).toBeLessThan(0.006);
    expect(outcomesFor("cargo-shelf", 20_000, depth)).toEqual(outcomes);
  });

  it.each([DECORATION_DEFINITIONS.sealedEscapeCapsule, DECORATION_DEFINITIONS.lifeboatPod, DECORATION_DEFINITIONS.serverRack])(
    "$definitionId can spawn either type of heavy enemy", definition => {
      const kinds = Array.from({ length: 100 }, (_, index) => monsterSpecForSceneryAmbush({
        ...definition, id: `room-${index}::decor-0`, roomId: index, x: 0, y: 0, maxHp: definition.hp,
        destroyed: true, dropKind: null,
      }, 1)?.kind);
      expect(new Set(kinds)).toEqual(new Set(["melee-heavy", "shooter-heavy"]));
    },
  );

  it.each([DECORATION_DEFINITIONS.plantGreen, DECORATION_DEFINITIONS.planterDivider])(
    "$definitionId can spawn a small enemy", definition => {
      expect(outcomesFor(definition.definitionId, 500)).toContain("monster");
      const monster = monsterSpecForSceneryAmbush({
        ...definition, id: "decor-0", roomId: 1, x: 0, y: 0, maxHp: definition.hp, destroyed: true, dropKind: null,
      }, 1);
      expect(monster?.kind).toMatch(/^(melee|shooter)-light$/);
    },
  );

  it("does not roll for open pods or indestructible props", () => {
    expect(outcomesFor("open-escape-capsule", 500).every(outcome => outcome === null)).toBe(true);
    expect(outcomesFor("cargo-shelf", 500, 1, false).every(outcome => outcome === null)).toBe(true);
  });
});
