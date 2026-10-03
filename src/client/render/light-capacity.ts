let detectedMaxLights: number | null = null;

export function supportedMaxLights(): number {
  if (detectedMaxLights !== null) return detectedMaxLights;
  const configured = Number(import.meta.env.VITE_MAX_LIGHTS);
  if (Number.isFinite(configured) && configured > 0) return detectedMaxLights = Math.floor(configured);
  if (typeof document === "undefined") return detectedMaxLights = 0;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl");
  if (!gl) return detectedMaxLights = 0;
  const uniformVectors = Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  const capacity = Math.max(4, Math.floor((uniformVectors - 24) / 5));
  return detectedMaxLights = capacity >= 256 ? 256 : capacity >= 128 ? 128 : capacity;
}
