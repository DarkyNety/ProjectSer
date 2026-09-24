/* ============================================================================
 * M134 Minigun · Reusable Three.js Module
 * ----------------------------------------------------------------------------
 * Что можно взять по отдельности:
 *   - MINIGUN_CONFIG         — все числа (позы, тайминги, нагрев, отдача)
 *   - createMinigunMaterials() — фабрика материалов
 *   - createMinigun()        — чистая модель (Group 'M134')
 *                              внутри группы: 'rotatingAssembly', 'ammoBox'
 *   - MinigunEffects         — частицы, дым, гильзы, трассеры, дырки
 *   - WeaponAudio            — процедурный звук выстрела/кликов/заклинивания
 *   - PlayerController       — движение WASD, прыжок, коллизии, обзор
 *   - MinigunController      — вся механика: стрельба, нагрев, заклинивание,
 *                              вращение стволов, перезарядка, осмотр, ADS,
 *                              bloom-интеграция через коллбэк
 * ----------------------------------------------------------------------------
 * Ориентация модели:   +X = дуло, +Y = вверх, +Z = правая сторона.
 * Для viewmodel:       minigun.rotation.y = Math.PI/2;
 *                      minigun.scale.setScalar(MINIGUN_CONFIG.SCALE);
 * ==========================================================================*/

import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════════════
   1 · КОНФИГ
   ═══════════════════════════════════════════════════════════════════════════ */

export const MINIGUN_CONFIG = {
  /* --- масштаб и позы viewmodel --- */
  SCALE: 0.0130,

  BASE_POS: { x:  0.20, y: -0.24, z: -0.28 },
  BASE_ROT: { x:  0.04, y: -0.06, z:  0.02 },

  ADS_POS:  { x:  0.00, y: -0.13, z: -0.22 },
  ADS_ROT:  { x: 0,     y: 0,     z: 0     },

  /* Дуло в локальных координатах weaponRoot:
     BARREL_TIP = 60 в модели * SCALE, ось уходит в -Z */
  MUZZLE_X:  0,
  MUZZLE_Y:  0,
  MUZZLE_Z: -60,

  /* --- патроны / тайминги --- */
  MAG_SIZE:      200,
  RESERVE:       600,
  FIRE_INTERVAL: 0.05,
  RELOAD_DUR:    7.0,
  INSPECT_DUR:   5.60,
  DRAW_DUR:      1.2,

  /* --- FOV --- */
  MAIN_FOV:              75,
  ADS_FOV_DELTA:        -18,
  WEAPON_FOV:            58,
  WEAPON_ADS_FOV_DELTA: -12,

  /* --- мышь / игрок --- */
  MOUSE_SENS:     0.0022,
  MOUSE_ADS_MULT: 0.4,
  MOVE_ADS_MULT:  0.55,

  /* --- нагрев --- */
  HEAT_MAX:             100,
  HEAT_PER_SHOT:        0.85,
  HEAT_SMOKE_THRESHOLD: 42,
  HEAT_SPARKS_THRESHOLD:78,
  HEAT_JAM_THRESHOLD:   100,
  HEAT_COOL_RATE:       16,
  HEAT_COOL_RATE_JAMMED:22,
  HEAT_UNJAM_LEVEL:     25,

  /* --- цвета стадий нагрева ствола --- */
  BARREL_COLORS: {
    cold:    0x3a4048,
    warm:    0x4a3630,
    hot:     0x7a2818,
    veryHot: 0xc03018,
    molten:  0xff6028
  },

  /* --- разброс --- */
  SPREAD_BASE:     0.012,
  SPREAD_MOVE:     0.012,
  SPREAD_HEAT:     0.030,
  SPREAD_ADS_MULT: 0.6,      // 1 - это множитель

  /* --- отдача --- */
  RECOIL_BURST_RAMP:   12,   // за сколько выстрелов отдача выходит на максимум
  RECOIL_VERT_MIN:     0.0080,
  RECOIL_VERT_MAX:     0.0140,
  RECOIL_HEAT_MULT:    1.5,  // +150% отдачи на 100% нагрева
  RECOIL_ADS_MULT:     0.2,
  DRIFT_IMPULSE_X:     0.0035,
  DRIFT_IMPULSE_Y:     0.0020,
  DRIFT_MAX_X:         0.020,
  DRIFT_MAX_Y:         0.012,
  DRIFT_INSTANT_X:     0.010,
  KICK_POS_Z:  { min: 0.030, max: 0.050 },
  KICK_POS_Y:  { min: 0.006, max: 0.010 },
  KICK_POS_X:  { amp: 0.010 },
  KICK_ROT_X:  { min: 0.055, max: 0.100 },
  KICK_ROT_Z:  { amp: 0.055 },
  KICK_ROT_Y:  { amp: 0.035 },

  /* --- вращение стволов --- */
  SPIN_FIRING:  12,
  SPIN_IDLE:    0.8,
  SPIN_HOT_MULT: 0.6,   // при > 80% жара

  /* --- вспышка --- */
  FLASH_TIME: 0.045,

  /* --- таймлайн перезарядки (в секундах) --- */
  RELOAD_TIMELINE: {
    coverOpen:  0.7,
    boxOut:     1.6,
    boxIn:      3.0,
    beltFed:    4.3,
    coverClosed:5.6,
    charged:    6.3
  },

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

export function makeHoleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0.00, 'rgba(0,0,0,1)');
  g.addColorStop(0.35, 'rgba(8,8,9,0.96)');
  g.addColorStop(0.60, 'rgba(60,60,62,0.55)');
  g.addColorStop(0.82, 'rgba(130,130,132,0.22)');
  g.addColorStop(1.00, 'rgba(160,160,160,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(32, 32, 30, 0, 7); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · МАТЕРИАЛЫ
   ═══════════════════════════════════════════════════════════════════════════ */

const _NOISE = makeNoiseTexture(256, 0.28);
_NOISE.repeat.set(4, 4);

export function createMinigunMaterials() {
  return {
    steel: new THREE.MeshStandardMaterial({
      color: 0x3a4048, metalness: 1.0, roughness: 0.42, roughnessMap: _NOISE
    }),
    /* Ствол — единственный материал, у которого контроллер меняет
       color / emissive / emissiveIntensity при нагреве. */
    barrel: new THREE.MeshStandardMaterial({
      color: 0x3a4048, metalness: 1.0, roughness: 0.42, roughnessMap: _NOISE,
      emissive: 0xff2200, emissiveIntensity: 0
    }),
    steelBright: new THREE.MeshStandardMaterial({
      color: 0x6a727c, metalness: 1.0, roughness: 0.32, roughnessMap: _NOISE
    }),
    phosphate: new THREE.MeshStandardMaterial({
      color: 0x2a2f36, metalness: 0.94, roughness: 0.62, roughnessMap: _NOISE
    }),
    steelDark: new THREE.MeshStandardMaterial({
      color: 0x1c2025, metalness: 1.0, roughness: 0.52, roughnessMap: _NOISE
    }),
    blackMetal: new THREE.MeshStandardMaterial({
      color: 0x121519, metalness: 0.88, roughness: 0.60, roughnessMap: _NOISE
    }),
    polymer: new THREE.MeshStandardMaterial({
      color: 0x1a1d21, metalness: 0.06, roughness: 0.62
    }),
    polymerMatte: new THREE.MeshStandardMaterial({
      color: 0x101215, metalness: 0.03, roughness: 0.88
    }),
    brass: new THREE.MeshStandardMaterial({
      color: 0xb08a3a, metalness: 1.0, roughness: 0.35
    }),
    crankSteel: new THREE.MeshStandardMaterial({
      color: 0x5a6169, metalness: 1.0, roughness: 0.38, roughnessMap: _NOISE
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x0d0f11, metalness: 0.05, roughness: 0.92
    }),
    delrin: new THREE.MeshStandardMaterial({
      color: 0x4a5a38, metalness: 0.15, roughness: 0.72
    }),
    warningYellow: new THREE.MeshStandardMaterial({
      color: 0xd4a820, metalness: 0.15, roughness: 0.72
    }),
    warningRed: new THREE.MeshStandardMaterial({
      color: 0x9a1a10, metalness: 0.15, roughness: 0.72
    })
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · МОДЕЛЬ M134 MINIGUN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Строит полную модель M134 Minigun.
 * @param {object} [materials] — результат createMinigunMaterials()
 * @returns {THREE.Group} — группа с именем 'M134';
 *                          дети: 'rotatingAssembly', 'ammoBox'
 */
export function createMinigun(materials) {
  const MAT = materials || createMinigunMaterials();
  const minigun = new THREE.Group();
  minigun.name = 'M134';

  const NUM_BARRELS = 6;
  const BARREL_RING_R = 2.15;
  const BARREL_LEN = 54;
  const BARREL_X = 33;
  const BARREL_TIP = BARREL_X + BARREL_LEN / 2;
  const BARREL_BREECH = BARREL_X - BARREL_LEN / 2;

  function box(w, h, d, mat, x=0, y=0, z=0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    minigun.add(m);
    return m;
  }
  function cyl(r1, r2, h, seg, mat, x=0, y=0, z=0, axis='x') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,seg), mat);
    if (axis==='x') m.rotation.z = Math.PI/2;
    if (axis==='z') m.rotation.x = Math.PI/2;
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    minigun.add(m);
    return m;
  }
  function boxG(w,h,d,mat,x=0,y=0,z=0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cylG(r1,r2,h,seg,mat,x=0,y=0,z=0,axis='x') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,seg), mat);
    if (axis==='x') m.rotation.z = Math.PI/2;
    if (axis==='z') m.rotation.x = Math.PI/2;
    m.position.set(x,y,z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function ringG(outerR, innerR, thickness, mat, x=0) {
    const shape = new THREE.Shape();
    shape.absarc(0,0,outerR,0,Math.PI*2,false);
    const hole = new THREE.Path();
    hole.absarc(0,0,innerR,0,Math.PI*2,true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08,
      bevelSegments: 1, curveSegments: 32, steps: 1
    });
    geo.translate(0,0,-thickness/2);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = Math.PI/2;
    m.position.x = x;
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /* ---------- ВРАЩАЮЩИЙСЯ БЛОК СТВОЛОВ ---------- */
  const rotatingAssembly = new THREE.Group();
  rotatingAssembly.name = 'rotatingAssembly';

  for (let i = 0; i < NUM_BARRELS; i++) {
    const a = (i / NUM_BARRELS) * Math.PI * 2;
    const py = Math.cos(a) * BARREL_RING_R;
    const pz = Math.sin(a) * BARREL_RING_R;

    rotatingAssembly.add(cylG(0.5, 0.5, BARREL_LEN, 20, MAT.barrel, BARREL_X, py, pz, 'x'));

    rotatingAssembly.add(cylG(0.62, 0.62, 3.8, 20, MAT.steelDark, BARREL_TIP - 2.0, py, pz, 'x'));
    for (let j = 0; j < 4; j++) {
      const cx = BARREL_TIP - 3.4 + j * 0.85;
      const sa = (j * 0.5);
      rotatingAssembly.add(boxG(0.55, 0.22, 0.22, MAT.blackMetal, cx, py + Math.cos(sa) * 0.55, pz + Math.sin(sa) * 0.55));
      rotatingAssembly.add(boxG(0.55, 0.22, 0.22, MAT.blackMetal, cx, py + Math.cos(sa + Math.PI) * 0.55, pz + Math.sin(sa + Math.PI) * 0.55));
    }
    rotatingAssembly.add(cylG(0.65, 0.65, 0.5, 20, MAT.steelDark, BARREL_TIP - 0.15, py, pz, 'x'));
    rotatingAssembly.add(cylG(0.28, 0.28, 0.15, 16, MAT.blackMetal, BARREL_TIP + 0.15, py, pz, 'x'));
    rotatingAssembly.add(cylG(0.66, 0.66, 0.35, 20, MAT.blackMetal, BARREL_TIP - 4.2, py, pz, 'x'));

    rotatingAssembly.add(cylG(0.55, 0.55, 4.5, 20, MAT.steelDark, BARREL_BREECH + 2.0, py, pz, 'x'));
    rotatingAssembly.add(cylG(0.65, 0.65, 1.2, 20, MAT.blackMetal, BARREL_BREECH + 0.4, py, pz, 'x'));
  }

  rotatingAssembly.add(ringG(3.1, 2.7, 2.0, MAT.steelDark, 10));
  rotatingAssembly.add(ringG(3.1, 2.7, 2.2, MAT.steelDark, 30));
  rotatingAssembly.add(ringG(3.2, 2.7, 2.6, MAT.steelDark, BARREL_TIP - 6));
  rotatingAssembly.add(ringG(3.3, 2.65, 0.9, MAT.delrin, BARREL_TIP - 6.8));
  rotatingAssembly.add(ringG(3.3, 2.65, 0.9, MAT.delrin, BARREL_TIP - 5.2));

  for (const cx of [10, 30, BARREL_TIP - 6]) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      rotatingAssembly.add(cylG(0.16, 0.16, 0.35, 8, MAT.blackMetal, cx, Math.cos(a) * 3.15, Math.sin(a) * 3.15, 'x'));
    }
  }

  rotatingAssembly.add(cylG(3.0, 3.0, 12, 40, MAT.phosphate, 0, 0, 0, 'x'));
  rotatingAssembly.add(cylG(3.35, 3.0, 1.0, 40, MAT.phosphate, 6.3, 0, 0, 'x'));
  rotatingAssembly.add(cylG(3.4, 3.4, 0.35, 40, MAT.steelDark, 6.9, 0, 0, 'x'));
  rotatingAssembly.add(cylG(3.35, 3.35, 1.0, 40, MAT.phosphate, -6.3, 0, 0, 'x'));
  rotatingAssembly.add(cylG(3.4, 3.4, 0.35, 40, MAT.steelDark, -6.9, 0, 0, 'x'));
  rotatingAssembly.add(cylG(3.08, 3.08, 0.35, 40, MAT.steelDark, -3.5, 0, 0, 'x'));
  rotatingAssembly.add(cylG(3.08, 3.08, 0.35, 40, MAT.steelDark, 3.5, 0, 0, 'x'));

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    rotatingAssembly.add(cylG(0.22, 0.22, 0.45, 10, MAT.blackMetal, 0, Math.cos(a) * 3.02, Math.sin(a) * 3.02, 'x'));
  }

  rotatingAssembly.add(cylG(3.3, 3.3, 0.5, 40, MAT.blackMetal, 6.8, 0, 0, 'x'));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const py = Math.cos(a) * BARREL_RING_R;
    const pz = Math.sin(a) * BARREL_RING_R;
    rotatingAssembly.add(boxG(1.8, 0.65, 0.65, MAT.steelBright, 7.2, py, pz));
    rotatingAssembly.add(cylG(0.22, 0.22, 1.2, 10, MAT.steelBright, 7.9, py, pz, 'x'));
    rotatingAssembly.add(boxG(1.2, 0.55, 0.55, MAT.steelBright, -6.8, py, pz));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const py = Math.cos(a) * BARREL_RING_R;
    const pz = Math.sin(a) * BARREL_RING_R;
    rotatingAssembly.add(boxG(1.6, 0.35, 0.5, MAT.steelBright, -8.0, py, pz));
  }

  minigun.add(rotatingAssembly);

  /* ---------- КОРПУС РЕСИВЕРА ---------- */
  box(14, 7.0, 7.2, MAT.phosphate, -13.5, 0, 0);
  box(13.5, 0.6, 6.6, MAT.phosphate, -13.5, 3.8, 0);
  box(13.5, 0.6, 6.8, MAT.phosphate, -13.5, -3.8, 0);
  box(1.5, 5.4, 5.6, MAT.phosphate, -6.8, 0, 0);
  box(14.2, 0.25, 0.25, MAT.steelDark, -13.5, 2.2, 3.65);
  box(14.2, 0.25, 0.25, MAT.steelDark, -13.5, -2.2, 3.65);
  box(14.2, 0.25, 0.25, MAT.steelDark, -13.5, 2.2, -3.65);
  box(14.2, 0.25, 0.25, MAT.steelDark, -13.5, -2.2, -3.65);
  for (const bx of [-19.0, -16.0, -13.0, -10.0, -7.5]) {
    cyl(0.2, 0.2, 7.6, 10, MAT.steelDark, bx, 2.6, 0, 'z');
    cyl(0.2, 0.2, 7.6, 10, MAT.steelDark, bx, -2.6, 0, 'z');
  }
  box(4.0, 1.1, 0.08, MAT.steelBright, -15.0, 1.0, 3.68);
  box(3.2, 0.12, 0.05, MAT.blackMetal, -15.0, 1.25, 3.74);
  box(2.4, 0.1, 0.05, MAT.blackMetal, -15.0, 0.75, 3.74);
  box(3.5, 1.4, 0.06, MAT.warningYellow, -17.5, -1.5, 3.68);
  box(3.5, 0.35, 0.03, MAT.blackMetal, -17.5, -1.05, 3.72);
  box(3.5, 0.35, 0.03, MAT.blackMetal, -17.5, -1.95, 3.72);
  for (let i = 0; i < 6; i++) {
    box(0.32, 0.55, 0.03, MAT.blackMetal, -18.9 + i * 0.55, -1.5, 3.72);
  }

  /* ---------- ПАТРОНООТВОД ---------- */
  box(2.5, 1.8, 2.2, MAT.phosphate, -10.5, -1.5, 3.5);
  box(1.6, 3.5, 1.5, MAT.phosphate, -9.8, -3.6, 3.7);
  const chute = box(1.2, 2.8, 1.2, MAT.steelDark, -9.2, -6.0, 4.2);
  chute.rotation.x = -0.3;
  box(1.0, 0.5, 1.0, MAT.rubber, -9.0, -7.5, 4.4);

  /* ---------- РУЧКА ДЛЯ ПЕРЕНОСКИ ---------- */
  (function addCarryHandle() {
    const HY = 3.8;
    const HX_FRONT = -9.5;
    const HX_REAR = -16.5;
    box(1.8, 1.4, 1.8, MAT.phosphate, HX_FRONT, HY + 0.7, 0);
    cyl(0.28, 0.28, 2.2, 10, MAT.steelDark, HX_FRONT, HY + 0.7, 0, 'z');
    box(1.8, 1.4, 1.8, MAT.phosphate, HX_REAR, HY + 0.7, 0);
    cyl(0.28, 0.28, 2.2, 10, MAT.steelDark, HX_REAR, HY + 0.7, 0, 'z');

    const handlePoints = [
      [HX_REAR,  HY + 1.4], [HX_REAR + 0.8, HY + 2.8], [HX_REAR + 2.0, HY + 3.6],
      [-13.5,     HY + 3.9], [-12.5,     HY + 3.9], [HX_FRONT - 2.0, HY + 3.6],
      [HX_FRONT - 0.8, HY + 2.8], [HX_FRONT,  HY + 1.4]
    ];
    const curvePts = handlePoints.map(p => new THREE.Vector3(p[0], p[1], 0));
    const handleCurve = new THREE.CatmullRomCurve3(curvePts);
    const handleGeo = new THREE.TubeGeometry(handleCurve, 48, 0.38, 12, false);
    const handleMesh = new THREE.Mesh(handleGeo, MAT.phosphate);
    handleMesh.castShadow = true; handleMesh.receiveShadow = true;
    minigun.add(handleMesh);

    for (let i = 0; i < 3; i++) {
      const t = 0.25 + i * 0.25;
      const p = handleCurve.getPoint(t);
      const tan = handleCurve.getTangent(t);
      const clamp = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 8, 16), MAT.steelDark);
      clamp.position.copy(p);
      clamp.lookAt(p.clone().add(tan));
      clamp.castShadow = true;
      minigun.add(clamp);
    }

    const gripCurvePts = [
      new THREE.Vector3(-15.0, HY + 3.72, 0), new THREE.Vector3(-13.5, HY + 3.88, 0),
      new THREE.Vector3(-12.5, HY + 3.88, 0), new THREE.Vector3(-11.0, HY + 3.72, 0)
    ];
    const gripCurve = new THREE.CatmullRomCurve3(gripCurvePts);
    const gripGeo = new THREE.TubeGeometry(gripCurve, 32, 0.58, 16, false);
    const gripMesh = new THREE.Mesh(gripGeo, MAT.rubber);
    gripMesh.castShadow = true;
    minigun.add(gripMesh);
    for (let i = 0; i < 7; i++) {
      const t = 0.08 + i * 0.14;
      const p = gripCurve.getPoint(t);
      const tan = gripCurve.getTangent(t);
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 16), MAT.polymerMatte);
      rib.position.copy(p);
      rib.lookAt(p.clone().add(tan));
      minigun.add(rib);
    }

    cyl(0.42, 0.42, 0.9, 14, MAT.steelDark, HX_REAR, HY + 1.4, 0, 'y');
    cyl(0.42, 0.42, 0.9, 14, MAT.steelDark, HX_FRONT, HY + 1.4, 0, 'y');
  })();

  /* ---------- РУЧНОЙ ПРИВОД ---------- */
  (function addCrank() {
    const CX = -20.0, CY = 1.0, REACH = 4.4;
    cyl(1.0, 1.0, 1.6, 24, MAT.steel, CX, CY, 0, 'x');
    cyl(1.2, 1.2, 0.4, 24, MAT.crankSteel, CX - 0.7, CY, 0, 'x');
    box(0.85, REACH, 0.85, MAT.crankSteel, CX, CY + REACH/2, 0);
    box(0.32, REACH - 0.9, 0.38, MAT.steelDark, CX + 0.55, CY + REACH/2, 0);
    box(1.25, 1.25, 1.25, MAT.crankSteel, CX, CY + REACH, 0);
    cyl(0.55, 0.55, 1.6, 16, MAT.steel, CX, CY + REACH, 0, 'x');
    cyl(0.55, 0.55, 3.0, 20, MAT.polymer, CX - 0.2, CY + REACH, 0, 'x');
    cyl(0.65, 0.65, 0.4, 20, MAT.crankSteel, CX - 1.5, CY + REACH, 0, 'x');
    cyl(0.65, 0.65, 0.4, 20, MAT.crankSteel, CX + 1.1, CY + REACH, 0, 'x');
    box(0.65, 1.5, 0.65, MAT.steelDark, CX, CY - 1.1, 0);
    cyl(0.55, 0.55, 1.3, 16, MAT.steel, CX, CY - 1.85, 0, 'y');
  })();

  /* ---------- ВЕРХНИЙ БЛОК ---------- */
  box(8.0, 2.4, 5.6, MAT.phosphate, -14.0, 4.6, 0);
  box(8.4, 0.5, 6.0, MAT.steelDark, -14.0, 5.9, 0);
  box(2.4, 0.55, 0.7, MAT.steelDark, -16.5, 6.2, 0);
  cyl(0.28, 0.28, 1.0, 12, MAT.steel, -16.5, 6.2, 0, 'z');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    box(0.5, 0.6, 0.9, MAT.steel, -11.5, Math.cos(a) * 1.0, Math.sin(a) * 1.0);
  }
  for (const bx of [-17.5, -14.0, -10.5]) {
    cyl(0.18, 0.18, 5.8, 10, MAT.steelDark, bx, 4.6, 0, 'z');
  }

  /* ---------- ЗАДНЯЯ ЧАСТЬ ---------- */
  cyl(2.9, 2.9, 6.5, 32, MAT.phosphate, -23.8, 0, 0, 'x');
  cyl(3.1, 3.1, 0.8, 32, MAT.steelDark, -20.7, 0, 0, 'x');
  cyl(2.7, 2.7, 1.0, 32, MAT.phosphate, -27.4, 0, 0, 'x');
  cyl(2.2, 2.2, 0.6, 32, MAT.steelDark, -28.2, 0, 0, 'x');
  for (let i = 0; i < 10; i++) {
    cyl(3.05, 3.05, 0.22, 32, MAT.steelDark, -21.5 - i * 0.55, 0, 0, 'x');
  }
  box(2.0, 1.4, 1.6, MAT.blackMetal, -23.5, 2.5, 0);
  box(1.4, 0.9, 1.2, MAT.steelDark, -23.5, 3.2, 0);
  cyl(0.32, 0.32, 0.35, 12, MAT.brass, -22.8, 3.2, 0, 'y');
  cyl(0.32, 0.32, 0.35, 12, MAT.brass, -24.2, 3.2, 0, 'y');

  /* ---------- БОКОВЫЕ РУКОЯТКИ ---------- */
  for (const side of [-1, 1]) {
    const gz = side * 2.8;
    box(2.6, 4.2, 1.2, MAT.phosphate, -21.0, -0.5, gz);
    box(1.4, 1.2, 1.6, MAT.steelDark, -21.0, 1.7, gz);
    const grip = box(1.6, 5.4, 1.6, MAT.polymer, -22.4, -4.0, gz);
    grip.rotation.z = -0.18;
    for (let i = 0; i < 5; i++) {
      const rg = box(1.7, 0.28, 1.7, MAT.polymerMatte, -22.4 - i * 0.12, -2.4 - i * 0.85, gz);
      rg.rotation.z = -0.18;
    }
    cyl(0.35, 0.35, 0.5, 14, MAT.steelDark, -22.2, -1.3, gz, 'y');
    cyl(0.28, 0.28, 0.35, 14, MAT.blackMetal, -22.2, -1.05, gz, 'y');
    box(1.8, 0.5, 1.8, MAT.polymerMatte, -23.0, -6.7, gz);
    box(1.6, 0.15, 1.6, MAT.warningRed, -23.0, -6.35, gz);
    box(1.9, 0.35, 0.35, MAT.steelDark, -22.2, -1.9, gz + side * 0.75);
    box(1.9, 0.35, 0.35, MAT.steelDark, -22.2, -1.9, gz - side * 0.75);
  }
  box(1.2, 0.6, 5.6, MAT.phosphate, -21.0, 0.0, 0);

  /* ---------- ПАТРОННАЯ ЛЕНТА ---------- */
  (function addAmmoChute() {
    const pts = [
      new THREE.Vector3(-11.0, 5.5, 0), new THREE.Vector3(-11.5, 6.2, -2.2),
      new THREE.Vector3(-14.0, 6.0, -4.0), new THREE.Vector3(-18.0, 4.5, -4.8),
      new THREE.Vector3(-22.0, 2.0, -4.6), new THREE.Vector3(-25.0, -1.0, -4.0)
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 40, 0.85, 12, false);
    const m = new THREE.Mesh(geo, MAT.polymerMatte);
    m.castShadow = true; m.receiveShadow = true;
    minigun.add(m);

    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.11, 8, 16), MAT.polymer);
      ringMesh.position.copy(p);
      ringMesh.lookAt(p.clone().add(tan));
      minigun.add(ringMesh);
    }
    for (let i = 0; i < 5; i++) {
      const t = 0.05 + i * 0.08;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      const brassMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 12), MAT.brass);
      brassMesh.position.copy(p);
      brassMesh.lookAt(p.clone().add(tan));
      brassMesh.rotateX(Math.PI/2);
      minigun.add(brassMesh);
    }
  })();

  /* ---------- ПАТРОННЫЙ ЯЩИК (отдельная группа для перезарядки) ---------- */
  const ammoBoxGroup = new THREE.Group();
  ammoBoxGroup.name = 'ammoBox';
  (function addAmmoBox() {
    const box1 = new THREE.Mesh(new THREE.BoxGeometry(8.5, 6.5, 6.0), MAT.polymer);
    box1.position.set(-25.0, -6.5, -4.0);
    box1.castShadow = true; box1.receiveShadow = true;
    ammoBoxGroup.add(box1);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(8.7, 0.6, 6.2), MAT.polymerMatte);
    cap.position.set(-25.0, -3.1, -4.0);
    cap.castShadow = true;
    ammoBoxGroup.add(cap);

    const warn = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.04), MAT.warningYellow);
    warn.position.set(-25.0, -6.0, -1.02);
    ammoBoxGroup.add(warn);
  })();
  minigun.add(ammoBoxGroup);

  /* ---------- НИЖНЯЯ ПЛАНКА / КРЕПЛЕНИЕ ---------- */
  box(6.0, 0.8, 5.0, MAT.phosphate, -13.0, -4.3, 0);
  box(3.0, 3.0, 3.0, MAT.phosphate, -13.0, -5.8, 0);
  cyl(0.55, 0.55, 6.5, 16, MAT.steelDark, -13.0, -6.5, 0, 'z');
  cyl(0.85, 0.85, 0.5, 16, MAT.steel, -13.0, -6.5, 3.4, 'z');
  cyl(0.85, 0.85, 0.5, 16, MAT.steel, -13.0, -6.5, -3.4, 'z');

  cyl(0.22, 0.22, 15.0, 10, MAT.steelDark, -13.5, -3.0, 3.5, 'x');
  cyl(0.22, 0.22, 15.0, 10, MAT.steelDark, -13.5, -3.0, -3.5, 'x');
  for (const dx of [-17.0, -13.5, -10.0]) {
    cyl(0.25, 0.25, 0.4, 10, MAT.blackMetal, dx, -4.05, 0, 'y');
  }
  for (let i = 0; i < 4; i++) {
    box(0.35, 0.5, 6.4, MAT.steelDark, -19.0 + i * 1.6, 3.9, 0);
  }

  return minigun;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · ЭФФЕКТЫ
   ═══════════════════════════════════════════════════════════════════════════ */

export class MinigunEffects {
  constructor(scene, audio, opts = {}) {
    this.scene = scene;
    this.audio = audio || null;
    this.maxParticles = opts.maxParticles ?? 4500;
    this.maxDecals    = opts.maxDecals    ?? 200;
    this.maxCasings   = opts.maxCasings   ?? 120;

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

    /* --- дырки от пуль --- */
    const decalMat = new THREE.MeshBasicMaterial({
      map: makeHoleTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false
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

    /* --- гильзы --- */
    this.casings = [];
    this.casingMat = new THREE.MeshStandardMaterial({
      color: 0xb08a3a, metalness: 1.0, roughness: 0.35
    });
    this.casingGeo = new THREE.CylinderGeometry(0.010, 0.011, 0.058, 10);

    /* --- трассеры --- */
    this.tracers = [];
    this.tracerGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 6, 1, true);
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

  /* ====== дырки ====== */
  addDecal(point, normal, scale = 0.024) {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.maxDecals;
    d.visible = true;
    d.position.copy(point).addScaledVector(normal, 0.006);
    d.lookAt(point.clone().add(normal));
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(scale * (0.75 + Math.random() * 0.6));
  }

  /* ====== гильзы ====== */
  spawnCasing(worldPos, baseVel) {
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    m.position.copy(worldPos);
    m.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
    m.castShadow = true;
    this.scene.add(m);
    this.casings.push({
      obj: m,
      vel: baseVel.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 1.5,
        1.8 + Math.random() * 1.2,
        (Math.random() - 0.5) * 1.5
      )),
      spin: new THREE.Vector3(
        (Math.random()-0.5)*35, (Math.random()-0.5)*35, (Math.random()-0.5)*35
      ),
      life: 30, bounced: 0, sfxDone: false
    });
    if (this.casings.length > this.maxCasings) {
      const old = this.casings.shift();
      this.scene.remove(old.obj);
    }
  }

  /* ====== трассеры ====== */
  spawnTracer(from, to) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd070, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    });
    const m = new THREE.Mesh(this.tracerGeo, mat);
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, from.distanceTo(to));
    this.scene.add(m);
    this.tracers.push({ obj: m, mat, life: 0.05 });
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
        if (!c.sfxDone && c.bounced === 0 && Math.abs(c.vel.y) > 1.5) {
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
      t.mat.opacity = Math.max(t.life / 0.05, 0) * 0.85;
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
  constructor(masterVolume = 0.5) {
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

  shot() {
    if (!this.actx) return;
    const t = this.actx.currentTime;

    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = this.actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 250;
    const lp = this.actx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + 0.10);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.13);
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.masterGain);
    src.start(t); src.stop(t + 0.15);

    const o = this.actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    const og = this.actx.createGain();
    og.gain.setValueAtTime(0.35, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(og); og.connect(this.masterGain);
    o.start(t); o.stop(t + 0.07);
  }

  jam() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.3);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(this.masterGain);
    o.start(t); o.stop(t + 0.45);

    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const bp = this.actx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 1200; bp.Q.value = 5;
    const g2 = this.actx.createGain();
    g2.gain.setValueAtTime(0.3, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(bp); bp.connect(g2); g2.connect(this.masterGain);
    src.start(t); src.stop(t + 0.45);
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

  casingBounce() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.05);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.04, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.08);
    o.connect(g); g.connect(this.masterGain);
    o.start(t); o.stop(t + 0.1);
  }

  impact() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(1800 + Math.random() * 900, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.06);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g); g.connect(this.masterGain);
    o.start(t); o.stop(t + 0.1);
  }

  ping() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    [1500, 2250, 3000].forEach((f, i) => {
      const o = this.actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.actx.createGain();
      g.gain.setValueAtTime(0.08 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.0003, t + 0.45 + i * 0.1);
      o.connect(g); g.connect(this.masterGain);
      o.start(t); o.stop(t + 0.5);
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   7 · КОНТРОЛЛЕР ИГРОКА (идентичен АК-версии)
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

    this.mouseSensitivity = opts.mouseSensitivity ?? MINIGUN_CONFIG.MOUSE_SENS;
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
   8 · КОНТРОЛЛЕР MINIGUN
   ═══════════════════════════════════════════════════════════════════════════ */

const _smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _easeOutCubic = x => 1 - Math.pow(1 - x, 3);

export class MinigunController {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.weaponScene
   * @param {THREE.Camera} opts.weaponCamera
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {PlayerController} opts.player
   * @param {Array} [opts.hittables]
   * @param {Array} [opts.colliders]
   * @param {MinigunEffects} [opts.effects]
   * @param {WeaponAudio} [opts.audio]
   * @param {HTMLElement} [opts.crosshairEl]
   * @param {HTMLElement} [opts.heatFillEl]   — заполнение шкалы нагрева
   * @param {HTMLElement} [opts.heatValEl]    — текстовое значение %
   * @param {Function} [opts.onAmmoChange]
   * @param {Function} [opts.onStateMessage]
   * @param {Function} [opts.onBloomStrength]  — (value) => void  (для BloomPass)
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
    this._heatFillEl     = opts.heatFillEl     || null;
    this._heatValEl      = opts.heatValEl      || null;
    this._onAmmoChange   = opts.onAmmoChange   || null;
    this._onStateMessage = opts.onStateMessage || null;
    this._onBloomStrength= opts.onBloomStrength|| null;

    /* --- конфиг --- */
    this.cfg = Object.assign({}, MINIGUN_CONFIG, opts.config || {});

    /* --- модель --- */
    this.weaponRoot = new THREE.Group();
    this.weaponRoot.rotation.order = 'YXZ';
    this.weaponRoot.visible = false;

    const materials = opts.materials || createMinigunMaterials();
    this.materials = materials;
    this.minigun = createMinigun(materials);
    this.minigun.rotation.y = Math.PI / 2;
    this.minigun.scale.setScalar(this.cfg.SCALE);
    this.weaponRoot.add(this.minigun);

    this.rotatingAssembly = this.minigun.getObjectByName('rotatingAssembly');
    this.ammoBoxGroup     = this.minigun.getObjectByName('ammoBox');
    this.muzzle = new THREE.Vector3(
      this.cfg.MUZZLE_X, this.cfg.MUZZLE_Y, this.cfg.MUZZLE_Z * this.cfg.SCALE
    );

    /* --- состояние --- */
    this.state        = 'holstered';
    this.time         = 0;
    this.ammo         = this.cfg.MAG_SIZE;
    this.reserve      = this.cfg.RESERVE;
    this.fireCooldown = 0;
    this.triggerHeld  = false;
    this.adsHeld      = false;
    this.adsAmount    = 0;

    /* --- нагрев --- */
    this.heat = {
      value: 0,
      smoothedHeat: 0,
      jammed: false,
      smokeTimer: 0,
      sparkTimer: 0
    };

    /* --- счётчики отдачи --- */
    this.shotCounter  = 0;
    this.recoilDriftX = 0;
    this.recoilDriftY = 0;

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

    this.reloadFlags = {
      coverOpen: false, boxOut: false, boxIn: false,
      beltFed: false, coverClosed: false, charged: false
    };

    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 400;

    /* --- цвета стадий --- */
    this._barrelColors = {
      cold:    new THREE.Color(this.cfg.BARREL_COLORS.cold),
      warm:    new THREE.Color(this.cfg.BARREL_COLORS.warm),
      hot:     new THREE.Color(this.cfg.BARREL_COLORS.hot),
      veryHot: new THREE.Color(this.cfg.BARREL_COLORS.veryHot),
      molten:  new THREE.Color(this.cfg.BARREL_COLORS.molten)
    };
    this._tempColor = new THREE.Color();

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
    flashGroup.add(new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), flashMat));
    const fq2 = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), flashMat);
    fq2.rotation.z = Math.PI/4;
    flashGroup.add(fq2);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.10, 0.42, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb050, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
        depthTest: false, toneMapped: false
      })
    );
    cone.rotation.x = -Math.PI/2;
    cone.position.z = -0.22;
    flashGroup.add(cone);

    const flashLight = new THREE.PointLight(0xffb060, 0, 6, 2);
    flashLight.position.copy(this.muzzle);
    this.weaponRoot.add(flashLight);
    this.flashLight = flashLight;

    const worldLight = new THREE.PointLight(0xffb060, 0, 25, 2);
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
      this.triggerHeld = true;
      this.tryFire();
    }
    if (button === 2) {
      if (this.state === 'inspecting') this.cancelInspect();
      this.adsHeld = true;
    }
  }

  onMouseUp(button) {
    if (button === 0) {
      this.triggerHeld = false;
      this.shotCounter  = 0;
      this.recoilDriftX = 0;
      this.recoilDriftY = 0;
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
      setTimeout(() => this.audio?.click(0.20, 1100, 0.07), 400);
      setTimeout(() => this.audio?.click(0.18, 1800, 0.05), 800);
    }
  }

  cancelInspect() {
    if (this.state === 'inspecting') { this.state = 'idle'; this.time = 0; }
  }

  tryReload() {
    if (this.state === 'inspecting') this.cancelInspect();
    if (this.state !== 'idle') return;
    if (this.ammo >= this.cfg.MAG_SIZE) return;
    if (this.reserve <= 0) { this.setStateMessage('НЕТ ПАТРОНОВ'); return; }
    if (this.heat.jammed)  { this.setStateMessage('ОСТЫВАЕТ...'); return; }

    this.state = 'reloading';
    this.time  = 0;
    this.reloadFlags.coverOpen   = false;
    this.reloadFlags.boxOut      = false;
    this.reloadFlags.boxIn       = false;
    this.reloadFlags.beltFed     = false;
    this.reloadFlags.coverClosed = false;
    this.reloadFlags.charged     = false;
    if (this.ammoBoxGroup) this.ammoBoxGroup.visible = true;
    this.setStateMessage('ПЕРЕЗАРЯДКА...', this.cfg.RELOAD_DUR);
  }

  tryInspect() {
    if (this.state === 'inspecting') { this.cancelInspect(); return; }
    if (this.state !== 'idle') return;
    this.state = 'inspecting';
    this.time  = 0;
    this.audio?.click(0.15, 700, 0.09);
  }

  /* ========================================================================
     ВЫСТРЕЛ
     ======================================================================== */

  tryFire() {
    if (this.state !== 'idle') return;
    if (this.heat.jammed) {
      this.audio?.click(0.15, 200, 0.05);
      return;
    }
    if (this.fireCooldown > 0) return;
    if (this.ammo <= 0) {
      this.audio?.click(0.22, 2400, 0.05);
      this.fireCooldown = 0.35;
      this.setStateMessage('ПЕРЕЗАРЯДКА [R]');
      return;
    }

    this.ammo--;
    this._emitAmmo();
    this.fireCooldown = this.cfg.FIRE_INTERVAL;
    this.shotCounter++;

    /* --- нагрев --- */
    this.heat.value = Math.min(this.cfg.HEAT_MAX, this.heat.value + this.cfg.HEAT_PER_SHOT);
    if (this.heat.value >= this.cfg.HEAT_JAM_THRESHOLD && !this.heat.jammed) {
      this.heat.jammed = true;
      this.audio?.jam();
      this.setStateMessage('ПЕРЕГРЕВ · ПЕРЕКЛИНИЛО', 2.0);
    }

    /* --- направление со спредом --- */
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
    );
    const heatRatio = this.heat.value / this.cfg.HEAT_MAX;
    const moveFactor = Math.min(this.player.planarSpeed / this.player.walkSpeed, 1.4);
    const spread = (this.cfg.SPREAD_BASE +
                    moveFactor * this.cfg.SPREAD_MOVE +
                    heatRatio * this.cfg.SPREAD_HEAT) *
                    (1 - this.adsAmount * (1 - this.cfg.SPREAD_ADS_MULT));

    const upV = new THREE.Vector3(0, 1, 0);
    const rightV = new THREE.Vector3().crossVectors(dir, upV).normalize();
    const trueUp = new THREE.Vector3().crossVectors(rightV, dir).normalize();
    dir.addScaledVector(rightV, (Math.random() - 0.5) * spread * 2)
       .addScaledVector(trueUp, (Math.random() - 0.5) * spread * 2)
       .normalize();

    this._raycaster.set(this.camera.position.clone(), dir);
    const hits = this._raycaster.intersectObjects(this.hittables, false);

    let endPoint, hitInfo = null;
    if (hits.length > 0) { hitInfo = hits[0]; endPoint = hitInfo.point.clone(); }
    else endPoint = this.camera.position.clone().addScaledVector(dir, 200);

    /* --- мировые координаты дула --- */
    this.weaponRoot.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld(true);
    const muzzleCam = this.muzzle.clone().applyMatrix4(this.weaponRoot.matrixWorld);
    const muzzleWorld = muzzleCam.clone().applyMatrix4(this.camera.matrixWorld);

    if (Math.random() < 0.55) this.effects?.spawnTracer(muzzleWorld, endPoint);

    this.flashGroup.visible = true;
    this.flashGroup.rotation.z = Math.random() * Math.PI * 2;
    this.flashGroup.scale.setScalar(0.9 + Math.random() * 0.5);
    this.flashLight.intensity = 10 + Math.random() * 5;
    this.worldFlashLight.position.copy(muzzleWorld);
    this.worldFlashLight.intensity = 55;
    this.flashTimer = this.cfg.FLASH_TIME;

    /* --- гильза --- */
    if (Math.random() < 0.5) {
      const ejectLocal = new THREE.Vector3(-0.055, -0.020, 0.015);
      const ejectCam = ejectLocal.clone().applyMatrix4(this.weaponRoot.matrixWorld);
      const ejectWorld = ejectCam.clone().applyMatrix4(this.camera.matrixWorld);
      const ejectDir = new THREE.Vector3(0.3, -1, 0.3).applyEuler(
        new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
      );
      this.effects?.spawnCasing(ejectWorld, ejectDir.multiplyScalar(2.5));
    }

    /* --- попадание --- */
    if (hitInfo && this.effects) {
      const n = hitInfo.face
        ? hitInfo.face.normal.clone().transformDirection(hitInfo.object.matrixWorld)
        : dir.clone().negate();
      this.effects.addDecal(hitInfo.point, n, 0.024);

      const sparkCount = 2 + Math.floor(Math.random() * 3);
      for (let s = 0; s < sparkCount; s++) {
        const v = n.clone().multiplyScalar(1.5 + Math.random() * 2.0)
          .add(new THREE.Vector3(
            (Math.random() - 0.5) * 2.5,
            Math.random() * 2.0,
            (Math.random() - 0.5) * 2.5
          ));
        this.effects.spawnParticle(hitInfo.point, v, 0xffc060, 0.20 + Math.random() * 0.25, 1.2, 0.09);
      }

      if (this.audio) {
        if (hitInfo.object?.userData?.isPlate) this.audio.ping();
        else this.audio.impact();
      }

      if (this._crossEl) {
        this._crossEl.classList.add('hit');
        clearTimeout(this._hitT);
        this._hitT = setTimeout(() => this._crossEl.classList.remove('hit'), 70);
      }
    }

    this.audio?.shot();

    /* ====================================================================
       СИЛЬНАЯ РАНДОМНАЯ ОТДАЧА
       ==================================================================== */
    const i = Math.min(this.shotCounter, 40);
    const burstGrow   = Math.min(i / this.cfg.RECOIL_BURST_RAMP, 1);
    const heatPenalty = 1 + heatRatio * this.cfg.RECOIL_HEAT_MULT;
    const recoilScale = (1 - this.adsAmount * this.cfg.RECOIL_ADS_MULT) * burstGrow * heatPenalty;

    /* --- вертикальный толчок --- */
    const vertKick = (this.cfg.RECOIL_VERT_MIN +
                      Math.random() * (this.cfg.RECOIL_VERT_MAX - this.cfg.RECOIL_VERT_MIN))
                     * recoilScale;
    this.player.pitch += vertKick;
    if (Math.random() < 0.25) this.player.pitch += Math.random() * 0.008 * recoilScale;

    /* --- рандомный дрейф --- */
    this.recoilDriftX += (Math.random() - 0.5) * this.cfg.DRIFT_IMPULSE_X * recoilScale;
    this.recoilDriftY += (Math.random() - 0.5) * this.cfg.DRIFT_IMPULSE_Y * recoilScale;
    this.recoilDriftX = Math.max(-this.cfg.DRIFT_MAX_X, Math.min(this.cfg.DRIFT_MAX_X, this.recoilDriftX));
    this.recoilDriftY = Math.max(-this.cfg.DRIFT_MAX_Y, Math.min(this.cfg.DRIFT_MAX_Y, this.recoilDriftY));

    this.player.yaw += this.recoilDriftX;
    this.player.pitch += this.recoilDriftY;
    this.player.yaw += (Math.random() - 0.5) * this.cfg.DRIFT_INSTANT_X * recoilScale;
    this.player.pitch = Math.max(-this.player.pitchLimit,
                        Math.min(this.player.pitchLimit, this.player.pitch));

    /* --- физический толчок модели --- */
    const K = this.cfg;
    this.kickPos.z += (K.KICK_POS_Z.min + Math.random() * (K.KICK_POS_Z.max - K.KICK_POS_Z.min)) * recoilScale;
    this.kickPos.y += (K.KICK_POS_Y.min + Math.random() * (K.KICK_POS_Y.max - K.KICK_POS_Y.min)) * recoilScale;
    this.kickPos.x += (Math.random() - 0.5) * K.KICK_POS_X.amp * recoilScale;
    this.kickRot.x += (K.KICK_ROT_X.min + Math.random() * (K.KICK_ROT_X.max - K.KICK_ROT_X.min)) * recoilScale;
    this.kickRot.z += (Math.random() - 0.5) * K.KICK_ROT_Z.amp * recoilScale;
    this.kickRot.y += (Math.random() - 0.5) * K.KICK_ROT_Y.amp * recoilScale;

    /* --- тряска камеры --- */
    this.camShakeVel.x += (Math.random() - 0.5) * 14;
    this.camShakeVel.y += (Math.random() - 0.5) * 14 + 3;
    this.camShakeVel.z += (Math.random() - 0.5) * 10;
  }

  _emitAmmo() {
    if (this._onAmmoChange) this._onAmmoChange(this.ammo, this.reserve);
    this._updateHeatHud();
  }

  _updateHeatHud() {
    const pct = Math.min(this.heat.value, this.cfg.HEAT_MAX) / this.cfg.HEAT_MAX * 100;
    if (this._heatFillEl) this._heatFillEl.style.width = pct + '%';
    if (this._heatValEl)  this._heatValEl.textContent = Math.round(pct) + '%';
  }

  /* ========================================================================
     ОБНОВЛЕНИЕ
     ======================================================================== */

  update(dt) {
    this._updateState(dt);
    this._updateHeat(dt);
    this._updateWeapon(dt);
    this._updateBarrelSpin(dt);
    this._updateFiring(dt);
    this._updateFlash(dt);
    this._applyToCamera();
    this._applyHudOpacity();
    this._updateHeatHud();

    /* --- bloom strength --- */
    if (this._onBloomStrength) {
      const heatRatio = this.heat.value / this.cfg.HEAT_MAX;
      this._onBloomStrength(0.85 + heatRatio * 0.5);
    }
  }

  /* ---------- машина состояний ---------- */
  _updateState(dt) {
    if (this.state === 'drawing') {
      this.time += dt;
      if (this.time / this.cfg.DRAW_DUR >= 1) { this.state = 'idle'; this.time = 0; }
    } else if (this.state === 'reloading') {
      this.time += dt;
      this._reloadStep();
      if (this.time >= this.cfg.RELOAD_DUR) { this.state = 'idle'; this.time = 0; }
    } else if (this.state === 'inspecting') {
      this.time += dt;
      if (this.time >= this.cfg.INSPECT_DUR) { this.state = 'idle'; this.time = 0; }
    }
  }

  /* ---------- перезарядка ---------- */
  _reloadStep() {
    const t = this.time;
    const T = this.cfg.RELOAD_TIMELINE;
    const F = this.reloadFlags;

    if (!F.coverOpen && t >= T.coverOpen) {
      F.coverOpen = true;
      this.audio?.click(0.35, 1200, 0.06);
      this.audio?.thunk(0.35, 250);
    }
    if (!F.boxOut && t >= T.boxOut) {
      F.boxOut = true;
      this.audio?.thunk(0.4, 180);
      setTimeout(() => this.audio?.click(0.3, 900, 0.08), 100);
      if (this.ammoBoxGroup) this.ammoBoxGroup.visible = false;
    }
    if (!F.boxIn && t >= T.boxIn) {
      F.boxIn = true;
      if (this.ammoBoxGroup) this.ammoBoxGroup.visible = true;
      this.audio?.thunk(0.45, 160);
      this.audio?.click(0.4, 1000, 0.07);
    }
    if (!F.beltFed && t >= T.beltFed) {
      F.beltFed = true;
      for (let i = 0; i < 5; i++) {
        setTimeout(() => this.audio?.click(0.30, 1500 + Math.random() * 400, 0.04), i * 110);
      }
    }
    if (!F.coverClosed && t >= T.coverClosed) {
      F.coverClosed = true;
      this.audio?.thunk(0.55, 200);
      this.audio?.click(0.4, 1400, 0.08);
    }
    if (!F.charged && t >= T.charged) {
      F.charged = true;
      this.audio?.click(0.5, 900, 0.12);
      setTimeout(() => this.audio?.click(0.55, 2000, 0.10), 180);
      setTimeout(() => this.audio?.thunk(0.5, 280), 280);
      const need = this.cfg.MAG_SIZE - this.ammo;
      const give = Math.min(need, this.reserve);
      this.ammo    += give;
      this.reserve -= give;
      this._emitAmmo();
    }
  }

  /* ---------- нагрев, дым, искры, цвет стволов ---------- */
  _updateHeat(dt) {
    const firing = (this.state === 'idle') && this.triggerHeld &&
                   !this.heat.jammed && this.ammo > 0;

    if (!firing) {
      const cool = this.heat.jammed ? this.cfg.HEAT_COOL_RATE_JAMMED : this.cfg.HEAT_COOL_RATE;
      this.heat.value = Math.max(0, this.heat.value - cool * dt);
    }

    this.heat.smoothedHeat += (this.heat.value - this.heat.smoothedHeat) * Math.min(dt * 4, 1);
    const ratio = this.heat.smoothedHeat / this.cfg.HEAT_MAX;

    /* снятие заклинивания */
    if (this.heat.jammed && this.heat.value < this.cfg.HEAT_UNJAM_LEVEL) {
      this.heat.jammed = false;
      this.setStateMessage('ГОТОВО', 0.6);
    }

    /* --- цвет ствола: 5 стадий --- */
    const C = this._barrelColors;
    const tc = this._tempColor;
    if (ratio < 0.25) {
      tc.copy(C.cold);
    } else if (ratio < 0.45) {
      tc.copy(C.cold).lerp(C.warm, (ratio - 0.25) / 0.20);
    } else if (ratio < 0.70) {
      tc.copy(C.warm).lerp(C.hot, (ratio - 0.45) / 0.25);
    } else if (ratio < 0.88) {
      tc.copy(C.hot).lerp(C.veryHot, (ratio - 0.70) / 0.18);
    } else {
      tc.copy(C.veryHot).lerp(C.molten, (ratio - 0.88) / 0.12);
    }
    this.materials.barrel.color.copy(tc);

    let emissiveIntensity = 0;
    if (ratio > 0.45) {
      const k = (ratio - 0.45) / 0.55;
      emissiveIntensity = Math.pow(k, 1.6) * 3.5;
    }
    this.materials.barrel.emissiveIntensity = emissiveIntensity;
    if (ratio < 0.75) this.materials.barrel.emissive.setHex(0xff1800);
    else               this.materials.barrel.emissive.setHex(0xff5020);

    /* --- дым --- */
    if (this.heat.value > this.cfg.HEAT_SMOKE_THRESHOLD) {
      this.heat.smokeTimer += dt;
      const smokeRatio = (this.heat.value - this.cfg.HEAT_SMOKE_THRESHOLD) /
                         (this.cfg.HEAT_MAX - this.cfg.HEAT_SMOKE_THRESHOLD);
      const interval = Math.max(0.008, 0.13 - smokeRatio * 0.12);
      while (this.heat.smokeTimer > interval) {
        this.heat.smokeTimer -= interval;
        this.weaponRoot.updateWorldMatrix(true, true);

        const sources = [
          new THREE.Vector3((Math.random() - 0.5) * 0.10, -0.02, -0.08),
          new THREE.Vector3(0.02, 0.0, -0.15),
          new THREE.Vector3(-0.04, 0.02, -0.05)
        ];
        const localPos = sources[Math.floor(Math.random() * sources.length)];
        const worldPos = localPos.clone()
          .applyMatrix4(this.weaponRoot.matrixWorld)
          .applyMatrix4(this.camera.matrixWorld);

        const v = new THREE.Vector3(
          (Math.random() - 0.5) * 0.6,
          0.5 + Math.random() * 1.0,
          (Math.random() - 0.5) * 0.4
        ).applyEuler(new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ'));

        let smokeColor, smokeSize, smokeLife;
        if (smokeRatio < 0.25) {
          smokeColor = 0xb0b0b0; smokeSize = 0.25; smokeLife = 0.9 + Math.random() * 0.6;
        } else if (smokeRatio < 0.65) {
          smokeColor = 0x707070; smokeSize = 0.40; smokeLife = 1.4 + Math.random() * 1.0;
        } else {
          smokeColor = 0x282828; smokeSize = 0.55; smokeLife = 2.0 + Math.random() * 1.5;
        }
        this.effects?.spawnParticle(worldPos, v, smokeColor, smokeLife, 0.08, smokeSize);

        if (Math.random() < 0.6) {
          this.effects?.spawnParticle(
            worldPos, v.clone().multiplyScalar(0.6),
            0x505050, smokeLife * 1.3, 0.06, smokeSize * 0.7
          );
        }
      }
    } else {
      this.heat.smokeTimer = 0;
    }

    /* --- искры --- */
    if (this.heat.value > this.cfg.HEAT_SPARKS_THRESHOLD) {
      this.heat.sparkTimer += dt;
      const sparkRatio = (this.heat.value - this.cfg.HEAT_SPARKS_THRESHOLD) /
                         (this.cfg.HEAT_MAX - this.cfg.HEAT_SPARKS_THRESHOLD);
      const interval = Math.max(0.05, 0.35 - sparkRatio * 0.28);
      while (this.heat.sparkTimer > interval) {
        this.heat.sparkTimer -= interval;
        this.weaponRoot.updateWorldMatrix(true, true);

        const localPos = new THREE.Vector3(
          (Math.random() - 0.5) * 0.06,
          (Math.random() - 0.5) * 0.06,
          -0.40 - Math.random() * 0.05
        );
        const worldPos = localPos.clone()
          .applyMatrix4(this.weaponRoot.matrixWorld)
          .applyMatrix4(this.camera.matrixWorld);

        const v = new THREE.Vector3(
          (Math.random() - 0.5) * 2.0,
          0.4 + Math.random() * 1.5,
          -1 - Math.random() * 2
        ).applyEuler(new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ'));

        this.effects?.spawnParticle(worldPos, v, 0xffb060, 0.35 + Math.random() * 0.4, 0.9, 0.10);
        if (Math.random() < 0.5) {
          this.effects?.spawnParticle(worldPos, v.clone().multiplyScalar(0.6), 0xff5020, 0.5, 0.8, 0.14);
        }
      }
    } else {
      this.heat.sparkTimer = 0;
    }
  }

  /* ---------- анимации viewmodel ---------- */
  _updateWeapon(dt) {
    const pos = new THREE.Vector3(this.cfg.BASE_POS.x, this.cfg.BASE_POS.y, this.cfg.BASE_POS.z);
    const rot = new THREE.Vector3(this.cfg.BASE_ROT.x, this.cfg.BASE_ROT.y, this.cfg.BASE_ROT.z);

    /* --- Доставание --- */
    if (this.state === 'drawing') {
      const t = Math.min(this.time / this.cfg.DRAW_DUR, 1);
      const k = 1 - _easeOutCubic(t);
      pos.y -= k * 0.7;
      pos.z += k * 0.18;
      rot.x -= k * 1.2;
      rot.z += k * 0.45;
      rot.y += k * 0.25;
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

    /* --- Перезарядка: наклон --- */
    if (this.state === 'reloading') {
      const t = this.time;
      const total = this.cfg.RELOAD_DUR;
      const tiltIn  = _smoothstep(0.0, 0.6, t);
      const tiltOut = 1 - _smoothstep(total - 0.8, total, t);
      const tilt = tiltIn * tiltOut;

      pos.z += 0.05 * tilt;
      pos.y -= 0.10 * tilt;
      pos.x -= 0.05 * tilt;
      rot.z += 0.55 * tilt;
      rot.x += 0.15 * tilt;
      rot.y -= 0.20 * tilt;

      if (t > 0.6 && t < total - 0.8) {
        pos.x += Math.sin(t * 22) * 0.003 * tilt;
        rot.z += Math.sin(t * 18) * 0.008 * tilt;
      }
    }

    /* --- Инерция (sway) --- */
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

    /* --- Отдача (пружина) --- */
    const stiff = 280, damp = 15;
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
    this.camShakeVel.multiplyScalar(Math.max(0, 1 - 5 * dt));
    this.camShake.addScaledVector(this.camShakeVel, dt * 0.012);
    this.camShake.multiplyScalar(Math.max(0, 1 - 6 * dt));

    /* --- применяем --- */
    this.weaponRoot.position.copy(pos);
    this.weaponRoot.rotation.set(rot.x, rot.y, rot.z);
  }

  /* ---------- вращение блока стволов ---------- */
  _updateBarrelSpin(dt) {
    if (!this.rotatingAssembly) return;
    let targetSpeed;
    if (this.state === 'idle' && this.triggerHeld && !this.heat.jammed && this.ammo > 0) {
      targetSpeed = this.cfg.SPIN_FIRING;
    } else if (this.heat.jammed) {
      targetSpeed = 0;
    } else {
      targetSpeed = this.cfg.SPIN_IDLE;
    }
    if (this.heat.value > 80 && targetSpeed > 0) targetSpeed *= this.cfg.SPIN_HOT_MULT;
    this.rotatingAssembly.rotation.x += targetSpeed * dt;
  }

  /* ---------- автоогонь + затухание дрейфа ---------- */
  _updateFiring(dt) {
    if (this.fireCooldown > 0) this.fireCooldown -= dt;

    if (this.triggerHeld && this.state === 'idle' &&
        !this.heat.jammed && this.fireCooldown <= 0 && this.ammo > 0) {
      this.tryFire();
    } else if (!this.triggerHeld) {
      this.recoilDriftX *= Math.max(0, 1 - dt * 1.5);
      this.recoilDriftY *= Math.max(0, 1 - dt * 1.5);
    }
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
  _applyHudOpacity() {
    if (this._crossEl) {
      this._crossEl.style.opacity = String(1 - this.adsAmount * 0.6);
    }
  }

  /* ========================================================================
     ГЕТТЕРЫ
     ======================================================================== */

  get adsActive()  { return this.adsAmount > 0.5; }
  get isJammed()   { return this.heat.jammed; }
  get heatRatio()  { return this.heat.value / this.cfg.HEAT_MAX; }
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
     MINIGUN_CONFIG, createMinigun, createMinigunMaterials,
     MinigunEffects, WeaponAudio, PlayerController, MinigunController
   } from './minigun.js';

   const renderer = new THREE.WebGLRenderer({ antialias: true });
   renderer.setSize(innerWidth, innerHeight);
   renderer.autoClear = false;
   document.body.appendChild(renderer.domElement);

   const scene = new THREE.Scene();
   const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.05, 900);
   const weaponScene = new THREE.Scene();
   const weaponCamera = new THREE.PerspectiveCamera(58, innerWidth/innerHeight, 0.01, 30);

   // --- composer для bloom при нагреве ---
   const composer = new EffectComposer(renderer);
   composer.addPass(new RenderPass(scene, camera));
   const rwp = new RenderPass(weaponScene, weaponCamera); rwp.clear = false; composer.addPass(rwp);
   const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.6, 0.72);
   composer.addPass(bloomPass);
   composer.addPass(new OutputPass());

   // --- мир ---
   const hittables = [];     // меши, по которым стреляем
   const colliders = [];     // AABB для игрока

   // --- игрок и оружие ---
   const player  = new PlayerController({ startPos: { x:0, y:1.7, z:10 }, colliders });
   const audio   = new WeaponAudio(0.5);
   const effects = new MinigunEffects(scene, audio);

   const mg = new MinigunController({
     weaponScene, weaponCamera, scene, camera,
     player, hittables, colliders, effects, audio,
     crosshairEl: document.getElementById('cross'),
     heatFillEl:  document.getElementById('heatFill'),
     heatValEl:   document.getElementById('heatVal'),
     onAmmoChange: (a, r) => { /* обновить HUD *\/ },
     onStateMessage: (t, d) => { /* показать сообщение *\/ },
     onBloomStrength: (v) => { bloomPass.strength = v; }
   });
   mg.mount();

   document.addEventListener('keydown', e => { player.onKeyDown(e.code); mg.onKeyDown(e.code); });
   document.addEventListener('keyup',   e => { player.onKeyUp(e.code); });
   document.addEventListener('mousemove', e => {
     if (document.pointerLockElement) {
       player.lookSensMult = 1 - mg.adsAmount * MINIGUN_CONFIG.MOUSE_ADS_MULT;
       player.look(e.movementX, e.movementY);
       mg.onMouseMove(e.movementX, e.movementY);
     }
   });
   document.addEventListener('mousedown', e => mg.onMouseDown(e.button));
   document.addEventListener('mouseup',   e => mg.onMouseUp(e.button));
   document.addEventListener('contextmenu', e => e.preventDefault());

   const clock = new THREE.Clock();
   (function loop() {
     requestAnimationFrame(loop);
     const dt = Math.min(clock.getDelta(), 0.05);
     player.speedMult = 1 - mg.adsAmount * MINIGUN_CONFIG.MOVE_ADS_MULT;
     player.update(dt);
     mg.update(dt);
     effects.update(dt);

     camera.position.copy(player.pos);
     camera.rotation.set(
       player.pitch + mg.camShakeOffset.x,
       player.yaw   + mg.camShakeOffset.y,
       mg.camShakeOffset.z,
       'YXZ'
     );

     composer.render();
   })();
   ═══════════════════════════════════════════════════════════════════════════ */