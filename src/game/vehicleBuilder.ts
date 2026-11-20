import * as THREE from 'three';
import { createLicensePlateTexture, ProceduralTextureSet } from './textures';
import {
  CarUpgrades,
  DiffuserOption,
  FrontBumperOption,
  PaintFinish,
  RimDesign,
  SpoilerOption,
  TireProfile,
  VehicleBodyStyle,
  WindowTintOption,
} from './types';

export interface BuiltVehicle {
  root: THREE.Group;
  chassisGroup: THREE.Group;
  wheels: THREE.Group[];
  paintMat: THREE.MeshPhysicalMaterial;
  rimMat: THREE.MeshStandardMaterial;
  glassMat: THREE.MeshPhysicalMaterial;
  headLedMat: THREE.MeshStandardMaterial;
  tailLedMat: THREE.MeshStandardMaterial;
  underglowMat: THREE.MeshBasicMaterial;
  underglowMesh: THREE.Mesh;
  underglowLight: THREE.PointLight | null;
  spawnRingMesh: THREE.Mesh | null;
  activeWingGroup: THREE.Group | null;
  activeWingBaseY: number;
  activeWingBaseRotX: number;
  flameLeft: THREE.Mesh;
  flameRight: THREE.Mesh;
  backfireLeft: THREE.Mesh;
  backfireRight: THREE.Mesh;
  backfireSparks: THREE.Mesh[];
  backfireLight: THREE.PointLight | null;
  updatePlateText: (text: string) => void;
  applyPaintFinish: (finish: PaintFinish) => void;
  applyWindowTint: (tint: WindowTintOption) => void;
  dispose: () => void;
}

interface StyleDims {
  frontAxleZ: number; // negative Z in car space
  rearAxleZ: number;  // positive Z in car space
  noseZ: number;      // negative Z tip
  tailZ: number;      // positive Z tip
  tireRadius: number;
  tireWidth: number;
  bodyWidth: number;
  cabinWidth: number;
  headlightY: number;
  taillightY: number;
  spoilerType: 'gt_swan' | 'r34_wing' | 'ducktail' | 'black_gt' | 'evo_wing' | 'hyper_wing' | 'none';
  quadExhaust: boolean;
  centerExhaust?: boolean;
  sideIntakes?: boolean;
  hoodScoop?: boolean;
  carbonRoof?: boolean;
}

const STYLE_DIMS: Record<VehicleBodyStyle, StyleDims> = {
  kuruma_sedan: {
    frontAxleZ: -1.32,
    rearAxleZ: 1.32,
    noseZ: -2.14,
    tailZ: 2.10,
    tireRadius: 0.31,
    tireWidth: 0.22,
    bodyWidth: 1.78,
    cabinWidth: 1.42,
    headlightY: 0.54,
    taillightY: 0.72,
    spoilerType: 'none',
    quadExhaust: false,
  },
  porsche_gt3: {
    frontAxleZ: -1.34,
    rearAxleZ: 1.32,
    noseZ: -2.18,
    tailZ: 2.12,
    tireRadius: 0.33,
    tireWidth: 0.28,
    bodyWidth: 1.88,
    cabinWidth: 1.38,
    headlightY: 0.54,
    taillightY: 0.68,
    spoilerType: 'gt_swan',
    quadExhaust: false,
    centerExhaust: true,
  },
  skyline_r34: {
    frontAxleZ: -1.36,
    rearAxleZ: 1.36,
    noseZ: -2.22,
    tailZ: 2.18,
    tireRadius: 0.33,
    tireWidth: 0.27,
    bodyWidth: 1.86,
    cabinWidth: 1.42,
    headlightY: 0.56,
    taillightY: 0.72,
    spoilerType: 'r34_wing',
    quadExhaust: false,
  },
  m4_csl: {
    frontAxleZ: -1.38,
    rearAxleZ: 1.35,
    noseZ: -2.24,
    tailZ: 2.18,
    tireRadius: 0.33,
    tireWidth: 0.28,
    bodyWidth: 1.9,
    cabinWidth: 1.42,
    headlightY: 0.55,
    taillightY: 0.72,
    spoilerType: 'ducktail',
    quadExhaust: true,
    carbonRoof: true,
  },
  supra_mk5: {
    frontAxleZ: -1.32,
    rearAxleZ: 1.30,
    noseZ: -2.18,
    tailZ: 2.08,
    tireRadius: 0.33,
    tireWidth: 0.28,
    bodyWidth: 1.9,
    cabinWidth: 1.36,
    headlightY: 0.52,
    taillightY: 0.70,
    spoilerType: 'ducktail',
    quadExhaust: false,
  },
  muscle_srt: {
    frontAxleZ: -1.42,
    rearAxleZ: 1.38,
    noseZ: -2.30,
    tailZ: 2.24,
    tireRadius: 0.35,
    tireWidth: 0.30,
    bodyWidth: 1.96,
    cabinWidth: 1.48,
    headlightY: 0.62,
    taillightY: 0.78,
    spoilerType: 'ducktail',
    quadExhaust: true,
    hoodScoop: true,
  },
  amg_black: {
    frontAxleZ: -1.42,
    rearAxleZ: 1.34,
    noseZ: -2.28,
    tailZ: 2.16,
    tireRadius: 0.33,
    tireWidth: 0.29,
    bodyWidth: 1.94,
    cabinWidth: 1.38,
    headlightY: 0.53,
    taillightY: 0.69,
    spoilerType: 'black_gt',
    quadExhaust: true,
    carbonRoof: true,
  },
  huracan_evo: {
    frontAxleZ: -1.36,
    rearAxleZ: 1.36,
    noseZ: -2.26,
    tailZ: 2.18,
    tireRadius: 0.33,
    tireWidth: 0.29,
    bodyWidth: 1.96,
    cabinWidth: 1.36,
    headlightY: 0.45,
    taillightY: 0.68,
    spoilerType: 'evo_wing',
    quadExhaust: false,
    centerExhaust: true,
    sideIntakes: true,
  },
  lafuria_v12: {
    frontAxleZ: -1.40,
    rearAxleZ: 1.40,
    noseZ: -2.32,
    tailZ: 2.22,
    tireRadius: 0.33,
    tireWidth: 0.30,
    bodyWidth: 1.98,
    cabinWidth: 1.34,
    headlightY: 0.46,
    taillightY: 0.68,
    spoilerType: 'hyper_wing',
    quadExhaust: true,
    sideIntakes: true,
    carbonRoof: true,
  },
  npc_sedan: {
    frontAxleZ: -1.38,
    rearAxleZ: 1.38,
    noseZ: -2.22,
    tailZ: 2.20,
    tireRadius: 0.33,
    tireWidth: 0.24,
    bodyWidth: 1.84,
    cabinWidth: 1.46,
    headlightY: 0.56,
    taillightY: 0.74,
    spoilerType: 'none',
    quadExhaust: false,
  },
  npc_suv: {
    frontAxleZ: -1.42,
    rearAxleZ: 1.42,
    noseZ: -2.28,
    tailZ: 2.24,
    tireRadius: 0.38,
    tireWidth: 0.27,
    bodyWidth: 1.94,
    cabinWidth: 1.56,
    headlightY: 0.72,
    taillightY: 0.92,
    spoilerType: 'none',
    quadExhaust: false,
  },
  npc_sport: {
    frontAxleZ: -1.34,
    rearAxleZ: 1.34,
    noseZ: -2.18,
    tailZ: 2.14,
    tireRadius: 0.33,
    tireWidth: 0.26,
    bodyWidth: 1.86,
    cabinWidth: 1.38,
    headlightY: 0.52,
    taillightY: 0.69,
    spoilerType: 'ducktail',
    quadExhaust: false,
  },
};

function traceWheelArch(
  s: THREE.Shape,
  axleX: number,
  axleY: number,
  archShapeR: number,
  sillShapeY: number
) {
  const ratio = THREE.MathUtils.clamp((sillShapeY - axleY) / archShapeR, -0.94, 0.94);
  const a = Math.asin(ratio); // negative when sillShapeY < axleY
  const startX = axleX - archShapeR * Math.cos(a);
  s.lineTo(startX, sillShapeY);
  s.absarc(axleX, axleY, archShapeR, Math.PI - a, a, true);
}

/**
 * Builds the lower sculpted chassis + bumpers with real circular wheel-arch cutouts
 * and the tapered upper greenhouse/cabin separately so the car has realistic tumblehome
 * and curved aerodynamic proportions instead of a flat-walled block.
 */
function createSculptedBodyParts(style: VehicleBodyStyle, dims: StyleDims): {
  lowerGeo: THREE.ExtrudeGeometry;
  cabinGeo: THREE.ExtrudeGeometry;
  glassGeo: THREE.ExtrudeGeometry;
} {
  // Shape X maps to -Z after rotateY(+PI/2): +X = nose, -X = rear
  const frontAxleX = -dims.frontAxleZ;
  const rearAxleX = -dims.rearAxleZ;
  const noseX = -dims.noseZ;
  const tailX = -dims.tailZ;

  const bevelSize = 0.065;
  const bevelThickness = 0.095;
  const desiredSillY = style === 'npc_suv' ? 0.29 : 0.21;
  const desiredArchR = dims.tireRadius + 0.055;

  // Compensate shape coordinates for outward bevel expansion
  const sillShapeY = desiredSillY + bevelSize;
  const archShapeR = desiredArchR + bevelSize;

  const lower = new THREE.Shape();
  const tailShapeX = tailX + bevelSize;
  const noseShapeX = noseX - bevelSize;

  lower.moveTo(tailShapeX, sillShapeY + 0.08);
  traceWheelArch(lower, rearAxleX, dims.tireRadius, archShapeR, sillShapeY);
  traceWheelArch(lower, frontAxleX, dims.tireRadius, archShapeR, sillShapeY);
  lower.lineTo(noseShapeX - 0.05, sillShapeY);

  // Sculpted upper lower-body curve (front bumper -> hood -> beltline -> rear haunch -> rear bumper)
  if (style === 'kuruma_sedan') {
    lower.quadraticCurveTo(noseShapeX + 0.04, 0.45, noseShapeX - 0.12, 0.61);
    lower.bezierCurveTo(frontAxleX + 0.25, 0.74, 0.90, 0.78, 0.50, 0.81);
    lower.lineTo(-1.38, 0.85);
    lower.quadraticCurveTo(tailShapeX + 0.10, 0.82, tailShapeX, 0.65);
    lower.lineTo(tailShapeX, sillShapeY + 0.08);
  } else if (style === 'porsche_gt3') {
    lower.quadraticCurveTo(noseShapeX + 0.05, 0.44, noseShapeX - 0.14, 0.57);
    lower.bezierCurveTo(frontAxleX + 0.25, 0.72, frontAxleX - 0.35, 0.76, 0.55, 0.79);
    lower.bezierCurveTo(0.0, 0.81, rearAxleX + 0.35, 0.86, rearAxleX - 0.2, 0.85);
    lower.quadraticCurveTo(tailShapeX + 0.12, 0.78, tailShapeX, 0.62);
    lower.quadraticCurveTo(tailShapeX - 0.03, 0.42, tailShapeX, sillShapeY + 0.08);
  } else if (style === 'skyline_r34') {
    lower.quadraticCurveTo(noseShapeX + 0.04, 0.45, noseShapeX - 0.06, 0.60);
    lower.bezierCurveTo(frontAxleX + 0.3, 0.73, 0.95, 0.78, 0.55, 0.82);
    lower.lineTo(-1.35, 0.86);
    lower.quadraticCurveTo(tailShapeX + 0.12, 0.84, tailShapeX, 0.70);
    lower.lineTo(tailShapeX, sillShapeY + 0.08);
  } else if (style === 'm4_csl') {
    lower.quadraticCurveTo(noseShapeX + 0.04, 0.44, noseShapeX - 0.08, 0.59);
    lower.bezierCurveTo(frontAxleX + 0.25, 0.74, 0.9, 0.78, 0.48, 0.83);
    lower.bezierCurveTo(-0.2, 0.85, rearAxleX + 0.2, 0.88, rearAxleX - 0.45, 0.90);
    lower.quadraticCurveTo(tailShapeX + 0.08, 0.84, tailShapeX, 0.65);
    lower.lineTo(tailShapeX, sillShapeY + 0.08);
  } else if (style === 'supra_mk5') {
    lower.bezierCurveTo(noseShapeX + 0.06, 0.38, noseShapeX - 0.04, 0.54, noseShapeX - 0.22, 0.63);
    lower.bezierCurveTo(frontAxleX + 0.15, 0.75, 0.8, 0.78, 0.35, 0.81);
    lower.bezierCurveTo(-0.3, 0.84, rearAxleX + 0.25, 0.90, rearAxleX - 0.4, 0.88);
    lower.quadraticCurveTo(tailShapeX + 0.08, 0.79, tailShapeX, 0.58);
    lower.lineTo(tailShapeX, sillShapeY + 0.08);
  } else if (style === 'muscle_srt') {
    lower.quadraticCurveTo(noseShapeX + 0.03, 0.52, noseShapeX - 0.04, 0.68);
    lower.bezierCurveTo(frontAxleX + 0.35, 0.79, 0.95, 0.84, 0.5, 0.87);
    lower.lineTo(-1.35, 0.92);
    lower.quadraticCurveTo(tailShapeX + 0.1, 0.91, tailShapeX, 0.74);
    lower.lineTo(tailShapeX, sillShapeY + 0.08);
  } else if (style === 'amg_black') {
    lower.quadraticCurveTo(noseShapeX + 0.05, 0.42, noseShapeX - 0.12, 0.58);
    lower.bezierCurveTo(frontAxleX + 0.2, 0.73, 0.8, 0.78, 0.18, 0.82);
    lower.bezierCurveTo(-0.4, 0.84, rearAxleX + 0.2, 0.85, tailShapeX + 0.15, 0.82);
    lower.quadraticCurveTo(tailShapeX + 0.04, 0.74, tailShapeX, 0.56);
    lower.lineTo(tailShapeX, sillShapeY + 0.08);
  } else if (style === 'huracan_evo') {
    lower.quadraticCurveTo(noseShapeX + 0.06, 0.36, noseShapeX - 0.2, 0.52);
    lower.bezierCurveTo(frontAxleX + 0.18, 0.68, 0.95, 0.74, 0.65, 0.77);
    lower.bezierCurveTo(0.0, 0.80, rearAxleX + 0.25, 0.84, tailShapeX + 0.15, 0.81);
    lower.quadraticCurveTo(tailShapeX + 0.03, 0.72, tailShapeX, 0.52);
    lower.lineTo(tailShapeX, sillShapeY + 0.08);
  } else if (style === 'lafuria_v12') {
    lower.bezierCurveTo(noseShapeX + 0.08, 0.35, noseShapeX - 0.1, 0.48, noseShapeX - 0.32, 0.58);
    lower.bezierCurveTo(frontAxleX + 0.15, 0.72, 0.85, 0.74, 0.55, 0.76);
    lower.bezierCurveTo(-0.1, 0.80, rearAxleX + 0.35, 0.86, tailShapeX + 0.18, 0.80);
    lower.quadraticCurveTo(tailShapeX + 0.02, 0.70, tailShapeX, 0.50);
    lower.lineTo(tailShapeX, sillShapeY + 0.08);
  } else if (style === 'npc_suv') {
    lower.quadraticCurveTo(noseShapeX + 0.03, 0.55, noseShapeX - 0.08, 0.78);
    lower.bezierCurveTo(frontAxleX + 0.35, 0.92, 0.95, 0.95, 0.55, 0.98);
    lower.lineTo(-1.65, 1.00);
    lower.quadraticCurveTo(tailShapeX + 0.08, 0.96, tailShapeX, 0.76);
    lower.lineTo(tailShapeX, sillShapeY + 0.08);
  } else {
    // npc_sedan / npc_sport
    lower.quadraticCurveTo(noseShapeX + 0.04, 0.45, noseShapeX - 0.1, 0.61);
    lower.bezierCurveTo(frontAxleX + 0.25, 0.75, 0.95, 0.79, 0.52, 0.83);
    lower.lineTo(-1.45, 0.86);
    lower.quadraticCurveTo(tailShapeX + 0.1, 0.82, tailShapeX, 0.64);
    lower.lineTo(tailShapeX, sillShapeY + 0.08);
  }
  lower.closePath();

  const lowerDepth = Math.max(0.6, dims.bodyWidth - bevelThickness * 2);
  const lowerGeo = new THREE.ExtrudeGeometry(lower, {
    depth: lowerDepth,
    curveSegments: 24,
    bevelEnabled: true,
    bevelSegments: 8,
    steps: 1,
    bevelSize,
    bevelThickness,
  });
  lowerGeo.translate(0, 0, -lowerDepth / 2);
  lowerGeo.rotateY(Math.PI / 2);
  lowerGeo.computeVertexNormals();

  // ==================== UPPER GREENHOUSE / ROOF CANOPY ====================
  const cabBevelSize = 0.045;
  const cabBevelThick = 0.08;
  const cabin = new THREE.Shape();

  if (style === 'porsche_gt3') {
    cabin.moveTo(-1.68, 0.74);
    cabin.lineTo(0.68, 0.74);
    cabin.bezierCurveTo(0.45, 0.95, 0.18, 1.15, -0.22, 1.15);
    cabin.bezierCurveTo(-0.78, 1.15, -1.25, 0.96, -1.68, 0.74);
  } else if (style === 'huracan_evo' || style === 'lafuria_v12') {
    cabin.moveTo(-1.35, 0.70);
    cabin.lineTo(0.88, 0.68);
    cabin.bezierCurveTo(0.55, 0.88, 0.18, 1.07, -0.24, 1.07);
    cabin.bezierCurveTo(-0.68, 1.07, -1.02, 0.90, -1.35, 0.70);
  } else if (style === 'amg_black') {
    cabin.moveTo(-1.65, 0.74);
    cabin.lineTo(0.28, 0.74);
    cabin.bezierCurveTo(0.02, 0.95, -0.26, 1.13, -0.62, 1.13);
    cabin.bezierCurveTo(-1.05, 1.13, -1.38, 0.94, -1.65, 0.74);
  } else if (style === 'supra_mk5') {
    cabin.moveTo(-1.55, 0.74);
    cabin.lineTo(0.46, 0.74);
    cabin.bezierCurveTo(0.18, 0.96, -0.10, 1.13, -0.45, 1.13);
    cabin.bezierCurveTo(-0.92, 1.13, -1.25, 0.95, -1.55, 0.74);
  } else if (style === 'npc_suv') {
    cabin.moveTo(-1.95, 0.90);
    cabin.lineTo(0.66, 0.90);
    cabin.quadraticCurveTo(0.32, 1.24, 0.08, 1.46);
    cabin.bezierCurveTo(-0.45, 1.50, -1.28, 1.48, -1.68, 1.38);
    cabin.quadraticCurveTo(-1.86, 1.18, -1.95, 0.90);
  } else if (style === 'npc_sedan' || style === 'kuruma_sedan') {
    cabin.moveTo(-1.62, 0.75);
    cabin.lineTo(0.64, 0.75);
    cabin.quadraticCurveTo(0.34, 1.01, 0.10, 1.21);
    cabin.bezierCurveTo(-0.32, 1.25, -0.80, 1.23, -1.10, 1.15);
    cabin.quadraticCurveTo(-1.40, 0.96, -1.62, 0.75);
  } else {
    // R34, M4 CSL, Muscle SRT, NPC Sport
    cabin.moveTo(-1.58, 0.75);
    cabin.lineTo(0.58, 0.75);
    cabin.quadraticCurveTo(0.28, 0.98, 0.04, 1.17);
    cabin.bezierCurveTo(-0.36, 1.19, -0.82, 1.18, -1.08, 1.10);
    cabin.quadraticCurveTo(-1.35, 0.94, -1.58, 0.75);
  }
  cabin.closePath();

  const cabinDepth = Math.max(0.5, dims.cabinWidth - cabBevelThick * 2);
  const cabinGeo = new THREE.ExtrudeGeometry(cabin, {
    depth: cabinDepth,
    curveSegments: 24,
    bevelEnabled: true,
    bevelSegments: 8,
    steps: 1,
    bevelSize: cabBevelSize,
    bevelThickness: cabBevelThick,
  });
  cabinGeo.translate(0, 0, -cabinDepth / 2);
  cabinGeo.rotateY(Math.PI / 2);
  cabinGeo.computeVertexNormals();

  // Slightly wider/thinner glass wrap shell around the middle of the cabin so windows read cleanly
  const glassDepth = cabinDepth + 0.035;
  const glassGeo = new THREE.ExtrudeGeometry(cabin, {
    depth: glassDepth,
    curveSegments: 24,
    bevelEnabled: true,
    bevelSegments: 6,
    steps: 1,
    bevelSize: cabBevelSize * 0.62,
    bevelThickness: cabBevelThick * 0.85,
  });
  glassGeo.translate(0, 0, -glassDepth / 2);
  glassGeo.rotateY(Math.PI / 2);
  glassGeo.scale(1.01, 0.95, 0.95);
  glassGeo.translate(0, 0.035, 0);
  glassGeo.computeVertexNormals();

  return { lowerGeo, cabinGeo, glassGeo };
}

/**
 * Builds a realistic rounded tire profile via LatheGeometry (sidewall bulge + curved crown)
 */
function createRoundedTireGeometry(outerR: number, rimR: number, width: number): THREE.LatheGeometry {
  const hw = width * 0.5;
  const midR = rimR + (outerR - rimR) * 0.56;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(rimR - 0.015, -hw * 0.84),
    new THREE.Vector2(midR, -hw * 0.98),
    new THREE.Vector2(outerR - 0.028, -hw * 0.90),
    new THREE.Vector2(outerR - 0.004, -hw * 0.52),
    new THREE.Vector2(outerR, 0),
    new THREE.Vector2(outerR - 0.004, hw * 0.52),
    new THREE.Vector2(outerR - 0.028, hw * 0.90),
    new THREE.Vector2(midR, hw * 0.98),
    new THREE.Vector2(rimR - 0.015, hw * 0.84),
  ];
  const geo = new THREE.LatheGeometry(pts, 28);
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createCurvedWingGeo(span: number, chord: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-chord * 0.5, 0);
  s.quadraticCurveTo(0, 0.045, chord * 0.5, 0.018);
  s.quadraticCurveTo(0, 0.012, -chord * 0.5, -0.012);
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: span,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.012,
    bevelThickness: 0.015,
  });
  geo.translate(0, 0, -span / 2);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function applyFinishParams(
  mat: THREE.MeshPhysicalMaterial,
  finish: PaintFinish,
  isTraffic?: boolean
) {
  if (isTraffic) {
    mat.metalness = 0.22;
    mat.roughness = 0.38;
    mat.clearcoat = 0.45;
    mat.clearcoatRoughness = 0.08;
    mat.envMapIntensity = 0.72;
    mat.needsUpdate = true;
    return;
  }
  if (finish === 'matte') {
    mat.metalness = 0.14;
    mat.roughness = 0.72;
    mat.clearcoat = 0.06;
    mat.clearcoatRoughness = 0.55;
    mat.specularIntensity = 0.35;
    mat.envMapIntensity = 0.48;
  } else if (finish === 'metallic') {
    mat.metalness = 0.74;
    mat.roughness = 0.25;
    mat.clearcoat = 0.96;
    mat.clearcoatRoughness = 0.07;
    mat.specularIntensity = 0.8;
    mat.envMapIntensity = 1.15;
  } else if (finish === 'chrome') {
    mat.metalness = 0.98;
    mat.roughness = 0.05;
    mat.clearcoat = 1.0;
    mat.clearcoatRoughness = 0.02;
    mat.specularIntensity = 1.0;
    mat.envMapIntensity = 1.65;
  } else {
    // 'gloss'
    mat.metalness = 0.30;
    mat.roughness = 0.22;
    mat.clearcoat = 1.0;
    mat.clearcoatRoughness = 0.05;
    mat.specularIntensity = 0.68;
    mat.envMapIntensity = 0.80;
  }
  mat.needsUpdate = true;
}

function applyTintParams(
  mat: THREE.MeshPhysicalMaterial,
  tint: WindowTintOption,
  isTraffic?: boolean
) {
  if (isTraffic) {
    mat.transparent = false;
    mat.opacity = 1.0;
    mat.depthWrite = true;
  } else {
    mat.transparent = true;
    mat.depthWrite = false;
    mat.opacity = tint === 'clear' ? 0.34 : tint === 'limo' ? 0.93 : 0.66;
  }
  mat.needsUpdate = true;
}

export function buildCompositeVehicle(options: {
  style: VehicleBodyStyle;
  paintHex: string;
  paintFinish?: PaintFinish;
  rimHex: string;
  rimDesign?: RimDesign;
  tireProfile?: TireProfile;
  underglowHex: string;
  textures: ProceduralTextureSet;
  isSoftwareGl: boolean;
  isTraffic?: boolean;
  upgrades?: CarUpgrades;
  spoilerOverride?: SpoilerOption;
  frontBumper?: FrontBumperOption;
  diffuser?: DiffuserOption;
  sportSteering?: boolean;
  starlightRoof?: boolean;
  plateText?: string;
  windowTint?: WindowTintOption;
}): BuiltVehicle {
  const root = new THREE.Group();
  const chassisGroup = new THREE.Group();
  const suspLvl = !options.isTraffic ? Math.min(3, Math.max(0, options.upgrades?.suspension ?? 0)) : 0;
  chassisGroup.position.y = -suspLvl * 0.013;
  root.add(chassisGroup);

  const wheels: THREE.Group[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const disposableTextures: THREE.Texture[] = [];

  const dims = STYLE_DIMS[options.style];

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(options.paintHex),
    flatShading: false,
  });
  applyFinishParams(paintMat, options.paintFinish ?? 'gloss', options.isTraffic);
  materials.push(paintMat);

  const carbonMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.46,
    metalness: 0.24,
    clearcoat: 0.92,
    clearcoatRoughness: 0.08,
    map: options.textures.carbon,
    bumpMap: options.textures.carbonBump,
    bumpScale: 0.014,
    roughnessMap: options.textures.carbonRoughness,
    flatShading: false,
  });
  materials.push(carbonMat);

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x05080f,
    roughness: 0.04,
    metalness: 0.16,
    clearcoat: 0.95,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.25,
    flatShading: false,
  });
  applyTintParams(glassMat, options.windowTint ?? 'smoke', options.isTraffic);
  materials.push(glassMat);

  const trimDarkMat = new THREE.MeshStandardMaterial({
    color: 0x0d0f14,
    roughness: 0.68,
    metalness: 0.26,
    flatShading: false,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(options.rimHex),
    metalness: 0.88,
    roughness: 0.2,
    envMapIntensity: 1.1,
    flatShading: false,
  });
  const rotorMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.85,
    roughness: 0.28,
    flatShading: false,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x121418,
    roughness: 0.86,
    metalness: 0.06,
    flatShading: false,
  });
  const brakeLvl = !options.isTraffic ? Math.min(3, Math.max(0, options.upgrades?.brakes ?? 0)) : 0;
  const caliperMat = new THREE.MeshStandardMaterial({
    color: brakeLvl >= 3 ? 0xf59e0b : brakeLvl >= 2 ? 0xe10600 : 0xb91c1c,
    roughness: 0.28,
    metalness: 0.45,
    flatShading: false,
  });
  materials.push(trimDarkMat, rimMat, rotorMat, tireMat, caliperMat);

  // 1. Multi-layer Curved Body (Lower Chassis + Tapered Cabin + Glass Greenhouse)
  const { lowerGeo, cabinGeo, glassGeo } = createSculptedBodyParts(options.style, dims);
  geometries.push(lowerGeo, cabinGeo, glassGeo);

  const lowerMesh = new THREE.Mesh(lowerGeo, paintMat);
  lowerMesh.castShadow = !options.isTraffic;
  lowerMesh.receiveShadow = true;
  chassisGroup.add(lowerMesh);

  const weightLvl = options.upgrades?.weight ?? 0;
  const hasCarbonRoof = (dims.carbonRoof || weightLvl >= 3) && !options.isTraffic;
  const cabinMesh = new THREE.Mesh(cabinGeo, hasCarbonRoof ? carbonMat : paintMat);
  cabinMesh.castShadow = !options.isTraffic;
  cabinMesh.receiveShadow = true;
  chassisGroup.add(cabinMesh);

  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  chassisGroup.add(glassMesh);

  // 1b. Interior Accessories (Seats, Dash, Sport Steering Wheel, Starlight Headliner) for Player Cars
  if (!options.isTraffic) {
    const dashGeo = new THREE.BoxGeometry(dims.cabinWidth * 0.72, 0.14, 0.24);
    const seatBackGeo = new THREE.BoxGeometry(0.34, 0.44, 0.1);
    const steerWheelGeo = new THREE.TorusGeometry(0.115, 0.017, 8, 20);
    const steerSpokeGeo = new THREE.BoxGeometry(0.20, 0.02, 0.018);
    geometries.push(dashGeo, seatBackGeo, steerWheelGeo, steerSpokeGeo);

    const dash = new THREE.Mesh(dashGeo, trimDarkMat);
    dash.position.set(0, 0.76, dims.frontAxleZ + 0.92);
    chassisGroup.add(dash);

    for (const sx of [-0.30, 0.30]) {
      const seat = new THREE.Mesh(seatBackGeo, trimDarkMat);
      seat.position.set(sx, 0.80, 0.18);
      seat.rotation.x = 0.22;
      chassisGroup.add(seat);
    }

    const wheelGroup = new THREE.Group();
    const swMat = options.sportSteering ? carbonMat : trimDarkMat;
    const sw = new THREE.Mesh(steerWheelGeo, swMat);
    const swSpoke = new THREE.Mesh(steerSpokeGeo, rimMat);
    wheelGroup.add(sw, swSpoke);
    if (options.sportSteering) {
      const markerGeo = new THREE.BoxGeometry(0.028, 0.028, 0.042);
      geometries.push(markerGeo);
      const marker = new THREE.Mesh(markerGeo, caliperMat);
      marker.position.set(0, 0.115, 0);
      wheelGroup.add(marker);
    }
    wheelGroup.position.set(-0.30, 0.85, dims.frontAxleZ + 1.05);
    wheelGroup.rotation.x = -0.35;
    chassisGroup.add(wheelGroup);

    if (options.starlightRoof) {
      const starGeo = new THREE.SphereGeometry(0.011, 6, 6);
      const starMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
      geometries.push(starGeo);
      materials.push(starMat);
      const roofY = options.style === 'huracan_evo' || options.style === 'lafuria_v12' ? 0.99 : 1.08;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const star = new THREE.Mesh(starGeo, starMat);
          star.position.set(c * 0.19, roofY, -0.25 + r * 0.18);
          chassisGroup.add(star);
        }
      }
    }
  }

  // 2. Sculpted Fender Arch Lips & Inner Wheel Well Tubs (so wheel arches never look hollow-through)
  const archLipGeo = new THREE.TorusGeometry(dims.tireRadius + 0.055, 0.028, 10, 24, Math.PI + 0.36);
  archLipGeo.rotateY(Math.PI / 2);
  archLipGeo.rotateX(-0.18);
  const wheelTubGeo = new THREE.CylinderGeometry(dims.tireRadius + 0.048, dims.tireRadius + 0.048, 0.34, 20, 1, false, 0, Math.PI);
  wheelTubGeo.rotateZ(Math.PI / 2);
  wheelTubGeo.rotateX(-Math.PI / 2);
  geometries.push(archLipGeo, wheelTubGeo);

  const archLipMat = options.style === 'npc_suv' ? trimDarkMat : paintMat;
  const wheelHalfTrack = dims.bodyWidth * 0.5 - dims.tireWidth * 0.42;

  for (const axZ of [dims.frontAxleZ, dims.rearAxleZ]) {
    for (const side of [-1, 1]) {
      const lip = new THREE.Mesh(archLipGeo, archLipMat);
      lip.position.set(side * (dims.bodyWidth * 0.49), dims.tireRadius, axZ);
      chassisGroup.add(lip);

      const tub = new THREE.Mesh(wheelTubGeo, trimDarkMat);
      tub.position.set(side * (wheelHalfTrack - 0.05), dims.tireRadius, axZ);
      chassisGroup.add(tub);
    }
  }

  // 3. Curved Side Mirrors on Angled Stalks
  const mirrorHousingGeo = new THREE.SphereGeometry(0.085, 12, 10);
  mirrorHousingGeo.scale(1.15, 0.68, 1.45);
  const mirrorStalkGeo = new THREE.CylinderGeometry(0.018, 0.024, 0.14, 8);
  mirrorStalkGeo.rotateZ(Math.PI / 3);
  geometries.push(mirrorHousingGeo, mirrorStalkGeo);

  const mirrorMat = options.isTraffic ? paintMat : carbonMat;
  for (const side of [-1, 1]) {
    const mirrorGroup = new THREE.Group();
    const housing = new THREE.Mesh(mirrorHousingGeo, mirrorMat);
    housing.position.set(side * 0.09, 0.04, 0);
    const stalk = new THREE.Mesh(mirrorStalkGeo, trimDarkMat);
    stalk.rotation.z = side * -0.95;
    stalk.position.set(side * 0.03, 0, 0);
    mirrorGroup.add(housing, stalk);
    mirrorGroup.position.set(side * (dims.bodyWidth * 0.46), dims.headlightY + 0.30, dims.frontAxleZ + 0.72);
    chassisGroup.add(mirrorGroup);
  }

  // 4. Front Splitter / Bumper Kit, Recessed Grille & Side Skirts / Intakes
  const turboLvl = options.upgrades?.turbo ?? 0;
  const frontBumperOpt: FrontBumperOption = !options.isTraffic ? (options.frontBumper ?? 'stock') : 'stock';
  const splitterMat = !options.isTraffic ? carbonMat : trimDarkMat;

  const splitterScaleZ = frontBumperOpt === 'gt_splitter' ? 0.56 : frontBumperOpt === 'carbon_lip' ? 0.46 : 0.38;
  const splitterGeo = new THREE.CylinderGeometry(
    dims.bodyWidth * (frontBumperOpt === 'gt_splitter' ? 0.54 : 0.51),
    dims.bodyWidth * (frontBumperOpt === 'gt_splitter' ? 0.55 : 0.52),
    frontBumperOpt === 'gt_splitter' ? 0.06 : 0.05,
    18,
    1,
    false,
    -Math.PI * 0.48,
    Math.PI * 0.96
  );
  splitterGeo.scale(1, 1, splitterScaleZ);
  splitterGeo.rotateY(Math.PI);
  geometries.push(splitterGeo);

  const splitter = new THREE.Mesh(splitterGeo, splitterMat);
  splitter.position.set(
    0,
    frontBumperOpt === 'gt_splitter' ? 0.17 : 0.19,
    dims.noseZ + (frontBumperOpt === 'gt_splitter' ? 0.10 : 0.16)
  );
  chassisGroup.add(splitter);

  if (frontBumperOpt === 'carbon_lip' || frontBumperOpt === 'gt_splitter') {
    const canardGeo = new THREE.BoxGeometry(0.12, 0.08, 0.24);
    geometries.push(canardGeo);
    for (const side of [-1, 1]) {
      const canard = new THREE.Mesh(canardGeo, carbonMat);
      canard.position.set(side * (dims.bodyWidth * 0.48), 0.24, dims.noseZ + 0.14);
      canard.rotation.z = side * -0.25;
      chassisGroup.add(canard);
    }
    if (frontBumperOpt === 'gt_splitter') {
      const strutGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.18, 6);
      geometries.push(strutGeo);
      for (const sx of [-0.36, 0.36]) {
        const strut = new THREE.Mesh(strutGeo, rimMat);
        strut.position.set(sx, 0.24, dims.noseZ - 0.01);
        strut.rotation.x = 0.22;
        chassisGroup.add(strut);
      }
    }
  }

  // Recessed front grille mesh
  const grilleGeo = new THREE.BoxGeometry(dims.bodyWidth * 0.58, 0.17, 0.08);
  geometries.push(grilleGeo);
  const grille = new THREE.Mesh(grilleGeo, trimDarkMat);
  grille.position.set(0, dims.headlightY - 0.16, dims.noseZ + 0.04);
  chassisGroup.add(grille);

  // Carbon hood overlay on Stage 2+ Turbo or Stage 2+ Weight Reduction player cars
  if (!options.isTraffic && (turboLvl >= 2 || weightLvl >= 2)) {
    const hoodGeo = new THREE.SphereGeometry(0.68, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.35);
    hoodGeo.scale(0.92, 0.18, 1.05);
    geometries.push(hoodGeo);
    const hoodOverlay = new THREE.Mesh(hoodGeo, carbonMat);
    hoodOverlay.position.set(0, dims.headlightY + 0.14, dims.frontAxleZ + 0.02);
    chassisGroup.add(hoodOverlay);
  }

  // Muscle hood blower scoop
  if (dims.hoodScoop) {
    const scoopGeo = new THREE.BoxGeometry(0.46, 0.11, 0.72);
    geometries.push(scoopGeo);
    const scoop = new THREE.Mesh(scoopGeo, carbonMat);
    scoop.position.set(0, 0.87, dims.frontAxleZ + 0.12);
    chassisGroup.add(scoop);
  }

  // Mid-engine side air intakes
  if (dims.sideIntakes) {
    const intakeGeo = new THREE.BoxGeometry(0.08, 0.24, 0.52);
    geometries.push(intakeGeo);
    for (const side of [-1, 1]) {
      const intake = new THREE.Mesh(intakeGeo, trimDarkMat);
      intake.position.set(side * (dims.bodyWidth * 0.495), 0.56, 0.52);
      chassisGroup.add(intake);
    }
  }

  // Sculpted side skirts connecting front and rear wheel arches
  const skirtLen = Math.abs(dims.rearAxleZ - dims.frontAxleZ) - (dims.tireRadius + 0.06) * 2;
  const skirtGeo = new THREE.BoxGeometry(0.09, 0.06, Math.max(0.8, skirtLen));
  geometries.push(skirtGeo);
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(skirtGeo, splitterMat);
    skirt.position.set(side * (dims.bodyWidth * 0.49), 0.20, 0);
    chassisGroup.add(skirt);
  }

  // 5. Rear Spoiler / GT Wing + Rear Diffuser + Dual/Quad Exhausts + Nitro Flames
  const effectiveSpoilerType: StyleDims['spoilerType'] =
    options.spoilerOverride === 'none'
      ? 'none'
      : options.spoilerOverride === 'ducktail'
        ? 'ducktail'
        : options.spoilerOverride === 'street_wing'
          ? 'r34_wing'
          : options.spoilerOverride === 'gt_wing'
            ? 'gt_swan'
            : dims.spoilerType;

  let activeWingGroup: THREE.Group | null = null;
  let activeWingBaseY = dims.taillightY + 0.14;
  let activeWingBaseRotX = 0.14;

  if (effectiveSpoilerType !== 'none') {
    const wingSpan =
      effectiveSpoilerType === 'gt_swan' ||
      effectiveSpoilerType === 'black_gt' ||
      effectiveSpoilerType === 'hyper_wing'
        ? dims.bodyWidth * 0.94
        : dims.bodyWidth * 0.84;
    const wingChord = effectiveSpoilerType === 'ducktail' ? 0.18 : 0.30;
    const wingGeo = createCurvedWingGeo(wingSpan, wingChord);
    geometries.push(wingGeo);

    const wingY =
      effectiveSpoilerType === 'ducktail'
        ? dims.taillightY + 0.16
        : effectiveSpoilerType === 'black_gt' || effectiveSpoilerType === 'gt_swan'
          ? dims.taillightY + 0.38
          : dims.taillightY + 0.28;
    const wingZ = dims.tailZ - 0.14;
    const wingTilt = effectiveSpoilerType === 'ducktail' ? 0.38 : 0.14;

    activeWingGroup = new THREE.Group();
    activeWingGroup.position.set(0, wingY, wingZ);
    activeWingBaseY = wingY;
    activeWingBaseRotX = wingTilt;

    const wingMesh = new THREE.Mesh(wingGeo, carbonMat);
    wingMesh.rotation.x = wingTilt;
    activeWingGroup.add(wingMesh);

    if (effectiveSpoilerType !== 'ducktail') {
      const pylonH = wingY - dims.taillightY - 0.04;
      const pylonGeo = new THREE.BoxGeometry(0.045, Math.max(0.14, pylonH), 0.14);
      const endplateGeo = new THREE.BoxGeometry(0.025, 0.16, 0.34);
      geometries.push(pylonGeo, endplateGeo);

      for (const sx of [-0.46, 0.46]) {
        const pylon = new THREE.Mesh(pylonGeo, trimDarkMat);
        pylon.position.set(sx, wingY - pylonH * 0.5, wingZ + 0.02);
        chassisGroup.add(pylon);
      }
      for (const sx of [-wingSpan * 0.5, wingSpan * 0.5]) {
        const ep = new THREE.Mesh(endplateGeo, carbonMat);
        ep.position.set(sx, -0.01, 0);
        activeWingGroup.add(ep);
      }
    }
    chassisGroup.add(activeWingGroup);
  } else if (!options.isTraffic) {
    // Deployable flush rear aero flap even on stock/clean tail cars
    const flapGeo = createCurvedWingGeo(dims.bodyWidth * 0.64, 0.15);
    geometries.push(flapGeo);
    activeWingBaseY = dims.taillightY + 0.10;
    activeWingBaseRotX = 0.06;
    activeWingGroup = new THREE.Group();
    activeWingGroup.position.set(0, activeWingBaseY, dims.tailZ - 0.18);
    const flapMesh = new THREE.Mesh(flapGeo, carbonMat);
    flapMesh.rotation.x = activeWingBaseRotX;
    activeWingGroup.add(flapMesh);
    chassisGroup.add(activeWingGroup);
  }

  // Rear diffuser + vertical fins + custom 3D License Plate
  const diffuserOpt: DiffuserOption = !options.isTraffic ? (options.diffuser ?? 'stock') : 'stock';
  const diffWidth = diffuserOpt === 'race_carbon' ? dims.bodyWidth * 0.88 : dims.bodyWidth * 0.78;
  const diffDepth = diffuserOpt === 'race_carbon' ? 0.30 : diffuserOpt === 'finned' ? 0.26 : 0.22;
  const diffGeo = new THREE.BoxGeometry(diffWidth, 0.13, diffDepth);
  const finGeo = new THREE.BoxGeometry(0.025, diffuserOpt === 'stock' ? 0.14 : 0.18, diffDepth + 0.04);
  geometries.push(diffGeo, finGeo);
  const diffMat = diffuserOpt === 'race_carbon' ? carbonMat : trimDarkMat;
  const diffuser = new THREE.Mesh(diffGeo, diffMat);
  diffuser.position.set(0, 0.25, dims.tailZ - 0.04);
  chassisGroup.add(diffuser);
  const finXs =
    diffuserOpt === 'stock'
      ? [-0.42, -0.14, 0.14, 0.42]
      : [-0.60, -0.36, -0.12, 0.12, 0.36, 0.60];
  for (const fx of finXs) {
    const fin = new THREE.Mesh(finGeo, diffMat);
    fin.position.set(fx, 0.24, dims.tailZ - 0.01);
    chassisGroup.add(fin);
  }

  // Custom 3D Rear License Plate (Player cars)
  let currentPlateTex: THREE.CanvasTexture | null = null;
  let plateMat: THREE.MeshStandardMaterial | null = null;
  if (!options.isTraffic) {
    currentPlateTex = createLicensePlateTexture(options.plateText ?? 'GSTDVR');
    disposableTextures.push(currentPlateTex);
    const plateGeo = new THREE.PlaneGeometry(0.50, 0.155);
    const plateBackGeo = new THREE.BoxGeometry(0.52, 0.175, 0.018);
    geometries.push(plateGeo, plateBackGeo);
    plateMat = new THREE.MeshStandardMaterial({
      map: currentPlateTex,
      roughness: 0.35,
      metalness: 0.12,
    });
    materials.push(plateMat);
    const plateBack = new THREE.Mesh(plateBackGeo, trimDarkMat);
    plateBack.position.set(0, 0.46, dims.tailZ - 0.005);
    const plateFace = new THREE.Mesh(plateGeo, plateMat);
    plateFace.position.set(0, 0.46, dims.tailZ + 0.006);
    chassisGroup.add(plateBack, plateFace);
  }

  // Dual / Quad / Center Exhausts & Nitro Flames (scaled by Exhaust upgrade)
  const exhStage = !options.isTraffic ? Math.min(3, Math.max(0, options.upgrades?.exhaust ?? 0)) : 0;
  const exhR = 0.056 + exhStage * 0.010;
  const exhGeo = new THREE.CylinderGeometry(exhR, exhR, 0.20, 14);
  exhGeo.rotateX(Math.PI / 2);
  const exhInnerGeo = new THREE.CylinderGeometry(exhR * 0.74, exhR * 0.74, 0.21, 12);
  exhInnerGeo.rotateX(Math.PI / 2);
  geometries.push(exhGeo, exhInnerGeo);

  const exhTipMat =
    exhStage >= 2
      ? new THREE.MeshStandardMaterial({
          color: exhStage >= 3 ? 0x60a5fa : 0xd4af37,
          metalness: 0.92,
          roughness: 0.16,
        })
      : rimMat;
  if (exhTipMat !== rimMat) materials.push(exhTipMat);

  const exhPositions = dims.centerExhaust
    ? [-0.09, 0.09]
    : dims.quadExhaust
      ? [-0.56, -0.42, 0.42, 0.56]
      : [-0.48, 0.48];

  for (const sx of exhPositions) {
    const exh = new THREE.Mesh(exhGeo, exhTipMat);
    exh.position.set(sx, 0.25, dims.tailZ + (exhStage > 0 ? 0.02 : -0.01));
    const hole = new THREE.Mesh(exhInnerGeo, trimDarkMat);
    hole.position.set(sx, 0.25, dims.tailZ + (exhStage > 0 ? 0.025 : -0.005));
    chassisGroup.add(exh, hole);
  }

  const flameGeo = new THREE.ConeGeometry(0.095, 0.85, 10);
  flameGeo.rotateX(Math.PI / 2);
  const backfireOuterGeo = new THREE.ConeGeometry(0.125, 0.76, 10);
  backfireOuterGeo.rotateX(Math.PI / 2);
  const backfireCoreGeo = new THREE.ConeGeometry(0.064, 0.48, 8);
  backfireCoreGeo.rotateX(Math.PI / 2);
  const sparkGeo = new THREE.SphereGeometry(0.032, 6, 6);
  geometries.push(flameGeo, backfireOuterGeo, backfireCoreGeo, sparkGeo);

  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const backfireOuterMat = new THREE.MeshBasicMaterial({
    color: 0xff6b00,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const backfireCoreMat = new THREE.MeshBasicMaterial({
    color: 0x60a5fa,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.push(flameMat, backfireOuterMat, backfireCoreMat, sparkMat);

  const flameX = dims.centerExhaust ? 0.09 : 0.48;
  const flameLeft = new THREE.Mesh(flameGeo, flameMat);
  flameLeft.position.set(-flameX, 0.25, dims.tailZ + 0.42);
  const flameRight = new THREE.Mesh(flameGeo, flameMat);
  flameRight.position.set(flameX, 0.25, dims.tailZ + 0.42);

  const backfireLeft = new THREE.Mesh(backfireOuterGeo, backfireOuterMat);
  backfireLeft.position.set(-flameX, 0.25, dims.tailZ + 0.36);
  const bfCoreL = new THREE.Mesh(backfireCoreGeo, backfireCoreMat);
  bfCoreL.position.set(0, 0, -0.10);
  backfireLeft.add(bfCoreL);

  const backfireRight = new THREE.Mesh(backfireOuterGeo, backfireOuterMat);
  backfireRight.position.set(flameX, 0.25, dims.tailZ + 0.36);
  const bfCoreR = new THREE.Mesh(backfireCoreGeo, backfireCoreMat);
  bfCoreR.position.set(0, 0, -0.10);
  backfireRight.add(bfCoreR);

  const backfireSparks: THREE.Mesh[] = [];
  if (!options.isTraffic) {
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Mesh(sparkGeo, sparkMat);
      const sx = (i % 2 === 0 ? -1 : 1) * flameX;
      sp.position.set(sx, 0.25, dims.tailZ + 0.28);
      sp.visible = false;
      chassisGroup.add(sp);
      backfireSparks.push(sp);
    }
  }

  let backfireLight: THREE.PointLight | null = null;
  if (!options.isTraffic && !options.isSoftwareGl) {
    backfireLight = new THREE.PointLight(0xff7b00, 0, 6.2, 1.8);
    backfireLight.position.set(0, 0.30, dims.tailZ + 0.48);
    chassisGroup.add(backfireLight);
  }

  chassisGroup.add(flameLeft, flameRight, backfireLeft, backfireRight);

  // 6. Modern Glowing LED Headlight & Taillight Strips
  const headLedMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xdbeafe),
    emissiveIntensity: 2.6,
    roughness: 0.1,
    toneMapped: false,
  });
  const tailLedMat = new THREE.MeshStandardMaterial({
    color: 0xff2a36,
    emissive: new THREE.Color(0xff1e2d),
    emissiveIntensity: 2.8,
    roughness: 0.1,
    toneMapped: false,
  });
  materials.push(headLedMat, tailLedMat);

  const drlGeo = new THREE.BoxGeometry(0.38, 0.045, 0.06);
  const headClusterGeo = new THREE.SphereGeometry(0.065, 12, 8);
  headClusterGeo.scale(1.6, 0.65, 0.6);
  geometries.push(drlGeo, headClusterGeo);

  for (const side of [-1, 1]) {
    const drl = new THREE.Mesh(drlGeo, headLedMat);
    drl.position.set(side * (dims.bodyWidth * 0.31), dims.headlightY, dims.noseZ + 0.04);
    drl.rotation.y = side * -0.22;
    drl.rotation.z = side * 0.08;
    chassisGroup.add(drl);

    const pod = new THREE.Mesh(headClusterGeo, headLedMat);
    pod.position.set(side * (dims.bodyWidth * 0.32), dims.headlightY + 0.035, dims.noseZ + 0.06);
    chassisGroup.add(pod);
  }

  // Full-width / twin sleek LED taillight bar
  if (
    options.style === 'porsche_gt3' ||
    options.style === 'huracan_evo' ||
    options.style === 'lafuria_v12' ||
    options.style === 'muscle_srt'
  ) {
    const fullTailGeo = new THREE.BoxGeometry(dims.bodyWidth * 0.78, 0.042, 0.05);
    geometries.push(fullTailGeo);
    const fullTail = new THREE.Mesh(fullTailGeo, tailLedMat);
    fullTail.position.set(0, dims.taillightY, dims.tailZ - 0.02);
    chassisGroup.add(fullTail);
  } else {
    const tailBarGeo = new THREE.BoxGeometry(0.42, 0.052, 0.05);
    geometries.push(tailBarGeo);
    for (const side of [-1, 1]) {
      const tl = new THREE.Mesh(tailBarGeo, tailLedMat);
      tl.position.set(side * (dims.bodyWidth * 0.30), dims.taillightY, dims.tailZ - 0.02);
      tl.rotation.y = side * 0.14;
      chassisGroup.add(tl);
    }
  }

  // 7. 4 Rounded Tires (LatheGeometry) + Customizable Rims + Disc Rotors + Brembo Calipers
  const perfStage = Math.max(options.upgrades?.ecu ?? 0, options.upgrades?.gearbox ?? 0, weightLvl);
  const tireProfile: TireProfile = !options.isTraffic ? (options.tireProfile ?? 'street') : 'street';
  const tireWidthBonus = tireProfile === 'racing_wide' ? 0.055 : tireProfile === 'semi_slick' ? 0.028 : 0;
  const tireWidth = dims.tireWidth + perfStage * 0.012 + tireWidthBonus;
  const rimR = dims.tireRadius * 0.65;

  const tireGeo = createRoundedTireGeometry(dims.tireRadius, rimR, tireWidth);
  const rimBarrelGeo = new THREE.CylinderGeometry(rimR, rimR, tireWidth * 0.84, 24);
  rimBarrelGeo.rotateZ(Math.PI / 2);
  const rotorScale = 0.80 + brakeLvl * 0.032;
  const rotorGeo = new THREE.CylinderGeometry(rimR * rotorScale, rimR * rotorScale, 0.035, 22);
  rotorGeo.rotateZ(Math.PI / 2);
  const rimDesign: RimDesign = !options.isTraffic ? (options.rimDesign ?? 'five_spoke') : 'five_spoke';
  const spokeCount = rimDesign === 'multi_spoke' ? 10 : rimDesign === 'turbofan' ? 8 : 5;
  const spokeWidth = rimDesign === 'multi_spoke' ? 0.022 : 0.042;
  const spokeGeo = new THREE.BoxGeometry(0.028, rimR * 1.88, spokeWidth);
  const centerCapGeo = new THREE.CylinderGeometry(0.055, 0.055, tireWidth * 0.9, 14);
  centerCapGeo.rotateZ(Math.PI / 2);
  const calGeo = new THREE.BoxGeometry(0.075, 0.125 + brakeLvl * 0.015, 0.088 + brakeLvl * 0.012);
  const lipGeo =
    rimDesign === 'deep_dish'
      ? new THREE.TorusGeometry(rimR * 0.95, 0.022, 8, 24)
      : null;
  if (lipGeo) {
    lipGeo.rotateY(Math.PI / 2);
    geometries.push(lipGeo);
  }
  const turbofanDiscGeo =
    rimDesign === 'turbofan'
      ? new THREE.CylinderGeometry(rimR * 0.93, rimR * 0.93, 0.02, 24)
      : null;
  if (turbofanDiscGeo) {
    turbofanDiscGeo.rotateZ(Math.PI / 2);
    geometries.push(turbofanDiscGeo);
  }
  geometries.push(tireGeo, rimBarrelGeo, rotorGeo, spokeGeo, centerCapGeo, calGeo);

  const wheelTrackX = dims.bodyWidth * 0.5 - tireWidth * 0.36;
  const wheelCoords = [
    { x: -wheelTrackX, y: dims.tireRadius, z: dims.frontAxleZ },
    { x: wheelTrackX, y: dims.tireRadius, z: dims.frontAxleZ },
    { x: -wheelTrackX, y: dims.tireRadius, z: dims.rearAxleZ },
    { x: wheelTrackX, y: dims.tireRadius, z: dims.rearAxleZ },
  ];

  for (const wc of wheelCoords) {
    const wg = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = !options.isTraffic;
    wg.add(tire);

    const barrel = new THREE.Mesh(rimBarrelGeo, trimDarkMat);
    wg.add(barrel);

    const rotor = new THREE.Mesh(rotorGeo, rotorMat);
    rotor.position.x = wc.x > 0 ? -0.02 : 0.02;
    wg.add(rotor);

    const dishOffset = rimDesign === 'deep_dish' ? 0.62 : 1.0;
    const faceX = (wc.x > 0 ? tireWidth * 0.36 : -tireWidth * 0.36) * dishOffset;

    if (turbofanDiscGeo) {
      const disc = new THREE.Mesh(turbofanDiscGeo, rimMat);
      disc.position.x = wc.x > 0 ? tireWidth * 0.34 : -tireWidth * 0.34;
      wg.add(disc);
    }

    for (let s = 0; s < spokeCount; s++) {
      const spoke = new THREE.Mesh(spokeGeo, rimDesign === 'turbofan' ? trimDarkMat : rimMat);
      spoke.position.x = wc.x > 0 ? Math.abs(faceX) + (turbofanDiscGeo ? 0.012 : 0) : -Math.abs(faceX) - (turbofanDiscGeo ? 0.012 : 0);
      spoke.rotation.x = (s * Math.PI) / spokeCount;
      wg.add(spoke);
    }

    if (lipGeo) {
      const lip = new THREE.Mesh(lipGeo, rimMat);
      lip.position.x = wc.x > 0 ? tireWidth * 0.40 : -tireWidth * 0.40;
      wg.add(lip);
    }

    const cap = new THREE.Mesh(centerCapGeo, rimMat);
    wg.add(cap);

    const caliper = new THREE.Mesh(calGeo, caliperMat);
    caliper.position.set(wc.x > 0 ? 0.01 : -0.01, 0.10, 0.09);
    wg.add(caliper);

    wg.position.set(wc.x, wc.y, wc.z);
    wg.rotation.order = 'YXZ';
    root.add(wg);
    wheels.push(wg);
  }

  // 8. Soft Chassis + Per-Tire Contact Shadow Planes
  const shadowPlaneGeo = new THREE.PlaneGeometry(dims.bodyWidth + 0.9, 5.4);
  shadowPlaneGeo.rotateX(-Math.PI / 2);
  const wheelShadowGeo = new THREE.PlaneGeometry(0.76, 1.05);
  wheelShadowGeo.rotateX(-Math.PI / 2);
  geometries.push(shadowPlaneGeo, wheelShadowGeo);

  const shadowPlaneMat = new THREE.MeshBasicMaterial({
    map: options.textures.contactShadow,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });
  const wheelShadowMat = new THREE.MeshBasicMaterial({
    map: options.textures.contactShadow,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  materials.push(shadowPlaneMat, wheelShadowMat);

  const contactShadowMesh = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
  contactShadowMesh.position.y = 0.012;
  root.add(contactShadowMesh);

  for (const wc of wheelCoords) {
    const ws = new THREE.Mesh(wheelShadowGeo, wheelShadowMat);
    ws.position.set(wc.x, 0.014, wc.z);
    root.add(ws);
  }

  // 9. Customizable Underglow Neon Beneath Chassis + Spawn Pulse Ring
  const ugGeo = new THREE.PlaneGeometry(dims.bodyWidth + 1.0, 5.4);
  ugGeo.rotateX(-Math.PI / 2);
  geometries.push(ugGeo);
  const hasUg = options.underglowHex !== 'none' && !options.isTraffic;
  const underglowMat = new THREE.MeshBasicMaterial({
    map: options.textures.underglowRadial,
    color: new THREE.Color(hasUg ? options.underglowHex : '#000000'),
    transparent: true,
    opacity: hasUg ? 0.88 : 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.push(underglowMat);
  const underglowMesh = new THREE.Mesh(ugGeo, underglowMat);
  underglowMesh.position.y = 0.026;
  underglowMesh.visible = hasUg;
  root.add(underglowMesh);

  let spawnRingMesh: THREE.Mesh | null = null;
  if (!options.isTraffic) {
    const ringGeo = new THREE.RingGeometry(1.7, 2.35, 36);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    geometries.push(ringGeo);
    materials.push(ringMat);
    spawnRingMesh = new THREE.Mesh(ringGeo, ringMat);
    spawnRingMesh.position.y = 0.035;
    spawnRingMesh.visible = false;
    root.add(spawnRingMesh);
  }

  let underglowLight: THREE.PointLight | null = null;
  if (!options.isTraffic && !options.isSoftwareGl) {
    underglowLight = new THREE.PointLight(
      hasUg ? options.underglowHex : '#0ea5e9',
      hasUg ? 2.4 : 0,
      7.8,
      1.8
    );
    underglowLight.position.set(0, 0.24, 0);
    root.add(underglowLight);
  }

  return {
    root,
    chassisGroup,
    wheels,
    paintMat,
    rimMat,
    glassMat,
    headLedMat,
    tailLedMat,
    underglowMat,
    underglowMesh,
    underglowLight,
    spawnRingMesh,
    activeWingGroup,
    activeWingBaseY,
    activeWingBaseRotX,
    flameLeft,
    flameRight,
    backfireLeft,
    backfireRight,
    backfireSparks,
    backfireLight,
    updatePlateText: (text: string) => {
      if (!plateMat) return;
      const nextTex = createLicensePlateTexture(text);
      if (currentPlateTex) {
        currentPlateTex.dispose();
        const idx = disposableTextures.indexOf(currentPlateTex);
        if (idx >= 0) disposableTextures.splice(idx, 1);
      }
      currentPlateTex = nextTex;
      disposableTextures.push(nextTex);
      plateMat.map = nextTex;
      plateMat.needsUpdate = true;
    },
    applyPaintFinish: (finish: PaintFinish) => {
      applyFinishParams(paintMat, finish, options.isTraffic);
    },
    applyWindowTint: (tint: WindowTintOption) => {
      applyTintParams(glassMat, tint, options.isTraffic);
    },
    dispose: () => {
      disposableTextures.forEach((t) => t.dispose());
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

export interface DriverCharacter {
  root: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  updateMotion: (moveSpeedNorm: number, dt: number) => void;
  dispose: () => void;
}

export function buildDriverCharacter(textures: ProceduralTextureSet): DriverCharacter {
  const root = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const jacketMat = new THREE.MeshStandardMaterial({
    color: 0x161b24,
    roughness: 0.65,
    metalness: 0.12,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xe10600,
    roughness: 0.4,
    metalness: 0.15,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: 0x0f1218,
    roughness: 0.8,
    metalness: 0.05,
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.45,
    metalness: 0.1,
  });
  const gloveMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.55,
    metalness: 0.1,
  });
  const helmetMat = new THREE.MeshPhysicalMaterial({
    color: 0xf1f5f9,
    roughness: 0.12,
    metalness: 0.25,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
  });
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: 0x090d16,
    roughness: 0.04,
    metalness: 0.82,
    clearcoat: 1.0,
  });
  materials.push(jacketMat, stripeMat, pantsMat, shoeMat, gloveMat, helmetMat, visorMat);

  // Ground contact shadow disc
  const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadow,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  geometries.push(shadowGeo);
  materials.push(shadowMat);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.y = 0.015;
  root.add(shadow);

  // Pelvis / Body root for natural bounce & forward sprint lean
  const bodyRig = new THREE.Group();
  root.add(bodyRig);

  // Articulated 2-segment legs (Hip -> Thigh -> Knee -> Shin + Shoe)
  const thighGeo = new THREE.CapsuleGeometry(0.082, 0.26, 6, 10);
  const shinGeo = new THREE.CapsuleGeometry(0.068, 0.26, 6, 10);
  const shoeGeo = new THREE.BoxGeometry(0.14, 0.09, 0.24);
  geometries.push(thighGeo, shinGeo, shoeGeo);

  const makeLeg = (x: number) => {
    const hip = new THREE.Group();
    hip.position.set(x, 0.84, 0);
    const thigh = new THREE.Mesh(thighGeo, pantsMat);
    thigh.position.y = -0.18;
    thigh.castShadow = true;

    const knee = new THREE.Group();
    knee.position.set(0, -0.38, 0);
    const shin = new THREE.Mesh(shinGeo, pantsMat);
    shin.position.y = -0.18;
    shin.castShadow = true;
    const shoe = new THREE.Mesh(shoeGeo, shoeMat);
    shoe.position.set(0, -0.39, -0.045);

    knee.add(shin, shoe);
    hip.add(thigh, knee);
    bodyRig.add(hip);
    return { hip, knee };
  };

  const leftLegRig = makeLeg(-0.12);
  const rightLegRig = makeLeg(0.12);

  // Torso group for realistic upper-body counter-twist and breathing
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 0.86, 0);
  bodyRig.add(torsoGroup);

  const torsoGeo = new THREE.CapsuleGeometry(0.19, 0.34, 8, 14);
  const collarGeo = new THREE.BoxGeometry(0.32, 0.07, 0.24);
  geometries.push(torsoGeo, collarGeo);
  const torso = new THREE.Mesh(torsoGeo, jacketMat);
  torso.scale.set(1.12, 1, 0.76);
  torso.position.y = 0.28;
  torso.castShadow = true;
  const stripe = new THREE.Mesh(collarGeo, stripeMat);
  stripe.position.set(0, 0.46, 0);
  torsoGroup.add(torso, stripe);

  // Articulated 2-segment arms (Shoulder -> UpperArm -> Elbow -> Forearm + Glove)
  const upperArmGeo = new THREE.CapsuleGeometry(0.058, 0.20, 6, 10);
  const forearmGeo = new THREE.CapsuleGeometry(0.048, 0.20, 6, 10);
  const handGeo = new THREE.SphereGeometry(0.052, 8, 8);
  geometries.push(upperArmGeo, forearmGeo, handGeo);

  const makeArm = (x: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, 0.48, 0);
    const upperArm = new THREE.Mesh(upperArmGeo, jacketMat);
    upperArm.position.y = -0.13;
    upperArm.castShadow = true;

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.26, 0);
    const forearm = new THREE.Mesh(forearmGeo, jacketMat);
    forearm.position.y = -0.12;
    forearm.castShadow = true;
    const hand = new THREE.Mesh(handGeo, gloveMat);
    hand.position.y = -0.25;

    elbow.add(forearm, hand);
    shoulder.add(upperArm, elbow);
    torsoGroup.add(shoulder);
    return { shoulder, elbow };
  };

  const leftArmRig = makeArm(-0.27);
  const rightArmRig = makeArm(0.27);

  // Track-Day Helmet + Visor
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.68, 0);
  const headGeo = new THREE.SphereGeometry(0.155, 16, 14);
  const visorGeo = new THREE.BoxGeometry(0.22, 0.085, 0.14);
  geometries.push(headGeo, visorGeo);
  const head = new THREE.Mesh(headGeo, helmetMat);
  head.position.set(0, 0.08, 0);
  head.castShadow = true;
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.09, -0.105);
  headGroup.add(head, visor);
  torsoGroup.add(headGroup);

  let phase = 0;

  return {
    root,
    leftLeg: leftLegRig.hip,
    rightLeg: rightLegRig.hip,
    leftArm: leftArmRig.shoulder,
    rightArm: rightArmRig.shoulder,
    updateMotion: (moveSpeedNorm: number, dt: number) => {
      if (moveSpeedNorm > 0.04) {
        const freq = 9.2 + moveSpeedNorm * 4.5;
        phase += dt * freq;
        const amp = 0.52 + moveSpeedNorm * 0.34;
        const s = Math.sin(phase);
        const c = Math.cos(phase);

        // Hip swing + realistic knee bend (bends backward during recovery/back-swing)
        leftLegRig.hip.rotation.x = s * amp;
        rightLegRig.hip.rotation.x = -s * amp;
        leftLegRig.knee.rotation.x = -Math.max(0, -s * 0.95 - 0.1) * (0.65 + moveSpeedNorm * 0.45);
        rightLegRig.knee.rotation.x = -Math.max(0, s * 0.95 - 0.1) * (0.65 + moveSpeedNorm * 0.45);

        // Shoulder swing + bent elbow flexion
        leftArmRig.shoulder.rotation.x = -s * amp * 0.85;
        rightArmRig.shoulder.rotation.x = s * amp * 0.85;
        leftArmRig.elbow.rotation.x = 0.45 + Math.max(0, -s) * 0.55;
        rightArmRig.elbow.rotation.x = 0.45 + Math.max(0, s) * 0.55;

        // Vertical stride bob, sprint forward lean, and shoulder counter-rotation
        bodyRig.position.y = Math.abs(c) * (0.032 + moveSpeedNorm * 0.025);
        torsoGroup.rotation.x = 0.06 + moveSpeedNorm * 0.14;
        torsoGroup.rotation.y = s * 0.11;
        headGroup.rotation.x = -torsoGroup.rotation.x * 0.55;
      } else {
        // Subtle idle breathing & smooth relaxation
        phase += dt * 2.1;
        const damp = 1 - Math.exp(-10 * dt);
        leftLegRig.hip.rotation.x = THREE.MathUtils.lerp(leftLegRig.hip.rotation.x, 0, damp);
        rightLegRig.hip.rotation.x = THREE.MathUtils.lerp(rightLegRig.hip.rotation.x, 0, damp);
        leftLegRig.knee.rotation.x = THREE.MathUtils.lerp(leftLegRig.knee.rotation.x, 0, damp);
        rightLegRig.knee.rotation.x = THREE.MathUtils.lerp(rightLegRig.knee.rotation.x, 0, damp);
        leftArmRig.shoulder.rotation.x = THREE.MathUtils.lerp(leftArmRig.shoulder.rotation.x, 0, damp);
        rightArmRig.shoulder.rotation.x = THREE.MathUtils.lerp(rightArmRig.shoulder.rotation.x, 0, damp);
        leftArmRig.elbow.rotation.x = THREE.MathUtils.lerp(leftArmRig.elbow.rotation.x, 0.14, damp);
        rightArmRig.elbow.rotation.x = THREE.MathUtils.lerp(rightArmRig.elbow.rotation.x, 0.14, damp);
        bodyRig.position.y = THREE.MathUtils.lerp(bodyRig.position.y, Math.sin(phase) * 0.006, damp);
        torsoGroup.rotation.x = THREE.MathUtils.lerp(torsoGroup.rotation.x, 0, damp);
        torsoGroup.rotation.y = THREE.MathUtils.lerp(torsoGroup.rotation.y, 0, damp);
        headGroup.rotation.x = THREE.MathUtils.lerp(headGroup.rotation.x, 0, damp);
      }
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
