/* ============================================================================
 * RPG-7 · Reusable Three.js Module
 * ----------------------------------------------------------------------------
 * Один файл, из которого можно взять:
 *   - RPG7_CONFIG          — все настраиваемые числа (позы, тайминги, FOV)
 *   - createRPGMaterials() — фабрика материалов
 *   - createRPG7()         — чистая модель (THREE.Group с детьми 'rocket')
 *   - RPGEffects           — частицы, взрывы, летящие ракеты
 *   - WeaponAudio          — процедурный звук (launch / explosion / click)
 *   - PlayerController     — движение WASD, прыжок, коллизии, обзор
 *   - RPG7Controller       — вся механика: одиночный выстрел, перезарядка,
 *                            осмотр, прицеливание через ПГО-7, отдача, вспышка
 * ----------------------------------------------------------------------------
 * Модель ориентирована:  +X = дуло, +Y = вверх, +Z = вправо.
 * Для viewmodel:         rpg.rotation.y = Math.PI/2;
 *                        rpg.scale.setScalar(RPG7_CONFIG.SCALE);
 * ==========================================================================*/

import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════════════
   1 · КОНФИГ
   ═══════════════════════════════════════════════════════════════════════════ */

export const RPG7_CONFIG = {
  /* --- масштаб и позы viewmodel --- */
  SCALE: 0.009,

  BASE_POS: { x:  0.10, y: -0.05, z: -0.24 },
  BASE_ROT: { x:  0.05, y: -0.08, z:  0.03 },

  /* ADS-поза: глаз напротив окуляра ПГО-7
     (получено из локальных координат линзы и scale) */
  ADS_POS:  { x: 0.0369, y: -0.0477, z: -0.2478 },
  ADS_ROT:  { x: 0,      y: 0,       z: 0       },

  /* Дуло в локальных координатах weaponRoot:
     rpg.rotation.y = π/2 → длина ракеты (52.2) уходит в -Z * SCALE */
  MUZZLE_Z: -52.2,

  /* --- патроны / тайминги --- */
  MAG_SIZE:      1,
  RESERVE:       5,
  FIRE_INTERVAL: 1.0,
  RELOAD_DUR:    3.4,
  INSPECT_DUR:   5.60,
  DRAW_DUR:      0.75,

  /* --- FOV --- */
  MAIN_FOV:              75,
  ADS_FOV_DELTA:        -30,
  WEAPON_FOV:            55,
  WEAPON_ADS_FOV_DELTA: -22,

  /* --- мышь / игрок --- */
  MOUSE_SENS:     0.0022,
  MOUSE_ADS_MULT: 0.6,
  MOVE_ADS_MULT:  0.5,

  /* --- ключи анимации осмотра --- */
  INSPECT_END: 3.10,
  INSPECT_KEYS: [
    { t: 0.00, p: [ 0.00,  0.00, 0.00], r: [ 0.00,  0.00,  0.00] },
    { t: 0.45, p: [ 0.04,  0.05, 0.06], r: [-0.10,  0.85, -0.75] },
    { t: 1.15, p: [ 0.02,  0.07, 0.10], r: [ 0.05, -0.75,  0.70] },
    { t: 1.85, p: [-0.02,  0.06, 0.04], r: [ 0.55,  0.15,  0.10] },
    { t: 2.45, p: [ 0.00,  0.03, 0.03], r: [ 0.10,  0.05,  0.25] },
    { t: 3.10, p: [ 0.00,  0.00, 0.00], r: [ 0.00,  0.00,  0.00] }
  ],

  /* --- физика ракеты/взрыва --- */
  ROCKET_SPEED:   60,
  ROCKET_GRAVITY: 5,
  ROCKET_LIFE:    8,
  EXPLOSION_DURATION: 0.9,
  EXPLOSION_LIGHT:    200,
  SHAKE_ON_EXPLOSION: { x: 30, y: 30, z: 20, yBias: 8 },
  SHAKE_ON_FIRE:      { x: 18, y: 18, z: 10 }
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

export function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,245,200,0.95)');
  g.addColorStop(0.38, 'rgba(255,180,70,0.55)');
  g.addColorStop(0.72, 'rgba(255,90,10,0.20)');
  g.addColorStop(1.00, 'rgba(255,60,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · МАТЕРИАЛЫ
   ═══════════════════════════════════════════════════════════════════════════ */

const _NOISE      = makeNoiseTexture(256, 0.28); _NOISE.repeat.set(4, 4);
const _NOISE_FINE = makeNoiseTexture(256, 0.14); _NOISE_FINE.repeat.set(12, 12);
const _NOISE_POLY = makeNoiseTexture(256, 0.55); _NOISE_POLY.repeat.set(20, 20);

export function createRPGMaterials() {
  return {
    olive:      new THREE.MeshStandardMaterial({ color: 0x454c30, metalness: 0.82, roughness: 0.58, roughnessMap: _NOISE }),
    oliveDark:  new THREE.MeshStandardMaterial({ color: 0x2c3220, metalness: 0.85, roughness: 0.66, roughnessMap: _NOISE }),
    steel:      new THREE.MeshStandardMaterial({ color: 0x484e56, metalness: 1.0,  roughness: 0.40, roughnessMap: _NOISE }),
    steelDark:  new THREE.MeshStandardMaterial({ color: 0x22252a, metalness: 1.0,  roughness: 0.55, roughnessMap: _NOISE }),
    blackMetal: new THREE.MeshStandardMaterial({ color: 0x0e1013, metalness: 0.92, roughness: 0.60, roughnessMap: _NOISE }),
    blackInner: new THREE.MeshStandardMaterial({ color: 0x050608, metalness: 0.5,  roughness: 0.95, side: THREE.BackSide }),
    polymer:    new THREE.MeshStandardMaterial({ color: 0x111315, metalness: 0.05, roughness: 0.78, roughnessMap: _NOISE_POLY }),
    polymerSoft:new THREE.MeshStandardMaterial({ color: 0x0a0b0d, metalness: 0.03, roughness: 0.92 }),
    markYellow: new THREE.MeshStandardMaterial({ color: 0xc6a020, metalness: 0.3,  roughness: 0.62 }),
    markRed:    new THREE.MeshStandardMaterial({ color: 0x961410, metalness: 0.3,  roughness: 0.62 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9ecbff, metalness: 0.0, roughness: 0.04,
      transparent: true, opacity: 0.32, side: THREE.DoubleSide,
      clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 2.0, depthWrite: false
    }),
    reticle: new THREE.MeshBasicMaterial({
      color: 0xff2510, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    })
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · МОДЕЛЬ РПГ-7
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Строит полную модель РПГ-7.
 * @param {object} [materials] — результат createRPGMaterials()
 * @returns {THREE.Group} — группа с именем 'RPG7' и дочерней группой 'rocket'
 */
export function createRPG7(materials) {
  const MAT = materials || createRPGMaterials();
  const launcher = new THREE.Group();
  launcher.name = 'RPG7';

  function mesh(geo, mat, x=0, y=0, z=0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    launcher.add(m);
    return m;
  }
  const box = (w,h,d,mat,x=0,y=0,z=0) => mesh(new THREE.BoxGeometry(w,h,d), mat, x,y,z);
  function cyl(r1, r2, h, seg, mat, x=0, y=0, z=0, axis='x') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
    if (axis==='x') m.rotation.z = Math.PI/2;
    if (axis==='z') m.rotation.x = Math.PI/2;
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    launcher.add(m);
    return m;
  }
  function cone(rTop, rBottom, h, seg, mat, x=0, y=0, z=0) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, false), mat);
    m.rotation.z = -Math.PI/2;
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    launcher.add(m);
    return m;
  }
  function extrudeSide(points, depth, mat, bevel = 0.12) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i=1; i<points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 2, curveSegments: 24, steps: 1
    });
    geo.translate(0, 0, -depth/2);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    launcher.add(m);
    return m;
  }
  function makeRail(length, width=1.4, toothH=0.22, pitch=0.55) {
    const g = new THREE.Group();
    const baseH = 0.24;
    const base = new THREE.Mesh(new THREE.BoxGeometry(length, baseH, width), MAT.blackMetal);
    base.position.y = baseH/2;
    base.castShadow = true; base.receiveShadow = true;
    g.add(base);
    const toothW = 0.34;
    const n = Math.max(1, Math.floor((length - 0.3) / pitch));
    const start = -((n - 1) * pitch) / 2;
    for (let i=0; i<n; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(toothW, toothH, width), MAT.blackMetal);
      t.position.set(start + i*pitch, baseH + toothH/2, 0);
      t.castShadow = true; t.receiveShadow = true;
      g.add(t);
    }
    return g;
  }

  /* ---------- РАКЕТА (отдельная группа для анимации перезарядки) ---------- */
  const rocketGroup = new THREE.Group();
  rocketGroup.name = 'rocket';
  launcher.add(rocketGroup);
  function rmesh(geo, mat, x=0, y=0, z=0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    rocketGroup.add(m);
    return m;
  }
  function rcyl(r1, r2, h, seg, mat, x=0, y=0, z=0, axis='x') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
    if (axis==='x') m.rotation.z = Math.PI/2;
    if (axis==='z') m.rotation.x = Math.PI/2;
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    rocketGroup.add(m);
    return m;
  }
  function rcone(rTop, rBottom, h, seg, mat, x=0, y=0, z=0) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, false), mat);
    m.rotation.z = -Math.PI/2;
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    rocketGroup.add(m);
    return m;
  }

  /* ---------- ОСНОВНАЯ ТРУБА ---------- */
  cyl(2.05, 2.05, 8, 32, MAT.olive, -35, 0, 0, 'x');
  cyl(2.0, 2.0, 42, 32, MAT.olive, -10, 0, 0, 'x');
  cyl(2.05, 2.05, 14, 32, MAT.olive, 18, 0, 0, 'x');
  box(62, 0.14, 0.32, MAT.oliveDark, -8, 2.02, 0);
  box(62, 0.10, 0.24, MAT.oliveDark, -8, -2.02, 0);
  for (const rx of [-32, -22, -14, 2, 12]) {
    cyl(2.14, 2.14, 0.55, 32, MAT.oliveDark, rx, 0, 0, 'x');
    cyl(2.16, 2.16, 0.16, 32, MAT.blackMetal, rx, 0, 0, 'x');
  }
  for (const rx of [-33, -27, -19, -8, 4, 15]) {
    cyl(0.14, 0.14, 4.2, 10, MAT.steelDark, rx, 0, 0, 'z');
    cyl(0.22, 0.22, 0.14, 10, MAT.steelDark, rx, 0, 2.1, 'z');
    cyl(0.22, 0.22, 0.14, 10, MAT.steelDark, rx, 0, -2.1, 'z');
  }

  /* ---------- ПЕРЕДНИЙ КОЖУХ ---------- */
  cyl(2.28, 2.28, 9, 32, MAT.oliveDark, 14, 0, 0, 'x');
  cyl(2.40, 2.40, 0.5, 32, MAT.oliveDark, 9.5, 0, 0, 'x');
  cyl(2.40, 2.40, 0.6, 32, MAT.oliveDark, 18.7, 0, 0, 'x');
  for (let i=0; i<4; i++) {
    const x = 11 + i*1.9;
    box(1.35, 0.35, 0.55, MAT.blackMetal, x, 2.30, 0.9);
    box(1.35, 0.35, 0.55, MAT.blackMetal, x, 2.30, -0.9);
    box(1.35, 0.35, 0.55, MAT.blackMetal, x, -2.30, 0.9);
    box(1.35, 0.35, 0.55, MAT.blackMetal, x, -2.30, -0.9);
    box(1.35, 0.55, 0.35, MAT.blackMetal, x, 0.9, 2.30);
    box(1.35, 0.55, 0.35, MAT.blackMetal, x, -0.9, 2.30);
    box(1.35, 0.55, 0.35, MAT.blackMetal, x, 0.9, -2.30);
    box(1.35, 0.55, 0.35, MAT.blackMetal, x, -0.9, -2.30);
  }

  /* ---------- ПЕРЕДНИЙ СРЕЗ ТРУБЫ ---------- */
  cyl(2.42, 2.42, 3.2, 32, MAT.oliveDark, 22.5, 0, 0, 'x');
  cyl(2.58, 2.58, 0.9, 32, MAT.oliveDark, 24.7, 0, 0, 'x');
  cyl(2.42, 2.42, 0.4, 32, MAT.blackMetal, 25.35, 0, 0, 'x');
  cyl(2.25, 2.25, 0.3, 32, MAT.blackMetal, 25.5, 0, 0, 'x');

  /* ---------- ЗАДНИЙ РАСТРУБ ---------- */
  cyl(2.20, 2.20, 2.0, 32, MAT.oliveDark, -40.0, 0, 0, 'x');
  cone(3.9, 2.20, 7, 32, MAT.oliveDark, -45.5, 0, 0);
  cyl(3.95, 3.95, 0.7, 32, MAT.oliveDark, -49.35, 0, 0, 'x');
  cyl(4.05, 4.05, 0.3, 32, MAT.blackMetal, -49.35, 0, 0, 'x');
  cyl(3.70, 3.70, 0.35, 32, MAT.blackMetal, -49.6, 0, 0, 'x');
  cone(2.0, 3.55, 2.5, 32, MAT.blackMetal, -47.9, 0, 0);
  for (let i=0; i<6; i++) {
    const a = (i/6) * Math.PI * 2;
    const py = Math.cos(a) * 2.55;
    const pz = Math.sin(a) * 2.55;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.28, 5), MAT.oliveDark);
    rib.position.set(-45.5, py, pz);
    rib.rotation.x = a;
    rib.castShadow = true; rib.receiveShadow = true;
    launcher.add(rib);
  }

  /* ---------- РАКЕТА PG-7V ---------- */
  rcyl(1.42, 1.42, 15, 24, MAT.oliveDark, 23.5, 0, 0, 'x');
  rcyl(1.62, 1.62, 0.45, 24, MAT.steelDark, 20.5, 0, 0, 'x');
  rcyl(1.60, 1.60, 0.45, 24, MAT.steelDark, 29.5, 0, 0, 'x');
  rcone(4.35, 1.42, 3.2, 32, MAT.olive, 32.6, 0, 0);
  rcyl(4.35, 4.35, 8, 32, MAT.olive, 38.2, 0, 0, 'x');
  rcyl(4.40, 4.40, 0.28, 32, MAT.oliveDark, 41.5, 0, 0, 'x');
  rcyl(4.36, 4.36, 0.35, 32, MAT.markYellow, 35.2, 0, 0, 'x');
  rcyl(4.36, 4.36, 0.28, 32, MAT.markRed, 36.2, 0, 0, 'x');
  rcyl(4.36, 4.36, 0.22, 32, MAT.markYellow, 40.0, 0, 0, 'x');
  rcone(2.35, 4.35, 4.5, 32, MAT.olive, 44.5, 0, 0);
  rcone(0.75, 2.35, 5.0, 32, MAT.olive, 49.3, 0, 0);
  rcyl(0.90, 0.90, 0.28, 20, MAT.steelDark, 51.6, 0, 0, 'x');
  rmesh(new THREE.SphereGeometry(0.78, 24, 16), MAT.oliveDark, 52.2, 0, 0);
  rcyl(1.05, 1.05, 0.42, 24, MAT.steel, 51.0, 0, 0, 'x');
  rcyl(0.75, 0.75, 0.22, 20, MAT.blackMetal, 51.4, 0, 0, 'x');
  rcyl(4.42, 4.42, 0.30, 32, MAT.oliveDark, 33.8, 0, 0, 'x');
  rcyl(4.42, 4.42, 0.30, 32, MAT.oliveDark, 43.0, 0, 0, 'x');

  /* ---------- РУКОЯТКИ ---------- */
  extrudeSide([[-6.5,-2.2], [-10.5,-2.2], [-13.8,-9.5], [-9.5,-10.5]], 2.9, MAT.polymer);
  for (let i=0; i<5; i++) {
    const t = i/5;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.6, 2.95), MAT.polymerSoft);
    rib.position.set(-8.0 - t*3.4, -3.6 - t*5.0, 0);
    rib.rotation.z = -0.42;
    rib.castShadow = true; rib.receiveShadow = true;
    launcher.add(rib);
  }
  box(2.2, 0.9, 2.7, MAT.polymerSoft, -12.0, -9.8, 0);

  extrudeSide([[1.6,-2.2], [-0.8,-2.2], [-3.2,-7.8], [-0.2,-8.6]], 2.7, MAT.polymer);
  for (let i=0; i<4; i++) {
    const t = i/4;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.4, 2.75), MAT.polymerSoft);
    rib.position.set(0.9 - t*2.2, -3.4 - t*3.2, 0);
    rib.rotation.z = -0.35;
    rib.castShadow = true; rib.receiveShadow = true;
    launcher.add(rib);
  }

  /* ---------- УСМ ---------- */
  box(7.2, 2.6, 2.6, MAT.oliveDark, -4.0, -2.5, 0);
  box(6.8, 0.4, 2.4, MAT.steelDark, -4.0, -1.2, 0);
  const trig = box(0.65, 2.1, 0.9, MAT.steel, -3.5, -4.4, 0);
  trig.rotation.z = 0.22;
  box(5.4, 0.5, 1.8, MAT.steelDark, -3.0, -6.4, 0);
  box(0.5, 2.1, 1.8, MAT.steelDark, -5.5, -5.5, 0);
  box(0.5, 2.1, 1.8, MAT.steelDark, -0.6, -5.5, 0);
  box(1.4, 0.7, 0.6, MAT.steel, -7.8, -3.6, 1.4);
  cyl(0.28, 0.28, 0.55, 10, MAT.steelDark, -7.8, -3.6, 1.1, 'z');
  box(0.9, 0.9, 0.9, MAT.steelDark, -6.5, -2.8, 1.2);

  /* ---------- ПЛАНКИ ПИКАТИННИ ---------- */
  const railRear  = makeRail(10, 1.4); railRear.position.set(-8, 2.15, 0);  launcher.add(railRear);
  const railMid   = makeRail(8,  1.4); railMid.position.set(2, 2.15, 0);    launcher.add(railMid);
  const railFront = makeRail(9,  1.4); railFront.position.set(14, 2.85, 0); launcher.add(railFront);
  const railSide  = makeRail(9,  1.2);
  railSide.rotation.z = Math.PI/2;
  railSide.position.set(-9, 0, -3.4);
  launcher.add(railSide);

  /* ---------- ЖЕЛЕЗНЫЕ ПРИЦЕЛЫ ---------- */
  box(3.4, 1.0, 2.4, MAT.steelDark, -9.5, 2.55, 0);
  cyl(0.28, 0.28, 2.6, 12, MAT.steel, -9.5, 2.85, 0, 'z');
  box(0.55, 3.0, 2.2, MAT.steelDark, -9.5, 4.3, 0);
  box(0.9, 0.4, 0.65, MAT.blackMetal, -9.5, 5.5, 0);
  for (let i=0; i<5; i++) box(0.10, 0.9, 0.15, MAT.blackMetal, -9.5, 3.4 + i*0.45, 0.95);
  box(0.4, 2.8, 0.4, MAT.steelDark, -9.5, 4.3, 1.15);
  box(0.4, 2.8, 0.4, MAT.steelDark, -9.5, 4.3, -1.15);

  box(2.6, 1.0, 2.3, MAT.steelDark, 19.5, 2.55, 0);
  cyl(0.26, 0.26, 2.4, 12, MAT.steel, 19.5, 2.85, 0, 'z');
  box(0.55, 2.8, 0.55, MAT.steelDark, 19.5, 4.5, 0);
  box(0.42, 2.6, 0.42, MAT.steelDark, 19.5, 4.5, 1.15);
  box(0.42, 2.6, 0.42, MAT.steelDark, 19.5, 4.5, -1.15);
  box(0.42, 0.42, 2.75, MAT.steelDark, 19.5, 5.75, 0);
  box(0.22, 0.5, 0.22, MAT.blackMetal, 19.5, 5.9, 0);

  /* ============================================================
     ПГО-7 — основной прицел (сквозная труба + красная сетка)
     ============================================================ */
  (function addPGO7(){
    const optic = new THREE.Group();
    optic.name = 'pgo7';
    const oadd = (geo, mat, x, y, z, rx=0, ry=0, rz=0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true; m.receiveShadow = true;
      optic.add(m);
      return m;
    };

    oadd(new THREE.BoxGeometry(5.0, 1.8, 0.7), MAT.blackMetal, 0, 0, 0);
    oadd(new THREE.BoxGeometry(1.6, 1.2, 2.2), MAT.blackMetal, 0, -0.6, 1.0);
    oadd(new THREE.CylinderGeometry(0.22, 0.22, 0.45, 10), MAT.steelDark, -1.8, -0.6, 1.4, Math.PI/2, 0, 0);
    oadd(new THREE.CylinderGeometry(0.22, 0.22, 0.45, 10), MAT.steelDark,  1.8, -0.6, 1.4, Math.PI/2, 0, 0);

    const outerTube = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.35, 7.4, 24, 1, true), MAT.blackMetal
    );
    outerTube.rotation.z = Math.PI/2;
    outerTube.position.set(0, 1.9, 0);
    outerTube.castShadow = true; outerTube.receiveShadow = true;
    optic.add(outerTube);

    const innerTube = new THREE.Mesh(
      new THREE.CylinderGeometry(1.32, 1.32, 7.4, 24, 1, true), MAT.blackInner
    );
    innerTube.rotation.z = Math.PI/2;
    innerTube.position.set(0, 1.9, 0);
    optic.add(innerTube);

    oadd(new THREE.BoxGeometry(7.6, 0.3, 1.4), MAT.blackMetal, 0, 3.2, 0);
    for (let i=0; i<8; i++) {
      oadd(new THREE.BoxGeometry(0.6, 0.15, 1.6), MAT.steelDark, -3.3 + i*0.94, 3.4, 0);
    }

    const objHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.32, 1.32, 1.0, 24, 1, true), MAT.blackMetal
    );
    objHousing.rotation.z = Math.PI/2;
    objHousing.position.set(4.5, 1.9, 0);
    objHousing.castShadow = true; objHousing.receiveShadow = true;
    optic.add(objHousing);

    const sunShade = new THREE.Mesh(
      new THREE.CylinderGeometry(1.38, 1.38, 0.7, 24, 1, true), MAT.blackMetal
    );
    sunShade.rotation.z = Math.PI/2;
    sunShade.position.set(5.4, 1.9, 0);
    sunShade.castShadow = true; sunShade.receiveShadow = true;
    optic.add(sunShade);

    const frontLens = new THREE.Mesh(new THREE.CircleGeometry(1.12, 28), MAT.glass);
    frontLens.rotation.y = Math.PI/2;
    frontLens.position.set(5.72, 1.9, 0);
    frontLens.renderOrder = 5;
    optic.add(frontLens);

    const eyeHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.15, 1.3, 24, 1, true), MAT.blackMetal
    );
    eyeHousing.rotation.z = Math.PI/2;
    eyeHousing.position.set(-4.6, 1.9, 0);
    eyeHousing.castShadow = true; eyeHousing.receiveShadow = true;
    optic.add(eyeHousing);

    const rubber = new THREE.Mesh(
      new THREE.CylinderGeometry(1.32, 1.32, 1.0, 24, 1, true), MAT.polymerSoft
    );
    rubber.rotation.z = Math.PI/2;
    rubber.position.set(-5.5, 1.9, 0);
    rubber.castShadow = true;
    optic.add(rubber);

    const eyeLens = new THREE.Mesh(new THREE.CircleGeometry(0.98, 28), MAT.glass);
    eyeLens.rotation.y = -Math.PI/2;
    eyeLens.position.set(-5.2, 1.9, 0);
    eyeLens.renderOrder = 5;
    optic.add(eyeLens);

    /* Сетка */
    const reticle = new THREE.Group();
    reticle.position.set(0, 1.9, 0);

    reticle.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1.85), MAT.reticle));

    const vTop = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.55, 0.03), MAT.reticle);
    vTop.position.y = 0.42; reticle.add(vTop);
    const vBot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.55, 0.03), MAT.reticle);
    vBot.position.y = -0.42; reticle.add(vBot);

    reticle.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.05), MAT.reticle));

    for (let i=1; i<=3; i++) {
      const off = i * 0.25;
      const tL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.02), MAT.reticle);
      tL.position.z = off; reticle.add(tL);
      const tR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.02), MAT.reticle);
      tR.position.z = -off; reticle.add(tR);
    }
    for (let i=1; i<=2; i++) {
      const off = 0.55 + i * 0.18;
      const tL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.20, 0.02), MAT.reticle);
      tL.position.z = off; reticle.add(tL);
      const tR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.20, 0.02), MAT.reticle);
      tR.position.z = -off; reticle.add(tR);
    }
    for (let i=1; i<=3; i++) {
      const yOff = -0.55 - i * 0.20;
      const tL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.15), MAT.reticle);
      tL.position.y = yOff; tL.position.z = 0.20; reticle.add(tL);
      const tR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.15), MAT.reticle);
      tR.position.y = yOff; tR.position.z = -0.20; reticle.add(tR);
    }
    optic.add(reticle);

    /* Барабанчики поправок */
    oadd(new THREE.CylinderGeometry(0.55, 0.55, 0.85, 16), MAT.blackMetal, -1.5, 3.5, 0);
    oadd(new THREE.CylinderGeometry(0.65, 0.65, 0.15, 16), MAT.steelDark, -1.5, 4.0, 0);
    for (let i=0; i<8; i++) {
      const a = (i/8) * Math.PI * 2;
      oadd(new THREE.BoxGeometry(0.06, 0.55, 0.06), MAT.blackMetal,
           -1.5 + Math.cos(a) * 0.55, 3.85, Math.sin(a) * 0.55);
    }
    oadd(new THREE.CylinderGeometry(0.50, 0.50, 0.75, 16), MAT.blackMetal, 0, 1.9, 1.35, Math.PI/2, 0, 0);
    oadd(new THREE.CylinderGeometry(0.60, 0.60, 0.13, 16), MAT.steelDark, 0, 1.9, 1.75, Math.PI/2, 0, 0);

    optic.position.set(-9, 3.4, -4.1);
    launcher.add(optic);
  })();

  /* ---------- ДОП. ДЕТАЛИ ---------- */
  cyl(2.35, 2.35, 0.55, 32, MAT.oliveDark, 6.5, 0, 0, 'x');
  cyl(0.28, 0.28, 1.4, 12, MAT.blackMetal, -4.0, -5.0, 0.9, 'z');
  cyl(0.32, 0.32, 0.25, 12, MAT.steelDark, -4.0, -5.0, 1.6, 'z');
  cyl(0.18, 0.18, 0.35, 10, MAT.steelDark, -1.5, -2.5, 1.35, 'z');
  cyl(0.18, 0.18, 0.35, 10, MAT.steelDark, -6.5, -2.5, 1.35, 'z');
  box(1.4, 0.7, 0.9, MAT.steelDark, 23.5, -1.9, 0);
  cyl(0.20, 0.20, 1.6, 10, MAT.blackMetal, 22.5, -1.9, 0, 'x');
  cyl(0.22, 0.22, 0.30, 10, MAT.steelDark, -46, 0, 3.75, 'x');
  cyl(0.22, 0.22, 0.30, 10, MAT.steelDark, -46, 0, -3.75, 'x');

  box(5.0, 1.3, 0.10, MAT.steel, -15, 0.5, 2.10);
  box(4.2, 0.18, 0.05, MAT.blackMetal, -15, 0.95, 2.18);
  box(3.6, 0.14, 0.05, MAT.blackMetal, -15, 0.55, 2.18);
  box(4.5, 0.14, 0.05, MAT.blackMetal, -15, 0.20, 2.18);

  return launcher;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · ЭФФЕКТЫ (частицы, взрывы, летящие ракеты)
   ═══════════════════════════════════════════════════════════════════════════ */

export class RPGEffects {
  /**
   * @param {THREE.Scene} scene
   * @param {WeaponAudio} [audio]
   * @param {object} [opts]
   */
  constructor(scene, audio, opts = {}) {
    this.scene = scene;
    this.audio = audio || null;
    this.maxParticles = opts.maxParticles ?? 2000;
    this.hittables    = opts.hittables || [];

    /* --- частицы --- */
    this.pPositions = new Float32Array(this.maxParticles * 3);
    this.pColors    = new Float32Array(this.maxParticles * 3);
    this.pData = [];
    for (let i=0; i<this.maxParticles; i++) {
      this.pData.push({ life: 0, maxLife: 1, vel: new THREE.Vector3(), base: new THREE.Color(), grav: 1 });
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPositions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pColors, 3));
    this.pGeo = pGeo;

    this.pointsMat = new THREE.PointsMaterial({
      size: 0.10, map: makeDotTexture(), vertexColors: true,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true
    });
    this.points = new THREE.Points(pGeo, this.pointsMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pCursor = 0;

    /* --- летящие ракеты --- */
    this.flyingRockets = [];

    /* --- взрывы --- */
    this.explosions = [];

    /* --- внешние коллбеки --- */
    this.onExplosionShake = null; // (x, y, z) => void
  }

  /* ====== частицы ====== */
  spawnParticle(pos, vel, color, life, grav = 1) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % this.maxParticles;
    const d = this.pData[i];
    d.life = life; d.maxLife = life;
    d.vel.copy(vel);
    d.base.set(color);
    d.grav = grav;
    this.pPositions[i*3]   = pos.x;
    this.pPositions[i*3+1] = pos.y;
    this.pPositions[i*3+2] = pos.z;
    this.pColors[i*3]   = d.base.r;
    this.pColors[i*3+1] = d.base.g;
    this.pColors[i*3+2] = d.base.b;
  }

  /* ====== ракета ====== */
  spawnRocket(startPos, dir, materials) {
    const M = materials || createRPGMaterials();

    const grp = new THREE.Group();
    const g1 = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.075, 16), M.olive);
    g1.rotation.x = Math.PI/2; grp.add(g1);
    const g2 = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.045, 16), M.oliveDark);
    g2.rotation.x = -Math.PI/2; g2.position.z = 0.06; grp.add(g2);
    const g3 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 12), M.steelDark);
    g3.rotation.x = Math.PI/2; g3.position.z = -0.065; grp.add(g3);

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.032, 0.15, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb050, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false
      })
    );
    flame.rotation.x = Math.PI/2;
    flame.position.z = -0.14;
    grp.add(flame);

    grp.position.copy(startPos);
    grp.lookAt(startPos.clone().add(dir));
    this.scene.add(grp);

    const light = new THREE.PointLight(0xffb060, 5, 15, 2);
    light.position.copy(startPos);
    this.scene.add(light);

    this.flyingRockets.push({
      obj: grp, flame, light,
      vel: dir.clone().multiplyScalar(RPG7_CONFIG.ROCKET_SPEED),
      life: RPG7_CONFIG.ROCKET_LIFE,
      trailTimer: 0
    });
  }

  /* ====== взрыв ====== */
  createExplosion(pos, dir = new THREE.Vector3(0, 1, 0)) {
    const fireball = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 20, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffa030, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      })
    );
    fireball.position.copy(pos); fireball.renderOrder = 3;
    this.scene.add(fireball);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xfff2b0, transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      })
    );
    core.position.copy(pos); core.renderOrder = 4;
    this.scene.add(core);

    const shock = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.5, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffd0a0, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false
      })
    );
    shock.position.copy(pos);
    shock.lookAt(pos.clone().add(dir.clone().multiplyScalar(-1)));
    shock.renderOrder = 3;
    this.scene.add(shock);

    const light = new THREE.PointLight(0xffa040, RPG7_CONFIG.EXPLOSION_LIGHT, 30, 2);
    light.position.copy(pos);
    this.scene.add(light);

    for (let i=0; i<70; i++) {
      const v = new THREE.Vector3((Math.random()-0.5)*22, Math.random()*14+2, (Math.random()-0.5)*22);
      this.spawnParticle(pos, v, 0xffc060, 0.4 + Math.random()*0.5, 1.2);
    }
    for (let i=0; i<40; i++) {
      const v = new THREE.Vector3((Math.random()-0.5)*14, Math.random()*10, (Math.random()-0.5)*14);
      this.spawnParticle(pos, v, 0xff5020, 0.8 + Math.random()*0.6, 1.0);
    }
    for (let i=0; i<80; i++) {
      const v = new THREE.Vector3((Math.random()-0.5)*6, Math.random()*5+1, (Math.random()-0.5)*6);
      const p = pos.clone();
      p.x += (Math.random()-0.5)*0.5; p.y += (Math.random()-0.5)*0.5; p.z += (Math.random()-0.5)*0.5;
      this.spawnParticle(p, v, 0x4a4a4a, 1.8 + Math.random()*1.4, 0.1);
    }
    for (let i=0; i<40; i++) {
      const v = new THREE.Vector3((Math.random()-0.5)*4, Math.random()*3+1, (Math.random()-0.5)*4);
      this.spawnParticle(pos, v, 0x1a1a1a, 2.5 + Math.random()*1.5, 0.1);
    }

    this.explosions.push({ fireball, core, shock, light, age: 0, duration: RPG7_CONFIG.EXPLOSION_DURATION });

    /* уведомить наружу (камера shake) */
    if (this.onExplosionShake) {
      const S = RPG7_CONFIG.SHAKE_ON_EXPLOSION;
      this.onExplosionShake(
        (Math.random()-0.5) * S.x,
        (Math.random()-0.5) * S.y + S.yBias,
        (Math.random()-0.5) * S.z
      );
    }
    this.audio?.explosion();
  }

  /* ====== обновление ====== */
  update(dt) {
    /* --- частицы --- */
    const P = this.pData, pos = this.pPositions, col = this.pColors;
    for (let i=0; i<this.maxParticles; i++) {
      const d = P[i];
      if (d.life <= 0) {
        col[i*3] = col[i*3+1] = col[i*3+2] = 0;
        continue;
      }
      d.life -= dt;
      const t = Math.max(d.life / d.maxLife, 0);
      d.vel.y -= 9.81 * d.grav * dt;
      d.vel.multiplyScalar(1 - 1.8 * dt);
      pos[i*3]   += d.vel.x * dt;
      pos[i*3+1] += d.vel.y * dt;
      pos[i*3+2] += d.vel.z * dt;
      if (pos[i*3+1] < 0.05) {
        pos[i*3+1] = 0.05;
        d.vel.y *= -0.25; d.vel.x *= 0.6; d.vel.z *= 0.6;
      }
      const k = t * t;
      col[i*3]   = d.base.r * k;
      col[i*3+1] = d.base.g * k;
      col[i*3+2] = d.base.b * k;
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;

    /* --- летящие ракеты --- */
    for (let i = this.flyingRockets.length - 1; i >= 0; i--) {
      const r = this.flyingRockets[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.scene.remove(r.obj); this.scene.remove(r.light);
        this.flyingRockets.splice(i, 1);
        continue;
      }
      r.vel.y -= RPG7_CONFIG.ROCKET_GRAVITY * dt;
      r.obj.position.addScaledVector(r.vel, dt);
      r.obj.lookAt(r.obj.position.clone().add(r.vel));
      r.light.position.copy(r.obj.position);

      /* след */
      r.trailTimer += dt;
      const step = 0.012;
      while (r.trailTimer > step) {
        r.trailTimer -= step;
        for (let k=0; k<2; k++) {
          const back = r.obj.position.clone().addScaledVector(r.vel.clone().normalize(), -0.15);
          back.x += (Math.random() - 0.5) * 0.06;
          back.y += (Math.random() - 0.5) * 0.06;
          back.z += (Math.random() - 0.5) * 0.06;
          const v = r.vel.clone().normalize().multiplyScalar(-2 + Math.random() * 1.5);
          v.x += (Math.random() - 0.5) * 1.0;
          v.y += Math.random() * 0.8;
          v.z += (Math.random() - 0.5) * 1.0;
          this.spawnParticle(back, v, 0x8a8a8a, 0.9 + Math.random() * 0.5, 0.15);
        }
        const back = r.obj.position.clone().addScaledVector(r.vel.clone().normalize(), -0.10);
        const v = r.vel.clone().normalize().multiplyScalar(-3 + Math.random() * 2);
        v.x += (Math.random() - 0.5) * 2.0;
        v.y += Math.random() * 1.0;
        v.z += (Math.random() - 0.5) * 2.0;
        this.spawnParticle(back, v, 0xff8030, 0.35, 0.4);
      }

      /* столкновения */
      const origin = r.obj.position.clone();
      const dir = r.vel.clone().normalize();
      const ray = new THREE.Raycaster(origin, dir, 0, 0.5);
      const hits = ray.intersectObjects(this.hittables, false);
      if (hits.length > 0) {
        this.createExplosion(hits[0].point, dir);
        this.scene.remove(r.obj); this.scene.remove(r.light);
        this.flyingRockets.splice(i, 1);
        continue;
      }
      if (r.obj.position.y < 0.02) {
        const p = r.obj.position.clone(); p.y = 0.02;
        this.createExplosion(p, dir);
        this.scene.remove(r.obj); this.scene.remove(r.light);
        this.flyingRockets.splice(i, 1);
      }
    }

    /* --- взрывы --- */
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.age += dt;
      const t = e.age / e.duration;
      if (t >= 1) {
        this.scene.remove(e.fireball); this.scene.remove(e.core);
        this.scene.remove(e.shock);    this.scene.remove(e.light);
        e.fireball.material.dispose();
        e.core.material.dispose();
        e.shock.material.dispose();
        this.explosions.splice(i, 1);
        continue;
      }
      e.fireball.scale.setScalar((0.5 + t*4.5) / 0.5);
      e.fireball.material.opacity = Math.max(0, 0.95 * (1 - t*1.3));
      e.core.scale.setScalar(1 + t*6);
      e.core.material.opacity = Math.max(0, 1 - t*2);
      e.shock.scale.setScalar((0.5 + t*8) / 0.5);
      e.shock.material.opacity = Math.max(0, 0.8 * (1 - t*1.4));
      e.light.intensity = Math.max(0, RPG7_CONFIG.EXPLOSION_LIGHT * (1 - t*1.5));
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · ЗВУК
   ═══════════════════════════════════════════════════════════════════════════ */

export class WeaponAudio {
  constructor(masterVolume = 0.6) {
    this.volume = masterVolume;
    this.actx = null;
    this.masterGain = null;
    this.noiseBuf = null;
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

      const len = Math.floor(this.actx.sampleRate * 1.2);
      this.noiseBuf = this.actx.createBuffer(1, len, this.actx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { /* Audio недоступен */ }
  }

  resume() {
    if (this.actx && this.actx.state === 'suspended') this.actx.resume();
  }

  launch() {
    if (!this.actx) return;
    const t = this.actx.currentTime;

    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = this.actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
    const lp = this.actx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.masterGain);
    src.start(t); src.stop(t + 0.5);

    const o = this.actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const og = this.actx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og); og.connect(this.masterGain);
    o.start(t); o.stop(t + 0.32);

    const src2 = this.actx.createBufferSource(); src2.buffer = this.noiseBuf;
    const bp = this.actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.5;
    const g2 = this.actx.createGain();
    g2.gain.setValueAtTime(0.0001, t + 0.05);
    g2.gain.linearRampToValueAtTime(0.35, t + 0.1);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    src2.connect(bp); bp.connect(g2); g2.connect(this.masterGain);
    src2.start(t); src2.stop(t + 1.3);
  }

  explosion() {
    if (!this.actx) return;
    const t = this.actx.currentTime;

    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = this.actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
    const lp = this.actx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(1.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.masterGain);
    src.start(t); src.stop(t + 1.8);

    const o = this.actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    const og = this.actx.createGain();
    og.gain.setValueAtTime(1.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(og); og.connect(this.masterGain);
    o.start(t); o.stop(t + 1.1);

    const src2 = this.actx.createBufferSource(); src2.buffer = this.noiseBuf;
    const bp = this.actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 0.4;
    const g2 = this.actx.createGain();
    g2.gain.setValueAtTime(0.0001, t + 0.1);
    g2.gain.linearRampToValueAtTime(0.4, t + 0.2);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
    src2.connect(bp); bp.connect(g2); g2.connect(this.masterGain);
    src2.start(t); src2.stop(t + 2.6);
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

    this.mouseSensitivity = opts.mouseSensitivity ?? RPG7_CONFIG.MOUSE_SENS;
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
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2);
        if (d > 0.0001) {
          const push = (r - d) / d;
          this.pos.x += dx * push;
          this.pos.z += dz * push;
        } else {
          this.pos.x += (this.pos.x < (b.min.x + b.max.x) / 2 ? -0.1 : 0.1);
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
   8 · КОНТРОЛЛЕР РПГ-7
   ═══════════════════════════════════════════════════════════════════════════ */

const _smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _easeOutCubic = x => 1 - Math.pow(1 - x, 3);

export class RPG7Controller {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.weaponScene
   * @param {THREE.Camera} opts.weaponCamera
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {PlayerController} opts.player
   * @param {RPGEffects} [opts.effects]
   * @param {WeaponAudio} [opts.audio]
   * @param {THREE.Vector3[]} [opts._ignored]
   * @param {HTMLElement} [opts.crosshairEl]
   * @param {Function} [opts.onAmmoChange]
   * @param {Function} [opts.onStateMessage]
   */
  constructor(opts) {
    this.opts = opts;
    this.weaponScene  = opts.weaponScene;
    this.weaponCamera = opts.weaponCamera;
    this.scene        = opts.scene;
    this.camera       = opts.camera;
    this.player       = opts.player;
    this.effects      = opts.effects || null;
    this.audio        = opts.audio   || null;

    this._crossEl        = opts.crosshairEl    || null;
    this._onAmmoChange   = opts.onAmmoChange   || null;
    this._onStateMessage = opts.onStateMessage || null;

    /* --- конфиг --- */
    this.cfg = Object.assign({}, RPG7_CONFIG, opts.config || {});

    /* --- модель --- */
    this.weaponRoot = new THREE.Group();
    this.weaponRoot.rotation.order = 'YXZ';
    this.weaponRoot.visible = false;

    const materials = opts.materials || createRPGMaterials();
    this.materials  = materials;
    this.rpg = createRPG7(materials);
    this.rpg.rotation.y = Math.PI / 2;
    this.rpg.scale.setScalar(this.cfg.SCALE);
    this.weaponRoot.add(this.rpg);

    this.rocketGroup = this.rpg.getObjectByName('rocket');
    this.muzzle = new THREE.Vector3(0, 0, this.cfg.MUZZLE_Z * this.cfg.SCALE);

    /* --- состояние --- */
    this.state        = 'holstered';
    this.time         = 0;
    this.ammo         = this.cfg.MAG_SIZE;
    this.reserve      = this.cfg.RESERVE;
    this.fireCooldown = 0;
    this.adsHeld      = false;
    this.adsAmount    = 0;

    /* --- анимационные слои --- */
    this.swayTarget  = new THREE.Vector2();
    this.swayCurrent = new THREE.Vector2();
    this.kickPos     = new THREE.Vector3();
    this.kickRot     = new THREE.Vector3();
    this.kickPosVel  = new THREE.Vector3();
    this.kickRotVel  = new THREE.Vector3();
    this.camShake    = new THREE.Vector3();
    this.camShakeVel = new THREE.Vector3();
    this.bobTime     = 0;
    this.bobAmount   = 0;
    this.breatheTime = 0;

    this.inspectOffsetPos = new THREE.Vector3();
    this.inspectOffsetRot = new THREE.Vector3();
    this.inspectOffsetActive = false;

    this.reloadFlags = { rocketOut: false, newRocketIn: false, ammoGiven: false };

    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 500;

    this._buildMuzzleFlash();

    /* --- прокидываем shake во внешние взрывы --- */
    if (this.effects && this.effects.onExplosionShake === null) {
      this.effects.onExplosionShake = (x, y, z) => {
        this.camShakeVel.x += x;
        this.camShakeVel.y += y;
        this.camShakeVel.z += z;
      };
    }
  }

  _buildMuzzleFlash() {
    const flashGroup = new THREE.Group();
    flashGroup.position.copy(this.muzzle);
    flashGroup.visible = false;
    this.weaponRoot.add(flashGroup);
    this.flashGroup = flashGroup;

    const flashTex = makeFlashTexture();
    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false
    });
    flashGroup.add(new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), flashMat));
    const fq2 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
    fq2.rotation.z = Math.PI/4;
    flashGroup.add(fq2);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.35, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb050, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
        depthTest: false, toneMapped: false
      })
    );
    cone.rotation.x = -Math.PI/2;
    cone.position.z = -0.18;
    flashGroup.add(cone);

    const flashLight = new THREE.PointLight(0xffb060, 0, 4, 2);
    flashLight.position.copy(this.muzzle);
    this.weaponRoot.add(flashLight);
    this.flashLight = flashLight;

    const worldLight = new THREE.PointLight(0xffb060, 0, 20, 2);
    this.scene.add(worldLight);
    this.worldFlashLight = worldLight;

    this.flashTimer = 0;
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
      this.tryFire();
    }
    if (button === 2) {
      if (this.state === 'inspecting') this.cancelInspect();
      this.adsHeld = true;
    }
  }

  onMouseUp(button) {
    if (button === 2) this.adsHeld = false;
  }

  onMouseMove(dx, dy) {
    const swayScale = 1 - this.adsAmount * 0.95;
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
      this.audio.click(0.25, 900, 0.07);
      setTimeout(() => this.audio?.click(0.2, 1600, 0.05), 260);
      setTimeout(() => this.audio?.click(0.18, 2200, 0.04), 480);
    }
  }

  cancelInspect() {
    if (this.state === 'inspecting') { this.state = 'idle'; this.time = 0; }
  }

  tryReload() {
    if (this.state === 'inspecting') this.cancelInspect();
    if (this.state !== 'idle') return;
    if (this.ammo >= this.cfg.MAG_SIZE) return;
    if (this.reserve <= 0) { this.setStateMessage('НЕТ РАКЕТ'); return; }

    this.state = 'reloading';
    this.time  = 0;
    this.reloadFlags.rocketOut   = false;
    this.reloadFlags.newRocketIn = false;
    this.reloadFlags.ammoGiven   = false;
    this.rocketGroup.visible = false;
    this.rocketGroup.position.set(0, 0, 0);
    this.audio?.click(0.3, 1100, 0.06);
  }

  tryInspect() {
    if (this.state === 'inspecting') { this.cancelInspect(); return; }
    if (this.state !== 'idle') return;
    this.state = 'inspecting';
    this.time  = 0;
    this.audio?.click(0.15, 700, 0.09);
  }

  /* ========================================================================
     ВЫСТРЕЛ РАКЕТОЙ
     ======================================================================== */

  tryFire() {
    if (this.state !== 'idle') return;
    if (this.fireCooldown > 0) return;

    if (this.ammo <= 0) {
      this.audio?.click(0.22, 2800, 0.04);
      this.fireCooldown = 0.5;
      this.setStateMessage('ПЕРЕЗАРЯДКА [R]');
      return;
    }

    this.ammo = 0;
    this._emitAmmo();
    this.fireCooldown = this.cfg.FIRE_INTERVAL;

    /* --- направление --- */
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
    );

    /* --- мировые координаты дула --- */
    this.weaponRoot.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld(true);
    const muzzleCam = this.muzzle.clone().applyMatrix4(this.weaponRoot.matrixWorld);
    const muzzleWorld = muzzleCam.clone().applyMatrix4(this.camera.matrixWorld);

    /* --- ракета + вспышка --- */
    this.effects?.spawnRocket(muzzleWorld, dir, this.materials);
    this.rocketGroup.visible = false;

    this.flashGroup.visible = true;
    this.flashGroup.rotation.z = Math.random() * Math.PI * 2;
    this.flashGroup.scale.setScalar(1.2 + Math.random() * 0.6);
    this.flashLight.intensity = 12 + Math.random() * 6;
    this.worldFlashLight.position.copy(muzzleWorld);
    this.worldFlashLight.intensity = 80;
    this.flashTimer = 0.09;

    /* --- отдача --- */
    this.kickPos.z += 0.10;
    this.kickPos.y += 0.02;
    this.kickRot.x += 0.30 + Math.random() * 0.10;
    this.kickRot.z += (Math.random() - 0.5) * 0.12;
    this.kickRot.y += (Math.random() - 0.5) * 0.08;

    this.player.pitch += 0.035;
    this.player.yaw   += (Math.random() - 0.5) * 0.008;
    this.player.pitch = Math.max(-this.player.pitchLimit,
                        Math.min(this.player.pitchLimit, this.player.pitch));

    const S = this.cfg.SHAKE_ON_FIRE;
    this.camShakeVel.x += (Math.random() - 0.5) * S.x;
    this.camShakeVel.y += (Math.random() - 0.5) * S.y;
    this.camShakeVel.z += (Math.random() - 0.5) * S.z;

    this.audio?.launch();

    /* --- реактивный выхлоп позади --- */
    if (this.effects) {
      const back = new THREE.Vector3(0, 0, 0.4).applyMatrix4(this.weaponRoot.matrixWorld);
      const backWorld = back.clone().applyMatrix4(this.camera.matrixWorld);
      for (let i=0; i<30; i++) {
        const v = new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          (Math.random() - 0.3) * 2,
          1 + Math.random() * 2
        ).applyEuler(new THREE.Euler(0, this.player.yaw, 0, 'YXZ'));
        this.effects.spawnParticle(backWorld, v, 0x8a8a8a, 0.9 + Math.random() * 0.6, 0.2);
      }
    }
  }

  _emitAmmo() {
    if (this._onAmmoChange) this._onAmmoChange(this.ammo, this.reserve);
  }

  /* ========================================================================
     ОБНОВЛЕНИЕ
     ======================================================================== */

  update(dt) {
    this._updateState(dt);
    this._updateAnimation(dt);
    this._updateFiring(dt);
    this._updateFlash(dt);
    this._applyToCamera();
    this._applyHudOpacity();
  }

  _updateState(dt) {
    if (this.state === 'drawing') {
      this.time += dt;
      if (this.time / this.cfg.DRAW_DUR >= 1) { this.state = 'idle'; this.time = 0; }
    } else if (this.state === 'reloading') {
      this.time += dt;
      this._reloadStep(dt);
      if (this.time >= this.cfg.RELOAD_DUR) {
        this.state = 'idle';
        this.time  = 0;
        this.rocketGroup.position.set(0, 0, 0);
        this.rocketGroup.visible = true;
      }
    } else if (this.state === 'inspecting') {
      this.time += dt;
      if (this.time >= this.cfg.INSPECT_DUR) { this.state = 'idle'; this.time = 0; }
    }
  }

  _reloadStep() {
    const t = this.time;
    const total = this.cfg.RELOAD_DUR;
    const F = this.reloadFlags;

    if (!F.rocketOut && t >= 0.35) {
      F.rocketOut = true;
      this.rocketGroup.visible = false;
      this.audio?.click(0.30, 700, 0.09);
      setTimeout(() => this.audio?.click(0.20, 400, 0.15), 120);
    }

    const newStart = 1.0;
    const newEnd = total - 0.5;
    if (t >= newStart && t < newEnd) {
      if (!F.newRocketIn) {
        F.newRocketIn = true;
        this.rocketGroup.visible = true;
        this.rocketGroup.position.set(0, -18, 4);
      }
      const u = _smoothstep(newStart, newEnd, t);
      this.rocketGroup.position.y = -18 * (1 - u);
      this.rocketGroup.position.z =  4  * (1 - u);
      this.rocketGroup.position.x =  0;
    }
    if (!F.ammoGiven && t >= newEnd - 0.1) {
      F.ammoGiven = true;
      this.rocketGroup.position.set(0, 0, 0);
      this.ammo    = 1;
      this.reserve = Math.max(0, this.reserve - 1);
      this._emitAmmo();
      this.audio?.click(0.35, 1100, 0.08);
      this.audio?.click(0.30, 2200, 0.06);
    }
  }

  _updateAnimation(dt) {
    const pos = new THREE.Vector3(this.cfg.BASE_POS.x, this.cfg.BASE_POS.y, this.cfg.BASE_POS.z);
    const rot = new THREE.Vector3(this.cfg.BASE_ROT.x, this.cfg.BASE_ROT.y, this.cfg.BASE_ROT.z);

    /* --- Доставание --- */
    if (this.state === 'drawing') {
      const t = Math.min(this.time / this.cfg.DRAW_DUR, 1);
      const k = 1 - _easeOutCubic(t);
      pos.y -= k * 0.65; pos.z += k * 0.15;
      rot.x -= k * 1.15; rot.z += k * 0.40; rot.y += k * 0.20;
    }

    /* --- Осмотр --- */
    if (this.state === 'inspecting') {
      const kT = this.time * (this.cfg.INSPECT_END / this.cfg.INSPECT_DUR);
      const keys = this.cfg.INSPECT_KEYS;
      let k0 = keys[0], k1 = keys[keys.length - 1];
      for (let i=0; i<keys.length - 1; i++) {
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

    /* --- Перезарядка: наклон --- */
    if (this.state === 'reloading') {
      const t = this.time;
      const total = this.cfg.RELOAD_DUR;
      const tiltIn  = _smoothstep(0.0, 0.25, t);
      const tiltOut = 1 - _smoothstep(total - 0.5, total, t);
      const tilt = tiltIn * tiltOut;

      pos.z += 0.06 * tilt;
      pos.y -= 0.10 * tilt;
      pos.x -= 0.03 * tilt;
      rot.z += 0.55 * tilt;
      rot.x += 0.20 * tilt;
      rot.y -= 0.25 * tilt;

      if (t > 0.4 && t < total - 0.6) {
        pos.y += Math.sin(t * 18) * 0.004 * tilt;
        rot.z += Math.sin(t * 15) * 0.010 * tilt;
      }
    }

    /* --- Инерция --- */
    this.swayCurrent.x += (this.swayTarget.x - this.swayCurrent.x) * Math.min(dt * 9, 1);
    this.swayCurrent.y += (this.swayTarget.y - this.swayCurrent.y) * Math.min(dt * 9, 1);
    this.swayTarget.multiplyScalar(1 - Math.min(dt * 2.2, 1));

    const swayMul = 1 - this.adsAmount * 0.9;
    pos.x += this.swayCurrent.x * swayMul;
    pos.y += this.swayCurrent.y * swayMul;
    rot.y += this.swayCurrent.x * 1.4 * swayMul;
    rot.x += this.swayCurrent.y * 1.4 * swayMul;

    /* --- Ходьба --- */
    const walkSpeed = this.player?.planarSpeed ?? 0;
    const onGround  = this.player?.onGround ?? true;
    const targetBob = onGround ? Math.min(walkSpeed / (this.player?.walkSpeed ?? 4.4), 1.4) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(dt * 8, 1);
    this.bobTime   += dt * (6.0 + walkSpeed * 1.1);
    this.breatheTime += dt;

    const bobMul = 1 - this.adsAmount * 0.92;
    pos.x += Math.sin(this.bobTime) * 0.0125 * this.bobAmount * bobMul;
    pos.y += (Math.abs(Math.cos(this.bobTime)) * 0.0105 * this.bobAmount - 0.004 * this.bobAmount) * bobMul;
    rot.z += Math.sin(this.bobTime) * 0.020 * this.bobAmount * bobMul;
    rot.x += Math.abs(Math.cos(this.bobTime)) * 0.008 * this.bobAmount * bobMul;

    /* --- Дыхание --- */
    const idleAmount = 1 - Math.min(this.bobAmount, 1);
    pos.y += Math.sin(this.breatheTime * 1.35) * 0.0022 * idleAmount;
    pos.x += Math.sin(this.breatheTime * 0.85) * 0.0016 * idleAmount;
    rot.z += Math.sin(this.breatheTime * 1.1) * 0.006 * idleAmount;

    /* --- ADS через ПГО-7 --- */
    const wantAds = this.adsHeld && this.state === 'idle';
    const adsTarget = wantAds ? 1 : 0;
    this.adsAmount += (adsTarget - this.adsAmount) * Math.min(dt * 10, 1);
    if (this.adsAmount < 0.0005) this.adsAmount = 0;
    if (this.adsAmount > 0.9995) this.adsAmount = 1;

    if (this.adsAmount > 0) {
      const a = this.adsAmount;
      pos.lerp(new THREE.Vector3(this.cfg.ADS_POS.x, this.cfg.ADS_POS.y, this.cfg.ADS_POS.z), a);
      rot.x = rot.x * (1 - a) + this.cfg.ADS_ROT.x * a;
      rot.y = rot.y * (1 - a) + this.cfg.ADS_ROT.y * a;
      rot.z = rot.z * (1 - a) + this.cfg.ADS_ROT.z * a;
    }

    /* --- Отдача (пружина) --- */
    const stiff = 220, damp = 17;
    this.kickPosVel.addScaledVector(this.kickPos, -stiff * dt);
    this.kickPosVel.multiplyScalar(Math.max(0, 1 - damp * dt));
    this.kickPos.addScaledVector(this.kickPosVel, dt);

    this.kickRotVel.addScaledVector(this.kickRot, -stiff * dt);
    this.kickRotVel.multiplyScalar(Math.max(0, 1 - damp * dt));
    this.kickRot.addScaledVector(this.kickRotVel, dt);

    pos.add(this.kickPos);
    rot.x += this.kickRot.x;
    rot.y += this.kickRot.y;
    rot.z += this.kickRot.z;

    /* --- Тряска камеры --- */
    this.camShakeVel.multiplyScalar(Math.max(0, 1 - 6 * dt));
    this.camShake.addScaledVector(this.camShakeVel, dt * 0.015);
    this.camShake.multiplyScalar(Math.max(0, 1 - 7 * dt));

    /* --- применяем --- */
    this.weaponRoot.position.copy(pos);
    this.weaponRoot.rotation.set(rot.x, rot.y, rot.z);
  }

  _updateFiring(dt) {
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
  }

  _updateFlash(dt) {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flashGroup.visible = false;
        this.flashLight.intensity = 0;
        this.worldFlashLight.intensity = 0;
      } else {
        this.flashLight.intensity      *= 0.72;
        this.worldFlashLight.intensity *= 0.72;
        this.flashGroup.scale.multiplyScalar(1 + dt * 8);
      }
    }
  }

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

  _applyHudOpacity() {
    if (this._crossEl) {
      this._crossEl.style.opacity = String(1 - this.adsAmount * 0.9);
    }
  }

  /* ========================================================================
     ГЕТТЕРЫ
     ======================================================================== */

  get adsActive() { return this.adsAmount > 0.5; }
  get camShakeOffset() { return this.camShake; }   // добавьте к camera.rotation при апдейте
}

/* ═══════════════════════════════════════════════════════════════════════════
   9 · ПРИМЕР ИСПОЛЬЗОВАНИЯ (закомментировано)

   import * as THREE from 'three';
   import {
     RPG7_CONFIG, createRPG7, createRPGMaterials,
     RPGEffects, WeaponAudio, PlayerController, RPG7Controller
   } from './rpg7.js';

   const scene = new THREE.Scene();
   const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.05, 800);
   const weaponScene = new THREE.Scene();
   const weaponCamera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.01, 30);

   const hittables = [];   // меши, по которым стреляем (взрыв при попадании)
   const colliders = [];   // AABB { min: Vector3, max: Vector3 } для игрока и ракеты

   const player  = new PlayerController({ startPos: { x:0, y:1.7, z:10 }, colliders });
   const audio   = new WeaponAudio(0.6);
   const effects = new RPGEffects(scene, audio, { hittables });

   const rpg = new RPG7Controller({
     weaponScene, weaponCamera, scene, camera,
     player, effects, audio,
     crosshairEl: document.getElementById('cross'),
     onAmmoChange: (a, r) => { /* обновить HUD *\/ },
     onStateMessage: (t, d) => { /* показать сообщение *\/ }
   });
   rpg.mount();

   document.addEventListener('keydown', e => { player.onKeyDown(e.code); rpg.onKeyDown(e.code); });
   document.addEventListener('keyup',   e => { player.onKeyUp(e.code); });
   document.addEventListener('mousemove', e => {
     if (document.pointerLockElement) {
       player.lookSensMult = 1 - rpg.adsAmount * RPG7_CONFIG.MOUSE_ADS_MULT;
       player.look(e.movementX, e.movementY);
       rpg.onMouseMove(e.movementX, e.movementY);
     }
   });
   document.addEventListener('mousedown', e => rpg.onMouseDown(e.button));
   document.addEventListener('mouseup',   e => rpg.onMouseUp(e.button));
   document.addEventListener('contextmenu', e => e.preventDefault());

   const clock = new THREE.Clock();
   (function loop() {
     requestAnimationFrame(loop);
     const dt = Math.min(clock.getDelta(), 0.05);

     player.speedMult = 1 - rpg.adsAmount * RPG7_CONFIG.MOVE_ADS_MULT;
     player.update(dt);
     rpg.update(dt);
     effects.update(dt);

     camera.position.copy(player.pos);
     camera.rotation.set(
       player.pitch + rpg.camShakeOffset.x,
       player.yaw   + rpg.camShakeOffset.y,
       rpg.camShakeOffset.z,
       'YXZ'
     );

     renderer.clear();
     renderer.render(scene, camera);
     renderer.clearDepth();
     renderer.render(weaponScene, weaponCamera);
   })();
   ═══════════════════════════════════════════════════════════════════════════ */