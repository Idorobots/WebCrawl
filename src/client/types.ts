export type Direction = "N" | "E" | "S" | "W";
export type PlayerDirection =
  | "up"
  | "upRight"
  | "right"
  | "downRight"
  | "down"
  | "downLeft"
  | "left"
  | "upLeft";
export type PlayerAnimation = "walk" | "shoot";
export type LootKind = "credit" | "crystal" | "core" | "medkit" | "weapon";
export type BossKind = "packet-storm" | "fork-bomb" | "heap-titan";
export type MonsterKind = "slow" | "fast" | "sentry" | BossKind;
export type BulletOwner = "player" | "enemy";
export type BulletStyle = "player" | "enemy" | "boss" | "shockwave";
export type WeaponKind =
  | "pulse-rifle"
  | "byte-repeater"
  | "scatter-array"
  | "fork-driver"
  | "trident"
  | "needle-rail"
  | "packet-lobber"
  | "cross-compiler"
  | "nova-cache"
  | "helix-emitter"
  | "sideband-projector";
export type RoomShape = "rectangle" | "wide" | "tall" | "capsule" | "octagon";
export type MonsterAnimation = "idle" | "walk" | "attack";
export type WeaponPlacement = "pedestal" | "floor";

export interface Point {
  x: number;
  y: number;
}

export interface GraphNode extends Point {
  id: number;
  parentId: number | null;
  tag: string;
  depth: number;
  hrefs: string[];
  coalescedCount: number;
  label: string;
  title: string;
  width: number;
  height: number;
  lootSeed: number;
  isRoot: boolean;
  isHidden: boolean;
  parentSide: Direction | null;
  directionFromParent: Direction | null;
  shape: RoomShape;
  childCount: number;
}

export interface GraphLink {
  source: number;
  target: number;
}

export interface DungeonGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  originalCount: number;
  coalescedCount: number;
  truncated: boolean;
}

export interface LayoutLink {
  id: string;
  source: GraphNode;
  target: GraphNode;
  direction: Direction;
  ownerRoomId: number;
  width: number;
  points: Point[];
}

export interface DungeonLayout {
  nodes: GraphNode[];
  links: LayoutLink[];
  hiddenCount: number;
}

export interface Stair extends Point {
  id: string;
  type: "up" | "down";
  roomId: number;
  url: string | null;
  enabled: boolean;
}

export interface LootItem extends Point {
  id: string;
  roomId: number;
  kind: LootKind;
  weapon?: WeaponSpec;
  weaponAmmo?: number | null;
  weaponPlacement?: WeaponPlacement;
}

export interface WeaponSpec {
  kind: WeaponKind;
  name: string;
  fireCooldownMs: number;
  projectileSpeed: number;
  projectileRange: number;
  projectileRadius: number;
  damage: number;
  maxAmmo: number | null;
  ammoPerLoot: number;
}

export interface WeaponProjectile {
  direction: Point;
  lateralOffset: number;
  speed: number;
  range: number;
  radius: number;
  damage: number;
}

export interface Decoration extends Point {
  id: string;
  roomId: number;
  kind: string;
  asset: string;
  obstacle: boolean;
  radius: number;
  size: number;
  footprint?: number;
  maxHp: number;
  hp: number;
  destroyed: boolean;
  dropKind: LootKind | null;
  spawner?: boolean;
  spawnIntervalMs?: number;
  spawnLimit?: number;
  spawnedCount?: number;
  nextSpawnAt?: number;
}

export interface ObstacleState {
  hp: number;
  destroyed: boolean;
  spawnedCount?: number;
}

export interface Monster extends Point {
  id: string;
  seed: number;
   kind: MonsterKind;
  spawnRoomId: number;
  roomId: number;
  maxHp: number;
  hp: number;
  speed: number;
  fast: boolean;
  radius: number;
  size: number;
  bossKind?: BossKind;
  attackRange: number;
  attackDamage: number;
  attackCooldownMs: number;
  projectileSpeed: number;
  projectileRange: number;
  dropsLoot: boolean;
  lastAttackAt: number;
  active: boolean;
  dead: boolean;
  deathAnimating?: boolean;
  moveDir?: "up" | "down" | "left" | "right" | null;
  path?: Point[];
  pathIndex?: number;
  pathTargetRoomId?: number | null;
  pathTargetX?: number;
  pathTargetY?: number;
  nextPathRefreshAt?: number;
  blockedMoveCount?: number;
  escapeDirection?: Point;
  escapeUntil?: number;
  attackSequence?: number;
  summonedCount?: number;
  nextSpecialAt?: number;
  droppedLoot?: boolean;
  dropId?: string | null;
  dropX?: number | null;
  dropY?: number | null;
  dropKind?: LootKind | null;
}

export interface MonsterState {
  x: number;
  y: number;
  roomId: number;
  hp: number;
  dead: boolean;
  active: boolean;
  droppedLoot: boolean;
  dropId: string | null;
  dropX: number | null;
  dropY: number | null;
  dropKind: LootKind | null;
  attackSequence?: number;
  summonedCount?: number;
}

export interface Bullet extends Point {
  id: string;
  owner: BulletOwner;
  damage: number;
  vx: number;
  vy: number;
  traveled: number;
  radius?: number;
  maxDistance?: number;
  style?: BulletStyle;
  weaponKind?: WeaponKind;
}

export interface RunStats {
  kills: number;
  fastKills: number;
  slowKills: number;
  sentryKills?: number;
  bossKills?: number;
  shotsFired: number;
}

export interface HighScore extends RunStats {
  score: number;
  at: string;
}

export interface LoadPageOptions {
  pushCurrent?: boolean;
  popBack?: boolean;
  returnRoomId?: number | null;
  spawnRoomId?: number | null;
  stateId?: string | null;
}
