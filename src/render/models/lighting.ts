/**
 * Game lighting rig, shared by the model gallery and the game so both look identical.
 *
 * Usage (integration):
 *   configureRenderer(renderer);
 *   const sky = createSkyAndFog(scene, renderer);   // background, fog, IBL environment
 *   const rig = createLightRig(); scene.add(rig.group);
 *   // every frame:
 *   rig.update(night01, cameraFocusPoint, visibleRadiusMetres);
 *   sky.update(night01);
 *
 * Palette (sRGB):          day                         night
 *   sun / moon colour       #fff0d8  (int 2.6)           #8fa8ff (int 0.5)
 *   sky (hemi up)           #cfe4ff  (int 0.95)          #2c3f70 (int 0.42)
 *   ground (hemi down)      #c8b496                      #141a2a
 *   background / fog        #bcdcef                      #0e1729
 *   environment intensity   0.45                         0.10
 *   sun direction (to light) (0.62, 1, 0.36) — from the east-south-east, ~50° high, so street-facing
 *   walls read in two tones and west/north walls never shadow a cut-away interior.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function configureRenderer(r: THREE.WebGLRenderer): void {
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true;
  // PCFSoftShadowMap was removed in r18x; PCF + shadow.radius gives the soft look.
  r.shadowMap.type = THREE.PCFShadowMap;
}

const DAY = {
  sun: new THREE.Color(0xfff0d8),
  sunI: 2.6,
  sky: new THREE.Color(0xcfe4ff),
  ground: new THREE.Color(0xc8b496),
  hemiI: 0.95,
  fill: new THREE.Color(0xbcd4ff),
  fillI: 0.3,
};
const NIGHT = {
  sun: new THREE.Color(0x8fa8ff),
  sunI: 0.5,
  sky: new THREE.Color(0x2c3f70),
  ground: new THREE.Color(0x141a2a),
  hemiI: 0.42,
  fill: new THREE.Color(0x6f86c8),
  fillI: 0.18,
};

/** Light direction (towards the light) for day (sun from SSE, high) and night (moon from SW). */
const SUN_DIR = new THREE.Vector3(0.62, 1.0, 0.36).normalize();
const MOON_DIR = new THREE.Vector3(0.3, 1.0, 0.55).normalize();

export interface LightRig {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  update(night01: number, focus: THREE.Vector3, viewRadius: number): void;
}

export function createLightRig(): LightRig {
  const group = new THREE.Group();
  group.name = 'lightRig';
  const sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 200;
  group.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(DAY.sky, DAY.ground, DAY.hemiI);
  group.add(hemi);
  // gentle back/fill from the opposite side so shaded faces are never flat black
  const fill = new THREE.DirectionalLight(DAY.fill, DAY.fillI);
  fill.castShadow = false;
  group.add(fill, fill.target);

  const dir = new THREE.Vector3();
  const tmp = new THREE.Color();
  let lastR = -1;
  return {
    group,
    sun,
    hemi,
    update(night01: number, focus: THREE.Vector3, viewRadius: number) {
      const n = THREE.MathUtils.clamp(night01, 0, 1);
      const k = n * n * (3 - 2 * n);
      dir.copy(SUN_DIR).lerp(MOON_DIR, k).normalize();
      const dist = Math.max(30, viewRadius * 2.5);
      sun.position.copy(focus).addScaledVector(dir, dist);
      sun.target.position.copy(focus);
      sun.color.copy(DAY.sun).lerp(NIGHT.sun, k);
      sun.intensity = THREE.MathUtils.lerp(DAY.sunI, NIGHT.sunI, k);
      hemi.color.copy(DAY.sky).lerp(NIGHT.sky, k);
      hemi.groundColor.copy(tmp.copy(DAY.ground).lerp(NIGHT.ground, k));
      hemi.intensity = THREE.MathUtils.lerp(DAY.hemiI, NIGHT.hemiI, k);
      fill.position.copy(focus).addScaledVector(dir, -dist).setY(focus.y + dist * 0.6);
      fill.target.position.copy(focus);
      fill.color.copy(DAY.fill).lerp(NIGHT.fill, k);
      fill.intensity = THREE.MathUtils.lerp(DAY.fillI, NIGHT.fillI, k);
      // fit the shadow frustum to the view
      const r = Math.max(6, viewRadius);
      if (Math.abs(r - lastR) > 0.01) {
        lastR = r;
        const cam = sun.shadow.camera;
        cam.left = -r;
        cam.right = r;
        cam.top = r;
        cam.bottom = -r;
        cam.far = dist + r * 2;
        cam.updateProjectionMatrix();
      }
      // stabilise: snap the focus to shadow texels to avoid shimmering while panning
      const texel = (2 * r) / sun.shadow.mapSize.x;
      sun.target.position.x = Math.round(sun.target.position.x / texel) * texel;
      sun.target.position.z = Math.round(sun.target.position.z / texel) * texel;
      sun.position.copy(sun.target.position).addScaledVector(dir, dist);
    },
  };
}

export const SKY_DAY = 0xbcdcef;
export const SKY_NIGHT = 0x0e1729;

export interface SkyAndFog {
  update(night01: number): void;
}

/**
 * Background colour, distance fog and a neutral IBL environment (RoomEnvironment → PMREM; procedural,
 * no downloaded HDRI). Pass the renderer to enable the environment map (strongly recommended: metals
 * and glass look dead without it).
 */
export function createSkyAndFog(scene: THREE.Scene, renderer?: THREE.WebGLRenderer, fogNear = 60, fogFar = 220): SkyAndFog {
  const day = new THREE.Color(SKY_DAY);
  const night = new THREE.Color(SKY_NIGHT);
  const bg = new THREE.Color(SKY_DAY);
  scene.background = bg;
  const fog = new THREE.Fog(bg.getHex(), fogNear, fogFar);
  scene.fog = fog;
  if (renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    scene.environment = env;
  }
  scene.environmentIntensity = 0.45;
  return {
    update(night01: number) {
      const n = THREE.MathUtils.clamp(night01, 0, 1);
      const k = n * n * (3 - 2 * n);
      bg.copy(day).lerp(night, k);
      fog.color.copy(bg);
      scene.environmentIntensity = THREE.MathUtils.lerp(0.45, 0.1, k);
    },
  };
}
