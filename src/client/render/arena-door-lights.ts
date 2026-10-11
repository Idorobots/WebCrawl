import type { DungeonLayout, GraphNode, LayoutLink, Point } from "../types";

export interface ArenaDoorLink {
  link: LayoutLink;
  arena: GraphNode;
  approach: GraphNode;
  door: Point;
}

/**
 * Direct (shared-doorway) links where exactly one side is a boss arena. These
 * doorways have no corridor to tint red, so the renderer warns the player with
 * a light centered on the shared door instead.
 */
export function directArenaDoorLinks(layout: DungeonLayout): ArenaDoorLink[] {
  const result: ArenaDoorLink[] = [];
  for (const link of layout.links) {
    if (!link.direct) continue;
    const door = link.points[0];
    if (!door) continue;
    const sourceArena = link.source.isBossArena === true;
    const targetArena = link.target.isBossArena === true;
    if (sourceArena === targetArena) continue;
    result.push({
      link,
      arena: sourceArena ? link.source : link.target,
      approach: sourceArena ? link.target : link.source,
      door,
    });
  }
  return result;
}
