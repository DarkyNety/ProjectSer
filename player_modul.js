/* ============================================================================
 * Voxel Duster Character · Reusable Three.js Module
 * ----------------------------------------------------------------------------
 * Что можно взять по отдельности:
 *   - CHARACTER_CONFIG           — все числа: цвета, размеры, скорости, камеры
 *   - createCharacterMaterials() — фабрика материалов
 *   - createCharacter()          — чистая модель (Group с иерархией костей)
 *   - solveTwoBoneIK()           — IK-солвер для рук на оружии
 *   - CharacterController        — вся механика: движение, анимации рук и ног,
 *                                  камера, коллизии, ADS, переключение 1/3 лица
 * ----------------------------------------------------------------------------
 * Иерархия костей:
 *   root
 *    └─ Body
 *       ├─ Leg_R (hip → knee → ankle)
 *       ├─ Leg_L (hip → knee → ankle)
 *       ├─ CoatTailFR / FL / BR / BL
 *       └─ Upper              (пивот в тазу)
 *          ├─ CoatUpper
 *          ├─ Arm_R (shoulder → elbow → hand)
 *          ├─ Arm_L (shoulder → elbow → hand)
 *          ├─ BackSlot
 *          └─ Head
 * ==========================================================================*/

import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════════════
   1 · КОНФИГ
   ═══════════════════════════════════════════════════════════════════════════ */

export const CHARACTER_CONFIG = {
  COLORS: {
    skin:  "#cf9a71",
    hair:  "#2e2014",
    shirt: "#7f9fbd",
    pants: "#3d4a5e",
    shoes: "#1a1714",
    coatBase:   0x0e0e16,
    coatCollar: 0x15151c,
  },

  DIMENSIONS: {
    headSize: 0.24, headRes: 7,
    torsoW: 0.36, torsoH: 0.55, torsoD: 0.20,
    hipY:   0.90,
    thighL: 0.42, shinL: 0.38, legT: 0.17,
    legSpacing: 0.09,
    upperArmL: 0.30, forearmL: 0.28, armT: 0.12,
    shoulderSpacing: 0.24,
  },

  COAT: {
    voxel:         0.034,
    yTop:          1.44,
    coatNL:        36,
    maxTatter:     10,
    frontGap:      0.85,
    numStrands:    24,
    outerPad:      0.0238,
    innerOff:      0.040,
    wallTol:       0.30,
    collarNL:      4,
    collarGap:     0.55,
  },

  MOVEMENT: {
    walkSpeed:   1.55,
    sprintMul:   1.35,
    crouchMul:   0.45,
    drawPenalty: 0.35,
    jumpSpeed:   4.2,
    gravity:     13.5,
    worldLimit:  26,
    radius:      0.42,
    height:      1.70,
    accelGround: 14,
    accelAir:    3,
    airRecover:  12,
  },

  ANIMATION: {
    /* ноги */
    legAmpBase:   0.55, legAmpSprint:  0.20,
    kneeAmpBase:  0.75, kneeAmpSprint: 0.30,
    /* руки */
    armAmpBase:   0.50, armAmpSprint:  0.30,
    elbowAmpBase: 0.45, elbowAmpSprint: 0.40,
    /* присед / прыжок */
    crouchHip:   -0.85, crouchKnee:   1.55,
    airHip:      -0.45, airKnee:      0.85,
    /* походка */
    cadenceBase:  5.2, cadenceSprint: 4.0,
    /* торс / голова */
    torsoLeanMove:  0.10,
    torsoLeanCrouch:0.20,
    headCounter:    0.55,
    /* плащ */
    coatLagBack:    0.45,
    coatSideLag:    0.22,
    /* ADS-стойка рук */
    adsShoulderX:  -0.72,
    adsShoulderZ:   0.14,
    adsElbowX:     -0.92,
  },

  CAMERA_TPS: {
    sensitivity: 0.0026,
    pitchLimit:  1.15,
    distIdle: 3.00, distAim: 1.75,
    sideIdle: 0.30, sideAim: 0.85,
    upIdle:   1.10, upAim:   0.55,
    chest:    1.35,
    lookAhead: 2.0,
    enterDur: 0.30, exitDur: 0.24,
    baseFov:  52, aimFovDelta: -8,
    smoothPos: 0.0008,
    smoothTgt: 0.0004,
    crouchDrop: 0.30,
  },

  CAMERA_FPS: {
    eyeY:       1.65,
    pitchLimit: 1.45,
    adsEnter:   0.20, adsExit: 0.16,
    baseFov:    75, adsFovDelta: -24,
  },

  ADS: {
    enterDur: 0.28, exitDur: 0.22,
    mouseAdsMult: 0.55,
    moveAdsMult:  0.50,
  },

  MOUSE_SENS: 0.0022,
};

/* ═══════════════════════════════════════════════════════════════════════════
   2 · ВОКСЕЛЬ-ТУЛКИТ
   ═══════════════════════════════════════════════════════════════════════════ */

function _hash3(x, y, z) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function _dedupe(cells) {
  const seen = new Set();
  const out = [];
  for (const c of cells) {
    const k = c[0] + '|' + c[1] + '|' + c[2];
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out;
}

function _cellsToInstanced(cells, mat, baseHex, variation, vox) {
  const geo = new THREE.BoxGeometry(vox, vox, vox);
  const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const base = new THREE.Color(baseHex);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    m.makeTranslation(c[0] * vox, c[1] * vox, c[2] * vox);
    mesh.setMatrixAt(i, m);
    const f = 1 + (_hash3(c[0], c[1], c[2]) - 0.5) * variation;
    col.copy(base).multiplyScalar(f);
    mesh.setColorAt(i, col);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function _voxelSolidCyl(rTop, rBot, length, yOffset, tol, vox) {
  const cells = [];
  const NL = Math.max(1, Math.round(length / vox));
  const gMax = Math.ceil(Math.max(rTop, rBot) / vox) + 1;
  for (let iy = 0; iy <= NL; iy++) {
    const t = iy / NL;
    const R = rTop + (rBot - rTop) * t;
    const gy = yOffset - iy;
    for (let gx = -gMax; gx <= gMax; gx++) {
      for (let gz = -gMax; gz <= gMax; gz++) {
        const px = gx * vox;
        const pz = gz * vox;
        if (px * px + pz * pz <= (R + vox * tol) * (R + vox * tol)) {
          cells.push([gx, gy, gz]);
        }
      }
    }
  }
  return cells;
}

function _voxelSolidSphere(r, yScale, vox) {
  const cells = [];
  const gMax = Math.ceil(r / vox) + 1;
  for (let gx = -gMax; gx <= gMax; gx++) {
    for (let gy = -gMax; gy <= gMax; gy++) {
      for (let gz = -gMax; gz <= gMax; gz++) {
        const px = gx * vox;
        const py = gy * vox / yScale;
        const pz = gz * vox;
        if (px * px + py * py + pz * pz <= r * r) {
          cells.push([gx, gy, gz]);
        }
      }
    }
  }
  return cells;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · МАТЕРИАЛЫ
   ═══════════════════════════════════════════════════════════════════════════ */

export function createCharacterMaterials(config = CHARACTER_CONFIG) {
  const C = config.COLORS;
  const mat = (c, r = 0.85, m = 0.05) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });

  return {
    skin:  mat(C.skin),
    hair:  mat(C.hair, 0.94),
    shirt: mat(C.shirt, 0.92, 0.03),
    pants: mat(C.pants, 0.94, 0.03),
    shoes: mat(C.shoes, 0.85, 0.12),
    dark:  mat(0x1a1714, 0.80, 0.15),
    metal: mat(0xa8a090, 0.32, 0.90),

    coat: new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.78, metalness: 0.08,
    }),

    lens: new THREE.MeshPhysicalMaterial({
      color: 0x0a0a15, metalness: 1.0, roughness: 0.06,
      emissive: 0x101a30, emissiveIntensity: 0.35,
    }),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · ГЕНЕРАЦИЯ ПЛАЩА
   ═══════════════════════════════════════════════════════════════════════════ */

function _buildCoatSections(config) {
  const CO = config.COAT;
  const vox = CO.voxel;

  const Y_TOP_G = Math.round(CO.yTop / vox);
  const HIP_G = Math.round(config.DIMENSIONS.hipY / vox);
  const UPPER_CUT = Y_TOP_G - HIP_G;

  const strandLen = [];
  for (let s = 0; s < CO.numStrands; s++) {
    const smooth =
      Math.sin(s * 0.72) * 0.50 +
      Math.sin(s * 1.83 + 1.30) * 0.32 +
      Math.sin(s * 4.10 + 0.60) * 0.18;
    const r = _hash3(s * 13 + 5, 7, 13);
    strandLen[s] = Math.max(0, Math.round(3.0 + smooth * 2.5 + (r - 0.5) * 4.5));
  }

  const sec = { upper: [], tailFL: [], tailFR: [], tailBL: [], tailBR: [] };

  for (let iy = 0; iy < CO.coatNL + CO.maxTatter; iy++) {
    const t = Math.min(iy / (CO.coatNL - 1), 1);
    const Rx = 0.215 + 0.025 * t;
    const Rz = 0.135 + 0.020 * t;
    const gy = Y_TOP_G - iy;
    if (gy < 0) continue;

    const oRx = Rx + CO.outerPad;
    const oRz = Rz + CO.outerPad;
    const iRx = Rx - CO.innerOff;
    const iRz = Rz - CO.innerOff;

    const gxMax = Math.ceil(oRx / vox) + 1;
    const gzMax = Math.ceil(oRz / vox) + 1;

    for (let gx = -gxMax; gx <= gxMax; gx++) {
      for (let gz = -gzMax; gz <= gzMax; gz++) {
        const px = gx * vox;
        const pz = gz * vox;

        if (Math.hypot(px / oRx, pz / oRz) > 1.0 + CO.wallTol * vox) continue;
        if (Math.hypot(px / iRx, pz / iRz) < 1.0 - CO.wallTol * vox) continue;

        const th = Math.atan2(px, pz);
        if (Math.abs(th) < CO.frontGap) continue;

        const u = (th + Math.PI) / (Math.PI * 2);
        const s = Math.floor(u * CO.numStrands) % CO.numStrands;
        if (iy - (CO.coatNL - 1) > strandLen[s]) continue;

        const cell = [gx, gy, gz];
        if (iy < UPPER_CUT) sec.upper.push(cell);
        else if (th >= 0 && th < Math.PI / 2) sec.tailFR.push(cell);
        else if (th >= Math.PI / 2) sec.tailBR.push(cell);
        else if (th >= -Math.PI / 2 && th < 0) sec.tailFL.push(cell);
        else sec.tailBL.push(cell);
      }
    }
  }

  const collar = [];
  const COL_Y0 = Math.round(1.42 / vox);
  for (let iy = 0; iy <= CO.collarNL; iy++) {
    const t = iy / CO.collarNL;
    const Rx = 0.120 + 0.025 * t + CO.outerPad;
    const Rz = 0.092 + 0.020 * t + CO.outerPad;
    const iRx = 0.120 + 0.025 * t - 0.035;
    const iRz = 0.092 + 0.020 * t - 0.035;
    const gy = COL_Y0 + iy;
    const gxMax = Math.ceil(Rx / vox) + 1;
    const gzMax = Math.ceil(Rz / vox) + 1;
    for (let gx = -gxMax; gx <= gxMax; gx++) {
      for (let gz = -gzMax; gz <= gzMax; gz++) {
        const px = gx * vox;
        const pz = gz * vox;
        if (Math.hypot(px / Rx, pz / Rz) > 1.0 + CO.wallTol * vox) continue;
        if (Math.hypot(px / iRx, pz / iRz) < 1.0 - CO.wallTol * vox) continue;
        const th = Math.atan2(px, pz);
        if (Math.abs(th) < CO.collarGap) continue;
        collar.push([gx, gy, gz]);
      }
    }
  }

  return { sections: sec, collar };
}

function _buildUpperSleeve(mats, vox) {
  const cells = _dedupe([
    ..._voxelSolidSphere(0.100, 0.85, vox),
    ..._voxelSolidCyl(0.090, 0.083, 0.34, 0, 0.15, vox),
  ]);
  return _cellsToInstanced(cells, mats.coat, 0x0e0e16, 0.55, vox);
}

function _buildLowerSleeve(mats, vox) {
  const cells = _dedupe([
    ..._voxelSolidCyl(0.083, 0.076, 0.26, 0, 0.15, vox),
    ..._voxelSolidCyl(0.100, 0.105, 0.10, -0.22, 0.15, vox),
  ]);
  return _cellsToInstanced(cells, mats.coat, 0x0e0e16, 0.55, vox);
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · СБОРКА МОДЕЛИ
   ═══════════════════════════════════════════════════════════════════════════ */

export function createCharacter(config = CHARACTER_CONFIG, materials = null) {
  const CFG = config;
  const D = CFG.DIMENSIONS;
  const M = materials || createCharacterMaterials(CFG);
  const vox = CFG.COAT.voxel;

  const root = new THREE.Group();
  root.name = 'Character';

  const body = new THREE.Group();
  body.name = 'Body';
  root.add(body);

  const upper = new THREE.Group();
  upper.name = 'Upper';
  upper.position.y = D.hipY;
  body.add(upper);

  function box(parent, w, h, d, m, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /* --- НОГИ --- */
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.name = side > 0 ? 'Leg_R' : 'Leg_L';
    hip.position.set(side * D.legSpacing, D.hipY, 0);
    body.add(hip);

    box(hip, D.legT, D.thighL, D.legT, M.pants, 0, -D.thighL / 2, 0);

    const knee = new THREE.Group();
    knee.position.y = -D.thighL;
    hip.add(knee);

    box(knee, D.legT * 0.88, D.shinL, D.legT * 0.88, M.pants, 0, -D.shinL / 2, 0);

    const ankle = new THREE.Group();
    ankle.position.y = -D.shinL;
    knee.add(ankle);

    box(ankle, D.legT * 1.05, 0.10, D.legT * 1.7, M.shoes, 0, -0.05, D.legT * 0.30);

    return { hip, knee, ankle };
  }
  const legR = makeLeg(1);
  const legL = makeLeg(-1);

  /* --- ТОРС --- */
  box(upper, D.torsoW, D.torsoH, D.torsoD, M.shirt, 0, D.torsoH / 2, 0);
  box(upper, D.torsoW + 0.02, 0.05, D.torsoD + 0.01, M.dark, 0, 0.020, 0);
  box(upper, 0.045, 0.035, 0.018, M.metal, 0, 0.020, D.torsoD / 2 + 0.006);
  box(upper, 0.075, 0.10, 0.075, M.skin, 0, 0.600, 0);

  /* --- РУКИ --- */
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.name = side > 0 ? 'Arm_R' : 'Arm_L';
    shoulder.position.set(side * D.shoulderSpacing, 0.55, 0);
    upper.add(shoulder);

    box(shoulder, D.armT, D.upperArmL, D.armT, M.shirt, 0, -D.upperArmL / 2, 0);

    const elbow = new THREE.Group();
    elbow.position.y = -D.upperArmL;
    shoulder.add(elbow);

    box(elbow, D.armT * 0.92, D.forearmL, D.armT * 0.92, M.shirt, 0, -D.forearmL / 2, 0);

    const hand = new THREE.Group();
    hand.position.y = -D.forearmL;
    elbow.add(hand);

    box(hand, D.armT * 0.85, D.armT * 0.95, D.armT * 0.90, M.skin, 0, -0.05, 0);
    box(hand, D.armT * 0.30, D.armT * 0.55, D.armT * 0.32, M.skin,
      -side * D.armT * 0.48, -0.03, D.armT * 0.22);

    shoulder.add(_buildUpperSleeve(M, vox));
    elbow.add(_buildLowerSleeve(M, vox));

    return { shoulder, elbow, hand };
  }
  const armR = makeArm(1);
  const armL = makeArm(-1);

  /* --- ГОЛОВА --- */
  const headBone = new THREE.Group();
  headBone.name = 'Head';
  headBone.position.set(0, 0.62, 0);
  upper.add(headBone);

  const headGroup = new THREE.Group();
  headGroup.position.y = 0.13;
  headBone.add(headGroup);

  const HS = D.headSize;
  const res = D.headRes;
  const voxHead = HS / res;
  const halfHead = (res - 1) / 2;
  const vGeo = new THREE.BoxGeometry(voxHead, voxHead, voxHead);

  const insideHead = (nx, ny, nz) => {
    const taper = ny < -0.3 ? 0.76 : (ny < 0.1 ? 0.92 : 1.0);
    const mx = 0.86 * taper;
    const mz = 1.00 * taper;
    if (Math.abs(nx) > mx || Math.abs(nz) > mz || Math.abs(ny) > 1.0) return false;
    const c = Math.pow(Math.abs(nx) / mx, 4) +
              Math.pow(Math.abs(nz) / mz, 4) +
              Math.pow(Math.abs(ny), 4) * 0.55;
    return c <= 1.65;
  };

  for (let ix = 0; ix < res; ix++) {
    for (let iy = 0; iy < res; iy++) {
      for (let iz = 0; iz < res; iz++) {
        const nx = (ix - halfHead) / halfHead;
        const ny = (iy - halfHead) / halfHead;
        const nz = (iz - halfHead) / halfHead;
        if (!insideHead(nx, ny, nz)) continue;
        let m = M.skin;
        if (ny > 0.55 || (nz < -0.25 && ny > -0.3) || (Math.abs(nx) > 0.6 && ny > 0.4)) {
          m = M.hair;
        }
        const v = new THREE.Mesh(vGeo, m);
        v.position.set(
          (ix - halfHead) * voxHead,
          (iy - halfHead) * voxHead,
          (iz - halfHead) * voxHead
        );
        v.castShadow = true;
        v.receiveShadow = true;
        headGroup.add(v);
      }
    }
  }

  const faceZ = HS * 0.5;
  const eyeY = HS * 0.06;
  const lensW = HS * 0.32;
  const lensH = HS * 0.16;
  const frameT = HS * 0.016;

  [-1, 1].forEach(s => {
    const lens = new THREE.Mesh(new THREE.BoxGeometry(lensW, lensH, HS * 0.02), M.lens);
    lens.position.set(s * HS * 0.21, eyeY, faceZ + 0.008);
    headGroup.add(lens);

    const top = new THREE.Mesh(new THREE.BoxGeometry(lensW + frameT * 2, frameT, HS * 0.026), M.dark);
    top.position.set(s * HS * 0.21, eyeY + lensH / 2, faceZ + 0.008);
    headGroup.add(top);

    const bot = top.clone();
    bot.position.y = eyeY - lensH / 2;
    headGroup.add(bot);

    const outer = new THREE.Mesh(new THREE.BoxGeometry(frameT, lensH, HS * 0.026), M.dark);
    outer.position.set(s * (HS * 0.21 + lensW / 2), eyeY, faceZ + 0.008);
    headGroup.add(outer);

    const temple = new THREE.Mesh(
      new THREE.BoxGeometry(HS * 0.016, HS * 0.016, HS * 0.55),
      M.dark
    );
    temple.position.set(s * HS * 0.40, eyeY, faceZ - HS * 0.22);
    headGroup.add(temple);
  });

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(HS * 0.10, HS * 0.02, HS * 0.026), M.dark);
  bridge.position.set(0, eyeY + lensH * 0.3, faceZ + 0.008);
  headGroup.add(bridge);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(HS * 0.09, HS * 0.12, HS * 0.10), M.skin);
  nose.position.set(0, 0, faceZ + HS * 0.03);
  nose.castShadow = true;
  headGroup.add(nose);

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(HS * 0.13, HS * 0.014, HS * 0.02), M.dark);
  mouth.position.set(0, -HS * 0.20, faceZ + 0.002);
  headGroup.add(mouth);

  const mustache = new THREE.Mesh(
    new THREE.BoxGeometry(HS * 0.22, HS * 0.055, HS * 0.03),
    M.hair
  );
  mustache.position.set(0, -HS * 0.155, faceZ + 0.006);
  headGroup.add(mustache);

  const goatee = new THREE.Mesh(
    new THREE.BoxGeometry(HS * 0.15, HS * 0.17, HS * 0.055),
    M.hair
  );
  goatee.position.set(0, -HS * 0.33, faceZ - 0.012);
  headGroup.add(goatee);

  [-1, 1].forEach(s => {
    const sb = new THREE.Mesh(
      new THREE.BoxGeometry(HS * 0.03, HS * 0.20, HS * 0.05),
      M.hair
    );
    sb.position.set(s * HS * 0.40, 0, faceZ - HS * 0.12);
    headGroup.add(sb);

    const ear = new THREE.Mesh(
      new THREE.BoxGeometry(HS * 0.055, HS * 0.19, HS * 0.13),
      M.skin
    );
    ear.position.set(s * HS * 0.47, 0, 0);
    ear.castShadow = true;
    headGroup.add(ear);
  });

  /* --- ПЛАЩ --- */
  const { sections, collar } = _buildCoatSections(CFG);

  const coatUpper = new THREE.Group();
  coatUpper.name = 'CoatUpper';
  coatUpper.position.y = -D.hipY;
  upper.add(coatUpper);

  coatUpper.add(_cellsToInstanced(sections.upper, M.coat, CFG.COLORS.coatBase, 0.55, vox));
  coatUpper.add(_cellsToInstanced(collar, M.coat, CFG.COLORS.coatCollar, 0.45, vox));

  const Y_TOP_G = Math.round(CFG.COAT.yTop / vox);
  const HIP_G = Math.round(D.hipY / vox);
  const TAIL_TOP_Y = (Y_TOP_G - (Y_TOP_G - HIP_G)) * vox;

  function makeCoatTail(name, cells) {
    const bone = new THREE.Group();
    bone.name = name;
    bone.position.set(0, TAIL_TOP_Y, 0);
    body.add(bone);

    const wrap = new THREE.Group();
    wrap.position.y = -TAIL_TOP_Y;
    bone.add(wrap);
    wrap.add(_cellsToInstanced(cells, M.coat, CFG.COLORS.coatBase, 0.55, vox));
    return bone;
  }

  const coatTailFR = makeCoatTail('CoatTailFR', sections.tailFR);
  const coatTailFL = makeCoatTail('CoatTailFL', sections.tailFL);
  const coatTailBR = makeCoatTail('CoatTailBR', sections.tailBR);
  const coatTailBL = makeCoatTail('CoatTailBL', sections.tailBL);

  /* --- ТОЧКА ЗА СПИНОЙ --- */
  const backSlot = new THREE.Group();
  backSlot.name = 'BackSlot';
  backSlot.position.set(0.05, 0.55, -0.28);
  upper.add(backSlot);

  root.userData.bones = {
    legR, legL,
    armR, armL,
    head: headBone,
    upper, body, root,
    backSlot,
    coatTails: [coatTailFR, coatTailFL, coatTailBR, coatTailBL],
    coatUpper,
  };
  root.userData.materials = M;

  return root;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6 · TWO-BONE IK
   ═══════════════════════════════════════════════════════════════════════════ */

const _ikDiff = new THREE.Vector3();
const _ikU    = new THREE.Vector3();
const _ikPole = new THREE.Vector3();
const _ikE    = new THREE.Vector3();
const _ikUA   = new THREE.Vector3();
const _ikVA   = new THREE.Vector3();
const _ikW    = new THREE.Vector3();
const _ikX    = new THREE.Vector3();
const _ikY    = new THREE.Vector3();
const _ikZ    = new THREE.Vector3();
const _ikMat  = new THREE.Matrix4();

export function solveTwoBoneIK(shoulderPos, targetPos, L1, L2, poleDir, outQuat) {
  _ikDiff.subVectors(targetPos, shoulderPos);
  let d = _ikDiff.length();
  const dMin = Math.abs(L1 - L2) + 1e-4;
  const dMax = L1 + L2 - 1e-4;
  d = Math.max(dMin, Math.min(dMax, d));

  _ikU.copy(_ikDiff).normalize();

  const cosA = Math.max(-1, Math.min(1, (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2)));
  const alpha = Math.acos(cosA);
  const elbowAngle = -alpha;

  _ikPole.copy(poleDir);
  _ikPole.addScaledVector(_ikU, -_ikPole.dot(_ikU));
  if (_ikPole.lengthSq() < 1e-8) {
    _ikPole.set(1, 0, 0).addScaledVector(_ikU, -_ikU.x);
    if (_ikPole.lengthSq() < 1e-8) {
      _ikPole.set(0, 1, 0).addScaledVector(_ikU, -_ikU.y);
    }
  }
  _ikPole.normalize();

  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _ikE.copy(shoulderPos).addScaledVector(_ikU, a).addScaledVector(_ikPole, h);

  _ikUA.subVectors(_ikE, shoulderPos).normalize();
  _ikVA.subVectors(targetPos, _ikE).normalize();

  _ikW.copy(_ikVA).addScaledVector(_ikUA, -_ikVA.dot(_ikUA));
  if (_ikW.lengthSq() < 1e-8) {
    _ikW.set(0, 0, 1).cross(_ikUA);
    if (_ikW.lengthSq() < 1e-8) _ikW.set(1, 0, 0).cross(_ikUA);
  }
  _ikW.normalize();

  _ikX.crossVectors(_ikW, _ikUA);
  _ikY.copy(_ikUA).negate();
  _ikZ.copy(_ikW);

  _ikMat.makeBasis(_ikX, _ikY, _ikZ);
  outQuat.setFromRotationMatrix(_ikMat);
  return elbowAngle;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7 · КОНТРОЛЛЕР
   ═══════════════════════════════════════════════════════════════════════════ */

const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _smoothstep = (a, b, x) => {
  const t = _clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const _lerp = (a, b, t) => a + (b - a) * t;
const _damp = (k, dt) => 1 - Math.pow(k, dt);

export class CharacterController {
  constructor(opts) {
    this.scene    = opts.scene;
    this.renderer = opts.renderer;
    this.camera   = opts.camera;

    this.colliders  = opts.colliders || [];
    this.worldLimit = opts.worldLimit ?? CHARACTER_CONFIG.MOVEMENT.worldLimit;

    this.cfg = CHARACTER_CONFIG;

    this.materials = createCharacterMaterials(this.cfg);
    this.root = createCharacter(this.cfg, this.materials);
    this.scene.add(this.root);

    const B = this.root.userData.bones;
    this.bones = {
      root: this.root,
      body: B.body,
      upper: B.upper,
      legR: B.legR,
      legL: B.legL,
      armR: B.armR,
      armL: B.armL,
      head: B.head,
      backSlot: B.backSlot,
      coatTails: B.coatTails,
      coatUpper: B.coatUpper,
    };

    this.L_upperArm = this.cfg.DIMENSIONS.upperArmL;
    this.L_forearm  = this.cfg.DIMENSIONS.forearmL;
    this.shoulderR_local = new THREE.Vector3(
      this.cfg.DIMENSIONS.shoulderSpacing, 0.55, 0
    );
    this.shoulderL_local = new THREE.Vector3(
      -this.cfg.DIMENSIONS.shoulderSpacing, 0.55, 0
    );

    const S = this.state = {
      viewMode: 'third',
      grounded: true,
      vy: 0,
      baseY: 0,
      speed: 0,
      phase: 0,
      moveBlend: 0,
      crouch: 0, crouchTarget: 0,
      sprint: 0, sprintTarget: 0,
      air: 0,
      turnVel: 0,
      keys: Object.create(null),
      lmb: false,
      rmb: false,
      pointerLocked: false,
      yaw: 0,
      pitch: 0,
      adsRaw: 0, adsTarget: 0, adsAmount: 0,
    };

    if (opts.spawnPosition) this.root.position.copy(opts.spawnPosition);

    this._camSmooth = {
      pos: new THREE.Vector3(),
      target: new THREE.Vector3(),
      init: false,
    };

    this._vPressed = false;

    this.onViewChange = opts.onViewChange || null;

    this.root.visible = true;
  }

  get position() { return this.root.position; }
  get rotation() { return this.root.rotation; }
  get viewMode() { return this.state.viewMode; }
  isFPS() { return this.state.viewMode === 'first'; }
  isTPS() { return this.state.viewMode === 'third'; }
  get yaw()   { return this.state.yaw; }
  get pitch() { return this.state.pitch; }
  get adsAmount() { return this.state.adsAmount; }

  getEyeWorldPosition(out = new THREE.Vector3()) {
    out.set(
      this.root.position.x,
      this.root.position.y + this.cfg.CAMERA_FPS.eyeY,
      this.root.position.z
    );
    return out;
  }

  getUpperGroup() { return this.bones.upper; }

  getBone(name) {
    if (this.bones[name]) return this.bones[name];
    return this.root.getObjectByName(name);
  }

  onKeyDown(code) { this.state.keys[code] = true; }
  onKeyUp(code)   { this.state.keys[code] = false; }

  onMouseDown(button) {
    if (button === 0) this.state.lmb = true;
    if (button === 2) this.state.rmb = true;
  }
  onMouseUp(button) {
    if (button === 0) this.state.lmb = false;
    if (button === 2) this.state.rmb = false;
  }
  onMouseMove(dx, dy) {
    if (!this.state.pointerLocked) return;
    this.look(dx, dy);
  }
  setPointerLock(locked) {
    this.state.pointerLocked = locked;
    if (!locked) {
      this.state.lmb = false;
      this.state.rmb = false;
    }
  }

  look(dx, dy) {
    const s = this.state;
    const isFPS = s.viewMode === 'first';
    const sensBase = isFPS ? this.cfg.MOUSE_SENS : this.cfg.CAMERA_TPS.sensitivity;
    const adsMul = 1 - s.adsAmount * (1 - this.cfg.ADS.mouseAdsMult);
    const sens = sensBase * adsMul;

    s.yaw   -= dx * sens;
    s.pitch -= dy * sens;

    const pitchLimit = isFPS
      ? this.cfg.CAMERA_FPS.pitchLimit
      : this.cfg.CAMERA_TPS.pitchLimit;
    s.pitch = _clamp(s.pitch, -pitchLimit, pitchLimit);
  }

  setViewMode(mode, silent = false) {
    if (this.state.viewMode === mode) return;
    const old = this.state.viewMode;
    this.state.viewMode = mode;

    if (mode === 'first') {
      this.root.visible = false;
    } else {
      this.root.visible = true;
      this.root.rotation.y = this.state.yaw;
      this._camSmooth.init = false;
    }

    if (!silent && this.onViewChange) this.onViewChange(mode, old);
  }

  setAdsHeld(held) { this.state.adsTarget = held ? 1 : 0; }

  update(dt) {
    this._updateViewKey();
    this._updateAdsWeight(dt);
    const effSprint = this._updateMovement(dt);
    this._updatePoseAnimation(dt, effSprint);
    this._updateArmsPose(effSprint);
    this._updateCoat(dt, effSprint);
    this._updateCamera(dt);
  }

  _updateViewKey() {
    if (this.state.keys['KeyV']) {
      if (!this._vPressed) {
        this._vPressed = true;
        this.setViewMode(this.isFPS() ? 'third' : 'first');
      }
    } else {
      this._vPressed = false;
    }
  }

  _updateAdsWeight(dt) {
    const s = this.state;
    const isFPS = s.viewMode === 'first';
    s.adsTarget = isFPS
      ? (s.rmb ? 1 : 0)
      : ((s.lmb || s.rmb) ? 1 : 0);

    const dur = s.adsTarget > s.adsRaw
      ? (isFPS ? this.cfg.CAMERA_FPS.adsEnter : this.cfg.ADS.enterDur)
      : (isFPS ? this.cfg.CAMERA_FPS.adsExit  : this.cfg.ADS.exitDur);

    const step = dt / dur;
    if (s.adsRaw < s.adsTarget) {
      s.adsRaw = Math.min(s.adsTarget, s.adsRaw + step);
    } else if (s.adsRaw > s.adsTarget) {
      s.adsRaw = Math.max(s.adsTarget, s.adsRaw - step);
    }

    s.adsAmount = _smoothstep(0, 1, s.adsRaw);
  }

  _updateMovement(dt) {
    const s = this.state;
    const MV = this.cfg.MOVEMENT;
    const isFPS = s.viewMode === 'first';

    let ix = 0, iz = 0;
    if (s.keys['KeyW'] || s.keys['ArrowUp'])    iz -= 1;
    if (s.keys['KeyS'] || s.keys['ArrowDown'])  iz += 1;
    if (s.keys['KeyA'] || s.keys['ArrowLeft'])  ix += 1;
    if (s.keys['KeyD'] || s.keys['ArrowRight']) ix -= 1;

    const crouchKey = !!(s.keys['ControlLeft'] || s.keys['ControlRight'] || s.keys['KeyC']);
    const sprintKey = !!(s.keys['ShiftLeft'] || s.keys['ShiftRight']);
    const hasInput  = (ix !== 0 || iz !== 0);

    const useLookBasis = isFPS || s.pointerLocked;
    const moveDir = new THREE.Vector3();

    if (useLookBasis) {
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      const rx = fz;
      const rz = -fx;
      if (hasInput) {
        moveDir.set(fx * -iz + rx * ix, 0, fz * -iz + rz * ix).normalize();
      }
    } else {
      const camFwd = new THREE.Vector3();
      this.camera.getWorldDirection(camFwd);
      camFwd.y = 0;
      if (camFwd.lengthSq() < 1e-6) camFwd.set(0, 0, -1);
      camFwd.normalize();
      const camRight = new THREE.Vector3()
        .crossVectors(camFwd, new THREE.Vector3(0, 1, 0))
        .normalize();
      if (hasInput) {
        moveDir.addScaledVector(camFwd, -iz).addScaledVector(camRight, ix).normalize();
      }
    }

    s.crouchTarget = (crouchKey && s.grounded) ? 1 : 0;
    s.sprintTarget = (sprintKey && hasInput && !crouchKey && s.grounded && s.adsAmount < 0.5) ? 1 : 0;
    s.crouch += (s.crouchTarget - s.crouch) * Math.min(1, dt * 9);
    s.sprint += (s.sprintTarget - s.sprint) * Math.min(1, dt * 6);

    const canSprint = s.sprintTarget && s.adsAmount < 0.25;
    const effSprint = canSprint ? s.sprint : 0;

    const drawPenalty = 0;
    const adsMul = 1 - s.adsAmount * (1 - this.cfg.ADS.moveAdsMult);
    const baseSpeed = MV.walkSpeed *
      (1 - (1 - MV.crouchMul) * s.crouch) *
      (1 - drawPenalty) *
      adsMul;
    const maxSpeed = baseSpeed * (1 + effSprint * (MV.sprintMul - 1));
    const targetSpeed = hasInput ? maxSpeed : 0;
    s.speed += (targetSpeed - s.speed) * Math.min(1, dt * 9);

    const prevYaw = this.root.rotation.y;
    if (isFPS) {
      this.root.rotation.y = s.yaw;
    } else if (s.adsAmount > 0.15 || s.lmb || s.rmb) {
      let d = s.yaw - this.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.root.rotation.y += d * Math.min(1, dt * (4 + 10 * s.adsAmount));
    } else if (hasInput) {
      const targetYaw = Math.atan2(moveDir.x, moveDir.z);
      let d = targetYaw - this.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.root.rotation.y += d * Math.min(1, dt * 11);
    }
    let dyaw = this.root.rotation.y - prevYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    s.turnVel += ((dyaw / Math.max(dt, 1e-4)) - s.turnVel) * Math.min(1, dt * 8);

    if (hasInput && s.speed > 0.002) {
      this.root.position.x += moveDir.x * s.speed * dt;
      this.root.position.z += moveDir.z * s.speed * dt;
    }
    this._resolveCollisions(this.root.position);

    if (s.keys['Space'] && s.grounded) {
      s.vy = MV.jumpSpeed;
      s.grounded = false;
    }
    if (!s.grounded) {
      s.vy -= MV.gravity * dt;
      s.baseY += s.vy * dt;
      if (s.baseY <= 0) {
        s.baseY = 0;
        s.vy = 0;
        s.grounded = true;
      }
    }
    s.air += ((s.grounded ? 0 : 1) - s.air) * Math.min(1, dt * MV.airRecover);

    if (s.grounded) {
      const cadence = this.cfg.ANIMATION.cadenceBase +
        effSprint * this.cfg.ANIMATION.cadenceSprint;
      s.phase += dt * cadence * Math.min(1.6, s.speed / 1.3);
    }
    const blendTarget = s.speed > 0.08 ? Math.min(1, s.speed / 1.2) : 0;
    s.moveBlend += (blendTarget - s.moveBlend) * Math.min(1, dt * 10);

    this.root.position.y = s.baseY;
    return effSprint;
  }

  _resolveCollisions(pos) {
    const MV = this.cfg.MOVEMENT;
    const r = MV.radius;
    const feet = pos.y - MV.height;

    for (const b of this.colliders) {
      if (feet > b.max.y - 0.05) continue;
      if (pos.y < b.min.y) continue;

      const cx = _clamp(pos.x, b.min.x, b.max.x);
      const cz = _clamp(pos.z, b.min.z, b.max.z);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;

      if (d2 < r * r) {
        const d = Math.sqrt(d2);
        if (d > 0.0001) {
          const push = (r - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
        } else {
          pos.x += (pos.x < (b.min.x + b.max.x) / 2 ? -0.1 : 0.1);
        }
      }
    }

    pos.x = _clamp(pos.x, -this.worldLimit, this.worldLimit);
    pos.z = _clamp(pos.z, -this.worldLimit, this.worldLimit);
  }

  _updatePoseAnimation(dt, effSprint) {
    const s = this.state;
    const A = this.cfg.ANIMATION;
    const p = s.phase;
    const moveB = s.moveBlend;
    const c = s.crouch;
    const air = s.air;
    const sp = effSprint;

    const legAmp  = (A.legAmpBase + A.legAmpSprint * sp) * moveB * (1 - 0.30 * c);
    const kneeAmp = (A.kneeAmpBase + A.kneeAmpSprint * sp) * moveB * (1 - 0.25 * c);

    const crouchHip = A.crouchHip * c;
    const crouchKnee = A.crouchKnee * c;
    const airHip = A.airHip * air;
    const airKnee = A.airKnee * air;

    const hipR = -legAmp * Math.sin(p);
    const hipL = -legAmp * Math.sin(p + Math.PI);
    const kneeR = Math.max(0, kneeAmp * Math.sin(p + 0.9)) + 0.06;
    const kneeL = Math.max(0, kneeAmp * Math.sin(p + 0.9 + Math.PI)) + 0.06;

    const LR = this.bones.legR;
    const LL = this.bones.legL;

    LR.hip.rotation.x  = hipR + crouchHip + airHip;
    LL.hip.rotation.x  = hipL + crouchHip + airHip;
    LR.knee.rotation.x = kneeR + crouchKnee + airKnee;
    LL.knee.rotation.x = kneeL + crouchKnee + airKnee;
    LR.ankle.rotation.x = -(LR.hip.rotation.x + LR.knee.rotation.x) * 0.85;
    LL.ankle.rotation.x = -(LL.hip.rotation.x + LL.knee.rotation.x) * 0.85;

    const aimTorsoPitch = s.pitch * 0.20 * s.adsAmount;
    const torsoLean = (A.torsoLeanMove * moveB * (1 + sp * 0.9) + A.torsoLeanCrouch * c) *
      (1 - s.adsAmount * 0.5);

    this.bones.upper.rotation.x = torsoLean + aimTorsoPitch;
    this.bones.upper.rotation.z = Math.sin(p * 2) * 0.012 * moveB;

    this.bones.head.rotation.x = -this.bones.upper.rotation.x * A.headCounter -
      s.adsAmount * 0.05 -
      s.pitch * 0.75 * s.adsAmount;

    const now = performance.now();
    this.bones.head.rotation.y = Math.sin(now * 0.00055) * 0.03 * (1 - moveB);

    const legLift = (Math.abs(hipR) + Math.abs(hipL)) * 0.08;
    const bob = Math.sin(p * 2) * 0.012 * moveB;
    const breath = Math.sin(now * 0.0014) * 0.006 * (1 - moveB);

    this.bones.body.position.y =
      -this.cfg.CAMERA_TPS.crouchDrop * c - legLift + bob + breath;
  }

  /* --- АНИМАЦИЯ РУК: махи в противофазе с ногами + сгиб локтей + ADS-стойка --- */
  _updateArmsPose(effSprint) {
    const s = this.state;
    const A = this.cfg.ANIMATION;
    const p = s.phase;
    const moveB = s.moveBlend;
    const c = s.crouch;
    const air = s.air;
    const sp = effSprint;

    /* Амплитуда маха рук */
    const armAmp   = (A.armAmpBase   + A.armAmpSprint   * sp) * moveB * (1 - 0.30 * c);
    const elbowAmp = (A.elbowAmpBase + A.elbowAmpSprint * sp) * moveB;

    /* Правая рука машет в противофазе с правой ногой (sin(p + π)) */
    const swingR = armAmp * Math.sin(p + Math.PI);
    const swingL = armAmp * Math.sin(p);

    /* Локти сгибаются сильнее на переднем махе */
    const bendR = elbowAmp * Math.max(0, -Math.sin(p + Math.PI));
    const bendL = elbowAmp * Math.max(0, -Math.sin(p));

    /* Дополнительные смещения: присед / прыжок */
    const crouchOffset = -0.18 * c;
    const airOffset    = -0.55 * air;

    /* Правая рука */
    const R = this.bones.armR;
    let shR_x = swingR + crouchOffset + airOffset;
    let shR_z =  0.05 + 0.05 * sp + 0.12 * air;
    let elR_x = -0.15 - bendR - 0.22 * c - 0.55 * air;

    /* Левая рука */
    const L = this.bones.armL;
    let shL_x = swingL + crouchOffset + airOffset;
    let shL_z = -0.05 - 0.05 * sp - 0.12 * air;
    let elL_x = -0.15 - bendL - 0.22 * c - 0.55 * air;

    /* ADS-стойка — руки сходятся к «оружию» перед грудью */
    const a = s.adsAmount;
    if (a > 0.001) {
      shR_x = shR_x * (1 - a) + A.adsShoulderX * a;
      shR_z = shR_z * (1 - a) + A.adsShoulderZ * a;
      elR_x = elR_x * (1 - a) + A.adsElbowX    * a;

      shL_x = shL_x * (1 - a) + A.adsShoulderX * a;
      shL_z = shL_z * (1 - a) - A.adsShoulderZ * a;
      elL_x = elL_x * (1 - a) + A.adsElbowX    * a;
    }

    R.shoulder.rotation.x = shR_x;
    R.shoulder.rotation.z = shR_z;
    R.elbow.rotation.x    = elR_x;

    L.shoulder.rotation.x = shL_x;
    L.shoulder.rotation.z = shL_z;
    L.elbow.rotation.x    = elL_x;
  }

  _updateCoat(dt, effSprint) {
    const s = this.state;
    const A = this.cfg.ANIMATION;
    const FR = this.bones.coatTails[0];
    const FL = this.bones.coatTails[1];
    const BR = this.bones.coatTails[2];
    const BL = this.bones.coatTails[3];

    const speedFactor = Math.min(1, s.speed / 1.8);
    const lagBack = A.coatLagBack * speedFactor * (1 + effSprint * 0.45);
    const sideLag = _clamp(s.turnVel * A.coatSideLag, -0.35, 0.35);

    const p = s.phase;
    const moveB = s.moveBlend;
    const swayZ = Math.sin(p * 2) * 0.06 * moveB;
    const swayY = Math.sin(p * 2 + 1) * 0.04 * moveB;
    const airFlare = 0.55 * s.air;

    FR.rotation.x = lagBack * 1.15 + Math.sin(p * 2 + 0.3) * 0.07 * moveB + airFlare * 0.6;
    FR.rotation.z = sideLag * 1.10 + swayZ * 0.5 + 0.03;
    FR.rotation.y = swayY * 0.5;

    FL.rotation.x = lagBack * 1.15 + Math.sin(p * 2 + 0.6) * 0.07 * moveB + airFlare * 0.6;
    FL.rotation.z = sideLag * 1.10 + swayZ * 0.5 - 0.03;
    FL.rotation.y = -swayY * 0.5;

    BR.rotation.x = lagBack * 0.95 + Math.sin(p * 2 + 0.9) * 0.09 * moveB + airFlare * 0.45;
    BR.rotation.z = sideLag * 0.90 + swayZ * 0.6 + 0.03;
    BR.rotation.y = swayY * 0.6;

    BL.rotation.x = lagBack * 0.95 + Math.sin(p * 2 + 1.2) * 0.09 * moveB + airFlare * 0.45;
    BL.rotation.z = sideLag * 0.90 + swayZ * 0.6 - 0.03;
    BL.rotation.y = -swayY * 0.6;
  }

  _updateCamera(dt) {
    const s = this.state;
    if (s.viewMode === 'first') {
      this._updateFPSCamera(dt);
    } else {
      this._updateTPSCamera(dt);
    }
  }

  _updateFPSCamera(dt) {
    const s = this.state;
    const C = this.cfg.CAMERA_FPS;

    this.camera.position.set(
      this.root.position.x,
      this.root.position.y + C.eyeY,
      this.root.position.z
    );

    this.camera.rotation.set(s.pitch, s.yaw + Math.PI, 0, 'YXZ');

    const targetFov = C.baseFov + s.adsAmount * C.adsFovDelta;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
  }

  _updateTPSCamera(dt) {
    const s = this.state;
    const C = this.cfg.CAMERA_TPS;
    const cs = this._camSmooth;

    const cosP = Math.cos(s.pitch);
    const dir = new THREE.Vector3(
      Math.sin(s.yaw) * cosP,
      Math.sin(s.pitch),
      Math.cos(s.yaw) * cosP
    ).normalize();

    const right = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));

    const anchorX = this.root.position.x;
    const anchorY = this.root.position.y - C.crouchDrop * s.crouch + C.chest;
    const anchorZ = this.root.position.z;

    const dist = _lerp(C.distIdle, C.distAim, s.adsAmount);
    const side = _lerp(C.sideIdle, C.sideAim, s.adsAmount);
    const up = _lerp(C.upIdle, C.upAim, s.adsAmount);

    const desiredX = anchorX - dir.x * dist + right.x * side;
    const desiredY = anchorY - dir.y * dist + up;
    const desiredZ = anchorZ - dir.z * dist + right.z * side;

    if (!cs.init) {
      cs.pos.set(desiredX, desiredY, desiredZ);
      cs.target.set(anchorX, anchorY, anchorZ);
      cs.init = true;
    } else {
      const kp = _damp(C.smoothPos, dt);
      const kt = _damp(C.smoothTgt, dt);
      cs.pos.x += (desiredX - cs.pos.x) * kp;
      cs.pos.y += (desiredY - cs.pos.y) * kp;
      cs.pos.z += (desiredZ - cs.pos.z) * kp;
      cs.target.x += (anchorX - cs.target.x) * kt;
      cs.target.y += (anchorY - cs.target.y) * kt;
      cs.target.z += (anchorZ - cs.target.z) * kt;
    }

    this.camera.position.copy(cs.pos);

    const lx = cs.target.x + dir.x * C.lookAhead;
    const ly = cs.target.y + dir.y * C.lookAhead;
    const lz = cs.target.z + dir.z * C.lookAhead;
    this.camera.lookAt(lx, ly, lz);

    const targetFov = C.baseFov + s.adsAmount * C.aimFovDelta;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }
  }

  attachToBone(obj, boneName, position, quaternion) {
    const bone = this.getBone(boneName);
    if (!bone) {
      console.warn('Bone not found:', boneName);
      return;
    }
    bone.add(obj);
    if (position) obj.position.copy(position);
    if (quaternion) obj.quaternion.copy(quaternion);
  }

  detach(obj) {
    if (obj.parent) obj.parent.remove(obj);
  }

  getBoneWorldMatrix(boneName, out = new THREE.Matrix4()) {
    const bone = this.getBone(boneName);
    if (!bone) return out.identity();
    bone.updateWorldMatrix(true, false);
    return out.copy(bone.matrixWorld);
  }
}