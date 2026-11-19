import { ASSETS } from "../config";
import type { Decoration, DungeonLayout, LayoutLink, ObstacleState, Point } from "../types";
import { corridorJunctions } from "./corridor-junctions";
import { WORLD_GEOMETRY } from "./world-specs";

const segment = WORLD_GEOMETRY.segmentSize;
export const CORRIDOR_MONSTER_MIN_LENGTH = 6 * segment;
export const SECURITY_DOOR_MIN_LENGTH = 6 * segment;
export const SECURITY_DOOR_RADIUS = 4 * segment;
export const SECURITY_DOOR_MAX_HP = 18;
export const CORRIDOR_ENCOUNTER_CLEARANCE = 1.25 * segment;
const EXTRA_SECURITY_DOOR_LENGTH = 8 * segment;
const SECURITY_DOOR_SPACING = 4 * segment;
const MAX_SECURITY_DOORS_PER_CORRIDOR = 3;

export interface SecurityDoor extends Decoration {
  kind: "security-door";
  linkId: string;
  position: Point;
  side: "E" | "S";
}

export function isSecurityDoor(item: Decoration): item is SecurityDoor {
  return item.kind === "security-door";
}

export function corridorRuns(link: LayoutLink): { start: Point; end: Point; length: number }[] {
  if (link.direct) return [];
  return link.points.slice(1).map((end, index) => {
    const start = link.points[index]!;
    return { start, end, length: Math.hypot(end.x - start.x, end.y - start.y) };
  }).filter(run => run.length > 0);
}

function corridorLength(link: LayoutLink): number {
  return corridorRuns(link).reduce((sum, run) => sum + run.length, 0);
}

/** A shared fork trunk gets a single encounter, owned by its longest link. */
export function corridorEncounterLinks(layout: DungeonLayout): LayoutLink[] {
  const forks = new Map<string, LayoutLink>();
  for (const link of layout.links) {
    if (!link.forkId) continue;
    const owner = forks.get(link.forkId);
    if (!owner || corridorLength(link) > corridorLength(owner)) forks.set(link.forkId, link);
  }
  return layout.links.filter(link => !link.direct && (!link.forkId || forks.get(link.forkId) === link));
}

export function corridorKeepOutPoints(layout: DungeonLayout): Map<string, Point[]> {
  const forks = new Map<string, Point[]>();
  for (const link of layout.links) {
    if (!link.forkId || link.forkPointIndex === undefined) continue;
    const point = link.points[link.forkPointIndex];
    if (!point) continue;
    const points = forks.get(link.forkId) ?? [];
    points.push(point);
    forks.set(link.forkId, points);
  }
  const points = new Map(layout.links.map(link => [link.id, [...link.points, ...(forks.get(link.forkId ?? "") ?? [])]]));
  for (const junction of corridorJunctions(layout.links)) {
    for (const id of junction.linkIds) points.get(id)?.push(junction.point);
  }
  return points;
}

export function corridorEncounterPositionIsClear(point: Point, keepOut: readonly Point[]): boolean {
  return keepOut.every(other => Math.hypot(point.x - other.x, point.y - other.y) >= CORRIDOR_ENCOUNTER_CLEARANCE);
}

export function buildSecurityDoors(layout: DungeonLayout, saved: ReadonlyMap<string, ObstacleState>): SecurityDoor[] {
  const keepOut = corridorKeepOutPoints(layout);
  return corridorEncounterLinks(layout).flatMap(link => {
    const length = corridorLength(link);
    if (length < SECURITY_DOOR_MIN_LENGTH) return [];
    const count = Math.min(MAX_SECURITY_DOORS_PER_CORRIDOR,
      1 + Math.floor((length - SECURITY_DOOR_MIN_LENGTH) / EXTRA_SECURITY_DOOR_LENGTH));
    const landmarks = keepOut.get(link.id) ?? [];
    const candidates = corridorRuns(link).sort((a, b) => b.length - a.length).flatMap(run => {
      const slots = Math.floor(run.length / segment);
      const offsets = Array.from({ length: Math.max(0, slots - 1) }, (_, index) => index + 1)
        .sort((a, b) => Math.abs(a - slots / 2) - Math.abs(b - slots / 2));
      return offsets.flatMap(offset => {
        const progress = offset * segment / run.length;
        const position = {
          x: run.start.x + (run.end.x - run.start.x) * progress,
          y: run.start.y + (run.end.y - run.start.y) * progress,
        };
        return corridorEncounterPositionIsClear(position, landmarks)
          ? [{ position, vertical: run.start.y === run.end.y }] : [];
      });
    });
    if (!candidates.length) return [];

    // Keep the original center-first doorway and save ID. Extra doors split
    // the largest available gaps without crowding entrances or junctions.
    const placements = [candidates[0]!];
    while (placements.length < count) {
      let best: (typeof candidates)[number] | undefined;
      let bestClearance = -Infinity;
      for (const candidate of candidates) {
        const { x, y } = candidate.position;
        const distance = (point: Point): number => Math.hypot(point.x - x, point.y - y);
        const doorClearance = Math.min(...placements.map(door => distance(door.position)));
        if (doorClearance < SECURITY_DOOR_SPACING) continue;
        const clearance = Math.min(doorClearance, ...landmarks.map(distance));
        if (clearance <= bestClearance) continue;
        best = candidate;
        bestClearance = clearance;
      }
      if (!best) break;
      placements.push(best);
    }

    return placements.map(({ position, vertical }, index): SecurityDoor => {
      const id = `${link.id}::security-door${index === 0 ? "" : `-${index + 1}`}`;
      const state = saved.get(id);
      const hp = state?.destroyed ? 0 : state?.hp ?? SECURITY_DOOR_MAX_HP;
      const thickness = WORLD_GEOMETRY.wallThickness / segment / 2;
      return {
        id, kind: "security-door", definitionId: "security-door", roomId: link.ownerRoomId,
        linkId: link.id, corridorId: link.id, position, ...position, side: vertical ? "E" : "S",
        hp, maxHp: SECURITY_DOOR_MAX_HP, destroyed: hp <= 0, destructible: true, dropKind: null,
        // The animated leaf supplies its own rectangular footprint and projectile collision.
        obstacle: false, size: segment, visualOffset: { x: 0, y: 0 },
        hitboxOffset: { x: vertical ? -thickness : 0, y: -0.25 - (vertical ? 0 : thickness) },
        hitboxRadii: vertical ? { x: thickness, y: 1 } : { x: 1, y: thickness },
        footprintRadii: vertical ? { x: thickness, y: 1 } : { x: 1, y: thickness },
        visual: { normal: { frames: [vertical ? ASSETS.doorVerticalTop : ASSETS.doorHorizontalLeft],
          frameDurationMs: 0, sizeScale: 1, origin: { x: 0.5, y: 0.5 } } },
      };
    });
  });
}
