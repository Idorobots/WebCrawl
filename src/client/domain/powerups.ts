import { POWERUP_ASSETS } from "../config";
import type { PowerupKind, WeaponSpec } from "../types";
import { stableHash } from "./hash";
import { REGULAR_MONSTER_WEAPON_DROP_CHANCE_PER_10K } from "./weapons";
import { CRYSTAL_INVULNERABILITY_DURATION_MS, PLAYER_ENERGY_MAX, PLAYER_SPEC } from "./world-specs";

export const POWERUP_DEFINITIONS: Readonly<Record<PowerupKind, { name: string; asset: string; color: number }>> = {
  health: { name: "Higher Valuation", asset: POWERUP_ASSETS.health, color: 0xff315c },
  energy: { name: "The End is nigh", asset: POWERUP_ASSETS.energy, color: 0x20caff },
  damage: { name: "Context utilization", asset: POWERUP_ASSETS.damage, color: 0xcb36ff },
  movement_speed: { name: "Lower Latency", asset: POWERUP_ASSETS.movement_speed, color: 0xffb52e },
  shot_speed: { name: "Tok/s", asset: POWERUP_ASSETS.shot_speed, color: 0xff8a23 },
  health_regen: { name: "Vesting", asset: POWERUP_ASSETS.health_regen, color: 0xff477a },
  energy_regen: { name: "Model training", asset: POWERUP_ASSETS.energy_regen, color: 0x36caff },
  ammo_regen: { name: "Quota Reset", asset: POWERUP_ASSETS.ammo_regen, color: 0xffc33d },
  extra_ram: { name: "DDR", asset: POWERUP_ASSETS.extra_ram, color: 0x25d5ff },
  extra_crystal: { name: "Campaign Contribution", asset: POWERUP_ASSETS.extra_crystal, color: 0x28ed97 },
  critical_damage: { name: "Trust me bro benchmark", asset: POWERUP_ASSETS.critical_damage, color: 0xff303f },
};

export const POWERUP_KINDS = Object.keys(POWERUP_DEFINITIONS) as PowerupKind[];
export const REGEN_INTERVAL_MS = 10_000;
export const MINIBOSS_POWERUP_CHANCE_PER_10K = 50;
export const REGULAR_MONSTER_POWERUP_CHANCE_PER_10K = REGULAR_MONSTER_WEAPON_DROP_CHANCE_PER_10K;

type RegenKind = "health_regen" | "energy_regen" | "ammo_regen";

export interface PlayerState {
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  damageMultiplier: number;
  shotRateMultiplier: number;
  walkSpeedMultiplier: number;
  criticalChance: number;
  aimAid: number;
  powerups: Partial<Record<PowerupKind, number>>;
  regenElapsedMs: Record<RegenKind, number>;
  ammoRegenRemainder: number;
}

export function createPlayerState(mobile = false, maxHp: number = PLAYER_SPEC.maxHp): PlayerState {
  return {
    hp: maxHp, maxHp, energy: 0, maxEnergy: PLAYER_ENERGY_MAX,
    damageMultiplier: 1, shotRateMultiplier: 1, walkSpeedMultiplier: 1,
    criticalChance: 0, aimAid: mobile ? 0.2 : 0,
    powerups: {}, regenElapsedMs: { health_regen: 0, energy_regen: 0, ammo_regen: 0 },
    ammoRegenRemainder: 0,
  };
}

export function collectPowerup(state: PlayerState, kind: PowerupKind): void {
  const stacks = (state.powerups[kind] ?? 0) + 1;
  state.powerups[kind] = stacks;
  switch (kind) {
    case "health": state.maxHp += 2; state.hp = Math.min(state.maxHp, state.hp + 2); break;
    case "energy": state.maxEnergy += 2; state.energy = Math.min(state.maxEnergy, state.energy + 2); break;
    case "damage": state.damageMultiplier = 1 + stacks / 10; break;
    case "movement_speed": state.walkSpeedMultiplier = 1 + stacks / 10; break;
    case "shot_speed": state.shotRateMultiplier = 1 + stacks / 10; break;
    case "critical_damage": state.criticalChance = Math.min(1, stacks / 100); break;
  }
}

export function ramPerPickup(state: PlayerState): number {
  return 1 + (state.powerups.extra_ram ?? 0);
}

export function bailoutDurationMs(state: PlayerState): number {
  return CRYSTAL_INVULNERABILITY_DURATION_MS + (state.powerups.extra_crystal ?? 0) * 2_000;
}

export function playerAttackDamage(state: PlayerState, damage: number): number {
  return damage * state.damageMultiplier;
}

/** Bullet damage is already scaled on firing; only the impact's critical roll remains. */
export function criticalBulletDamage(state: PlayerState, damage: number, random = Math.random): number {
  return state.criticalChance > 0 && random() < state.criticalChance ? damage * 3 : damage;
}

/** Call only with active gameplay time, so loading and pauses cannot grant regeneration. */
export function regeneratePlayer(
  state: PlayerState, weapon: WeaponSpec, ammo: number | null, elapsedMs: number,
): { energy: number; ammo: number | null } {
  for (const kind of ["health_regen", "energy_regen", "ammo_regen"] as const) {
    const stacks = state.powerups[kind] ?? 0;
    if (!stacks) continue;
    state.regenElapsedMs[kind] += Math.max(0, elapsedMs);
    const ticks = Math.floor((state.regenElapsedMs[kind] + 1e-7) / REGEN_INTERVAL_MS);
    if (!ticks) continue;
    state.regenElapsedMs[kind] = Math.max(0, state.regenElapsedMs[kind] - ticks * REGEN_INTERVAL_MS);
    if (kind === "health_regen") state.hp = Math.min(state.maxHp, state.hp + ticks * stacks / 10);
    if (kind === "energy_regen") state.energy = Math.min(state.maxEnergy, state.energy + ticks * stacks / 10);
    if (kind === "ammo_regen" && ammo !== null && weapon.maxAmmo !== null) {
      const amount = state.ammoRegenRemainder + weapon.maxAmmo * ticks * stacks / 100;
      const rounds = Math.floor(amount + 1e-7);
      ammo = Math.min(weapon.maxAmmo, ammo + rounds);
      state.ammoRegenRemainder = ammo >= weapon.maxAmmo ? 0 : Math.max(0, amount - rounds);
    }
  }
  return { energy: state.energy, ammo };
}

export function powerupForSeed(seed: number): PowerupKind {
  return POWERUP_KINDS[stableHash(`${seed}|powerup-kind`) % POWERUP_KINDS.length]!;
}

export function monsterDropsPowerup(seed: number, miniboss: boolean): boolean {
  const chance = miniboss ? MINIBOSS_POWERUP_CHANCE_PER_10K : REGULAR_MONSTER_POWERUP_CHANCE_PER_10K;
  return stableHash(`${seed}|monster-powerup-drop`) % 10_000 < chance;
}
