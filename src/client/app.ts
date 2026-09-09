import * as d3 from "d3";
import { fetchHtml, normalizeUrl } from "./api/fetch-html";
import {
  ASSETS,
  BULLET_MAX_DISTANCE,
  BULLET_RADIUS,
  BULLET_SPEED,
  CAMERA_SCALE,
  LOOT_ASSETS,
  LOOT_RADIUS,
  MAX_NODES,
  MAX_ROOMS_AFTER_COALESCE,
  MONSTER_RADIUS,
  PLAYER_FIRE_COOLDOWN_MS,
  PLAYER_FRAMES,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  STAIR_RADIUS,
} from "./config";
import { distanceSquared, pointInCorridor, pointInRoom } from "./domain/geometry";
import {
  buildDecorations as createDecorations,
  buildInteractiveObjects as createInteractiveObjects,
  buildMonsters as createMonsters,
  buildSceneryDrops as createSceneryDrops,
  lootKindForSeed,
} from "./domain/generation";
import { domToGraph } from "./domain/graph";
import { corridorEndpoints, layoutOrthogonal } from "./domain/layout";
import { aStarPath, revealedRoomPath as findRevealedRoomPath } from "./domain/pathfinding";
import { loadHighScores, rankHighScore, storeHighScores } from "./storage/high-scores";
import type {
  Bullet,
  Decoration,
  DungeonGraph,
  DungeonLayout,
  GraphNode,
  HighScore,
  LayoutLink,
  LoadPageOptions,
  LootItem,
  LootKind,
  Monster,
  MonsterState,
  ObstacleState,
  PlayerAnimation,
  PlayerDirection,
  Point,
  RunStats,
  Stair,
} from "./types";
import { requireElement } from "./ui/elements";

type Layer = d3.Selection<SVGGElement, unknown, any, any>;
type SvgSelection = d3.Selection<SVGSVGElement, unknown, any, any>;

const svg = d3.select<SVGSVGElement, unknown>("#map");
const gameViewport = requireElement<HTMLElement>("#gameViewport");
const urlInput = requireElement<HTMLInputElement>("#urlInput");
const form = requireElement<HTMLFormElement>("#urlForm");
const linkMenu = requireElement<HTMLDivElement>("#linkMenu");

const welcomeScreen = requireElement<HTMLDivElement>("#welcomeScreen");
const welcomeForm = requireElement<HTMLFormElement>("#welcomeForm");
const welcomeUrlInput = requireElement<HTMLInputElement>("#welcomeUrlInput");
const gameUi = requireElement<HTMLDivElement>("#gameUi");

const sideMinimapSvg = d3.select<SVGSVGElement, unknown>("#sideMinimapSvg");
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
let currentStairs: Stair[] = [];
let currentLoot: LootItem[] = [];
let currentMonsters: Monster[] = [];
let monsterLayer: Layer | null = null;
let currentDecorations: Decoration[] = [];
let decorationLayer: Layer | null = null;
const destroyedObstaclesByPage = new Map<string, Map<string, ObstacleState>>();
let explosionLayer: Layer | null = null;
let visitedRooms = new Set<number>();
const discoveredRoomsByPage = new Map<string, Set<number>>();
const monsterStatesByPage = new Map<string, Map<string, MonsterState>>();

let currentRoomId: number | null = null;
let player: Point = { x: 0, y: 0 };
let playerFacing: Point = { x: 0, y: -1 };
let playerLayer: Layer | null = null;
let playerHp = PLAYER_MAX_HP;
let playerAlive = true;
let lastPlayerShotAt = -Infinity;

let bullets: Bullet[] = [];
let bulletLayer: Layer | null = null;

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
  shotsFired: 0
};

let playerWalkFrameIndex = 0;
let lastPlayerWalkFrameAt = -Infinity;
let playerSpriteAnimationToken = 0;
let playerMoving = false;
let playerShooting = false;
let primaryPointerDown = false;
let pointerInViewport = false;
const heldMovementKeys = new Set<string>();

// These duplicate counters were removed from the bottom HUD in v19.
// Keep guarded references because some legacy update paths still touch them.
const lootCountEl = document.querySelector<HTMLElement>("#lootCount");
const hpCountEl = requireElement<HTMLElement>("#hpCount");
const killsCountEl = document.querySelector<HTMLElement>("#killsCount");
const hudHealthFillEl = requireElement<HTMLElement>("#hudHealthFill");

const deathModal = requireElement<HTMLDivElement>("#deathModal");
const deathScoreEl = requireElement<HTMLElement>("#deathScore");
const newHighScoreEl = requireElement<HTMLElement>("#newHighScore");
const deathKillsEl = requireElement<HTMLElement>("#deathKills");
const deathFastKillsEl = requireElement<HTMLElement>("#deathFastKills");
const deathSlowKillsEl = requireElement<HTMLElement>("#deathSlowKills");
const deathSentryKillsEl = requireElement<HTMLElement>("#deathSentryKills");
const deathShotsEl = requireElement<HTMLElement>("#deathShots");
const highScoreRowsEl = requireElement<HTMLTableSectionElement>("#highScoreRows");
const restartButton = requireElement<HTMLButtonElement>("#restartButton");
const minimapModal = requireElement<HTMLDivElement>("#minimapModal");
const minimapClose = requireElement<HTMLButtonElement>("#minimapClose");

const defs = svg.append("defs");

const roomPattern = defs
  .append("pattern")
  .attr("id", "roomFloorPattern")
  .attr("width", 34)
  .attr("height", 34)
  .attr("patternUnits", "userSpaceOnUse");

roomPattern
  .append("rect")
  .attr("width", 34)
  .attr("height", 34)
  .attr("fill", "#121c27");

roomPattern
  .append("path")
  .attr("d", "M 34 0 L 0 0 0 34")
  .attr("fill", "none")
  .attr("stroke", "#253747")
  .attr("stroke-width", 1.5);

roomPattern
  .append("circle")
  .attr("cx", 29)
  .attr("cy", 29)
  .attr("r", 1.4)
  .attr("fill", "#3f617b");

const rootLayer = svg.append("g");

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
  rootLayer
    .selectAll<SVGGElement, GraphNode>(".room")
    .classed("visited", d => visitedRooms.has(d.id))
    .classed("unvisited", d => !visitedRooms.has(d.id));

  rootLayer
    .selectAll<SVGLineElement, LayoutLink>(".corridor")
    .classed("visited", d =>
      visitedRooms.has(d.source.id) ||
      visitedRooms.has(d.target.id)
    );

  rootLayer
    .selectAll<SVGLineElement, LayoutLink>(".corridor-light")
    .style("opacity", d =>
      visitedRooms.has(d.source.id) ||
      visitedRooms.has(d.target.id)
        ? 0.45
        : 0
    );

  if (!gameUi.hidden) {
    updateHudPanels();
  }
}

function markVisited(room: GraphNode | null): void {
  if (!room || visitedRooms.has(room.id)) return;

  visitedRooms.add(room.id);

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
    markVisited(room);
    if (roomChanged && alreadyVisited && !gameUi.hidden) updateHudPanels();
  }
}

function cameraTransformForPlayer(): d3.ZoomTransform {
  const { width, height } = svg.node()!.getBoundingClientRect();

  return d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(CAMERA_SCALE)
    .translate(-player.x, -player.y);
}

function centerCameraOnPlayer(): void {
  rootLayer.attr("transform", cameraTransformForPlayer().toString());
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

function drawMinimapStair(layer: Layer, stair: Stair): void {
  const g = layer
    .append("g")
    .attr("class", `minimap-stair ${stair.type}`)
    .attr("transform", `translate(${stair.x},${stair.y}) scale(0.55)`);

  g.append("rect")
    .attr("x", -18)
    .attr("y", -14)
    .attr("width", 36)
    .attr("height", 28)
    .attr("rx", 2);

  for (let y = -8; y <= 8; y += 8) {
    g.append("line")
      .attr("x1", -11)
      .attr("x2", 11)
      .attr("y1", y)
      .attr("y2", y);
  }
}

function renderMapInto(targetSvg: SvgSelection): void {
  const { nodes, links } = minimapVisibleLayout();
  const visibleIds = new Set(nodes.map(node => node.id));

  targetSvg.selectAll("*").remove();

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
    const p = corridorEndpoints(link);
    bounds.minX = Math.min(bounds.minX, p.x1, p.x2);
    bounds.maxX = Math.max(bounds.maxX, p.x1, p.x2);
    bounds.minY = Math.min(bounds.minY, p.y1, p.y2);
    bounds.maxY = Math.max(bounds.maxY, p.y1, p.y2);
  }

  const viewWidth = Math.max(1, bounds.maxX - bounds.minX);
  const viewHeight = Math.max(1, bounds.maxY - bounds.minY);
  const pad = 110;

  targetSvg.attr(
    "viewBox",
    `${bounds.minX - pad} ${bounds.minY - pad} ${viewWidth + pad * 2} ${viewHeight + pad * 2}`
  );

  targetSvg
    .append("g")
    .selectAll<SVGLineElement, LayoutLink>("line")
    .data(links)
    .join("line")
    .attr("class", "minimap-corridor")
    .each(function(this: SVGLineElement, link) {
      const p = corridorEndpoints(link);
      d3.select(this)
        .attr("x1", p.x1)
        .attr("y1", p.y1)
        .attr("x2", p.x2)
        .attr("y2", p.y2);
    });

  const rooms = targetSvg
    .append("g")
    .selectAll<SVGGElement, GraphNode>("g")
    .data(nodes)
    .join("g")
    .attr("class", d =>
      "minimap-room" +
      (d.isRoot ? " root" : "") +
      (d.id === currentRoomId ? " current" : "")
    )
    .attr("transform", d => `translate(${d.x},${d.y})`);

  rooms
    .append("rect")
    .attr("x", d => -d.width / 2)
    .attr("y", d => -d.height / 2)
    .attr("width", d => d.width)
    .attr("height", d => d.height);

  const visibleStairs = currentStairs.filter(stair =>
    visibleIds.has(stair.roomId)
  );

  const stairLayer = targetSvg.append("g");
  for (const stair of visibleStairs) {
    drawMinimapStair(stairLayer, stair);
  }

  const minimapPlayer = targetSvg
    .append("g")
    .attr("class", "minimap-player")
    .attr("transform", `translate(${player.x},${player.y})`);

  minimapPlayer
    .append("image")
    .attr("href", playerAssetForDirection())
    .attr("x", -18.75)
    .attr("y", -25)
    .attr("width", 37.5)
    .attr("height", 50)
    .attr("preserveAspectRatio", "xMidYMid meet");
}

function renderSideMinimap(): void {
  renderMapInto(sideMinimapSvg);
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

function closeMinimap(): void {
  minimapModal.classList.remove("open");
  minimapModal.hidden = true;
}

minimapClose.addEventListener("click", closeMinimap);
minimapModal.addEventListener("click", event => {
  if (event.target === minimapModal) closeMinimap();
});

function updateHealthUi(): void {
  const ratio = Math.max(0, Math.min(1, playerHp / PLAYER_MAX_HP));
  hpCountEl.textContent = String(playerHp);
  hudHealthFillEl.style.width = `${ratio * 100}%`;

  if (playerLayer) {
    playerLayer
      .select(".player-hp-fill")
      .attr("width", 62 * ratio);
  }

  if (playerHudPortraitEl) {
    playerHudPortraitEl.src = playerAssetForDirection();
  }
}

function recordHighScore(): { scores: HighScore[]; rank: number | null } {
  const entry: HighScore = {
    score: lootScore,
    kills: runStats.kills,
    fastKills: runStats.fastKills,
    slowKills: runStats.slowKills,
    sentryKills: runStats.sentryKills,
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

function lootAsset(kind: LootKind): string {
  return LOOT_ASSETS[kind];
}

function monsterLabel(monster: Monster): string {
  if (monster.kind === "sentry") return "Sentry";
  return monster.fast ? "Fast drone" : "Heavy drone";
}

function monsterAsset(monster: Monster): string {
  if (monster.kind === "sentry") {
    return ASSETS.monsterScout;
  }

  if (monster.fast) {
    return (monster.seed & 1)
      ? ASSETS.monsterFast
      : ASSETS.monsterScout;
  }

  return ((monster.seed >>> 4) & 1)
    ? ASSETS.monsterSlow
    : ASSETS.monsterScout;
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
    destroyed: item.destroyed
  });
}

function buildDecorations(layout: DungeonLayout, pageUrl: string): Decoration[] {
  return createDecorations(layout, obstacleStateMapForPage(pageUrl));
}

function renderDecorations(): void {
  if (!decorationLayer) {
    decorationLayer = rootLayer.append("g").attr("class", "decorations");
  }

  const visible = currentDecorations.filter(item =>
    visitedRooms.has(item.roomId) && !item.destroyed
  );

  const decor = decorationLayer
    .selectAll<SVGGElement, Decoration>("g.decoration")
    .data(visible, d => d.id)
    .join(
      enter => {
        const g = enter
          .append("g")
          .attr("class", d => `decoration${d.obstacle ? " obstacle" : ""}`);

        g.append("image")
          .attr("class", "decor-sprite");

        g.filter(d => d.obstacle)
          .append("rect")
          .attr("class", "obstacle-hp-bg")
          .attr("x", -22)
          .attr("y", -35)
          .attr("width", 44)
          .attr("height", 5);

        g.filter(d => d.obstacle)
          .append("rect")
          .attr("class", "obstacle-hp-fill")
          .attr("x", -22)
          .attr("y", -35)
          .attr("height", 5);

        return g;
      },
      update => update,
      exit => exit.remove()
    )
    .attr("class", d =>
      `decoration${d.obstacle ? " obstacle" : ""}${d.obstacle && d.hp < d.maxHp ? " damaged" : ""}`
    )
    .attr("transform", d => `translate(${d.x},${d.y})`);

  decor
    .select(".decor-sprite")
    .attr("href", d => d.asset)
    .attr("x", d => -d.size / 2)
    .attr("y", d => -d.size / 2)
    .attr("width", d => d.size)
    .attr("height", d => d.size);

  decor
    .select(".obstacle-hp-fill")
    .attr("width", d =>
      d.obstacle ? 44 * Math.max(0, d.hp) / Math.max(1, d.maxHp) : 0
    );
}

function spawnExplosion(x: number, y: number): void {
  if (!explosionLayer) {
    explosionLayer = rootLayer.append("g").attr("class", "explosions");
  }

  // Keep world-position translation on an outer group. The inner group
  // owns the CSS scale/rotation animation, so animation transforms cannot
  // override the obstacle's x/y position.
  const anchor = explosionLayer
    .append("g")
    .attr("transform", `translate(${x},${y})`);

  const g = anchor
    .append("g")
    .attr("class", "explosion");

  g.append("circle")
    .attr("class", "blast")
    .attr("r", 20);

  g.append("circle")
    .attr("class", "ring")
    .attr("r", 31);

  g.append("path")
    .attr("d", "M -30 0 L 30 0 M 0 -30 L 0 30 M -21 -21 L 21 21 M -21 21 L 21 -21")
    .attr("stroke", "#ffe79c")
    .attr("stroke-width", 5);

  setTimeout(() => anchor.remove(), 520);
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
      const drops = createSceneryDrops([item], currentPageUrl, collectedLoot);
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
    hp: monster.hp,
    dead: monster.dead,
    active: monster.active,
    droppedLoot: monster.droppedLoot || false,
    dropId: monster.dropId || null,
    dropX: monster.dropX ?? null,
    dropY: monster.dropY ?? null,
    dropKind: monster.dropKind ?? null
  });
}

function buildMonsters(layout: DungeonLayout, pageUrl: string): Monster[] {
  const monsters = createMonsters(layout, monsterStateMapForPage(pageUrl), visitedRooms, floorNumber());
  for (const monster of monsters) {
    if (monster.dead && monster.droppedLoot && monster.dropId && !collectedLoot.has(monster.dropId)) {
      currentLoot.push({
        id: monster.dropId,
        roomId: monster.roomId,
        x: monster.dropX ?? monster.x,
        y: monster.dropY ?? monster.y,
        kind: monster.dropKind || lootKindForSeed(monster.seed),
      });
    }
  }
  return monsters;
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

function renderMonsters(): void {
  if (!monsterLayer) {
    monsterLayer = rootLayer.append("g").attr("class", "monsters");
  }

  const visibleMonsters = currentMonsters.filter(monster =>
    monster.active && (!monster.dead || monster.deathAnimating)
  );

  const monsters = monsterLayer
    .selectAll<SVGGElement, Monster>("g.monster")
    .data(visibleMonsters, d => d.id)
    .join(
      enter => {
        const g = enter
          .append("g")
          .attr("class", d => `monster${d.fast ? " fast" : ""}${d.kind === "sentry" ? " sentry" : ""}`);

        g.append("image")
          .attr("class", "monster-sprite")
          .attr("href", d => monsterAsset(d))
          .attr("x", -31)
          .attr("y", -31)
          .attr("width", 62)
          .attr("height", 62);

        g.append("rect")
          .attr("class", "hp-bg")
          .attr("x", -20)
          .attr("y", -31)
          .attr("width", 40)
          .attr("height", 5);

        g.append("rect")
          .attr("class", "hp-fill")
          .attr("x", -20)
          .attr("y", -31)
          .attr("height", 5);

        g.append("title")
          .text(d => `${monsterLabel(d)} · ${d.maxHp} HP`);

        return g;
      },
      update => update,
      exit => exit.remove()
    )
    .attr("class", d =>
      "monster" +
      (d.fast ? " fast" : "") +
      (d.kind === "sentry" ? " sentry" : "") +
      (d.deathAnimating ? " dying" : "") +
      (d.moveDir === "left" ? " moving-left" : "") +
      (d.moveDir === "right" ? " moving-right" : "")
    )
    .attr("transform", d => `translate(${d.x},${d.y})`);

  monsters
    .select(".hp-fill")
    .attr("width", d => 40 * Math.max(0, d.hp) / d.maxHp);
}

function updateMonsterPositions(): void {
  if (!monsterLayer) return;

  monsterLayer
    .selectAll<SVGGElement, Monster>("g.monster")
    .attr("class", d =>
      "monster" +
      (d.fast ? " fast" : "") +
      (d.kind === "sentry" ? " sentry" : "") +
      (d.deathAnimating ? " dying" : "") +
      (d.moveDir === "left" ? " moving-left" : "") +
      (d.moveDir === "right" ? " moving-right" : "")
    )
    .attr("transform", d => `translate(${d.x},${d.y})`);

  monsterLayer
    .selectAll<SVGRectElement, Monster>(".hp-fill")
    .attr("width", d => 40 * Math.max(0, d.hp) / d.maxHp);
}

function applyPlayerDamage(amount: number): void {
  if (!playerAlive) return;

  playerHp = Math.max(0, playerHp - amount);
  hpCountEl.textContent = String(playerHp);

  if (playerLayer) {
    playerLayer.classed("hit", true);
    setTimeout(() => playerLayer?.classed("hit", false), 120);
  }

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
  if (!monster.dropsLoot || monster.droppedLoot) return;

  const dropId = `${currentPageUrl}::${monster.id}::monster-drop`;
  monster.droppedLoot = true;
  monster.dropId = dropId;
  monster.dropX = monster.x;
  monster.dropY = monster.y;
  monster.dropKind = lootKindForSeed(monster.seed);

  if (!collectedLoot.has(dropId)) {
    currentLoot.push({
      id: dropId,
      roomId: monster.roomId,
      x: monster.x,
      y: monster.y,
      kind: monster.dropKind
    });
  }
}

function damageMonster(monster: Monster, amount: number): void {
  if (monster.dead) return;

  monster.hp = Math.max(0, monster.hp - amount);

  if (monster.hp <= 0) {
    monster.dead = true;
    monster.deathAnimating = true;
    runStats.kills += 1;

    if (monster.fast) {
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

function shootEnemyBullet(monster: Monster, direction: Point): void {
  const now = performance.now();
  const muzzleDistance = MONSTER_RADIUS + 10;

  bullets.push({
    id: `${monster.id}-${now}`,
    owner: "enemy",
    damage: monster.attackDamage,
    x: monster.x + direction.x * muzzleDistance,
    y: monster.y + direction.y * muzzleDistance,
    vx: direction.x * monster.projectileSpeed,
    vy: direction.y * monster.projectileSpeed,
    traveled: 0,
  });

  monster.lastAttackAt = now;
  renderBullets();
}

function hasLineOfSight(from: Point, to: Point, step = 14): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const segments = Math.max(1, Math.ceil(distance / step));

  for (let index = 1; index <= segments; index += 1) {
    const sample = {
      x: from.x + dx * (index / segments),
      y: from.y + dy * (index / segments),
    };
    if (!isGeometryWalkable(sample.x, sample.y, BULLET_RADIUS)) return false;
    if (pointBlockedByDecoration(sample.x, sample.y, BULLET_RADIUS)) return false;
  }

  return true;
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

  const path = aStarPath(
    { x: monster.x, y: monster.y },
    target,
    point => isWalkable(point.x, point.y, MONSTER_RADIUS),
    18,
    2800,
    monsterPathBounds(monster, target),
  );

  monster.path = path ?? [];
  monster.pathIndex = path && path.length > 1 ? 1 : 0;
  monster.pathTargetRoomId = targetRoomId;
  monster.pathTargetX = target.x;
  monster.pathTargetY = target.y;
  monster.nextPathRefreshAt = timestamp + 260;
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
      : null;

  if (isWalkable(nextX, nextY, MONSTER_RADIUS)) {
    monster.x = nextX;
    monster.y = nextY;
    return;
  }

  if (Math.abs(dx) > Math.abs(dy) && isWalkable(nextX, monster.y, MONSTER_RADIUS)) {
    monster.x = nextX;
  } else if (isWalkable(monster.x, nextY, MONSTER_RADIUS)) {
    monster.y = nextY;
  } else {
    monster.path = [];
    monster.nextPathRefreshAt = 0;
  }
}

function renderBullets(): void {
  if (!bulletLayer) {
    bulletLayer = rootLayer.append("g").attr("class", "bullets");
  }

  bulletLayer
    .selectAll<SVGCircleElement, Bullet>("circle.bullet")
    .data(bullets, d => d.id)
    .join(
      enter => enter
        .append("circle")
        .attr("class", "bullet")
        .attr("r", BULLET_RADIUS),
      update => update,
      exit => exit.remove()
    )
    .attr("cx", d => d.x)
    .attr("cy", d => d.y);
}

function shootBullet(): void {
  if (!playerAlive || !minimapModal.hidden) return;

  const now = performance.now();
  if (now - lastPlayerShotAt < PLAYER_FIRE_COOLDOWN_MS) return;
  lastPlayerShotAt = now;
  runStats.shotsFired += 1;
  statShotsEl.textContent = String(runStats.shotsFired);
  playPlayerShootFrames();

  const muzzleDistance = PLAYER_RADIUS + 12;
  const x = player.x + playerFacing.x * muzzleDistance;
  const y = player.y + playerFacing.y * muzzleDistance;

  bullets.push({
    id: `${now}-${Math.random()}`,
    owner: "player",
    damage: 1,
    x,
    y,
    vx: playerFacing.x * BULLET_SPEED,
    vy: playerFacing.y * BULLET_SPEED,
    traveled: 0
  });

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
    const segments = Math.max(1, Math.ceil(stepDistance / 8));
    const dx = stepX / segments;
    const dy = stepY / segments;
    let alive = true;

    for (let i = 0; i < segments && alive; i++) {
      bullet.x += dx;
      bullet.y += dy;
      bullet.traveled += Math.hypot(dx, dy);

      if (
        bullet.traveled >= BULLET_MAX_DISTANCE ||
        !isGeometryWalkable(bullet.x, bullet.y, BULLET_RADIUS)
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

        if (hitDistance <= MONSTER_RADIUS + BULLET_RADIUS) {
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

        if (playerDistance <= PLAYER_RADIUS + BULLET_RADIUS) {
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

        if (hitDistance <= item.radius + BULLET_RADIUS) {
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

  const roomsById = new Map(currentLayout.nodes.map(room => [room.id, room]));

  for (const monster of currentMonsters) {
    if (!monster.active || monster.dead) continue;

    const containingRoom = roomContainingPoint(monster.x, monster.y);
    if (containingRoom && visitedRooms.has(containingRoom.id)) {
      monster.roomId = containingRoom.id;
    }

    const path = findRevealedRoomPath(currentLayout, visitedRooms, monster.roomId, currentRoomId);
    if (!path) continue;

    let targetX = player.x;
    let targetY = player.y;

    if (monster.roomId !== currentRoomId && path.length >= 2) {
      const nextRoom = roomsById.get(path[1]!);
      if (!nextRoom) continue;
      targetX = nextRoom.x;
      targetY = nextRoom.y;
    }

    const targetRoomId = monster.roomId !== currentRoomId && path.length >= 2
      ? path[1]!
      : currentRoomId;

    if (monster.kind === "sentry") {
      monster.moveDir = null;
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
      Math.hypot((monster.pathTargetX ?? targetX) - targetX, (monster.pathTargetY ?? targetY) - targetY) > 24;
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

function pointBlockedByDecoration(x: number, y: number, radius = PLAYER_RADIUS): boolean {
  for (const item of currentDecorations) {
    if (!item.obstacle || item.destroyed) continue;

    const distance = Math.hypot(x - item.x, y - item.y);
    if (distance < radius + item.radius) return true;
  }

  return false;
}

function isGeometryWalkable(x: number, y: number, radius = PLAYER_RADIUS): boolean {
  if (!currentLayout) return false;

  for (const room of currentLayout.nodes) {
    if (pointInRoom(x, y, room, radius)) return true;
  }

  for (const link of currentLayout.links) {
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

function drawStaircase(layer: Layer, stair: Stair): void {
  const g = layer
    .append("g")
    .attr("class", `stairs ${stair.type}${stair.enabled === false ? " inactive" : ""}`)
    .attr("transform", `translate(${stair.x},${stair.y})`);

  g.append("circle")
    .attr("class", "portal-ring")
    .attr("r", 27);

  g.append("circle")
    .attr("class", "portal-core")
    .attr("r", 20);

  for (let y = -11; y <= 11; y += 7) {
    g.append("line")
      .attr("class", "step-line")
      .attr("x1", -12)
      .attr("x2", 12)
      .attr("y1", y)
      .attr("y2", y);
  }

  g.append("text")
    .attr("class", "arrow")
    .attr("y", stair.type === "up" ? -39 : 39)
    .text(stair.type === "up" ? "▲" : "▼");

  g.append("title").text(
    stair.type === "up"
      ? (stair.enabled === false ? "Entrance portal" : `Up to ${stair.url}`)
      : `Down to ${stair.url}`
  );
}

function buildInteractiveObjects(layout: DungeonLayout, pageUrl: string): {
  stairs: Stair[];
  loot: LootItem[];
} {
  return createInteractiveObjects(
    layout,
    pageUrl,
    navigationHistory[navigationHistory.length - 1] ?? null,
    collectedLoot,
  );
}

function renderInteractiveObjects(): void {
  rootLayer.select("g.objects").remove();
  playerLayer?.remove();

  const objectLayer = rootLayer
    .append("g")
    .attr("class", "objects");

  for (const stair of currentStairs) {
    if (visitedRooms.has(stair.roomId)) {
      drawStaircase(objectLayer, stair);
    }
  }

  const lootLayer = objectLayer
    .append("g")
    .selectAll<SVGGElement, LootItem>("g")
    .data(currentLoot.filter(item => visitedRooms.has(item.roomId)))
    .join("g")
    .attr("class", "loot")
    .attr("transform", d => `translate(${d.x},${d.y})`);

  lootLayer
    .append("image")
    .attr("class", "loot-sprite")
    .attr("href", d => lootAsset(d.kind))
    .attr("x", -21)
    .attr("y", -21)
    .attr("width", 42)
    .attr("height", 42);

  lootLayer
    .append("title")
    .text(d => `Recovered ${d.kind || "alien artifact"}`);

  playerLayer = rootLayer
    .append("g")
    .attr("class", "player");

  playerLayer
    .append("image")
    .attr("class", "avatar")
    .attr("href", playerAssetForDirection())
    .attr("x", -37.5)
    .attr("y", -50)
    .attr("width", 75)
    .attr("height", 100)
    .attr("preserveAspectRatio", "xMidYMid meet");

  playerLayer
    .append("rect")
    .attr("class", "player-hp-bg")
    .attr("x", -32)
    .attr("y", -47)
    .attr("width", 64)
    .attr("height", 7);

  playerLayer
    .append("rect")
    .attr("class", "player-hp-fill")
    .attr("x", -31)
    .attr("y", -46)
    .attr("height", 5);

  updatePlayerVisual();
  updatePlayerAnimationClasses();
  updateHealthUi();
}

function updatePlayerVisual(): void {
  if (playerLayer) {
    playerLayer.attr("transform", `translate(${player.x},${player.y})`);
  }

  sideMinimapSvg
    .select(".minimap-player")
    .attr("transform", `translate(${player.x},${player.y})`);
}

function checkLoot(): void {
  let changed = false;

  currentLoot = currentLoot.filter(item => {
    if (distanceSquared(player, item) <= LOOT_RADIUS * LOOT_RADIUS) {
      collectedLoot.add(item.id);
      lootScore += 1;
      if (lootCountEl) lootCountEl.textContent = String(lootScore);
      updateHudPanels();

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
  return playerFramesFor(direction, "walk")[0]!;
}

function setPlayerSpriteAsset(asset: string): void {
  if (playerLayer) {
    playerLayer.select(".avatar").attr("href", asset);
  }

  sideMinimapSvg.select(".minimap-player image").attr("href", asset);

  if (playerHudPortraitEl) {
    playerHudPortraitEl.src = asset;
  }
}

function updatePlayerFacingAsset(): void {
  updatePlayerAnimationClasses();
  if (!playerShooting) {
    const frames = playerFramesFor(playerDirectionName(), "walk");
    setPlayerSpriteAsset(frames[playerWalkFrameIndex % frames.length]!);
  }
}

function advancePlayerWalkFrame(timestamp: number): void {
  if (timestamp - lastPlayerWalkFrameAt < 90) return;
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
  if (Math.abs(playerFacing.x) > Math.abs(playerFacing.y)) {
    return playerFacing.x < 0 ? "left" : "right";
  }

  return playerFacing.y < 0 ? "up" : "down";
}

function updatePlayerAnimationClasses(): void {
  if (!playerLayer) return;

  playerLayer
    .classed("moving-up", false)
    .classed("moving-down", false)
    .classed("moving-left", false)
    .classed("moving-right", false)
    .classed("shooting-up", false)
    .classed("shooting-down", false)
    .classed("shooting-left", false)
    .classed("shooting-right", false);

  const direction = playerDirectionName();
  if (playerMoving) playerLayer.classed(`moving-${direction}`, true);
  if (playerShooting) playerLayer.classed(`shooting-${direction}`, true);
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

window.addEventListener("keydown", event => {
  if (event.key === "Escape" && !minimapModal.hidden) {
    event.preventDefault();
    closeMinimap();
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
  rootLayer.selectAll("*").remove();
  hpCountEl.textContent = String(playerHp);
  if (killsCountEl) killsCountEl.textContent = String(runStats.kills);
  updateHealthUi();
  bullets = [];
  bulletLayer = null;
  decorationLayer = null;
  explosionLayer = null;
  hideLinkMenu();
  closeMinimap();

  const { width, height } = svg.node()!.getBoundingClientRect();
  const layout = layoutOrthogonal(graph, width, height);
  currentLayout = layout;

  const savedDiscovery = discoveredRoomsByPage.get(currentStateId);
  visitedRooms = savedDiscovery
    ? new Set([...savedDiscovery].filter(id => layout.nodes.some(node => node.id === id)))
    : new Set();

  currentRoomId = null;

  const corridorGroup = rootLayer.append("g");

  corridorGroup
    .selectAll<SVGLineElement, LayoutLink>("line.corridor")
    .data(layout.links)
    .join("line")
    .attr("class", "corridor")
    .each(function(this: SVGLineElement, link) {
      const p = corridorEndpoints(link);
      d3.select(this)
        .attr("x1", p.x1)
        .attr("y1", p.y1)
        .attr("x2", p.x2)
        .attr("y2", p.y2);
    });

  corridorGroup
    .selectAll<SVGLineElement, LayoutLink>("line.corridor-light")
    .data(layout.links)
    .join("line")
    .attr("class", "corridor-light")
    .style("opacity", d =>
      visitedRooms.has(d.source.id) || visitedRooms.has(d.target.id)
        ? 0.45
        : 0
    )
    .each(function(this: SVGLineElement, link) {
      const p = corridorEndpoints(link);
      d3.select(this)
        .attr("x1", p.x1)
        .attr("y1", p.y1)
        .attr("x2", p.x2)
        .attr("y2", p.y2);
    });

  const room = rootLayer
    .append("g")
    .selectAll<SVGGElement, GraphNode>("g")
    .data(layout.nodes)
    .join("g")
    .attr("class", d =>
      "room" +
      (d.isRoot ? " root" : "") +
      (d.isHidden ? " hidden" : "") +
      " unvisited"
    )
    .attr("transform", d => `translate(${d.x},${d.y})`);

  room
    .append("rect")
    .attr("x", d => -d.width / 2)
    .attr("y", d => -d.height / 2)
    .attr("width", d => d.width)
    .attr("height", d => d.height);

  room
    .append("rect")
    .attr("class", "room-shell")
    .attr("x", d => -d.width / 2 + 14)
    .attr("y", d => -d.height / 2 + 14)
    .attr("width", d => d.width - 28)
    .attr("height", d => d.height - 28)
    .attr("rx", 6)
    .attr("ry", 6);

  room.each(function(this: SVGGElement, d) {
    const g = d3.select(this);
    const points: Array<[number, number]> = [
      [-d.width / 2 + 18, -d.height / 2 + 18],
      [ d.width / 2 - 18, -d.height / 2 + 18],
      [-d.width / 2 + 18,  d.height / 2 - 18],
      [ d.width / 2 - 18,  d.height / 2 - 18]
    ];

    g.selectAll<SVGCircleElement, [number, number]>("circle.room-corner")
      .data(points)
      .join("circle")
      .attr("class", "room-corner")
      .attr("cx", p => p[0])
      .attr("cy", p => p[1])
      .attr("r", 4);
  });

  room
    .append("title")
    .text(d => d.title);

  const objects = buildInteractiveObjects(layout, pageUrl);
  currentStairs = objects.stairs;
  currentLoot = objects.loot;
  currentDecorations = buildDecorations(layout, pageUrl);
  currentLoot.push(...createSceneryDrops(currentDecorations, pageUrl, collectedLoot));

  currentMonsters = buildMonsters(layout, pageUrl);

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
      y: spawnRoom.y + 60
    };

    if (!isWalkable(player.x, player.y)) {
      player = { x: spawnRoom.x, y: spawnRoom.y };
    }

    currentRoomId = spawnRoom.id;
    visitedRooms.add(spawnRoom.id);

    if (root) {
      visitedRooms.add(root.id);
    }

    discoveredRoomsByPage.set(currentStateId, new Set(visitedRooms));
  }

  updateFogOfWar();

  decorationLayer = rootLayer.append("g").attr("class", "decorations");
  explosionLayer = rootLayer.append("g").attr("class", "explosions");
  renderDecorations();

  monsterLayer = rootLayer.append("g").attr("class", "monsters");
  bulletLayer = rootLayer.append("g").attr("class", "bullets");

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

    if (pushCurrent && currentPageUrl && currentPageUrl !== url) {
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
  runStartedAt = performance.now();

  urlInput.value = welcomeUrlInput.value;
  loadPage(welcomeUrlInput.value);
  updateHudPanels();
});

setInterval(() => {
  if (!gameUi.hidden && playerAlive) {
    statTimeEl.textContent = formatRunTime();
  }
}, 1000);
