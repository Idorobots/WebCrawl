import { describe, expect, it } from "vitest";
import { sceneryAmbushOutcome } from "../../src/client/domain/generation";

const floor = "https://example.com/warehouse::floor-1";
const outcomesFor = (definitionId: string, count: number, destructible = true) =>
  Array.from({ length: count }, (_, index) => sceneryAmbushOutcome({
    id: `room-${index}::${definitionId}-0`, definitionId, destructible,
  }, floor));

describe("scenery ambush outcomes", () => {
  it.each(["sealed-escape-capsule", "lifeboat-pod", "cargo-shelf", "crate-armored", "crate-ammo", "crate-medical"])(
    "rolls both a monster and a powerup for %s across different props",
    definitionId => expect(new Set(outcomesFor(definitionId, 500))).toEqual(new Set(["monster", "powerup", null])),
  );

  it("gives about 10% of eligible props a monster and 2% a powerup", () => {
    const outcomes = outcomesFor("cargo-shelf", 10_000);
    const frequency = (result: string) => outcomes.filter(outcome => outcome === result).length / outcomes.length;
    expect(Math.abs(frequency("monster") - 0.10)).toBeLessThan(0.01);
    expect(Math.abs(frequency("powerup") - 0.02)).toBeLessThan(0.01);
    expect(outcomesFor("cargo-shelf", 10_000)).toEqual(outcomes);
  });

  it("does not roll for open pods or indestructible props", () => {
    expect(outcomesFor("open-escape-capsule", 500).every(outcome => outcome === null)).toBe(true);
    expect(outcomesFor("cargo-shelf", 500, false).every(outcome => outcome === null)).toBe(true);
  });
});
