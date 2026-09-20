export interface MusicHandle {
  stop(fadeOutMs?: number): void;
}

export interface MusicOptions {
  volume?: number;
  fadeInMs?: number;
  loop?: boolean;
}

export interface SfxOptions {
  volume?: number;
}

const DEFAULT_FADE_MS = 750;
const FADE_STEP_MS = 50;
const DEFAULT_MUSIC_VOLUME = 0.5;
const WELCOME_AMBIENT_VOLUME = 0.35;
const INTERFACE_TEXT_VOLUME = 0.45;
const BUTTON_CLICK_VOLUME = 0.5;
const ELEVATOR_VOLUME = 0.5;

export const WELCOME_AMBIENT_SRC = "sounds/ui/welcome/ambient.mp3";
export const WELCOME_INTERFACE_TEXT_SRC = "sounds/ui/welcome/interface_text.mp3";
export const WELCOME_BUTTON_CLICK_SRC = "sounds/ui/welcome/button_click.mp3";
export const LOADING_ELEVATOR_SRC = "sounds/ui/loading/elevator.mp3";

interface PlayingAudio {
  el: HTMLAudioElement;
  targetVolume: number;
  fadeInMs: number;
  fadeTimer: number | null;
  pending: boolean;
  stopped: boolean;
}

const activeMusic = new Set<PlayingAudio>();
const pendingUnlock = new Set<PlayingAudio>();
let unlockListenersArmed = false;
let elevatorPrefetched = false;

function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

function clearFadeTimer(audio: PlayingAudio): void {
  if (audio.fadeTimer === null) return;
  window.clearInterval(audio.fadeTimer);
  audio.fadeTimer = null;
}

function haltElement(audio: PlayingAudio): void {
  clearFadeTimer(audio);
  audio.el.pause();
  audio.el.currentTime = 0;
}

function fadeTo(audio: PlayingAudio, target: number, durationMs: number, onDone?: () => void): void {
  clearFadeTimer(audio);
  const clampedTarget = clampVolume(target);
  const el = audio.el;
  if (durationMs <= 0) {
    el.volume = clampedTarget;
    onDone?.();
    return;
  }
  const startVolume = el.volume;
  const steps = Math.max(1, Math.round(durationMs / FADE_STEP_MS));
  const increment = (clampedTarget - startVolume) / steps;
  let step = 0;
  audio.fadeTimer = window.setInterval(() => {
    step += 1;
    el.volume = clampVolume(startVolume + increment * step);
    if (step >= steps) {
      clearFadeTimer(audio);
      el.volume = clampedTarget;
      onDone?.();
    }
  }, FADE_STEP_MS);
}

function armUnlockListeners(): void {
  if (unlockListenersArmed) return;
  unlockListenersArmed = true;
  const unlock = (): void => {
    unlockListenersArmed = false;
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
    const waiting = [...pendingUnlock];
    pendingUnlock.clear();
    for (const audio of waiting) {
      audio.pending = false;
      if (!audio.stopped) startPlayback(audio);
    }
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
}

function startPlayback(audio: PlayingAudio): void {
  void audio.el.play().then(() => {
    if (audio.stopped) return;
    fadeTo(audio, audio.targetVolume, audio.fadeInMs);
  }).catch((error: unknown) => {
    // Autoplay is blocked until the first user gesture; queue for retry.
    if (audio.stopped) return;
    if (error instanceof DOMException && error.name !== "NotAllowedError") return;
    audio.pending = true;
    pendingUnlock.add(audio);
    armUnlockListeners();
  });
}

function stopAudio(audio: PlayingAudio, fadeOutMs: number): void {
  if (audio.stopped) return;
  audio.stopped = true;
  activeMusic.delete(audio);
  if (audio.pending) {
    audio.pending = false;
    pendingUnlock.delete(audio);
    haltElement(audio);
    return;
  }
  fadeTo(audio, 0, Math.max(0, fadeOutMs), () => haltElement(audio));
}

export function playMusic(src: string, options: MusicOptions = {}): MusicHandle {
  const el = new Audio(src);
  el.preload = "auto";
  el.loop = options.loop ?? true;
  const audio: PlayingAudio = {
    el,
    targetVolume: clampVolume(options.volume ?? DEFAULT_MUSIC_VOLUME),
    fadeInMs: Math.max(0, options.fadeInMs ?? DEFAULT_FADE_MS),
    fadeTimer: null,
    pending: false,
    stopped: false,
  };
  el.volume = 0;
  activeMusic.add(audio);
  startPlayback(audio);
  return {
    stop(fadeOutMs = DEFAULT_FADE_MS): void {
      stopAudio(audio, fadeOutMs);
    },
  };
}

export function playSfxOnce(src: string, options: SfxOptions = {}): void {
  const el = new Audio(src);
  el.preload = "auto";
  el.loop = false;
  el.volume = clampVolume(options.volume ?? 1);
  void el.play().catch(() => undefined);
}

export function stopAllMusic(fadeOutMs = DEFAULT_FADE_MS): void {
  welcomeAmbientHandle = null;
  interfaceTextHandle = null;
  elevatorHandle = null;
  for (const audio of [...activeMusic]) stopAudio(audio, fadeOutMs);
}

export function prefetchLoadingMusic(): void {
  if (elevatorPrefetched) return;
  elevatorPrefetched = true;
  const el = new Audio(LOADING_ELEVATOR_SRC);
  el.preload = "auto";
  el.load();
}

let welcomeAmbientHandle: MusicHandle | null = null;
let interfaceTextHandle: MusicHandle | null = null;
let elevatorHandle: MusicHandle | null = null;

export function playWelcomeAmbient(): void {
  welcomeAmbientHandle?.stop(0);
  welcomeAmbientHandle = playMusic(WELCOME_AMBIENT_SRC, { volume: WELCOME_AMBIENT_VOLUME });
}

export function startInterfaceTextLoop(): void {
  interfaceTextHandle?.stop(0);
  interfaceTextHandle = playMusic(WELCOME_INTERFACE_TEXT_SRC, {
    volume: INTERFACE_TEXT_VOLUME,
    fadeInMs: 0,
  });
}

export function stopInterfaceTextLoop(): void {
  interfaceTextHandle?.stop(0);
  interfaceTextHandle = null;
}

export function playButtonClick(): void {
  playSfxOnce(WELCOME_BUTTON_CLICK_SRC, { volume: BUTTON_CLICK_VOLUME });
}

export function startLoadingElevator(): void {
  elevatorHandle?.stop(0);
  elevatorHandle = playMusic(LOADING_ELEVATOR_SRC, { volume: ELEVATOR_VOLUME });
}

export function stopLoadingElevator(): void {
  elevatorHandle?.stop(0);
  elevatorHandle = null;
}

function installPrefetchListeners(): void {
  const prefetch = (): void => {
    document.removeEventListener("pointerdown", prefetch, true);
    document.removeEventListener("keydown", prefetch, true);
    prefetchLoadingMusic();
  };
  document.addEventListener("pointerdown", prefetch, true);
  document.addEventListener("keydown", prefetch, true);
}

installPrefetchListeners();