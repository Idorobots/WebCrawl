import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enterFullscreen,
  isFullscreen,
  isMobileDevice,
  requestMobileFullscreen,
  supportsFullscreenApi,
} from "../../src/client/ui/fullscreen";

type TestDocument = Document & {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
};
type TestElement = HTMLElement & {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const doc = document as TestDocument;
const root = document.documentElement as TestElement;
const docProps = [
  "fullscreenElement",
  "webkitFullscreenElement",
  "fullscreenEnabled",
  "webkitFullscreenEnabled",
] as const;

function setProp(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { configurable: true, value });
}

function stubMatchMedia(matches: boolean): void {
  setProp(window, "matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  for (const key of docProps) delete (doc as unknown as Record<string, unknown>)[key];
  delete (root as unknown as Record<string, unknown>).requestFullscreen;
  delete (root as unknown as Record<string, unknown>).webkitRequestFullscreen;
  delete (navigator as unknown as Record<string, unknown>).maxTouchPoints;
  delete (window as unknown as Record<string, unknown>).matchMedia;
});

describe("supportsFullscreenApi", () => {
  it("is true when the standard API is enabled", () => {
    setProp(doc, "fullscreenEnabled", true);
    expect(supportsFullscreenApi()).toBe(true);
  });

  it("is true when only the webkit API is enabled", () => {
    setProp(doc, "webkitFullscreenEnabled", true);
    expect(supportsFullscreenApi()).toBe(true);
  });

  it("is false when the API is disabled", () => {
    setProp(doc, "fullscreenEnabled", false);
    expect(supportsFullscreenApi()).toBe(false);
  });
});

describe("isFullscreen", () => {
  it("detects the standard fullscreen element", () => {
    setProp(doc, "fullscreenElement", document.documentElement);
    expect(isFullscreen()).toBe(true);
  });

  it("detects the webkit fullscreen element", () => {
    setProp(doc, "webkitFullscreenElement", document.documentElement);
    expect(isFullscreen()).toBe(true);
  });

  it("is false outside of fullscreen", () => {
    expect(isFullscreen()).toBe(false);
  });
});

describe("isMobileDevice", () => {
  it("requires both a coarse pointer and touch support", () => {
    stubMatchMedia(true);
    setProp(navigator, "maxTouchPoints", 3);
    expect(isMobileDevice()).toBe(true);
  });

  it("is false without a coarse pointer", () => {
    stubMatchMedia(false);
    setProp(navigator, "maxTouchPoints", 3);
    expect(isMobileDevice()).toBe(false);
  });

  it("is false without touch support", () => {
    stubMatchMedia(true);
    setProp(navigator, "maxTouchPoints", 0);
    expect(isMobileDevice()).toBe(false);
  });
});

describe("enterFullscreen", () => {
  it("requests the document element fullscreen with hidden navigation UI", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    setProp(doc, "fullscreenEnabled", true);
    setProp(root, "requestFullscreen", requestFullscreen);
    await enterFullscreen();
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
  });

  it("is a no-op when already fullscreen", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    setProp(doc, "fullscreenEnabled", true);
    setProp(doc, "fullscreenElement", document.documentElement);
    setProp(root, "requestFullscreen", requestFullscreen);
    await enterFullscreen();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("is a no-op when the API is disabled", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    setProp(doc, "fullscreenEnabled", false);
    setProp(root, "requestFullscreen", requestFullscreen);
    await enterFullscreen();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("swallows request rejections", async () => {
    const requestFullscreen = vi.fn().mockRejectedValue(new Error("denied"));
    setProp(doc, "fullscreenEnabled", true);
    setProp(root, "requestFullscreen", requestFullscreen);
    await expect(enterFullscreen()).resolves.toBeUndefined();
  });

  it("falls back to the webkit API when the standard one is missing", async () => {
    const webkitRequestFullscreen = vi.fn().mockResolvedValue(undefined);
    setProp(doc, "webkitFullscreenEnabled", true);
    setProp(root, "requestFullscreen", undefined);
    setProp(root, "webkitRequestFullscreen", webkitRequestFullscreen);
    await enterFullscreen();
    expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe("requestMobileFullscreen", () => {
  it("requests fullscreen on mobile devices", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    stubMatchMedia(true);
    setProp(navigator, "maxTouchPoints", 1);
    setProp(doc, "fullscreenEnabled", true);
    setProp(root, "requestFullscreen", requestFullscreen);
    requestMobileFullscreen();
    await vi.waitFor(() => expect(requestFullscreen).toHaveBeenCalled());
  });

  it("does nothing on desktop devices", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    stubMatchMedia(false);
    setProp(navigator, "maxTouchPoints", 0);
    setProp(doc, "fullscreenEnabled", true);
    setProp(root, "requestFullscreen", requestFullscreen);
    requestMobileFullscreen();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });
});
