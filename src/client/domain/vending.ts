import type { Decoration, GraphNode, LootKind, Point, VendingKind } from "../types";
import { footprintsOverlap, sweptEllipsesOverlap } from "./geometry";
import { stableHash } from "./hash";
import { worldPoint } from "./object-geometry";
import { LOOT_DEFINITIONS, PLAYER_SPEC } from "./world-specs";

export const VENDING_PRODUCTS: Readonly<Record<VendingKind, { kind: Exclude<LootKind, "weapon" | "credit">; name: string; price: number }>> = {
  medical: { kind: "medkit", name: "Medkit", price: 20 },
  ammo: { kind: "core", name: "Ammo crate", price: 10 },
  energy: { kind: "energy", name: "Energy crate", price: 15 },
  crystal: { kind: "crystal", name: "Crystal", price: 100 },
};

export const VENDING_SPRING_DURATION_MS = 400;
export const VENDING_DEPLETION_DELAY_MS = 140;

/** Damped spring recoil: initially away from the player, then a small rebound. */
export function vendingSpringOffset(direction: Point, elapsedMs: number): Point {
  const progress = Math.max(0, elapsedMs) / VENDING_SPRING_DURATION_MS;
  if (progress >= 1) return { x: 0, y: 0 };
  const displacement = Math.sin(progress * Math.PI * 2.5) * Math.exp(-progress * 4) * 24 * (1 - progress);
  return { x: direction.x * displacement, y: direction.y * displacement };
}

export function vendingPrice(kind: VendingKind, floor: number): number {
  // Integer arithmetic avoids rounding up floating-point noise at whole-RAM prices.
  return Math.ceil(VENDING_PRODUCTS[kind].price * (10 + Math.max(0, Math.floor(floor) - 1)) / 10);
}

export function vendingStockForSeed(seed: number): number {
  return stableHash(`${seed}|vending-stock`) % 5 + 1;
}

export function vendingDropForSeed(seed: number, kind: VendingKind): LootKind | null {
  return stableHash(`${seed}|vending-drop`) % 100 < 25 ? VENDING_PRODUCTS[kind].kind : null;
}

/** Equal overall common-type rates; medical machines compensate for theme eligibility. */
export function vendingKindForRoom(room: Pick<GraphNode, "lootSeed">, medical: boolean, themeCount: number): VendingKind | null {
  const roll = stableHash(`${room.lootSeed}|vending-type`) % 10_000;
  if (roll < 200) return "ammo";
  if (roll < 400) return "energy";
  if (roll < 500) return "crystal";
  if (medical && roll < 500 + 200 * themeCount) return "medical";
  return null;
}

export function vendingStateForSeed(seed: number, kind: VendingKind): {
  vendingCapacity: number; vendingRemaining: number; dropKind: LootKind | null;
} {
  const capacity = vendingStockForSeed(seed);
  return { vendingCapacity: capacity, vendingRemaining: capacity, dropKind: vendingDropForSeed(seed, kind) };
}

/** Replace the machine with permanent scenery, keeping its footprint and identity. */
export function vendingWreck(item: Decoration): Decoration {
  if (!item.vendingKind || item.kind === "debris") return item;
  return {
    ...item,
    definitionId: `debris-vending-${item.vendingKind}`,
    kind: "debris",
    obstacle: true,
    destructible: false,
    destroyed: false,
    hp: 1,
    maxHp: 1,
    dropKind: null,
    vendingRemaining: 0,
    vendingExhaustedAt: undefined,
    visual: { normal: item.visual.destroyed?.[0] ?? item.visual.normal, destroyed: [] },
  };
}

export function purchaseVendingItem(item: Decoration, credits: number, floor: number): {
  purchased: boolean; credits: number; price: number; depleted: boolean;
} {
  const price = item.vendingKind ? vendingPrice(item.vendingKind, floor) : 0;
  if (!item.vendingKind || item.destroyed || !item.vendingRemaining || credits < price) {
    return { purchased: false, credits, price, depleted: false };
  }
  item.vendingRemaining -= 1;
  return { purchased: true, credits: credits - price, price, depleted: item.vendingRemaining === 0 };
}

/** Only an attempted move toward the machine can trigger a purchase. */
export function bumpsVendingMachine(from: Point, to: Point, item: Decoration): boolean {
  if (!item.vendingKind || item.destroyed || !item.vendingRemaining) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx * (item.x - from.x) + dy * (item.y - from.y) <= 0) return false;
  return sweptEllipsesOverlap(from, to, PLAYER_SPEC.footprintRadii, item, worldPoint(item, "footprintRadii"));
}

/** A small separation margin prevents repeated purchases from collision jitter. */
export function touchingVendingMachine(player: Point, item: Decoration): boolean {
  return footprintsOverlap(player, {
    x: PLAYER_SPEC.footprintRadii.x + 8,
    y: PLAYER_SPEC.footprintRadii.y + 8,
  }, item, worldPoint(item, "footprintRadii"));
}

export function vendingLootPosition(item: Decoration, toward: Point, canPlace: (point: Point) => boolean): Point | null {
  if (!item.vendingKind) return null;
  const kind = VENDING_PRODUCTS[item.vendingKind].kind;
  const footprint = worldPoint(item, "footprintRadii");
  const loot = LOOT_DEFINITIONS[kind].footprintRadii;
  const radius = Math.max(footprint.x, footprint.y) + Math.max(loot.x, loot.y) + 16;
  const start = Math.atan2(toward.y - item.y, toward.x - item.x);
  for (const scale of [1, 1.5, 2, 3]) {
    for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const angle = start + turn * Math.PI / 4;
      const point = { x: item.x + Math.cos(angle) * radius * scale, y: item.y + Math.sin(angle) * radius * scale };
      if (canPlace(point)) return point;
    }
  }
  return null;
}
