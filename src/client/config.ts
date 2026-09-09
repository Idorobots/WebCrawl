import type { Direction, LootKind, PlayerAnimation, PlayerDirection } from "./types";

export const MAX_NODES = 450;
export const MAX_ROOMS_AFTER_COALESCE = 100;
export const MAX_CHILDREN_PER_ROOM = 3;

export const ROOM_WIDTH = 600;
export const ROOM_HEIGHT = 400;
export const ROOM_X_SPACING = 626;
export const ROOM_Y_SPACING = 426;
export const ROOM_COLLISION_MARGIN = 4;

export const PLAYER_RADIUS = 7;
export const PLAYER_SPEED = 220;
export const PLAYER_MAX_HP = 10;
export const PLAYER_FIRE_COOLDOWN_MS = 220;
export const BULLET_SPEED = 520;
export const BULLET_RADIUS = 5;
export const BULLET_MAX_DISTANCE = 900;
export const MONSTER_RADIUS = 16;
export const MONSTER_ATTACK_RANGE = 38;
export const CORRIDOR_HALF_WIDTH = 36;
export const STAIR_RADIUS = 25;
export const LOOT_RADIUS = 26;
export const CAMERA_SCALE = 0.92;
export const HIGH_SCORE_KEY = "alien-web-crawler-high-scores-v1";

export const DIRECTIONS: Record<Direction, {
  name: Direction;
  dx: number;
  dy: number;
  opposite: Direction;
}> = {
  N: { name: "N", dx: 0, dy: -1, opposite: "S" },
  E: { name: "E", dx: 1, dy: 0, opposite: "W" },
  S: { name: "S", dx: 0, dy: 1, opposite: "N" },
  W: { name: "W", dx: -1, dy: 0, opposite: "E" },
};

export const ASSETS = {
  playerRight: "assets/player_frames/east/walk/east_walk_01.png",
  playerLeft: "assets/player_frames/west/walk/west_walk_01.png",
  playerUp: "assets/player_frames/north/walk/north_walk_01.png",
  playerDown: "assets/player_frames/south/walk/south_walk_01.png",
  monsterFast: "assets/monster_fast.png",
  monsterSlow: "assets/monster_slow.png",
  monsterScout: "assets/monster_scout.png",
  lootCrystal: "assets/loot_crystal.png",
  lootMedkit: "assets/loot_medkit.png",
  lootCredit: "assets/loot_credit.png",
  lootCore: "assets/loot_core.png",
  decorPlant: "assets/decor_plant.png",
  decorBarrel: "assets/decor_barrel.png",
  decorCrate: "assets/decor_crate.png",
  decorTerminal: "assets/decor_terminal.png",
  decorDebris: "assets/decor_debris.png",
} as const;

const framePaths = (direction: string, action: PlayerAnimation, count: number): string[] =>
  Array.from({ length: count }, (_, index) =>
    `assets/player_frames/${direction}/${action}/${direction}_${action}_${String(index + 1).padStart(2, "0")}.png`,
  );

export const PLAYER_FRAMES: Record<PlayerDirection, Record<PlayerAnimation, string[]>> = {
  up: { walk: framePaths("north", "walk", 6), shoot: framePaths("north", "shoot", 4) },
  down: { walk: framePaths("south", "walk", 6), shoot: framePaths("south", "shoot", 4) },
  left: { walk: framePaths("west", "walk", 6), shoot: framePaths("west", "shoot", 4) },
  right: { walk: framePaths("east", "walk", 6), shoot: framePaths("east", "shoot", 4) },
};

export const LOOT_ASSETS: Record<LootKind, string> = {
  credit: ASSETS.lootCredit,
  crystal: ASSETS.lootCrystal,
  core: ASSETS.lootCore,
  medkit: ASSETS.lootMedkit,
};
