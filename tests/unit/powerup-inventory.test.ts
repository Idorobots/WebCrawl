import { describe, expect, it } from "vitest";
import { POWERUP_KINDS } from "../../src/client/domain/powerups";
import type { PowerupKind } from "../../src/client/types";
import { renderPowerupInventory } from "../../src/client/ui/powerup-inventory";

function slots(host: HTMLElement): Array<string | undefined> {
  return [...host.querySelectorAll<HTMLElement>(".powerup-inventory-slot")].map(slot => slot.dataset.powerup);
}

describe("powerup inventory", () => {
  it("renders owned kinds in pickup order and keeps stacks in their original position", () => {
    const host = document.createElement("div");
    renderPowerupInventory(host, { damage: 2, health: 1, berserk: 3 }, ["health", "damage", "berserk"]);
    expect(slots(host)).toEqual(["health", "damage", "berserk"]);
    expect(host.hidden).toBe(false);
  });

  it("appends kinds missing from the order after the ordered ones", () => {
    const host = document.createElement("div");
    renderPowerupInventory(host, { health: 1, damage: 1 }, ["damage"]);
    expect(slots(host)).toEqual(["damage", "health"]);
  });

  it("switches to the multiline layout only above eight owned kinds", () => {
    const host = document.createElement("div");
    const count = (kinds: PowerupKind[]): Partial<Record<PowerupKind, number>> =>
      Object.fromEntries(kinds.map(kind => [kind, 1]));
    const eight = POWERUP_KINDS.slice(0, 8);
    renderPowerupInventory(host, count(eight), eight);
    expect(host.classList.contains("is-multiline")).toBe(false);

    const nine = POWERUP_KINDS.slice(0, 9);
    renderPowerupInventory(host, count(nine), nine);
    expect(host.classList.contains("is-multiline")).toBe(true);
  });

  it("hides the inventory when nothing is owned", () => {
    const host = document.createElement("div");
    renderPowerupInventory(host, {}, []);
    expect(host.hidden).toBe(true);
    expect(slots(host)).toEqual([]);
  });
});
