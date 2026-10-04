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
export type BossKind = "deepseek-summoner" | "qwen-teleporter" | "glm-hunter" | "kimi-spiral" | "hy4-wave";
export type RegularMonsterKind =
  | "melee-heavy"
  | "melee-light"
  | "shooter-light"
  | "shooter-heavy"
  | "sentry-light"
  | "sentry-heavy"
  | "sentry-scatter";
export type MonsterKind = RegularMonsterKind | BossKind;
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

/** Axis-aligned ellipse half-width and half-height in world pixels. */
export interface EllipseRadii extends Point {}

/** Object geometry, in specifications and runtime state: unitless fractions of `size`. */
export interface RelativeObjectGeometry {
  size: number;
  /** Whether the footprint blocks other actors' movement. */
  obstacle: boolean;
  /** Sprite center offset as a fraction of size. Visuals only. */
  visualOffset: Point;
  /** Damage hitbox center offset as a fraction of size. */
  hitboxOffset: Point;
  hitboxRadii: Point;
  /** Centered on the object's world position, regardless of blocking. */
  footprintRadii: Point;
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
  floorLabel: string;
  title: string;
  contentHtml: string | null;
  /** Disjoint, document-ordered readable content; absent on older hand-built graphs. */
  contentChunks?: ContentChunk[];
  width: number;
  height: number;
  lootSeed: number;
  isRoot: boolean;
  /** Selected combat arena on this floor, independent of the room's HTML tag. */
  isBossArena?: boolean;
  isHidden: boolean;
  parentSide: Direction | null;
  directionFromParent: Direction | null;
  shape: RoomShape;
  childCount: number;
}

export interface ContentChunk {
  order: number;
  html: string;
  label: string;
  /** Direct child subtree folded into the room displaying this chunk. */
  sourceSubtreeId?: number;
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
  targetDirection?: Direction;
  ownerRoomId: number;
  width: number;
  points: Point[];
  /** Rooms share a doorway; both points coincide and there is no corridor floor. */
  direct?: boolean;
  forkId?: string;
  forkPointIndex?: number;
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

export interface Decoration extends Point, RelativeObjectGeometry {
  id: string;
  definitionId: string;
  roomId: number;
  kind: string;
  visual: ObjectVisualDefinition;
  visualVariant?: number;
  destructible: boolean;
  maxHp: number;
  hp: number;
  destroyed: boolean;
  dropKind: LootKind | null;
  dropCount?: number;
  contentPoint?: boolean;
  contentUnlocked?: boolean;
  contentEnabled?: boolean;
  contentTurningOff?: boolean;
  spawner?: boolean;
  spawnIntervalMs?: number;
  spawnedCount?: number;
  nextSpawnAt?: number;
  /** Timestamp at which a started spawn sequence completes; set when the charge-up begins. */
  pendingSpawnAt?: number;
  spawnAnimationStartedAt?: number;
}

export interface ObstacleState {
  hp: number;
  destroyed: boolean;
  contentUnlocked?: boolean;
  contentEnabled?: boolean;
  spawnedCount?: number;
}

export interface Monster extends Point, RelativeObjectGeometry {
  id: string;
  seed: number;
  kind: MonsterKind;
  visual: ActorVisualDefinition;
  /** Wreck center offset as a fraction of size. */
  destroyedVisualOffset: Point;
  spriteSize: number;
  spawnRoomId: number;
  roomId: number;
  maxHp: number;
  hp: number;
  speed: number;
  fast: boolean;
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
  /** Timestamp before which the monster will not attack; set when it appears. */
  attackWarmupUntil?: number;
  attackKind?: MonsterAttackKind;
  active: boolean;
  dead: boolean;
  deathAnimating?: boolean;
  moving?: boolean;
  moveDir?: "up" | "down" | "left" | "right" | null;
  path?: Point[];
  pathIndex?: number;
  pathTargetRoomId?: number | null;
  pathPursuitRoomId?: number | null;
  pathTargetX?: number;
  pathTargetY?: number;
  nextPathRefreshAt?: number;
  lastPathSearchAt?: number;
  blockedMoveCount?: number;
  /** Keep the blocked route direction while a miniboss clears its obstacle. */
  blockedWaypoint?: Point;
  escapeDirection?: Point;
  escapeUntil?: number;
  attackSequence?: number;
  spawnSourceId?: string;
  summonedCount?: number;
  nextSpecialAt?: number;
  nextVolleyAt?: number;
  chargeWindupUntil?: number;
  chargeUntil?: number;
  chargeRecoverUntil?: number;
  chargeDirection?: Point;
  chargeHit?: boolean;
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
