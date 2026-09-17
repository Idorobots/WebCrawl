import { fetchHtml, normalizeUrl } from "./api/fetch-html";
import {
  LOOT_ASSETS,
  MAX_NODES,
  PLAYER_DEFAULT_ASSETS,
  PLAYER_FRAMES,
  WEAPON_ASSETS,
  world,
} from "./config";
import {
  actorAimDirection,
  actorCollisionCenter,
  actorProjectileOrigin,
  applyObstacleDamage,
  enemyVolleyProjectiles,
  monsterAttackIsReady,
  monsterEngagementRange,
  projectileHitsCircle,
  projectileHitsDecoration,
} from "./domain/combat";
import {
  distanceSquared,
  pointInCorridor,
  pointInRoom,
  pointInRoomFloor,
  slideAlongObstacles,
} from "./domain/geometry";
import {
  buildDecorations as createDecorations,
  buildInteractiveObjects as createInteractiveObjects,
  buildMonsters as createMonsters,
  buildSceneryDrops as createSceneryDrops,
  bossLootDrops,
  lootKindForSeed,
  monsterSpecForBossSummon,
  monsterSpecForSpawner,
  weaponPedestalForRoom,
} from "./domain/generation";
import { domToGraph } from "./domain/graph";
import { layoutOrthogonal } from "./domain/layout";
import { aStarPath, monsterEscapeStep } from "./domain/pathfinding";
import { updatePortalContacts } from "./domain/portals";
import { scoreForRun, timedShieldState, type LootInventory } from "./domain/scoring";
import {
  CRYSTAL_INVULNERABILITY_BLINK_START_MS,
  CRYSTAL_INVULNERABILITY_DURATION_MS,
  DEFAULT_BULLET_SPEC,
  ENERGY_DASH_DAMAGE,
  ENERGY_DASH_RANGE,
  ENERGY_DASH_SPEED,
  HEAP_TITAN_WAVE,
  LOOT_DEFINITIONS,
  monsterVisualCenterOffsetY,
  PLAYER_ENERGY_MAX,
  PLAYER_SPEC,
  PORTAL_DEFINITION,
  WEAPON_PICKUP_DEFINITIONS,
  WORLD_GEOMETRY,
} from "./domain/specs";
import {
  DEFAULT_WEAPON,
  monsterDropsWeapon,
  projectilesForWeapon,
  replenishWeaponAmmo,
  weaponForMonster,
} from "./domain/weapons";
import { PhaserRenderer } from "./render/phaser-renderer";
import { loadHighScores, rankHighScore, storeHighScores } from "./storage/high-scores";
import type {
  Bullet,
  BulletStyle,
  Decoration,
  DungeonGraph,
  DungeonLayout,
  GraphNode,
  HighScore,
  LayoutLink,
  LoadPageOptions,
  LootItem,
  Monster,
  MonsterState,
  ObstacleState,
  PlayerAnimation,
  PlayerDirection,
  Point,
  RunStats,
  SpriteDirection,
  Stair,
  WeaponSpec,
} from "./types";
import { requireElement } from "./ui/elements";

const gameViewport = requireElement<HTMLElement>("#gameViewport");
const gameCanvasHost = requireElement<HTMLElement>("#gameCanvas");
const renderer = new PhaserRenderer(gameCanvasHost);
const urlInput = requireElement<HTMLInputElement>("#urlInput");
const form = requireElement<HTMLFormElement>("#urlForm");
const linkMenu = requireElement<HTMLDivElement>("#linkMenu");

const welcomeScreen = requireElement<HTMLDivElement>("#welcomeScreen");
const welcomeForm = requireElement<HTMLFormElement>("#welcomeForm");
const welcomeUrlInput = requireElement<HTMLInputElement>("#welcomeUrlInput");
const gameUi = requireElement<HTMLDivElement>("#gameUi");

const sideMinimapCanvas = requireElement<HTMLCanvasElement>("#sideMinimapCanvas");
const sideFloorLabelEl = requireElement<HTMLElement>("#sideFloorLabel");

let currentRequest = 0;
let currentPageUrl: string | null = null;
let currentStateId: string | null = null;
const navigationHistory: string[] = [];
const navigationReturnRooms: Array<number | null> = [];

let currentLayout: DungeonLayout | null = null;
let currentRoomsById = new Map<number, GraphNode>();
let currentStairs: Stair[] = [];
let currentLoot: LootItem[] = [];
let currentMonsters: Monster[] = [];
let currentDecorations: Decoration[] = [];
const destroyedObstaclesByPage = new Map<string, Map<string, ObstacleState>>();
let visitedRooms = new Set<number>();
let roomRoutingDirty = true;
let nextRoomTowardPlayer = new Map<number, number>();
const SPATIAL_CELL_SIZE = WORLD_GEOMETRY.spatialCellSize;
interface GeometryCell {
  rooms: Set<GraphNode>;
  links: Set<LayoutLink>;
}
let geometryCells = new Map<string, GeometryCell>();
let obstacleCells = new Map<string, Set<Decoration>>();
let damageableCells = new Map<string, Set<Decoration>>();
const discoveredRoomsByPage = new Map<string, Set<number>>();
const monsterStatesByPage = new Map<string, Map<string, MonsterState>>();

let currentRoomId: number | null = null;
let player: Point = { x: 0, y: 0 };
let playerFacing: Point = { x: 0, y: -1 };
let playerHp: number = PLAYER_SPEC.maxHp;
let playerAlive = true;
let playerInvulnerable = false;
let crystalInvulnerableUntil = 0;
let energyDash: {
  dirX: number;
  dirY: number;
  traveled: number;
  maxDistance: number;
  hitTargets: Set<string>;
  playerInvulnerableBefore: boolean;
} | null = null;
let lastPlayerShotAt = -Infinity;
let currentWeapon: WeaponSpec = { ...DEFAULT_WEAPON };
let currentWeaponAmmo: number | null = null;
let weaponShotSequence = 0;

let bullets: Bullet[] = [];
const extraLootByPage = new Map<string, LootItem[]>();
const extraLootSerialByPage = new Map<string, number>();
let lastDroppedWeapon: LootItem | null = null;
let queuedLootDrops: LootItem[] = [];
const temporarilyBlockedLoot = new Set<string>();

let gameAnimationFrame: number | null = null;
let lastGameTick: number | null = null;

const lootInventory: LootInventory = { credits: 0, crystals: 0, cores: 0, energy: 0, medkits: 0 };
const collectedLoot = new Set<string>();

const runStats: RunStats = {
  kills: 0,
  fastKills: 0,
  slowKills: 0,
  sentryKills: 0,
  bossKills: 0,
  shotsFired: 0
};

let playerWalkFrameIndex = 0;
let lastPlayerWalkFrameAt = -Infinity;
let playerSpriteAnimationToken = 0;
let playerMoving = false;
let playerShooting = false;
let currentPlayerSpriteAsset = PLAYER_DEFAULT_ASSETS.up;
let primaryPointerDown = false;
let pointerInViewport = false;
let portalTransitioning = false;
const portalContacts = new Set<string>();
const heldMovementKeys = new Set<string>();

const killsCountEl = document.querySelector<HTMLElement>("#killsCount");
const hudHealthFillEl = requireElement<HTMLElement>("#hudHealthFill");
const creditCountEl = requireElement<HTMLElement>("#creditCount");
const crystalCountEl = requireElement<HTMLElement>("#crystalCount");
const coreCountEl = requireElement<HTMLElement>("#coreCount");
const energyLootCountEl = requireElement<HTMLElement>("#energyLootCount");
const medkitCountEl = requireElement<HTMLElement>("#medkitCount");
const hudEnergyFillEl = requireElement<HTMLElement>("#hudEnergyFill");
const weaponNameEl = requireElement<HTMLElement>("#weaponName");
const hudAmmoFillEl = requireElement<HTMLElement>("#hudAmmoFill");
const weaponHudIconEl = requireElement<HTMLImageElement>("#weaponHudIcon");

const deathModal = requireElement<HTMLDivElement>("#deathModal");
const deathScoreEl = requireElement<HTMLElement>("#deathScore");
const newHighScoreEl = requireElement<HTMLElement>("#newHighScore");
const deathKillsEl = requireElement<HTMLElement>("#deathKills");
const deathFastKillsEl = requireElement<HTMLElement>("#deathFastKills");
const deathSlowKillsEl = requireElement<HTMLElement>("#deathSlowKills");
const deathSentryKillsEl = requireElement<HTMLElement>("#deathSentryKills");
const deathBossKillsEl = requireElement<HTMLElement>("#deathBossKills");
const deathShotsEl = requireElement<HTMLElement>("#deathShots");
const highScoreRowsEl = requireElement<HTMLTableSectionElement>("#highScoreRows");
const restartButton = requireElement<HTMLButtonElement>("#restartButton");

function setStatus(message: string, isError = false): void {
  if (isError) {
    console.error(`[WebCrawl] ${message}`);
  } else {
    console.log(`[WebCrawl] ${message}`);
  }
}

function hideLinkMenu(): void {
  linkMenu.hidden = true;
  linkMenu.replaceChildren();
}

function navigateTo(url: string, returnRoomId = currentRoomId): void {
  hideLinkMenu();
  urlInput.value = url;
  const nextStateId = stateIdForPage(url, floorNumber() + 1);
  loadPage(url, {
    pushCurrent: true,
    returnRoomId,
    stateId: nextStateId,
  });
}

function goBack(): void {
  const previous = navigationHistory[navigationHistory.length - 1];
  if (!previous) return;

  const returnRoomId =
    navigationReturnRooms[navigationReturnRooms.length - 1] ?? null;

  hideLinkMenu();
  urlInput.value = previous;
  const previousStateId = stateIdForPage(previous, Math.max(1, floorNumber() - 1));
  loadPage(previous, {
    popBack: true,
    spawnRoomId: returnRoomId,
    stateId: previousStateId,
  });
}

document.addEventListener("click", (event) => {
  if (event.target instanceof Node && !linkMenu.contains(event.target)) hideLinkMenu();
});

function roomContainingPoint(x: number, y: number): GraphNode | null {
  if (!currentLayout) return null;

  for (const room of currentLayout.nodes) {
    if (pointInRoom(x, y, room, 0)) return room;
  }

  return null;
}

function updateFogOfWar(): void {
  renderer.setFog(visitedRooms);

  if (!gameUi.hidden) {
    updateHudPanels();
  }
}

function markVisited(room: GraphNode | null): void {
  if (!room || visitedRooms.has(room.id)) return;

  visitedRooms.add(room.id);
  roomRoutingDirty = true;

  if (currentPageUrl) {
    discoveredRoomsByPage.set(currentStateId ?? currentPageUrl, new Set(visitedRooms));
  }

  updateFogOfWar();
  activateMonstersInRoom(room.id);
  renderDecorations();
  renderInteractiveObjects();
}

function corridorContainingPoint(x: number, y: number): LayoutLink | null {
  if (!currentLayout) return null;

  for (const link of currentLayout.links) {
    if (pointInCorridor(x, y, link, 0)) {
      return link;
    }
  }

  return null;
}

function revealRoomsFromCorridor(x: number, y: number): void {
  const link = corridorContainingPoint(x, y);
  if (!link) return;

  // If either end of this corridor is already known, reveal the other end.
  // This lets the player see/activate the destination before crossing a
  // doorway that might be obstructed by generated room props.
  const sourceVisited = visitedRooms.has(link.source.id);
  const targetVisited = visitedRooms.has(link.target.id);

  if (sourceVisited && !targetVisited) {
    markVisited(link.target);
  } else if (targetVisited && !sourceVisited) {
    markVisited(link.source);
  }
}

function updateCurrentRoom(): void {
  const room = roomContainingPoint(player.x, player.y);

  if (room) {
    const roomChanged = currentRoomId !== room.id;
    const alreadyVisited = visitedRooms.has(room.id);
    currentRoomId = room.id;
    gameCanvasHost.dataset.currentRoomTag = room.tag;
    if (roomChanged) roomRoutingDirty = true;
    markVisited(room);
    if (roomChanged && alreadyVisited && !gameUi.hidden) updateHudPanels();
  }
}

function updateCameraForPlayer(immediate = false): void {
  renderer.setCameraRoom(roomContainingPoint(player.x, player.y), immediate);
}

function minimapVisibleLayout(): Pick<DungeonLayout, "nodes" | "links"> {
  if (!currentLayout) return { nodes: [], links: [] };

  const visibleIds = new Set(
    currentLayout.nodes
      .filter(room => visitedRooms.has(room.id))
      .map(room => room.id)
  );

  return {
    nodes: currentLayout.nodes.filter(room => visibleIds.has(room.id)),
    links: currentLayout.links.filter(link =>
      visibleIds.has(link.source.id) || visibleIds.has(link.target.id)
    )
  };
}

function renderSideMinimap(): void {
  const { nodes, links } = minimapVisibleLayout();
  const visibleIds = new Set(nodes.map(node => node.id));
  const boundsRect = sideMinimapCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(boundsRect.width || sideMinimapCanvas.clientWidth || 320));
  const height = Math.max(1, Math.round(boundsRect.height || sideMinimapCanvas.clientHeight || 220));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  sideMinimapCanvas.width = Math.round(width * ratio);
  sideMinimapCanvas.height = Math.round(height * ratio);
  const context = sideMinimapCanvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#071018";
  context.fillRect(0, 0, width, height);
  if (!nodes.length) return;

  const bounds = nodes.reduce((acc, node) => ({
    minX: Math.min(acc.minX, node.x - node.width / 2),
    maxX: Math.max(acc.maxX, node.x + node.width / 2),
    minY: Math.min(acc.minY, node.y - node.height / 2),
    maxY: Math.max(acc.maxY, node.y + node.height / 2)
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity
  });

  for (const link of links) {
    for (const point of link.points) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
  }
  const pad = 18;
  const scale = Math.min(
    (width - pad * 2) / Math.max(1, bounds.maxX - bounds.minX),
    (height - pad * 2) / Math.max(1, bounds.maxY - bounds.minY),
  );
  const mapX = (x: number): number => pad + (x - bounds.minX) * scale;
  const mapY = (y: number): number => pad + (y - bounds.minY) * scale;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#315267";
  context.lineWidth = Math.max(2, 20 * scale);
  for (const link of links) {
    context.beginPath();
    link.points.forEach((point, index) => index
      ? context.lineTo(mapX(point.x), mapY(point.y))
      : context.moveTo(mapX(point.x), mapY(point.y))
    );
    context.stroke();
  }
  for (const room of nodes) {
    const x = mapX(room.x - room.width / 2);
    const y = mapY(room.y - room.height / 2);
    const roomWidth = Math.max(3, room.width * scale);
    const roomHeight = Math.max(3, room.height * scale);
    context.fillStyle = room.id === currentRoomId ? "#57d9c1" : room.isRoot ? "#244d59" : "#1a303e";
    context.fillRect(x, y, roomWidth, roomHeight);
    context.strokeStyle = room.id === currentRoomId ? "#bafff1" : "#568198";
    context.lineWidth = 1;
    context.strokeRect(x, y, roomWidth, roomHeight);
  }
  for (const stair of currentStairs.filter(item => visibleIds.has(item.roomId))) {
    context.fillStyle = stair.type === "up" ? "#62e6c8" : "#c07cff";
    context.beginPath();
    context.arc(mapX(stair.x), mapY(stair.y), 3, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(mapX(player.x), mapY(player.y), 4, 0, Math.PI * 2);
  context.fill();
}

function updateHudPanels(): void {
  const floor = navigationHistory.length + 1;
  const rooms = visitedRooms.size;

  sideFloorLabelEl.textContent = `FLOOR ${floor}`;
  gameCanvasHost.dataset.visitedRooms = String(rooms);
  gameCanvasHost.dataset.floor = String(floor);
  gameCanvasHost.dataset.kills = String(runStats.kills);
  gameCanvasHost.dataset.shotsFired = String(runStats.shotsFired);
  renderSideMinimap();
}

function floorNumber(): number {
  return navigationHistory.length + 1;
}

function stateIdForPage(url: string, floor = floorNumber()): string {
  return `${url}::floor-${floor}`;
}

function floorIdentity(pageUrl: string): string {
  return currentStateId ?? stateIdForPage(pageUrl);
}

function updateHealthUi(): void {
  const ratio = Math.max(0, Math.min(1, playerHp / PLAYER_SPEC.maxHp));
  hudHealthFillEl.style.width = `${ratio * 100}%`;

  renderer.setPlayer(player, playerHp, PLAYER_SPEC.maxHp, currentPlayerSpriteAsset);
}

function updateWeaponUi(): void {
  weaponNameEl.textContent = currentWeapon.name;
  weaponHudIconEl.src = WEAPON_ASSETS[currentWeapon.kind];
  const ammoRatio = currentWeaponAmmo === null
    ? 1
    : Math.max(0, Math.min(1, currentWeaponAmmo / Math.max(1, currentWeapon.maxAmmo ?? currentWeaponAmmo)));
  hudAmmoFillEl.style.width = `${ammoRatio * 100}%`;
  gameCanvasHost.dataset.weaponKind = currentWeapon.kind;
  gameCanvasHost.dataset.weaponAmmo = currentWeaponAmmo === null ? "infinite" : String(currentWeaponAmmo);
}

function updateLootUi(): void {
  creditCountEl.textContent = String(lootInventory.credits);
  crystalCountEl.textContent = String(lootInventory.crystals);
  coreCountEl.textContent = String(lootInventory.cores);
  energyLootCountEl.textContent = String(lootInventory.energy);
  medkitCountEl.textContent = String(lootInventory.medkits);
  gameCanvasHost.dataset.credits = String(lootInventory.credits);
  gameCanvasHost.dataset.crystals = String(lootInventory.crystals);
  gameCanvasHost.dataset.cores = String(lootInventory.cores);
  gameCanvasHost.dataset.energy = String(lootInventory.energy);
  gameCanvasHost.dataset.medkits = String(lootInventory.medkits);
  updateEnergyUi();
  updateHudPanels();
}

function updateEnergyUi(): void {
  const fill = Math.min(PLAYER_ENERGY_MAX, lootInventory.energy);
  hudEnergyFillEl.style.width = `${fill / PLAYER_ENERGY_MAX * 100}%`;
}

function isPlayerInvulnerable(now = performance.now()): boolean {
  return playerInvulnerable || now < crystalInvulnerableUntil;
}

function updatePlayerProtectionVisual(now = performance.now()): void {
  const timedShield = timedShieldState(
    crystalInvulnerableUntil,
    now,
    CRYSTAL_INVULNERABILITY_BLINK_START_MS,
  );
  const active = playerInvulnerable || timedShield.active;
  const tintVisible = playerInvulnerable || timedShield.tintVisible;
  renderer.setPlayerProtection(active, tintVisible);
}

function activateCrystalInvulnerability(now = performance.now()): boolean {
  if (!playerAlive || lootInventory.crystals <= 0) return false;
  lootInventory.crystals -= 1;
  crystalInvulnerableUntil = now + CRYSTAL_INVULNERABILITY_DURATION_MS;
  updateLootUi();
  updatePlayerProtectionVisual(now);
  setStatus("Crystal shield active for 10 seconds.");
  return true;
}

function equipWeapon(weapon: WeaponSpec): void {
  equipWeaponWithAmmo(weapon, weapon.maxAmmo);
}

function equipWeaponWithAmmo(weapon: WeaponSpec, ammo: number | null): void {
  currentWeapon = { ...weapon };
  currentWeaponAmmo = weapon.maxAmmo === null || ammo === null
    ? weapon.maxAmmo
    : Math.max(0, Math.min(weapon.maxAmmo, ammo));
  weaponShotSequence = 0;
  updateWeaponUi();
}

function equipDefaultWeapon(): void {
  equipWeapon(DEFAULT_WEAPON);
}

function lootReplenishesAmmo(item: LootItem): boolean {
  return item.kind === "core";
}

function extraLootForCurrentPage(): LootItem[] {
  if (!currentPageUrl) return [];
  const key = floorIdentity(currentPageUrl);
  const items = extraLootByPage.get(key);
  if (items) return items;
  const created: LootItem[] = [];
  extraLootByPage.set(key, created);
  return created;
}

function nextExtraLootId(prefix: string): string | null {
  if (!currentPageUrl) return null;
  const key = floorIdentity(currentPageUrl);
  const serial = (extraLootSerialByPage.get(key) ?? 0) + 1;
  extraLootSerialByPage.set(key, serial);
  return `${key}::${prefix}-${serial}`;
}

function persistDroppedWeapon(weapon: WeaponSpec, ammo: number, position: Point, roomId: number): void {
  if (!currentPageUrl || weapon.maxAmmo === null || ammo <= 0) return;
  const id = nextExtraLootId(`dropped-weapon::${weapon.kind}`);
  if (!id) return;
  const dropped: LootItem = {
    id,
    roomId,
    x: position.x,
    y: position.y,
    kind: "weapon",
    weapon: { ...weapon },
    weaponAmmo: ammo,
    weaponPlacement: "floor",
  };
  const items = extraLootForCurrentPage();
  if (items.some(item => item.id === dropped.id)) return;
  items.push(dropped);
  queuedLootDrops.push(dropped);
  temporarilyBlockedLoot.add(dropped.id);
  lastDroppedWeapon = dropped;
}

function recordHighScore(): { scores: HighScore[]; rank: number | null } {
  const entry: HighScore = {
    score: scoreForRun(lootInventory, runStats),
    kills: runStats.kills,
    fastKills: runStats.fastKills,
    slowKills: runStats.slowKills,
    sentryKills: runStats.sentryKills,
    bossKills: runStats.bossKills,
    shotsFired: runStats.shotsFired,
    at: new Date().toISOString()
  };

  const { scores, rank } = rankHighScore(loadHighScores(), entry);
  storeHighScores(scores);
  return { scores, rank };
}

function showDeathModal(): void {
  const { scores, rank } = recordHighScore();

  deathScoreEl.textContent = `Final score: ${scoreForRun(lootInventory, runStats)}`;
  deathKillsEl.textContent = String(runStats.kills);
  deathFastKillsEl.textContent = String(runStats.fastKills);
  deathSlowKillsEl.textContent = String(runStats.slowKills);
  deathSentryKillsEl.textContent = String(runStats.sentryKills ?? 0);
  deathBossKillsEl.textContent = String(runStats.bossKills ?? 0);
  deathShotsEl.textContent = String(runStats.shotsFired);

  newHighScoreEl.textContent =
    rank === 1
      ? "New expedition high score."
      : rank
        ? `Run placed #${rank}.`
        : "";

  highScoreRowsEl.replaceChildren();

  scores.slice(0, 5).forEach((score, index) => {
    const tr = document.createElement("tr");
    const date = score.at
      ? new Date(score.at).toLocaleDateString()
      : "—";

    for (const value of [
      index + 1,
      score.score ?? 0,
      score.kills ?? 0,
      date
    ]) {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.appendChild(td);
    }

    highScoreRowsEl.appendChild(tr);
  });

  deathModal.hidden = false;
  deathModal.classList.add("open");
}

restartButton.addEventListener("click", () => location.reload());

function cardinalDirection(dx: number, dy: number): SpriteDirection {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function isBoss(monster: Monster): boolean {
  return monster.bossKind !== undefined;
}

function obstacleStateMapForPage(pageUrl: string): Map<string, ObstacleState> {
  const key = currentStateId ?? stateIdForPage(pageUrl);
  if (!destroyedObstaclesByPage.has(key)) {
    destroyedObstaclesByPage.set(key, new Map());
  }
  return destroyedObstaclesByPage.get(key)!;
}

function saveObstacleState(item: Decoration): void {
  if (!currentPageUrl || !item.destructible) return;

  obstacleStateMapForPage(currentPageUrl).set(item.id, {
    hp: item.hp,
    destroyed: item.destroyed,
    spawnedCount: item.spawnedCount,
  });
}

function buildDecorations(layout: DungeonLayout, pageUrl: string): Decoration[] {
  const pageIdentity = floorIdentity(pageUrl);
  return [
    ...createDecorations(layout, obstacleStateMapForPage(pageUrl), floorNumber()),
    ...layout.nodes.flatMap((room) => {
      const pedestal = weaponPedestalForRoom(room, pageIdentity);
      return pedestal ? [pedestal] : [];
    }),
  ];
}

function renderDecorations(): void {
  renderer.renderDecorations(currentDecorations, visitedRooms);
}

function damageObstacle(item: Decoration, amount: number): void {
  if (!applyObstacleDamage(item, amount)) return;

  if (item.hp <= 0) {
    item.destroyed = true;
    saveObstacleState(item);
    renderer.spawnEffect(item.visual.animations?.destroy, item.x, item.y, item.size);
    renderDecorations();
    if (currentPageUrl) {
      const drops = createSceneryDrops([item], floorIdentity(currentPageUrl), collectedLoot);
      currentLoot.push(...drops);
      if (drops.length) renderInteractiveObjects();
    }
  } else {
    renderer.spawnEffect(item.visual.animations?.damage, item.x, item.y + item.hitOffsetY, item.size);
    saveObstacleState(item);
    renderDecorations();
  }
}

function monsterStateMapForPage(pageUrl: string): Map<string, MonsterState> {
  const key = currentStateId ?? stateIdForPage(pageUrl);
  if (!monsterStatesByPage.has(key)) {
    monsterStatesByPage.set(key, new Map());
  }
  return monsterStatesByPage.get(key)!;
}

function saveMonsterState(monster: Monster): void {
  if (!currentPageUrl) return;

  const states = monsterStateMapForPage(currentPageUrl);
  states.set(monster.id, {
    x: monster.x,
    y: monster.y,
    roomId: monster.roomId,
    hp: monster.hp,
    dead: monster.dead,
    active: monster.active,
    droppedLoot: monster.droppedLoot || false,
    dropId: monster.dropId || null,
    dropX: monster.dropX ?? null,
    dropY: monster.dropY ?? null,
    dropKind: monster.dropKind ?? null,
    attackSequence: monster.attackSequence,
    summonedCount: monster.summonedCount,
  });
}

function lootDropsForMonster(monster: Monster): LootItem[] {
  if (!currentPageUrl) return [];
  const namespace = floorIdentity(currentPageUrl);
  const x = monster.dropX ?? monster.x;
  const y = monster.dropY ?? monster.y;
  if (!isBoss(monster)) {
    if (!monster.dropId || !monster.dropKind) return [];
    return [{
      id: monster.dropId,
      roomId: monster.roomId,
      x,
      y,
      kind: monster.dropKind,
      weapon: monster.dropKind === "weapon"
        ? weaponForMonster(monster.kind, monster.seed)
        : undefined,
      weaponPlacement: monster.dropKind === "weapon" ? "floor" : undefined,
    }];
  }
  return bossLootDrops(
    { ...monster, dropX: x, dropY: y },
    namespace,
    floorNumber(),
    currentRoomsById.get(monster.spawnRoomId),
  );
}

function saveCurrentFloorState(): void {
  if (!currentPageUrl || !currentStateId) return;
  discoveredRoomsByPage.set(currentStateId, new Set(visitedRooms));
  for (const item of currentDecorations) {
    if (item.destructible) saveObstacleState(item);
  }
  for (const monster of currentMonsters) saveMonsterState(monster);
}

function buildMonsters(layout: DungeonLayout, pageUrl: string): Monster[] {
  const monsters = createMonsters(
    layout,
    monsterStateMapForPage(pageUrl),
    visitedRooms,
    floorNumber(),
    currentDecorations,
  );
  for (const monster of monsters) {
    if (monster.dead && monster.droppedLoot) {
      currentLoot.push(...lootDropsForMonster(monster).filter(item => !collectedLoot.has(item.id)));
    }
  }
  return monsters;
}

function updateBossGates(): void {
  const lockedRooms = new Set(currentMonsters
    .filter(monster => isBoss(monster) && !monster.dead)
    .map(monster => monster.spawnRoomId));
  for (const stair of currentStairs) {
    if (stair.type === "down") stair.enabled = !lockedRooms.has(stair.roomId);
  }
  updatePortalContacts(
    currentStairs,
    player,
    PORTAL_DEFINITION.contactRadius,
    portalContacts,
    PORTAL_DEFINITION.contactOffset,
  );
}

function activateMonstersInRoom(roomId: number): void {
  let changed = false;

  for (const monster of currentMonsters) {
    if (!monster.dead && monster.spawnRoomId === roomId && !monster.active) {
      monster.active = true;
      saveMonsterState(monster);
      changed = true;
    }
  }

  if (changed) renderMonsters();
}

function updateMonsterSpawners(timestamp: number): void {
  let spawned = false;
  for (const spawner of currentDecorations) {
    if (
      !spawner.spawner ||
      spawner.destroyed ||
      !visitedRooms.has(spawner.roomId) ||
      (spawner.spawnedCount ?? 0) >= (spawner.spawnLimit ?? 0)
    ) continue;

    if (spawner.nextSpawnAt === undefined) {
      spawner.nextSpawnAt = timestamp + (spawner.spawnIntervalMs ?? 7_000);
      continue;
    }
    const spawnClip = spawner.visual.animations?.spawn;
    const eventDelay = (spawnClip?.eventFrame ?? 0) * (spawnClip?.frameDurationMs ?? 0);
    const animationStartAt = spawner.nextSpawnAt - eventDelay;
    if (timestamp >= animationStartAt && (spawner.spawnAnimationStartedAt ?? -Infinity) < animationStartAt) {
      spawner.spawnAnimationStartedAt = animationStartAt;
    }
    if (timestamp < spawner.nextSpawnAt) continue;

    const index = spawner.spawnedCount ?? 0;
    const monster = monsterSpecForSpawner(spawner, floorNumber(), index);
    monster.hp = monster.maxHp;
    monster.active = true;
    const sideDistance = (spawner.footprint ?? spawner.radius) + monster.radius + world(8);
    const spawnOffsets: Point[] = [
      { x: 0, y: 0 },
      { x: sideDistance, y: 0 }, { x: -sideDistance, y: 0 },
      { x: 0, y: sideDistance }, { x: 0, y: -sideDistance },
      { x: sideDistance, y: sideDistance }, { x: -sideDistance, y: -sideDistance },
    ];
    const safePosition = spawnOffsets
      .map(offset => ({ x: spawner.x + offset.x, y: spawner.y + offset.y }))
      .find(point => monsterSpawnPositionIsClear(monster, spawner, point));
    if (!safePosition) {
      spawner.nextSpawnAt = timestamp + 1_000;
      continue;
    }
    monster.x = safePosition.x;
    monster.y = safePosition.y;
    currentMonsters.push(monster);
    spawner.spawnedCount = index + 1;
    spawner.nextSpawnAt = timestamp + (spawner.spawnIntervalMs ?? 7_000);
    saveObstacleState(spawner);
    saveMonsterState(monster);
    renderer.spawnEffect(monster.visual.effects?.destroy, monster.x, monster.y, monster.size);
    spawned = true;
  }
  renderer.updateDecorationAnimations(currentDecorations, timestamp);
  if (spawned) renderMonsters();
}

function renderMonsters(): void {
  renderer.renderMonsters(currentMonsters);
}

function updateMonsterPositions(): void {
  renderer.updateMonsterPositions(currentMonsters);
}

function applyPlayerDamage(amount: number): void {
  if (!playerAlive) return;

  renderer.spawnEffect(
    PLAYER_SPEC.visual.effects?.damage,
    player.x,
    player.y + PLAYER_SPEC.visualCenterOffsetY,
    PLAYER_SPEC.spriteSize,
  );

  if (isPlayerInvulnerable()) return;

  playerHp = Math.max(0, playerHp - amount);

  updateHealthUi();

  if (playerHp <= 0) {
    playerAlive = false;
    resetPlayerInput();
    const hud = document.querySelector("#hud");
    hud?.classList.add("game-over");
    setStatus("Operative signal lost.", true);
    showDeathModal();
  }
}

function monsterDrop(monster: Monster): void {
  if (!currentPageUrl || monster.droppedLoot) return;

  const dropsWeapon = !isBoss(monster) && monsterDropsWeapon(monster.seed, monster.miniboss);
  if (!monster.dropsLoot && !dropsWeapon) return;

  monster.droppedLoot = true;
  monster.dropX = monster.x;
  monster.dropY = monster.y;
  if (!isBoss(monster)) {
    monster.dropId = `${floorIdentity(currentPageUrl)}::${monster.id}::monster-drop`;
    monster.dropKind = dropsWeapon ? "weapon" : lootKindForSeed(monster.seed);
  }
  currentLoot.push(...lootDropsForMonster(monster).filter(item => !collectedLoot.has(item.id)));
}

function damageMonster(monster: Monster, amount: number): void {
  if (monster.dead) return;

  monster.hp = Math.max(0, monster.hp - amount);

  if (monster.hp <= 0) {
    monster.dead = true;
    monster.deathAnimating = true;
    renderer.spawnEffect(monster.visual.effects?.destroy, monster.x, monster.y, monster.size);
    runStats.kills += 1;

    if (isBoss(monster)) {
      runStats.bossKills = (runStats.bossKills ?? 0) + 1;
      updateBossGates();
    } else if (monster.speed === 0) {
      runStats.sentryKills = (runStats.sentryKills ?? 0) + 1;
    } else if (monster.fast) {
      runStats.fastKills += 1;
    } else {
      runStats.slowKills += 1;
    }

    if (killsCountEl) killsCountEl.textContent = String(runStats.kills);
    updateHudPanels();

    monsterDrop(monster);
    saveMonsterState(monster);
    renderMonsters();
    renderInteractiveObjects();

    setTimeout(() => {
      monster.deathAnimating = false;
      renderMonsters();
    }, 460);
  } else {
    renderer.spawnEffect(
      monster.visual.effects?.damage,
      monster.x,
      monster.y + monsterVisualCenterOffsetY(monster.size, monster.visualKind),
      monster.size,
    );
    saveMonsterState(monster);
    updateMonsterPositions();
  }
}

function queueEnemyBullet(
  monster: Monster,
  direction: Point,
  {
    speed = monster.projectileSpeed,
    damage = monster.attackDamage,
    radius = DEFAULT_BULLET_SPEC.radius,
    maxDistance = monster.projectileRange,
    style = "enemy",
    lateralOffset = 0,
  }: {
    speed?: number;
    damage?: number;
    radius?: number;
    maxDistance?: number;
    style?: BulletStyle;
    lateralOffset?: number;
  } = {},
): void {
  const muzzleDistance = Math.max(monster.radius + radius + world(5), monster.size * 0.42);
  const origin = actorProjectileOrigin(
    monster,
    direction,
    monsterVisualCenterOffsetY(monster.size, monster.visualKind),
    muzzleDistance,
    lateralOffset,
  );
  bullets.push({
    id: `${monster.id}-${performance.now()}-${bullets.length}`,
    owner: "enemy",
    damage,
    ...origin,
    vx: direction.x * speed,
    vy: direction.y * speed,
    traveled: 0,
    radius,
    maxDistance,
    style,
  });
}

function playerCollisionCenter(): Point {
  return actorCollisionCenter(player, PLAYER_SPEC.visualCenterOffsetY);
}

function shootEnemyVolley(monster: Monster, direction: Point, timestamp: number): void {
  for (const projectile of enemyVolleyProjectiles(direction, monster.attackPattern, world(15))) {
    queueEnemyBullet(monster, projectile.direction, { lateralOffset: projectile.lateralOffset });
  }
  monster.attackKind = "ranged";
  monster.lastAttackAt = timestamp;
  renderBullets();
}

function rotatedDirection(direction: Point, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: direction.x * cosine - direction.y * sine,
    y: direction.x * sine + direction.y * cosine,
  };
}

function fireBossVolley(monster: Monster, timestamp: number): void {
  const sequence = monster.attackSequence ?? 0;
  const enraged = monster.hp <= monster.maxHp / 2;
  const target = playerCollisionCenter();
  const aimed = actorAimDirection(
    monster,
    monsterVisualCenterOffsetY(monster.size, monster.visualKind),
    target,
  );

  if (monster.bossKind === "packet-storm" && sequence % 2 === 0) {
    const count = 10 + Math.min(6, floorNumber()) + (enraged ? 4 : 0);
    const offset = sequence * 0.19;
    for (let index = 0; index < count; index += 1) {
      const angle = offset + index / count * Math.PI * 2;
      queueEnemyBullet(monster, { x: Math.cos(angle), y: Math.sin(angle) }, {
        radius: world(6),
        style: "boss",
      });
    }
  } else {
    const count = monster.bossKind === "fork-bomb" ? (enraged ? 5 : 3) : (enraged ? 7 : 5);
    const spread = monster.bossKind === "fork-bomb" ? 0.19 : 0.14;
    for (let index = 0; index < count; index += 1) {
      queueEnemyBullet(monster, rotatedDirection(aimed, (index - (count - 1) / 2) * spread), {
        radius: world(6),
        style: "boss",
      });
    }
  }
  monster.attackSequence = sequence + 1;
  monster.attackKind = "ranged";
  monster.lastAttackAt = timestamp;
  saveMonsterState(monster);
  renderBullets();
}

function summonBossMinions(boss: Monster, timestamp: number): void {
  const totalLimit = 7 + Math.min(9, floorNumber());
  const aliveLimit = 3 + Math.min(4, Math.floor(floorNumber() / 3));
  const prefix = `${boss.id}::summon-`;
  const alive = currentMonsters.filter(monster => monster.id.startsWith(prefix) && !monster.dead).length;
  const summonedCount = boss.summonedCount ?? 0;
  if (alive >= aliveLimit || summonedCount >= totalLimit) {
    boss.nextSpecialAt = timestamp + 1_500;
    return;
  }
  const waveSize = boss.hp <= boss.maxHp / 2 ? 2 : 1;
  let added = 0;
  for (let offset = 0; offset < waveSize && alive + added < aliveLimit && summonedCount + added < totalLimit; offset += 1) {
    const index = summonedCount + added;
    const minion = monsterSpecForBossSummon(boss, floorNumber(), index);
    if (!isWalkable(minion.x, minion.y, minion.radius)) continue;
    minion.hp = minion.maxHp;
    minion.active = true;
    currentMonsters.push(minion);
    saveMonsterState(minion);
    renderer.spawnEffect(minion.visual.effects?.destroy, minion.x, minion.y, minion.size);
    added += 1;
  }
  boss.summonedCount = summonedCount + added;
  boss.nextSpecialAt = timestamp + Math.max(2_800, 6_500 - floorNumber() * 260);
  saveMonsterState(boss);
  if (added) renderMonsters();
}

function hasWalkableLine(from: Point, to: Point, radius: number, step: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const segments = Math.max(1, Math.ceil(distance / step));

  for (let index = 1; index <= segments; index += 1) {
    const sample = {
      x: from.x + dx * (index / segments),
      y: from.y + dy * (index / segments),
    };
    if (!isWalkable(sample.x, sample.y, radius)) return false;
  }

  return true;
}

function hasLineOfSight(from: Point, to: Point, step = WORLD_GEOMETRY.pathLineStep): boolean {
  return hasWalkableLine(from, to, DEFAULT_BULLET_SPEC.radius, step);
}

function monsterPathBounds(monster: Monster, target: Point): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return {
    minX: Math.min(monster.x, target.x) - WORLD_GEOMETRY.pathBoundsPadding,
    maxX: Math.max(monster.x, target.x) + WORLD_GEOMETRY.pathBoundsPadding,
    minY: Math.min(monster.y, target.y) - WORLD_GEOMETRY.pathBoundsPadding,
    maxY: Math.max(monster.y, target.y) + WORLD_GEOMETRY.pathBoundsPadding,
  };
}

function updateMonsterPath(monster: Monster, target: Point, targetRoomId: number | null, timestamp: number): void {
  if (monster.speed === 0) return;
  if (timestamp < (monster.nextPathRefreshAt ?? 0) && monster.path?.length) return;

  const start = { x: monster.x, y: monster.y };
  const walkable = (point: Point): boolean => isMonsterWalkable(monster, point.x, point.y);
  const path = hasWalkableLine(start, target, monster.radius, WORLD_GEOMETRY.pathLineStep)
    ? [target]
    : aStarPath(
      start,
      target,
      walkable,
      WORLD_GEOMETRY.pathGridStep,
      1800,
      monsterPathBounds(monster, target),
    );

  monster.path = path ?? [];
  monster.pathIndex = path && path.length > 1 ? 1 : 0;
  monster.pathTargetRoomId = targetRoomId;
  monster.pathTargetX = target.x;
  monster.pathTargetY = target.y;
  monster.nextPathRefreshAt = timestamp + 420;
}

function moveMonsterTowards(monster: Monster, target: Point, dt: number, timestamp: number): void {
  const waypoint = monster.path?.[monster.pathIndex ?? 0] ?? target;
  const dx = waypoint.x - monster.x;
  const dy = waypoint.y - monster.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= 10 && monster.path && (monster.pathIndex ?? 0) < monster.path.length - 1) {
    monster.pathIndex = (monster.pathIndex ?? 0) + 1;
    moveMonsterTowards(monster, target, dt, timestamp);
    return;
  }

  if (distance <= 0.001) {
    monster.moveDir = null;
    monster.moving = false;
    monster.blockedMoveCount = 0;
    return;
  }

  const step = Math.min(distance, monster.speed * dt);
  monster.escapeDirection = undefined;
  monster.escapeUntil = undefined;
  const nextX = monster.x + dx / distance * step;
  const nextY = monster.y + dy / distance * step;

  monster.moveDir =
    Math.abs(dx) > Math.abs(dy)
      ? (dx < 0 ? "left" : "right")
      : (dy < 0 ? "up" : "down");

  if (isMonsterWalkable(monster, nextX, nextY)) {
    monster.x = nextX;
    monster.y = nextY;
    monster.moving = true;
    monster.blockedMoveCount = 0;
    return;
  }

  const horizontalStep = { x: nextX, y: monster.y };
  const verticalStep = { x: monster.x, y: nextY };
  const axisSteps = Math.abs(dx) > Math.abs(dy)
    ? [horizontalStep, verticalStep]
    : [verticalStep, horizontalStep];
  for (const candidate of axisSteps) {
    if (Math.hypot(candidate.x - monster.x, candidate.y - monster.y) <= 0.001) continue;
    if (!isMonsterWalkable(monster, candidate.x, candidate.y)) continue;
    monster.moveDir = cardinalDirection(candidate.x - monster.x, candidate.y - monster.y);
    monster.x = candidate.x;
    monster.y = candidate.y;
    monster.moving = true;
    monster.blockedMoveCount = 0;
    return;
  }

  monster.path = [];
  monster.nextPathRefreshAt = 0;
  monster.blockedMoveCount = (monster.blockedMoveCount ?? 0) + 1;
  if (monster.blockedMoveCount < 4) return;
  const escaped = monsterEscapeStep(
    monster,
    { x: dx, y: dy },
    Math.max(step, world(6)),
    point => isMonsterWalkable(monster, point.x, point.y),
    monster.seed + monster.blockedMoveCount,
  );
  if (escaped) {
    const escapeDx = escaped.x - monster.x;
    const escapeDy = escaped.y - monster.y;
    monster.moveDir = cardinalDirection(escapeDx, escapeDy);
    monster.x = escaped.x;
    monster.y = escaped.y;
    monster.moving = true;
    monster.blockedMoveCount = 0;
  }
}

function updateBoss(monster: Monster, dt: number, timestamp: number): void {
  if (currentRoomId === null) return;
  const playerRoom = roomContainingPoint(player.x, player.y);
  const sharesPlayerRoom = playerRoom?.id === monster.roomId;
  let target: Point = player;
  let targetRoomId: number | null = playerRoom?.id ?? null;
  if (!sharesPlayerRoom && playerRoom) {
    const nextRoomId = nextRoomTowardPlayer.get(monster.roomId);
    const nextRoom = nextRoomId === undefined ? undefined : currentRoomsById.get(nextRoomId);
    if (!nextRoom) return;
    target = nextRoom;
    targetRoomId = nextRoom.id;
  }
  if (monster.bossKind === "heap-titan") {
    updateMonsterPath(monster, player, playerRoom?.id ?? null, timestamp);
    moveMonsterTowards(monster, player, dt, timestamp);
  } else if (!sharesPlayerRoom) {
    updateMonsterPath(monster, target, targetRoomId, timestamp);
    moveMonsterTowards(monster, target, dt, timestamp);
  }
  const playerDistance = Math.hypot(player.x - monster.x, player.y - monster.y);
  monster.moveDir = cardinalDirection(player.x - monster.x, player.y - monster.y);

  if (monster.bossKind === "packet-storm") {
    if (
      playerDistance <= monster.projectileRange &&
      monsterAttackIsReady(monster, timestamp)
    ) fireBossVolley(monster, timestamp);
    return;
  }

  if (monster.bossKind === "fork-bomb") {
    if (monster.nextSpecialAt === undefined) monster.nextSpecialAt = timestamp + 2_800;
    if (sharesPlayerRoom && timestamp >= monster.nextSpecialAt) summonBossMinions(monster, timestamp);
    if (
      playerDistance <= monster.projectileRange &&
      monsterAttackIsReady(monster, timestamp)
    ) fireBossVolley(monster, timestamp);
    return;
  }

  if (playerDistance <= monster.attackRange && monsterAttackIsReady(monster, timestamp)) {
    monster.attackKind = "melee";
    monster.lastAttackAt = timestamp;
    applyPlayerDamage(monster.attackDamage);
  }
  if (monster.nextSpecialAt === undefined) monster.nextSpecialAt = timestamp + HEAP_TITAN_WAVE.initialDelayMs;
  if (timestamp >= monster.nextSpecialAt && playerDistance <= monster.projectileRange) {
    const count = monster.hp <= monster.maxHp / 2
      ? HEAP_TITAN_WAVE.enragedBulletCount
      : HEAP_TITAN_WAVE.bulletCount;
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2;
      queueEnemyBullet(monster, { x: Math.cos(angle), y: Math.sin(angle) }, {
        damage: Math.max(1, Math.floor(monster.attackDamage / 2)),
      radius: world(8),
        maxDistance: monster.projectileRange,
        style: "shockwave",
      });
    }
    monster.nextSpecialAt = timestamp + Math.max(
      HEAP_TITAN_WAVE.minIntervalMs,
      HEAP_TITAN_WAVE.baseIntervalMs - floorNumber() * HEAP_TITAN_WAVE.floorReductionMs,
    );
    monster.attackSequence = (monster.attackSequence ?? 0) + 1;
    monster.attackKind = "ranged";
    monster.lastAttackAt = timestamp;
    saveMonsterState(monster);
    renderBullets();
  }
}

function renderBullets(): void {
  renderer.renderBullets(bullets);
}

function shootBullet(): void {
  if (!playerAlive) return;

  const now = performance.now();
  if (now - lastPlayerShotAt < currentWeapon.fireCooldownMs) return;
  lastPlayerShotAt = now;
  runStats.shotsFired += 1;
  gameCanvasHost.dataset.shotsFired = String(runStats.shotsFired);
  playPlayerShootFrames();

  const projectiles = projectilesForWeapon(currentWeapon, playerFacing, weaponShotSequence);
  for (const [index, projectile] of projectiles.entries()) {
    const muzzleDistance = Math.max(
      PLAYER_SPEC.radius + projectile.radius + world(7),
      PLAYER_SPEC.muzzleDistance,
    );
    const origin = actorProjectileOrigin(
      player,
      playerFacing,
      PLAYER_SPEC.visualCenterOffsetY,
      muzzleDistance,
      projectile.lateralOffset,
    );
    bullets.push({
      id: `${now}-${weaponShotSequence}-${index}`,
      owner: "player",
      damage: projectile.damage,
      ...origin,
      vx: projectile.direction.x * projectile.speed,
      vy: projectile.direction.y * projectile.speed,
      traveled: 0,
      radius: projectile.radius,
      maxDistance: projectile.range,
      style: "player",
      weaponKind: currentWeapon.kind,
    });
  }
  gameCanvasHost.dataset.lastPlayerVolley = String(projectiles.length);
  weaponShotSequence += 1;
  if (currentWeaponAmmo !== null) {
    currentWeaponAmmo -= 1;
    if (currentWeaponAmmo <= 0) equipDefaultWeapon();
    else updateWeaponUi();
  }

  renderBullets();
}

function updateBullets(dt: number): void {
  if (!bullets.length) return;

  const survivors = [];

  for (const bullet of bullets) {
    const stepX = bullet.vx * dt;
    const stepY = bullet.vy * dt;
    const stepDistance = Math.hypot(stepX, stepY);

    // Sub-step fast bullets so they do not tunnel through monsters/walls.
    const segments = Math.max(1, Math.ceil(stepDistance / world(8)));
    const dx = stepX / segments;
    const dy = stepY / segments;
    let alive = true;

    for (let i = 0; i < segments && alive; i++) {
      bullet.x += dx;
      bullet.y += dy;
      bullet.traveled += Math.hypot(dx, dy);
      const bulletRadius = bullet.radius ?? DEFAULT_BULLET_SPEC.radius;

      if (
        bullet.traveled >= (bullet.maxDistance ?? DEFAULT_BULLET_SPEC.maxDistance) ||
        !isGeometryWalkable(bullet.x, bullet.y, bulletRadius)
      ) {
        alive = false;
        break;
      }

      if (bullet.owner === "player") {
        for (const monster of currentMonsters) {
          if (!monster.active || monster.dead) continue;

          if (projectileHitsCircle(
            { x: monster.x, y: monster.y + monsterVisualCenterOffsetY(monster.size, monster.visualKind) },
            monster.radius,
            bullet,
            bulletRadius,
          )) {
            damageMonster(monster, bullet.damage);
            alive = false;
            break;
          }
        }
      }

      if (!alive) break;

      if (bullet.owner === "enemy") {
        if (projectileHitsCircle(playerCollisionCenter(), PLAYER_SPEC.radius, bullet, bulletRadius)) {
          applyPlayerDamage(bullet.damage);
          alive = false;
          break;
        }
      }

      for (const item of damageableCells.get(spatialCellKey(bullet.x, bullet.y)) ?? []) {
        if (!item.destructible || item.destroyed) continue;

        if (projectileHitsDecoration(item, bullet, bulletRadius)) {
          damageObstacle(item, bullet.damage);
          alive = false;
          break;
        }
      }
    }

    if (alive) survivors.push(bullet);
  }

  bullets = survivors;
  renderBullets();
}

function rebuildRoomRouting(): void {
  if (!roomRoutingDirty || !currentLayout || currentRoomId === null) return;
  roomRoutingDirty = false;
  nextRoomTowardPlayer = new Map([[currentRoomId, currentRoomId]]);
  const adjacency = new Map<number, number[]>();
  for (const room of currentLayout.nodes) {
    if (visitedRooms.has(room.id)) adjacency.set(room.id, []);
  }
  for (const link of currentLayout.links) {
    if (!visitedRooms.has(link.source.id) || !visitedRooms.has(link.target.id)) continue;
    adjacency.get(link.source.id)?.push(link.target.id);
    adjacency.get(link.target.id)?.push(link.source.id);
  }
  const queue = [currentRoomId];
  for (let index = 0; index < queue.length; index += 1) {
    const roomId = queue[index]!;
    for (const neighbor of adjacency.get(roomId) ?? []) {
      if (nextRoomTowardPlayer.has(neighbor)) continue;
      nextRoomTowardPlayer.set(neighbor, roomId);
      queue.push(neighbor);
    }
  }
}


function gameTick(timestamp: number): void {
  gameAnimationFrame = requestAnimationFrame(gameTick);

  if (!playerAlive || !currentLayout) {
    lastGameTick = timestamp;
    setPlayerMoving(false, timestamp);
    return;
  }

  if (lastGameTick == null) {
    lastGameTick = timestamp;
    return;
  }

  const dt = Math.min(0.05, Math.max(0, (timestamp - lastGameTick) / 1000));
  lastGameTick = timestamp;

  updatePlayerProtectionVisual(timestamp);
  updateEnergyDash(dt, timestamp);
  if (primaryPointerDown && pointerInViewport) shootBullet();
  updateBullets(dt);
  updateMonsterSpawners(timestamp);
  renderer.updateLootAnimations(currentLoot, timestamp);

  rebuildRoomRouting();

  for (const monster of currentMonsters) {
    if (!monster.active || monster.dead) continue;
    monster.moving = false;

    const containingRoom = roomContainingPoint(monster.x, monster.y);
    if (containingRoom && visitedRooms.has(containingRoom.id)) {
      monster.roomId = containingRoom.id;
    }

    if (isBoss(monster)) {
      updateBoss(monster, dt, timestamp);
      continue;
    }

    const nextRoomId = nextRoomTowardPlayer.get(monster.roomId);
    if (nextRoomId === undefined) continue;

    let targetX = player.x;
    let targetY = player.y;

    if (monster.roomId !== currentRoomId) {
      const nextRoom = currentRoomsById.get(nextRoomId);
      if (!nextRoom) continue;
      targetX = nextRoom.x;
      targetY = nextRoom.y;
    }

    const targetRoomId = monster.roomId !== currentRoomId ? nextRoomId : currentRoomId;

    if (monster.speed === 0) {
      const target = playerCollisionCenter();
      const monsterCenter = actorCollisionCenter(
        monster,
        monsterVisualCenterOffsetY(monster.size, monster.visualKind),
      );
      monster.moveDir = cardinalDirection(target.x - monsterCenter.x, target.y - monsterCenter.y);
      const playerDistance = Math.hypot(target.x - monsterCenter.x, target.y - monsterCenter.y);
      if (
        playerDistance <= monsterEngagementRange(monster) &&
        monsterAttackIsReady(monster, timestamp) &&
        hasLineOfSight(monster, target)
      ) {
        shootEnemyVolley(monster, actorAimDirection(
          monster,
          monsterVisualCenterOffsetY(monster.size, monster.visualKind),
          target,
        ), timestamp);
      }
      continue;
    }

    const target = playerCollisionCenter();
    let monsterCenter = actorCollisionCenter(
      monster,
      monsterVisualCenterOffsetY(monster.size, monster.visualKind),
    );
    let playerDistance = Math.hypot(target.x - monsterCenter.x, target.y - monsterCenter.y);
    const rangedInPosition =
      monster.attackPattern !== "melee" &&
      monster.roomId === currentRoomId &&
      playerDistance <= monsterEngagementRange(monster) &&
      hasLineOfSight(monsterCenter, target);
    const targetPoint = { x: targetX, y: targetY };
    if (!rangedInPosition) {
      const pathStale =
        !monster.path?.length ||
        monster.pathTargetRoomId !== targetRoomId ||
        Math.hypot((monster.pathTargetX ?? targetX) - targetX, (monster.pathTargetY ?? targetY) - targetY) > 48;
      if (pathStale) monster.nextPathRefreshAt = 0;
      updateMonsterPath(monster, targetPoint, targetRoomId, timestamp);
      moveMonsterTowards(monster, targetPoint, dt, timestamp);
      monsterCenter = actorCollisionCenter(
        monster,
        monsterVisualCenterOffsetY(monster.size, monster.visualKind),
      );
      playerDistance = Math.hypot(target.x - monsterCenter.x, target.y - monsterCenter.y);
    } else {
      monster.moveDir = cardinalDirection(target.x - monsterCenter.x, target.y - monsterCenter.y);
    }

    if (
      monster.attackPattern === "melee" &&
      playerDistance <= monsterEngagementRange(monster) &&
      monsterAttackIsReady(monster, timestamp)
    ) {
      monster.attackKind = "melee";
      monster.lastAttackAt = timestamp;
      applyPlayerDamage(monster.attackDamage);
    } else if (
      monster.attackPattern !== "melee" &&
      playerDistance <= monsterEngagementRange(monster) &&
      monsterAttackIsReady(monster, timestamp) &&
      hasLineOfSight(monsterCenter, target)
    ) {
      shootEnemyVolley(monster, actorAimDirection(
        monster,
        monsterVisualCenterOffsetY(monster.size, monster.visualKind),
        target,
      ), timestamp);
    }
  }

  updateMonsterPositions();
}

function startGameLoop(): void {
  if (gameAnimationFrame !== null) {
    cancelAnimationFrame(gameAnimationFrame);
  }

  lastGameTick = null;
  gameAnimationFrame = requestAnimationFrame(gameTick);
}

function spatialCellKey(x: number, y: number): string {
  return `${Math.floor(x / SPATIAL_CELL_SIZE)},${Math.floor(y / SPATIAL_CELL_SIZE)}`;
}

function forSpatialCells(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  visit: (key: string) => void,
): void {
  const firstX = Math.floor(minX / SPATIAL_CELL_SIZE);
  const lastX = Math.floor(maxX / SPATIAL_CELL_SIZE);
  const firstY = Math.floor(minY / SPATIAL_CELL_SIZE);
  const lastY = Math.floor(maxY / SPATIAL_CELL_SIZE);
  for (let cellX = firstX; cellX <= lastX; cellX += 1) {
    for (let cellY = firstY; cellY <= lastY; cellY += 1) visit(`${cellX},${cellY}`);
  }
}

function rebuildSpatialIndexes(): void {
  geometryCells = new Map();
  obstacleCells = new Map();
  damageableCells = new Map();
  if (!currentLayout) return;
  const margin = world(48);

  for (const room of currentLayout.nodes) {
    forSpatialCells(
      room.x - room.width / 2 - margin,
      room.x + room.width / 2 + margin,
      room.y - room.height / 2 - margin,
      room.y + room.height / 2 + margin,
      key => {
        const cell = geometryCells.get(key) ?? { rooms: new Set(), links: new Set() };
        cell.rooms.add(room);
        geometryCells.set(key, cell);
      },
    );
  }
  for (const link of currentLayout.links) {
    const corridorMargin = link.width / 2 + margin;
    for (let index = 1; index < link.points.length; index += 1) {
      const start = link.points[index - 1]!;
      const end = link.points[index]!;
      forSpatialCells(
        Math.min(start.x, end.x) - corridorMargin,
        Math.max(start.x, end.x) + corridorMargin,
        Math.min(start.y, end.y) - corridorMargin,
        Math.max(start.y, end.y) + corridorMargin,
        key => {
          const cell = geometryCells.get(key) ?? { rooms: new Set(), links: new Set() };
          cell.links.add(link);
          geometryCells.set(key, cell);
        },
      );
    }
  }
  for (const item of currentDecorations) {
    if (item.obstacle) {
      const extent = item.radius + margin;
      forSpatialCells(item.x - extent, item.x + extent, item.y - extent, item.y + extent, key => {
        const cell = obstacleCells.get(key) ?? new Set();
        cell.add(item);
        obstacleCells.set(key, cell);
      });
    }
    if (item.destructible) {
      const extent = item.radius + world(24);
      forSpatialCells(item.x - extent, item.x + extent, item.y - extent, item.y + extent, key => {
        const cell = damageableCells.get(key) ?? new Set();
        cell.add(item);
        damageableCells.set(key, cell);
      });
    }
  }
}

function pointBlockedByDecoration(x: number, y: number, radius = PLAYER_SPEC.radius): boolean {
  for (const item of obstacleCells.get(spatialCellKey(x, y)) ?? []) {
    if (!item.obstacle || item.destroyed) continue;

    const footprint = item.footprint ?? item.radius;
    const distance = Math.hypot(x - item.x, y - item.y);
    if (distance < radius + footprint) return true;
  }

  return false;
}

function isGeometryWalkable(x: number, y: number, radius = PLAYER_SPEC.radius): boolean {
  if (!currentLayout) return false;
  const cell = geometryCells.get(spatialCellKey(x, y));
  if (!cell) return false;
  for (const room of cell.rooms) {
    if (pointInRoomFloor(x, y, room, radius)) return true;
  }
  for (const link of cell.links) {
    if (pointInCorridor(x, y, link, radius)) return true;
  }

  return false;
}

function isWalkable(x: number, y: number, radius = PLAYER_SPEC.radius): boolean {
  return (
    isGeometryWalkable(x, y, radius) &&
    !pointBlockedByDecoration(x, y, radius)
  );
}

function isMonsterWalkable(monster: Monster, x: number, y: number): boolean {
  if (!isGeometryWalkable(x, y, monster.radius)) return false;
  for (const item of obstacleCells.get(spatialCellKey(x, y)) ?? []) {
    if (!item.obstacle || item.destroyed) continue;
    const extent = monster.radius + (item.footprint ?? item.radius);
    const nextDistance = Math.hypot(x - item.x, y - item.y);
    if (nextDistance >= extent) continue;
    if (item.id === monster.spawnSourceId) {
      const currentDistance = Math.hypot(monster.x - item.x, monster.y - item.y);
      if (currentDistance < extent && nextDistance >= currentDistance) continue;
    }
    return false;
  }
  return true;
}

function monsterSpawnPositionIsClear(monster: Monster, spawner: Decoration, position: Point): boolean {
  if (!isGeometryWalkable(position.x, position.y, monster.radius)) return false;
  for (const item of currentDecorations) {
    if (item.id === spawner.id || !item.obstacle || item.destroyed) continue;
    if (Math.hypot(position.x - item.x, position.y - item.y) <
      monster.radius + (item.footprint ?? item.radius)) return false;
  }
  if (Math.hypot(position.x - player.x, position.y - player.y) < monster.radius + PLAYER_SPEC.radius) return false;
  return currentMonsters.every(item => item.dead || Math.hypot(position.x - item.x, position.y - item.y) >= monster.radius + item.radius);
}

function buildInteractiveObjects(layout: DungeonLayout, pageUrl: string): {
  stairs: Stair[];
  loot: LootItem[];
} {
  const base = createInteractiveObjects(
    layout,
    floorIdentity(pageUrl),
    navigationHistory[navigationHistory.length - 1] ?? null,
    collectedLoot,
  );
  return {
    stairs: base.stairs,
    loot: [...base.loot, ...extraLootForCurrentPage().filter(item => !collectedLoot.has(item.id))],
  };
}

function renderInteractiveObjects(): void {
  renderer.renderObjects(currentStairs, currentLoot, visitedRooms, LOOT_ASSETS);
  renderer.setPlayer(player, playerHp, PLAYER_SPEC.maxHp, currentPlayerSpriteAsset);
  updatePlayerVisual();
  updatePlayerAnimationClasses();
  updateHealthUi();
}

function updatePlayerVisual(): void {
  renderer.setPlayer(player, playerHp, PLAYER_SPEC.maxHp, currentPlayerSpriteAsset);
  updatePlayerProtectionVisual();
}

function checkLoot(): void {
  let changed = false;
  queuedLootDrops = [];

  for (const item of currentLoot) {
    const pickupRadius = item.kind === "weapon"
      ? WEAPON_PICKUP_DEFINITIONS[item.weaponPlacement ?? "floor"].pickupRadius
      : LOOT_DEFINITIONS[item.kind].pickupRadius;
    if (
      temporarilyBlockedLoot.has(item.id) &&
      distanceSquared(player, item) > pickupRadius * pickupRadius
    ) {
      temporarilyBlockedLoot.delete(item.id);
    }
  }

  currentLoot = currentLoot.filter(item => {
    const pickupRadius = item.kind === "weapon"
      ? WEAPON_PICKUP_DEFINITIONS[item.weaponPlacement ?? "floor"].pickupRadius
      : LOOT_DEFINITIONS[item.kind].pickupRadius;
    if (
      distanceSquared(player, item) <= pickupRadius * pickupRadius &&
      !temporarilyBlockedLoot.has(item.id)
    ) {
      collectedLoot.add(item.id);

      if (item.kind === "credit") lootInventory.credits += 1;
      if (item.kind === "crystal") lootInventory.crystals += 1;
      if (item.kind === "core") lootInventory.cores += 1;
      if (item.kind === "energy") lootInventory.energy = Math.min(PLAYER_ENERGY_MAX, lootInventory.energy + 1);
      if (item.kind === "medkit") lootInventory.medkits += 1;
      updateLootUi();

      if (item.kind === "weapon" && item.weapon) {
        if (currentWeapon.maxAmmo !== null && currentWeaponAmmo !== null && currentWeaponAmmo > 0) {
          persistDroppedWeapon(currentWeapon, currentWeaponAmmo, item, item.roomId);
        }
        equipWeaponWithAmmo(item.weapon, item.weaponAmmo ?? item.weapon.maxAmmo);
        setStatus(`Equipped ${item.weapon.name} · ${item.weaponAmmo ?? item.weapon.maxAmmo} / ${item.weapon.maxAmmo} ammo`);
      } else if (lootReplenishesAmmo(item)) {
        const replenishedAmmo = replenishWeaponAmmo(currentWeapon, currentWeaponAmmo);
        if (replenishedAmmo !== currentWeaponAmmo) {
          currentWeaponAmmo = replenishedAmmo;
          updateWeaponUi();
        }
      }

      if (item.kind === "medkit" && playerAlive) {
        const restored = playerHp < PLAYER_SPEC.maxHp ? 1 : 0;

        if (restored > 0) {
          playerHp += restored;
          renderer.spawnEffect(PLAYER_SPEC.visual.effects?.healing, player.x, player.y, PLAYER_SPEC.spriteSize);
          updateHealthUi();
          setStatus(`Health pack restored 1 HP · ${currentPageUrl}`);
        }
      }

      changed = true;
      return false;
    }
    return true;
  });

  if (queuedLootDrops.length) {
    const existing = new Set(currentLoot.map(item => item.id));
    for (const item of queuedLootDrops) {
      if (existing.has(item.id)) continue;
      currentLoot.push(item);
      existing.add(item.id);
      changed = true;
    }
  }
  queuedLootDrops = [];

  if (changed) {
    renderInteractiveObjects();
  }
}

function checkStairs(): boolean {
  if (portalTransitioning) return true;
  const stair = updatePortalContacts(
    currentStairs,
    player,
    PORTAL_DEFINITION.contactRadius,
    portalContacts,
    PORTAL_DEFINITION.contactOffset,
  );
  if (!stair) return false;
  portalTransitioning = true;
  renderer.spawnEffect(PLAYER_SPEC.visual.effects?.teleport, player.x, player.y, PLAYER_SPEC.spriteSize);
  setTimeout(() => {
    portalTransitioning = false;
    if (stair.type === "up") goBack();
    else if (stair.url) navigateTo(stair.url, stair.roomId);
  }, 400);
  return true;
}

function playerFramesFor(
  direction: PlayerDirection = playerDirectionName(),
  kind: PlayerAnimation = "walk",
): string[] {
  return PLAYER_FRAMES[direction]?.[kind] || PLAYER_FRAMES.right.walk;
}

function playerAssetForDirection(direction: PlayerDirection = playerDirectionName()): string {
  return PLAYER_DEFAULT_ASSETS[direction];
}

function setPlayerSpriteAsset(asset: string): void {
  currentPlayerSpriteAsset = asset;
  renderer.setPlayerAsset(asset);
}

function updatePlayerFacingAsset(): void {
  updatePlayerAnimationClasses();
  if (!playerShooting) {
    const direction = playerDirectionName();
    const frames = playerFramesFor(direction, "walk");
    setPlayerSpriteAsset(playerMoving
      ? frames[playerWalkFrameIndex % frames.length]!
      : playerAssetForDirection(direction));
  }
}

function advancePlayerWalkFrame(timestamp: number): void {
  if (timestamp - lastPlayerWalkFrameAt < 125) return;
  lastPlayerWalkFrameAt = timestamp;
  const frames = playerFramesFor(playerDirectionName(), "walk");
  playerWalkFrameIndex = (playerWalkFrameIndex + 1) % frames.length;
  setPlayerSpriteAsset(frames[playerWalkFrameIndex]!);
}

function playPlayerShootFrames(): void {
  // The current player pack has no shooting frames, so retain the directional movement frame.
}

function playerDirectionName(): PlayerDirection {
  const octant = Math.round(Math.atan2(playerFacing.y, playerFacing.x) / (Math.PI / 4));
  return ([
    "right",
    "downRight",
    "down",
    "downLeft",
    "left",
    "upLeft",
    "up",
    "upRight",
  ] as const)[(octant + 8) % 8]!;
}

function updatePlayerAnimationClasses(): void {
  // Frame changes are applied directly to the Phaser player sprite.
}

function setPlayerMoving(moving: boolean, timestamp: number): void {
  if (playerMoving !== moving) {
    playerMoving = moving;
    updatePlayerAnimationClasses();

    if (moving && !playerShooting) {
      playerWalkFrameIndex = 0;
      lastPlayerWalkFrameAt = timestamp;
      updatePlayerFacingAsset();
    } else if (!moving && !playerShooting) {
      playerWalkFrameIndex = 0;
      updatePlayerFacingAsset();
    }
  }

  if (moving && !playerShooting) advancePlayerWalkFrame(timestamp);
}

const movementDirections: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

function updatePlayerMovement(dt: number, timestamp: number): void {
  if (!playerAlive) {
    setPlayerMoving(false, timestamp);
    return;
  }

  let inputX = 0;
  let inputY = 0;
  for (const code of heldMovementKeys) {
    const direction = movementDirections[code];
    if (!direction) continue;
    inputX += direction.x;
    inputY += direction.y;
  }

  const magnitude = Math.hypot(inputX, inputY);
  if (magnitude === 0) {
    setPlayerMoving(false, timestamp);
    return;
  }

  const distance = PLAYER_SPEC.speed * dt;
  const dx = inputX / magnitude * distance;
  const dy = inputY / magnitude * distance;
  const next = {
    x: player.x + dx,
    y: player.y + dy,
  };

  let moved = false;
  if (isWalkable(next.x, next.y)) {
    player = next;
    moved = true;
  } else {
    const nearbyObstacles = [...(obstacleCells.get(spatialCellKey(next.x, next.y)) ?? [])]
      .filter(item => item.obstacle && !item.destroyed)
      .map(item => ({ x: item.x, y: item.y, radius: item.footprint ?? item.radius }));
    const slid = slideAlongObstacles(
      player,
      { x: dx, y: dy },
      PLAYER_SPEC.radius,
      nearbyObstacles,
      point => isWalkable(point.x, point.y),
    );
    if (slid) {
      player = slid;
      moved = true;
    }
  }
  if (!moved) {
    if (dx !== 0 && isWalkable(player.x + dx, player.y)) {
      player.x += dx;
      moved = true;
    }
    if (dy !== 0 && isWalkable(player.x, player.y + dy)) {
      player.y += dy;
      moved = true;
    }
  }

  setPlayerMoving(moved, timestamp);
  if (!moved) return;

  updatePlayerVisual();
  revealRoomsFromCorridor(player.x, player.y);
  updateCurrentRoom();
  updateCameraForPlayer();
  checkLoot();
  if (checkStairs()) heldMovementKeys.clear();
}

function startEnergyDash(clientX: number, clientY: number): void {
  if (!playerAlive || !currentLayout || energyDash || lootInventory.energy < PLAYER_ENERGY_MAX) return;
  const target = renderer.worldPointAt(clientX, clientY);
  if (!target) return;
  const center = actorCollisionCenter(player, PLAYER_SPEC.visualCenterOffsetY);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < 1) return;
  energyDash = {
    dirX: dx / magnitude,
    dirY: dy / magnitude,
    traveled: 0,
    maxDistance: ENERGY_DASH_RANGE,
    hitTargets: new Set(),
    playerInvulnerableBefore: playerInvulnerable,
  };
  playerInvulnerable = true;
  renderer.setPlayerDashTint(true);
  updatePlayerProtectionVisual();
  setStatus("Energy surge!");
}

function endEnergyDash(): void {
  const dash = energyDash;
  if (!dash) return;
  playerInvulnerable = dash.playerInvulnerableBefore;
  energyDash = null;
  renderer.setPlayerDashTint(false);
  lootInventory.energy = 0;
  updateLootUi();
  updatePlayerProtectionVisual();
}

function applyEnergyDashDamage(): void {
  const dash = energyDash;
  if (!dash) return;
  const center = playerCollisionCenter();
  for (const monster of currentMonsters) {
    if (!monster.active || monster.dead || dash.hitTargets.has(monster.id)) continue;
    if (projectileHitsCircle(
      { x: monster.x, y: monster.y + monsterVisualCenterOffsetY(monster.size, monster.visualKind) },
      monster.radius,
      center,
      PLAYER_SPEC.radius,
    )) {
      dash.hitTargets.add(monster.id);
      damageMonster(monster, ENERGY_DASH_DAMAGE);
    }
  }
  for (const item of damageableCells.get(spatialCellKey(player.x, player.y)) ?? []) {
    if (!item.destructible || item.destroyed || dash.hitTargets.has(item.id)) continue;
    if (projectileHitsDecoration(item, center, PLAYER_SPEC.radius)) {
      dash.hitTargets.add(item.id);
      damageObstacle(item, ENERGY_DASH_DAMAGE);
    }
  }
}

function updateEnergyDash(dt: number, timestamp: number): void {
  const dash = energyDash;
  if (!dash) {
    updatePlayerMovement(dt, timestamp);
    return;
  }

  const remaining = dash.maxDistance - dash.traveled;
  const distance = Math.min(ENERGY_DASH_SPEED * dt, remaining);
  if (distance > 0) {
    const next = {
      x: player.x + dash.dirX * distance,
      y: player.y + dash.dirY * distance,
    };
    if (isWalkable(next.x, next.y)) {
      player = next;
      dash.traveled += distance;
    } else {
      dash.traveled = dash.maxDistance;
    }
  } else {
    dash.traveled = dash.maxDistance;
  }

  applyEnergyDashDamage();

  updatePlayerVisual();
  revealRoomsFromCorridor(player.x, player.y);
  updateCurrentRoom();
  updateCameraForPlayer();
  checkLoot();
  if (checkStairs()) {
    endEnergyDash();
    return;
  }

  if (dash.traveled >= dash.maxDistance) endEnergyDash();
}

function teleportPlayerTo(x: number, y: number): void {
  if (!currentLayout || !isWalkable(x, y)) return;
  player = { x, y };
  updatePlayerVisual();
  revealRoomsFromCorridor(player.x, player.y);
  updateCurrentRoom();
  updateCameraForPlayer(true);
  checkLoot();
}

(window as Window & {
  __webcrawlTest?: {
    teleportPlayerTo: (x: number, y: number) => void;
    setWeaponAmmo: (ammo: number) => void;
    setPlayerInvulnerable: (enabled: boolean) => void;
    grantCrystals: (count: number) => void;
    grantEnergy: (count: number) => void;
    energy: () => number;
    dashing: () => boolean;
    useCrystal: () => boolean;
    expireCrystalShield: () => void;
    playerHp: () => number;
    damagePlayer: (amount: number) => void;
    stairs: () => Array<Pick<Stair, "id" | "type" | "x" | "y">>;
    portalContacts: () => string[];
    loot: () => Array<{ id: string; kind: string; x: number; y: number; ammo: number | null; name: string | null; placement: string | null }>;
    lastDroppedWeapon: () => { id: string; x: number; y: number; ammo: number | null; maxAmmo: number | null; name: string | null; placement: string | null } | null;
    camera: () => { x: number; y: number; zoom: number; bossRoomId: number | null } | null;
  };
}).__webcrawlTest = {
  teleportPlayerTo,
  setWeaponAmmo(ammo: number): void {
    if (currentWeapon.maxAmmo === null) return;
    currentWeaponAmmo = Math.max(0, Math.min(currentWeapon.maxAmmo, ammo));
    lastPlayerShotAt = -Infinity;
    updateWeaponUi();
  },
  setPlayerInvulnerable(enabled: boolean): void {
    playerInvulnerable = enabled;
    updatePlayerProtectionVisual();
  },
  grantCrystals(count: number): void {
    lootInventory.crystals = Math.max(0, lootInventory.crystals + count);
    updateLootUi();
  },
  grantEnergy(count: number): void {
    lootInventory.energy = Math.min(PLAYER_ENERGY_MAX, Math.max(0, lootInventory.energy + count));
    updateLootUi();
  },
  energy: () => lootInventory.energy,
  dashing: () => energyDash !== null,
  useCrystal: () => activateCrystalInvulnerability(),
  expireCrystalShield(): void {
    crystalInvulnerableUntil = 0;
    updatePlayerProtectionVisual();
  },
  playerHp: () => playerHp,
  damagePlayer: applyPlayerDamage,
  stairs: () => currentStairs.map(({ id, type, x, y }) => ({ id, type, x, y })),
  portalContacts: () => [...portalContacts],
  camera: () => renderer.cameraState(),
  loot: () => currentLoot.map(item => ({
    id: item.id,
    kind: item.kind,
    x: item.x,
    y: item.y,
    ammo: item.weaponAmmo ?? item.weapon?.maxAmmo ?? null,
    name: item.weapon?.name ?? null,
    placement: item.weaponPlacement ?? null,
  })),
  lastDroppedWeapon: () => lastDroppedWeapon
    ? {
      id: lastDroppedWeapon.id,
      x: lastDroppedWeapon.x,
      y: lastDroppedWeapon.y,
      ammo: lastDroppedWeapon.weaponAmmo ?? lastDroppedWeapon.weapon?.maxAmmo ?? null,
      maxAmmo: lastDroppedWeapon.weapon?.maxAmmo ?? null,
      name: lastDroppedWeapon.weapon?.name ?? null,
      placement: lastDroppedWeapon.weaponPlacement ?? null,
    }
    : null,
};

window.addEventListener("keydown", event => {
  if (event.code === "Space") {
    if (!gameUi.hidden) event.preventDefault();
    activateCrystalInvulnerability();
    return;
  }
  if (!(event.code in movementDirections)) return;
  if (
    gameUi.hidden ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    (event.target instanceof HTMLElement && event.target.isContentEditable)
  ) return;

  event.preventDefault();
  if (!event.repeat) heldMovementKeys.add(event.code);
}, { passive: false });

window.addEventListener("keyup", event => {
  if (!(event.code in movementDirections)) return;
  heldMovementKeys.delete(event.code);
});

function updatePlayerAim(clientX: number, clientY: number): void {
  const target = renderer.worldPointAt(clientX, clientY);
  if (!target) return;
  const center = actorCollisionCenter(player, PLAYER_SPEC.visualCenterOffsetY);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < 1) return;

  playerFacing = { x: dx / magnitude, y: dy / magnitude };
  updatePlayerFacingAsset();
}

function resetPlayerInput(): void {
  heldMovementKeys.clear();
  primaryPointerDown = false;
  playerSpriteAnimationToken += 1;
  playerShooting = false;
  setPlayerMoving(false, performance.now());
  updatePlayerFacingAsset();
}

gameViewport.addEventListener("pointerenter", event => {
  pointerInViewport = true;
  if (!gameUi.hidden) updatePlayerAim(event.clientX, event.clientY);
});

gameViewport.addEventListener("pointermove", event => {
  pointerInViewport = true;
  if (primaryPointerDown && (event.buttons & 1) === 0) primaryPointerDown = false;
  if (!gameUi.hidden) updatePlayerAim(event.clientX, event.clientY);
});

gameViewport.addEventListener("pointerdown", event => {
  if (
    gameUi.hidden ||
    !currentLayout ||
    !playerAlive
  ) return;

  if (event.button === 2) {
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    pointerInViewport = true;
    startEnergyDash(event.clientX, event.clientY);
    return;
  }
  if (event.button !== 0) return;

  event.preventDefault();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  pointerInViewport = true;
  primaryPointerDown = true;
  updatePlayerAim(event.clientX, event.clientY);
  shootBullet();
});

gameViewport.addEventListener("contextmenu", event => {
  event.preventDefault();
});

gameViewport.addEventListener("pointerleave", () => {
  pointerInViewport = false;
  primaryPointerDown = false;
});

window.addEventListener("pointerup", event => {
  if (event.button === 0) primaryPointerDown = false;
});

window.addEventListener("pointercancel", () => {
  primaryPointerDown = false;
});

window.addEventListener("blur", () => {
  pointerInViewport = false;
  resetPlayerInput();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) resetPlayerInput();
});

function renderGraph(
  graph: DungeonGraph,
  pageUrl: string,
  {
    spawnRoomId = null,
    stateId = null,
    spawnPortalUrl = null,
  }: Pick<LoadPageOptions, "spawnRoomId" | "stateId"> & { spawnPortalUrl?: string | null } = {},
): void {
  currentStateId = stateId ?? stateIdForPage(pageUrl);
  renderer.clear();
  if (killsCountEl) killsCountEl.textContent = String(runStats.kills);
  updateHealthUi();
  updateWeaponUi();
  bullets = [];
  hideLinkMenu();

  const layout = layoutOrthogonal(graph);
  currentLayout = layout;
  currentRoomsById = new Map(layout.nodes.map(room => [room.id, room]));
  roomRoutingDirty = true;
  nextRoomTowardPlayer = new Map();

  const savedDiscovery = discoveredRoomsByPage.get(currentStateId);
  visitedRooms = savedDiscovery
    ? new Set([...savedDiscovery].filter(id => layout.nodes.some(node => node.id === id)))
    : new Set();

  currentRoomId = null;

  const objects = buildInteractiveObjects(layout, pageUrl);
  currentStairs = objects.stairs;
  currentLoot = objects.loot;
  currentDecorations = buildDecorations(layout, pageUrl);
  rebuildSpatialIndexes();
  currentLoot.push(...createSceneryDrops(currentDecorations, floorIdentity(pageUrl), collectedLoot));

  currentMonsters = buildMonsters(layout, pageUrl);
  updateBossGates();

  const root =
    layout.nodes.find(node => node.isRoot) ||
    layout.nodes.find(node => node.parentId === null);

  const spawnRoom =
    (spawnRoomId !== null
      ? layout.nodes.find(node => node.id === spawnRoomId)
      : null) ||
    root;

  if (spawnRoom) {
    const roomStairs = currentStairs.filter(stair => stair.roomId === spawnRoom.id);
    const entryPortal =
      (spawnPortalUrl
        ? roomStairs.find(stair => stair.url === spawnPortalUrl)
        : null) ||
      roomStairs.find(stair => stair.type === "up");
    player = entryPortal
      ? {
          x: entryPortal.x + PORTAL_DEFINITION.contactOffset.x,
          y: entryPortal.y + PORTAL_DEFINITION.contactOffset.y,
        }
      : { x: spawnRoom.x, y: spawnRoom.y };

    currentRoomId = spawnRoom.id;
    gameCanvasHost.dataset.currentRoomTag = spawnRoom.tag;
    visitedRooms.add(spawnRoom.id);

    if (root) {
      visitedRooms.add(root.id);
    }

    discoveredRoomsByPage.set(currentStateId, new Set(visitedRooms));
  }
  portalContacts.clear();
  updatePortalContacts(
    currentStairs,
    player,
    PORTAL_DEFINITION.contactRadius,
    portalContacts,
    PORTAL_DEFINITION.contactOffset,
  );

  renderer.setWorld(layout, visitedRooms);
  updateFogOfWar();
  renderDecorations();

  for (const roomId of visitedRooms) {
    activateMonstersInRoom(roomId);
  }

  renderMonsters();
  renderInteractiveObjects();
  updatePlayerFacingAsset();
  revealRoomsFromCorridor(player.x, player.y);
  updateCameraForPlayer(true);
  updateLootUi();
  startGameLoop();

  setStatus(
    `Map: ${layout.nodes.length} visible rooms · ${layout.links.length} corridors` +
    ` · ${currentStairs.filter(d => d.type === "down").length} down stairs` +
    ` · ${currentLoot.length} loot` +
    ` · ${currentMonsters.filter(d => d.active && !d.dead).length} active monsters` +
    (layout.hiddenCount ? ` · ${layout.hiddenCount} hidden to avoid overlap` : "") +
    (graph.coalescedCount ? ` · coalesced ${graph.coalescedCount} of ${graph.originalCount}` : "") +
    ` · ${pageUrl}` +
    (graph.truncated ? ` · source capped at ${MAX_NODES} elements` : "")
  );
}

async function loadPage(
  rawUrl: string,
  {
    pushCurrent = false,
    popBack = false,
    returnRoomId = null,
    spawnRoomId = null,
    stateId = null
  }: LoadPageOptions = {},
): Promise<void> {
  resetPlayerInput();
  portalTransitioning = false;
  const requestId = ++currentRequest;
  const departingPageUrl = currentPageUrl;

  let url: string;
  try {
    url = normalizeUrl(rawUrl);
  } catch {
    setStatus("That does not look like a valid URL.", true);
    return;
  }

  urlInput.value = url;
  setStatus("Fetching " + url + " …");

  try {
    const html = await fetchHtml(url);
    if (requestId !== currentRequest) return;

    setStatus("Parsing HTML …");
    const graph = domToGraph(html, url);
    saveCurrentFloorState();

    if (pushCurrent && currentPageUrl) {
      navigationHistory.push(currentPageUrl);
      navigationReturnRooms.push(returnRoomId ?? currentRoomId);
    }

    if (
      popBack &&
      navigationHistory[navigationHistory.length - 1] === url
    ) {
      navigationHistory.pop();
      navigationReturnRooms.pop();
    }

    currentPageUrl = url;
    currentStateId = stateId ?? stateIdForPage(url);
    renderGraph(graph, url, {
      spawnRoomId,
      stateId: currentStateId,
      spawnPortalUrl: popBack ? departingPageUrl : null,
    });
  } catch (err) {
    if (requestId !== currentRequest) return;
    const message = err instanceof Error ? err.message : "Unknown error";
    setStatus(
      `Could not load ${url}: ${message}. ` +
      "The remote site may reject automated requests or the server may have blocked the target URL.",
      true
    );
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadPage(urlInput.value, { pushCurrent: true });
});

welcomeForm.addEventListener("submit", (event) => {
  event.preventDefault();

  navigationHistory.length = 0;
  navigationReturnRooms.length = 0;
  currentStateId = null;
  gameUi.hidden = false;
  welcomeScreen.hidden = true;
  renderer.start();
  equipDefaultWeapon();

  urlInput.value = welcomeUrlInput.value;
  loadPage(welcomeUrlInput.value);
  updateHudPanels();
});
