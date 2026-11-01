/**
 * Shared model components: status stack light, contact shadows, status helpers.
 */
import * as THREE from 'three';
import type { AnimState, ModelInstance, VisualStatus } from './types';
import { Builder, disposeTree, fract, TAU } from './geom';
import { contactRoundMat, mat, PAL, radialTexture, setNightLevel } from './materials';

// ---------------------------------------------------------------------------------------------
// Status language (see docs/art-bible.md §Animation-state language)

/** True when the machine's mechanism should be moving. */
export const isRunning = (s: VisualStatus) => s === 'working' || s === 'loading' || s === 'unloading';

/**
 * Stack-light tiers, bottom → top: 0 blue, 1 green, 2 amber, 3 red, 4 white (clear cap).
 * Each status lights ONE tier with a distinct blink pattern, so status reads by position + rhythm,
 * not colour alone.
 */
export function statusLamp(status: VisualStatus, t: number, out: Float32Array): void {
  out.fill(0);
  switch (status) {
    case 'working':
      out[1] = 1; // steady green
      break;
    case 'loading':
    case 'unloading':
      out[1] = fract(t * 2.2) < 0.55 ? 1 : 0.15; // quick green blink
      break;
    case 'starved':
      out[2] = fract(t * 0.8) < 0.5 ? 1 : 0.08; // slow amber blink
      break;
    case 'blocked': {
      const f = fract(t / 1.3); // amber double flash
      out[2] = f < 0.1 || (f > 0.2 && f < 0.3) ? 1 : 0.08;
      break;
    }
    case 'no_power':
      out[3] = fract(t / 1.8) < 0.12 ? 1 : 0.05; // short red flash, mostly dark
      break;
    case 'no_worker':
      out[0] = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 3.2)); // breathing blue
      break;
    case 'no_recipe':
      out[4] = fract(t * 0.6) < 0.5 ? 0.9 : 0.1; // slow white blink
      break;
    case 'upgrading': {
      const f = fract(t * 1.2); // amber/green alternate
      out[2] = f < 0.5 ? 1 : 0;
      out[1] = f < 0.5 ? 0 : 1;
      break;
    }
    case 'idle':
    default:
      out[4] = 0.22; // dim white = "grey"
      break;
  }
}

const TIER_COLORS = [0x2f7cff, 0x2fd35a, 0xffa31a, 0xff3326, 0xf2f4f8];

const stackVert = /* glsl */ `
attribute float aSeg;
uniform vec4 uOnA;
uniform float uOnB;
varying float vOn;
`;

function stackOnBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms, mat: THREE.Material): void {
  shader.uniforms.uOnA = mat.userData.uOnA;
  shader.uniforms.uOnB = mat.userData.uOnB;
  shader.vertexShader = stackVert + shader.vertexShader.replace(
    '#include <color_vertex>',
    `#include <color_vertex>
    vOn = aSeg < -0.5 ? 0.0 : aSeg < 0.5 ? uOnA.x : aSeg < 1.5 ? uOnA.y : aSeg < 2.5 ? uOnA.z : aSeg < 3.5 ? uOnA.w : uOnB;`,
  );
  shader.fragmentShader = 'varying float vOn;\n' + shader.fragmentShader
    .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(0.38, 0.9, vOn);')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vColor.rgb * diffuse * vOn * 3.2;');
}

const lensGeoCache = new Map<string, THREE.BufferGeometry>();
/** Stacked lens tiers (bottom → top) with a per-vertex `aSeg` tier id. Shared per size. */
function lensGeometry(r: number, tierH: number, tiers: number): THREE.BufferGeometry {
  const key = `${r}:${tierH}:${tiers}`;
  let g = lensGeoCache.get(key);
  if (g) return g;
  const ids = tiers === 1 ? [1] : [0, 1, 2, 3, 4];
  const parts: THREE.BufferGeometry[] = [];
  const segAttr: number[] = [];
  let y = 0;
  for (const tier of ids) {
    const isCap = tier === 4;
    const src = isCap
      ? new THREE.SphereGeometry(r * 0.92, 12, 5, 0, TAU, 0, Math.PI / 2)
      : new THREE.CylinderGeometry(r, r, tierH * 0.86, 14, 1, false);
    src.translate(0, isCap ? y : y + tierH / 2, 0);
    const geo = src.toNonIndexed();
    src.dispose();
    const c = new THREE.Color(tiers === 1 ? 0xffffff : TIER_COLORS[tier]);
    const cnt = geo.attributes.position.count;
    const col = new Float32Array(cnt * 3);
    for (let v = 0; v < cnt; v++) {
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      segAttr.push(tier);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.deleteAttribute('uv');
    parts.push(geo);
    y += tierH;
  }
  let total = 0;
  for (const m of parts) total += m.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const m of parts) {
    pos.set(m.attributes.position.array as Float32Array, o * 3);
    nor.set(m.attributes.normal.array as Float32Array, o * 3);
    col.set(m.attributes.color.array as Float32Array, o * 3);
    o += m.attributes.position.count;
    m.dispose();
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSeg', new THREE.Float32BufferAttribute(segAttr, 1));
  g.computeBoundingSphere();
  g.userData.shared = true;
  lensGeoCache.set(key, g);
  return g;
}

let haloTex: THREE.Texture | null = null;

/**
 * Industrial stack light. Housing (base, pole, cap) is added into the caller's static Builder; the
 * lens is one mesh with a per-instance material (shared shader program) + an additive halo sprite
 * that makes the active tier readable at phone size.
 */
export class StackLight {
  readonly object = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;
  private halo: THREE.Sprite;
  private haloMat: THREE.SpriteMaterial;
  private on = new Float32Array(5);
  private uA: { value: THREE.Vector4 };
  private uB: { value: number };
  private tierH: number;
  private tiers: number;

  /**
   * @param b builder receiving the static housing
   * @param x,y,z mount point (top of the surface it stands on)
   * @param pole pole height above mount
   * @param size scale (1 = 0.11 m diameter lens)
   * @param tiers 5 for the full stack, 1 for a single green/amber LED (belts)
   */
  constructor(b: Builder, x: number, y: number, z: number, pole = 0.3, size = 1, tiers = 5, halo = true) {
    const r = 0.055 * size;
    this.tierH = 0.065 * size;
    this.tiers = tiers;
    // housing
    b.cylB('satin', PAL.graphite, r * 1.25, 0.03 * size, x, y, z, 12);
    if (pole > 0.001) b.cylB('metal', PAL.steel, 0.012 * size + 0.006, pole, x, y + 0.03 * size, z, 8);
    const lensY = y + 0.03 * size + pole;
    b.cylB('satin', PAL.graphite, r * 1.08, 0.025 * size, x, lensY - 0.012 * size, z, 12);
    const h = this.tierH * (tiers === 5 ? 4 : tiers);
    if (tiers !== 5) b.cylB('satin', PAL.graphite, r * 1.08, 0.02 * size, x, lensY + h, z, 12);
    this.uA = { value: new THREE.Vector4() };
    this.uB = { value: 0 };
    this.mat = new THREE.MeshStandardMaterial({ name: 'stackLens', vertexColors: true, roughness: 0.25, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1 });
    this.mat.userData.perInstance = true;
    this.mat.userData.uOnA = this.uA;
    this.mat.userData.uOnB = this.uB;
    this.mat.onBeforeCompile = function (this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
      stackOnBeforeCompile(shader, this);
    };
    this.mat.customProgramCacheKey = () => 'stackLens';
    const lens = new THREE.Mesh(lensGeometry(r, this.tierH, tiers), this.mat);
    lens.position.set(x, lensY + 0.012 * size, z);
    lens.castShadow = false;
    lens.name = 'stackLens';
    this.object.add(lens);
    if (!haloTex) haloTex = radialTexture();
    this.haloMat = new THREE.SpriteMaterial({ map: haloTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.haloMat.userData.perInstance = true;
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.setScalar(0.42 * size);
    this.halo.position.copy(lens.position);
    this.halo.renderOrder = 10;
    if (halo) this.object.add(this.halo);
    else this.halo.visible = false;
  }

  /** Top of the light (for placing above). */
  update(status: VisualStatus, t: number, night: number): void {
    const on = this.on;
    statusLamp(status, t, on);
    if (this.tiers === 1) {
      // single LED: the lens is white; colour = whichever tier is active (fixed pattern per status)
      let bi = -1, bv = 0;
      for (let i = 0; i < 4; i++) if (on[i] > bv) { bv = on[i]; bi = i; }
      this.mat.color.setHex(bi >= 0 ? TIER_COLORS[bi] : 0x777777);
      this.uA.value.set(0, bi >= 0 ? bv : 0, 0, 0);
      this.uB.value = 0;
    } else {
      this.uA.value.set(on[0], on[1], on[2], on[3]);
      this.uB.value = on[4];
    }
    // halo on the brightest tier
    let best = 0, bi = -1;
    for (let i = 0; i < 5; i++) if (on[i] > best) { best = on[i]; bi = i; }
    if (bi < 0 || (bi === 4 && best < 0.3)) {
      this.haloMat.opacity = 0;
    } else {
      this.haloMat.color.setHex(TIER_COLORS[bi]);
      this.haloMat.opacity = best * (0.55 + 0.4 * night);
      const tierIndex = this.tiers === 5 ? bi : 0;
      this.halo.position.y = (this.object.children[0] as THREE.Mesh).position.y + this.tierH * (tierIndex + 0.5);
    }
  }

  dispose(): void {
    this.mat.dispose();
    this.haloMat.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Contact shadows

const unitPlane = (() => {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  g.userData.shared = true;
  return g;
})();

/** Soft rectangular contact shadow (w × d metres) at floor level. */
export function contactShadow(w: number, d: number, x = 0, z = 0, round = false, y = 0.006): THREE.Mesh {
  const m = new THREE.Mesh(unitPlane, round ? contactRoundMat() : mat('contact'));
  // the texture has a soft margin; enlarge so the dark core matches the footprint
  const k = round ? 1.25 : 1.5;
  m.scale.set(w * k, 1, d * k);
  m.position.set(x, y, z);
  m.renderOrder = -1;
  m.name = 'contactShadow';
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** Ground light pool for lamps (visible at night). */
export function lightPool(r: number, x = 0, z = 0, y = 0.012): THREE.Mesh {
  const m = new THREE.Mesh(unitPlane, mat('lightPool'));
  m.scale.set(r * 2, 1, r * 2);
  m.position.set(x, y, z);
  m.renderOrder = 2;
  m.name = 'lightPool';
  return m;
}

// ---------------------------------------------------------------------------------------------
// Instance assembly

export interface InstanceParts {
  root: THREE.Object3D;
  update?: (dt: number, s: AnimState) => void;
  setCutaway?: (a: number) => void;
  extraDispose?: () => void;
}

export function makeInstance(p: InstanceParts): ModelInstance {
  const inst: ModelInstance = {
    root: p.root,
    update: (dt, s) => {
      setNightLevel(s.night);
      p.update?.(dt, s);
    },
    dispose: () => {
      p.extraDispose?.();
      disposeTree(p.root);
      p.root.removeFromParent();
    },
  };
  if (p.setCutaway) inst.setCutaway = p.setCutaway;
  return inst;
}

/** Hazard-striped edge strip (yellow/black) of length L along X, for machine bases and dock lips. */
export function hazardStrip(b: Builder, len: number, x: number, y: number, z: number, ry = 0, w = 0.06, h = 0.012): void {
  b.box('hazard', 0xffffff, len, h, w, x, y + h / 2, z, 0.003, { ry });
}

/** Common floor-mounted adjustable foot (levelling pad). */
export function foot(b: Builder, x: number, z: number, h = 0.06, r = 0.035): void {
  b.cylB('metal', PAL.steelDark, r, 0.012, x, 0, z, 10);
  b.cylB('metal', PAL.steel, r * 0.35, h, x, 0.012, z, 6);
}

/** Small control panel with buttons (static). Faces +Z in local frame. */
export function controlPanel(b: Builder, x: number, y: number, z: number, ry = 0, w = 0.28, h = 0.2, body: number = PAL.graphite): void {
  b.push(x, y, z, ry);
  b.box('satin', body, w, h, 0.06, 0, 0, 0, 0.012);
  b.box('screen', 0xffffff, w * 0.42, h * 0.38, 0.008, -w * 0.18, h * 0.12, 0.031, 0.002);
  b.cyl('satin', PAL.green, 0.016, 0.02, w * 0.22, h * 0.18, 0.035, 'z', 10);
  b.cyl('satin', PAL.red, 0.022, 0.024, w * 0.22, -h * 0.2, 0.035, 'z', 10);
  b.cyl('satin', PAL.yellow, 0.026, 0.006, w * 0.22, -h * 0.2, 0.031, 'z', 10);
  b.box('satin', PAL.white, w * 0.12, 0.018, 0.012, -w * 0.3, -h * 0.25, 0.034, 0.003);
  b.box('satin', PAL.white, w * 0.12, 0.018, 0.012, -w * 0.08, -h * 0.25, 0.034, 0.003);
  b.pop();
}

export { disposeTree };
