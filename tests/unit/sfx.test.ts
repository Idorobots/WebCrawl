import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOADING_ELEVATOR_SRC,
  playMusic,
  playSfxOnce,
  startInterfaceTextLoop,
  startLoadingElevator,
  stopAllMusic,
  stopInterfaceTextLoop,
  stopLoadingElevator,
  WELCOME_AMBIENT_SRC,
  WELCOME_INTERFACE_TEXT_SRC,
} from "../../src/client/audio/sfx";

class FakeAudio {
  static instances: FakeAudio[] = [];
  static nextPlayError: unknown = null;

  src: string;
  volume = 1;
  loop = false;
  preload = "";
  paused = true;
  currentTime = 0;
  playCount = 0;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.playCount += 1;
    const error = FakeAudio.nextPlayError;
    return error ? Promise.reject(error) : Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  load(): void {}
}

beforeEach(() => {
  FakeAudio.instances = [];
  FakeAudio.nextPlayError = null;
  vi.stubGlobal("Audio", FakeAudio);
  vi.useFakeTimers();
});

afterEach(() => {
  stopAllMusic(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sfx", () => {
  it("fades music in from silence to the target volume", async () => {
    playMusic(WELCOME_AMBIENT_SRC, { volume: 0.5 });
    const el = FakeAudio.instances[0]!;

    expect(el.src).toBe(WELCOME_AMBIENT_SRC);
    expect(el.loop).toBe(true);
    expect(el.playCount).toBe(1);
    expect(el.volume).toBe(0);

    await vi.advanceTimersByTimeAsync(750);
    expect(el.volume).toBeCloseTo(0.5);
  });

  it("fades music out and pauses it when stopped", async () => {
    const handle = playMusic(WELCOME_AMBIENT_SRC, { volume: 0.6, fadeInMs: 0 });
    const el = FakeAudio.instances[0]!;
    await vi.advanceTimersByTimeAsync(0);
    expect(el.volume).toBeCloseTo(0.6);

    handle.stop(500);
    await vi.advanceTimersByTimeAsync(500);
    expect(el.volume).toBe(0);
    expect(el.paused).toBe(true);
    expect(el.currentTime).toBe(0);
  });

  it("stops every active music track", async () => {
    playMusic("sounds/a.mp3", { fadeInMs: 0 });
    playMusic("sounds/b.mp3", { fadeInMs: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeAudio.instances.length).toBe(2);

    stopAllMusic(0);
    for (const el of FakeAudio.instances) {
      expect(el.paused).toBe(true);
      expect(el.volume).toBe(0);
    }
  });

  it("plays one-shot sfx at the requested volume", () => {
    playSfxOnce("sounds/ui/welcome/button_click.mp3", { volume: 0.7 });
    const el = FakeAudio.instances[0]!;
    expect(el.playCount).toBe(1);
    expect(el.volume).toBe(0.7);
    expect(el.loop).toBe(false);
  });

  it("retries blocked music once the user interacts", async () => {
    FakeAudio.nextPlayError = new DOMException("blocked", "NotAllowedError");
    playMusic(WELCOME_AMBIENT_SRC, { volume: 0.5 });
    const el = FakeAudio.instances[0]!;
    expect(el.playCount).toBe(1);

    await vi.advanceTimersByTimeAsync(0);
    FakeAudio.nextPlayError = null;
    document.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(750);
    expect(el.playCount).toBe(2);
    expect(el.volume).toBeCloseTo(0.5);
  });

  it("does not play music that was stopped while waiting for a gesture", async () => {
    FakeAudio.nextPlayError = new DOMException("blocked", "NotAllowedError");
    const handle = playMusic(WELCOME_AMBIENT_SRC, { volume: 0.5 });
    const el = FakeAudio.instances[0]!;

    await vi.advanceTimersByTimeAsync(0);
    handle.stop(0);
    FakeAudio.nextPlayError = null;
    document.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(750);
    expect(el.playCount).toBe(1);
    expect(el.paused).toBe(true);
    expect(el.volume).toBe(0);
  });

  it("loops the interface text sound without fading", async () => {
    startInterfaceTextLoop();
    const el = FakeAudio.instances[0]!;
    expect(el.src).toBe(WELCOME_INTERFACE_TEXT_SRC);
    expect(el.loop).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(el.volume).toBeCloseTo(0.45);

    stopInterfaceTextLoop();
    expect(el.paused).toBe(true);
  });

  it("fades the elevator music in and out", async () => {
    startLoadingElevator();
    const el = FakeAudio.instances[0]!;
    expect(el.src).toBe(LOADING_ELEVATOR_SRC);

    await vi.advanceTimersByTimeAsync(750);
    expect(el.volume).toBeCloseTo(0.5);

    stopLoadingElevator();
    await vi.advanceTimersByTimeAsync(750);
    expect(el.volume).toBe(0);
    expect(el.paused).toBe(true);
  });

  it("starts fresh music after stopAllMusic cleared the semantic handles", () => {
    startLoadingElevator();
    stopAllMusic(0);
    startLoadingElevator();
    expect(FakeAudio.instances.length).toBe(2);
    expect(FakeAudio.instances[1]!.playCount).toBe(1);
  });
});