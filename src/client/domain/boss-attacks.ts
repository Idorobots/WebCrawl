import type { BossKind, Point } from "../types";

export type BossStage = 1 | 2 | 3;

export interface BossProjectile {
  direction: Point;
  lateralOffset?: number;
}

export function bossStage(hp: number, maxHp: number): BossStage {
  if (hp <= maxHp / 3) return 3;
  if (hp <= maxHp * 2 / 3) return 2;
  return 1;
}

export function bossStageCooldown(baseMs: number, stage: BossStage): number {
  return Math.round(baseMs * [1, 0.82, 0.65][stage - 1]!);
}

function rotate(direction: Point, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: direction.x * cosine - direction.y * sine,
    y: direction.x * sine + direction.y * cosine,
  };
}

function fan(aimed: Point, count: number, spacing: number, center = 0): BossProjectile[] {
  return Array.from({ length: count }, (_, index) => ({
    direction: rotate(aimed, center + (index - (count - 1) / 2) * spacing),
  }));
}

function ring(count: number, rotation: number): BossProjectile[] {
  return Array.from({ length: count }, (_, index) => ({
    direction: { x: Math.cos(rotation + index * Math.PI * 2 / count), y: Math.sin(rotation + index * Math.PI * 2 / count) },
  }));
}

/** Deterministic shot geometry: the saved attack sequence also preserves pattern rotation across room reloads. */
export function bossVolleyProjectiles(
  kind: BossKind,
  stage: BossStage,
  sequence: number,
  aimed: Point,
  floor: number,
  laneWidth: number,
): BossProjectile[] {
  if (kind === "packet-storm") {
    const rotation = sequence * 0.19;
    if (stage === 1) return sequence % 2 === 0
      ? ring(10 + Math.min(6, floor), rotation)
      : fan(aimed, 5, 0.14);
    if (stage === 2) return sequence % 2 === 0
      ? [...ring(14 + Math.min(6, floor), rotation), ...fan(aimed, 3, 0.14)]
      : [...ring(9, rotation + 0.15), ...fan(aimed, 7, 0.14)];
    return [
      ...ring(16 + Math.min(6, floor), rotation),
      ...ring(12, rotation + Math.PI / 12),
      ...fan(aimed, 7, 0.13),
    ];
  }

  if (kind === "fork-bomb") {
    if (stage === 1) return fan(aimed, 3, 0.19);
    if (stage === 2) return [
      ...fan(aimed, 5, 0.17),
      ...fan(aimed, 2, 0.12, sequence % 2 ? 0.55 : -0.55),
    ];
    return [
      ...fan(aimed, 3, 0.13, -0.55),
      ...fan(aimed, 3, 0.13, 0.55),
      ...fan(aimed, 3, 0.13),
    ];
  }

  if (kind === "heap-titan") {
    if (stage === 1) return ring(12, 0);
    if (stage === 2) return [...ring(16, sequence * 0.17), ...fan(aimed, 3, 0.18)];
    return [...ring(20, sequence * 0.21), ...ring(10, sequence * 0.21 + Math.PI / 10), ...fan(aimed, 5, 0.16)];
  }

  if (kind === "kimi-swarm") {
    if (stage === 1) return fan(aimed, 5, 0.23);
    if (stage === 2) return [...ring(10, sequence * 0.35), ...fan(aimed, 3, 0.18)];
    return [...ring(18, sequence * 0.42), ...ring(9, -sequence * 0.42), ...fan(aimed, 5, 0.18)];
  }

  // Llama Herd: parallel charges become crossing lanes, then a full stampede.
  const lanes = stage === 1 ? [-1, 0, 1] : stage === 2 ? [-2, -1, 0, 1, 2] : [-3, -2, -1, 0, 1, 2, 3];
  const forward = lanes.map(lane => ({ direction: aimed, lateralOffset: lane * laneWidth }));
  if (stage === 1) return forward;
  const crossing = lanes.filter(lane => lane !== 0).map(lane => ({
    direction: rotate(aimed, (sequence % 2 === 0 ? 1 : -1) * (lane < 0 ? -0.28 : 0.28)),
    lateralOffset: lane * laneWidth,
  }));
  return stage === 2 ? [...forward, ...crossing] : [...forward, ...crossing, ...ring(10, sequence * 0.16)];
}
