import { describe, expect, it } from "vitest";
import {
  bossStage,
  bossStageCooldown,
  bossVolleyProjectiles,
} from "../../src/client/domain/boss-attacks";
import type { BossKind } from "../../src/client/types";

const aim = { x: 1, y: 0 };
const volley = (kind: BossKind, stage: 1 | 2 | 3, sequence = 0) =>
  bossVolleyProjectiles(kind, stage, sequence, aim, 1, 16);

describe("boss stages", () => {
  it("switches at each HP third, including the exact thresholds", () => {
    expect(bossStage(90, 90)).toBe(1);
    expect(bossStage(61, 90)).toBe(1);
    expect(bossStage(60, 90)).toBe(2);
    expect(bossStage(31, 90)).toBe(2);
    expect(bossStage(30, 90)).toBe(3);
    expect(bossStage(1, 90)).toBe(3);
  });

  it("accelerates both regular and special attacks as stages progress", () => {
    expect([1, 2, 3].map(stage => bossStageCooldown(1_000, stage as 1 | 2 | 3)))
      .toEqual([1_000, 820, 650]);
    expect([1, 2, 3].map(stage => bossStageCooldown(2_000, stage as 1 | 2 | 3)))
      .toEqual([2_000, 1_640, 1_300]);
  });

  it("turns Packet Storm's alternating ring and aimed fan into a layered lattice", () => {
    expect(volley("packet-storm", 1)).toHaveLength(11);
    expect(volley("packet-storm", 1, 1)).toHaveLength(5);
    expect(volley("packet-storm", 2)).toHaveLength(18);
    expect(volley("packet-storm", 3)).toHaveLength(36);
    expect(volley("packet-storm", 3).some(shot => shot.direction.x < -0.9)).toBe(true);
    expect(volley("packet-storm", 3).some(shot => shot.direction.x > 0.9)).toBe(true);
  });

  it("splits Fork Bomb's fan into three distinct aimed branches", () => {
    expect(volley("fork-bomb", 1)).toHaveLength(3);
    expect(volley("fork-bomb", 2)).toHaveLength(7);
    const branches = volley("fork-bomb", 3);
    expect(branches).toHaveLength(9);
    expect(branches.some(shot => shot.direction.y < -0.4)).toBe(true);
    expect(branches.some(shot => Math.abs(shot.direction.y) < 0.01)).toBe(true);
    expect(branches.some(shot => shot.direction.y > 0.4)).toBe(true);
  });

  it("layers Titan shockwaves and gives Kimi counter-rotating spirals", () => {
    expect([1, 2, 3].map(stage => volley("heap-titan", stage as 1 | 2 | 3).length))
      .toEqual([12, 19, 35]);
    expect([1, 2, 3].map(stage => volley("kimi-swarm", stage as 1 | 2 | 3).length))
      .toEqual([5, 13, 32]);
    expect(volley("kimi-swarm", 3, 1)).not.toEqual(volley("kimi-swarm", 3, 2));
    expect(volley("heap-titan", 3).some(shot => shot.direction.x < -0.9)).toBe(true);
  });

  it("turns Llama Herd's straight lanes into crossing stampede lanes", () => {
    expect([1, 2, 3].map(stage => volley("llama-herd", stage as 1 | 2 | 3).length))
      .toEqual([3, 9, 23]);
    expect(volley("llama-herd", 1).map(shot => shot.lateralOffset)).toEqual([-16, 0, 16]);
    expect(volley("llama-herd", 2).some(shot => shot.direction.y !== 0)).toBe(true);
    expect(volley("llama-herd", 3).some(shot => shot.direction.x < 0)).toBe(true);
  });
});
