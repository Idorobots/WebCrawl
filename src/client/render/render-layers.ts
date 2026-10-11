import type { Decoration, LootItem } from "../types";

export type LootLayer = "regular" | "special" | "pedestal";

/**
 * Ground rubble (non-obstacle debris and destroyed props) stays pinned to the
 * floor layer, so actors always walk over it. A vending-machine wreck is an
 * indestructible obstacle and must Y-sort like scenery instead.
 */
export function isGroundDebris(item: Pick<Decoration, "kind" | "obstacle" | "destroyed" | "definitionId">): boolean {
  const isVendingWreck = item.kind === "debris" && item.obstacle;
  return !isVendingWreck && (
    item.destroyed ||
    item.kind === "debris" ||
    item.kind === "doorway-debris" ||
    item.definitionId.startsWith("debris")
  );
}

/** Weapons and power-ups render above regular loot; pedestal rewards render on the pedestal. */
export function lootLayer(item: Pick<LootItem, "kind" | "weaponPlacement" | "powerupPlacement">): LootLayer {
  if (item.weaponPlacement === "pedestal" || item.powerupPlacement === "pedestal") return "pedestal";
  return item.kind === "weapon" || item.kind === "powerup" ? "special" : "regular";
}
