import { describe, expect, it } from "vitest";
import { artDebugLevel } from "../../src/client/domain/authored-rooms";
import { footprintsOverlap, pointInRoomFloor } from "../../src/client/domain/geometry";
import { buildDecorations, buildInteractiveObjects, buildMonsters } from "../../src/client/domain/generation";
import { layoutOrthogonal } from "../../src/client/domain/layout";
import { buildWallFootprints, WallRectIndex, wallOverlapsEllipse } from "../../src/client/domain/wall-collision";
import {
  BOSS_DEFINITIONS, DECORATION_DEFINITIONS, LOOT_DEFINITIONS,
  MINIBOSS_DAMAGE_MULTIPLIER, MINIBOSS_HP_MULTIPLIER, MINIBOSS_SIZE_MULTIPLIER,
  PLAYER_SPEC, REGULAR_MONSTER_DEFINITIONS,
} from "../../src/client/domain/world-specs";
import { weaponKinds } from "../../src/client/domain/weapons";

describe("authored art floor", () => {
  it("has fixed, connected rooms with one room for every enemy, miniboss, and boss kind", () => {
    const { graph, layout, rooms } = artDebugLevel();
    const walls = new WallRectIndex(buildWallFootprints(layout));
    const monsters = buildMonsters(layout, new Map(), new Set([0]), 1, [], undefined, walls, rooms);
    const enemyKinds = Object.keys(REGULAR_MONSTER_DEFINITIONS);
    const bossKinds = Object.keys(BOSS_DEFINITIONS);
    const kinds = [...enemyKinds, ...enemyKinds, ...bossKinds];

    expect(layout.nodes).toHaveLength(kinds.length + 1);
    expect(layout.hiddenCount).toBe(0);
    expect(layout.links).toHaveLength(kinds.length);
    expect(layout.links.every(link => link.direct &&
      link.points[0]!.x === link.points[1]!.x && link.points[0]!.y === link.points[1]!.y)).toBe(true);
    expect(graph.nodes).toEqual(artDebugLevel().graph.nodes);
    expect(monsters).toHaveLength(kinds.length);
    expect(monsters.map(monster => monster.kind)).toEqual(kinds);
    expect(new Set(monsters.map(monster => monster.spawnRoomId)).size).toBe(kinds.length);
    expect(monsters.filter(monster => !monster.miniboss && !monster.bossKind).map(monster => monster.kind)).toEqual(enemyKinds);
    expect(monsters.filter(monster => monster.bossKind).map(monster => monster.kind)).toEqual(bossKinds);
    const minibosses = monsters.filter(monster => monster.miniboss);
    expect(minibosses.map(monster => monster.kind)).toEqual(enemyKinds);
    for (const miniboss of minibosses) {
      const regular = monsters.find(monster => monster.kind === miniboss.kind && !monster.miniboss)!;
      expect(miniboss.size).toBeCloseTo(regular.size * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.spriteSize).toBeCloseTo(regular.spriteSize * MINIBOSS_SIZE_MULTIPLIER);
      expect(miniboss.maxHp).toBe(Math.ceil(regular.maxHp * MINIBOSS_HP_MULTIPLIER));
      expect(miniboss.attackDamage).toBe(Math.ceil(regular.attackDamage * MINIBOSS_DAMAGE_MULTIPLIER));
      for (const field of ["hitboxRadii", "hitboxOffset", "visualOffset", "destroyedVisualOffset", "footprintRadii"] as const) {
        expect(miniboss[field].x).toBeCloseTo(regular[field].x * MINIBOSS_SIZE_MULTIPLIER);
        expect(miniboss[field].y).toBeCloseTo(regular[field].y * MINIBOSS_SIZE_MULTIPLIER);
      }
      const room = layout.nodes.find(room => room.id === miniboss.spawnRoomId)!;
      expect(room).toMatchObject({ tag: "miniboss", isBossArena: false, label: `Miniboss ${miniboss.kind}` });
      expect(pointInRoomFloor(miniboss.x, miniboss.y, room)).toBe(true);
      expect(wallOverlapsEllipse(miniboss, miniboss.footprintRadii, walls)).toBe(false);
    }
    expect(monsters.every(monster => monster.hp === monster.maxHp)).toBe(true);
  });

  it("exhibits every decoration and pickup with accessible, non-overlapping placements", () => {
    const { layout, rooms } = artDebugLevel();
    const gallery = layout.nodes[0]!;
    const walls = new WallRectIndex(buildWallFootprints(layout));
    const decorations = buildDecorations(layout, new Map(), 1, walls, rooms);
    const { loot } = buildInteractiveObjects(layout, "art-debug", null, new Set(), walls, rooms);

    expect(decorations.map(item => item.definitionId).sort())
      .toEqual(Object.values(DECORATION_DEFINITIONS).map(item => item.definitionId).sort());
    expect(loot.filter(item => item.kind !== "weapon").map(item => item.kind).sort())
      .toEqual(Object.keys(LOOT_DEFINITIONS).sort());
    expect(loot.filter(item => item.kind === "weapon").map(item => item.weapon?.kind))
      .toEqual(weaponKinds());

    for (const [index, item] of decorations.entries()) {
      expect(pointInRoomFloor(item.x, item.y, gallery)).toBe(true);
      expect(wallOverlapsEllipse(item, item.footprintRadii, walls)).toBe(false);
      for (const other of decorations.slice(index + 1)) {
        if (item.obstacle && other.obstacle) {
          expect(footprintsOverlap(item, item.footprintRadii, other, other.footprintRadii)).toBe(false);
        }
      }
    }
    for (const item of loot) {
      expect(pointInRoomFloor(item.x, item.y, gallery)).toBe(true);
      expect(decorations.some(decor => decor.obstacle &&
        footprintsOverlap(item, PLAYER_SPEC.footprintRadii, decor, decor.footprintRadii))).toBe(false);
    }
    expect(decorations.some(item => item.obstacle &&
      footprintsOverlap(gallery, PLAYER_SPEC.footprintRadii, item, item.footprintRadii))).toBe(false);
    for (let x = gallery.x; x < gallery.x + gallery.width / 2; x += 40) {
      expect(decorations.some(item => item.obstacle &&
        footprintsOverlap({ x, y: gallery.y }, PLAYER_SPEC.footprintRadii,
          item, item.footprintRadii))).toBe(false);
    }
  });

  it("can place templates in another layout and restore their ordinary game state", () => {
    const art = artDebugLevel();
    const graph = { ...art.graph, nodes: art.graph.nodes.slice(0, 2), links: art.graph.links.slice(0, 1) };
    const rooms = new Map([...art.rooms].slice(0, 2));
    const layout = layoutOrthogonal(graph, rooms);
    expect(layout.nodes.map(room => [room.width, room.height]))
      .toEqual(art.layout.nodes.slice(0, 2).map(room => [room.width, room.height]));

    const savedDecorations = new Map([["0::authored-decor-0", { hp: 2, destroyed: true }]]);
    const decorations = buildDecorations(layout, savedDecorations, 1, undefined, rooms);
    expect(decorations[0]).toMatchObject({ hp: 2, destroyed: true });

    const initialLoot = buildInteractiveObjects(layout, "art-debug", null, new Set(), undefined, rooms).loot;
    expect(buildInteractiveObjects(layout, "art-debug", null, new Set([initialLoot[0]!.id]), undefined, rooms).loot)
      .toHaveLength(initialLoot.length - 1);

    const state = new Map([["1::authored-monster-0", {
      x: layout.nodes[1]!.x, y: layout.nodes[1]!.y,
      roomId: 1, hp: 1, dead: false, active: true,
      droppedLoot: false, dropId: null, dropX: null, dropY: null, dropKind: null,
    }]]);
    const monster = buildMonsters(layout, state, new Set([0, 1]), 1, decorations, undefined, undefined, rooms)[0];
    expect(monster).toMatchObject({ id: "1::authored-monster-0", hp: 1, active: true });
  });
});
