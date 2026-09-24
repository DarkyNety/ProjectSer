/* ============================================================================
 * M9 Flamethrower · Reusable Three.js Module
 * ----------------------------------------------------------------------------
 * Что можно взять по отдельности:
 *   - FLAMETHROWER_CONFIG       — все числа (позы, топливо, сопло, пламя)
 *   - createFlamethrowerMaterials() — фабрика материалов
 *   - createFlamethrower()      — чистая модель (Group 'M9')
 *                                 внутри: 'pilotFlame' (материал мигает)
 *   - FlamethrowerEffects       — частицы, обугливание, горящие пятна,
 *                                 горючие цели (дерево загорается и прогорает)
 *   - WeaponAudio               — процедурный звук с НЕПРЕРЫВНЫМ гулом пламени
 *   - PlayerController          — движение WASD, прыжок, коллизии, обзор
 *   - FlamethrowerController    — вся механика: непрерывная струя, расход
 *                                 топлива, нагрев/перегрев сопла, дым, заправка,
 *                                 осмотр, ADS, пилотное пламя, подсветка сцены,
 *                                 bloom через коллбэк
 * ----------------------------------------------------------------------------
 * Ориентация модели:  +X = дуло, +Y = вверх, +Z = правая сторона.
 * Для viewmodel:      flamer.rotation.y = Math.PI/2;
 *                     flamer.scale.setScalar(FLAMETHROWER_CONFIG.SCALE);
 * ==========================================================================*/

import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════════════
   1 · КОНФИГ
   ═══════════════════════════════════════════════════════════════════════════ */

export const FLAMETHROWER_CONFIG = {
  /* --- масштаб и позы viewmodel --- */
  SCALE: 0.0080,

  BASE_POS: { x:  0.25,  y: -0.10,  z: -0.45 },
  BASE_ROT: { x:  0.02,  y: -0.04,  z:  0.02 },

  ADS_POS:  { x:  0.00,  y: -0.12,  z: -0.22 },
  ADS_ROT:  { x:  0,     y:  0,     z:  0    },

  /* Дуло в «модельных» единицах (умножается на SCALE) */
  MUZZLE_X:  0,
  MUZZLE_Y:  0,
  MUZZLE_Z: -31.5,

  /* --- топливо / сопло --- */
  FUEL_MAX:      100,
  FUEL_PER_SEC:  7.5,
  REFUEL_DUR:    6.0,

  NOZZLE_MAX:           100,
  NOZZLE_HEAT_RATE:     14,
  NOZZLE_COOL_RATE:     12,
  NOZZLE_SMOKE_LEVEL:   55,   // с какого уровня идёт дым
  NOZZLE_OVERHEAT_LEVEL:100,
  NOZZLE_RESET_LEVEL:   30,   // остыло — можно снова

  /* --- тайминги --- */
  INSPECT_DUR: 5.60,
  DRAW_DUR:    1.10,

  /* --- FOV --- */
  MAIN_FOV:              75,
  ADS_FOV_DELTA:        -20,
  WEAPON_FOV:            58,
  WEAPON_ADS_FOV_DELTA: -14,

  /* --- мышь / игрок --- */
  MOUSE_SENS:     0.0022,
  MOUSE_ADS_MULT: 0.5,
  MOVE_ADS_MULT:  0.5,

  /* --- пламя --- */
  FLAME_RANGE:        18,      // макс. дистанция струи (м)
  FLAME_SPREAD_BASE:  0.10,
  FLAME_SPREAD_ADS_MULT: 0.6,

  /* Количество частиц за кадр (при 60 fps) */
  EMIT_CORE:   2,
  EMIT_MAIN:   4,
  EMIT_OUTER:  3,
  EMIT_SMOKE:  2,
  EMIT_SPARKS: 2,
  EMIT_IMPACT: 4,
  EMIT_IMPACT_SMOKE: 2,

  /* --- свет и bloom --- */
  MUZZLE_LIGHT_FIRING_BASE: 6,
  MUZZLE_LIGHT_FIRING_RAND: 3,
  MUZZLE_LIGHT_DISTANCE:    7,
  BLOOM_IDLE:       0.42,
  BLOOM_FIRING_BASE:0.52,
  BLOOM_FIRING_RAND:0.06,

  /* --- пилотное пламя --- */
  PILOT_BASE_INTENSITY: 5,
  PILOT_FLICKER_A: 0.15,
  PILOT_FLICKER_B: 0.08,
  PILOT_FREQ_A:   22,
  PILOT_FREQ_B:   37,

  /* --- анимация заправки --- */
  REFUEL_TILT_IN:  0.40,
  REFUEL_TILT_OUT: 0.60,
  REFUEL_SFX_START:0.30,
  REFUEL_SFX_HISS_END: 0.95,

  /* --- обугливание / горючие цели --- */
  SCORCH_MAX: 60,
  GROUND_FIRE_MAX: 20,
  GROUND_FIRE_LIFE_MIN: 4,
  GROUND_FIRE_LIFE_MAX: 7,
  BURNABLE_TIME: 12,

  /* --- ключи анимации осмотра --- */
  INSPECT_END: 3.10,
  INSPECT_KEYS: [
    { t: 0.00, p: [ 0.00,  0.00, 0.00], r: [ 0.00,  0.00,  0.00] },
    { t: 0.45, p: [ 0.04,  0.05, 0.06], r: [-0.10,  0.75, -0.65] },
    { t: 1.15, p: [ 0.02,  0.07, 0.10], r: [ 0.05, -0.65,  0.60] },
    { t: 1.85, p: [-0.02,  0.06, 0.04], r: [ 0.45,  0.15,  0.10] },
    { t: 2.45, p: [ 0.00,  0.03, 0.03], r: [ 0.10,  0.05,  0.22] },
    { t: 3.10, p: [ 0.00,  0.00, 0.00], r: [ 0.00,  0.00,  0.00] }
  ]
};

/* ═══════════════════════════════════════════════════════════════════════════
   2 · ПРОЦЕДУРНЫЕ ТЕКСТУРЫ
   ═══════════════════════════════════════════════════════════════════════════ */

export function makeNoiseTexture(size = 256, contrast = 0.30) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 200 + (Math.random() - 0.5) * 255 * contrast;
    img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = v;
    img.data[i*4+3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function makeFlameParticleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0.0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.15)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeScorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);

  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
  g.addColorStop(0.00, 'rgba(0,0,0,0.95)');
  g.addColorStop(0.40, 'rgba(10,8,6,0.85)');
  g.addColorStop(0.70, 'rgba(30,25,20,0.55)');
  g.addColorStop(0.90, 'rgba(60,50,40,0.20)');
  g.addColorStop(1.00, 'rgba(80,70,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(64, 64, 60, 0, 7); ctx.fill();

  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 55;
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    const s = 3 + Math.random() * 8;
    ctx.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.5})`;
    ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · МАТЕРИАЛЫ
   ═══════════════════════════════════════════════════════════════════════════ */

const _NOISE      = makeNoiseTexture(256, 0.30);
const _NOISE_FINE = makeNoiseTexture(256, 0.14); _NOISE_FINE.repeat.set(12, 12);

export function createFlamethrowerMaterials() {
  return {
    bodyOlive:     new THREE.MeshStandardMaterial({ color: 0x39402b, metalness: 0.85, roughness: 0.62, roughnessMap: _NOISE }),
    bodyOliveDark: new THREE.MeshStandardMaterial({ color: 0x262c1c, metalness: 0.88, roughness: 0.70, roughnessMap: _NOISE }),
    steelDark:     new THREE.MeshStandardMaterial({ color: 0x1e2226, metalness: 1.0,  roughness: 0.52, roughnessMap: _NOISE }),
    steel:         new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 1.0,  roughness: 0.42, roughnessMap: _NOISE }),
    steelBright:   new THREE.MeshStandardMaterial({ color: 0x707880, metalness: 1.0,  roughness: 0.32, roughnessMap: _NOISE_FINE }),
    blackMetal:    new THREE.MeshStandardMaterial({ color: 0x121519, metalness: 0.88, roughness: 0.60, roughnessMap: _NOISE }),
    tank:          new THREE.MeshStandardMaterial({ color: 0x2e3a26, metalness: 0.92, roughness: 0.48, roughnessMap: _NOISE }),
    red:           new THREE.MeshStandardMaterial({ color: 0x8e1a14, metalness: 0.5,  roughness: 0.55 }),
    brass:         new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 1.0,  roughness: 0.35 }),
    polymer:       new THREE.MeshStandardMaterial({ color: 0x1a1d21, metalness: 0.06, roughness: 0.62, roughnessMap: _NOISE }),
    polymerMatte:  new THREE.MeshStandardMaterial({ color: 0x0f1113, metalness: 0.03, roughness: 0.88 }),
    rubber:        new THREE.MeshStandardMaterial({ color: 0x0d0f11, metalness: 0.03, roughness: 0.92 }),
    hose:          new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.2,  roughness: 0.78 }),
    glass:         new THREE.MeshPhysicalMaterial({
      color: 0xdfe8f0, metalness: 0.0, roughness: 0.05,
      transparent: true, opacity: 0.35, side: THREE.DoubleSide,
      clearcoat: 1.0, clearcoatRoughness: 0.05
    }),
    pilotFlame:    new THREE.MeshStandardMaterial({
      color: 0xffb040, emissive: 0xff6a10, emissiveIntensity: 5, toneMapped: false
    }),
    warningYellow: new THREE.MeshStandardMaterial({ color: 0xd4a820, metalness: 0.15, roughness: 0.72 }),
    warningRed:    new THREE.MeshStandardMaterial({ color: 0x9a1a10, metalness: 0.15, roughness: 0.72 }),
    thermalWrap:   new THREE.MeshStandardMaterial({ color: 0x3a3028, metalness: 0.4,  roughness: 0.92 })
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · МОДЕЛЬ
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Строит полную модель огнемёта.
 * @param {object} [materials] — результат createFlamethrowerMaterials()
 * @returns {THREE.Group} — группа 'M9' с ребёнком 'pilotFlame'
 *                          (материал pilotFlame мигает — управляется контроллером)
 */
export function createFlamethrower(materials) {
  const MAT = materials || createFlamethrowerMaterials();
  const flamer = new THREE.Group();
  flamer.name = 'M9';

  function box(w, h, d, mat, x=0, y=0, z=0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    flamer.add(m);
    return m;
  }
  function cyl(r1, r2, h, seg, mat, x=0, y=0, z=0, axis='x') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
    if (axis === 'x') m.rotation.z = Math.PI/2;
    if (axis === 'z') m.rotation.x = Math.PI/2;
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    flamer.add(m);
    return m;
  }
  function sphere(r, seg, mat, x=0, y=0, z=0) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg/1.4)), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    flamer.add(m);
    return m;
  }
  function torusM(r, tube, seg, ringSeg, mat, x=0, y=0, z=0) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, seg, ringSeg), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    flamer.add(m);
    return m;
  }
  function extrudeSide(points, depth, mat, bevel = 0.1) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 2, curveSegments: 24, steps: 1
    });
    geo.translate(0, 0, -depth/2);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    flamer.add(m);
    return m;
  }

  const BP_X = -48;

  /* ---------- РАМА-КЛЕТКА ---------- */
  box(12, 0.9, 10, MAT.steelDark, BP_X, 9.5, 0);
  box(12, 0.9, 10, MAT.steelDark, BP_X, -14.5, 0);
  box(11, 0.4, 1.0, MAT.steelDark, BP_X, 9.0, 3.5);
  box(11, 0.4, 1.0, MAT.steelDark, BP_X, 9.0, -3.5);
  box(11, 0.4, 1.0, MAT.steelDark, BP_X, -14.0, 3.5);
  box(11, 0.4, 1.0, MAT.steelDark, BP_X, -14.0, -3.5);
  for (const dx of [-5.5, 5.5]) {
    for (const dz of [-4.5, 4.5]) {
      box(0.8, 25, 0.8, MAT.steelDark, BP_X + dx, -2.5, dz);
    }
  }
  for (const ry of [3, -8]) {
    box(12, 0.5, 0.7, MAT.steelDark, BP_X, ry, 4.5);
    box(12, 0.5, 0.7, MAT.steelDark, BP_X, ry, -4.5);
  }

  /* ---------- РЕЗЕРВУАРЫ ---------- */
  for (const side of [-1, 1]) {
    const tz = side * 3.0;
    cyl(2.5, 2.5, 22, 32, MAT.tank, BP_X, -3, tz, 'y');
    sphere(2.5, 24, MAT.tank, BP_X, 8, tz);
    sphere(2.5, 24, MAT.tank, BP_X, -14, tz);
    for (const ry of [-9, -3, 3]) {
      cyl(2.6, 2.6, 0.35, 32, MAT.steelDark, BP_X, ry, tz, 'y');
    }
    cyl(2.52, 2.52, 0.9, 32, MAT.warningYellow, BP_X, -11, tz, 'y');
    cyl(2.54, 2.54, 0.15, 32, MAT.blackMetal, BP_X, -10.55, tz, 'y');
    cyl(2.54, 2.54, 0.15, 32, MAT.blackMetal, BP_X, -11.45, tz, 'y');
    cyl(0.75, 0.75, 0.9, 16, MAT.steel, BP_X, 10.6, tz, 'y');
    cyl(0.95, 0.95, 0.35, 16, MAT.brass, BP_X, 11.3, tz, 'y');
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      box(0.15, 1.2, 0.15, MAT.steelDark,
        BP_X + Math.cos(a) * 0.9, 11.0, tz + Math.sin(a) * 0.9);
    }
    const ringUp = torusM(1.0, 0.1, 6, 20, MAT.steelDark, BP_X, 11.6, tz);
    ringUp.rotation.x = Math.PI / 2;
    cyl(0.55, 0.55, 0.6, 14, MAT.steelDark, BP_X, 12.0, tz, 'y');
    cyl(0.5, 0.5, 0.7, 14, MAT.brass, BP_X, -16.2, tz, 'y');
    cyl(0.65, 0.65, 0.3, 14, MAT.steel, BP_X, -16.7, tz, 'y');
    box(4.8, 0.25, 4.8, MAT.steelDark, BP_X, 10.1, tz);
    box(2.6, 0.9, 0.06, MAT.warningYellow, BP_X, 6.0, tz + 2.55);
    box(2.6, 0.22, 0.08, MAT.blackMetal, BP_X, 6.35, tz + 2.58);
    box(2.6, 0.22, 0.08, MAT.blackMetal, BP_X, 5.7, tz + 2.58);
  }

  /* ---------- ГАЗОВЫЙ БАЛЛОН ---------- */
  cyl(1.1, 1.1, 18, 24, MAT.tank, BP_X, -3, 0, 'y');
  sphere(1.1, 18, MAT.steelDark, BP_X, 6, 0);
  sphere(1.1, 18, MAT.steelDark, BP_X, -12, 0);
  for (const ry of [-9, -3, 3]) {
    cyl(1.2, 1.2, 0.2, 20, MAT.steelDark, BP_X, ry, 0, 'y');
  }
  cyl(0.45, 0.45, 1.2, 14, MAT.brass, BP_X, 7.2, 0, 'y');
  cyl(0.55, 0.55, 0.25, 14, MAT.steel, BP_X, 7.9, 0, 'y');
  const valveWheel = torusM(0.75, 0.14, 8, 20, MAT.red, BP_X, 8.2, 0);
  valveWheel.rotation.x = Math.PI/2;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const spoke = box(1.3, 0.12, 0.12, MAT.steel, BP_X, 8.2, 0);
    spoke.rotation.y = a;
  }
  cyl(0.4, 0.4, 0.4, 14, MAT.steelDark, BP_X, 8.9, 0, 'y');

  /* ---------- АЗОТНЫЙ БАЛЛОН ---------- */
  cyl(0.7, 0.7, 4.5, 20, MAT.steelDark, BP_X, 8.5, 0, 'y');
  cyl(0.35, 0.35, 0.6, 14, MAT.brass, BP_X, 11.05, 0, 'y');
  torusM(0.55, 0.1, 8, 16, MAT.steel, BP_X, 11.4, 0);
  cyl(0.72, 0.72, 0.3, 20, MAT.steel, BP_X, 10.0, 0, 'y');

  /* ---------- ТРУБКА ГАЗА ---------- */
  const gasPts = [
    new THREE.Vector3(BP_X + 1.5, -12, 0),
    new THREE.Vector3(BP_X + 6, -13, 0.3),
    new THREE.Vector3(BP_X + 10, -12, 0.6)
  ];
  flamer.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(gasPts), 20, 0.35, 10, false), MAT.steel));

  /* ---------- РЕМНИ ---------- */
  for (const side of [-1, 1]) {
    const sz = side * 3.5;
    const strapPts = [
      new THREE.Vector3(BP_X + 5, 8.5, sz),
      new THREE.Vector3(BP_X + 15, 6.5, sz),
      new THREE.Vector3(-25, 1.5, sz),
      new THREE.Vector3(-18, 0.0, sz)
    ];
    flamer.add(new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(strapPts), 30, 0.4, 8, false),
      MAT.rubber
    ));
    box(1.4, 0.4, 1.8, MAT.steelDark, BP_X + 15, 6.5, sz);
    box(1.6, 0.7, 0.4, MAT.steel, BP_X + 15, 6.5, sz + side * 0.5);
    cyl(0.18, 0.18, 2.2, 10, MAT.steelDark, BP_X + 15, 6.5, sz, 'z');
    box(1.2, 0.5, 0.5, MAT.steelDark, -22, 1.0, sz);
    box(0.8, 0.9, 0.7, MAT.blackMetal, -21, 1.0, sz);
  }

  /* ---------- ШЛАНГ ---------- */
  const hosePts = [
    new THREE.Vector3(BP_X + 6, -10, 0),
    new THREE.Vector3(BP_X + 14, -12, 0.5),
    new THREE.Vector3(BP_X + 22, -10, 1.0),
    new THREE.Vector3(-32, -6, 1.0),
    new THREE.Vector3(-28, -2, 0.8),
    new THREE.Vector3(-26, -1, 0.5)
  ];
  const hoseCurve = new THREE.CatmullRomCurve3(hosePts);
  flamer.add(new THREE.Mesh(
    new THREE.TubeGeometry(hoseCurve, 60, 0.85, 12, false),
    MAT.hose
  ));
  for (let i = 0; i < 28; i++) {
    const t = i / 27;
    const p = hoseCurve.getPoint(t);
    const tan = hoseCurve.getTangent(t);
    const ring = torusM(0.9, 0.1, 6, 12, MAT.steelDark);
    ring.position.copy(p);
    ring.lookAt(p.clone().add(tan));
  }
  cyl(1.15, 1.15, 1.5, 20, MAT.brass, BP_X + 6, -10, 0, 'x');
  cyl(1.25, 1.25, 0.4, 20, MAT.steel, BP_X + 7.5, -10, 0, 'x');
  cyl(1.15, 1.15, 1.5, 20, MAT.brass, -26, -1, 0.5, 'x');
  cyl(1.25, 1.25, 0.4, 20, MAT.steel, -25.5, -1, 0.5, 'x');

  /* ---------- ОСНОВНОЙ СТВОЛ ---------- */
  cyl(1.0, 1.0, 60, 28, MAT.bodyOlive, 2, 0, 0, 'x');
  for (let i = 0; i < 22; i++) {
    cyl(1.06, 1.06, 0.6, 20, MAT.thermalWrap, 8 + i * 0.9, 0, 0, 'x');
  }
  cyl(1.4, 1.4, 6, 28, MAT.bodyOlive, 24, 0, 0, 'x');
  cyl(1.55, 1.55, 0.5, 28, MAT.steelDark, 21.3, 0, 0, 'x');
  cyl(1.55, 1.55, 0.5, 28, MAT.steelDark, 26.7, 0, 0, 'x');

  /* ---------- ДУЛЬНЫЙ УЗЕЛ ---------- */
  cyl(1.6, 1.3, 1.4, 28, MAT.steelDark, 27.8, 0, 0, 'x');
  cyl(1.45, 1.45, 0.4, 28, MAT.blackMetal, 28.6, 0, 0, 'x');
  cyl(1.65, 1.65, 0.5, 28, MAT.steel, 29.4, 0, 0, 'x');
  cyl(1.55, 1.55, 0.25, 28, MAT.steelDark, 29.85, 0, 0, 'x');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rib = box(0.35, 0.15, 0.7, MAT.steelDark, 29.4, Math.cos(a) * 0.9, Math.sin(a) * 0.9);
    rib.rotation.x = a;
  }
  cyl(1.2, 1.45, 1.2, 24, MAT.steel, 30.6, 0, 0, 'x');
  cyl(0.9, 0.9, 0.35, 20, MAT.blackMetal, 31.5, 0, 0, 'x');

  /* ---------- ПОРТ ЗАПАЛЬНИКА ---------- */
  cyl(0.35, 0.35, 0.9, 12, MAT.steelDark, 30.2, 1.5, 0, 'y');
  cyl(0.45, 0.45, 0.25, 12, MAT.brass, 30.2, 2.05, 0, 'y');
  box(0.6, 0.3, 0.6, MAT.blackMetal, 30.2, 1.85, 0);

  /* ---------- КОРПУС ---------- */
  box(14, 3.5, 3.2, MAT.bodyOlive, -12, -1.75, 0);
  box(14.2, 0.4, 3.4, MAT.steelDark, -12, 0.05, 0);
  box(14.2, 0.4, 3.4, MAT.steelDark, -12, -3.55, 0);
  box(0.5, 3.6, 3.3, MAT.steelDark, -4.8, -1.75, 0);
  box(0.5, 3.6, 3.3, MAT.steelDark, -19.2, -1.75, 0);
  box(4.0, 1.2, 0.3, MAT.blackMetal, -12, -1.75, 1.62);
  box(4.0, 1.2, 0.3, MAT.blackMetal, -12, -1.75, -1.62);
  for (const bx of [-17.5, -14.0, -10.0, -6.5]) {
    cyl(0.14, 0.14, 3.6, 10, MAT.steelDark, bx, -1.75, 0, 'z');
    cyl(0.2, 0.2, 0.2, 10, MAT.steel, bx, -1.75, 1.7, 'z');
    cyl(0.2, 0.2, 0.2, 10, MAT.steel, bx, -1.75, -1.7, 'z');
  }

  /* ---------- ПЛАНКА ПИКАТИННИ ---------- */
  box(10, 0.35, 1.2, MAT.blackMetal, -12, 0.35, 0);
  for (let i = 0; i < 12; i++) {
    box(0.45, 0.25, 1.2, MAT.blackMetal, -16.5 + i * 0.82, 0.65, 0);
  }

  /* ---------- КЛАПАН ГАЗА ---------- */
  box(4.0, 2.0, 2.6, MAT.steelDark, -14, 1.7, 0);
  box(4.2, 0.35, 2.8, MAT.bodyOliveDark, -14, 2.9, 0);
  cyl(0.85, 0.85, 0.9, 20, MAT.brass, -14, 3.0, 0, 'y');
  cyl(1.0, 1.0, 0.3, 20, MAT.steel, -14, 3.5, 0, 'y');

  /* ---------- МАНОМЕТР ---------- */
  cyl(1.15, 1.15, 0.8, 24, MAT.steelDark, -17, 1.9, 1.3, 'z');
  cyl(1.3, 1.3, 0.3, 24, MAT.steel, -17, 1.9, 1.25, 'z');
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), MAT.glass);
  glass.position.set(-17, 1.9, 1.75);
  flamer.add(glass);
  torusM(0.85, 0.07, 8, 24, MAT.brass, -17, 1.9, 1.68);
  const needle = box(0.75, 0.07, 0.05, MAT.red, -16.7, 2.0, 1.7);
  needle.rotation.z = 0.6;

  /* ---------- ПИСТОЛЕТНАЯ РУКОЯТКА ---------- */
  extrudeSide([[-9.5, -3.55], [-13.0, -3.55], [-15.5, -10.5], [-12.0, -11.5]], 2.6, MAT.polymer);
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    const rg = box(0.35, 1.6, 2.75, MAT.polymerMatte, -11.0 - t * 2.8, -5.0 - t * 5.2, 0);
    rg.rotation.z = -0.38;
  }
  box(2.0, 0.6, 2.4, MAT.polymerMatte, -14.4, -10.6, 0);

  /* ---------- ПЕРЕДНЯЯ РУКОЯТКА ---------- */
  cyl(1.15, 1.15, 1.6, 20, MAT.steelDark, 0.5, 0, 0, 'x');
  cyl(1.25, 1.25, 0.35, 20, MAT.steel, -0.3, 0, 0, 'x');
  cyl(1.25, 1.25, 0.35, 20, MAT.steel, 1.3, 0, 0, 'x');
  box(2.6, 2.4, 2.4, MAT.bodyOlive, 0.5, -2.2, 0);
  box(0.35, 2.4, 2.5, MAT.steelDark, -0.7, -2.2, 0);
  box(0.35, 2.4, 2.5, MAT.steelDark, 1.7, -2.2, 0);
  box(2.9, 2.5, 0.35, MAT.steelDark, 0.5, -2.2, 1.2);
  box(2.9, 2.5, 0.35, MAT.steelDark, 0.5, -2.2, -1.2);
  const foreGrip = extrudeSide([[1.5, -3.4], [-1.5, -3.4], [-3.5, -9.5], [-0.5, -10.2]], 2.4, MAT.polymer);
  foreGrip.position.x = 0.5;
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const rg = box(0.3, 1.4, 2.55, MAT.polymerMatte, 0.5 + 1.0 - t * 2.2, -4.5 - t * 3.5, 0);
    rg.rotation.z = -0.4;
  }

  /* ---------- СПУСКОВАЯ СКОБА ---------- */
  box(5.4, 0.4, 1.8, MAT.steelDark, -8.6, -7.4, 0);
  box(0.4, 2.2, 1.8, MAT.steelDark, -6.1, -6.5, 0);
  box(0.4, 2.2, 1.8, MAT.steelDark, -11.1, -6.5, 0);
  box(5.6, 0.35, 1.9, MAT.steelDark, -8.6, -5.6, 0);
  const trigger = box(0.5, 2.0, 0.85, MAT.steel, -8.5, -6.0, 0);
  trigger.rotation.z = 0.20;
  cyl(0.14, 0.14, 1.2, 10, MAT.steelDark, -8.5, -5.2, 0, 'z');

  /* ---------- ПРЕДОХРАНИТЕЛЬ ---------- */
  cyl(0.3, 0.3, 0.5, 14, MAT.steel, -6.7, -4.5, 0, 'z');
  box(0.7, 0.3, 0.35, MAT.steelDark, -6.5, -4.5, 0.5);
  box(0.4, 0.35, 0.35, MAT.red, -6.3, -4.5, 0.55);

  /* ---------- ЗАПАЛЬНИК ---------- */
  box(2.0, 1.2, 2.0, MAT.steelDark, 22, 1.5, 0);
  box(2.2, 0.25, 2.2, MAT.steel, 22, 2.15, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    box(0.4, 0.7, 0.4, MAT.steelDark, 22 + Math.cos(a) * 0.5, 2.6, Math.sin(a) * 0.5);
  }
  box(0.4, 0.5, 0.4, MAT.steelDark, 22, 2.55, 0.85);
  box(0.4, 0.5, 0.4, MAT.steelDark, 22, 2.55, -0.85);
  cyl(0.35, 0.35, 1.3, 16, MAT.steel, 22, 3.3, 0, 'y');
  cyl(0.45, 0.45, 0.35, 16, MAT.brass, 22, 3.9, 0, 'y');
  cyl(0.3, 0.3, 0.4, 14, MAT.steelDark, 22, 4.15, 0, 'y');

  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), MAT.pilotFlame);
  pilot.name = 'pilotFlame';
  pilot.position.set(22, 4.5, 0);
  flamer.add(pilot);

  const ignPts = [
    new THREE.Vector3(22, 3.3, 0),
    new THREE.Vector3(15, 2.2, 0.5),
    new THREE.Vector3(5, 1.6, 0.5),
    new THREE.Vector3(-5, 1.4, 0.4),
    new THREE.Vector3(-12, 1.8, 0),
    new THREE.Vector3(-14, 2.0, 0)
  ];
  const ignCurve = new THREE.CatmullRomCurve3(ignPts);
  flamer.add(new THREE.Mesh(
    new THREE.TubeGeometry(ignCurve, 30, 0.2, 8, false),
    MAT.brass
  ));

  /* ---------- ПРИЦЕЛЫ ---------- */
  box(2.0, 0.6, 1.8, MAT.steelDark, -18, 1.0, 0);
  box(0.35, 1.4, 0.4, MAT.steelDark, -18, 1.9, 0);
  box(0.15, 0.3, 0.6, MAT.blackMetal, -18, 2.3, 0);
  box(1.4, 0.55, 1.4, MAT.steelDark, 21, 1.65, 0);
  box(0.35, 1.5, 0.35, MAT.steelDark, 21, 2.5, 0);
  box(0.3, 1.6, 0.3, MAT.steelDark, 21, 2.6, 0.85);
  box(0.3, 1.6, 0.3, MAT.steelDark, 21, 2.6, -0.85);
  box(0.3, 0.3, 1.9, MAT.steelDark, 21, 3.35, 0);

  /* ---------- ТЕПЛОЗАЩИТА ---------- */
  box(16, 0.35, 2.2, MAT.steelDark, 8, 1.15, 0);
  box(1.0, 0.7, 2.4, MAT.steelDark, 0, 1.0, 0);
  box(1.0, 0.7, 2.4, MAT.steelDark, 16, 1.0, 0);

  /* ---------- АНТАБКИ ---------- */
  const sling = torusM(0.55, 0.13, 8, 18, MAT.steelDark, -22, -3.0, 0);
  sling.rotation.y = Math.PI/2;
  const sling2 = torusM(0.5, 0.12, 8, 18, MAT.steelDark, 12, -1.5, 0);
  sling2.rotation.y = Math.PI/2;

  return flamer;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · ЭФФЕКТЫ (частицы, обугливание, горящие пятна, горючие цели)
   ═══════════════════════════════════════════════════════════════════════════ */

export class FlamethrowerEffects {
  constructor(scene, audio, opts = {}) {
    this.scene = scene;
    this.audio = audio || null;

    this.maxParticles = opts.maxParticles ?? 6000;
    this.maxScorch    = opts.maxScorch    ?? FLAMETHROWER_CONFIG.SCORCH_MAX;
    this.maxGroundFire= opts.maxGroundFire?? FLAMETHROWER_CONFIG.GROUND_FIRE_MAX;

    /* --- частицы --- */
    this.pPositions = new Float32Array(this.maxParticles * 3);
    this.pColors    = new Float32Array(this.maxParticles * 3);
    this.pSizes     = new Float32Array(this.maxParticles);
    this.pData = [];
    for (let i=0; i<this.maxParticles; i++) {
      this.pData.push({
        life: 0, maxLife: 1,
        vel: new THREE.Vector3(),
        base: new THREE.Color(),
        grav: 1, size: 0.1,
        startSize: 0.1, endSize: 0.1,
        fadeIn: 0
      });
      this.pSizes[i] = 0.1;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPositions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pColors, 3));
    pGeo.setAttribute('size', new THREE.BufferAttribute(this.pSizes, 1));
    this.pGeo = pGeo;

    this.pointsMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: makeFlameParticleTexture() } },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 350.0 / -mvPos.z;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vColor * t.rgb, t.a);
        }
      `,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.points = new THREE.Points(pGeo, this.pointsMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pCursor = 0;

    /* --- обугливание --- */
    const scorchMat = new THREE.MeshBasicMaterial({
      map: makeScorchTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
      toneMapped: false, opacity: 0.85
    });
    this.scorchMatTemplate = scorchMat;
    this.scorchGeo = new THREE.PlaneGeometry(1, 1);
    this.scorches = [];
    this.scorchCursor = 0;
    for (let i=0; i<this.maxScorch; i++) {
      const m = new THREE.Mesh(this.scorchGeo, scorchMat.clone());
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.scorches.push(m);
    }

    /* --- горящие пятна на земле --- */
    this.groundFires = [];

    /* --- горючие цели (дерево) --- */
    /* Регистрируются снаружи: effects.registerBurnable(mesh, {burnTime}) */
    this.burnables = [];   // [{ mesh, burning, burnTime, burnDur, originalMaterial, charMaterial }]

    /* --- ссылки на вспомогательные элементы --- */
    this._rng = Math.random;
    this._tmpColor = new THREE.Color();
  }

  /* ====== частицы ====== */
  spawnParticle(pos, vel, color, life, grav, size, startSize = size, endSize = size, fadeIn = 0.1) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % this.maxParticles;
    const d = this.pData[i];
    d.life = life; d.maxLife = life;
    d.vel.copy(vel);
    d.base.set(color);
    d.grav = grav;
    d.size = size;
    d.startSize = startSize;
    d.endSize = endSize;
    d.fadeIn = fadeIn;
    this.pPositions[i*3]   = pos.x;
    this.pPositions[i*3+1] = pos.y;
    this.pPositions[i*3+2] = pos.z;
    this.pColors[i*3]   = d.base.r;
    this.pColors[i*3+1] = d.base.g;
    this.pColors[i*3+2] = d.base.b;
    this.pSizes[i] = startSize;
  }

  /* ====== обугливание ====== */
  addScorch(point, normal, scale = 0.8) {
    const s = this.scorches[this.scorchCursor];
    this.scorchCursor = (this.scorchCursor + 1) % this.maxScorch;
    s.visible = true;
    s.position.copy(point).addScaledVector(normal, 0.01);
    s.lookAt(point.clone().add(normal));
    s.rotateZ(Math.random() * Math.PI * 2);
    s.scale.setScalar(scale * (0.7 + Math.random() * 0.6));
  }

  /* ====== горящее пятно на земле ====== */
  spawnGroundFire(pos) {
    if (this.groundFires.length >= this.maxGroundFire) {
      const old = this.groundFires.shift();
      this.scene.remove(old.mesh);
      this.scene.remove(old.light);
      old.mesh.material.dispose();
    }
    const geo = new THREE.CircleGeometry(0.6 + Math.random() * 0.4, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6020, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI/2;
    m.position.set(pos.x, 0.02, pos.z);
    m.renderOrder = 3;
    this.scene.add(m);

    const light = new THREE.PointLight(0xff5020, 1.8, 2.5, 2);
    light.position.set(pos.x, 0.3, pos.z);
    this.scene.add(light);

    const maxLife = FLAMETHROWER_CONFIG.GROUND_FIRE_LIFE_MIN +
                    Math.random() * (FLAMETHROWER_CONFIG.GROUND_FIRE_LIFE_MAX - FLAMETHROWER_CONFIG.GROUND_FIRE_LIFE_MIN);
    this.groundFires.push({ mesh: m, light, life: maxLife, maxLife });
  }

  /* ====== регистрация горючих целей ====== */
  /** @param {THREE.Mesh} mesh — цель
   *  @param {object} [opts]   — { burnTime, charColor } */
  registerBurnable(mesh, opts = {}) {
    const burnTime = opts.burnTime ?? FLAMETHROWER_CONFIG.BURNABLE_TIME;
    const charColor = opts.charColor ?? 0x1a1008;
    this.burnables.push({
      mesh,
      burning: false,
      burnTime: 0,
      burnDur: burnTime,
      charMaterial: new THREE.MeshStandardMaterial({
        color: charColor, roughness: 0.95, metalness: 0.02
      }),
      originalMaterial: mesh.material
    });
  }

  /** Попробовать зажечь цель по её меш-объекту. Возвращает true, если зажгли. */
  tryIgnite(mesh) {
    for (const b of this.burnables) {
      if (b.mesh === mesh && !b.burning) {
        b.burning = true;
        b.burnTime = 0;
        return true;
      }
    }
    return false;
  }

  /* ====== обновление ====== */
  update(dt) {
    /* --- частицы --- */
    const P = this.pData, pos = this.pPositions, col = this.pColors, sz = this.pSizes;
    for (let i=0; i<this.maxParticles; i++) {
      const d = P[i];
      if (d.life <= 0) {
        col[i*3] = col[i*3+1] = col[i*3+2] = 0;
        sz[i] = 0;
        continue;
      }
      d.life -= dt;
      const t = 1 - d.life / d.maxLife;
      d.vel.y -= 9.81 * d.grav * dt;
      d.vel.multiplyScalar(1 - 1.2 * dt);
      pos[i*3]   += d.vel.x * dt;
      pos[i*3+1] += d.vel.y * dt;
      pos[i*3+2] += d.vel.z * dt;
      if (pos[i*3+1] < 0.05) {
        pos[i*3+1] = 0.05;
        d.vel.y *= -0.15; d.vel.x *= 0.7; d.vel.z *= 0.7;
      }

      let alpha;
      if (t < d.fadeIn) alpha = t / d.fadeIn;
      else alpha = 1 - (t - d.fadeIn) / (1 - d.fadeIn);
      alpha = Math.max(0, Math.min(1, alpha));

      sz[i] = d.startSize + (d.endSize - d.startSize) * t;

      const k = alpha * alpha;
      col[i*3]   = d.base.r * k;
      col[i*3+1] = d.base.g * k;
      col[i*3+2] = d.base.b * k;
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    this.pGeo.attributes.size.needsUpdate = true;

    /* --- горючие цели --- */
    for (const b of this.burnables) {
      if (!b.burning) continue;
      b.burnTime += dt;
      if (b.burnTime < b.burnDur) {
        /* пока горит — эмитим пламя и дым с поверхности */
        for (let i = 0; i < 2; i++) {
          const p = b.mesh.position.clone();
          const q = b.mesh.quaternion.clone();
          const localOffset = new THREE.Vector3(
            (Math.random() - 0.5) * 1.4,
            (Math.random() - 0.5) * 1.2,
            0.06
          ).applyQuaternion(q);
          p.add(localOffset);

          const v = new THREE.Vector3(
            (Math.random() - 0.5) * 0.6,
            1.2 + Math.random() * 1.5,
            (Math.random() - 0.5) * 0.6
          );

          const flameCol = new THREE.Color().setHSL(0.06 + Math.random() * 0.05, 1, 0.5);
          this.spawnParticle(p, v, flameCol.getHex(), 0.7 + Math.random() * 0.5, 0.1, 0.4, 0.35, 0.9, 0.15);
          this.spawnParticle(p, v.clone().multiplyScalar(0.7), 0x1a1a1a, 1.5 + Math.random(), 0.05, 0.4, 0.3, 1.4, 0.2);
        }
      } else {
        /* прогорела — меняем материал на обугленный */
        b.burning = false;
        b.mesh.material = b.charMaterial;
      }
    }

    /* --- горящие пятна на земле --- */
    for (let i = this.groundFires.length - 1; i >= 0; i--) {
      const gf = this.groundFires[i];
      gf.life -= dt;
      if (gf.life <= 0) {
        this.scene.remove(gf.mesh);
        this.scene.remove(gf.light);
        gf.mesh.material.dispose();
        this.groundFires.splice(i, 1);
        continue;
      }
      const t = gf.life / gf.maxLife;
      gf.mesh.material.opacity = 0.6 * Math.min(1, t * 2);
      gf.mesh.scale.setScalar(0.9 + Math.sin(gf.life * 15) * 0.1);
      gf.light.intensity = 1.8 * t * (0.8 + Math.random() * 0.4);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · ЗВУК (с непрерывным гулом пламени)
   ═══════════════════════════════════════════════════════════════════════════ */

export class WeaponAudio {
  constructor(masterVolume = 0.55) {
    this.volume = masterVolume;
    this.actx = null;
    this.masterGain = null;
    this.noiseBuf = null;

    /* Непрерывный гул пламени */
    this.flameSource = null;
    this.flameGain = null;
    this.flameFilter = null;
  }

  init() {
    if (this.actx) {
      if (this.actx.state === 'suspended') this.actx.resume();
      return;
    }
    try {
      this.actx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.actx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.actx.destination);

      const len = Math.floor(this.actx.sampleRate * 2);
      this.noiseBuf = this.actx.createBuffer(1, len, this.actx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i=0; i<len; i++) d[i] = Math.random() * 2 - 1;

      /* Непрерывный сэмпл — стартует сразу, громкость в нуле */
      this.flameSource = this.actx.createBufferSource();
      this.flameSource.buffer = this.noiseBuf;
      this.flameSource.loop = true;

      this.flameFilter = this.actx.createBiquadFilter();
      this.flameFilter.type = 'bandpass';
      this.flameFilter.frequency.value = 300;
      this.flameFilter.Q.value = 0.8;

      const lowFilter = this.actx.createBiquadFilter();
      lowFilter.type = 'lowpass';
      lowFilter.frequency.value = 2200;

      this.flameGain = this.actx.createGain();
      this.flameGain.gain.value = 0;

      this.flameSource.connect(lowFilter);
      lowFilter.connect(this.flameFilter);
      this.flameFilter.connect(this.flameGain);
      this.flameGain.connect(this.masterGain);
      this.flameSource.start(0);
    } catch (e) { /* Audio недоступен */ }
  }

  resume() {
    if (this.actx && this.actx.state === 'suspended') this.actx.resume();
  }

  /** Интенсивность 0..1 — управляет громкостью и фильтром непрерывного гула. */
  setFlameIntensity(intensity) {
    if (!this.flameGain || !this.actx) return;
    const target = intensity * 0.35;
    this.flameGain.gain.setTargetAtTime(target, this.actx.currentTime, 0.05);
    if (this.flameFilter) {
      const f = 300 + intensity * 400 + Math.sin(this.actx.currentTime * 18) * 100;
      this.flameFilter.frequency.setTargetAtTime(f, this.actx.currentTime, 0.08);
    }
  }

  /* --- единичные звуки --- */
  ignite() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.25);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.masterGain);
    o.start(t); o.stop(t + 0.32);
  }

  click(vol = 0.3, freq = 1400, dur = 0.055) {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.actx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = freq; f.Q.value = 4;
    const g = this.actx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    src.connect(f); f.connect(g); g.connect(this.masterGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  thunk(vol = 0.4, freq = 200) {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.35, t + 0.15);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(this.masterGain);
    o.start(t); o.stop(t + 0.25);

    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const lp = this.actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000;
    const g2 = this.actx.createGain();
    g2.gain.setValueAtTime(vol * 0.6, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(lp); lp.connect(g2); g2.connect(this.masterGain);
    src.start(t); src.stop(t + 0.2);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   7 · КОНТРОЛЛЕР ИГРОКА
   ═══════════════════════════════════════════════════════════════════════════ */

export class PlayerController {
  constructor(opts = {}) {
    const s = opts.startPos || { x: 0, y: 1.7, z: 10 };
    this.pos   = new THREE.Vector3(s.x, s.y, s.z);
    this.vel   = new THREE.Vector3();
    this.yaw   = 0;
    this.pitch = 0;

    this.height      = opts.height      ?? 1.7;
    this.radius      = opts.radius      ?? 0.42;
    this.walkSpeed   = opts.walkSpeed   ?? 4.4;
    this.sprintSpeed = opts.sprintSpeed ?? 7.6;
    this.jumpSpeed   = opts.jumpSpeed   ?? 5.0;
    this.gravity     = opts.gravity     ?? 20;
    this.pitchLimit  = opts.pitchLimit  ?? 1.45;
    this.worldLimit  = opts.worldLimit  ?? 130;

    this.mouseSensitivity = opts.mouseSensitivity ?? FLAMETHROWER_CONFIG.MOUSE_SENS;
    this.lookSensMult = 1;
    this.speedMult    = 1;

    this.keys      = Object.create(null);
    this.colliders = opts.colliders || [];
    this.onGround  = true;
  }

  onKeyDown(code) { this.keys[code] = true;  }
  onKeyUp  (code) { this.keys[code] = false; }

  look(dx, dy) {
    const s = this.mouseSensitivity * this.lookSensMult;
    this.yaw   -= dx * s;
    this.pitch -= dy * s;
    this.pitch = Math.max(-this.pitchLimit, Math.min(this.pitchLimit, this.pitch));
  }

  groundHeightAt(x, z) {
    let h = 0;
    for (const b of this.colliders) {
      if (x > b.min.x - 0.3 && x < b.max.x + 0.3 &&
          z > b.min.z - 0.3 && z < b.max.z + 0.3) {
        if (b.max.y > h && b.max.y < this.pos.y - this.height + 0.55) h = b.max.y;
      }
    }
    return h;
  }

  update(dt) {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right   = new THREE.Vector3( Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    let moveX = 0, moveZ = 0;
    if (this.keys['KeyW']) moveZ += 1;
    if (this.keys['KeyS']) moveZ -= 1;
    if (this.keys['KeyD']) moveX += 1;
    if (this.keys['KeyA']) moveX -= 1;

    const sprinting = (this.keys['ShiftLeft'] || this.keys['ShiftRight']) &&
                      moveZ > 0 && this.speedMult > 0.7;
    const baseSpeed = sprinting ? this.sprintSpeed : this.walkSpeed;
    const speed = baseSpeed * this.speedMult;

    const wish = new THREE.Vector3();
    wish.addScaledVector(forward, moveZ);
    wish.addScaledVector(right, moveX);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    const accel = this.onGround ? 14 : 3;
    this.vel.x += (wish.x - this.vel.x) * Math.min(accel * dt, 1);
    this.vel.z += (wish.z - this.vel.z) * Math.min(accel * dt, 1);

    if (this.keys['Space'] && this.onGround) {
      this.vel.y = this.jumpSpeed;
      this.onGround = false;
    }

    this.vel.y -= this.gravity * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    const r = this.radius;
    for (const b of this.colliders) {
      const feet = this.pos.y - this.height;
      if (feet > b.max.y - 0.05) continue;
      if (this.pos.y < b.min.y) continue;

      const cx = Math.max(b.min.x, Math.min(this.pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(this.pos.z, b.max.z));
      const dx = this.pos.x - cx;
      const dz = this.pos.z - cz;
      const d2 = dx*dx + dz*dz;
      if (d2 < r*r) {
        const d = Math.sqrt(d2);
        if (d > 0.0001) {
          const push = (r - d) / d;
          this.pos.x += dx * push;
          this.pos.z += dz * push;
        } else {
          this.pos.x += (this.pos.x < (b.min.x + b.max.x)/2 ? -0.1 : 0.1);
        }
      }
    }

    const gh = this.groundHeightAt(this.pos.x, this.pos.z);
    const floorY = gh + this.height;
    if (this.pos.y <= floorY) {
      this.pos.y = floorY;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    const lim = this.worldLimit;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
  }

  get planarSpeed() { return Math.hypot(this.vel.x, this.vel.z); }
}

/* ═══════════════════════════════════════════════════════════════════════════
   8 · КОНТРОЛЛЕР ОГНЕМЁТА
   ═══════════════════════════════════════════════════════════════════════════ */

const _smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _easeOutCubic = x => 1 - Math.pow(1 - x, 3);

export class FlamethrowerController {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.weaponScene
   * @param {THREE.Camera} opts.weaponCamera
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {PlayerController} opts.player
   * @param {Array} [opts.hittables]
   * @param {FlamethrowerEffects} [opts.effects]
   * @param {WeaponAudio} [opts.audio]
   * @param {HTMLElement} [opts.crosshairEl]
   * @param {HTMLElement} [opts.fuelFillEl]
   * @param {HTMLElement} [opts.nozzleFillEl]
   * @param {HTMLElement} [opts.nozzleValEl]
   * @param {Function} [opts.onAmmoChange]    — (fuel, fuelMax) => void
   * @param {Function} [opts.onStateMessage]
   * @param {Function} [opts.onBloomStrength] — (value) => void
   */
  constructor(opts) {
    this.opts = opts;
    this.weaponScene  = opts.weaponScene;
    this.weaponCamera = opts.weaponCamera;
    this.scene        = opts.scene;
    this.camera       = opts.camera;
    this.player       = opts.player;
    this.hittables    = opts.hittables || [];
    this.effects      = opts.effects || null;
    this.audio        = opts.audio   || null;

    this._crossEl        = opts.crosshairEl    || null;
    this._fuelFillEl     = opts.fuelFillEl     || null;
    this._nozzleFillEl   = opts.nozzleFillEl   || null;
    this._nozzleValEl    = opts.nozzleValEl    || null;
    this._onAmmoChange   = opts.onAmmoChange   || null;
    this._onStateMessage = opts.onStateMessage || null;
    this._onBloomStrength= opts.onBloomStrength|| null;

    /* --- конфиг --- */
    this.cfg = Object.assign({}, FLAMETHROWER_CONFIG, opts.config || {});

    /* --- модель --- */
    this.weaponRoot = new THREE.Group();
    this.weaponRoot.rotation.order = 'YXZ';
    this.weaponRoot.visible = false;

    const materials = opts.materials || createFlamethrowerMaterials();
    this.materials = materials;
    this.flamer = createFlamethrower(materials);
    this.flamer.rotation.y = Math.PI / 2;
    this.flamer.scale.setScalar(this.cfg.SCALE);
    this.weaponRoot.add(this.flamer);

    this.pilotFlameMesh = this.flamer.getObjectByName('pilotFlame');
    this.muzzle = new THREE.Vector3(
      this.cfg.MUZZLE_X * this.cfg.SCALE,
      this.cfg.MUZZLE_Y * this.cfg.SCALE,
      this.cfg.MUZZLE_Z * this.cfg.SCALE
    );

    /* --- состояние --- */
    this.state        = 'holstered';
    this.time         = 0;
    this.fuel         = this.cfg.FUEL_MAX;
    this.triggerHeld  = false;
    this.firing       = false;
    this.adsHeld      = false;
    this.adsAmount    = 0;

    /* --- сопло --- */
    this.nozzle = {
      value: 0,
      overheated: false,
      smokeTimer: 0
    };

    /* --- заправка --- */
    this._refuelStartFuel = this.cfg.FUEL_MAX;
    this._refuelDone = false;

    /* --- анимационные слои --- */
    this.swayTarget  = new THREE.Vector2();
    this.swayCurrent = new THREE.Vector2();
    this.bobTime     = 0;
    this.bobAmount   = 0;
    this.breatheTime = 0;
    this.pilotTime   = 0;

    this.continuousRecoilY = 0;
    this.continuousRecoilX = 0;

    this.inspectOffsetPos = new THREE.Vector3();
    this.inspectOffsetRot = new THREE.Vector3();
    this.inspectOffsetActive = false;

    /* --- свет у дула --- */
    this.flameLight = new THREE.PointLight(0xff6020, 0, this.cfg.MUZZLE_LIGHT_DISTANCE, 2);
    this.scene.add(this.flameLight);

    /* --- рейкаст для струи --- */
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = this.cfg.FLAME_RANGE;
  }

  mount() {
    this.weaponScene.add(this.weaponRoot);
    return this;
  }

  /* ========================================================================
     УПРАВЛЕНИЕ
     ======================================================================== */

  onKeyDown(code) {
    if (code === 'Digit1') this.drawWeapon();
    if (code === 'KeyR')   this.tryReload();
    if (code === 'KeyG')   this.tryInspect();
  }

  onMouseDown(button) {
    if (button === 0) {
      if (this.state === 'inspecting') this.cancelInspect();
      if (this.state === 'reloading')  { this.cancelReload(); return; }
      this.triggerHeld = true;
      if (this.state === 'idle' && !this.nozzle.overheated) this.startFiring();
    }
    if (button === 2) {
      if (this.state === 'inspecting') this.cancelInspect();
      this.adsHeld = true;
    }
  }

  onMouseUp(button) {
    if (button === 0) {
      this.triggerHeld = false;
      this.stopFiring();
    }
    if (button === 2) this.adsHeld = false;
  }

  onMouseMove(dx, dy) {
    const swayScale = 1 - this.adsAmount * 0.85;
    this.swayTarget.x += -dx * 0.00035 * swayScale;
    this.swayTarget.y +=  dy * 0.00035 * swayScale;
    this.swayTarget.x = Math.max(-0.035, Math.min(0.035, this.swayTarget.x));
    this.swayTarget.y = Math.max(-0.035, Math.min(0.035, this.swayTarget.y));
  }

  /* ========================================================================
     СОСТОЯНИЕ
     ======================================================================== */

  setStateMessage(text, time = 0.7) {
    if (this._onStateMessage) this._onStateMessage(text, time);
  }

  drawWeapon() {
    if (this.state === 'inspecting') { this.cancelInspect(); return; }
    if (this.state === 'drawing' || this.state === 'reloading') return;
    if (this.state === 'idle') return;
    this.state = 'drawing';
    this.time  = 0;
    this.weaponRoot.visible = true;
    if (this.audio) {
      this.audio.click(0.25, 700, 0.09);
      setTimeout(() => this.audio?.click(0.20, 1100, 0.07), 350);
      setTimeout(() => this.audio?.click(0.18, 1800, 0.05), 700);
    }
  }

  cancelInspect() {
    if (this.state === 'inspecting') { this.state = 'idle'; this.time = 0; }
  }

  cancelReload() {
    if (this.state === 'reloading') {
      this.state = 'idle';
      this.time  = 0;
      this.audio?.click(0.25, 700, 0.07);
    }
  }

  tryReload() {
    if (this.state === 'inspecting') this.cancelInspect();
    if (this.state === 'reloading') { this.cancelReload(); return; }
    if (this.state !== 'idle') return;
    if (this.fuel >= this.cfg.FUEL_MAX) return;

    this.state = 'reloading';
    this.time  = 0;
    this._refuelStartFuel = this.fuel;
    this._refuelDone = false;
    this.setStateMessage('ЗАПРАВКА...', this.cfg.REFUEL_DUR + 0.5);
    this.audio?.click(0.3, 900, 0.07);
  }

  tryInspect() {
    if (this.state === 'inspecting') { this.cancelInspect(); return; }
    if (this.state !== 'idle') return;
    this.state = 'inspecting';
    this.time  = 0;
    this.audio?.click(0.15, 700, 0.09);
  }

  startFiring() {
    if (this.firing) return;
    if (this.fuel <= 0) {
      this.setStateMessage('НЕТ ТОПЛИВА [R]', 1.0);
      return;
    }
    if (this.nozzle.overheated) {
      this.setStateMessage('СОПЛО ПЕРЕГРЕТО', 1.0);
      return;
    }
    this.firing = true;
    this.audio?.ignite();
  }

  stopFiring() {
    this.firing = false;
  }

  _emitAmmo() {
    if (this._onAmmoChange) this._onAmmoChange(this.fuel, this.cfg.FUEL_MAX);
  }

  _updateNozzleHud() {
    const pct = this.nozzle.value;
    if (this._nozzleFillEl) this._nozzleFillEl.style.width = pct + '%';
    if (this._nozzleValEl)  this._nozzleValEl.textContent = Math.round(pct) + '%';
    if (this._fuelFillEl)   this._fuelFillEl.style.width = (this.fuel / this.cfg.FUEL_MAX * 100) + '%';
  }

  /* ========================================================================
     ОБНОВЛЕНИЕ
     ======================================================================== */

  update(dt) {
    this._updateState(dt);
    this._updateFuelAndNozzle(dt);
    this._updateFlameEmission(dt);
    this._updateWeapon(dt);
    this._updatePilotFlame(dt);
    this._updateFlameLight(dt);
    this._applyToCamera();
    this._updateNozzleHud();

    /* Bloom: при стрельбе растёт, иначе — на базовом уровне */
    if (this._onBloomStrength) {
      if (this.firing && this.state === 'idle') {
        this._onBloomStrength(this.cfg.BLOOM_FIRING_BASE + Math.random() * this.cfg.BLOOM_FIRING_RAND);
      } else {
        this._onBloomStrength(this.cfg.BLOOM_IDLE);
      }
    }

    /* Непрерывный звук пламени */
    if (this.audio) {
      this.audio.setFlameIntensity(this.firing && this.state === 'idle' ? 1 : 0);
    }
  }

  /* ---------- 1. машина состояний ---------- */
  _updateState(dt) {
    if (this.state === 'drawing') {
      this.time += dt;
      if (this.time / this.cfg.DRAW_DUR >= 1) { this.state = 'idle'; this.time = 0; }
    } else if (this.state === 'inspecting') {
      this.time += dt;
      if (this.time >= this.cfg.INSPECT_DUR) { this.state = 'idle'; this.time = 0; }
    } else if (this.state === 'reloading') {
      this.time += dt;
      this._refuelStep();
      if (this.time >= this.cfg.REFUEL_DUR) {
        this.state = 'idle';
        this.time  = 0;
        this.fuel  = this.cfg.FUEL_MAX;
        this._refuelDone = false;
        this._emitAmmo();
        this.setStateMessage('ЗАПРАВЛЕНО', 0.8);
      }
    }
  }

  /* ---------- 2. топливо и нагрев сопла ---------- */
  _updateFuelAndNozzle(dt) {
    const firingActive = this.firing && this.state === 'idle';

    /* Остывание сопла, когда не стреляем */
    if (!firingActive) {
      this.nozzle.value = Math.max(0, this.nozzle.value - this.cfg.NOZZLE_COOL_RATE * dt);
    }
    /* Снятие перегрева */
    if (this.nozzle.overheated && this.nozzle.value < this.cfg.NOZZLE_RESET_LEVEL) {
      this.nozzle.overheated = false;
      this.setStateMessage('СОПЛО ГОТОВО', 0.6);
    }

    /* Дым от горячего сопла */
    if (this.nozzle.value > this.cfg.NOZZLE_SMOKE_LEVEL) {
      this.nozzle.smokeTimer += dt;
      const intensity = (this.nozzle.value - this.cfg.NOZZLE_SMOKE_LEVEL) /
                        (this.cfg.NOZZLE_MAX - this.cfg.NOZZLE_SMOKE_LEVEL);
      const interval = Math.max(0.03, 0.18 - intensity * 0.15);
      while (this.nozzle.smokeTimer > interval) {
        this.nozzle.smokeTimer -= interval;
        this.weaponRoot.updateWorldMatrix(true, true);
        const localPos = new THREE.Vector3(
          (Math.random() - 0.5) * 0.05,
          (Math.random() - 0.5) * 0.05,
          -0.18 - Math.random() * 0.06
        );
        const worldPos = localPos.clone()
          .applyMatrix4(this.weaponRoot.matrixWorld)
          .applyMatrix4(this.camera.matrixWorld);
        const v = new THREE.Vector3(
          (Math.random() - 0.5) * 0.4,
          0.4 + Math.random() * 0.5,
          (Math.random() - 0.5) * 0.3
        ).applyEuler(new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ'));
        this.effects?.spawnParticle(worldPos, v, 0x404040, 1.0 + Math.random() * 0.6, 0.05, 0.30, 0.25, 0.55, 0.2);
      }
    }
  }

  /* ---------- 3. эмиссия пламени ---------- */
  _updateFlameEmission(dt) {
    if (!this.firing || this.state !== 'idle') return;

    /* Расход топлива */
    this.fuel = Math.max(0, this.fuel - this.cfg.FUEL_PER_SEC * dt);
    this._emitAmmo();
    if (this.fuel <= 0) {
      this.stopFiring();
      this.setStateMessage('НЕТ ТОПЛИВА [R]', 1.2);
      return;
    }

    /* Нагрев сопла */
    this.nozzle.value = Math.min(this.cfg.NOZZLE_MAX,
      this.nozzle.value + this.cfg.NOZZLE_HEAT_RATE * dt);
    if (this.nozzle.value >= this.cfg.NOZZLE_OVERHEAT_LEVEL && !this.nozzle.overheated) {
      this.nozzle.overheated = true;
      this.setStateMessage('СОПЛО ПЕРЕГРЕТО · ОСТЫВАЕТ', 2.0);
      this.stopFiring();
      this.audio?.thunk(0.4, 180);
      return;
    }

    /* Мировые координаты дула */
    this.weaponRoot.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld(true);
    const muzzleCam = this.muzzle.clone().applyMatrix4(this.weaponRoot.matrixWorld);
    const muzzleWorld = muzzleCam.clone().applyMatrix4(this.camera.matrixWorld);

    /* Базовое направление и разброс */
    const baseDir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
    );
    const spread = this.cfg.FLAME_SPREAD_BASE * (1 - this.adsAmount * this.cfg.FLAME_SPREAD_ADS_MULT);
    const upV = new THREE.Vector3(0, 1, 0);
    const rightV = new THREE.Vector3().crossVectors(baseDir, upV).normalize();
    const trueUp = new THREE.Vector3().crossVectors(rightV, baseDir).normalize();

    /* Рейкаст — куда попадёт струя */
    this._raycaster.set(this.camera.position.clone(), baseDir);
    this._raycaster.far = this.cfg.FLAME_RANGE;
    const hits = this._raycaster.intersectObjects(this.hittables, false);
    let flameEnd = this.camera.position.clone().addScaledVector(baseDir, this.cfg.FLAME_RANGE);
    if (hits.length > 0 && hits[0].distance < this.cfg.FLAME_RANGE) {
      flameEnd = hits[0].point.clone();

      /* Обугливание поверхности */
      if (Math.random() < dt * 8) {
        const n = hits[0].face
          ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld)
          : baseDir.clone().negate();
        this.effects?.addScorch(hits[0].point, n, 0.6 + Math.random() * 0.5);
        this.effects?.tryIgnite(hits[0].object);
      }
    }

    const distToHit = muzzleWorld.distanceTo(flameEnd);
    const emitMul = 1 + this.adsAmount * 0.2;

    /* ---------- Ядро ---------- */
    const coreCount = Math.floor(this.cfg.EMIT_CORE * emitMul);
    for (let i = 0; i < coreCount; i++) {
      const dir = baseDir.clone()
        .addScaledVector(rightV, (Math.random() - 0.5) * spread * 0.5)
        .addScaledVector(trueUp, (Math.random() - 0.5) * spread * 0.5)
        .normalize();
      const speed = 12 + Math.random() * 8;
      const v = dir.multiplyScalar(speed);
      const p = muzzleWorld.clone().addScaledVector(baseDir, Math.random() * 0.08);
      const c = new THREE.Color().setHSL(0.11 + Math.random() * 0.03, 1, 0.65);
      this.effects?.spawnParticle(p, v, c.getHex(), 0.22 + Math.random() * 0.15, 0.05, 0.35, 0.28, 0.55, 0.15);
    }

    /* ---------- Основное пламя ---------- */
    const mainCount = Math.floor(this.cfg.EMIT_MAIN * emitMul);
    for (let i = 0; i < mainCount; i++) {
      const dir = baseDir.clone()
        .addScaledVector(rightV, (Math.random() - 0.5) * spread)
        .addScaledVector(trueUp, (Math.random() - 0.5) * spread)
        .normalize();
      const speed = 9 + Math.random() * 7;
      const v = dir.multiplyScalar(speed);
      const p = muzzleWorld.clone().addScaledVector(baseDir, Math.random() * 0.12);
      const c = new THREE.Color().setHSL(0.06 + Math.random() * 0.05, 1, 0.52 + Math.random() * 0.08);
      this.effects?.spawnParticle(p, v, c.getHex(), 0.38 + Math.random() * 0.22, 0.1, 0.5, 0.35, 0.85, 0.15);
    }

    /* ---------- Внешнее пламя ---------- */
    const outerCount = Math.floor(this.cfg.EMIT_OUTER * emitMul);
    for (let i = 0; i < outerCount; i++) {
      const dir = baseDir.clone()
        .addScaledVector(rightV, (Math.random() - 0.5) * spread * 1.5)
        .addScaledVector(trueUp, (Math.random() - 0.5) * spread * 1.5)
        .normalize();
      const speed = 6 + Math.random() * 6;
      const v = dir.multiplyScalar(speed);
      const p = muzzleWorld.clone();
      const c = new THREE.Color().setHSL(0.04 + Math.random() * 0.03, 1, 0.45);
      this.effects?.spawnParticle(p, v, c.getHex(), 0.5 + Math.random() * 0.3, 0.15, 0.7, 0.45, 1.15, 0.1);
    }

    /* ---------- Дым ---------- */
    const smokeCount = Math.floor(this.cfg.EMIT_SMOKE * emitMul);
    for (let i = 0; i < smokeCount; i++) {
      const dir = baseDir.clone()
        .addScaledVector(rightV, (Math.random() - 0.5) * spread * 2)
        .addScaledVector(trueUp, (Math.random() - 0.5) * spread * 2 + 0.5)
        .normalize();
      const speed = 3 + Math.random() * 3;
      const v = dir.multiplyScalar(speed);
      const p = muzzleWorld.clone().addScaledVector(baseDir, 0.4 + Math.random() * 0.5);
      const c = new THREE.Color().setHSL(0, 0, 0.12 + Math.random() * 0.08);
      this.effects?.spawnParticle(p, v, c.getHex(), 1.2 + Math.random() * 0.8, 0.02, 0.4, 0.4, 1.6, 0.25);
    }

    /* ---------- Искры ---------- */
    const sparkCount = Math.floor(this.cfg.EMIT_SPARKS * emitMul);
    for (let i = 0; i < sparkCount; i++) {
      const dir = baseDir.clone()
        .addScaledVector(rightV, (Math.random() - 0.5) * spread * 2.5)
        .addScaledVector(trueUp, (Math.random() - 0.5) * spread * 2.5 + Math.random() * 0.5)
        .normalize();
      const speed = 14 + Math.random() * 12;
      const v = dir.multiplyScalar(speed);
      const p = muzzleWorld.clone().addScaledVector(baseDir, 0.3 + Math.random() * 0.6);
      const c = new THREE.Color().setHSL(0.08 + Math.random() * 0.05, 1, 0.55);
      this.effects?.spawnParticle(p, v, c.getHex(), 0.6 + Math.random() * 0.5, 1.2, 0.15, 0.15, 0.05, 0.05);
    }

    /* ---------- Попадание: огонь растекается ---------- */
    if (hits.length > 0 && distToHit < this.cfg.FLAME_RANGE) {
      const hitPos = hits[0].point.clone();
      const n = hits[0].face
        ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld)
        : baseDir.clone().negate();

      for (let i = 0; i < this.cfg.EMIT_IMPACT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const tangent = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
          .cross(n).normalize();
        const v = tangent.multiplyScalar(2 + Math.random() * 4);
        v.y += 1 + Math.random() * 2;
        v.addScaledVector(n, 1 + Math.random() * 2);
        const c = new THREE.Color().setHSL(0.05 + Math.random() * 0.05, 1, 0.5 + Math.random() * 0.12);
        this.effects?.spawnParticle(
          hitPos.clone().addScaledVector(n, 0.03), v, c.getHex(),
          0.4 + Math.random() * 0.35, 0.3, 0.4, 0.3, 0.8, 0.15
        );
      }
      for (let i = 0; i < this.cfg.EMIT_IMPACT_SMOKE; i++) {
        const v = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          1.5 + Math.random() * 2,
          (Math.random() - 0.5) * 2
        ).addScaledVector(n, 1);
        this.effects?.spawnParticle(
          hitPos.clone().addScaledVector(n, 0.1), v, 0x1a1a1a,
          1.5 + Math.random(), 0.05, 0.35, 0.35, 1.4, 0.2
        );
      }

      /* Горящее пятно на земле */
      if (Math.random() < dt * 3 && hitPos.y < 0.3) {
        this.effects?.spawnGroundFire(hitPos);
      }
    }
  }

  /* ---------- 4. анимации ---------- */
  _updateWeapon(dt) {
    const pos = new THREE.Vector3(this.cfg.BASE_POS.x, this.cfg.BASE_POS.y, this.cfg.BASE_POS.z);
    const rot = new THREE.Vector3(this.cfg.BASE_ROT.x, this.cfg.BASE_ROT.y, this.cfg.BASE_ROT.z);

    /* --- Доставание --- */
    if (this.state === 'drawing') {
      const t = Math.min(this.time / this.cfg.DRAW_DUR, 1);
      const k = 1 - _easeOutCubic(t);
      pos.y -= k * 0.65;
      pos.z += k * 0.16;
      rot.x -= k * 1.1;
      rot.z += k * 0.4;
      rot.y += k * 0.22;
    }

    /* --- Осмотр --- */
    if (this.state === 'inspecting') {
      const kT = this.time * (this.cfg.INSPECT_END / this.cfg.INSPECT_DUR);
      const keys = this.cfg.INSPECT_KEYS;
      let k0 = keys[0], k1 = keys[keys.length - 1];
      for (let i=0; i<keys.length-1; i++) {
        if (kT >= keys[i].t && kT <= keys[i+1].t) { k0 = keys[i]; k1 = keys[i+1]; break; }
      }
      const lt = _smoothstep(k0.t, k1.t, kT);
      this.inspectOffsetPos.set(
        k0.p[0] + (k1.p[0] - k0.p[0]) * lt,
        k0.p[1] + (k1.p[1] - k0.p[1]) * lt,
        k0.p[2] + (k1.p[2] - k0.p[2]) * lt
      );
      this.inspectOffsetRot.set(
        k0.r[0] + (k1.r[0] - k0.r[0]) * lt,
        k0.r[1] + (k1.r[1] - k0.r[1]) * lt,
        k0.r[2] + (k1.r[2] - k0.r[2]) * lt
      );
      this.inspectOffsetActive = true;
    } else if (this.inspectOffsetActive) {
      const k = Math.min(dt * 16, 1);
      this.inspectOffsetPos.multiplyScalar(1 - k);
      this.inspectOffsetRot.multiplyScalar(1 - k);
      if (this.inspectOffsetPos.lengthSq() < 1e-6 && this.inspectOffsetRot.lengthSq() < 1e-6) {
        this.inspectOffsetPos.set(0, 0, 0);
        this.inspectOffsetRot.set(0, 0, 0);
        this.inspectOffsetActive = false;
      }
    }
    pos.add(this.inspectOffsetPos);
    rot.x += this.inspectOffsetRot.x;
    rot.y += this.inspectOffsetRot.y;
    rot.z += this.inspectOffsetRot.z;

    /* --- Заправка --- */
    if (this.state === 'reloading') {
      const t = this.time / this.cfg.REFUEL_DUR;
      const tiltIn  = _smoothstep(0.0, this.cfg.REFUEL_TILT_IN, this.time);
      const tiltOut = 1 - _smoothstep(
        this.cfg.REFUEL_DUR - this.cfg.REFUEL_TILT_OUT,
        this.cfg.REFUEL_DUR,
        this.time
      );
      const tilt = tiltIn * tiltOut;

      pos.z += 0.05 * tilt;
      pos.y -= 0.09 * tilt;
      pos.x -= 0.05 * tilt;
      rot.z += 0.55 * tilt;
      rot.x += 0.15 * tilt;
      rot.y -= 0.25 * tilt;
    }

    /* --- Инерция --- */
    this.swayCurrent.x += (this.swayTarget.x - this.swayCurrent.x) * Math.min(dt * 9, 1);
    this.swayCurrent.y += (this.swayTarget.y - this.swayCurrent.y) * Math.min(dt * 9, 1);
    this.swayTarget.multiplyScalar(1 - Math.min(dt * 2.2, 1));
    pos.x += this.swayCurrent.x * (1 - this.adsAmount * 0.85);
    pos.y += this.swayCurrent.y * (1 - this.adsAmount * 0.85);
    rot.y += this.swayCurrent.x * 1.2 * (1 - this.adsAmount * 0.85);
    rot.x += this.swayCurrent.y * 1.2 * (1 - this.adsAmount * 0.85);

    /* --- Ходьба --- */
    const walkSpeed = this.player?.planarSpeed ?? 0;
    const onGround  = this.player?.onGround ?? true;
    const targetBob = onGround ? Math.min(walkSpeed / (this.player?.walkSpeed ?? 4.4), 1.4) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(dt * 8, 1);
    this.bobTime   += dt * (6.0 + walkSpeed * 1.1);
    this.breatheTime += dt;

    const bobMul = 1 - this.adsAmount * 0.88;
    pos.x += Math.sin(this.bobTime) * 0.0115 * this.bobAmount * bobMul;
    pos.y += (Math.abs(Math.cos(this.bobTime)) * 0.0095 * this.bobAmount - 0.004 * this.bobAmount) * bobMul;
    rot.z += Math.sin(this.bobTime) * 0.018 * this.bobAmount * bobMul;
    rot.x += Math.abs(Math.cos(this.bobTime)) * 0.007 * this.bobAmount * bobMul;

    /* --- Дыхание --- */
    const idleAmount = 1 - Math.min(this.bobAmount, 1);
    pos.y += Math.sin(this.breatheTime * 1.35) * 0.0022 * idleAmount;
    pos.x += Math.sin(this.breatheTime * 0.85) * 0.0016 * idleAmount;
    rot.z += Math.sin(this.breatheTime * 1.1) * 0.006 * idleAmount;

    /* --- Непрерывная тряска при стрельбе --- */
    if (this.firing && this.state === 'idle') {
      pos.x += (Math.random() - 0.5) * 0.003;
      pos.y += (Math.random() - 0.5) * 0.003;
      rot.z += (Math.random() - 0.5) * 0.008;

      this.continuousRecoilY += dt * 0.15;
      this.continuousRecoilY = Math.min(this.continuousRecoilY, 0.03);
      this.continuousRecoilX += (Math.random() - 0.5) * dt * 0.5;
      this.continuousRecoilX = Math.max(-0.015, Math.min(0.015, this.continuousRecoilX));

      rot.x -= this.continuousRecoilY * 0.5;
      rot.z += this.continuousRecoilX;

      this.player.pitch += dt * 0.10 * (1 - this.adsAmount * 0.4);
    } else {
      this.continuousRecoilY *= Math.max(0, 1 - dt * 3);
      this.continuousRecoilX *= Math.max(0, 1 - dt * 3);
    }

    /* --- ADS --- */
    const wantAds = this.adsHeld && this.state === 'idle';
    const adsTarget = wantAds ? 1 : 0;
    this.adsAmount += (adsTarget - this.adsAmount) * Math.min(dt * 9, 1);
    if (this.adsAmount < 0.0005) this.adsAmount = 0;
    if (this.adsAmount > 0.9995) this.adsAmount = 1;

    if (this.adsAmount > 0) {
      const a = this.adsAmount;
      pos.lerp(new THREE.Vector3(this.cfg.ADS_POS.x, this.cfg.ADS_POS.y, this.cfg.ADS_POS.z), a);
      rot.x = rot.x * (1 - a) + this.cfg.ADS_ROT.x * a;
      rot.y = rot.y * (1 - a) + this.cfg.ADS_ROT.y * a;
      rot.z = rot.z * (1 - a) + this.cfg.ADS_ROT.z * a;
    }

    /* --- применяем --- */
    this.weaponRoot.position.copy(pos);
    this.weaponRoot.rotation.set(rot.x, rot.y, rot.z);

    /* --- прицел --- */
    if (this._crossEl) {
      this._crossEl.style.opacity = String(1 - this.adsAmount * 0.5);
    }
  }

  /* ---------- 5. мигание пилотного пламени ---------- */
  _updatePilotFlame(dt) {
    if (!this.pilotFlameMesh) return;
    this.pilotTime += dt;
    const C = this.cfg;
    const flicker = 0.8 +
      Math.sin(this.pilotTime * C.PILOT_FREQ_A) * C.PILOT_FLICKER_A +
      Math.sin(this.pilotTime * C.PILOT_FREQ_B) * C.PILOT_FLICKER_B;
    this.pilotFlameMesh.material.emissiveIntensity = C.PILOT_BASE_INTENSITY * flicker;
  }

  /* ---------- 6. свет у дула ---------- */
  _updateFlameLight(dt) {
    if (this.firing && this.state === 'idle') {
      this.weaponRoot.updateWorldMatrix(true, true);
      this.camera.updateMatrixWorld(true);
      const muzzleCam = this.muzzle.clone().applyMatrix4(this.weaponRoot.matrixWorld);
      const muzzleWorld = muzzleCam.clone().applyMatrix4(this.camera.matrixWorld);
      this.flameLight.position.copy(muzzleWorld);
      this.flameLight.intensity = this.cfg.MUZZLE_LIGHT_FIRING_BASE +
                                  Math.random() * this.cfg.MUZZLE_LIGHT_FIRING_RAND;
      this.flameLight.distance = this.cfg.MUZZLE_LIGHT_DISTANCE;
    } else {
      this.flameLight.intensity *= Math.max(0, 1 - dt * 8);
    }
  }

  /* ---------- 7. FOV ---------- */
  _applyToCamera() {
    if (!this.camera) return;
    const mainFov = this.cfg.MAIN_FOV + this.adsAmount * this.cfg.ADS_FOV_DELTA;
    if (Math.abs(this.camera.fov - mainFov) > 0.02) {
      this.camera.fov += (mainFov - this.camera.fov) * 0.35;
      this.camera.updateProjectionMatrix();
    }
    if (this.weaponCamera) {
      const wFov = this.cfg.WEAPON_FOV + this.adsAmount * this.cfg.WEAPON_ADS_FOV_DELTA;
      if (Math.abs(this.weaponCamera.fov - wFov) > 0.02) {
        this.weaponCamera.fov += (wFov - this.weaponCamera.fov) * 0.35;
        this.weaponCamera.updateProjectionMatrix();
      }
    }
  }

  /* ---------- 8. пошаговая заправка ---------- */
  _refuelStep() {
    const t = this.time / this.cfg.REFUEL_DUR;
    const S = this.cfg;

    /* Звуки заправки */
    if (t > 0.3 && t < 0.7) {
      if (this.time < 0.3 + 0.05) {
        this.audio?.click(0.35, 1200, 0.06);
        this.audio?.thunk(0.4, 220);
      }
    }
    if (t > 0.55 && t < S.REFUEL_SFX_HISS_END) {
      if (Math.random() < (1/60) * 8) {  // ~8 раз в секунду при 60 fps
        this.audio?.click(0.15, 3000 + Math.random() * 2000, 0.04);
      }
    }
    if (t > 0.85 && t < 1.0 && !this._refuelDone) {
      if (t > 0.88) {
        this._refuelDone = true;
        this.audio?.click(0.4, 900, 0.08);
        this.audio?.thunk(0.5, 180);
      }
    }

    /* Плавно поднимаем топливо */
    this.fuel = this._refuelStartFuel +
                (this.cfg.FUEL_MAX - this._refuelStartFuel) * Math.min(1, t * 1.05);
    this._emitAmmo();
  }

  /* ========================================================================
     ГЕТТЕРЫ
     ======================================================================== */

  get adsActive()    { return this.adsAmount > 0.5; }
  get isOverheated() { return this.nozzle.overheated; }
  get isFiring()     { return this.firing && this.state === 'idle'; }
  get nozzleRatio()  { return this.nozzle.value / this.cfg.NOZZLE_MAX; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   9 · ПРИМЕР ИСПОЛЬЗОВАНИЯ

   import * as THREE from 'three';
   import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
   import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
   import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
   import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
   import {
     FLAMETHROWER_CONFIG, createFlamethrower, createFlamethrowerMaterials,
     FlamethrowerEffects, WeaponAudio, PlayerController, FlamethrowerController
   } from './flamethrower.js';

   const renderer = new THREE.WebGLRenderer({ antialias: true });
   renderer.setSize(innerWidth, innerHeight);
   renderer.autoClear = false;
   document.body.appendChild(renderer.domElement);

   const scene = new THREE.Scene();
   const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.05, 900);
   const weaponScene = new THREE.Scene();
   const weaponCamera = new THREE.PerspectiveCamera(58, innerWidth/innerHeight, 0.01, 30);

   const composer = new EffectComposer(renderer);
   composer.addPass(new RenderPass(scene, camera));
   const rwp = new RenderPass(weaponScene, weaponCamera);
   rwp.clear = false; rwp.clearDepth = true;
   composer.addPass(rwp);
   const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.50, 0.75);
   composer.addPass(bloomPass);
   composer.addPass(new OutputPass());

   const hittables = [];
   const colliders = [];

   // Деревянные цели: зарегистрировать как горючие.
   // const woodTargetMesh = ... создать меш ...
   // effects.registerBurnable(woodTargetMesh, { burnTime: 12 });

   const player  = new PlayerController({ startPos: { x:0, y:1.7, z:10 }, colliders });
   const audio   = new WeaponAudio(0.55);
   const effects = new FlamethrowerEffects(scene, audio);

   const fl = new FlamethrowerController({
     weaponScene, weaponCamera, scene, camera,
     player, hittables, effects, audio,
     crosshairEl:    document.getElementById('cross'),
     fuelFillEl:     document.getElementById('fuelFill'),
     nozzleFillEl:   document.getElementById('heatFill'),
     nozzleValEl:    document.getElementById('heatVal'),
     onAmmoChange:   (fuel, max) => { /* обновить HUD *\/ },
     onStateMessage: (t, d) => { /* показать сообщение *\/ },
     onBloomStrength:(v) => { bloomPass.strength = v; }
   });
   fl.mount();

   document.addEventListener('keydown', e => { player.onKeyDown(e.code); fl.onKeyDown(e.code); });
   document.addEventListener('keyup',   e => { player.onKeyUp(e.code); });
   document.addEventListener('mousemove', e => {
     if (document.pointerLockElement) {
       player.lookSensMult = 1 - fl.adsAmount * FLAMETHROWER_CONFIG.MOUSE_ADS_MULT;
       player.look(e.movementX, e.movementY);
       fl.onMouseMove(e.movementX, e.movementY);
     }
   });
   document.addEventListener('mousedown', e => fl.onMouseDown(e.button));
   document.addEventListener('mouseup',   e => fl.onMouseUp(e.button));
   document.addEventListener('contextmenu', e => e.preventDefault());

   const clock = new THREE.Clock();
   (function loop() {
     requestAnimationFrame(loop);
     const dt = Math.min(clock.getDelta(), 0.05);
     player.speedMult = 1 - fl.adsAmount * FLAMETHROWER_CONFIG.MOVE_ADS_MULT;
     player.update(dt);
     fl.update(dt);
     effects.update(dt);

     camera.position.copy(player.pos);
     camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

     composer.render();
   })();
   ═══════════════════════════════════════════════════════════════════════════ */