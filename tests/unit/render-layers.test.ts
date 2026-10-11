import { describe, expect, it } from "vitest";
import { isGroundDebris, lootLayer } from "../../src/client/render/render-layers";

describe("decoration render layers", () => {
  it("keeps ground rubble on the floor layer but Y-sorts the vending wreck like scenery", () => {
    expect(isGroundDebris({ kind: "debris", obstacle: false, destroyed: false, definitionId: "debris-metal" })).toBe(true);
    expect(isGroundDebris({ kind: "doorway-debris", obstacle: false, destroyed: false, definitionId: "debris-circuit" })).toBe(true);
    expect(isGroundDebris({ kind: "plant", obstacle: true, destroyed: true, definitionId: "plant-violet" })).toBe(true);
    expect(isGroundDebris({ kind: "debris", obstacle: true, destroyed: false, definitionId: "debris-vending-ammo" })).toBe(false);
    expect(isGroundDebris({ kind: "vending", obstacle: true, destroyed: false, definitionId: "vending-ammo" })).toBe(false);
    expect(isGroundDebris({ kind: "weapon-pedestal", obstacle: false, destroyed: false, definitionId: "weapon-pedestal" })).toBe(false);
  });
});

describe("loot render layers", () => {
  it("layers pedestal rewards, floor weapons/power-ups and regular loot", () => {
    expect(lootLayer({ kind: "weapon", weaponPlacement: "pedestal" })).toBe("pedestal");
    expect(lootLayer({ kind: "powerup", powerupPlacement: "pedestal" })).toBe("pedestal");
    expect(lootLayer({ kind: "weapon", weaponPlacement: "floor" })).toBe("special");
    expect(lootLayer({ kind: "powerup", powerupPlacement: "floor" })).toBe("special");
    expect(lootLayer({ kind: "credit" })).toBe("regular");
    expect(lootLayer({ kind: "medkit" })).toBe("regular");
  });
});
