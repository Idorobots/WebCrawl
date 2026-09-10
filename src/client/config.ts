import type {
  Direction,
  LootKind,
  PlayerAnimation,
  PlayerDirection,
  WeaponKind,
} from "./types";

export const MAX_NODES = 450;
export const MAX_ROOMS_AFTER_COALESCE = 100;
export const MAX_CHILDREN_PER_ROOM = 10;

export const WORLD_SCALE = 1.6;
export const ROOM_WIDTH = 960;
export const ROOM_HEIGHT = 640;
export const ROOM_X_SPACING = 1_002;
export const ROOM_Y_SPACING = 682;
export const ROOM_COLLISION_MARGIN = 6;

export const PLAYER_RADIUS = 32;
export const PLAYER_SPRITE_SIZE = 160;
export const PLAYER_MUZZLE_DISTANCE = 68;
export const PLAYER_SPEED = 640;
export const PLAYER_MAX_HP = 10;
export const PLAYER_FIRE_COOLDOWN_MS = 220;
export const BULLET_SPEED = 832;
export const BULLET_RADIUS = 8;
export const BULLET_MAX_DISTANCE = 1_440;
export const MONSTER_RADIUS = 96;
export const CORRIDOR_HALF_WIDTH = 160;
export const MAX_CORRIDOR_LENGTH = 1_152;
export const STAIR_RADIUS = 44;
export const LOOT_RADIUS = 46;
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

const asset = (path: string): string => `assets_new/${path}`;

export const ASSETS = {
  playerRight: asset("player/idle/player_right.png"),
  playerLeft: asset("player/idle/player_left.png"),
  playerUp: asset("player/idle/player_back.png"),
  playerDown: asset("player/idle/player_front.png"),
  backgroundTechTile: asset("environment/background_tech_tile.png"),
  lootCrystal: asset("pickups/crystal.png"),
  lootMedkit: asset("pickups/medkit.png"),
  lootCredit: asset("pickups/gold.png"),
  lootCore: asset("props/ammo_energy.png"),
  decorPlant: asset("props/plant_large_violet.png"),
  decorPlantGreen: asset("props/plant_large_green.png"),
  decorPlantMagenta: asset("props/plant_magenta.png"),
  decorPlantTeal: asset("props/plant_small_teal.png"),
  decorPlantAmber: asset("props/plant_small_amber.png"),
  decorBarrel: asset("props/barrel_red.png"),
  decorBarrelCoolant: asset("props/barrel_coolant.png"),
  decorBarrelHazard: asset("props/barrel_hazard.png"),
  decorCrate: asset("props/crate.png"),
  decorTerminal: asset("props/terminal.png"),
  decorSceneryCrate: asset("props/crate_front.png"),
  decorSceneryTerminal: asset("props/terminal_front.png"),
  decorDebris: "assets/decor_debris.png",
} as const;

const walkFramePaths = (direction: string): string[] =>
  Array.from({ length: 4 }, (_, index) =>
    asset(`player/walk/${direction}/walk_${direction}_${String(index + 1).padStart(2, "0")}.png`),
  );

const playerFrames = (
  direction: string,
  idle: string,
): Record<PlayerAnimation, string[]> => ({
  walk: walkFramePaths(direction),
  shoot: [idle],
});

const diagonalIdle = (direction: string): string => walkFramePaths(direction)[0]!;

export const PLAYER_IDLE_ASSETS: Record<PlayerDirection, string> = {
  up: ASSETS.playerUp,
  upRight: diagonalIdle("NE"),
  right: ASSETS.playerRight,
  downRight: diagonalIdle("SE"),
  down: ASSETS.playerDown,
  downLeft: diagonalIdle("SW"),
  left: ASSETS.playerLeft,
  upLeft: diagonalIdle("NW"),
};

export const PLAYER_FRAMES: Record<PlayerDirection, Record<PlayerAnimation, string[]>> = {
  up: playerFrames("N", PLAYER_IDLE_ASSETS.up),
  upRight: playerFrames("NE", PLAYER_IDLE_ASSETS.upRight),
  right: playerFrames("E", PLAYER_IDLE_ASSETS.right),
  downRight: playerFrames("SE", PLAYER_IDLE_ASSETS.downRight),
  down: playerFrames("S", PLAYER_IDLE_ASSETS.down),
  downLeft: playerFrames("SW", PLAYER_IDLE_ASSETS.downLeft),
  left: playerFrames("W", PLAYER_IDLE_ASSETS.left),
  upLeft: playerFrames("NW", PLAYER_IDLE_ASSETS.upLeft),
};

export type SpriteDirection = "up" | "down" | "left" | "right";

const enemyViews = (directory: string, name: string): Record<SpriteDirection, string> => ({
  up: asset(`enemies/${directory}/${name}_back.png`),
  down: asset(`enemies/${directory}/${name}_front.png`),
  left: asset(`enemies/${directory}/${name}_left.png`),
  right: asset(`enemies/${directory}/${name}_right.png`),
});

export const MONSTER_ASSETS = {
  scout: enemyViews("scout", "scout"),
  heavy: enemyViews("heavy", "heavy"),
  sentryBallistic: enemyViews("sentry_ballistic", "sentry_ballistic"),
  sentryTwin: enemyViews("sentry_twin", "sentry_twin"),
  sentryEnergy: enemyViews("sentry_energy", "sentry_energy"),
  bossArc: enemyViews("boss_arc", "boss_arc"),
  bossMissile: enemyViews("boss_missile", "boss_missile"),
  bossFortress: enemyViews("boss_fortress", "boss_fortress"),
} as const;

export const WEAPON_ASSETS: Record<WeaponKind, string> = {
  "pulse-rifle": asset("pickups/weapons/weapon_assault_rifle.png"),
  "byte-repeater": asset("pickups/weapons/weapon_smg.png"),
  "scatter-array": asset("pickups/weapons/weapon_shotgun.png"),
  "fork-driver": asset("pickups/weapons/weapon_assault_rifle.png"),
  trident: asset("pickups/weapons/weapon_plasma.png"),
  "needle-rail": asset("pickups/weapons/weapon_sniper.png"),
  "packet-lobber": asset("pickups/weapons/weapon_rocket.png"),
  "cross-compiler": asset("pickups/weapons/weapon_laser.png"),
  "nova-cache": asset("pickups/weapons/weapon_flamer.png"),
  "helix-emitter": asset("pickups/weapons/weapon_arc.png"),
  "sideband-projector": asset("pickups/weapons/weapon_pistol.png"),
};

export const EXPLOSION_FRAMES = Array.from({ length: 6 }, (_, index) =>
  asset(`effects/explosion/explosion_${String(index + 1).padStart(2, "0")}.png`),
);

export const LOOT_ASSETS: Partial<Record<LootKind, string>> = {
  credit: ASSETS.lootCredit,
  crystal: ASSETS.lootCrystal,
  core: ASSETS.lootCore,
  medkit: ASSETS.lootMedkit,
};
