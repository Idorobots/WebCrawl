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
export type PlayerAnimation = "normal" | "walk";
export type LootKind = "credit" | "crystal" | "core" | "medkit" | "energy" | "weapon";
export type BossKind = "packet-storm" | "fork-bomb" | "heap-titan" | "kimi-swarm" | "llama-herd";
export type RegularMonsterKind =
  | "melee-heavy"
  | "melee-light"
  | "shooter-light"
  | "shooter-heavy"
  | "sentry-light"
  | "sentry-heavy"
  | "sentry-scatter";
export type MonsterKind = RegularMonsterKind | BossKind;
export type MonsterVisualKind =
  | "scout"
  | "heavy"
  | "sentry-ballistic"
  | "sentry-twin"
  | "sentry-energy"
  | "boss-arc"
  | "boss-missile"
  | "boss-fortress"
  | "boss-laser"
  | "boss-siege";
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
export type SpriteDirection = "up" | "down" | "left" | "right";
export type MonsterAnimation = "normal" | "walk" | "melee" | "ranged";
export type MonsterAttackKind = "melee" | "ranged";
export type MonsterAttackPattern = "melee" | "single" | "double" | "scatter";
export type VisualEvent = "damage" | "destroy" | "spawn" | "healing" | "teleport";
export type WeaponPlacement = "pedestal" | "floor";

export interface Point {
  x: number;
  y: number;
}

export interface SpriteClip {
  frames: readonly string[];
  frameDurationMs: number;
  sizeScale: number;
  origin: Point;
  loop?: boolean;
  holdLast?: boolean;
  eventFrame?: number;
  light?: {
    color: number;
    radiusScale: number;
    intensity: number;
  };
}

export interface DirectionalSpriteVisual {
  normal: SpriteClip;
  walk?: SpriteClip;
  melee?: SpriteClip;
  ranged?: SpriteClip;
}

export interface ActorVisualDefinition {
  directions: Readonly<Record<string, DirectionalSpriteVisual>>;
  effects?: Partial<Record<VisualEvent, SpriteClip>>;
  destroyed?: readonly SpriteClip[];
}

export interface ObjectVisualDefinition {
  normal: SpriteClip;
  destroyed?: readonly SpriteClip[];
  animations?: Partial<Record<VisualEvent, SpriteClip>>;
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
  definitionId: string;
  roomId: number;
  kind: string;
  visual: ObjectVisualDefinition;
  visualVariant?: number;
  destructible: boolean;
  obstacle: boolean;
  radius: number;
  hitOffsetY: number;
  size: number;
  origin: { x: number; y: number };
  /** Fraction of the sprite height where opaque content starts; aligns health bars with the visible body. */
  healthBarTop?: number;
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
  spawnAnimationStartedAt?: number;
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
  visualKind: MonsterVisualKind;
  visual: ActorVisualDefinition;
  spawnRoomId: number;
  roomId: number;
  maxHp: number;
  hp: number;
  speed: number;
  fast: boolean;
  radius: number;
  size: number;
  bossKind?: BossKind;
  miniboss: boolean;
  attackPattern: MonsterAttackPattern;
  attackRange: number;
  attackDamage: number;
  attackCooldownMs: number;
  projectileSpeed: number;
  projectileRange: number;
  dropsLoot: boolean;
  lastAttackAt: number;
  attackKind?: MonsterAttackKind;
  active: boolean;
  dead: boolean;
  deathAnimating?: boolean;
  moving?: boolean;
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
  spawnSourceId?: string;
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
  /** Offset from the bullet's visual center to its game-field depth anchor. */
  depthOffsetY: number;
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
