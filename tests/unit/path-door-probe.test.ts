import { describe, it } from "vitest";
import { domToGraph } from "../../src/client/domain/graph";
import { layoutOrthogonal } from "../../src/client/domain/layout";
import { pointInCorridor, pointInRoomFloor } from "../../src/client/domain/geometry";
import { PLAYER_SPEC, REGULAR_MONSTER_DEFINITIONS, BOSS_DEFINITIONS } from "../../src/client/domain/world-specs";
import { buildWallFootprints, wallOverlapsEllipse, WallRectIndex } from "../../src/client/domain/wall-collision";
import type { EllipseRadii, Point } from "../../src/client/types";

describe("doorway walkability detail", () => {
  it("dumps walkability along one door axis", () => {
    const html = `<body><main><h1>T</h1><p>${"lorem ".repeat(20)}</p><div><p>x</p></div><section><a href="/a">a</a><a href="/b">b</a></section><footer>f</footer><article>some content here for room</article><aside>aside</aside></main></body>`;
    const graph = domToGraph(html, "https://example.com/probe", 1);
    const layout = layoutOrthogonal(graph);
    const walls = new WallRectIndex(buildWallFootprints(layout));
    const link = layout.links.find(l => l.id === "1->2")!;
    const door = link.points[link.points.length - 1]!;

    const radii = new Map<string, EllipseRadii>([
      ["player", PLAYER_SPEC.footprintRadii],
      ...Object.entries(REGULAR_MONSTER_DEFINITIONS).map(([kind, def]) => [kind, def.footprintRadii] as const),
      ...Object.entries(BOSS_DEFINITIONS).map(([kind, def]) => [kind, def.footprintRadii] as const),
    ]);

    for (const [kind, radius] of radii) {
      const rows: string[] = [];
      let blockedSpan = "";
      for (let depth = -160; depth <= 240; depth += 2) {
        const probe: Point = { x: door.x, y: door.y + depth };
        const onFloor = pointInCorridor(probe.x, probe.y, link) ||
          pointInRoomFloor(probe.x, probe.y, link.source) ||
          pointInRoomFloor(probe.x, probe.y, link.target);
        const ok = onFloor && !wallOverlapsEllipse(probe, radius, walls);
        if (!ok) blockedSpan += `${depth} `;
      }
      rows.push(blockedSpan.trim() || "fully walkable");
      console.log(`r=(${radius.x}, ${radius.y}) (${kind}): ${rows[0]}`);
    }
  });
});
