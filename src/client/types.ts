export type Direction = "N" | "E" | "S" | "W";
export type PlayerDirection = "up" | "down" | "left" | "right";
export type PlayerAnimation = "walk" | "shoot";
export type LootKind = "credit" | "crystal" | "core" | "medkit";

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
  source: GraphNode;
  target: GraphNode;
  direction: Direction;
}

export interface DungeonLayout {
  nodes: GraphNode[];
  links: LayoutLink[];
  hiddenCount: number;
}

export interface Stair extends Point {
  type: "up" | "down";
  roomId: number;
  url: string | null;
  enabled: boolean;
}

export interface LootItem extends Point {
  id: string;
  roomId: number;
  kind: LootKind;
}

export interface Decoration extends Point {
  id: string;
  roomId: number;
  kind: string;
  asset: string;
  obstacle: boolean;
  radius: number;
  size: number;
  maxHp: number;
  hp: number;
  destroyed: boolean;
}

export interface ObstacleState {
  hp: number;
  destroyed: boolean;
}

export interface Monster extends Point {
  id: string;
  seed: number;
  spawnRoomId: number;
  roomId: number;
  maxHp: number;
  hp: number;
  speed: number;
  fast: boolean;
  attackDamage: number;
  attackCooldownMs: number;
  dropsLoot: boolean;
  lastAttackAt: number;
  active: boolean;
  dead: boolean;
  deathAnimating?: boolean;
  moveDir?: "left" | "right" | null;
  droppedLoot?: boolean;
  dropId?: string | null;
  dropX?: number | null;
  dropY?: number | null;
  dropKind?: LootKind | null;
}

export interface MonsterState {
  hp: number;
  dead: boolean;
  active: boolean;
  droppedLoot: boolean;
  dropId: string | null;
  dropX: number | null;
  dropY: number | null;
  dropKind: LootKind | null;
}

export interface Bullet extends Point {
  id: string;
  vx: number;
  vy: number;
  traveled: number;
}

export interface RunStats {
  kills: number;
  fastKills: number;
  slowKills: number;
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
}
