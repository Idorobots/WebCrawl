import type { Monster } from "../types";
import { powerupChance, type PlayerState } from "./powerups";

export const SLOW_DURATION_MS = 2_000;
export const STUN_DURATION_MS = 500;
export const SLOW_TINT = 0x4d8dff;
export const STUN_TINT = 0xb0b0b0;

export function applyBulletStatuses(monster: Monster, state: PlayerState, random = Math.random): void {
  if (monster.dead) return;
  const slow = powerupChance(state.powerups.damage_slow ?? 0, 0.05);
  const stun = powerupChance(state.powerups.damage_stun ?? 0, 0.05);
  // The first active effect owns the target until expiry. Only that same effect may refresh.
  if ((monster.stunRemainingMs ?? 0) > 0) {
    if (stun && random() < stun) monster.stunRemainingMs = STUN_DURATION_MS;
    return;
  }
  if ((monster.slowRemainingMs ?? 0) > 0) {
    if (slow && random() < slow) monster.slowRemainingMs = SLOW_DURATION_MS;
    return;
  }
  const applySlow = slow > 0 && random() < slow;
  const applyStun = stun > 0 && random() < stun;
  if (!applySlow && !applyStun) return;
  // Simultaneous procs have no earlier effect: choose one without permanently favoring a powerup.
  if (applyStun && (!applySlow || random() >= 0.5)) {
    monster.stunRemainingMs = STUN_DURATION_MS;
    monster.slowRemainingMs = 0;
  } else {
    monster.slowRemainingMs = SLOW_DURATION_MS;
    monster.stunRemainingMs = 0;
  }
}

/** Only active gameplay advances status clocks. Freeze pending attacks/charges during a stun. */
export function advanceMonsterStatuses(monster: Monster, elapsedMs: number): void {
  if (monster.dead) {
    monster.slowRemainingMs = monster.stunRemainingMs = 0;
    return;
  }
  const elapsed = Math.max(0, elapsedMs);
  const stunnedMs = Math.min(monster.stunRemainingMs ?? 0, elapsed);
  if (stunnedMs > 0) {
    for (const field of [
      "lastAttackAt", "attackWarmupUntil", "nextSpecialAt", "nextVolleyAt",
      "chargeWindupUntil", "chargeUntil", "chargeRecoverUntil",
    ] as const) {
      if (monster[field] !== undefined) monster[field] += stunnedMs;
    }
  }
  monster.slowRemainingMs = Math.max(0, (monster.slowRemainingMs ?? 0) - elapsed);
  monster.stunRemainingMs = Math.max(0, (monster.stunRemainingMs ?? 0) - elapsed);
}

export function monsterMovementSpeed(monster: Monster): number {
  return monster.speed * ((monster.slowRemainingMs ?? 0) > 0 ? 0.5 : 1);
}

export function monsterStatusTint(monster: Monster): number | null {
  if (monster.dead) return null;
  if ((monster.stunRemainingMs ?? 0) > 0) return STUN_TINT;
  return (monster.slowRemainingMs ?? 0) > 0 ? SLOW_TINT : null;
}
