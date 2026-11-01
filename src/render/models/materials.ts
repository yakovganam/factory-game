/**
 * Shared palette + material library. Every model in the library draws from these few materials;
 * per-part colour comes from vertex colours (multiplied into the material's base colour), so a
 * whole machine is typically 2–4 draw calls. See docs/art-bible.md for the palette rationale.
 *
 * Shared materials are NEVER disposed by model instances. Call `disposeMaterialLibrary()` only when
 * tearing down the whole renderer.
 */
import * as THREE from 'three';

/** Palette (sRGB hex). Keep in sync with docs/art-bible.md. */
export const PAL = {
  // architecture
  brick: 0xb35a3d,
  brickDark: 0x83402e,
  cream: 0xf1e6cf,
  creamDark: 0xdccaa6,
  plaster: 0xe9e2d4,
  roof: 0x4d6670,
  roofDark: 0x34474f,
  roofRed: 0xa64a3b,
  teal: 0x2e7c78,
  tealDark: 0x1f5654,
  mint: 0x93d6c3,
  // materials
  wood: 0xc9985f,
  woodLight: 0xe3c08a,
  woodDark: 0x8a5d36,
  cardboard: 0xc99b63,
  cardboardDark: 0xa87b46,
  steel: 0xaab3ba,
  steelDark: 0x5c656d,
  chrome: 0xe2e6ea,
  graphite: 0x34383f,
  rubber: 0x2a2c31,
  concrete: 0xd3ccc0,
  concreteDark: 0xaaa296,
  asphalt: 0x4c5056,
  grass: 0x8dbf62,
  grassDark: 0x6c9e48,
  // accents
  yellow: 0xf2bb2c,
  orange: 0xef7f3a,
  red: 0xd8453c,
  blue: 0x3f7fc8,
  navy: 0x2b3d5c,
  purple: 0x6d4fa8,
  green: 0x4caf6a,
  white: 0xf5f3ee,
  black: 0x26272b,
  glass: 0x86aebf,
  glow: 0xffc874,
  skin: [0xf2c9a6, 0xe0aa80, 0xc68a5f, 0x9c6741, 0x6e4529],
} as const;

export type MatKey =
  | 'paint' // matte painted / plastered / generic (rough 0.8)
  | 'satin' // painted steel, plastic, toys, vehicles (rough 0.45)
  | 'metal' // bare steel, aluminium, chrome (metal 0.85)
  | 'brick' // brick texture, world-metre UVs
  | 'concrete' // floors, slabs, pavements (subtle 1 m joints)
  | 'ribbed' // corrugated metal: roofs, containers, cladding (vertical ribs, normal map)
  | 'slats' // roller-door curtains (horizontal ribs)
  | 'tiles' // house roof tiles (rows along U, matte)
  | 'wood' // planks, pallets, benches
  | 'hazard' // yellow/black diagonal stripes
  | 'glass' // opaque reflective glazing (never glows)
  | 'glassLit' // building windows: warm glow at night
  | 'glassClear' // see-through glazing (booths, offices, display windows)
  | 'lamp' // warm emissive (street lamps, headlights, interior pendants)
  | 'lampCool' // cool LED panels
  | 'tail' // red tail lights / warning lamps
  | 'screen' // cyan displays, HMI screens, mascot eyes
  | 'solar' // PV panels
  | 'wire' // wire-mesh fence panels (alpha-tested)
  | 'foliage' // trees / shrubs (matte, vertex-coloured)
  | 'contact' // soft blob contact shadow (transparent)
  | 'lightPool'; // additive light pool under street lamps at night

const mats = new Map<string, THREE.Material>();
const textures = new Map<string, THREE.Texture>();
let nightLevel = -1;

const hasDOM = typeof document !== 'undefined';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (!hasDOM) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  return [c, ctx];
}

/** Deterministic tiny PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit string hash (FNV-1a). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tex(key: string, make: () => THREE.Texture | null): THREE.Texture | null {
  if (textures.has(key)) return textures.get(key)!;
  const t = make();
  if (t) textures.set(key, t);
  return t;
}

function canvasTexture(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Brick: 1 texture = 1.2 m × 1.2 m (4 bricks × 12 courses), real colours, tinted by vertex colour. */
function brickTexture(): THREE.Texture | null {
  return tex('brick', () => {
    const cv = canvas(256, 256);
    if (!cv) return null;
    const [c, g] = cv;
    g.fillStyle = '#e9dcc6';
    g.fillRect(0, 0, 256, 256);
    const r = rng(7);
    const rows = 12;
    const rh = 256 / rows;
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? 32 : 0;
      for (let col = -1; col < 5; col++) {
        const x = col * 64 + off;
        const v = 0.9 + r() * 0.16;
        const hue = r() < 0.12 ? -10 : 0;
        g.fillStyle = `rgb(${Math.round((198 + hue) * v)},${Math.round(104 * v)},${Math.round(76 * v)})`;
        g.fillRect(x + 2, row * rh + 2, 60, rh - 3);
        // soft top highlight for a hint of relief
        g.fillStyle = 'rgba(255,235,210,0.10)';
        g.fillRect(x + 2, row * rh + 2, 60, 2);
      }
    }
    const t = canvasTexture(c);
    t.repeat.set(1 / 1.2, 1 / 1.2);
    return t;
  });
}

/** Concrete: 1 texture = 1 m with very faint joint at the edges (aligned to grid when UVs start at grid corner). */
function concreteTexture(): THREE.Texture | null {
  return tex('concrete', () => {
    const cv = canvas(128, 128);
    if (!cv) return null;
    const [c, g] = cv;
    g.fillStyle = '#f2f0ec';
    g.fillRect(0, 0, 128, 128);
    const r = rng(11);
    for (let i = 0; i < 260; i++) {
      const v = 225 + Math.floor(r() * 30);
      g.fillStyle = `rgba(${v},${v - 2},${v - 6},0.35)`;
      const s = 2 + r() * 6;
      g.fillRect(r() * 128, r() * 128, s, s);
    }
    g.fillStyle = 'rgba(120,112,100,0.30)';
    g.fillRect(0, 0, 128, 2);
    g.fillRect(0, 0, 2, 128);
    const t = canvasTexture(c);
    return t;
  });
}

function woodTexture(): THREE.Texture | null {
  return tex('wood', () => {
    const cv = canvas(128, 128);
    if (!cv) return null;
    const [c, g] = cv;
    g.fillStyle = '#f4ece0';
    g.fillRect(0, 0, 128, 128);
    const r = rng(5);
    for (let i = 0; i < 40; i++) {
      const y = r() * 128;
      g.strokeStyle = `rgba(150,105,60,${0.10 + r() * 0.15})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(40, y + (r() - 0.5) * 6, 90, y + (r() - 0.5) * 6, 128, y);
      g.stroke();
    }
    const t = canvasTexture(c);
    t.repeat.set(2, 2);
    return t;
  });
}

function hazardTexture(): THREE.Texture | null {
  return tex('hazard', () => {
    const cv = canvas(64, 64);
    if (!cv) return null;
    const [c, g] = cv;
    g.fillStyle = '#f2bb2c';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#26272b';
    for (let k = -2; k < 3; k++) {
      g.beginPath();
      g.moveTo(k * 32, 64);
      g.lineTo(k * 32 + 16, 64);
      g.lineTo(k * 32 + 16 + 64, 0);
      g.lineTo(k * 32 + 64, 0);
      g.closePath();
      g.fill();
    }
    const t = canvasTexture(c);
    t.repeat.set(1 / 0.24, 1 / 0.24); // one stripe pair every 0.12 m
    return t;
  });
}

/** Normal map with sinusoidal ribs along U (vertical) or V (horizontal). */
function ribTexture(key: string, horizontal: boolean, period: number, sharp: number): THREE.Texture | null {
  return tex(key, () => {
    const cv = canvas(64, 64);
    if (!cv) return null;
    const [c, g] = cv;
    const img = g.createImageData(64, 64);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const s = horizontal ? y : x;
        const ph = (s / 64) * Math.PI * 2 * 2; // two ribs per tile
        let d = Math.cos(ph);
        d = Math.sign(d) * Math.pow(Math.abs(d), sharp);
        const nx = horizontal ? 0 : d * 0.55;
        const ny = horizontal ? d * 0.55 : 0;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const i = (y * 64 + x) * 4;
        img.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
        img.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        img.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    const t = canvasTexture(c, false);
    t.repeat.set(1 / period, 1 / period);
    return t;
  });
}

function solarTexture(): THREE.Texture | null {
  return tex('solar', () => {
    const cv = canvas(128, 128);
    if (!cv) return null;
    const [c, g] = cv;
    g.fillStyle = '#1d2f55';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const grd = g.createLinearGradient(x * 32, y * 32, x * 32 + 32, y * 32 + 32);
        grd.addColorStop(0, '#2c4a86');
        grd.addColorStop(1, '#1f3768');
        g.fillStyle = grd;
        g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
      }
    g.fillStyle = 'rgba(200,215,240,0.35)';
    for (let k = 0; k < 4; k++) g.fillRect(k * 32 + 15, 0, 1, 128);
    const t = canvasTexture(c);
    t.repeat.set(1 / 0.5, 1 / 0.5);
    return t;
  });
}

function wireTexture(): THREE.Texture | null {
  return tex('wire', () => {
    const cv = canvas(64, 64);
    if (!cv) return null;
    const [c, g] = cv;
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    g.beginPath();
    for (let k = 0; k <= 64; k += 16) {
      g.moveTo(k, 0);
      g.lineTo(k, 64);
      g.moveTo(0, k);
      g.lineTo(64, k);
    }
    g.stroke();
    const t = canvasTexture(c, true);
    t.repeat.set(1 / 0.2, 1 / 0.2);
    return t;
  });
}

/** Radial falloff used for contact shadows (alpha) and light pools. */
export function radialTexture(): THREE.Texture | null {
  return tex('radial', () => {
    const cv = canvas(128, 128);
    if (!cv) return null;
    const [c, g] = cv;
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 63);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = canvasTexture(c, false, false);
    return t;
  });
}

/** Square soft-edged rectangle falloff for machine/vehicle footprints. */
function rectShadowTexture(): THREE.Texture | null {
  return tex('rectShadow', () => {
    const cv = canvas(128, 128);
    if (!cv) return null;
    const [c, g] = cv;
    g.clearRect(0, 0, 128, 128);
    g.filter = 'blur(10px)';
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(22, 22, 84, 84, 18);
    g.fill();
    g.filter = 'none';
    return canvasTexture(c, false, false);
  });
}

const std = (o: THREE.MeshStandardMaterialParameters & { name: string }) =>
  new THREE.MeshStandardMaterial({ vertexColors: true, ...o });

function create(key: MatKey): THREE.Material {
  switch (key) {
    case 'paint':
      return std({ name: 'paint', roughness: 0.82, metalness: 0 });
    case 'satin':
      return std({ name: 'satin', roughness: 0.46, metalness: 0.02 });
    case 'metal':
      return std({ name: 'metal', roughness: 0.34, metalness: 0.85 });
    case 'brick':
      return std({ name: 'brick', roughness: 0.9, metalness: 0, map: brickTexture() });
    case 'concrete':
      return std({ name: 'concrete', roughness: 0.92, metalness: 0, map: concreteTexture() });
    case 'ribbed': {
      const n = ribTexture('ribV', false, 0.36, 0.6);
      return std({ name: 'ribbed', roughness: 0.55, metalness: 0.35, normalMap: n, normalScale: new THREE.Vector2(0.9, 0.9) });
    }
    case 'slats': {
      const n = ribTexture('ribH', true, 0.22, 0.35);
      return std({ name: 'slats', roughness: 0.5, metalness: 0.4, normalMap: n, normalScale: new THREE.Vector2(1, 1) });
    }
    case 'tiles': {
      const n = ribTexture('ribTiles', false, 0.28, 0.25);
      return std({ name: 'tiles', roughness: 0.78, metalness: 0, normalMap: n, normalScale: new THREE.Vector2(1.1, 1.1) });
    }
    case 'wood':
      return std({ name: 'wood', roughness: 0.72, metalness: 0, map: woodTexture() });
    case 'hazard':
      return std({ name: 'hazard', roughness: 0.6, metalness: 0, map: hazardTexture() });
    case 'glass':
      return std({ name: 'glass', color: 0xffffff, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.2 });
    case 'glassLit':
      return std({ name: 'glassLit', roughness: 0.1, metalness: 0.55, emissive: new THREE.Color(PAL.glow), emissiveIntensity: 0 });
    case 'glassClear':
      return new THREE.MeshStandardMaterial({
        name: 'glassClear',
        color: 0xcfe6ee,
        roughness: 0.05,
        metalness: 0.1,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    case 'lamp':
    case 'lampCool':
    case 'tail':
    case 'screen': {
      // one shared emissive material; the glow colour comes from the vertex colour (see GLOW_TINT)
      const m = std({ name: 'glow', roughness: 0.3, metalness: 0, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.45 });
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor;');
      };
      m.customProgramCacheKey = () => 'glowVC';
      return m;
    }
    case 'solar':
      return std({ name: 'solar', roughness: 0.18, metalness: 0.5, map: solarTexture() });
    case 'wire':
      return new THREE.MeshStandardMaterial({
        name: 'wire',
        color: 0x8d969d,
        roughness: 0.4,
        metalness: 0.7,
        alphaMap: wireTexture(),
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      });
    case 'foliage':
      return std({ name: 'foliage', roughness: 0.88, metalness: 0 });
    case 'contact':
      return new THREE.MeshBasicMaterial({
        name: 'contact',
        color: 0x141821,
        alphaMap: rectShadowTexture(),
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    case 'lightPool':
      return new THREE.MeshBasicMaterial({
        name: 'lightPool',
        color: 0xffc070,
        alphaMap: radialTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
  }
}

/** Default vertex tint for the emissive aliases (used when a part is coloured 0xffffff). */
export const GLOW_TINT: Partial<Record<MatKey, number>> = { lamp: 0xffd08a, lampCool: 0xe8f3ff, tail: 0xff3a24, screen: 0x58e0ff };

export function mat(key: MatKey): THREE.Material {
  if (key === 'lampCool' || key === 'tail' || key === 'screen') key = 'lamp';
  let m = mats.get(key);
  if (!m) {
    m = create(key);
    m.userData.shared = true;
    mats.set(key, m);
  }
  return m;
}

/** Round contact-shadow material (for characters, trees, poles). */
export function contactRoundMat(): THREE.Material {
  let m = mats.get('contactRound');
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      name: 'contactRound',
      color: 0x141821,
      alphaMap: radialTexture(),
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    m.userData.shared = true;
    mats.set('contactRound', m);
  }
  return m;
}

/**
 * Global night level → emissive intensities of shared lamp/window materials. Idempotent and cheap;
 * every model's update() calls it with AnimState.night so the integration doesn't have to.
 */
export function setNightLevel(n: number): void {
  if (Math.abs(n - nightLevel) < 1e-3) return;
  nightLevel = n;
  const k = n * n * (3 - 2 * n); // smoothstep
  const gl = mats.get('glassLit') as THREE.MeshStandardMaterial | undefined;
  if (gl) gl.emissiveIntensity = 1.35 * k;
  const lamp = mats.get('lamp') as THREE.MeshStandardMaterial | undefined;
  if (lamp) lamp.emissiveIntensity = 0.45 + 2.2 * k;
  const pool = mats.get('lightPool') as THREE.MeshBasicMaterial | undefined;
  if (pool) pool.opacity = 0.55 * k;
  for (const [key, m] of mats) if (key.startsWith('sign:')) (m as THREE.MeshStandardMaterial).emissiveIntensity = (m.userData.dayGlow ?? 0) + (m.userData.nightGlow ?? 1.2) * k;
}

export interface SignSpec {
  text: string;
  sub?: string;
  bg: string;
  fg: string;
  accent?: string;
  /** canvas px; aspect should match the sign mesh */
  w: number;
  h: number;
  icon?: 'robot' | 'gear' | 'bus' | 'lock' | 'bolt' | 'toy' | 'truck';
  /** emissive glow at night (0 = unlit). */
  nightGlow?: number;
  dayGlow?: number;
  style?: 'painted' | 'panel' | 'neon';
}

function drawIcon(g: CanvasRenderingContext2D, icon: NonNullable<SignSpec['icon']>, cx: number, cy: number, s: number, fg: string, accent: string): void {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = fg;
  g.strokeStyle = fg;
  g.lineWidth = s * 0.08;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  switch (icon) {
    case 'robot': {
      g.beginPath();
      g.roundRect(-s * 0.36, -s * 0.22, s * 0.72, s * 0.56, s * 0.12);
      g.fill();
      g.beginPath();
      g.moveTo(0, -s * 0.22);
      g.lineTo(0, -s * 0.38);
      g.stroke();
      g.beginPath();
      g.arc(0, -s * 0.42, s * 0.06, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(-s * 0.15, 0.02 * s, s * 0.08, 0, Math.PI * 2);
      g.arc(s * 0.15, 0.02 * s, s * 0.08, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-s * 0.14, s * 0.17, s * 0.28, s * 0.05);
      break;
    }
    case 'gear': {
      const n = 8;
      g.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const r = i % 2 ? s * 0.32 : s * 0.42;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(0, 0, s * 0.14, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'bus': {
      g.beginPath();
      g.roundRect(-s * 0.32, -s * 0.36, s * 0.64, s * 0.62, s * 0.1);
      g.fill();
      g.fillStyle = accent;
      g.fillRect(-s * 0.25, -s * 0.28, s * 0.5, s * 0.24);
      g.beginPath();
      g.arc(-s * 0.18, s * 0.3, s * 0.07, 0, Math.PI * 2);
      g.arc(s * 0.18, s * 0.3, s * 0.07, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'lock': {
      g.beginPath();
      g.roundRect(-s * 0.3, -s * 0.05, s * 0.6, s * 0.45, s * 0.08);
      g.fill();
      g.lineWidth = s * 0.1;
      g.beginPath();
      g.arc(0, -s * 0.08, s * 0.2, Math.PI, 0);
      g.stroke();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(0, s * 0.14, s * 0.06, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'bolt': {
      g.beginPath();
      g.moveTo(s * 0.08, -s * 0.45);
      g.lineTo(-s * 0.26, s * 0.06);
      g.lineTo(-s * 0.02, s * 0.06);
      g.lineTo(-s * 0.1, s * 0.45);
      g.lineTo(s * 0.26, -s * 0.08);
      g.lineTo(s * 0.02, -s * 0.08);
      g.closePath();
      g.fill();
      break;
    }
    case 'toy': {
      // stacked blocks
      g.fillStyle = '#e8473f';
      g.fillRect(-s * 0.36, s * 0.02, s * 0.34, s * 0.34);
      g.fillStyle = '#3f7fc8';
      g.fillRect(s * 0.02, s * 0.02, s * 0.34, s * 0.34);
      g.fillStyle = '#f2bb2c';
      g.fillRect(-s * 0.17, -s * 0.34, s * 0.34, s * 0.34);
      break;
    }
    case 'truck': {
      g.beginPath();
      g.roundRect(-s * 0.42, -s * 0.24, s * 0.52, s * 0.4, s * 0.04);
      g.roundRect(s * 0.12, -s * 0.1, s * 0.28, s * 0.26, s * 0.06);
      g.fill();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(-s * 0.24, s * 0.22, s * 0.08, 0, Math.PI * 2);
      g.arc(s * 0.24, s * 0.22, s * 0.08, 0, Math.PI * 2);
      g.fill();
      break;
    }
  }
  g.restore();
}

const SIGN_FONT = "'Rubik', 'Arial Rounded MT Bold', 'Helvetica Neue', 'DejaVu Sans', Arial, sans-serif";

/** Shared sign material (cached by key). Text is drawn once into a CanvasTexture. */
export function signMat(key: string, spec: SignSpec): THREE.Material {
  const k = 'sign:' + key;
  let m = mats.get(k);
  if (m) return m;
  const cv = canvas(spec.w, spec.h);
  let map: THREE.Texture | null = null;
  if (cv) {
    const [c, g] = cv;
    const { w, h } = spec;
    g.fillStyle = spec.bg;
    g.fillRect(0, 0, w, h);
    if (spec.style !== 'neon') {
      g.strokeStyle = spec.accent ?? spec.fg;
      g.lineWidth = Math.max(4, h * 0.05);
      g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
    }
    let tx = w / 2;
    if (spec.icon) {
      const s = h * 0.62;
      drawIcon(g, spec.icon, h * 0.55, h / 2, s, spec.fg, spec.accent ?? spec.bg);
      tx = h * 0.55 + (w - h * 0.55) / 2;
    }
    g.fillStyle = spec.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const avail = w - (spec.icon ? h * 1.1 : h * 0.3);
    let size = spec.sub ? h * 0.42 : h * 0.56;
    g.font = `800 ${size}px ${SIGN_FONT}`;
    const mw = g.measureText(spec.text).width;
    if (mw > avail) {
      size *= avail / mw;
      g.font = `800 ${size}px ${SIGN_FONT}`;
    }
    g.fillText(spec.text, tx, spec.sub ? h * 0.4 : h * 0.53);
    if (spec.sub) {
      g.font = `600 ${h * 0.2}px ${SIGN_FONT}`;
      g.fillStyle = spec.accent ?? spec.fg;
      g.fillText(spec.sub, tx, h * 0.76);
    }
    map = canvasTexture(c, true, false);
  }
  const glow = spec.nightGlow ?? 0;
  m = new THREE.MeshStandardMaterial({
    name: k,
    map,
    roughness: 0.6,
    metalness: 0,
    emissive: glow > 0 ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
    emissiveMap: glow > 0 ? map : null,
    emissiveIntensity: spec.dayGlow ?? 0,
  });
  m.userData.shared = true;
  m.userData.nightGlow = glow;
  m.userData.dayGlow = spec.dayGlow ?? 0;
  mats.set(k, m);
  if (nightLevel >= 0) {
    const n = nightLevel;
    nightLevel = -1;
    setNightLevel(n);
  }
  return m;
}

/** Livery atlas for vehicles: 4 rows, each a side decal (stripe + logo). */
export function liveryMat(): THREE.Material {
  let m = mats.get('livery');
  if (m) return m;
  const cv = canvas(512, 512);
  let map: THREE.Texture | null = null;
  if (cv) {
    const [c, g] = cv;
    const rows: { bg: string; stripe: string; fg: string; text: string; icon: NonNullable<SignSpec['icon']> }[] = [
      { bg: '#f5f3ee', stripe: '#2e7c78', fg: '#1f5654', text: 'TOY WORKS', icon: 'robot' },
      { bg: '#d8453c', stripe: '#f5f3ee', fg: '#ffffff', text: 'EXPRESS', icon: 'truck' },
      { bg: '#f2bb2c', stripe: '#26272b', fg: '#26272b', text: 'PARTS CO', icon: 'gear' },
      { bg: '#3f7fc8', stripe: '#f5f3ee', fg: '#ffffff', text: 'CITY FREIGHT', icon: 'truck' },
    ];
    rows.forEach((r, i) => {
      const y0 = i * 128;
      g.fillStyle = r.bg;
      g.fillRect(0, y0, 512, 128);
      g.fillStyle = r.stripe;
      g.fillRect(0, y0 + 92, 512, 16);
      g.beginPath();
      g.moveTo(330, y0 + 128);
      g.lineTo(420, y0 + 0);
      g.lineTo(460, y0 + 0);
      g.lineTo(370, y0 + 128);
      g.fill();
      drawIcon(g, r.icon, 52, y0 + 50, 70, r.fg, r.bg);
      g.fillStyle = r.fg;
      g.font = `800 40px ${SIGN_FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(r.text, 100, y0 + 52, 220);
    });
    map = canvasTexture(c, true, false);
  }
  m = new THREE.MeshStandardMaterial({ name: 'livery', map, roughness: 0.42, metalness: 0.05 });
  m.userData.shared = true;
  mats.set('livery', m);
  return m;
}

export const LIVERY_BG = [PAL.white, PAL.red, PAL.yellow, PAL.blue] as const;

/** Count of distinct shared materials created so far (gallery stats). */
export function sharedMaterialCount(): number {
  return mats.size;
}

export function disposeMaterialLibrary(): void {
  for (const m of mats.values()) m.dispose();
  for (const t of textures.values()) t.dispose();
  mats.clear();
  textures.clear();
  nightLevel = -1;
}
