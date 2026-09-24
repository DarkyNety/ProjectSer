/* ============================================================
   rye-map.js
   Бесконечное ржаное поле с тропинками, дождём и пасмурным небом.

   Использование:

     import { RyeMap } from './rye-map.js';

     const map = new RyeMap({ scene, renderer, camera });

     // в цикле анимации:
     map.update(dt, time);

     // запрос высоты рельефа в любой точке:
     const y = map.getHeightAt(x, z);

     // проверка, на тропинке ли точка:
     const onPath = map.getPathMaskAt(x, z);

     // очистка ресурсов:
     map.dispose();
   ============================================================ */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/* ============================================================
   Утилиты: математика, ГПСЧ, шум
   ============================================================ */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2i(x, y) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

function vnoise(x, y) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2i(xi, yi),
    b = hash2i(xi + 1, yi);
  const c = hash2i(xi, yi + 1),
    d = hash2i(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

function fbm(x, y, oct = 4, lac = 2.03, gain = 0.5) {
  let s = 0,
    amp = 1,
    norm = 0,
    fx = x,
    fy = y;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(fx, fy);
    norm += amp;
    amp *= gain;
    fx *= lac;
    fy *= lac;
  }
  return s / norm;
}

function pnoise(x, y, period) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = (i) => ((i % period) + period) % period;
  const a = hash2i(w(xi), w(yi)),
    b = hash2i(w(xi + 1), w(yi));
  const c = hash2i(w(xi), w(yi + 1)),
    d = hash2i(w(xi + 1), w(yi + 1));
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

function pfbm(x, y, period, oct = 4) {
  let s = 0,
    amp = 1,
    norm = 0,
    fx = x,
    fy = y,
    p = period;
  for (let i = 0; i < oct; i++) {
    s += amp * pnoise(fx, fy, p);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
    p *= 2;
  }
  return s / norm;
}

/* ============================================================
   Процедурные текстуры
   ============================================================ */

function makeCanvasTexture(size, pixelFn) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const out = [0, 0, 0];

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      pixelFn(x / size, v, out);
      const i = (y * size + x) * 4;
      d[i] = clamp(out[0] * 255, 0, 255);
      d[i + 1] = clamp(out[1] * 255, 0, 255);
      d[i + 2] = clamp(out[2] * 255, 0, 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function makeGrassGroundTexture(aniso) {
  const tex = makeCanvasTexture(1024, (u, v, out) => {
    const x = u * 10,
      y = v * 10,
      P = 10;
    const n1 = pfbm(x, y, P, 5);
    const n2 = pfbm(x * 3 + 40, y * 3 + 40, P * 3, 4);
    const n3 = pfbm(x * 16 + 7, y * 16 + 7, P * 16, 3);
    const n4 = pfbm(x * 48 + 3, y * 48 + 3, P * 48, 2);

    let r = 0.095,
      g = 0.082,
      b = 0.042;
    const t1 = smoothstep(0.34, 0.66, n1);
    r = lerp(r, 0.245, t1);
    g = lerp(g, 0.198, t1);
    b = lerp(b, 0.088, t1);
    const t2 = smoothstep(0.52, 0.86, n2) * 0.9;
    r = lerp(r, 0.4, t2);
    g = lerp(g, 0.325, t2);
    b = lerp(b, 0.152, t2);
    const t3 = smoothstep(0.58, 0.92, n4) * 0.5;
    r = lerp(r, 0.335, t3);
    g = lerp(g, 0.278, t3);
    b = lerp(b, 0.142, t3);

    const s = 0.7 + n3 * 0.64;
    out[0] = r * s;
    out[1] = g * s;
    out[2] = b * s;
  });
  tex.anisotropy = aniso;
  return tex;
}

function makeDirtTexture(aniso) {
  const tex = makeCanvasTexture(1024, (u, v, out) => {
    const x = u * 8,
      y = v * 8,
      P = 8;
    const n1 = pfbm(x, y, P, 5);
    const n2 = pfbm(x * 4 + 11, y * 4 + 11, P * 4, 4);
    const n3 = pfbm(x * 20 + 3, y * 20 + 3, P * 20, 3);
    const n4 = pfbm(x * 60 + 8, y * 60 + 8, P * 60, 2);

    let r = 0.155,
      g = 0.118,
      b = 0.076;
    const t1 = smoothstep(0.38, 0.68, n1);
    r = lerp(r, 0.29, t1);
    g = lerp(g, 0.228, t1);
    b = lerp(b, 0.148, t1);
    const t2 = smoothstep(0.56, 0.9, n2) * 0.72;
    r = lerp(r, 0.082, t2);
    g = lerp(g, 0.066, t2);
    b = lerp(b, 0.048, t2);
    const t3 = smoothstep(0.7, 0.94, n3);
    r = lerp(r, 0.4, t3);
    g = lerp(g, 0.368, t3);
    b = lerp(b, 0.322, t3);
    const t4 = smoothstep(0.82, 0.98, n4) * 0.55;
    r = lerp(r, 0.5, t4);
    g = lerp(g, 0.482, t4);
    b = lerp(b, 0.448, t4);

    const s = 0.8 + n3 * 0.45;
    out[0] = r * s;
    out[1] = g * s;
    out[2] = b * s;
  });
  tex.anisotropy = aniso;
  return tex;
}

function makeRyeTexture(aniso) {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const rnd = mulberry32(1337);
  const stalks = 34;

  for (let i = 0; i < stalks; i++) {
    const x0 = 8 + rnd() * (S - 16);
    const h = S * (0.48 + rnd() * 0.46);
    const lean = (rnd() - 0.5) * 88;
    const w = 3.0 + rnd() * 3.0;
    const y0 = S;
    const y1 = S - h;
    const x1 = x0 + lean;

    const hue = 40 + rnd() * 12;
    const sat = 58 + rnd() * 24;
    const l0 = 15 + rnd() * 11;
    const l1 = 44 + rnd() * 14;

    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0.0, `hsl(${hue - 6}, ${sat - 10}%, ${l0}%)`);
    grad.addColorStop(0.35, `hsl(${hue - 2}, ${sat - 4}%, ${l0 + 9}%)`);
    grad.addColorStop(0.75, `hsl(${hue}, ${sat}%, ${l0 + 20}%)`);
    grad.addColorStop(1.0, `hsl(${hue + 4}, ${sat}%, ${l1}%)`);

    ctx.strokeStyle = grad;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + lean * 0.35, y0 - h * 0.58, x1, y1);
    ctx.stroke();

    ctx.strokeStyle = `hsla(${hue + 8}, ${sat - 20}%, ${l1 + 20}%, 0.32)`;
    ctx.lineWidth = w * 0.35;
    ctx.beginPath();
    ctx.moveTo(x0 + w * 0.25, y0);
    ctx.quadraticCurveTo(x0 + lean * 0.35 + w * 0.25, y0 - h * 0.58, x1 + w * 0.25, y1);
    ctx.stroke();

    const ang = Math.atan2(lean, h);
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(ang);

    const earLen = 42 + rnd() * 22;
    const grains = 12;
    const earHue = hue - 4 + rnd() * 8;
    const earSat = sat + 8;
    const grainL_base = l1 - 10 - rnd() * 4;
    const grainL_tip = grainL_base - 10;

    for (let k = 0; k < grains; k++) {
      const t = k / (grains - 1);
      const yy = -t * earLen;
      const sc = 1 - t * 0.44;

      ctx.beginPath();
      ctx.ellipse(0, yy, 3.3 * sc, 5.2 * sc, 0, 0, Math.PI * 2);
      const grainHue = earHue + rnd() * 4;
      const grainSat = earSat + rnd() * 6;
      const grainL = grainL_base + (grainL_tip - grainL_base) * t + (rnd() - 0.5) * 3;
      ctx.fillStyle = `hsl(${grainHue}, ${grainSat}%, ${grainL}%)`;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, yy - 3.6 * sc);
      ctx.lineTo(0, yy + 3.6 * sc);
      ctx.strokeStyle = `hsla(${earHue - 10}, ${earSat}%, ${Math.max(8, grainL - 14)}%, 0.7)`;
      ctx.lineWidth = 0.9;
      ctx.stroke();

      const gGrad = ctx.createRadialGradient(0, yy, 0, 0, yy, 5.2 * sc);
      gGrad.addColorStop(0.0, `hsla(${earHue}, ${earSat}%, ${grainL + 6}%, 0.55)`);
      gGrad.addColorStop(1.0, `hsla(${earHue - 6}, ${earSat}%, ${grainL - 10}%, 0.0)`);
      ctx.fillStyle = gGrad;
      ctx.beginPath();
      ctx.ellipse(0, yy, 3.3 * sc, 5.2 * sc, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = `hsla(${earHue + 6}, ${earSat - 10}%, ${Math.max(14, grainL_tip - 4)}%, 0.78)`;
    ctx.lineWidth = 0.7;
    for (let k = 0; k < grains; k++) {
      const t = k / (grains - 1);
      const yy = -t * earLen;
      const sc = 1 - t * 0.44;
      const awnLen = (13 + rnd() * 6) * sc;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(-awnLen * 0.75, yy - awnLen);
      ctx.moveTo(0, yy);
      ctx.lineTo(awnLen * 0.75, yy - awnLen);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'source-atop';
  const shade = ctx.createLinearGradient(0, S, 0, S * 0.58);
  shade.addColorStop(0.0, 'rgba(12, 7, 2, 0.52)');
  shade.addColorStop(1.0, 'rgba(12, 7, 2, 0.0)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/* ============================================================
   Класс карты
   ============================================================ */

export class RyeMap {
  /**
   * @param {Object} cfg
   * @param {THREE.Scene}      cfg.scene
   * @param {THREE.WebGLRenderer} cfg.renderer
   * @param {THREE.Camera}     cfg.camera
   * @param {number}  [cfg.seed=1337]
   * @param {number}  [cfg.chunkSize=40]
   * @param {number}  [cfg.chunkSegments=24]
   * @param {number}  [cfg.viewRadius=3]
   * @param {number}  [cfg.disposeRadius=5]
   * @param {number}  [cfg.ryePerChunk=5500]
   * @param {number}  [cfg.ryeBatch=1400]
   * @param {number}  [cfg.revealSpeed=320]
   * @param {number}  [cfg.rainCount=9000]
   * @param {THREE.Vector3} [cfg.sunDirection]
   * @param {THREE.Color}   [cfg.fogColor]
   * @param {number}  [cfg.fogDensity=0.03]
   * @param {number}  [cfg.exposure=1.15]
   * @param {number}  [cfg.shadowMapSize=4096]
   * @param {number}  [cfg.shadowExtent=18]
   * @param {boolean} [cfg.ownsAtmosphere=true] — создавать ли небо, туман, свет
   */
  constructor(cfg) {
    if (!cfg || !cfg.scene || !cfg.renderer || !cfg.camera) {
      throw new Error('RyeMap: нужны scene, renderer и camera');
    }

    this.scene = cfg.scene;
    this.renderer = cfg.renderer;
    this.camera = cfg.camera;

    this.seed = cfg.seed ?? 1337;
    this.chunkSize = cfg.chunkSize ?? 40;
    this.chunkSegments = cfg.chunkSegments ?? 24;
    this.viewRadius = cfg.viewRadius ?? 3;
    this.disposeRadius = cfg.disposeRadius ?? 5;
    this.ryePerChunk = cfg.ryePerChunk ?? 5500;
    this.ryeBatch = cfg.ryeBatch ?? 1400;
    this.revealSpeed = cfg.revealSpeed ?? 320;
    this.rainCount = cfg.rainCount ?? 9000;
    this.ownsAtmosphere = cfg.ownsAtmosphere !== false;

    this.sunDirection = cfg.sunDirection
      ? cfg.sunDirection.clone().normalize()
      : new THREE.Vector3(0.62, 0.44, 0.36).normalize();

    this.fogColor = cfg.fogColor ? cfg.fogColor.clone() : new THREE.Color(0x3b424a);
    this.fogDensity = cfg.fogDensity ?? 0.03;
    this.exposure = cfg.exposure ?? 1.15;

    this.shadowMapSize = cfg.shadowMapSize ?? 4096;
    this.shadowExtent = cfg.shadowExtent ?? 18;

    // --- внутреннее состояние ---
    this.time = 0;
    this.windDirX = 0.04;
    this.windDirZ = 0.018;
    this.loading = true;
    this.lastCX = Infinity;
    this.lastCZ = Infinity;

    this.chunks = new Map();
    this.jobs = new Map();
    this.revealingChunks = [];

    this._disposables = [];
    this._listeners = [];

    // --- инициализация ---
    this._initRendererTweaks();
    if (this.ownsAtmosphere) this._initAtmosphere();
    this._initTextures();
    this._initMaterials();
    this._initSky();
    this._initRain();
    this._initGeometry();

    // первичная генерация вокруг камеры
    const camPos = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    this.updateChunkGrid(camPos.x, camPos.z);
  }

  /* ---------- настройки рендерера ---------- */

  _initRendererTweaks() {
    const r = this.renderer;
    this._prevExposure = r.toneMappingExposure;
    this._prevToneMapping = r.toneMapping;
    this._prevOutputColorSpace = r.outputColorSpace;
    this._prevShadowEnabled = r.shadowMap.enabled;
    this._prevShadowType = r.shadowMap.type;

    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = this.exposure;
    r.outputColorSpace = THREE.SRGBColorSpace;
  }

  _restoreRenderer() {
    const r = this.renderer;
    r.toneMappingExposure = this._prevExposure;
    r.toneMapping = this._prevToneMapping;
    r.outputColorSpace = this._prevOutputColorSpace;
    r.shadowMap.enabled = this._prevShadowEnabled;
    r.shadowMap.type = this._prevShadowType;
  }

  /* ---------- атмосфера: свет, туман ---------- */

  _initAtmosphere() {
    this._prevFog = this.scene.fog;
    this._prevBackground = this.scene.background;

    this.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), this.fogDensity);
    this.scene.background = this.fogColor.clone();

    this.hemi = new THREE.HemisphereLight(0x8a94a2, 0x262a22, 2.05);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0x424a54, 0.42);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xaab4c2, 1.55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    const e = this.shadowExtent;
    this.sun.shadow.camera.left = -e;
    this.sun.shadow.camera.right = e;
    this.sun.shadow.camera.top = e;
    this.sun.shadow.camera.bottom = -e;
    this.sun.shadow.camera.near = 50;
    this.sun.shadow.camera.far = 140;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 0.008;
    this.sun.shadow.radius = 1.6;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.fill = new THREE.DirectionalLight(0x8a97a8, 0.55);
    this.fill.position.set(-60, 40, -50);
    this.scene.add(this.fill);
    this.scene.add(this.fill.target);

    this._disposables.push(this.hemi, this.ambient, this.sun, this.sun.target, this.fill, this.fill.target);
  }

  /* ---------- текстуры ---------- */

  _initTextures() {
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.grassGroundTex = makeGrassGroundTexture(aniso);
    this.dirtTex = makeDirtTexture(aniso);
    this.ryeTex = makeRyeTexture(aniso);
  }

  /* ---------- материалы ---------- */

  _initMaterials() {
    this._initGroundMaterial();
    this._initRyeMaterial();
  }

  _initGroundMaterial() {
    const PATH_W = 1.5;
    const PATH_E = 2.6;

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0.0,
    });

    this.groundUniforms = { uTime: { value: 0 } };

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uGrassTex = { value: this.grassGroundTex };
      shader.uniforms.uDirtTex = { value: this.dirtTex };
      shader.uniforms.uTime = this.groundUniforms.uTime;

      shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

      shader.fragmentShader =
        `
        varying vec3 vWPos;
        uniform sampler2D uGrassTex;
        uniform sampler2D uDirtTex;
        uniform float uTime;

        float hash21(vec2 p){
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        vec2 hash22(vec2 p){
          vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.xx + p3.yz) * p3.zy);
        }
        float vnoise2(vec2 p){
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1,0)), u.x),
                     mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), u.x), u.y);
        }
        float fbm2(vec2 p){
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * vnoise2(p); p *= 2.03; a *= 0.5; }
          return v / 0.9375;
        }
        float pathMaskGL(vec2 w){
          float dA = abs(w.x - (26.0*sin(w.y*0.012) + 9.0*sin(w.y*0.037 + 2.1) + 4.0*sin(w.y*0.09)));
          float dB = abs(w.y - (26.0*sin(w.x*0.011 + 5.0) + 9.0*sin(w.x*0.034) + 3.5*sin(w.x*0.08 + 1.7)));
          float mA = 1.0 - smoothstep(${PATH_W.toFixed(2)}, ${(PATH_W + PATH_E).toFixed(2)}, dA);
          float mB = 1.0 - smoothstep(${PATH_W.toFixed(2)}, ${(PATH_W + PATH_E).toFixed(2)}, dB);
          return max(mA, mB);
        }
        float rippleRing(vec2 wp, vec2 cellCenter, float age, float speed, float maxR) {
          vec2 d = wp - cellCenter;
          float r = length(d);
          float waveRadius = age * speed;
          if (r > maxR) return 0.0;
          float ring = exp(-pow((r - waveRadius) * 9.0, 2.0));
          float decay = exp(-age * 2.4) * exp(-r * 3.5);
          return ring * decay;
        }
        float rippleSmall(vec2 wp, float t) {
          vec2 p = wp * 0.85;
          vec2 id = floor(p);
          vec2 f = fract(p) - 0.5;
          vec2 h = hash22(id);
          float period = 0.45 + h.x * 0.35;
          float phase = fract(t / period + h.y);
          float age = phase * period;
          vec2 center = (h - 0.5) * 0.6;
          return rippleRing(f, center, age, 0.9, 0.55) * (1.0 - phase);
        }
        float rippleLarge(vec2 wp, float t) {
          vec2 p = wp * 0.32 + vec2(3.7, 1.3);
          vec2 id = floor(p);
          vec2 f = fract(p) - 0.5;
          vec2 h = hash22(id + 17.0);
          float period = 1.1 + h.x * 0.9;
          float phase = fract(t / period + h.y * 1.7);
          float age = phase * period;
          vec2 center = (h - 0.5) * 0.5;
          return rippleRing(f, center, age, 1.6, 0.55) * (1.0 - phase) * 1.6;
        }
        float rippleHeight(vec2 wp, float t) {
          return rippleSmall(wp, t) + rippleLarge(wp, t);
        }
        ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        vec2 wp = vWPos.xz;
        float pm = pathMaskGL(wp);

        vec3 gcol = texture2D(uGrassTex, wp * 0.28).rgb;
        gcol = mix(gcol, texture2D(uGrassTex, wp * 1.05 + 17.0).rgb, 0.5);
        gcol = mix(gcol, texture2D(uGrassTex, wp * 3.4 + 43.0).rgb, 0.22);

        vec3 dcol = texture2D(uDirtTex, wp * 0.19).rgb;
        dcol = mix(dcol, texture2D(uDirtTex, wp * 0.90 + 31.0).rgb, 0.5);

        vec3 base = mix(gcol, dcol, pm);
        float macro = fbm2(wp * 0.021);
        base *= 0.72 + macro * 0.56;

        float puddleNoise = fbm2(wp * 0.14 + 7.0);
        float puddleShape = smoothstep(0.80, 0.92, puddleNoise + pm * 0.05);
        float wetEdge = smoothstep(0.74, 0.84, puddleNoise + pm * 0.04) - puddleShape;

        float gWet = puddleShape;
        float gDamp = clamp(puddleShape + wetEdge * 0.45, 0.0, 1.0);

        vec3 wetGround = base * mix(0.55, 0.22, puddleShape);
        base = mix(base, wetGround, gDamp);
        base = mix(base, base * 0.78, wetEdge * 0.75);

        float edge = smoothstep(0.05, 0.6, pm) * (1.0 - smoothstep(0.62, 1.0, pm));
        base = mix(base, base * 0.78, edge * 0.5);

        diffuseColor.rgb *= base * 1.35;
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix(0.96, 0.14, gWet);`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `
        #include <normal_fragment_begin>
        {
          float nd1 = fbm2(vWPos.xz * 6.8) - 0.5;
          float nd2 = fbm2(vWPos.xz * 6.8 + vec2(53.1, 27.7)) - 0.5;
          normal.x += nd1 * 0.28 * (1.0 - gWet);
          normal.z += nd2 * 0.28 * (1.0 - gWet);

          float eps = 0.012;
          float h0 = rippleHeight(vWPos.xz, uTime);
          float hX = rippleHeight(vWPos.xz + vec2(eps, 0.0), uTime);
          float hZ = rippleHeight(vWPos.xz + vec2(0.0, eps), uTime);
          vec3 grad = vec3((hX - h0) / eps, 0.0, (hZ - h0) / eps);

          float rippleAmp = gWet * 0.35 + wetEdge * 0.15;
          normal.x += grad.x * rippleAmp;
          normal.z += grad.z * rippleAmp;
          normal = normalize(normal);
        }
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `
        #include <lights_fragment_end>
        {
          vec3 viewDir = normalize(cameraPosition - vWPos);
          vec3 N = vec3(0.0, 1.0, 0.0);
          float ndv = max(dot(viewDir, N), 0.0);

          float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
          fres = pow(fres, 0.75);

          vec3 skyRefl = vec3(0.155, 0.180, 0.215);
          vec3 sunRefl = vec3(0.235, 0.250, 0.275);

          float mixAmt = gWet * (0.35 + fres * 0.65);
          reflectedLight.indirectSpecular += mix(skyRefl, sunRefl, fres * 0.6) * mixAmt * 1.55;
          reflectedLight.indirectSpecular += vec3(0.10, 0.12, 0.14) * wetEdge * fres * 0.6;
        }
        `
      );
    };

    this.groundMat = mat;
    this._disposables.push(mat);
  }

  _initRyeMaterial() {
    this.ryeUniforms = {
      uTime: { value: 0 },
      uWind: { value: 1.0 },
      uWet: { value: 1.0 },
    };

    const mat = new THREE.MeshStandardMaterial({
      map: this.ryeTex,
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.0,
      side: THREE.DoubleSide,
      alphaTest: 0.3,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.ryeUniforms.uTime;
      shader.uniforms.uWind = this.ryeUniforms.uWind;
      shader.uniforms.uWet = this.ryeUniforms.uWet;

      shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iwp = (instanceMatrix * vec4(position, 1.0)).xyz;
          float ph = iwp.x * 0.62 + iwp.z * 0.47;

          float gustPhase = iwp.x * 0.020 + iwp.z * 0.014 - uTime * 0.32;
          float gust = sin(gustPhase) * 0.5 + 0.5;
          gust = pow(gust, 2.5);
          float gustAmp = 1.6;

          float bigWave = sin(uTime * 0.85 + ph * 0.28) * 0.62
                        + sin(uTime * 0.41 + ph * 0.17) * 0.45;
          float midWave = sin(uTime * 1.55 + ph) * 0.55
                        + sin(uTime * 2.90 + ph * 1.73) * 0.28;
          float flutter = sin(uTime * 6.5 + ph * 4.3) * 0.15
                        + sin(uTime * 11.2 + ph * 7.1) * 0.08;

          vec2 windDir = normalize(vec2(0.82, 0.57));
          float gustContrib = gust * gustAmp;
          float wv = bigWave * 0.55 + midWave * 0.9 + flutter;

          float bend = position.y * position.y;
          float amp = 0.145 * uWind;
          transformed.x += (wv * amp + gustContrib * amp * 0.9) * bend * windDir.x;
          transformed.z += (wv * amp + gustContrib * amp * 0.9) * bend * windDir.y;
          transformed.y -= abs(wv) * 0.038 * bend * uWind;
        #endif
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `
        #include <beginnormal_vertex>
        objectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.80));
        `
      );

      shader.fragmentShader = 'uniform float uWet;\n' + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #include <map_fragment>
        float heightAO = mix(0.40, 1.0, smoothstep(0.0, 0.28, vMapUv.y));
        diffuseColor.rgb *= heightAO;
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `
        #include <lights_fragment_end>
        {
          vec3 N = normalize(normal);
          vec3 V = normalize(vViewPosition);
          float ndv = saturate(dot(N, V));
          float rim = pow(1.0 - ndv, 2.4);
          float backLight = pow(saturate(1.0 - ndv), 3.2);

          float heightFactor = smoothstep(0.15, 0.85, vMapUv.y);
          vec3 sssLow  = vec3(0.60, 0.38, 0.16);
          vec3 sssHigh = vec3(0.85, 0.58, 0.28);
          vec3 sssColor = mix(sssLow, sssHigh, heightFactor);
          float wet = uWet;

          reflectedLight.directDiffuse   += sssColor * (rim * 0.30 + backLight * 0.14) * wet;
          reflectedLight.indirectDiffuse += sssColor * rim * 0.10 * wet;
        }
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix(0.85, 0.42, uWet);`
      );
    };

    this.ryeMat = mat;

    this.ryeDepthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: this.ryeTex,
      alphaTest: 0.15,
    });
    this.ryeDepthMat.side = THREE.DoubleSide;

    this._disposables.push(mat, this.ryeDepthMat);
  }

  /* ---------- небо ---------- */

  _initSky() {
    this.skyUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: this.sunDirection.clone() },
      uFogColor: { value: this.fogColor.clone() },
    };

    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.skyUniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        uniform float uTime;
        uniform vec3  uSunDir;
        uniform vec3  uFogColor;

        float hash21(vec2 p){
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1,0)), u.x),
                     mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), u.x), u.y);
        }
        float fbm5(vec2 p){
          float v = 0.0, a = 0.5;
          mat2 m = mat2(1.62, 1.18, -1.18, 1.62);
          for (int i = 0; i < 5; i++) {
            v += a * vnoise(p);
            p = m * p;
            a *= 0.5;
          }
          return v;
        }
        float billow(vec2 p){
          float v = 0.0, a = 0.5;
          mat2 m = mat2(1.62, 1.18, -1.18, 1.62);
          for (int i = 0; i < 5; i++) {
            v += a * abs(vnoise(p) * 2.0 - 1.0);
            p = m * p;
            a *= 0.5;
          }
          return v;
        }
        float cloudDensity(vec3 rayDir, float H, float scale, float time, float seed) {
          float up = max(rayDir.y, 0.055);
          float t = H / up;
          vec2 cc = rayDir.xz * t * scale + seed;

          vec2 q = vec2(
            fbm5(cc * 0.75 + vec2(time * 0.32, time * 0.14)),
            fbm5(cc * 0.75 + vec2(4.7, 1.3) + vec2(-time * 0.26, time * 0.20))
          );
          vec2 r = vec2(
            fbm5(cc + 3.1 * q + vec2(time * 0.10, 0.0)),
            fbm5(cc + 3.1 * q + vec2(1.7, 9.2) + vec2(0.0, time * 0.08))
          );
          float puff = billow(cc + 2.6 * r + vec2(time * 0.06, 0.0));
          float detail = fbm5(cc * 2.6 + 2.6 * r);
          return puff * 0.78 + detail * 0.22;
        }

        void main() {
          vec3 d = normalize(vDir);
          float up = d.y;
          float cosSun = dot(d, uSunDir);

          vec3 zenithCol  = vec3(0.022, 0.030, 0.046);
          vec3 midCol     = vec3(0.070, 0.084, 0.108);
          vec3 horizonCol = vec3(0.180, 0.196, 0.218);

          float h1 = smoothstep(-0.05, 0.35, up);
          float h2 = smoothstep(0.25, 0.85, up);
          vec3 sky = mix(horizonCol, midCol, h1);
          sky = mix(sky, zenithCol, h2);

          float sunGlow = pow(max(cosSun, 0.0), 5.0);
          sky += vec3(0.10, 0.075, 0.048) * sunGlow * smoothstep(0.40, -0.10, up) * 0.22;

          vec3 cloudCol = vec3(0.0);
          float cloudMask = 0.0;

          {
            float layer = cloudDensity(d, 1800.0, 0.00016, uTime * 0.006, 0.0);
            layer = smoothstep(0.26, 0.72, layer);
            float layerUp = cloudDensity(d, 2300.0, 0.00016, uTime * 0.006, 0.0);
            layerUp = smoothstep(0.34, 0.78, layerUp);
            float topness = smoothstep(0.10, 0.70, layerUp);

            vec3 cDeep  = vec3(0.028, 0.034, 0.046);
            vec3 cDark  = vec3(0.062, 0.072, 0.090);
            vec3 cMid   = vec3(0.108, 0.122, 0.146);
            vec3 cLight = vec3(0.180, 0.196, 0.224);
            vec3 cTop   = vec3(0.258, 0.276, 0.312);

            vec3 c = mix(cDeep, cDark, smoothstep(0.10, 0.42, layer));
            c = mix(c, cMid, smoothstep(0.38, 0.64, layer));
            c = mix(c, cLight, smoothstep(0.60, 0.88, layer));
            c = mix(c, cTop, topness * 0.42);

            float sunFace = smoothstep(-0.25, 0.75, cosSun);
            c += vec3(0.20, 0.16, 0.11) * sunFace * sunGlow * 0.35 * topness;

            float underLight = smoothstep(0.62, 0.95, layer) * (1.0 - smoothstep(0.30, 0.60, layerUp));
            c += vec3(0.14, 0.12, 0.09) * underLight * sunFace * 0.30;

            cloudCol = c;
            cloudMask = layer;
          }

          {
            float cirrus = cloudDensity(d, 3500.0, 0.00009, uTime * 0.004, 60.0);
            cirrus = smoothstep(0.50, 0.85, cirrus) * 0.40;
            vec3 cirrusCol = vec3(0.135, 0.148, 0.176);
            cloudCol = mix(cloudCol, cirrusCol, cirrus * (1.0 - cloudMask * 0.8));
            cloudMask = max(cloudMask, cirrus * (1.0 - cloudMask * 0.8));
          }

          float cloudFade = smoothstep(-0.06, 0.14, up);
          float edgeDark = smoothstep(0.55, 0.15, up);
          cloudCol *= (1.0 - edgeDark * 0.30);

          sky = mix(sky, cloudCol, cloudMask * cloudFade);

          float haze = exp(-abs(up - 0.02) * 4.5);
          sky = mix(sky, uFogColor, haze * 0.85);

          sky += vec3(0.020, 0.022, 0.025) * exp(-abs(up) * 18.0);
          sky += (hash21(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);

          gl_FragColor = vec4(sky, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(520, 48, 28), mat);
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);

    this._disposables.push(this.skyMesh, this.skyMesh.geometry, mat);
  }

  /* ---------- дождь ---------- */

  _initRain() {
    const COUNT = this.rainCount;
    const BOX_XZ = 80;
    const BOX_Y = 50;

    const baseGeo = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = baseGeo.index;
    geo.setAttribute('position', baseGeo.attributes.position);

    const iPos = new Float32Array(COUNT * 3);
    const iSpeed = new Float32Array(COUNT);
    const iLen = new Float32Array(COUNT);
    const iWid = new Float32Array(COUNT);
    const iAlpha = new Float32Array(COUNT);

    const rnd = mulberry32(4242);
    for (let i = 0; i < COUNT; i++) {
      iPos[i * 3 + 0] = rnd() * BOX_XZ;
      iPos[i * 3 + 1] = rnd() * BOX_Y;
      iPos[i * 3 + 2] = rnd() * BOX_XZ;
      iSpeed[i] = 18 + rnd() * 16;
      iLen[i] = 0.7 + rnd() * 1.1;
      iWid[i] = 0.006 + rnd() * 0.01;
      iAlpha[i] = 0.35 + rnd() * 0.65;
    }

    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iSpeed', new THREE.InstancedBufferAttribute(iSpeed, 1));
    geo.setAttribute('iLen', new THREE.InstancedBufferAttribute(iLen, 1));
    geo.setAttribute('iWid', new THREE.InstancedBufferAttribute(iWid, 1));
    geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(iAlpha, 1));
    geo.instanceCount = COUNT;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.rainUniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(0.04, 0.018) },
      uSunDir: { value: this.sunDirection.clone() },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.rainUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        uniform vec3  uCam;
        uniform vec2  uWind;
        attribute vec3  iPos;
        attribute float iSpeed;
        attribute float iLen;
        attribute float iWid;
        attribute float iAlpha;
        varying vec2  vQuad;
        varying float vFade;
        varying float vAlpha;

        const float BOX_XZ  = 80.0;
        const float BOX_Y   = 50.0;
        const float Y_BELOW = 15.0;

        void main() {
          vec3 p = iPos;
          p.y = mod(p.y - uTime * iSpeed, BOX_Y);
          p.x = mod(p.x - uCam.x + BOX_XZ * 0.5, BOX_XZ) - BOX_XZ * 0.5 + uCam.x;
          p.z = mod(p.z - uCam.z + BOX_XZ * 0.5, BOX_XZ) - BOX_XZ * 0.5 + uCam.z;
          p.y += uCam.y - Y_BELOW;

          float fall = (uCam.y + BOX_Y - Y_BELOW) - p.y;
          p.x += fall * uWind.x;
          p.z += fall * uWind.y;

          vec3 streakDir = normalize(vec3(uWind.x * 2.0, -1.0, uWind.y * 2.0));
          vec3 toCam = uCam - p;
          float camDist = length(toCam);
          toCam /= max(camDist, 0.001);

          vec3 right = cross(streakDir, toCam);
          float rl = length(right);
          if (rl < 0.001) {
            right = abs(streakDir.y) < 0.9
              ? normalize(cross(streakDir, vec3(0.0, 1.0, 0.0)))
              : vec3(1.0, 0.0, 0.0);
          } else {
            right /= rl;
          }

          vec3 worldPos = p
            + right * position.x * iWid
            + streakDir * (position.y + 0.5) * iLen;

          vec4 mv = viewMatrix * vec4(worldPos, 1.0);
          gl_Position = projectionMatrix * mv;

          vQuad = position.xy + 0.5;
          vAlpha = iAlpha;
          vFade = smoothstep(85.0, 14.0, camDist) * smoothstep(0.6, 2.2, camDist);
        }
      `,
      fragmentShader: `
        varying vec2  vQuad;
        varying float vFade;
        varying float vAlpha;
        void main() {
          float ex = 1.0 - smoothstep(0.15, 0.5, abs(vQuad.x - 0.5) * 2.0);
          float ey = 1.0 - smoothstep(0.65, 1.0, abs(vQuad.y - 0.5) * 2.0);
          float head = smoothstep(0.35, 1.0, vQuad.y);
          float a = ex * ey * vFade * vAlpha * mix(0.4, 1.3, head);
          if (a < 0.004) discard;
          vec3 col = mix(vec3(0.42, 0.50, 0.64), vec3(0.78, 0.85, 0.94), head);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.rainMesh = new THREE.Mesh(geo, mat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 10;
    this.scene.add(this.rainMesh);

    this._disposables.push(this.rainMesh, geo, baseGeo, mat);
  }

  /* ---------- геометрия ржи ---------- */

  _initGeometry() {
    const geos = [];
    const planes = 3;
    for (let i = 0; i < planes; i++) {
      const g = new THREE.PlaneGeometry(1, 1, 1, 4);
      g.translate(0, 0.5, 0);
      g.rotateY((i * Math.PI) / planes);
      geos.push(g);
    }
    const merged = BufferGeometryUtils.mergeGeometries(geos);
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    geos.forEach((g) => g.dispose());
    this.ryeGeo = merged;
    this._disposables.push(merged);
  }

  /* ============================================================
     Публичное API
     ============================================================ */

  /**
   * Высота рельефа в произвольной точке мира.
   * Можно вызывать даже без инстанса: RyeMap.heightAt(x, z)
   */
  getHeightAt(x, z) {
    return RyeMap.heightAt(x, z);
  }

  /** Значение маски тропинки: 0 — далеко от троп, 1 — центр тропы */
  getPathMaskAt(x, z) {
    return RyeMap.pathMaskAt(x, z);
  }

  /** Радиус загруженной зоны вокруг камеры, в метрах */
  get loadedRadius() {
    return this.viewRadius * this.chunkSize;
  }

  /**
   * Главный тик. Вызывать в requestAnimationFrame.
   * @param {number} dt   секунды с прошлого кадра
   * @param {number} time общее время (секунды)
   */
  update(dt, time) {
    if (typeof time === 'number') this.time = time;
    else this.time += dt;

    this._updateWind(dt);

    const camPos = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);

    this._updateChunkGrid(camPos.x, camPos.z);
    this._processJobs(this.loading ? 20 : 7);
    this._updateRevealingChunks();

    this._updateUniforms(camPos);
  }

  /** Принудительно перестроить зону вокруг новой точки (телепорт) */
  teleport(x, z) {
    this.lastCX = Infinity;
    this.lastCZ = Infinity;
    this._updateChunkGrid(x, z);
  }

  /** Очистить все GPU-ресурсы и убрать меши из сцены */
  dispose() {
    for (const ch of this.chunks.values()) this._disposeChunk(ch);
    this.chunks.clear();
    this.jobs.clear();
    this.revealingChunks.length = 0;

    for (const d of this._disposables) {
      if (d && typeof d.dispose === 'function') d.dispose();
      else if (d && d.parent) d.parent.remove(d);
    }
    this._disposables.length = 0;

    if (this.ownsAtmosphere) {
      this.scene.fog = this._prevFog ?? null;
      this.scene.background = this._prevBackground ?? null;
    }

    this._restoreRenderer();
  }

  /* ============================================================
     Внутренние обновления
     ============================================================ */

  _updateWind(dt) {
    const t = this.time;
    const targetX = 0.032 + Math.sin(t * 0.08) * 0.024;
    const targetZ = 0.014 + Math.cos(t * 0.06 + 1.3) * 0.018;
    const k = 1 - Math.exp(-dt * 0.6);
    this.windDirX += (targetX - this.windDirX) * k;
    this.windDirZ += (targetZ - this.windDirZ) * k;
  }

  _updateUniforms(camPos) {
    const t = this.time;

    if (this.skyMesh) {
      this.skyMesh.position.copy(camPos);
      this.skyUniforms.uTime.value = t;
      this.skyUniforms.uSunDir.value.copy(this.sunDirection);
      this.skyUniforms.uFogColor.value.copy(this.fogColor);
    }

    if (this.rainMesh) {
      this.rainUniforms.uTime.value = t;
      this.rainUniforms.uCam.value.copy(camPos);
      this.rainUniforms.uWind.value.set(this.windDirX, this.windDirZ);
      this.rainUniforms.uSunDir.value.copy(this.sunDirection);
    }

    if (this.ryeUniforms) this.ryeUniforms.uTime.value = t;
    if (this.groundUniforms) this.groundUniforms.uTime.value = t;

    if (this.sun) {
      const gY = RyeMap.heightAt(camPos.x, camPos.z);
      this.sun.target.position.set(camPos.x, gY, camPos.z);
      this.sun.position.set(
        camPos.x + this.sunDirection.x * 95,
        gY + this.sunDirection.y * 90,
        camPos.z + this.sunDirection.z * 95
      );
      this.fill.target.position.set(camPos.x, gY, camPos.z);
      this.fill.position.set(camPos.x - 55, gY + 44, camPos.z - 48);
      this.sun.target.updateMatrixWorld();
      this.fill.target.updateMatrixWorld();
    }
  }

  /* ---------- чанки ---------- */

  _keyOf(cx, cz) {
    return cx + ',' + cz;
  }

  _makeJob(cx, cz, dist) {
    return {
      cx,
      cz,
      dist,
      key: this._keyOf(cx, cz),
      stage: 'grid',
      grid: null,
      N: 0,
      NP: 0,
      ox: 0,
      oz: 0,
      step: 0,
      terrain: null,
      inst: null,
      dummy: null,
      rnd: null,
      i: 0,
      n: 0,
      col: new THREE.Color(),
      totalCount: 0,
    };
  }

  _sampleGrid(job, wx, wz) {
    const N = job.N,
      NP = job.NP,
      step = job.step,
      g = job.grid;
    let fx = (wx - job.ox) / step;
    let fz = (wz - job.oz) / step;
    if (fx < 0) fx = 0;
    else if (fx > N - 1.0001) fx = N - 1.0001;
    if (fz < 0) fz = 0;
    else if (fz > N - 1.0001) fz = N - 1.0001;
    const i0 = fx | 0,
      j0 = fz | 0;
    const tx = fx - i0,
      tz = fz - j0;
    const ip = i0 + 1,
      jp = j0 + 1;
    const a = g[jp * NP + ip];
    const b = g[jp * NP + ip + 1];
    const c = g[(jp + 1) * NP + ip];
    const d = g[(jp + 1) * NP + ip + 1];
    const ab = a + (b - a) * tx;
    const cd = c + (d - c) * tx;
    return ab + (cd - ab) * tz;
  }

  _advanceJob(job) {
    if (job.stage === 'grid') {
      const N = this.chunkSegments + 1;
      const NP = N + 2;
      const step = this.chunkSize / this.chunkSegments;
      const ox = job.cx * this.chunkSize - this.chunkSize / 2;
      const oz = job.cz * this.chunkSize - this.chunkSize / 2;
      const g = new Float32Array(NP * NP);
      for (let j = -1; j <= N; j++) {
        const wz = oz + j * step;
        for (let i = -1; i <= N; i++) {
          g[(j + 1) * NP + (i + 1)] = RyeMap.heightAt(ox + i * step, wz);
        }
      }
      job.grid = g;
      job.N = N;
      job.NP = NP;
      job.ox = ox;
      job.oz = oz;
      job.step = step;
      job.stage = 'terrain';
      return;
    }

    if (job.stage === 'terrain') {
      const N = job.N,
        NP = job.NP,
        step = job.step,
        g = job.grid;
      const geo = new THREE.PlaneGeometry(
        this.chunkSize,
        this.chunkSize,
        this.chunkSegments,
        this.chunkSegments
      );
      geo.rotateX(-Math.PI / 2);

      const pos = geo.attributes.position;
      const nrm = geo.attributes.normal;
      const half = this.chunkSize / 2;

      for (let k = 0; k < pos.count; k++) {
        const lx = pos.getX(k);
        const lz = pos.getZ(k);
        let gi = Math.round((lx + half) / step);
        let gj = Math.round((lz + half) / step);
        if (gi < 0) gi = 0;
        else if (gi > N - 1) gi = N - 1;
        if (gj < 0) gj = 0;
        else if (gj > N - 1) gj = N - 1;

        const ip = gi + 1,
          jp = gj + 1;
        pos.setY(k, g[jp * NP + ip]);

        const hL = g[jp * NP + (ip - 1)];
        const hR = g[jp * NP + (ip + 1)];
        const hD = g[(jp - 1) * NP + ip];
        const hU = g[(jp + 1) * NP + ip];
        let nx = hL - hR;
        let ny = 2 * step;
        let nz = hD - hU;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nrm.setXYZ(k, nx * inv, ny * inv, nz * inv);
      }
      pos.needsUpdate = true;
      nrm.needsUpdate = true;
      geo.computeBoundingSphere();

      const terrain = new THREE.Mesh(geo, this.groundMat);
      terrain.receiveShadow = true;
      terrain.castShadow = false;
      terrain.position.set(job.cx * this.chunkSize, 0, job.cz * this.chunkSize);
      terrain.matrixAutoUpdate = false;
      terrain.updateMatrix();
      this.scene.add(terrain);

      const inst = new THREE.InstancedMesh(this.ryeGeo, this.ryeMat, this.ryePerChunk);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.count = 0;
      inst.frustumCulled = false;
      inst.customDepthMaterial = this.ryeDepthMat;

      const zeroColor = new Float32Array(this.ryePerChunk * 3);
      for (let c = 0; c < this.ryePerChunk; c++) {
        zeroColor[c * 3] = 1;
        zeroColor[c * 3 + 1] = 1;
        zeroColor[c * 3 + 2] = 1;
      }
      inst.instanceColor = new THREE.InstancedBufferAttribute(zeroColor, 3);
      this.scene.add(inst);

      this.chunks.set(job.key, {
        cx: job.cx,
        cz: job.cz,
        key: job.key,
        terrain,
        grass: inst,
      });

      job.terrain = terrain;
      job.inst = inst;
      job.dummy = new THREE.Object3D();
      job.rnd = mulberry32(
        ((job.cx * 73856093) ^ (job.cz * 19349663) ^ this.seed) >>> 0
      );
      job.i = 0;
      job.n = 0;
      job.stage = 'rye';
      return;
    }

    if (job.stage === 'rye') {
      if (!this.chunks.has(job.key)) {
        job.stage = 'done';
        return;
      }
      const inst = job.inst;
      const dummy = job.dummy;
      const rnd = job.rnd;
      const col = job.col;

      let processed = 0;
      while (job.i < this.ryePerChunk && processed < this.ryeBatch) {
        const wx = job.ox + rnd() * this.chunkSize;
        const wz = job.oz + rnd() * this.chunkSize;

        const pm = RyeMap.pathMaskAt(wx, wz);
        if (pm > 0.02 && rnd() < pm * 1.15) {
          job.i++;
          continue;
        }

        const ground = this._sampleGrid(job, wx, wz);
        const sc = 0.78 + rnd() * 0.5;
        const h = (1.3 + rnd() * 0.9) * (1 - pm * 0.35);
        const tiltX = (rnd() - 0.5) * 0.2;
        const tiltZ = (rnd() - 0.5) * 0.2;

        dummy.position.set(wx, ground - 0.08, wz);
        dummy.rotation.set(tiltX, rnd() * Math.PI * 2, tiltZ);
        dummy.scale.set(sc * 1.24, h, sc * 1.24);
        dummy.updateMatrix();
        inst.setMatrixAt(job.n, dummy.matrix);

        const t = 0.68 + rnd() * 0.36;
        col.setRGB(
          clamp(t * (0.96 + rnd() * 0.18), 0, 1.6),
          clamp(t * (0.8 + rnd() * 0.14), 0, 1.6),
          clamp(t * (0.36 + rnd() * 0.18), 0, 1.6)
        );
        inst.setColorAt(job.n, col);

        job.n++;
        job.i++;
        processed++;
      }

      inst.instanceMatrix.needsUpdate = true;
      inst.instanceColor.needsUpdate = true;

      if (job.i < this.ryePerChunk) return;

      job.totalCount = job.n;
      this.revealingChunks.push({
        inst,
        totalCount: job.n,
        currentCount: 0,
      });
      job.stage = 'done';
    }
  }

  _updateRevealingChunks() {
    for (let i = this.revealingChunks.length - 1; i >= 0; i--) {
      const rc = this.revealingChunks[i];
      if (!rc.inst.parent) {
        this.revealingChunks.splice(i, 1);
        continue;
      }
      rc.currentCount = Math.min(rc.totalCount, rc.currentCount + this.revealSpeed);
      rc.inst.count = rc.currentCount;
      if (rc.currentCount >= rc.totalCount) this.revealingChunks.splice(i, 1);
    }
  }

  _disposeChunk(ch) {
    for (let i = this.revealingChunks.length - 1; i >= 0; i--) {
      if (this.revealingChunks[i].inst === ch.grass) this.revealingChunks.splice(i, 1);
    }
    this.scene.remove(ch.terrain);
    ch.terrain.geometry.dispose();
    this.scene.remove(ch.grass);
    ch.grass.dispose();
  }

  _updateChunkGrid(px, pz) {
    const ccx = Math.floor(px / this.chunkSize);
    const ccz = Math.floor(pz / this.chunkSize);
    if (ccx === this.lastCX && ccz === this.lastCZ) return;
    this.lastCX = ccx;
    this.lastCZ = ccz;

    const R = this.viewRadius;
    const DR = this.disposeRadius;

    const desiredCreate = new Set();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz <= R * R + 1) {
          desiredCreate.add(this._keyOf(ccx + dx, ccz + dz));
        }
      }
    }

    const desiredKeep = new Set();
    for (let dz = -DR; dz <= DR; dz++) {
      for (let dx = -DR; dx <= DR; dx++) {
        if (dx * dx + dz * dz <= DR * DR + 1) {
          desiredKeep.add(this._keyOf(ccx + dx, ccz + dz));
        }
      }
    }

    for (const [k, ch] of this.chunks) {
      if (!desiredKeep.has(k)) {
        this._disposeChunk(ch);
        this.chunks.delete(k);
      }
    }

    for (const k of [...this.jobs.keys()]) {
      if (!desiredKeep.has(k)) {
        const ch = this.chunks.get(k);
        if (ch) {
          this._disposeChunk(ch);
          this.chunks.delete(k);
        }
        this.jobs.delete(k);
      }
    }

    for (const k of desiredCreate) {
      if (this.chunks.has(k) || this.jobs.has(k)) continue;
      const [cx, cz] = k.split(',').map(Number);
      const d = Math.hypot(cx - ccx, cz - ccz);
      this.jobs.set(k, this._makeJob(cx, cz, d));
    }
  }

  _processJobs(budgetMs) {
    if (this.jobs.size === 0) {
      if (this.loading) this.loading = false;
      return;
    }
    const deadline = performance.now() + budgetMs;
    while (this.jobs.size > 0) {
      let best = null;
      for (const j of this.jobs.values()) {
        if (!best || j.dist < best.dist) best = j;
      }
      if (!best) break;
      this._advanceJob(best);
      if (best.stage === 'done') this.jobs.delete(best.key);
      if (!this.loading && performance.now() >= deadline) break;
      if (performance.now() >= deadline + 40) break; // защита от долгой блокировки при загрузке
    }
  }
}

/* ============================================================
   Статические запросы (доступны без инстанса)
   ============================================================ */

RyeMap.pathMaskAt = function (x, z) {
  const dA = Math.abs(
    x - (26 * Math.sin(z * 0.012) + 9 * Math.sin(z * 0.037 + 2.1) + 4 * Math.sin(z * 0.09))
  );
  const dB = Math.abs(
    z - (26 * Math.sin(x * 0.011 + 5.0) + 9 * Math.sin(x * 0.034) + 3.5 * Math.sin(x * 0.08 + 1.7))
  );
  const PATH_W = 1.5;
  const PATH_E = 2.6;
  const mA = 1 - smoothstep(PATH_W, PATH_W + PATH_E, dA);
  const mB = 1 - smoothstep(PATH_W, PATH_W + PATH_E, dB);
  return mA > mB ? mA : mB;
};

RyeMap.heightAt = function (x, z) {
  let h = (fbm(x * 0.0055, z * 0.0055, 4) - 0.5) * 30.0;
  h += (fbm(x * 0.019 + 31.7, z * 0.019 - 11.3, 3) - 0.5) * 5.5;
  const fine = (fbm(x * 0.075, z * 0.075, 3) - 0.5) * 0.9;
  const p = RyeMap.pathMaskAt(x, z);
  h += fine * (1 - 0.9 * p);
  h -= p * 0.42;
  return h;
};

export default RyeMap;