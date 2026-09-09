import Phaser from "phaser";
import { ASSETS, BULLET_RADIUS, CAMERA_SCALE, PLAYER_FRAMES } from "../config";
import type {
  Bullet,
  Decoration,
  DungeonLayout,
  GraphNode,
  LootItem,
  Monster,
  Point,
  Stair,
} from "../types";

const textureKey = (asset: string): string => `asset:${asset}`;

export class PhaserRenderer {
  private game: Phaser.Game | null = null;
  private scene: Phaser.Scene | null = null;
  private layout: DungeonLayout | null = null;
  private visited = new Set<number>();
  private staticGraphics: Phaser.GameObjects.Graphics | null = null;
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
  private currentLootAssets: Record<string, string> = {};
  private currentMonsterAssetFor: (monster: Monster) => string = () => ASSETS.monsterScout;

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
          ...Object.values(PLAYER_FRAMES).flatMap(actions => Object.values(actions).flat()),
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
      backgroundColor: "#071018",
      render: { antialias: true, pixelArt: false },
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
    this.staticGraphics?.clear();
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
    this.drawWorld();
  }

  private drawWorld(): void {
    const scene = this.scene;
    if (!scene || !this.layout) return;
    this.staticGraphics?.destroy();
    const graphics = scene.add.graphics().setDepth(0);
    this.staticGraphics = graphics;

    for (const link of this.layout.links) {
      const visible = this.visited.has(link.source.id) || this.visited.has(link.target.id);
      const points = link.points.map(point => new Phaser.Math.Vector2(point.x, point.y));
      graphics.lineStyle(link.width + 18, visible ? 0x172a37 : 0x0b141d, visible ? 1 : 0.42);
      graphics.strokePoints(points, false, false);
      graphics.lineStyle(2, 0x3b6d82, visible ? 0.62 : 0.08);
      graphics.strokePoints(points, false, false);
    }

    for (const room of this.layout.nodes) {
      const visible = this.visited.has(room.id);
      const fill = room.isRoot ? 0x162e3a : 0x121c27;
      graphics.fillStyle(visible ? fill : 0x080d13, visible ? 1 : 0.6);
      graphics.lineStyle(room.isRoot ? 5 : 3, room.isRoot ? 0x55d6be : 0x315267, visible ? 0.95 : 0.16);
      this.drawRoom(graphics, room, true);
      if (visible) {
        graphics.lineStyle(1, 0x253747, 0.65);
        for (let x = room.x - room.width / 2 + 34; x < room.x + room.width / 2; x += 34) {
          graphics.lineBetween(x, room.y - room.height / 2 + 16, x, room.y + room.height / 2 - 16);
        }
      }
    }
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
      const sprite = scene.add.image(0, 0, textureKey(item.asset)).setDisplaySize(item.size, item.size);
      const container = scene.add.container(item.x, item.y, [sprite]).setDepth(20);
      if (item.spawner) {
        sprite.setTint(0xe77cff);
        const field = scene.add.circle(0, 0, item.radius + 8, 0x7d2c91, 0.22).setStrokeStyle(2, 0xf09cff, 0.85);
        container.addAt(field, 0);
      }
      if (item.obstacle) {
        const bg = scene.add.rectangle(-22, -35, 44, 5, 0x071018).setOrigin(0, 0.5);
        const hp = scene.add.rectangle(-22, -35, 44 * Math.max(0, item.hp) / Math.max(1, item.maxHp), 5, 0x62e6c8).setOrigin(0, 0.5);
        container.add([bg, hp]);
      }
      this.decorations.push(container);
    }
  }

  renderObjects(stairs: readonly Stair[], loot: readonly LootItem[], visited: ReadonlySet<number>, lootAssets: Record<string, string>): void {
    this.currentStairs = stairs.map(item => ({ ...item }));
    this.currentLoot = loot.map(item => ({ ...item }));
    this.currentLootAssets = lootAssets;
    this.destroyAll(this.objects);
    const scene = this.scene;
    if (!scene) return;
    for (const stair of stairs) {
      if (!visited.has(stair.roomId)) continue;
      const ring = scene.add.circle(0, 0, 27, stair.type === "up" ? 0x183a48 : 0x2b2145, stair.enabled ? 0.95 : 0.35)
        .setStrokeStyle(3, stair.type === "up" ? 0x62e6c8 : 0xc07cff);
      const marker = scene.add.text(0, stair.type === "up" ? -3 : 3, stair.type === "up" ? "▲" : "▼", {
        color: stair.type === "up" ? "#62e6c8" : "#d9a3ff", fontSize: "20px", fontStyle: "bold",
      }).setOrigin(0.5);
      this.objects.push(scene.add.container(stair.x, stair.y, [ring, marker]).setDepth(15));
    }
    for (const item of loot) {
      if (!visited.has(item.roomId)) continue;
      const asset = lootAssets[item.kind];
      if (!asset) continue;
      const sprite = scene.add.image(0, 0, textureKey(asset)).setDisplaySize(42, 42);
      this.objects.push(scene.add.container(item.x, item.y, [sprite]).setDepth(25));
    }
  }

  renderMonsters(items: readonly Monster[], assetFor: (monster: Monster) => string): void {
    this.currentMonsters = items.map(item => ({ ...item }));
    this.currentMonsterAssetFor = assetFor;
    this.host.dataset.activeMonsters = String(items.filter(item => item.active && !item.dead).length);
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
        const frame = scene.textures.getFrame(assetKey);
        const cropTop = Math.ceil(frame.height * 0.14);
        const sprite = scene.add.image(0, 0, assetKey)
          .setCrop(0, cropTop, frame.width, frame.height - cropTop)
          .setDisplaySize(62, 62)
          .setName("sprite");
        const bg = scene.add.rectangle(-20, -34, 40, 5, 0x071018).setOrigin(0, 0.5);
        const hp = scene.add.rectangle(-20, -34, 40, 5, item.kind === "sentry" ? 0xc07cff : 0xff6b6b).setOrigin(0, 0.5).setName("hp");
        container = scene.add.container(item.x, item.y, [sprite, bg, hp]).setDepth(30);
        this.monsters.set(item.id, container);
      }
      container.setPosition(item.x, item.y).setAlpha(item.deathAnimating ? 0.35 : 1);
      const hp = container.getByName("hp") as Phaser.GameObjects.Rectangle;
      hp.width = 40 * Math.max(0, item.hp) / Math.max(1, item.maxHp);
    }
  }

  updateMonsterPositions(items: readonly Monster[]): void {
    for (const item of items) {
      const container = this.monsters.get(item.id);
      if (!container) continue;
      container.setPosition(item.x, item.y);
      const hp = container.getByName("hp") as Phaser.GameObjects.Rectangle;
      hp.width = 40 * Math.max(0, item.hp) / Math.max(1, item.maxHp);
    }
  }

  renderBullets(items: readonly Bullet[]): void {
    this.currentBullets = items.map(item => ({ ...item }));
    this.host.dataset.bullets = String(items.length);
    if (!this.scene) return;
    this.bulletsGraphics ??= this.scene.add.graphics().setDepth(40);
    this.bulletsGraphics.clear();
    for (const bullet of items) {
      this.bulletsGraphics.fillStyle(bullet.owner === "enemy" ? 0xff596e : 0x86fff0, 1);
      this.bulletsGraphics.fillCircle(bullet.x, bullet.y, BULLET_RADIUS);
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
      this.playerSprite = scene.add.image(0, 0, textureKey(asset)).setDisplaySize(75, 100);
      const bg = scene.add.rectangle(-32, -49, 64, 7, 0x071018).setOrigin(0, 0.5);
      this.playerHpFill = scene.add.rectangle(-31, -49, 62, 5, 0x62e6c8).setOrigin(0, 0.5);
      this.player = scene.add.container(position.x, position.y, [this.playerSprite, bg, this.playerHpFill]).setDepth(50);
    }
    this.player.setPosition(position.x, position.y);
    this.playerHpFill!.width = 62 * Math.max(0, hp) / Math.max(1, maxHp);
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
    const blast = scene.add.circle(x, y, 12, 0xffd166, 0.9).setStrokeStyle(4, 0xff7755).setDepth(45);
    scene.tweens.add({
      targets: blast, scale: 3, alpha: 0, duration: 480,
      onComplete: () => blast.destroy(),
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
