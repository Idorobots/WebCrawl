import type {
  Direction,
  LootKind,
  MonsterAnimation,
  PlayerAnimation,
  PlayerDirection,
  WeaponKind,
} from "./types";

export const MAX_NODES = 450;
export const MAX_ROOMS_AFTER_COALESCE = 100;
export const MAX_CHILDREN_PER_ROOM = 10;

export const WORLD_SCALE = 1.8;
export const ROOM_WIDTH = 960;
export const ROOM_HEIGHT = 640;
export const ROOM_X_SPACING = 1_002;
export const ROOM_Y_SPACING = 682;
export const ROOM_COLLISION_MARGIN = 6;

export const PLAYER_RADIUS = 50;
export const PLAYER_SPRITE_SIZE = 320;
export const PLAYER_MUZZLE_DISTANCE = 30;
export const PLAYER_SPEED = 640;
export const PLAYER_MAX_HP = 10;
export const PLAYER_FIRE_COOLDOWN_MS = 220;
export const BULLET_SPEED = 832;
export const BULLET_RADIUS = 8;
export const BULLET_MAX_DISTANCE = 1_440;
export const MONSTER_RADIUS = 96;
export const CORRIDOR_HALF_WIDTH = 160;
export const MAX_CORRIDOR_LENGTH = 1_152;
export const STAIR_RADIUS = 56;
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

const asset = (path: string): string => `assets/${path}`;

export const ASSETS = {
  playerRight: asset("player/idle/player_right.png"),
  playerLeft: asset("player/idle/player_left.png"),
  playerUp: asset("player/idle/player_back.png"),
  playerDown: asset("player/idle/player_front.png"),
  backgroundTechTile: asset("environment/background_tech_tile.png"),
  floorPlain: asset("environment/rugged/floor_plate.png"),
  floorGrate: asset("environment/rugged/floor_grate.png"),
  floorHex: asset("environment/rugged/floor_hex.png"),
  floorHatch: asset("environment/rugged/floor_hatch.png"),
  floorTread: asset("environment/rugged/floor_tread.png"),
  floorAsteroidDust: asset("environment/rugged/floor_asteroid_dust.png"),
  wallHorizontal: asset("environment/rugged/wall_horizontal.png"),
  wallVertical: asset("environment/rugged/wall_vertical.png"),
  wallRibbedHorizontal: asset("environment/rugged/wall_ribbed.png"),
  wallRibbedVertical: asset("environment/rugged/wall_ribbed_vertical.png"),
  wallDamagedHorizontal: asset("environment/rugged/wall_damaged.png"),
  wallDamagedVertical: asset("environment/rugged/wall_damaged_vertical.png"),
  wallCorner: asset("environment/rugged/corner.png"),
  doorOpenHorizontal: asset("environment/rugged/door_open.png"),
  doorOpenVertical: asset("environment/rugged/door_open_vertical.png"),
  pedestal: asset("props/pedestal.png"),
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
  decorTerminal: asset("props/terminal_front.png"),
  decorSceneryCrate: asset("props/crate_front.png"),
  decorSceneryTerminal: asset("props/terminal_front.png"),
  decorDebris: asset("environment/rugged/floor_asteroid_dust.png"),
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
export type MonsterFrameSet = Record<SpriteDirection, Record<MonsterAnimation, readonly string[]>>;

const enemyViews = (directory: string, name: string): Record<SpriteDirection, string> => ({
  up: asset(`enemies/${directory}/${name}_back.png`),
  down: asset(`enemies/${directory}/${name}_front.png`),
  left: asset(`enemies/${directory}/${name}_left.png`),
  right: asset(`enemies/${directory}/${name}_right.png`),
});

const enemyActionFrames = (directory: string, action: "walk" | "attack"): string[] =>
  Array.from({ length: 4 }, (_, index) =>
    asset(`enemies/${directory}/${action}_front/frame_${String(index + 1).padStart(2, "0")}.png`),
  );

const enemyFrames = (
  directory: string,
  name: string,
  animated: { walk: boolean; attack: boolean },
): MonsterFrameSet => {
  const idle = enemyViews(directory, name);
  const oneFrame = (direction: SpriteDirection): Record<MonsterAnimation, readonly string[]> => ({
    idle: [idle[direction]],
    walk: [idle[direction]],
    attack: [idle[direction]],
  });
  return {
    up: oneFrame("up"),
    right: oneFrame("right"),
    left: oneFrame("left"),
    down: {
      idle: [idle.down],
      walk: animated.walk ? enemyActionFrames(directory, "walk") : [idle.down],
      attack: animated.attack ? enemyActionFrames(directory, "attack") : [idle.down],
    },
  };
};

export const MONSTER_FRAMES = {
  scout: enemyFrames("scout", "scout", { walk: true, attack: true }),
  heavy: enemyFrames("heavy", "heavy", { walk: true, attack: true }),
  sentryBallistic: enemyFrames("sentry_ballistic", "sentry_ballistic", { walk: false, attack: true }),
  sentryTwin: enemyFrames("sentry_twin", "sentry_twin", { walk: false, attack: true }),
  sentryEnergy: enemyFrames("sentry_energy", "sentry_energy", { walk: false, attack: true }),
  bossArc: enemyFrames("boss_arc", "boss_arc", { walk: true, attack: true }),
  bossMissile: enemyFrames("boss_missile", "boss_missile", { walk: true, attack: true }),
  bossFortress: enemyFrames("boss_fortress", "boss_fortress", { walk: true, attack: true }),
  bossLaser: enemyFrames("boss_laser", "boss_laser", { walk: true, attack: true }),
  bossSiege: enemyFrames("boss_siege", "boss_siege", { walk: true, attack: true }),
} as const satisfies Record<string, MonsterFrameSet>;

export const PORTAL_FRAMES = {
  up: [
    asset("portals/portal_up_inactive.png"),
    asset("portals/portal_up_activation_01.png"),
    asset("portals/portal_up_activation_02.png"),
    asset("portals/portal_up_active.png"),
  ],
  down: [
    asset("portals/portal_down_inactive.png"),
    asset("portals/portal_down_activation_01.png"),
    asset("portals/portal_down_activation_02.png"),
    asset("portals/portal_down_active.png"),
  ],
} as const;

export const WEAPON_ASSETS: Record<WeaponKind, string> = {
  "pulse-rifle": asset("pickups/weapons/assault_rifle.png"),
  "byte-repeater": asset("pickups/weapons/smg.png"),
  "scatter-array": asset("pickups/weapons/shotgun.png"),
  "fork-driver": asset("pickups/weapons/assault_rifle.png"),
  trident: asset("pickups/weapons/plasma.png"),
  "needle-rail": asset("pickups/weapons/sniper.png"),
  "packet-lobber": asset("pickups/weapons/rocket.png"),
  "cross-compiler": asset("pickups/weapons/laser.png"),
  "nova-cache": asset("pickups/weapons/flamer.png"),
  "helix-emitter": asset("pickups/weapons/arc.png"),
  "sideband-projector": asset("pickups/weapons/pistol.png"),
};

export const EXPLOSION_FRAMES = Array.from({ length: 6 }, (_, index) =>
  asset(`effects/explosion/explosion_${String(index + 1).padStart(2, "0")}.png`),
);

const effectFrames = (directory: string): string[] =>
  Array.from({ length: 4 }, (_, index) =>
    asset(`effects/${directory}/frame_${String(index + 1).padStart(2, "0")}.png`),
  );

export const EFFECT_FRAMES = {
  damage: effectFrames("damage"),
  healing: effectFrames("healing"),
  plantBreak: effectFrames("plant_break"),
  teleport: effectFrames("teleport"),
} as const;

export type EffectKind = keyof typeof EFFECT_FRAMES;

export const LOOT_ASSETS: Partial<Record<LootKind, string>> = {
  credit: ASSETS.lootCredit,
  crystal: ASSETS.lootCrystal,
  core: ASSETS.lootCore,
  medkit: ASSETS.lootMedkit,
};
