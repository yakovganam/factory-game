/**
 * UI item icons rendered from the real 3D item visuals (one shared renderer, small render
 * target, cached data URLs) so screen-space UI and the world always match.
 */
import * as THREE from 'three';
import { getItemVisual } from './models';

export class IconRenderer {
  private cache = new Map<string, string>();
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  private target: THREE.WebGLRenderTarget;
  private size = 96;
  private canvas = document.createElement('canvas');
  private mesh: THREE.Mesh | null = null;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.target = new THREE.WebGLRenderTarget(this.size, this.size, { samples: 4 });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.canvas.width = this.canvas.height = this.size;
    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8a9aa6, 2.2));
    const d = new THREE.DirectionalLight(0xffffff, 2.2);
    d.position.set(1.5, 2.5, 2);
    this.scene.add(d);
  }

  get(item: string): string {
    const c = this.cache.get(item);
    if (c) return c;
    let url = '';
    try {
      url = this.render(item);
    } catch {
      url = '';
    }
    this.cache.set(item, url);
    return url;
  }

  private render(item: string): string {
    const vis = getItemVisual(item);
    if (this.mesh) this.scene.remove(this.mesh);
    this.mesh = new THREE.Mesh(vis.geometry, vis.material);
    this.scene.add(this.mesh);
    vis.geometry.computeBoundingSphere();
    const bs = vis.geometry.boundingSphere!;
    const r = Math.max(0.05, bs.radius);
    this.cam.position.set(bs.center.x + r * 2.2, bs.center.y + r * 2.0, bs.center.z + r * 2.6);
    this.cam.lookAt(bs.center);
    const prevTarget = this.renderer.getRenderTarget();
    const prevClear = this.renderer.getClearAlpha();
    const prevColor = new THREE.Color();
    this.renderer.getClearColor(prevColor);
    const prevShadow = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.cam);
    const buf = new Uint8Array(this.size * this.size * 4);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, this.size, this.size, buf);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearColor(prevColor, prevClear);
    this.renderer.shadowMap.enabled = prevShadow;
    const ctx = this.canvas.getContext('2d')!;
    const img = ctx.createImageData(this.size, this.size);
    // Flip vertically (GL origin is bottom-left).
    for (let y = 0; y < this.size; y++) img.data.set(buf.subarray((this.size - 1 - y) * this.size * 4, (this.size - y) * this.size * 4), y * this.size * 4);
    ctx.putImageData(img, 0, 0);
    return this.canvas.toDataURL('image/png');
  }
}
