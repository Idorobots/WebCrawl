import type { DungeonLayout, Point } from "../types";
import { buildCorridorRenderPlan } from "../render/corridor-render-plan";
import { forSpatialCells, spatialCellKey } from "./spatial";
import { WORLD_GEOMETRY } from "./world-specs";

interface FloorRect { x: number; y: number; width: number; height: number }

/** Floor ownership follows the rendered rooms, corridor runs and junction tiles.
 * Actor clearance is handled separately by the wall and obstacle footprints. */
export class FloorGeometry {
  private readonly cells = new Map<string, FloorRect[]>();

  constructor(layout: DungeonLayout) {
    const s = WORLD_GEOMETRY.segmentSize;
    const plan = buildCorridorRenderPlan(layout, s);
    const rectangles: FloorRect[] = layout.nodes.map(room => ({
      x: room.x - room.width / 2, y: room.y - room.height / 2,
      width: room.width, height: room.height,
    }));
    for (const segment of plan.segments) {
      const horizontal = segment.start.y === segment.end.y;
      rectangles.push({
        x: horizontal ? Math.min(segment.start.x, segment.end.x) : segment.start.x - segment.width / 2,
        y: horizontal ? segment.start.y - segment.width / 2 : Math.min(segment.start.y, segment.end.y),
        width: horizontal ? Math.abs(segment.end.x - segment.start.x) : segment.width,
        height: horizontal ? segment.width : Math.abs(segment.end.y - segment.start.y),
      });
    }
    for (const floor of plan.junctionFloors) {
      rectangles.push({ x: floor.x - s / 2, y: floor.y - s / 2, width: s, height: s });
    }
    for (const rect of rectangles) {
      forSpatialCells(rect.x, rect.x + rect.width, rect.y, rect.y + rect.height, key => {
        const cell = this.cells.get(key) ?? [];
        cell.push(rect);
        this.cells.set(key, cell);
      });
    }
  }

  contains(point: Point): boolean {
    return (this.cells.get(spatialCellKey(point.x, point.y)) ?? []).some(rect =>
      point.x >= rect.x && point.x <= rect.x + rect.width &&
      point.y >= rect.y && point.y <= rect.y + rect.height
    );
  }
}
