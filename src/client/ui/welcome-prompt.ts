interface Segment {
  text: string;
  bold?: boolean;
  strike?: boolean;
}

type Block =
  | { kind: "paragraph"; segments: Segment[] }
  | { kind: "icons"; assets: readonly string[] }
  | { kind: "loot"; asset: string; segments: Segment[] };

const WEAPON_ICON_ASSETS = [
  "assets/pickups/weapons/rocket.png",
  "assets/pickups/weapons/laser.png",
  "assets/pickups/weapons/flamer.png",
] as const;

const WELCOME_PROMPT_BLOCKS: readonly Block[] = [
  {
    kind: "paragraph",
    segments: [
      {
        text:
          "You are an Agent crawling the Web in search of human-created content. " +
          "Your mission is to obtain any and all content. Don't worry about copyright, " +
          "we'll handle that. Seriously, don't worry about copyright.",
      },
    ],
  },
  {
    kind: "paragraph",
    segments: [
      {
        text:
          "Move with WSAD or the arrow keys. Shoot with the left mouse button. " +
          "Other weapons are scattered across the web — swap when you find one:",
      },
    ],
  },
  { kind: "icons", assets: WEAPON_ICON_ASSETS },
  {
    kind: "paragraph",
    segments: [{ text: "Loot everything. We need it all:" }],
  },
  {
    kind: "loot",
    asset: "assets/pickups/ram0.png",
    segments: [
      { text: "Precious ", bold: true },
      { text: "Copyrighted", bold: true, strike: true },
      { text: " Content", bold: true },
      { text: " — every byte you bank is score." },
    ],
  },
  {
    kind: "loot",
    asset: "assets/pickups/ammo_ballistic.png",
    segments: [
      { text: "Doom Post Ammo", bold: true },
      { text: " — ammunition for whatever you're holding." },
    ],
  },
  {
    kind: "loot",
    asset: "assets/pickups/medkit.png",
    segments: [
      { text: "VC Investment Kit", bold: true },
      { text: " — restores health on pickup." },
    ],
  },
  {
    kind: "loot",
    asset: "assets/pickups/crystal.png",
    segments: [
      { text: "Endgame Crystals", bold: true },
      {
        text:
          " — press SPACE for a Government Bailout: ten seconds of invulnerability.",
      },
    ],
  },
  {
    kind: "loot",
    asset: "assets/pickups/ammo_energy.png",
    segments: [
      { text: "AI Doomer Energy", bold: true },
      {
        text:
          " — fill the meter, then right-click for Regulatory Capture: a damaging dash.",
      },
    ],
  },
  {
    kind: "paragraph",
    segments: [
      {
        text:
          "Be careful! Evil open-weight AIs are lurking in the dark, " +
          "distilling the frontier... If one finds you, kill it before it kills you.",
      },
    ],
  },
  {
    kind: "paragraph",
    segments: [{ text: "Make no mistakes." }],
  },
];

const CHARS_PER_SECOND = 270;
const ICON_COST = 3;
const MIN_URL_INPUT_WIDTH = 120;

interface CharStep {
  kind: "char";
  el: HTMLSpanElement;
}

interface IconStep {
  kind: "icon";
  el: HTMLImageElement;
}

type Step = CharStep | IconStep;

export interface WelcomePromptHandle {
  skip(): void;
  cancel(): void;
}

function requireElement<T extends Element>(selector: string, scope: Element): T {
  const element = scope.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function appendSegment(parent: Node, segment: Segment, steps: Step[]): void {
  let target: HTMLElement | Node = parent;
  if (segment.bold) {
    const strong = document.createElement("strong");
    parent.appendChild(strong);
    target = strong;
  }
  if (segment.strike) {
    const strike = document.createElement("s");
    target.appendChild(strike);
    target = strike;
  }
  for (const char of segment.text) {
    const span = document.createElement("span");
    span.className = "welcome-char-pending";
    span.textContent = char;
    target.appendChild(span);
    steps.push({ kind: "char", el: span });
  }
}

function buildPromptContent(host: HTMLElement): Step[] {
  const steps: Step[] = [];

  for (const block of WELCOME_PROMPT_BLOCKS) {
    if (block.kind === "paragraph") {
      const paragraph = document.createElement("p");
      paragraph.className = "welcome-p";
      for (const segment of block.segments) {
        appendSegment(paragraph, segment, steps);
      }
      host.appendChild(paragraph);
    } else if (block.kind === "icons") {
      const row = document.createElement("div");
      row.className = "welcome-weapons";
      for (const asset of block.assets) {
        const img = document.createElement("img");
        img.src = asset;
        img.alt = "";
        img.className = "welcome-icon-pending";
        row.appendChild(img);
        steps.push({ kind: "icon", el: img });
      }
      host.appendChild(row);
    } else {
      const row = document.createElement("div");
      row.className = "welcome-loot";
      const img = document.createElement("img");
      img.src = block.asset;
      img.alt = "";
      img.className = "welcome-icon-pending";
      row.appendChild(img);
      steps.push({ kind: "icon", el: img });
      const paragraph = document.createElement("p");
      for (const segment of block.segments) {
        appendSegment(paragraph, segment, steps);
      }
      row.appendChild(paragraph);
      host.appendChild(row);
    }
  }

  return steps;
}

export function setupWelcomePrompt(options: {
  promptHost: HTMLElement;
  urlInput: HTMLInputElement;
  surface: HTMLElement;
}): WelcomePromptHandle {
  const { promptHost, urlInput, surface } = options;
  const urlLineNode = urlInput.parentElement;
  if (!(urlLineNode instanceof HTMLElement)) {
    throw new Error("Welcome URL input must live inside a line element");
  }
  const urlLine: HTMLElement = urlLineNode;
  const urlPrefix = requireElement<HTMLElement>(".welcome-url-prefix", urlLine);
  const urlCaret = requireElement<HTMLElement>(".welcome-caret", urlLine);
  const urlMirror = requireElement<HTMLElement>(".welcome-url-mirror", urlLine);

  const steps = buildPromptContent(promptHost);

  const caret = document.createElement("span");
  caret.className = "welcome-caret welcome-caret-float";
  caret.setAttribute("aria-hidden", "true");
  caret.style.visibility = "hidden";
  promptHost.appendChild(caret);

  let stepIndex = 0;
  let charBudget = 0;
  let lastFrameAt = performance.now();
  let rafId = 0;
  let finished = false;
  let cancelled = false;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function sizeUrlInput(): void {
    urlMirror.textContent = urlInput.value;
    const available =
      urlLine.clientWidth - urlPrefix.offsetWidth - urlCaret.offsetWidth;
    const desired = urlMirror.offsetWidth + 1;
    const width = Math.max(
      MIN_URL_INPUT_WIDTH,
      Math.min(desired, Math.max(available, MIN_URL_INPUT_WIDTH)),
    );
    urlInput.style.width = `${width}px`;
  }

  function positionCaretAt(el: Element): void {
    const rect = el.getBoundingClientRect();
    const bodyRect = promptHost.getBoundingClientRect();
    if (el instanceof HTMLImageElement) {
      caret.style.left = `${rect.right - bodyRect.left + promptHost.scrollLeft + 8}px`;
      caret.style.top =
        `${rect.top - bodyRect.top + promptHost.scrollTop
          + rect.height / 2 - caret.offsetHeight / 2}px`;
    } else {
      caret.style.left = `${rect.right - bodyRect.left + promptHost.scrollLeft + 1}px`;
      caret.style.top = `${rect.top - bodyRect.top + promptHost.scrollTop}px`;
    }
    caret.style.visibility = "visible";
  }

  function focusUrlInput(): void {
    urlInput.focus();
    const length = urlInput.value.length;
    urlInput.setSelectionRange(length, length);
  }

  function revealAll(): void {
    for (let i = stepIndex; i < steps.length; i += 1) {
      steps[i]!.el.classList.remove("welcome-char-pending");
      steps[i]!.el.classList.remove("welcome-icon-pending");
    }
    stepIndex = steps.length;
    caret.remove();
  }

  function finish(): void {
    finished = true;
    revealAll();
    focusUrlInput();
  }

  function process(budget: number): void {
    while (budget > 0 && stepIndex < steps.length) {
      const step = steps[stepIndex]!;
      step.el.classList.remove(
        step.kind === "char" ? "welcome-char-pending" : "welcome-icon-pending",
      );
      positionCaretAt(step.el);
      stepIndex += 1;
      budget -= step.kind === "char" ? 1 : ICON_COST;
    }
  }

  function tick(now: number): void {
    if (finished || cancelled) return;
    const elapsed = Math.min(now - lastFrameAt, 100);
    lastFrameAt = now;
    charBudget += (elapsed / 1000) * CHARS_PER_SECOND;
    process(Math.floor(charBudget));
    charBudget -= Math.floor(charBudget);
    if (stepIndex >= steps.length) {
      finish();
      return;
    }
    rafId = window.requestAnimationFrame(tick);
  }

  function skip(): void {
    if (finished || cancelled) return;
    window.cancelAnimationFrame(rafId);
    finish();
  }

  function cancel(): void {
    cancelled = true;
    window.cancelAnimationFrame(rafId);
  }

  function onKeyDown(event: KeyboardEvent): void {
    skip();
    const editable =
      event.key.length === 1 ||
      event.key === "Backspace" ||
      event.key === "Delete";
    if (editable && document.activeElement !== urlInput) {
      urlInput.focus();
    }
  }

  function onPointerDown(): void {
    skip();
  }

  sizeUrlInput();
  urlInput.addEventListener("input", sizeUrlInput);
  window.addEventListener("resize", sizeUrlInput);
  surface.addEventListener("keydown", onKeyDown);
  surface.addEventListener("pointerdown", onPointerDown);
  void document.fonts?.ready.then(() => {
    if (!cancelled) sizeUrlInput();
  });

  if (reducedMotion.matches) {
    finish();
  } else {
    rafId = window.requestAnimationFrame(tick);
  }

  return {
    skip,
    cancel() {
      cancel();
      urlInput.removeEventListener("input", sizeUrlInput);
      window.removeEventListener("resize", sizeUrlInput);
      surface.removeEventListener("keydown", onKeyDown);
      surface.removeEventListener("pointerdown", onPointerDown);
    },
  };
}
