import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { MidnightAudioEngine } from './audio';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import { OnlineClient, OnlinePlayerRecord } from './onlineClient';
import {
  CameraPreset,
  CAR_CATALOG,
  ControlPerspective,
  DuelHudState,
  GameMode,
  GameSettings,
  getCarEffectiveHp,
  getCarEffectiveMaxRpm,
  getCarEffectiveWeight,
  getCarEffectiveZeroToHundred,
  getGearTopSpeedsKmh,
  HudSnapshot,
  KeyAction,
  MISSIONS_ROTATION,
  RadarBlip,
  RadioStation,
  RemotePlayerSummary,
  SaveProfile,
  StudioAnglePreset,
  StudioFocusZone,
  TransmissionMode,
  WalkingInteractionZone,
  WeatherMode,
} from './types';
import {
  buildCompositeVehicle,
  buildDriverCharacter,
  BuiltVehicle,
  DriverCharacter,
} from './vehicleBuilder';
import {
  buildMetropolisWorld,
  CAR_MEET_BOUNDS,
  CONTRACT_POS,
  DEALERSHIP_COUNTER_POS,
  DEALERSHIP_ENTRY_POS,
  DEALERSHIP_FOCUS_POS,
  DEALERSHIP_INTERIOR_BOUNDS,
  getRampBoundsAtZ,
  getRampElevationAtZ,
  getRampSlopeAtZ,
  HIGHWAY_Y,
  INTERIOR_CONNECT_BOUNDS,
  MetropolisWorld,
  PADDOCK_OBSTACLES,
  PARKING_BOUNDS,
  PARKING_PLAYER_CAR_POS,
  RAMP_BOTTOM_Z,
  RAMP_MERGE_END_Z,
  RAMP_TOP_Z,
  TrackProjection,
  TrackSample,
  TUNER_BAY_POS,
  TUNER_BAY_X_CENTERS,
  TUNER_ENTRY_POS,
  WALK_DOOR_BOUNDS,
} from './worldBuilder';

interface TrafficEntity {
  vehicle: BuiltVehicle;
  s: number;
  laneX: number; // road-local lateral offset (-7.6, -3.4, 3.4, 7.6)
  speedMs: number;
  isOncoming: boolean;
  nearMissed: boolean;
  hitCooldown: number;
}

const LANE_X = [-7.6, -3.4, 3.4, 7.6];
const TRAFFIC_COLORS = [
  '#94a3b8',
  '#475569',
  '#1e293b',
  '#991b1b',
  '#1e40af',
  '#cbd5e1',
  '#78350f',
  '#0f766e',
];
const TRAFFIC_STYLES = ['npc_sedan', 'npc_suv', 'npc_sport'] as const;
const GEAR_RATIOS = [0, 3.32, 2.18, 1.56, 1.18, 0.94, 0.77];
const IDLE_RPM = 950;

const CYLINDER_CONFIG_BY_CAR: Record<string, 'I4' | 'I6' | 'V8' | 'V10' | 'V12'> = {
  kuruma_2008: 'I4',
  elegy_r34: 'I6',
  supra_mk5: 'I6',
  m4_csl: 'I6',
  comet_gt3: 'I6',
  hellfire_srt: 'V8',
  amg_black: 'V8',
  huracan_evo: 'V10',
  lafuria_v12: 'V12',
};

export type ProgressionEventType =
  | 'NEAR_MISS'
  | 'EXTREME_ROCE'
  | 'RADAR_HIT'
  | 'CONTRACT_WIN'
  | 'DUEL_WIN'
  | 'CASH_BANK'
  | 'LIKE_SENT'
  | 'LIKE_RECEIVED'
  | 'HIGHWAY_KM'
  | 'WRONG_WAY_KM';

export interface ProgressionEvent {
  type: ProgressionEventType;
  cashDelta?: number;
  xpDelta?: number;
  repDelta?: number;
  radarId?: string;
  speedKmh?: number;
  combo?: number;
  kmDelta?: number;
  message?: string;
}

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

interface RemoteVehicleEntry {
  vehicle: BuiltVehicle;
  carKey: string;
  targetPos: THREE.Vector3;
  targetYaw: number;
  backfireTimer: number;
  flashTimer: number;
  summary: RemotePlayerSummary;
}

const MAX_PARTICLES = 220;

export class MidnightEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private pmremGenerator: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget;
  private textures: ProceduralTextureSet;
  private isSoftwareGl: boolean;

  private world: MetropolisWorld;
  private parkedPlayerCar: BuiltVehicle | null = null;
  private highwayPlayerCar: BuiltVehicle | null = null;
  private driverChar: DriverCharacter;

  private trafficPool: TrafficEntity[] = [];

  public audio = new MidnightAudioEngine();

  private profile: SaveProfile;
  private settings: GameSettings;
  private onHudUpdate: (snap: HudSnapshot) => void;
  private onProfileChange: (profile: SaveProfile) => void;
  private onContextLostCallback: (lost: boolean) => void;
  private onWalkingInteractCallback?: (zone: WalkingInteractionZone) => void;
  private onEnterTuningBayCallback?: () => void;
  private onProgressionEventCallback?: (ev: ProgressionEvent) => void;

  private mode: GameMode = 'START_MENU';
  private perspective: ControlPerspective = 'IN_CAR';
  private cameraPreset: CameraPreset = 'CHASE';
  private focusZone: StudioFocusZone = 'GARAGE';
  private tuningDrawerOpen = false;
  private inTuningBay = false;
  private enteredTuningByCar = false;
  private activeTuningBayX = TUNER_BAY_POS.x;

  // Parked & Parking-Drive Car State
  private parkedCarPos = new THREE.Vector3(
    PARKING_PLAYER_CAR_POS.x,
    0.015,
    PARKING_PLAYER_CAR_POS.z
  );
  private targetParkedCarPos = new THREE.Vector3(
    PARKING_PLAYER_CAR_POS.x,
    0.015,
    PARKING_PLAYER_CAR_POS.z
  );
  private parkedCarRotY = PARKING_PLAYER_CAR_POS.rotY;
  private targetParkedCarRotY = PARKING_PLAYER_CAR_POS.rotY;
  private parkingSpeedMs = 0;

  // Suspension, steering & active aero state
  private suspPitch = 0;
  private suspRoll = 0;
  private frontSteerAngle = 0;
  private activeWingDeploy = 0;
  private spawnPulseTimer = 0;

  // Walker & Dealership Inspection State
  private walkerPos = new THREE.Vector3(31.0, 0, 14.2);
  private walkerRotY = -0.35;
  private nearbyZone: WalkingInteractionZone = null;
  private nearbyDealershipCarId: string | null = null;
  private previewCarId: string | null = null;
  private previewAutoSpin = false;

  // Orbital Camera + Pointer Lock 360° Free Look
  private activePointers = new Map<number, { x: number; y: number }>();
  private lastPinchDist: number | null = null;
  private isDragging = false;
  private prevPtrX = 0;
  private prevPtrY = 0;
  private orbitTheta = 0.55;
  private orbitPhi = 1.24;
  private orbitVelTheta = 0;
  private orbitVelPhi = 0;
  private targetPresetTheta: number | null = null;
  private targetPresetPhi: number | null = null;
  private orbitRadius = 4.5;
  private targetOrbitRadius = 4.5;
  private orbitLookAt = new THREE.Vector3(32.5, 1.0, 12.0);
  private targetOrbitLookAt = new THREE.Vector3(32.5, 1.0, 12.0);
  private startMenuTime = 0;

  private pointerLocked = false;
  private freeCamYaw = 0;
  private freeCamPitch = 0;

  // Smooth align transition when launching onto Elevated Highway
  private launchTransitionTimer = 0;
  private readonly launchTransitionDuration = 0.85;
  private mergeGraceTimer = 0;

  // Closed-Loop Elevated Highway + Incorporation Ramp Physics State
  private playerS = 0;
  private laneOffset = 7.6;
  private highwayHeadingOffset = 0;
  private steerInputSmoothed = 0;
  private playerX = 7.6;
  private playerY = HIGHWAY_Y + 0.015;
  private playerZ = 0;
  private onRamp = false;
  private speedMs = 0; // signed: >0 forward, <0 reverse
  private rpm = IDLE_RPM;
  private gear = 1; // -1=R, 0=N, 1..6
  private nitro = 100;
  private revLimiterActive = false;
  private limiterPhase = 0;
  private backfireTimer = 0;
  private backfireCooldown = 0;
  private prevThrottleHeld = false;

  private combo = 0;
  private comboTimer = 0;
  private sessionEarnings = 0;
  private distanceMeters = 0;
  private nearMissBanner: string | null = null;
  private nearMissBannerTimer = 0;
  private crashBanner: string | null = null;
  private crashBannerTimer = 0;
  private crashCooldown = 0;

  // Active Mission State
  private missionIndex = 0;
  private missionProgress = 0;
  private missionBanner: string | null = null;
  private missionBannerTimer = 0;

  // No Hesi Pending Cash, Bullet Time, Radars & Contrato Express
  private pendingCash = 0;
  private bulletTimeTimer = 0;
  private extremeRoceBanner: string | null = null;
  private extremeRoceBannerTimer = 0;
  private radarFlashOpacity = 0;
  private radarFlashTimer = 0;
  private radarResultBanner: string | null = null;
  private radarResultTimer = 0;
  private radarCooldowns: Record<string, number> = {};
  private contractActive = false;
  private contractCheckpointIdx = 0;
  private contractTimerSec = 0;
  private contractBanner: string | null = null;
  private contractBannerTimer = 0;
  private highwayKmAccum = 0;
  private wrongWayKmAccum = 0;
  private brakeHeat = 0;
  private highBeamFlashTimer = 0;
  private elapsedSeconds = 0;

  // Volumetric Particle Pool (tire smoke, sparks, rain spray, aero streaks)
  private particleMesh!: THREE.InstancedMesh;
  private particleSlots: ParticleSlot[] = [];
  private particleCursor = 0;
  private readonly _pDummy = new THREE.Object3D();
  private readonly _pColor = new THREE.Color();

  // Online Cross-Play Client & Remote Players
  private onlineClient!: OnlineClient;
  private remoteVehicles = new Map<string, RemoteVehicleEntry>();
  private onlineConnected = false;
  private onlineRoomCode = 'PUBLIC';
  private onlinePlayers: RemotePlayerSummary[] = [];
  private nearbyRemotePlayer: RemotePlayerSummary | null = null;
  private inCarMeetZone = false;
  private isKing = false;
  private duelState: DuelHudState | null = null;
  private duelBannerTimer = 0;
  private pendingScoreDelta = 0;
  private onlineSyncAccum = 0;

  // Dynamic Keybindings & Touch State
  private heldCodes = new Set<string>();
  private keyCapturePaused = false;
  private touchControls = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    nitro: false,
  };

  // Scratch structs (zero per-frame allocations)
  private readonly _sample: TrackSample = {
    x: 0,
    z: 0,
    tx: 0,
    tz: -1,
    rx: 1,
    rz: 0,
    yaw: 0,
    s: 0,
  };
  private readonly _proj: TrackProjection = {
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

  // Loop & Timing
  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;
  private hudEmitAccum = 0;

  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();

  constructor(opts: {
    container: HTMLElement;
    profile: SaveProfile;
    settings: GameSettings;
    onHudUpdate: (snap: HudSnapshot) => void;
    onProfileChange: (profile: SaveProfile) => void;
    onContextLost: (lost: boolean) => void;
    onWalkingInteract?: (zone: WalkingInteractionZone) => void;
    onEnterTuningBay?: () => void;
    onProgressionEvent?: (ev: ProgressionEvent) => void;
  }) {
    this.container = opts.container;
    this.profile = opts.profile;
    this.settings = opts.settings;
    this.onHudUpdate = opts.onHudUpdate;
    this.onProfileChange = opts.onProfileChange;
    this.onContextLostCallback = opts.onContextLost;
    this.onWalkingInteractCallback = opts.onWalkingInteract;
    this.onEnterTuningBayCallback = opts.onEnterTuningBay;
    this.onProgressionEventCallback = opts.onProgressionEvent;

    this.isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const gpu = String(probe.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.settings.exposure;
    this.applyQualityPixelRatio();
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && this.settings.graphicsQuality === 'HIGH';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    this.container.appendChild(canvas);

    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xaacae8);
    this.scene.fog = new THREE.Fog(0xaacae8, 165, 540);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov * 0.72, width / height, 0.1, 560);

    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRT = this.pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;

    this.textures = createProceduralTextures(this.renderer.capabilities.getMaxAnisotropy());

    this.world = buildMetropolisWorld(this.textures, this.isSoftwareGl);
    this.scene.add(this.world.group);

    this.driverChar = buildDriverCharacter(this.textures);
    this.driverChar.root.position.copy(this.walkerPos);
    this.driverChar.root.rotation.y = this.walkerRotY;
    this.driverChar.root.visible = false;
    this.world.group.add(this.driverChar.root);

    this.playerS = this.world.track.projectToTrack(0, -4, null, this._proj).s;

    this.initTrafficPool();
    this.initParticlePool();
    this.initOnlineClient();
    this.resetTrafficPositions(this.playerS, false);
    this.rebuildParkedCar();
    this.world.setQuality(this.settings.graphicsQuality);
    this.world.setViewDistance(this.settings.viewDistance, this.scene, this.camera);
    this.applySettings(this.settings);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const initialBloomStrength =
        this.settings.graphicsQuality === 'HIGH'
          ? 0.12
          : this.settings.graphicsQuality === 'MEDIUM'
            ? 0.08
            : 0;
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        initialBloomStrength,
        0.20,
        0.96
      );
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
    }

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    document.addEventListener('pointerlockerror', this.handlePointerLockError);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });

    this.emitHud();
    this.startLoop();
  }

  public setOnProgressionEvent(cb: (ev: ProgressionEvent) => void) {
    this.onProgressionEventCallback = cb;
  }

  private initParticlePool() {
    const geom = new THREE.SphereGeometry(0.18, 6, 5);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.particleMesh = new THREE.InstancedMesh(geom, mat, MAX_PARTICLES);
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;

    this._pDummy.position.set(0, -100, 0);
    this._pDummy.scale.set(0, 0, 0);
    this._pDummy.updateMatrix();

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particleSlots.push({
        active: false,
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        r: 1,
        g: 1,
        b: 1,
      });
      this.particleMesh.setMatrixAt(i, this._pDummy.matrix);
      this.particleMesh.setColorAt(i, this._pColor.setRGB(1, 1, 1));
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.particleMesh);
  }

  private resetParticles() {
    if (!this.particleMesh) return;
    this._pDummy.position.set(0, -100, 0);
    this._pDummy.scale.set(0, 0, 0);
    this._pDummy.updateMatrix();
    for (let i = 0; i < this.particleSlots.length; i++) {
      this.particleSlots[i].active = false;
      this.particleSlots[i].life = 0;
      this.particleMesh.setMatrixAt(i, this._pDummy.matrix);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    r: number,
    g: number,
    b: number
  ) {
    const slot = this.particleSlots[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.life = life;
    slot.maxLife = life;
    slot.size = size;
    slot.r = r;
    slot.g = g;
    slot.b = b;
  }

  private updateParticles(dt: number) {
    if (!this.particleMesh) return;
    let dirty = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particleSlots[i];
      if (!p.active) continue;
      dirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this._pDummy.position.set(0, -100, 0);
        this._pDummy.scale.set(0, 0, 0);
        this._pDummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, this._pDummy.matrix);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - 1.4 * dt;
      p.vz *= 1 - 1.4 * dt;
      const ratio = p.life / p.maxLife;
      const s = p.size * (0.4 + (1 - ratio) * 1.15) * Math.min(1, ratio * 2.2);
      this._pDummy.position.set(p.x, p.y, p.z);
      this._pDummy.scale.set(s, s, s);
      this._pDummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, this._pDummy.matrix);
      this._pColor.setRGB(p.r * ratio + 0.15, p.g * ratio + 0.15, p.b * ratio + 0.15);
      this.particleMesh.setColorAt(i, this._pColor);
    }
    if (dirty) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  private initOnlineClient() {
    this.onlineClient = new OnlineClient({
      onConnectionChange: (connected) => {
        this.onlineConnected = connected;
        this.emitHud();
      },
      onRoomJoined: (roomCode) => {
        this.onlineRoomCode = roomCode;
        for (const entry of this.remoteVehicles.values()) {
          this.world.group.remove(entry.vehicle.root);
          entry.vehicle.dispose();
        }
        this.remoteVehicles.clear();
        this.emitHud();
      },
      onSnapshot: (roomCode, players, duels) => {
        this.onlineRoomCode = roomCode;
        this.syncRemotePlayers(players, duels);
      },
      onRemoteBackfire: (pid) => {
        const ent = this.remoteVehicles.get(pid);
        if (ent) {
          ent.backfireTimer = 0.25;
          const dist = Math.hypot(
            ent.targetPos.x - this.camera.position.x,
            ent.targetPos.z - this.camera.position.z
          );
          if (dist < 42) {
            this.audio.playBackfirePop(0.7, 2);
          }
        }
      },
      onRemoteFlash: (pid) => {
        const ent = this.remoteVehicles.get(pid);
        if (ent) {
          ent.flashTimer = 0.55;
        }
      },
      onLikeReceived: (fromName, _totalLikes, repGain) => {
        this.audio.playLikeChime();
        this.onProgressionEventCallback?.({
          type: 'LIKE_RECEIVED',
          repDelta: repGain,
          xpDelta: 35,
          message: `${fromName} votó tu coche (+${repGain} Rep)`,
        });
      },
      onLikeSent: (_targetId, targetName) => {
        this.audio.playLikeChime();
        this.onProgressionEventCallback?.({
          type: 'LIKE_SENT',
          xpDelta: 30,
          message: `Voto enviado a ${targetName}`,
        });
      },
      onDuelStarted: (duel) => {
        const myId = this.onlineClient.getPlayerId();
        const isChallenger = duel.challengerId === myId;
        this.audio.playDuelChallenge();
        this.duelState = {
          duelId: duel.id,
          opponentName: isChallenger ? duel.opponentName : duel.challengerName,
          myScore: 0,
          opponentScore: 0,
          remainingSec: 25,
          resultBanner: `DUELO VS ${isChallenger ? duel.opponentName : duel.challengerName}`,
        };
        this.duelBannerTimer = 2.6;
        this.emitHud();
      },
      onDuelFinished: (data) => {
        const myId = this.onlineClient.getPlayerId();
        const won = data.winnerId && data.winnerId === myId;
        const draw = !data.winnerId;
        const resultText = won
          ? '¡VICTORIA EN DUELO! +$3,500 · +200 XP'
          : draw
            ? 'EMPATE EN DUELO'
            : `DERROTA VS ${data.winnerName ?? 'RIVAL'}`;
        if (won) {
          this.awardCash(3500);
          this.audio.playMissionComplete();
          this.onProgressionEventCallback?.({
            type: 'DUEL_WIN',
            xpDelta: 200,
            repDelta: 60,
            message: resultText,
          });
        }
        this.duelState = {
          duelId: data.duelId,
          opponentName: data.winnerName ?? 'Rival',
          myScore: data.challengerScore,
          opponentScore: data.opponentScore,
          remainingSec: 0,
          resultBanner: resultText,
        };
        this.duelBannerTimer = 3.6;
        this.emitHud();
      },
    });
    this.onlineClient.connect(this.profile.playerName);
  }

  private syncRemotePlayers(
    players: OnlinePlayerRecord[],
    duels: Array<{
      id: string;
      challengerId: string;
      opponentId: string;
      challengerScore: number;
      opponentScore: number;
      remainingSec: number;
    }>
  ) {
    const myId = this.onlineClient.getPlayerId();
    const seen = new Set<string>();
    const summaries: RemotePlayerSummary[] = [];
    let selfKing = false;

    for (const p of players) {
      if (p.id === myId) {
        selfKing = Boolean(p.isKing);
        continue;
      }
      seen.add(p.id);
      const summary: RemotePlayerSummary = {
        id: p.id,
        name: p.name,
        carId: p.carId,
        mode: p.mode,
        x: p.x,
        z: p.z,
        speedKmh: p.speedKmh,
        inCarMeet: p.inCarMeet,
        likes: p.likes,
        score: p.score,
        isKing: p.isKing,
      };
      summaries.push(summary);

      const carKey = `${p.carId}|${p.paint}|${p.paintFinish}|${p.rimColor}|${p.spoiler}|${p.underglow}`;
      const existing = this.remoteVehicles.get(p.id);
      if (!existing || existing.carKey !== carKey) {
        if (existing) {
          this.world.group.remove(existing.vehicle.root);
          existing.vehicle.dispose();
        }
        const spec = CAR_CATALOG[p.carId] ?? CAR_CATALOG.kuruma_2008;
        const v = buildCompositeVehicle({
          style: spec.bodyStyle,
          paintHex: p.paint || spec.defaultPaint,
          paintFinish: p.paintFinish || 'gloss',
          rimHex: p.rimColor || spec.defaultRim,
          underglowHex: p.underglow || 'none',
          spoilerOverride: p.spoiler || 'stock',
          textures: this.textures,
          isSoftwareGl: this.isSoftwareGl,
          isTraffic: true,
        });
        v.root.position.set(p.x, p.y, p.z);
        v.root.rotation.y = p.rotY;
        v.setHeadlightsOn(true);
        v.setKingCrown(Boolean(p.isKing));
        this.world.group.add(v.root);
        this.remoteVehicles.set(p.id, {
          vehicle: v,
          carKey,
          targetPos: new THREE.Vector3(p.x, p.y, p.z),
          targetYaw: p.rotY,
          backfireTimer: 0,
          flashTimer: 0,
          summary,
        });
      } else {
        existing.targetPos.set(p.x, p.y, p.z);
        existing.targetYaw = p.rotY;
        existing.summary = summary;
        existing.vehicle.setKingCrown(Boolean(p.isKing));
      }
    }

    for (const [id, entry] of this.remoteVehicles.entries()) {
      if (!seen.has(id)) {
        this.world.group.remove(entry.vehicle.root);
        entry.vehicle.dispose();
        this.remoteVehicles.delete(id);
      }
    }

    this.isKing = selfKing;
    this.onlinePlayers = summaries;
    this.parkedPlayerCar?.setKingCrown(this.isKing);
    this.highwayPlayerCar?.setKingCrown(this.isKing);

    const activeDuel = duels.find((d) => d.challengerId === myId || d.opponentId === myId);
    if (activeDuel) {
      const amChallenger = activeDuel.challengerId === myId;
      const oppId = amChallenger ? activeDuel.opponentId : activeDuel.challengerId;
      const opp = summaries.find((s) => s.id === oppId);
      this.duelState = {
        duelId: activeDuel.id,
        opponentName: opp?.name ?? this.duelState?.opponentName ?? 'Rival',
        myScore: amChallenger ? activeDuel.challengerScore : activeDuel.opponentScore,
        opponentScore: amChallenger ? activeDuel.opponentScore : activeDuel.challengerScore,
        remainingSec: activeDuel.remainingSec,
        resultBanner: this.duelBannerTimer > 0 ? this.duelState?.resultBanner ?? null : null,
      };
    } else if (this.duelBannerTimer <= 0) {
      this.duelState = null;
    }
  }

  private updateRemoteVehicles(dt: number) {
    const px =
      this.mode === 'HIGHWAY'
        ? this.playerX
        : this.mode === 'PARKING_DRIVE'
          ? this.parkedCarPos.x
          : this.walkerPos.x;
    const pz =
      this.mode === 'HIGHWAY'
        ? this.playerZ
        : this.mode === 'PARKING_DRIVE'
          ? this.parkedCarPos.z
          : this.walkerPos.z;

    let closestRemote: RemotePlayerSummary | null = null;
    let closestDist = 8.5;

    for (const entry of this.remoteVehicles.values()) {
      const visible = entry.summary.mode !== 'START_MENU';
      entry.vehicle.root.visible = visible;
      if (!visible) continue;

      entry.vehicle.root.position.lerp(entry.targetPos, 1 - Math.exp(-12 * dt));
      let dy = entry.targetYaw - entry.vehicle.root.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      entry.vehicle.root.rotation.y += dy * (1 - Math.exp(-12 * dt));

      const speedMs = entry.summary.speedKmh / 3.6;
      for (const w of entry.vehicle.wheels) {
        w.rotation.x -= (speedMs / 0.33) * dt;
      }

      if (entry.flashTimer > 0) {
        entry.flashTimer = Math.max(0, entry.flashTimer - dt);
        entry.vehicle.flashHighBeams(true);
      } else {
        entry.vehicle.flashHighBeams(false);
      }

      if (entry.backfireTimer > 0) {
        entry.backfireTimer = Math.max(0, entry.backfireTimer - dt);
        entry.vehicle.backfireLeft.visible = true;
        entry.vehicle.backfireRight.visible = true;
        entry.vehicle.backfireOuterMat.opacity = 0.85;
        entry.vehicle.backfireCoreMat.opacity = 0.95;
      } else {
        entry.vehicle.backfireLeft.visible = false;
        entry.vehicle.backfireRight.visible = false;
      }

      const d = Math.hypot(entry.targetPos.x - px, entry.targetPos.z - pz);
      if (d < closestDist) {
        closestDist = d;
        closestRemote = entry.summary;
      }
    }

    this.nearbyRemotePlayer = closestRemote;
    this.inCarMeetZone =
      px >= CAR_MEET_BOUNDS.minX &&
      px <= CAR_MEET_BOUNDS.maxX &&
      pz >= CAR_MEET_BOUNDS.minZ &&
      pz <= CAR_MEET_BOUNDS.maxZ;
  }

  private pushOnlineState(dt: number) {
    if (!this.onlineClient?.isConnected()) return;
    this.onlineSyncAccum += dt;
    if (this.onlineSyncAccum < 0.065) return;
    this.onlineSyncAccum = 0;

    const { spec, carState } = this.getActiveCarState();
    const x =
      this.mode === 'HIGHWAY'
        ? this.playerX
        : this.mode === 'PARKING_DRIVE'
          ? this.parkedCarPos.x
          : this.walkerPos.x;
    const y =
      this.mode === 'HIGHWAY'
        ? this.playerY
        : 0.015;
    const z =
      this.mode === 'HIGHWAY'
        ? this.playerZ
        : this.mode === 'PARKING_DRIVE'
          ? this.parkedCarPos.z
          : this.walkerPos.z;
    const rotY =
      this.mode === 'HIGHWAY'
        ? this.highwayPlayerCar?.root.rotation.y ?? 0
        : this.mode === 'PARKING_DRIVE'
          ? this.parkedCarRotY
          : this.walkerRotY;

    const scoreDelta = this.pendingScoreDelta;
    this.pendingScoreDelta = 0;

    this.onlineClient.sendState({
      name: this.profile.playerName || 'GHOST_078',
      carId: spec.id,
      paint: carState.paint,
      paintFinish: carState.paintFinish ?? 'gloss',
      rimColor: carState.rimColor,
      rimDesign: carState.rimDesign ?? 'five_spoke',
      underglow: carState.underglow,
      spoiler: carState.spoiler ?? 'stock',
      mode: this.mode,
      x,
      y,
      z,
      rotY,
      speedKmh: Math.round(Math.abs(this.speedMs) * 3.6),
      gear: this.gear,
      inCarMeet: this.inCarMeetZone,
      combo: this.combo,
      scoreDelta,
      bestScore: this.profile.bestNoHesiCombo,
    });
  }

  private getActiveCarState() {
    const spec = CAR_CATALOG[this.profile.activeCarId] ?? CAR_CATALOG.kuruma_2008;
    const carState = this.profile.cars[spec.id];
    return { spec, carState };
  }

  private getActiveCarTransmission(): TransmissionMode {
    const carState = this.profile.cars[this.profile.activeCarId];
    return carState?.transmission ?? this.profile.transmission;
  }

  private isActionHeld(action: KeyAction): boolean {
    if (this.keyCapturePaused) return false;
    const codes = this.settings.keybindings?.[action];
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) {
      if (this.heldCodes.has(codes[i])) return true;
    }
    return false;
  }

  private isCodeForAction(code: string, action: KeyAction): boolean {
    const codes = this.settings.keybindings?.[action];
    return Array.isArray(codes) && codes.includes(code);
  }

  public setKeyCapturePaused(paused: boolean) {
    this.keyCapturePaused = paused;
    if (paused) {
      this.heldCodes.clear();
    }
  }

  private applyQualityPixelRatio() {
    if (this.isSoftwareGl) {
      this.renderer.setPixelRatio(1);
      return;
    }
    const maxDpr =
      this.settings.graphicsQuality === 'HIGH'
        ? 1.5
        : this.settings.graphicsQuality === 'MEDIUM'
          ? 1.25
          : 1.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  }

  private initTrafficPool() {
    for (let i = 0; i < 20; i++) {
      const style = TRAFFIC_STYLES[i % TRAFFIC_STYLES.length];
      const color = TRAFFIC_COLORS[i % TRAFFIC_COLORS.length];
      const v = buildCompositeVehicle({
        style,
        paintHex: color,
        rimHex: '#64748b',
        underglowHex: 'none',
        textures: this.textures,
        isSoftwareGl: this.isSoftwareGl,
        isTraffic: true,
      });
      this.world.group.add(v.root);
      this.trafficPool.push({
        vehicle: v,
        s: 0,
        laneX: LANE_X[i % 4],
        speedMs: 22,
        isOncoming: i % 4 < 2,
        nearMissed: false,
        hitCooldown: 0,
      });
    }
  }

  private resetTrafficPositions(anchorS: number, clearNearMerge = false) {
    const track = this.world.track;
    this.trafficPool.forEach((t, idx) => {
      const laneIdx = idx % 4;
      const lx = LANE_X[laneIdx];
      t.laneX = lx;
      t.isOncoming = laneIdx < 2;
      t.speedMs = t.isOncoming ? 22 + (idx % 4) * 2.2 : 21 + (idx % 5) * 2.0;
      t.nearMissed = false;
      t.hitCooldown = 0;

      let sPos = clearNearMerge
        ? track.wrapS(anchorS + 68 + idx * 95)
        : track.wrapS(anchorS + 28 + idx * (track.totalLength / this.trafficPool.length));

      if (clearNearMerge && Math.abs(track.shortestSignedDeltaS(anchorS, sPos)) < 54) {
        sPos = track.wrapS(anchorS + 68 + idx * 35);
      }

      t.s = sPos;
      track.sampleAtS(sPos, this._sample);
      const worldX = this._sample.x + this._sample.rx * lx;
      const worldZ = this._sample.z + this._sample.rz * lx;
      t.vehicle.root.position.set(worldX, HIGHWAY_Y + 0.015, worldZ);
      t.vehicle.root.rotation.y = this._sample.yaw + (t.isOncoming ? Math.PI : 0);
    });
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.onContextLostCallback(true);
  };

  private handleContextRestored = () => {
    this.onContextLostCallback(false);
  };

  private handleResize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer?.setSize(width, height);
    this.bloomPass?.setSize(width, height);
  };

  private handleWindowBlur = () => {
    this.heldCodes.clear();
  };

  // ==================== POINTER LOCK & 360° FREE CAMERA ====================

  private handlePointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    this.emitHud();
  };

  private handlePointerLockError = () => {
    this.pointerLocked = false;
    this.emitHud();
  };

  public togglePointerLock() {
    if (this.mode === 'START_MENU') return;
    try {
      const canvas = this.renderer.domElement;
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock?.();
      } else {
        const res = canvas.requestPointerLock?.() as unknown;
        if (res && typeof (res as Promise<void>).catch === 'function') {
          (res as Promise<void>).catch(() => {
            this.pointerLocked = false;
          });
        }
      }
    } catch {
      this.pointerLocked = false;
    }
  }

  public exitPointerLock() {
    try {
      if (document.pointerLockElement === this.renderer.domElement) {
        document.exitPointerLock?.();
      }
    } catch {
      // ignore
    }
  }

  private handleMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    const sens = this.settings.cameraSensitivity;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;

    if (this.mode === 'WALKING') {
      this.targetPresetTheta = null;
      this.targetPresetPhi = null;
      this.previewAutoSpin = false;
      this.orbitTheta -= dx * 0.0042 * sens;
      this.orbitPhi = THREE.MathUtils.clamp(
        this.orbitPhi - dy * 0.0038 * sens,
        0.18,
        Math.PI * 0.49
      );
      this.orbitVelTheta = 0;
      this.orbitVelPhi = 0;
    } else if (this.mode === 'PARKING_DRIVE' || this.mode === 'HIGHWAY') {
      this.freeCamYaw -= dx * 0.0045 * sens;
      this.freeCamPitch = THREE.MathUtils.clamp(
        this.freeCamPitch - dy * 0.0035 * sens,
        -0.55,
        0.85
      );
    }
  };

  private handlePointerDown = (e: PointerEvent) => {
    this.audio.unlock();
    if (this.mode !== 'WALKING' && this.mode !== 'PARKING_DRIVE') return;
    if (this.pointerLocked) return;

    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.targetPresetTheta = null;
    this.targetPresetPhi = null;
    this.previewAutoSpin = false;

    if (this.activePointers.size === 1) {
      this.isDragging = true;
      this.prevPtrX = e.clientX;
      this.prevPtrY = e.clientY;
    } else if (this.activePointers.size === 2) {
      this.isDragging = false;
      const pts = Array.from(this.activePointers.values());
      this.lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  };

  private handlePointerMove = (e: PointerEvent) => {
    if (this.pointerLocked) return;
    if (this.mode !== 'WALKING' && this.mode !== 'PARKING_DRIVE') return;
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (this.activePointers.size === 2) {
      const pts = Array.from(this.activePointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.lastPinchDist !== null) {
        const delta = this.lastPinchDist - dist;
        this.targetOrbitRadius = THREE.MathUtils.clamp(
          this.targetOrbitRadius + delta * 0.015,
          2.8,
          12.5
        );
      }
      this.lastPinchDist = dist;
      return;
    }

    if (!this.isDragging) return;
    const sens = this.settings.cameraSensitivity;
    const dx = e.clientX - this.prevPtrX;
    const dy = e.clientY - this.prevPtrY;

    if (this.mode === 'WALKING') {
      const dTheta = -dx * 0.0055 * sens;
      const dPhi = -dy * 0.0048 * sens;
      this.orbitTheta += dTheta;
      this.orbitPhi = THREE.MathUtils.clamp(this.orbitPhi + dPhi, 0.22, Math.PI * 0.49);
      this.orbitVelTheta = THREE.MathUtils.lerp(this.orbitVelTheta, dTheta * 50, 0.45);
      this.orbitVelPhi = THREE.MathUtils.lerp(this.orbitVelPhi, dPhi * 50, 0.45);
    } else if (this.mode === 'PARKING_DRIVE') {
      this.freeCamYaw -= dx * 0.005 * sens;
      this.freeCamPitch = THREE.MathUtils.clamp(
        this.freeCamPitch - dy * 0.004 * sens,
        -0.45,
        0.75
      );
    }

    this.prevPtrX = e.clientX;
    this.prevPtrY = e.clientY;
  };

  private handlePointerUp = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) {
      this.lastPinchDist = null;
    }
    if (this.activePointers.size === 0) {
      this.isDragging = false;
    }
  };

  private handleWheel = (e: WheelEvent) => {
    if (this.mode !== 'WALKING') return;
    e.preventDefault();
    this.targetOrbitRadius = THREE.MathUtils.clamp(
      this.targetOrbitRadius + e.deltaY * 0.0036,
      2.8,
      12.5
    );
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (this.keyCapturePaused) return;
    this.audio.unlock();

    if (this.isCodeForAction(e.code, 'togglePointerLock') || e.code === 'Tab') {
      if (this.isCodeForAction(e.code, 'togglePointerLock')) {
        e.preventDefault();
        if (!e.repeat && this.mode !== 'START_MENU') {
          this.togglePointerLock();
        }
        return;
      }
    }

    if (
      this.mode !== 'START_MENU' &&
      (this.isCodeForAction(e.code, 'nitro') ||
        e.code === 'Space' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown')
    ) {
      e.preventDefault();
    }

    this.heldCodes.add(e.code);

    if (e.repeat) return;

    if (this.isCodeForAction(e.code, 'toggleRadio')) {
      this.cycleRadioStation();
      return;
    }
    if (this.isCodeForAction(e.code, 'flashHeadlights')) {
      this.triggerHeadlightFlash();
    }

    if (this.mode === 'WALKING') {
      if (this.isCodeForAction(e.code, 'enterExitCar')) {
        if (this.nearbyZone === 'CAR' || (this.nearbyZone === null && this.walkerPos.z >= 1.5)) {
          this.enterCarInParking();
        } else if (this.nearbyZone) {
          this.onWalkingInteractCallback?.(this.nearbyZone);
        }
      } else if (
        (this.isCodeForAction(e.code, 'shiftUp') || e.code === 'KeyE') &&
        this.nearbyZone
      ) {
        this.onWalkingInteractCallback?.(this.nearbyZone);
      } else if (e.code === 'KeyT' && !this.tuningDrawerOpen) {
        this.enteredTuningByCar = false;
        this.activeTuningBayX = TUNER_BAY_POS.x;
        this.onEnterTuningBayCallback?.();
      }
    } else if (this.mode === 'PARKING_DRIVE') {
      if (this.isCodeForAction(e.code, 'enterExitCar')) {
        this.exitCarInParking();
      } else if (this.isCodeForAction(e.code, 'cycleCamera')) {
        this.cycleCameraPreset();
      } else if (this.isCodeForAction(e.code, 'toggleTransmission')) {
        this.toggleTransmission();
      } else if (e.code === 'KeyT') {
        this.enterNearestTuningBayFromDrive();
      }
    } else if (this.mode === 'HIGHWAY') {
      if (this.isCodeForAction(e.code, 'shiftUp')) this.shiftGear(1);
      else if (this.isCodeForAction(e.code, 'shiftDown')) this.shiftGear(-1);
      else if (this.isCodeForAction(e.code, 'cycleCamera')) this.cycleCameraPreset();
      else if (this.isCodeForAction(e.code, 'toggleTransmission')) this.toggleTransmission();
      else if (this.isCodeForAction(e.code, 'enterExitCar')) this.exitToShowroom();
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.heldCodes.delete(e.code);
  };

  // ==================== PUBLIC API FOR REACT ====================

  public setProfile(next: SaveProfile) {
    const prevCar = this.profile.activeCarId;
    const prevWeather = this.profile.weather;
    const prevState = this.profile.cars[prevCar];
    const nextState = next.cars[next.activeCarId];

    const needsGeometryRebuild =
      prevCar !== next.activeCarId ||
      prevState?.spoiler !== nextState?.spoiler ||
      prevState?.rimDesign !== nextState?.rimDesign ||
      prevState?.tireProfile !== nextState?.tireProfile ||
      prevState?.frontBumper !== nextState?.frontBumper ||
      prevState?.diffuser !== nextState?.diffuser ||
      prevState?.sportSteering !== nextState?.sportSteering ||
      prevState?.starlightRoof !== nextState?.starlightRoof ||
      prevState?.upgrades?.weight !== nextState?.upgrades?.weight ||
      prevState?.upgrades?.turbo !== nextState?.upgrades?.turbo ||
      prevState?.upgrades?.brakes !== nextState?.upgrades?.brakes ||
      prevState?.upgrades?.suspension !== nextState?.upgrades?.suspension ||
      prevState?.upgrades?.exhaust !== nextState?.upgrades?.exhaust;

    this.profile = next;

    if (needsGeometryRebuild) {
      this.rebuildParkedCar();
    } else {
      this.refreshShowroomCarAppearance();
    }
    if (prevWeather !== next.weather) {
      this.applyWeather(next.weather);
    }
  }

  public applySettings(next: GameSettings) {
    const prevQuality = this.settings.graphicsQuality;
    const prevViewDist = this.settings.viewDistance;
    this.settings = next;
    this.renderer.toneMappingExposure = next.exposure;
    this.audio.setVolumes({
      master: next.masterVolume,
      engine: next.engineVolume,
      sfx: next.sfxVolume,
      muted: next.muted,
    });
    this.applyWeather(next.weather);
    if (prevViewDist !== next.viewDistance) {
      this.world.setViewDistance(next.viewDistance, this.scene, this.camera);
    }
    if (prevQuality !== next.graphicsQuality) {
      this.applyQualityPixelRatio();
      this.renderer.shadowMap.enabled = !this.isSoftwareGl && next.graphicsQuality === 'HIGH';
      this.renderer.shadowMap.needsUpdate = true;
      this.world.setQuality(next.graphicsQuality);
      if (this.bloomPass) {
        this.bloomPass.strength =
          next.graphicsQuality === 'HIGH'
            ? 0.12
            : next.graphicsQuality === 'MEDIUM'
              ? 0.08
              : 0;
        this.bloomPass.radius = 0.20;
        this.bloomPass.threshold = 0.96;
      }
    }
  }

  public setRadioStation(station: RadioStation) {
    this.audio.unlock();
    this.audio.setRadioStation(station);
    this.emitHud();
  }

  public cycleRadioStation() {
    this.audio.unlock();
    this.audio.cycleRadioStation();
    this.emitHud();
  }

  public triggerHeadlightFlash() {
    this.audio.unlock();
    this.highBeamFlashTimer = 0.55;
    this.onlineClient?.sendHeadlightFlash();
    this.emitHud();
  }

  public joinOnlineRoom(opts: { roomCode?: string; createPrivate?: boolean; name?: string }) {
    this.onlineClient?.joinRoom(opts);
  }

  public likeNearbyRemotePlayer() {
    if (!this.nearbyRemotePlayer) return;
    this.audio.unlock();
    this.onlineClient?.sendCarMeetLike(this.nearbyRemotePlayer.id);
  }

  public startContratoExpress() {
    this.audio.unlock();
    this.contractActive = true;
    this.contractCheckpointIdx = 0;
    this.contractTimerSec = 95;
    this.contractBanner = 'CONTRATO EXPRESS · ¡SAL AL HIGHWAY! CHECKPOINT 1/10 (95s)';
    this.contractBannerTimer = 3.6;

    // Position car oriented toward the Highway exit ramp when launched from the Paddock totem
    if (this.mode === 'WALKING') {
      this.parkedCarPos.set(27.0, 0.015, 16.5);
      this.targetParkedCarPos.copy(this.parkedCarPos);
      this.parkedCarRotY = Math.PI * 0.5;
      this.targetParkedCarRotY = this.parkedCarRotY;
      this.enterCarInParking();
    }
    this.emitHud();
  }

  public applyWeather(weather: WeatherMode) {
    this.world.setAtmosphere(weather, this.scene);
  }

  public setMode(nextMode: GameMode) {
    if (nextMode === 'START_MENU') {
      this.exitPointerLock();
      this.resetParticles();
      this.mode = 'START_MENU';
      this.driverChar.root.visible = false;
      this.tuningDrawerOpen = false;
      this.inTuningBay = false;
      this.enteredTuningByCar = false;
      this.previewCarId = null;
      this.previewAutoSpin = false;
      this.parkingSpeedMs = 0;
      this.freeCamYaw = 0;
      this.freeCamPitch = 0;
      this.setStudioFocusZone('GARAGE');
      if (this.highwayPlayerCar) {
        this.highwayPlayerCar.root.visible = false;
        this.highwayPlayerCar.setHeadlightsOn(false);
      }
      this.parkedCarPos.set(
        PARKING_PLAYER_CAR_POS.x,
        0.015,
        PARKING_PLAYER_CAR_POS.z
      );
      this.targetParkedCarPos.copy(this.parkedCarPos);
      this.parkedCarRotY = PARKING_PLAYER_CAR_POS.rotY;
      this.targetParkedCarRotY = PARKING_PLAYER_CAR_POS.rotY;
      if (this.parkedPlayerCar) {
        this.parkedPlayerCar.root.position.copy(this.parkedCarPos);
        this.parkedPlayerCar.root.rotation.y = this.parkedCarRotY;
        this.parkedPlayerCar.root.visible = true;
        this.parkedPlayerCar.setHeadlightsOn(true);
      }
      const homeS = this.world.track.projectToTrack(0, 0, null, this._proj).s;
      this.resetTrafficPositions(homeS, false);
      this.emitHud();
    } else if (nextMode === 'WALKING') {
      this.audio.unlock();
      this.resetParticles();
      this.mode = 'WALKING';
      this.driverChar.root.visible = true;
      this.driverChar.root.position.copy(this.walkerPos);
      this.orbitRadius = 4.2;
      this.targetOrbitRadius = 4.2;
      this.freeCamYaw = 0;
      this.freeCamPitch = 0;
      this.setStudioFocusZone('GARAGE');
      if (this.highwayPlayerCar) {
        this.highwayPlayerCar.root.visible = false;
        this.highwayPlayerCar.setHeadlightsOn(false);
      }
      if (this.parkedPlayerCar) {
        this.parkedPlayerCar.root.visible = true;
        this.parkedPlayerCar.setHeadlightsOn(false);
      }
      this.emitHud();
    } else if (nextMode === 'PARKING_DRIVE') {
      this.enterCarInParking();
    } else {
      this.enterHighway(false);
    }
  }

  public enterCarInParking() {
    this.audio.unlock();
    this.mode = 'PARKING_DRIVE';
    this.tuningDrawerOpen = false;
    this.inTuningBay = false;
    this.enteredTuningByCar = false;
    this.previewCarId = null;
    this.previewAutoSpin = false;
    this.focusZone = 'GARAGE';
    this.driverChar.root.visible = false;
    this.parkingSpeedMs = 0;
    this.suspPitch = 0;
    this.suspRoll = 0;
    this.frontSteerAngle = 0;
    this.activeWingDeploy = 0;
    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.revLimiterActive = false;
    this.freeCamYaw = 0;
    this.freeCamPitch = 0;

    if (this.parkedPlayerCar) {
      this.parkedPlayerCar.root.visible = true;
      this.parkedPlayerCar.setHeadlightsOn(true);
      this.parkedCarPos.copy(this.parkedPlayerCar.root.position);
      this.targetParkedCarPos.copy(this.parkedCarPos);
      this.parkedCarRotY = this.parkedPlayerCar.root.rotation.y;
      this.targetParkedCarRotY = this.parkedCarRotY;
    }
    this.emitHud();
  }

  public exitCarInParking() {
    this.mode = 'WALKING';
    this.parkingSpeedMs = 0;
    this.suspPitch = 0;
    this.suspRoll = 0;
    this.frontSteerAngle = 0;
    this.freeCamYaw = 0;
    this.freeCamPitch = 0;
    this.inTuningBay = false;
    this.enteredTuningByCar = false;
    this.parkedPlayerCar?.setHeadlightsOn(false);

    const sideX = this.parkedCarPos.x + Math.cos(this.parkedCarRotY) * 1.9;
    const sideZ = this.parkedCarPos.z - Math.sin(this.parkedCarRotY) * 1.9;
    this.walkerPos.set(
      THREE.MathUtils.clamp(sideX, PARKING_BOUNDS.minX, PARKING_BOUNDS.maxX - 0.5),
      0,
      THREE.MathUtils.clamp(sideZ, PARKING_BOUNDS.minZ + 0.5, PARKING_BOUNDS.maxZ - 0.5)
    );
    this.driverChar.root.position.copy(this.walkerPos);
    this.driverChar.root.visible = true;
    this.targetOrbitLookAt.set(this.walkerPos.x, 1.38, this.walkerPos.z);
    this.targetOrbitRadius = 4.2;
    this.emitHud();
  }

  private pickNearestBayX(x: number): number {
    let best = TUNER_BAY_X_CENTERS[1];
    let bestDist = Infinity;
    for (const bx of TUNER_BAY_X_CENTERS) {
      const d = Math.abs(x - bx);
      if (d < bestDist) {
        bestDist = d;
        best = bx;
      }
    }
    return best;
  }

  private enterNearestTuningBayFromDrive(snapX?: number) {
    const bayX = this.pickNearestBayX(snapX ?? this.parkedCarPos.x);
    this.activeTuningBayX = bayX;
    this.parkingSpeedMs = 0;
    this.suspPitch = 0;
    this.suspRoll = 0;
    this.frontSteerAngle = 0;
    this.inTuningBay = true;
    this.enteredTuningByCar = true;
    this.mode = 'WALKING';
    this.driverChar.root.visible = false;
    this.setStudioFocusZone('TUNING', bayX);
    this.onEnterTuningBayCallback?.();
  }

  public spawnCarInFrontOfPlayer() {
    this.audio.unlock();
    this.exitPointerLock();
    this.tuningDrawerOpen = false;
    this.inTuningBay = false;
    this.enteredTuningByCar = false;
    this.previewCarId = null;
    this.previewAutoSpin = false;
    this.focusZone = 'GARAGE';

    if (this.walkerPos.z < 2.2 && this.walkerPos.x >= 38.0) {
      this.walkerPos.set(51.0, 0, 5.2);
      this.walkerRotY = Math.PI;
      this.driverChar.root.position.copy(this.walkerPos);
      this.driverChar.root.rotation.y = this.walkerRotY;
    }

    const fwdX = -Math.sin(this.walkerRotY);
    const fwdZ = -Math.cos(this.walkerRotY);
    const spawnX = THREE.MathUtils.clamp(this.walkerPos.x + fwdX * 4.3, 24.5, 61.5);
    const spawnZ = THREE.MathUtils.clamp(this.walkerPos.z + fwdZ * 4.3, 2.5, 26.2);

    const spawnRotY = this.walkerRotY + Math.PI * 0.65;
    this.parkedCarPos.set(spawnX, 0.015, spawnZ);
    this.targetParkedCarPos.copy(this.parkedCarPos);
    this.parkedCarRotY = spawnRotY;
    this.targetParkedCarRotY = spawnRotY;

    this.mode = 'WALKING';
    this.driverChar.root.visible = true;
    this.rebuildParkedCar();
    this.spawnPulseTimer = 1.0;
    this.audio.playSpawnChime();

    this.targetOrbitLookAt.set(
      (this.walkerPos.x + spawnX) * 0.5,
      1.05,
      (this.walkerPos.z + spawnZ) * 0.5
    );
    this.targetOrbitRadius = 5.4;
    this.emitHud();
  }

  public previewDealershipCar(carId: string | null) {
    if (!carId) {
      this.previewCarId = null;
      this.previewAutoSpin = false;
      if (this.focusZone === 'DEALERSHIP') {
        this.targetOrbitLookAt.set(
          DEALERSHIP_FOCUS_POS.x,
          DEALERSHIP_FOCUS_POS.y,
          DEALERSHIP_FOCUS_POS.z
        );
        this.targetOrbitRadius = 11.2;
      }
      return;
    }

    const entry = this.world.showcaseEntries.find((e) => e.carId === carId);
    if (!entry) return;

    this.mode = 'WALKING';
    this.focusZone = 'DEALERSHIP';
    this.previewCarId = carId;
    this.previewAutoSpin = true;
    this.orbitVelTheta = 0;
    this.orbitVelPhi = 0;
    this.targetOrbitLookAt.set(entry.x, 0.72, entry.z);
    this.targetOrbitRadius = 4.65;
    this.targetPresetTheta = 0.68;
    this.targetPresetPhi = 1.26;
    this.emitHud();
  }

  public revDealershipCar(carId: string) {
    const spec = CAR_CATALOG[carId];
    if (!spec) return;
    const cylinders = CYLINDER_CONFIG_BY_CAR[carId] ?? 'I6';
    this.audio.playEngineRevPreview(spec.baseHp, cylinders);
  }

  public setStudioFocusZone(zone: StudioFocusZone, bayX?: number) {
    this.focusZone = zone;
    this.orbitVelTheta = 0;
    this.orbitVelPhi = 0;

    if (zone === 'TUNING') {
      const targetBayX = bayX ?? this.activeTuningBayX ?? TUNER_BAY_POS.x;
      this.activeTuningBayX = targetBayX;
      this.tuningDrawerOpen = true;
      this.inTuningBay = true;
      this.previewCarId = null;
      this.previewAutoSpin = false;
      this.driverChar.root.visible = false;
      this.targetParkedCarPos.set(targetBayX, 0.015, TUNER_BAY_POS.z);
      this.targetParkedCarRotY = Math.PI + 0.14;
      this.targetOrbitLookAt.set(targetBayX + 0.35, 0.72, TUNER_BAY_POS.z);
      this.targetOrbitRadius = 4.9;
      this.targetPresetTheta = 0.42;
      this.targetPresetPhi = 1.28;
    } else if (zone === 'DEALERSHIP') {
      this.tuningDrawerOpen = false;
      this.inTuningBay = false;
      this.targetOrbitLookAt.set(
        DEALERSHIP_FOCUS_POS.x,
        DEALERSHIP_FOCUS_POS.y,
        DEALERSHIP_FOCUS_POS.z
      );
      this.targetOrbitRadius = 11.4;
      this.targetPresetTheta = 0.18;
      this.targetPresetPhi = 1.28;
    } else {
      this.tuningDrawerOpen = false;
      this.inTuningBay = false;
      this.previewCarId = null;
      this.previewAutoSpin = false;
      this.targetOrbitRadius = 4.3;
      this.targetPresetTheta = null;
      this.targetPresetPhi = null;

      if (this.enteredTuningByCar) {
        this.enteredTuningByCar = false;
        this.parkedCarPos.set(this.activeTuningBayX, 0.015, 1.5);
        this.targetParkedCarPos.copy(this.parkedCarPos);
        this.parkedCarRotY = Math.PI;
        this.targetParkedCarRotY = Math.PI;
        this.mode = 'PARKING_DRIVE';
        this.driverChar.root.visible = false;
      } else {
        if (this.parkedCarPos.z < -1.8) {
          this.targetParkedCarPos.set(
            PARKING_PLAYER_CAR_POS.x,
            0.015,
            PARKING_PLAYER_CAR_POS.z
          );
          this.targetParkedCarRotY = PARKING_PLAYER_CAR_POS.rotY;
        }
        if (this.mode === 'WALKING') {
          this.driverChar.root.visible = true;
        }
      }
    }
    this.emitHud();
  }

  public setTuningDrawerOpen(open: boolean) {
    this.setStudioFocusZone(open ? 'TUNING' : 'GARAGE');
  }

  public setStudioAngle(preset: StudioAnglePreset) {
    if (this.mode !== 'WALKING') return;
    this.orbitVelTheta = 0;
    this.orbitVelPhi = 0;
    this.previewAutoSpin = false;
    if (this.focusZone === 'DEALERSHIP' && this.previewCarId) {
      const entry = this.world.showcaseEntries.find((e) => e.carId === this.previewCarId);
      if (entry) {
        this.targetOrbitLookAt.set(entry.x, 0.72, entry.z);
      }
    } else {
      this.targetOrbitLookAt.set(this.parkedCarPos.x, 0.72, this.parkedCarPos.z);
    }

    if (preset === 'front34') {
      this.targetPresetTheta = 0.75;
      this.targetPresetPhi = 1.28;
      this.targetOrbitRadius = 5.1;
    } else if (preset === 'side') {
      this.targetPresetTheta = Math.PI * 0.5;
      this.targetPresetPhi = 1.38;
      this.targetOrbitRadius = 5.0;
    } else if (preset === 'rear34') {
      this.targetPresetTheta = Math.PI - 0.55;
      this.targetPresetPhi = 1.26;
      this.targetOrbitRadius = 5.1;
    } else {
      this.targetPresetTheta = 0.45;
      this.targetPresetPhi = 0.72;
      this.targetOrbitRadius = 6.0;
    }
  }

  public zoomStudioCamera(delta: number) {
    if (this.mode !== 'WALKING') return;
    this.targetOrbitRadius = THREE.MathUtils.clamp(this.targetOrbitRadius + delta, 2.8, 12.5);
  }

  public setTouchControl(key: keyof MidnightEngine['touchControls'], active: boolean) {
    this.audio.unlock();
    this.touchControls[key] = active;
  }

  public shiftGear(delta: 1 | -1) {
    if (this.mode !== 'HIGHWAY') return;
    if (this.getActiveCarTransmission() !== 'MT') return;

    const { spec, carState } = this.getActiveCarState();
    const maxRpm = getCarEffectiveMaxRpm(spec, carState);

    let nextGear = THREE.MathUtils.clamp(this.gear + delta, -1, 6);
    // Block shifting directly into Reverse while moving quickly forward
    if (nextGear === -1 && this.speedMs > 5.0) {
      nextGear = 0;
    }
    if (nextGear !== this.gear) {
      const prevGear = this.gear;
      this.gear = nextGear;

      if (nextGear > 0 && prevGear > 0) {
        const ratioChange = GEAR_RATIOS[nextGear] / GEAR_RATIOS[prevGear];
        this.rpm = THREE.MathUtils.clamp(this.rpm * ratioChange, IDLE_RPM, maxRpm);
        if (delta > 0 && (carState.upgrades.turbo >= 1 || spec.baseHp >= 280)) {
          this.audio.playShiftBov();
        }
        if (delta > 0 && carState.cdiRacing && this.rpm > maxRpm * 0.55) {
          this.triggerBackfire(0.75);
        }
      } else if (nextGear === 0) {
        // Clutch disengaged in Neutral
        this.rpm = Math.max(IDLE_RPM, this.rpm * 0.65);
      } else if (nextGear === 1 && prevGear <= 0) {
        this.rpm = Math.max(IDLE_RPM + 350, this.rpm);
      }
      this.emitHud();
    }
  }

  public toggleTransmission() {
    const carId = this.profile.activeCarId;
    const currentCar = this.profile.cars[carId];
    const currTx = currentCar?.transmission ?? this.profile.transmission;
    const next: TransmissionMode = currTx === 'AT' ? 'MT' : 'AT';

    const updatedCars = currentCar
      ? {
          ...this.profile.cars,
          [carId]: {
            ...currentCar,
            transmission: next,
          },
        }
      : this.profile.cars;

    this.profile = {
      ...this.profile,
      transmission: next,
      cars: updatedCars,
    };
    if (next === 'AT' && this.gear === 0) {
      this.gear = this.speedMs < -0.2 ? -1 : 1;
    }
    this.onProfileChange(this.profile);
  }

  public cycleCameraPreset() {
    const order: CameraPreset[] = ['CHASE', 'HOOD', 'BUMPER'];
    const idx = (order.indexOf(this.cameraPreset) + 1) % order.length;
    this.cameraPreset = order[idx];
    this.freeCamYaw = 0;
    this.freeCamPitch = 0;
    this.emitHud();
  }

  public rebuildShowroomCar() {
    this.rebuildParkedCar();
  }

  private rebuildParkedCar() {
    if (this.parkedPlayerCar) {
      this.world.group.remove(this.parkedPlayerCar.root);
      this.parkedPlayerCar.dispose();
      this.parkedPlayerCar = null;
    }
    const { spec, carState } = this.getActiveCarState();
    this.parkedPlayerCar = buildCompositeVehicle({
      style: spec.bodyStyle,
      paintHex: carState.paint,
      paintFinish: carState.paintFinish,
      rimHex: carState.rimColor,
      rimDesign: carState.rimDesign,
      tireProfile: carState.tireProfile,
      underglowHex: carState.underglow,
      textures: this.textures,
      isSoftwareGl: this.isSoftwareGl,
      upgrades: carState.upgrades,
      spoilerOverride: carState.spoiler,
      frontBumper: carState.frontBumper,
      diffuser: carState.diffuser,
      sportSteering: carState.sportSteering,
      starlightRoof: carState.starlightRoof,
      plateText: carState.plateText,
      windowTint: carState.windowTint,
    });
    this.parkedPlayerCar.root.position.copy(this.parkedCarPos);
    this.parkedPlayerCar.root.rotation.y = this.parkedCarRotY;
    this.parkedPlayerCar.root.visible = this.mode !== 'HIGHWAY';
    this.parkedPlayerCar.setHeadlightsOn(
      this.mode === 'START_MENU' || this.mode === 'PARKING_DRIVE'
    );
    this.world.group.add(this.parkedPlayerCar.root);
  }

  public refreshShowroomCarAppearance() {
    if (!this.parkedPlayerCar) return;
    const carState = this.profile.cars[this.profile.activeCarId] ?? this.profile.cars.kuruma_2008;
    this.parkedPlayerCar.paintMat.color.set(carState.paint);
    this.parkedPlayerCar.applyPaintFinish(carState.paintFinish ?? 'gloss');
    this.parkedPlayerCar.rimMat.color.set(carState.rimColor);
    this.parkedPlayerCar.applyWindowTint(carState.windowTint ?? 'smoke');
    this.parkedPlayerCar.updatePlateText(carState.plateText ?? 'GSTDVR');
    const hasUg = carState.underglow !== 'none';
    const ugHex = carState.underglow === 'pulse_neon' ? '#38bdf8' : carState.underglow;
    this.parkedPlayerCar.underglowMesh.visible = hasUg;
    this.parkedPlayerCar.underglowMat.color.set(hasUg ? ugHex : '#000000');
    this.parkedPlayerCar.underglowMat.opacity = hasUg ? 0.88 : 0;
    if (this.parkedPlayerCar.underglowLight) {
      this.parkedPlayerCar.underglowLight.color.set(hasUg ? ugHex : '#0ea5e9');
      this.parkedPlayerCar.underglowLight.intensity = hasUg ? 2.4 : 0;
    }
  }

  private triggerBackfire(intensity = 0.9) {
    if (this.backfireCooldown > 0) return;
    const { carState } = this.getActiveCarState();
    if (!carState?.cdiRacing) return;
    const exhaustStage = carState.upgrades?.exhaust ?? 0;
    this.backfireTimer = 0.24;
    this.backfireCooldown = 0.08 + Math.random() * 0.07;
    this.audio.playBackfirePop(intensity, exhaustStage);
    this.onlineClient?.sendBackfire();
  }

  /**
   * Seamless transition when the player physically drives their car out of the Parking onto the Closed-Loop Highway!
   */
  public enterHighway(fromParkingDrive = false) {
    this.audio.unlock();
    this.resetParticles();
    this.mode = 'HIGHWAY';
    this.tuningDrawerOpen = false;
    this.inTuningBay = false;
    this.enteredTuningByCar = false;
    this.previewCarId = null;
    this.previewAutoSpin = false;
    this.focusZone = 'GARAGE';
    this.driverChar.root.visible = false;
    this.suspPitch = 0;
    this.suspRoll = 0;
    this.frontSteerAngle = 0;
    this.activeWingDeploy = 0;
    this.revLimiterActive = false;
    this.backfireTimer = 0;
    this.backfireCooldown = 0;
    this.prevThrottleHeld = false;

    if (this.parkedPlayerCar) {
      this.parkedPlayerCar.root.visible = false;
    }

    if (this.highwayPlayerCar) {
      this.world.group.remove(this.highwayPlayerCar.root);
      this.highwayPlayerCar.dispose();
      this.highwayPlayerCar = null;
    }
    const { spec, carState } = this.getActiveCarState();
    this.highwayPlayerCar = buildCompositeVehicle({
      style: spec.bodyStyle,
      paintHex: carState.paint,
      paintFinish: carState.paintFinish,
      rimHex: carState.rimColor,
      rimDesign: carState.rimDesign,
      tireProfile: carState.tireProfile,
      underglowHex: carState.underglow,
      textures: this.textures,
      isSoftwareGl: this.isSoftwareGl,
      upgrades: carState.upgrades,
      spoilerOverride: carState.spoiler,
      frontBumper: carState.frontBumper,
      diffuser: carState.diffuser,
      sportSteering: carState.sportSteering,
      starlightRoof: carState.starlightRoof,
      plateText: carState.plateText,
      windowTint: carState.windowTint,
    });
    this.highwayPlayerCar.setHeadlightsOn(true);
    this.world.group.add(this.highwayPlayerCar.root);

    const track = this.world.track;

    if (fromParkingDrive) {
      this.playerX = this.parkedCarPos.x;
      this.playerZ = this.parkedCarPos.z;
      this.playerY = getRampElevationAtZ(this.playerZ) + 0.015;
      this.onRamp = true;
      track.projectToTrack(this.playerX, this.playerZ, null, this._proj);
      this.playerS = this._proj.s;
      this.laneOffset = this._proj.laneOffset;

      let headingDiff = this.parkedCarRotY - this._proj.yaw;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      this.highwayHeadingOffset = headingDiff;
      this.steerInputSmoothed = 0;
      this.mergeGraceTimer = 1.65;
      this.speedMs =
        Math.abs(this.parkingSpeedMs) < 1.5
          ? 2.5
          : this.parkingSpeedMs;
      this.highwayPlayerCar.root.rotation.set(0, this._proj.yaw + this.highwayHeadingOffset, 0);
      this.launchTransitionTimer = 0;
    } else {
      track.projectToTrack(7.6, -4, null, this._proj);
      this.playerS = this._proj.s;
      this.laneOffset = 7.6;
      this.playerX = this._proj.cx + this._proj.rx * this.laneOffset;
      this.playerZ = this._proj.cz + this._proj.rz * this.laneOffset;
      this.playerY = HIGHWAY_Y + 0.015;
      this.onRamp = false;
      this.highwayHeadingOffset = 0;
      this.steerInputSmoothed = 0;
      this.mergeGraceTimer = 0;
      this.speedMs = 22;
      this.highwayPlayerCar.root.rotation.set(0, this._proj.yaw, 0);
      this.launchTransitionTimer = this.launchTransitionDuration;
    }

    this.gear = this.speedMs > 24 ? 2 : 1;
    this.rpm = 3800;
    this.nitro = 100;
    this.combo = 0;
    this.comboTimer = 0;
    this.sessionEarnings = 0;
    this.distanceMeters = 0;
    this.nearMissBanner = null;
    this.crashBanner = null;
    this.crashCooldown = 0;
    this.missionProgress = 0;
    this.missionBanner = null;

    this.highwayPlayerCar.root.position.set(this.playerX, this.playerY, this.playerZ);

    this.resetTrafficPositions(this.playerS, true);

    if (!fromParkingDrive) {
      this.camera.fov = Math.max(55, this.settings.fov * 0.85);
      this.camera.updateProjectionMatrix();
    }
    this.emitHud();
  }

  private returnToParkingFromHighway() {
    this.bankPendingCash(true);
    this.resetParticles();
    this.mode = 'PARKING_DRIVE';
    this.onRamp = false;
    if (this.highwayPlayerCar) {
      this.highwayPlayerCar.setInteriorCockpitMode(false);
      this.highwayPlayerCar.root.visible = false;
    }
    if (this.parkedPlayerCar) {
      this.parkedPlayerCar.root.visible = true;
    }
    this.parkedCarPos.set(
      THREE.MathUtils.clamp(this.playerX, 22.8, 56.0),
      0.015,
      THREE.MathUtils.clamp(this.playerZ, 11.4, 24.6)
    );
    this.targetParkedCarPos.copy(this.parkedCarPos);
    this.world.track.sampleAtS(this.playerS, this._sample);
    this.parkedCarRotY = this._sample.yaw + this.highwayHeadingOffset;
    this.targetParkedCarRotY = this.parkedCarRotY;
    this.parkingSpeedMs = THREE.MathUtils.clamp(this.speedMs, -8, 22);
    this.revLimiterActive = false;
    this.emitHud();
  }

  public exitToShowroom() {
    this.bankPendingCash(true);
    this.resetParticles();
    this.contractActive = false;
    this.mode = 'WALKING';
    this.onRamp = false;
    if (this.highwayPlayerCar) {
      this.highwayPlayerCar.setInteriorCockpitMode(false);
      this.highwayPlayerCar.root.visible = false;
    }
    this.launchTransitionTimer = 0;
    this.parkingSpeedMs = 0;
    this.speedMs = 0;
    this.suspPitch = 0;
    this.suspRoll = 0;
    this.frontSteerAngle = 0;
    this.activeWingDeploy = 0;
    this.revLimiterActive = false;
    this.freeCamYaw = 0;
    this.freeCamPitch = 0;
    this.inTuningBay = false;
    this.enteredTuningByCar = false;
    this.parkedCarPos.set(
      PARKING_PLAYER_CAR_POS.x,
      0.015,
      PARKING_PLAYER_CAR_POS.z
    );
    this.targetParkedCarPos.copy(this.parkedCarPos);
    this.parkedCarRotY = PARKING_PLAYER_CAR_POS.rotY;
    this.targetParkedCarRotY = PARKING_PLAYER_CAR_POS.rotY;

    this.walkerPos.set(31.0, 0, 14.2);
    this.driverChar.root.position.copy(this.walkerPos);
    this.driverChar.root.visible = true;
    this.setStudioFocusZone('GARAGE');
    this.rebuildParkedCar();
    const homeS = this.world.track.projectToTrack(0, 0, null, this._proj).s;
    this.resetTrafficPositions(homeS, false);
    this.camera.fov = this.settings.fov * 0.72;
    this.camera.updateProjectionMatrix();
    this.emitHud();
  }

  // ==================== ASSETTO CORSA SUSPENSION, BRAKE LIGHTS & ACTIVE AERO ====================

  private updateVehicleDynamicsAndLights(
    vehicle: BuiltVehicle,
    steerInput: number,
    accelNorm: number,
    speedMs: number,
    isBraking: boolean,
    dt: number,
    wheelDirSign: number
  ) {
    const absSpeed = Math.abs(speedMs);
    const speedFactor = Math.min(1, absSpeed / 16);
    const targetFrontSteer = steerInput * 0.42 * (1 - speedFactor * 0.46);
    this.frontSteerAngle = THREE.MathUtils.damp(this.frontSteerAngle, targetFrontSteer, 12, dt);

    const { carState } = this.getActiveCarState();
    const suspStiffness = 1 - Math.min(3, Math.max(0, carState?.upgrades?.suspension ?? 0)) * 0.14;
    const targetRoll = -steerInput * speedFactor * 0.044 * suspStiffness;
    const targetPitch = accelNorm * 0.028 * suspStiffness;
    this.suspRoll = THREE.MathUtils.damp(this.suspRoll, targetRoll, 9.5, dt);
    this.suspPitch = THREE.MathUtils.damp(this.suspPitch, targetPitch, 9.5, dt);

    vehicle.chassisGroup.rotation.z = this.suspRoll;
    vehicle.chassisGroup.rotation.x = this.suspPitch;

    for (let i = 0; i < vehicle.wheels.length; i++) {
      const w = vehicle.wheels[i];
      w.rotation.x += wheelDirSign * (speedMs / 0.33) * dt;
      if (i < 2) {
        w.rotation.y = this.frontSteerAngle;
      }
    }

    // Dynamic Brake Taillights
    const targetBrakeIntensity = isBraking ? 3.8 : 1.5;
    vehicle.tailLedMat.emissiveIntensity = THREE.MathUtils.lerp(
      vehicle.tailLedMat.emissiveIntensity,
      targetBrakeIntensity,
      0.32
    );

    // Deployable Active Rear Aero Wing (lifts above 115 km/h & pitches steeply on braking)
    if (vehicle.activeWingGroup) {
      const deployTarget = absSpeed > 32 ? 1 : 0;
      this.activeWingDeploy = THREE.MathUtils.damp(this.activeWingDeploy, deployTarget, 6.5, dt);
      const airbrakePitch = isBraking && absSpeed > 18 ? 0.24 : 0;
      vehicle.activeWingGroup.position.y =
        vehicle.activeWingBaseY + this.activeWingDeploy * 0.095;
      vehicle.activeWingGroup.rotation.x = THREE.MathUtils.damp(
        vehicle.activeWingGroup.rotation.x,
        vehicle.activeWingBaseRotX - this.activeWingDeploy * 0.06 - airbrakePitch,
        9.0,
        dt
      );
    }

    // Subtle Idle Engine Vibration + Thermal Brake Glow + Cockpit Telemetry + Chameleon/Pulse Neon
    const speedKmh = absSpeed * 3.6;
    const isCockpitCam =
      this.cameraPreset === 'HOOD' &&
      (this.mode === 'HIGHWAY' || this.mode === 'PARKING_DRIVE');

    if (isBraking && speedKmh > 55) {
      this.brakeHeat = Math.min(1, this.brakeHeat + dt * 1.45);
    } else {
      this.brakeHeat = Math.max(0, this.brakeHeat - dt * 0.42);
    }
    vehicle.setBrakeHeat(this.brakeHeat);
    vehicle.flashHighBeams(this.highBeamFlashTimer > 0);
    vehicle.setInteriorCockpitMode(isCockpitCam);
    if (isCockpitCam) {
      const { spec } = this.getActiveCarState();
      vehicle.updateCockpit(
        this.frontSteerAngle,
        this.rpm,
        getCarEffectiveMaxRpm(spec, carState),
        speedKmh,
        this.gear,
        this.nitro
      );
    }
    vehicle.chassisGroup.position.y =
      Math.sin(this.elapsedSeconds * 44) * (accelNorm > 0.2 ? 0.0028 : 0.0014);
    vehicle.updateVisualPulse(
      this.elapsedSeconds,
      carState.paintFinish === 'chameleon',
      carState.underglow === 'pulse_neon'
    );
  }

  private updateSpawnPulse(dt: number) {
    if (!this.parkedPlayerCar) return;
    if (this.spawnPulseTimer > 0) {
      this.spawnPulseTimer = Math.max(0, this.spawnPulseTimer - dt * 1.15);
      const t = 1 - this.spawnPulseTimer;
      const pulse = Math.sin(t * Math.PI * 3) > 0 ? 1 : 0.25;
      this.parkedPlayerCar.headLedMat.emissiveIntensity = 0.9 + pulse * 1.4;
      if (this.parkedPlayerCar.spawnRingMesh) {
        this.parkedPlayerCar.spawnRingMesh.visible = true;
        const s = 1 + t * 2.2;
        this.parkedPlayerCar.spawnRingMesh.scale.set(s, s, 1);
        (this.parkedPlayerCar.spawnRingMesh.material as THREE.MeshBasicMaterial).opacity =
          this.spawnPulseTimer * 0.85;
      }
    } else {
      this.parkedPlayerCar.headLedMat.emissiveIntensity = 1.15;
      if (this.parkedPlayerCar.spawnRingMesh) {
        this.parkedPlayerCar.spawnRingMesh.visible = false;
      }
    }
  }

  // ==================== MAIN LOOP ====================

  private startLoop() {
    const tick = () => {
      if (this.disposed) return;
      const realDt = Math.min(this.clock.getDelta(), 0.05);
      this.elapsedSeconds += realDt;

      if (this.highBeamFlashTimer > 0) {
        this.highBeamFlashTimer = Math.max(0, this.highBeamFlashTimer - realDt);
      }
      if (this.radarFlashTimer > 0) {
        this.radarFlashTimer = Math.max(0, this.radarFlashTimer - realDt);
        this.radarFlashOpacity = Math.max(0, this.radarFlashTimer / 0.24);
      } else {
        this.radarFlashOpacity = 0;
      }
      if (this.radarResultTimer > 0) {
        this.radarResultTimer = Math.max(0, this.radarResultTimer - realDt);
        if (this.radarResultTimer <= 0) this.radarResultBanner = null;
      }
      if (this.extremeRoceBannerTimer > 0) {
        this.extremeRoceBannerTimer = Math.max(0, this.extremeRoceBannerTimer - realDt);
        if (this.extremeRoceBannerTimer <= 0) this.extremeRoceBanner = null;
      }
      if (this.contractBannerTimer > 0) {
        this.contractBannerTimer = Math.max(0, this.contractBannerTimer - realDt);
        if (this.contractBannerTimer <= 0) this.contractBanner = null;
      }
      if (this.duelBannerTimer > 0) {
        this.duelBannerTimer = Math.max(0, this.duelBannerTimer - realDt);
        if (this.duelBannerTimer <= 0 && this.duelState && this.duelState.remainingSec <= 0) {
          this.duelState = null;
        }
      }

      // Bullet Time timeScale (0.34 during "¡ROCE MORTAL!")
      let simDt = realDt;
      if (this.bulletTimeTimer > 0) {
        this.bulletTimeTimer = Math.max(0, this.bulletTimeTimer - realDt);
        simDt = realDt * 0.34;
      }

      if (this.mode === 'START_MENU') {
        this.updateStartMenu(realDt);
      } else if (this.mode === 'WALKING') {
        this.updateWalking(realDt);
      } else if (this.mode === 'PARKING_DRIVE') {
        this.updateParkingDrive(realDt);
      } else {
        this.updateHighway(simDt, realDt);
      }

      this.updateRemoteVehicles(realDt);
      this.updateParticles(simDt);
      this.pushOnlineState(realDt);

      if (this.composer && !this.isSoftwareGl && this.settings.graphicsQuality !== 'LOW') {
        this.composer.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }

      this.hudEmitAccum += realDt;
      if (this.hudEmitAccum >= 0.055) {
        this.hudEmitAccum = 0;
        this.emitHud();
      }

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    this.frameId = requestAnimationFrame(tick);
  }

  private afterDraw(cb: () => void) {
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 75);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } catch {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private updateAmbientTraffic(dt: number) {
    const track = this.world.track;
    for (const t of this.trafficPool) {
      if (t.isOncoming) {
        t.s = track.wrapS(t.s - t.speedMs * dt);
      } else {
        t.s = track.wrapS(t.s + t.speedMs * dt);
      }
      track.sampleAtS(t.s, this._sample);
      const wx = this._sample.x + this._sample.rx * t.laneX;
      const wz = this._sample.z + this._sample.rz * t.laneX;
      t.vehicle.root.position.set(wx, HIGHWAY_Y + 0.015, wz);
      t.vehicle.root.rotation.y = this._sample.yaw + (t.isOncoming ? Math.PI : 0);

      const dir = t.isOncoming ? 1 : -1;
      for (const w of t.vehicle.wheels) {
        w.rotation.x += dir * (t.speedMs / 0.34) * dt;
      }
    }
  }

  private updateStartMenu(dt: number) {
    const isStorm = false;
    this.startMenuTime += dt;
    this.audio.update({
      dt,
      inCar: false,
      rpmRatio: 0,
      throttle: false,
      nitroActive: false,
      isStorm,
    });

    this.updateAmbientTraffic(dt);
    this.world.updateScroll(42, 16, 0, 12, dt, isStorm, true);

    // Nocturnal Paddock Lobby shot:
    // Foreground-left: player's equipped car on worn asphalt with headlights illuminating pavement
    // Background: car carrier truck (left), stacked red/blue containers, 2 red tents + sports cars
    // Right: dark-green metallic wire-mesh fence & lush broadleaf trees behind
    const swayX = Math.sin(this.startMenuTime * 0.24) * 0.35;
    const swayZ = Math.cos(this.startMenuTime * 0.20) * 0.28;
    const camX = 27.6 + swayX;
    const camY = 2.42 + Math.sin(this.startMenuTime * 0.32) * 0.08;
    const camZ = 17.6 + swayZ;

    this.camera.fov = this.settings.fov * 0.68;
    this.camera.updateProjectionMatrix();
    this.camera.position.lerp(this._v1.set(camX, camY, camZ), 1 - Math.exp(-4.5 * dt));
    this._v2.set(53.5, 1.48, 18.2);
    this.camera.lookAt(this._v2);
  }

  private isWalkPointValid(x: number, z: number): boolean {
    for (const obs of PADDOCK_OBSTACLES) {
      if (x >= obs.minX && x <= obs.maxX && z >= obs.minZ && z <= obs.maxZ) {
        return false;
      }
    }

    const inParking =
      x >= PARKING_BOUNDS.minX &&
      x <= PARKING_BOUNDS.maxX &&
      z >= PARKING_BOUNDS.minZ &&
      z <= PARKING_BOUNDS.maxZ;
    if (inParking) return true;

    const inTaller = x >= 22.6 && x <= 37.6 && z >= -12.8 && z <= -1.2;
    if (inTaller) return true;

    const inDealership =
      x >= DEALERSHIP_INTERIOR_BOUNDS.minX &&
      x <= DEALERSHIP_INTERIOR_BOUNDS.maxX &&
      z >= DEALERSHIP_INTERIOR_BOUNDS.minZ &&
      z <= DEALERSHIP_INTERIOR_BOUNDS.maxZ;
    if (inDealership) return true;

    const inInteriorConnect =
      x >= INTERIOR_CONNECT_BOUNDS.minX &&
      x <= INTERIOR_CONNECT_BOUNDS.maxX &&
      z >= INTERIOR_CONNECT_BOUNDS.minZ &&
      z <= INTERIOR_CONNECT_BOUNDS.maxZ;
    if (inInteriorConnect) return true;

    const inDoorBridge =
      x >= WALK_DOOR_BOUNDS.minX &&
      x <= WALK_DOOR_BOUNDS.maxX &&
      z >= WALK_DOOR_BOUNDS.minZ &&
      z <= WALK_DOOR_BOUNDS.maxZ;
    return inDoorBridge;
  }

  private updateWalking(dt: number) {
    const isStorm = false;
    this.audio.update({
      dt,
      inCar: false,
      rpmRatio: 0,
      throttle: false,
      nitroActive: false,
      isStorm,
    });

    this.updateAmbientTraffic(dt);
    this.world.updateScroll(this.walkerPos.x, this.walkerPos.z, 0, 10, dt, isStorm, true);
    this.updateSpawnPulse(dt);

    this.parkedCarPos.lerp(this.targetParkedCarPos, 1 - Math.exp(-6.5 * dt));
    this.parkedCarRotY = THREE.MathUtils.lerp(
      this.parkedCarRotY,
      this.targetParkedCarRotY,
      1 - Math.exp(-6.5 * dt)
    );
    if (this.parkedPlayerCar) {
      this.parkedPlayerCar.root.position.copy(this.parkedCarPos);
      this.parkedPlayerCar.root.rotation.y = this.parkedCarRotY;
      this.parkedPlayerCar.chassisGroup.rotation.set(0, 0, 0);
      this.parkedPlayerCar.setInteriorCockpitMode(false);
      const { carState } = this.getActiveCarState();
      this.parkedPlayerCar.updateVisualPulse(
        this.elapsedSeconds,
        carState.paintFinish === 'chameleon',
        carState.underglow === 'pulse_neon'
      );
    }

    let moveSpeedNorm = 0;
    if (this.focusZone === 'GARAGE') {
      const forwardIn =
        (this.isActionHeld('accelerate') || this.touchControls.throttle ? 1 : 0) -
        (this.isActionHeld('brake') || this.touchControls.brake ? 1 : 0);
      const strafeIn =
        (this.isActionHeld('steerRight') || this.touchControls.right ? 1 : 0) -
        (this.isActionHeld('steerLeft') || this.touchControls.left ? 1 : 0);
      const sprinting = this.isActionHeld('nitro');

      if (forwardIn !== 0 || strafeIn !== 0) {
        moveSpeedNorm = sprinting ? 1.45 : 1.0;
        const camForwardX = -Math.sin(this.orbitTheta);
        const camForwardZ = -Math.cos(this.orbitTheta);
        const camRightX = Math.cos(this.orbitTheta);
        const camRightZ = -Math.sin(this.orbitTheta);

        let mx = camForwardX * forwardIn + camRightX * strafeIn;
        let mz = camForwardZ * forwardIn + camRightZ * strafeIn;
        const len = Math.hypot(mx, mz) || 1;
        mx /= len;
        mz /= len;

        const walkSpeed = sprinting ? 8.2 : 5.6;
        const stepX = this.walkerPos.x + mx * walkSpeed * dt;
        const stepZ = this.walkerPos.z + mz * walkSpeed * dt;

        if (this.isWalkPointValid(stepX, stepZ)) {
          this.walkerPos.set(stepX, 0, stepZ);
        } else if (this.isWalkPointValid(stepX, this.walkerPos.z)) {
          this.walkerPos.set(stepX, 0, this.walkerPos.z);
        } else if (this.isWalkPointValid(this.walkerPos.x, stepZ)) {
          this.walkerPos.set(this.walkerPos.x, 0, stepZ);
        }

        const targetYaw = Math.atan2(-mx, -mz);
        let diff = targetYaw - this.walkerRotY;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.walkerRotY += diff * (1 - Math.exp(-12 * dt));
      }

      this.targetOrbitLookAt.set(this.walkerPos.x, 1.38, this.walkerPos.z);
    }

    // Articulated knees/elbows/torso animation
    this.driverChar.updateMotion(moveSpeedNorm, dt);
    this.driverChar.root.position.copy(this.walkerPos);
    this.driverChar.root.rotation.y = this.walkerRotY;

    const distCar = Math.hypot(
      this.walkerPos.x - this.parkedCarPos.x,
      this.walkerPos.z - this.parkedCarPos.z
    );
    const distContract = Math.hypot(
      this.walkerPos.x - CONTRACT_POS.x,
      this.walkerPos.z - CONTRACT_POS.z
    );
    const distTuner = Math.hypot(
      this.walkerPos.x - TUNER_ENTRY_POS.x,
      this.walkerPos.z - TUNER_ENTRY_POS.z
    );
    const distDealer = Math.hypot(
      this.walkerPos.x - DEALERSHIP_ENTRY_POS.x,
      this.walkerPos.z - DEALERSHIP_ENTRY_POS.z
    );
    const distCounterBox = Math.hypot(
      this.walkerPos.x - DEALERSHIP_COUNTER_POS.x,
      this.walkerPos.z - DEALERSHIP_COUNTER_POS.z
    );
    const inTallerCyanZone =
      this.walkerPos.x >= 22.8 &&
      this.walkerPos.x <= 37.2 &&
      this.walkerPos.z <= -3.2 &&
      this.walkerPos.z >= -12.0;

    let closestShowcaseId: string | null = null;
    if (this.walkerPos.x >= 38.0 && this.walkerPos.z <= 2.4) {
      let bestDist = 3.8;
      for (const sc of this.world.showcaseEntries) {
        const d = Math.hypot(this.walkerPos.x - sc.x, this.walkerPos.z - sc.z);
        if (d < bestDist) {
          bestDist = d;
          closestShowcaseId = sc.carId;
        }
      }
    }
    this.nearbyDealershipCarId = closestShowcaseId;

    if (distCounterBox < 1.85) {
      this.nearbyZone = 'DEALERSHIP';
    } else if (this.walkerPos.x >= 38.2 && this.walkerPos.z <= 1.9) {
      this.nearbyZone = closestShowcaseId ? 'DEALERSHIP' : null;
    } else if (distContract < 2.65) {
      this.nearbyZone = 'CONTRACT';
    } else if (distCar < 3.6) {
      this.nearbyZone = 'CAR';
    } else if (distTuner < 4.4 || inTallerCyanZone) {
      this.nearbyZone = 'TUNING';
    } else if (distDealer < 4.4) {
      this.nearbyZone = 'DEALERSHIP';
    } else {
      this.nearbyZone = null;
    }

    if (this.targetPresetTheta !== null && this.targetPresetPhi !== null) {
      this.orbitTheta = THREE.MathUtils.damp(this.orbitTheta, this.targetPresetTheta, 7.5, dt);
      this.orbitPhi = THREE.MathUtils.damp(this.orbitPhi, this.targetPresetPhi, 7.5, dt);
      if (
        Math.abs(this.orbitTheta - this.targetPresetTheta) < 0.004 &&
        Math.abs(this.orbitPhi - this.targetPresetPhi) < 0.004
      ) {
        this.targetPresetTheta = null;
        this.targetPresetPhi = null;
      }
    } else if (
      this.focusZone === 'DEALERSHIP' &&
      this.previewAutoSpin &&
      !this.isDragging &&
      !this.pointerLocked
    ) {
      this.orbitTheta += 0.34 * dt;
    } else if (!this.isDragging && !this.pointerLocked) {
      this.orbitTheta += this.orbitVelTheta * dt;
      this.orbitPhi = THREE.MathUtils.clamp(
        this.orbitPhi + this.orbitVelPhi * dt,
        0.18,
        Math.PI * 0.49
      );
      const damping = Math.exp(-5.8 * dt);
      this.orbitVelTheta *= damping;
      this.orbitVelPhi *= damping;
    }

    this.orbitRadius = THREE.MathUtils.damp(this.orbitRadius, this.targetOrbitRadius, 7.5, dt);
    this.orbitLookAt.lerp(this.targetOrbitLookAt, 1 - Math.exp(-9.0 * dt));

    this.camera.fov = this.settings.fov * 0.72;
    this.camera.updateProjectionMatrix();
    this.camera.position.x =
      this.orbitLookAt.x + this.orbitRadius * Math.sin(this.orbitPhi) * Math.sin(this.orbitTheta);
    this.camera.position.y = Math.max(
      0.5,
      this.orbitLookAt.y + this.orbitRadius * Math.cos(this.orbitPhi)
    );
    this.camera.position.z =
      this.orbitLookAt.z + this.orbitRadius * Math.sin(this.orbitPhi) * Math.cos(this.orbitTheta);
    this.camera.lookAt(this.orbitLookAt);
  }

  /**
   * Real driving physics inside the Parking lot & Drive-In Taller Bays.
   */
  private updateParkingDrive(dt: number) {
    if (!this.parkedPlayerCar) return;
    const isStorm = false;
    const { spec, carState } = this.getActiveCarState();
    const maxRpm = getCarEffectiveMaxRpm(spec, carState);

    this.updateAmbientTraffic(dt);
    this.world.updateScroll(this.parkedCarPos.x, this.parkedCarPos.z, 0, 10, dt, isStorm, true);
    this.updateSpawnPulse(dt);

    const throttle = this.isActionHeld('accelerate') || this.touchControls.throttle;
    const brakeOrRev = this.isActionHeld('brake') || this.touchControls.brake;
    const steerLeft = this.isActionHeld('steerLeft') || this.touchControls.left;
    const steerRight = this.isActionHeld('steerRight') || this.touchControls.right;

    let accelNorm = 0;
    let isBraking = false;
    if (throttle) {
      if (this.parkingSpeedMs < 0) {
        this.parkingSpeedMs = Math.min(0, this.parkingSpeedMs + 30 * dt);
        accelNorm = 0.85;
      } else {
        this.parkingSpeedMs = Math.min(24, this.parkingSpeedMs + 14.5 * dt);
        accelNorm = 0.9;
      }
    } else if (brakeOrRev) {
      if (this.parkingSpeedMs > 0.35) {
        this.parkingSpeedMs = Math.max(0, this.parkingSpeedMs - 30 * dt);
        accelNorm = -1.05;
        isBraking = true;
      } else {
        this.parkingSpeedMs = Math.max(-35 / 3.6, this.parkingSpeedMs - 10 * dt);
        accelNorm = -0.5;
        isBraking = this.parkingSpeedMs > -0.2;
      }
    } else {
      const drag = 6.2 * dt;
      if (Math.abs(this.parkingSpeedMs) <= drag) {
        this.parkingSpeedMs = 0;
      } else {
        this.parkingSpeedMs -= Math.sign(this.parkingSpeedMs) * drag;
      }
    }

    const steerInput = (steerLeft ? 1 : 0) - (steerRight ? 1 : 0);
    if (Math.abs(this.parkingSpeedMs) > 0.25 && steerInput !== 0) {
      const dir = this.parkingSpeedMs >= 0 ? 1 : -1;
      const turnFactor = Math.min(1, Math.abs(this.parkingSpeedMs) / 6);
      this.parkedCarRotY +=
        steerInput * dir * 2.15 * turnFactor * this.settings.steeringSensitivity * dt;
    }

    const fwdX = -Math.sin(this.parkedCarRotY);
    const fwdZ = -Math.cos(this.parkedCarRotY);
    let nextX = this.parkedCarPos.x + fwdX * this.parkingSpeedMs * dt;
    let nextZ = this.parkedCarPos.z + fwdZ * this.parkingSpeedMs * dt;

    // 3 Taller Bays are along the left-back side (x = 22.4..37.6, z = -12..-2)
    const inTallerApron = nextX >= 22.4 && nextX <= 37.6;
    const minZLimit = inTallerApron ? -11.2 : -1.2;
    nextZ = THREE.MathUtils.clamp(nextZ, minZLimit, 27.8);
    nextX = Math.min(65.6, nextX);
    // Wide 14m open metallic barrier gateway at x = 22.0, z in [11.0 .. 25.0]
    const inBarrierGate = nextZ >= 11.0 && nextZ <= 25.0;
    if (!inBarrierGate && nextX < 22.6) {
      nextX = 22.6;
      this.parkingSpeedMs *= 0.6;
    }

    // Slide cleanly around Paddock props (carrier truck, stacked containers, red tents, leaderboard)
    const carPad = 1.25;
    for (const obs of PADDOCK_OBSTACLES) {
      const minX = obs.minX - carPad;
      const maxX = obs.maxX + carPad;
      const minZ = obs.minZ - carPad;
      const maxZ = obs.maxZ + carPad;
      if (nextX > minX && nextX < maxX && nextZ > minZ && nextZ < maxZ) {
        const dL = nextX - minX;
        const dR = maxX - nextX;
        const dT = nextZ - minZ;
        const dB = maxZ - nextZ;
        const m = Math.min(dL, dR, dT, dB);
        if (m === dL) nextX = minX;
        else if (m === dR) nextX = maxX;
        else if (m === dT) nextZ = minZ;
        else nextZ = maxZ;
        this.parkingSpeedMs *= 0.55;
      }
    }

    this.parkedCarPos.set(nextX, 0.015, nextZ);
    this.targetParkedCarPos.copy(this.parkedCarPos);
    this.targetParkedCarRotY = this.parkedCarRotY;

    this.parkedPlayerCar.root.position.copy(this.parkedCarPos);
    this.parkedPlayerCar.root.rotation.y = this.parkedCarRotY;

    this.updateVehicleDynamicsAndLights(
      this.parkedPlayerCar,
      steerInput,
      accelNorm,
      this.parkingSpeedMs,
      isBraking,
      dt,
      -1
    );

    const absSpeed = Math.abs(this.parkingSpeedMs);
    this.speedMs = this.parkingSpeedMs;
    this.rpm = THREE.MathUtils.lerp(
      this.rpm,
      IDLE_RPM + (absSpeed / 22) * (maxRpm * 0.62) + (throttle ? 800 : 0),
      0.22
    );
    this.gear = this.parkingSpeedMs < -0.2 ? -1 : absSpeed < 0.2 ? 0 : absSpeed > 14 ? 2 : 1;

    this.audio.update({
      dt,
      inCar: true,
      rpmRatio: (this.rpm - IDLE_RPM) / Math.max(1000, maxRpm - IDLE_RPM),
      throttle,
      nitroActive: false,
      isStorm,
    });

    if (!this.pointerLocked && !this.isDragging) {
      this.freeCamYaw = THREE.MathUtils.damp(this.freeCamYaw, 0, 5.5, dt);
      this.freeCamPitch = THREE.MathUtils.damp(this.freeCamPitch, 0, 5.5, dt);
    }

    if (inTallerApron && nextZ <= -4.8 && !this.inTuningBay) {
      this.enterNearestTuningBayFromDrive(nextX);
      return;
    }

    if (nextX <= 21.7 && inBarrierGate) {
      this.enterHighway(true);
      return;
    }

    const camYaw = this.parkedCarRotY + this.freeCamYaw;
    const lookTargetY = this.cameraPreset === 'CHASE' ? 1.0 : 1.15;
    this._v2.set(this.parkedCarPos.x, lookTargetY, this.parkedCarPos.z);

    if (this.cameraPreset === 'HOOD' && this.parkedPlayerCar) {
      this.parkedPlayerCar.chassisGroup.localToWorld(this._v1.set(-0.30, 1.03, 0.22));
      this.camera.position.copy(this._v1);
      const lookX = this._v1.x - Math.sin(camYaw) * Math.cos(this.freeCamPitch) * 20;
      const lookY = this._v1.y + Math.sin(this.freeCamPitch) * 14;
      const lookZ = this._v1.z - Math.cos(camYaw) * Math.cos(this.freeCamPitch) * 20;
      this.camera.lookAt(lookX, lookY, lookZ);
    } else if (this.cameraPreset === 'BUMPER') {
      const bumpX = this.parkedCarPos.x + fwdX * 2.05;
      const bumpZ = this.parkedCarPos.z + fwdZ * 2.05;
      this.camera.position.set(bumpX, 0.68, bumpZ);
      const lookX = bumpX - Math.sin(camYaw) * Math.cos(this.freeCamPitch) * 20;
      const lookY = 0.68 + Math.sin(this.freeCamPitch) * 14;
      const lookZ = bumpZ - Math.cos(camYaw) * Math.cos(this.freeCamPitch) * 20;
      this.camera.lookAt(lookX, lookY, lookZ);
    } else {
      const dist = 6.2;
      const pitch = THREE.MathUtils.clamp(0.24 + this.freeCamPitch * 0.65, 0.04, 0.95);
      const targetCamX = this.parkedCarPos.x + Math.sin(camYaw) * Math.cos(pitch) * dist;
      const targetCamY = Math.max(0.65, 0.95 + Math.sin(pitch) * dist);
      const targetCamZ = this.parkedCarPos.z + Math.cos(camYaw) * Math.cos(pitch) * dist;
      this.camera.position.lerp(
        this._v1.set(targetCamX, targetCamY, targetCamZ),
        1 - Math.exp(-9 * dt)
      );
      this.camera.lookAt(this._v2);
    }

    this.camera.fov = this.settings.fov * 0.78;
    this.camera.updateProjectionMatrix();
  }

  private updateHighway(dt: number, realDt = dt) {
    if (!this.highwayPlayerCar) return;

    const track = this.world.track;
    const { spec, carState } = this.getActiveCarState();
    const hp = getCarEffectiveHp(spec, carState);
    const weightKg = getCarEffectiveWeight(spec, carState);
    const zeroTo100 = getCarEffectiveZeroToHundred(spec, carState);
    const maxRpm = getCarEffectiveMaxRpm(spec, carState);
    const isStorm = false;
    const activeTx = this.getActiveCarTransmission();

    const throttle = this.isActionHeld('accelerate') || this.touchControls.throttle;
    const brake = this.isActionHeld('brake') || this.touchControls.brake;
    const steerLeft = this.isActionHeld('steerLeft') || this.touchControls.left;
    const steerRight = this.isActionHeld('steerRight') || this.touchControls.right;
    const wantNitro = this.isActionHeld('nitro') || this.touchControls.nitro;

    const nitroUpLvl = Math.min(3, Math.max(0, carState.upgrades.nitroUp ?? 0));
    const brakeLvl = Math.min(3, Math.max(0, carState.upgrades.brakes ?? 0));
    const tireLvl = Math.min(3, Math.max(0, carState.upgrades.tires ?? 0));
    const suspLvl = Math.min(3, Math.max(0, carState.upgrades.suspension ?? 0));

    const nitroActive = wantNitro && this.nitro > 1 && throttle && this.gear > 0;
    if (nitroActive) {
      const drainRate = Math.max(7.5, 20 - carState.upgrades.ecu * 1.1 - nitroUpLvl * 2.4);
      this.nitro = Math.max(0, this.nitro - drainRate * dt);
    } else {
      this.nitro = Math.min(100, this.nitro + (3.5 + nitroUpLvl * 0.6) * dt);
    }

    const gearTopSpeeds = getGearTopSpeedsKmh(spec, carState, nitroActive);
    const pwrScale = hp / weightKg / 0.34;
    const tireLaunchBoost = 1 + tireLvl * 0.045;
    const launchScale = ((4.2 / Math.max(1.8, zeroTo100)) * 0.65 + pwrScale * 0.35) * tireLaunchBoost;
    const absFactor = this.settings.absEnabled ? 1.1 : 0.94;
    const stormGrip = 1.0;
    const tireGrip =
      1 +
      tireLvl * 0.075 +
      (carState.tireProfile === 'racing_wide' ? 0.08 : carState.tireProfile === 'semi_slick' ? 0.04 : 0);
    const weightRatio = spec.weightKg / weightKg;
    const brakePower = (1 + brakeLvl * 0.13) * absFactor * Math.min(1.18, tireGrip);

    if (this.backfireCooldown > 0) this.backfireCooldown = Math.max(0, this.backfireCooldown - dt);
    if (this.backfireTimer > 0) this.backfireTimer = Math.max(0, this.backfireTimer - dt);

    // ==================== UNIFIED GEAR, REVERSE, NEUTRAL & ZERO-KMH BRAKING ====================
    let accelNorm = 0;
    let isBraking = false;

    if (activeTx === 'AT') {
      if (this.gear === 0) this.gear = 1;
      if (this.gear === -1) {
        if (throttle) {
          // Pressing forward throttle while rolling backward brakes first, then shifts to 1st
          if (this.speedMs < -0.35) {
            this.speedMs = Math.min(0, this.speedMs + 34 * brakePower * weightRatio * dt);
            accelNorm = 0.7;
            isBraking = true;
          } else {
            this.speedMs = 0;
            this.gear = 1;
          }
        } else if (brake) {
          this.speedMs = Math.max(-35 / 3.6, this.speedMs - 11.5 * dt);
          accelNorm = -0.45;
        } else {
          this.speedMs = Math.min(0, this.speedMs + 5.8 * dt);
          if (Math.abs(this.speedMs) < 0.15) this.speedMs = 0;
        }
      } else {
        // Forward AT gears 1..6
        const currGearCapMs = gearTopSpeeds[this.gear] / 3.6;
        if (throttle) {
          const gearBoost = 1.38 - (this.gear - 1) * 0.135;
          const nitroMult = nitroActive ? 1.38 + nitroUpLvl * 0.06 : 1.0;
          const accel = 16.5 * launchScale * gearBoost * nitroMult * stormGrip;
          if (this.speedMs < currGearCapMs) {
            this.speedMs = Math.min(currGearCapMs, this.speedMs + accel * dt);
          } else {
            this.speedMs = Math.max(currGearCapMs, this.speedMs - 8 * dt);
          }
          accelNorm = nitroActive ? 1.25 : 0.9;
        } else if (brake) {
          if (this.speedMs > 0.3) {
            this.speedMs = Math.max(0, this.speedMs - 40 * brakePower * weightRatio * dt);
            accelNorm = -1.15;
            isBraking = true;
          } else {
            this.speedMs = 0;
            this.gear = -1;
            accelNorm = -0.3;
            isBraking = true;
          }
        } else {
          const coastDrag = (3.4 + this.speedMs * 0.068) * dt;
          if (this.speedMs <= coastDrag) {
            this.speedMs = 0;
          } else {
            this.speedMs -= coastDrag;
          }
          accelNorm = this.speedMs > 0.5 ? -0.18 : 0;
        }
      }
    } else {
      // Manual Sequential (MT): supports R (-1), N (0), and 1..6 with authentic per-gear caps
      if (this.gear === 0) {
        // Neutral: free-rolling coast, zero wheel drive force
        const sign = Math.sign(this.speedMs);
        const drag = (3.0 + Math.abs(this.speedMs) * 0.055) * dt;
        if (Math.abs(this.speedMs) <= drag) this.speedMs = 0;
        else this.speedMs -= sign * drag;
        if (brake && Math.abs(this.speedMs) > 0.2) {
          this.speedMs = Math.max(0, Math.abs(this.speedMs) - 38 * brakePower * weightRatio * dt) * sign;
          accelNorm = -1.0;
          isBraking = true;
        }
      } else if (this.gear === -1) {
        // Reverse (-35 km/h max)
        if (throttle) {
          const gearBoost = 1.1;
          this.speedMs = Math.max(
            -35 / 3.6,
            this.speedMs - 11.5 * gearBoost * stormGrip * dt
          );
          accelNorm = -0.5;
        } else if (brake) {
          if (this.speedMs < -0.25) {
            this.speedMs = Math.min(0, this.speedMs + 34 * brakePower * weightRatio * dt);
            isBraking = true;
            accelNorm = 0.85;
          } else {
            this.speedMs = 0;
            isBraking = true;
          }
        } else {
          this.speedMs = Math.min(0, this.speedMs + 5.5 * dt);
          if (Math.abs(this.speedMs) < 0.15) this.speedMs = 0;
        }
      } else {
        // Forward MT gears 1..6
        const currGearCapMs = gearTopSpeeds[this.gear] / 3.6;
        if (throttle) {
          const gearBoost = 1.42 - (this.gear - 1) * 0.14;
          const nitroMult = nitroActive ? 1.40 + nitroUpLvl * 0.06 : 1.0;
          const accel = 16.8 * launchScale * gearBoost * nitroMult * stormGrip;
          if (this.speedMs < currGearCapMs) {
            this.speedMs = Math.min(currGearCapMs, this.speedMs + accel * dt);
            accelNorm = nitroActive ? 1.25 : 0.92;
          } else if (this.speedMs > currGearCapMs + 0.6) {
            // Engine braking when downshifted too early
            this.speedMs = Math.max(currGearCapMs, this.speedMs - 14 * dt);
            accelNorm = -0.35;
          } else {
            this.speedMs = currGearCapMs;
            accelNorm = 0.25;
          }
        } else if (brake) {
          if (this.speedMs > 0.2) {
            this.speedMs = Math.max(0, this.speedMs - 42 * brakePower * weightRatio * dt);
            accelNorm = -1.15;
            isBraking = true;
          } else {
            this.speedMs = 0;
            isBraking = true;
          }
        } else {
          const engineBrake =
            this.speedMs > currGearCapMs ? 14.0 * dt : (3.3 + this.speedMs * 0.068) * dt;
          if (this.speedMs <= engineBrake) {
            this.speedMs = 0;
          } else {
            this.speedMs -= engineBrake;
          }
          accelNorm = this.speedMs > 0.5 ? -0.2 : 0;
        }
      }
    }

    if (this.mergeGraceTimer > 0) {
      this.mergeGraceTimer = Math.max(0, this.mergeGraceTimer - dt);
    }

    // ==================== REALISTIC NOSE-HEADING STEERING & U-TURN PHYSICS ====================
    const steerRaw = (steerLeft ? 1 : 0) - (steerRight ? 1 : 0);
    this.steerInputSmoothed = THREE.MathUtils.damp(
      this.steerInputSmoothed,
      steerRaw,
      steerRaw !== 0 ? 8.5 + suspLvl * 0.9 : 11.5,
      dt
    );

    const absSpeedMs = Math.abs(this.speedMs);
    const speedRatio = Math.min(1, absSpeedMs / 68);
    const agileFactor =
      (1.0 + carState.upgrades.weight * 0.06 + carState.upgrades.gearbox * 0.03 + suspLvl * 0.04) *
      Math.min(1.16, tireGrip * 0.96);
    const turnSign = this.speedMs >= -0.05 ? 1 : -1;
    const steerMobility = absSpeedMs < 0.2 ? 0 : Math.min(1, absSpeedMs / 4.2);
    const turnRate =
      (1.62 - speedRatio * 0.72) *
      agileFactor *
      this.settings.steeringSensitivity *
      stormGrip *
      steerMobility;

    this.highwayHeadingOffset += this.steerInputSmoothed * turnSign * turnRate * dt;
    while (this.highwayHeadingOffset > Math.PI) this.highwayHeadingOffset -= Math.PI * 2;
    while (this.highwayHeadingOffset < -Math.PI) this.highwayHeadingOffset += Math.PI * 2;

    if (steerRaw === 0 && absSpeedMs > 0.4) {
      const alignDamp = this.mergeGraceTimer > 0 ? 1.8 : 4.2;
      const targetAlign =
        Math.abs(this.highwayHeadingOffset) <= Math.PI * 0.5
          ? 0
          : this.highwayHeadingOffset >= 0
            ? Math.PI
            : -Math.PI;
      this.highwayHeadingOffset = THREE.MathUtils.damp(
        this.highwayHeadingOffset,
        targetAlign,
        alignDamp,
        dt
      );
    }

    track.sampleAtS(this.playerS, this._sample);
    const prevRoadYaw = this._sample.yaw;
    const prevLaneOffset = this.laneOffset;
    const worldYaw = prevRoadYaw + this.highwayHeadingOffset;
    const moveX = -Math.sin(worldYaw) * this.speedMs * dt;
    const moveZ = -Math.cos(worldYaw) * this.speedMs * dt;

    // Gentle slope gravity when climbing or descending the Incorporation Ramp
    if (this.onRamp && this.playerZ > RAMP_TOP_Z && this.playerZ < RAMP_BOTTOM_Z) {
      const slope = getRampSlopeAtZ(this.playerZ);
      const uphillFactor = -Math.cos(worldYaw);
      this.speedMs -= 9.81 * slope * uphillFactor * dt;
    }

    this.playerX += moveX;
    this.playerZ += moveZ;

    // Project onto closed-loop Frenet spline
    track.projectToTrack(this.playerX, this.playerZ, this.playerS, this._proj);
    const dsSigned = track.shortestSignedDeltaS(this.playerS, this._proj.s);
    this.playerS = this._proj.s;
    this.laneOffset = this._proj.laneOffset;
    this.distanceMeters += Math.abs(dsSigned);

    // Determine if car is on the Home Straight Access/Incorporation Ramp vs Elevated Main Deck
    const nearHomeStraight =
      Math.abs(this._proj.cx) < 4.5 &&
      this.playerZ <= 28.0 &&
      this.playerZ >= RAMP_MERGE_END_Z;

    if (nearHomeStraight && this.playerZ > RAMP_TOP_Z && (this.onRamp || this.laneOffset > 11.2)) {
      // Climbing / descending the concrete-walled Incorporation Ramp (z in (-122 .. +28])
      this.onRamp = true;
      const inBarrierGate = this.playerZ >= 11.0 && this.playerZ <= 25.0;
      if (this.mergeGraceTimer <= 0 && inBarrierGate && this.playerX > 22.05) {
        this.returnToParkingFromHighway();
        return;
      }

      const bounds = getRampBoundsAtZ(this.playerZ);
      const minRampX = bounds.leftX + 0.85;
      const maxRampX = inBarrierGate ? 23.0 : bounds.rightX - 0.85;
      if (this.playerX < minRampX || this.playerX > maxRampX) {
        this.playerX = THREE.MathUtils.clamp(this.playerX, minRampX, maxRampX);
        this.highwayHeadingOffset = THREE.MathUtils.damp(this.highwayHeadingOffset, 0, 10, dt);
        this.speedMs *= 1 - 0.3 * dt;
      }
      if (this.playerZ > 27.1) {
        this.playerZ = 27.1;
        this.speedMs *= 0.5;
      }
      track.projectToTrack(this.playerX, this.playerZ, this.playerS, this._proj);
      this.playerS = this._proj.s;
      this.laneOffset = this._proj.laneOffset;
      this.playerY = getRampElevationAtZ(this.playerZ) + 0.015;
    } else if (nearHomeStraight && this.playerZ <= RAMP_TOP_Z && this.playerZ >= RAMP_MERGE_END_Z) {
      // Flush Elevated Merge Taper & Gore Chevron Zone (z in [-195 .. -122] at y = 4.5m)
      this.onRamp = this.laneOffset > 10.6;
      this.playerY = HIGHWAY_Y + 0.015;
      const bounds = getRampBoundsAtZ(this.playerZ);
      const leftLimit = -10.05;
      const rightLimit = bounds.rightX - 0.85;
      if (this.laneOffset < leftLimit || this.laneOffset > rightLimit) {
        this.laneOffset = THREE.MathUtils.clamp(this.laneOffset, leftLimit, rightLimit);
        this.playerX = this._proj.cx + this._proj.rx * this.laneOffset;
        this.playerZ = this._proj.cz + this._proj.rz * this.laneOffset;
        this.highwayHeadingOffset = THREE.MathUtils.damp(this.highwayHeadingOffset, 0, 12, dt);
        this.speedMs *= 1 - 0.35 * dt;
      }
    } else {
      // Main Elevated Closed-Loop Highway Deck (y = 4.5m)
      this.onRamp = false;
      this.playerY = HIGHWAY_Y + 0.015;
      const leftLimit = -10.05;
      const rightLimit = 10.05;
      if (this.laneOffset < leftLimit || this.laneOffset > rightLimit) {
        this.laneOffset = THREE.MathUtils.clamp(this.laneOffset, leftLimit, rightLimit);
        this.playerX = this._proj.cx + this._proj.rx * this.laneOffset;
        this.playerZ = this._proj.cz + this._proj.rz * this.laneOffset;
        this.highwayHeadingOffset = THREE.MathUtils.damp(this.highwayHeadingOffset, 0, 12, dt);
        this.speedMs *= 1 - 0.35 * dt;
        if (Math.abs(this.speedMs) > 14 && Math.random() < 0.75) {
          this.spawnParticle(
            this.playerX,
            this.playerY + 0.35,
            this.playerZ,
            (Math.random() - 0.5) * 5,
            2.2 + Math.random() * 2.8,
            (Math.random() - 0.5) * 5,
            0.26,
            0.55,
            1.0,
            0.65,
            0.15
          );
        }
      }
    }

    // Center Median Barrier collision EXCEPT inside the 5 strategic Median Openings!
    if (!this.onRamp && !track.isInMedianOpening(this.playerS)) {
      const medianHalfClearance = 1.28;
      if (Math.abs(this.laneOffset) < medianHalfClearance) {
        this.laneOffset = prevLaneOffset >= 0 ? medianHalfClearance : -medianHalfClearance;
        this.playerX = this._proj.cx + this._proj.rx * this.laneOffset;
        this.playerZ = this._proj.cz + this._proj.rz * this.laneOffset;
        this.speedMs *= 1 - 0.25 * dt;
        if (Math.abs(this.speedMs) > 14 && Math.random() < 0.7) {
          this.spawnParticle(
            this.playerX,
            this.playerY + 0.35,
            this.playerZ,
            (Math.random() - 0.5) * 5,
            2.0 + Math.random() * 2.5,
            (Math.random() - 0.5) * 5,
            0.25,
            0.5,
            1.0,
            0.62,
            0.15
          );
        }
      }
    }

    // ==================== RPM, FUEL-CUT LIMITER & CDI RACING BACKFIRES ====================
    const speedKmh = absSpeedMs * 3.6;

    if (this.gear === 0) {
      // Neutral free-revving
      const targetNeutralRpm = throttle ? maxRpm + 180 : IDLE_RPM;
      const rate = throttle ? 12.5 : 5.2;
      this.rpm = THREE.MathUtils.damp(this.rpm, targetNeutralRpm, rate, dt);
    } else if (this.gear === -1) {
      const targetRevRpm =
        IDLE_RPM +
        (absSpeedMs / (35 / 3.6)) * (maxRpm * 0.72 - IDLE_RPM) +
        (throttle ? 420 : 0);
      this.rpm = THREE.MathUtils.lerp(
        this.rpm,
        THREE.MathUtils.clamp(targetRevRpm, IDLE_RPM, maxRpm),
        0.26
      );
    } else {
      const currGearCapMs = Math.max(10, gearTopSpeeds[this.gear] / 3.6);
      const gearRatioNorm = Math.max(0, this.speedMs) / currGearCapMs;
      const minRpmForGear = this.gear === 1 ? IDLE_RPM : Math.max(IDLE_RPM, maxRpm * 0.32);
      const targetRpm =
        IDLE_RPM +
        gearRatioNorm * (maxRpm - IDLE_RPM) +
        (throttle && absSpeedMs < 1.5 ? 650 : 0);
      this.rpm = THREE.MathUtils.lerp(
        this.rpm,
        THREE.MathUtils.clamp(targetRpm, minRpmForGear, maxRpm + 120),
        0.28
      );

      // Automatic shifting (AT)
      if (activeTx === 'AT') {
        if (this.rpm >= maxRpm * 0.92 && this.gear < 6 && throttle && this.speedMs > 6) {
          this.gear++;
          this.rpm *= GEAR_RATIOS[this.gear] / GEAR_RATIOS[this.gear - 1];
          if (carState.upgrades.turbo >= 1 || spec.baseHp >= 280) {
            this.audio.playShiftBov();
          }
          if (carState.cdiRacing && this.rpm > maxRpm * 0.55) {
            this.triggerBackfire(0.7);
          }
        } else if (
          this.gear > 1 &&
          (this.rpm < maxRpm * 0.35 || this.speedMs < (gearTopSpeeds[this.gear - 1] / 3.6) * 0.62)
        ) {
          this.gear--;
          this.rpm *= GEAR_RATIOS[this.gear] / GEAR_RATIOS[this.gear + 1];
        }
      }
    }

    // Rev-Limiter check (Stock electronic clean fuel-cut vs CDI Racing aggressive pop/flame cut)
    const hittingLimiter =
      this.rpm >= maxRpm - 95 &&
      (throttle || (this.gear > 0 && this.speedMs > (gearTopSpeeds[this.gear] / 3.6) * 0.985));

    if (hittingLimiter) {
      this.revLimiterActive = true;
      this.limiterPhase += dt * (carState.cdiRacing ? 44 : 26);
      if (carState.cdiRacing) {
        // CDI Racing: aggressive ignition cut + exhaust flames & pops/bangs
        this.rpm = maxRpm - 260 + Math.sin(this.limiterPhase) * 210;
        this.triggerBackfire(0.95);
      } else {
        // Stock: clean electronic fuel-cut bounce with zero backfire flames or pops
        this.rpm = maxRpm - 180 + Math.sin(this.limiterPhase) * 120;
      }
    } else {
      this.revLimiterActive = false;
    }

    // CDI Racing throttle lift-off pops & bangs after revving
    if (
      carState.cdiRacing &&
      this.prevThrottleHeld &&
      !throttle &&
      this.rpm > maxRpm * 0.50
    ) {
      this.triggerBackfire(0.85);
    }
    this.prevThrottleHeld = throttle;

    const roadYaw = this._proj.yaw;
    const carVisualYaw = roadYaw + this.highwayHeadingOffset;
    this.highwayPlayerCar.root.position.set(this.playerX, this.playerY, this.playerZ);
    this.highwayPlayerCar.root.rotation.y = carVisualYaw;

    // Subtle visual ramp pitch angle when climbing/descending
    if (this.onRamp && this.playerZ > RAMP_TOP_Z && this.playerZ < RAMP_BOTTOM_Z) {
      const slope = getRampSlopeAtZ(this.playerZ);
      this.highwayPlayerCar.root.rotation.x = slope * (-Math.cos(carVisualYaw)) * 0.85;
    } else {
      this.highwayPlayerCar.root.rotation.x = THREE.MathUtils.damp(
        this.highwayPlayerCar.root.rotation.x,
        0,
        12,
        dt
      );
    }

    this.updateVehicleDynamicsAndLights(
      this.highwayPlayerCar,
      this.steerInputSmoothed,
      accelNorm,
      this.speedMs,
      isBraking,
      dt,
      -1
    );

    // Independent Nitro Flames vs CDI Racing Dual Blue/Orange Exhaust Backfire Flames
    const flameMat = this.highwayPlayerCar.flameLeft.material as THREE.MeshBasicMaterial;
    if (nitroActive) {
      flameMat.opacity = 0.85 + Math.random() * 0.15;
      const scaleZ = 1.0 + Math.random() * 0.45;
      this.highwayPlayerCar.flameLeft.scale.set(1, 1, scaleZ);
      this.highwayPlayerCar.flameRight.scale.set(1, 1, scaleZ);
    } else {
      flameMat.opacity = 0;
    }

    const showBackfire = Boolean(carState.cdiRacing) && this.backfireTimer > 0;
    this.highwayPlayerCar.backfireLeft.visible = showBackfire;
    this.highwayPlayerCar.backfireRight.visible = showBackfire;
    if (showBackfire) {
      this.highwayPlayerCar.backfireOuterMat.opacity = 0.82 + Math.random() * 0.18;
      this.highwayPlayerCar.backfireCoreMat.opacity = 0.90 + Math.random() * 0.10;
      const bfScale = 0.85 + Math.random() * 0.80;
      const bfFlicker = 0.78 + Math.random() * 0.36;
      this.highwayPlayerCar.backfireLeft.scale.set(bfFlicker, bfFlicker, bfScale);
      this.highwayPlayerCar.backfireRight.scale.set(bfFlicker, bfFlicker, bfScale);
    } else {
      this.highwayPlayerCar.backfireOuterMat.opacity = 0;
      this.highwayPlayerCar.backfireCoreMat.opacity = 0;
    }

    for (let i = 0; i < this.highwayPlayerCar.backfireSparks.length; i++) {
      const sp = this.highwayPlayerCar.backfireSparks[i];
      sp.visible = showBackfire;
      if (showBackfire) {
        const side = i % 2 === 0 ? -1 : 1;
        sp.position.set(
          side * (0.44 + (Math.random() - 0.5) * 0.22),
          0.22 + (Math.random() - 0.3) * 0.16,
          2.16 + Math.random() * 0.95
        );
        const s = 0.5 + Math.random() * 0.9;
        sp.scale.set(s, s, s);
      }
    }
    if (this.highwayPlayerCar.backfireLight) {
      this.highwayPlayerCar.backfireLight.intensity = showBackfire
        ? 4.2 + Math.random() * 3.2
        : 0;
    }

    // Volumetric Tire Smoke, Wet Spray & High-Speed Aero Streaks
    const carFwdX = -Math.sin(carVisualYaw);
    const carFwdZ = -Math.cos(carVisualYaw);
    const carRightX = Math.cos(carVisualYaw);
    const carRightZ = -Math.sin(carVisualYaw);
    const rearX = this.playerX - carFwdX * 1.45;
    const rearZ = this.playerZ - carFwdZ * 1.45;

    if (
      (Math.abs(this.steerInputSmoothed) > 0.55 && absSpeedMs > 18) ||
      (isBraking && absSpeedMs > 16) ||
      (throttle && absSpeedMs < 13 && this.rpm > maxRpm * 0.72)
    ) {
      const side = Math.random() > 0.5 ? 0.78 : -0.78;
      this.spawnParticle(
        rearX + carRightX * side,
        this.playerY + 0.16,
        rearZ + carRightZ * side,
        (Math.random() - 0.5) * 1.6,
        0.55 + Math.random() * 0.55,
        (Math.random() - 0.5) * 1.6,
        0.55,
        1.5,
        0.82,
        0.85,
        0.90
      );
    }

    if (isStorm && absSpeedMs > 14 && Math.random() < 0.8) {
      const side = Math.random() > 0.5 ? 0.8 : -0.8;
      this.spawnParticle(
        rearX + carRightX * side,
        this.playerY + 0.18,
        rearZ + carRightZ * side,
        (Math.random() - 0.5) * 1.8,
        0.8 + Math.random() * 0.8,
        (Math.random() - 0.5) * 1.8,
        0.35,
        1.1,
        0.65,
        0.78,
        0.92
      );
    }

    if (speedKmh > 210 && Math.random() < 0.75) {
      const side = (Math.random() > 0.5 ? 1 : -1) * (1.25 + Math.random() * 1.2);
      this.spawnParticle(
        this.playerX + carFwdX * 2.5 + carRightX * side,
        this.playerY + 0.55 + Math.random() * 0.7,
        this.playerZ + carFwdZ * 2.5 + carRightZ * side,
        -carFwdX * 14,
        0,
        -carFwdZ * 14,
        0.18,
        0.48,
        0.7,
        0.88,
        1.0
      );
    }

    this.world.updateScroll(
      this.playerX,
      this.playerZ,
      this.playerY,
      absSpeedMs,
      dt,
      isStorm,
      false
    );

    if (this.combo > 0) {
      this.comboTimer -= realDt;
      if (this.comboTimer <= 0) {
        this.bankPendingCash(false);
      }
    }
    if (this.nearMissBannerTimer > 0) {
      this.nearMissBannerTimer -= realDt;
      if (this.nearMissBannerTimer <= 0) this.nearMissBanner = null;
    }
    if (this.crashBannerTimer > 0) {
      this.crashBannerTimer -= realDt;
      if (this.crashBannerTimer <= 0) this.crashBanner = null;
    }
    if (this.missionBannerTimer > 0) {
      this.missionBannerTimer -= realDt;
      if (this.missionBannerTimer <= 0) this.missionBanner = null;
    }
    if (this.crashCooldown > 0) {
      this.crashCooldown -= dt;
    }

    // ==================== CLOSED-LOOP TRAFFIC & FRENET COLLISION DETECTION ====================
    const roadFwdX = this._proj.tx;
    const roadFwdZ = this._proj.tz;
    const roadRightX = this._proj.rx;
    const roadRightZ = this._proj.rz;
    const travelSign = Math.cos(this.highwayHeadingOffset) >= 0 ? 1 : -1;

    // Accumulate No Hesi Pending Cash for 220+ km/h & Wrong Way risk driving
    const isWrongWay =
      this.laneOffset < -0.45 && travelSign > 0 && !this.onRamp && this.crashCooldown <= 0;
    const kmStep = (Math.abs(dsSigned) / 1000);
    this.highwayKmAccum += kmStep;
    if (this.highwayKmAccum >= 0.25) {
      const chunk = this.highwayKmAccum;
      this.highwayKmAccum = 0;
      this.onProgressionEventCallback?.({ type: 'HIGHWAY_KM', kmDelta: chunk });
    }
    if (isWrongWay) {
      this.wrongWayKmAccum += kmStep;
      if (this.wrongWayKmAccum >= 0.2) {
        const wChunk = this.wrongWayKmAccum;
        this.wrongWayKmAccum = 0;
        this.onProgressionEventCallback?.({ type: 'WRONG_WAY_KM', kmDelta: wChunk });
      }
    }

    if (this.combo > 0 && (speedKmh >= 220 || isWrongWay)) {
      const mult = Math.max(1, Math.min(25, this.combo));
      const rate = (speedKmh >= 220 ? 35 : 0) + (isWrongWay ? 55 : 0);
      this.pendingCash += Math.round(rate * mult * dt);
    }

    // Check 4 Highway Speed Radars
    this.updateSpeedRadars(realDt, speedKmh);

    // Check Contrato Express Checkpoints
    this.updateContractProgress(realDt);

    for (const ent of this.trafficPool) {
      if (ent.hitCooldown > 0) ent.hitCooldown -= dt;

      if (ent.isOncoming) {
        ent.s = track.wrapS(ent.s - ent.speedMs * dt);
      } else {
        ent.s = track.wrapS(ent.s + ent.speedMs * dt);
      }

      const relS = track.shortestSignedDeltaS(this.playerS, ent.s) * travelSign;
      if (relS < -48 || relS > 360) {
        const laneIdx = Math.floor(Math.random() * 4);
        const chosenLaneX = LANE_X[laneIdx];
        let respawnS = track.wrapS(this.playerS + travelSign * (185 + Math.random() * 145));
        for (const other of this.trafficPool) {
          if (other !== ent && Math.abs(other.laneX - chosenLaneX) < 0.5) {
            if (Math.abs(track.shortestSignedDeltaS(other.s, respawnS)) < 26) {
              respawnS = track.wrapS(respawnS + travelSign * 28);
            }
          }
        }
        ent.laneX = chosenLaneX;
        ent.isOncoming = laneIdx < 2;
        ent.speedMs = ent.isOncoming ? 20 + Math.random() * 5 : 21 + Math.random() * 4;
        ent.nearMissed = false;
        ent.s = respawnS;
      }

      track.sampleAtS(ent.s, this._sample);
      const tWorldX = this._sample.x + this._sample.rx * ent.laneX;
      const tWorldZ = this._sample.z + this._sample.rz * ent.laneX;
      ent.vehicle.root.position.set(tWorldX, HIGHWAY_Y + 0.015, tWorldZ);
      ent.vehicle.root.rotation.y = this._sample.yaw + (ent.isOncoming ? Math.PI : 0);

      const wheelDir = ent.isOncoming ? 1 : -1;
      for (const w of ent.vehicle.wheels) {
        w.rotation.x += wheelDir * (ent.speedMs / 0.34) * dt;
      }

      if (Math.abs(relS) < 12 && !this.onRamp) {
        const dWorldX = tWorldX - this.playerX;
        const dWorldZ = tWorldZ - this.playerZ;
        const longDist = Math.abs(dWorldX * roadFwdX + dWorldZ * roadFwdZ);
        const latDist = Math.abs(dWorldX * roadRightX + dWorldZ * roadRightZ);

        if (latDist < 1.72 && longDist < 4.05 && ent.hitCooldown <= 0 && this.crashCooldown <= 0) {
          ent.hitCooldown = 1.6;
          this.handleCrash(ent);
        } else if (
          !ent.nearMissed &&
          longDist < 4.5 &&
          latDist >= 1.72 &&
          latDist < 3.25 &&
          speedKmh > 105
        ) {
          ent.nearMissed = true;
          const headOnToPlayer = travelSign > 0 ? ent.isOncoming : !ent.isOncoming;
          const isExtremeRoce = latDist < 2.25 && speedKmh >= 250;
          this.handleNearMiss(headOnToPlayer, isExtremeRoce);
        }
      }
    }

    this.updateActiveMission(realDt, speedKmh, nitroActive);

    const baseFov = THREE.MathUtils.clamp(this.settings.fov * 0.78, 50, 86);
    const targetFov = nitroActive
      ? Math.min(100, baseFov + 10)
      : THREE.MathUtils.clamp(baseFov + (speedKmh / 320) * 8, baseFov, 96);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 0.08);
    this.camera.updateProjectionMatrix();

    if (!this.pointerLocked) {
      this.freeCamYaw = THREE.MathUtils.damp(this.freeCamYaw, 0, 5.5, realDt);
      this.freeCamPitch = THREE.MathUtils.damp(this.freeCamPitch, 0, 5.5, realDt);
    }

    const followYaw = carVisualYaw + this.freeCamYaw;

    if (this.launchTransitionTimer > 0) {
      this.launchTransitionTimer = Math.max(0, this.launchTransitionTimer - realDt);
      const t = 1 - this.launchTransitionTimer / this.launchTransitionDuration;
      const ease = 1 - Math.pow(1 - t, 3);
      const targetCamX = THREE.MathUtils.lerp(
        this.camera.position.x,
        this.playerX - roadFwdX * 6.4,
        ease
      );
      const targetCamY = THREE.MathUtils.lerp(this.camera.position.y, this.playerY + 2.25, ease);
      const targetCamZ = THREE.MathUtils.lerp(
        this.camera.position.z,
        this.playerZ - roadFwdZ * 6.4,
        ease
      );
      this.camera.position.set(targetCamX, targetCamY, targetCamZ);
      this._v2.set(
        this.playerX + roadFwdX * 14,
        this.playerY + 1.05,
        this.playerZ + roadFwdZ * 14
      );
      this.camera.lookAt(this._v2);
    } else if (this.cameraPreset === 'CHASE') {
      const shake = speedKmh > 210 ? ((speedKmh - 210) / 140) * 0.025 : 0;
      const dist = 6.2;
      const pitch = THREE.MathUtils.clamp(0.19 + this.freeCamPitch * 0.65, 0.03, 0.92);
      const offX = Math.sin(followYaw) * Math.cos(pitch) * dist;
      const offY = Math.max(this.playerY + 0.55, this.playerY + 1.0 + Math.sin(pitch) * dist);
      const offZ = Math.cos(followYaw) * Math.cos(pitch) * dist;

      const targetCamX = this.playerX + offX + (Math.random() - 0.5) * shake;
      const targetCamY = offY + (Math.random() - 0.5) * shake;
      const targetCamZ = this.playerZ + offZ;

      this.camera.position.lerp(
        this._v1.set(targetCamX, targetCamY, targetCamZ),
        1 - Math.exp(-11 * realDt)
      );
      const lookFwd = Math.abs(this.freeCamYaw) > 0.1 ? 0 : 12;
      this._v2.set(
        this.playerX + carFwdX * lookFwd,
        this.playerY + 1.05,
        this.playerZ + carFwdZ * lookFwd
      );
      this.camera.lookAt(this._v2);
    } else if (this.cameraPreset === 'HOOD') {
      this.highwayPlayerCar.chassisGroup.localToWorld(this._v1.set(-0.30, 1.03, 0.22));
      const lookYaw = carVisualYaw + this.freeCamYaw;
      this.camera.position.copy(this._v1);
      const lx = this._v1.x - Math.sin(lookYaw) * Math.cos(this.freeCamPitch) * 24;
      const ly = this._v1.y + Math.sin(this.freeCamPitch) * 16;
      const lz = this._v1.z - Math.cos(lookYaw) * Math.cos(this.freeCamPitch) * 24;
      this.camera.lookAt(lx, ly, lz);
    } else {
      const bumpX = this.playerX + carFwdX * 2.1;
      const bumpZ = this.playerZ + carFwdZ * 2.1;
      const lookYaw = carVisualYaw + this.freeCamYaw;
      this.camera.position.set(bumpX, this.playerY + 0.65, bumpZ);
      const lx = bumpX - Math.sin(lookYaw) * Math.cos(this.freeCamPitch) * 24;
      const ly = this.playerY + 0.72 + Math.sin(this.freeCamPitch) * 16;
      const lz = bumpZ - Math.cos(lookYaw) * Math.cos(this.freeCamPitch) * 24;
      this.camera.lookAt(lx, ly, lz);
    }

    this.audio.update({
      dt: realDt,
      inCar: true,
      rpmRatio: (this.rpm - IDLE_RPM) / Math.max(1000, maxRpm - IDLE_RPM),
      throttle,
      nitroActive,
      isStorm,
      fuelCutActive: !carState.cdiRacing && this.revLimiterActive,
    });
  }

  private updateSpeedRadars(realDt: number, speedKmh: number) {
    for (const node of this.world.radarNodes) {
      const cd = this.radarCooldowns[node.id] ?? 0;
      if (cd > 0) {
        this.radarCooldowns[node.id] = Math.max(0, cd - realDt);
      }
      node.flashMesh.visible = this.radarFlashTimer > 0 && cd > 11.7;

      const distS = Math.abs(this.world.track.shortestSignedDeltaS(this.playerS, node.s));
      if (distS < 6.5 && !this.onRamp && (this.radarCooldowns[node.id] ?? 0) <= 0) {
        if (speedKmh >= node.limitKmh) {
          this.radarCooldowns[node.id] = 12.0;
          this.radarFlashTimer = 0.24;
          this.radarFlashOpacity = 0.92;
          this.audio.playRadarFlash();
          const roundedSpeed = Math.round(speedKmh);
          const bonus = Math.round(650 + (roundedSpeed - node.limitKmh) * 18);
          this.awardCash(bonus);
          this.pendingScoreDelta += 120;
          this.radarResultBanner = `${node.label}: ${roundedSpeed} km/h (Mín ${node.limitKmh}) · +$${bonus.toLocaleString()}`;
          this.radarResultTimer = 2.8;
          this.onProgressionEventCallback?.({
            type: 'RADAR_HIT',
            radarId: node.id,
            speedKmh: roundedSpeed,
            xpDelta: 75,
          });
        } else {
          this.radarCooldowns[node.id] = 6.0;
          this.radarResultBanner = `${node.label}: ${Math.round(speedKmh)}/${node.limitKmh} km/h (Muy lento)`;
          this.radarResultTimer = 1.8;
        }
      }
    }
  }

  private updateContractProgress(realDt: number) {
    const cps = this.world.contractCheckpoints;
    if (!this.contractActive) {
      for (let i = 0; i < cps.length; i++) {
        cps[i].group.visible = false;
      }
      return;
    }

    this.contractTimerSec = Math.max(0, this.contractTimerSec - realDt);
    for (let i = 0; i < cps.length; i++) {
      const active = i === this.contractCheckpointIdx;
      cps[i].group.visible = active;
      if (active) {
        const pulse = 1 + Math.sin(this.elapsedSeconds * 7) * 0.08;
        cps[i].group.scale.set(pulse, pulse, pulse);
      }
    }

    const targetCp = cps[this.contractCheckpointIdx];
    if (targetCp) {
      const ds = Math.abs(this.world.track.shortestSignedDeltaS(this.playerS, targetCp.s));
      const d = Math.hypot(this.playerX - targetCp.x, this.playerZ - targetCp.z);
      if ((!this.onRamp && ds < 14) || d < 12.5) {
        this.audio.playCheckpointChime(this.contractCheckpointIdx + 1);
        this.contractCheckpointIdx++;
        if (this.contractCheckpointIdx >= cps.length) {
          this.contractActive = false;
          this.awardCash(18000);
          this.audio.playMissionComplete();
          this.pendingScoreDelta += 450;
          this.contractBanner = '¡CONTRATO EXPRESS COMPLETADO! +$18,000 · +450 XP';
          this.contractBannerTimer = 4.2;
          this.onProgressionEventCallback?.({
            type: 'CONTRACT_WIN',
            xpDelta: 450,
            repDelta: 80,
          });
        } else {
          this.contractBanner = `Checkpoint ${this.contractCheckpointIdx}/${cps.length} superado`;
          this.contractBannerTimer = 1.4;
        }
        return;
      }
    }

    if (this.contractTimerSec <= 0) {
      this.contractActive = false;
      this.contractBanner = 'CONTRATO EXPRESS EXPIRADO';
      this.contractBannerTimer = 3.0;
    }
  }

  private bankPendingCash(silent = false) {
    if (this.pendingCash > 0) {
      const banked = Math.round(this.pendingCash);
      this.awardCash(banked);
      const xpGain = Math.max(15, Math.min(250, Math.round(banked / 45)));
      if (!silent) {
        this.audio.playCashBank();
        this.nearMissBanner = `¡BANCO ASEGURADO! +$${banked.toLocaleString()}`;
        this.nearMissBannerTimer = 2.0;
      }
      this.onProgressionEventCallback?.({
        type: 'CASH_BANK',
        xpDelta: xpGain,
      });
    }
    this.pendingCash = 0;
    this.combo = 0;
    this.comboTimer = 0;
  }

  private handleNearMiss(oncomingBonus: boolean, isExtremeRoce: boolean) {
    this.combo = Math.min(25, this.combo + 1);
    this.comboTimer = 4.2;
    const baseReward = oncomingBonus ? 260 : 130;
    const roceBonus = isExtremeRoce ? 520 : 0;
    const reward = (baseReward + roceBonus) * this.combo;
    this.pendingCash += reward;
    this.pendingScoreDelta += (oncomingBonus ? 40 : 20) * Math.min(10, this.combo);
    this.nitro = Math.min(100, this.nitro + (isExtremeRoce ? 24 : 14));

    if (isExtremeRoce) {
      this.bulletTimeTimer = 0.30;
      this.audio.playExtremeRoce();
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([35, 25, 45]);
        } catch {
          // ignore vibrate errors
        }
      }
      this.extremeRoceBanner = `¡ROCE MORTAL! x${this.combo} · +$${reward.toLocaleString()} en riesgo`;
      this.extremeRoceBannerTimer = 2.1;
      this.onProgressionEventCallback?.({
        type: 'EXTREME_ROCE',
        combo: this.combo,
        xpDelta: 45,
      });
    } else {
      this.audio.playNearMissChime(this.combo);
      this.nearMissBanner = oncomingBonus
        ? `Adelanto x${this.combo} (Contracorriente) +$${reward.toLocaleString()} en riesgo`
        : `Adelanto x${this.combo} +$${reward.toLocaleString()} en riesgo`;
      this.nearMissBannerTimer = 1.6;
      this.onProgressionEventCallback?.({
        type: 'NEAR_MISS',
        combo: this.combo,
        xpDelta: 15,
      });
    }

    const m = MISSIONS_ROTATION[this.missionIndex];
    if (m.type === 'NEAR_MISS_STREAK') {
      this.missionProgress += 1;
    }
  }

  private handleCrash(ent: TrafficEntity) {
    this.audio.playCrash();
    const lostPending = Math.round(this.pendingCash);
    this.speedMs = Math.max(8 / 3.6, Math.abs(this.speedMs) * 0.36);
    this.pendingCash = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.crashCooldown = 1.1;
    this.crashBanner =
      lostPending > 0
        ? `¡COLISIÓN! -$${lostPending.toLocaleString()} EN RIESGO PERDIDO`
        : '¡COLISIÓN EN EL TRÁFICO!';
    this.crashBannerTimer = 2.0;

    for (let i = 0; i < 22; i++) {
      this.spawnParticle(
        this.playerX,
        this.playerY + 0.5,
        this.playerZ,
        (Math.random() - 0.5) * 12,
        2.5 + Math.random() * 5.5,
        (Math.random() - 0.5) * 12,
        0.35 + Math.random() * 0.2,
        0.65,
        1.0,
        0.58,
        0.12
      );
    }

    const pushDir = this.laneOffset >= ent.laneX ? 1.15 : -1.15;
    this.laneOffset = THREE.MathUtils.clamp(this.laneOffset + pushDir, -9.85, 9.85);
    this.world.track.sampleAtS(this.playerS, this._sample);
    this.playerX = this._sample.x + this._sample.rx * this.laneOffset;
    this.playerZ = this._sample.z + this._sample.rz * this.laneOffset;
    this.highwayHeadingOffset *= 0.25;

    const m = MISSIONS_ROTATION[this.missionIndex];
    if (m.type === 'NEAR_MISS_STREAK' || m.type === 'ONCOMING_DIST') {
      this.missionProgress = 0;
    }
  }

  private updateActiveMission(dt: number, speedKmh: number, nitroActive: boolean) {
    const m = MISSIONS_ROTATION[this.missionIndex];

    if (m.type === 'HIGH_SPEED_HOLD') {
      if (speedKmh >= 240) {
        this.missionProgress += dt;
      } else {
        this.missionProgress = Math.max(0, this.missionProgress - dt * 0.5);
      }
    } else if (m.type === 'ONCOMING_DIST') {
      if (this.laneOffset < -0.35 && this.crashCooldown <= 0) {
        this.missionProgress += Math.max(0, this.speedMs) * dt;
      }
    } else if (m.type === 'NITRO_PEAK') {
      if (nitroActive) {
        this.missionProgress = Math.max(this.missionProgress, speedKmh);
      }
    }

    if (this.missionProgress >= m.target) {
      this.awardCash(m.reward);
      this.audio.playMissionComplete();
      this.missionBanner = `MISIÓN COMPLETADA: +$${m.reward.toLocaleString()}`;
      this.missionBannerTimer = 3.5;
      this.missionIndex = (this.missionIndex + 1) % MISSIONS_ROTATION.length;
      this.missionProgress = 0;
    }
  }

  private awardCash(amount: number) {
    this.sessionEarnings += amount;
    this.profile = {
      ...this.profile,
      cash: this.profile.cash + amount,
    };
    this.onProfileChange(this.profile);
  }

  private collectRadarBlips(): RadarBlip[] {
    if (this.mode !== 'HIGHWAY') return [];
    const track = this.world.track;
    const blips: RadarBlip[] = [];
    for (const t of this.trafficPool) {
      const ds = track.shortestSignedDeltaS(this.playerS, t.s);
      if (ds > -42 && ds < 135) {
        blips.push({
          dx: t.laneX,
          dz: -ds,
          kind: t.isOncoming ? 'oncoming' : 'traffic',
        });
      }
    }
    return blips;
  }

  private emitHud() {
    const { spec, carState } = this.getActiveCarState();
    const maxRpm = getCarEffectiveMaxRpm(spec, carState);
    this.onHudUpdate({
      mode: this.mode,
      perspective: this.perspective,
      speedKmh: Math.round(Math.abs(this.speedMs) * 3.6),
      rpm: Math.round(this.rpm),
      maxRpm,
      gear: this.gear,
      nitro: Math.round(this.nitro),
      cdiRacing: Boolean(carState.cdiRacing),
      revLimiterActive: this.revLimiterActive,
      combo: this.combo,
      comboTimerRatio: this.combo > 0 ? Math.max(0, this.comboTimer / 4.2) : 0,
      sessionEarnings: this.sessionEarnings,
      distanceKm: this.distanceMeters / 1000,
      nearMissBanner: this.nearMissBanner,
      crashBanner: this.crashBanner,
      mission: {
        mission: MISSIONS_ROTATION[this.missionIndex],
        progress: this.missionProgress,
        completedBanner: this.missionBanner,
      },
      cameraPreset: this.cameraPreset,
      nearbyZone: this.nearbyZone,
      nearbyDealershipCarId: this.nearbyDealershipCarId,
      inTuningBay: this.inTuningBay,
      playerX: this.mode === 'HIGHWAY' ? this.laneOffset : this.walkerPos.x,
      playerZ: this.mode === 'HIGHWAY' ? this.playerZ : this.walkerPos.z,
      radarBlips: this.collectRadarBlips(),
      pointerLocked: this.pointerLocked,
      pendingCash: Math.round(this.pendingCash),
      comboMultiplier: Math.max(1, Math.min(25, this.combo)),
      pendingBankTimerRatio: this.combo > 0 ? Math.max(0, this.comboTimer / 4.2) : 0,
      bulletTimeActive: this.bulletTimeTimer > 0,
      extremeRoceBanner: this.extremeRoceBanner,
      radarFlashOpacity: this.radarFlashOpacity,
      radarResultBanner: this.radarResultBanner,
      contractActive: this.contractActive,
      contractCheckpointIdx: this.contractCheckpointIdx,
      contractCheckpointTotal: this.world.contractCheckpoints.length,
      contractTimerSec: Math.ceil(this.contractTimerSec),
      contractBanner: this.contractBanner,
      inCarMeetZone: this.inCarMeetZone,
      nearbyRemotePlayer: this.nearbyRemotePlayer,
      onlineConnected: this.onlineConnected,
      onlineRoomCode: this.onlineRoomCode,
      onlinePlayersCount: this.onlinePlayers.length + (this.onlineConnected ? 1 : 0),
      onlinePlayers: this.onlinePlayers,
      isKing: this.isKing,
      duelState: this.duelState,
      radioStation: this.audio.getRadioStation(),
    });
  }

  public dispose() {
    this.disposed = true;
    this.exitPointerLock();
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    document.removeEventListener('pointerlockerror', this.handlePointerLockError);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('wheel', this.handleWheel);

    this.onlineClient?.dispose();
    for (const entry of this.remoteVehicles.values()) {
      this.world.group.remove(entry.vehicle.root);
      entry.vehicle.dispose();
    }
    this.remoteVehicles.clear();
    if (this.particleMesh) {
      this.scene.remove(this.particleMesh);
      this.particleMesh.geometry.dispose();
      (this.particleMesh.material as THREE.Material).dispose();
    }

    this.audio.dispose();
    this.driverChar.dispose();
    this.parkedPlayerCar?.dispose();
    this.highwayPlayerCar?.dispose();
    this.trafficPool.forEach((t) => t.vehicle.dispose());
    this.world.dispose();
    this.textures.dispose();
    this.envRT.dispose();
    this.pmremGenerator.dispose();
    this.bloomPass?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();

    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
