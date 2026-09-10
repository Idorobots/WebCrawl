import { fetchHtml, normalizeUrl } from "./api/fetch-html";
import {
  BULLET_MAX_DISTANCE,
  BULLET_RADIUS,
  LOOT_ASSETS,
  LOOT_RADIUS,
  MAX_NODES,
  MAX_ROOMS_AFTER_COALESCE,
  MONSTER_ASSETS,
  PLAYER_FRAMES,
  PLAYER_IDLE_ASSETS,
  PLAYER_MAX_HP,
  PLAYER_MUZZLE_DISTANCE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  STAIR_RADIUS,
  WORLD_SCALE,
  type SpriteDirection,
} from "./config";
import { distanceSquared, pointInCorridor, pointInRoom } from "./domain/geometry";
import {
  buildDecorations as createDecorations,
  buildInteractiveObjects as createInteractiveObjects,
  buildMonsters as createMonsters,
  buildSceneryDrops as createSceneryDrops,
  bossLootDrops,
  lootKindForSeed,
  monsterSpecForBossSummon,
  monsterSpecForSpawner,
} from "./domain/generation";
import { domToGraph } from "./domain/graph";
import { layoutOrthogonal } from "./domain/layout";
import { aStarPath } from "./domain/pathfinding";
import { DEFAULT_WEAPON, projectilesForWeapon, replenishWeaponAmmo } from "./domain/weapons";
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
const minimapCanvas = requireElement<HTMLCanvasElement>("#minimapCanvas");
const sideFloorLabelEl = requireElement<HTMLElement>("#sideFloorLabel");
const statRoomsEl = requireElement<HTMLElement>("#statRooms");
const statFloorEl = requireElement<HTMLElement>("#statFloor");
const statLootEl = requireElement<HTMLElement>("#statLoot");
const statKillsEl = requireElement<HTMLElement>("#statKills");
const statShotsEl = requireElement<HTMLElement>("#statShots");
const statTimeEl = requireElement<HTMLElement>("#statTime");
const playerHudPortraitEl = requireElement<HTMLImageElement>("#playerHudPortrait");

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
const SPATIAL_CELL_SIZE = 512;
const world = (value: number): number => Math.round(value * WORLD_SCALE);
interface GeometryCell {
  rooms: Set<GraphNode>;
  links: Set<LayoutLink>;
}
let geometryCells = new Map<string, GeometryCell>();
let obstacleCells = new Map<string, Set<Decoration>>();
const discoveredRoomsByPage = new Map<string, Set<number>>();
const monsterStatesByPage = new Map<string, Map<string, MonsterState>>();

let currentRoomId: number | null = null;
let player: Point = { x: 0, y: 0 };
let playerFacing: Point = { x: 0, y: -1 };
let playerHp = PLAYER_MAX_HP;
let playerAlive = true;
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

let lootScore = 0;
const collectedLoot = new Set<string>();
let runStartedAt: number | null = null;

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
let currentPlayerSpriteAsset = PLAYER_IDLE_ASSETS.up;
let primaryPointerDown = false;
let pointerInViewport = false;
const heldMovementKeys = new Set<string>();

// These duplicate counters were removed from the bottom HUD in v19.
// Keep guarded references because some legacy update paths still touch them.
const lootCountEl = document.querySelector<HTMLElement>("#lootCount");
const hpCountEl = requireElement<HTMLElement>("#hpCount");
const killsCountEl = document.querySelector<HTMLElement>("#killsCount");
const hudHealthFillEl = requireElement<HTMLElement>("#hudHealthFill");
const weaponNameEl = requireElement<HTMLElement>("#weaponName");
const ammoCountEl = requireElement<HTMLElement>("#ammoCount");

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
const minimapModal = requireElement<HTMLDivElement>("#minimapModal");
const minimapClose = requireElement<HTMLButtonElement>("#minimapClose");

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

function centerCameraOnPlayer(): void {
  renderer.centerCamera(player);
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
      visibleIds.has(link.source.id) ||
      visibleIds.has(link.target.id)
    )
  };
}

function renderMapInto(canvas: HTMLCanvasElement): void {
  const { nodes, links } = minimapVisibleLayout();
  const visibleIds = new Set(nodes.map(node => node.id));
  const boundsRect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(boundsRect.width || canvas.clientWidth || 320));
  const height = Math.max(1, Math.round(boundsRect.height || canvas.clientHeight || 220));
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
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
  const scale = Math.min((width - pad * 2) / Math.max(1, bounds.maxX - bounds.minX), (height - pad * 2) / Math.max(1, bounds.maxY - bounds.minY));
  const mapX = (x: number): number => pad + (x - bounds.minX) * scale;
  const mapY = (y: number): number => pad + (y - bounds.minY) * scale;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#315267";
  context.lineWidth = Math.max(2, 20 * scale);
  for (const link of links) {
    context.beginPath();
    link.points.forEach((point, index) => index ? context.lineTo(mapX(point.x), mapY(point.y)) : context.moveTo(mapX(point.x), mapY(point.y)));
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

function renderSideMinimap(): void {
  renderMapInto(sideMinimapCanvas);
}

function formatRunTime(): string {
  if (!runStartedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((performance.now() - runStartedAt) / 1000));
  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function updateHudPanels(): void {
  const floor = navigationHistory.length + 1;
  const rooms = visitedRooms.size;

  sideFloorLabelEl.textContent = `FLOOR ${floor}`;
  statRoomsEl.textContent = `${rooms} / ${MAX_ROOMS_AFTER_COALESCE}`;
  statFloorEl.textContent = String(floor);
  statLootEl.textContent = String(lootScore);
  statKillsEl.textContent = String(runStats.kills);
  statShotsEl.textContent = String(runStats.shotsFired);
  statTimeEl.textContent = formatRunTime();
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

function closeMinimap(): void {
  minimapModal.classList.remove("open");
  minimapModal.hidden = true;
}

function openMinimap(): void {
  if (!currentLayout) return;
  minimapModal.hidden = false;
  minimapModal.classList.add("open");
  requestAnimationFrame(() => renderMapInto(minimapCanvas));
}

minimapClose.addEventListener("click", closeMinimap);
minimapModal.addEventListener("click", event => {
  if (event.target === minimapModal) closeMinimap();
});

function updateHealthUi(): void {
  const ratio = Math.max(0, Math.min(1, playerHp / PLAYER_MAX_HP));
  hpCountEl.textContent = String(playerHp);
  hudHealthFillEl.style.width = `${ratio * 100}%`;

  renderer.setPlayer(player, playerHp, PLAYER_MAX_HP, currentPlayerSpriteAsset);

  if (playerHudPortraitEl) {
    playerHudPortraitEl.src = currentPlayerSpriteAsset;
  }
}

function updateWeaponUi(): void {
  weaponNameEl.textContent = currentWeapon.name;
  ammoCountEl.textContent = currentWeaponAmmo === null
    ? "∞"
    : `${currentWeaponAmmo} / ${currentWeapon.maxAmmo}`;
  gameCanvasHost.dataset.weaponKind = currentWeapon.kind;
  gameCanvasHost.dataset.weaponAmmo = currentWeaponAmmo === null ? "infinite" : String(currentWeaponAmmo);
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
  return item.kind === "crystal" || item.kind === "core";
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
    score: lootScore,
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

  deathScoreEl.textContent = `Loot recovered: ${lootScore}`;
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

function monsterAsset(monster: Monster): string {
  const direction = monster.moveDir ?? "down";
  if (monster.bossKind === "packet-storm") return MONSTER_ASSETS.bossArc[direction];
  if (monster.bossKind === "fork-bomb") return MONSTER_ASSETS.bossMissile[direction];
  if (monster.bossKind === "heap-titan") return MONSTER_ASSETS.bossFortress[direction];
  if (monster.kind === "sentry") {
    const variants = [
      MONSTER_ASSETS.sentryBallistic,
      MONSTER_ASSETS.sentryTwin,
      MONSTER_ASSETS.sentryEnergy,
    ] as const;
    return variants[monster.seed % variants.length]![direction];
  }
  return (monster.fast ? MONSTER_ASSETS.scout : MONSTER_ASSETS.heavy)[direction];
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
  if (!currentPageUrl || !item.obstacle) return;

  obstacleStateMapForPage(currentPageUrl).set(item.id, {
    hp: item.hp,
    destroyed: item.destroyed,
    spawnedCount: item.spawnedCount,
  });
}

function buildDecorations(layout: DungeonLayout, pageUrl: string): Decoration[] {
  return createDecorations(layout, obstacleStateMapForPage(pageUrl), floorNumber());
}

function renderDecorations(): void {
  renderer.renderDecorations(currentDecorations, visitedRooms);
}

function spawnExplosion(x: number, y: number): void {
  renderer.spawnExplosion(x, y);
}

function damageObstacle(item: Decoration, amount: number): void {
  if (!item?.obstacle || item.destroyed) return;

  item.hp = Math.max(0, item.hp - amount);

  if (item.hp <= 0) {
    item.destroyed = true;
    saveObstacleState(item);
    spawnExplosion(item.x, item.y);
    renderDecorations();
    if (currentPageUrl) {
      const drops = createSceneryDrops([item], floorIdentity(currentPageUrl), collectedLoot);
      currentLoot.push(...drops);
      if (drops.length) renderInteractiveObjects();
    }
  } else {
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
    return [{ id: monster.dropId, roomId: monster.roomId, x, y, kind: monster.dropKind }];
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
    if (item.obstacle) saveObstacleState(item);
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
    if (timestamp < spawner.nextSpawnAt) continue;

    const index = spawner.spawnedCount ?? 0;
    const monster = monsterSpecForSpawner(spawner, floorNumber(), index);
    monster.hp = monster.maxHp;
    monster.active = true;
    const spawnOffsets: Point[] = [
      { x: world(64), y: 0 }, { x: -world(64), y: 0 },
      { x: 0, y: world(64) }, { x: 0, y: -world(64) },
      { x: world(78), y: world(78) }, { x: -world(78), y: -world(78) },
    ];
    const safePosition = spawnOffsets
      .map(offset => ({ x: spawner.x + offset.x, y: spawner.y + offset.y }))
      .find(point => isWalkable(point.x, point.y, monster.radius));
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
    spawnExplosion(monster.x, monster.y);
    spawned = true;
  }
  if (spawned) renderMonsters();
}

function renderMonsters(): void {
  renderer.renderMonsters(currentMonsters, monsterAsset);
}

function updateMonsterPositions(): void {
  renderer.updateMonsterPositions(currentMonsters);
}

function applyPlayerDamage(amount: number): void {
  if (!playerAlive) return;

  playerHp = Math.max(0, playerHp - amount);
  hpCountEl.textContent = String(playerHp);

  renderer.flashPlayer();

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
  if (!currentPageUrl || !monster.dropsLoot || monster.droppedLoot) return;

  monster.droppedLoot = true;
  monster.dropX = monster.x;
  monster.dropY = monster.y;
  if (!isBoss(monster)) {
    monster.dropId = `${floorIdentity(currentPageUrl)}::${monster.id}::monster-drop`;
    monster.dropKind = lootKindForSeed(monster.seed);
  }
  currentLoot.push(...lootDropsForMonster(monster).filter(item => !collectedLoot.has(item.id)));
}

function damageMonster(monster: Monster, amount: number): void {
  if (monster.dead) return;

  monster.hp = Math.max(0, monster.hp - amount);

  if (monster.hp <= 0) {
    monster.dead = true;
    monster.deathAnimating = true;
    runStats.kills += 1;

    if (isBoss(monster)) {
      runStats.bossKills = (runStats.bossKills ?? 0) + 1;
      updateBossGates();
    } else if (monster.fast) {
      runStats.fastKills += 1;
    } else if (monster.kind === "sentry") {
      runStats.sentryKills = (runStats.sentryKills ?? 0) + 1;
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
    radius = BULLET_RADIUS,
    maxDistance = monster.projectileRange,
    style = "enemy",
  }: {
    speed?: number;
    damage?: number;
    radius?: number;
    maxDistance?: number;
    style?: BulletStyle;
  } = {},
): void {
  const muzzleDistance = Math.max(monster.radius + radius + world(5), monster.size * 0.42);
  bullets.push({
    id: `${monster.id}-${performance.now()}-${bullets.length}`,
    owner: "enemy",
    damage,
    x: monster.x + direction.x * muzzleDistance,
    y: monster.y + direction.y * muzzleDistance,
    vx: direction.x * speed,
    vy: direction.y * speed,
    traveled: 0,
    radius,
    maxDistance,
    style,
  });
}

function shootEnemyBullet(monster: Monster, direction: Point): void {
  const now = performance.now();
  queueEnemyBullet(monster, direction);
  monster.lastAttackAt = now;
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
  const toPlayer = { x: player.x - monster.x, y: player.y - monster.y };
  const playerDistance = Math.max(1, Math.hypot(toPlayer.x, toPlayer.y));
  const aimed = { x: toPlayer.x / playerDistance, y: toPlayer.y / playerDistance };

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
    spawnExplosion(minion.x, minion.y);
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

function hasLineOfSight(from: Point, to: Point, step = 14): boolean {
  return hasWalkableLine(from, to, BULLET_RADIUS, step);
}

function monsterPathBounds(monster: Monster, target: Point): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return {
    minX: Math.min(monster.x, target.x) - 180,
    maxX: Math.max(monster.x, target.x) + 180,
    minY: Math.min(monster.y, target.y) - 180,
    maxY: Math.max(monster.y, target.y) + 180,
  };
}

function updateMonsterPath(monster: Monster, target: Point, targetRoomId: number | null, timestamp: number): void {
  if (monster.kind === "sentry") return;
  if (timestamp < (monster.nextPathRefreshAt ?? 0) && monster.path?.length) return;

  const start = { x: monster.x, y: monster.y };
  const path = hasWalkableLine(start, target, monster.radius, 24)
    ? [target]
    : aStarPath(
      start,
      target,
      point => isWalkable(point.x, point.y, monster.radius),
      18,
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

function moveMonsterTowards(monster: Monster, target: Point, dt: number): void {
  const waypoint = monster.path?.[monster.pathIndex ?? 0] ?? target;
  const dx = waypoint.x - monster.x;
  const dy = waypoint.y - monster.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= 10 && monster.path && (monster.pathIndex ?? 0) < monster.path.length - 1) {
    monster.pathIndex = (monster.pathIndex ?? 0) + 1;
    moveMonsterTowards(monster, target, dt);
    return;
  }

  if (distance <= 0.001) {
    monster.moveDir = null;
    return;
  }

  const step = Math.min(distance, monster.speed * dt);
  const nextX = monster.x + dx / distance * step;
  const nextY = monster.y + dy / distance * step;

  monster.moveDir =
    Math.abs(dx) > Math.abs(dy)
      ? (dx < 0 ? "left" : "right")
      : (dy < 0 ? "up" : "down");

  if (isWalkable(nextX, nextY, monster.radius)) {
    monster.x = nextX;
    monster.y = nextY;
    return;
  }

  if (Math.abs(dx) > Math.abs(dy) && isWalkable(nextX, monster.y, monster.radius)) {
    monster.x = nextX;
  } else if (isWalkable(monster.x, nextY, monster.radius)) {
    monster.y = nextY;
  } else {
    monster.path = [];
    monster.nextPathRefreshAt = 0;
  }
}

function updateBoss(monster: Monster, dt: number, timestamp: number): void {
  if (currentRoomId === null) return;
  const sharesPlayerRoom = monster.roomId === currentRoomId;
  let target: Point = player;
  let targetRoomId = currentRoomId;
  if (!sharesPlayerRoom) {
    const nextRoomId = nextRoomTowardPlayer.get(monster.roomId);
    const nextRoom = nextRoomId === undefined ? undefined : currentRoomsById.get(nextRoomId);
    if (!nextRoom) return;
    target = nextRoom;
    targetRoomId = nextRoom.id;
  }
  if (monster.bossKind === "heap-titan" || !sharesPlayerRoom) {
    updateMonsterPath(monster, target, targetRoomId, timestamp);
    moveMonsterTowards(monster, target, dt);
  }
  const playerDistance = Math.hypot(player.x - monster.x, player.y - monster.y);
  monster.moveDir = cardinalDirection(player.x - monster.x, player.y - monster.y);

  if (monster.bossKind === "packet-storm") {
    if (
      playerDistance <= monster.projectileRange &&
      timestamp - monster.lastAttackAt >= monster.attackCooldownMs
    ) fireBossVolley(monster, timestamp);
    return;
  }

  if (monster.bossKind === "fork-bomb") {
    if (monster.nextSpecialAt === undefined) monster.nextSpecialAt = timestamp + 2_800;
    if (sharesPlayerRoom && timestamp >= monster.nextSpecialAt) summonBossMinions(monster, timestamp);
    if (
      playerDistance <= monster.projectileRange &&
      timestamp - monster.lastAttackAt >= monster.attackCooldownMs
    ) fireBossVolley(monster, timestamp);
    return;
  }

  if (playerDistance <= monster.attackRange && timestamp - monster.lastAttackAt >= monster.attackCooldownMs) {
    monster.lastAttackAt = timestamp;
    applyPlayerDamage(monster.attackDamage);
  }
  if (monster.nextSpecialAt === undefined) monster.nextSpecialAt = timestamp + 2_000;
  if (timestamp >= monster.nextSpecialAt && playerDistance <= monster.projectileRange) {
    const count = monster.hp <= monster.maxHp / 2 ? 12 : 8;
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2;
      queueEnemyBullet(monster, { x: Math.cos(angle), y: Math.sin(angle) }, {
        damage: Math.max(1, Math.floor(monster.attackDamage / 2)),
      radius: world(8),
        maxDistance: monster.projectileRange,
        style: "shockwave",
      });
    }
    monster.nextSpecialAt = timestamp + Math.max(1_800, 3_600 - floorNumber() * 90);
    monster.attackSequence = (monster.attackSequence ?? 0) + 1;
    saveMonsterState(monster);
    renderBullets();
  }
}

function renderBullets(): void {
  renderer.renderBullets(bullets);
}

function shootBullet(): void {
  if (!playerAlive || !minimapModal.hidden) return;

  const now = performance.now();
  if (now - lastPlayerShotAt < currentWeapon.fireCooldownMs) return;
  lastPlayerShotAt = now;
  runStats.shotsFired += 1;
  statShotsEl.textContent = String(runStats.shotsFired);
  playPlayerShootFrames();

  const projectiles = projectilesForWeapon(currentWeapon, playerFacing, weaponShotSequence);
  const perpendicular = { x: -playerFacing.y, y: playerFacing.x };
  for (const [index, projectile] of projectiles.entries()) {
    const muzzleDistance = Math.max(
      PLAYER_RADIUS + projectile.radius + world(7),
      PLAYER_MUZZLE_DISTANCE,
    );
    const x = player.x + playerFacing.x * muzzleDistance + perpendicular.x * projectile.lateralOffset;
    const y = player.y + playerFacing.y * muzzleDistance + perpendicular.y * projectile.lateralOffset;
    bullets.push({
      id: `${now}-${weaponShotSequence}-${index}`,
      owner: "player",
      damage: projectile.damage,
      x,
      y,
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
      const bulletRadius = bullet.radius ?? BULLET_RADIUS;

      if (
        bullet.traveled >= (bullet.maxDistance ?? BULLET_MAX_DISTANCE) ||
        !isGeometryWalkable(bullet.x, bullet.y, bulletRadius)
      ) {
        alive = false;
        break;
      }

      for (const monster of currentMonsters) {
        if (bullet.owner !== "player" || !monster.active || monster.dead) continue;

        const hitDistance = Math.hypot(
          bullet.x - monster.x,
          bullet.y - monster.y
        );

        if (hitDistance <= monster.radius + bulletRadius) {
          damageMonster(monster, bullet.damage);
          alive = false;
          break;
        }
      }

      if (!alive) break;

      if (bullet.owner === "enemy") {
        const playerDistance = Math.hypot(
          bullet.x - player.x,
          bullet.y - player.y
        );

        if (playerDistance <= PLAYER_RADIUS + bulletRadius) {
          applyPlayerDamage(bullet.damage);
          alive = false;
          break;
        }
      }

      for (const item of currentDecorations) {
        if (!item.obstacle || item.destroyed) continue;

        const hitDistance = Math.hypot(
          bullet.x - item.x,
          bullet.y - item.y
        );

        if (hitDistance <= item.radius + bulletRadius) {
          damageObstacle(item, 1);
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

  if (!playerAlive || !minimapModal.hidden || !currentLayout) {
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

  updatePlayerMovement(dt, timestamp);
  if (primaryPointerDown && pointerInViewport) shootBullet();
  updateBullets(dt);
  updateMonsterSpawners(timestamp);

  rebuildRoomRouting();

  for (const monster of currentMonsters) {
    if (!monster.active || monster.dead) continue;

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

    if (monster.kind === "sentry") {
      monster.moveDir = cardinalDirection(player.x - monster.x, player.y - monster.y);
      const playerDistance = Math.hypot(player.x - monster.x, player.y - monster.y);
      if (
        playerDistance <= monster.projectileRange &&
        timestamp - monster.lastAttackAt >= monster.attackCooldownMs &&
        hasLineOfSight(monster, player)
      ) {
        const direction = {
          x: (player.x - monster.x) / playerDistance,
          y: (player.y - monster.y) / playerDistance,
        };
        shootEnemyBullet(monster, direction);
      }
      continue;
    }

    const targetPoint = { x: targetX, y: targetY };
    const pathStale =
      !monster.path?.length ||
      monster.pathTargetRoomId !== targetRoomId ||
      Math.hypot((monster.pathTargetX ?? targetX) - targetX, (monster.pathTargetY ?? targetY) - targetY) > 48;
    if (pathStale) monster.nextPathRefreshAt = 0;
    updateMonsterPath(monster, targetPoint, targetRoomId, timestamp);
    moveMonsterTowards(monster, targetPoint, dt);

    const playerDistance = Math.hypot(
      player.x - monster.x,
      player.y - monster.y
    );

    if (
      playerDistance <= monster.attackRange &&
      timestamp - monster.lastAttackAt >= monster.attackCooldownMs
    ) {
      monster.lastAttackAt = timestamp;
      applyPlayerDamage(monster.attackDamage);
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
    if (!item.obstacle) continue;
    const extent = item.radius + margin;
    forSpatialCells(item.x - extent, item.x + extent, item.y - extent, item.y + extent, key => {
      const cell = obstacleCells.get(key) ?? new Set();
      cell.add(item);
      obstacleCells.set(key, cell);
    });
  }
}

function pointBlockedByDecoration(x: number, y: number, radius = PLAYER_RADIUS): boolean {
  for (const item of obstacleCells.get(spatialCellKey(x, y)) ?? []) {
    if (!item.obstacle || item.destroyed) continue;

    const footprint = item.footprint ?? item.radius;
    const distance = Math.hypot(x - item.x, y - item.y);
    if (distance < radius + footprint) return true;
  }

  return false;
}

function isGeometryWalkable(x: number, y: number, radius = PLAYER_RADIUS): boolean {
  if (!currentLayout) return false;
  const cell = geometryCells.get(spatialCellKey(x, y));
  if (!cell) return false;
  for (const room of cell.rooms) {
    if (pointInRoom(x, y, room, radius)) return true;
  }
  for (const link of cell.links) {
    if (pointInCorridor(x, y, link, radius)) return true;
  }

  return false;
}

function isWalkable(x: number, y: number, radius = PLAYER_RADIUS): boolean {
  return (
    isGeometryWalkable(x, y, radius) &&
    !pointBlockedByDecoration(x, y, radius)
  );
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
  renderer.setPlayer(player, playerHp, PLAYER_MAX_HP, currentPlayerSpriteAsset);
  updatePlayerVisual();
  updatePlayerAnimationClasses();
  updateHealthUi();
}

function updatePlayerVisual(): void {
  renderer.setPlayer(player, playerHp, PLAYER_MAX_HP, currentPlayerSpriteAsset);
}

function checkLoot(): void {
  let changed = false;
  queuedLootDrops = [];

  for (const item of currentLoot) {
    if (
      temporarilyBlockedLoot.has(item.id) &&
      distanceSquared(player, item) > LOOT_RADIUS * LOOT_RADIUS
    ) {
      temporarilyBlockedLoot.delete(item.id);
    }
  }

  currentLoot = currentLoot.filter(item => {
    if (
      distanceSquared(player, item) <= LOOT_RADIUS * LOOT_RADIUS &&
      !temporarilyBlockedLoot.has(item.id)
    ) {
      collectedLoot.add(item.id);
      lootScore += 1;
      if (lootCountEl) lootCountEl.textContent = String(lootScore);
      updateHudPanels();

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
        const restored = playerHp < PLAYER_MAX_HP ? 1 : 0;

        if (restored > 0) {
          playerHp += restored;
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
  for (const stair of currentStairs) {
    if (stair.enabled === false) continue;

    if (distanceSquared(player, stair) <= STAIR_RADIUS * STAIR_RADIUS) {
      if (stair.type === "up") {
        goBack();
      } else {
        if (stair.url) navigateTo(stair.url, stair.roomId);
      }
      return true;
    }
  }

  return false;
}

function playerFramesFor(
  direction: PlayerDirection = playerDirectionName(),
  kind: PlayerAnimation = "walk",
): string[] {
  return PLAYER_FRAMES[direction]?.[kind] || PLAYER_FRAMES.right.walk;
}

function playerAssetForDirection(direction: PlayerDirection = playerDirectionName()): string {
  return PLAYER_IDLE_ASSETS[direction];
}

function setPlayerSpriteAsset(asset: string): void {
  currentPlayerSpriteAsset = asset;
  renderer.setPlayerAsset(asset);

  if (playerHudPortraitEl) {
    playerHudPortraitEl.src = asset;
  }
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
  const token = ++playerSpriteAnimationToken;
  const frameCount = playerFramesFor(playerDirectionName(), "shoot").length;
  playerShooting = true;
  updatePlayerAnimationClasses();

  for (let index = 0; index < frameCount; index++) {
    setTimeout(() => {
      if (token !== playerSpriteAnimationToken) return;
      const frames = playerFramesFor(playerDirectionName(), "shoot");
      setPlayerSpriteAsset(frames[index % frames.length]!);
    }, index * 55);
  }

  setTimeout(() => {
    if (token !== playerSpriteAnimationToken) return;
    playerShooting = false;
    updatePlayerAnimationClasses();
    updatePlayerFacingAsset();
  }, frameCount * 55 + 10);
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

    if (!moving && !playerShooting) {
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

  const distance = PLAYER_SPEED * dt;
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
  centerCameraOnPlayer();
  checkLoot();
  if (checkStairs()) heldMovementKeys.clear();
}

function teleportPlayerTo(x: number, y: number): void {
  if (!currentLayout || !isWalkable(x, y)) return;
  player = { x, y };
  updatePlayerVisual();
  revealRoomsFromCorridor(player.x, player.y);
  updateCurrentRoom();
  centerCameraOnPlayer();
  checkLoot();
}

(window as Window & {
  __webcrawlTest?: {
    teleportPlayerTo: (x: number, y: number) => void;
    setWeaponAmmo: (ammo: number) => void;
    loot: () => Array<{ id: string; kind: string; x: number; y: number; ammo: number | null; name: string | null }>;
    lastDroppedWeapon: () => { id: string; x: number; y: number; ammo: number | null; maxAmmo: number | null; name: string | null } | null;
  };
}).__webcrawlTest = {
  teleportPlayerTo,
  setWeaponAmmo(ammo: number): void {
    if (currentWeapon.maxAmmo === null) return;
    currentWeaponAmmo = Math.max(0, Math.min(currentWeapon.maxAmmo, ammo));
    updateWeaponUi();
  },
  loot: () => currentLoot.map(item => ({
    id: item.id,
    kind: item.kind,
    x: item.x,
    y: item.y,
    ammo: item.weaponAmmo ?? item.weapon?.maxAmmo ?? null,
    name: item.weapon?.name ?? null,
  })),
  lastDroppedWeapon: () => lastDroppedWeapon
    ? {
      id: lastDroppedWeapon.id,
      x: lastDroppedWeapon.x,
      y: lastDroppedWeapon.y,
      ammo: lastDroppedWeapon.weaponAmmo ?? lastDroppedWeapon.weapon?.maxAmmo ?? null,
      maxAmmo: lastDroppedWeapon.weapon?.maxAmmo ?? null,
      name: lastDroppedWeapon.weapon?.name ?? null,
    }
    : null,
};

window.addEventListener("keydown", event => {
  if (event.key === "Escape" && !minimapModal.hidden) {
    event.preventDefault();
    closeMinimap();
    return;
  }

  if (event.key.toLowerCase() === "m" && !gameUi.hidden) {
    event.preventDefault();
    if (minimapModal.hidden) {
      resetPlayerInput();
      openMinimap();
    } else {
      closeMinimap();
    }
    return;
  }

  if (!(event.code in movementDirections)) return;
  if (
    !minimapModal.hidden ||
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
  const bounds = gameViewport.getBoundingClientRect();
  const dx = clientX - (bounds.left + bounds.width / 2);
  const dy = clientY - (bounds.top + bounds.height / 2);
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
    event.button !== 0 ||
    gameUi.hidden ||
    !currentLayout ||
    !playerAlive ||
    !minimapModal.hidden
  ) return;

  event.preventDefault();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  pointerInViewport = true;
  primaryPointerDown = true;
  updatePlayerAim(event.clientX, event.clientY);
  shootBullet();
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
  { spawnRoomId = null, stateId = null }: Pick<LoadPageOptions, "spawnRoomId" | "stateId"> = {},
): void {
  currentStateId = stateId ?? stateIdForPage(pageUrl);
  renderer.clear();
  hpCountEl.textContent = String(playerHp);
  if (killsCountEl) killsCountEl.textContent = String(runStats.kills);
  updateHealthUi();
  updateWeaponUi();
  bullets = [];
  hideLinkMenu();
  closeMinimap();

  const { width, height } = renderer.viewportSize();
  const layout = layoutOrthogonal(graph, width, height);
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
    player = {
      x: spawnRoom.x,
      y: spawnRoom.y + world(60)
    };

    if (!isWalkable(player.x, player.y)) {
      player = { x: spawnRoom.x, y: spawnRoom.y };
    }

    currentRoomId = spawnRoom.id;
    gameCanvasHost.dataset.currentRoomTag = spawnRoom.tag;
    visitedRooms.add(spawnRoom.id);

    if (root) {
      visitedRooms.add(root.id);
    }

    discoveredRoomsByPage.set(currentStateId, new Set(visitedRooms));
  }

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
  centerCameraOnPlayer();
  updateHudPanels();
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
  const requestId = ++currentRequest;

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
    renderGraph(graph, url, { spawnRoomId, stateId: currentStateId });
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
  runStartedAt = performance.now();
  equipDefaultWeapon();

  urlInput.value = welcomeUrlInput.value;
  loadPage(welcomeUrlInput.value);
  updateHudPanels();
});

setInterval(() => {
  if (!gameUi.hidden && playerAlive) {
    statTimeEl.textContent = formatRunTime();
  }
}, 1000);
