import Phaser from "phaser";

export const ELLIPTICAL_LIGHT_PIPELINE = "WebCrawlLight2D";

const FRAGMENT_SHADER = `
#define SHADER_NAME WEBCRAWL_ELLIPTICAL_LIGHT_FS
precision mediump float;

struct Light
{
    vec2 position;
    vec3 color;
    float intensity;
    float radius;
};

const int kMaxLights = %LIGHT_COUNT%;
uniform vec4 uCamera;
uniform vec2 uResolution;
uniform sampler2D uMainSampler;
uniform sampler2D uNormSampler;
uniform vec3 uAmbientLightColor;
uniform Light uLights[kMaxLights];
uniform int uLightCount;
uniform mat3 uInverseRotationMatrix;

uniform float uFlashlightActive;
uniform vec2 uFlashlightOrigin;
uniform vec2 uFlashlightTarget;
uniform vec2 uFlashlightRadii;
uniform vec3 uFlashlightColor;
uniform float uFlashlightIntensity;
uniform float uFlashlightSoftness;
uniform float uFlashlightHeight;

varying vec2 outTexCoord;
varying float outTexId;
varying float outTintEffect;
varying vec4 outTint;

void main ()
{
    vec3 finalColor = vec3(0.0, 0.0, 0.0);
    vec4 texel = vec4(outTint.bgr * outTint.a, outTint.a);
    vec4 texture = texture2D(uMainSampler, outTexCoord);
    vec4 color = texture * texel;

    if (outTintEffect == 1.0)
    {
        color.rgb = mix(texture.rgb, outTint.bgr * outTint.a, texture.a);
    }
    else if (outTintEffect == 2.0)
    {
        color = texel;
    }

    vec3 normalMap = texture2D(uNormSampler, outTexCoord).rgb;
    vec3 normal = normalize(uInverseRotationMatrix * vec3(normalMap * 2.0 - 1.0));
    vec2 res = vec2(min(uResolution.x, uResolution.y)) * uCamera.w;

    for (int index = 0; index < kMaxLights; ++index)
    {
        if (index < uLightCount)
        {
            Light light = uLights[index];
            vec3 lightDir = vec3((light.position.xy / res) - (gl_FragCoord.xy / res), 0.1);
            vec3 lightNormal = normalize(lightDir);
            float distToSurf = length(lightDir) * uCamera.w;
            float diffuseFactor = max(dot(normal, lightNormal), 0.0);
            float radius = (light.radius / res.x * uCamera.w) * uCamera.w;
            float attenuation = clamp(1.0 - distToSurf * distToSurf / (radius * radius), 0.0, 1.0);
            finalColor += attenuation * light.color * diffuseFactor * light.intensity;
        }
    }

    if (uFlashlightActive > 0.5)
    {
        vec2 rawAxis = uFlashlightTarget - uFlashlightOrigin;
        vec2 axis = normalize(rawAxis + vec2(0.0001, 0.0));
        vec2 perpendicular = vec2(-axis.y, axis.x);
        vec2 fromTarget = gl_FragCoord.xy - uFlashlightTarget;
        vec2 ellipse = vec2(
            dot(fromTarget, axis) / max(uFlashlightRadii.x, 1.0),
            dot(fromTarget, perpendicular) / max(uFlashlightRadii.y, 1.0)
        );
        float ellipticalDistance = length(ellipse);
        float featherStart = clamp(1.0 - uFlashlightSoftness, 0.0, 0.98);
        float attenuation = 1.0 - smoothstep(featherStart, 1.0, ellipticalDistance);
        float minimumDimension = min(uResolution.x, uResolution.y);
        vec3 lightDirection = normalize(vec3(
            (uFlashlightOrigin - gl_FragCoord.xy) / minimumDimension,
            uFlashlightHeight / minimumDimension
        ));
        float diffuseFactor = max(dot(normal, lightDirection), 0.0);
        finalColor += attenuation * uFlashlightColor * diffuseFactor * uFlashlightIntensity;
    }

    vec4 lightColor = vec4(uAmbientLightColor + finalColor, 1.0);
    gl_FragColor = color * vec4(lightColor.rgb * lightColor.a, lightColor.a);
}
`;

export interface FlashlightState {
  active: boolean;
  originX: number;
  originY: number;
  targetX: number;
  targetY: number;
  majorRadius: number;
  minorRadius: number;
  intensity: number;
}

export class EllipticalLightPipeline extends Phaser.Renderer.WebGL.Pipelines.LightPipeline {
  flashlight: FlashlightState = {
    active: false,
    originX: 0,
    originY: 0,
    targetX: 0,
    targetY: 0,
    majorRadius: 1,
    minorRadius: 1,
    intensity: 0,
  };

  constructor(game: Phaser.Game) {
    super({ game, fragShader: FRAGMENT_SHADER });
  }

  override onRender(scene: Phaser.Scene, camera: Phaser.Cameras.Scene2D.Camera): void {
    super.onRender(scene, camera);

    const flashlight = this.flashlight;
    this.set1f("uFlashlightActive", flashlight.active ? 1 : 0);
    if (!flashlight.active) return;

    const zoom = camera.zoom;
    const rendererHeight = this.renderer.height;
    const originX = camera.x + (flashlight.originX - camera.worldView.x) * zoom;
    const originY = rendererHeight - (camera.y + (flashlight.originY - camera.worldView.y) * zoom);
    const targetX = camera.x + (flashlight.targetX - camera.worldView.x) * zoom;
    const targetY = rendererHeight - (camera.y + (flashlight.targetY - camera.worldView.y) * zoom);

    this.set2f("uFlashlightOrigin", originX, originY);
    this.set2f("uFlashlightTarget", targetX, targetY);
    this.set2f(
      "uFlashlightRadii",
      flashlight.majorRadius * zoom,
      flashlight.minorRadius * zoom,
    );
    this.set3f("uFlashlightColor", 1, 1, 1);
    this.set1f("uFlashlightIntensity", flashlight.intensity);
    this.set1f("uFlashlightSoftness", 0.7);
    this.set1f("uFlashlightHeight", flashlight.majorRadius * zoom * 0.72);
  }
}
