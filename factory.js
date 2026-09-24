/**
 * FactoryScene — процедурная 3D-модель промышленного комплекса на Three.js.
 * Единый модуль: сцена + процедурные текстуры + коллизии + FPS-режим.
 *
 * Управление:
 *   Orbit-режим  — ЛКМ/ПКМ вращение, колесо — зум, камера не проходит сквозь стены.
 *   FPS-режим    — Tab (или F), WASD/стрелки, мышь — обзор, Space — прыжок.
 */

import * as THREE from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const cv = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  // Контекст создаётся сразу с willReadFrequently — все последующие
  // getContext('2d') вернут этот же контекст (спецификация игнорирует
  // повторные опции). Убирает предупреждения при частых getImageData().
  c.getContext('2d', { willReadFrequently: true });
  return c;
};

/* ============================================================================
   COLLISION SYSTEM — AABB + вертикальные цилиндры + рейкасты
   ============================================================================ */
class CollisionSystem {
  constructor() {
    this.boxes = [];
    this.cylinders = [];
    this._tmp = new THREE.Vector3();
  }
  addBox(box) { if (!box.isEmpty()) this.boxes.push(box.clone()); }
  addBoxFromObject(obj, padding = 0) {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj);
    if (padding) box.expandByScalar(padding);
    if (!box.isEmpty()) this.boxes.push(box);
    return box;
  }
  addBoxFromSize(cx, cy, cz, sx, sy, sz) {
    this.boxes.push(new THREE.Box3(
      new THREE.Vector3(cx - sx/2, cy - sy/2, cz - sz/2),
      new THREE.Vector3(cx + sx/2, cy + sy/2, cz + sz/2)
    ));
  }
  addCylinder(cx, cz, r, y0, y1) { this.cylinders.push({ x: cx, z: cz, r, y0, y1 }); }

  resolveSphere(pos, radius, out = new THREE.Vector3()) {
    out.copy(pos);
    for (const box of this.boxes) {
      const cx = Math.max(box.min.x, Math.min(out.x, box.max.x));
      const cy = Math.max(box.min.y, Math.min(out.y, box.max.y));
      const cz = Math.max(box.min.z, Math.min(out.z, box.max.z));
      const dx = out.x - cx, dy = out.y - cy, dz = out.z - cz;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 >= radius*radius) continue;
      const dist = Math.sqrt(d2);
      if (dist > 1e-5) {
        const push = (radius - dist) / dist;
        out.x += dx * push; out.y += dy * push; out.z += dz * push;
      } else {
        const dxMin = out.x - box.min.x, dxMax = box.max.x - out.x;
        const dyMin = out.y - box.min.y, dyMax = box.max.y - out.y;
        const dzMin = out.z - box.min.z, dzMax = box.max.z - out.z;
        const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
        if      (m === dxMin) out.x = box.min.x - radius;
        else if (m === dxMax) out.x = box.max.x + radius;
        else if (m === dyMin) out.y = box.min.y - radius;
        else if (m === dyMax) out.y = box.max.y + radius;
        else if (m === dzMin) out.z = box.min.z - radius;
        else                  out.z = box.max.z + radius;
      }
    }
    for (const c of this.cylinders) {
      if (out.y + radius < c.y0 || out.y - radius > c.y1) continue;
      const dx = out.x - c.x, dz = out.z - c.z;
      const d2 = dx*dx + dz*dz;
      const rr = c.r + radius;
      if (d2 >= rr*rr) continue;
      const dist = Math.sqrt(d2) || 1e-5;
      const push = (rr - dist) / dist;
      out.x += dx * push; out.z += dz * push;
    }
    return out;
  }

  isFree(pos, radius) {
    for (const box of this.boxes) {
      const cx = Math.max(box.min.x, Math.min(pos.x, box.max.x));
      const cy = Math.max(box.min.y, Math.min(pos.y, box.max.y));
      const cz = Math.max(box.min.z, Math.min(pos.z, box.max.z));
      const dx = pos.x - cx, dy = pos.y - cy, dz = pos.z - cz;
      if (dx*dx + dy*dy + dz*dz < radius*radius - 1e-4) return false;
    }
    for (const c of this.cylinders) {
      if (pos.y + radius < c.y0 || pos.y - radius > c.y1) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const rr = c.r + radius;
      if (dx*dx + dz*dz < rr*rr - 1e-4) return false;
    }
    return true;
  }

  /** Рейкаст "вниз" — возвращает ближайшую высоту пола под точкой. */
  floorHeightAt(x, z, fromY = 100, belowY = -10) {
    const origin = V3(x, fromY, z);
    const dir = V3(0, -1, 0);
    const maxDist = fromY - belowY;
    let best = 0;
    for (const box of this.boxes) {
      if (x < box.min.x - 0.01 || x > box.max.x + 0.01) continue;
      if (z < box.min.z - 0.01 || z > box.max.z + 0.01) continue;
      const top = box.max.y;
      if (top < belowY || top > fromY) continue;
      if (top > best) best = top;
    }
    return best;
  }

  /** Горизонтальный рейкаст до ближайшего препятствия. */
  raycast(origin, dir, maxDist = Infinity) {
    let best = maxDist;
    for (const box of this.boxes) {
      if (box.containsPoint(origin)) continue;
      const t = this._rayBox(origin, dir, box);
      if (t !== null && t >= 0 && t < best) best = t;
    }
    const ax = dir.x*dir.x + dir.z*dir.z;
    if (ax > 1e-8) {
      for (const c of this.cylinders) {
        const ox = origin.x - c.x, oz = origin.z - c.z;
        const b  = 2 * (ox*dir.x + oz*dir.z);
        const cc = ox*ox + oz*oz - c.r*c.r;
        const disc = b*b - 4*ax*cc;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        const t1 = (-b - sq) / (2*ax);
        const t2 = (-b + sq) / (2*ax);
        let t = t1 >= 0 ? t1 : t2;
        if (t < 0 || t >= best) continue;
        const hy = origin.y + dir.y * t;
        if (hy < c.y0 || hy > c.y1) continue;
        best = t;
      }
    }
    return best;
  }

  _rayBox(origin, dir, box) {
    let tmin = -Infinity, tmax = Infinity;
    for (const a of ['x','y','z']) {
      const o = origin[a], d = dir[a];
      const mn = box.min[a], mx = box.max[a];
      if (Math.abs(d) < 1e-8) {
        if (o < mn || o > mx) return null;
      } else {
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    if (tmax < 0) return null;
    return tmin >= 0 ? tmin : tmax;
  }
  clear() { this.boxes.length = 0; this.cylinders.length = 0; }
}

/* ============================================================================
   FACTORY SCENE
   ============================================================================ */
export class FactoryScene {
  constructor(container, options = {}) {
    if (!container) throw new Error('FactoryScene: container required');

    this.container = container;
    this.options = Object.assign({
      exposure: 0.95,
      bloom: { strength: 0.5, radius: 0.7, threshold: 0.85 },
      shadows: true,
      pixelRatioCap: 2,
      startInWalkMode: false
    }, options);

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.style.overflow = 'hidden';

    this._raf = 0;
    this._clock = new THREE.Clock();
    this._elapsed = 0;
    this._resizeObs = null;
    this._plumes = [];
    this._chimneys = [];
    this._disposables = [];
    this._colliders = new CollisionSystem();
    this._walkMode = false;
    this._keys = Object.create(null);
    this._tmp1 = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();

    this._initRenderer();
    this._initTextures();
    this._initScene();
    this._initLights();
    this._initCamera();
    this._initPostProcessing();

    this._buildWorld();
    this._registerColliders();

    this._attachEvents();
    this._startLoop();

    if (this.options.startInWalkMode) {
      requestAnimationFrame(() => this.setWalkMode(true));
    }
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.options.pixelRatioCap));
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  dispose() {
    if (this._walkMode) this.setWalkMode(false);
    cancelAnimationFrame(this._raf);
    if (this._resizeObs) this._resizeObs.disconnect();
    window.removeEventListener('resize', this._onWindowResize);
    window.removeEventListener('keydown', this._onKeyToggle);
    this.controls?.dispose();
    this.renderer?.dispose();
    this.composer?.dispose?.();
    for (const d of this._disposables) {
      d.geometry?.dispose?.();
      if (Array.isArray(d.material)) d.material.forEach(m => this._disposeMaterial(m));
      else this._disposeMaterial(d.material);
    }
    for (const t of (this._textures || [])) t.dispose?.();
    for (const t of (this._envTex || [])) t.dispose?.();
    if (this.renderer?.domElement?.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }

  _disposeMaterial(m) {
    if (!m) return;
    for (const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap']) {
      m[k]?.dispose?.();
    }
    m.dispose?.();
  }

  /* ================================================================
     RENDERER / ТЕКСТУРЫ
     ================================================================ */
  _initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.options.pixelRatioCap));
    r.setSize(this.container.clientWidth, this.container.clientHeight, false);
    r.shadowMap.enabled = !!this.options.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = this.options.exposure;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.style.display = 'block';
    this.container.appendChild(r.domElement);
    this.renderer = r;
  }

  _initTextures() {
    this._textures = [];
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    const asColor = (canvas, wrap = true) => {
      const t = new THREE.CanvasTexture(canvas);
      if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = maxAniso;
      this._textures.push(t);
      return t;
    };
    const asData = (canvas, wrap = true) => {
      const t = new THREE.CanvasTexture(canvas);
      if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = maxAniso;
      this._textures.push(t);
      return t;
    };
    const normalFromHeight = (src, strength = 2.2) => {
      const w = src.width, h = src.height;
      const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
      const out = cv(w, h), octx = out.getContext('2d');
      const img = octx.createImageData(w, h), od = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y*w + x)*4;
        const l = (y*w + ((x-1+w)%w))*4, r = (y*w + ((x+1)%w))*4;
        const u = (((y-1+h)%h)*w + x)*4, d = (((y+1)%h)*w + x)*4;
        const dx = (sd[l] - sd[r])/255 * strength;
        const dy = (sd[u] - sd[d])/255 * strength;
        const len = Math.hypot(dx, dy, 1);
        od[i] = ((dx/len)*0.5 + 0.5)*255;
        od[i+1] = ((dy/len)*0.5 + 0.5)*255;
        od[i+2] = ((1/len)*0.5 + 0.5)*255;
        od[i+3] = 255;
      }
      octx.putImageData(img, 0, 0);
      return asData(out);
    };
    const addNoise = (ctx, w, h, a) => {
      const img = ctx.getImageData(0,0,w,h), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 255 * a;
        d[i] = Math.min(255, Math.max(0, d[i] + n));
        d[i+1] = Math.min(255, Math.max(0, d[i+1] + n));
        d[i+2] = Math.min(255, Math.max(0, d[i+2] + n));
      }
      ctx.putImageData(img, 0, 0);
    };

    /* ---- BRICK ---- */
    const brickC = cv(512, 512);
    {
      const ctx = brickC.getContext('2d');
      ctx.fillStyle = '#6b6660'; ctx.fillRect(0,0,512,512);
      const rows = 22, bh = 512/rows, cols = 9, bw = 512/cols;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) ? bw/2 : 0;
        for (let c = -1; c <= cols; c++) {
          const x = c*bw + off, y = r*bh, v = 0.68 + Math.random()*0.45;
          ctx.fillStyle = `rgb(${Math.round(122*v)},${Math.round(60*v)},${Math.round(48*v)})`;
          ctx.fillRect(x+2, y+2, bw-4, bh-4);
          if (Math.random() < 0.35) {
            ctx.fillStyle = `rgba(40,32,26,${0.08 + Math.random()*0.15})`;
            ctx.fillRect(x+2, y+2, bw-4, bh-4);
          }
        }
      }
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(40,34,28,${0.02 + Math.random()*0.06})`;
        ctx.fillRect(Math.random()*512, Math.random()*512, 8 + Math.random()*60, 2 + Math.random()*10);
      }
      addNoise(ctx, 512, 512, 0.11);
    }
    const brickTex = asColor(brickC);
    const brickNrm = normalFromHeight(brickC, 2.8);

    /* ---- CONCRETE ---- */
    const concreteC = cv(512, 512);
    {
      const ctx = concreteC.getContext('2d');
      ctx.fillStyle = '#a8a59e'; ctx.fillRect(0,0,512,512);
      for (let i = 0; i < 320; i++) {
        const x = Math.random()*512, y = Math.random()*512, r = 8 + Math.random()*70;
        const g = ctx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0, Math.random() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(50,50,50,0.07)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(75,73,70,0.55)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(256,0); ctx.lineTo(256,512); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,256); ctx.lineTo(512,256); ctx.stroke();
      for (const [x,y] of [[40,40],[472,40],[40,472],[472,472],[256,256]]) {
        ctx.fillStyle = 'rgba(60,58,55,0.6)';
        ctx.beginPath(); ctx.arc(x,y,4,0,7); ctx.fill();
      }
      addNoise(ctx, 512, 512, 0.09);
    }
    const concreteTex = asColor(concreteC);
    const concreteNrm = normalFromHeight(concreteC, 1.5);

    /* ---- CORRUGATED ---- */
    const corrC = cv(512, 512);
    {
      const ctx = corrC.getContext('2d');
      const n = 16, sw = 512/n;
      for (let i = 0; i < n; i++) {
        const g = ctx.createLinearGradient(i*sw, 0, (i+1)*sw, 0);
        g.addColorStop(0,    '#75808a');
        g.addColorStop(0.28, '#cbd3da');
        g.addColorStop(0.52, '#a3abb2');
        g.addColorStop(0.78, '#8b939a');
        g.addColorStop(1,    '#6d7780');
        ctx.fillStyle = g; ctx.fillRect(i*sw, 0, sw, 512);
      }
      for (let i = 0; i < 90; i++) {
        const x = Math.random()*512, y = Math.random()*512, r = 2 + Math.random()*16;
        const g = ctx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0, `rgba(122,58,26,${0.15 + Math.random()*0.35})`);
        g.addColorStop(1, 'rgba(122,58,26,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(50,56,62,0.55)'; ctx.lineWidth = 2;
      for (let y = 0; y < 512; y += 128) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
      }
      addNoise(ctx, 512, 512, 0.07);
    }
    const corrTex = asColor(corrC);
    const corrNrm = normalFromHeight(corrC, 3.2);

    /* ---- ASPHALT ---- */
    const asphaltC = cv(512, 512);
    {
      const ctx = asphaltC.getContext('2d');
      ctx.fillStyle = '#38393d'; ctx.fillRect(0,0,512,512);
      for (let i = 0; i < 12000; i++) {
        const v = Math.random();
        ctx.fillStyle = v < 0.5
          ? `rgba(18,18,20,${0.12 + Math.random()*0.35})`
          : `rgba(160,160,166,${0.03 + Math.random()*0.14})`;
        ctx.fillRect(Math.random()*512, Math.random()*512, 1 + Math.random()*3, 1 + Math.random()*3);
      }
      ctx.strokeStyle = 'rgba(12,12,14,0.55)'; ctx.lineWidth = 1.3;
      for (let i = 0; i < 20; i++) {
        ctx.beginPath();
        let x = Math.random()*512, y = Math.random()*512;
        ctx.moveTo(x, y);
        for (let j = 0; j < 8; j++) {
          x += (Math.random()-0.5)*70; y += (Math.random()-0.5)*70; ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
      addNoise(ctx, 512, 512, 0.06);
    }
    const asphaltTex = asColor(asphaltC);
    const asphaltNrm = normalFromHeight(asphaltC, 0.9);

    /* ---- DIRT ---- */
    const dirtC = cv(512, 512);
    {
      const ctx = dirtC.getContext('2d');
      ctx.fillStyle = '#67624f'; ctx.fillRect(0,0,512,512);
      for (let i = 0; i < 520; i++) {
        const x = Math.random()*512, y = Math.random()*512, r = 10 + Math.random()*65;
        const g = ctx.createRadialGradient(x,y,0,x,y,r);
        const c = Math.random();
        g.addColorStop(0, c < 0.34 ? 'rgba(86,96,58,0.32)' : c < 0.68 ? 'rgba(118,106,84,0.28)' : 'rgba(66,62,54,0.28)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
      }
      addNoise(ctx, 512, 512, 0.14);
    }
    const dirtTex = asColor(dirtC);
    const dirtNrm = normalFromHeight(dirtC, 1.2);

    /* ---- RUST ---- */
    const rustC = cv(256, 256);
    {
      const ctx = rustC.getContext('2d');
      ctx.fillStyle = '#7a4426'; ctx.fillRect(0,0,256,256);
      for (let i = 0; i < 400; i++) {
        const x = Math.random()*256, y = Math.random()*256, r = 3 + Math.random()*30;
        const g = ctx.createRadialGradient(x,y,0,x,y,r);
        const c = Math.random();
        g.addColorStop(0, c < 0.5
          ? `rgba(${120+Math.random()*80|0},${50+Math.random()*40|0},20,0.5)`
          : 'rgba(60,30,15,0.45)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
      }
      addNoise(ctx, 256, 256, 0.15);
    }
    const rustTex = asColor(rustC);
    const rustNrm = normalFromHeight(rustC, 1.8);

    /* ---- CHIMNEY ---- */
    const chimneyC = cv(256, 1024);
    {
      const ctx = chimneyC.getContext('2d');
      ctx.fillStyle = '#b0ada8'; ctx.fillRect(0,0,256,1024);
      for (let i = 0; i < 240; i++) {
        const x = Math.random()*256, y = Math.random()*1024, r = 4 + Math.random()*42;
        const g = ctx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0, Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(70,70,70,0.08)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
      }
      for (let i = 0; i < 60; i++) {
        const x = Math.random()*256, y1 = 100 + Math.random()*500;
        const g = ctx.createLinearGradient(0, 0, 0, y1);
        g.addColorStop(0, `rgba(30,28,26,${0.15 + Math.random()*0.4})`);
        g.addColorStop(1, 'rgba(30,28,26,0)');
        ctx.fillStyle = g; ctx.fillRect(x, 0, 2 + Math.random()*6, y1);
      }
      const bh = 1024*0.20/4;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#b0342a' : '#e7e2d8';
        ctx.fillRect(0, i*bh, 256, bh);
      }
      addNoise(ctx, 256, 1024, 0.08);
    }
    const chimneyTex = asColor(chimneyC);
    const chimneyNrm = normalFromHeight(chimneyC, 1.0);

    /* ---- FENCE ---- */
    const fenceC = cv(256, 256);
    {
      const ctx = fenceC.getContext('2d');
      ctx.clearRect(0,0,256,256);
      ctx.lineWidth = 3; ctx.strokeStyle = '#aab1b8';
      const step = 16;
      for (let i = -256; i < 512; i += step) {
        ctx.beginPath(); ctx.moveTo(i, 0);   ctx.lineTo(i+256, 256); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, 256); ctx.lineTo(i+256, 0);   ctx.stroke();
      }
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(122,60,30,${0.15 + Math.random()*0.3})`;
        ctx.beginPath(); ctx.arc(Math.random()*256, Math.random()*256, 2 + Math.random()*8, 0, 7); ctx.fill();
      }
    }
    const fenceTex = asColor(fenceC);

    /* ---- METAL PANEL (для стен склада/офиса) ---- */
    const metalPanelC = cv(512, 512);
    {
      const ctx = metalPanelC.getContext('2d');
      const n = 24, sw = 512/n;
      for (let i = 0; i < n; i++) {
        const g = ctx.createLinearGradient(i*sw, 0, (i+1)*sw, 0);
        g.addColorStop(0, '#6e777f');
        g.addColorStop(0.5, '#b8c0c8');
        g.addColorStop(1, '#6e777f');
        ctx.fillStyle = g; ctx.fillRect(i*sw, 0, sw, 512);
      }
      ctx.strokeStyle = 'rgba(30,36,42,0.6)'; ctx.lineWidth = 2;
      for (let y = 0; y < 512; y += 128) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,44,50,0.7)';
      for (let y = 20; y < 512; y += 32)
        for (let x = 8; x < 512; x += sw)
          ctx.fillRect(x-1, y-1, 3, 3);
      addNoise(ctx, 512, 512, 0.05);
    }
    const metalPanelTex = asColor(metalPanelC);
    const metalPanelNrm = normalFromHeight(metalPanelC, 1.4);

    /* ---- SMOKE / DUST ---- */
    const smokeSprite = (() => {
      const s = 192, c = cv(s, s), ctx = c.getContext('2d');
      for (let i = 0; i < 14; i++) {
        const x = s/2 + (Math.random()-0.5)*70;
        const y = s/2 + (Math.random()-0.5)*70;
        const r = 18 + Math.random()*40;
        const g = ctx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,   'rgba(255,255,255,0.36)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.10)');
        g.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
      }
      const g2 = ctx.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
      g2.addColorStop(0, 'rgba(255,255,255,0.35)');
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2; ctx.fillRect(0,0,s,s);
      return asColor(c, false);
    })();
    const dustSprite = (() => {
      const s = 64, c = cv(s, s), ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
      g.addColorStop(0,   'rgba(255,255,255,0.9)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
      g.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,s,s);
      return asColor(c, false);
    })();

    /* ---- SIGN / PLACARD ---- */
    const signC = cv(512, 256);
    {
      const ctx = signC.getContext('2d');
      ctx.fillStyle = '#e8e4dc'; ctx.fillRect(0,0,512,256);
      ctx.strokeStyle = '#1c1f22'; ctx.lineWidth = 8;
      ctx.strokeRect(8, 8, 496, 240);
      ctx.fillStyle = '#1c1f22';
      ctx.font = 'bold 42px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ВНИМАНИЕ', 256, 92);
      ctx.font = 'bold 28px "Courier New", monospace';
      ctx.fillText('ОПАСНАЯ ЗОНА', 256, 142);
      ctx.font = 'bold 24px "Courier New", monospace';
      ctx.fillText('ПРОХОД ЗАПРЕЩЁН', 256, 190);
      ctx.fillStyle = '#c42a1a';
      ctx.font = 'bold 22px "Courier New", monospace';
      ctx.fillText('⚠  ГОСТ 12.1.005  ⚠', 256, 228);
      addNoise(ctx, 512, 256, 0.05);
    }
    const signTex = asColor(signC, false);

    this.tex = {
      brick:    { color: brickTex,    normal: brickNrm },
      concrete: { color: concreteTex, normal: concreteNrm },
      corr:     { color: corrTex,     normal: corrNrm },
      asphalt:  { color: asphaltTex,  normal: asphaltNrm },
      dirt:     { color: dirtTex,     normal: dirtNrm },
      rust:     { color: rustTex,     normal: rustNrm },
      chimney:  { color: chimneyTex,  normal: chimneyNrm },
      metalPanel: { color: metalPanelTex, normal: metalPanelNrm },
      fence: fenceTex, smoke: smokeSprite, dust: dustSprite, sign: signTex
    };
  }

  _initScene() {
    const scene = new THREE.Scene();
    const w = 2048, h = 1024, c = cv(w, h), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, '#0e2a56');
    g.addColorStop(0.28, '#3a6fa8');
    g.addColorStop(0.46, '#7fb0d6');
    g.addColorStop(0.52, '#c9dceb');
    g.addColorStop(0.56, '#e7eff5');
    g.addColorStop(0.62, '#c9c8c0');
    g.addColorStop(1.00, '#6d7580');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    const sx = w * 0.72, sy = h * 0.24;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 220);
    sg.addColorStop(0,    'rgba(255,245,220,0.98)');
    sg.addColorStop(0.15, 'rgba(255,235,190,0.55)');
    sg.addColorStop(0.5,  'rgba(255,220,160,0.12)');
    sg.addColorStop(1,    'rgba(255,220,160,0)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 320; i++) {
      const x = Math.random()*w, y = Math.random()*h*0.48, r = 25 + Math.random()*130;
      const a = 0.04 + Math.random()*0.2;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0,   `rgba(255,255,255,${a})`);
      grd.addColorStop(0.5, `rgba(240,242,245,${a*0.35})`);
      grd.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(x, y, r*1.8, r*0.55, 0, 0, Math.PI*2); ctx.fill();
    }
    const skyTex = new THREE.CanvasTexture(c);
    skyTex.mapping = THREE.EquirectangularReflectionMapping;
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this._envTex = [skyTex];

    scene.background = skyTex;
    scene.fog = new THREE.FogExp2(0xb2c4d6, 0.0018);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(skyTex).texture;
    pmrem.dispose();

    this.scene = scene;
  }

  _initLights() {
    this.scene.add(new THREE.HemisphereLight(0xcadfff, 0x4e463a, 0.55));
    const sun = new THREE.DirectionalLight(0xfff0d4, 3.0);
    sun.position.set(120, 165, 95);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 520;
    const SH = 210;
    sun.shadow.camera.left = -SH;
    sun.shadow.camera.right = SH;
    sun.shadow.camera.top = SH;
    sun.shadow.camera.bottom = -SH;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.32;
    this.scene.add(sun, sun.target);
    this._sun = sun;

    const fill = new THREE.DirectionalLight(0x8ab0e0, 0.35);
    fill.position.set(-110, 60, -80);
    this.scene.add(fill);
  }

  _initCamera() {
    const cam = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.5, 2500);
    cam.position.set(160, 82, 168);
    this.camera = cam;

    const ctrl = new OrbitControls(cam, this.renderer.domElement);
    ctrl.target.set(-6, 16, -6);
    ctrl.enableDamping = true;
    ctrl.dampingFactor = 0.055;
    ctrl.minDistance = 22;
    ctrl.maxDistance = 520;
    ctrl.maxPolarAngle = Math.PI * 0.495;
    this.controls = ctrl;
  }

  _initPostProcessing() {
    const size = new THREE.Vector2(this.container.clientWidth, this.container.clientHeight);
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(size,
      this.options.bloom.strength, this.options.bloom.radius, this.options.bloom.threshold);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloom = bloom;
  }

  /* ================================================================
     ХЕЛПЕРЫ
     ================================================================ */
  _mats() {
    return {
      steel: new THREE.MeshStandardMaterial({ color: 0xbfc6cd, roughness: 0.32, metalness: 0.92, envMapIntensity: 1.2 }),
      dark:  new THREE.MeshStandardMaterial({ color: 0x3d434a, roughness: 0.55, metalness: 0.85 }),
      mid:   new THREE.MeshStandardMaterial({ color: 0x8a929a, roughness: 0.42, metalness: 0.82 }),
      galv:  new THREE.MeshStandardMaterial({
        map: this._rep(this.tex.rust.color, 3, 3),
        normalMap: this._rep(this.tex.rust.normal, 3, 3),
        color: 0xb4b0a8, roughness: 0.7, metalness: 0.6
      }),
      roof:    new THREE.MeshStandardMaterial({ color: 0x474d54, roughness: 0.72, metalness: 0.5 }),
      roofRib: new THREE.MeshStandardMaterial({ color: 0x565d64, roughness: 0.65, metalness: 0.55 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x0d1a26, roughness: 0.05, metalness: 0.0,
        transmission: 0.15, reflectivity: 0.65, ior: 1.5,
        envMapIntensity: 2.0, clearcoat: 1.0
      }),
      glassLit: new THREE.MeshStandardMaterial({
        color: 0xffcf8a, emissive: 0xffb066, emissiveIntensity: 2.4,
        roughness: 0.5, side: THREE.DoubleSide
      }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.96, metalness: 0.02 }),
      wood:   new THREE.MeshStandardMaterial({ color: 0x8b6b45, roughness: 0.95 }),
      cable:  new THREE.MeshStandardMaterial({ color: 0x1a1e22, roughness: 0.85, metalness: 0.1 }),
      insulation: new THREE.MeshStandardMaterial({ color: 0xb8b09c, roughness: 0.92, metalness: 0.05 }),
      copper: new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.35, metalness: 1.0, envMapIntensity: 1.4 }),
      concrete: new THREE.MeshStandardMaterial({
        map: this._rep(this.tex.concrete.color, 3, 3),
        normalMap: this._rep(this.tex.concrete.normal, 3, 3),
        roughness: 0.94
      })
    };
  }

  _rep(tex, x, y) {
    const t = tex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(x, y);
    t.needsUpdate = true;
    return t;
  }

  _detailedBox(w, h, d, tex, nrm, tile, o = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const faces = [[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
    const mats = faces.map(([fw, fh]) => {
      const rx = Math.max(1, fw / tile), ry = Math.max(1, fh / tile);
      return new THREE.MeshStandardMaterial({
        map: this._rep(tex, rx, ry),
        normalMap: nrm ? this._rep(nrm, rx, ry) : null,
        normalScale: new THREE.Vector2(o.nrmScale || 1, o.nrmScale || 1),
        color: o.color !== undefined ? o.color : 0xffffff,
        roughness: o.rough !== undefined ? o.rough : 0.9,
        metalness: o.metal !== undefined ? o.metal : 0.0
      });
    });
    const m = new THREE.Mesh(geo, mats);
    m.castShadow = true; m.receiveShadow = true;
    this._disposables.push(m);
    return m;
  }

  _pipe(a, b, radius, mat, seg = 16) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, len, seg, 1, false);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(V3(0,1,0), dir.clone().normalize());
    m.castShadow = true; m.receiveShadow = true;
    this._disposables.push(m);
    return m;
  }

  _flange(pos, quat, r) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, r*0.18, 8, 20), this.mats.steel);
    m.position.copy(pos); m.quaternion.copy(quat);
    m.castShadow = true;
    this._disposables.push(m);
    return m;
  }

  _handrail(parent, a, b, y, height = 1.1, segs = null) {
    const len = new THREE.Vector3().subVectors(b, a).length();
    const r = 0.045;
    parent.add(this._pipe(V3(a.x, y+height, a.z), V3(b.x, y+height, b.z), r, this.mats.steel, 8));
    parent.add(this._pipe(V3(a.x, y+height*0.55, a.z), V3(b.x, y+height*0.55, b.z), r*0.85, this.mats.steel, 8));
    const n = segs || Math.max(2, Math.round(len/2.2));
    const postGeo = new THREE.CylinderGeometry(r, r, height, 8);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new THREE.Vector3().copy(a).lerp(b, t);
      const post = new THREE.Mesh(postGeo, this.mats.steel);
      post.position.set(p.x, y + height/2, p.z);
      post.castShadow = true;
      parent.add(post);
    }
  }

  _ladder(parent, x, y0, y1, z, mat, width = 0.65) {
    const g = new THREE.Group();
    const hgt = y1 - y0;
    const railGeo = new THREE.BoxGeometry(0.075, hgt, 0.075);
    for (const dx of [-width/2, width/2]) {
      const r = new THREE.Mesh(railGeo, mat);
      r.position.set(dx, hgt/2, 0);
      r.castShadow = true;
      g.add(r);
    }
    const count = Math.floor(hgt / 0.4);
    const rungGeo = new THREE.BoxGeometry(width + 0.05, 0.055, 0.055);
    const inst = new THREE.InstancedMesh(rungGeo, mat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set(0, 0.3 + i*0.4, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    g.add(inst);
    g.position.set(x, y0, z);
    parent.add(g);
    return g;
  }

  _valveWheel(pos, quat, r = 0.35) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 16), this.mats.steel));
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(r*2, 0.05, 0.05), this.mats.steel);
      sp.rotation.z = (i/4) * Math.PI;
      g.add(sp);
    }
    const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 8), this.mats.steel);
    axis.rotation.x = Math.PI/2;
    g.add(axis);
    g.position.copy(pos); g.quaternion.copy(quat);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  /** Кабельная трасса между двумя точками с провисом. */
  _cableBetween(a, b, sag = 1.2, radius = 0.04, mat = null) {
    const N = 20, pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      p.y -= Math.sin(t*Math.PI) * sag;
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 24, radius, 6, false);
    const m = new THREE.Mesh(geo, mat || this.mats.cable);
    m.castShadow = true;
    this._disposables.push(m);
    return m;
  }

  /** Анкерный болт — мелкая деталь на стенах. */
  _bolt(parent, x, y, z, r = 0.06, mat = null) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r*1.1, r*0.8, 8),
      mat || this.mats.steel
    );
    m.position.set(x, y, z);
    m.rotation.x = Math.PI/2;
    m.castShadow = true;
    parent.add(m);
  }

  /** Вентиляционная решётка на стене. */
  _grille(parent, x, y, z, w = 1.6, h = 1.0, faceZ = 1) {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.06),
      this.mats.dark
    );
    frame.position.set(x, y, z);
    parent.add(frame);
    const inner = new THREE.Mesh(
      new THREE.PlaneGeometry(w*0.88, h*0.82),
      new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.9 })
    );
    inner.position.set(x, y, z + faceZ * 0.04);
    inner.rotation.y = faceZ > 0 ? 0 : Math.PI;
    parent.add(inner);
    for (let i = 0; i < 6; i++) {
      const lam = new THREE.Mesh(
        new THREE.BoxGeometry(w*0.9, 0.03, 0.05),
        this.mats.mid
      );
      lam.position.set(x, y - h*0.4 + i*h*0.15, z + faceZ * 0.06);
      parent.add(lam);
    }
  }

  /* ================================================================
     СБОРКА МИРА
     ================================================================ */
  _buildWorld() {
    this.mats = this._mats();
    this._buildGround();
    this._buildRailway();
    this._buildPowerLines();
    this._buildMainHall();
    this._buildChimneys();
    this._buildCoolingTower();
    this._buildSilos();
    this._buildWarehouse();
    this._buildTankFarm();
    this._buildConveyor();
    this._buildPipeRack();
    this._buildBoilerHouse();
    this._buildOffice();
    this._buildFence();
    this._buildGate();
    this._buildLamps();
    this._buildForklifts();
    this._buildCratesBarrelsContainers();
    this._buildSigns();
    this._buildCableNetwork();
    this._buildPlumes();
    this._buildDust();
  }

  _buildGround() {
    const scene = this.scene;
    const groundMat = new THREE.MeshStandardMaterial({
      map: this._rep(this.tex.dirt.color, 110, 110),
      normalMap: this._rep(this.tex.dirt.normal, 110, 110),
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughness: 1.0
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1100), groundMat);
    ground.rotation.x = -Math.PI/2;
    ground.receiveShadow = true;
    scene.add(ground);
    this._disposables.push(ground);

    const siteMat = new THREE.MeshStandardMaterial({
      map: this._rep(this.tex.asphalt.color, 42, 38),
      normalMap: this._rep(this.tex.asphalt.normal, 42, 38),
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.96, metalness: 0.02
    });
    const site = new THREE.Mesh(new THREE.PlaneGeometry(290, 260), siteMat);
    site.rotation.x = -Math.PI/2;
    site.position.y = 0.02;
    site.receiveShadow = true;
    scene.add(site);
    this._disposables.push(site);

    /* Разметка */
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xdad2bd, roughness: 0.85 });
    const y = 0.035;
    for (let z = -100; z <= 95; z += 6) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.01, 3.0), lineMat);
      d.position.set(0, y, z);
      d.receiveShadow = true;
      scene.add(d);
    }
    for (const x of [-95, 95]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 200), lineMat);
      s.position.set(x, y, -5);
      s.receiveShadow = true;
      scene.add(s);
    }

    /* Парковочная зона — пунктирные линии */
    const parkMat = new THREE.MeshStandardMaterial({ color: 0xe4b23b, roughness: 0.85 });
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 5), parkMat);
      p.position.set(-60 + i*4, y + 0.01, 78);
      scene.add(p);
    }

    /* Лужи */
    const puddleMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a3038, roughness: 0.05, metalness: 0.05, transmission: 0.25,
      reflectivity: 0.85, ior: 1.33, envMapIntensity: 2.0, transparent: true, opacity: 0.85
    });
    [[-55,28,5,1.6,0.9],[22,45,3.2,1.1,1.0],[88,-30,4.5,1.3,0.8],
     [-10,-92,6,1.4,0.9],[110,70,3,1,1.2],[-85,78,3.6,1.2,0.9],
     [30,-45,4,1.2,0.8],[-42,-70,5,1.5,1.0],[70,25,3.5,1.1,0.9]]
      .forEach(([x, z, r, sx, sz]) => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24), puddleMat);
        m.rotation.x = -Math.PI/2;
        m.scale.set(sx, sz, 1);
        m.position.set(x, 0.045, z);
        scene.add(m);
      });

    /* Масляные пятна — тёмные круги */
    const oilMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0c, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.72
    });
    [[-30,-12,2.5,1.2,0.8],[60,-25,3.0,1.0,1.3],[-40,30,2.0,0.9,1.1],
     [90,-35,2.5,1.3,0.9],[15,60,2.2,1.0,0.8]]
      .forEach(([x, z, r, sx, sz]) => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), oilMat);
        m.rotation.x = -Math.PI/2;
        m.scale.set(sx, sz, 1);
        m.position.set(x, 0.048, z);
        scene.add(m);
      });

    /* Следы шин — кривые тёмные полосы */
    const trackMat = new THREE.MeshStandardMaterial({
      color: 0x141416, roughness: 0.92, transparent: true, opacity: 0.55
    });
    const addTrack = (x1, z1, x2, z2) => {
      const N = 10;
      for (let i = 0; i < N; i++) {
        const t = i / N;
        const x = x1 + (x2-x1)*t + (Math.random()-0.5)*0.4;
        const z = z1 + (z2-z1)*t + (Math.random()-0.5)*0.4;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.2), trackMat);
        m.rotation.x = -Math.PI/2;
        m.rotation.z = Math.atan2(x2-x1, z2-z1) + (Math.random()-0.5)*0.1;
        m.position.set(x, 0.042, z);
        scene.add(m);
      }
    };
    addTrack(-35, 50, 35, 50);
    addTrack(-35, 52, 35, 52);
    addTrack(-70, -60, 70, -60);
    addTrack(-70, -63, 70, -63);

    /* Бетонные площадки */
    const apron = (x, z, w, d, yy = 0.05) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({
          map: this._rep(this.tex.concrete.color, w/5, d/5),
          normalMap: this._rep(this.tex.concrete.normal, w/5, d/5),
          roughness: 0.94
        })
      );
      m.rotation.x = -Math.PI/2;
      m.position.set(x, yy, z);
      m.receiveShadow = true;
      scene.add(m);
    };
    apron(-30,-12,88,52,0.04);
    apron( 62,-22,64,48,0.045);
    apron( 10,-60,74,24,0.05);
    apron(-88,-35,44,44,0.04);
    apron( 48, 42,50,36,0.04);
    apron(-18, 62,30,18,0.04);
    apron(-66, 28, 30, 26, 0.045);
  }

  _buildRailway() {
    const g = new THREE.Group();
    const zC = 30, y = 0.14;

    const ballastMat = new THREE.MeshStandardMaterial({
      map: this._rep(this.tex.dirt.color, 40, 3),
      normalMap: this._rep(this.tex.dirt.normal, 40, 3),
      color: 0x7a7264, roughness: 1.0
    });
    const ballast = new THREE.Mesh(new THREE.BoxGeometry(220, 0.28, 5.5), ballastMat);
    ballast.position.set(0, y, zC);
    ballast.receiveShadow = true;
    g.add(ballast);

    const sleeperGeo = new THREE.BoxGeometry(2.8, 0.18, 0.28);
    const sleepers = Math.floor(220 / 0.75);
    const inst = new THREE.InstancedMesh(sleeperGeo, this.mats.wood, sleepers);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < sleepers; i++) {
      dummy.position.set(-110 + i*0.75, y + 0.23, zC);
      dummy.rotation.set(0, Math.PI/2, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true; inst.receiveShadow = true;
    g.add(inst);

    const railMat = new THREE.MeshStandardMaterial({ color: 0x686f77, roughness: 0.35, metalness: 0.95, envMapIntensity: 1.4 });
    for (const dz of [-1.435/2, 1.435/2]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(220, 0.16, 0.09), railMat);
      r.position.set(0, y + 0.40, zC + dz);
      r.castShadow = true; r.receiveShadow = true;
      g.add(r);
    }

    const tankCar = (x, z, color = 0x2a333d) => {
      const cg = new THREE.Group();
      const R = 1.4, L = 11;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, L, 24),
        new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.55 })
      );
      body.rotation.z = Math.PI/2;
      body.position.y = R + 1.6;
      body.castShadow = true; body.receiveShadow = true;
      cg.add(body);
      for (const dx of [-3, 0, 3]) {
        const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.6, 12), this.mats.mid);
        dome.position.set(dx, R*2 + 1.6, 0);
        cg.add(dome);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8, 0, Math.PI*2, 0, Math.PI/2), this.mats.mid);
        cap.position.set(dx, R*2 + 1.9, 0);
        cap.scale.y = 0.5;
        cg.add(cap);
      }
      const frame = new THREE.Mesh(new THREE.BoxGeometry(L+2, 0.4, 2.4), this.mats.dark);
      frame.position.y = 1.0; frame.castShadow = true;
      cg.add(frame);
      for (const dx of [-4, 4]) {
        const bg = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 2.2), this.mats.dark);
        b.position.y = 0.6; bg.add(b);
        const wGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.14, 18);
        wGeo.rotateZ(Math.PI/2);
        for (const dz of [-1.435/2, 1.435/2]) for (const ddx of [-0.9, 0.9]) {
          const w = new THREE.Mesh(wGeo, this.mats.rubber);
          w.position.set(ddx, 0.52, dz);
          bg.add(w);
        }
        bg.position.set(dx, 0, 0);
        cg.add(bg);
      }
      cg.position.set(x, 0.7, z);
      cg.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(cg);
    };
    tankCar(-40, 30);
    tankCar(-20, 30, 0x3d2a2a);
    tankCar( 20, 30, 0x2a3d30);

    this.scene.add(g);
  }

  _buildPowerLines() {
    const g = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({
      map: this._rep(this.tex.concrete.color, 1, 4),
      normalMap: this._rep(this.tex.concrete.normal, 1, 4),
      color: 0xa49e92, roughness: 0.92
    });

    const poles = [];
    for (let i = 0; i < 7; i++) {
      const x = -130 + i*42;
      poles.push({ x, z: -100, h: 14 });
      const pg = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 14, 10), poleMat);
      pole.position.y = 7;
      pole.castShadow = true;
      pg.add(pole);

      for (const [yy, len] of [[13, 3.4], [11.6, 4.0], [10.2, 3.4]]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.18), this.mats.dark);
        arm.position.set(0, yy, 0);
        arm.castShadow = true;
        pg.add(arm);
        for (const dx of [-len/2+0.3, 0, len/2-0.3]) {
          const ins = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.14, 0.35, 8),
            new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.5 })
          );
          ins.position.set(dx, yy+0.26, 0);
          pg.add(ins);
        }
      }
      pg.position.set(x, 0, -100);
      g.add(pg);
    }

    for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i], b = poles[i+1];
      for (const [dy, dx] of [[-1.0,-1.4],[-1.0,1.4],[-2.4,-1.7],[-2.4,1.7],[-3.8,-1.4],[-3.8,1.4]]) {
        g.add(this._cableBetween(
          V3(a.x+dx, a.h+dy, a.z),
          V3(b.x+dx, b.h+dy, b.z),
          0.6, 0.035, this.mats.dark
        ));
      }
    }
    this.scene.add(g);
  }

  _buildMainHall() {
    const g = new THREE.Group();
    const W = 74, H = 22, D = 38, cx = -30, cz = -12;

    const body = this._detailedBox(W, H, D, this.tex.brick.color, this.tex.brick.normal, 2.2, { rough: 0.94 });
    body.position.set(cx, H/2, cz);
    g.add(body);

    const base = this._detailedBox(W+1.5, 2.6, D+1.5, this.tex.concrete.color, this.tex.concrete.normal, 3.5, { rough: 0.92 });
    base.position.set(cx, 1.3, cz);
    g.add(base);

    const pilMat = new THREE.MeshStandardMaterial({
      map: this._rep(this.tex.brick.color, 1, 2), color: 0xc8beb0, roughness: 0.92
    });
    for (let x = -W/2+4; x <= W/2-4; x += 8) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.0, H, 0.9), pilMat);
      p.position.set(cx+x, H/2, cz + D/2 + 0.45);
      p.castShadow = true; p.receiveShadow = true;
      g.add(p);
    }

    /* Карниз плотно к стене, крыша прижата к карнизу */
    const cornice = this._detailedBox(W+2.4, 1.4, D+2.4, this.tex.concrete.color, this.tex.concrete.normal, 3, { rough: 0.9 });
    cornice.position.set(cx, H + 0.7, cz);
    g.add(cornice);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(W+1, 0.6, D+1), this.mats.roof);
    roof.position.set(cx, H + 1.7, cz);
    roof.castShadow = true; roof.receiveShadow = true;
    g.add(roof);

    /* Крышные рёбра */
    const ribGeo = new THREE.BoxGeometry(W+1, 0.14, 0.14);
    for (let z = -D/2+2; z <= D/2-2; z += 3.2) {
      const r = new THREE.Mesh(ribGeo, this.mats.roofRib);
      r.position.set(cx, H + 2.07, cz+z);
      r.castShadow = true;
      g.add(r);
    }

    /* Окна с подоконниками */
    const items = [];
    const rows = [6.8, 12.0, 17.0];
    const paneGeo = new THREE.BoxGeometry(3.4, 2.4, 0.32);
    for (const zs of [1, -1]) for (const y of rows)
      for (let x = -W/2+5; x <= W/2-5; x += 4.7)
        items.push({ p: V3(cx+x, y, cz+zs*D/2), ry: zs>0?0:Math.PI, out: V3(0,0,zs) });
    for (const xs of [1, -1]) for (const y of rows)
      for (let z = -D/2+4; z <= D/2-4; z += 4.7)
        items.push({ p: V3(cx+xs*W/2, y, cz+z), ry: xs>0?Math.PI/2:-Math.PI/2, out: V3(xs,0,0) });

    const dummy = new THREE.Object3D();

    const winInst = new THREE.InstancedMesh(paneGeo, this.mats.glass, items.length);
    winInst.receiveShadow = true;
    items.forEach((it, i) => {
      dummy.position.copy(it.p).addScaledVector(it.out, 0.08);
      dummy.rotation.set(0, it.ry, 0);
      dummy.updateMatrix(); winInst.setMatrixAt(i, dummy.matrix);
    });
    winInst.instanceMatrix.needsUpdate = true;
    g.add(winInst);

    /* Рама ЗА стеклом — обрамление */
    const frameGeo = new THREE.BoxGeometry(3.7, 2.7, 0.14);
    const frameInst = new THREE.InstancedMesh(frameGeo, this.mats.dark, items.length);
    items.forEach((it, i) => {
      dummy.position.copy(it.p).addScaledVector(it.out, -0.02);
      dummy.rotation.set(0, it.ry, 0); dummy.updateMatrix();
      frameInst.setMatrixAt(i, dummy.matrix);
    });
    frameInst.instanceMatrix.needsUpdate = true;
    g.add(frameInst);

    /* Подоконник ПЕРЕД окном */
    const sillGeo = new THREE.BoxGeometry(3.9, 0.18, 0.55);
    const sillInst = new THREE.InstancedMesh(sillGeo, this.mats.mid, items.length);
    items.forEach((it, i) => {
      dummy.position.copy(it.p).addScaledVector(it.out, 0.35);
      dummy.position.y -= 1.45;
      dummy.rotation.set(0, it.ry, 0); dummy.updateMatrix();
      sillInst.setMatrixAt(i, dummy.matrix);
    });
    sillInst.instanceMatrix.needsUpdate = true;
    g.add(sillInst);

    /* Подсвеченные окна ПЕРЕД стеклом */
    const litItems = items.filter(() => Math.random() < 0.24);
    const litGeo = new THREE.PlaneGeometry(3.0, 2.0);
    const litInst = new THREE.InstancedMesh(litGeo, this.mats.glassLit, litItems.length);
    litItems.forEach((it, i) => {
      dummy.position.copy(it.p).addScaledVector(it.out, 0.26);
      dummy.rotation.set(0, it.ry, 0); dummy.updateMatrix();
      litInst.setMatrixAt(i, dummy.matrix);
    });
    litInst.instanceMatrix.needsUpdate = true;
    g.add(litInst);

    /* Ворота */
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2f3a44, roughness: 0.55, metalness: 0.55 });
    for (let i = 0; i < 3; i++) {
      const dx = cx - 22 + i*17, dz = cz + D/2;
      const door = new THREE.Mesh(new THREE.BoxGeometry(7.2, 7.8, 0.5), doorMat);
      door.position.set(dx, 3.9, dz + 0.22);
      door.castShadow = true; door.receiveShadow = true;
      g.add(door);
      for (let k = 0; k < 8; k++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.12, 0.05), this.mats.mid);
        rib.position.set(dx, 0.6 + k*1.05, dz + 0.5);
        g.add(rib);
      }
      /* Ручки на воротах */
      for (const ox of [-3.0, 3.0]) {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.35), this.mats.steel);
        handle.position.set(dx + ox, 3.5, dz + 0.65);
        g.add(handle);
      }
      const can = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.32, 2.4), this.mats.mid);
      can.position.set(dx, 8.5, dz + 1.2);
      can.castShadow = true;
      g.add(can);
      for (const ox of [-3.9, 3.9]) {
        const sup = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 2.4), this.mats.mid);
        sup.position.set(dx+ox, 8.35, dz+1.2);
        sup.castShadow = true;
        g.add(sup);
      }
    }

    /* Наружная лестница */
    const st = new THREE.Group();
    const steps = 30;
    const stairH = H + 1.4;
    const sh = stairH / steps, sd = 0.32;
    for (let i = 0; i < steps; i++) {
      const stp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.42), this.mats.dark);
      stp.position.set(0, i * sh, i * sd);
      stp.castShadow = true; stp.receiveShadow = true;
      st.add(stp);
    }
    for (const ox of [-0.75, 0.75]) {
      const pts = [];
      for (let i = 0; i <= steps; i++) pts.push(V3(ox, i*sh + 1.0, i*sd));
      const curve = new THREE.CatmullRomCurve3(pts);
      const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.045, 6, false), this.mats.dark);
      rail.castShadow = true;
      st.add(rail);
    }
    const landing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1.8), this.mats.mid);
    landing.position.set(0, stairH + 0.06, steps*sd + 0.6);
    landing.castShadow = true; landing.receiveShadow = true;
    st.add(landing);
    st.position.set(cx + W/2 + 1.6, 0, cz + D/2 - steps*sd - 0.5);
    g.add(st);

    /* Крышное оборудование */
    const equipMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.42, metalness: 0.82 });
    const ventPositions = [
      [-58,-22,1.6],[-48,-6,1.4],[-38,-18,1.8],[-28,-2,1.6],
      [-18,-22,1.5],[-8,-6,1.7],[-52,2,1.3],[-32,2,1.5],
      [-22,-12,1.6],[-12,-18,1.4]
    ];
    ventPositions.forEach(([x, z, s]) => {
      const vg = new THREE.Group();
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.3*s, 1.5*s, 3.2, 18), equipMat);
      cyl.position.y = 1.6; cyl.castShadow = true;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.75*s, 1.75*s, 0.35, 18), this.mats.mid);
      cap.position.y = 3.4; cap.castShadow = true;
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.6*s, 0.6*s, 1.0, 12), this.mats.dark);
      motor.position.y = 0.5;
      vg.add(cyl, cap, motor);
      vg.position.set(x, H + 2.2, z);
      g.add(vg);
    });

    const ahu = new THREE.Group();
    const ahuBody = new THREE.Mesh(new THREE.BoxGeometry(10, 3.4, 5), equipMat);
    ahuBody.position.y = 1.7; ahuBody.castShadow = true; ahuBody.receiveShadow = true;
    ahu.add(ahuBody);
    const ahuTop = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.3, 5.4), this.mats.roof);
    ahuTop.position.y = 3.55;
    ahu.add(ahuTop);
    for (const dx of [-3.5, 0, 3.5]) {
      const fr = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 16), this.mats.dark);
      fr.position.set(dx, 3.8, 0);
      ahu.add(fr);
    }
    ahu.position.set(cx + 10, H + 2.2, cz);
    g.add(ahu);

    /* Спутниковая тарелка на крыше.
       ВАЖНО: стрелочная функция — иначе в strict mode (ES-модуль)
       обычная IIFE потеряет this, и `this.mats` будет undefined. */
    (() => {
      const dishGroup = new THREE.Group();
      const dish = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 20, 14, 0, Math.PI*2, 0, Math.PI/2.8),
        new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide })
      );
      dish.rotation.x = -Math.PI/3;
      dishGroup.add(dish);
      const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.2, 10), this.mats.dark);
      mount.position.y = -0.6;
      dishGroup.add(mount);
      dishGroup.position.set(cx + 28, H + 3.6, cz + 12);
      g.add(dishGroup);
    })();

    this._handrail(g, V3(cx-W/2-0.5, H+2.0, cz-D/2-0.5), V3(cx+W/2+0.5, H+2.0, cz-D/2-0.5), 0, 1.05, 30);
    this._handrail(g, V3(cx-W/2-0.5, H+2.0, cz+D/2+0.5), V3(cx+W/2+0.5, H+2.0, cz+D/2+0.5), 0, 1.05, 30);
    this._handrail(g, V3(cx-W/2-0.5, H+2.0, cz-D/2), V3(cx-W/2-0.5, H+2.0, cz+D/2), 0, 1.05, 16);
    this._handrail(g, V3(cx+W/2+0.5, H+2.0, cz-D/2), V3(cx+W/2+0.5, H+2.0, cz+D/2), 0, 1.05, 16);

    /* Фасадные трубы */
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x9b8f7a, roughness: 0.7, metalness: 0.5 });
    const fz = cz + D/2 + 0.75;
    g.add(this._pipe(V3(cx-33, 1, fz), V3(cx-33, 19, fz), 0.26, pipeMat, 10));
    g.add(this._pipe(V3(cx+33, 1, fz), V3(cx+33, 19, fz), 0.26, pipeMat, 10));
    g.add(this._pipe(V3(cx-33, 19, fz), V3(cx+33, 19, fz), 0.26, pipeMat, 10));
    for (let x = -32; x <= 32; x += 4) {
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.7), this.mats.dark);
      clamp.position.set(cx+x, 19, fz - 0.4);
      g.add(clamp);
    }
    for (const x of [-25, -10, 5, 22]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2, 0, 0));
      g.add(this._valveWheel(V3(cx+x, 19 + 0.26, fz), q, 0.28));
    }
    for (let x = -30; x <= 30; x += 20) {
      g.add(this._pipe(V3(cx+x, 1, fz), V3(cx+x, 21, fz), 0.11, this.mats.galv, 8));
    }

    /* Вентиляционные решётки на стенах */
    this._grille(g, cx - 20, 3.5, cz + D/2 + 0.08, 2.2, 1.2, 1);
    this._grille(g, cx + 5, 3.5, cz + D/2 + 0.08, 2.2, 1.2, 1);

    /* Боковые окна */
    this._bolt(g, cx + W/2 + 0.5, 8, cz - 8, 0.08);
    this._bolt(g, cx + W/2 + 0.5, 8, cz + 8, 0.08);

    this.scene.add(g);
  }

  _buildChimneys() {
    const make = (x, z, height, rBottom, rTop) => {
      const g = new THREE.Group();

      /* Фундаментная плита — заливает "щель" между землёй и телом трубы */
      const foundation = new THREE.Mesh(
        new THREE.CylinderGeometry(rBottom*2.2, rBottom*2.35, 0.6, 40),
        this.mats.concrete
      );
      foundation.position.y = 0.3;
      foundation.castShadow = true; foundation.receiveShadow = true;
      g.add(foundation);

      const bodyMat = new THREE.MeshStandardMaterial({
        map: this._rep(this.tex.chimney.color, 1, 1),
        normalMap: this._rep(this.tex.chimney.normal, 1, 1),
        roughness: 0.88, metalness: 0.05
      });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, height, 48, 4, false), bodyMat);
      body.position.y = height/2 + 0.6;
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);

      /* Юбка у основания (переход от фундамента к трубе) */
      const skirt = new THREE.Mesh(
        new THREE.CylinderGeometry(rBottom, rBottom*1.55, 4.5, 36),
        this.mats.concrete
      );
      skirt.position.y = 0.6 + 2.25;
      skirt.castShadow = true; skirt.receiveShadow = true;
      g.add(skirt);

      /* Кольцевое ребро на стыке юбки и трубы */
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(rBottom + 0.15, 0.22, 8, 40),
        this.mats.mid
      );
      collar.rotation.x = Math.PI/2;
      collar.position.y = 0.6 + 4.5;
      g.add(collar);

      /* Кольца по высоте */
      for (const t of [0.12, 0.28, 0.46, 0.66, 0.86]) {
        const yy = 0.6 + t * height;
        const r = rBottom + (rTop - rBottom) * t;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.15, 0.22, 8, 40), this.mats.mid);
        ring.rotation.x = Math.PI/2; ring.position.y = yy; ring.castShadow = true;
        g.add(ring);
      }

      const topRing = new THREE.Mesh(new THREE.TorusGeometry(rTop + 0.2, 0.25, 8, 40), this.mats.steel);
      topRing.rotation.x = Math.PI/2; topRing.position.y = height + 0.6;
      g.add(topRing);

      /* Внутренняя тёмная вставка на срезе — без просвета */
      const innerDisc = new THREE.Mesh(
        new THREE.CircleGeometry(rTop - 0.05, 40),
        new THREE.MeshBasicMaterial({ color: 0x0a0a0a })
      );
      innerDisc.rotation.x = -Math.PI/2;
      innerDisc.position.y = height + 0.61;
      g.add(innerDisc);

      /* Лестница с площадкой */
      const ladX = rBottom + 0.7;
      this._ladder(g, ladX, 0.6, height + 0.6, 0, this.mats.dark, 0.7);
      for (let i = 0; i < 14; i++) {
        const yy = 0.6 + (0.14 + i * 0.06) * height;
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.028, 6, 16), this.mats.dark);
        hoop.rotation.x = Math.PI/2;
        hoop.position.set(ladX, yy, 0);
        hoop.castShadow = true;
        g.add(hoop);
      }

      const lampMat = new THREE.MeshStandardMaterial({
        color: 0xff3524, emissive: 0xff3524, emissiveIntensity: 3.5, roughness: 0.4
      });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 14), lampMat);
      lamp.position.set(0, height + 1.7, 0);
      g.add(lamp);
      const lampHouse = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.35, 12), this.mats.dark);
      lampHouse.position.set(0, height + 1.2, 0);
      g.add(lampHouse);

      const stainMat = new THREE.MeshBasicMaterial({ color: 0x1a1614, transparent: true, opacity: 0.5 });
      const stain = new THREE.Mesh(
        new THREE.CylinderGeometry(rTop + 0.02, rTop + 0.02, height*0.18, 32, 1, true),
        stainMat
      );
      stain.position.y = height - height*0.09 + 0.6;
      g.add(stain);

      g.position.set(x, 0, z);
      this.scene.add(g);
      this._chimneys.push({ group: g, lampMat });
      return { x, z, height: height + 0.6, rTop };
    };

    this.chimA = make(-58, -48, 52, 3.2, 2.3);
    this.chimB = make(-38, -58, 42, 2.7, 2.0);

    const small = (x, z, h = 12) => {
      const g = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.0, 1.2, 0.5, 18),
        this.mats.concrete
      );
      base.position.y = 0.25;
      base.castShadow = true;
      g.add(base);
      const c = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.65, h, 16),
        new THREE.MeshStandardMaterial({ color: 0x8b8a85, roughness: 0.8, metalness: 0.4 })
      );
      c.position.y = h/2 + 0.5; c.castShadow = true;
      g.add(c);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 6, 16), this.mats.steel);
      rim.rotation.x = Math.PI/2; rim.position.y = h + 0.5;
      g.add(rim);
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.5, 16),
        new THREE.MeshBasicMaterial({ color: 0x0a0a0a })
      );
      disc.rotation.x = -Math.PI/2;
      disc.position.y = h + 0.51;
      g.add(disc);
      g.position.set(x, 0, z);
      this.scene.add(g);
    };
    small(-72, 24, 14);
    small(-68, 30, 12);
  }

  _buildCoolingTower() {
    const g = new THREE.Group();
    const H = 38, rThroat = 10.5, yThroat = H*0.60, rBase = 15, rTop = 12.5;
    const pts = [];
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const t = i/N, y = t*H;
      let r;
      if (y <= yThroat) {
        const k = (y - yThroat) / (0 - yThroat);
        r = rThroat + (rBase - rThroat) * Math.pow(k, 1.85);
      } else {
        const k = (y - yThroat) / (H - yThroat);
        r = rThroat + (rTop - rThroat) * Math.pow(k, 2.0);
      }
      pts.push(new THREE.Vector2(r, y));
    }
    const towerMat = new THREE.MeshStandardMaterial({
      map: this._rep(this.tex.concrete.color, 20, 10),
      normalMap: this._rep(this.tex.concrete.normal, 20, 10),
      roughness: 0.96, side: THREE.DoubleSide
    });
    const tower = new THREE.Mesh(new THREE.LatheGeometry(pts, 72), towerMat);
    tower.castShadow = true; tower.receiveShadow = true;
    g.add(tower);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(rTop, 0.4, 10, 72), this.mats.mid);
    rim.rotation.x = Math.PI/2; rim.position.y = H;
    g.add(rim);

    /* Фундаментное кольцо — закрывает стык трубы с землёй */
    const foundation = new THREE.Mesh(
      new THREE.CylinderGeometry(rBase + 1.2, rBase + 2.4, 1.2, 72),
      this.mats.concrete
    );
    foundation.position.y = 0.6;
    foundation.castShadow = true; foundation.receiveShadow = true;
    g.add(foundation);

    /* Опорные рёбра у основания */
    for (let i = 0; i < 36; i++) {
      const a = (i/36) * Math.PI * 2;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.55, 6.5, 1.0), this.mats.dark);
      rib.position.set(Math.cos(a)*(rBase+0.5), 3.25, Math.sin(a)*(rBase+0.5));
      rib.rotation.y = -a; rib.castShadow = true;
      g.add(rib);
    }

    /* Бассейн */
    const pool = new THREE.Mesh(
      new THREE.CylinderGeometry(rBase+5, rBase+5, 1.6, 48),
      this.mats.concrete
    );
    pool.position.y = 1.4;
    pool.receiveShadow = true; pool.castShadow = true;
    g.add(pool);

    /* Парапет бассейна */
    const parapetOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(rBase+5.3, rBase+5.3, 0.6, 48, 1, true),
      this.mats.mid
    );
    parapetOuter.position.y = 2.5;
    g.add(parapetOuter);

    const water = new THREE.Mesh(
      new THREE.CircleGeometry(rBase+4.5, 40),
      new THREE.MeshPhysicalMaterial({
        color: 0x2a4652, roughness: 0.08, metalness: 0.1,
        transmission: 0.3, reflectivity: 0.8, ior: 1.33, envMapIntensity: 1.8
      })
    );
    water.rotation.x = -Math.PI/2; water.position.y = 2.21;
    g.add(water);

    /* Лестница на бассейн */
    const poolLadder = new THREE.Group();
    for (const dx of [-0.3, 0.3]) {
      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8),
        this.mats.steel
      );
      rail.position.set(dx, 1.4, rBase + 5.3);
      poolLadder.add(rail);
    }
    poolLadder.position.set(0, 0, 0);
    g.add(poolLadder);

    g.position.set(-92, 0, -38);
    this.scene.add(g);
    this.tower = { x: -92, z: -38, H, rTop, poolR: rBase + 5 };
  }

  _buildSilos() {
    const siloXs = [-12, 4, 20, 36];
    const legH = 4.0, Hs = 22, R = 4.6;

    siloXs.forEach(x => {
      const g = new THREE.Group();
      const shellMat = new THREE.MeshStandardMaterial({
        map: this._rep(this.tex.corr.color, 10, 6),
        normalMap: this._rep(this.tex.corr.normal, 10, 6),
        normalScale: new THREE.Vector2(1.4, 1.4),
        roughness: 0.38, metalness: 0.82, color: 0xd6dbe0, envMapIntensity: 1.1
      });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, Hs, 40), shellMat);
      body.position.y = legH + Hs/2;
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);

      /* Коническое днище — замкнутый конус с заглушкой снизу */
      const coneMat = new THREE.MeshStandardMaterial({
        map: this._rep(this.tex.corr.color, 8, 3),
        normalMap: this._rep(this.tex.corr.normal, 8, 3),
        color: 0xc2c8ce, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide
      });
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(R, 0.85, legH, 40, 1, true), coneMat);
      cone.position.y = legH/2 + 0.02; cone.castShadow = true;
      g.add(cone);

      /* Заглушка на вершине конуса — точно совпадает по радиусу с нижним срезом конуса */
      const topCap = new THREE.Mesh(
        new THREE.CircleGeometry(R, 40),
        this.mats.dark
      );
      topCap.rotation.x = Math.PI/2;
      topCap.position.y = legH + 0.03;
      g.add(topCap);

      /* Полное днище конуса — закрывает центральное отверстие. */
      const bottomDisc = new THREE.Mesh(
        new THREE.CircleGeometry(0.85, 40),
        this.mats.dark
      );
      bottomDisc.rotation.x = -Math.PI/2;
      bottomDisc.position.y = 0.02;
      g.add(bottomDisc);

      /* Тонкое кольцо у нижнего среза конуса — декоративное */
      const bottomRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.85, 0.06, 6, 24),
        this.mats.steel
      );
      bottomRing.rotation.x = Math.PI/2;
      bottomRing.position.y = 0.03;
      g.add(bottomRing);

      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(R, 40, 20, 0, Math.PI*2, 0, Math.PI/2),
        shellMat
      );
      dome.position.y = legH + Hs; dome.scale.y = 0.6; dome.castShadow = true;
      g.add(dome);

      for (let i = 1; i <= 4; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R+0.06, 0.10, 8, 48), this.mats.dark);
        ring.rotation.x = Math.PI/2;
        ring.position.y = legH + 2 + i*(Hs/5);
        g.add(ring);
      }

      const legGeo = new THREE.BoxGeometry(0.55, legH, 0.55);
      for (let i = 0; i < 8; i++) {
        const a = (i/8) * Math.PI * 2;
        const leg = new THREE.Mesh(legGeo, this.mats.dark);
        leg.position.set(Math.cos(a)*R*0.82, legH/2, Math.sin(a)*R*0.82);
        leg.castShadow = true;
        g.add(leg);
        /* Пятка опоры — плита под каждой ногой */
        const foot = new THREE.Mesh(
          new THREE.BoxGeometry(0.75, 0.15, 0.75),
          this.mats.dark
        );
        foot.position.set(Math.cos(a)*R*0.82, 0.075, Math.sin(a)*R*0.82);
        foot.castShadow = true; foot.receiveShadow = true;
        g.add(foot);
      }
      for (let i = 0; i < 8; i++) {
        const a1 = (i/8) * Math.PI * 2, a2 = ((i+1)/8) * Math.PI * 2;
        const r = R * 0.82;
        g.add(this._pipe(V3(Math.cos(a1)*r, 0.3, Math.sin(a1)*r), V3(Math.cos(a2)*r, legH-0.3, Math.sin(a2)*r), 0.06, this.mats.dark, 4));
        g.add(this._pipe(V3(Math.cos(a2)*r, 0.3, Math.sin(a2)*r), V3(Math.cos(a1)*r, legH-0.3, Math.sin(a1)*r), 0.06, this.mats.dark, 4));
      }

      /* Патрубок разгрузки */
      const out = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.6, 16), this.mats.mid);
      out.position.y = 0.3; out.castShadow = true;
      g.add(out);

      /* Фланцы патрубка */
      const outFlangeTop = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.08, 6, 16), this.mats.steel);
      outFlangeTop.rotation.x = Math.PI/2;
      outFlangeTop.position.y = 0.02;
      g.add(outFlangeTop);
      const outFlangeBot = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.08, 6, 16), this.mats.steel);
      outFlangeBot.rotation.x = Math.PI/2;
      outFlangeBot.position.y = 0.58;
      g.add(outFlangeBot);

      /* Патрубок вентиляции сверху */
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 1.4, 14), this.mats.mid);
      vent.position.y = legH + Hs + R*0.6 + 0.7; vent.castShadow = true;
      g.add(vent);
      const ventCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.75, 0.75, 0.2, 14),
        this.mats.dark
      );
      ventCap.position.y = legH + Hs + R*0.6 + 1.4;
      g.add(ventCap);

      this._ladder(g, R+0.7, 0, legH + Hs + R*0.6, 0, this.mats.dark, 0.65);

      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.5), this.mats.steel);
      plate.position.set(R*0.3, legH + Hs + 0.3, R*0.3);
      g.add(plate);
      const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16), this.mats.steel);
      gauge.rotation.x = Math.PI/2;
      gauge.position.set(R*0.3, legH + Hs + 0.5, R*0.3);
      g.add(gauge);

      g.position.set(x, 0, -60);
      this.scene.add(g);
    });

    /* Галерея между силосами */
    const y = 4.0 + 22 + 0.4, z = -60;
    const group = new THREE.Group();
    const walkMat = new THREE.MeshStandardMaterial({ color: 0x5c636a, roughness: 0.7, metalness: 0.7 });
    for (let i = 0; i < siloXs.length - 1; i++) {
      const x1 = siloXs[i], x2 = siloXs[i+1];
      const span = x2 - x1;
      const plat = new THREE.Mesh(new THREE.BoxGeometry(span-8, 0.15, 2.2), walkMat);
      plat.position.set((x1+x2)/2, y, z);
      plat.castShadow = true; plat.receiveShadow = true;
      group.add(plat);
      this._handrail(group, V3(x1+4, y, z-1.1), V3(x2-4, y, z-1.1), 0, 1.1, 5);
      this._handrail(group, V3(x1+4, y, z+1.1), V3(x2-4, y, z+1.1), 0, 1.1, 5);
    }
    const manifoldMat = new THREE.MeshStandardMaterial({ color: 0xa8b0b8, roughness: 0.4, metalness: 0.85 });
    group.add(this._pipe(V3(siloXs[0], y+1.8, z-1.6), V3(siloXs[siloXs.length-1], y+1.8, z-1.6), 0.55, manifoldMat, 16));
    for (let x = siloXs[0]+6; x <= siloXs[siloXs.length-1]-6; x += 8) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, y, 10), this.mats.dark);
      pillar.position.set(x, y/2, z); pillar.castShadow = true;
      group.add(pillar);
    }
    this.scene.add(group);
  }

  _buildWarehouse() {
    const g = new THREE.Group();
    const W = 52, H = 13, D = 30, cx = 66, cz = -26;

    const walls = this._detailedBox(W, H, D, this.tex.corr.color, this.tex.corr.normal, 3.0,
      { rough: 0.5, metal: 0.6, color: 0xd4d9dd, nrmScale: 1.3 });
    walls.position.set(cx, H/2, cz);
    g.add(walls);

    const base = this._detailedBox(W+1, 1.4, D+1, this.tex.concrete.color, this.tex.concrete.normal, 3);
    base.position.set(cx, 0.7, cz);
    g.add(base);

    const roofH = 5.5;
    const shape = new THREE.Shape();
    shape.moveTo(-D/2-1.2, 0); shape.lineTo(D/2+1.2, 0);
    shape.lineTo(0, roofH);    shape.lineTo(-D/2-1.2, 0);
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: W+2.4, bevelEnabled: false });
    roofGeo.rotateY(Math.PI/2);
    roofGeo.translate(-W/2-1.2, H, 0);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x59616a, roughness: 0.7, metalness: 0.55 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(cx, 0, cz);
    roof.castShadow = true; roof.receiveShadow = true;
    g.add(roof);

    /* Конёк — узкая полоса по верху крыши */
    const ridge = new THREE.Mesh(
      new THREE.BoxGeometry(W+2.6, 0.25, 0.5),
      this.mats.roofRib
    );
    ridge.position.set(cx, H + roofH + 0.12, cz);
    ridge.castShadow = true;
    g.add(ridge);

    /* Вентиляционные клапаны на коньке */
    for (let i = 0; i < 6; i++) {
      const x = cx - W/2 + 6 + i * (W/5.5);
      const vent = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.6, 0.8, 12),
        this.mats.mid
      );
      vent.position.set(x, H + roofH + 0.6, cz);
      g.add(vent);
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 0.15, 12),
        this.mats.dark
      );
      cap.position.set(x, H + roofH + 1.05, cz);
      g.add(cap);
    }

    /* Ребра по всей крыше */
    for (const side of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        const t = (i + 0.5) / 8;
        const zOff = side * (D/2 + 1.2) * (1 - t);
        const y = H + roofH * t;
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(W + 2.4, 0.14, 0.14),
          this.mats.roofRib
        );
        rib.position.set(cx, y, cz + zOff);
        rib.castShadow = true;
        g.add(rib);
      }
    }

    const doorMat = new THREE.MeshStandardMaterial({ color: 0x38424c, roughness: 0.55, metalness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const dx = cx - 19 + i*13;
      const door = new THREE.Mesh(new THREE.BoxGeometry(5.6, 5.6, 0.4), doorMat);
      door.position.set(dx, 4.2, cz + D/2 + 0.25);
      door.castShadow = true;
      g.add(door);
      for (let k = 0; k < 10; k++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.09, 0.05), this.mats.mid);
        rib.position.set(dx, 1.6 + k*0.55, cz + D/2 + 0.5);
        g.add(rib);
      }
      for (const ox of [-2.6, 2.6]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.35), this.mats.rubber);
        b.position.set(dx+ox, 1.6, cz + D/2 + 0.5);
        g.add(b);
      }
    }
    const dock = this._detailedBox(W+6, 1.4, 8, this.tex.concrete.color, this.tex.concrete.normal, 4);
    dock.position.set(cx, 0.7, cz + D/2 + 4);
    g.add(dock);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(W+6, 0.02, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xe4b23b, roughness: 0.7 })
    );
    stripe.position.set(cx, 1.42, cz + D/2 + 7.9);
    g.add(stripe);

    for (let i = 0; i < 5; i++) {
      const hv = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.8, 3.2), this.mats.mid);
      hv.position.set(cx - 18 + i*9, H + roofH*0.35 + 2.2, cz);
      hv.castShadow = true;
      g.add(hv);
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.9, 12), this.mats.dark);
      ex.position.set(cx - 18 + i*9, H + roofH*0.35 + 3.5, cz);
      g.add(ex);
    }

    /* Табличка на стене склада */
    const signMat = new THREE.MeshStandardMaterial({ map: this.tex.sign.color, roughness: 0.85 });
    const signPlate = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), signMat);
    signPlate.position.set(cx - 20, 9.5, cz + D/2 + 0.35);
    g.add(signPlate);
    const signFrame = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.4, 0.1), this.mats.dark);
    signFrame.position.set(cx - 20, 9.5, cz + D/2 + 0.28);
    g.add(signFrame);

    this.scene.add(g);
  }

  _buildTankFarm() {
    const g = new THREE.Group();
    const bx = 50, bz = 46;
    const tankMat = new THREE.MeshStandardMaterial({
      map: this._rep(this.tex.corr.color, 6, 4),
      normalMap: this._rep(this.tex.corr.normal, 6, 4),
      color: 0xc4cbd2, roughness: 0.34, metalness: 0.9, envMapIntensity: 1.3
    });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x9aa2aa, roughness: 0.45, metalness: 0.88 });

    for (let i = 0; i < 2; i++) {
      const z = bz - 6 + i*15, R = 3.4, L = 16;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 32), tankMat);
      body.rotation.z = Math.PI/2;
      body.position.set(bx, R+1.6, z);
      body.castShadow = true;
      g.add(body);
      for (const sx of [-1, 1]) {
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(R, 28, 14, 0, Math.PI*2, 0, Math.PI/2),
          capMat
        );
        cap.rotation.z = sx*Math.PI/2;
        cap.position.set(bx + sx*L/2, R+1.6, z);
        cap.castShadow = true;
        g.add(cap);
      }
      for (const dx of [-4, 0, 4]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R+0.04, 0.10, 8, 24), this.mats.dark);
        ring.rotation.y = Math.PI/2;
        ring.position.set(bx+dx, R+1.6, z);
        g.add(ring);
      }
      for (const off of [-5, 5]) {
        const saddle = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.7, R*2+0.7), this.mats.dark);
        saddle.position.set(bx+off, 0.85, z);
        saddle.castShadow = true;
        g.add(saddle);
        /* Фундаментный блок под седлом — заливает стык с землёй */
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(1.8, 0.15, R*2+1.0),
          this.mats.concrete
        );
        base.position.set(bx+off, 0.075, z);
        base.castShadow = true; base.receiveShadow = true;
        g.add(base);
      }
    }
    for (let i = 0; i < 3; i++) {
      const x = bx - 24 + i*8, z = bz + 16, R = 2.8, Ht = 14;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(R, R, Ht, 28), tankMat);
      t.position.set(x, Ht/2+0.9, z);
      t.castShadow = true;
      g.add(t);
      const top = new THREE.Mesh(
        new THREE.SphereGeometry(R, 28, 14, 0, Math.PI*2, 0, Math.PI/2),
        capMat
      );
      top.position.set(x, Ht+0.9, z);
      top.scale.y = 0.5;
      top.castShadow = true;
      g.add(top);
      const bs = new THREE.Mesh(
        new THREE.CylinderGeometry(R*1.2, R*1.3, 1.8, 24),
        this.mats.concrete
      );
      bs.position.set(x, 0.9, z);
      bs.castShadow = true; bs.receiveShadow = true;
      g.add(bs);
      for (let k = 1; k <= 3; k++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R+0.05, 0.12, 8, 32), this.mats.dark);
        ring.rotation.x = Math.PI/2;
        ring.position.set(x, Ht*(k/4)+0.9, z);
        g.add(ring);
      }
    }

    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x9b8f7a, roughness: 0.65, metalness: 0.6 });
    const xA = bx-24, xB = bx-8, zV = bz+16;
    g.add(this._pipe(V3(xA, 1.4, zV), V3(xB, 1.4, zV), 0.32, pipeMat));
    g.add(this._pipe(V3(xB, 1.4, zV), V3(xB, 1.4, bz+2), 0.32, pipeMat));
    g.add(this._pipe(V3(xB, 1.4, bz+2), V3(bx, 1.4, bz+2), 0.32, pipeMat));

    this.scene.add(g);
  }

  _buildConveyor() {
    const g = new THREE.Group();
    const a = V3(9.5, 14, -20);
    const b = V3(44, 8, -24);

    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const dirN = dir.clone().normalize();
    const mid = new THREE.Vector3().copy(a).addScaledVector(dir, 0.5);

    const beltMat = new THREE.MeshStandardMaterial({
      map: this._rep(this.tex.corr.color, len/3, 1),
      normalMap: this._rep(this.tex.corr.normal, len/3, 1),
      color: 0xb6bcc2, roughness: 0.45, metalness: 0.75
    });

    const inner = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 1.8, 3.6), beltMat);
    body.castShadow = true; body.receiveShadow = true;
    inner.add(body);

    const coverGeo = new THREE.CylinderGeometry(1.8, 1.8, len, 24, 1, false, 0, Math.PI);
    const cover = new THREE.Mesh(coverGeo, beltMat);
    cover.rotation.set(-Math.PI/2, 0, Math.PI/2);
    cover.position.y = 0.9;
    cover.castShadow = true;
    inner.add(cover);

    const ribCount = Math.max(2, Math.floor(len / 2.5));
    for (let i = 0; i <= ribCount; i++) {
      const x = -len/2 + (i / ribCount) * len;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.07, 6, 16, Math.PI), this.mats.dark);
      rib.rotation.y = Math.PI / 2;
      rib.position.set(x, 0.9, 0);
      rib.castShadow = true;
      inner.add(rib);
    }

    /* Торцевые крышки конвейера — закрывают открытые торцы */
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.CircleGeometry(1.8, 24, 0, Math.PI),
        this.mats.dark
      );
      cap.position.set(sx * len/2, 0.9, 0);
      cap.rotation.y = sx > 0 ? Math.PI/2 : -Math.PI/2;
      inner.add(cap);
    }

    const xAxis = dirN.clone();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const zAxis = new THREE.Vector3().crossVectors(worldUp, xAxis);
    if (zAxis.lengthSq() < 1e-6) zAxis.set(0, 0, 1);
    zAxis.normalize();
    const yAxis = new THREE.Vector3().crossVectors(xAxis, zAxis).normalize();
    inner.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    inner.position.copy(mid);
    g.add(inner);

    const nSup = 3;
    for (let i = 1; i <= nSup; i++) {
      const t = i / (nSup + 1);
      const p = new THREE.Vector3().copy(a).addScaledVector(dir, t);
      const topY = p.y - 0.9;
      const h = Math.max(0.5, topY);
      for (const dz of [-1.4, 1.4]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.42, h, 0.42), this.mats.dark);
        col.position.set(p.x, h/2, p.z + dz);
        col.castShadow = true;
        g.add(col);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 3.6), this.mats.dark);
      beam.position.set(p.x, topY - 0.16, p.z);
      beam.castShadow = true;
      g.add(beam);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.18, h * 0.9, 0.18), this.mats.dark);
      brace.position.set(p.x, h/2, p.z);
      brace.rotation.x = 0.4;
      brace.castShadow = true;
      g.add(brace);
    }
    this.scene.add(g);
  }

  _buildPipeRack() {
    const g = new THREE.Group();
    const x0 = -95, x1 = 15, zMain = 14, y = 5.0;

    const pipeMats = [
      new THREE.MeshStandardMaterial({ color: 0xb0a48c, roughness: 0.65, metalness: 0.55 }),
      new THREE.MeshStandardMaterial({ color: 0xa0a9b1, roughness: 0.5,  metalness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0xc9a97a, roughness: 0.7,  metalness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x8b9a8b, roughness: 0.55, metalness: 0.65 }),
      new THREE.MeshStandardMaterial({ color: 0xb9743a, roughness: 0.75, metalness: 0.3 })
    ];
    const lanes = [
      { yOff: 0.00, zOff: -1.1, r: 0.34, mat: 0 },
      { yOff: 0.00, zOff:  1.1, r: 0.30, mat: 1 },
      { yOff: 0.85, zOff: -0.55, r: 0.28, mat: 2 },
      { yOff: 0.85, zOff:  0.55, r: 0.26, mat: 3 },
      { yOff: 1.70, zOff:  0.00, r: 0.24, mat: 4 }
    ];
    lanes.forEach(lane => {
      const p1 = V3(x0, y + lane.yOff, zMain + lane.zOff);
      const p2 = V3(x1, y + lane.yOff, zMain + lane.zOff);
      g.add(this._pipe(p1, p2, lane.r, pipeMats[lane.mat], 12));
      const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0,1,0), dir);
      for (let x = x0 + 8; x <= x1 - 8; x += 18) {
        g.add(this._flange(V3(x, y + lane.yOff, zMain + lane.zOff), q, lane.r*1.3));
      }
      for (let x = x0 + 15; x <= x1 - 15; x += 40) {
        g.add(this._valveWheel(V3(x, y + lane.yOff + lane.r + 0.35, zMain + lane.zOff), q, 0.32));
      }
      /* Изоляционные сегменты на трубах */
      for (let x = x0 + 6; x <= x1 - 6; x += 6) {
        const wrap = new THREE.Mesh(
          new THREE.CylinderGeometry(lane.r*1.15, lane.r*1.15, 4.5, 12, 1, true),
          this.mats.insulation
        );
        wrap.rotation.z = Math.PI/2;
        wrap.position.set(x, y + lane.yOff, zMain + lane.zOff);
        g.add(wrap);
      }
    });

    for (let x = x0; x <= x1; x += 12) {
      for (const dz of [-1.9, 1.9]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, y+2.4, 0.4), this.mats.dark);
        col.position.set(x, (y+2.4)/2, zMain + dz);
        col.castShadow = true; col.receiveShadow = true;
        g.add(col);
      }
      for (const yy of [y-0.1, y+1.85]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 4.6), this.mats.dark);
        beam.position.set(x, yy, zMain);
        beam.castShadow = true;
        g.add(beam);
      }
      for (const s of [-1, 1]) {
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.18, y*1.05, 0.18), this.mats.dark);
        br.position.set(x, y/2 + 0.2, zMain + s*1.9);
        br.rotation.x = s*0.25;
        br.castShadow = true;
        g.add(br);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 4.6), this.mats.dark);
      top.position.set(x, y+2.3, zMain);
      top.castShadow = true;
      g.add(top);
    }
    this.scene.add(g);
  }

  _buildBoilerHouse() {
    const g = new THREE.Group();
    const W = 24, H = 13, D = 20, cx = -66, cz = 28;

    const body = this._detailedBox(W, H, D, this.tex.concrete.color, this.tex.concrete.normal, 4,
      { color: 0xd0ccc3, rough: 0.92 });
    body.position.set(cx, H/2, cz);
    g.add(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(W+1.2, 0.7, D+1.2), this.mats.roof);
    roof.position.set(cx, H+0.35, cz);
    roof.castShadow = true; roof.receiveShadow = true;
    g.add(roof);

    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.1, 0.3), this.mats.glass);
      w.position.set(cx - 8 + i*5.5, 8, cz + D/2 + 0.05);
      g.add(w);
      const wf = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.4, 0.14), this.mats.dark);
      wf.position.set(cx - 8 + i*5.5, 8, cz + D/2 + 0.14);
      g.add(wf);
      if (i % 2 === 0) {
        const lit = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.8), this.mats.glassLit);
        lit.position.set(cx - 8 + i*5.5, 8, cz + D/2 + 0.24);
        g.add(lit);
      }
      /* Подоконник */
      const sill = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.15, 0.5), this.mats.mid);
      sill.position.set(cx - 8 + i*5.5, 6.85, cz + D/2 + 0.25);
      g.add(sill);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.4, 0.3), this.mats.dark);
    door.position.set(cx + 9.5, 1.7, cz + D/2);
    g.add(door);

    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.15, 18, 24), this.mats.mid);
    stack.position.set(cx - 9, H + 9, cz - 4);
    stack.castShadow = true;
    g.add(stack);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.1, 8, 24), this.mats.steel);
    rim.rotation.x = Math.PI/2;
    rim.position.set(cx - 9, H + 18, cz - 4);
    g.add(rim);
    const innerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 24),
      new THREE.MeshBasicMaterial({ color: 0x0a0a0a })
    );
    innerDisc.rotation.x = -Math.PI/2;
    innerDisc.position.y = H + 18.01;
    g.add(innerDisc);

    this.scene.add(g);
  }

  _buildOffice() {
    const g = new THREE.Group();
    const W = 30, H = 12.5, D = 15, cx = -18, cz = 68;

    const body = this._detailedBox(W, H, D, this.tex.metalPanel.color, this.tex.metalPanel.normal, 3.4,
      { color: 0xded9d0, rough: 0.78, metal: 0.15 });
    body.position.set(cx, H/2, cz);
    g.add(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(W+0.8, 0.6, D+0.8), this.mats.roof);
    roof.position.set(cx, H+0.3, cz);
    roof.castShadow = true; roof.receiveShadow = true;
    g.add(roof);

    const dummy = new THREE.Object3D();
    const items = [];
    for (const y of [3.5, 7.0, 10.5])
      for (let x = -13; x <= 13; x += 3.1) {
        items.push({ p: V3(cx+x, y, cz + D/2 + 0.05), ry: 0,       out: V3(0,0, 1) });
        items.push({ p: V3(cx+x, y, cz - D/2 - 0.05), ry: Math.PI, out: V3(0,0,-1) });
      }
    const paneGeo = new THREE.BoxGeometry(2.6, 2.0, 0.3);
    const inst = new THREE.InstancedMesh(paneGeo, this.mats.glass, items.length);
    items.forEach((it, i) => {
      dummy.position.copy(it.p).addScaledVector(it.out, 0.06);
      dummy.rotation.set(0, it.ry, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);

    const frameGeo = new THREE.BoxGeometry(2.9, 2.3, 0.14);
    const frameInst = new THREE.InstancedMesh(frameGeo, this.mats.dark, items.length);
    items.forEach((it, i) => {
      dummy.position.copy(it.p).addScaledVector(it.out, -0.02);
      dummy.rotation.set(0, it.ry, 0);
      dummy.updateMatrix();
      frameInst.setMatrixAt(i, dummy.matrix);
    });
    frameInst.instanceMatrix.needsUpdate = true;
    g.add(frameInst);

    const litItems = items.filter(() => Math.random() < 0.4);
    const lit = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.3, 1.7), this.mats.glassLit, litItems.length);
    litItems.forEach((it, i) => {
      dummy.position.copy(it.p).addScaledVector(it.out, 0.22);
      dummy.rotation.set(0, it.ry, 0);
      dummy.updateMatrix();
      lit.setMatrixAt(i, dummy.matrix);
    });
    lit.instanceMatrix.needsUpdate = true;
    g.add(lit);

    /* Подоконники */
    const sillGeo = new THREE.BoxGeometry(3.0, 0.15, 0.4);
    const sillInst = new THREE.InstancedMesh(sillGeo, this.mats.mid, items.length);
    items.forEach((it, i) => {
      dummy.position.copy(it.p).addScaledVector(it.out, 0.28);
      dummy.position.y -= 1.2;
      dummy.rotation.set(0, it.ry, 0);
      dummy.updateMatrix();
      sillInst.setMatrixAt(i, dummy.matrix);
    });
    sillInst.instanceMatrix.needsUpdate = true;
    g.add(sillInst);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(8, 0.25, 3.5), this.mats.mid);
    canopy.position.set(cx, 3.9, cz + D/2 + 1.8);
    canopy.castShadow = true;
    g.add(canopy);
    for (const dx of [-3.6, 3.6]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 4.0, 12), this.mats.mid);
      col.position.set(cx + dx, 2.0, cz + D/2 + 3.2);
      col.castShadow = true;
      g.add(col);
    }

    /* Вывеска на офисном здании */
    const signMat = new THREE.MeshStandardMaterial({ map: this.tex.sign.color, roughness: 0.85 });
    const signPlate = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), signMat);
    signPlate.position.set(cx, 10, cz + D/2 + 0.45);
    g.add(signPlate);
    const signFrame = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.4, 0.1), this.mats.dark);
    signFrame.position.set(cx, 10, cz + D/2 + 0.38);
    g.add(signFrame);

    this.scene.add(g);
  }

  _buildFence() {
    const addSeg = (a, b) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const H = 3.4;

      const t = this.tex.fence.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(len/1.6, H/1.6);
      t.needsUpdate = true;

      const mat = new THREE.MeshStandardMaterial({
        map: t, transparent: true, alphaTest: 0.4,
        side: THREE.DoubleSide, roughness: 0.55, metalness: 0.7
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, H), mat);
      mesh.position.set(mid.x, H/2 + 0.3, mid.z);
      mesh.rotation.y = Math.atan2(-dir.z, dir.x);
      this.scene.add(mesh);

      const count = Math.max(2, Math.round(len / 4));
      const postGeo = new THREE.CylinderGeometry(0.09, 0.09, H + 0.5, 8);
      const posts = new THREE.InstancedMesh(postGeo, this.mats.dark, count + 1);
      const dummy = new THREE.Object3D();
      for (let i = 0; i <= count; i++) {
        const p = new THREE.Vector3().copy(a).lerp(b, i / count);
        dummy.position.set(p.x, (H+0.5)/2, p.z);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
      }
      posts.instanceMatrix.needsUpdate = true;
      posts.castShadow = true;
      this.scene.add(posts);

      /* Фундаментные плиты под постами — заливают стык с землёй */
      for (let i = 0; i <= count; i++) {
        const p = new THREE.Vector3().copy(a).lerp(b, i / count);
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.3, 0.3, 10),
          this.mats.concrete
        );
        base.position.set(p.x, 0.15, p.z);
        base.receiveShadow = true;
        this.scene.add(base);
      }

      const railGeo = new THREE.CylinderGeometry(0.04, 0.04, len, 6);
      railGeo.rotateZ(Math.PI/2);
      const rail = new THREE.Mesh(railGeo, this.mats.dark);
      rail.position.set(mid.x, H + 0.25, mid.z);
      rail.rotation.y = Math.atan2(-dir.z, dir.x) + Math.PI/2;
      this.scene.add(rail);
    };

    const X0 = -140, X1 = 140, Z0 = -110, Z1 = 110, GAP = 10;
    addSeg(V3(X0, 0, Z0), V3(X1, 0, Z0));
    addSeg(V3(X0, 0, Z0), V3(X0, 0, Z1));
    addSeg(V3(X1, 0, Z0), V3(X1, 0, Z1));
    addSeg(V3(X0, 0, Z1), V3(-GAP, 0, Z1));
    addSeg(V3(GAP, 0, Z1), V3(X1, 0, Z1));
  }

  _buildGate() {
    const g = new THREE.Group();
    const z = 110;

    for (const x of [-10, 10]) {
      const pil = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 6.2, 1.6),
        this.mats.concrete
      );
      pil.position.set(x, 3.1, z);
      pil.castShadow = true; pil.receiveShadow = true;
      g.add(pil);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.4, 2.0), this.mats.mid);
      cap.position.set(x, 6.4, z);
      cap.castShadow = true;
      g.add(cap);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x27c45c, emissive: 0x27c45c, emissiveIntensity: 2.5 })
      );
      lamp.position.set(x, 5.9, z + 0.9);
      g.add(lamp);
    }

    const gateMat = new THREE.MeshStandardMaterial({ color: 0x3b4650, roughness: 0.55, metalness: 0.7 });
    const gateGroup = new THREE.Group();
    for (const y of [0.5, 5.4]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(19, 0.24, 0.24), gateMat);
      bar.position.set(0, y, 0); bar.castShadow = true; gateGroup.add(bar);
    }
    for (let i = 0; i < 9; i++) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.0, 0.2), gateMat);
      v.position.set(-9 + i*2.25, 2.95, 0); v.castShadow = true; gateGroup.add(v);
    }
    for (const y of [1.6, 2.9, 4.2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(19, 0.16, 0.16), gateMat);
      bar.position.set(0, y, 0); gateGroup.add(bar);
    }
    for (const y of [0.3, 5.6]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(24, 0.16, 0.16), this.mats.mid);
      r.position.set(0, y, -0.4); g.add(r);
    }
    gateGroup.position.set(0, 0, z + 0.2); g.add(gateGroup);

    const kp = new THREE.Group();
    const kb = this._detailedBox(8, 4.5, 6, this.tex.concrete.color, this.tex.concrete.normal, 3,
      { color: 0xe4e0d7, rough: 0.9 });
    kb.position.y = 2.25; kp.add(kb);
    const kroof = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 7), this.mats.roof);
    kroof.position.y = 4.75; kroof.castShadow = true; kp.add(kroof);
    const kwin = new THREE.Mesh(new THREE.BoxGeometry(6, 1.8, 0.3), this.mats.glass);
    kwin.position.set(0, 2.9, 3.05); kp.add(kwin);
    const klit = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.5), this.mats.glassLit);
    klit.position.set(0, 2.9, 3.28); kp.add(klit);
    const kdoor = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.0, 0.2), this.mats.dark);
    kdoor.position.set(2.6, 1.5, 3.05); kp.add(kdoor);
    kp.position.set(16, 0, 102); g.add(kp);

    const barBase = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.2, 12), this.mats.mid);
    barBase.position.set(12, 0.6, z);
    barBase.castShadow = true;
    g.add(barBase);

    const pivotY = 1.2;
    const barMat = new THREE.MeshStandardMaterial({ color: 0xd94b3a, roughness: 0.6 });
    const barMatW = new THREE.MeshStandardMaterial({ color: 0xf0eee6, roughness: 0.6 });
    const segLen = 8 / 6;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(segLen, 0.22, 0.22),
        i % 2 === 0 ? barMat : barMatW
      );
      seg.position.set(12 + segLen/2 + i*segLen, pivotY, z);
      seg.castShadow = true;
      g.add(seg);
    }
    const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), this.mats.dark);
    hinge.position.set(12, pivotY, z);
    hinge.castShadow = true;
    g.add(hinge);

    this.scene.add(g);
  }

  _buildLamps() {
    const make = (x, z, rotY = 0, height = 9) => {
      const g = new THREE.Group();
      /* Фундаментный блок у основания — закрывает стык с землёй */
      const foundation = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.7, 0.4, 12),
        this.mats.concrete
      );
      foundation.position.y = 0.2;
      foundation.castShadow = true; foundation.receiveShadow = true;
      g.add(foundation);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, height, 14), this.mats.dark);
      pole.position.y = height/2 + 0.4;
      pole.castShadow = true;
      g.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.5, 14), this.mats.dark);
      base.position.y = 0.65; base.castShadow = true;
      g.add(base);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.18), this.mats.dark);
      arm.position.set(1.1, height + 0.3, 0);
      arm.castShadow = true;
      g.add(arm);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.38, 0.95),
        new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.5, metalness: 0.75 })
      );
      head.position.set(2.1, height + 0.05, 0);
      head.castShadow = true;
      g.add(head);
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 0.8),
        new THREE.MeshStandardMaterial({
          color: 0xfff0c0, emissive: 0xffe6a8, emissiveIntensity: 1.6, side: THREE.DoubleSide
        })
      );
      glass.position.set(2.1, height - 0.16, 0);
      glass.rotation.x = Math.PI/2;
      g.add(glass);
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      this.scene.add(g);
    };
    [[-100, 65, 0],[-50, 92, 0],[50, 92, 0],[100, 65, 0],
     [100, -20, Math.PI],[-100, -20, Math.PI],[0, 35, 0],[0, -5, Math.PI],
     [50, -90, 0],[-50, -90, 0]].forEach(a => make(...a));
  }

  _buildForklifts() {
    const make = (x, z, rotY = 0) => {
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe4a52b, roughness: 0.5, metalness: 0.35 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 2.4), bodyMat);
      body.position.y = 0.9;
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);

      for (const sx of [-0.6, 0.6]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 0.08), this.mats.dark);
        bar.position.set(sx, 2.3, -0.9);
        g.add(bar);
      }
      for (const sz of [-0.9, 0.9]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.08, 0.08), this.mats.dark);
        bar.position.set(0, 3.15, sz);
        g.add(bar);
      }
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.5), this.mats.dark);
      seat.position.set(0, 1.55, -0.3);
      g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.1), this.mats.dark);
      back.position.set(0, 1.95, -0.55);
      g.add(back);

      for (const sx of [-0.5, 0.5]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.0, 0.12), this.mats.dark);
        rail.position.set(sx, 1.6, 1.35);
        g.add(rail);
      }
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.1), this.mats.dark);
      carriage.position.set(0, 0.8, 1.42);
      g.add(carriage);
      for (const sx of [-0.4, 0.4]) {
        const fork = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 1.0), this.mats.steel);
        fork.position.set(sx, 0.8, 1.9);
        g.add(fork);
      }
      const wGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 16);
      wGeo.rotateZ(Math.PI/2);
      for (const [wx, wz] of [[0.75, 0.7], [-0.75, 0.7], [0.85, -0.7], [-0.85, -0.7]]) {
        const w = new THREE.Mesh(wGeo, this.mats.rubber);
        w.position.set(wx, 0.38, wz);
        w.castShadow = true;
        g.add(w);
      }
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      this.scene.add(g);
    };
    make(92, -22, Math.PI * 0.3);
    make(-40, 88, -Math.PI * 0.6);
  }

  _buildCratesBarrelsContainers() {
    const crateMat = new THREE.MeshStandardMaterial({
      map: this._rep(this.tex.brick.color, 1, 1),
      color: 0xa08560, roughness: 0.95
    });
    const crate = (x, y, z, s = 1.5, rot = 0) => {
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      c.position.set(x, y + s/2, z);
      c.rotation.y = rot;
      c.castShadow = true; c.receiveShadow = true;
      this.scene.add(c);
    };
    [[96,-46],[98.5,-44],[97,-48.5],[100,-47],[94,-43],[99,-50],[96.5,-45.5]].forEach(([x, z], i) => {
      crate(x, 0, z, 1.5, Math.random() * 0.6);
      if (i % 2 === 0) crate(x, 1.5, z, 1.5, Math.random() * 0.6);
      if (i % 3 === 0) crate(x, 3.0, z, 1.3, Math.random() * 0.6);
    });

    const barrel = (x, z, color = 0x2f6b8f) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.75 });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.35, 20), mat);
      b.position.set(x, 0.68, z);
      b.castShadow = true; b.receiveShadow = true;
      this.scene.add(b);
    };
    for (let i = 0; i < 10; i++) barrel(-76 + i*1.1, 48 + (i%2)*1.1, i%3 === 0 ? 0xb8492c : 0x2f6b8f);
    for (let i = 0; i < 6; i++)  barrel(110 + (i%3)*1.1, -40 - Math.floor(i/3)*1.1);

    const container = (x, z, rotY, color) => {
      const c = new THREE.Mesh(
        new THREE.BoxGeometry(12, 2.6, 2.8),
        new THREE.MeshStandardMaterial({
          map: this._rep(this.tex.corr.color, 6, 2),
          normalMap: this._rep(this.tex.corr.normal, 6, 2),
          color, roughness: 0.72, metalness: 0.42
        })
      );
      c.position.set(x, 1.3, z);
      c.rotation.y = rotY;
      c.castShadow = true; c.receiveShadow = true;
      this.scene.add(c);

      const c2 = c.clone(); c2.position.y = 3.9; this.scene.add(c2);
      const c3 = c.clone(); c3.position.y = 6.5; c3.rotation.y = 0;
      c3.material = new THREE.MeshStandardMaterial({
        map: this._rep(this.tex.corr.color, 6, 2),
        normalMap: this._rep(this.tex.corr.normal, 6, 2),
        color: 0xa8452f, roughness: 0.72, metalness: 0.42
      });
      this.scene.add(c3);
    };
    container(88, -66, 0, 0x2f6b8f);
    container(88, -74, 0, 0x3d7a45);
    container(88, -82, 0, 0xb8862f);
  }

  /** Таблички по территории. */
  _buildSigns() {
    const signMat = new THREE.MeshStandardMaterial({ map: this.tex.sign.color, roughness: 0.85 });

    const placeSign = (x, y, z, ry) => {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, y, 8),
        this.mats.dark
      );
      pole.position.set(x, y/2, z);
      pole.castShadow = true;
      this.scene.add(pole);

      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), signMat);
      plate.position.set(x, y - 0.55, z);
      plate.rotation.y = ry;
      this.scene.add(plate);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 1.3, 0.06),
        this.mats.dark
      );
      frame.position.set(x, y - 0.55, z);
      frame.rotation.y = ry;
      this.scene.add(frame);
    };
    placeSign(-30, 2.6, -40, 0);
    placeSign(40, 2.6, -10, -Math.PI/2);
    placeSign(-60, 2.6, 40, Math.PI);
    placeSign(60, 2.6, 20, 0);
  }

  /** Сеть кабелей и воздушных линий между зданиями. */
  _buildCableNetwork() {
    const g = new THREE.Group();

    /* Кабели между главным цехом и складом */
    g.add(this._cableBetween(
      V3(-30 + 37, 22.7, -12), V3(66, 13, -26),
      1.8, 0.05, this.mats.cable
    ));
    /* Второй кабель параллельно */
    g.add(this._cableBetween(
      V3(-30 + 37, 21.5, -12 + 4), V3(66, 12, -26 + 4),
      1.8, 0.04, this.mats.cable
    ));

    /* Кабели между главным цехом и силосами */
    g.add(this._cableBetween(
      V3(-30 + 20, 22.7, -12 + 19), V3(0, 26, -60),
      1.4, 0.045, this.mats.cable
    ));

    /* Кабели от котельной к офису */
    g.add(this._cableBetween(
      V3(-66, 13.35, 28 + 10), V3(-18, 12.8, 68 - 7),
      1.6, 0.04, this.mats.cable
    ));

    /* Внутренние кабельные лотки на стене главного цеха (по бокам) */
    for (let i = 0; i < 5; i++) {
      const x = -30 - 37/2 + 6 + i * 14;
      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.15, 0.1),
        this.mats.dark
      );
      tray.position.set(x, 22.85, -12 + 19 + 0.4);
      g.add(tray);
    }

    this.scene.add(g);
  }

  _buildPlumes() {
    const smokeTex = this.tex.smoke;
    const scene = this.scene;
    const makePlume = (origin, opts) => {
      const o = Object.assign({
        count: 36, rise: 1.0, spread: 1.4, scale: 6, opacity: 0.45,
        drift: V3(1, 0, 0.25), color: 0xcfd3d8, travel: 28, lift: 34,
        rotate: 1.6, wobbleFreq: 0.7
      }, opts);
      const originCopy = origin.clone();
      const parts = [];
      const group = new THREE.Group();
      for (let i = 0; i < o.count; i++) {
        const mat = new THREE.SpriteMaterial({
          map: smokeTex, transparent: true, depthWrite: false,
          opacity: 0, color: o.color, fog: true
        });
        const sp = new THREE.Sprite(mat);
        sp.frustumCulled = false;
        parts.push({
          sp,
          life: Math.random(),
          speed: o.rise * (0.8 + Math.random()*0.5),
          phase: Math.random() * Math.PI * 2,
          jx: (Math.random() - 0.5) * 2,
          jz: (Math.random() - 0.5) * 2
        });
        group.add(sp);
      }
      scene.add(group);

      this._plumes.push({
        update: (dt, t) => {
          for (const p of parts) {
            p.life += dt * 0.14 * p.speed;
            if (p.life > 1) p.life -= 1;
            const l = p.life;
            const size = o.scale * (0.4 + l * 2.0);
            p.sp.scale.set(size, size, 1);
            const wob = Math.sin(t * o.wobbleFreq + p.phase) * o.spread;
            const wob2 = Math.cos(t * o.wobbleFreq * 0.74 + p.phase * 1.4) * o.spread;
            p.sp.position.set(
              originCopy.x + o.drift.x * l * o.travel + wob + p.jx * l * 3,
              originCopy.y + l * o.lift,
              originCopy.z + o.drift.z * l * o.travel + wob2 + p.jz * l * 3
            );
            p.sp.material.opacity = o.opacity * Math.sin(Math.PI * Math.pow(l, 0.55));
            p.sp.material.rotation = l * o.rotate + p.phase;
          }
        }
      });
    };

    makePlume(V3(this.chimA.x, this.chimA.height + 1.2, this.chimA.z), {
      count: 42, rise: 1.05, spread: 1.6, scale: 6.6, opacity: 0.42,
      color: 0xc9ccd0, drift: V3(1, 0, 0.28), travel: 38, lift: 46
    });
    makePlume(V3(this.chimB.x, this.chimB.height + 1.2, this.chimB.z), {
      count: 34, rise: 0.95, spread: 1.4, scale: 5.4, opacity: 0.36,
      color: 0xcdd0d4, drift: V3(1, 0, 0.28), travel: 32, lift: 38
    });
    makePlume(V3(this.tower.x, this.tower.H + 1.5, this.tower.z), {
      count: 36, rise: 0.55, spread: 2.8, scale: 12, opacity: 0.24,
      color: 0xf0f3f6, drift: V3(0.9, 0, 0.34), travel: 44, lift: 30, rotate: 0.8
    });
    makePlume(V3(-72, 15, 24), {
      count: 18, rise: 1.4, spread: 0.9, scale: 3.2, opacity: 0.35,
      color: 0xe4e8ec, drift: V3(0.8, 0, 0.4), travel: 18, lift: 22, rotate: 1.2
    });
    makePlume(V3(-68, 13, 30), {
      count: 14, rise: 1.2, spread: 0.9, scale: 2.8, opacity: 0.3,
      color: 0xe4e8ec, drift: V3(0.8, 0, 0.4), travel: 16, lift: 20, rotate: 1.2
    });
  }

  _buildDust() {
    const N = 300;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i*3]   = (Math.random() - 0.5) * 300;
      pos[i*3+1] =  Math.random() * 45;
      pos[i*3+2] = (Math.random() - 0.5) * 300;
      vel[i*3]   = 0.3 + Math.random() * 0.7;
      vel[i*3+1] = 0.05 + Math.random() * 0.1;
      vel[i*3+2] = (Math.random() - 0.5) * 0.3;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xd8cdb6, size: 0.35, transparent: true, opacity: 0.35,
      depthWrite: false, blending: THREE.AdditiveBlending,
      sizeAttenuation: true, map: this.tex.dust
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);

    this._dust = { geo, vel, count: N };
  }

  /* ================================================================
     КОЛЛАЙДЕРЫ — точные габариты и правильные стыки
     ================================================================ */
  _registerColliders() {
    const C = this._colliders;

    /* Главный цех: стены 0–22, карниз 22–23.4, крыша 23.4–24 */
    C.addBoxFromSize(-30, 12, -12, 74, 24, 38);

    /* Склад: стены 0–13, крыша-конёк 13–18.5 */
    C.addBoxFromSize(66, 6.5, -26, 52, 13, 30);
    C.addBoxFromSize(66, 15.75, -26, 54.4, 5.5, 32.4);
    C.addBoxFromSize(66, 0.7, -26 + 19, 58, 1.4, 8);

    /* Котельная */
    C.addBoxFromSize(-66, 6.5, 28, 24, 13, 20);
    C.addBoxFromSize(-66, 13.35, 28, 25.2, 0.7, 21.2);

    /* Админкорпус */
    C.addBoxFromSize(-18, 6.25, 68, 30, 12.5, 15);
    C.addBoxFromSize(-18, 12.8, 68, 30.8, 0.6, 15.8);

    /* Трубы */
    C.addCylinder(-58, -48, 3.2, 0, 53);
    C.addCylinder(-38, -58, 2.7, 0, 43);
    C.addCylinder(-72, 24, 0.65, 0, 14.5);
    C.addCylinder(-68, 30, 0.65, 0, 12.5);

    /* Градирня — тело + бассейн */
    C.addCylinder(-92, -38, 15, 0, 38);
    C.addCylinder(-92, -38, this.tower.poolR + 1.2, 0, 1.4);

    /* Силосы + галерея */
    [-12, 4, 20, 36].forEach(x => C.addCylinder(x, -60, 4.6, 0, 26.6));
    C.addBoxFromSize(12, 26.4, -60, 46, 0.4, 2.4);

    /* Танковый парк */
    C.addBoxFromSize(50, 3.0, 40, 16, 6, 7);
    C.addBoxFromSize(50, 3.0, 55, 16, 6, 7);
    [26, 34, 42].forEach(x => C.addCylinder(x, 62, 2.8, 0, 15));

    /* Конвейер */
    C.addBoxFromSize(26.75, 8, -22, 36, 12, 4);

    /* Трубная эстакада */
    for (let x = -95; x <= 15; x += 12) {
      C.addBoxFromSize(x, 3.7, 12.1, 0.5, 7.4, 0.5);
      C.addBoxFromSize(x, 3.7, 15.9, 0.5, 7.4, 0.5);
    }
    C.addBoxFromSize(-40, 6.15, 14, 112, 3.1, 4.2);

    /* Ворота + КПП */
    C.addBoxFromSize(-10, 3.1, 110, 1.6, 6.2, 1.6);
    C.addBoxFromSize( 10, 3.1, 110, 1.6, 6.2, 1.6);
    C.addBoxFromSize( 16, 2.25, 102, 8, 4.5, 6);

    /* Забор */
    const TH = 0.22;
    const X0 = -140, X1 = 140, Z0 = -110, Z1 = 110, GAP = 10;
    C.addBoxFromSize((X0+X1)/2, 1.7, Z0, X1-X0, 3.4, TH);
    C.addBoxFromSize(X0, 1.7, (Z0+Z1)/2, TH, 3.4, Z1-Z0);
    C.addBoxFromSize(X1, 1.7, (Z0+Z1)/2, TH, 3.4, Z1-Z0);
    C.addBoxFromSize((X0-GAP)/2, 1.7, Z1, GAP-X0, 3.4, TH);
    C.addBoxFromSize((GAP+X1)/2, 1.7, Z1, X1-GAP, 3.4, TH);

    /* Фонари */
    [[-100, 65],[-50, 92],[50, 92],[100, 65],[100, -20],
     [-100, -20],[0, 35],[0, -5],[50, -90],[-50, -90]]
      .forEach(([x, z]) => C.addCylinder(x, z, 0.28, 0, 9.4));

    /* Ящики / контейнеры */
    [[96,-46],[98.5,-44],[97,-48.5],[100,-47],[94,-43],[99,-50],[96.5,-45.5]]
      .forEach(([x, z]) => C.addBoxFromSize(x, 1.5, z, 2.0, 3.0, 2.0));
    [[88,-66],[88,-74],[88,-82]].forEach(([x, z]) =>
      C.addBoxFromSize(x, 3.9, z, 12, 7.8, 2.8)
    );

    /* Бочки */
    C.addCylinder(-70, 48, 1.4, 0, 1.4);
    C.addCylinder(110, -40, 1.0, 0, 1.4);

    /* Ж/Д цистерны */
    C.addBoxFromSize(-40, 2, 30, 13, 4, 2.8);
    C.addBoxFromSize(-20, 2, 30, 13, 4, 2.8);
    C.addBoxFromSize( 20, 2, 30, 13, 4, 2.8);
  }

  /* ================================================================
     СОБЫТИЯ
     ================================================================ */
  _attachEvents() {
    this._onWindowResize = () => this.resize();
    window.addEventListener('resize', this._onWindowResize);

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObs = new ResizeObserver(() => this.resize());
      this._resizeObs.observe(this.container);
    }

    this._onKeyToggle = (e) => {
      if ((e.code === 'Tab' || e.code === 'KeyF') && !e.repeat) {
        e.preventDefault();
        this.setWalkMode(!this._walkMode);
      }
    };
    window.addEventListener('keydown', this._onKeyToggle);
  }

  /* ================================================================
     WALK MODE
     ================================================================ */
  setWalkMode(enable = true) {
    if (enable === this._walkMode) return;
    this._walkMode = enable;

    if (enable) {
      this._savedCamPos = this.camera.position.clone();
      this._savedTarget = this.controls.target.clone();

      const start = this.camera.position.clone();
      let sx = start.x, sz = start.z;
      const probe = new THREE.Vector3(sx, 0.9, sz);
      if (!this._colliders.isFree(probe, 0.45)) {
        outer:
        for (let r = 1; r <= 40; r += 1) {
          for (let a = 0; a < 32; a++) {
            const ang = (a / 32) * Math.PI * 2;
            const tx = start.x + Math.cos(ang) * r;
            const tz = start.z + Math.sin(ang) * r;
            if (this._colliders.isFree(V3(tx, 0.9, tz), 0.45)) {
              sx = tx; sz = tz;
              break outer;
            }
          }
        }
      }

      this._player = {
        pos: new THREE.Vector3(sx, 0, sz),
        vel: new THREE.Vector3(),
        onGround: true,
        yaw: Math.atan2(
          this.camera.position.x - this.controls.target.x,
          this.camera.position.z - this.controls.target.z
        ) + Math.PI,
        pitch: -0.15,
        radius: 0.4,
        eye: 1.7
      };

      this.controls.enabled = false;
      this.renderer.domElement.requestPointerLock?.();

      this._onMouseMove = (e) => {
        if (document.pointerLockElement !== this.renderer.domElement) return;
        const p = this._player;
        p.yaw -= e.movementX * 0.0022;
        p.pitch -= e.movementY * 0.0022;
        p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
      };
      document.addEventListener('mousemove', this._onMouseMove);

      this._onKey = (e) => {
        this._keys[e.code] = e.type === 'keydown';
        if (e.code === 'Space' && e.type === 'keydown' && this._player.onGround) {
          this._player.vel.y = 5.2;
          this._player.onGround = false;
        }
      };
      window.addEventListener('keydown', this._onKey);
      window.addEventListener('keyup', this._onKey);

      this._onLockChange = () => {
        if (this._walkMode && document.pointerLockElement !== this.renderer.domElement) {
          this.setWalkMode(false);
        }
      };
      document.addEventListener('pointerlockchange', this._onLockChange);

    } else {
      this.controls.enabled = true;
      if (this._savedCamPos) this.camera.position.copy(this._savedCamPos);
      if (this._savedTarget) this.controls.target.copy(this._savedTarget);
      document.exitPointerLock?.();

      document.removeEventListener('mousemove', this._onMouseMove);
      window.removeEventListener('keydown', this._onKey);
      window.removeEventListener('keyup', this._onKey);
      document.removeEventListener('pointerlockchange', this._onLockChange);

      this._keys = Object.create(null);
    }

    this.container.dispatchEvent(new CustomEvent('walkmodechange', {
      detail: { enabled: enable }
    }));
  }

  /* ================================================================
     ИГРОК — подшаги, рейкаст пола, устойчивый step-up
     ================================================================ */
  _updatePlayer(dt) {
    const p = this._player;
    const bodyR = p.radius;
    const eyeOff = p.eye;

    /* ---- Ввод ---- */
    const speed = 5.5;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);

    let mx = 0, mz = 0;
    if (this._keys['KeyW'] || this._keys['ArrowUp']) { mx += fx; mz += fz; }
    if (this._keys['KeyS'] || this._keys['ArrowDown']) { mx -= fx; mz -= fz; }
    if (this._keys['KeyD'] || this._keys['ArrowRight']) { mx += rx; mz += rz; }
    if (this._keys['KeyA'] || this._keys['ArrowLeft']) { mx -= rx; mz -= rz; }
    const mlen = Math.hypot(mx, mz);
    if (mlen > 0) { mx = (mx / mlen) * speed; mz = (mz / mlen) * speed; }

    p.vel.x = mx;
    p.vel.z = mz;
    p.vel.y -= 14 * dt;

    /* ---- Подшаги для точности при высокой скорости ---- */
    const moveLen = Math.hypot(p.vel.x * dt, p.vel.z * dt);
    const steps = Math.max(1, Math.ceil(moveLen / (bodyR * 0.8)));
    const subDt = dt / steps;

    for (let s = 0; s < steps; s++) {
      const stepX = p.vel.x * subDt;
      const stepZ = p.vel.z * subDt;
      const stepY = p.vel.y * subDt;

      const nextPos = this._tmp1.set(
        p.pos.x + stepX,
        p.pos.y + stepY,
        p.pos.z + stepZ
      );

      /* Разрешение коллизии в двух точках: ноги и голова */
      const probeBody = this._tmp2.copy(nextPos);
      this._colliders.resolveSphere(probeBody, bodyR, probeBody);

      const headProbe = V3(nextPos.x, nextPos.y + eyeOff - 0.2, nextPos.z);
      this._colliders.resolveSphere(headProbe, bodyR * 0.9, headProbe);
      headProbe.y -= eyeOff - 0.2;

      /* Берём максимальное смещение от исходной точки */
      const dxB = Math.hypot(probeBody.x - nextPos.x, probeBody.z - nextPos.z);
      const dxH = Math.hypot(headProbe.x - nextPos.x, headProbe.z - nextPos.z);

      let resolved = (dxB >= dxH) ? probeBody : headProbe;

      /* ---- Step-up ---- */
      const horizontalBlocked = (Math.abs(resolved.x - nextPos.x) + Math.abs(resolved.z - nextPos.z)) >
        (Math.abs(stepX) + Math.abs(stepZ)) * 0.3;

      if (horizontalBlocked && p.onGround) {
        const stepHeight = 0.6;
        const testBody = V3(
          p.pos.x + stepX,
          p.pos.y + stepHeight,
          p.pos.z + stepZ
        );
        const testBodyResolved = testBody.clone();
        this._colliders.resolveSphere(testBodyResolved, bodyR, testBodyResolved);

        const testHead = V3(testBody.x, testBody.y + eyeOff - 0.2, testBody.z);
        const testHeadResolved = testHead.clone();
        this._colliders.resolveSphere(testHeadResolved, bodyR * 0.9, testHeadResolved);

        const stepOk = (
          Math.hypot(testBodyResolved.x - testBody.x, testBodyResolved.z - testBody.z) < 0.05 &&
          Math.hypot(testHeadResolved.x - testHead.x, testHeadResolved.z - testHead.z) < 0.05
        );

        if (stepOk) {
          resolved = testBody;
          p.vel.y = 0;
          p.onGround = true;
        }
      }

      /* ---- Пол под игроком через рейкаст ---- */
      const groundY = this._colliders.floorHeightAt(
        resolved.x, resolved.z, resolved.y + 2.0, resolved.y - 2.0
      );

      if (resolved.y <= groundY + 0.001) {
        resolved.y = groundY;
        if (p.vel.y < 0) p.vel.y = 0;
        p.onGround = true;
      } else {
        p.onGround = false;
      }

      /* Универсальная нижняя граница */
      if (resolved.y < 0) {
        resolved.y = 0;
        if (p.vel.y < 0) p.vel.y = 0;
        p.onGround = true;
      }

      p.pos.copy(resolved);
    }

    /* ---- Камера ---- */
    this.camera.position.set(p.pos.x, p.pos.y + p.eye, p.pos.z);

    const cp = Math.cos(p.pitch);
    const lookX = -Math.sin(p.yaw) * cp;
    const lookY = Math.sin(p.pitch);
    const lookZ = -Math.cos(p.yaw) * cp;
    this.camera.lookAt(
      this.camera.position.x + lookX,
      this.camera.position.y + lookY,
      this.camera.position.z + lookZ
    );
  }

  /* ================================================================
     Камера-коллизия в orbit режиме — многолучевое сэмплирование
     ================================================================ */
  _applyCameraCollision() {
    const t = this.controls.target;
    const c = this.camera.position;
    const dir = this._tmp2.copy(c).sub(t);
    const wantDist = dir.length();
    if (wantDist < 1e-4) return;
    dir.normalize();

    const PAD = 0.6;
    const maxDist = wantDist + PAD;

    /* Сэмплируем несколько лучей, чтобы избежать "проскоков" через углы */
    const up = V3(0, 1, 0);
    let right = new THREE.Vector3().crossVectors(dir, up);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const upV = new THREE.Vector3().crossVectors(right, dir).normalize();

    /* Массив смещений: центр + кольцо вокруг */
    const offsets = [
      V3(0, 0, 0),
      V3(0.35, 0, 0),
      V3(-0.35, 0, 0),
      V3(0, 0.35, 0),
      V3(0, -0.35, 0)
    ];

    let minHit = maxDist;
    for (const off of offsets) {
      const sampleOrigin = t.clone()
        .addScaledVector(right, off.x)
        .addScaledVector(upV, off.y);
      const sampleDir = dir.clone();
      const hit = this._colliders.raycast(sampleOrigin, sampleDir, maxDist);
      if (hit < minHit) minHit = hit;
    }

    if (minHit < maxDist) {
      const d = Math.max(minHit - PAD, this.controls.minDistance);
      c.copy(t).addScaledVector(dir, d);
    }
  }

  /* ================================================================
     ЦИКЛ
     ================================================================ */
  _startLoop() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(this._clock.getDelta(), 0.05);
      this._elapsed += dt;

      for (const p of this._plumes) p.update(dt, this._elapsed);

      for (let i = 0; i < this._chimneys.length; i++) {
        const c = this._chimneys[i];
        c.lampMat.emissiveIntensity =
          Math.sin(this._elapsed * 2.2 + i * 1.3) > 0.4 ? 4.5 : 0.15;
      }

      if (this._dust) {
        const arr = this._dust.geo.attributes.position.array;
        const v = this._dust.vel;
        for (let i = 0; i < this._dust.count; i++) {
          arr[i*3]   += v[i*3]   * dt;
          arr[i*3+1] += v[i*3+1] * dt;
          arr[i*3+2] += v[i*3+2] * dt;
          if (arr[i*3] > 150) { arr[i*3] = -150; arr[i*3+1] = Math.random() * 40; }
          if (arr[i*3+1] > 45) arr[i*3+1] = 0.5;
        }
        this._dust.geo.attributes.position.needsUpdate = true;
      }

      if (this._walkMode) {
        this._updatePlayer(dt);
      } else {
        this.controls.update();
        this._applyCameraCollision();
      }

      this.composer.render();
    };
    loop();
  }
}