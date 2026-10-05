import { describe, expect, it } from "vitest";
import { artDebugLevel } from "../../src/client/domain/authored-rooms";
import { energyDashPower, steerPlayerBullet } from "../../src/client/domain/combat";
import {
  bossLootDrops, bossSpecForRoom, buildInteractiveObjects, lootKindForSeed,
  monsterLootDropKindForSeed, monsterLootKindForSeed, rewardPedestalForRoom, roomRewardLoot, sceneryDropKindForSeed,
  weaponLootForRoom,
} from "../../src/client/domain/generation";
import {
  bailoutDurationMs, collectPowerup, createPlayerState, criticalBulletDamage,
  monsterDropsPowerup, playerAttackDamage, POWERUP_KINDS, powerupForSeed,
  ramPerPickup, regeneratePlayer,
} from "../../src/client/domain/powerups";
import { buildWallFootprints, WallRectIndex } from "../../src/client/domain/wall-collision";
import { stableHash } from "../../src/client/domain/hash";
import { DEFAULT_WEAPON, projectilesForWeapon, weaponForKind } from "../../src/client/domain/weapons";
import { LOOT_DEFINITIONS } from "../../src/client/domain/world-specs";
import type { Bullet, GraphNode } from "../../src/client/types";

const room: GraphNode = {
  ...artDebugLevel().layout.nodes[0]!, tag: "article", isRoot: false, width: 512, height: 512,
  x: 0, y: 0, isHidden: false, lootSeed: 0,
};
const layout = { nodes: [room], links: [], hiddenCount: 0 };
const walls = new WallRectIndex(buildWallFootprints(layout));

describe("player power-ups", () => {
  it("starts neutral on desktop and enables gentle mobile aim aid", () => {
    expect(createPlayerState()).toMatchObject({
      hp: 10, maxHp: 10, energy: 0, maxEnergy: 10, damageMultiplier: 1,
      shotRateMultiplier: 1, walkSpeedMultiplier: 1, criticalChance: 0, aimAid: 0, powerups: {},
    });
    expect(createPlayerState(true).aimAid).toBe(0.2);
    expect(createPlayerState(false, 1_000).maxHp).toBe(1_000);
    expect(LOOT_DEFINITIONS.powerup.size).toBe(LOOT_DEFINITIONS.crystal.size);
    expect(LOOT_DEFINITIONS.powerup.footprintRadii).toEqual(LOOT_DEFINITIONS.crystal.footprintRadii);
  });

  it("adds capacity and current resources without discarding existing damage or energy usage", () => {
    const state = createPlayerState();
    state.hp = 4.5;
    state.energy = 3.2;
    for (let index = 0; index < 2; index++) {
      collectPowerup(state, "health");
      collectPowerup(state, "energy");
    }
    expect(state.maxHp).toBe(14);
    expect(state.hp).toBe(8.5);
    expect(state.maxEnergy).toBe(14);
    expect(state.energy).toBeCloseTo(7.2);
  });

  it("stacks modifiers additively and scales bullets and Regulatory Capture", () => {
    const state = createPlayerState();
    for (const kind of POWERUP_KINDS) {
      collectPowerup(state, kind);
      collectPowerup(state, kind);
    }
    expect(state.damageMultiplier).toBe(1.2);
    expect(state.shotRateMultiplier).toBe(1.2);
    expect(state.walkSpeedMultiplier).toBe(1.2);
    expect(state.criticalChance).toBe(0.02);
    expect(ramPerPickup(state)).toBe(3);
    expect(bailoutDurationMs(state)).toBe(14_000);
    const projectile = projectilesForWeapon(DEFAULT_WEAPON, { x: 1, y: 0 }, 0)[0]!;
    expect(playerAttackDamage(state, projectile.damage)).toBeCloseTo(projectile.damage * 1.2);
    expect(playerAttackDamage(state, energyDashPower(5).damage)).toBeCloseTo(energyDashPower(5).damage * 1.2);
    expect(projectile.speed).toBe(DEFAULT_WEAPON.projectileSpeed);
    expect(createPlayerState().powerups).toEqual({});
  });

  it("triples scaled bullet damage only on a successful critical roll", () => {
    const state = createPlayerState();
    expect(criticalBulletDamage(state, 2, () => { throw new Error("zero chance must not roll"); })).toBe(2);
    collectPowerup(state, "critical_damage");
    collectPowerup(state, "damage");
    const damage = playerAttackDamage(state, 2);
    expect(criticalBulletDamage(state, damage, () => 0.009)).toBeCloseTo(6.6);
    expect(criticalBulletDamage(state, damage, () => 0.01)).toBeCloseTo(2.2);
    for (let index = 0; index < 110; index++) collectPowerup(state, "critical_damage");
    expect(state.criticalChance).toBe(1);
    expect(criticalBulletDamage(state, damage, () => 0.999)).toBeCloseTo(6.6);
  });

  it("regenerates on ten-second active intervals, stacks amounts and clamps at dynamic caps", () => {
    const state = createPlayerState();
    state.hp = 8;
    state.energy = 5;
    regeneratePlayer(state, DEFAULT_WEAPON, null, 30_000);
    collectPowerup(state, "health_regen");
    collectPowerup(state, "energy_regen");
    let resources = regeneratePlayer(state, DEFAULT_WEAPON, null, 9_999);
    expect(state.hp).toBe(8);
    expect(resources.energy).toBe(5);
    resources = regeneratePlayer(state, DEFAULT_WEAPON, null, 1);
    expect(state.hp).toBeCloseTo(8.1);
    expect(resources.energy).toBeCloseTo(5.1);
    collectPowerup(state, "health_regen");
    collectPowerup(state, "energy_regen");
    resources = regeneratePlayer(state, DEFAULT_WEAPON, null, 10_000);
    expect(state.hp).toBeCloseTo(8.3);
    expect(resources.energy).toBeCloseTo(5.3);
    collectPowerup(state, "health");
    collectPowerup(state, "energy");
    state.hp = 11.95;
    state.energy = 11.95;
    resources = regeneratePlayer(state, DEFAULT_WEAPON, null, 10_000);
    expect(state.hp).toBe(12);
    expect(resources.energy).toBe(12);
  });

  it("carries fractional ammo regeneration into whole rounds and never banks over capacity", () => {
    const state = createPlayerState();
    collectPowerup(state, "ammo_regen");
    const weapon = weaponForKind("packet-lobber");
    expect(weapon.maxAmmo).toBe(30);
    let resources = regeneratePlayer(state, weapon, 10, 30_000);
    expect(resources.ammo).toBe(10);
    resources = regeneratePlayer(state, weapon, resources.ammo, 10_000);
    expect(resources.ammo).toBe(11);
    expect(state.ammoRegenRemainder).toBeCloseTo(0.2);
    collectPowerup(state, "ammo_regen");
    resources = regeneratePlayer(state, weapon, 29, 20_000);
    expect(resources.ammo).toBe(30);
    expect(state.ammoRegenRemainder).toBe(0);
    expect(regeneratePlayer(state, DEFAULT_WEAPON, null, 50_000).ammo).toBeNull();
  });
});

describe("bullet aim aid", () => {
  const bullet = (): Bullet => ({
    id: "test", owner: "player", x: 0, y: 0, vx: 500, vy: 0, damage: 1, traveled: 0, depthOffsetY: 0,
  });

  it("turns gently toward the closest target to the bullet while retaining speed", () => {
    const shot = bullet();
    shot.x = 1_000;
    steerPlayerBullet(shot, [{ x: 0, y: -50 }, { x: 1_100, y: 100 }], 0.2, 0.1);
    expect(shot.vy).toBeGreaterThan(0);
    expect(Math.atan2(shot.vy, shot.vx)).toBeCloseTo(0.2 * Math.PI * 0.1);
    expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(500);
  });

  it("preserves trajectories at zero aid, without enemies, and for enemy bullets", () => {
    for (const [owner, aid, targets] of [
      ["player", 0, [{ x: 0, y: 100 }]], ["player", 0.2, []], ["enemy", 0.2, [{ x: 0, y: 100 }]],
    ] as const) {
      const shot = { ...bullet(), owner };
      steerPlayerBullet(shot, targets, aid, 0.1);
      expect(shot).toEqual({ ...bullet(), owner });
    }
  });

  it("ignores dead and inactive monsters and aims at living monster hitbox centers", () => {
    const monster = bossSpecForRoom({ ...room, tag: "script", isBossArena: true }, 1);
    const alive = { ...monster, active: true, dead: false, x: 100, y: 200 };
    const shot = bullet();
    steerPlayerBullet(shot, [
      { ...monster, active: true, dead: true, x: 0, y: 0 },
      { ...monster, active: false, dead: false, x: 10, y: 0 },
      alive,
    ], 0.2, 0.1);
    expect(shot.vy).toBeGreaterThan(0);
    expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(500);
  });

  it("uses elapsed time rather than the number of updates", () => {
    const once = bullet();
    const split = bullet();
    const targets = [{ x: 100, y: 100 }];
    steerPlayerBullet(once, targets, 0.2, 0.1);
    for (let index = 0; index < 10; index++) steerPlayerBullet(split, targets, 0.2, 0.01);
    expect(split.vx).toBeCloseTo(once.vx);
    expect(split.vy).toBeCloseTo(once.vy);
  });
});

describe("power-up loot generation", () => {
  it.each([
    { tag: "article", isHidden: false, chance: 0.1 },
    { tag: "img", isHidden: false, chance: 0.25 },
    { tag: "article", isHidden: true, chance: 1 },
  ])("shares a single pedestal roll in $tag rooms (hidden: $isHidden)", ({ tag, isHidden, chance }) => {
    const rewards = Array.from({ length: 2_000 }, (_, lootSeed) =>
      roomRewardLoot({ ...room, tag, isHidden, lootSeed }, "floor", walls)).filter(item => item !== null);
    expect(rewards.length / 2_000).toBeCloseTo(chance, 1);
    expect(rewards.filter(item => item.kind === "powerup").length / rewards.length).toBeCloseTo(0.5, 1);
    expect(rewards.every(item => item.kind === "powerup" ? item.powerup && !item.weapon : item.weapon && !item.powerup)).toBe(true);
  });

  it("keeps the reward and pedestal deterministic and prevents recollection on revisits", () => {
    for (let lootSeed = 0; lootSeed < 40; lootSeed++) {
      const candidate = { ...room, isHidden: true, lootSeed };
      const candidateLayout = { ...layout, nodes: [candidate] };
      const reward = roomRewardLoot(candidate, "floor", walls)!;
      expect(roomRewardLoot(candidate, "floor", walls)).toEqual(reward);
      expect(rewardPedestalForRoom(candidate, "floor", walls)).toMatchObject({
        id: `${reward.id}::pedestal`, x: reward.x, y: reward.y, obstacle: false,
      });
      expect(weaponLootForRoom(candidate, "floor", walls)).toEqual(reward.kind === "weapon" ? reward : null);
      const initial = buildInteractiveObjects(candidateLayout, "floor", null, new Set(), walls).loot;
      expect(initial.filter(item => item.kind === "powerup" || item.kind === "weapon")).toEqual([reward]);
      const revisited = buildInteractiveObjects(candidateLayout, "floor", null, new Set([reward.id]), walls).loot;
      expect(revisited.some(item => item.id === reward.id)).toBe(false);
      expect(rewardPedestalForRoom(candidate, "floor", walls)).not.toBeNull();
    }
    expect(roomRewardLoot({ ...room, isRoot: true }, "floor", walls)).toBeNull();
    expect(roomRewardLoot({ ...room, tag: "script" }, "floor", walls)).toBeNull();
  });

  it("excludes power-ups from ordinary loot and permits tiny regular and miniboss drops", () => {
    const seeds = Array.from({ length: 20_000 }, (_, seed) => seed);
    for (const miniboss of [false, true]) {
      const drops = seeds.filter(seed => monsterDropsPowerup(seed, miniboss));
      expect(drops.length / seeds.length).toBeGreaterThan(0.003);
      expect(drops.length / seeds.length).toBeLessThan(0.007);
    }
    expect(seeds.some(seed => monsterLootKindForSeed(seed) === "powerup" || lootKindForSeed(seed) === "powerup" ||
      sceneryDropKindForSeed(seed) === "powerup")).toBe(false);
    expect(new Set(seeds.map(powerupForSeed))).toEqual(new Set(POWERUP_KINDS));
  });

  it("keeps regular weapons, power-ups and crystals equally rare per kill, even without common loot", () => {
    const seeds = Array.from({ length: 50_000 }, (_, index) => stableHash(`rare-drop-${index}`));
    const commonLoot = seeds.map(seed => monsterLootDropKindForSeed(seed, false, true));
    const rareOnly = seeds.map(seed => monsterLootDropKindForSeed(seed, false, false));
    for (const kind of ["weapon", "powerup", "crystal"] as const) {
      expect(rareOnly.filter(drop => drop === kind)).toEqual(commonLoot.filter(drop => drop === kind));
      const rate = rareOnly.filter(drop => drop === kind).length / seeds.length;
      expect(rate).toBeGreaterThan(0.0035);
      expect(rate).toBeLessThan(0.0065);
    }
    expect(rareOnly.every(kind => kind === null || ["weapon", "powerup", "crystal"].includes(kind))).toBe(true);
    expect(commonLoot.some(kind => kind === "medkit")).toBe(true);
    expect(seeds.map(seed => monsterLootDropKindForSeed(seed, false, true))).toEqual(commonLoot);
    const minibossCrystals = seeds.filter(seed => monsterLootKindForSeed(seed, true) === "crystal");
    expect(minibossCrystals.length / seeds.length).toBeGreaterThan(0.04);
    expect(minibossCrystals.length / seeds.length).toBeLessThan(0.06);
  });

  it("guarantees two boss rewards: a weapon and a power-up, or two power-ups", () => {
    const boss = bossSpecForRoom({ ...room, tag: "script", isBossArena: true }, 1);
    const drops = Array.from({ length: 1_000 }, (_, seed) => bossLootDrops({ ...boss, seed }, "floor", 1));
    for (const loot of drops) {
      const special = loot.filter(item => item.kind === "weapon" || item.kind === "powerup");
      expect(special).toHaveLength(2);
      expect(special.filter(item => item.kind === "weapon").length).toBeLessThanOrEqual(1);
      expect(special[1]?.kind).toBe("powerup");
      for (const item of special) {
        expect(item.weaponPlacement ?? item.powerupPlacement).toBe("floor");
        expect(item.weapon ?? item.powerup).toBeDefined();
      }
      expect(new Set(loot.map(item => item.id)).size).toBe(loot.length);
    }
    expect(drops.filter(loot => loot[1]?.kind === "powerup").length / drops.length).toBeCloseTo(0.5, 1);
    expect(bossLootDrops(boss, "floor", 1)).toEqual(bossLootDrops(boss, "floor", 1));
    const relocated = bossLootDrops({ ...boss, seed: 0, dropX: 100, dropY: 200 }, "floor", 1);
    expect(relocated.map(item => item.id)).toEqual(drops[0]!.map(item => item.id));
  });
});
