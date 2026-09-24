/* ============================================================================
 * M870 Tactical · Reusable Three.js Module
 * ----------------------------------------------------------------------------
 * Что можно взять по отдельности:
 *   - SHOTGUN_CONFIG         — все числа (позы, тайминги, дробь, отдача)
 *   - createShotgunMaterials() — фабрика материалов
 *   - createShotgun()        — чистая модель (Group 'M870')
 *   - ShotgunEffects         — частицы, дым, гильзы, трассеры, дырки
 *   - WeaponAudio            — процедурный звук (выстрел / помпа / вставка)
 *   - PlayerController       — движение WASD, прыжок, коллизии, обзор
 *   - ShotgunController      — вся механика: выстрел 9-ю дробинами, помпа,
 *                              поштучная перезарядка (прерываемая), осмотр,
 *                              ADS, отдача, вспышка, bloom через коллбэк
 * ----------------------------------------------------------------------------
 * Ориентация модели:   +X = дуло, +Y = вверх, +Z = правая сторона.
 * Для viewmodel:       shotgun.rotation.y = Math.PI/2;
 *                      shotgun.scale.setScalar(SHOTGUN_CONFIG.SCALE);
 * ==========================================================================*/

import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════════════
   1 · КОНФИГ
   ═══════════════════════════════════════════════════════════════════════════ */

export const SHOTGUN_CONFIG = {
  /* --- масштаб и позы viewmodel --- */
  SCALE: 0.012,

  BASE_POS: { x:  0.12, y: -0.13, z: -0.30 },
  BASE_ROT: { x:  0.03, y: -0.06, z:  0.02 },

  /* ADS — без прицела, просто поднимаем и центрируем ствол */
  ADS_POS:  { x: 0,     y: -0.055, z: -0.25 },
  ADS_ROT:  { x: 0,     y: 0,      z:  0    },

  /* Дуло в локальных координатах weaponRoot:
     смещение (0, 1.05, -47.0) в модели умножается на SCALE.
     Значения хранятся в «модельных» единицах. */
  MUZZLE_X:  0,
  MUZZLE_Y:  1.05,
  MUZZLE_Z: -47.0,

  /* --- патроны / тайминги --- */
  MAG_SIZE:         8,
  RESERVE:          32,
  FIRE_TIME:        0.16,
  PUMP_TIME:        0.62,
  RELOAD_SHELL_TIME:0.60,
  INSPECT_DUR:      5.60,
  DRAW_DUR:         0.72,

  /* --- FOV --- */
  MAIN_FOV:              75,
  ADS_FOV_DELTA:        -20,
  WEAPON_FOV:            55,
  WEAPON_ADS_FOV_DELTA: -14,

  /* --- мышь / игрок --- */
  MOUSE_SENS:     0.0022,
  MOUSE_ADS_MULT: 0.45,
  MOVE_ADS_MULT:  0.45,

  /* --- дробь --- */
  PELLETS:          9,
  SPREAD_BASE:      0.020,
  SPREAD_MOVE:      0.020,
  SPREAD_ADS_MULT:  0.45,      // множитель (1 - adsAmount * SPREAD_ADS_MULT)
  DECAL_SCALE:      0.22,
  TRACER_EVERY_NTH: 3,          // трассер на каждую 3-ю дробину

  /* --- отдача --- */
  KICK_POS_Z: 0.14,
  KICK_POS_Y: 0.025,
  KICK_ROT_X: { base: 0.36, rand: 0.12 },
  KICK_ROT_Z: 0.14,
  KICK_ROT_Y: 0.10,
  RECOIL_PITCH: { base: 0.045, rand: 0.015 },
  RECOIL_YAW:   0.010,
  SHAKE: { x: 24, y: 24, z: 14, yBias: 6 },

  /* --- анимация помпы --- */
  PUMP_FORWARD_PHASE: 0.4,      // доля времени помпы, уходящая на «вперёд»
  PUMP_POS_Z: 0.035,
  PUMP_POS_Y: 0.025,
  PUMP_ROT_X: 0.06,
  PUMP_ROT_Z: 0.02,

  /* --- тайминги перезарядки --- */
  RELOAD_TILT_IN:    0.20,
  RELOAD_TILT_OUT:   0.40,      // за сколько секунд до конца наклон уходит

  /* --- вспышка --- */
  FLASH_TIME: 0.08,

  /* --- ключи анимации осмотра --- */
  INSPECT_END: 3.10,
  INSPECT_KEYS: [
    { t: 0.00, p: [ 0.00,  0.00, 0.00], r: [ 0.00,  0.00,  0.00] },
    { t: 0.45, p: [ 0.03,  0.05, 0.06], r: [-0.10,  0.85, -0.75] },
    { t: 1.15, p: [ 0.01,  0.07, 0.10], r: [ 0.05, -0.75,  0.70] },
    { t: 1.85, p: [-0.02,  0.06, 0.04], r: [ 0.55,  0.15,  0.10] },
    { t: 2.45, p: [ 0.00,  0.03, 0.03], r: [ 0.10,  0.05,  0.25] },
    { t: 3.10, p: [ 0.00,  0.00, 0.00], r: [ 0.00,  0.00,  0.00] }
  ]
};

/* ═══════════════════════════════════════════════════════════════════════════
   2 · ПРОЦЕДУРНЫЕ ТЕКСТУРЫ
   ═══════════════════════════════════════════════════════════════════════════ */

export function makeNoiseTexture(size = 256, contrast = 0.28) {
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
  g.addColorStop(0.15, 'rgba(255,240,180,0.95)');
  g.addColorStop(0.42, 'rgba(255,150,50,0.55)');
  g.addColorStop(0.72, 'rgba(255,80,10,0.18)');
  g.addColorStop(1.00, 'rgba(255,50,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeParticleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** След от дроби — крупный, с разлётом и копотью (128×128). */
export function makePelletHoleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);

  const outer = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
  outer.addColorStop(0.00, 'rgba(20,15,10,0.75)');
  outer.addColorStop(0.35, 'rgba(40,35,30,0.55)');
  outer.addColorStop(0.60, 'rgba(80,75,70,0.30)');
  outer.addColorStop(0.85, 'rgba(120,115,110,0.10)');
  outer.addColorStop(1.00, 'rgba(150,145,140,0)');
  ctx.fillStyle = outer;
  ctx.beginPath(); ctx.arc(64, 64, 62, 0, 7); ctx.fill();

  const hole = ctx.createRadialGradient(64, 64, 0, 64, 64, 26);
  hole.addColorStop(0.00, 'rgba(0,0,0,1)');
  hole.addColorStop(0.55, 'rgba(5,5,6,0.98)');
  hole.addColorStop(0.85, 'rgba(20,18,16,0.75)');
  hole.addColorStop(1.00, 'rgba(40,36,32,0)');
  ctx.fillStyle = hole;
  ctx.beginPath(); ctx.arc(64, 64, 26, 0, 7); ctx.fill();

  ctx.fillStyle = 'rgba(15,12,10,0.85)';
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 26 + Math.random() * 30;
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    const sz = 1.5 + Math.random() * 3;
    ctx.beginPath(); ctx.arc(x, y, sz, 0, 7); ctx.fill();
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · МАТЕРИАЛЫ
   ═══════════════════════════════════════════════════════════════════════════ */

const _NOISE = makeNoiseTexture(256, 0.28);
_NOISE.repeat.set(4, 4);

export function createShotgunMaterials() {
  return {
    phosphate: new THREE.MeshStandardMaterial({ color: 0x24282d, metalness: 0.95, roughness: 0.55, roughnessMap: _NOISE }),
    receiver:  new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.94, roughness: 0.58, roughnessMap: _NOISE }),
    steel:     new THREE.MeshStandardMaterial({ color: 0x4d545c, metalness: 1.0,  roughness: 0.48, roughnessMap: _NOISE }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x1e2126, metalness: 1.0,  roughness: 0.55, roughnessMap: _NOISE }),
    blackMetal:new THREE.MeshStandardMaterial({ color: 0x15181c, metalness: 0.88, roughness: 0.60, roughnessMap: _NOISE }),
    polymer:   new THREE.MeshStandardMaterial({ color: 0x16181b, metalness: 0.06, roughness: 0.62 }),
    polymerMatte: new THREE.MeshStandardMaterial({ color: 0x0f1113, metalness: 0.03, roughness: 0.85 }),
    brass:     new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 1.0,  roughness: 0.35 }),
    shellRed:  new THREE.MeshStandardMaterial({ color: 0xa01e1a, metalness: 0.1,  roughness: 0.55 })
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · МОДЕЛЬ M870 TACTICAL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Строит полную модель дробовика.
 * @param {object} [materials] — результат createShotgunMaterials()
 * @returns {THREE.Group} — группа с именем 'M870'
 */
export function createShotgun(materials) {
  const MAT = materials || createShotgunMaterials();
  const gun = new THREE.Group();
  gun.name = 'M870';

  const boxG = (w,h,d) => new THREE.BoxGeometry(w,h,d);
  function mesh(geo, mat, x=0,y=0,z=0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    gun.add(m);
    return m;
  }
  function box(w,h,d,mat,x=0,y=0,z=0){ return mesh(boxG(w,h,d), mat, x,y,z); }
  function cyl(r1,r2,h,seg,mat,x=0,y=0,z=0,axis='x') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,seg), mat);
    if (axis==='x') m.rotation.z = Math.PI/2;
    if (axis==='z') m.rotation.x = Math.PI/2;
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    gun.add(m);
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
    gun.add(m);
    return m;
  }

  /* ---------- РЕСИВЕР ---------- */
  box(20, 4.2, 3.3, MAT.receiver, -2, 0, 0);
  box(1.2, 4.4, 3.4, MAT.receiver, 7.7, 0, 0);
  box(1.0, 4.6, 3.5, MAT.receiver, -12, -0.1, 0);

  box(5.0, 1.9, 0.35, MAT.blackMetal, 1.2, 0.3, 1.62);
  box(5.6, 0.35, 0.4, MAT.steelDark, 1.2, 1.35, 1.68);
  box(5.6, 0.35, 0.4, MAT.steelDark, 1.2, -0.75, 1.68);

  box(4.5, 0.3, 1.6, MAT.blackMetal, -3.5, -2.15, 0);
  box(4.9, 0.4, 0.4, MAT.steelDark, -3.5, -2.15, 1.0);
  box(4.9, 0.4, 0.4, MAT.steelDark, -3.5, -2.15, -1.0);

  for (const rx of [-10.5, -7.5, 4.5, 6.8]) {
    cyl(0.18, 0.18, 3.5, 10, MAT.steelDark, rx, -1.6, 0, 'z');
  }

  box(3.5, 0.8, 0.06, MAT.steelDark, -6.5, 0.2, 1.68);
  box(2.4, 0.12, 0.05, MAT.blackMetal, -6.5, 0.4, 1.72);
  box(1.8, 0.1, 0.05, MAT.blackMetal, -6.5, 0.1, 1.72);

  /* ---------- СТВОЛ ---------- */
  cyl(1.0, 1.0, 39, 28, MAT.phosphate, 27.5, 1.05, 0, 'x');
  cyl(1.15, 1.15, 2.2, 28, MAT.phosphate, 45.8, 1.05, 0, 'x');
  cyl(1.18, 1.18, 0.4, 28, MAT.steelDark, 46.9, 1.05, 0, 'x');
  cyl(0.85, 0.85, 0.35, 24, MAT.blackMetal, 47.0, 1.05, 0, 'x');

  box(1.6, 4.6, 3.0, MAT.phosphate, 41.5, -0.2, 0);
  box(1.8, 0.5, 3.2, MAT.steelDark, 41.5, 2.0, 0);
  box(1.8, 0.5, 3.2, MAT.steelDark, 41.5, -2.15, 0);

  /* ---------- ТРУБЧАТЫЙ МАГАЗИН ---------- */
  cyl(0.9, 0.9, 34, 24, MAT.phosphate, 25, -1.3, 0, 'x');
  cyl(1.05, 1.05, 1.6, 24, MAT.receiver, 8.5, -1.3, 0, 'x');
  cyl(1.0, 1.0, 1.4, 24, MAT.phosphate, 42.5, -1.3, 0, 'x');
  cyl(0.95, 0.95, 0.5, 24, MAT.steelDark, 43.4, -1.3, 0, 'x');

  const frontSling = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.13, 8, 18), MAT.steelDark);
  frontSling.position.set(42.9, -2.3, 0);
  frontSling.rotation.y = Math.PI/2;
  frontSling.castShadow = true; frontSling.receiveShadow = true;
  gun.add(frontSling);

  /* ---------- ТЕПЛОЗАЩИТНЫЙ КОЖУХ ---------- */
  box(20, 0.4, 2.3, MAT.steelDark, 26, 2.1, 0);
  for (let i=0; i<9; i++) {
    box(0.9, 0.5, 2.5, MAT.blackMetal, 17.0 + i*2.1, 2.1, 0);
  }
  box(1.4, 0.7, 2.5, MAT.phosphate, 16.5, 1.9, 0);
  box(1.4, 0.7, 2.5, MAT.phosphate, 35.5, 1.9, 0);

  /* ---------- ЦЕВЬЁ (PUMP FOREND) ---------- */
  /* Именуем группу — контроллер анимирует её вдоль X (в локальных
     координатах оружия) для движения помпы при перезарядке/выстреле. */
  const forendGroup = new THREE.Group();
  forendGroup.name = 'forend';
  gun.add(forendGroup);

  const forendMesh = extrudeSide([
    [12.5, -2.3], [27.5, -2.3], [27.5, 0.3], [12.5, 0.3]
  ], 3.6, MAT.polymer, 0.2);
  gun.remove(forendMesh);
  forendGroup.add(forendMesh);

  for (let i=0; i<6; i++) {
    const m1 = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.25, 0.35), MAT.polymerMatte);
    m1.position.set(20, -1.9 + i*0.42, 1.85);
    m1.castShadow = true; m1.receiveShadow = true;
    forendGroup.add(m1);
    const m2 = m1.clone();
    m2.position.z = -1.85;
    forendGroup.add(m2);
  }
  for (let i=0; i<8; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.4, 3.7), MAT.polymerMatte);
    m.position.set(13.5 + i*1.8, -1.0, 0);
    m.castShadow = true; m.receiveShadow = true;
    forendGroup.add(m);
  }
  {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.8, 3.8), MAT.polymerMatte);
    m.position.set(12.7, -1.0, 0);
    m.castShadow = true; m.receiveShadow = true;
    forendGroup.add(m);
    const m2 = m.clone();
    m2.position.x = 27.3;
    forendGroup.add(m2);
  }

  /* ---------- ПРИКЛАД ---------- */
  extrudeSide([
    [-12.0, 2.0], [-20.0, 1.9], [-28.0, 1.4], [-32.5, 0.7],
    [-33.5, -3.5], [-33.0, -6.5], [-26.0, -6.0], [-18.0, -5.2], [-12.0, -2.3]
  ], 3.2, MAT.polymer);

  const buttpad = box(1.2, 7.4, 3.4, MAT.polymerMatte, -34.1, -2.9, 0);
  buttpad.rotation.z = -0.09;
  for (let i=0; i<5; i++) {
    box(0.3, 7.0, 0.4, MAT.polymer, -34.4, -2.9, -1.5 + i*0.75);
  }

  const cheek = box(11.0, 0.9, 3.0, MAT.polymerMatte, -24.0, 1.7, 0);
  cheek.rotation.z = -0.06;
  cyl(0.22, 0.22, 3.2, 10, MAT.steelDark, -20.0, 1.7, 0, 'z');
  cyl(0.22, 0.22, 3.2, 10, MAT.steelDark, -28.0, 1.7, 0, 'z');

  const rearSling = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.15, 8, 18), MAT.steelDark);
  rearSling.position.set(-30.0, -6.6, 0);
  rearSling.rotation.y = Math.PI/2;
  rearSling.castShadow = true; rearSling.receiveShadow = true;
  gun.add(rearSling);

  /* ---------- ПИСТОЛЕТНАЯ РУКОЯТКА ---------- */
  extrudeSide([
    [-6.5, -2.3], [-10.5, -2.3], [-13.0, -9.8], [-9.5, -11.0]
  ], 3.0, MAT.polymerMatte);

  for (let i=0; i<5; i++) {
    const t = i/5;
    const gx = -8.0 - t*3.0;
    const gy = -4.0 - t*5.5;
    const rg = box(0.35, 1.7, 3.15, MAT.polymer, gx, gy, 0);
    rg.rotation.z = -0.4;
  }

  /* ---------- СПУСКОВАЯ СКОБА ---------- */
  box(5.8, 0.5, 1.9, MAT.steelDark, -5.6, -6.35, 0);
  box(0.55, 4.6, 1.9, MAT.steelDark, -2.95, -4.4, 0);
  box(0.55, 4.4, 1.9, MAT.steelDark, -8.25, -4.5, 0);
  box(7.2, 0.5, 2.2, MAT.receiver, -5.6, -2.25, 0);

  const trigger = box(0.55, 2.1, 0.85, MAT.steel, -5.5, -5.0, 0);
  trigger.rotation.z = 0.20;

  cyl(0.35, 0.35, 0.6, 14, MAT.steel, -3.6, -3.9, 0, 'z');
  box(0.5, 0.6, 0.35, MAT.steelDark, -3.6, -3.9, 0.55);
  box(0.8, 0.6, 1.4, MAT.steelDark, -2.2, -3.2, 0);

  /* ---------- МУШКА ---------- */
  box(1.2, 0.6, 1.4, MAT.steelDark, 44.0, 2.2, 0);
  cyl(0.2, 0.2, 1.3, 10, MAT.steel, 44.0, 3.0, 0, 'y');
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), MAT.steelDark);
  bead.position.set(44.0, 3.6, 0);
  bead.castShadow = true;
  gun.add(bead);

  /* ---------- ДЕТАЛИ ---------- */
  box(15.5, 0.35, 0.3, MAT.steelDark, 20, -0.6, 1.95);
  box(15.5, 0.35, 0.3, MAT.steelDark, 20, -0.6, -1.95);
  box(1.0, 0.7, 1.2, MAT.steelDark, -0.5, -2.8, 0);

  return gun;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · ЭФФЕКТЫ
   ═══════════════════════════════════════════════════════════════════════════ */

export class ShotgunEffects {
  constructor(scene, audio, opts = {}) {
    this.scene = scene;
    this.audio = audio || null;
    this.maxParticles = opts.maxParticles ?? 3500;
    this.maxDecals    = opts.maxDecals    ?? 200;
    this.maxCasings   = opts.maxCasings   ?? 60;

    /* --- частицы --- */
    this.pPositions = new Float32Array(this.maxParticles * 3);
    this.pColors    = new Float32Array(this.maxParticles * 3);
    this.pSizes     = new Float32Array(this.maxParticles);
    this.pData = [];
    for (let i=0; i<this.maxParticles; i++) {
      this.pData.push({ life: 0, maxLife: 1, vel: new THREE.Vector3(), base: new THREE.Color(), grav: 1, size: 0.1 });
      this.pSizes[i] = 0.1;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPositions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pColors, 3));
    pGeo.setAttribute('size', new THREE.BufferAttribute(this.pSizes, 1));
    this.pGeo = pGeo;

    this.pointsMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: makeParticleTexture() } },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * 300.0 / -mvPos.z;
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

    /* --- дырки от дроби --- */
    const decalMat = new THREE.MeshBasicMaterial({
      map: makePelletHoleTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8, toneMapped: false
    });
    this.decalMat = decalMat;
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decals = [];
    this.decalCursor = 0;
    for (let i=0; i<this.maxDecals; i++) {
      const m = new THREE.Mesh(this.decalGeo, decalMat);
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.decals.push(m);
    }

    /* --- гильзы (две части: латунь + красный корпус) --- */
    this.casings = [];
    this.casingBrassMat = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 1.0, roughness: 0.35 });
    this.casingRedMat   = new THREE.MeshStandardMaterial({ color: 0xa01e1a, metalness: 0.1, roughness: 0.55 });

    /* --- трассеры --- */
    this.tracers = [];
    this.tracerGeo = new THREE.CylinderGeometry(0.005, 0.005, 1, 6, 1, true);
    this.tracerGeo.translate(0, 0.5, 0);
    this.tracerGeo.rotateX(Math.PI/2);
  }

  /* ====== частицы ====== */
  spawnParticle(pos, vel, color, life, grav = 1, size = 0.1) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % this.maxParticles;
    const d = this.pData[i];
    d.life = life; d.maxLife = life;
    d.vel.copy(vel);
    d.base.set(color);
    d.grav = grav;
    d.size = size;
    this.pPositions[i*3]   = pos.x;
    this.pPositions[i*3+1] = pos.y;
    this.pPositions[i*3+2] = pos.z;
    this.pColors[i*3]   = d.base.r;
    this.pColors[i*3+1] = d.base.g;
    this.pColors[i*3+2] = d.base.b;
    this.pSizes[i] = size;
  }

  /* ====== след от дроби ====== */
  addDecal(point, normal, scale = 0.22) {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.maxDecals;
    d.visible = true;
    d.position.copy(point).addScaledVector(normal, 0.008);
    d.lookAt(point.clone().add(normal));
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(scale * (0.8 + Math.random() * 0.5));
  }

  /* ====== гильза (латунь + красный корпус) ====== */
  spawnCasing(worldPos, baseVel) {
    const grp = new THREE.Group();
    const brass = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 12), this.casingBrassMat);
    brass.position.y = -0.012;
    brass.castShadow = true;
    grp.add(brass);

    const red = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.028, 12), this.casingRedMat);
    red.position.y = 0.012;
    red.castShadow = true;
    grp.add(red);

    grp.position.copy(worldPos);
    grp.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
    this.scene.add(grp);

    this.casings.push({
      obj: grp,
      vel: baseVel.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 1.2,
        1.6 + Math.random() * 1.0,
        (Math.random() - 0.5) * 1.2
      )),
      spin: new THREE.Vector3(
        (Math.random()-0.5)*30, (Math.random()-0.5)*30, (Math.random()-0.5)*30
      ),
      life: 60, bounced: 0, sfxDone: false
    });
    if (this.casings.length > this.maxCasings) {
      const old = this.casings.shift();
      this.scene.remove(old.obj);
    }
  }

  /* ====== трассер ====== */
  spawnTracer(from, to) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe0a0, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    });
    const m = new THREE.Mesh(this.tracerGeo, mat);
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, from.distanceTo(to));
    this.scene.add(m);
    this.tracers.push({ obj: m, mat, life: 0.035 });
  }

  /* ====== облако дыма (плотное, многослойное) ====== */
  spawnSmokeCloud(worldPos, dir, count = 45) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.3;
      const p = worldPos.clone();
      p.x += Math.cos(angle) * r;
      p.y += (Math.random() - 0.3) * 0.2;
      p.z += Math.sin(angle) * r;

      const vel = dir.clone().multiplyScalar(1.5 + Math.random() * 2.5);
      vel.x += (Math.random() - 0.5) * 2.0;
      vel.y += (Math.random() - 0.2) * 1.5 + 0.4;
      vel.z += (Math.random() - 0.5) * 2.0;

      this.spawnParticle(p, vel, 0xc8c0b0, 1.6 + Math.random() * 1.2, 0.08, 0.42);
    }
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
      sz[i] = d.size * (0.3 + t * 0.7);
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    this.pGeo.attributes.size.needsUpdate = true;

    /* --- гильзы --- */
    for (let i=this.casings.length-1; i>=0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      if (c.life <= 0) { this.scene.remove(c.obj); this.casings.splice(i, 1); continue; }
      c.vel.y -= 12 * dt;
      c.obj.position.addScaledVector(c.vel, dt);
      c.obj.rotation.x += c.spin.x * dt;
      c.obj.rotation.y += c.spin.y * dt;
      c.obj.rotation.z += c.spin.z * dt;
      if (c.obj.position.y < 0.015) {
        c.obj.position.y = 0.015;
        if (!c.sfxDone && c.bounced === 0 && Math.abs(c.vel.y) > 1) {
          c.sfxDone = true;
          this.audio?.casingBounce();
        }
        c.vel.y *= -0.32;
        c.vel.x *= 0.62; c.vel.z *= 0.62;
        c.spin.multiplyScalar(0.5);
        if (c.bounced++ > 3) { c.vel.set(0,0,0); c.spin.set(0,0,0); }
      }
    }

    /* --- трассеры --- */
    for (let i=this.tracers.length-1; i>=0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.mat.opacity = Math.max(t.life / 0.035, 0) * 0.75;
      if (t.life <= 0) {
        this.scene.remove(t.obj); t.mat.dispose(); this.tracers.splice(i, 1);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · ЗВУК
   ═══════════════════════════════════════════════════════════════════════════ */

export class WeaponAudio {
  constructor(masterVolume = 0.55) {
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
      const len = Math.floor(this.actx.sampleRate * 1.5);
      this.noiseBuf = this.actx.createBuffer(1, len, this.actx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i=0; i<len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { /* Audio недоступен */ }
  }

  resume() {
    if (this.actx && this.actx.state === 'suspended') this.actx.resume();
  }

  /* --- выстрел дробовика --- */
  blast() {
    if (!this.actx) return;
    const t = this.actx.currentTime;

    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = this.actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
    const lp = this.actx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.35);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(1.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.masterGain);
    src.start(t); src.stop(t + 0.6);

    const o = this.actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const og = this.actx.createGain();
    og.gain.setValueAtTime(1.1, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(og); og.connect(this.masterGain);
    o.start(t); o.stop(t + 0.4);

    const src2 = this.actx.createBufferSource(); src2.buffer = this.noiseBuf;
    const bp = this.actx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 800; bp.Q.value = 0.6;
    const g2 = this.actx.createGain();
    g2.gain.setValueAtTime(0.0001, t + 0.05);
    g2.gain.linearRampToValueAtTime(0.14, t + 0.12);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    src2.connect(bp); bp.connect(g2); g2.connect(this.masterGain);
    src2.start(t); src2.stop(t + 1.5);
  }

  /* --- помпа: два клика + шорох --- */
  pump() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    for (let i = 0; i < 2; i++) {
      const dt = i * 0.13;
      const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = this.actx.createBiquadFilter(); f.type = 'bandpass';
      f.frequency.value = 1600 + i * 600; f.Q.value = 6;
      const g = this.actx.createGain();
      g.gain.setValueAtTime(0.4, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.06);
      src.connect(f); f.connect(g); g.connect(this.masterGain);
      src.start(t + dt); src.stop(t + dt + 0.08);
    }

    const src3 = this.actx.createBufferSource(); src3.buffer = this.noiseBuf;
    const bp3 = this.actx.createBiquadFilter(); bp3.type = 'bandpass';
    bp3.frequency.value = 900; bp3.Q.value = 1.2;
    const g3 = this.actx.createGain();
    g3.gain.setValueAtTime(0.0001, t);
    g3.gain.linearRampToValueAtTime(0.12, t + 0.03);
    g3.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src3.connect(bp3); bp3.connect(g3); g3.connect(this.masterGain);
    src3.start(t); src3.stop(t + 0.25);
  }

  /* --- вставка патрона --- */
  shellInsert() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.actx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = 2200; f.Q.value = 5;
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(f); f.connect(g); g.connect(this.masterGain);
    src.start(t); src.stop(t + 0.08);

    const o = this.actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(280, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.06);
    const og = this.actx.createGain();
    og.gain.setValueAtTime(0.15, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(og); og.connect(this.masterGain);
    o.start(t); o.stop(t + 0.1);
  }

  /* --- выброс гильзы --- */
  shellEject() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(1600, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.1);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g); g.connect(this.masterGain);
    o.start(t); o.stop(t + 0.18);
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

  casingBounce() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(2200, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.06);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g); g.connect(this.masterGain);
    o.start(t); o.stop(t + 0.1);
  }

  impact() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(1800 + Math.random() * 800, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.07);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.10, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.10);
    o.connect(g); g.connect(this.masterGain);
    o.start(t); o.stop(t + 0.11);
  }

  ping() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    [1500, 2250, 3000].forEach((f, i) => {
      const o = this.actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.actx.createGain();
      g.gain.setValueAtTime(0.10 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.0003, t + 0.5 + i * 0.1);
      o.connect(g); g.connect(this.masterGain);
      o.start(t); o.stop(t + 0.55);
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   7 · КОНТРОЛЛЕР ИГРОКА (идентичен предыдущим модулям)
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

    this.mouseSensitivity = opts.mouseSensitivity ?? SHOTGUN_CONFIG.MOUSE_SENS;
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
   8 · КОНТРОЛЛЕР SHOTGUN
   ═══════════════════════════════════════════════════════════════════════════ */

const _smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _easeOutCubic = x => 1 - Math.pow(1 - x, 3);

export class ShotgunController {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.weaponScene
   * @param {THREE.Camera} opts.weaponCamera
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {PlayerController} opts.player
   * @param {Array} [opts.hittables]
   * @param {Array} [opts.colliders]
   * @param {ShotgunEffects} [opts.effects]
   * @param {WeaponAudio} [opts.audio]
   * @param {HTMLElement} [opts.crosshairEl]
   * @param {Function} [opts.onAmmoChange]
   * @param {Function} [opts.onStateMessage]
   * @param {Function} [opts.onBloomStrength]   — (value) => void
   */
  constructor(opts) {
    this.opts = opts;
    this.weaponScene  = opts.weaponScene;
    this.weaponCamera = opts.weaponCamera;
    this.scene        = opts.scene;
    this.camera       = opts.camera;
    this.player       = opts.player;
    this.hittables    = opts.hittables || [];
    this.colliders    = opts.colliders || [];
    this.effects      = opts.effects || null;
    this.audio        = opts.audio   || null;

    this._crossEl        = opts.crosshairEl    || null;
    this._onAmmoChange   = opts.onAmmoChange   || null;
    this._onStateMessage = opts.onStateMessage || null;
    this._onBloomStrength= opts.onBloomStrength|| null;

    /* --- конфиг --- */
    this.cfg = Object.assign({}, SHOTGUN_CONFIG, opts.config || {});

    /* --- модель --- */
    this.weaponRoot = new THREE.Group();
    this.weaponRoot.rotation.order = 'YXZ';
    this.weaponRoot.visible = false;

    const materials = opts.materials || createShotgunMaterials();
    this.materials = materials;
    this.shotgun = createShotgun(materials);
    this.shotgun.rotation.y = Math.PI / 2;
    this.shotgun.scale.setScalar(this.cfg.SCALE);
    this.weaponRoot.add(this.shotgun);

    this.forendGroup = this.shotgun.getObjectByName('forend');
    this.muzzle = new THREE.Vector3(
      this.cfg.MUZZLE_X * this.cfg.SCALE,
      this.cfg.MUZZLE_Y * this.cfg.SCALE,
      this.cfg.MUZZLE_Z * this.cfg.SCALE
    );

    /* --- состояние --- */
    this.state        = 'holstered';
    this.time         = 0;
    this.ammo         = this.cfg.MAG_SIZE;
    this.reserve      = this.cfg.RESERVE;
    this.fireCooldown = 0;
    this.adsHeld      = false;
    this.adsAmount    = 0;

    /* --- поштучная перезарядка --- */
    this._reload = {
      shellsToInsert: 0,
      inserted: 0
    };

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

    this.pumpPos = new THREE.Vector3();
    this.pumpRot = new THREE.Vector3();

    this.inspectOffsetPos = new THREE.Vector3();
    this.inspectOffsetRot = new THREE.Vector3();
    this.inspectOffsetActive = false;

    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 300;

    this._buildMuzzleFlash();
  }

  _buildMuzzleFlash() {
    const flashGroup = new THREE.Group();
    flashGroup.position.copy(this.muzzle);
    flashGroup.visible = false;
    this.weaponRoot.add(flashGroup);
    this.flashGroup = flashGroup;

    const flashMat = new THREE.MeshBasicMaterial({
      map: makeFlashTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false
    });
    flashGroup.add(new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), flashMat));
    const fq2 = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), flashMat);
    fq2.rotation.z = Math.PI/4;
    flashGroup.add(fq2);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.5, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb050, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
        depthTest: false, toneMapped: false
      })
    );
    cone.rotation.x = -Math.PI/2;
    cone.position.z = -0.24;
    flashGroup.add(cone);

    const flashLight = new THREE.PointLight(0xffb060, 0, 5, 2);
    flashLight.position.copy(this.muzzle);
    this.weaponRoot.add(flashLight);
    this.flashLight = flashLight;

    const worldLight = new THREE.PointLight(0xffb060, 0, 22, 2);
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
      if (this.state === 'reloading')  { this.cancelReload(); return; }
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
      this.audio.click(0.25, 900, 0.07);
      setTimeout(() => this.audio?.click(0.2, 1600, 0.05), 260);
      setTimeout(() => this.audio?.click(0.18, 2200, 0.04), 480);
    }
  }

  cancelInspect() {
    if (this.state === 'inspecting') { this.state = 'idle'; this.time = 0; }
  }

  cancelReload() {
    if (this.state === 'reloading') {
      this.state = 'idle';
      this.audio?.click(0.25, 700, 0.07);
    }
  }

  tryReload() {
    if (this.state === 'inspecting') this.cancelInspect();
    if (this.state === 'reloading') { this.cancelReload(); return; }
    if (this.state !== 'idle') return;
    if (this.ammo >= this.cfg.MAG_SIZE) return;
    if (this.reserve <= 0) { this.setStateMessage('НЕТ ПАТРОНОВ'); return; }

    this.state = 'reloading';
    this.time  = 0;
    this._reload.shellsToInsert = Math.min(this.cfg.MAG_SIZE - this.ammo, this.reserve);
    this._reload.inserted = 0;
    this.audio?.click(0.3, 1000, 0.05);
  }

  tryInspect() {
    if (this.state === 'inspecting') { this.cancelInspect(); return; }
    if (this.state !== 'idle') return;
    this.state = 'inspecting';
    this.time  = 0;
    this.audio?.click(0.15, 700, 0.09);
  }

  /* ========================================================================
     ВЫСТРЕЛ ДРОБЬЮ
     ======================================================================== */

  tryFire() {
    if (this.state !== 'idle') return;
    if (this.fireCooldown > 0) return;
    if (this.ammo <= 0) {
      this.audio?.click(0.22, 2600, 0.04);
      this.fireCooldown = 0.4;
      this.setStateMessage('ПЕРЕЗАРЯДКА [R]');
      return;
    }

    this.ammo--;
    this._emitAmmo();
    this.state = 'firing';
    this.time  = 0;
    this.fireCooldown = this.cfg.FIRE_TIME + this.cfg.PUMP_TIME;

    /* --- базовое направление --- */
    const baseDir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
    );

    /* --- мировые координаты дула --- */
    this.weaponRoot.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld(true);
    const muzzleCam = this.muzzle.clone().applyMatrix4(this.weaponRoot.matrixWorld);
    const muzzleWorld = muzzleCam.clone().applyMatrix4(this.camera.matrixWorld);

    /* --- вспышка --- */
    this.flashGroup.visible = true;
    this.flashGroup.rotation.z = Math.random() * Math.PI * 2;
    this.flashGroup.scale.setScalar(1.2 + Math.random() * 0.6);
    this.flashLight.intensity = 14 + Math.random() * 6;
    this.worldFlashLight.position.copy(muzzleWorld);
    this.worldFlashLight.intensity = 90;
    this.flashTimer = this.cfg.FLASH_TIME;

    /* --- разброс --- */
    const moveFactor = Math.min(this.player.planarSpeed / this.player.walkSpeed, 1.4);
    const spreadBase = this.cfg.SPREAD_BASE + moveFactor * this.cfg.SPREAD_MOVE;
    const spread = spreadBase * (1 - this.adsAmount * this.cfg.SPREAD_ADS_MULT);

    /* --- дробь --- */
    const PELLETS = this.cfg.PELLETS;
    const TRACER_NTH = this.cfg.TRACER_EVERY_NTH;
    let hitCount = 0;

    for (let i = 0; i < PELLETS; i++) {
      const pelletDir = baseDir.clone();
      const ang = Math.random() * Math.PI * 2;
      const mag = Math.random() * spread;
      const upV = new THREE.Vector3(0, 1, 0);
      const rightV = new THREE.Vector3().crossVectors(pelletDir, upV).normalize();
      const trueUp = new THREE.Vector3().crossVectors(rightV, pelletDir).normalize();
      pelletDir.addScaledVector(rightV, Math.cos(ang) * mag)
               .addScaledVector(trueUp, Math.sin(ang) * mag)
               .normalize();

      this._raycaster.set(this.camera.position.clone(), pelletDir);
      const hits = this._raycaster.intersectObjects(this.hittables, false);

      let endPoint, hitInfo = null;
      if (hits.length > 0) {
        hitInfo = hits[0];
        endPoint = hitInfo.point.clone();
        hitCount++;
      } else {
        endPoint = this.camera.position.clone().addScaledVector(pelletDir, 150);
      }

      if (i % TRACER_NTH === 0) this.effects?.spawnTracer(muzzleWorld, endPoint);

      if (hitInfo && this.effects) {
        const n = hitInfo.face
          ? hitInfo.face.normal.clone().transformDirection(hitInfo.object.matrixWorld)
          : pelletDir.clone().negate();

        this.effects.addDecal(hitInfo.point, n, this.cfg.DECAL_SCALE);

        for (let s = 0; s < 4; s++) {
          const v = n.clone().multiplyScalar(1.5 + Math.random() * 2.2)
            .add(new THREE.Vector3(
              (Math.random() - 0.5) * 3.0,
              Math.random() * 2.2,
              (Math.random() - 0.5) * 3.0
            ));
          this.effects.spawnParticle(hitInfo.point, v, 0xffc060, 0.25 + Math.random() * 0.3, 1.2, 0.10);
        }
        for (let s = 0; s < 3; s++) {
          const v = n.clone().multiplyScalar(0.6)
            .add(new THREE.Vector3(
              (Math.random() - 0.5) * 1.5,
              Math.random() * 1.0,
              (Math.random() - 0.5) * 1.5
            ));
          this.effects.spawnParticle(hitInfo.point, v, 0x8a8f96, 0.4 + Math.random() * 0.4, 0.2, 0.20);
        }

        if (this.audio) {
          if (hitInfo.object?.userData?.isPlate) this.audio.ping();
          else this.audio.impact();
        }
      }
    }

    /* --- плотный дым от выстрела --- */
    this.effects?.spawnSmokeCloud(muzzleWorld, baseDir);

    /* --- отдача --- */
    this.kickPos.z += this.cfg.KICK_POS_Z;
    this.kickPos.y += this.cfg.KICK_POS_Y;
    this.kickRot.x += this.cfg.KICK_ROT_X.base + Math.random() * this.cfg.KICK_ROT_X.rand;
    this.kickRot.z += (Math.random() - 0.5) * this.cfg.KICK_ROT_Z;
    this.kickRot.y += (Math.random() - 0.5) * this.cfg.KICK_ROT_Y;

    this.player.pitch += this.cfg.RECOIL_PITCH.base + Math.random() * this.cfg.RECOIL_PITCH.rand;
    this.player.yaw   += (Math.random() - 0.5) * this.cfg.RECOIL_YAW;
    this.player.pitch = Math.max(-this.player.pitchLimit,
                        Math.min(this.player.pitchLimit, this.player.pitch));

    const S = this.cfg.SHAKE;
    this.camShakeVel.x += (Math.random() - 0.5) * S.x;
    this.camShakeVel.y += (Math.random() - 0.5) * S.y + S.yBias;
    this.camShakeVel.z += (Math.random() - 0.5) * S.z;

    /* --- выброс гильзы --- */
    const ejectLocal = new THREE.Vector3(0.0194, 0.0036, -0.0144);
    const ejectCam = ejectLocal.clone().applyMatrix4(this.weaponRoot.matrixWorld);
    const ejectWorld = ejectCam.clone().applyMatrix4(this.camera.matrixWorld);
    const ejectDir = new THREE.Vector3(1, 0, 0).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
    );
    this.effects?.spawnCasing(ejectWorld, ejectDir.multiplyScalar(3.5));
    this.audio?.shellEject();

    this.audio?.blast();

    /* --- подсветка прицела --- */
    if (hitCount > 0 && this._crossEl) {
      this._crossEl.classList.add('hit');
      clearTimeout(this._hitT);
      this._hitT = setTimeout(() => this._crossEl.classList.remove('hit'), 110);
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
    this._updateWeapon(dt);
    this._updateFlash(dt);
    this._applyToCamera();
    this._applyHud();

    if (this._onBloomStrength) {
      /* у дробовика нет нагрева — bloom стабильный, но коллбэк
         оставлен для единообразия API */
      this._onBloomStrength(0.70);
    }
  }

  /* ---------- машина состояний ---------- */
  _updateState(dt) {
    if (this.state === 'drawing') {
      this.time += dt;
      if (this.time / this.cfg.DRAW_DUR >= 1) { this.state = 'idle'; this.time = 0; }
    } else if (this.state === 'inspecting') {
      this.time += dt;
      if (this.time >= this.cfg.INSPECT_DUR) { this.state = 'idle'; this.time = 0; }
    }
    /* 'firing', 'pumping', 'reloading' обрабатываются внутри _updateWeapon,
       т.к. они тесно связаны с анимацией. */
  }

  /* ---------- вся анимация: базовые слои + состояния ---------- */
  _updateWeapon(dt) {
    const pos = new THREE.Vector3(this.cfg.BASE_POS.x, this.cfg.BASE_POS.y, this.cfg.BASE_POS.z);
    const rot = new THREE.Vector3(this.cfg.BASE_ROT.x, this.cfg.BASE_ROT.y, this.cfg.BASE_ROT.z);

    /* --- Доставание --- */
    if (this.state === 'drawing') {
      const t = Math.min(this.time / this.cfg.DRAW_DUR, 1);
      const k = 1 - _easeOutCubic(t);
      pos.y -= k * 0.60;
      pos.z += k * 0.14;
      rot.x -= k * 1.15;
      rot.z += k * 0.42;
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

    /* --- Firing: короткая пауза перед помпой --- */
    if (this.state === 'firing') {
      this.time += dt;
      if (this.time >= this.cfg.FIRE_TIME) {
        this.state = 'pumping';
        this.time = 0;
        this.audio?.pump();
      }
    }

    /* --- Pumping: движение цевья + отдача всего оружия --- */
    if (this.state === 'pumping') {
      this.time += dt;
      const t = Math.min(this.time / this.cfg.PUMP_TIME, 1);
      const phase = t < this.cfg.PUMP_FORWARD_PHASE
        ? t / this.cfg.PUMP_FORWARD_PHASE
        : 1 - (t - this.cfg.PUMP_FORWARD_PHASE) / (1 - this.cfg.PUMP_FORWARD_PHASE);

      this.pumpPos.z = phase * this.cfg.PUMP_POS_Z;
      this.pumpPos.y = -phase * this.cfg.PUMP_POS_Y;
      this.pumpRot.x = phase * this.cfg.PUMP_ROT_X;
      this.pumpRot.z = Math.sin(t * Math.PI * 2) * this.cfg.PUMP_ROT_Z;

      pos.add(this.pumpPos);
      rot.x += this.pumpRot.x;
      rot.z += this.pumpRot.z;

      /* Движение самого цевья в модели */
      if (this.forendGroup) {
        this.forendGroup.position.x = phase * 3.2;
      }

      if (t >= 1) {
        this.state = 'idle';
        this.time = 0;
        if (this.forendGroup) this.forendGroup.position.x = 0;
      }
    } else if (this.forendGroup) {
      this.forendGroup.position.x *= Math.max(0, 1 - dt * 8);
    }

    /* --- Reloading: поштучная вставка --- */
    if (this.state === 'reloading') {
      this.time += dt;
      const shellDur = this.cfg.RELOAD_SHELL_TIME;
      const totalDur = this._reload.shellsToInsert * shellDur;

      const tiltIn  = _smoothstep(0.0, this.cfg.RELOAD_TILT_IN, this.time);
      const tiltOut = 1 - _smoothstep(
        totalDur - this.cfg.RELOAD_TILT_OUT, totalDur, this.time
      );
      const tilt = tiltIn * tiltOut;

      pos.z += 0.04 * tilt;
      pos.y -= 0.06 * tilt;
      pos.x -= 0.02 * tilt;
      rot.z += 0.55 * tilt;
      rot.x += 0.18 * tilt;
      rot.y -= 0.30 * tilt;

      const currentShellIdx = Math.min(
        Math.floor(this.time / shellDur),
        this._reload.shellsToInsert
      );
      if (currentShellIdx > this._reload.inserted) {
        this._reload.inserted = currentShellIdx;
        this.ammo += 1;
        this.reserve -= 1;
        this._emitAmmo();
        this.audio?.shellInsert();
      }

      if (this.time >= totalDur) {
        this.state = 'idle';
        this.time  = 0;
      }
    }

    /* --- Инерция (sway) --- */
    this.swayCurrent.x += (this.swayTarget.x - this.swayCurrent.x) * Math.min(dt * 9, 1);
    this.swayCurrent.y += (this.swayTarget.y - this.swayCurrent.y) * Math.min(dt * 9, 1);
    this.swayTarget.multiplyScalar(1 - Math.min(dt * 2.2, 1));

    pos.x += this.swayCurrent.x * (1 - this.adsAmount * 0.85);
    pos.y += this.swayCurrent.y * (1 - this.adsAmount * 0.85);
    rot.y += this.swayCurrent.x * 1.4 * (1 - this.adsAmount * 0.85);
    rot.x += this.swayCurrent.y * 1.4 * (1 - this.adsAmount * 0.85);

    /* --- Ходьба --- */
    const walkSpeed = this.player?.planarSpeed ?? 0;
    const onGround  = this.player?.onGround ?? true;
    const targetBob = onGround ? Math.min(walkSpeed / (this.player?.walkSpeed ?? 4.4), 1.4) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(dt * 8, 1);
    this.bobTime   += dt * (6.0 + walkSpeed * 1.1);
    this.breatheTime += dt;

    const bobMul = 1 - this.adsAmount * 0.88;
    pos.x += Math.sin(this.bobTime) * 0.0125 * this.bobAmount * bobMul;
    pos.y += (Math.abs(Math.cos(this.bobTime)) * 0.0105 * this.bobAmount - 0.004 * this.bobAmount) * bobMul;
    rot.z += Math.sin(this.bobTime) * 0.020 * this.bobAmount * bobMul;
    rot.x += Math.abs(Math.cos(this.bobTime)) * 0.008 * this.bobAmount * bobMul;

    /* --- Дыхание --- */
    const idleAmount = 1 - Math.min(this.bobAmount, 1);
    pos.y += Math.sin(this.breatheTime * 1.35) * 0.0022 * idleAmount;
    pos.x += Math.sin(this.breatheTime * 0.85) * 0.0016 * idleAmount;
    rot.z += Math.sin(this.breatheTime * 1.1) * 0.006 * idleAmount;

    /* --- ADS --- */
    const wantAds = this.adsHeld && this.state === 'idle';
    const adsTarget = wantAds ? 1 : 0;
    this.adsAmount += (adsTarget - this.adsAmount) * Math.min(dt * 11, 1);
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
    const stiff = 240, damp = 18;
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
    this.camShakeVel.multiplyScalar(Math.max(0, 1 - 7 * dt));
    this.camShake.addScaledVector(this.camShakeVel, dt * 0.018);
    this.camShake.multiplyScalar(Math.max(0, 1 - 8 * dt));

    /* --- применяем --- */
    this.weaponRoot.position.copy(pos);
    this.weaponRoot.rotation.set(rot.x, rot.y, rot.z);
  }

  /* ---------- вспышка ---------- */
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

  /* ---------- FOV ---------- */
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

  /* ---------- прицел ---------- */
  _applyHud() {
    if (this._crossEl) {
      /* у дробовика прицел остаётся видимым, лишь слегка уменьшается при ADS */
      this._crossEl.style.opacity = String(0.9 - this.adsAmount * 0.15);
      const crossScale = 1 - this.adsAmount * 0.25;
      this._crossEl.style.transform = `translate(-50%, -50%) scale(${crossScale})`;
    }
  }

  /* ========================================================================
     ГЕТТЕРЫ
     ======================================================================== */

  get adsActive()  { return this.adsAmount > 0.5; }
  get isReloading() { return this.state === 'reloading'; }
  get camShakeOffset() { return this.camShake; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   9 · ПРИМЕР ИСПОЛЬЗОВАНИЯ

   import * as THREE from 'three';
   import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
   import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
   import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
   import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
   import {
     SHOTGUN_CONFIG, createShotgun, createShotgunMaterials,
     ShotgunEffects, WeaponAudio, PlayerController, ShotgunController
   } from './shotgun.js';

   const renderer = new THREE.WebGLRenderer({ antialias: true });
   renderer.setSize(innerWidth, innerHeight);
   renderer.autoClear = false;
   document.body.appendChild(renderer.domElement);

   const scene = new THREE.Scene();
   const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.05, 800);
   const weaponScene = new THREE.Scene();
   const weaponCamera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.01, 30);

   const composer = new EffectComposer(renderer);
   composer.addPass(new RenderPass(scene, camera));
   const rwp = new RenderPass(weaponScene, weaponCamera);
   rwp.clear = false; rwp.clearDepth = true;
   composer.addPass(rwp);
   const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.70, 0.55, 0.80);
   composer.addPass(bloomPass);
   composer.addPass(new OutputPass());

   const hittables = [];
   const colliders = [];

   const player  = new PlayerController({ startPos: { x:0, y:1.7, z:10 }, colliders });
   const audio   = new WeaponAudio(0.55);
   const effects = new ShotgunEffects(scene, audio);

   const sg = new ShotgunController({
     weaponScene, weaponCamera, scene, camera,
     player, hittables, colliders, effects, audio,
     crosshairEl: document.getElementById('cross'),
     onAmmoChange: (a, r) => { /* обновить HUD *\/ },
     onStateMessage: (t, d) => { /* показать сообщение *\/ },
     onBloomStrength: (v) => { bloomPass.strength = v; }
   });
   sg.mount();

   document.addEventListener('keydown', e => { player.onKeyDown(e.code); sg.onKeyDown(e.code); });
   document.addEventListener('keyup',   e => { player.onKeyUp(e.code); });
   document.addEventListener('mousemove', e => {
     if (document.pointerLockElement) {
       player.lookSensMult = 1 - sg.adsAmount * SHOTGUN_CONFIG.MOUSE_ADS_MULT;
       player.look(e.movementX, e.movementY);
       sg.onMouseMove(e.movementX, e.movementY);
     }
   });
   document.addEventListener('mousedown', e => sg.onMouseDown(e.button));
   document.addEventListener('mouseup',   e => sg.onMouseUp(e.button));
   document.addEventListener('contextmenu', e => e.preventDefault());

   const clock = new THREE.Clock();
   (function loop() {
     requestAnimationFrame(loop);
     const dt = Math.min(clock.getDelta(), 0.05);
     player.speedMult = 1 - sg.adsAmount * SHOTGUN_CONFIG.MOVE_ADS_MULT;
     player.update(dt);
     sg.update(dt);
     effects.update(dt);

     camera.position.copy(player.pos);
     camera.rotation.set(
       player.pitch + sg.camShakeOffset.x,
       player.yaw   + sg.camShakeOffset.y,
       sg.camShakeOffset.z,
       'YXZ'
     );

     composer.render();
   })();
   ═══════════════════════════════════════════════════════════════════════════ */