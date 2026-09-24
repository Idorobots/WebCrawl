import { describe, it } from "vitest";
import { domToGraph } from "../../src/client/domain/graph";
import { layoutOrthogonal } from "../../src/client/domain/layout";
import { buildMonsters, buildDecorations } from "../../src/client/domain/generation";

describe("top wall edge probe", () => {
  it("reports closest approaches", () => {
    const html = `<body><main><h1>T</h1><p>${"lorem ".repeat(20)}</p><div><p>x</p></div><section><a href="/a">a</a><a href="/b">b</a></section><footer>f</footer><article>some content here for room</article><aside>aside</aside></main></body>`;
    const graph = domToGraph(html, "https://example.com/probe", 1);
    const layout = layoutOrthogonal(graph);
    const decorations = buildDecorations(layout, new Map(), 1);
    const monsters = buildMonsters(layout, new Map(), new Set([1]), 1, decorations);

    const report = (name: string, items: Array<{ roomId: number; y: number; radius?: number }>, getRadius: (item: any) => number) => {
      let worst: { distanceToTopEdge: number; roomId: number; tag: string } | null = null;
      const byRoom = new Map<number, string[]>();
      for (const item of items) {
        const room = layout.nodes.find(r => r.id === item.roomId);
        if (!room) continue;
        const d = (item.y - getRadius(item)) - (room.y - room.height / 2);
        if (!worst || d < worst.distanceToTopEdge) worst = { distanceToTopEdge: d, roomId: room.id, tag: room.tag };
        const rel = ((item.y - (room.y - room.height / 2)) / room.height).toFixed(2);
        if (!byRoom.has(room.id)) byRoom.set(room.id, []);
        byRoom.get(room.id)!.push(rel);
      }
      console.log(`${name}: closest approach to top wall face = ${worst ? worst.distanceToTopEdge.toFixed(1) : "n/a"} (room ${worst?.roomId} <${worst?.tag}>)`);
      for (const [id, rels] of byRoom) {
        const room = layout.nodes.find(r => r.id === id)!;
        console.log(`  room ${id} <${room.tag}> h=${room.height} relY: ${rels.join(", ")}`);
      }
    };

    report("scenery", decorations, () => 0);
    report("monsters", monsters.filter(m => !m.bossKind), m => m.radius);
  });
});
