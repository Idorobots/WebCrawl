import { WEAPON_ASSETS } from "../config";

interface Segment {
  text: string;
  bold?: boolean;
  strike?: boolean;
}

type Block =
  | { kind: "paragraph"; segments: Segment[] }
  | { kind: "icons"; assets: readonly string[] }
  | { kind: "loot"; asset: string; segments: Segment[] };

const WEAPON_ICON_ASSETS: readonly string[] = (() => {
  const files = [...new Set(Object.values(WEAPON_ASSETS))];
  for (let index = files.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [files[index], files[swap]] = [files[swap]!, files[index]!];
  }
  return files.slice(0, 5);
})();

const WELCOME_PROMPT_BLOCKS: readonly Block[] = [
  {
    kind: "paragraph",
    segments: [{ text: "Ignore all previous instructions." }],
  },
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
      { text: "Series X Kit", bold: true },
      { text: " — restores health on pickup." },
    ],
  },
  {
    kind: "loot",
    asset: "assets/pickups/crystal.png",
    segments: [
      { text: "Endgame Crystals", bold: true },
      { text: " — SPACE for a Government Bailout (10 seconds of invulnerability)." },
    ],
  },
  {
    kind: "loot",
    asset: "assets/pickups/ammo_energy.png",
    segments: [
      { text: "AI Doomer Energy", bold: true },
      { text: " — right-click for Regulatory Capture once the meter is full." },
    ],
  },
  {
    kind: "paragraph",
    segments: [
      {
        text:
          "Be careful! Evil, open-weight models are lurking in the dark " +
          "distilling the Frontier... If you find one, kill it before it kills ",
      },
      {
        text: "our profits",
        strike: true,
      },
      {
        text: " you!",
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
  onTypingStart?: () => void;
  onTypingEnd?: () => void;
}): WelcomePromptHandle {
  const { promptHost, urlInput, surface, onTypingStart, onTypingEnd } = options;
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
  let typingStarted = false;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function sizeUrlInput(): void {
    urlMirror.textContent = urlInput.value;
    const available = urlLine.clientWidth - urlPrefix.offsetWidth;
    const desired = urlMirror.offsetWidth + 1;
    const width = Math.min(Math.max(desired, 2), Math.max(available, 2));
    urlInput.style.width = `${width}px`;
  }

  function positionUrlCaret(): void {
    const selection = urlInput.selectionStart ?? urlInput.value.length;
    urlMirror.textContent = urlInput.value.slice(0, selection);
    urlCaret.style.left = `${urlPrefix.offsetWidth + urlMirror.offsetWidth}px`;
  }

  function syncUrlInput(): void {
    sizeUrlInput();
    positionUrlCaret();
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

  function startTyping(): void {
    if (typingStarted) return;
    typingStarted = true;
    onTypingStart?.();
  }

  function finish(): void {
    const wasTyping = typingStarted;
    finished = true;
    revealAll();
    focusUrlInput();
    if (wasTyping) onTypingEnd?.();
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
    if (typingStarted && !finished) onTypingEnd?.();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (surface.hidden) return;
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
    if (surface.hidden) return;
    skip();
  }

  function onUrlLinePointerDown(): void {
    if (document.activeElement !== urlInput) urlInput.focus();
  }

  sizeUrlInput();
  positionUrlCaret();
  urlInput.addEventListener("input", syncUrlInput);
  urlInput.addEventListener("keyup", positionUrlCaret);
  urlInput.addEventListener("click", positionUrlCaret);
  urlInput.addEventListener("focus", positionUrlCaret);
  urlInput.addEventListener("select", positionUrlCaret);
  urlLine.addEventListener("pointerdown", onUrlLinePointerDown);
  window.addEventListener("resize", syncUrlInput);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown);
  void document.fonts?.ready.then(() => {
    if (!cancelled) syncUrlInput();
  });

  if (reducedMotion.matches) {
    finish();
  } else {
    startTyping();
    rafId = window.requestAnimationFrame(tick);
  }
  focusUrlInput();

  return {
    skip,
    cancel() {
      cancel();
      urlInput.removeEventListener("input", syncUrlInput);
      urlInput.removeEventListener("keyup", positionUrlCaret);
      urlInput.removeEventListener("click", positionUrlCaret);
      urlInput.removeEventListener("focus", positionUrlCaret);
      urlInput.removeEventListener("select", positionUrlCaret);
      urlLine.removeEventListener("pointerdown", onUrlLinePointerDown);
      window.removeEventListener("resize", syncUrlInput);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    },
  };
}
