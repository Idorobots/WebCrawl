export function supportsFullscreenApi(): boolean {
  const doc = document as Document & { webkitFullscreenEnabled?: boolean };
  return doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
}

export function isFullscreen(): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return doc.fullscreenElement != null || doc.webkitFullscreenElement != null;
}

export function isMobileDevice(): boolean {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  return coarse && touch;
}

export async function enterFullscreen(): Promise<void> {
  if (isFullscreen() || !supportsFullscreenApi()) return;
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  if (typeof root.requestFullscreen === "function") {
    try {
      await root.requestFullscreen({ navigationUI: "hide" });
      return;
    } catch {
      return;
    }
  }
  try {
    await root.webkitRequestFullscreen?.();
  } catch {
    return;
  }
}

export function requestMobileFullscreen(): void {
  if (!isMobileDevice()) return;
  void enterFullscreen();
}
