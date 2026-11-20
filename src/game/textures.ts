import * as THREE from 'three';

export interface ProceduralTextureSet {
  carbon: THREE.CanvasTexture;
  carbonBump: THREE.CanvasTexture;
  carbonRoughness: THREE.CanvasTexture;
  asphalt: THREE.CanvasTexture;
  asphaltBump: THREE.CanvasTexture;
  asphaltRoughness: THREE.CanvasTexture;
  parkingAsphalt: THREE.CanvasTexture;
  crosswalkRoad: THREE.CanvasTexture;
  tallerFloor: THREE.CanvasTexture;
  tallerFloorRoughness: THREE.CanvasTexture;
  showroomFloor: THREE.CanvasTexture;
  showroomFloorRoughness: THREE.CanvasTexture;
  underglowRadial: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  skyscraperFacade: THREE.CanvasTexture;
  skyscraperEmissive: THREE.CanvasTexture;
  skyscraperRoughness: THREE.CanvasTexture;
  concreteBarrier: THREE.CanvasTexture;
  highwaySign1: THREE.CanvasTexture;
  highwaySign2: THREE.CanvasTexture;
  hangarSign: THREE.CanvasTexture;
  tallerWallSign: THREE.CanvasTexture;
  dealershipSign: THREE.CanvasTexture;
  dispose: () => void;
}

export function createLicensePlateTexture(rawText: string): THREE.CanvasTexture {
  const clean = (rawText || 'GSTDVR')
    .toUpperCase()
    .replace(/[^A-Z0-9- ]/g, '')
    .slice(0, 8) || 'GSTDVR';
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  // White/brushed metal plate background
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, 512, 160);

  // Dark perimeter frame
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 150);

  // Left blue motorsport/JDM-EU band
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(10, 10, 56, 140);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 22px "Barlow Condensed", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WG', 38, 62);
  ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('JP', 38, 104);

  // Top subtle red accent bar
  ctx.fillStyle = '#e10600';
  ctx.fillRect(74, 16, 422, 6);

  // Main embossed plate characters
  ctx.fillStyle = '#090d14';
  ctx.font = '800 84px "Barlow Condensed", "Consolas", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(clean, 286, 92);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSignTexture(title: string, subtitle: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, 1024, 256);

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 1008, 240);

  ctx.fillStyle = accent;
  ctx.fillRect(36, 48, 12, 160);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 72px "Barlow Condensed", "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 74, 108);

  ctx.fillStyle = 'rgba(226,232,240,0.72)';
  ctx.font = '500 28px "Plus Jakarta Sans", "Segoe UI", sans-serif';
  ctx.fillText(subtitle, 76, 180);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createExpresswaySignTexture(
  routeCode: string,
  routeColor: string,
  line1: string,
  line2: string
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#092e20';
  ctx.fillRect(0, 0, 1024, 256);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 1004, 236);

  ctx.fillStyle = routeColor;
  ctx.fillRect(34, 46, 130, 164);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.strokeRect(34, 46, 130, 164);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 74px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(routeCode, 99, 130);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 62px "Barlow Condensed", sans-serif';
  ctx.fillText(line1, 198, 96);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '500 34px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(line2, 198, 174);

  ctx.fillStyle = '#f8fafc';
  for (const ax of [840, 935]) {
    ctx.beginPath();
    ctx.moveTo(ax, 196);
    ctx.lineTo(ax - 22, 152);
    ctx.lineTo(ax - 8, 152);
    ctx.lineTo(ax - 8, 70);
    ctx.lineTo(ax + 8, 70);
    ctx.lineTo(ax + 8, 152);
    ctx.lineTo(ax + 22, 152);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));

  // 1. 1024x1024 Woven 2x2 Twill Carbon Fiber (Albedo + Bump + Roughness)
  const carbonCanvas = document.createElement('canvas');
  carbonCanvas.width = 1024;
  carbonCanvas.height = 1024;
  const cCtx = carbonCanvas.getContext('2d')!;

  const carbonBumpCanvas = document.createElement('canvas');
  carbonBumpCanvas.width = 1024;
  carbonBumpCanvas.height = 1024;
  const cbCtx = carbonBumpCanvas.getContext('2d')!;

  const carbonRoughCanvas = document.createElement('canvas');
  carbonRoughCanvas.width = 1024;
  carbonRoughCanvas.height = 1024;
  const crCtx = carbonRoughCanvas.getContext('2d')!;

  cCtx.fillStyle = '#0c0e13';
  cCtx.fillRect(0, 0, 1024, 1024);
  cbCtx.fillStyle = '#606060';
  cbCtx.fillRect(0, 0, 1024, 1024);
  crCtx.fillStyle = '#787878';
  crCtx.fillRect(0, 0, 1024, 1024);

  const cell = 16;
  for (let y = 0; y < 1024; y += cell) {
    for (let x = 0; x < 1024; x += cell) {
      const ix = (x / cell) | 0;
      const iy = (y / cell) | 0;
      const phase = (ix + iy) % 4;
      if (phase < 2) {
        // Horizontal fiber tow
        const g = cCtx.createLinearGradient(x, y, x + cell, y);
        g.addColorStop(0, '#141821');
        g.addColorStop(0.5, '#2b313f');
        g.addColorStop(1, '#141821');
        cCtx.fillStyle = g;
        cCtx.fillRect(x + 1, y + 1, cell - 2, cell - 2);

        cbCtx.fillStyle = '#c8c8c8';
        cbCtx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
        crCtx.fillStyle = '#383838';
        crCtx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      } else {
        // Vertical fiber tow
        const g = cCtx.createLinearGradient(x, y, x, y + cell);
        g.addColorStop(0, '#0f1219');
        g.addColorStop(0.5, '#202633');
        g.addColorStop(1, '#0f1219');
        cCtx.fillStyle = g;
        cCtx.fillRect(x + 1, y + 1, cell - 2, cell - 2);

        cbCtx.fillStyle = '#9a9a9a';
        cbCtx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
        crCtx.fillStyle = '#525252';
        crCtx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      }
    }
  }

  const carbon = new THREE.CanvasTexture(carbonCanvas);
  carbon.colorSpace = THREE.SRGBColorSpace;
  carbon.wrapS = THREE.RepeatWrapping;
  carbon.wrapT = THREE.RepeatWrapping;
  carbon.repeat.set(8, 8);
  carbon.anisotropy = aniso;

  const carbonBump = new THREE.CanvasTexture(carbonBumpCanvas);
  carbonBump.wrapS = THREE.RepeatWrapping;
  carbonBump.wrapT = THREE.RepeatWrapping;
  carbonBump.repeat.set(8, 8);
  carbonBump.anisotropy = aniso;

  const carbonRoughness = new THREE.CanvasTexture(carbonRoughCanvas);
  carbonRoughness.wrapS = THREE.RepeatWrapping;
  carbonRoughness.wrapT = THREE.RepeatWrapping;
  carbonRoughness.repeat.set(8, 8);
  carbonRoughness.anisotropy = aniso;

  // 2. 1024x1024 Realistic Granular Expressway Asphalt + Rubber Skid Marks (Albedo, Bump, Roughness)
  const aspCanvas = document.createElement('canvas');
  aspCanvas.width = 1024;
  aspCanvas.height = 1024;
  const aCtx = aspCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 1024;
  bumpCanvas.height = 1024;
  const bCtx = bumpCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 1024;
  roughCanvas.height = 1024;
  const rCtx = roughCanvas.getContext('2d')!;

  aCtx.fillStyle = '#141820';
  aCtx.fillRect(0, 0, 1024, 1024);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, 1024, 1024);
  rCtx.fillStyle = '#cfcfcf';
  rCtx.fillRect(0, 0, 1024, 1024);

  // Polished tire tracks & subtle rubber deposits along the 4 lanes
  for (const laneCenter of [144, 380, 644, 880]) {
    for (const wheelOffset of [-34, 34]) {
      const wx = laneCenter + wheelOffset;
      const grad = aCtx.createLinearGradient(wx - 28, 0, wx + 28, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, 'rgba(6,8,12,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      aCtx.fillStyle = grad;
      aCtx.fillRect(wx - 28, 0, 56, 1024);

      const rGrad = rCtx.createLinearGradient(wx - 26, 0, wx + 26, 0);
      rGrad.addColorStop(0, 'rgba(180,180,180,0)');
      rGrad.addColorStop(0.5, 'rgba(72,72,72,0.72)');
      rGrad.addColorStop(1, 'rgba(180,180,180,0)');
      rCtx.fillStyle = rGrad;
      rCtx.fillRect(wx - 26, 0, 52, 1024);
    }
  }

  // Asphalt mineral aggregate & micro-grain across 1024x1024
  for (let i = 0; i < 42000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const sz = i % 7 === 0 ? 3 : 2;
    aCtx.fillStyle =
      i % 3 === 0
        ? 'rgba(255,255,255,0.042)'
        : i % 3 === 1
          ? 'rgba(0,0,0,0.28)'
          : 'rgba(120,132,152,0.05)';
    aCtx.fillRect(x, y, sz, sz);

    const bv = 78 + Math.floor(Math.random() * 112);
    bCtx.fillStyle = `rgb(${bv},${bv},${bv})`;
    bCtx.fillRect(x, y, sz, sz);
  }

  // Subtle longitudinal rubber skid streaks
  for (let i = 0; i < 45; i++) {
    const sx = 80 + Math.random() * 860;
    const sy = Math.random() * 1024;
    const len = 40 + Math.random() * 180;
    aCtx.fillStyle = 'rgba(4,5,8,0.34)';
    aCtx.fillRect(sx, sy, 4 + Math.random() * 4, len);
  }

  // Subtle roughness streaks for realistic road sheen
  for (let i = 0; i < 8000; i++) {
    const v = 130 + Math.floor(Math.random() * 96);
    rCtx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    rCtx.fillRect(Math.random() * 1024, Math.random() * 1024, 4, 14);
  }

  // Crisp highway painted edge lines & lane dividers
  aCtx.fillStyle = '#dce2ec';
  aCtx.fillRect(28, 0, 12, 1024);
  aCtx.fillRect(984, 0, 12, 1024);

  aCtx.fillStyle = '#e2e8f0';
  for (let y = 32; y < 1024; y += 256) {
    aCtx.fillRect(264, y, 10, 136);
    aCtx.fillRect(750, y, 10, 136);
  }

  // Double amber median
  aCtx.fillStyle = '#d97706';
  aCtx.fillRect(496, 0, 10, 1024);
  aCtx.fillRect(518, 0, 10, 1024);

  // Paint markings slightly smoother in roughness map
  rCtx.fillStyle = '#8a8a8a';
  rCtx.fillRect(28, 0, 12, 1024);
  rCtx.fillRect(984, 0, 12, 1024);

  const asphalt = new THREE.CanvasTexture(aspCanvas);
  asphalt.colorSpace = THREE.SRGBColorSpace;
  asphalt.wrapS = THREE.RepeatWrapping;
  asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.anisotropy = aniso;

  const asphaltBump = new THREE.CanvasTexture(bumpCanvas);
  asphaltBump.wrapS = THREE.RepeatWrapping;
  asphaltBump.wrapT = THREE.RepeatWrapping;
  asphaltBump.anisotropy = aniso;

  const asphaltRoughness = new THREE.CanvasTexture(roughCanvas);
  asphaltRoughness.wrapS = THREE.RepeatWrapping;
  asphaltRoughness.wrapT = THREE.RepeatWrapping;
  asphaltRoughness.anisotropy = aniso;

  // 3. 1024x1024 Parking Forecourt & Access Road Asphalt
  const parkCanvas = document.createElement('canvas');
  parkCanvas.width = 1024;
  parkCanvas.height = 1024;
  const pCtx = parkCanvas.getContext('2d')!;
  pCtx.fillStyle = '#171b23';
  pCtx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 22000; i++) {
    pCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.028)' : 'rgba(0,0,0,0.22)';
    pCtx.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
  }
  pCtx.strokeStyle = 'rgba(255,255,255,0.06)';
  pCtx.lineWidth = 3;
  for (let x = 0; x <= 1024; x += 128) {
    pCtx.beginPath();
    pCtx.moveTo(x, 0);
    pCtx.lineTo(x, 1024);
    pCtx.stroke();
  }
  for (let y = 0; y <= 1024; y += 128) {
    pCtx.beginPath();
    pCtx.moveTo(0, y);
    pCtx.lineTo(1024, y);
    pCtx.stroke();
  }
  // Crisp parking stalls
  pCtx.fillStyle = 'rgba(226,232,240,0.62)';
  for (let x = 110; x < 920; x += 176) {
    pCtx.fillRect(x, 42, 8, 196);
    pCtx.fillRect(x, 786, 8, 196);
  }
  // Access road directional arrows pointing LEFT (toward Highway x = 9.0)
  pCtx.fillStyle = 'rgba(245,158,11,0.58)';
  pCtx.fillRect(0, 498, 1024, 6);
  pCtx.fillStyle = 'rgba(226,232,240,0.68)';
  for (const ax of [120, 340, 560]) {
    pCtx.beginPath();
    pCtx.moveTo(ax, 456);
    pCtx.lineTo(ax + 48, 428);
    pCtx.lineTo(ax + 48, 444);
    pCtx.lineTo(ax + 128, 444);
    pCtx.lineTo(ax + 128, 468);
    pCtx.lineTo(ax + 48, 468);
    pCtx.lineTo(ax + 48, 484);
    pCtx.closePath();
    pCtx.fill();
  }

  const parkingAsphalt = new THREE.CanvasTexture(parkCanvas);
  parkingAsphalt.colorSpace = THREE.SRGBColorSpace;
  parkingAsphalt.anisotropy = aniso;

  // 3b. 1024x1024 Direct Access Street & Crosswalk (Paso de Cebra) Connector Texture
  const cwCanvas = document.createElement('canvas');
  cwCanvas.width = 1024;
  cwCanvas.height = 1024;
  const cwCtx = cwCanvas.getContext('2d')!;
  cwCtx.fillStyle = '#181c24';
  cwCtx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 16000; i++) {
    cwCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.032)' : 'rgba(0,0,0,0.22)';
    cwCtx.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
  }
  // Yellow center divider line running east-west (along X)
  cwCtx.fillStyle = 'rgba(245,158,11,0.85)';
  cwCtx.fillRect(0, 502, 1024, 8);
  cwCtx.fillRect(0, 514, 1024, 8);
  // Wide white pedestrian crosswalk stripes ("Paso de Cebra") along x = 260..500
  cwCtx.fillStyle = 'rgba(241,245,249,0.88)';
  for (let y = 52; y < 980; y += 92) {
    cwCtx.fillRect(260, y, 220, 52);
  }
  // Stop bars & crisp exit arrows toward Highway
  cwCtx.fillStyle = 'rgba(241,245,249,0.75)';
  cwCtx.fillRect(540, 48, 22, 420);
  cwCtx.fillRect(190, 556, 22, 420);
  for (const [ay, dir] of [
    [260, -1],
    [760, 1],
  ] as const) {
    cwCtx.beginPath();
    if (dir < 0) {
      cwCtx.moveTo(640, ay);
      cwCtx.lineTo(720, ay - 38);
      cwCtx.lineTo(720, ay - 16);
      cwCtx.lineTo(880, ay - 16);
      cwCtx.lineTo(880, ay + 16);
      cwCtx.lineTo(720, ay + 16);
      cwCtx.lineTo(720, ay + 38);
    } else {
      cwCtx.moveTo(880, ay);
      cwCtx.lineTo(800, ay - 38);
      cwCtx.lineTo(800, ay - 16);
      cwCtx.lineTo(640, ay - 16);
      cwCtx.lineTo(640, ay + 16);
      cwCtx.lineTo(800, ay + 16);
      cwCtx.lineTo(800, ay + 38);
    }
    cwCtx.closePath();
    cwCtx.fill();
  }
  const crosswalkRoad = new THREE.CanvasTexture(cwCanvas);
  crosswalkRoad.colorSpace = THREE.SRGBColorSpace;
  crosswalkRoad.anisotropy = aniso;

  // 4. 1024x1024 Clean Light-Gray Industrial Epoxy Floor with Crisp Blue Lines (Taller de Personalización)
  const tallerCanvas = document.createElement('canvas');
  tallerCanvas.width = 1024;
  tallerCanvas.height = 1024;
  const tCtx = tallerCanvas.getContext('2d')!;

  const tallerRoughCanvas = document.createElement('canvas');
  tallerRoughCanvas.width = 1024;
  tallerRoughCanvas.height = 1024;
  const trCtx = tallerRoughCanvas.getContext('2d')!;

  tCtx.fillStyle = '#bcc6d4';
  tCtx.fillRect(0, 0, 1024, 1024);
  trCtx.fillStyle = '#363636'; // glossy polished epoxy resin base
  trCtx.fillRect(0, 0, 1024, 1024);

  // Fine mineral epoxy speckle
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    tCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(51,65,85,0.10)';
    tCtx.fillRect(x, y, 2, 2);
    const rv = 36 + Math.floor(Math.random() * 38);
    trCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
    trCtx.fillRect(x, y, 3, 3);
  }
  // Expansion joint grid + matte seams
  tCtx.strokeStyle = 'rgba(71,85,105,0.28)';
  tCtx.lineWidth = 3;
  trCtx.strokeStyle = '#909090';
  trCtx.lineWidth = 4;
  for (let g = 0; g <= 1024; g += 256) {
    tCtx.beginPath();
    tCtx.moveTo(g, 0);
    tCtx.lineTo(g, 1024);
    tCtx.stroke();
    tCtx.beginPath();
    tCtx.moveTo(0, g);
    tCtx.lineTo(1024, g);
    tCtx.stroke();

    trCtx.beginPath();
    trCtx.moveTo(g, 0);
    trCtx.lineTo(g, 1024);
    trCtx.stroke();
    trCtx.beginPath();
    trCtx.moveTo(0, g);
    trCtx.lineTo(1024, g);
    trCtx.stroke();
  }
  // Crisp blue safety/bay guide stripes ("líneas azules")
  tCtx.fillStyle = '#2563eb';
  tCtx.fillRect(0, 38, 1024, 22);
  tCtx.fillRect(0, 964, 1024, 22);
  tCtx.fillRect(42, 0, 18, 1024);
  tCtx.fillRect(964, 0, 18, 1024);
  tCtx.fillStyle = 'rgba(37,99,235,0.32)';
  tCtx.fillRect(0, 504, 1024, 16);

  const tallerFloor = new THREE.CanvasTexture(tallerCanvas);
  tallerFloor.colorSpace = THREE.SRGBColorSpace;
  tallerFloor.wrapS = THREE.RepeatWrapping;
  tallerFloor.wrapT = THREE.RepeatWrapping;
  tallerFloor.repeat.set(3, 1);
  tallerFloor.anisotropy = aniso;

  const tallerFloorRoughness = new THREE.CanvasTexture(tallerRoughCanvas);
  tallerFloorRoughness.wrapS = THREE.RepeatWrapping;
  tallerFloorRoughness.wrapT = THREE.RepeatWrapping;
  tallerFloorRoughness.repeat.set(3, 1);
  tallerFloorRoughness.anisotropy = aniso;

  // 5. 1024x1024 Polished Architectural Porcelain Floor (Concesionario)
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 1024;
  floorCanvas.height = 1024;
  const fCtx = floorCanvas.getContext('2d')!;

  const floorRoughCanvas = document.createElement('canvas');
  floorRoughCanvas.width = 1024;
  floorRoughCanvas.height = 1024;
  const frCtx = floorRoughCanvas.getContext('2d')!;

  fCtx.fillStyle = '#0c1017';
  fCtx.fillRect(0, 0, 1024, 1024);
  frCtx.fillStyle = '#202020'; // mirror-polished porcelain tiles
  frCtx.fillRect(0, 0, 1024, 1024);

  // Subtle natural stone/porcelain veining inside each 256x256 slab
  for (let ty = 0; ty < 1024; ty += 256) {
    for (let tx = 0; tx < 1024; tx += 256) {
      const shade = 14 + (((tx + ty) / 256) % 3) * 3;
      fCtx.fillStyle = `rgb(${shade},${shade + 4},${shade + 10})`;
      fCtx.fillRect(tx + 3, ty + 3, 250, 250);
      fCtx.strokeStyle = 'rgba(226,232,240,0.035)';
      fCtx.lineWidth = 2;
      fCtx.beginPath();
      fCtx.moveTo(tx + 24, ty + 210);
      fCtx.bezierCurveTo(tx + 96, ty + 140, tx + 160, ty + 180, tx + 230, ty + 60);
      fCtx.stroke();
    }
  }
  // Grout seams
  fCtx.strokeStyle = 'rgba(255,255,255,0.065)';
  fCtx.lineWidth = 3;
  frCtx.strokeStyle = '#909090';
  frCtx.lineWidth = 4;
  for (let g = 0; g <= 1024; g += 256) {
    fCtx.beginPath();
    fCtx.moveTo(g, 0);
    fCtx.lineTo(g, 1024);
    fCtx.stroke();
    fCtx.beginPath();
    fCtx.moveTo(0, g);
    fCtx.lineTo(1024, g);
    fCtx.stroke();

    frCtx.beginPath();
    frCtx.moveTo(g, 0);
    frCtx.lineTo(g, 1024);
    frCtx.stroke();
    frCtx.beginPath();
    frCtx.moveTo(0, g);
    frCtx.lineTo(1024, g);
    frCtx.stroke();
  }

  const showroomFloor = new THREE.CanvasTexture(floorCanvas);
  showroomFloor.colorSpace = THREE.SRGBColorSpace;
  showroomFloor.wrapS = THREE.RepeatWrapping;
  showroomFloor.wrapT = THREE.RepeatWrapping;
  showroomFloor.repeat.set(5, 6);
  showroomFloor.anisotropy = aniso;

  const showroomFloorRoughness = new THREE.CanvasTexture(floorRoughCanvas);
  showroomFloorRoughness.wrapS = THREE.RepeatWrapping;
  showroomFloorRoughness.wrapT = THREE.RepeatWrapping;
  showroomFloorRoughness.repeat.set(5, 6);
  showroomFloorRoughness.anisotropy = aniso;

  // 6. Radial Underglow & Contact Shadow
  const ugCanvas = document.createElement('canvas');
  ugCanvas.width = 256;
  ugCanvas.height = 256;
  const uCtx = ugCanvas.getContext('2d')!;
  const ugGrad = uCtx.createRadialGradient(128, 128, 14, 128, 128, 126);
  ugGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
  ugGrad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  ugGrad.addColorStop(1, 'rgba(255,255,255,0)');
  uCtx.fillStyle = ugGrad;
  uCtx.fillRect(0, 0, 256, 256);
  const underglowRadial = new THREE.CanvasTexture(ugCanvas);
  underglowRadial.colorSpace = THREE.SRGBColorSpace;

  const csCanvas = document.createElement('canvas');
  csCanvas.width = 256;
  csCanvas.height = 256;
  const csCtx = csCanvas.getContext('2d')!;
  const csGrad = csCtx.createRadialGradient(128, 128, 20, 128, 128, 124);
  csGrad.addColorStop(0, 'rgba(0,0,0,0.85)');
  csGrad.addColorStop(0.55, 'rgba(0,0,0,0.48)');
  csGrad.addColorStop(1, 'rgba(0,0,0,0)');
  csCtx.fillStyle = csGrad;
  csCtx.fillRect(0, 0, 256, 256);
  const contactShadow = new THREE.CanvasTexture(csCanvas);

  // 7. 1024x1024 Modern Architectural Glass Curtain-Wall Skyscraper Maps
  const skyDiffCanvas = document.createElement('canvas');
  skyDiffCanvas.width = 1024;
  skyDiffCanvas.height = 1024;
  const sdCtx = skyDiffCanvas.getContext('2d')!;

  const skyEmisCanvas = document.createElement('canvas');
  skyEmisCanvas.width = 1024;
  skyEmisCanvas.height = 1024;
  const seCtx = skyEmisCanvas.getContext('2d')!;

  const skyRoughCanvas = document.createElement('canvas');
  skyRoughCanvas.width = 1024;
  skyRoughCanvas.height = 1024;
  const srCtx = skyRoughCanvas.getContext('2d')!;

  sdCtx.fillStyle = '#0c1118';
  sdCtx.fillRect(0, 0, 1024, 1024);
  seCtx.fillStyle = '#000000';
  seCtx.fillRect(0, 0, 1024, 1024);
  srCtx.fillStyle = '#999999';
  srCtx.fillRect(0, 0, 1024, 1024);

  const cols = 16;
  const rows = 32;
  const cellW = 1024 / cols;
  const cellH = 1024 / rows;

  for (let r = 0; r < rows; r++) {
    const floorLitRatio = 0.25 + ((r * 7) % 10) * 0.048;
    for (let c = 0; c < cols; c++) {
      const px = c * cellW + 5;
      const py = r * cellH + 5;
      const pw = cellW - 10;
      const ph = cellH - 10;

      sdCtx.fillStyle = '#141e2c';
      sdCtx.fillRect(px, py, pw, ph);

      srCtx.fillStyle = '#202020';
      srCtx.fillRect(px, py, pw, ph);

      const hash = Math.sin(r * 31.7 + c * 17.3) * 43758.5453;
      const rnd = hash - Math.floor(hash);
      if (rnd < floorLitRatio) {
        const tone =
          rnd < 0.14
            ? 'rgba(253, 230, 178, 0.86)'
            : rnd < 0.26
              ? 'rgba(226, 236, 248, 0.72)'
              : 'rgba(191, 219, 254, 0.45)';
        seCtx.fillStyle = tone;
        seCtx.fillRect(px, py, pw, ph);
        // Subtle window blind line
        seCtx.fillStyle = 'rgba(0,0,0,0.22)';
        seCtx.fillRect(px, py + ph * 0.55, pw, 2);
      }
    }
    sdCtx.fillStyle = '#080b10';
    sdCtx.fillRect(0, r * cellH, 1024, 4);
  }

  const skyscraperFacade = new THREE.CanvasTexture(skyDiffCanvas);
  skyscraperFacade.colorSpace = THREE.SRGBColorSpace;
  skyscraperFacade.wrapS = THREE.RepeatWrapping;
  skyscraperFacade.wrapT = THREE.RepeatWrapping;
  skyscraperFacade.anisotropy = aniso;

  const skyscraperEmissive = new THREE.CanvasTexture(skyEmisCanvas);
  skyscraperEmissive.colorSpace = THREE.SRGBColorSpace;
  skyscraperEmissive.wrapS = THREE.RepeatWrapping;
  skyscraperEmissive.wrapT = THREE.RepeatWrapping;
  skyscraperEmissive.anisotropy = aniso;

  const skyscraperRoughness = new THREE.CanvasTexture(skyRoughCanvas);
  skyscraperRoughness.wrapS = THREE.RepeatWrapping;
  skyscraperRoughness.wrapT = THREE.RepeatWrapping;
  skyscraperRoughness.anisotropy = aniso;

  // 8. Cast Concrete Acoustic Barrier Texture (1024x1024)
  const concCanvas = document.createElement('canvas');
  concCanvas.width = 1024;
  concCanvas.height = 1024;
  const ccCtx = concCanvas.getContext('2d')!;
  ccCtx.fillStyle = '#242933';
  ccCtx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 18000; i++) {
    ccCtx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.16)';
    ccCtx.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3);
  }
  ccCtx.strokeStyle = 'rgba(10,12,16,0.7)';
  ccCtx.lineWidth = 6;
  for (let x = 0; x <= 1024; x += 256) {
    ccCtx.beginPath();
    ccCtx.moveTo(x, 0);
    ccCtx.lineTo(x, 1024);
    ccCtx.stroke();
  }
  const concreteBarrier = new THREE.CanvasTexture(concCanvas);
  concreteBarrier.colorSpace = THREE.SRGBColorSpace;
  concreteBarrier.wrapS = THREE.RepeatWrapping;
  concreteBarrier.wrapT = THREE.RepeatWrapping;
  concreteBarrier.anisotropy = aniso;

  // 9. Illuminated Expressway Gantry Signs & Complex Signs
  const highwaySign1 = createExpresswaySignTexture(
    'B',
    '#dc2626',
    'WANGAN LOOP',
    'CIRCUITO CERRADO · SHIBAURA · GINZA'
  );
  highwaySign1.anisotropy = aniso;

  const highwaySign2 = createExpresswaySignTexture(
    'C1',
    '#2563eb',
    'ACCESO PARKING / TALLER',
    'CARRIL DERECHO · CONCESIONARIO'
  );
  highwaySign2.anisotropy = aniso;

  const hangarSign = createSignTexture(
    'PERSONALIZACIÓN',
    'TALLER GARAGE · RENDIMIENTO · COSMÉTICA · CDI RACING',
    '#2563eb'
  );
  hangarSign.anisotropy = aniso;

  const tallerWallSign = createSignTexture(
    'PERSONALIZACIÓN',
    'RENDIMIENTO · COSMÉTICA · PINTURA Y TINTE',
    '#2563eb'
  );
  tallerWallSign.anisotropy = aniso;

  const dealershipSign = createSignTexture(
    'CONCESIONARIO',
    'CATÁLOGO OFICIAL · 9 MODELOS',
    '#e10600'
  );
  dealershipSign.anisotropy = aniso;

  return {
    carbon,
    carbonBump,
    carbonRoughness,
    asphalt,
    asphaltBump,
    asphaltRoughness,
    parkingAsphalt,
    crosswalkRoad,
    tallerFloor,
    tallerFloorRoughness,
    showroomFloor,
    showroomFloorRoughness,
    underglowRadial,
    contactShadow,
    skyscraperFacade,
    skyscraperEmissive,
    skyscraperRoughness,
    concreteBarrier,
    highwaySign1,
    highwaySign2,
    hangarSign,
    tallerWallSign,
    dealershipSign,
    dispose: () => {
      carbon.dispose();
      carbonBump.dispose();
      carbonRoughness.dispose();
      asphalt.dispose();
      asphaltBump.dispose();
      asphaltRoughness.dispose();
      parkingAsphalt.dispose();
      crosswalkRoad.dispose();
      tallerFloor.dispose();
      tallerFloorRoughness.dispose();
      showroomFloor.dispose();
      showroomFloorRoughness.dispose();
      underglowRadial.dispose();
      contactShadow.dispose();
      skyscraperFacade.dispose();
      skyscraperEmissive.dispose();
      skyscraperRoughness.dispose();
      concreteBarrier.dispose();
      highwaySign1.dispose();
      highwaySign2.dispose();
      hangarSign.dispose();
      tallerWallSign.dispose();
      dealershipSign.dispose();
    },
  };
}
