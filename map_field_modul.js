/* ============================================================================
 * Rye Field · Reusable Three.js Module
 * ----------------------------------------------------------------------------
 * Что можно взять по отдельности:
 *   - FIELD_CONFIG              — все числа (чанки, пути, атмосфера, игрок)
 *   - makeGrassTexture()        — процедурная текстура травы
 *   - makeDirtTexture()         — процедурная текстура земли (тропинок)
 *   - makeRyeTexture()          — процедурная текстура колосьев ржи
 *   - makeCrossRyeGeometry()    — геометрия «креста» из 3 плоскостей
 *   - createSky()               — шейдерное небо с fbm-облаками
 *   - createRain()              — инстансный дождь (9000 стриков)
 *   - createFieldLights()       — hemi + sun + fill
 *   - createGroundMaterial()    — материал земли (трава/грязь/лужи/рябь)
 *   - createRyeMaterial()       — материал ржи с качанием на ветру
 *   - createRyeDepthMaterial()  — depth-материал для shadowmap ржи
 *   - FieldTerrain              — менеджер чанков (стриминг ландшафта и ржи)
 *   - FieldPlayerController     — WASD + ходьба по рельефу + покачивание
 *   - createField()             — фабрика: собрать всё сразу
 * ----------------------------------------------------------------------------
 * Зависимости:
 *   three
 *   three/addons/utils/BufferGeometryUtils.js
 * ==========================================================================*/

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/* ═══════════════════════════════════════════════════════════════════════════
   1 · КОНФИГ
   ═══════════════════════════════════════════════════════════════════════════ */

export const FIELD_CONFIG = {
  /* --- Чанки / стриминг --- */
  CHUNK:            40,
  CHUNK_SEG:        24,
  VIEW_RAD:         3,
  DISPOSE_RAD:      5,
  RYE_PER_CHUNK:    5500,
  RYE_BATCH:        1400,
  REVEAL_SPEED:     320,

  /* --- Тропинки --- */
  PATH_W:      1.5,
  PATH_E:      2.6,
  PATH_A_JS:   z => 26 * Math.sin(z * 0.012) + 9 * Math.sin(z * 0.037 + 2.1) + 4 * Math.sin(z * 0.09),
  PATH_B_JS:   x => 26 * Math.sin(x * 0.011 + 5.0) + 9 * Math.sin(x * 0.034) + 3.5 * Math.sin(x * 0.08 + 1.7),
  /* GLSL: w.x = worldX, w.y = worldZ */
  PATH_A_GLSL: '26.0*sin(w.y*0.012) + 9.0*sin(w.y*0.037 + 2.1) + 4.0*sin(w.y*0.09)',
  PATH_B_GLSL: '26.0*sin(w.x*0.011 + 5.0) + 9.0*sin(w.x*0.034) + 3.5*sin(w.x*0.08 + 1.7)',

  /* --- Атмосфера --- */
  FOG_COLOR:    0x3b424a,
  FOG_DENSITY:  0.030,
  SUN_DIR:      [0.62, 0.44, 0.36],

  /* --- Свет --- */
  HEMI_SKY:     0x8a94a2,
  HEMI_GROUND:  0x262a22,
  HEMI_INT:     2.05,
  AMBIENT_COL:  0x424a54,
  AMBIENT_INT:  0.42,
  SUN_COL:      0xaab4c2,
  SUN_INT:      1.55,
  FILL_COL:     0x8a97a8,
  FILL_INT:     0.55,

  /* --- Тени --- */
  SHADOW_EXTENT:   18,
  SHADOW_MAP_SIZE: 4096,

  /* --- Небо --- */
  SKY_RADIUS:      520,
  SKY_SEG_W:       48,
  SKY_SEG_H:       28,

  /* --- Дождь --- */
  RAIN_COUNT:        9000,
  RAIN_BOX_XZ:       80,
  RAIN_BOX_Y:        50,
  RAIN_Y_BELOW:      15,
  RAIN_WIND:         [0.040, 0.018],
  RAIN_WIND_SWAY_X:  0.024,
  RAIN_WIND_SWAY_Z:  0.018,
  RAIN_WIND_FREQ_X:  0.08,
  RAIN_WIND_FREQ_Z:  0.06,
  RAIN_FADE_NEAR:    85,
  RAIN_FADE_FAR:     14,

  /* --- Земля: лужи --- */
  PUDDLE_LO:  0.80,
  PUDDLE_HI:  0.92,
  WETEDGE_LO: 0.74,
  WETEDGE_HI: 0.84,

  /* --- Рожь: качание --- */
  RYE_WIND_AMP:   0.145,
  RYE_WIND_DIR:   [0.82, 0.57],
  RYE_GUST_AMP:   1.6,
  RYE_GUST_FREQ:  0.32,
  RYE_GUST_SCALE: [0.020, 0.014],

  /* --- Рожь: разброс инстансов --- */
  RYE_SCALE_XZ_MIN:     0.78,
  RYE_SCALE_XZ_RANGE:   0.50,
  RYE_SCALE_XZ_BOOST:   1.24,
  RYE_HEIGHT_MIN:       1.30,
  RYE_HEIGHT_RANGE:     0.90,
  RYE_PATH_HEIGHT_RED:  0.35,
  RYE_TILT:             0.20,
  RYE_Y_OFFSET:        -0.08,

  /* --- Рожь: цвет инстанса --- */
  RYE_COLOR_T_MIN:     0.68,
  RYE_COLOR_T_RANGE:   0.36,
  RYE_COLOR_R:         0.96,
  RYE_COLOR_R_RANGE:   0.18,
  RYE_COLOR_G:         0.80,
  RYE_COLOR_G_RANGE:   0.14,
  RYE_COLOR_B:         0.36,
  RYE_COLOR_B_RANGE:   0.18,

  /* --- Игрок --- */
  EYE_HEIGHT:  1.68,
  WALK_SPEED:  2.45,
  RUN_SPEED:   6.2,
  BOB_AMP:     0.036,
  BOB_FREQ:    2.15,
  ACCEL_K:     9.5,
  SMOOTH_Y_K:  15
};

/* ═══════════════════════════════════════════════════════════════════════════
   2 · МАТЕМАТИКА / ШУМ
   ═══════════════════════════════════════════════════════════════════════════ */

export const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
export const lerp  = (a, b, t) => a + (b - a) * t;

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2i(x, y) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2i(xi, yi),     b = hash2i(xi + 1, yi);
  const c = hash2i(xi, yi + 1), d = hash2i(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export function fbm(x, y, oct = 4, lac = 2.03, gain = 0.5) {
  let s = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(fx, fy);
    norm += amp;
    amp *= gain;
    fx *= lac; fy *= lac;
  }
  return s / norm;
}

export function pnoise(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = (i) => ((i % period) + period) % period;
  const a = hash2i(w(xi), w(yi)),     b = hash2i(w(xi + 1), w(yi));
  const c = hash2i(w(xi), w(yi + 1)), d = hash2i(w(xi + 1), w(yi + 1));
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export function pfbm(x, y, period, oct = 4) {
  let s = 0, amp = 1, norm = 0, fx = x, fy = y, p = period;
  for (let i = 0; i < oct; i++) {
    s += amp * pnoise(fx, fy, p);
    norm += amp;
    amp *= 0.5;
    fx *= 2; fy *= 2; p *= 2;
  }
  return s / norm;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · ПУТИ И РЕЛЬЕФ
   ═══════════════════════════════════════════════════════════════════════════ */

/** Создаёт пару функций pathMask и terrainHeight по конфигу. */
export function makeTerrainFunctions(config = FIELD_CONFIG) {
  const PATH_A = config.PATH_A_JS;
  const PATH_B = config.PATH_B_JS;
  const PATH_W = config.PATH_W;
  const PATH_E = config.PATH_E;

  function pathMask(x, z) {
    const dA = Math.abs(x - PATH_A(z));
    const dB = Math.abs(z - PATH_B(x));
    const mA = 1 - smoothstep(PATH_W, PATH_W + PATH_E, dA);
    const mB = 1 - smoothstep(PATH_W, PATH_W + PATH_E, dB);
    return mA > mB ? mA : mB;
  }

  function terrainHeight(x, z) {
    let h = (fbm(x * 0.0055, z * 0.0055, 4) - 0.5) * 30.0;
    h += (fbm(x * 0.019 + 31.7, z * 0.019 - 11.3, 3) - 0.5) * 5.5;
    const fine = (fbm(x * 0.075, z * 0.075, 3) - 0.5) * 0.9;
    const p = pathMask(x, z);
    h += fine * (1 - 0.9 * p);
    h -= p * 0.42;
    return h;
  }

  return { pathMask, terrainHeight };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · ПРОЦЕДУРНЫЕ ТЕКСТУРЫ
   ═══════════════════════════════════════════════════════════════════════════ */

function _canvasTexture(size, pixelFn, maxAniso) {
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
      d[i]     = clamp(out[0] * 255, 0, 255);
      d[i + 1] = clamp(out[1] * 255, 0, 255);
      d[i + 2] = clamp(out[2] * 255, 0, 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function makeGrassTexture(maxAniso = 8) {
  return _canvasTexture(1024, (u, v, out) => {
    const x = u * 10, y = v * 10, P = 10;
    const n1 = pfbm(x, y, P, 5);
    const n2 = pfbm(x * 3 + 40, y * 3 + 40, P * 3, 4);
    const n3 = pfbm(x * 16 + 7, y * 16 + 7, P * 16, 3);
    const n4 = pfbm(x * 48 + 3, y * 48 + 3, P * 48, 2);

    let r = 0.095, g = 0.082, b = 0.042;
    const t1 = smoothstep(0.34, 0.66, n1);
    r = lerp(r, 0.245, t1); g = lerp(g, 0.198, t1); b = lerp(b, 0.088, t1);
    const t2 = smoothstep(0.52, 0.86, n2) * 0.9;
    r = lerp(r, 0.400, t2); g = lerp(g, 0.325, t2); b = lerp(b, 0.152, t2);
    const t3 = smoothstep(0.58, 0.92, n4) * 0.5;
    r = lerp(r, 0.335, t3); g = lerp(g, 0.278, t3); b = lerp(b, 0.142, t3);

    const s = 0.70 + n3 * 0.64;
    out[0] = r * s; out[1] = g * s; out[2] = b * s;
  }, maxAniso);
}

export function makeDirtTexture(maxAniso = 8) {
  return _canvasTexture(1024, (u, v, out) => {
    const x = u * 8, y = v * 8, P = 8;
    const n1 = pfbm(x, y, P, 5);
    const n2 = pfbm(x * 4 + 11, y * 4 + 11, P * 4, 4);
    const n3 = pfbm(x * 20 + 3, y * 20 + 3, P * 20, 3);
    const n4 = pfbm(x * 60 + 8, y * 60 + 8, P * 60, 2);

    let r = 0.155, g = 0.118, b = 0.076;
    const t1 = smoothstep(0.38, 0.68, n1);
    r = lerp(r, 0.290, t1); g = lerp(g, 0.228, t1); b = lerp(b, 0.148, t1);
    const t2 = smoothstep(0.56, 0.90, n2) * 0.72;
    r = lerp(r, 0.082, t2); g = lerp(g, 0.066, t2); b = lerp(b, 0.048, t2);
    const t3 = smoothstep(0.70, 0.94, n3);
    r = lerp(r, 0.400, t3); g = lerp(g, 0.368, t3); b = lerp(b, 0.322, t3);
    const t4 = smoothstep(0.82, 0.98, n4) * 0.55;
    r = lerp(r, 0.500, t4); g = lerp(g, 0.482, t4); b = lerp(b, 0.448, t4);

    const s = 0.80 + n3 * 0.45;
    out[0] = r * s; out[1] = g * s; out[2] = b * s;
  }, maxAniso);
}

export function makeRyeTexture(maxAniso = 8) {
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
    const h  = S * (0.48 + rnd() * 0.46);
    const lean = (rnd() - 0.5) * 88;
    const w  = 3.0 + rnd() * 3.0;

    const y0 = S;
    const y1 = S - h;
    const x1 = x0 + lean;

    const hue = 40 + rnd() * 12;
    const sat = 58 + rnd() * 24;
    const l0  = 15 + rnd() * 11;
    const l1  = 44 + rnd() * 14;

    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0.00, `hsl(${hue - 6}, ${sat - 10}%, ${l0}%)`);
    grad.addColorStop(0.35, `hsl(${hue - 2}, ${sat - 4}%, ${l0 + 9}%)`);
    grad.addColorStop(0.75, `hsl(${hue}, ${sat}%, ${l0 + 20}%)`);
    grad.addColorStop(1.00, `hsl(${hue + 4}, ${sat}%, ${l1}%)`);

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
    const grainL_tip  = grainL_base - 10;

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

      const grainGrad = ctx.createRadialGradient(0, yy, 0, 0, yy, 5.2 * sc);
      grainGrad.addColorStop(0.0, `hsla(${earHue}, ${earSat}%, ${grainL + 6}%, 0.55)`);
      grainGrad.addColorStop(1.0, `hsla(${earHue - 6}, ${earSat}%, ${grainL - 10}%, 0.0)`);
      ctx.fillStyle = grainGrad;
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
      ctx.lineTo( awnLen * 0.75, yy - awnLen);
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
  tex.anisotropy = maxAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · ГЕОМЕТРИЯ РЖИ (крест из 3 плоскостей)
   ═══════════════════════════════════════════════════════════════════════════ */

export function makeCrossRyeGeometry(planes = 3) {
  const geos = [];
  for (let i = 0; i < planes; i++) {
    const g = new THREE.PlaneGeometry(1, 1, 1, 4);
    g.translate(0, 0.5, 0);
    g.rotateY((i * Math.PI) / planes);
    geos.push(g);
  }
  const merged = BufferGeometryUtils.mergeGeometries(geos);
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · НЕБО (шейдерное, с fbm-облаками)
   ═══════════════════════════════════════════════════════════════════════════ */

export function createSky(config = FIELD_CONFIG) {
  const sunDir = new THREE.Vector3().fromArray(config.SUN_DIR).normalize();
  const fogColor = new THREE.Color(config.FOG_COLOR);

  const uniforms = {
    uTime:     { value: 0 },
    uSunDir:   { value: sunDir.clone() },
    uFogColor: { value: fogColor.clone() }
  };

  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
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
    `
  });

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(config.SKY_RADIUS, config.SKY_SEG_W, config.SKY_SEG_H),
    material
  );
  mesh.frustumCulled = false;

  return {
    mesh,
    uniforms,
    update(cameraPos, time) {
      mesh.position.copy(cameraPos);
      uniforms.uTime.value = time;
      uniforms.uSunDir.value.copy(sunDir);
      uniforms.uFogColor.value.copy(fogColor);
    }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   7 · ДОЖДЬ (инстансные стрики)
   ═══════════════════════════════════════════════════════════════════════════ */

export function createRain(config = FIELD_CONFIG) {
  const COUNT  = config.RAIN_COUNT;
  const BOX_XZ = config.RAIN_BOX_XZ;
  const BOX_Y  = config.RAIN_BOX_Y;
  const Y_BELOW = config.RAIN_Y_BELOW;

  const baseGeo = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = baseGeo.index;
  geo.setAttribute('position', baseGeo.attributes.position);

  const iPos   = new Float32Array(COUNT * 3);
  const iSpeed = new Float32Array(COUNT);
  const iLen   = new Float32Array(COUNT);
  const iWid   = new Float32Array(COUNT);
  const iAlpha = new Float32Array(COUNT);

  const rnd = mulberry32(4242);
  for (let i = 0; i < COUNT; i++) {
    iPos[i * 3 + 0] = rnd() * BOX_XZ;
    iPos[i * 3 + 1] = rnd() * BOX_Y;
    iPos[i * 3 + 2] = rnd() * BOX_XZ;
    iSpeed[i] = 18 + rnd() * 16;
    iLen[i]   = 0.7 + rnd() * 1.1;
    iWid[i]   = 0.006 + rnd() * 0.010;
    iAlpha[i] = 0.35 + rnd() * 0.65;
  }

  geo.setAttribute('iPos',   new THREE.InstancedBufferAttribute(iPos, 3));
  geo.setAttribute('iSpeed', new THREE.InstancedBufferAttribute(iSpeed, 1));
  geo.setAttribute('iLen',   new THREE.InstancedBufferAttribute(iLen, 1));
  geo.setAttribute('iWid',   new THREE.InstancedBufferAttribute(iWid, 1));
  geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(iAlpha, 1));
  geo.instanceCount = COUNT;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms = {
    uTime:   { value: 0 },
    uCam:    { value: new THREE.Vector3() },
    uWind:   { value: new THREE.Vector2(config.RAIN_WIND[0], config.RAIN_WIND[1]) },
    uSunDir: { value: new THREE.Vector3().fromArray(config.SUN_DIR).normalize() }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
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

      const float BOX_XZ  = ${BOX_XZ.toFixed(1)};
      const float BOX_Y   = ${BOX_Y.toFixed(1)};
      const float Y_BELOW = ${Y_BELOW.toFixed(1)};

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

        vFade = smoothstep(${config.RAIN_FADE_NEAR.toFixed(1)}, ${config.RAIN_FADE_FAR.toFixed(1)}, camDist)
              * smoothstep(0.6, 2.2, camDist);
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
    `
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  /* Ветер со временем колеблется — управляется снаружи. */
  const state = {
    windX: config.RAIN_WIND[0],
    windZ: config.RAIN_WIND[1]
  };

  return {
    mesh,
    uniforms,
    state,
    update(cameraPos, time, dt) {
      /* Плавная смена ветра */
      const targetX = config.RAIN_WIND[0] + Math.sin(time * config.RAIN_WIND_FREQ_X) * config.RAIN_WIND_SWAY_X;
      const targetZ = config.RAIN_WIND[1] + Math.cos(time * config.RAIN_WIND_FREQ_Z + 1.3) * config.RAIN_WIND_SWAY_Z;
      const k = 1 - Math.exp(-dt * 0.6);
      state.windX += (targetX - state.windX) * k;
      state.windZ += (targetZ - state.windZ) * k;

      uniforms.uTime.value = time;
      uniforms.uCam.value.copy(cameraPos);
      uniforms.uWind.value.set(state.windX, state.windZ);
    }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   8 · СВЕТ
   ═══════════════════════════════════════════════════════════════════════════ */

export function createFieldLights(config = FIELD_CONFIG) {
  const hemi = new THREE.HemisphereLight(config.HEMI_SKY, config.HEMI_GROUND, config.HEMI_INT);

  const ambient = new THREE.AmbientLight(config.AMBIENT_COL, config.AMBIENT_INT);

  const sunDir = new THREE.Vector3().fromArray(config.SUN_DIR).normalize();

  const sun = new THREE.DirectionalLight(config.SUN_COL, config.SUN_INT);
  sun.castShadow = true;
  sun.shadow.mapSize.set(config.SHADOW_MAP_SIZE, config.SHADOW_MAP_SIZE);
  const E = config.SHADOW_EXTENT;
  sun.shadow.camera.left   = -E;
  sun.shadow.camera.right  =  E;
  sun.shadow.camera.top    =  E;
  sun.shadow.camera.bottom = -E;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far  = 140;
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.008;
  sun.shadow.radius = 1.6;

  const fill = new THREE.DirectionalLight(config.FILL_COL, config.FILL_INT);

  return {
    hemi,
    ambient,
    sun,
    fill,
    sunDir,
    /** Обновить позиции светил относительно игрока (для shadowmap-«фокуса»). */
    follow(cameraPos, groundY) {
      sun.target.position.set(cameraPos.x, groundY, cameraPos.z);
      sun.position.set(
        cameraPos.x + sunDir.x * 95,
        groundY     + sunDir.y * 90,
        cameraPos.z + sunDir.z * 95
      );
      fill.target.position.set(cameraPos.x, groundY, cameraPos.z);
      fill.position.set(cameraPos.x - 55, groundY + 44, cameraPos.z - 48);
      sun.target.updateMatrixWorld();
      fill.target.updateMatrixWorld();
    }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   9 · МАТЕРИАЛ ЗЕМЛИ (трава / грязь / лужи / рябь)
   ═══════════════════════════════════════════════════════════════════════════ */

export function createGroundMaterial(grassTex, dirtTex, config = FIELD_CONFIG) {
  const uniforms = { uTime: { value: 0 } };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0
  });

  mat.userData.uniforms = uniforms;

  const PATH_W = config.PATH_W;
  const PATH_E = config.PATH_E;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassTex = { value: grassTex };
    shader.uniforms.uDirtTex  = { value: dirtTex };
    shader.uniforms.uTime     = uniforms.uTime;

    shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );

    shader.fragmentShader = `
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
        float dA = abs(w.x - (${config.PATH_A_GLSL}));
        float dB = abs(w.y - (${config.PATH_B_GLSL}));
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
      float puddleShape = smoothstep(${config.PUDDLE_LO.toFixed(2)}, ${config.PUDDLE_HI.toFixed(2)}, puddleNoise + pm * 0.05);
      float wetEdge = smoothstep(${config.WETEDGE_LO.toFixed(2)}, ${config.WETEDGE_HI.toFixed(2)}, puddleNoise + pm * 0.04) - puddleShape;

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

  return mat;
}

/* ═══════════════════════════════════════════════════════════════════════════
   10 · МАТЕРИАЛ РЖИ (качание на ветру, SSS-подсветка)
   ═══════════════════════════════════════════════════════════════════════════ */

export function createRyeMaterial(ryeTex, config = FIELD_CONFIG) {
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: 1.0 },
    uWet:  { value: 1.0 }
  };

  const mat = new THREE.MeshStandardMaterial({
    map: ryeTex,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.0,
    side: THREE.DoubleSide,
    alphaTest: 0.30,
    transparent: false,
    depthWrite: true,
    depthTest: true
  });

  mat.userData.uniforms = uniforms;

  const [windX, windZ] = config.RYE_WIND_DIR;
  const gustX = config.RYE_GUST_SCALE[0];
  const gustZ = config.RYE_GUST_SCALE[1];
  const windAmp = config.RYE_WIND_AMP;
  const gustAmp = config.RYE_GUST_AMP;
  const gustFreq = config.RYE_GUST_FREQ;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uWet  = uniforms.uWet;

    shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\n' + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 iwp = (instanceMatrix * vec4(position, 1.0)).xyz;
        float ph = iwp.x * 0.62 + iwp.z * 0.47;

        float gustPhase = iwp.x * ${gustX.toFixed(3)} + iwp.z * ${gustZ.toFixed(3)} - uTime * ${gustFreq.toFixed(3)};
        float gust = sin(gustPhase) * 0.5 + 0.5;
        gust = pow(gust, 2.5);
        float gustAmpC = ${gustAmp.toFixed(3)};

        float bigWave = sin(uTime * 0.85 + ph * 0.28) * 0.62
                      + sin(uTime * 0.41 + ph * 0.17) * 0.45;
        float midWave = sin(uTime * 1.55 + ph) * 0.55
                      + sin(uTime * 2.90 + ph * 1.73) * 0.28;
        float flutter = sin(uTime * 6.5 + ph * 4.3) * 0.15
                      + sin(uTime * 11.2 + ph * 7.1) * 0.08;

        vec2 windDir = normalize(vec2(${windX.toFixed(3)}, ${windZ.toFixed(3)}));
        float gustContrib = gust * gustAmpC;
        float wv = bigWave * 0.55 + midWave * 0.9 + flutter;

        float bend = position.y * position.y;
        float amp = ${windAmp.toFixed(4)} * uWind;
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

  return mat;
}

export function createRyeDepthMaterial(ryeTex) {
  const mat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: ryeTex,
    alphaTest: 0.15
  });
  mat.side = THREE.DoubleSide;
  return mat;
}

/* ═══════════════════════════════════════════════════════════════════════════
   11 · МЕНЕДЖЕР ЧАНКОВ
   ═══════════════════════════════════════════════════════════════════════════ */

export class FieldTerrain {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Material} opts.groundMaterial
   * @param {THREE.Material} opts.ryeMaterial
   * @param {THREE.BufferGeometry} opts.ryeGeometry
   * @param {THREE.Material} opts.ryeDepthMaterial
   * @param {Function} opts.terrainHeight  — (x,z) => height
   * @param {Function} opts.pathMask       — (x,z) => 0..1
   * @param {object} [opts.config]
   */
  constructor(opts) {
    this.scene           = opts.scene;
    this.groundMaterial  = opts.groundMaterial;
    this.ryeMaterial     = opts.ryeMaterial;
    this.ryeGeometry     = opts.ryeGeometry;
    this.ryeDepthMaterial= opts.ryeDepthMaterial;
    this.terrainHeight   = opts.terrainHeight;
    this.pathMask        = opts.pathMask;

    this.config = Object.assign({}, FIELD_CONFIG, opts.config || {});

    this.chunks = new Map();
    this.jobs   = new Map();
    this.revealingChunks = [];

    this.lastCX = Infinity;
    this.lastCZ = Infinity;
  }

  keyOf(cx, cz) { return cx + ',' + cz; }

  /* -------- публичный API -------- */

  getHeightAt(x, z) {
    return this.terrainHeight(x, z);
  }

  /** Главный апдейт: стриминг + обработка задач + анимация появления ржи. */
  update(px, pz, budgetMs = 7) {
    this._updateChunkGrid(px, pz);
    this._processJobs(budgetMs);
    this._updateRevealingChunks();
  }

  /** Кол-во оставшихся задач (для прогресс-бара загрузки). */
  get pendingJobs() { return this.jobs.size; }

  /** true, если всё вокруг загружено и появления завершены. */
  get isReady() { return this.jobs.size === 0 && this.revealingChunks.length === 0; }

  dispose() {
    for (const ch of this.chunks.values()) this._disposeChunk(ch);
    this.chunks.clear();
    this.jobs.clear();
    this.revealingChunks.length = 0;
  }

  /* -------- внутренние -------- */

  _makeJob(cx, cz, dist) {
    return {
      cx, cz, dist, key: this.keyOf(cx, cz),
      stage: 'grid',
      grid: null, N: 0, NP: 0, ox: 0, oz: 0, step: 0,
      terrain: null, inst: null, dummy: null, rnd: null,
      i: 0, n: 0, col: new THREE.Color(),
      totalCount: 0
    };
  }

  _sampleGrid(job, wx, wz) {
    const N = job.N, NP = job.NP, step = job.step, g = job.grid;
    let fx = (wx - job.ox) / step;
    let fz = (wz - job.oz) / step;
    if (fx < 0) fx = 0; else if (fx > N - 1.0001) fx = N - 1.0001;
    if (fz < 0) fz = 0; else if (fz > N - 1.0001) fz = N - 1.0001;
    const i0 = fx | 0, j0 = fz | 0;
    const tx = fx - i0, tz = fz - j0;
    const ip = i0 + 1, jp = j0 + 1;
    const a = g[jp * NP + ip];
    const b = g[jp * NP + ip + 1];
    const c = g[(jp + 1) * NP + ip];
    const d = g[(jp + 1) * NP + ip + 1];
    const ab = a + (b - a) * tx;
    const cd = c + (d - c) * tx;
    return ab + (cd - ab) * tz;
  }

  _advanceJob(job) {
    const cfg = this.config;

    if (job.stage === 'grid') {
      const N = cfg.CHUNK_SEG + 1;
      const NP = N + 2;
      const step = cfg.CHUNK / cfg.CHUNK_SEG;
      const ox = job.cx * cfg.CHUNK - cfg.CHUNK / 2;
      const oz = job.cz * cfg.CHUNK - cfg.CHUNK / 2;
      const g = new Float32Array(NP * NP);
      for (let j = -1; j <= N; j++) {
        const wz = oz + j * step;
        for (let i = -1; i <= N; i++) {
          g[(j + 1) * NP + (i + 1)] = this.terrainHeight(ox + i * step, wz);
        }
      }
      job.grid = g; job.N = N; job.NP = NP;
      job.ox = ox; job.oz = oz; job.step = step;
      job.stage = 'terrain';
      return;
    }

    if (job.stage === 'terrain') {
      const N = job.N, NP = job.NP, step = job.step, g = job.grid;

      const geo = new THREE.PlaneGeometry(cfg.CHUNK, cfg.CHUNK, cfg.CHUNK_SEG, cfg.CHUNK_SEG);
      geo.rotateX(-Math.PI / 2);

      const pos = geo.attributes.position;
      const nrm = geo.attributes.normal;
      const half = cfg.CHUNK / 2;

      for (let k = 0; k < pos.count; k++) {
        const lx = pos.getX(k);
        const lz = pos.getZ(k);
        let gi = Math.round((lx + half) / step);
        let gj = Math.round((lz + half) / step);
        if (gi < 0) gi = 0; else if (gi > N - 1) gi = N - 1;
        if (gj < 0) gj = 0; else if (gj > N - 1) gj = N - 1;

        const ip = gi + 1, jp = gj + 1;
        pos.setY(k, g[jp * NP + ip]);

        const hL = g[jp * NP + (ip - 1)];
        const hR = g[jp * NP + (ip + 1)];
        const hD = g[(jp - 1) * NP + ip];
        const hU = g[(jp + 1) * NP + ip];
        let nx = hL - hR;
        let ny = 2 * step;
        let nz = hD - hU;
        const inv = 1 / Math.sqrt(nx*nx + ny*ny + nz*nz);
        nrm.setXYZ(k, nx * inv, ny * inv, nz * inv);
      }
      pos.needsUpdate = true;
      nrm.needsUpdate = true;
      geo.computeBoundingSphere();

      const terrain = new THREE.Mesh(geo, this.groundMaterial);
      terrain.receiveShadow = true;
      terrain.castShadow = false;
      terrain.position.set(job.cx * cfg.CHUNK, 0, job.cz * cfg.CHUNK);
      terrain.matrixAutoUpdate = false;
      terrain.updateMatrix();
      this.scene.add(terrain);

      const inst = new THREE.InstancedMesh(this.ryeGeometry, this.ryeMaterial, cfg.RYE_PER_CHUNK);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.count = 0;
      inst.frustumCulled = false;
      inst.customDepthMaterial = this.ryeDepthMaterial;

      const zeroColor = new Float32Array(cfg.RYE_PER_CHUNK * 3);
      for (let c = 0; c < cfg.RYE_PER_CHUNK; c++) {
        zeroColor[c*3] = 1; zeroColor[c*3+1] = 1; zeroColor[c*3+2] = 1;
      }
      inst.instanceColor = new THREE.InstancedBufferAttribute(zeroColor, 3);
      this.scene.add(inst);

      this.chunks.set(job.key, {
        cx: job.cx, cz: job.cz, key: job.key, terrain, grass: inst
      });

      job.terrain = terrain;
      job.inst = inst;
      job.dummy = new THREE.Object3D();
      job.rnd = mulberry32(((job.cx * 73856093) ^ (job.cz * 19349663) ^ 0x9e3779b9) >>> 0);
      job.i = 0;
      job.n = 0;
      job.stage = 'rye';
      return;
    }

    if (job.stage === 'rye') {
      if (!this.chunks.has(job.key)) { job.stage = 'done'; return; }

      const inst = job.inst;
      const dummy = job.dummy;
      const rnd = job.rnd;
      const col = job.col;

      const BATCH = cfg.RYE_BATCH;
      const TOTAL = cfg.RYE_PER_CHUNK;

      let processed = 0;
      while (job.i < TOTAL && processed < BATCH) {
        const wx = job.ox + rnd() * cfg.CHUNK;
        const wz = job.oz + rnd() * cfg.CHUNK;

        const pm = this.pathMask(wx, wz);
        if (pm > 0.02 && rnd() < pm * 1.15) { job.i++; continue; }

        const ground = this._sampleGrid(job, wx, wz);

        const sc = cfg.RYE_SCALE_XZ_MIN + rnd() * cfg.RYE_SCALE_XZ_RANGE;
        const h  = (cfg.RYE_HEIGHT_MIN + rnd() * cfg.RYE_HEIGHT_RANGE) *
                   (1 - pm * cfg.RYE_PATH_HEIGHT_RED);

        const tiltX = (rnd() - 0.5) * cfg.RYE_TILT;
        const tiltZ = (rnd() - 0.5) * cfg.RYE_TILT;

        dummy.position.set(wx, ground + cfg.RYE_Y_OFFSET, wz);
        dummy.rotation.set(tiltX, rnd() * Math.PI * 2, tiltZ);
        dummy.scale.set(
          sc * cfg.RYE_SCALE_XZ_BOOST,
          h,
          sc * cfg.RYE_SCALE_XZ_BOOST
        );
        dummy.updateMatrix();
        inst.setMatrixAt(job.n, dummy.matrix);

        const t = cfg.RYE_COLOR_T_MIN + rnd() * cfg.RYE_COLOR_T_RANGE;
        col.setRGB(
          clamp(t * (cfg.RYE_COLOR_R + rnd() * cfg.RYE_COLOR_R_RANGE), 0, 1.6),
          clamp(t * (cfg.RYE_COLOR_G + rnd() * cfg.RYE_COLOR_G_RANGE), 0, 1.6),
          clamp(t * (cfg.RYE_COLOR_B + rnd() * cfg.RYE_COLOR_B_RANGE), 0, 1.6)
        );
        inst.setColorAt(job.n, col);

        job.n++;
        job.i++;
        processed++;
      }

      inst.instanceMatrix.needsUpdate = true;
      inst.instanceColor.needsUpdate = true;

      if (job.i < TOTAL) return;

      job.totalCount = job.n;
      this.revealingChunks.push({ inst, totalCount: job.n, currentCount: 0 });
      job.stage = 'done';
      return;
    }
  }

  _updateRevealingChunks() {
    for (let i = this.revealingChunks.length - 1; i >= 0; i--) {
      const rc = this.revealingChunks[i];
      if (!rc.inst.parent) { this.revealingChunks.splice(i, 1); continue; }
      rc.currentCount = Math.min(rc.totalCount, rc.currentCount + this.config.REVEAL_SPEED);
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
    const cfg = this.config;
    const ccx = Math.floor(px / cfg.CHUNK);
    const ccz = Math.floor(pz / cfg.CHUNK);
    if (ccx === this.lastCX && ccz === this.lastCZ) return;
    this.lastCX = ccx; this.lastCZ = ccz;

    const desiredCreate = new Set();
    for (let dz = -cfg.VIEW_RAD; dz <= cfg.VIEW_RAD; dz++) {
      for (let dx = -cfg.VIEW_RAD; dx <= cfg.VIEW_RAD; dx++) {
        if (dx*dx + dz*dz <= cfg.VIEW_RAD * cfg.VIEW_RAD + 1) {
          desiredCreate.add(this.keyOf(ccx + dx, ccz + dz));
        }
      }
    }

    const desiredKeep = new Set();
    for (let dz = -cfg.DISPOSE_RAD; dz <= cfg.DISPOSE_RAD; dz++) {
      for (let dx = -cfg.DISPOSE_RAD; dx <= cfg.DISPOSE_RAD; dx++) {
        if (dx*dx + dz*dz <= cfg.DISPOSE_RAD * cfg.DISPOSE_RAD + 1) {
          desiredKeep.add(this.keyOf(ccx + dx, ccz + dz));
        }
      }
    }

    for (const [k, ch] of this.chunks) {
      if (!desiredKeep.has(k)) { this._disposeChunk(ch); this.chunks.delete(k); }
    }

    for (const k of [...this.jobs.keys()]) {
      if (!desiredKeep.has(k)) {
        const ch = this.chunks.get(k);
        if (ch) { this._disposeChunk(ch); this.chunks.delete(k); }
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
    if (this.jobs.size === 0) return;
    const deadline = performance.now() + budgetMs;
    while (this.jobs.size > 0) {
      let best = null;
      for (const j of this.jobs.values()) {
        if (!best || j.dist < best.dist) best = j;
      }
      if (!best) break;
      this._advanceJob(best);
      if (best.stage === 'done') this.jobs.delete(best.key);
      if (performance.now() >= deadline) break;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   12 · КОНТРОЛЛЕР ИГРОКА (WASD + рельеф + покачивание)
   ═══════════════════════════════════════════════════════════════════════════ */

export class FieldPlayerController {
  /**
   * @param {THREE.Camera} camera
   * @param {FieldTerrain} terrain
   * @param {object} [opts]
   * @param {object} [opts.keys]      — внешний keyState (Object.create(null))
   * @param {object} [opts.config]    — переопределение FIELD_CONFIG
   * @param {number} [opts.startX]
   * @param {number} [opts.startZ]
   */
  constructor(camera, terrain, opts = {}) {
    this.camera  = camera;
    this.terrain = terrain;
    this.config  = Object.assign({}, FIELD_CONFIG, opts.config || {});
    this.keys    = opts.keys || Object.create(null);

    this.playerPos = new THREE.Vector3(opts.startX ?? 0, 0, opts.startZ ?? 0);
    this.velocity  = new THREE.Vector3();
    this.bobPhase  = 0;
    this.smoothY   = terrain.getHeightAt(this.playerPos.x, this.playerPos.z) + this.config.EYE_HEIGHT;

    this._fwd   = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish  = new THREE.Vector3();
    this._up    = new THREE.Vector3(0, 1, 0);

    camera.position.set(this.playerPos.x, this.smoothY, this.playerPos.z);
  }

  setPosition(x, z) {
    this.playerPos.set(x, 0, z);
    this.smoothY = this.terrain.getHeightAt(x, z) + this.config.EYE_HEIGHT;
    this.camera.position.set(x, this.smoothY, z);
  }

  update(dt) {
    const cfg = this.config;
    const keys = this.keys;

    const running = !!(keys['ShiftLeft'] || keys['ShiftRight']);
    const speed = running ? cfg.RUN_SPEED : cfg.WALK_SPEED;

    this.camera.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    if (this._fwd.lengthSq() < 1e-8) this._fwd.set(0, 0, -1);
    this._fwd.normalize();

    this._right.crossVectors(this._fwd, this._up).normalize();

    this._wish.set(0, 0, 0);
    if (keys['KeyW'] || keys['ArrowUp'])    this._wish.add(this._fwd);
    if (keys['KeyS'] || keys['ArrowDown'])  this._wish.sub(this._fwd);
    if (keys['KeyD'] || keys['ArrowRight']) this._wish.add(this._right);
    if (keys['KeyA'] || keys['ArrowLeft'])  this._wish.sub(this._right);

    if (this._wish.lengthSq() > 0) this._wish.normalize().multiplyScalar(speed);

    const k = 1 - Math.exp(-cfg.ACCEL_K * dt);
    this.velocity.x += (this._wish.x - this.velocity.x) * k;
    this.velocity.z += (this._wish.z - this.velocity.z) * k;

    this.playerPos.x += this.velocity.x * dt;
    this.playerPos.z += this.velocity.z * dt;

    const groundY = this.terrain.getHeightAt(this.playerPos.x, this.playerPos.z);
    const spd = Math.hypot(this.velocity.x, this.velocity.z);

    this.bobPhase += spd * dt * cfg.BOB_FREQ;
    const bob = Math.sin(this.bobPhase * 2.0) * cfg.BOB_AMP * Math.min(1, spd / 3.2);

    const targetY = groundY + cfg.EYE_HEIGHT + bob;
    this.smoothY += (targetY - this.smoothY) * (1 - Math.exp(-cfg.SMOOTH_Y_K * dt));

    this.camera.position.set(this.playerPos.x, this.smoothY, this.playerPos.z);
  }

  get position() { return this.camera.position; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   13 · ФАБРИКА — собрать всё сразу
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Быстрая сборка «поля».
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} [opts]
 * @param {object} [opts.config]
 * @returns {{ config, sky, rain, lights, terrain, player?, materials, textures,
 *             update(dt, camera, player), dispose() }}
 */
export function createField(scene, renderer, opts = {}) {
  const config = Object.assign({}, FIELD_CONFIG, opts.config || {});
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  /* --- текстуры / геометрия --- */
  const grassTex = makeGrassTexture(maxAniso);
  const dirtTex  = makeDirtTexture(maxAniso);
  const ryeTex   = makeRyeTexture(maxAniso);
  const ryeGeo   = makeCrossRyeGeometry();

  /* --- функции рельефа --- */
  const { pathMask, terrainHeight } = makeTerrainFunctions(config);

  /* --- материалы --- */
  const groundMat   = createGroundMaterial(grassTex, dirtTex, config);
  const ryeMat      = createRyeMaterial(ryeTex, config);
  const ryeDepthMat = createRyeDepthMaterial(ryeTex);

  /* --- сцена --- */
  scene.fog = new THREE.FogExp2(config.FOG_COLOR, config.FOG_DENSITY);
  scene.background = new THREE.Color(config.FOG_COLOR);

  const sky = createSky(config);
  scene.add(sky.mesh);

  const rain = createRain(config);
  scene.add(rain.mesh);

  const lights = createFieldLights(config);
  scene.add(lights.hemi, lights.ambient);
  scene.add(lights.sun, lights.sun.target);
  scene.add(lights.fill, lights.fill.target);

  /* --- ландшафт --- */
  const terrain = new FieldTerrain({
    scene,
    groundMaterial:   groundMat,
    ryeMaterial:      ryeMat,
    ryeGeometry:      ryeGeo,
    ryeDepthMaterial: ryeDepthMat,
    terrainHeight,
    pathMask,
    config
  });

  /* --- общий апдейт --- */
  let time = 0;
  const _camWorld = new THREE.Vector3();

  function update(dt, camera, player) {
    time += dt;

    /* Стриминг чанков — вокруг игрока (или камеры) */
    const px = player ? player.playerPos.x : camera.position.x;
    const pz = player ? player.playerPos.z : camera.position.z;
    terrain.update(px, pz, terrain.isReady ? 7 : 20);

    /* Атмосфера и свет — от камеры */
    camera.getWorldPosition(_camWorld);

    sky.update(_camWorld, time);
    rain.update(_camWorld, time, dt);

    groundMat.userData.uniforms.uTime.value = time;
    ryeMat.userData.uniforms.uTime.value = time;

    const groundY = terrainHeight(_camWorld.x, _camWorld.z);
    lights.follow(_camWorld, groundY);
  }

  function dispose() {
    terrain.dispose();
    scene.remove(sky.mesh);
    sky.mesh.geometry.dispose();
    sky.mesh.material.dispose();
    scene.remove(rain.mesh);
    rain.mesh.geometry.dispose();
    rain.mesh.material.dispose();
    scene.remove(lights.hemi, lights.ambient, lights.sun, lights.sun.target, lights.fill, lights.fill.target);
    grassTex.dispose();
    dirtTex.dispose();
    ryeTex.dispose();
    groundMat.dispose();
    ryeMat.dispose();
    ryeDepthMat.dispose();
    ryeGeo.dispose();
  }

  return {
    config,
    sky,
    rain,
    lights,
    terrain,
    materials: { groundMat, ryeMat, ryeDepthMat },
    textures:  { grassTex, dirtTex, ryeTex },
    geometry:  { ryeGeo },
    terrainHeight,
    pathMask,
    update,
    dispose
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   14 · ПРИМЕР ИСПОЛЬЗОВАНИЯ

   import * as THREE from 'three';
   import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
   import {
     createField, FieldPlayerController, FIELD_CONFIG
   } from './field.js';

   const renderer = new THREE.WebGLRenderer({ antialias: true });
   renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
   renderer.setSize(innerWidth, innerHeight);
   renderer.shadowMap.enabled = true;
   renderer.shadowMap.type = THREE.PCFSoftShadowMap;
   renderer.toneMapping = THREE.ACESFilmicToneMapping;
   renderer.toneMappingExposure = 1.15;
   renderer.outputColorSpace = THREE.SRGBColorSpace;
   document.body.appendChild(renderer.domElement);

   const scene = new THREE.Scene();
   const camera = new THREE.PerspectiveCamera(68, innerWidth/innerHeight, 0.1, 900);

   // --- всё поле одной строкой ---
   const field = createField(scene, renderer);

   // --- игрок ---
   const keys = Object.create(null);
   const player = new FieldPlayerController(camera, field.terrain, { keys });

   // --- PointerLockControls — только для поворота камеры ---
   const controls = new PointerLockControls(camera, renderer.domElement);
   document.addEventListener('click', () => controls.lock());

   // --- ввод ---
   addEventListener('keydown', e => { keys[e.code] = true; });
   addEventListener('keyup',   e => { keys[e.code] = false; });
   addEventListener('blur',    () => { for (const k in keys) keys[k] = false; });

   // --- цикл ---
   const clock = new THREE.Clock();
   (function loop() {
     requestAnimationFrame(loop);
     const dt = Math.min(0.05, clock.getDelta());

     if (controls.isLocked) player.update(dt);
     field.update(dt, camera, player);

     renderer.render(scene, camera);
   })();
   ═══════════════════════════════════════════════════════════════════════════ */