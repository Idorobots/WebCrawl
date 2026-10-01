import type { BossKind, Point } from "../types";

export type BossStage = 1 | 2 | 3;

export interface BossProjectile {
  direction: Point;
  lateralOffset?: number;
  forwardOffset?: number;
}

export function bossStage(hp: number, maxHp: number): BossStage {
  if (hp <= maxHp / 3) return 3;
  if (hp <= maxHp * 2 / 3) return 2;
  return 1;
}

export function bossStageCooldown(baseMs: number, stage: BossStage): number {
  return Math.round(baseMs * [1, 0.9, 0.82][stage - 1]!);
}

export function bossTeleportCooldown(stage: BossStage): number {
  return [3_000, 2_400, 1_600][stage - 1]!;
}

export function bossRingCooldown(stage: BossStage): number {
  return [3_600, 2_700, 2_000][stage - 1]!;
}

export function hy4RingCooldown(stage: BossStage): number {
  return bossRingCooldown(stage) * 2;
}

export function bossChargeCooldown(stage: BossStage): number {
  return [4_500, 3_000, 1_500][stage - 1]!;
}

export function bossChargeDuration(stage: BossStage): number {
  return [450, 350, 250][stage - 1]!;
}

export function bossChargeSpeedMultiplier(stage: BossStage): number {
  return [3, 4, 5][stage - 1]!;
}

export function kimiSpiralCooldown(stage: BossStage): number {
  return [200, 160, 120][stage - 1]!;
}

export function bossSummonAliveLimit(stage: BossStage): number {
  return [3, 5, 7][stage - 1]!;
}

export function bossSummonCount(stage: BossStage, alive: number): number {
  return alive < bossSummonAliveLimit(stage) ? 1 : 0;
}

export function bossSummonCooldown(stage: BossStage): number {
  return [3_000, 2_000, 1_000][stage - 1]!;
}

/** Ordered, deterministic candidates around the player; callers reject obstructed or occupied points. */
export function bossTeleportCandidates(player: Point, sequence: number, distance: number): Point[] {
  return [1, 1.4].flatMap(scale => Array.from({ length: 8 }, (_, index) => {
    const angle = sequence * 1.13 + index * Math.PI / 4;
    return {
      x: player.x + Math.cos(angle) * distance * scale,
      y: player.y + Math.sin(angle) * distance * scale,
    };
  }));
}

export function bossTeleportDestination(
  player: Point,
  sequence: number,
  distance: number,
  isClear: (point: Point) => boolean,
  hasSight: (point: Point) => boolean,
): Point | undefined {
  const valid = bossTeleportCandidates(player, sequence, distance).filter(isClear);
  return valid.find(hasSight) ?? valid[0];
}

function rotate(direction: Point, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: direction.x * cosine - direction.y * sine,
    y: direction.x * sine + direction.y * cosine,
  };
}

function fan(aimed: Point, count: number, spacing: number): BossProjectile[] {
  return Array.from({ length: count }, (_, index) => ({
    direction: rotate(aimed, (index - (count - 1) / 2) * spacing),
  }));
}

function ring(count: number, rotation: number): BossProjectile[] {
  return Array.from({ length: count }, (_, index) => ({
    direction: { x: Math.cos(rotation + index * Math.PI * 2 / count), y: Math.sin(rotation + index * Math.PI * 2 / count) },
  }));
}

export function bossRingProjectiles(stage: BossStage, sequence: number): BossProjectile[] {
  return ring(8 + stage * 2, sequence * 0.23);
}

/** Prefer retreat/approach outside the firing band, and orbit within it. Kimi pauses between short walks. */
export function bossRangedMovement(
  kind: "kimi-spiral" | "hy4-wave",
  boss: Point,
  player: Point,
  timestamp: number,
  seed: number,
): Point[] {
  const dx = player.x - boss.x;
  const dy = player.y - boss.y;
  const distance = Math.hypot(dx, dy);
  const toward = distance > 0 ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
  const side = Math.floor((timestamp + seed % 3_000) / 4_000) % 2 === 0 ? 1 : -1;
  const tangent = { x: -toward.y * side, y: toward.x * side };
  const otherTangent = { x: -tangent.x, y: -tangent.y };
  const near = kind === "hy4-wave" ? 340 : 260;
  const far = kind === "hy4-wave" ? 510 : 450;
  if (distance < near) return [{ x: -toward.x, y: -toward.y }, tangent, otherTangent];
  if (kind === "kimi-spiral" && (timestamp + seed % 3_000) % 3_000 >= 2_000) return [];
  if (distance > far) return [toward, tangent, otherTangent];
  return [tangent, otherTangent];
}

/** Qwen's two parallel lanes have a longer tail at each stage. */
function doubleLines(aimed: Point, stage: BossStage): BossProjectile[] {
  return [-1, 1].flatMap(lane => Array.from({ length: stage }, (_, index) => ({
    direction: aimed,
    lateralOffset: lane * 28,
    forwardOffset: -index * 38,
  })));
}

/** Kimi builds a continuous rotating spiral over successive shots. */
export function bossVolleyProjectiles(
  kind: BossKind,
  stage: BossStage,
  sequence: number,
  aimed: Point,
): BossProjectile[] {
  if (kind === "deepseek-summoner") return fan(aimed, stage, 0.25);
  if (kind === "qwen-teleporter") return doubleLines(aimed, stage);
  if (kind === "glm-hunter") return bossRingProjectiles(stage, sequence);
  if (kind === "hy4-wave") return fan(aimed, stage * 2 + 1, [0.22, 0.20, 0.18][stage - 1]!);

  const rotation = sequence * [0.55, 0.40, 0.28][stage - 1]!;
  return ring(stage === 3 ? 3 : 2, rotation);
}
