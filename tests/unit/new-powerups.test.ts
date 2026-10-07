import { describe, expect, it, vi } from "vitest";
import { artDebugLevel } from "../../src/client/domain/authored-rooms";
import { bonusLootDrop, bossSpecForRoom } from "../../src/client/domain/generation";
import { advanceMonsterStatuses, applyBulletStatuses, monsterMovementSpeed, monsterStatusTint, SLOW_TINT, STUN_TINT } from "../../src/client/domain/monster-status";
import { collectPowerup, createPlayerState, criticalBulletDamage, extraProjectiles, playerAttackDamage,
  powerupChance, receivedPlayerDamage, resourcesAfterShot } from "../../src/client/domain/powerups";
import { projectilesForWeapon, weaponForKind, weaponKinds } from "../../src/client/domain/weapons";
import type { Decoration } from "../../src/client/types";

const monster = () => bossSpecForRoom({ ...artDebugLevel().layout.nodes[0]!, isBossArena: true }, 1);

describe("combat powerup stacking", () => {
  it("adds uncapped damage, speed, homing and missing-health bonuses, with multiplicative damage reduction", () => {
    const state = createPlayerState(true);
    for (let index = 0; index < 100; index++) {
      for (const kind of ["damage", "movement_speed", "shot_speed", "shot_aim", "berserk", "damage_reduction"] as const) collectPowerup(state, kind);
    }
    expect(state.damageMultiplier).toBe(11);
    expect(state.walkSpeedMultiplier).toBe(11);
    expect(state.shotRateMultiplier).toBe(11);
    expect(state.aimAid).toBeCloseTo(10.2);
    state.hp = 5;
    expect(playerAttackDamage(state, 2)).toBe(132);
    expect(receivedPlayerDamage(state, 10)).toBeCloseTo(10 * 0.9 ** 100);
    const fresh = createPlayerState();
    collectPowerup(fresh, "damage_reduction");
    collectPowerup(fresh, "damage_reduction");
    expect(receivedPlayerDamage(fresh, 10)).toBeCloseTo(8.1);
    collectPowerup(fresh, "berserk");
    fresh.hp = 5;
    expect(playerAttackDamage(fresh, 2)).toBeCloseTo(2.1);
    fresh.hp = fresh.maxHp;
    expect(playerAttackDamage(fresh, 2)).toBe(2);
    fresh.criticalChance = 1;
    fresh.hp = 0;
    expect(criticalBulletDamage(fresh, playerAttackDamage(fresh, 2), () => 0)).toBeCloseTo(6.6);
    expect(powerupChance(100)).toBe(1);
  });

  it("rolls bonus bullets independently for all five original shotgun pellets without recursively multiplying", () => {
    const projectiles = projectilesForWeapon(weaponForKind("scatter-array"), { x: 1, y: 0 });
    const before = structuredClone(projectiles);
    const rolls = [0.05, 0.2, 0.09, 0.1, 0.99];
    const random = vi.fn(() => rolls.shift()!);
    const result = extraProjectiles(projectiles, 1, random);
    expect(random).toHaveBeenCalledTimes(5);
    expect(result).toHaveLength(7);
    expect(result.filter(item => projectiles.includes(item))).toHaveLength(5);
    expect(projectiles).toEqual(before);
    expect(extraProjectiles(projectiles, 100, () => 0.999)).toHaveLength(10);
    expect(extraProjectiles(projectiles, 0, () => { throw new Error("no powerup must not roll"); })).toEqual(projectiles);
  });

  it.each(weaponKinds())("preserves the original %s pattern and each extra bullet's damage, speed and range", kind => {
    const projectiles = projectilesForWeapon(weaponForKind(kind), { x: 0, y: 1 }, 3);
    const result = extraProjectiles(projectiles, 10, () => 0.5);
    expect(result).toHaveLength(projectiles.length * 2);
    projectiles.forEach((original, index) => {
      expect(result[index * 2]).toEqual(original);
      expect(result[index * 2 + 1]).toMatchObject({ damage: original.damage, speed: original.speed,
        range: original.range, radius: original.radius, lateralOffset: original.lateralOffset });
      expect(Math.hypot(result[index * 2 + 1]!.direction.x, result[index * 2 + 1]!.direction.y)).toBeCloseTo(1);
    });
  });

  it("uses energy only at the last ammo round, one unit per shot regardless of powerup stacks", () => {
    const state = createPlayerState();
    state.energy = 3;
    expect(resourcesAfterShot(state, 1)).toEqual({ ammo: 0, energy: 3 });
    collectPowerup(state, "energy_ammo");
    expect(resourcesAfterShot(state, 2)).toEqual({ ammo: 1, energy: 3 });
    expect(resourcesAfterShot(state, 1)).toEqual({ ammo: 1, energy: 2 });
    expect(resourcesAfterShot(state, null)).toEqual({ ammo: null, energy: 3 });
    collectPowerup(state, "energy_ammo");
    expect(resourcesAfterShot(state, 0)).toEqual({ ammo: 0, energy: 2 });
    state.energy = 0.9;
    expect(resourcesAfterShot(state, 1)).toEqual({ ammo: 0, energy: 0.9 });
    expect(state.energy).toBe(0.9);
  });
});

describe("on-hit slow and stun", () => {
  it.each(["damage_slow", "damage_stun"] as const)("uses a 5%% per-stack chance for %s, capped at 100%%", kind => {
    const state = createPlayerState();
    collectPowerup(state, kind);
    const duration = kind === "damage_slow" ? 2_000 : 500;
    const field = kind === "damage_slow" ? "slowRemainingMs" : "stunRemainingMs";
    const succeeds = monster();
    applyBulletStatuses(succeeds, state, () => 0.049);
    expect(succeeds[field]).toBe(duration);
    const fails = monster();
    applyBulletStatuses(fails, state, () => 0.05);
    expect(fails[field] ?? 0).toBe(0);
    collectPowerup(state, kind);
    const stacked = monster();
    applyBulletStatuses(stacked, state, () => 0.099);
    expect(stacked[field]).toBe(duration);
    state.powerups[kind] = 20;
    const capped = monster();
    applyBulletStatuses(capped, state, () => 0.999);
    expect(capped[field]).toBe(duration);
  });

  it("preserves the first slow, permits refresh, and only allows stun after slow expires", () => {
    const target = monster();
    const state = createPlayerState();
    state.powerups = { damage_slow: 20, damage_stun: 20 };
    applyBulletStatuses(target, state, () => 0);
    expect(target.slowRemainingMs).toBe(2_000);
    expect(target.stunRemainingMs).toBe(0);
    expect(monsterMovementSpeed(target)).toBe(target.speed / 2);
    expect(monsterStatusTint(target)).toBe(SLOW_TINT);
    advanceMonsterStatuses(target, 900);
    const refresh = vi.fn(() => 0.999);
    applyBulletStatuses(target, state, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(target.slowRemainingMs).toBe(2_000);
    expect(target.stunRemainingMs).toBe(0);
    advanceMonsterStatuses(target, 2_000);
    applyBulletStatuses(target, state, () => 0.999);
    expect(target.slowRemainingMs).toBe(0);
    expect(target.stunRemainingMs).toBe(500);
    expect(monsterStatusTint(target)).toBe(STUN_TINT);
    advanceMonsterStatuses(target, 500);
    expect(monsterStatusTint(target)).toBeNull();
    expect(monsterMovementSpeed(target)).toBe(target.speed);
  });

  it("preserves the first stun and does not roll or apply an opposing slow", () => {
    const target = monster();
    const state = createPlayerState();
    state.powerups.damage_stun = 20;
    applyBulletStatuses(target, state, () => 0.999);
    advanceMonsterStatuses(target, 200);
    const onlySlow = createPlayerState();
    onlySlow.powerups.damage_slow = 20;
    applyBulletStatuses(target, onlySlow, () => { throw new Error("opposing slow must not roll"); });
    expect(target.stunRemainingMs).toBe(300);
    expect(target.slowRemainingMs).toBe(0);
    state.powerups.damage_slow = 20;
    const refresh = vi.fn(() => 0);
    applyBulletStatuses(target, state, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(target.stunRemainingMs).toBe(500);
    expect(target.slowRemainingMs).toBe(0);
    expect(monsterStatusTint(target)).toBe(STUN_TINT);
    advanceMonsterStatuses(target, 500);
    applyBulletStatuses(target, onlySlow, () => 0);
    expect(target.slowRemainingMs).toBe(2_000);
    expect(target.stunRemainingMs).toBe(0);
  });

  it("selects only one effect when both proc on the same hit", () => {
    const state = createPlayerState();
    state.powerups = { damage_slow: 1, damage_stun: 1 };
    for (const choice of [0.1, 0.9]) {
      const target = monster();
      const rolls = [0, 0, choice];
      applyBulletStatuses(target, state, () => rolls.shift()!);
      expect(target.slowRemainingMs).toBe(choice < 0.5 ? 2_000 : 0);
      expect(target.stunRemainingMs).toBe(choice < 0.5 ? 0 : 500);
    }
  });

  it("pauses boss attack, special and charge clocks during a stun without changing base speed", () => {
    const target = monster();
    Object.assign(target, { stunRemainingMs: 500, lastAttackAt: 100,
      nextSpecialAt: 600, nextVolleyAt: 700, chargeUntil: 800, chargeWindupUntil: 300, chargeRecoverUntil: 900 });
    const speed = target.speed;
    advanceMonsterStatuses(target, 0);
    expect(target.stunRemainingMs).toBe(500);
    advanceMonsterStatuses(target, 400);
    expect(target).toMatchObject({ stunRemainingMs: 100, nextSpecialAt: 1_000, nextVolleyAt: 1_100, chargeUntil: 1_200 });
    advanceMonsterStatuses(target, 800);
    expect(target).toMatchObject({ stunRemainingMs: 0, slowRemainingMs: 0, lastAttackAt: 600,
      nextSpecialAt: 1_100, chargeWindupUntil: 800, chargeRecoverUntil: 1_400 });
    expect(target.speed).toBe(speed);
  });

  it("does not roll without upgrades or on corpses and caps proc chance at 100%", () => {
    const target = monster();
    const state = createPlayerState();
    const noRoll = () => { throw new Error("must not roll"); };
    applyBulletStatuses(target, state, noRoll);
    state.powerups = { damage_slow: 100, damage_stun: 100 };
    applyBulletStatuses(target, state, () => 0.999);
    expect(target.stunRemainingMs).toBe(500);
    target.dead = true;
    applyBulletStatuses(target, state, noRoll);
    advanceMonsterStatuses(target, 1);
    expect(target.stunRemainingMs).toBe(0);
    expect(monsterStatusTint(target)).toBeNull();
  });
});

describe("bonus loot", () => {
  it("rolls occurrence independently, then includes ordinary items, rare weapons and powerups for monsters and scenery", () => {
    const target = monster();
    const prop = { id: "prop", roomId: 0, kind: "crate", definitionId: "test-crate", x: 0, y: 0 } as Decoration;
    for (const source of [target, prop]) {
      expect(bonusLootDrop(source, "floor", 0)).toBeNull();
      const candidates = Array.from({ length: 10_000 }, (_, index) => ({ ...source, id: `source-${index}` }));
      const occasional = candidates.map(item => bonusLootDrop(item, "floor", 1)).filter(item => item !== null);
      expect(occasional.length).toBeGreaterThan(400);
      expect(occasional.length).toBeLessThan(600);
      const guaranteed = candidates.map(item => bonusLootDrop(item, "floor", 20)!);
      const kinds = new Set(guaranteed.map(item => item.kind));
      expect(kinds).toEqual(new Set(["credit", "energy", "core", "medkit", "crystal", "weapon", "powerup"]));
      for (const kind of ["weapon", "powerup"] as const) {
        const rare = guaranteed.filter(item => item.kind === kind);
        expect(rare.length).toBeGreaterThan(10);
        expect(rare.length).toBeLessThan(100);
        expect(rare.every(item => kind === "weapon" ? item.weapon && item.weaponPlacement === "floor"
          : item.powerup && item.powerupPlacement === "floor")).toBe(true);
      }
      expect(bonusLootDrop(source, "floor", 100)).toEqual(bonusLootDrop(source, "floor", 20));
      expect(bonusLootDrop(source, "floor", 20)!.id).not.toBe(bonusLootDrop(source, "other-floor", 20)!.id);
    }
  });
});
