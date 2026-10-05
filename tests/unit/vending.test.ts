import { describe, expect, it } from "vitest";
import type { Decoration, GraphNode, VendingKind } from "../../src/client/types";
import { applyObstacleDamage, bossCrushedScenery, projectileHitsDecoration } from "../../src/client/domain/combat";
import { buildDecorations, buildSceneryDrops, decorationSpecsForRoom, roomSceneryThemeForRoom, sceneryDropKindForSeed } from "../../src/client/domain/generation";
import { footprintsOverlap } from "../../src/client/domain/geometry";
import { stableHash } from "../../src/client/domain/hash";
import { resolveGeometry } from "../../src/client/domain/object-geometry";
import { DECORATION_DEFINITIONS, ROOM_SCENERY_THEMES, VENDING_DEFINITIONS } from "../../src/client/domain/world-specs";
import {
  bumpsVendingMachine, purchaseVendingItem, touchingVendingMachine,
  vendingKindForRoom, vendingLootPosition, vendingPrice, vendingSpringOffset, vendingStateForSeed, vendingWreck,
  VENDING_PRODUCTS, VENDING_SPRING_DURATION_MS,
} from "../../src/client/domain/vending";

function machine(kind: VendingKind = "ammo", seed = 42): Decoration {
  const definition = VENDING_DEFINITIONS[kind];
  return {
    ...definition, id: "machine", roomId: 0, x: 0, y: 0,
    hp: definition.hp, maxHp: definition.hp, destroyed: false,
    ...vendingStateForSeed(seed, kind),
  };
}

function room(seed: number): GraphNode {
  return {
    id: seed, parentId: null, depth: 0, tag: "div", hrefs: [], coalescedCount: 0,
    label: "room", floorLabel: "room", title: "room", contentHtml: null,
    width: 1600, height: 1600, lootSeed: stableHash(`vending-room-${seed}`),
    isRoot: true, isHidden: false, x: 0, y: 0, parentSide: null,
    directionFromParent: null, shape: "rectangle", childCount: 0,
  };
}

describe("vending machines", () => {
  it.each(Object.keys(VENDING_PRODUCTS) as VendingKind[])("uses refrigerator geometry and destructible blocking for %s", kind => {
    const item = machine(kind);
    const refrigerator = resolveGeometry(DECORATION_DEFINITIONS.refrigerator);
    const geometry = resolveGeometry(item);
    expect(geometry.size).toBe(refrigerator.size);
    expect(geometry.footprintRadii).toEqual(refrigerator.footprintRadii);
    expect(geometry.hitboxRadii).toEqual(refrigerator.hitboxRadii);
    expect(geometry.hitboxOffset).toEqual(refrigerator.hitboxOffset);
    expect(item.obstacle).toBe(true);
    expect(projectileHitsDecoration(item, { x: 0, y: -80 }, 1)).toBe(true);
    expect(projectileHitsDecoration(item, { x: 50, y: -30 }, 1)).toBe(false);
    expect(item.visual.animations?.destroy).toEqual(DECORATION_DEFINITIONS.barrelRed.visual.animations.destroy);
    expect(applyObstacleDamage(item, item.hp)).toBe(true);
    expect(item.destroyed).toBe(true);
    expect(purchaseVendingItem(item, 1000, 1).purchased).toBe(false);
  });

  it("increases prices linearly and rounds fractional RAM upward without arithmetic noise", () => {
    expect([1, 2, 3, 10].map(floor => vendingPrice("medical", floor))).toEqual([20, 22, 24, 38]);
    expect([1, 2, 3, 10].map(floor => vendingPrice("ammo", floor))).toEqual([10, 11, 12, 19]);
    expect([1, 2, 3, 4].map(floor => vendingPrice("energy", floor))).toEqual([15, 17, 18, 20]);
    expect([1, 2, 3, 10].map(floor => vendingPrice("crystal", floor))).toEqual([100, 110, 120, 190]);
  });

  it.each(Object.keys(VENDING_PRODUCTS) as VendingKind[])("replaces destroyed %s machines with permanent blocking scenery", kind => {
    const item = machine(kind);
    item.dropKind = VENDING_PRODUCTS[kind].kind;
    applyObstacleDamage(item, item.hp);
    expect(buildSceneryDrops([item], "floor", new Set())).toHaveLength(1);
    const wreck = vendingWreck(item);
    expect(wreck).toMatchObject({
      id: item.id, x: item.x, y: item.y, roomId: item.roomId,
      kind: "debris", destroyed: false, obstacle: true, destructible: false,
      vendingRemaining: 0, dropKind: null,
    });
    expect(wreck.footprintRadii).toEqual(item.footprintRadii);
    expect(wreck.size).toBe(item.size);
    expect(wreck.visual.normal).toEqual(item.visual.destroyed![0]);
    const footprint = resolveGeometry(wreck).footprintRadii;
    expect(footprintsOverlap({ x: 0, y: 50 }, { x: 20, y: 20 }, wreck, footprint)).toBe(true);
    expect(applyObstacleDamage(wreck, 10_000)).toBe(false);
    expect(wreck.hp).toBe(1);
    expect(bossCrushedScenery({ x: -100, y: 0 }, { x: 100, y: 0 }, 80, [wreck])).toEqual([]);
    expect(purchaseVendingItem(wreck, 1000, 1).purchased).toBe(false);
    expect(bumpsVendingMachine({ x: 0, y: 60 }, { x: 0, y: 50 }, wreck)).toBe(false);
    expect(buildSceneryDrops([wreck], "floor", new Set())).toEqual([]);
    expect(vendingWreck(wreck)).toBe(wreck);
  });

  it("charges once per successful item, leaves failed purchases intact, and never oversells", () => {
    const item = { ...machine("medical"), vendingRemaining: 2 };
    expect(purchaseVendingItem(item, 21, 2)).toEqual({ purchased: false, credits: 21, price: 22, depleted: false });
    expect(item.vendingRemaining).toBe(2);
    expect(purchaseVendingItem(item, 22, 2)).toEqual({ purchased: true, credits: 0, price: 22, depleted: false });
    expect(item.vendingRemaining).toBe(1);
    expect(purchaseVendingItem(item, 50, 2)).toEqual({ purchased: true, credits: 28, price: 22, depleted: true });
    expect(item.destroyed).toBe(false);
    expect(item.vendingExhaustedAt).toBeUndefined();
    expect(purchaseVendingItem(item, 50, 2)).toEqual({ purchased: false, credits: 50, price: 22, depleted: false });
    expect(item.vendingRemaining).toBe(0);
  });

  it("triggers from swept movement into its footprint, including a fully blocked step", () => {
    const item = machine();
    expect(bumpsVendingMachine({ x: 0, y: 70 }, { x: 0, y: 50 }, item)).toBe(true);
    expect(bumpsVendingMachine({ x: 0, y: 55 }, { x: 0, y: 54 }, item)).toBe(true);
    expect(bumpsVendingMachine({ x: 0, y: 55 }, { x: 0, y: 65 }, item)).toBe(false);
    expect(bumpsVendingMachine({ x: 0, y: 55 }, { x: 10, y: 55 }, item)).toBe(false);
    expect(bumpsVendingMachine({ x: 0, y: 55 }, { x: 0, y: 55 }, item)).toBe(false);
    expect(touchingVendingMachine({ x: 0, y: 60 }, item)).toBe(true);
    expect(touchingVendingMachine({ x: 0, y: 80 }, item)).toBe(false);
  });

  it.each(Object.keys(VENDING_PRODUCTS) as VendingKind[])("allows another bump of an empty %s machine but not its exploding or wrecked state", kind => {
    const item = { ...machine(kind), vendingRemaining: 0 };
    const from = { x: 0, y: 70 };
    const to = { x: 0, y: 50 };
    expect(bumpsVendingMachine(from, to, item)).toBe(true);
    expect(purchaseVendingItem(item, 0, 1)).toMatchObject({ purchased: false, credits: 0 });
    expect(item.vendingRemaining).toBe(0);
    expect(bumpsVendingMachine(to, from, item)).toBe(false);
    item.vendingExhaustedAt = 140;
    expect(bumpsVendingMachine(from, to, item)).toBe(false);
    expect(bumpsVendingMachine(from, to, vendingWreck(item))).toBe(false);
  });

  it("pushes away, rebounds, and returns exactly to its anchor", () => {
    expect(vendingSpringOffset({ x: 1, y: 0 }, 60).x).toBeGreaterThan(0);
    expect(vendingSpringOffset({ x: 1, y: 0 }, 240).x).toBeLessThan(0);
    expect(vendingSpringOffset({ x: 0, y: -1 }, 60).y).toBeLessThan(0);
    expect(vendingSpringOffset({ x: 1, y: 0 }, VENDING_SPRING_DURATION_MS)).toEqual({ x: 0, y: 0 });
  });

  it("finds nearby free floor space and fails cleanly when every candidate is blocked", () => {
    const item = machine();
    const position = vendingLootPosition(item, { x: 100, y: 0 }, point => point.y > 60);
    expect(position?.y).toBeGreaterThan(60);
    expect(vendingLootPosition(item, { x: 100, y: 0 }, () => false)).toBeNull();
  });

  it("uses stable 1–5 stock and independent matching-product drops at approximately 25%", () => {
    const stocks = new Set<number>();
    let drops = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const seed = stableHash(`vending-item-${index}`);
      const state = vendingStateForSeed(seed, "medical");
      expect(state).toEqual(vendingStateForSeed(seed, "medical"));
      stocks.add(state.vendingRemaining!);
      if (state.dropKind) {
        expect(state.dropKind).toBe("medkit");
        drops += 1;
      }
      expect(sceneryDropKindForSeed(seed, "vending-medical")).toBe(state.dropKind);
    }
    expect([...stocks].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(drops / 10_000).toBeGreaterThan(0.23);
    expect(drops / 10_000).toBeLessThan(0.27);
  });

  it("keeps machines rare, crystals half as common, and medical vending exclusive to medical themes", () => {
    const counts = { medical: 0, ammo: 0, energy: 0, crystal: 0 };
    const themeCount = Object.keys(ROOM_SCENERY_THEMES).length;
    for (let index = 0; index < 20_000; index += 1) {
      const candidate = room(index);
      const medical = roomSceneryThemeForRoom(candidate) === "medical";
      const kind = vendingKindForRoom(candidate, medical, themeCount);
      if (kind) counts[kind] += 1;
      if (kind === "medical") expect(medical).toBe(true);
    }
    for (const kind of ["medical", "ammo", "energy"] as const) {
      expect(counts[kind] / 20_000).toBeGreaterThan(0.015);
      expect(counts[kind] / 20_000).toBeLessThan(0.025);
      expect(counts.crystal / counts[kind]).toBeGreaterThan(0.35);
      expect(counts.crystal / counts[kind]).toBeLessThan(0.65);
    }
  });

  it("places machines deterministically and restores partially spent and destroyed authored stock", () => {
    const generated: Decoration[] = [];
    for (let index = 0; index < 200; index += 1) {
      const candidate = room(index);
      const items = decorationSpecsForRoom(candidate);
      expect(items).toEqual(decorationSpecsForRoom(candidate));
      const machines = items.filter(item => item.vendingKind);
      expect(machines.length).toBeLessThanOrEqual(1);
      generated.push(...machines);
    }
    expect(generated.length).toBeGreaterThan(0);
    const candidate = room(0);
    const layout = { nodes: [candidate], links: [], hiddenCount: 0 };
    const authored = new Map([[candidate.id, {
      width: 1600, height: 1600, decorations: [{ definition: "vendingEnergy" as const, x: 100, y: 100 }],
    }]]);
    const original = buildDecorations(layout, new Map(), 3, undefined, authored)[0]!;
    expect(original.vendingRemaining).toBe(original.vendingCapacity);
    const saved = new Map([[original.id, { hp: 5, destroyed: false, vendingRemaining: 1 }]]);
    const restored = buildDecorations(layout, saved, 3, undefined, authored)[0]!;
    expect(restored.hp).toBe(5);
    expect(restored.vendingRemaining).toBe(1);
    expect(restored.vendingCapacity).toBe(original.vendingCapacity);
    saved.set(original.id, { hp: 5, destroyed: false, vendingRemaining: 0 });
    const empty = buildDecorations(layout, saved, 3, undefined, authored)[0]!;
    expect(empty).toMatchObject({ hp: 5, destroyed: false, destructible: true, vendingRemaining: 0 });
    expect(empty.kind).not.toBe("debris");
    expect(empty.vendingExhaustedAt).toBeUndefined();
    saved.set(original.id, { hp: 0, destroyed: true, vendingRemaining: 0 });
    const wreck = buildDecorations(layout, saved, 3, undefined, authored)[0]!;
    expect(wreck).toMatchObject({ kind: "debris", destroyed: false, obstacle: true, destructible: false, vendingRemaining: 0 });
    expect(wreck.footprintRadii).toEqual(original.footprintRadii);
    // Shooting with stock still inside must restore the same empty, permanent wreck.
    saved.set(original.id, { hp: 0, destroyed: true, vendingRemaining: original.vendingCapacity! });
    expect(buildDecorations(layout, saved, 3, undefined, authored)[0]).toEqual(wreck);
  });
});
