import { describe, expect, it } from "vitest";
import {
  bossChargeCooldown,
  bossChargeSpeedMultiplier,
  bossRangedMovement,
  bossRingCooldown,
  bossRingProjectiles,
  bossStage,
  bossStageCooldown,
  bossSummonAliveLimit,
  bossSummonCooldown,
  bossSummonCount,
  bossTeleportCandidates,
  bossTeleportCooldown,
  bossTeleportDestination,
  bossVolleyProjectiles,
  hy4RingCooldown,
  kimiSpiralCooldown,
} from "../../src/client/domain/boss-attacks";
import { bossCrushedScenery } from "../../src/client/domain/combat";
import { world } from "../../src/client/config";
import type { BossKind } from "../../src/client/types";

const aim = { x: 1, y: 0 };
const volley = (kind: BossKind, stage: 1 | 2 | 3, sequence = 0) =>
  bossVolleyProjectiles(kind, stage, sequence, aim);
const angles = (kind: BossKind, stage: 1 | 2 | 3, sequence = 0) =>
  volley(kind, stage, sequence).map(shot => Math.atan2(shot.direction.y, shot.direction.x));

describe("boss attacks", () => {
  it("switches at each HP third and modestly accelerates as stages progress", () => {
    expect([90, 61, 60, 31, 30, 1].map(hp => bossStage(hp, 90)))
      .toEqual([1, 1, 2, 2, 3, 3]);
    expect([1, 2, 3].map(stage => bossStageCooldown(2_000, stage as 1 | 2 | 3)))
      .toEqual([2_000, 1_800, 1_640]);
  });

  it("makes GLM's rotating rings denser, its charges faster and both attacks more frequent", () => {
    expect(([1, 2, 3] as const).map(stage => volley("glm-hunter", stage).length))
      .toEqual([8, 10, 12]);
    expect(angles("glm-hunter", 3, 1)).not.toEqual(angles("glm-hunter", 3, 0));
    expect(([1, 2, 3] as const).map(bossRingCooldown)).toEqual([3_600, 2_700, 2_000]);
    expect(([1, 2, 3] as const).map(bossChargeCooldown)).toEqual([4_200, 3_100, 2_300]);
    expect(([1, 2, 3] as const).map(bossChargeSpeedMultiplier)).toEqual([4.4, 5.2, 6]);
  });

  it("widens Hy4's 3/5/7 aimed waves and interleaves occasional rings", () => {
    const spreads = ([1, 2, 3] as const).map(stage => {
      const shots = volley("hy4-wave", stage);
      expect(shots).toHaveLength(stage * 2 + 1);
      expect(shots.every(shot => shot.direction.x > 0)).toBe(true);
      return Math.max(...angles("hy4-wave", stage)) - Math.min(...angles("hy4-wave", stage));
    });
    expect(spreads[0]).toBeLessThan(spreads[1]!);
    expect(spreads[1]).toBeLessThan(spreads[2]!);
    expect(([1, 2, 3] as const).map(stage => bossRingProjectiles("hy4-wave", stage, 0).length))
      .toEqual([10, 12, 14]);
    expect(([1, 2, 3] as const).map(hy4RingCooldown)).toEqual([7_200, 5_400, 4_000]);
    expect(bossRingProjectiles("hy4-wave", 2, 0)).not.toEqual(bossRingProjectiles("hy4-wave", 2, 1));
  });

  it("keeps Hy4 circling at range, retreating nearby and approaching when far away", () => {
    const boss = { x: 0, y: 0 };
    expect(bossRangedMovement("hy4-wave", boss, { x: world(150), y: 0 }, 0, 0)[0]!.x).toBe(-1);
    expect(bossRangedMovement("hy4-wave", boss, { x: world(650), y: 0 }, 0, 0)[0]!.x).toBe(1);
    const orbit = bossRangedMovement("hy4-wave", boss, { x: world(410), y: 0 }, 0, 0)[0]!;
    expect(Math.abs(orbit.x)).toBe(0);
    expect(Math.abs(orbit.y)).toBe(1);
    expect(bossRangedMovement("hy4-wave", boss, { x: world(410), y: 0 }, 4_000, 0)[0]!.y)
      .toBe(-orbit.y);
  });

  it("lets Kimi roam periodically without stopping its evasive retreat when crowded", () => {
    const boss = { x: 0, y: 0 };
    expect(bossRangedMovement("kimi-spiral", boss, { x: world(350), y: 0 }, 0, 0)).toHaveLength(2);
    expect(bossRangedMovement("kimi-spiral", boss, { x: world(350), y: 0 }, 2_500, 0)).toEqual([]);
    expect(bossRangedMovement("kimi-spiral", boss, { x: world(180), y: 0 }, 2_500, 0)[0]!.x)
      .toBe(-1);
  });

  it("summons one DeepSeek minion per fast stage-scaled interval up to 3/5/7 live minions", () => {
    expect([1, 2, 3].map(stage => volley("deepseek-summoner", stage as 1 | 2 | 3).length))
      .toEqual([1, 2, 3]);
    expect(([1, 2, 3] as const).map(bossSummonAliveLimit)).toEqual([3, 5, 7]);
    expect(([1, 2, 3] as const).map(stage => bossSummonCount(stage, 0))).toEqual([1, 1, 1]);
    expect(bossSummonCount(1, 1)).toBe(1);
    expect(bossSummonCount(2, 3)).toBe(1);
    expect(bossSummonCount(3, 5)).toBe(1);
    expect(bossSummonCount(1, 3)).toBe(0);
    expect(bossSummonCount(2, 5)).toBe(0);
    expect(bossSummonCount(3, 7)).toBe(0);
    expect(([1, 2, 3] as const).map(bossSummonCooldown)).toEqual([2_000, 1_500, 1_100]);
  });

  it("makes Kimi's continuous rotating spiral denser and faster each stage", () => {
    expect([1, 2, 3].map(stage => volley("kimi-spiral", stage as 1 | 2 | 3).length))
      .toEqual([2, 2, 3]);
    expect(([1, 2, 3] as const).map(kimiSpiralCooldown)).toEqual([170, 130, 105]);
    const angularSteps = ([1, 2, 3] as const).map(stage =>
      angles("kimi-spiral", stage, 1)[0]! - angles("kimi-spiral", stage, 0)[0]!);
    expect(angularSteps[0]).toBeGreaterThan(angularSteps[1]!);
    expect(angularSteps[1]).toBeGreaterThan(angularSteps[2]!);
  });

  it("teleports more often in later stages and offers separated, rotating positions", () => {
    expect([1, 2, 3].map(stage => bossTeleportCooldown(stage as 1 | 2 | 3)))
      .toEqual([5_000, 3_500, 2_400]);
    const player = { x: 100, y: 200 };
    const candidates = bossTeleportCandidates(player, 0, 320);
    expect(candidates).toHaveLength(16);
    expect(candidates.every(point => Math.hypot(point.x - player.x, point.y - player.y) >= 320))
      .toBe(true);
    expect(bossTeleportCandidates(player, 1, 320)).not.toEqual(candidates);
    expect(bossTeleportCandidates(player, 0, 320)).toEqual(candidates);
  });

  it("fires Qwen's two parallel lines with longer bullet tails each stage", () => {
    for (const stage of [1, 2, 3] as const) {
      const shots = volley("qwen-teleporter", stage);
      expect(shots).toHaveLength((stage + 1) * 2);
      expect(shots.every(shot => shot.direction.x === 1 && shot.direction.y === 0)).toBe(true);
      for (const side of [-world(28), world(28)]) {
        expect(shots.filter(shot => shot.lateralOffset === side).map(shot => shot.forwardOffset))
          .toEqual(Array.from({ length: stage + 1 }, (_, index) => -index * world(38)));
      }
    }
  });

  it("crushes scenery along a boss's swept path but leaves distant or destroyed items intact", () => {
    const scenery = [
      { x: 40, y: 12, footprintRadii: { x: 6, y: 6 }, destructible: true, destroyed: false },
      { x: 70, y: 50, footprintRadii: { x: 6, y: 6 }, destructible: true, destroyed: false },
      { x: 90, y: 0, footprintRadii: { x: 6, y: 6 }, destructible: true, destroyed: true },
      { x: 20, y: 0, footprintRadii: { x: 6, y: 6 }, destructible: false, destroyed: false },
    ];
    expect(bossCrushedScenery({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, scenery))
      .toEqual([scenery[0]]);
    expect(bossCrushedScenery({ x: 100, y: 0 }, { x: 100, y: 0 }, 10, scenery)).toEqual([]);
  });

  it("sweeps elliptical footprints without skipping scenery between charge endpoints", () => {
    const near = { x: 50, y: 18,
      footprintRadii: { x: 4, y: 16 }, destructible: true, destroyed: false };
    const far = { ...near, y: 22 };
    expect(bossCrushedScenery({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 8, y: 4 }, [near, far]))
      .toEqual([near]);
  });

  it("skips blocked teleports and prefers a visible safe landing", () => {
    const player = { x: 100, y: 200 };
    const candidates = bossTeleportCandidates(player, 2, 320);
    expect(bossTeleportDestination(player, 2, 320, () => false, () => true)).toBeUndefined();
    const isClear = (point: typeof player) => [candidates[1], candidates[3]]
      .some(candidate => candidate!.x === point.x && candidate!.y === point.y);
    const canSeePlayer = (point: typeof player) =>
      point.x === candidates[3]!.x && point.y === candidates[3]!.y;
    expect(bossTeleportDestination(player, 2, 320, isClear, canSeePlayer)).toEqual(candidates[3]);
    expect(bossTeleportDestination(player, 2, 320, isClear, () => false)).toEqual(candidates[1]);
  });
});
