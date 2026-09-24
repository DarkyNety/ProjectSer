/* ============================================================================
 * AK-47 · Reusable Three.js Module
 * ----------------------------------------------------------------------------
 * Один файл, из которого можно взять:
 *   - AK47_CONFIG          — все настраиваемые числа (позы, тайминги, отдача)
 *   - createAKMaterials()  — фабрика материалов оружия
 *   - createAK47()         — чистая модель (THREE.Group)
 *   - WeaponEffects        — искры, дырки, гильзы, трассеры, сброшенные магазины
 *   - WeaponAudio          — процедурный звук выстрела/кликов/рикошета
 *   - PlayerController     — движение WASD, прыжок, коллизии, обзор
 *   - AK47Controller       — вся механика: стрельба, перезарядка, осмотр,
 *                            прицеливание, инерция, отдача, вспышка, HUD-хуки
 * ----------------------------------------------------------------------------
 * Модель ориентирована:  +X = дуло, +Y = вверх, +Z = вправо (правая сторона).
 * Для viewmodel её обычно поворачивают:  ak.rotation.y = Math.PI/2;
 *                                        ak.scale.setScalar(0.01);
 * ==========================================================================*/

import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════════════
   1 · КОНФИГ
   ═══════════════════════════════════════════════════════════════════════════ */

export const AK47_CONFIG = {
  /* --- позы viewmodel (в пространстве weaponRoot) --- */
  BASE_POS: { x: 0.115,  y: -0.115,  z: -0.42  },
  BASE_ROT: { x: 0,      y: 0,       z: 0      },
  ADS_POS:  { x: 0,      y: -0.0525, z: -0.32  },
  ADS_ROT:  { x: 0,      y: 0,       z: 0      },
  MUZZLE:   { x: 0,      y: 0,       z: -0.475 },   // в локальных координатах weaponRoot

  /* --- патроны / тайминги --- */
  MAG_SIZE:      30,
  RESERVE:       90,
  FIRE_INTERVAL: 0.098,
  RELOAD_DUR:    2.75,
  INSPECT_DUR:   5.60,
  DRAW_DUR:      0.62,

  /* --- FOV --- */
  MAIN_FOV:              75,
  ADS_FOV_DELTA:        -24,
  WEAPON_FOV:            55,
  WEAPON_ADS_FOV_DELTA: -17,

  /* --- разброс --- */
  SPREAD_BASE:      0.0012,
  SPREAD_MOVE:      0.010,
  SPREAD_PER_SHOT:  0.00055,
  SPREAD_ADS_MULT:  0.25,

  /* --- отдача --- */
  RECOIL_VERT:        0.0125,
  RECOIL_VERT_GROWTH: 0.0082,
  RECOIL_HORIZ:       0.0052,
  RECOIL_HORIZ2:      0.0038,
  RECOIL_ADS_MULT:    0.65,

  /* --- мышь / игрок --- */
  MOUSE_SENS:     0.0022,
  MOUSE_ADS_MULT: 0.55,
  MOVE_ADS_MULT:  0.45,

  /* --- ключи анимации осмотра (t, position, rotation) --- */
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

export function makeNoiseTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 195 + (Math.random() - 0.5) * 95;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

export function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,240,190,0.95)');
  g.addColorStop(0.42, 'rgba(255,160,50,0.55)');
  g.addColorStop(0.72, 'rgba(255,90,10,0.18)');
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

export function makeHoleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0.00, 'rgba(0,0,0,1)');
  g.addColorStop(0.28, 'rgba(8,8,9,0.96)');
  g.addColorStop(0.42, 'rgba(60,60,62,0.55)');
  g.addColorStop(0.62, 'rgba(130,130,132,0.22)');
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

const _NOISE = makeNoiseTexture();

export function createAKMaterials() {
  return {
    steel:      new THREE.MeshStandardMaterial({ color: 0x4d545c, metalness: 1.0,  roughness: 0.50, roughnessMap: _NOISE }),
    steelDark:  new THREE.MeshStandardMaterial({ color: 0x2e3238, metalness: 1.0,  roughness: 0.56, roughnessMap: _NOISE }),
    phosphate:  new THREE.MeshStandardMaterial({ color: 0x353a41, metalness: 0.92, roughness: 0.70, roughnessMap: _NOISE }),
    blackMetal: new THREE.MeshStandardMaterial({ color: 0x1b1e22, metalness: 0.88, roughness: 0.62, roughnessMap: _NOISE }),
    polymer:    new THREE.MeshStandardMaterial({ color: 0x17191b, metalness: 0.06, roughness: 0.66 }),
    polymerSoft:new THREE.MeshStandardMaterial({ color: 0x0f1113, metalness: 0.03, roughness: 0.86 }),

    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9ecbff, metalness: 0.0, roughness: 0.06,
      transparent: true, opacity: 0.30, side: THREE.DoubleSide,
      clearcoat: 1.0, clearcoatRoughness: 0.05
    }),

    scopeGlass: new THREE.MeshPhysicalMaterial({
      color: 0x9ecbff, metalness: 0.0, roughness: 0.02,
      transparent: true, opacity: 0.24, side: THREE.DoubleSide,
      clearcoat: 1.0, clearcoatRoughness: 0.01,
      envMapIntensity: 2.2, depthWrite: false, toneMapped: true
    }),

    scopeGlassRear: new THREE.MeshPhysicalMaterial({
      color: 0x8fc0e8, metalness: 0.0, roughness: 0.02,
      transparent: true, opacity: 0.20, side: THREE.DoubleSide,
      clearcoat: 1.0, clearcoatRoughness: 0.01,
      envMapIntensity: 2.2, depthWrite: false, toneMapped: true
    }),

    dot: new THREE.MeshStandardMaterial({
      color: 0xff2a10, emissive: 0xff2a10, emissiveIntensity: 6,
      toneMapped: false, side: THREE.DoubleSide
    })
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · МОДЕЛЬ AK-47
   ═══════════════════════════════════════════════════════════════════════════ */

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  return mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
}
function cyl(r1, r2, h, seg, mat, x = 0, y = 0, z = 0, axis = 'x') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
function extrudeSide(points, depth, mat, bevel = 0.14) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 24, steps: 1
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}
function makeRail(length, width, M) {
  const g = new THREE.Group();
  const baseH = 0.45, toothH = 0.42;
  g.add(mesh(new THREE.BoxGeometry(length, baseH, width), M.steelDark, 0, baseH / 2, 0));
  const pitch = 1.05, toothW = 0.62;
  const n = Math.max(1, Math.floor((length - 0.5) / pitch));
  const start = -((n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) {
    g.add(mesh(new THREE.BoxGeometry(toothW, toothH, width), M.steelDark,
      start + i * pitch, baseH + toothH / 2, 0));
  }
  return g;
}
function makeMagazine(M) {
  const R = 27, W = 4.0, D = 3.0;
  const cx = 27, cy = -4.0;
  const a0 = Math.PI, a1 = Math.PI * 1.205;

  const shape = new THREE.Shape();
  shape.absarc(cx, cy, R + W / 2, a0, a1, false);
  shape.absarc(cx, cy, R - W / 2, a1, a0, true);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: D, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12,
    bevelSegments: 2, curveSegments: 56, steps: 1
  });
  geo.translate(0, 0, -D / 2);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, M.polymer);
}

/**
 * Строит полную модель AK-47 (без прицела ADS-позы — она в контроллере).
 * @param {object} [materials] — результат createAKMaterials() (по умолчанию новый набор)
 * @returns {THREE.Group} — группа с именами детей: 'bolt', 'magazine', 'optic', 'muzzle'
 */
export function createAK47(materials) {
  const M = materials || createAKMaterials();
  const rifle = new THREE.Group();
  rifle.name = 'AK47';

  /* ---------- СТВОЛЬНАЯ КОРОБКА ---------- */
  rifle.add(box(24, 5.3, 3.4, M.phosphate, -4, -1.75, 0));
  rifle.add(box(22, 1.0, 3.2, M.phosphate, -5, 1.4, 0));

  const topRail = makeRail(20, 2.2, M);
  topRail.position.set(-5, 1.9, 0);
  rifle.add(topRail);

  for (const rx of [-13.5, -9.5, 3.5, 6.5]) {
    rifle.add(cyl(0.22, 0.22, 3.6, 10, M.steelDark, rx, -2.2, 0, 'z'));
  }

  /* ---------- СТВОЛ ---------- */
  rifle.add(cyl(0.85, 0.85, 38, 28, M.steel, 23, 0, 0, 'x'));
  rifle.add(cyl(1.05, 1.05, 3.8, 24, M.steelDark, 43.6, 0, 0, 'x'));
  rifle.add(cyl(1.15, 1.15, 0.55, 24, M.steelDark, 42.0, 0, 0, 'x'));
  rifle.add(cyl(1.15, 1.15, 0.55, 24, M.steelDark, 45.3, 0, 0, 'x'));
  for (let i = 0; i < 3; i++) {
    rifle.add(box(0.5, 2.4, 2.4, M.blackMetal, 42.9 + i * 0.9, 0, 0));
  }

  /* ---------- МУШКА ---------- */
  rifle.add(box(3.4, 2.6, 2.6, M.steelDark, 39, 1.25, 0));
  rifle.add(cyl(0.22, 0.22, 1.9, 12, M.steel, 39, 3.1, 0, 'y'));
  rifle.add(box(1.3, 2.3, 0.45, M.steelDark, 39, 3.1, 1.05));
  rifle.add(box(1.3, 2.3, 0.45, M.steelDark, 39, 3.1, -1.05));

  /* ---------- ГАЗОВАЯ КАМОРА / ТРУБКА ---------- */
  rifle.add(box(2.5, 2.5, 2.6, M.steelDark, 7.2, 1.7, 0));
  rifle.add(cyl(0.62, 0.62, 23, 18, M.steel, 19.5, 2.65, 0, 'x'));
  rifle.add(box(2.8, 4.5, 2.6, M.steelDark, 30, 1.25, 0));

  /* ---------- ЦЕВЬЁ ---------- */
  rifle.add(box(20.5, 3.0, 3.6, M.polymer, 18.25, -1.9, 0));
  rifle.add(box(20.5, 1.7, 3.3, M.polymer, 18.25, 1.15, 0));

  const railBottom = makeRail(12, 2.4, M);
  railBottom.rotation.x = Math.PI;
  railBottom.position.set(19.5, -3.4, 0);
  rifle.add(railBottom);

  const railLeft = makeRail(10, 2.0, M);
  railLeft.rotation.x = Math.PI / 2;
  railLeft.position.set(19.5, -1.9, 1.8);
  rifle.add(railLeft);

  const railRight = makeRail(10, 2.0, M);
  railRight.rotation.x = -Math.PI / 2;
  railRight.position.set(19.5, -1.9, -1.8);
  rifle.add(railRight);

  rifle.add(cyl(1.35, 1.35, 1.3, 20, M.steelDark, 10.6, 0, 0, 'x'));
  rifle.add(cyl(1.30, 1.30, 1.1, 20, M.steelDark, 28.6, 0, 0, 'x'));
  rifle.add(cyl(0.16, 0.16, 27, 8, M.steel, 25, -1.55, 1.4, 'x'));

  /* ---------- ПРИЦЕЛ (ружейный) ---------- */
  rifle.add(box(3.6, 1.7, 3.2, M.steelDark, 4, 1.6, 0));
  const leaf = box(3.4, 0.32, 2.6, M.steel, 4, 2.55, 0);
  leaf.rotation.z = -0.16;
  rifle.add(leaf);

  /* ---------- ЗАТВОРНАЯ РАМКА / РУКОЯТКА ---------- */
  const bolt = new THREE.Group();
  bolt.name = 'bolt';
  bolt.add(cyl(0.32, 0.32, 1.9, 12, M.steel, 1.5, 0.35, 2.55, 'z'));
  bolt.add(cyl(0.52, 0.52, 0.7, 14, M.steelDark, 1.5, 0.35, 3.4, 'z'));
  rifle.add(bolt);

  /* ---------- ПРЕДОХРАНИТЕЛЬ ---------- */
  const safety = box(6.2, 1.05, 0.38, M.steelDark, -4.2, -1.5, 1.85);
  safety.rotation.z = -0.10;
  rifle.add(safety);
  rifle.add(cyl(0.5, 0.5, 0.5, 12, M.steelDark, -7.2, -1.9, 1.9, 'z'));

  /* ---------- СПУСКОВАЯ СКОБА И СПУСК ---------- */
  rifle.add(box(6.2, 0.5, 2.2, M.steelDark, -6.2, -6.4, 0));
  rifle.add(box(0.5, 2.3, 2.2, M.steelDark, -3.4, -5.4, 0));
  rifle.add(box(0.5, 2.3, 2.2, M.steelDark, -9.1, -5.4, 0));

  const trigger = box(0.55, 2.1, 0.85, M.steel, -5.9, -5.3, 0);
  trigger.rotation.z = 0.18;
  rifle.add(trigger);

  rifle.add(box(1.0, 0.7, 1.4, M.steelDark, -2.4, -4.9, 0));

  /* ---------- МАГАЗИН ---------- */
  const magazine = makeMagazine(M);
  magazine.name = 'magazine';
  rifle.add(magazine);

  (function addMagPlate() {
    const a1 = Math.PI * 1.205;
    const R = 27, cx = 27, cy = -4.0;
    const px = cx + R * Math.cos(a1) + 0.6 * 0.22;
    const py = cy + R * Math.sin(a1) - 0.6 * 0.22;
    const plate = box(4.8, 0.55, 3.35, M.polymerSoft, px, py, 0);
    plate.rotation.z = a1;
    rifle.add(plate);
  })();

  for (let i = 0; i < 4; i++) {
    const ang = Math.PI + (i + 0.6) * 0.145;
    const px = 27 + 27 * Math.cos(ang);
    const py = -4.0 + 27 * Math.sin(ang);
    const rib = box(0.28, 3.0, 0.35, M.polymerSoft, px, py, 1.62);
    rib.rotation.z = ang + Math.PI / 2;
    rifle.add(rib);
  }

  /* ---------- ПИСТОЛЕТНАЯ РУКОЯТКА ---------- */
  const grip = extrudeSide([
    [-10.0, -3.5], [-14.2, -3.5], [-17.6, -12.4], [-14.6, -13.5]
  ], 3.0, M.polymerSoft);
  rifle.add(grip);

  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    const gx = -11.2 - t * 3.0;
    const gy = -5.6 - t * 6.4;
    const rg = box(0.35, 1.9, 3.15, M.polymer, gx, gy, 0);
    rg.rotation.z = -0.36;
    rifle.add(rg);
  }

  /* ---------- ПРИКЛАД ---------- */
  const stock = extrudeSide([
    [-15.0, 0.9], [-22.0, 0.5], [-28.0, 0.5], [-36.0, -0.5],
    [-38.5, -2.5], [-38.0, -7.0], [-15.0, -4.4]
  ], 3.2, M.polymer);
  rifle.add(stock);

  const buttpad = box(1.2, 5.5, 3.5, M.polymerSoft, -38.6, -4.75, 0);
  buttpad.rotation.z = -0.15;
  rifle.add(buttpad);

  const cheekRest = box(8.0, 1.2, 3.0, M.polymerSoft, -30.0, 0.8, 0);
  cheekRest.rotation.z = -0.08;
  rifle.add(cheekRest);

  rifle.add(cyl(1.1, 1.1, 3.6, 16, M.steelDark, -15.0, -1.75, 0, 'z'));
  rifle.add(box(1.5, 1.5, 3.8, M.steelDark, -15.0, -1.75, 0));
  for (let i = -1; i <= 1; i++) {
    rifle.add(box(0.3, 1.2, 3.8, M.steel, -15.0, -1.75 + i * 0.6, 0));
  }

  const sling1 = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.16, 8, 20), M.steelDark);
  sling1.position.set(-35.0, 0.0, 0);
  sling1.rotation.y = Math.PI / 2;
  rifle.add(sling1);

  const sling2 = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.15, 8, 20), M.steelDark);
  sling2.position.set(30, -0.3, 1.5);
  sling2.rotation.x = Math.PI / 2;
  rifle.add(sling2);

  /* ---------- КОЛЛИМАТОРНЫЙ ПРИЦЕЛ ---------- */
  (function addOptic() {
    const optic = new THREE.Group();
    optic.name = 'optic';

    optic.add(box(3.6, 0.5, 2.8, M.blackMetal, 0, -2.55, 0));
    optic.add(box(0.8, 2.0, 1.6, M.blackMetal, 1.25, -1.55, 0));
    optic.add(box(0.8, 2.0, 1.6, M.blackMetal, -1.25, -1.55, 0));
    optic.add(cyl(0.13, 0.13, 0.18, 8, M.steel, 1.25, -1.55, 0.85, 'z'));
    optic.add(cyl(0.13, 0.13, 0.18, 8, M.steel, -1.25, -1.55, 0.85, 'z'));

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x14171a, metalness: 0.92, roughness: 0.40, roughnessMap: _NOISE
    });
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.35, 3.6, 36, 1, true), bodyMat
    );
    tube.rotation.z = Math.PI / 2;
    optic.add(tube);

    const frontBezel = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.55, 0.55, 36, 1, true), M.blackMetal
    );
    frontBezel.rotation.z = Math.PI / 2;
    frontBezel.position.set(1.75, 0, 0);
    optic.add(frontBezel);

    const frontRing = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.09, 10, 36), M.steelDark);
    frontRing.rotation.y = Math.PI / 2;
    frontRing.position.set(2.02, 0, 0);
    optic.add(frontRing);

    const rearBezel = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.55, 0.55, 36, 1, true), M.blackMetal
    );
    rearBezel.rotation.z = Math.PI / 2;
    rearBezel.position.set(-1.75, 0, 0);
    optic.add(rearBezel);

    const rearRing = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.09, 10, 36), M.steelDark);
    rearRing.rotation.y = Math.PI / 2;
    rearRing.position.set(-2.02, 0, 0);
    optic.add(rearRing);

    const frontGlass = new THREE.Mesh(new THREE.CircleGeometry(1.44, 40), M.scopeGlass);
    frontGlass.rotation.y = Math.PI / 2;
    frontGlass.position.set(1.94, 0, 0);
    frontGlass.renderOrder = 5;
    optic.add(frontGlass);

    const rearGlass = new THREE.Mesh(new THREE.CircleGeometry(1.44, 40), M.scopeGlassRear);
    rearGlass.rotation.y = -Math.PI / 2;
    rearGlass.position.set(-1.94, 0, 0);
    rearGlass.renderOrder = 5;
    optic.add(rearGlass);

    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), M.dot);
    dot.rotation.y = -Math.PI / 2;
    dot.position.set(0.9, 0, 0);
    dot.renderOrder = 1;
    optic.add(dot);

    const dotGlow = new THREE.Mesh(
      new THREE.CircleGeometry(0.28, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff2a10, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      })
    );
    dotGlow.rotation.y = -Math.PI / 2;
    dotGlow.position.set(0.86, 0, 0);
    dotGlow.renderOrder = 2;
    optic.add(dotGlow);

    optic.add(cyl(0.42, 0.42, 0.65, 18, M.blackMetal, 0, 1.6, 0, 'y'));
    optic.add(cyl(0.5, 0.5, 0.09, 18, M.steelDark, 0, 1.98, 0, 'y'));
    optic.add(cyl(0.38, 0.38, 0.55, 18, M.blackMetal, 0, 0, 1.55, 'z'));
    optic.add(cyl(0.46, 0.46, 0.08, 18, M.steelDark, 0, 0, 1.88, 'z'));
    optic.add(cyl(0.28, 0.28, 0.28, 12, M.steel, -1.35, 1.5, 0, 'y'));

    optic.position.set(-1.4, 5.25, 0);
    rifle.add(optic);
  })();

  /* ---------- дульный маркер (пустышка) ---------- */
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(46, 0, 0);
  rifle.add(muzzle);

  rifle.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return rifle;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · ЭФФЕКТЫ (искры, дырки, гильзы, трассеры, сброшенные магазины)
   ═══════════════════════════════════════════════════════════════════════════ */

export class WeaponEffects {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxParticles = options.maxParticles ?? 900;
    this.maxDecals    = options.maxDecals    ?? 90;
    this.maxCasings   = options.maxCasings   ?? 45;

    /* --- частицы --- */
    this.pPositions = new Float32Array(this.maxParticles * 3);
    this.pColors    = new Float32Array(this.maxParticles * 3);
    this.pData = [];
    for (let i = 0; i < this.maxParticles; i++) {
      this.pData.push({ life: 0, maxLife: 1, vel: new THREE.Vector3(), base: new THREE.Color(), grav: 1 });
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPositions, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pColors, 3));

    this.pointsMat = new THREE.PointsMaterial({
      size: 0.075, map: makeDotTexture(), vertexColors: true,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true
    });
    this.points = new THREE.Points(pGeo, this.pointsMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pGeo = pGeo;
    this.pCursor = 0;

    /* --- дырки --- */
    this.holeTex = makeHoleTexture();
    this.decalMat = new THREE.MeshBasicMaterial({
      map: this.holeTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false
    });
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decals = [];
    this.decalCursor = 0;
    for (let i = 0; i < this.maxDecals; i++) {
      const m = new THREE.Mesh(decalGeo, this.decalMat);
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.decals.push(m);
    }

    /* --- гильзы --- */
    this.casings = [];
    this.casingGeo = new THREE.CylinderGeometry(0.0048, 0.0052, 0.025, 8);
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1.0, roughness: 0.32 });

    /* --- трассеры --- */
    this.tracers = [];
    this.tracerGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 6, 1, true);
    this.tracerGeo.translate(0, 0.5, 0);
    this.tracerGeo.rotateX(Math.PI / 2);

    /* --- сброшенные магазины --- */
    this.droppedMags = [];
  }

  /* ---------- частицы ---------- */
  spawnParticle(pos, vel, color, life, grav = 1) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % this.maxParticles;
    const d = this.pData[i];
    d.life = life; d.maxLife = life;
    d.vel.copy(vel);
    d.base.set(color);
    d.grav = grav;
    this.pPositions[i * 3]     = pos.x;
    this.pPositions[i * 3 + 1] = pos.y;
    this.pPositions[i * 3 + 2] = pos.z;
    this.pColors[i * 3]     = d.base.r;
    this.pColors[i * 3 + 1] = d.base.g;
    this.pColors[i * 3 + 2] = d.base.b;
  }

  /* ---------- дырки ---------- */
  addDecal(point, normal, scale = 0.055) {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.maxDecals;
    d.visible = true;
    d.position.copy(point).addScaledVector(normal, 0.006);
    d.lookAt(point.clone().add(normal));
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(scale * (0.75 + Math.random() * 0.6));
  }

  /* ---------- гильзы ---------- */
  spawnCasing(worldPos, baseVel) {
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    m.position.copy(worldPos);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.castShadow = true;
    this.scene.add(m);
    this.casings.push({
      obj: m,
      vel: baseVel.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.6,
        1.4 + Math.random() * 0.9,
        (Math.random() - 0.5) * 0.6
      )),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.5) * 22
      ),
      life: 4.5, bounced: 0
    });
    if (this.casings.length > this.maxCasings) {
      const old = this.casings.shift();
      this.scene.remove(old.obj);
    }
  }

  /* ---------- трассеры ---------- */
  spawnTracer(from, to) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd48a, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    });
    const m = new THREE.Mesh(this.tracerGeo, mat);
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, from.distanceTo(to));
    this.scene.add(m);
    this.tracers.push({ obj: m, mat, life: 0.055 });
  }

  /* ---------- сброшенный магазин ---------- */
  spawnDroppedMag(sourceMesh) {
    sourceMesh.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    sourceMesh.matrixWorld.decompose(p, q, s);

    const clone = new THREE.Mesh(sourceMesh.geometry, sourceMesh.material);
    clone.position.copy(p);
    clone.quaternion.copy(q);
    clone.scale.copy(s);
    clone.castShadow = true;
    this.scene.add(clone);

    this.droppedMags.push({
      obj: clone,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.35, -0.5, (Math.random() - 0.5) * 0.35),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 5
      ),
      life: 6
    });
  }

  /* ---------- обновление ---------- */
  update(dt) {
    /* частицы */
    const P = this.pData;
    const pos = this.pPositions, col = this.pColors;
    for (let i = 0; i < this.maxParticles; i++) {
      const d = P[i];
      if (d.life <= 0) {
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
        continue;
      }
      d.life -= dt;
      const t = Math.max(d.life / d.maxLife, 0);
      d.vel.y -= 9.81 * d.grav * dt;
      d.vel.multiplyScalar(1 - 2.2 * dt);
      pos[i * 3]     += d.vel.x * dt;
      pos[i * 3 + 1] += d.vel.y * dt;
      pos[i * 3 + 2] += d.vel.z * dt;
      if (pos[i * 3 + 1] < 0.02) {
        pos[i * 3 + 1] = 0.02;
        d.vel.y *= -0.3; d.vel.x *= 0.6; d.vel.z *= 0.6;
      }
      const k = t * t;
      col[i * 3]     = d.base.r * k;
      col[i * 3 + 1] = d.base.g * k;
      col[i * 3 + 2] = d.base.b * k;
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;

    /* гильзы */
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      if (c.life <= 0) { this.scene.remove(c.obj); this.casings.splice(i, 1); continue; }
      c.vel.y -= 12 * dt;
      c.obj.position.addScaledVector(c.vel, dt);
      c.obj.rotation.x += c.spin.x * dt;
      c.obj.rotation.y += c.spin.y * dt;
      c.obj.rotation.z += c.spin.z * dt;
      if (c.obj.position.y < 0.012) {
        c.obj.position.y = 0.012;
        c.vel.y *= -0.32;
        c.vel.x *= 0.62; c.vel.z *= 0.62;
        c.spin.multiplyScalar(0.5);
        if (c.bounced++ > 3) { c.vel.set(0, 0, 0); c.spin.set(0, 0, 0); }
      }
    }

    /* трассеры */
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.mat.opacity = Math.max(t.life / 0.055, 0) * 0.9;
      if (t.life <= 0) { this.scene.remove(t.obj); t.mat.dispose(); this.tracers.splice(i, 1); }
    }

    /* сброшенные магазины */
    for (let i = this.droppedMags.length - 1; i >= 0; i--) {
      const d = this.droppedMags[i];
      d.life -= dt;
      if (d.life <= 0) { this.scene.remove(d.obj); this.droppedMags.splice(i, 1); continue; }
      d.vel.y -= 14 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
      if (d.obj.position.y < 0.03) {
        d.obj.position.y = 0.03;
        d.vel.y *= -0.2; d.vel.x *= 0.5; d.vel.z *= 0.5;
        d.spin.multiplyScalar(0.6);
        if (Math.abs(d.vel.y) < 0.4) { d.vel.set(0, 0, 0); d.spin.set(0, 0, 0); }
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

      const len = Math.floor(this.actx.sampleRate * 0.6);
      this.noiseBuf = this.actx.createBuffer(1, len, this.actx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      console.warn('Audio недоступен', e);
    }
  }

  resume() {
    if (this.actx && this.actx.state === 'suspended') this.actx.resume();
  }

  shot() {
    if (!this.actx) return;
    const t = this.actx.currentTime;

    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = this.actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150;
    const lp = this.actx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(380, t + 0.20);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.30);
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.masterGain);
    src.start(t); src.stop(t + 0.32);

    const o = this.actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const og = this.actx.createGain();
    og.gain.setValueAtTime(0.65, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    o.connect(og); og.connect(this.masterGain);
    o.start(t); o.stop(t + 0.18);

    const src2 = this.actx.createBufferSource(); src2.buffer = this.noiseBuf;
    const bp = this.actx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 900; bp.Q.value = 0.7;
    const g2 = this.actx.createGain();
    g2.gain.setValueAtTime(0.0001, t + 0.05);
    g2.gain.linearRampToValueAtTime(0.10, t + 0.09);
    g2.gain.exponentialRampToValueAtTime(0.0005, t + 0.85);
    src2.connect(bp); bp.connect(g2); g2.connect(this.masterGain);
    src2.start(t); src2.stop(t + 0.9);
  }

  click(vol = 0.3, freq = 1400, dur = 0.055) {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.actx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 4;
    const g = this.actx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    src.connect(f); f.connect(g); g.connect(this.masterGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  impact() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(1800 + Math.random() * 900, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.09);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
    o.connect(g); g.connect(this.masterGain);
    o.start(t); o.stop(t + 0.13);
  }

  ping() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    [1560, 2340, 3120].forEach((f, i) => {
      const o = this.actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.actx.createGain();
      g.gain.setValueAtTime(0.13 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.55 + i * 0.1);
      o.connect(g); g.connect(this.masterGain);
      o.start(t); o.stop(t + 0.6);
    });
  }

  dryFire() { this.click(0.22, 2600, 0.04); }
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
    this.worldLimit  = opts.worldLimit  ?? 110;

    this.mouseSensitivity = opts.mouseSensitivity ?? AK47_CONFIG.MOUSE_SENS;
    this.lookSensMult     = 1;   // устанавливается снаружи (напр. под ADS)
    this.speedMult        = 1;   // устанавливается снаружи (напр. под ADS)

    this.keys     = Object.create(null);
    this.colliders = opts.colliders || [];
    this.onGround = true;
  }

  onKeyDown(code) { this.keys[code] = true;  }
  onKeyUp  (code) { this.keys[code] = false; }

  look(dx, dy) {
    const s = this.mouseSensitivity * this.lookSensMult;
    this.yaw   -= dx * s;
    this.pitch -= dy * s;
    this.pitch = Math.max(-this.pitchLimit, Math.min(this.pitchLimit, this.pitch));
  }

  /** Высота пола под точкой (по AABB-коллайдерам). */
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
                      moveZ > 0 && this.speedMult > 0.7; // не спринт при сильном ADS
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

    /* --- коллизии --- */
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

    /* --- пол --- */
    const gh = this.groundHeightAt(this.pos.x, this.pos.z);
    const floorY = gh + this.height;
    if (this.pos.y <= floorY) {
      this.pos.y = floorY;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    /* --- границы мира --- */
    const lim = this.worldLimit;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
  }

  /** Возвращает текущую горизонтальную скорость (для покачивания оружия). */
  get planarSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   8 · КОНТРОЛЛЕР AK-47
   ═══════════════════════════════════════════════════════════════════════════ */

/* --- вспомогательные easing --- */
const _smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _easeOutCubic = x => 1 - Math.pow(1 - x, 3);

export class AK47Controller {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.weaponScene  — сцена для viewmodel
   * @param {THREE.Camera} opts.weaponCamera
   * @param {THREE.Scene} opts.scene        — основная сцена
   * @param {THREE.Camera} opts.camera      — основная камера
   * @param {PlayerController} opts.player
   * @param {Array} [opts.hittables]        — объекты, по которым стреляем
   * @param {Array} [opts.colliders]        — AABB-коллайдеры (для игрока и стрельбы)
   * @param {WeaponEffects} [opts.effects]
   * @param {WeaponAudio} [opts.audio]
   * @param {HTMLElement} [opts.crosshairEl]
   * @param {Function} [opts.onAmmoChange]   — (ammo, reserve) => void
   * @param {Function} [opts.onStateMessage] — (text, time) => void
   * @param {Function} [opts.onFire]         — хук на выстрел (hitInfo|null) => void
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
    this._onFire         = opts.onFire         || null;

    /* --- модель --- */
    this.weaponRoot = new THREE.Group();
    this.weaponRoot.rotation.order = 'YXZ';
    this.weaponRoot.visible = false;

    const materials = opts.materials || createAKMaterials();
    this.ak = createAK47(materials);
    this.ak.rotation.y = Math.PI / 2;
    this.ak.scale.setScalar(0.01);
    this.weaponRoot.add(this.ak);

    this.magMesh  = this.ak.getObjectByName('magazine');
    this.boltMesh = this.ak.getObjectByName('bolt');

    /* --- конфиг (можно переопределить через opts.config) --- */
    this.cfg = Object.assign({}, AK47_CONFIG, opts.config || {});

    /* --- состояние --- */
    this.state        = 'holstered';
    this.time         = 0;
    this.ammo         = this.cfg.MAG_SIZE;
    this.reserve      = this.cfg.RESERVE;
    this.fireCooldown = 0;
    this.shotIndex    = 0;
    this.triggerHeld  = false;
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

    this.reloadFlags = {
      magDropped: false, magInserted: false,
      ammoGiven:  false, boltRacked:  false, magSpawned: false
    };

    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = 300;

    this._buildMuzzleFlash();
  }

  /* ---------- сборка вспышки выстрела ---------- */
  _buildMuzzleFlash() {
    const muzzle = new THREE.Vector3(this.cfg.MUZZLE.x, this.cfg.MUZZLE.y, this.cfg.MUZZLE.z);

    const flashGroup = new THREE.Group();
    flashGroup.position.copy(muzzle);
    flashGroup.visible = false;
    this.weaponRoot.add(flashGroup);
    this.flashGroup = flashGroup;

    const flashTex = makeFlashTexture();
    const flashMat = new THREE.MeshBasicMaterial({
      map: flashTex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false
    });

    const qA = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.30), flashMat);
    const qB = new THREE.Mesh(new THREE.PlaneGeometry(0.20, 0.20), flashMat);
    qB.rotation.z = Math.PI / 4;
    flashGroup.add(qA, qB);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.30, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb050, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false
      })
    );
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = -0.16;
    flashGroup.add(cone);

    const flashLight = new THREE.PointLight(0xffb060, 0, 3.5, 2);
    flashLight.position.copy(muzzle);
    this.weaponRoot.add(flashLight);
    this.flashLight = flashLight;

    const worldFlashLight = new THREE.PointLight(0xffb060, 0, 14, 2);
    this.scene.add(worldFlashLight);
    this.worldFlashLight = worldFlashLight;

    this.flashTimer = 0;
  }

  /** Добавить weaponRoot в сцену viewmodel. */
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
    if (button === 0) { this.triggerHeld = false; this.fireCooldown = 0; this.shotIndex = 0; }
    if (button === 2) { this.adsHeld = false; }
  }

  onMouseMove(dx, dy) {
    const swayScale = 1 - this.adsAmount * 0.9;
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
      setTimeout(() => this.audio?.click(0.2, 1600, 0.05), 220);
      setTimeout(() => this.audio?.click(0.18, 2200, 0.04), 380);
    }
  }

  cancelInspect() {
    if (this.state === 'inspecting') {
      this.state = 'idle';
      this.time  = 0;
      /* inspectOffsetActive = true, чтобы смещение плавно ушло в ноль */
    }
  }

  tryReload() {
    if (this.state === 'inspecting') this.cancelInspect();
    if (this.state !== 'idle') return;
    if (this.ammo >= this.cfg.MAG_SIZE) return;
    if (this.reserve <= 0) { this.setStateMessage('НЕТ ПАТРОНОВ'); return; }

    this.state = 'reloading';
    this.time  = 0;
    this.reloadFlags.magDropped = false;
    this.reloadFlags.magInserted = false;
    this.reloadFlags.ammoGiven = false;
    this.reloadFlags.boltRacked = false;
    this.reloadFlags.magSpawned = false;
    this.magMesh.visible = true;
    this.magMesh.position.set(0, 0, 0);
    this.boltMesh.position.set(0, 0, 0);
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
     ВЫСТРЕЛ
     ======================================================================== */

  tryFire() {
    if (this.state !== 'idle') return;
    if (this.fireCooldown > 0) return;

    if (this.ammo <= 0) {
      this.audio?.dryFire();
      this.fireCooldown = 0.28;
      this.kickRot.x += 0.02;
      return;
    }

    this.ammo--;
    this._emitAmmo();

    this.fireCooldown = this.cfg.FIRE_INTERVAL;

    /* --- направление с учётом разброса --- */
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
    );

    const moveFactor = Math.min(this.player.planarSpeed / this.player.walkSpeed, 1.4);
    const spreadBase = this.cfg.SPREAD_BASE +
                       moveFactor * this.cfg.SPREAD_MOVE +
                       Math.min(this.shotIndex, 20) * this.cfg.SPREAD_PER_SHOT;
    const spread = spreadBase * (1 - this.adsAmount * (1 - this.cfg.SPREAD_ADS_MULT));

    const upV    = new THREE.Vector3(0, 1, 0);
    const rightV = new THREE.Vector3().crossVectors(dir, upV).normalize();
    const trueUp = new THREE.Vector3().crossVectors(rightV, dir).normalize();
    dir.addScaledVector(rightV, (Math.random() - 0.5) * spread * 2)
       .addScaledVector(trueUp, (Math.random() - 0.5) * spread * 2)
       .normalize();

    /* --- рейкаст --- */
    this._raycaster.set(origin, dir);
    const hits = this._raycaster.intersectObjects(this.hittables, false);

    let endPoint, hitInfo = null;
    if (hits.length > 0) {
      hitInfo = hits[0];
      endPoint = hitInfo.point.clone();
    } else {
      endPoint = origin.clone().addScaledVector(dir, 200);
    }

    /* --- мировые координаты дула --- */
    this.weaponRoot.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld(true);
    const muzzleCamSpace = new THREE.Vector3(this.cfg.MUZZLE.x, this.cfg.MUZZLE.y, this.cfg.MUZZLE.z)
      .applyMatrix4(this.weaponRoot.matrixWorld);
    const muzzleWorld = muzzleCamSpace.clone().applyMatrix4(this.camera.matrixWorld);

    /* --- эффекты и вспышка --- */
    this.effects?.spawnTracer(muzzleWorld, endPoint);

    this.flashGroup.visible = true;
    this.flashGroup.rotation.z = Math.random() * Math.PI * 2;
    this.flashGroup.scale.setScalar(0.85 + Math.random() * 0.5);
    this.flashLight.intensity = 7 + Math.random() * 4;
    this.worldFlashLight.position.copy(muzzleWorld);
    this.worldFlashLight.intensity = 45;
    this.flashTimer = 0.045;

    /* --- отдача / тряска --- */
    const i = Math.min(this.shotIndex, 30);
    const recoilScale = 1 - this.adsAmount * (1 - this.cfg.RECOIL_ADS_MULT);

    const vert = (this.cfg.RECOIL_VERT +
                  this.cfg.RECOIL_VERT_GROWTH * Math.min(i / 10, 1)) * recoilScale;
    const horiz = (Math.sin(i * 0.62) * this.cfg.RECOIL_HORIZ * Math.min(i / 5, 1)
                + Math.sin(i * 0.27) * this.cfg.RECOIL_HORIZ2 * Math.min(i / 8, 1)
                + (Math.random() - 0.5) * 0.0026) * recoilScale;

    this.player.pitch = Math.max(-this.player.pitchLimit,
                        Math.min(this.player.pitchLimit, this.player.pitch + vert));
    this.player.yaw += horiz;

    this.kickPos.z += (0.030 + Math.random() * 0.012) * recoilScale;
    this.kickPos.y += 0.004;
    this.kickRot.x += (0.085 + Math.random() * 0.03) * recoilScale;
    this.kickRot.z += (Math.random() - 0.5) * 0.05;
    this.kickRot.y += (Math.random() - 0.5) * 0.03;

    this.camShakeVel.x += (Math.random() - 0.5) * 3.5 * recoilScale;
    this.camShakeVel.y += (Math.random() - 0.5) * 3.5 * recoilScale;
    this.camShakeVel.z += (Math.random() - 0.5) * 2.0 * recoilScale;

    /* --- гильза --- */
    const ejectCam = new THREE.Vector3(0.03, 0.01, -0.18).applyMatrix4(this.weaponRoot.matrixWorld);
    const ejectWorld = ejectCam.clone().applyMatrix4(this.camera.matrixWorld);
    const ejectDir = new THREE.Vector3(1, 0, 0).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
    );
    this.effects?.spawnCasing(ejectWorld, ejectDir.multiplyScalar(2.2));

    /* --- попадание --- */
    if (hitInfo && this.effects) {
      const n = hitInfo.face
        ? hitInfo.face.normal.clone().transformDirection(hitInfo.object.matrixWorld)
        : dir.clone().negate();

      this.effects.addDecal(hitInfo.point, n, 0.05);

      const sparkCount = 7 + Math.floor(Math.random() * 6);
      for (let s = 0; s < sparkCount; s++) {
        const v = n.clone().multiplyScalar(1.6 + Math.random() * 2.4)
          .add(new THREE.Vector3(
            (Math.random() - 0.5) * 2.6,
            Math.random() * 2.0,
            (Math.random() - 0.5) * 2.6
          ));
        this.effects.spawnParticle(hitInfo.point, v, 0xffc060, 0.28 + Math.random() * 0.32, 1);
      }
      for (let s = 0; s < 5; s++) {
        const v = n.clone().multiplyScalar(0.6)
          .add(new THREE.Vector3(
            (Math.random() - 0.5) * 1.4,
            Math.random() * 1.0,
            (Math.random() - 0.5) * 1.4
          ));
        this.effects.spawnParticle(hitInfo.point, v, 0x8a8f96, 0.45 + Math.random() * 0.4, 0.25);
      }

      if (this.audio) {
        if (hitInfo.object?.userData?.isPlate) this.audio.ping();
        else this.audio.impact();
      }
    }

    this.audio?.shot();

    /* --- подсветка прицела --- */
    if (hitInfo && this._crossEl) {
      this._crossEl.classList.add('hit');
      clearTimeout(this._hitT);
      this._hitT = setTimeout(() => this._crossEl.classList.remove('hit'), 90);
    }

    /* --- хук --- */
    this._onFire?.(hitInfo);

    this.shotIndex++;
    this._emitAmmo();
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

  /* ---------- 1. машина состояний ---------- */
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
        this.magMesh.position.set(0, 0, 0);
        this.magMesh.visible = true;
      }
    } else if (this.state === 'inspecting') {
      this.time += dt;
      if (this.time >= this.cfg.INSPECT_DUR) { this.state = 'idle'; this.time = 0; }
    }
  }

  /* ---------- 2. перезарядка (по таймлайну) ---------- */
  _reloadStep(dt) {
    const t = this.time;
    const F = this.reloadFlags;

    if (!F.magDropped && t >= 0.30) {
      F.magDropped = true;
      this.effects?.spawnDroppedMag(this.magMesh);
      this.magMesh.visible = false;
      this.audio?.click(0.30, 800, 0.08);
      setTimeout(() => this.audio?.click(0.18, 500, 0.12), 90);
    }

    if (t >= 1.30 && t < 1.75) {
      if (!F.magSpawned) {
        F.magSpawned = true;
        this.magMesh.visible = true;
        this.magMesh.position.set(0, -14, 0);
      }
      const u = _smoothstep(1.30, 1.75, t);
      this.magMesh.position.y = -14 * (1 - u);
      if (!F.magInserted && u > 0.98) {
        F.magInserted = true;
        this.magMesh.position.set(0, 0, 0);
        this.audio?.click(0.34, 1200, 0.07);
      }
    }
    if (!F.ammoGiven && t >= 1.80) {
      F.ammoGiven = true;
      const need = this.cfg.MAG_SIZE - this.ammo;
      const give = Math.min(need, this.reserve);
      this.ammo    += give;
      this.reserve -= give;
      this._emitAmmo();
      this.audio?.click(0.26, 1500, 0.05);
    }

    if (t >= 2.00 && t < 2.32) {
      const u = (t - 2.00) / 0.32;
      this.boltMesh.position.x = -1.7 * Math.sin(Math.PI * u);
      if (!F.boltRacked && u > 0.5) {
        F.boltRacked = true;
        this.audio?.click(0.42, 1000, 0.07);
        this.audio?.click(0.30, 2400, 0.05);
      }
    } else {
      this.boltMesh.position.x = 0;
    }
  }

  /* ---------- 3. анимации (все слои вместе) ---------- */
  _updateAnimation(dt) {
    const pos = new THREE.Vector3(this.cfg.BASE_POS.x, this.cfg.BASE_POS.y, this.cfg.BASE_POS.z);
    const rot = new THREE.Vector3(this.cfg.BASE_ROT.x, this.cfg.BASE_ROT.y, this.cfg.BASE_ROT.z);

    /* 3.1 Доставание */
    if (this.state === 'drawing') {
      const t = Math.min(this.time / this.cfg.DRAW_DUR, 1);
      const k = 1 - _easeOutCubic(t);
      pos.y -= k * 0.55;
      pos.z += k * 0.12;
      rot.x -= k * 1.25;
      rot.z += k * 0.45;
      rot.y += k * 0.25;
    }

    /* 3.2 Осмотр — ключи в конфиге, длительность INSPECT_DUR */
    if (this.state === 'inspecting') {
      const kT = this.time * (this.cfg.INSPECT_END / this.cfg.INSPECT_DUR);
      const keys = this.cfg.INSPECT_KEYS;
      let k0 = keys[0], k1 = keys[keys.length - 1];
      for (let i = 0; i < keys.length - 1; i++) {
        if (kT >= keys[i].t && kT <= keys[i + 1].t) { k0 = keys[i]; k1 = keys[i + 1]; break; }
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

    /* 3.3 Перезарядка — покачивание */
    if (this.state === 'reloading') {
      const t = this.time;
      const tiltIn  = _smoothstep(0.00, 0.22, t);
      const tiltOut = 1 - _smoothstep(2.38, 2.75, t);
      const tilt = tiltIn * tiltOut;

      pos.z += 0.05 * tilt;
      pos.y -= 0.07 * tilt;
      pos.x -= 0.015 * tilt;
      rot.z += 0.52 * tilt;
      rot.x += 0.16 * tilt;
      rot.y -= 0.20 * tilt;

      if (t > 0.35 && t < 2.2) {
        pos.y += Math.sin(t * 24) * 0.0035 * tilt;
        rot.z += Math.sin(t * 19) * 0.012 * tilt;
      }
    }

    /* 3.4 Инерция (sway) */
    this.swayCurrent.x += (this.swayTarget.x - this.swayCurrent.x) * Math.min(dt * 9, 1);
    this.swayCurrent.y += (this.swayTarget.y - this.swayCurrent.y) * Math.min(dt * 9, 1);
    this.swayTarget.multiplyScalar(1 - Math.min(dt * 2.2, 1));

    pos.x += this.swayCurrent.x;
    pos.y += this.swayCurrent.y;
    rot.y += this.swayCurrent.x * 1.4;
    rot.x += this.swayCurrent.y * 1.4;

    /* 3.5 Покачивание при ходьбе */
    const walkSpeed = this.player?.planarSpeed ?? 0;
    const onGround  = this.player?.onGround ?? true;
    const targetBob = onGround ? Math.min(walkSpeed / (this.player?.walkSpeed ?? 4.4), 1.4) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(dt * 8, 1);
    this.bobTime   += dt * (6.0 + walkSpeed * 1.1);
    this.breatheTime += dt;

    const bobX = Math.sin(this.bobTime) * 0.0125 * this.bobAmount;
    const bobY = Math.abs(Math.cos(this.bobTime)) * 0.0105 * this.bobAmount - 0.004 * this.bobAmount;
    const bobR = Math.sin(this.bobTime) * 0.020 * this.bobAmount;
    pos.x += bobX;
    pos.y += bobY;
    rot.z += bobR;
    rot.x += Math.abs(Math.cos(this.bobTime)) * 0.008 * this.bobAmount;

    /* 3.6 Дыхание */
    const idleAmount = 1 - Math.min(this.bobAmount, 1);
    pos.y += Math.sin(this.breatheTime * 1.35) * 0.0022 * idleAmount;
    pos.x += Math.sin(this.breatheTime * 0.85) * 0.0016 * idleAmount;
    rot.z += Math.sin(this.breatheTime * 1.1) * 0.006 * idleAmount;

    /* 3.7 ADS (ПКМ) */
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

    /* 3.8 Отдача (пружина) */
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

    /* 3.9 Тряска камеры (накапливается) */
    this.camShakeVel.multiplyScalar(Math.max(0, 1 - 9 * dt));
    this.camShake.addScaledVector(this.camShakeVel, dt * 0.02);
    this.camShake.multiplyScalar(Math.max(0, 1 - 8 * dt));

    /* --- применяем --- */
    this.weaponRoot.position.copy(pos);
    this.weaponRoot.rotation.set(rot.x, rot.y, rot.z);
  }

  /* ---------- 4. автоогонь ---------- */
  _updateFiring(dt) {
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.triggerHeld && this.state === 'idle' && this.fireCooldown <= 0) {
      this.tryFire();
    }
    if (!this.triggerHeld) {
      this.shotIndex = Math.max(0, this.shotIndex - dt * 25);
    }
  }

  /* ---------- 5. вспышка ---------- */
  _updateFlash(dt) {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flashGroup.visible = false;
        this.flashLight.intensity = 0;
        this.worldFlashLight.intensity = 0;
      } else {
        this.flashLight.intensity      *= 0.75;
        this.worldFlashLight.intensity *= 0.75;
        this.flashGroup.scale.multiplyScalar(1 + dt * 6);
      }
    }
  }

  /* ---------- 6. FOV / тряска камеры ---------- */
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

  /* ---------- 7. прозрачность прицела ---------- */
  _applyHudOpacity() {
    if (this._crossEl) {
      this._crossEl.style.opacity = String(1 - this.adsAmount * 0.7);
    }
  }

  /* ========================================================================
     ГЕТТЕРЫ
     ======================================================================== */

  get adsActive() { return this.adsAmount > 0.5; }
  get isFiring()  { return this.triggerHeld && this.state === 'idle'; }
  get camShakeOffset() { return this.camShake; }  // добавьте к camera.rotation в своём апдейте
}

/* ═══════════════════════════════════════════════════════════════════════════
   9 · ПРИМЕР ИСПОЛЬЗОВАНИЯ (закомментировано)

   import * as THREE from 'three';
   import {
     AK47_CONFIG, createAK47, createAKMaterials,
     WeaponEffects, WeaponAudio, PlayerController, AK47Controller
   } from './ak47.js';

   // --- сцена ---
   const scene = new THREE.Scene();
   const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.05, 500);
   const weaponScene = new THREE.Scene();
   const weaponCamera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.01, 30);

   // --- мир ---
   const hittables = [];   // меши, по которым стреляем
   const colliders = [];   // AABB { min: Vector3, max: Vector3 }

   // --- игрок + оружие ---
   const player = new PlayerController({ startPos: { x: 0, y: 1.7, z: 10 }, colliders });
   const effects = new WeaponEffects(scene);
   const audio   = new WeaponAudio(0.55);

   const ak = new AK47Controller({
     weaponScene, weaponCamera, scene, camera,
     player, hittables, colliders, effects, audio,
     crosshairEl: document.getElementById('cross'),
     onAmmoChange: (a, r) => { /* обновить HUD *\/ },
     onStateMessage: (t, d) => { /* показать сообщение *\/ },
     onFire: (hit) => { /* ... *\/ }
   });
   ak.mount();

   // --- ввод ---
   document.addEventListener('keydown', e => { player.onKeyDown(e.code); ak.onKeyDown(e.code); });
   document.addEventListener('keyup',   e => { player.onKeyUp(e.code); });
   document.addEventListener('mousemove', e => {
     if (document.pointerLockElement) {
       const mult = 1 - ak.adsAmount * AK47_CONFIG.MOUSE_ADS_MULT;
       player.lookSensMult = mult;
       player.look(e.movementX, e.movementY);
       ak.onMouseMove(e.movementX, e.movementY);
     }
   });
   document.addEventListener('mousedown', e => ak.onMouseDown(e.button));
   document.addEventListener('mouseup',   e => ak.onMouseUp(e.button));
   document.addEventListener('contextmenu', e => e.preventDefault());

   // --- цикл ---
   const clock = new THREE.Clock();
   (function loop() {
     requestAnimationFrame(loop);
     const dt = Math.min(clock.getDelta(), 0.05);

     player.speedMult = 1 - ak.adsAmount * AK47_CONFIG.MOVE_ADS_MULT;
     player.update(dt);
     ak.update(dt);
     effects.update(dt);

     camera.position.copy(player.pos);
     camera.rotation.set(
       player.pitch + ak.camShakeOffset.x,
       player.yaw   + ak.camShakeOffset.y,
       ak.camShakeOffset.z,
       'YXZ'
     );

     renderer.clear();
     renderer.render(scene, camera);
     renderer.clearDepth();
     renderer.render(weaponScene, weaponCamera);
   })();
   ═══════════════════════════════════════════════════════════════════════════ */