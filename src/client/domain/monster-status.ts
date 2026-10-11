import type { Monster } from "../types";
import { powerupChance, type PlayerState } from "./powerups";

export const SLOW_DURATION_MS = 2_000;
export const STUN_DURATION_MS = 500;
/** While slowed, movement and the ability/cooldown clocks run at this fraction of normal speed. */
export const SLOW_SPEED_FACTOR = 0.5;
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

/** Guaranteed stun from a direct hit (e.g. Regulatory Capture); replaces any active slow. */
export function stunMonster(monster: Monster, durationMs: number): void {
  if (monster.dead) return;
  monster.stunRemainingMs = durationMs;
  monster.slowRemainingMs = 0;
}

/** Only active gameplay advances status clocks. Freeze pending attacks/charges during a stun. */
export function advanceMonsterStatuses(monster: Monster, elapsedMs: number): void {
  if (monster.dead) {
    monster.slowRemainingMs = monster.stunRemainingMs = 0;
    return;
  }
  const elapsed = Math.max(0, elapsedMs);
  const stunnedMs = Math.min(monster.stunRemainingMs ?? 0, elapsed);
  const slowedMs = Math.min(monster.slowRemainingMs ?? 0, elapsed);
  // Stun freezes the ability clocks; slow runs them at SLOW_SPEED_FACTOR, which
  // extends every attack, special and charge cooldown without touching its base value.
  const cooldownShift = stunnedMs + slowedMs * (1 - SLOW_SPEED_FACTOR);
  if (cooldownShift > 0) {
    for (const field of [
      "lastAttackAt", "attackWarmupUntil", "nextSpecialAt", "nextVolleyAt",
      "chargeWindupUntil", "chargeUntil", "chargeRecoverUntil",
    ] as const) {
      if (monster[field] !== undefined) monster[field] += cooldownShift;
    }
  }
  monster.slowRemainingMs = Math.max(0, (monster.slowRemainingMs ?? 0) - elapsed);
  monster.stunRemainingMs = Math.max(0, (monster.stunRemainingMs ?? 0) - elapsed);
}

export function monsterMovementSpeed(monster: Monster): number {
  return monster.speed * ((monster.slowRemainingMs ?? 0) > 0 ? SLOW_SPEED_FACTOR : 1);
}

export function monsterStatusTint(monster: Monster): number | null {
  if (monster.dead) return null;
  if ((monster.stunRemainingMs ?? 0) > 0) return STUN_TINT;
  return (monster.slowRemainingMs ?? 0) > 0 ? SLOW_TINT : null;
}
