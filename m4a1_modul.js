/* ============================================================================
 * M4A1-S · Reusable Three.js Module
 * ----------------------------------------------------------------------------
 * Что можно взять по отдельности:
 *   - M4A1_CONFIG           — все числа (позы, тайминги, отдача, FOV)
 *   - createM4A1Materials() — фабрика материалов
 *   - createM4A1()          — чистая модель (Group 'M4A1S')
 *                             внутри группы: 'magazine', 'bolt'
 *   - WeaponEffects         — частицы, искры, гильзы, трассеры, дырки,
 *                             сброшенные магазины
 *   - WeaponAudio           — процедурный звук выстрела/кликов/рикошета
 *   - PlayerController      — движение WASD, прыжок, коллизии, обзор
 *   - M4A1Controller        — вся механика: автоогонь, перезарядка, осмотр,
 *                             ADS через коллиматор, отдача, вспышка
 * ----------------------------------------------------------------------------
 * Ориентация модели:  +X = дуло, +Y = вверх, +Z = правая сторона.
 * Для viewmodel:      m4.rotation.y = Math.PI/2;
 *                     m4.scale.setScalar(M4A1_CONFIG.SCALE);
 * ==========================================================================*/

import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════════════
   1 · КОНФИГ
   ═══════════════════════════════════════════════════════════════════════════ */

export const M4A1_CONFIG = {
  /* --- масштаб и позы viewmodel --- */
  SCALE: 0.55,

  BASE_POS: { x:  0.13, y: -0.13,    z: -0.40 },
  BASE_ROT: { x:  0,    y:  0,       z:  0    },

  /* ADS — камера смотрит через трубу коллиматора.
     Труба прицела в rifle-local: (-0.150, 0.078, 0)
     После scale 0.55 и rotation.y=π/2: weaponRoot-local (0, 0.0429, 0.0825)
     ADS_POS = (0, -0.0429, -0.32) */
  ADS_POS:  { x: 0,     y: -0.0429,  z: -0.32 },
  ADS_ROT:  { x: 0,     y:  0,       z:  0    },

  /* Дуло — прямо в weaponRoot-пространстве (не в модельных единицах) */
  MUZZLE: { x: 0, y: 0, z: -0.451 },

  /* --- патроны / тайминги --- */
  MAG_SIZE:      30,
  RESERVE:       90,
  FIRE_INTERVAL: 0.075,
  RELOAD_DUR:    2.55,
  INSPECT_DUR:   5.60,
  DRAW_DUR:      0.62,

  /* --- FOV --- */
  MAIN_FOV:              75,
  ADS_FOV_DELTA:        -24,
  WEAPON_FOV:            55,
  WEAPON_ADS_FOV_DELTA: -17,

  /* --- мышь / игрок --- */
  MOUSE_SENS:     0.0022,
  MOUSE_ADS_MULT: 0.55,
  MOVE_ADS_MULT:  0.45,

  /* --- разброс --- */
  SPREAD_BASE:     0.0010,
  SPREAD_MOVE:     0.0085,
  SPREAD_PER_SHOT: 0.00048,
  SPREAD_ADS_MULT: 0.18,       // множитель (1 - adsAmount * ...)

  /* --- отдача --- */
  RECOIL_VERT:        0.0105,
  RECOIL_VERT_GROWTH: 0.0068,
  RECOIL_HORIZ:       0.0042,
  RECOIL_HORIZ2:      0.0032,
  RECOIL_ADS_MULT:    0.60,    // (1 - adsAmount * ...)

  /* --- ключи анимации осмотра --- */
  INSPECT_END: 3.10,
  INSPECT_KEYS: [
    { t: 0.00, p: [ 0.00,  0.00, 0.00], r: [ 0.00,  0.00,  0.00] },
    { t: 0.45, p: [ 0.03,  0.05, 0.06], r: [-0.10,  0.85, -0.75] },
    { t: 1.15, p: [ 0.01,  0.07, 0.10], r: [ 0.05, -0.75,  0.70] },
    { t: 1.85, p: [-0.02,  0.06, 0.04], r: [ 0.55,  0.15,  0.10] },
    { t: 2.45, p: [ 0.00,  0.03, 0.03], r: [ 0.10,  0.05,  0.25] },
    { t: 3.10, p: [ 0.00,  0.00, 0.00], r: [ 0.00,  0.00,  0.00] }
  ],

  /* --- таймлайн перезарядки (в секундах) --- */
  RELOAD_TIMELINE: {
    magDropped:    0.28,
    magSpawn:      1.20,
    magInsert:     1.62,
    ammoGiven:     1.68,
    boltRackStart: 1.85,
    boltRackEnd:   2.18
  },

  /* --- значения анимации перезарядки --- */
  RELOAD_MAG_DROP_Y: -0.30,   // куда «уезжает» магазин перед вставкой
  RELOAD_BOLT_TRAVEL: -0.08   // амплитуда движения затворной рукоятки
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

const _NOISE_MED  = makeNoiseTexture(256, 0.30); _NOISE_MED.repeat.set(8, 8);
const _NOISE_FINE = makeNoiseTexture(256, 0.15); _NOISE_FINE.repeat.set(14, 14);
const _NOISE_POLY = makeNoiseTexture(256, 0.55); _NOISE_POLY.repeat.set(20, 20);

export function createM4A1Materials() {
  return {
    body: new THREE.MeshStandardMaterial({
      color: 0x2a2e33, roughness: 0.62, metalness: 0.78, roughnessMap: _NOISE_MED
    }),
    dark: new THREE.MeshStandardMaterial({
      color: 0x14161a, roughness: 0.68, metalness: 0.62, roughnessMap: _NOISE_MED
    }),
    poly: new THREE.MeshStandardMaterial({
      color: 0x1a1c1e, roughness: 0.94, metalness: 0.04, roughnessMap: _NOISE_POLY
    }),
    steel: new THREE.MeshStandardMaterial({
      color: 0x5a626c, roughness: 0.34, metalness: 0.96, roughnessMap: _NOISE_FINE
    }),
    matte: new THREE.MeshStandardMaterial({
      color: 0x08090b, roughness: 1.0, metalness: 0.0
    }),
    bolt: new THREE.MeshStandardMaterial({
      color: 0x8c9298, roughness: 0.28, metalness: 1.0, roughnessMap: _NOISE_FINE
    }),
    opticBody: new THREE.MeshStandardMaterial({
      color: 0x14171a, metalness: 0.92, roughness: 0.40, roughnessMap: _NOISE_MED
    }),
    dot: new THREE.MeshStandardMaterial({
      color: 0xff2a10, emissive: 0xff2a10, emissiveIntensity: 8,
      toneMapped: false, side: THREE.DoubleSide
    }),

    scopeGlass: new THREE.MeshPhysicalMaterial({
      color: 0x9ecbff, metalness: 0.0, roughness: 0.02,
      transparent: true, opacity: 0.24, side: THREE.DoubleSide,
      clearcoat: 1.0, clearcoatRoughness: 0.01, envMapIntensity: 2.2,
      depthWrite: false, toneMapped: true
    }),
    scopeGlassRear: new THREE.MeshPhysicalMaterial({
      color: 0x8fc0e8, metalness: 0.0, roughness: 0.02,
      transparent: true, opacity: 0.20, side: THREE.DoubleSide,
      clearcoat: 1.0, clearcoatRoughness: 0.01, envMapIntensity: 2.2,
      depthWrite: false, toneMapped: true
    }),

    dotGlow: new THREE.MeshBasicMaterial({
      color: 0xff2a10, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    })
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · МОДЕЛЬ M4A1-S С КОЛЛИМАТОРОМ
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Строит полную модель M4A1-S.
 * @param {object} [materials] — результат createM4A1Materials()
 * @returns {THREE.Group} — группа 'M4A1S'; дети-группы: 'magazine', 'bolt'
 */
export function createM4A1(materials) {
  const M = materials || createM4A1Materials();
  const rifle = new THREE.Group();
  rifle.name = 'M4A1S';

  const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  function tubeG(rBack, rFront, len, seg = 20) {
    const g = new THREE.CylinderGeometry(rFront, rBack, len, seg);
    g.rotateZ(-Math.PI / 2);
    return g;
  }
  function ovalG(rBack, rFront, len, scaleY, scaleZ, seg = 24) {
    const g = new THREE.CylinderGeometry(rFront, rBack, len, seg);
    g.rotateZ(-Math.PI / 2);
    g.scale(1, scaleY, scaleZ);
    return g;
  }
  function torusG(r, tube, seg = 8, ringSeg = 20) {
    return new THREE.TorusGeometry(r, tube, seg, ringSeg);
  }

  function part(geo, material, pos = [0, 0, 0], rot = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = true; m.receiveShadow = true;
    rifle.add(m);
    return m;
  }
  function partIn(group, geo, material, pos = [0, 0, 0], rot = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  }

  const magazineGroup = new THREE.Group();
  magazineGroup.name = 'magazine';
  rifle.add(magazineGroup);

  const boltGroup = new THREE.Group();
  boltGroup.name = 'bolt';
  rifle.add(boltGroup);

  /* ---------- СТВОЛ / ГЛУШИТЕЛЬ ---------- */
  part(tubeG(0.011, 0.010, 0.135, 18), M.steel, [0.435, 0, 0]);
  part(tubeG(0.020, 0.020, 0.018, 22), M.body, [0.355, 0, 0]);
  part(boxG(0.030, 0.030, 0.030), M.dark, [0.475, -0.005, 0]);

  part(tubeG(0.0315, 0.0315, 0.290, 36), M.dark, [0.665, 0, 0]);
  part(tubeG(0.0330, 0.0330, 0.014, 36), M.body, [0.525, 0, 0]);
  part(tubeG(0.0322, 0.0322, 0.008, 36), M.body, [0.600, 0, 0]);
  part(tubeG(0.0322, 0.0322, 0.008, 36), M.body, [0.740, 0, 0]);
  part(tubeG(0.0322, 0.0322, 0.012, 36), M.body, [0.800, 0, 0]);
  part(tubeG(0.016, 0.016, 0.016, 26), M.matte, [0.812, 0, 0]);
  part(tubeG(0.0318, 0.0318, 0.006, 36), M.dark, [0.510, 0, 0]);

  /* ---------- ЦЕВЬЁ ---------- */
  part(ovalG(0.0325, 0.0325, 0.260, 0.90, 1.08, 32), M.poly, [0.205, 0, 0]);
  for (let i = 0; i < 7; i++) {
    const x = 0.095 + i * 0.037;
    part(boxG(0.020, 0.007, 0.012), M.poly, [x, 0.030, 0.020]);
    part(boxG(0.020, 0.007, 0.012), M.poly, [x, 0.030, -0.020]);
    part(boxG(0.020, 0.007, 0.012), M.poly, [x, -0.030, 0.020]);
    part(boxG(0.020, 0.007, 0.012), M.poly, [x, -0.030, -0.020]);
    part(boxG(0.020, 0.012, 0.007), M.poly, [x, 0.018, 0.036]);
    part(boxG(0.020, 0.012, 0.007), M.poly, [x, -0.018, 0.036]);
    part(boxG(0.020, 0.012, 0.007), M.poly, [x, 0.018, -0.036]);
    part(boxG(0.020, 0.012, 0.007), M.poly, [x, -0.018, -0.036]);
  }
  part(tubeG(0.038, 0.038, 0.026, 22), M.body, [0.058, 0, 0]);
  part(tubeG(0.039, 0.039, 0.006, 22), M.dark, [0.045, 0, 0]);
  part(tubeG(0.034, 0.034, 0.014, 22), M.body, [0.340, 0, 0]);

  /* ---------- ГАЗОВЫЙ БЛОК / МУШКА ---------- */
  part(boxG(0.048, 0.058, 0.044), M.body, [0.380, 0.005, 0]);
  part(boxG(0.040, 0.014, 0.036), M.body, [0.380, -0.032, 0]);
  part(boxG(0.012, 0.014, 0.018), M.body, [0.400, -0.042, 0]);
  part(boxG(0.008, 0.008, 0.014), M.body, [0.408, -0.052, 0]);

  part(boxG(0.007, 0.048, 0.006), M.dark, [0.365, 0.052, 0.018]);
  part(boxG(0.007, 0.048, 0.006), M.dark, [0.365, 0.052, -0.018]);
  part(boxG(0.007, 0.048, 0.006), M.dark, [0.395, 0.052, 0.018]);
  part(boxG(0.007, 0.048, 0.006), M.dark, [0.395, 0.052, -0.018]);
  part(boxG(0.036, 0.005, 0.006), M.dark, [0.380, 0.076, 0.018]);
  part(boxG(0.036, 0.005, 0.006), M.dark, [0.380, 0.076, -0.018]);
  part(boxG(0.008, 0.030, 0.007), M.matte, [0.380, 0.050, 0]);

  /* ---------- ВЕРХНИЙ РЕСИВЕР ---------- */
  part(boxG(0.300, 0.062, 0.058), M.body, [-0.115, 0, 0]);
  part(boxG(0.075, 0.062, 0.058), M.body, [-0.300, 0, 0]);

  /* ---------- ПЛОСКАЯ ПИКАТИННИ-ПЛАНКА ---------- */
  part(boxG(0.390, 0.006, 0.024), M.dark, [-0.125, 0.034, 0]);
  for (let i = 0; i < 15; i++) {
    const x = -0.295 + i * 0.025;
    part(boxG(0.013, 0.005, 0.024), M.dark, [x, 0.040, 0]);
  }

  /* ============================================================
     КОЛЛИМАТОРНЫЙ ПРИЦЕЛ — RED DOT
     ============================================================ */
  (function buildRedDot() {
    const optic = new THREE.Group();
    const TUBE_X = -0.150;
    const TUBE_Y = 0.078;
    optic.position.set(TUBE_X, TUBE_Y, 0);

    const addToOptic = (geo, mat, pos, rot) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(pos[0], pos[1], pos[2]);
      if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      m.castShadow = true; m.receiveShadow = true;
      optic.add(m);
      return m;
    };

    /* крепление к планке */
    addToOptic(new THREE.BoxGeometry(0.066, 0.008, 0.042), M.opticBody, [0, -0.038, 0]);
    addToOptic(new THREE.BoxGeometry(0.014, 0.028, 0.024), M.opticBody, [ 0.022, -0.020, 0]);
    addToOptic(new THREE.BoxGeometry(0.014, 0.028, 0.024), M.opticBody, [-0.022, -0.020, 0]);
    addToOptic(new THREE.CylinderGeometry(0.0025, 0.0025, 0.004, 10), M.steel,
               [ 0.022, -0.020, 0.013], [Math.PI/2, 0, 0]);
    addToOptic(new THREE.CylinderGeometry(0.0025, 0.0025, 0.004, 10), M.steel,
               [-0.022, -0.020, 0.013], [Math.PI/2, 0, 0]);

    /* основной корпус трубы */
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.062, 32, 1, true),
      M.opticBody
    );
    tube.rotation.z = Math.PI / 2;
    tube.castShadow = true; tube.receiveShadow = true;
    optic.add(tube);

    /* передняя оправа */
    addToOptic(new THREE.CylinderGeometry(0.019, 0.019, 0.008, 32, 1, true),
               M.opticBody, [0.031, 0, 0], [0, 0, Math.PI/2]);
    const frontRing = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0016, 8, 32), M.steel);
    frontRing.rotation.y = Math.PI / 2;
    frontRing.position.set(0.036, 0, 0);
    frontRing.castShadow = true;
    optic.add(frontRing);

    /* задняя оправа */
    addToOptic(new THREE.CylinderGeometry(0.019, 0.019, 0.008, 32, 1, true),
               M.opticBody, [-0.031, 0, 0], [0, 0, Math.PI/2]);
    const rearRing = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0016, 8, 32), M.steel);
    rearRing.rotation.y = Math.PI / 2;
    rearRing.position.set(-0.036, 0, 0);
    rearRing.castShadow = true;
    optic.add(rearRing);

    /* переднее стекло */
    const frontGlass = new THREE.Mesh(new THREE.CircleGeometry(0.0172, 40), M.scopeGlass);
    frontGlass.rotation.y = Math.PI / 2;
    frontGlass.position.set(0.0345, 0, 0);
    frontGlass.renderOrder = 5;
    optic.add(frontGlass);

    /* заднее стекло */
    const rearGlass = new THREE.Mesh(new THREE.CircleGeometry(0.0172, 40), M.scopeGlassRear);
    rearGlass.rotation.y = -Math.PI / 2;
    rearGlass.position.set(-0.0345, 0, 0);
    rearGlass.renderOrder = 5;
    optic.add(rearGlass);

    /* красная точка */
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0018, 20), M.dot);
    dot.rotation.y = -Math.PI / 2;
    dot.position.set(0.006, 0, 0);
    dot.renderOrder = 1;
    optic.add(dot);

    /* свечение точки */
    const dotGlow = new THREE.Mesh(new THREE.CircleGeometry(0.0040, 20), M.dotGlow);
    dotGlow.rotation.y = -Math.PI / 2;
    dotGlow.position.set(0.005, 0, 0);
    dotGlow.renderOrder = 2;
    optic.add(dotGlow);

    /* барабанчики поправок */
    addToOptic(new THREE.CylinderGeometry(0.0055, 0.0055, 0.010, 16),
               M.opticBody, [0, 0.019, 0]);
    addToOptic(new THREE.CylinderGeometry(0.0066, 0.0066, 0.0018, 16),
               M.dark, [0, 0.0245, 0]);
    addToOptic(new THREE.CylinderGeometry(0.0050, 0.0050, 0.009, 16),
               M.opticBody, [0, 0, 0.018], [Math.PI/2, 0, 0]);
    addToOptic(new THREE.CylinderGeometry(0.0060, 0.0060, 0.0015, 16),
               M.dark, [0, 0, 0.0235], [Math.PI/2, 0, 0]);

    /* кнопка питания */
    addToOptic(new THREE.CylinderGeometry(0.0030, 0.0030, 0.004, 12),
               M.steel, [-0.009, 0.016, 0]);

    rifle.add(optic);
  })();

  /* ---------- EJECTION PORT ---------- */
  part(boxG(0.090, 0.032, 0.004), M.matte, [-0.115, 0.006, 0.030]);
  part(boxG(0.088, 0.004, 0.026), M.body, [-0.115, 0.024, 0.032], [-0.6, 0, 0]);
  part(tubeG(0.004, 0.004, 0.086, 10), M.dark, [-0.115, 0.022, 0.020]);
  partIn(boltGroup, boxG(0.080, 0.022, 0.010), M.bolt, [-0.115, 0.000, 0.026]);

  /* ---------- CHARGING HANDLE ---------- */
  part(boxG(0.075, 0.012, 0.020), M.body, [-0.330, 0.020, 0]);
  part(boxG(0.022, 0.024, 0.034), M.dark, [-0.368, 0.020, 0]);
  for (let i = -1; i <= 1; i++) {
    part(boxG(0.002, 0.020, 0.002), M.matte, [-0.380, 0.020 + i * 0.006, 0.016]);
    part(boxG(0.002, 0.020, 0.002), M.matte, [-0.380, 0.020 + i * 0.006, -0.016]);
  }

  /* ---------- FORWARD ASSIST ---------- */
  part(new THREE.CylinderGeometry(0.012, 0.012, 0.024, 16), M.body,
       [-0.205, -0.014, 0.032], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    part(boxG(0.002, 0.010, 0.002), M.matte,
         [-0.205 + Math.cos(a) * 0.010, -0.014 + Math.sin(a) * 0.010, 0.044]);
  }

  /* ---------- НИЖНИЙ РЕСИВЕР ---------- */
  part(boxG(0.240, 0.050, 0.050), M.body, [-0.165, -0.052, 0]);
  part(boxG(0.078, 0.058, 0.052), M.body, [-0.090, -0.096, 0]);
  part(boxG(0.084, 0.010, 0.056), M.body, [-0.090, -0.124, 0]);
  part(new THREE.CylinderGeometry(0.010, 0.010, 0.014, 14), M.dark,
       [-0.063, -0.062, 0.028], [Math.PI / 2, 0, 0]);
  part(boxG(0.030, 0.022, 0.014), M.dark, [-0.215, -0.032, 0.028]);
  part(boxG(0.014, 0.028, 0.010), M.dark, [-0.232, -0.032, 0.030]);

  /* ---------- ПИСТОЛЕТНАЯ РУКОЯТЬ ---------- */
  part(boxG(0.048, 0.120, 0.044), M.poly, [-0.280, -0.115, 0], [0, 0, -0.32]);
  part(boxG(0.052, 0.014, 0.048), M.poly, [-0.298, -0.176, 0], [0, 0, -0.32]);
  part(boxG(0.056, 0.014, 0.050), M.poly, [-0.268, -0.062, 0], [0, 0, -0.32]);
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    part(boxG(0.006, 0.004, 0.044), M.matte,
         [-0.272 - t * 0.030, -0.078 - t * 0.075, 0], [0, 0, -0.32]);
  }

  /* ---------- СПУСКОВАЯ СКОБА ---------- */
  part(boxG(0.008, 0.040, 0.016), M.body, [-0.145, -0.092, 0]);
  part(boxG(0.008, 0.034, 0.016), M.body, [-0.228, -0.092, 0]);
  part(boxG(0.092, 0.008, 0.016), M.body, [-0.190, -0.110, 0]);
  part(boxG(0.010, 0.034, 0.012), M.steel, [-0.184, -0.088, 0], [0, 0, 0.14]);
  part(boxG(0.014, 0.008, 0.012), M.steel, [-0.180, -0.104, 0]);
  part(tubeG(0.005, 0.005, 0.030, 12), M.dark, [-0.184, -0.072, 0]);

  /* ---------- СЕЛЕКТОР ОГНЯ ---------- */
  part(new THREE.CylinderGeometry(0.009, 0.009, 0.018, 14), M.dark,
       [-0.285, -0.018, 0.030], [Math.PI / 2, 0, 0]);
  part(boxG(0.030, 0.010, 0.008), M.dark, [-0.270, -0.018, 0.036], [0, 0, 0.35]);

  /* ---------- МАГАЗИН ---------- */
  (function buildMagazine() {
    const segs = [
      { x: -0.085, y: -0.135, rot: 0.00 },
      { x: -0.081, y: -0.192, rot: 0.06 },
      { x: -0.073, y: -0.248, rot: 0.14 },
      { x: -0.061, y: -0.300, rot: 0.24 },
    ];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      partIn(magazineGroup, boxG(0.058, 0.058, 0.040), M.dark, [s.x, s.y, 0], [0, 0, s.rot]);
      for (let j = -1; j <= 1; j++) {
        partIn(magazineGroup, boxG(0.056, 0.004, 0.042), M.dark,
             [s.x + Math.sin(s.rot) * (j * 0.016),
              s.y + Math.cos(s.rot) * (j * 0.016), 0], [0, 0, s.rot]);
      }
    }
    const last = segs[segs.length - 1];
    partIn(magazineGroup, boxG(0.064, 0.012, 0.046), M.poly,
         [last.x - 0.010, last.y - 0.038, 0], [0, 0, last.rot + 0.06]);
    partIn(magazineGroup, boxG(0.014, 0.006, 0.014), M.poly,
         [last.x - 0.010, last.y - 0.048, 0], [0, 0, last.rot + 0.06]);
  })();

  /* ---------- ПРИКЛАД ---------- */
  part(tubeG(0.021, 0.021, 0.220, 22), M.body, [-0.400, 0.008, 0]);
  for (let i = 0; i < 4; i++) {
    const x = -0.325 - i * 0.032;
    part(tubeG(0.0225, 0.0225, 0.006, 22), M.dark, [x, 0.008, 0]);
  }
  part(boxG(0.160, 0.086, 0.048), M.poly, [-0.455, -0.022, 0]);
  part(boxG(0.130, 0.026, 0.046), M.poly, [-0.470, 0.028, 0]);
  part(boxG(0.055, 0.024, 0.040), M.poly, [-0.360, 0.006, 0]);
  part(boxG(0.028, 0.104, 0.052), M.poly, [-0.540, -0.002, 0]);
  part(boxG(0.010, 0.104, 0.052), M.matte, [-0.552, -0.002, 0]);
  part(boxG(0.032, 0.016, 0.052), M.dark, [-0.395, -0.070, 0]);
  part(new THREE.CylinderGeometry(0.007, 0.007, 0.010, 12), M.steel,
       [-0.395, -0.070, 0.026], [Math.PI / 2, 0, 0]);
  part(torusG(0.012, 0.0025, 6, 16), M.dark, [-0.430, -0.078, 0], [Math.PI / 2, 0, 0]);
  part(boxG(0.010, 0.012, 0.010), M.dark, [-0.430, -0.070, 0]);

  /* ---------- ДОП. ДЕТАЛИ ---------- */
  part(torusG(0.010, 0.0022, 6, 16), M.dark, [0.480, -0.028, 0.020], [0, Math.PI/2, 0]);
  part(boxG(0.012, 0.006, 0.006), M.dark, [0.480, -0.024, 0.026]);
  part(new THREE.CylinderGeometry(0.004, 0.004, 0.008, 10), M.dark,
       [-0.180, -0.030, -0.028], [Math.PI / 2, 0, 0]);
  part(new THREE.CylinderGeometry(0.004, 0.004, 0.008, 10), M.dark,
       [-0.100, -0.030, -0.028], [Math.PI / 2, 0, 0]);
  part(tubeG(0.004, 0.004, 0.020, 10), M.dark, [-0.220, -0.058, 0]);
  part(new THREE.CylinderGeometry(0.006, 0.006, 0.014, 12), M.dark,
       [-0.300, -0.030, 0.026], [Math.PI / 2, 0, 0]);

  rifle.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return rifle;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · ЭФФЕКТЫ
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
    this.pGeo = pGeo;

    this.pointsMat = new THREE.PointsMaterial({
      size: 0.075, map: makeDotTexture(), vertexColors: true,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true
    });
    this.points = new THREE.Points(pGeo, this.pointsMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pCursor = 0;

    /* --- дырки --- */
    this.decalMat = new THREE.MeshBasicMaterial({
      map: makeHoleTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false
    });
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decals = [];
    this.decalCursor = 0;
    for (let i = 0; i < this.maxDecals; i++) {
      const m = new THREE.Mesh(this.decalGeo, this.decalMat);
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.decals.push(m);
    }

    /* --- гильзы --- */
    this.casings = [];
    this.casingGeo = new THREE.CylinderGeometry(0.0038, 0.0042, 0.018, 8);
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1.0, roughness: 0.32 });

    /* --- трассеры --- */
    this.tracers = [];
    this.tracerGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 6, 1, true);
    this.tracerGeo.translate(0, 0.5, 0);
    this.tracerGeo.rotateX(Math.PI / 2);

    /* --- сброшенные магазины --- */
    this.droppedMags = [];
  }

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

  addDecal(point, normal, scale = 0.05) {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.maxDecals;
    d.visible = true;
    d.position.copy(point).addScaledVector(normal, 0.006);
    d.lookAt(point.clone().add(normal));
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(scale * (0.75 + Math.random() * 0.6));
  }

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

  /** Клонирует источник (mesh или group) и бросает его в сцене. */
  spawnDroppedMag(sourceObject) {
    sourceObject.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    sourceObject.matrixWorld.decompose(p, q, s);
    const clone = sourceObject.clone(true);
    clone.position.copy(p);
    clone.quaternion.copy(q);
    clone.scale.copy(s);
    clone.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(clone);
    this.droppedMags.push({
      obj: clone,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.35, -0.5, (Math.random() - 0.5) * 0.35
      ),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5
      ),
      life: 6
    });
  }

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
    } catch (e) { /* Audio недоступен */ }
  }

  resume() {
    if (this.actx && this.actx.state === 'suspended') this.actx.resume();
  }

  shot() {
    if (!this.actx) return;
    const t = this.actx.currentTime;

    const src = this.actx.createBufferSource(); src.buffer = this.noiseBuf;
    const hp = this.actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
    const lp = this.actx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(11000, t);
    lp.frequency.exponentialRampToValueAtTime(550, t + 0.16);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.80, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.24);
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.masterGain);
    src.start(t); src.stop(t + 0.26);

    const o = this.actx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.10);
    const og = this.actx.createGain();
    og.gain.setValueAtTime(0.55, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og); og.connect(this.masterGain);
    o.start(t); o.stop(t + 0.15);

    const src2 = this.actx.createBufferSource(); src2.buffer = this.noiseBuf;
    const bp = this.actx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 1400; bp.Q.value = 0.8;
    const g2 = this.actx.createGain();
    g2.gain.setValueAtTime(0.0001, t + 0.04);
    g2.gain.linearRampToValueAtTime(0.08, t + 0.08);
    g2.gain.exponentialRampToValueAtTime(0.0005, t + 0.75);
    src2.connect(bp); bp.connect(g2); g2.connect(this.masterGain);
    src2.start(t); src2.stop(t + 0.8);
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

  impact() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    const o = this.actx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(2000 + Math.random() * 900, t);
    o.frequency.exponentialRampToValueAtTime(450, t + 0.09);
    const g = this.actx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
    o.connect(g); g.connect(this.masterGain);
    o.start(t); o.stop(t + 0.13);
  }

  ping() {
    if (!this.actx) return;
    const t = this.actx.currentTime;
    [1700, 2550, 3400].forEach((f, i) => {
      const o = this.actx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.actx.createGain();
      g.gain.setValueAtTime(0.13 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.55 + i * 0.1);
      o.connect(g); g.connect(this.masterGain);
      o.start(t); o.stop(t + 0.6);
    });
  }

  dryFire() { this.click(0.22, 2800, 0.04); }
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

    this.mouseSensitivity = opts.mouseSensitivity ?? M4A1_CONFIG.MOUSE_SENS;
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
   8 · КОНТРОЛЛЕР M4A1-S
   ═══════════════════════════════════════════════════════════════════════════ */

const _smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _easeOutCubic = x => 1 - Math.pow(1 - x, 3);

export class M4A1Controller {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.weaponScene
   * @param {THREE.Camera} opts.weaponCamera
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {PlayerController} opts.player
   * @param {Array} [opts.hittables]
   * @param {Array} [opts.colliders]
   * @param {WeaponEffects} [opts.effects]
   * @param {WeaponAudio} [opts.audio]
   * @param {HTMLElement} [opts.crosshairEl]
   * @param {Function} [opts.onAmmoChange]
   * @param {Function} [opts.onStateMessage]
   * @param {Function} [opts.onFire]
   * @param {Function} [opts.isPlate] — (hitObject) => boolean — для «звона»
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
    this._isPlate        = opts.isPlate        || null;

    /* --- конфиг --- */
    this.cfg = Object.assign({}, M4A1_CONFIG, opts.config || {});

    /* --- модель --- */
    this.weaponRoot = new THREE.Group();
    this.weaponRoot.rotation.order = 'YXZ';
    this.weaponRoot.visible = false;

    const materials = opts.materials || createM4A1Materials();
    this.materials = materials;
    this.m4 = createM4A1(materials);
    this.m4.rotation.y = Math.PI / 2;
    this.m4.scale.setScalar(this.cfg.SCALE);
    this.weaponRoot.add(this.m4);

    this.magMesh  = this.m4.getObjectByName('magazine');
    this.boltMesh = this.m4.getObjectByName('bolt');
    this.muzzle   = new THREE.Vector3(this.cfg.MUZZLE.x, this.cfg.MUZZLE.y, this.cfg.MUZZLE.z);

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
    flashGroup.add(new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat));
    const fq2 = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), flashMat);
    fq2.rotation.z = Math.PI / 4;
    flashGroup.add(fq2);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.055, 0.22, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb050, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
        depthTest: false, toneMapped: false
      })
    );
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = -0.12;
    flashGroup.add(cone);

    const flashLight = new THREE.PointLight(0xffb060, 0, 3.5, 2);
    flashLight.position.copy(this.muzzle);
    this.weaponRoot.add(flashLight);
    this.flashLight = flashLight;

    const worldLight = new THREE.PointLight(0xffb060, 0, 14, 2);
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
      this.fireCooldown = 0;
      this.shotIndex = 0;
    }
    if (button === 2) this.adsHeld = false;
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
    if (this.state === 'inspecting') { this.state = 'idle'; this.time = 0; }
  }

  tryReload() {
    if (this.state === 'inspecting') this.cancelInspect();
    if (this.state !== 'idle') return;
    if (this.ammo >= this.cfg.MAG_SIZE) return;
    if (this.reserve <= 0) { this.setStateMessage('НЕТ ПАТРОНОВ'); return; }

    this.state = 'reloading';
    this.time  = 0;
    this.reloadFlags.magDropped  = false;
    this.reloadFlags.magInserted = false;
    this.reloadFlags.ammoGiven   = false;
    this.reloadFlags.boltRacked  = false;
    this.reloadFlags.magSpawned  = false;
    if (this.magMesh) {
      this.magMesh.visible = true;
      this.magMesh.position.set(0, 0, 0);
    }
    if (this.boltMesh) this.boltMesh.position.set(0, 0, 0);
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

    /* --- направление со спредом --- */
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
    );
    const moveFactor = Math.min(this.player.planarSpeed / this.player.walkSpeed, 1.4);
    const spreadBase = this.cfg.SPREAD_BASE +
                       moveFactor * this.cfg.SPREAD_MOVE +
                       Math.min(this.shotIndex, 20) * this.cfg.SPREAD_PER_SHOT;
    const spread = spreadBase * (1 - this.adsAmount * (1 - this.cfg.SPREAD_ADS_MULT));

    const upV = new THREE.Vector3(0, 1, 0);
    const rightV = new THREE.Vector3().crossVectors(dir, upV).normalize();
    const trueUp = new THREE.Vector3().crossVectors(rightV, dir).normalize();
    dir.addScaledVector(rightV, (Math.random() - 0.5) * spread * 2)
       .addScaledVector(trueUp, (Math.random() - 0.5) * spread * 2)
       .normalize();

    /* --- рейкаст --- */
    this._raycaster.set(origin, dir);
    const hits = this._raycaster.intersectObjects(this.hittables, false);

    let endPoint, hitInfo = null;
    if (hits.length > 0) { hitInfo = hits[0]; endPoint = hitInfo.point.clone(); }
    else endPoint = origin.clone().addScaledVector(dir, 200);

    /* --- мировые координаты дула --- */
    this.weaponRoot.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld(true);
    const muzzleCam = this.muzzle.clone().applyMatrix4(this.weaponRoot.matrixWorld);
    const muzzleWorld = muzzleCam.clone().applyMatrix4(this.camera.matrixWorld);

    this.effects?.spawnTracer(muzzleWorld, endPoint);

    /* --- вспышка --- */
    this.flashGroup.visible = true;
    this.flashGroup.rotation.z = Math.random() * Math.PI * 2;
    this.flashGroup.scale.setScalar(0.85 + Math.random() * 0.5);
    this.flashLight.intensity = 7 + Math.random() * 4;
    this.worldFlashLight.position.copy(muzzleWorld);
    this.worldFlashLight.intensity = 40;
    this.flashTimer = 0.045;

    /* --- отдача --- */
    const i = Math.min(this.shotIndex, 30);
    const recoilScale = 1 - this.adsAmount * this.cfg.RECOIL_ADS_MULT;
    const vert = (this.cfg.RECOIL_VERT +
                  this.cfg.RECOIL_VERT_GROWTH * Math.min(i / 10, 1)) * recoilScale;
    const horiz = (Math.sin(i * 0.68) * this.cfg.RECOIL_HORIZ * Math.min(i / 5, 1)
                + Math.sin(i * 0.31) * this.cfg.RECOIL_HORIZ2 * Math.min(i / 8, 1)
                + (Math.random() - 0.5) * 0.0022) * recoilScale;

    this.player.pitch = Math.max(-this.player.pitchLimit,
                        Math.min(this.player.pitchLimit, this.player.pitch + vert));
    this.player.yaw += horiz;

    this.kickPos.z += (0.024 + Math.random() * 0.010) * recoilScale;
    this.kickPos.y += 0.003;
    this.kickRot.x += (0.070 + Math.random() * 0.025) * recoilScale;
    this.kickRot.z += (Math.random() - 0.5) * 0.04;
    this.kickRot.y += (Math.random() - 0.5) * 0.025;

    this.camShakeVel.x += (Math.random() - 0.5) * 3.0 * recoilScale;
    this.camShakeVel.y += (Math.random() - 0.5) * 3.0 * recoilScale;
    this.camShakeVel.z += (Math.random() - 0.5) * 1.6 * recoilScale;

    /* --- гильза --- */
    const ejectCam = new THREE.Vector3(0.04, 0.01, -0.10).applyMatrix4(this.weaponRoot.matrixWorld);
    const ejectWorld = ejectCam.clone().applyMatrix4(this.camera.matrixWorld);
    const ejectDir = new THREE.Vector3(1, 0, 0).applyEuler(
      new THREE.Euler(this.player.pitch, this.player.yaw, 0, 'YXZ')
    );
    this.effects?.spawnCasing(ejectWorld, ejectDir.multiplyScalar(2.0));

    /* --- попадание --- */
    if (hitInfo && this.effects) {
      const n = hitInfo.face
        ? hitInfo.face.normal.clone().transformDirection(hitInfo.object.matrixWorld)
        : dir.clone().negate();
      this.effects.addDecal(hitInfo.point, n, 0.045);

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
        const isPlate = this._isPlate
          ? this._isPlate(hitInfo.object)
          : hitInfo.object?.userData?.isPlate;
        if (isPlate) this.audio.ping();
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
    this._updateWeapon(dt);
    this._updateFiring(dt);
    this._updateFlash(dt);
    this._applyToCamera();
    this._applyHudOpacity();
  }

  _updateState(dt) {
    if (this.state === 'drawing') {
      this.time += dt;
      if (this.time / this.cfg.DRAW_DUR >= 1) { this.state = 'idle'; this.time = 0; }
    } else if (this.state === 'inspecting') {
      this.time += dt;
      if (this.time >= this.cfg.INSPECT_DUR) { this.state = 'idle'; this.time = 0; }
    }
  }

  /* ---------- анимации ---------- */
  _updateWeapon(dt) {
    const pos = new THREE.Vector3(this.cfg.BASE_POS.x, this.cfg.BASE_POS.y, this.cfg.BASE_POS.z);
    const rot = new THREE.Vector3(this.cfg.BASE_ROT.x, this.cfg.BASE_ROT.y, this.cfg.BASE_ROT.z);

    /* --- Доставание --- */
    if (this.state === 'drawing') {
      const t = Math.min(this.time / this.cfg.DRAW_DUR, 1);
      const k = 1 - _easeOutCubic(t);
      pos.y -= k * 0.55; pos.z += k * 0.12;
      rot.x -= k * 1.25; rot.z += k * 0.45; rot.y += k * 0.25;
    }

    /* --- Осмотр --- */
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

    /* --- Перезарядка --- */
    if (this.state === 'reloading') {
      this.time += dt;
      this._reloadStep();
    }

    /* --- Инерция --- */
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

    const bobMul = 1 - this.adsAmount * 0.85;
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
    this.camShakeVel.multiplyScalar(Math.max(0, 1 - 9 * dt));
    this.camShake.addScaledVector(this.camShakeVel, dt * 0.02);
    this.camShake.multiplyScalar(Math.max(0, 1 - 8 * dt));

    /* --- применяем --- */
    this.weaponRoot.position.copy(pos);
    this.weaponRoot.rotation.set(rot.x, rot.y, rot.z);
  }

  _reloadStep() {
    const t = this.time;
    const T = this.cfg.RELOAD_TIMELINE;
    const F = this.reloadFlags;

    /* --- Наклон/покачивание всего оружия --- */
    const tiltIn  = _smoothstep(0.00, 0.22, t);
    const tiltOut = 1 - _smoothstep(this.cfg.RELOAD_DUR - 0.35, this.cfg.RELOAD_DUR, t);
    const tilt = tiltIn * tiltOut;
    // Значения передаются в _updateWeapon через отдельные смещения — здесь
    // мы просто применяем их через this.weaponRoot напрямую (после отработки
    // базовых слоёв в _updateWeapon).

    /* --- Дроп магазина --- */
    if (!F.magDropped && t >= T.magDropped) {
      F.magDropped = true;
      if (this.magMesh) {
        this.effects?.spawnDroppedMag(this.magMesh);
        this.magMesh.visible = false;
      }
      this.audio?.click(0.30, 800, 0.08);
      setTimeout(() => this.audio?.click(0.18, 500, 0.12), 90);
    }

    /* --- Вставка магазина --- */
    if (t >= T.magSpawn && t < T.magInsert) {
      if (!F.magSpawned && this.magMesh) {
        F.magSpawned = true;
        this.magMesh.visible = true;
        this.magMesh.position.set(0, this.cfg.RELOAD_MAG_DROP_Y, 0);
      }
      const u = _smoothstep(T.magSpawn, T.magInsert, t);
      if (this.magMesh) {
        this.magMesh.position.y = this.cfg.RELOAD_MAG_DROP_Y * (1 - u);
      }
      if (!F.magInserted && u > 0.98 && this.magMesh) {
        F.magInserted = true;
        this.magMesh.position.set(0, 0, 0);
        this.audio?.click(0.34, 1200, 0.07);
      }
    }

    /* --- Выдача патронов --- */
    if (!F.ammoGiven && t >= T.ammoGiven) {
      F.ammoGiven = true;
      const need = this.cfg.MAG_SIZE - this.ammo;
      const give = Math.min(need, this.reserve);
      this.ammo    += give;
      this.reserve -= give;
      this._emitAmmo();
      this.audio?.click(0.26, 1500, 0.05);
    }

    /* --- Дёрганье затвора --- */
    if (t >= T.boltRackStart && t < T.boltRackEnd && this.boltMesh) {
      const u = (t - T.boltRackStart) / (T.boltRackEnd - T.boltRackStart);
      this.boltMesh.position.x = this.cfg.RELOAD_BOLT_TRAVEL * Math.sin(Math.PI * u);
      if (!F.boltRacked && u > 0.5) {
        F.boltRacked = true;
        this.audio?.click(0.42, 1000, 0.07);
        this.audio?.click(0.30, 2400, 0.05);
      }
    } else if (this.boltMesh) {
      this.boltMesh.position.x = 0;
    }

    /* --- Конец перезарядки --- */
    if (t >= this.cfg.RELOAD_DUR) {
      this.state = 'idle';
      this.time  = 0;
      if (this.magMesh) {
        this.magMesh.position.set(0, 0, 0);
        this.magMesh.visible = true;
      }
    }

    /* --- Наклон оружия через отдельное смещение (после базовых слоёв) --- */
    // Накладываем поверх текущего weaponRoot.position/rotation — в update loop
    // после _updateWeapon мы не можем этого сделать, поэтому добавляем
    // накопительно к локальному pos/rot прямо здесь.
    // Реализация: ниже в _updateWeapon мы возвращаем наклон через поля
    // this._reloadTiltX / _reloadTiltZ, которые применяются поверх.
    this._reloadTilt = tilt;
  }

  _updateFiring(dt) {
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.triggerHeld && this.state === 'idle' && this.fireCooldown <= 0) {
      this.tryFire();
    }
    if (!this.triggerHeld) {
      this.shotIndex = Math.max(0, this.shotIndex - dt * 25);
    }
  }

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
      this._crossEl.style.opacity = String(1 - this.adsAmount * 0.75);
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
   9 · ПРИМЕР ИСПОЛЬЗОВАНИЯ

   import * as THREE from 'three';
   import {
     M4A1_CONFIG, createM4A1, createM4A1Materials,
     WeaponEffects, WeaponAudio, PlayerController, M4A1Controller
   } from './m4a1.js';

   const renderer = new THREE.WebGLRenderer({ antialias: true });
   renderer.setSize(innerWidth, innerHeight);
   renderer.autoClear = false;
   document.body.appendChild(renderer.domElement);

   const scene = new THREE.Scene();
   const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.05, 500);
   const weaponScene = new THREE.Scene();
   const weaponCamera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.01, 30);

   const hittables = [];   // меши, по которым стреляем
   const colliders = [];   // AABB-коллайдеры для игрока

   const player  = new PlayerController({ startPos: {x:0, y:1.7, z:10}, colliders });
   const effects = new WeaponEffects(scene);
   const audio   = new WeaponAudio(0.55);

   const m4 = new M4A1Controller({
     weaponScene, weaponCamera, scene, camera,
     player, hittables, colliders, effects, audio,
     crosshairEl: document.getElementById('cross'),
     onAmmoChange: (a, r) => { /* обновить HUD *\/ },
     onStateMessage: (t, d) => { /* показать сообщение *\/ },
     onFire: (hit) => { /* хук *\/ },
     isPlate: (obj) => obj?.userData?.isPlate
   });
   m4.mount();

   document.addEventListener('keydown', e => { player.onKeyDown(e.code); m4.onKeyDown(e.code); });
   document.addEventListener('keyup',   e => { player.onKeyUp(e.code); });
   document.addEventListener('mousemove', e => {
     if (document.pointerLockElement) {
       player.lookSensMult = 1 - m4.adsAmount * M4A1_CONFIG.MOUSE_ADS_MULT;
       player.look(e.movementX, e.movementY);
       m4.onMouseMove(e.movementX, e.movementY);
     }
   });
   document.addEventListener('mousedown', e => m4.onMouseDown(e.button));
   document.addEventListener('mouseup',   e => m4.onMouseUp(e.button));
   document.addEventListener('contextmenu', e => e.preventDefault());

   const clock = new THREE.Clock();
   (function loop() {
     requestAnimationFrame(loop);
     const dt = Math.min(clock.getDelta(), 0.05);
     player.speedMult = 1 - m4.adsAmount * M4A1_CONFIG.MOVE_ADS_MULT;
     player.update(dt);
     m4.update(dt);
     effects.update(dt);

     camera.position.copy(player.pos);
     camera.rotation.set(
       player.pitch + m4.camShakeOffset.x,
       player.yaw   + m4.camShakeOffset.y,
       m4.camShakeOffset.z,
       'YXZ'
     );

     renderer.clear();
     renderer.render(scene, camera);
     renderer.clearDepth();
     renderer.render(weaponScene, weaponCamera);
   })();
   ═══════════════════════════════════════════════════════════════════════════ */