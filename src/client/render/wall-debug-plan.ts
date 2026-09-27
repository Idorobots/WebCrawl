import { world } from "../config";
import { corridorFloorBounds, pointInCorridor, pointInRoomFloor, type FloorBounds } from "../domain/geometry";
import { forSpatialCells, spatialCellKey } from "../domain/spatial";
import { PLAYER_SPEC, WORLD_GEOMETRY } from "../domain/specs";
import type { DungeonLayout, GraphNode, LayoutLink } from "../types";

export interface DebugWallRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Shade floor edges, splitting boundary cells at exact movement-geometry edges. */
export function buildBlockedWallRegions(
  layout: DungeonLayout,
  radius = PLAYER_SPEC.radius,
  step = world(8),
): DebugWallRegion[] {
  const rows = new Map<number, Set<number>>();
  const regions: DebugWallRegion[] = [];
  const visited = new Set<string>();
  const padding = radius + WORLD_GEOMETRY.wallThickness;
  const roomCells = new Map<string, Set<GraphNode>>();
  const linkCells = new Map<string, Set<LayoutLink>>();
  const roomBounds = new Map<GraphNode, FloorBounds>();
  const linkBounds = new Map<LayoutLink, FloorBounds[]>();
  for (const room of layout.nodes) {
    roomBounds.set(room, {
      left: room.x - room.width / 2 + radius, right: room.x + room.width / 2 - radius,
      top: room.y - room.height / 2 + radius, bottom: room.y + room.height / 2 - radius,
    });
    forSpatialCells(room.x - room.width / 2, room.x + room.width / 2,
      room.y - room.height / 2, room.y + room.height / 2, key => {
        const candidates = roomCells.get(key) ?? new Set<GraphNode>();
        candidates.add(room);
        roomCells.set(key, candidates);
      });
  }
  for (const link of layout.links) {
    linkBounds.set(link, corridorFloorBounds(link, radius));
    const margin = (link.width || WORLD_GEOMETRY.corridorHalfWidth * 2) / 2 + padding +
      Math.abs(WORLD_GEOMETRY.verticalDoorPassableOffsetY);
    const addSegment = (start: { x: number; y: number }, end: { x: number; y: number }): void => {
      forSpatialCells(Math.min(start.x, end.x) - margin, Math.max(start.x, end.x) + margin,
        Math.min(start.y, end.y) - margin, Math.max(start.y, end.y) + margin, key => {
          const candidates = linkCells.get(key) ?? new Set<LayoutLink>();
          candidates.add(link);
          linkCells.set(key, candidates);
        });
    };
    if (link.direct && link.points[0]) addSegment(link.points[0], link.points[0]);
    else for (let index = 1; index < link.points.length; index += 1) {
      addSegment(link.points[index - 1]!, link.points[index]!);
    }
  }
  const walkable = (x: number, y: number): boolean => {
    const key = spatialCellKey(x, y);
    for (const room of roomCells.get(key) ?? []) {
      if (pointInRoomFloor(x, y, room, radius)) return true;
    }
    for (const link of linkCells.get(key) ?? []) {
      if (pointInCorridor(x, y, link, radius)) return true;
    }
    return false;
  };
  const scanBand = (left: number, top: number, right: number, bottom: number): void => {
    for (let row = Math.floor(top / step); row < Math.ceil(bottom / step); row += 1) {
      for (let col = Math.floor(left / step); col < Math.ceil(right / step); col += 1) {
        const cellKey = `${col},${row}`;
        if (visited.has(cellKey)) continue;
        visited.add(cellKey);
        const cellLeft = col * step;
        const cellTop = row * step;
        const cellRight = cellLeft + step;
        const cellBottom = cellTop + step;
        const xCuts = [cellLeft, cellRight];
        const yCuts = [cellTop, cellBottom];
        const spatialKey = spatialCellKey(cellLeft + step / 2, cellTop + step / 2);
        const addCuts = (bounds: FloorBounds): void => {
          if (bounds.left >= bounds.right || bounds.top >= bounds.bottom ||
            bounds.right <= cellLeft || bounds.left >= cellRight ||
            bounds.bottom <= cellTop || bounds.top >= cellBottom) return;
          for (const x of [bounds.left, bounds.right]) {
            if (x > cellLeft && x < cellRight) xCuts.push(x);
          }
          for (const y of [bounds.top, bounds.bottom]) {
            if (y > cellTop && y < cellBottom) yCuts.push(y);
          }
        };
        for (const room of roomCells.get(spatialKey) ?? []) addCuts(roomBounds.get(room)!);
        for (const link of linkCells.get(spatialKey) ?? []) {
          for (const bounds of linkBounds.get(link) ?? []) addCuts(bounds);
        }
        if (xCuts.length === 2 && yCuts.length === 2) {
          if (!walkable(cellLeft + step / 2, cellTop + step / 2)) {
            const cells = rows.get(row) ?? new Set<number>();
            cells.add(col);
            rows.set(row, cells);
          }
          continue;
        }
        xCuts.sort((a, b) => a - b);
        yCuts.sort((a, b) => a - b);
        for (let yi = 1; yi < yCuts.length; yi += 1) {
          const y0 = yCuts[yi - 1]!;
          const y1 = yCuts[yi]!;
          if (y0 === y1) continue;
          for (let xi = 1; xi < xCuts.length; xi += 1) {
            const x0 = xCuts[xi - 1]!;
            const x1 = xCuts[xi]!;
            if (x0 === x1 || walkable((x0 + x1) / 2, (y0 + y1) / 2)) continue;
            regions.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
          }
        }
      }
    }
  };

  for (const room of layout.nodes) {
    const left = room.x - room.width / 2;
    const right = room.x + room.width / 2;
    const top = room.y - room.height / 2;
    const bottom = room.y + room.height / 2;
    scanBand(left - padding, top - padding, right + padding, top + padding);
    scanBand(left - padding, bottom - padding, right + padding, bottom + padding);
    scanBand(left - padding, top + padding, left + padding, bottom - padding);
    scanBand(right - padding, top + padding, right + padding, bottom - padding);
  }
  for (const link of layout.links) {
    if (link.direct) continue;
    const halfWidth = (link.width || WORLD_GEOMETRY.corridorHalfWidth * 2) / 2;
    for (let index = 1; index < link.points.length; index += 1) {
      const start = link.points[index - 1]!;
      const end = link.points[index]!;
      if (start.y === end.y) {
        const left = Math.min(start.x, end.x) - padding;
        const right = Math.max(start.x, end.x) + padding;
        scanBand(left, start.y - halfWidth - padding, right, start.y - halfWidth + padding);
        scanBand(left, start.y + halfWidth - padding, right, start.y + halfWidth + padding);
      } else {
        const top = Math.min(start.y, end.y) - padding;
        const bottom = Math.max(start.y, end.y) + padding;
        scanBand(start.x - halfWidth - padding, top, start.x - halfWidth + padding, bottom);
        scanBand(start.x + halfWidth - padding, top, start.x + halfWidth + padding, bottom);
      }
    }
  }

  for (const [row, cells] of rows) {
    const columns = [...cells].sort((left, right) => left - right);
    let first = columns[0];
    let last = first;
    for (const col of columns.slice(1)) {
      if (col === last! + 1) {
        last = col;
      } else {
        regions.push({ x: first! * step, y: row * step, width: (last! - first! + 1) * step, height: step });
        first = last = col;
      }
    }
    if (first !== undefined) {
      regions.push({ x: first * step, y: row * step, width: (last! - first + 1) * step, height: step });
    }
  }
  return regions;
}
