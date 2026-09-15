import type { RunStats } from "../types";

export interface LootInventory {
  credits: number;
  crystals: number;
  cores: number;
  medkits: number;
}

export const SCORE_VALUES = {
  credit: 100,
  crystal: 1_000,
  fastKill: 100,
  slowKill: 150,
  sentryKill: 300,
  bossKill: 3_000,
} as const;

export function scoredLootCount(inventory: LootInventory): number {
  return inventory.credits + inventory.crystals;
}

export function scoreForRun(inventory: LootInventory, stats: RunStats): number {
  return (
    inventory.credits * SCORE_VALUES.credit +
    inventory.crystals * SCORE_VALUES.crystal +
    stats.fastKills * SCORE_VALUES.fastKill +
    stats.slowKills * SCORE_VALUES.slowKill +
    (stats.sentryKills ?? 0) * SCORE_VALUES.sentryKill +
    (stats.bossKills ?? 0) * SCORE_VALUES.bossKill
  );
}

export function timedShieldState(
  activeUntil: number,
  now: number,
  blinkStartMs: number,
): { active: boolean; tintVisible: boolean } {
  const remaining = activeUntil - now;
  if (remaining <= 0) return { active: false, tintVisible: false };
  return {
    active: true,
    tintVisible: remaining > blinkStartMs || Math.floor(remaining / 220) % 2 === 0,
  };
}
