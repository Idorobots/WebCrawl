import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export interface WelcomeSceneOptions {
  canvas: HTMLCanvasElement;
  formElement?: HTMLElement;
  lowQuality?: boolean;
  reduceMotion?: boolean;
}

export interface WelcomeSceneHandle {
  playSignInTransition(): Promise<void>;
  dispose(): void;
}

const ASSET_BASE = "assets/ui";
const TRANSITION_MS = 720;

// The room is a box. The camera sits inside it, near the open front, and looks
// at the back wall. The back wall is the screen: its content is the sign-in
// form. The person (guy.png) is outside the box, behind the screen.
const ROOM_WIDTH = 30;
const ROOM_HEIGHT = 18;
const ROOM_DEPTH = 34;
const HALF_WIDTH = ROOM_WIDTH / 2;
const FLOOR_Y = -ROOM_HEIGHT / 2;
const CEIL_Y = ROOM_HEIGHT / 2;
const BACK_Z = -ROOM_DEPTH / 2;
const ROOM_CENTER_Z = 0;
const SCREEN_Y = 0;
const CAMERA_X = 5;
const CAMERA_Y = 0.8;
const CAMERA_Z = 5;

interface Hologram {
  object: THREE.Object3D;
  material: THREE.Material;
  base: THREE.Vector3;
  baseRotZ: number;
  phase: number;
  bob: number;
  sway: number;
}

const FORM_CONTENT_HEIGHT = 6;

// Paint the live sign-in form into the screen's canvas so the form becomes
// part of the screen texture itself. The real DOM form stays in the document
// (invisible) as the interactive layer, and its layout geometry is measured so
// the painted fields line up exactly with the clickable inputs.
function paintLoginForm(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  panel: HTMLElement,
  time: number,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const savedTransform = panel.style.transform;
  panel.style.transform = "none";
  const panelRect = panel.getBoundingClientRect();
  const panelW = panelRect.width || panel.offsetWidth || 360;
  const panelH = panelRect.height || panel.offsetHeight || 330;

  const contentW = FORM_CONTENT_HEIGHT * (panelW / panelH);
  const rectW = canvasWidth * (contentW / ROOM_WIDTH);
  const rectH = canvasHeight * (FORM_CONTENT_HEIGHT / ROOM_HEIGHT);
  const rectX = (canvasWidth - rectW) / 2;
  const rectY = (canvasHeight - rectH) / 2;

  const mapX = (value: number): number => rectX + ((value - panelRect.left) / panelW) * rectW;
  const mapY = (value: number): number => rectY + ((value - panelRect.top) / panelH) * rectH;
  const mapW = (value: number): number => (value / panelW) * rectW;
  const mapH = (value: number): number => (value / panelH) * rectH;
  const fontFor = (element: Element, fallback: number): string => {
    const style = getComputedStyle(element);
    return `${mapH(parseFloat(style.fontSize) || fallback)}px ${style.fontFamily}`;
  };

  // Panel wash + slight border.
  ctx.fillStyle = "rgba(18, 54, 96, 0.14)";
  ctx.fillRect(rectX, rectY, rectW, rectH);
  ctx.strokeStyle = "rgba(120, 215, 255, 0.34)";
  ctx.lineWidth = Math.max(1, rectH * 0.004);
  ctx.strokeRect(rectX, rectY, rectW, rectH);

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const header = panel.querySelector(".welcome-panel-header");
  if (header) {
    const rect = header.getBoundingClientRect();
    ctx.font = fontFor(header, 12);
    ctx.fillStyle = "rgba(150, 220, 255, 0.72)";
    ctx.fillText(
      (header.textContent ?? "").replace(/\s+/g, " ").trim(),
      mapX(rect.left),
      mapY(rect.top + rect.height * 0.6),
    );
    ctx.strokeStyle = "rgba(90, 200, 255, 0.35)";
    ctx.lineWidth = Math.max(1, rectH * 0.003);
    ctx.beginPath();
    ctx.moveTo(rectX, mapY(rect.bottom));
    ctx.lineTo(rectX + rectW, mapY(rect.bottom));
    ctx.stroke();
  }

  const welcome = panel.querySelector(".login-welcome");
  if (welcome) {
    const rect = welcome.getBoundingClientRect();
    ctx.font = fontFor(welcome, 15);
    ctx.fillStyle = "rgba(205, 240, 255, 0.95)";
    ctx.fillText(welcome.textContent ?? "", mapX(rect.left), mapY(rect.top + rect.height / 2));
  }

  panel.querySelectorAll(".login-field").forEach((field) => {
    const input = field.querySelector("input");
    const label = field.querySelector(".login-label");
    if (label) {
      const rect = label.getBoundingClientRect();
      const focused = input !== null && document.activeElement === input;
      ctx.font = fontFor(label, 16);
      ctx.fillStyle = focused ? "rgba(215, 248, 255, 0.98)" : "rgba(150, 222, 255, 0.8)";
      ctx.fillText(label.textContent ?? "", mapX(rect.left), mapY(rect.top + rect.height / 2));
    }
    if (input) {
      const rect = input.getBoundingClientRect();
      const focused = document.activeElement === input;
      ctx.fillStyle = "rgba(6, 22, 40, 0.5)";
      ctx.fillRect(mapX(rect.left), mapY(rect.top), mapW(rect.width), mapH(rect.height));
      ctx.strokeStyle = focused ? "rgba(175, 242, 255, 0.95)" : "rgba(90, 200, 255, 0.45)";
      ctx.lineWidth = Math.max(1, rectH * (focused ? 0.006 : 0.004));
      ctx.strokeRect(mapX(rect.left), mapY(rect.top), mapW(rect.width), mapH(rect.height));
      const text = input.type === "password" ? "•".repeat(input.value.length) : input.value;
      ctx.font = fontFor(input, 16);
      ctx.fillStyle = "rgba(214, 242, 255, 0.96)";
      const textX = mapX(rect.left + rect.height * 0.3);
      const textY = mapY(rect.top + rect.height / 2);
      ctx.fillText(text, textX, textY);
      if (focused && Math.floor(time * 2) % 2 === 0) {
        // The texture is mirrored, so the logical end of the input sits on the
        // visual left; the caret traces it and moves further left as you type.
        const caretX = textX + ctx.measureText(text).width + rectH * 0.01;
        ctx.fillStyle = "rgba(205, 245, 255, 0.95)";
        ctx.fillRect(caretX, mapY(rect.top) + mapH(rect.height) * 0.18, Math.max(1, rectH * 0.02), mapH(rect.height) * 0.64);
      }
    }
  });

  const button = panel.querySelector("#loginSignInButton");
  if (button) {
    const rect = button.getBoundingClientRect();
    const focused = document.activeElement === button;
    const glow = 0.5 + 0.5 * Math.sin(time * 1.35);
    const bx = mapX(rect.left);
    const by = mapY(rect.top);
    const bw = mapW(rect.width);
    const bh = mapH(rect.height);
    ctx.save();
    ctx.shadowColor = `rgba(90, 200, 255, ${0.22 + glow * 0.4})`;
    ctx.shadowBlur = rectH * (0.03 + glow * 0.06);
    ctx.fillStyle = "rgba(28, 100, 180, 0.26)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(${150 + glow * 60}, ${225 + glow * 25}, 255, ${0.55 + glow * 0.4})`;
    ctx.lineWidth = Math.max(1, rectH * (focused ? 0.007 : 0.005));
    ctx.strokeRect(bx, by, bw, bh);
    ctx.font = fontFor(button, 15);
    ctx.fillStyle = "rgba(220, 245, 255, 0.98)";
    ctx.textAlign = "center";
    ctx.fillText(button.textContent ?? "", bx + bw / 2, by + bh / 2);
    ctx.restore();
  }

  panel.style.transform = savedTransform;
}

function loadTexture(
  loader: THREE.TextureLoader,
  file: string,
  repeatX = 1,
  repeatY = 1,
): THREE.Texture {
  const texture = loader.load(`${ASSET_BASE}/${file}`);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return texture;
}

function disposeScene(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    for (const entry of materials) {
      const map = (entry as THREE.MeshBasicMaterial).map;
      map?.dispose();
      entry.dispose();
    }
  });
}

// Build a CSS matrix3d that maps a W x H element (top-left origin) onto the
// quadrilateral p0..p3, where p0..p3 are the images of the unit square's
// (0,0), (1,0), (1,1), (0,1) corners. This lets the DOM form be drawn flat on
// the projected screen wall, following the camera exactly.
function rectToQuadTransform(
  width: number,
  height: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
): string | null {
  const [x0, y0] = p0;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-8) return null;

  const g = (dx3 * dy2 - dy3 * dx2) / denom;
  const h = (dx1 * dy3 - dy1 * dx3) / denom;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;

  const A = a / width;
  const B = b / height;
  const D = d / width;
  const E = e / height;
  const G = g / width;
  const H = h / height;

  return `matrix3d(${A},${D},0,${G},${B},${E},0,${H},0,0,1,0,${c},${f},0,1)`;
}

const SCENE_BACKGROUND = 0x081422;

export function createWelcomeScene(options: WelcomeSceneOptions): WelcomeSceneHandle | null {
  const { canvas, formElement, lowQuality = false, reduceMotion = false } = options;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !lowQuality,
      // Transparent so the CSS welcome background shows through: the scene and
      // the welcome screen then share the exact same background colour.
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }

  const width = Math.max(1, canvas.clientWidth || window.innerWidth);
  const height = Math.max(1, canvas.clientHeight || window.innerHeight);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowQuality ? 1 : 2));
  renderer.setSize(width, height, false);
  renderer.setClearAlpha(0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.FogExp2(SCENE_BACKGROUND, 0.014);

  const camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 260);
  camera.position.set(CAMERA_X, CAMERA_Y, CAMERA_Z);
  camera.lookAt(0, SCREEN_Y, BACK_Z);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowQuality ? 1 : 2));
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    lowQuality ? 0.45 : 0.75,
    0.6,
    0.2,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // Fade the scene in only once every texture has finished loading.
  const loadingManager = new THREE.LoadingManager();
  loadingManager.onLoad = () => { canvas.style.opacity = "1"; };
  loadingManager.onError = () => { canvas.style.opacity = "1"; };
  const loader = new THREE.TextureLoader(loadingManager);
  const holograms: Hologram[] = [];

  const registerHologram = (
    object: THREE.Object3D,
    material: THREE.Material,
    phase: number,
    bob = 0.3,
    sway = 0.15,
  ): void => {
    holograms.push({
      object,
      material,
      base: object.position.clone(),
      baseRotZ: object.rotation.z,
      phase,
      bob,
      sway,
    });
  };

  // Every surface in the box is the same translucent holographic material so
  // the screen wall reads exactly like the surrounding walls.
  const holoMaterial = (
    texture: THREE.Texture,
    opacity: number,
  ): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      map: texture,
      color: 0x7fc4ff,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

  const wall1 = loadTexture(loader, "wall1.png", 2, 1.2);
  const wall2 = loadTexture(loader, "wall2.png", 2, 1.2);
  const wall3 = loadTexture(loader, "wall3.png", 2, 1.2);
  const screenTexture = loadTexture(loader, "screen.png", 1, 1);
  const guyTexture = loadTexture(loader, "guy.png", 1, 1);

  const sideWallGeometry = new THREE.PlaneGeometry(ROOM_DEPTH, ROOM_HEIGHT);
  const leftWall = new THREE.Mesh(sideWallGeometry, holoMaterial(wall1, 0.38));
  leftWall.position.set(-HALF_WIDTH, 0, ROOM_CENTER_Z);
  leftWall.rotation.y = Math.PI / 2;
  scene.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeometry, holoMaterial(wall3, 0.38));
  rightWall.position.set(HALF_WIDTH, 0, ROOM_CENTER_Z);
  rightWall.rotation.y = -Math.PI / 2;
  scene.add(rightWall);

  const endWallGeometry = new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_HEIGHT);
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
    holoMaterial(wall2, 0.22),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, CEIL_Y, ROOM_CENTER_Z);
  scene.add(ceiling);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
    holoMaterial(wall2, 0.32),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, ROOM_CENTER_Z);
  scene.add(floor);

  // The back wall is the screen. It is exactly the same material, tint and
  // opacity as the other walls; the bezel texture merely frames its edge.
  const screen = new THREE.Mesh(endWallGeometry, holoMaterial(screenTexture, 0.38));
  screen.position.set(0, SCREEN_Y, BACK_Z);
  scene.add(screen);

  // The person is outside the box, behind the screen. The screen's centre is
  // transparent, so they are visible through it.
  const guy = new THREE.Mesh(
    new THREE.PlaneGeometry(25.3, 14.19),
    new THREE.MeshBasicMaterial({
      map: guyTexture,
      color: 0xbcd8ff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  guy.position.set(0, SCREEN_Y, BACK_Z - 2.6);
  scene.add(guy);

  // The sign-in form is painted into this canvas and mapped onto a plane that
  // sits on the screen wall, so it is literally textured onto the surface (it
  // participates in the same projection, translucency and bloom as the rest of
  // the scene). The texture is mirrored so the form matches the mirrored DOM
  // interaction layer.
  const formCanvas = document.createElement("canvas");
  formCanvas.width = 1024;
  formCanvas.height = Math.round((1024 * ROOM_HEIGHT) / ROOM_WIDTH);
  const formCtx = formCanvas.getContext("2d");
  const formTexture = new THREE.CanvasTexture(formCanvas);
  formTexture.colorSpace = THREE.SRGBColorSpace;
  formTexture.center.set(0.5, 0.5);
  formTexture.repeat.x = -1;
  formTexture.anisotropy = 4;
  formTexture.needsUpdate = true;

  const formPlane = new THREE.Mesh(
    endWallGeometry,
    new THREE.MeshBasicMaterial({
      map: formTexture,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  formPlane.position.set(0, SCREEN_Y, BACK_Z + 0.05);
  scene.add(formPlane);

  const panelTextures = [
    loadTexture(loader, "panel1.png"),
    loadTexture(loader, "panel4.png"),
    loadTexture(loader, "panel3.png"),
    loadTexture(loader, "panel2.png"),
  ];

  // Decorative HUD panels drift along the side walls, each parked at a
  // different distance from its wall so they overlap in depth.
  const panelLayout: Array<{
    file: number;
    x: number;
    y: number;
    z: number;
    rotY: number;
    width: number;
    height: number;
  }> = [
    { file: 0, x: -13.6, y: 3.6, z: -10, rotY: Math.PI / 2, width: 13.5, height: 10.1 },
    { file: 1, x: -11.4, y: -3.2, z: -12, rotY: Math.PI / 2, width: 11, height: 8.25 },
    { file: 3, x: -12.8, y: 4.6, z: -13.5, rotY: Math.PI / 2, width: 7.2, height: 9.6 },
    { file: 2, x: -13.4, y: -3.8, z: -15, rotY: Math.PI / 2, width: 9, height: 6.75 },
    { file: 1, x: 13.6, y: 3.6, z: -10.5, rotY: -Math.PI / 2, width: 13.5, height: 10.1 },
    { file: 0, x: 11.6, y: -3.2, z: -12.5, rotY: -Math.PI / 2, width: 11, height: 8.25 },
    { file: 3, x: 12.8, y: 4.4, z: -14, rotY: -Math.PI / 2, width: 7.2, height: 9.6 },
    { file: 2, x: 13.4, y: -3.8, z: -15.5, rotY: -Math.PI / 2, width: 9, height: 6.75 },
  ];

  panelLayout.forEach((spec, index) => {
    const material = new THREE.MeshBasicMaterial({
      map: panelTextures[spec.file],
      color: 0xa8e4ff,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height), material);
    mesh.position.set(spec.x, spec.y, spec.z);
    mesh.rotation.set(0, spec.rotY, (index % 2 === 0 ? -1 : 1) * 0.04);
    scene.add(mesh);
    registerHologram(mesh, material, index * 1.37, 0.32 + (index % 3) * 0.08, 0.12 + (index % 2) * 0.08);
  });

  const railMaterial = new THREE.MeshBasicMaterial({
    color: 0x49b6ff,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  for (const x of [-HALF_WIDTH + 0.7, HALF_WIDTH - 0.7]) {
    const rail = new THREE.Mesh(new THREE.PlaneGeometry(0.16, ROOM_DEPTH), railMaterial);
    rail.rotation.x = -Math.PI / 2;
    rail.position.set(x, FLOOR_Y + 0.05, ROOM_CENTER_Z);
    scene.add(rail);
  }

  const dustCount = lowQuality ? 140 : 320;
  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    dustPositions[i * 3] = (Math.random() - 0.5) * ROOM_WIDTH;
    dustPositions[i * 3 + 1] = FLOOR_Y + Math.random() * ROOM_HEIGHT;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * ROOM_DEPTH;
  }
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: 0x8fd8ff,
      size: 0.06,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      sizeAttenuation: true,
    }),
  );
  scene.add(dust);

  let disposed = false;
  let transitioning = false;
  let frozen = false;
  let transitionStartMs = 0;
  let transitionResolve: (() => void) | null = null;
  const startTime = performance.now();
  const baseCameraX = camera.position.x;
  const baseCameraY = camera.position.y;
  const baseCameraZ = camera.position.z;
  const baseFov = camera.fov;
  const baseFogDensity = scene.fog ? (scene.fog as THREE.FogExp2).density : 0.014;
  const baseBloomStrength = bloom.strength;

  let pointerTargetX = 0;
  let pointerTargetY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let formPrepared = false;

  const handlePointerMove = (event: PointerEvent): void => {
    pointerTargetX = event.clientX / window.innerWidth - 0.5;
    pointerTargetY = event.clientY / window.innerHeight - 0.5;
  };
  window.addEventListener("pointermove", handlePointerMove);

  // Project a rectangle of the screen wall and map the (invisible) DOM form
  // onto it, so the clickable fields line up exactly with the painted texture.
  const formCorner = new THREE.Vector3();
  const applyFormTransform = (): void => {
    if (!formElement) return;
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    const boxW = formElement.offsetWidth;
    const boxH = formElement.offsetHeight;
    if (boxW < 2 || boxH < 2) return;

    if (!formPrepared) {
      formElement.style.position = "fixed";
      formElement.style.left = "0px";
      formElement.style.top = "0px";
      formElement.style.margin = "0px";
      formElement.style.transformOrigin = "0px 0px";
      // The visible form now comes from the texture; keep the DOM layer for
      // interaction only.
      formElement.style.opacity = "0";
      formPrepared = true;
    }

    const ch = FORM_CONTENT_HEIGHT;
    const cw = ch * (boxW / boxH);
    const project = (x: number, y: number): [number, number] => {
      formCorner.set(x, SCREEN_Y + y, BACK_Z).project(camera);
      return [
        (formCorner.x * 0.5 + 0.5) * cssW,
        (0.5 - formCorner.y * 0.5) * cssH,
      ];
    };
    const topLeft = project(-cw / 2, ch / 2);
    const topRight = project(cw / 2, ch / 2);
    const bottomLeft = project(-cw / 2, -ch / 2);
    const bottomRight = project(cw / 2, -ch / 2);
    // Mirrored: the element's left edge lands on the wall's right edge.
    const matrix = rectToQuadTransform(boxW, boxH, topRight, topLeft, bottomLeft, bottomRight);
    if (matrix) formElement.style.transform = matrix;
  };

  const updateIdle = (time: number): void => {
    if (reduceMotion) return;
    pointerX += (pointerTargetX - pointerX) * 0.08;
    pointerY += (pointerTargetY - pointerY) * 0.08;
    camera.position.x = baseCameraX + Math.sin(time * 0.24) * 0.18 + pointerX * 2.4;
    camera.position.y = baseCameraY + Math.sin(time * 0.31) * 0.1 - pointerY * 1.6;
    camera.position.z = baseCameraZ + Math.sin(time * 0.18) * 0.35;
    camera.lookAt(0, SCREEN_Y, BACK_Z);

    for (const holo of holograms) {
      holo.object.position.y = holo.base.y + Math.sin(time * 0.7 + holo.phase) * holo.bob;
      holo.object.position.x = holo.base.x + Math.sin(time * 0.4 + holo.phase) * holo.sway;
      holo.object.position.z = holo.base.z + Math.cos(time * 0.33 + holo.phase) * (holo.sway * 0.7);
      holo.object.rotation.z = holo.baseRotZ + Math.sin(time * 0.55 + holo.phase) * 0.02;
      const material = holo.material as THREE.MeshBasicMaterial;
      if (typeof material.opacity === "number") {
        material.opacity = 0.7 + Math.sin(time * 1.3 + holo.phase) * 0.12;
      }
    }

    dust.rotation.y = time * 0.02;
    bloom.strength = baseBloomStrength + Math.sin(time * 0.9) * 0.06;
  };

  const updateTransition = (now: number): void => {
    const raw = Math.min(1, (now - transitionStartMs) / TRANSITION_MS);
    const eased = raw * raw * raw;
    camera.position.z = baseCameraZ + eased * 76;
    camera.position.x = baseCameraX * (1 - eased);
    camera.position.y = baseCameraY * (1 - eased);
    camera.fov = baseFov + eased * 32;
    camera.updateProjectionMatrix();
    camera.lookAt(0, SCREEN_Y, BACK_Z);
    if (scene.fog) (scene.fog as THREE.FogExp2).density = baseFogDensity + eased * 0.32;
    bloom.strength = baseBloomStrength + Math.sin(raw * Math.PI) * baseBloomStrength * 1.6;

    // Dissolve the canvas into the CSS welcome background at the end of the
    // flight, so the furthermost point and the welcome screen share one colour.
    const fade = raw < 0.35 ? 1 : 1 - (raw - 0.35) / 0.65;
    canvas.style.opacity = String(Math.max(0, Math.min(1, fade)));

    if (raw >= 1) {
      transitioning = false;
      frozen = true;
      const resolve = transitionResolve;
      transitionResolve = null;
      resolve?.();
    }
  };

  let rafId = 0;
  let lastFormPaint = -1000;
  let formDirty = true;
  const markFormDirty = (): void => { formDirty = true; };
  if (formElement) {
    formElement.querySelectorAll("input").forEach((el) => {
      el.addEventListener("input", markFormDirty);
      el.addEventListener("focus", markFormDirty);
      el.addEventListener("blur", markFormDirty);
    });
    const button = formElement.querySelector("#loginSignInButton");
    button?.addEventListener("pointerenter", markFormDirty);
    button?.addEventListener("pointerleave", markFormDirty);
    button?.addEventListener("pointerdown", markFormDirty);
    button?.addEventListener("pointerup", markFormDirty);
  }

  const frame = (): void => {
    if (disposed) return;
    rafId = window.requestAnimationFrame(frame);
    const now = performance.now();
    if (transitioning) updateTransition(now);
    else if (!frozen) updateIdle((now - startTime) / 1000);
    applyFormTransform();
    if (formElement && formCtx && (formDirty || now - lastFormPaint > 60)) {
      paintLoginForm(formCtx, formCanvas.width, formCanvas.height, formElement, (now - startTime) / 1000);
      formTexture.needsUpdate = true;
      formDirty = false;
      lastFormPaint = now;
    }
    composer.render();
  };
  rafId = window.requestAnimationFrame(frame);

  const handleResize = (): void => {
    if (disposed) return;
    const nextWidth = Math.max(1, canvas.clientWidth || window.innerWidth);
    const nextHeight = Math.max(1, canvas.clientHeight || window.innerHeight);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight, false);
    composer.setSize(nextWidth, nextHeight);
    bloom.setSize(nextWidth, nextHeight);
  };
  window.addEventListener("resize", handleResize);

  const playSignInTransition = (): Promise<void> => {
    if (reduceMotion || disposed) return Promise.resolve();
    if (transitioning) return Promise.resolve();
    transitioning = true;
    transitionStartMs = performance.now();
    canvas.style.transition = "none";
    return new Promise<void>((resolve) => {
      transitionResolve = resolve;
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    window.cancelAnimationFrame(rafId);
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("pointermove", handlePointerMove);
    transitionResolve?.();
    transitionResolve = null;
    if (formElement) {
      formElement.style.removeProperty("position");
      formElement.style.removeProperty("left");
      formElement.style.removeProperty("top");
      formElement.style.removeProperty("margin");
      formElement.style.removeProperty("transform-origin");
      formElement.style.removeProperty("transform");
      formElement.style.removeProperty("opacity");
    }
    disposeScene(scene);
    composer.dispose();
    renderer.dispose();
  };

  return { playSignInTransition, dispose };
}
