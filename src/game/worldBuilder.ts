import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';
import { CAR_CATALOG, GraphicsQuality, WeatherMode } from './types';
import { buildCompositeVehicle, BuiltVehicle } from './vehicleBuilder';

export const PARKING_PLAYER_CAR_POS = { x: 18.0, y: 0, z: 0.6, rotY: 0.72 };
export const TUNER_ENTRY_POS = { x: 17.5, y: 0, z: -15.5 };
export const TUNER_BAY_POS = { x: 17.5, y: 0, z: -19.8 };
export const DEALERSHIP_ENTRY_POS = { x: 29.8, y: 0, z: -2.5 };
export const DEALERSHIP_FOCUS_POS = { x: 41.4, y: 1.0, z: -2.5 };
export const PARKING_BOUNDS = { minX: 10.2, maxX: 29.8, minZ: -16.0, maxZ: 11.0 };
export const DEALERSHIP_INTERIOR_BOUNDS = { minX: 30.2, maxX: 50.2, minZ: -15.4, maxZ: 10.4 };

export interface TrackSample {
  x: number;
  z: number;
  tx: number;
  tz: number;
  rx: number;
  rz: number;
  yaw: number;
  s: number;
}

export interface TrackProjection {
  s: number;
  laneOffset: number;
  cx: number;
  cz: number;
  tx: number;
  tz: number;
  rx: number;
  rz: number;
  yaw: number;
}

export interface ClosedLoopTrack {
  totalLength: number;
  sampleCount: number;
  samples: TrackSample[];
  parkingOpenStartS: number;
  parkingOpenEndS: number;
  wrapS: (s: number) => number;
  shortestSignedDeltaS: (fromS: number, toS: number) => number;
  isInParkingOpening: (s: number) => boolean;
  sampleAtS: (s: number, out: TrackSample) => TrackSample;
  projectToTrack: (
    wx: number,
    wz: number,
    hintS: number | null,
    out: TrackProjection
  ) => TrackProjection;
  minDistanceToTrack: (wx: number, wz: number) => number;
}

export interface ShowcaseEntry {
  carId: string;
  x: number;
  z: number;
  vehicle: BuiltVehicle;
}

export interface MetropolisWorld {
  group: THREE.Group;
  parkingComplexGroup: THREE.Group;
  track: ClosedLoopTrack;
  showcaseEntries: ShowcaseEntry[];
  asphaltMat: THREE.MeshPhysicalMaterial;
  roadMesh: THREE.Mesh;
  cityGround: THREE.Mesh;
  rainSystem: THREE.LineSegments;
  rainPositions: Float32Array;
  rainCount: number;
  hemiLight: THREE.HemisphereLight;
  keyLight: THREE.DirectionalLight;
  setAtmosphere: (weather: WeatherMode, scene: THREE.Scene) => void;
  setQuality: (quality: GraphicsQuality) => void;
  updateScroll: (
    anchorX: number,
    anchorZ: number,
    speedMs: number,
    dt: number,
    isStorm: boolean,
    inParking: boolean
  ) => void;
  dispose: () => void;
}

function createClosedLoopTrack(): ClosedLoopTrack {
  // Control points trace a 3.3+ km counter-clockwise loop on the -X (West) side,
  // with a ruler-straight Home Straight along x = 0 from z = +110 through z = -90
  // so the Parking, Taller, and Concesionario on +X sit flush and completely unobstructed.
  const controlPoints = [
    new THREE.Vector3(0, 0, 175),
    new THREE.Vector3(0, 0, 110),
    new THREE.Vector3(0, 0, 45),
    new THREE.Vector3(0, 0, -25),
    new THREE.Vector3(0, 0, -90),
    new THREE.Vector3(0, 0, -160),

    // Sweeping NW fast turn 1
    new THREE.Vector3(-24, 0, -245),
    new THREE.Vector3(-95, 0, -330),
    new THREE.Vector3(-215, 0, -390),

    // North Wangan S-bend & high-speed straightaway
    new THREE.Vector3(-365, 0, -415),
    new THREE.Vector3(-515, 0, -365),
    new THREE.Vector3(-655, 0, -420),
    new THREE.Vector3(-785, 0, -355),

    // Wide West banking hairpin
    new THREE.Vector3(-865, 0, -245),
    new THREE.Vector3(-885, 0, -110),
    new THREE.Vector3(-845, 0, 30),

    // South-West technical sweepers & grand curve back to Home Straight
    new THREE.Vector3(-760, 0, 165),
    new THREE.Vector3(-635, 0, 260),
    new THREE.Vector3(-480, 0, 315),
    new THREE.Vector3(-325, 0, 330),
    new THREE.Vector3(-185, 0, 305),
    new THREE.Vector3(-85, 0, 255),
    new THREE.Vector3(-22, 0, 215),
  ];

  const curve = new THREE.CatmullRomCurve3(controlPoints, true, 'catmullrom', 0.5);
  const totalLength = curve.getLength();
  const sampleCount = 2048;
  const spaced = curve.getSpacedPoints(sampleCount);

  const samples: TrackSample[] = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const prev = spaced[(i - 1 + sampleCount) % sampleCount];
    const curr = spaced[i];
    const next = spaced[(i + 1) % sampleCount];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    // Right-hand lateral unit vector in XZ (at T=(0,-1), R=(1,0)=+X)
    const rx = -tz;
    const rz = tx;
    // Three.js car facing -Z rotated by yaw has forward (-sin(yaw), -cos(yaw)) = (tx, tz)
    const yaw = Math.atan2(-tx, -tz);
    samples[i] = {
      x: curr.x,
      z: curr.z,
      tx,
      tz,
      rx,
      rz,
      yaw,
      s: (i / sampleCount) * totalLength,
    };
  }

  const wrapS = (s: number) => ((s % totalLength) + totalLength) % totalLength;

  const shortestSignedDeltaS = (fromS: number, toS: number) => {
    let d = wrapS(toS) - wrapS(fromS);
    if (d > totalLength * 0.5) d -= totalLength;
    if (d < -totalLength * 0.5) d += totalLength;
    return d;
  };

  const sampleAtS = (s: number, out: TrackSample): TrackSample => {
    const wrapped = wrapS(s);
    const fIdx = (wrapped / totalLength) * sampleCount;
    const i0 = Math.floor(fIdx) % sampleCount;
    const i1 = (i0 + 1) % sampleCount;
    const alpha = fIdx - Math.floor(fIdx);
    const a = samples[i0];
    const b = samples[i1];

    const x = a.x + (b.x - a.x) * alpha;
    const z = a.z + (b.z - a.z) * alpha;
    let tx = a.tx + (b.tx - a.tx) * alpha;
    let tz = a.tz + (b.tz - a.tz) * alpha;
    const tLen = Math.hypot(tx, tz) || 1;
    tx /= tLen;
    tz /= tLen;
    const rx = -tz;
    const rz = tx;
    const yaw = Math.atan2(-tx, -tz);

    out.x = x;
    out.z = z;
    out.tx = tx;
    out.tz = tz;
    out.rx = rx;
    out.rz = rz;
    out.yaw = yaw;
    out.s = wrapped;
    return out;
  };

  const projectToTrack = (
    wx: number,
    wz: number,
    hintS: number | null,
    out: TrackProjection
  ): TrackProjection => {
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintS !== null) {
      const centerIdx = Math.floor((wrapS(hintS) / totalLength) * sampleCount) % sampleCount;
      const windowRadius = 72;
      for (let off = -windowRadius; off <= windowRadius; off++) {
        const idx = (centerIdx + off + sampleCount) % sampleCount;
        const p = samples[idx];
        const dx = wx - p.x;
        const dz = wz - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
    }

    // Full scan fallback if far from hint or no hint supplied
    if (hintS === null || bestDistSq > 900) {
      bestDistSq = Infinity;
      for (let i = 0; i < sampleCount; i++) {
        const p = samples[i];
        const dx = wx - p.x;
        const dz = wz - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
    }

    const base = samples[bestIdx];
    const dx = wx - base.x;
    const dz = wz - base.z;
    const along = dx * base.tx + dz * base.tz;
    const refinedS = wrapS(base.s + along);

    const tmp: TrackSample = {
      x: 0,
      z: 0,
      tx: 0,
      tz: -1,
      rx: 1,
      rz: 0,
      yaw: 0,
      s: 0,
    };
    sampleAtS(refinedS, tmp);

    const rdx = wx - tmp.x;
    const rdz = wz - tmp.z;
    out.s = tmp.s;
    out.laneOffset = rdx * tmp.rx + rdz * tmp.rz;
    out.cx = tmp.x;
    out.cz = tmp.z;
    out.tx = tmp.tx;
    out.tz = tmp.tz;
    out.rx = tmp.rx;
    out.rz = tmp.rz;
    out.yaw = tmp.yaw;
    return out;
  };

  const minDistanceToTrack = (wx: number, wz: number): number => {
    let bestDistSq = Infinity;
    for (let i = 0; i < sampleCount; i += 2) {
      const p = samples[i];
      const dx = wx - p.x;
      const dz = wz - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) bestDistSq = dSq;
    }
    return Math.sqrt(bestDistSq);
  };

  // Determine exact arc-length window [parkingOpenStartS, parkingOpenEndS]
  // covering z in [-16.0, +11.2] along the Home Straight (x approx 0)
  const projTmp: TrackProjection = {
    s: 0,
    laneOffset: 0,
    cx: 0,
    cz: 0,
    tx: 0,
    tz: -1,
    rx: 1,
    rz: 0,
    yaw: 0,
  };
  const parkingOpenStartS = projectToTrack(0, 11.2, null, projTmp).s;
  const parkingOpenEndS = projectToTrack(0, -16.0, parkingOpenStartS, projTmp).s;

  const isInParkingOpening = (s: number): boolean => {
    const ws = wrapS(s);
    if (parkingOpenStartS <= parkingOpenEndS) {
      return ws >= parkingOpenStartS && ws <= parkingOpenEndS;
    }
    return ws >= parkingOpenStartS || ws <= parkingOpenEndS;
  };

  return {
    totalLength,
    sampleCount,
    samples,
    parkingOpenStartS,
    parkingOpenEndS,
    wrapS,
    shortestSignedDeltaS,
    isInParkingOpening,
    sampleAtS,
    projectToTrack,
    minDistanceToTrack,
  };
}

function buildClosedTrackRibbonGeometry(
  track: ClosedLoopTrack,
  segments: number,
  leftOffset: number,
  rightOffset: number,
  yHeight: number,
  uvRepeatLenMeters: number,
  skipParkingOpening = false
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const uvLoops = Math.max(1, Math.round(track.totalLength / uvRepeatLenMeters));
  const aSample: TrackSample = { x: 0, z: 0, tx: 0, tz: -1, rx: 1, rz: 0, yaw: 0, s: 0 };
  const bSample: TrackSample = { x: 0, z: 0, tx: 0, tz: -1, rx: 1, rz: 0, yaw: 0, s: 0 };

  let vCursor = 0;
  for (let i = 0; i < segments; i++) {
    const s0 = (i / segments) * track.totalLength;
    const s1 = ((i + 1) / segments) * track.totalLength;
    const midS = 0.5 * (s0 + s1);
    if (skipParkingOpening && track.isInParkingOpening(midS)) {
      continue;
    }

    track.sampleAtS(s0, aSample);
    track.sampleAtS(s1, bSample);

    const v0 = (s0 / track.totalLength) * uvLoops;
    const v1 = (s1 / track.totalLength) * uvLoops;

    const p0Lx = aSample.x + aSample.rx * leftOffset;
    const p0Lz = aSample.z + aSample.rz * leftOffset;
    const p0Rx = aSample.x + aSample.rx * rightOffset;
    const p0Rz = aSample.z + aSample.rz * rightOffset;

    const p1Lx = bSample.x + bSample.rx * leftOffset;
    const p1Lz = bSample.z + bSample.rz * leftOffset;
    const p1Rx = bSample.x + bSample.rx * rightOffset;
    const p1Rz = bSample.z + bSample.rz * rightOffset;

    positions.push(
      p0Lx, yHeight, p0Lz,
      p0Rx, yHeight, p0Rz,
      p1Lx, yHeight, p1Lz,
      p1Rx, yHeight, p1Rz
    );
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    uvs.push(0, v0, 1, v0, 0, v1, 1, v1);

    indices.push(vCursor, vCursor + 1, vCursor + 2, vCursor + 2, vCursor + 1, vCursor + 3);
    vCursor += 4;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

function buildClosedTrackWallGeometry(
  track: ClosedLoopTrack,
  segments: number,
  centerOffset: number,
  width: number,
  bottomY: number,
  topY: number,
  uvRepeatLenMeters: number,
  skipParkingOpening: boolean
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const halfW = width * 0.5;
  const innerOff = centerOffset - halfW;
  const outerOff = centerOffset + halfW;
  const uvLoops = Math.max(1, Math.round(track.totalLength / uvRepeatLenMeters));

  const sA: TrackSample = { x: 0, z: 0, tx: 0, tz: -1, rx: 1, rz: 0, yaw: 0, s: 0 };
  const sB: TrackSample = { x: 0, z: 0, tx: 0, tz: -1, rx: 1, rz: 0, yaw: 0, s: 0 };

  let vCursor = 0;

  const pushQuad = (
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    u0: number, v0: number, u1: number, v1: number
  ) => {
    positions.push(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3);
    uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
    indices.push(vCursor, vCursor + 1, vCursor + 2, vCursor + 2, vCursor + 1, vCursor + 3);
    vCursor += 4;
  };

  for (let i = 0; i < segments; i++) {
    const segStart = (i / segments) * track.totalLength;
    const segEnd = ((i + 1) / segments) * track.totalLength;
    const midS = 0.5 * (segStart + segEnd);
    if (skipParkingOpening && track.isInParkingOpening(midS)) {
      continue;
    }

    track.sampleAtS(segStart, sA);
    track.sampleAtS(segEnd, sB);

    const v0 = (segStart / track.totalLength) * uvLoops;
    const v1 = (segEnd / track.totalLength) * uvLoops;

    const aInX = sA.x + sA.rx * innerOff;
    const aInZ = sA.z + sA.rz * innerOff;
    const aOutX = sA.x + sA.rx * outerOff;
    const aOutZ = sA.z + sA.rz * outerOff;

    const bInX = sB.x + sB.rx * innerOff;
    const bInZ = sB.z + sB.rz * innerOff;
    const bOutX = sB.x + sB.rx * outerOff;
    const bOutZ = sB.z + sB.rz * outerOff;

    // Top face
    pushQuad(
      aInX, topY, aInZ,
      aOutX, topY, aOutZ,
      bInX, topY, bInZ,
      bOutX, topY, bOutZ,
      0, v0, 1, v1
    );
    // Inner face (facing -R)
    pushQuad(
      aInX, bottomY, aInZ,
      aInX, topY, aInZ,
      bInX, bottomY, bInZ,
      bInX, topY, bInZ,
      0, v0, 1, v1
    );
    // Outer face (facing +R)
    pushQuad(
      aOutX, topY, aOutZ,
      aOutX, bottomY, aOutZ,
      bOutX, topY, bOutZ,
      bOutX, bottomY, bOutZ,
      0, v0, 1, v1
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function buildMetropolisWorld(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean
): MetropolisWorld {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const showcaseEntries: ShowcaseEntry[] = [];

  const track = createClosedLoopTrack();

  // ==================== 1. METROPOLIS URBAN GROUND ====================
  const cityGroundGeo = new THREE.PlaneGeometry(2800, 2800);
  cityGroundGeo.rotateX(-Math.PI / 2);
  geometries.push(cityGroundGeo);
  const cityGroundMat = new THREE.MeshStandardMaterial({
    color: 0x0a0d13,
    roughness: 0.92,
    metalness: 0.08,
  });
  materials.push(cityGroundMat);
  const cityGround = new THREE.Mesh(cityGroundGeo, cityGroundMat);
  cityGround.position.set(-420, -0.05, -40);
  cityGround.receiveShadow = true;
  group.add(cityGround);

  // ==================== 2. CLOSED-LOOP TOKYO WANGAN EXPRESSWAY ====================
  const roadSegments = 760;
  const roadGeo = buildClosedTrackRibbonGeometry(track, roadSegments, -9.0, 9.0, 0.01, 36, false);
  geometries.push(roadGeo);

  const asphaltMat = new THREE.MeshPhysicalMaterial({
    map: textures.asphalt,
    roughnessMap: textures.asphaltRoughness,
    bumpMap: textures.asphaltBump,
    bumpScale: 0.018,
    color: 0x2c3340,
    roughness: 0.72,
    metalness: 0.16,
    clearcoat: 0.18,
    clearcoatRoughness: 0.35,
    envMapIntensity: 0.85,
  });
  materials.push(asphaltMat);

  const roadMesh = new THREE.Mesh(roadGeo, asphaltMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // Continuous Concrete Acoustic Barriers + LED Strips
  const concreteMat = new THREE.MeshStandardMaterial({
    map: textures.concreteBarrier,
    color: 0x64748b,
    roughness: 0.78,
    metalness: 0.12,
  });
  const barrierLedMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    emissive: new THREE.Color(0xfde68a),
    emissiveIntensity: 0.72,
    roughness: 0.3,
  });
  materials.push(concreteMat, barrierLedMat);

  const leftWallGeo = buildClosedTrackWallGeometry(track, roadSegments, -9.3, 0.55, 0, 1.35, 24, false);
  const leftLedGeo = buildClosedTrackWallGeometry(track, roadSegments, -9.0, 0.09, 1.04, 1.12, 24, false);
  const rightWallGeo = buildClosedTrackWallGeometry(track, roadSegments, 9.3, 0.55, 0, 1.35, 24, true);
  const rightLedGeo = buildClosedTrackWallGeometry(track, roadSegments, 9.0, 0.09, 1.04, 1.12, 24, true);
  geometries.push(leftWallGeo, leftLedGeo, rightWallGeo, rightLedGeo);

  const leftWallMesh = new THREE.Mesh(leftWallGeo, concreteMat);
  const leftLedMesh = new THREE.Mesh(leftLedGeo, barrierLedMat);
  const rightWallMesh = new THREE.Mesh(rightWallGeo, concreteMat);
  const rightLedMesh = new THREE.Mesh(rightLedGeo, barrierLedMat);
  group.add(leftWallMesh, leftLedMesh, rightWallMesh, rightLedMesh);

  // ==================== 3. SHARED PARKING + TALLER (LEFT) + CONCESIONARIO (RIGHT) ====================
  const parkingComplexGroup = new THREE.Group();
  group.add(parkingComplexGroup);

  // 21.2m x 28m Parking Asphalt Pad (x = 9.0..30.2, z = -16.5..+11.5) flush with Home Straight edge x = 9.0
  const parkPadGeo = new THREE.PlaneGeometry(21.2, 28.0);
  parkPadGeo.rotateX(-Math.PI / 2);
  const parkPadMat = new THREE.MeshPhysicalMaterial({
    map: textures.parkingAsphalt,
    bumpMap: textures.asphaltBump,
    bumpScale: 0.014,
    roughness: 0.68,
    metalness: 0.14,
    clearcoat: 0.22,
    clearcoatRoughness: 0.3,
  });
  geometries.push(parkPadGeo);
  materials.push(parkPadMat);
  const parkPad = new THREE.Mesh(parkPadGeo, parkPadMat);
  parkPad.position.set(19.6, 0.013, -2.5);
  parkPad.receiveShadow = true;
  parkingComplexGroup.add(parkPad);

  // Wide direct connector road/ramp with Crosswalk (Paso de Cebra) bridging Parking x=11.0 to Highway x=8.2
  const connectorGeo = new THREE.PlaneGeometry(3.2, 26.8);
  connectorGeo.rotateX(-Math.PI / 2);
  const connectorMat = new THREE.MeshPhysicalMaterial({
    map: textures.crosswalkRoad,
    bumpMap: textures.asphaltBump,
    bumpScale: 0.014,
    roughness: 0.65,
    metalness: 0.14,
  });
  geometries.push(connectorGeo);
  materials.push(connectorMat);
  const connectorRoad = new THREE.Mesh(connectorGeo, connectorMat);
  connectorRoad.position.set(9.8, 0.0155, -2.5);
  connectorRoad.receiveShadow = true;
  parkingComplexGroup.add(connectorRoad);

  // Steel Guardrails (Guardarrail) flanking the Parking-to-Highway mouth edges
  const guardrailRailGeo = new THREE.BoxGeometry(3.6, 0.24, 0.12);
  const guardrailPostGeo = new THREE.BoxGeometry(0.12, 0.82, 0.12);
  const guardrailMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.78,
    roughness: 0.34,
  });
  geometries.push(guardrailRailGeo, guardrailPostGeo);
  materials.push(guardrailMat);
  for (const gz of [-16.1, 11.2]) {
    const rail = new THREE.Mesh(guardrailRailGeo, guardrailMat);
    rail.position.set(10.8, 0.62, gz);
    parkingComplexGroup.add(rail);
    for (const px of [9.4, 10.8, 12.2]) {
      const post = new THREE.Mesh(guardrailPostGeo, guardrailMat);
      post.position.set(px, 0.41, gz);
      parkingComplexGroup.add(post);
    }
  }

  // Barrier end bollards at z = -16.0 and z = +11.2 so driver sees the exact open mouth cleanly
  const bollardGeo = new THREE.CylinderGeometry(0.22, 0.26, 1.45, 12);
  const bollardMat = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    emissive: new THREE.Color(0x3b82f6),
    emissiveIntensity: 0.75,
    roughness: 0.35,
  });
  geometries.push(bollardGeo);
  materials.push(bollardMat);
  for (const bz of [-16.1, 11.2]) {
    const bollard = new THREE.Mesh(bollardGeo, bollardMat);
    bollard.position.set(9.1, 0.72, bz);
    parkingComplexGroup.add(bollard);
  }

  // South concrete curb
  const curbGeo = new THREE.BoxGeometry(20.8, 0.24, 0.45);
  geometries.push(curbGeo);
  const curbSouth = new THREE.Mesh(curbGeo, concreteMat);
  curbSouth.position.set(20.0, 0.12, 11.4);
  parkingComplexGroup.add(curbSouth);

  // Shared materials
  const steelBlackMat = new THREE.MeshStandardMaterial({
    color: 0x0d1016,
    roughness: 0.58,
    metalness: 0.55,
  });
  const darkWallMat = new THREE.MeshStandardMaterial({
    color: 0x090b10,
    roughness: 0.78,
    metalness: 0.25,
  });
  const liftRedMat = new THREE.MeshStandardMaterial({
    color: 0xb91c1c,
    roughness: 0.35,
    metalness: 0.45,
  });
  const ledStripMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    emissive: new THREE.Color(0xe2e8f0),
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  const glassFacadeMat = new THREE.MeshPhysicalMaterial({
    color: 0x0d1726,
    transparent: true,
    opacity: 0.2,
    roughness: 0.04,
    metalness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    depthWrite: false,
  });
  const tallerFloorMat = new THREE.MeshPhysicalMaterial({
    map: textures.tallerFloor,
    roughnessMap: textures.tallerFloorRoughness,
    color: 0xffffff,
    roughness: 0.28,
    metalness: 0.16,
    clearcoat: 0.80,
    clearcoatRoughness: 0.18,
  });
  const showcaseFloorMat = new THREE.MeshPhysicalMaterial({
    map: textures.showroomFloor,
    roughnessMap: textures.showroomFloorRoughness,
    color: 0x161b24,
    roughness: 0.16,
    metalness: 0.45,
    clearcoat: 0.92,
    clearcoatRoughness: 0.1,
  });
  const bayTriggerMat = new THREE.MeshBasicMaterial({
    color: 0x2563eb,
    transparent: true,
    opacity: 0.86,
  });
  const bayFloorFillMat = new THREE.MeshBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  const plinthMat = new THREE.MeshPhysicalMaterial({
    color: 0x11151d,
    roughness: 0.22,
    metalness: 0.45,
    clearcoat: 0.85,
  });
  const plinthTrimMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    emissive: new THREE.Color(0x94a3b8),
    emissiveIntensity: 0.65,
  });
  materials.push(
    steelBlackMat,
    darkWallMat,
    liftRedMat,
    ledStripMat,
    glassFacadeMat,
    tallerFloorMat,
    showcaseFloorMat,
    bayTriggerMat,
    bayFloorFillMat,
    plinthMat,
    plinthTrimMat
  );

  // --- A) LEFT SIDE OF PARKING: TALLER DE TUNEO (3 drivable bays at x = 12.5, 17.5, 22.5, z = -23.5..-16.5) ---
  const hangarFloorGeo = new THREE.PlaneGeometry(15.6, 7.6);
  hangarFloorGeo.rotateX(-Math.PI / 2);
  const hangarRoofGeo = new THREE.BoxGeometry(15.6, 0.38, 7.6);
  const hangarBackGeo = new THREE.BoxGeometry(15.6, 4.9, 0.32);
  const hangarSideGeo = new THREE.BoxGeometry(0.32, 4.9, 7.6);
  const columnGeo = new THREE.BoxGeometry(0.28, 4.8, 0.28);
  const fasciaGeo = new THREE.BoxGeometry(15.6, 0.9, 0.28);
  const ledStripGeo = new THREE.BoxGeometry(0.18, 0.06, 5.6);
  const liftPostGeo = new THREE.BoxGeometry(0.18, 2.75, 0.22);
  const liftArmGeo = new THREE.BoxGeometry(0.75, 0.08, 0.12);
  const cartGeo = new THREE.BoxGeometry(0.85, 0.92, 0.52);
  const stackTireGeo = new THREE.TorusGeometry(0.28, 0.11, 10, 18);
  stackTireGeo.rotateX(Math.PI / 2);
  const bayZonePadGeo = new THREE.PlaneGeometry(3.2, 5.4);
  bayZonePadGeo.rotateX(-Math.PI / 2);
  const bayEdgeZGeo = new THREE.PlaneGeometry(0.08, 5.4);
  bayEdgeZGeo.rotateX(-Math.PI / 2);
  const bayEdgeXGeo = new THREE.PlaneGeometry(3.2, 0.08);
  bayEdgeXGeo.rotateX(-Math.PI / 2);

  geometries.push(
    hangarFloorGeo,
    hangarRoofGeo,
    hangarBackGeo,
    hangarSideGeo,
    columnGeo,
    fasciaGeo,
    ledStripGeo,
    liftPostGeo,
    liftArmGeo,
    cartGeo,
    stackTireGeo,
    bayZonePadGeo,
    bayEdgeZGeo,
    bayEdgeXGeo
  );

  const hangarGroup = new THREE.Group();
  parkingComplexGroup.add(hangarGroup);

  const hangarFloor = new THREE.Mesh(hangarFloorGeo, tallerFloorMat);
  hangarFloor.position.set(17.5, 0.015, -20.2);
  hangarFloor.receiveShadow = true;
  const hangarRoof = new THREE.Mesh(hangarRoofGeo, steelBlackMat);
  hangarRoof.position.set(17.5, 4.85, -20.2);
  const hangarBack = new THREE.Mesh(hangarBackGeo, darkWallMat);
  hangarBack.position.set(17.5, 2.45, -23.9);
  const hangarLeft = new THREE.Mesh(hangarSideGeo, darkWallMat);
  hangarLeft.position.set(9.85, 2.45, -20.2);
  const hangarRight = new THREE.Mesh(hangarSideGeo, darkWallMat);
  hangarRight.position.set(25.15, 2.45, -20.2);
  const hangarFascia = new THREE.Mesh(fasciaGeo, steelBlackMat);
  hangarFascia.position.set(17.5, 4.45, -16.5);
  hangarGroup.add(hangarFloor, hangarRoof, hangarBack, hangarLeft, hangarRight, hangarFascia);

  for (const cx of [10.0, 15.0, 20.0, 25.0]) {
    const col = new THREE.Mesh(columnGeo, steelBlackMat);
    col.position.set(cx, 2.4, -16.5);
    hangarGroup.add(col);
  }

  const hangarSignGeo = new THREE.PlaneGeometry(5.8, 1.35);
  const hangarSignMat = new THREE.MeshStandardMaterial({
    map: textures.hangarSign,
    emissiveMap: textures.hangarSign,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.85,
    roughness: 0.3,
  });
  const tallerWallSignGeo = new THREE.PlaneGeometry(5.4, 1.25);
  const tallerWallSignMat = new THREE.MeshStandardMaterial({
    map: textures.tallerWallSign,
    emissiveMap: textures.tallerWallSign,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.82,
    roughness: 0.32,
  });
  geometries.push(hangarSignGeo, tallerWallSignGeo);
  materials.push(hangarSignMat, tallerWallSignMat);
  const hangarSignMesh = new THREE.Mesh(hangarSignGeo, hangarSignMat);
  hangarSignMesh.position.set(17.5, 4.45, -16.34);
  const wallBackSign = new THREE.Mesh(tallerWallSignGeo, tallerWallSignMat);
  wallBackSign.position.set(17.5, 3.35, -23.72);
  const wallLeftSign = new THREE.Mesh(tallerWallSignGeo, tallerWallSignMat);
  wallLeftSign.rotation.y = Math.PI / 2;
  wallLeftSign.position.set(10.04, 3.2, -20.2);
  hangarGroup.add(hangarSignMesh, wallBackSign, wallLeftSign);

  for (const bayX of [12.5, 17.5, 22.5]) {
    for (const dx of [-1.1, 1.1]) {
      const strip = new THREE.Mesh(ledStripGeo, ledStripMat);
      strip.position.set(bayX + dx, 4.64, -20.0);
      hangarGroup.add(strip);
    }
    const padFill = new THREE.Mesh(bayZonePadGeo, bayFloorFillMat);
    padFill.position.set(bayX, 0.02, -19.8);
    const edgeL = new THREE.Mesh(bayEdgeZGeo, bayTriggerMat);
    edgeL.position.set(bayX - 1.56, 0.022, -19.8);
    const edgeR = new THREE.Mesh(bayEdgeZGeo, bayTriggerMat);
    edgeR.position.set(bayX + 1.56, 0.022, -19.8);
    const edgeFront = new THREE.Mesh(bayEdgeXGeo, bayTriggerMat);
    edgeFront.position.set(bayX, 0.022, -17.12);
    const edgeBack = new THREE.Mesh(bayEdgeXGeo, bayTriggerMat);
    edgeBack.position.set(bayX, 0.022, -22.48);
    hangarGroup.add(padFill, edgeL, edgeR, edgeFront, edgeBack);

    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(liftPostGeo, liftRedMat);
      post.position.set(bayX + side * 1.95, 1.38, -20.0);
      const arm = new THREE.Mesh(liftArmGeo, steelBlackMat);
      arm.position.set(bayX + side * 1.58, 0.28, -20.0);
      hangarGroup.add(post, arm);
    }
    const cart = new THREE.Mesh(cartGeo, liftRedMat);
    cart.position.set(bayX - 1.1, 0.46, -23.2);
    hangarGroup.add(cart);
  }

  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(stackTireGeo, darkWallMat);
    t.position.set(10.8, 0.14 + i * 0.21, -22.7);
    hangarGroup.add(t);
  }

  // --- B) RIGHT SIDE OF PARKING: WALKABLE GLASS CONCESIONARIO WITH ALL 9 CARS ---
  const dealerGroup = new THREE.Group();
  parkingComplexGroup.add(dealerGroup);

  const dealerRoofGeo = new THREE.BoxGeometry(21.2, 0.38, 28.6);
  const dealerBackGeo = new THREE.BoxGeometry(0.32, 4.9, 28.6);
  const dealerSideGeo = new THREE.BoxGeometry(21.2, 4.9, 0.32);
  const dealerFasciaGeo = new THREE.BoxGeometry(0.28, 0.9, 28.6);
  const dealerGlassWingGeo = new THREE.PlaneGeometry(10.0, 3.9);
  dealerGlassWingGeo.rotateY(-Math.PI / 2);
  const dealerPadGeo = new THREE.BoxGeometry(20.6, 0.05, 28.0);
  const dealerLedGeo = new THREE.BoxGeometry(1.4, 0.06, 4.4);
  const plinthGeo = new THREE.CylinderGeometry(2.55, 2.7, 0.1, 32);
  const plinthRingGeo = new THREE.RingGeometry(2.58, 2.7, 32);
  plinthRingGeo.rotateX(-Math.PI / 2);
  const entryStripGeo = new THREE.BoxGeometry(0.18, 0.04, 7.2);

  geometries.push(
    dealerRoofGeo,
    dealerBackGeo,
    dealerSideGeo,
    dealerFasciaGeo,
    dealerGlassWingGeo,
    dealerPadGeo,
    dealerLedGeo,
    plinthGeo,
    plinthRingGeo,
    entryStripGeo
  );

  const dealerRoof = new THREE.Mesh(dealerRoofGeo, steelBlackMat);
  dealerRoof.position.set(41.0, 4.85, -2.5);
  const dealerBack = new THREE.Mesh(dealerBackGeo, darkWallMat);
  dealerBack.position.set(51.5, 2.45, -2.5);
  const dealerNorth = new THREE.Mesh(dealerSideGeo, darkWallMat);
  dealerNorth.position.set(41.0, 2.45, -16.65);
  const dealerSouth = new THREE.Mesh(dealerSideGeo, darkWallMat);
  dealerSouth.position.set(41.0, 2.45, 11.65);
  const dealerFascia = new THREE.Mesh(dealerFasciaGeo, steelBlackMat);
  dealerFascia.position.set(30.5, 4.45, -2.5);
  const dealerPad = new THREE.Mesh(dealerPadGeo, showcaseFloorMat);
  dealerPad.position.set(41.0, 0.025, -2.5);
  dealerPad.receiveShadow = true;
  dealerGroup.add(dealerRoof, dealerBack, dealerNorth, dealerSouth, dealerFascia, dealerPad);

  for (const mz of [-16.4, -6.3, 1.3, 11.4]) {
    const mullion = new THREE.Mesh(columnGeo, steelBlackMat);
    mullion.position.set(30.5, 2.4, mz);
    dealerGroup.add(mullion);
  }
  const glassNorthWing = new THREE.Mesh(dealerGlassWingGeo, glassFacadeMat);
  glassNorthWing.position.set(30.48, 2.0, -11.35);
  const glassSouthWing = new THREE.Mesh(dealerGlassWingGeo, glassFacadeMat);
  glassSouthWing.position.set(30.48, 2.0, 6.35);
  const entryThreshold = new THREE.Mesh(entryStripGeo, ledStripMat);
  entryThreshold.position.set(30.5, 0.04, -2.5);
  dealerGroup.add(glassNorthWing, glassSouthWing, entryThreshold);

  const dealerSignGeo = new THREE.PlaneGeometry(6.8, 1.35);
  dealerSignGeo.rotateY(-Math.PI / 2);
  const dealerSignMat = new THREE.MeshStandardMaterial({
    map: textures.dealershipSign,
    emissiveMap: textures.dealershipSign,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.85,
    roughness: 0.3,
  });
  geometries.push(dealerSignGeo);
  materials.push(dealerSignMat);
  const dealerSignMesh = new THREE.Mesh(dealerSignGeo, dealerSignMat);
  dealerSignMesh.position.set(30.32, 4.45, -2.5);
  dealerGroup.add(dealerSignMesh);

  const allCatalogSpecs = Object.values(CAR_CATALOG);
  const colXs = [35.0, 41.4, 47.8];
  const rowZs = [-10.8, -2.5, 5.8];

  allCatalogSpecs.forEach((spec, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const sx = colXs[col] ?? 41.4;
    const sz = rowZs[row] ?? -2.5;

    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.set(sx, 0.05, sz);
    const ring = new THREE.Mesh(plinthRingGeo, plinthTrimMat);
    ring.position.set(sx, 0.105, sz);
    const ceilingPanel = new THREE.Mesh(dealerLedGeo, ledStripMat);
    ceilingPanel.position.set(sx, 4.64, sz);
    dealerGroup.add(plinth, ring, ceilingPanel);

    const car = buildCompositeVehicle({
      style: spec.bodyStyle,
      paintHex: spec.defaultPaint,
      rimHex: spec.defaultRim,
      underglowHex: 'none',
      textures,
      isSoftwareGl,
      isTraffic: true,
    });
    car.root.position.set(sx, 0.10, sz);
    car.root.rotation.y = Math.PI * 0.58;
    dealerGroup.add(car.root);
    showcaseEntries.push({ carId: spec.id, x: sx, z: sz, vehicle: car });
  });

  // Parking streetlamps
  const lampPostGeo = new THREE.CylinderGeometry(0.09, 0.13, 6.2, 10);
  const lampHeadGeo = new THREE.BoxGeometry(0.75, 0.12, 0.36);
  const bulbGlowMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: new THREE.Color(0xfef3c7),
    emissiveIntensity: 0.9,
  });
  geometries.push(lampPostGeo, lampHeadGeo);
  materials.push(bulbGlowMat);

  for (const [lx, lz] of [
    [12.0, 9.2],
    [27.5, 9.2],
    [27.5, -13.5],
  ]) {
    const post = new THREE.Mesh(lampPostGeo, steelBlackMat);
    post.position.set(lx, 3.1, lz);
    const head = new THREE.Mesh(lampHeadGeo, bulbGlowMat);
    head.position.set(lx, 6.18, lz);
    parkingComplexGroup.add(post, head);
  }

  if (!isSoftwareGl) {
    const parkLight1 = new THREE.PointLight(0xf8fafc, 2.4, 26, 1.45);
    parkLight1.position.set(17.5, 4.0, -19.5);
    const parkLight2 = new THREE.PointLight(0xe2e8f0, 2.9, 34, 1.35);
    parkLight2.position.set(41.4, 4.2, -2.5);
    const parkLight3 = new THREE.PointLight(0xfef3c7, 2.0, 28, 1.5);
    parkLight3.position.set(18.5, 5.8, -1.5);
    parkingComplexGroup.add(parkLight1, parkLight2, parkLight3);
  }

  // ==================== 4. INSTANCED HIGHWAY GANTRIES & OVERPASSES AROUND CLOSED LOOP ====================
  const gantrySteelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.78,
    roughness: 0.32,
  });
  const signMat1 = new THREE.MeshStandardMaterial({
    map: textures.highwaySign1,
    emissiveMap: textures.highwaySign1,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.65,
    roughness: 0.4,
  });
  const signMat2 = new THREE.MeshStandardMaterial({
    map: textures.highwaySign2,
    emissiveMap: textures.highwaySign2,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.65,
    roughness: 0.4,
  });
  materials.push(gantrySteelMat, signMat1, signMat2);

  const poleGeo = new THREE.CylinderGeometry(0.15, 0.2, 8.6, 8);
  const trussGeo = new THREE.BoxGeometry(20.0, 0.45, 0.38);
  const lampArmGeo = new THREE.BoxGeometry(1.1, 0.1, 0.35);
  const signPanelGeo = new THREE.PlaneGeometry(7.6, 1.9);
  geometries.push(poleGeo, trussGeo, lampArmGeo, signPanelGeo);

  const gantrySList: number[] = [];
  const gantrySpacing = 74;
  for (let s = 32; s < track.totalLength - 32; s += gantrySpacing) {
    if (!track.isInParkingOpening(s)) {
      gantrySList.push(s);
    }
  }

  const dummy = new THREE.Object3D();
  const sample: TrackSample = { x: 0, z: 0, tx: 0, tz: -1, rx: 1, rz: 0, yaw: 0, s: 0 };

  const polesInst = new THREE.InstancedMesh(poleGeo, gantrySteelMat, gantrySList.length * 2);
  const trussInst = new THREE.InstancedMesh(trussGeo, gantrySteelMat, gantrySList.length);
  const lampsInst = new THREE.InstancedMesh(lampArmGeo, bulbGlowMat, gantrySList.length * 2);
  const signGroup = new THREE.Group();
  group.add(polesInst, trussInst, lampsInst, signGroup);

  gantrySList.forEach((gs, i) => {
    track.sampleAtS(gs, sample);

    // Left & right poles
    dummy.rotation.set(0, sample.yaw, 0);
    dummy.scale.set(1, 1, 1);

    dummy.position.set(sample.x - sample.rx * 9.7, 4.3, sample.z - sample.rz * 9.7);
    dummy.updateMatrix();
    polesInst.setMatrixAt(i * 2, dummy.matrix);

    dummy.position.set(sample.x + sample.rx * 9.7, 4.3, sample.z + sample.rz * 9.7);
    dummy.updateMatrix();
    polesInst.setMatrixAt(i * 2 + 1, dummy.matrix);

    // Overhead truss
    dummy.position.set(sample.x, 8.2, sample.z);
    dummy.updateMatrix();
    trussInst.setMatrixAt(i, dummy.matrix);

    // Overhead lamps
    dummy.position.set(sample.x - sample.rx * 4.5, 7.9, sample.z - sample.rz * 4.5);
    dummy.updateMatrix();
    lampsInst.setMatrixAt(i * 2, dummy.matrix);

    dummy.position.set(sample.x + sample.rx * 4.5, 7.9, sample.z + sample.rz * 4.5);
    dummy.updateMatrix();
    lampsInst.setMatrixAt(i * 2 + 1, dummy.matrix);

    // Directional illuminated signage every 2nd gantry
    if (i % 2 === 0) {
      const sign = new THREE.Mesh(signPanelGeo, i % 4 === 0 ? signMat1 : signMat2);
      sign.position.set(
        sample.x + sample.rx * 3.1 - sample.tx * 0.24,
        7.75,
        sample.z + sample.rz * 3.1 - sample.tz * 0.24
      );
      sign.rotation.y = sample.yaw;
      signGroup.add(sign);
    }
  });
  polesInst.instanceMatrix.needsUpdate = true;
  trussInst.instanceMatrix.needsUpdate = true;
  lampsInst.instanceMatrix.needsUpdate = true;
  polesInst.computeBoundingSphere();
  trussInst.computeBoundingSphere();
  lampsInst.computeBoundingSphere();

  // Overpasses & Pedestrian Bridges placed smoothly perpendicular to track
  const bridgeDeckGeo = new THREE.BoxGeometry(74, 1.3, 7.5);
  const bridgePierGeo = new THREE.BoxGeometry(1.6, 9.2, 2.2);
  const pedDeckGeo = new THREE.BoxGeometry(34, 0.75, 2.8);
  const pedGlassGeo = new THREE.BoxGeometry(34, 1.35, 0.08);
  geometries.push(bridgeDeckGeo, bridgePierGeo, pedDeckGeo, pedGlassGeo);

  const overpassCount = 10;
  for (let i = 0; i < overpassCount; i++) {
    const os = track.wrapS(165 + i * (track.totalLength / overpassCount));
    if (track.isInParkingOpening(os) || track.minDistanceToTrack(19.6, -2.5) < 1) {
      // Keep clear of the immediate Parking/Taller complex (z in [-30, +25] at x=0)
    }
    track.sampleAtS(os, sample);
    if (sample.x > -35 && sample.z > -42 && sample.z < 36) continue;

    const ov = new THREE.Group();
    if (i % 2 === 1) {
      const deck = new THREE.Mesh(bridgeDeckGeo, concreteMat);
      deck.position.y = 9.4;
      const pierL = new THREE.Mesh(bridgePierGeo, concreteMat);
      pierL.position.set(-14.2, 4.6, 0);
      const pierR = new THREE.Mesh(bridgePierGeo, concreteMat);
      pierR.position.set(14.2, 4.6, 0);
      ov.add(deck, pierL, pierR);
    } else {
      const pedDeck = new THREE.Mesh(pedDeckGeo, gantrySteelMat);
      pedDeck.position.y = 6.6;
      const pedGlassF = new THREE.Mesh(pedGlassGeo, glassFacadeMat);
      pedGlassF.position.set(0, 7.6, 1.36);
      const pedGlassB = new THREE.Mesh(pedGlassGeo, glassFacadeMat);
      pedGlassB.position.set(0, 7.6, -1.36);
      const pierL = new THREE.Mesh(bridgePierGeo, concreteMat);
      pierL.scale.set(0.65, 0.72, 0.65);
      pierL.position.set(-13.2, 3.3, 0);
      const pierR = new THREE.Mesh(bridgePierGeo, concreteMat);
      pierR.scale.set(0.65, 0.72, 0.65);
      pierR.position.set(13.2, 3.3, 0);
      ov.add(pedDeck, pedGlassF, pedGlassB, pierL, pierR);
    }
    ov.position.set(sample.x, 0, sample.z);
    ov.rotation.y = sample.yaw;
    group.add(ov);
  }

  // ==================== 5. INSTANCED MODERN METROPOLIS SKYLINE AROUND LOOP ====================
  const towerGlassMat = new THREE.MeshPhysicalMaterial({
    map: textures.skyscraperFacade,
    roughnessMap: textures.skyscraperRoughness,
    emissiveMap: textures.skyscraperEmissive,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.75,
    color: 0x94a3b8,
    roughness: 0.24,
    metalness: 0.68,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
  });

  const towerConcreteMat = new THREE.MeshPhysicalMaterial({
    map: textures.skyscraperFacade,
    emissiveMap: textures.skyscraperEmissive,
    emissive: new THREE.Color(0xffe8c2),
    emissiveIntensity: 0.55,
    color: 0x475569,
    roughness: 0.58,
    metalness: 0.28,
  });

  const crownWarmMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: new THREE.Color(0xfbbf24),
    emissiveIntensity: 0.9,
  });
  const crownCoolMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    emissive: new THREE.Color(0x93c5fd),
    emissiveIntensity: 0.85,
  });
  materials.push(towerGlassMat, towerConcreteMat, crownWarmMat, crownCoolMat);

  interface TowerPlacement {
    x: number;
    z: number;
    w: number;
    h: number;
    d: number;
    yaw: number;
    tier: 'core' | 'dense';
    isGlass: boolean;
    isWarmCrown: boolean;
  }

  const placements: TowerPlacement[] = [];
  const buildingStepS = 38;
  let bIdx = 0;

  for (let s = 0; s < track.totalLength; s += buildingStepS) {
    track.sampleAtS(s, sample);
    for (const side of [-1, 1] as const) {
      bIdx++;
      const w = 13 + (bIdx % 4) * 3.8;
      const d = 13 + ((bIdx * 3) % 4) * 3.6;
      const h = 30 + ((bIdx * 23) % 72) + (bIdx % 3 === 0 ? 22 : 0);
      const layer = bIdx % 3;
      const offsetDist = 23 + (w + d) * 0.38 + layer * 22 + ((bIdx * 7) % 10);

      const tx = sample.x + sample.rx * side * offsetDist;
      const tz = sample.z + sample.rz * side * offsetDist;

      // Guarantee zero overlap with ANY loop road segment AND Parking/Taller/Concesionario complex
      const minTrackDist = track.minDistanceToTrack(tx, tz);
      const radius = Math.hypot(w, d) * 0.55 + 14;
      if (minTrackDist < radius) continue;

      const inComplex = tx > 4 && tx < 62 && tz > -34 && tz < 22;
      if (inComplex) continue;

      placements.push({
        x: tx,
        z: tz,
        w,
        h,
        d,
        yaw: sample.yaw,
        tier: layer === 2 ? 'dense' : 'core',
        isGlass: bIdx % 3 !== 0,
        isWarmCrown: bIdx % 2 === 1,
      });
    }
  }

  // Sort core placements before dense placements so LOW/MEDIUM LOD simply slices instance count!
  placements.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'core' ? -1 : 1));
  const coreTowerCount = placements.filter((p) => p.tier === 'core').length;
  const lowTowerCount = Math.max(24, Math.floor(coreTowerCount * 0.65));

  const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  geometries.push(unitBoxGeo);

  const glassPlacements = placements.filter((p) => p.isGlass);
  const concretePlacements = placements.filter((p) => !p.isGlass);
  const warmPlacements = placements.filter((p) => p.isWarmCrown);
  const coolPlacements = placements.filter((p) => !p.isWarmCrown);

  const podiumInst = new THREE.InstancedMesh(unitBoxGeo, darkWallMat, placements.length);
  const glassInst = new THREE.InstancedMesh(unitBoxGeo, towerGlassMat, glassPlacements.length);
  const concInst = new THREE.InstancedMesh(unitBoxGeo, towerConcreteMat, concretePlacements.length);
  const warmCrownInst = new THREE.InstancedMesh(unitBoxGeo, crownWarmMat, warmPlacements.length);
  const coolCrownInst = new THREE.InstancedMesh(unitBoxGeo, crownCoolMat, coolPlacements.length);

  group.add(podiumInst, glassInst, concInst, warmCrownInst, coolCrownInst);

  placements.forEach((p, idx) => {
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(p.w + 2.4, 7.5, p.d + 2.4);
    dummy.position.set(p.x, 3.7, p.z);
    dummy.updateMatrix();
    podiumInst.setMatrixAt(idx, dummy.matrix);
  });

  glassPlacements.forEach((p, idx) => {
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(p.w, p.h, p.d);
    dummy.position.set(p.x, p.h * 0.5 - 0.05, p.z);
    dummy.updateMatrix();
    glassInst.setMatrixAt(idx, dummy.matrix);
  });

  concretePlacements.forEach((p, idx) => {
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(p.w, p.h, p.d);
    dummy.position.set(p.x, p.h * 0.5 - 0.05, p.z);
    dummy.updateMatrix();
    concInst.setMatrixAt(idx, dummy.matrix);
  });

  warmPlacements.forEach((p, idx) => {
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(p.w + 0.3, 0.45, p.d + 0.3);
    dummy.position.set(p.x, p.h + 0.18, p.z);
    dummy.updateMatrix();
    warmCrownInst.setMatrixAt(idx, dummy.matrix);
  });

  coolPlacements.forEach((p, idx) => {
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(p.w + 0.3, 0.45, p.d + 0.3);
    dummy.position.set(p.x, p.h + 0.18, p.z);
    dummy.updateMatrix();
    coolCrownInst.setMatrixAt(idx, dummy.matrix);
  });

  for (const inst of [podiumInst, glassInst, concInst, warmCrownInst, coolCrownInst]) {
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
  }

  // ==================== 6. HIGH-SPEED 3D RAIN STREAKS ====================
  const rainCount = isSoftwareGl ? 320 : 800;
  const rainPositions = new Float32Array(rainCount * 6);
  for (let i = 0; i < rainCount; i++) {
    const x = (Math.random() - 0.5) * 32;
    const y = Math.random() * 14;
    const z = (Math.random() - 0.5) * 48;
    const idx = i * 6;
    rainPositions[idx] = x;
    rainPositions[idx + 1] = y;
    rainPositions[idx + 2] = z;
    rainPositions[idx + 3] = x - 0.08;
    rainPositions[idx + 4] = y + 0.75;
    rainPositions[idx + 5] = z + 0.55;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  geometries.push(rainGeo);

  const rainMat = new THREE.LineBasicMaterial({
    color: 0xbae6fd,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  materials.push(rainMat);

  const rainSystem = new THREE.LineSegments(rainGeo, rainMat);
  rainSystem.frustumCulled = false;
  rainSystem.visible = false;
  group.add(rainSystem);

  // ==================== 7. LIGHTING ====================
  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0b0f17, 0.72);
  group.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xcbd5e1, 0.92);
  keyLight.position.set(22, 34, 18);
  if (!isSoftwareGl) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 90;
    keyLight.shadow.camera.left = -28;
    keyLight.shadow.camera.right = 28;
    keyLight.shadow.camera.top = 28;
    keyLight.shadow.camera.bottom = -28;
    keyLight.shadow.bias = -0.0005;
  }
  group.add(keyLight);

  return {
    group,
    parkingComplexGroup,
    track,
    showcaseEntries,
    asphaltMat,
    roadMesh,
    cityGround,
    rainSystem,
    rainPositions,
    rainCount,
    hemiLight,
    keyLight,
    setAtmosphere: (weather: WeatherMode, scene: THREE.Scene) => {
      const isStorm = weather === 'STORM';
      const isSunset = weather === 'SUNSET';
      rainSystem.visible = isStorm;

      if (isStorm) {
        const fogHex = 0x070c16;
        scene.background = new THREE.Color(fogHex);
        (scene.fog as THREE.FogExp2).color.setHex(fogHex);
        (scene.fog as THREE.FogExp2).density = 0.0058;

        hemiLight.color.setHex(0x64748b);
        hemiLight.groundColor.setHex(0x070a10);
        hemiLight.intensity = 0.65;
        keyLight.color.setHex(0x93c5fd);
        keyLight.intensity = 0.82;

        asphaltMat.roughness = 0.14;
        asphaltMat.metalness = 0.55;
        asphaltMat.clearcoat = 1.0;
        asphaltMat.clearcoatRoughness = 0.08;
        asphaltMat.envMapIntensity = 1.9;
        asphaltMat.color.setHex(0x1a202c);

        parkPadMat.roughness = 0.18;
        parkPadMat.clearcoat = 0.95;
      } else if (isSunset) {
        const fogHex = 0x1a131f;
        scene.background = new THREE.Color(fogHex);
        (scene.fog as THREE.FogExp2).color.setHex(fogHex);
        (scene.fog as THREE.FogExp2).density = 0.0040;

        hemiLight.color.setHex(0xfdba74);
        hemiLight.groundColor.setHex(0x181320);
        hemiLight.intensity = 0.82;
        keyLight.color.setHex(0xffb478);
        keyLight.intensity = 1.25;

        asphaltMat.roughness = 0.68;
        asphaltMat.metalness = 0.2;
        asphaltMat.clearcoat = 0.24;
        asphaltMat.clearcoatRoughness = 0.3;
        asphaltMat.envMapIntensity = 1.0;
        asphaltMat.color.setHex(0x2d323e);

        parkPadMat.roughness = 0.62;
        parkPadMat.clearcoat = 0.25;
      } else {
        const fogHex = 0x050811;
        scene.background = new THREE.Color(fogHex);
        (scene.fog as THREE.FogExp2).color.setHex(fogHex);
        (scene.fog as THREE.FogExp2).density = 0.0042;

        hemiLight.color.setHex(0x93c5fd);
        hemiLight.groundColor.setHex(0x0b0f17);
        hemiLight.intensity = 0.7;
        keyLight.color.setHex(0xdbeafe);
        keyLight.intensity = 0.88;

        asphaltMat.roughness = 0.72;
        asphaltMat.metalness = 0.16;
        asphaltMat.clearcoat = 0.18;
        asphaltMat.clearcoatRoughness = 0.35;
        asphaltMat.envMapIntensity = 0.85;
        asphaltMat.color.setHex(0x2c3340);

        parkPadMat.roughness = 0.68;
        parkPadMat.clearcoat = 0.22;
      }
      asphaltMat.needsUpdate = true;
      parkPadMat.needsUpdate = true;
    },
    setQuality: (quality: GraphicsQuality) => {
      const ratio = quality === 'LOW' ? lowTowerCount / placements.length : quality === 'MEDIUM' ? coreTowerCount / placements.length : 1;
      podiumInst.count = Math.max(1, Math.round(placements.length * ratio));
      glassInst.count = Math.max(1, Math.round(glassPlacements.length * ratio));
      concInst.count = Math.max(1, Math.round(concretePlacements.length * ratio));
      warmCrownInst.count = Math.max(1, Math.round(warmPlacements.length * ratio));
      coolCrownInst.count = Math.max(1, Math.round(coolPlacements.length * ratio));
    },
    updateScroll: (
      anchorX: number,
      anchorZ: number,
      speedMs: number,
      dt: number,
      isStorm: boolean,
      inParking: boolean
    ) => {
      if (isStorm) {
        const rainAnchorX = inParking ? 22 : anchorX;
        const rainAnchorZ = inParking ? -2 : anchorZ;
        rainSystem.position.set(rainAnchorX, 0, rainAnchorZ);
        const dropSpeed = 24;
        const streakZ = Math.min(2.2, 0.35 + speedMs * 0.025);
        for (let i = 0; i < rainCount; i++) {
          const idx = i * 6;
          rainPositions[idx + 1] -= dropSpeed * dt;
          rainPositions[idx + 4] = rainPositions[idx + 1] + 0.82;
          rainPositions[idx + 5] = rainPositions[idx + 2] + streakZ;
          if (rainPositions[idx + 1] < 0) {
            const nx = (Math.random() - 0.5) * 32;
            const ny = 12 + Math.random() * 4;
            const nz = (Math.random() - 0.5) * 44;
            rainPositions[idx] = nx;
            rainPositions[idx + 1] = ny;
            rainPositions[idx + 2] = nz;
            rainPositions[idx + 3] = nx - 0.08;
            rainPositions[idx + 4] = ny + 0.82;
            rainPositions[idx + 5] = nz + streakZ;
          }
        }
        (rainSystem.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
    },
    dispose: () => {
      showcaseEntries.forEach((c) => c.vehicle.dispose());
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
