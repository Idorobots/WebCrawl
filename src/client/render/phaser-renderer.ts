import Phaser from "phaser";
import {
  ASSETS,
  BULLET_RADIUS,
  CAMERA_SCALE,
  EXPLOSION_FRAMES,
  MONSTER_ASSETS,
  PLAYER_FRAMES,
  PLAYER_IDLE_ASSETS,
  PLAYER_SPRITE_SIZE,
  WEAPON_ASSETS,
  WORLD_SCALE,
} from "../config";
import { WEAPON_COLORS } from "../domain/weapons";
import type {
  Bullet,
  Decoration,
  DungeonLayout,
  GraphNode,
  LootItem,
  LootKind,
  Monster,
  Point,
  Stair,
} from "../types";

const textureKey = (asset: string): string => `asset:${asset}`;
const world = (value: number): number => Math.round(value * WORLD_SCALE);
const TILE_SIZE = 128;
const WALL_THICKNESS = 32;
const HIDDEN_WORLD_ALPHA = 0.24;

export class PhaserRenderer {
  private game: Phaser.Game | null = null;
  private scene: Phaser.Scene | null = null;
  private layout: DungeonLayout | null = null;
  private visited = new Set<number>();
  private background: Phaser.GameObjects.TileSprite | null = null;
  private staticObjects: Phaser.GameObjects.GameObject[] = [];
  private roomLayers = new Map<number, Phaser.GameObjects.Container>();
  private corridorLayers = new Map<string, Phaser.GameObjects.Container>();
  private bulletsGraphics: Phaser.GameObjects.Graphics | null = null;
  private decorations: Phaser.GameObjects.Container[] = [];
  private objects: Phaser.GameObjects.Container[] = [];
  private monsters = new Map<string, Phaser.GameObjects.Container>();
  private player: Phaser.GameObjects.Container | null = null;
  private playerSprite: Phaser.GameObjects.Image | null = null;
  private playerHpFill: Phaser.GameObjects.Rectangle | null = null;
  private currentPlayer: Point = { x: 0, y: 0 };
  private currentPlayerHp = 10;
  private currentPlayerMaxHp = 10;
  private currentPlayerAsset: string = ASSETS.playerRight;
  private currentDecorations: Decoration[] = [];
  private currentStairs: Stair[] = [];
  private currentLoot: LootItem[] = [];
  private currentMonsters: Monster[] = [];
  private currentBullets: Bullet[] = [];
  private currentLootAssets: Partial<Record<LootKind, string>> = {};
  private currentMonsterAssetFor: (monster: Monster) => string = () => MONSTER_ASSETS.scout.down;

  constructor(private readonly host: HTMLElement) {}

  start(): void {
    if (this.game) return;
    const renderer = this;
    class DungeonScene extends Phaser.Scene {
      constructor() {
        super("dungeon");
      }

      preload(): void {
        const assets = new Set<string>([
          ...Object.values(ASSETS),
          ...Object.values(PLAYER_IDLE_ASSETS),
          ...Object.values(PLAYER_FRAMES).flatMap(actions => Object.values(actions).flat()),
          ...Object.values(MONSTER_ASSETS).flatMap(views => Object.values(views)),
          ...Object.values(WEAPON_ASSETS),
          ...EXPLOSION_FRAMES,
        ]);
        for (const asset of assets) this.load.image(textureKey(asset), asset);
      }

      create(): void {
        renderer.attach(this);
      }
    }

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.host,
      transparent: true,
      render: { antialias: false, pixelArt: true, roundPixels: true },
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: Math.max(1, this.host.clientWidth),
        height: Math.max(1, this.host.clientHeight),
      },
      scene: DungeonScene,
    });
  }

  private attach(scene: Phaser.Scene): void {
    this.scene = scene;
    scene.cameras.main.setZoom(CAMERA_SCALE);
    this.drawWorld();
    this.renderDecorations(this.currentDecorations, this.visited);
    this.renderObjects(this.currentStairs, this.currentLoot, this.visited, this.currentLootAssets);
    this.renderMonsters(this.currentMonsters, this.currentMonsterAssetFor);
    this.renderBullets(this.currentBullets);
    this.setPlayer(this.currentPlayer, this.currentPlayerHp, this.currentPlayerMaxHp, this.currentPlayerAsset);
    this.centerCamera(this.currentPlayer);
  }

  clear(): void {
    this.layout = null;
    this.background?.destroy();
    this.background = null;
    this.destroyStaticObjects();
    this.bulletsGraphics?.clear();
    this.destroyAll(this.decorations);
    this.destroyAll(this.objects);
    for (const object of this.monsters.values()) object.destroy(true);
    this.monsters.clear();
    this.player?.destroy(true);
    this.player = null;
    this.playerSprite = null;
    this.playerHpFill = null;
    this.currentDecorations = [];
    this.currentStairs = [];
    this.currentLoot = [];
    this.currentMonsters = [];
    this.currentBullets = [];
    delete this.host.dataset.rooms;
    delete this.host.dataset.corridors;
    delete this.host.dataset.availableWeapons;
    delete this.host.dataset.firstWeaponX;
    delete this.host.dataset.firstWeaponY;
    delete this.host.dataset.firstWeaponKind;
    delete this.host.dataset.firstLootX;
    delete this.host.dataset.firstLootY;
    delete this.host.dataset.firstLootKind;
  }

  setWorld(layout: DungeonLayout, visited: ReadonlySet<number>): void {
    this.layout = layout;
    this.visited = new Set(visited);
    this.host.dataset.rooms = String(layout.nodes.length);
    this.host.dataset.corridors = String(layout.links.length);
    const root = layout.nodes.find(room => room.isRoot);
    const firstExit = root ? layout.links.find(link => link.source.id === root.id) : undefined;
    if (firstExit) {
      this.host.dataset.firstExit = firstExit.direction;
      this.host.dataset.firstDoorX = String(Math.round(firstExit.points[0]!.x));
      this.host.dataset.firstDoorY = String(Math.round(firstExit.points[0]!.y));
    }
    this.drawWorld();
  }

  setFog(visited: ReadonlySet<number>): void {
    this.visited = new Set(visited);
    this.updateWorldVisibility();
  }

  private drawWorld(): void {
    const scene = this.scene;
    if (!scene || !this.layout) return;
    this.background?.destroy();
    this.background = null;
    this.destroyStaticObjects();
    const worldBounds = this.layout.nodes.reduce((bounds, room) => ({
      left: Math.min(bounds.left, room.x - room.width / 2),
      right: Math.max(bounds.right, room.x + room.width / 2),
      top: Math.min(bounds.top, room.y - room.height / 2),
      bottom: Math.max(bounds.bottom, room.y + room.height / 2),
    }), {
      left: Infinity,
      right: -Infinity,
      top: Infinity,
      bottom: -Infinity,
    });
    for (const link of this.layout.links) {
      for (const point of link.points) {
        worldBounds.left = Math.min(worldBounds.left, point.x - link.width / 2);
        worldBounds.right = Math.max(worldBounds.right, point.x + link.width / 2);
        worldBounds.top = Math.min(worldBounds.top, point.y - link.width / 2);
        worldBounds.bottom = Math.max(worldBounds.bottom, point.y + link.width / 2);
      }
    }
    const pad = world(384);
    const backgroundWidth = Math.max(world(1024), worldBounds.right - worldBounds.left + pad * 2);
    const backgroundHeight = Math.max(world(1024), worldBounds.bottom - worldBounds.top + pad * 2);
    this.background = scene.add.tileSprite(
      worldBounds.left - pad,
      worldBounds.top - pad,
      backgroundWidth,
      backgroundHeight,
      textureKey(ASSETS.backgroundTechTile),
    )
      .setOrigin(0)
      .setScrollFactor(1)
      .setDepth(-10);

    for (const link of this.layout.links) {
      const visible = this.visited.has(link.source.id) || this.visited.has(link.target.id);
      this.renderCorridor(link, visible ? 1 : HIDDEN_WORLD_ALPHA);
    }

    for (const room of this.layout.nodes) {
      const visible = this.visited.has(room.id);
      this.renderRoom(room, visible ? 1 : HIDDEN_WORLD_ALPHA);
    }
  }

  private updateWorldVisibility(): void {
    const layout = this.layout;
    if (!layout) return;
    for (const room of layout.nodes) {
      this.roomLayers.get(room.id)?.setAlpha(this.visited.has(room.id) ? 1 : HIDDEN_WORLD_ALPHA);
    }
    for (const link of layout.links) {
      const visible = this.visited.has(link.source.id) || this.visited.has(link.target.id);
      this.corridorLayers.get(link.id)?.setAlpha(visible ? 1 : HIDDEN_WORLD_ALPHA);
    }
  }

  private renderRoom(room: GraphNode, alpha: number): void {
    const scene = this.scene;
    if (!scene) return;
    const left = room.x - room.width / 2;
    const top = room.y - room.height / 2;
    const container = this.rememberStatic(scene.add.container(0, 0).setDepth(-2).setAlpha(alpha));
    this.roomLayers.set(room.id, container);
    const floor = scene.add.tileSprite(left, top, room.width, room.height, textureKey(ASSETS.floorPlain)).setOrigin(0);
    const maskGraphics = this.rememberStatic(scene.add.graphics().setVisible(false));
    maskGraphics.fillStyle(0xffffff, 1);
    this.drawRoom(maskGraphics, room, false);
    floor.setMask(maskGraphics.createGeometryMask());
    container.add(floor);
    if (room.shape === "capsule" || room.shape === "octagon") this.addShapedWallFrame(container, room);
    else this.addWallFrame(container, left, top, room.width, room.height);
    for (const link of this.layout?.links ?? []) {
      if (link.source.id === room.id) container.add(this.createDoor(link.points[0]!, link.direction));
      if (link.target.id === room.id) container.add(this.createDoor(link.points[link.points.length - 1]!, this.opposite(link.direction)));
    }
  }

  private renderCorridor(link: DungeonLayout["links"][number], alpha: number): void {
    const scene = this.scene;
    if (!scene) return;
    const container = this.rememberStatic(scene.add.container(0, 0).setDepth(-4).setAlpha(alpha));
    this.corridorLayers.set(link.id, container);
    for (let index = 1; index < link.points.length; index += 1) {
      const start = link.points[index - 1]!;
      const end = link.points[index]!;
      container.add(this.createCorridorSegment(start, end, link.width));
    }
    for (let index = 1; index < link.points.length - 1; index += 1) {
      container.add(this.createCorridorJunction(link.points[index]!, link.width));
    }
  }

  private createCorridorSegment(start: Point, end: Point, width: number): Phaser.GameObjects.Container {
    const scene = this.scene!;
    const container = scene.add.container(0, 0);
    if (Math.abs(start.x - end.x) >= Math.abs(start.y - end.y)) {
      const left = Math.min(start.x, end.x);
      const length = Math.abs(end.x - start.x);
      const top = start.y - width / 2;
      container.add(scene.add.tileSprite(left, top, length, width, textureKey(ASSETS.floorGrate)).setOrigin(0));
      container.add(scene.add.tileSprite(left, top, length, WALL_THICKNESS, textureKey(ASSETS.wallHorizontal)).setOrigin(0));
      container.add(scene.add.tileSprite(left, top + width - WALL_THICKNESS, length, WALL_THICKNESS, textureKey(ASSETS.wallHorizontal)).setOrigin(0));
      return container;
    }
    const top = Math.min(start.y, end.y);
    const length = Math.abs(end.y - start.y);
    const left = start.x - width / 2;
    container.add(scene.add.tileSprite(left, top, width, length, textureKey(ASSETS.floorGrate)).setOrigin(0));
    container.add(scene.add.tileSprite(left, top, WALL_THICKNESS, length, textureKey(ASSETS.wallVertical)).setOrigin(0));
    container.add(scene.add.tileSprite(left + width - WALL_THICKNESS, top, WALL_THICKNESS, length, textureKey(ASSETS.wallVertical)).setOrigin(0));
    return container;
  }

  private createCorridorJunction(point: Point, width: number): Phaser.GameObjects.Container {
    const scene = this.scene!;
    const left = point.x - width / 2;
    const top = point.y - width / 2;
    const container = scene.add.container(0, 0);
    container.add(scene.add.tileSprite(left, top, width, width, textureKey(ASSETS.floorGrate)).setOrigin(0));
    this.addWallFrame(container, left, top, width, width);
    return container;
  }

  private addWallFrame(container: Phaser.GameObjects.Container, left: number, top: number, width: number, height: number): void {
    const scene = this.scene!;
    const innerWidth = Math.max(0, width - TILE_SIZE * 2);
    const innerHeight = Math.max(0, height - TILE_SIZE * 2);
    if (innerWidth > 0) {
      container.add(scene.add.tileSprite(left + TILE_SIZE, top, innerWidth, WALL_THICKNESS, textureKey(ASSETS.wallHorizontal)).setOrigin(0));
      container.add(scene.add.tileSprite(left + TILE_SIZE, top + height - WALL_THICKNESS, innerWidth, WALL_THICKNESS, textureKey(ASSETS.wallHorizontal)).setOrigin(0));
    }
    if (innerHeight > 0) {
      container.add(scene.add.tileSprite(left, top + TILE_SIZE, WALL_THICKNESS, innerHeight, textureKey(ASSETS.wallVertical)).setOrigin(0));
      container.add(scene.add.tileSprite(left + width - WALL_THICKNESS, top + TILE_SIZE, WALL_THICKNESS, innerHeight, textureKey(ASSETS.wallVertical)).setOrigin(0));
    }
    container.add(scene.add.image(left, top, textureKey(ASSETS.wallCornerNW)).setOrigin(0));
    container.add(scene.add.image(left + width - TILE_SIZE, top, textureKey(ASSETS.wallCornerNE)).setOrigin(0));
    container.add(scene.add.image(left, top + height - TILE_SIZE, textureKey(ASSETS.wallCornerSW)).setOrigin(0));
    container.add(scene.add.image(left + width - TILE_SIZE, top + height - TILE_SIZE, textureKey(ASSETS.wallCornerSE)).setOrigin(0));
  }

  private addShapedWallFrame(container: Phaser.GameObjects.Container, room: GraphNode): void {
    const points = this.roomBoundaryPoints(room);
    for (let index = 0; index < points.length; index += 1) {
      this.addWallSegment(container, points[index]!, points[(index + 1) % points.length]!);
    }
  }

  private roomBoundaryPoints(room: GraphNode): Point[] {
    const left = room.x - room.width / 2;
    const right = room.x + room.width / 2;
    const top = room.y - room.height / 2;
    const bottom = room.y + room.height / 2;
    if (room.shape === "octagon") {
      const cut = Math.min(room.width, room.height) * 0.18;
      return [
        { x: left + cut, y: top }, { x: right - cut, y: top },
        { x: right, y: top + cut }, { x: right, y: bottom - cut },
        { x: right - cut, y: bottom }, { x: left + cut, y: bottom },
        { x: left, y: bottom - cut }, { x: left, y: top + cut },
      ];
    }

    const radius = Math.min(room.width, room.height) / 2;
    const steps = 8;
    const points: Point[] = [];
    if (room.width >= room.height) {
      const rightCenter = { x: right - radius, y: room.y };
      const leftCenter = { x: left + radius, y: room.y };
      for (let index = 0; index <= steps; index += 1) {
        const angle = -Math.PI / 2 + Math.PI * index / steps;
        points.push({ x: rightCenter.x + Math.cos(angle) * radius, y: rightCenter.y + Math.sin(angle) * radius });
      }
      for (let index = 0; index <= steps; index += 1) {
        const angle = Math.PI / 2 + Math.PI * index / steps;
        points.push({ x: leftCenter.x + Math.cos(angle) * radius, y: leftCenter.y + Math.sin(angle) * radius });
      }
      return points;
    }

    const topCenter = { x: room.x, y: top + radius };
    const bottomCenter = { x: room.x, y: bottom - radius };
    for (let index = 0; index <= steps; index += 1) {
      const angle = Math.PI + Math.PI * index / steps;
      points.push({ x: topCenter.x + Math.cos(angle) * radius, y: topCenter.y + Math.sin(angle) * radius });
    }
    for (let index = 0; index <= steps; index += 1) {
      const angle = Math.PI * index / steps;
      points.push({ x: bottomCenter.x + Math.cos(angle) * radius, y: bottomCenter.y + Math.sin(angle) * radius });
    }
    return points;
  }

  private addWallSegment(container: Phaser.GameObjects.Container, start: Point, end: Point): void {
    const scene = this.scene!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const x = (start.x + end.x) / 2;
    const y = (start.y + end.y) / 2;
    if (Math.abs(dx) < 0.5) {
      container.add(scene.add.tileSprite(x, y, WALL_THICKNESS, length, textureKey(ASSETS.wallVertical)).setOrigin(0.5));
      return;
    }
    const wall = scene.add.tileSprite(x, y, length, WALL_THICKNESS, textureKey(ASSETS.wallHorizontal)).setOrigin(0.5);
    wall.setRotation(Math.atan2(dy, dx));
    container.add(wall);
  }

  private createDoor(position: Point, side: "N" | "E" | "S" | "W"): Phaser.GameObjects.Container {
    const scene = this.scene!;
    const container = scene.add.container(0, 0);
    if (side === "N" || side === "S") {
      container.add(scene.add.tileSprite(position.x, position.y, TILE_SIZE, WALL_THICKNESS, textureKey(ASSETS.floorPlain)).setOrigin(0.5));
      container.add(scene.add.image(position.x, position.y, textureKey(ASSETS.doorOpenHorizontal)).setOrigin(0.5));
      return container;
    }
    container.add(scene.add.tileSprite(position.x, position.y, WALL_THICKNESS, TILE_SIZE, textureKey(ASSETS.floorPlain)).setOrigin(0.5));
    container.add(scene.add.image(position.x, position.y, textureKey(ASSETS.doorOpenVertical)).setOrigin(0.5));
    return container;
  }

  private opposite(direction: "N" | "E" | "S" | "W"): "N" | "E" | "S" | "W" {
    return ({ N: "S", E: "W", S: "N", W: "E" } as const)[direction];
  }

  private rememberStatic<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.staticObjects.push(object);
    return object;
  }

  private destroyStaticObjects(): void {
    for (const object of this.staticObjects) object.destroy();
    this.staticObjects.length = 0;
    this.roomLayers.clear();
    this.corridorLayers.clear();
  }

  private drawRoom(graphics: Phaser.GameObjects.Graphics, room: GraphNode, stroke: boolean): void {
    const left = room.x - room.width / 2;
    const top = room.y - room.height / 2;
    if (room.shape === "capsule") {
      const radius = Math.min(room.width, room.height) / 2;
      graphics.fillRoundedRect(left, top, room.width, room.height, radius);
      if (stroke) graphics.strokeRoundedRect(left, top, room.width, room.height, radius);
      return;
    }
    if (room.shape === "octagon") {
      const cut = Math.min(room.width, room.height) * 0.18;
      const points = [
        new Phaser.Math.Vector2(left + cut, top), new Phaser.Math.Vector2(left + room.width - cut, top),
        new Phaser.Math.Vector2(left + room.width, top + cut), new Phaser.Math.Vector2(left + room.width, top + room.height - cut),
        new Phaser.Math.Vector2(left + room.width - cut, top + room.height), new Phaser.Math.Vector2(left + cut, top + room.height),
        new Phaser.Math.Vector2(left, top + room.height - cut), new Phaser.Math.Vector2(left, top + cut),
      ];
      graphics.fillPoints(points, true);
      if (stroke) graphics.strokePoints(points, true);
      return;
    }
    graphics.fillRect(left, top, room.width, room.height);
    if (stroke) graphics.strokeRect(left, top, room.width, room.height);
  }

  renderDecorations(items: readonly Decoration[], visited: ReadonlySet<number>): void {
    this.currentDecorations = items.map(item => ({ ...item }));
    this.host.dataset.activeSpawners = String(items.filter(item =>
      item.spawner && !item.destroyed && visited.has(item.roomId)
    ).length);
    this.destroyAll(this.decorations);
    const scene = this.scene;
    if (!scene) return;
    for (const item of items) {
      if (!visited.has(item.roomId) || item.destroyed) continue;
      const sprite = scene.add.image(0, 0, textureKey(item.asset));
      sprite.setDisplaySize(item.size * sprite.width / sprite.height, item.size).setOrigin(0.5);
      const container = scene.add.container(item.x, item.y, [sprite]).setDepth(20);
      if (item.spawner) {
        sprite.setTint(0xe77cff);
        const field = scene.add.circle(0, 0, item.radius + world(8), 0x7d2c91, 0.22)
          .setStrokeStyle(world(2), 0xf09cff, 0.85);
        container.addAt(field, 0);
      }
      if (item.obstacle) {
        const barWidth = Math.max(world(44), item.size * 0.62);
        const barY = -item.size / 2 - world(8);
        const bg = scene.add.rectangle(-barWidth / 2, barY, barWidth, world(5), 0x071018).setOrigin(0, 0.5);
        const hp = scene.add.rectangle(
          -barWidth / 2,
          barY,
          barWidth * Math.max(0, item.hp) / Math.max(1, item.maxHp),
          world(5),
          0x62e6c8,
        ).setOrigin(0, 0.5);
        container.add([bg, hp]);
      }
      this.decorations.push(container);
    }
  }

  renderObjects(
    stairs: readonly Stair[],
    loot: readonly LootItem[],
    visited: ReadonlySet<number>,
    lootAssets: Partial<Record<LootKind, string>>,
  ): void {
    this.currentStairs = stairs.map(item => ({ ...item }));
    this.currentLoot = loot.map(item => ({ ...item }));
    this.currentLootAssets = lootAssets;
    const visibleItems = loot.filter(item => visited.has(item.roomId));
    const byDistance = (left: LootItem, right: LootItem): number =>
      Math.hypot(left.x - this.currentPlayer.x, left.y - this.currentPlayer.y) -
      Math.hypot(right.x - this.currentPlayer.x, right.y - this.currentPlayer.y);
    const visibleWeapon = visibleItems
      .filter(item => item.kind === "weapon" && item.weapon)
      .sort(byDistance)[0];
    const visibleLoot = visibleItems
      .filter(item => item.kind !== "weapon")
      .sort(byDistance)[0];
    this.host.dataset.availableWeapons = String(visibleItems.filter(item => item.kind === "weapon").length);
    if (visibleWeapon?.weapon) {
      this.host.dataset.firstWeaponX = String(Math.round(visibleWeapon.x));
      this.host.dataset.firstWeaponY = String(Math.round(visibleWeapon.y));
      this.host.dataset.firstWeaponKind = visibleWeapon.weapon.kind;
    } else {
      delete this.host.dataset.firstWeaponX;
      delete this.host.dataset.firstWeaponY;
      delete this.host.dataset.firstWeaponKind;
    }
    if (visibleLoot) {
      this.host.dataset.firstLootX = String(Math.round(visibleLoot.x));
      this.host.dataset.firstLootY = String(Math.round(visibleLoot.y));
      this.host.dataset.firstLootKind = visibleLoot.kind;
    } else {
      delete this.host.dataset.firstLootX;
      delete this.host.dataset.firstLootY;
      delete this.host.dataset.firstLootKind;
    }
    this.destroyAll(this.objects);
    const scene = this.scene;
    if (!scene) return;
    for (const stair of stairs) {
      if (!visited.has(stair.roomId)) continue;
      const ring = scene.add.circle(0, 0, world(27), stair.type === "up" ? 0x183a48 : 0x2b2145, stair.enabled ? 0.95 : 0.35)
        .setStrokeStyle(world(3), stair.type === "up" ? 0x62e6c8 : 0xc07cff);
      const marker = scene.add.text(0, stair.type === "up" ? -world(3) : world(3), stair.type === "up" ? "▲" : "▼", {
        color: stair.type === "up" ? "#62e6c8" : "#d9a3ff", fontSize: `${world(20)}px`, fontStyle: "bold",
      }).setOrigin(0.5);
      this.objects.push(scene.add.container(stair.x, stair.y, [ring, marker]).setDepth(15));
    }
    for (const item of loot) {
      if (!visited.has(item.roomId)) continue;
      if (item.kind === "weapon" && item.weapon) {
        const sprite = scene.add.image(0, 0, textureKey(WEAPON_ASSETS[item.weapon.kind]))
          .setDisplaySize(world(68), world(68));
        this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(25));
        continue;
      }
      const asset = lootAssets[item.kind];
      if (!asset) continue;
      const size = item.kind === "core" || item.kind === "crystal" || item.kind === "medkit"
        ? Math.round(world(50) * 1.25)
        : world(50);
      const sprite = scene.add.image(0, 0, textureKey(asset)).setDisplaySize(size, size);
      this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(25));
    }
  }

  renderMonsters(items: readonly Monster[], assetFor: (monster: Monster) => string): void {
    this.currentMonsters = items.map(item => ({ ...item }));
    this.currentMonsterAssetFor = assetFor;
    this.host.dataset.activeMonsters = String(items.filter(item => item.active && !item.dead).length);
    this.host.dataset.activeBosses = String(items.filter(item => item.active && item.bossKind && !item.dead).length);
    const activeBoss = items.find(item => item.active && item.bossKind && !item.dead);
    if (activeBoss?.bossKind) {
      this.host.dataset.activeBossKind = activeBoss.bossKind;
      this.host.dataset.activeBossX = String(Math.round(activeBoss.x));
      this.host.dataset.activeBossY = String(Math.round(activeBoss.y));
      this.host.dataset.activeBossRoom = String(activeBoss.roomId);
    } else {
      delete this.host.dataset.activeBossKind;
      delete this.host.dataset.activeBossX;
      delete this.host.dataset.activeBossY;
      delete this.host.dataset.activeBossRoom;
    }
    const scene = this.scene;
    if (!scene) return;
    const visibleIds = new Set(items.filter(item => item.active && (!item.dead || item.deathAnimating)).map(item => item.id));
    for (const [id, object] of this.monsters) {
      if (!visibleIds.has(id)) {
        object.destroy(true);
        this.monsters.delete(id);
      }
    }
    for (const item of items) {
      if (!visibleIds.has(item.id)) continue;
      let container = this.monsters.get(item.id);
      if (!container) {
        const assetKey = textureKey(assetFor(item));
        const sprite = scene.add.image(0, 0, assetKey)
          .setDisplaySize(item.size, item.size)
          .setOrigin(0.5)
          .setName("sprite");
        const barWidth = item.bossKind ? item.size * 0.68 : item.size * 0.6;
        const barY = -item.size / 2 - world(10);
        const children: Phaser.GameObjects.GameObject[] = [];
        if (item.bossKind) {
          const bossColors = { "packet-storm": 0xd975ff, "fork-bomb": 0x55e3cf, "heap-titan": 0xff8b4d };
          const color = bossColors[item.bossKind];
          children.push(scene.add.circle(0, 0, item.radius + world(11), color, 0.16)
            .setStrokeStyle(world(3), color, 0.8));
        }
        children.push(sprite);
        children.push(scene.add.rectangle(-barWidth / 2, barY, barWidth, item.bossKind ? world(9) : world(5), 0x071018).setOrigin(0, 0.5));
        children.push(scene.add.rectangle(-barWidth / 2, barY, barWidth, item.bossKind ? world(7) : world(5), item.bossKind ? 0xf09cff : item.kind === "sentry" ? 0xc07cff : 0xff6b6b).setOrigin(0, 0.5).setName("hp"));
        if (item.bossKind) {
          const labels = { "packet-storm": "PACKET STORM", "fork-bomb": "FORK BOMB", "heap-titan": "HEAP TITAN" };
          children.push(scene.add.text(0, barY - 13, labels[item.bossKind], {
            color: "#f7ddff", fontSize: `${world(11)}px`, fontStyle: "bold",
          }).setOrigin(0.5));
        }
        container = scene.add.container(item.x, item.y, children).setDepth(30);
        container.setData("hpWidth", barWidth);
        this.monsters.set(item.id, container);
      }
      container.setPosition(item.x, item.y).setAlpha(item.deathAnimating ? 0.35 : 1);
      const sprite = container.getByName("sprite") as Phaser.GameObjects.Image;
      const assetKey = textureKey(assetFor(item));
      if (scene.textures.exists(assetKey) && sprite.texture.key !== assetKey) sprite.setTexture(assetKey);
      const hp = container.getByName("hp") as Phaser.GameObjects.Rectangle;
      hp.width = Number(container.getData("hpWidth") ?? world(40)) * Math.max(0, item.hp) / Math.max(1, item.maxHp);
    }
  }

  updateMonsterPositions(items: readonly Monster[]): void {
    for (const item of items) {
      const container = this.monsters.get(item.id);
      if (!container) continue;
      container.setPosition(item.x, item.y);
      const sprite = container.getByName("sprite") as Phaser.GameObjects.Image;
      const assetKey = textureKey(this.currentMonsterAssetFor(item));
      if (this.scene?.textures.exists(assetKey) && sprite.texture.key !== assetKey) sprite.setTexture(assetKey);
      const hp = container.getByName("hp") as Phaser.GameObjects.Rectangle;
      hp.width = Number(container.getData("hpWidth") ?? world(40)) * Math.max(0, item.hp) / Math.max(1, item.maxHp);
    }
  }

  renderBullets(items: readonly Bullet[]): void {
    this.currentBullets = items.map(item => ({ ...item }));
    this.host.dataset.bullets = String(items.length);
    if (!this.scene) return;
    this.bulletsGraphics ??= this.scene.add.graphics().setDepth(40);
    this.bulletsGraphics.clear();
    for (const bullet of items) {
      const color = bullet.style === "shockwave"
        ? 0xffa34d
        : bullet.style === "boss"
          ? 0xee78ff
          : bullet.owner === "enemy"
            ? 0xff596e
            : bullet.weaponKind
              ? WEAPON_COLORS[bullet.weaponKind]
              : 0x86fff0;
      this.bulletsGraphics.fillStyle(color, 1);
      this.bulletsGraphics.fillCircle(bullet.x, bullet.y, bullet.radius ?? BULLET_RADIUS);
    }
  }

  setPlayer(position: Point, hp: number, maxHp: number, asset: string): void {
    this.currentPlayer = { ...position };
    this.currentPlayerHp = hp;
    this.currentPlayerMaxHp = maxHp;
    this.currentPlayerAsset = asset;
    this.host.dataset.playerAsset = asset;
    this.host.dataset.playerX = String(Math.round(position.x));
    this.host.dataset.playerY = String(Math.round(position.y));
    const scene = this.scene;
    if (!scene) return;
    if (!this.player) {
      this.playerSprite = scene.add.image(0, 0, textureKey(asset))
        .setDisplaySize(PLAYER_SPRITE_SIZE, PLAYER_SPRITE_SIZE)
        .setOrigin(0.5);
      const barWidth = world(68);
      const barY = -PLAYER_SPRITE_SIZE / 2 - world(10);
      const bg = scene.add.rectangle(-barWidth / 2 - 1, barY, barWidth + 2, world(7), 0x071018).setOrigin(0, 0.5);
      this.playerHpFill = scene.add.rectangle(-barWidth / 2, barY, barWidth, world(5), 0x62e6c8).setOrigin(0, 0.5);
      this.player = scene.add.container(position.x, position.y, [this.playerSprite, bg, this.playerHpFill]).setDepth(50);
    }
    this.player.setPosition(position.x, position.y);
    this.playerHpFill!.width = world(68) * Math.max(0, hp) / Math.max(1, maxHp);
    if (scene.textures.exists(textureKey(asset))) this.playerSprite!.setTexture(textureKey(asset));
  }

  setPlayerAsset(asset: string): void {
    this.currentPlayerAsset = asset;
    this.host.dataset.playerAsset = asset;
    if (this.playerSprite && this.scene?.textures.exists(textureKey(asset))) this.playerSprite.setTexture(textureKey(asset));
  }

  flashPlayer(): void {
    if (!this.player || !this.scene) return;
    this.scene.tweens.add({ targets: this.player, alpha: 0.25, duration: 60, yoyo: true });
  }

  spawnExplosion(x: number, y: number): void {
    const scene = this.scene;
    if (!scene) return;
    const blast = scene.add.image(x, y, textureKey(EXPLOSION_FRAMES[0]!))
      .setDisplaySize(world(118), world(118))
      .setDepth(45);
    let frameIndex = 0;
    scene.time.addEvent({
      delay: 1_000 / 12,
      repeat: EXPLOSION_FRAMES.length - 1,
      callback: () => {
        if (frameIndex >= EXPLOSION_FRAMES.length - 1) {
          blast.destroy();
          return;
        }
        frameIndex += 1;
        blast.setTexture(textureKey(EXPLOSION_FRAMES[frameIndex]!));
      },
    });
  }

  centerCamera(position: Point): void {
    this.currentPlayer = { ...position };
    this.scene?.cameras.main.centerOn(position.x, position.y);
  }

  viewportSize(): { width: number; height: number } {
    return { width: Math.max(1, this.host.clientWidth), height: Math.max(1, this.host.clientHeight) };
  }

  private destroyAll(objects: Phaser.GameObjects.Container[]): void {
    for (const object of objects) object.destroy(true);
    objects.length = 0;
  }
}
