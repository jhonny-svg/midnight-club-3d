import { useCallback, useEffect, useRef, useState } from 'react';
import { HighwayHUD } from './components/HighwayHUD';
import { SettingsModal } from './components/SettingsModal';
import { ShowroomHUD } from './components/ShowroomHUD';
import { StartMenuOverlay } from './components/StartMenuOverlay';
import { MidnightEngine } from './game/MidnightEngine';
import {
  CAR_CATALOG,
  CarState,
  CDI_MAX_RPM,
  CDI_MIN_RPM,
  CDI_RACING_COST,
  CDI_STEP_RPM,
  cloneDefaultKeybindings,
  createDefaultCarState,
  DEFAULT_SETTINGS,
  DiffuserOption,
  FrontBumperOption,
  GameSettings,
  getUpgradeCost,
  getUpgradeStageLabel,
  HudSnapshot,
  INITIAL_PROFILE,
  KeyAction,
  Keybindings,
  MISSIONS_ROTATION,
  PaintFinish,
  RimDesign,
  SaveProfile,
  SpoilerOption,
  TireProfile,
  TransmissionMode,
  UpgradePartKey,
  WalkingInteractionZone,
  WeatherMode,
  WindowTintOption,
} from './game/types';

const STORAGE_KEY = 'midnight_club_no_hesi_v5';
const SETTINGS_STORAGE_KEY = 'midnight_club_no_hesi_settings_v1';

function clampStage(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.min(3, Math.max(0, n));
}

function sanitizeSpoiler(v: unknown): SpoilerOption {
  if (v === 'none' || v === 'ducktail' || v === 'street_wing' || v === 'gt_wing' || v === 'stock') {
    return v;
  }
  return 'stock';
}

function sanitizePaintFinish(v: unknown): PaintFinish {
  if (v === 'gloss' || v === 'matte' || v === 'metallic' || v === 'chrome') return v;
  return 'gloss';
}

function sanitizeRimDesign(v: unknown): RimDesign {
  if (v === 'five_spoke' || v === 'multi_spoke' || v === 'deep_dish' || v === 'turbofan') return v;
  return 'five_spoke';
}

function sanitizeTireProfile(v: unknown): TireProfile {
  if (v === 'street' || v === 'semi_slick' || v === 'racing_wide') return v;
  return 'street';
}

function sanitizeFrontBumper(v: unknown): FrontBumperOption {
  if (v === 'stock' || v === 'carbon_lip' || v === 'gt_splitter') return v;
  return 'stock';
}

function sanitizeDiffuser(v: unknown): DiffuserOption {
  if (v === 'stock' || v === 'finned' || v === 'race_carbon') return v;
  return 'stock';
}

function sanitizeWindowTint(v: unknown): WindowTintOption {
  if (v === 'clear' || v === 'smoke' || v === 'limo') return v;
  return 'smoke';
}

function sanitizePlateText(v: unknown): string {
  if (typeof v !== 'string') return 'GSTDVR';
  const clean = v.toUpperCase().replace(/[^A-Z0-9- ]/g, '').slice(0, 8);
  return clean || 'GSTDVR';
}

function loadSavedProfile(): SaveProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return INITIAL_PROFILE;
    const parsed = JSON.parse(raw) as Partial<SaveProfile>;
    if (!parsed || !parsed.cars || !parsed.activeCarId) return INITIAL_PROFILE;

    const validOwned = Array.isArray(parsed.ownedCars)
      ? parsed.ownedCars.filter((id) => Boolean(CAR_CATALOG[id]))
      : [];
    if (!validOwned.includes('kuruma_2008')) {
      validOwned.unshift('kuruma_2008');
    }

    const activeCarId = CAR_CATALOG[parsed.activeCarId] ? parsed.activeCarId : 'kuruma_2008';
    const legacyTx: TransmissionMode = parsed.transmission === 'MT' ? 'MT' : 'AT';

    const sanitizedCars: Record<string, CarState> = {};
    for (const spec of Object.values(CAR_CATALOG)) {
      const saved = parsed.cars[spec.id];
      const def = createDefaultCarState(spec);
      const rawRpm =
        typeof saved?.revLimitRpm === 'number' && Number.isFinite(saved.revLimitRpm)
          ? Math.round(saved.revLimitRpm / CDI_STEP_RPM) * CDI_STEP_RPM
          : def.revLimitRpm;
      sanitizedCars[spec.id] = saved
        ? {
            paint: typeof saved.paint === 'string' ? saved.paint : def.paint,
            paintFinish: sanitizePaintFinish(saved.paintFinish),
            rimColor: typeof saved.rimColor === 'string' ? saved.rimColor : def.rimColor,
            rimDesign: sanitizeRimDesign(saved.rimDesign),
            tireProfile: sanitizeTireProfile(saved.tireProfile),
            underglow: typeof saved.underglow === 'string' ? saved.underglow : def.underglow,
            spoiler: sanitizeSpoiler(saved.spoiler),
            frontBumper: sanitizeFrontBumper(saved.frontBumper),
            diffuser: sanitizeDiffuser(saved.diffuser),
            sportSteering: Boolean(saved.sportSteering),
            starlightRoof: Boolean(saved.starlightRoof),
            plateText: sanitizePlateText(saved.plateText),
            windowTint: sanitizeWindowTint(saved.windowTint),
            transmission:
              saved.transmission === 'MT' || saved.transmission === 'AT'
                ? saved.transmission
                : legacyTx,
            cdiRacing: Boolean(saved.cdiRacing),
            revLimitRpm: Math.min(CDI_MAX_RPM, Math.max(CDI_MIN_RPM, rawRpm)),
            upgrades: {
              ecu: clampStage(saved.upgrades?.ecu),
              turbo: clampStage(saved.upgrades?.turbo),
              gearbox: clampStage(saved.upgrades?.gearbox),
              brakes: clampStage(saved.upgrades?.brakes),
              tires: clampStage(saved.upgrades?.tires),
              suspension: clampStage(saved.upgrades?.suspension),
              weight: clampStage(saved.upgrades?.weight),
              exhaust: clampStage(saved.upgrades?.exhaust),
              nitroUp: clampStage(saved.upgrades?.nitroUp),
            },
          }
        : def;
    }

    const weather: WeatherMode =
      parsed.weather === 'CLEAR' || parsed.weather === 'SUNSET' || parsed.weather === 'STORM'
        ? parsed.weather
        : INITIAL_PROFILE.weather;

    const activeCarTx = sanitizedCars[activeCarId]?.transmission ?? legacyTx;

    return {
      ...INITIAL_PROFILE,
      ...parsed,
      weather,
      transmission: activeCarTx,
      cash:
        typeof parsed.cash === 'number' && Number.isFinite(parsed.cash)
          ? parsed.cash
          : INITIAL_PROFILE.cash,
      activeCarId,
      ownedCars: validOwned,
      cars: sanitizedCars,
    };
  } catch {
    return INITIAL_PROFILE;
  }
}

function sanitizeKeybindings(raw: unknown): Keybindings {
  const base = cloneDefaultKeybindings();
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  (Object.keys(base) as KeyAction[]).forEach((action) => {
    const val = obj[action];
    if (Array.isArray(val)) {
      const clean = val.filter((c): c is string => typeof c === 'string' && c.length > 0);
      if (clean.length > 0) {
        base[action] = clean;
      }
    }
  });
  return base;
}

function loadSavedSettings(
  fallbackWeather: WeatherMode,
  fallbackTx: SaveProfile['transmission']
): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        ...DEFAULT_SETTINGS,
        keybindings: cloneDefaultKeybindings(),
        weather: fallbackWeather,
        transmission: fallbackTx,
      };
    }
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      keybindings: sanitizeKeybindings(parsed.keybindings),
      graphicsQuality:
        parsed.graphicsQuality === 'LOW' ||
        parsed.graphicsQuality === 'MEDIUM' ||
        parsed.graphicsQuality === 'HIGH'
          ? parsed.graphicsQuality
          : DEFAULT_SETTINGS.graphicsQuality,
      weather:
        parsed.weather === 'CLEAR' || parsed.weather === 'SUNSET' || parsed.weather === 'STORM'
          ? parsed.weather
          : fallbackWeather,
      transmission:
        parsed.transmission === 'AT' || parsed.transmission === 'MT'
          ? parsed.transmission
          : fallbackTx,
      absEnabled:
        typeof parsed.absEnabled === 'boolean'
          ? parsed.absEnabled
          : DEFAULT_SETTINGS.absEnabled,
      speedUnits:
        parsed.speedUnits === 'KMH' || parsed.speedUnits === 'MPH'
          ? parsed.speedUnits
          : DEFAULT_SETTINGS.speedUnits,
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      keybindings: cloneDefaultKeybindings(),
      weather: fallbackWeather,
      transmission: fallbackTx,
    };
  }
}

const INITIAL_HUD: HudSnapshot = {
  mode: 'START_MENU',
  perspective: 'IN_CAR',
  speedKmh: 0,
  rpm: 950,
  maxRpm: 7500,
  gear: 1,
  nitro: 100,
  cdiRacing: false,
  revLimiterActive: false,
  combo: 0,
  comboTimerRatio: 0,
  sessionEarnings: 0,
  distanceKm: 0,
  nearMissBanner: null,
  crashBanner: null,
  mission: {
    mission: MISSIONS_ROTATION[0],
    progress: 0,
    completedBanner: null,
  },
  cameraPreset: 'CHASE',
  nearbyZone: null,
  nearbyDealershipCarId: null,
  inTuningBay: false,
  playerX: 14.5,
  playerZ: 2.8,
  pointerLocked: false,
  radarBlips: [],
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MidnightEngine | null>(null);

  const [profile, setProfile] = useState<SaveProfile>(() => loadSavedProfile());
  const [settings, setSettings] = useState<GameSettings>(() =>
    loadSavedSettings(profile.weather, profile.transmission)
  );
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [dealershipOpen, setDealershipOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 2600);
  }, []);

  const updateAndPersistProfile = useCallback((next: SaveProfile) => {
    setProfile(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
    engineRef.current?.setProfile(next);
  }, []);

  const updateAndPersistSettings = useCallback((patch: Partial<GameSettings>) => {
    setSettings((prev) => {
      const next: GameSettings = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      engineRef.current?.applySettings(next);

      if (patch.weather !== undefined || patch.transmission !== undefined) {
        setProfile((currProfile) => {
          const activeId = currProfile.activeCarId;
          const activeCar = currProfile.cars[activeId];
          const syncedCars =
            patch.transmission !== undefined && activeCar
              ? {
                  ...currProfile.cars,
                  [activeId]: {
                    ...activeCar,
                    transmission: next.transmission,
                  },
                }
              : currProfile.cars;
          const synced: SaveProfile = {
            ...currProfile,
            weather: next.weather,
            transmission: next.transmission,
            cars: syncedCars,
          };
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(synced));
          } catch {
            // ignore
          }
          engineRef.current?.setProfile(synced);
          return synced;
        });
      }
      return next;
    });
  }, []);

  const handleOpenTuning = useCallback((open: boolean) => {
    setTuningOpen(open);
    if (open) {
      setDealershipOpen(false);
      engineRef.current?.exitPointerLock();
    }
    engineRef.current?.setStudioFocusZone(open ? 'TUNING' : 'GARAGE');
  }, []);

  const handleOpenDealership = useCallback((open: boolean) => {
    setDealershipOpen(open);
    if (open) {
      setTuningOpen(false);
      engineRef.current?.exitPointerLock();
    }
    engineRef.current?.setStudioFocusZone(open ? 'DEALERSHIP' : 'GARAGE');
  }, []);

  const handleOpenSettings = useCallback(() => {
    engineRef.current?.exitPointerLock();
    setSettingsOpen(true);
  }, []);

  const walkingInteractRef = useRef<(zone: WalkingInteractionZone) => void>(() => {});
  walkingInteractRef.current = (zone: WalkingInteractionZone) => {
    if (zone === 'CAR') {
      setTuningOpen(false);
      setDealershipOpen(false);
      engineRef.current?.enterCarInParking();
    } else if (zone === 'TUNING') {
      handleOpenTuning(true);
    } else if (zone === 'DEALERSHIP') {
      handleOpenDealership(true);
    }
  };

  const enterTuningBayRef = useRef<() => void>(() => {});
  enterTuningBayRef.current = () => {
    setDealershipOpen(false);
    setTuningOpen(true);
    engineRef.current?.exitPointerLock();
    engineRef.current?.setStudioFocusZone('TUNING');
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const engine = new MidnightEngine({
      container,
      profile,
      settings,
      onHudUpdate: (snap) => setHud(snap),
      onProfileChange: (nextProfile) => {
        setProfile(nextProfile);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProfile));
        } catch {
          // ignore
        }
        setSettings((curr) => {
          if (curr.transmission === nextProfile.transmission && curr.weather === nextProfile.weather) {
            return curr;
          }
          const synced = {
            ...curr,
            transmission: nextProfile.transmission,
            weather: nextProfile.weather,
          };
          try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(synced));
          } catch {
            // ignore
          }
          return synced;
        });
      },
      onContextLost: (lost) => setContextLost(lost),
      onWalkingInteract: (zone) => walkingInteractRef.current(zone),
      onEnterTuningBay: () => enterTuningBayRef.current(),
    });

    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // Mount WebGL canvas once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setKeyCapturePaused(settingsOpen);
  }, [settingsOpen]);

  const handleToggleMute = () => {
    updateAndPersistSettings({ muted: !settings.muted });
  };

  const handleBuyOrSelectCar = (carId: string) => {
    const spec = CAR_CATALOG[carId];
    if (!spec) return;
    const targetCarTx = profile.cars[carId]?.transmission ?? 'AT';

    if (profile.ownedCars.includes(carId)) {
      updateAndPersistProfile({
        ...profile,
        activeCarId: carId,
        transmission: targetCarTx,
      });
      setSettings((curr) => ({ ...curr, transmission: targetCarTx }));
      showToast(`${spec.name} equipado.`);
      return;
    }
    if (profile.cash >= spec.price) {
      updateAndPersistProfile({
        ...profile,
        cash: profile.cash - spec.price,
        ownedCars: [...profile.ownedCars, carId],
        activeCarId: carId,
        transmission: targetCarTx,
      });
      setSettings((curr) => ({ ...curr, transmission: targetCarTx }));
      showToast(`Comprado: ${spec.name}`);
    } else {
      showToast(
        `Fondos insuficientes (faltan $${(spec.price - profile.cash).toLocaleString()}).`
      );
    }
  };

  const handleSpawnCarInFront = (carId: string) => {
    const spec = CAR_CATALOG[carId];
    if (!spec || !profile.ownedCars.includes(carId)) return;
    const carTx = profile.cars[carId]?.transmission ?? 'AT';

    if (profile.activeCarId !== carId || profile.transmission !== carTx) {
      updateAndPersistProfile({
        ...profile,
        activeCarId: carId,
        transmission: carTx,
      });
      setSettings((curr) => ({ ...curr, transmission: carTx }));
    }
    engineRef.current?.spawnCarInFrontOfPlayer();
    showToast(`Generado frente a ti: ${spec.name}`);
  };

  const handleSetCarTransmission = (carId: string, tx: TransmissionMode) => {
    const spec = CAR_CATALOG[carId];
    if (!spec) return;
    const carState = profile.cars[carId] ?? createDefaultCarState(spec);
    const isCurrent = profile.activeCarId === carId;

    const next: SaveProfile = {
      ...profile,
      transmission: isCurrent ? tx : profile.transmission,
      cars: {
        ...profile.cars,
        [carId]: {
          ...carState,
          transmission: tx,
        },
      },
    };
    updateAndPersistProfile(next);
    if (isCurrent) {
      updateAndPersistSettings({ transmission: tx });
    }
    showToast(`${spec.name}: Caja ${tx}`);
  };

  const handleUpgradeCar = (part: UpgradePartKey) => {
    const carId = profile.activeCarId;
    const spec = CAR_CATALOG[carId] ?? CAR_CATALOG.kuruma_2008;
    const carState = profile.cars[carId] ?? createDefaultCarState(spec);
    const lvl = carState.upgrades[part] ?? 0;
    if (lvl >= 3) return;
    const cost = getUpgradeCost(spec, part, lvl);
    if (profile.cash < cost) {
      showToast(`Necesitas $${cost.toLocaleString()} para instalar ${getUpgradeStageLabel(lvl + 1)}.`);
      return;
    }
    const next: SaveProfile = {
      ...profile,
      cash: profile.cash - cost,
      cars: {
        ...profile.cars,
        [carId]: {
          ...carState,
          upgrades: {
            ...carState.upgrades,
            [part]: lvl + 1,
          },
        },
      },
    };
    updateAndPersistProfile(next);
    engineRef.current?.rebuildShowroomCar();
    showToast(`Instalado: ${getUpgradeStageLabel(lvl + 1)} en ${spec.name}.`);
  };

  const handleBuyCdiRacing = () => {
    const carId = profile.activeCarId;
    const spec = CAR_CATALOG[carId] ?? CAR_CATALOG.kuruma_2008;
    const carState = profile.cars[carId] ?? createDefaultCarState(spec);
    if (carState.cdiRacing) return;

    if (profile.cash < CDI_RACING_COST) {
      showToast(`Necesitas $${CDI_RACING_COST.toLocaleString()} para instalar el CDI Racing.`);
      return;
    }

    const defaultBoostRpm = Math.min(
      CDI_MAX_RPM,
      Math.max(8250, Math.round((spec.stockRedlineRpm + 750) / CDI_STEP_RPM) * CDI_STEP_RPM)
    );

    const next: SaveProfile = {
      ...profile,
      cash: profile.cash - CDI_RACING_COST,
      cars: {
        ...profile.cars,
        [carId]: {
          ...carState,
          cdiRacing: true,
          revLimitRpm: defaultBoostRpm,
        },
      },
    };
    updateAndPersistProfile(next);
    showToast(`CDI Racing Programable instalado en ${spec.name}.`);
  };

  const handleSetRevLimitRpm = (rpm: number) => {
    const carId = profile.activeCarId;
    const spec = CAR_CATALOG[carId] ?? CAR_CATALOG.kuruma_2008;
    const carState = profile.cars[carId] ?? createDefaultCarState(spec);
    if (!carState.cdiRacing) return;

    const snapped = Math.min(
      CDI_MAX_RPM,
      Math.max(CDI_MIN_RPM, Math.round(rpm / CDI_STEP_RPM) * CDI_STEP_RPM)
    );
    updateAndPersistProfile({
      ...profile,
      cars: {
        ...profile.cars,
        [carId]: {
          ...carState,
          revLimitRpm: snapped,
        },
      },
    });
  };

  const handleUpdateAppearance = (
    patch: Partial<
      Pick<
        CarState,
        | 'paint'
        | 'paintFinish'
        | 'rimColor'
        | 'rimDesign'
        | 'tireProfile'
        | 'underglow'
        | 'spoiler'
        | 'frontBumper'
        | 'diffuser'
        | 'sportSteering'
        | 'starlightRoof'
        | 'plateText'
        | 'windowTint'
      >
    >
  ) => {
    const carId = profile.activeCarId;
    const spec = CAR_CATALOG[carId] ?? CAR_CATALOG.kuruma_2008;
    const carState = profile.cars[carId] ?? createDefaultCarState(spec);
    updateAndPersistProfile({
      ...profile,
      cars: {
        ...profile.cars,
        [carId]: {
          ...carState,
          ...patch,
        },
      },
    });
  };

  const handleSaveTallerConfig = () => {
    updateAndPersistProfile({ ...profile });
    showToast('Configuraciones guardadas correctamente.');
  };

  const handleResetCarConfig = () => {
    const carId = profile.activeCarId;
    const spec = CAR_CATALOG[carId] ?? CAR_CATALOG.kuruma_2008;
    const resetCar = createDefaultCarState(spec);
    updateAndPersistProfile({
      ...profile,
      transmission: resetCar.transmission,
      cars: {
        ...profile.cars,
        [carId]: resetCar,
      },
    });
    updateAndPersistSettings({ transmission: resetCar.transmission });
    engineRef.current?.rebuildShowroomCar();
    showToast(`${spec.name} restablecido a predeterminado.`);
  };

  const handleResetProgress = () => {
    const fresh: SaveProfile = {
      ...INITIAL_PROFILE,
      weather: settings.weather,
      transmission: settings.transmission,
    };
    setTuningOpen(false);
    setDealershipOpen(false);
    updateAndPersistProfile(fresh);
    engineRef.current?.rebuildShowroomCar();
    showToast('Progreso reiniciado al estado inicial.');
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#050811]">
      {/* Isolated WebGL Canvas Container */}
      <div ref={mountRef} className="absolute inset-0 h-full w-full" />

      {/* Graceful WebGL Context Loss Fallback */}
      {contextLost && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#07090d]/95 p-6 text-center">
          <h2 className="font-display text-2xl font-bold text-white">
            Contexto WebGL pausado
          </h2>
          <p className="mt-2 max-w-md text-sm text-slate-400">
            El navegador suspendió temporalmente los gráficos 3D. Recarga la página si no se restaura automáticamente.
          </p>
        </div>
      )}

      {/* Active Mode UI */}
      {hud.mode === 'START_MENU' && (
        <StartMenuOverlay
          profile={profile}
          keybindings={settings.keybindings}
          onStart={() => {
            engineRef.current?.setMode('WALKING');
          }}
          onOpenSettings={handleOpenSettings}
        />
      )}

      {(hud.mode === 'WALKING' || hud.mode === 'PARKING_DRIVE') && (
        <ShowroomHUD
          profile={profile}
          hud={hud}
          muted={settings.muted}
          speedUnits={settings.speedUnits}
          keybindings={settings.keybindings}
          tuningOpen={tuningOpen}
          dealershipOpen={dealershipOpen}
          toastMessage={toastMessage}
          onToggleMute={handleToggleMute}
          onOpenTuning={handleOpenTuning}
          onOpenDealership={handleOpenDealership}
          onEnterCar={() => {
            setTuningOpen(false);
            setDealershipOpen(false);
            engineRef.current?.enterCarInParking();
          }}
          onExitCar={() => engineRef.current?.exitCarInParking()}
          onTogglePointerLock={() => engineRef.current?.togglePointerLock()}
          onOpenSettings={handleOpenSettings}
          onBuyOrSelectCar={handleBuyOrSelectCar}
          onSpawnCarInFront={handleSpawnCarInFront}
          onUpgradeCar={handleUpgradeCar}
          onBuyCdiRacing={handleBuyCdiRacing}
          onSetRevLimitRpm={handleSetRevLimitRpm}
          onUpdateAppearance={handleUpdateAppearance}
          onSaveTallerConfig={handleSaveTallerConfig}
          onResetCarConfig={handleResetCarConfig}
          onSetCarTransmission={handleSetCarTransmission}
          onStudioAngle={(preset) => engineRef.current?.setStudioAngle(preset)}
          onPreviewDealershipCar={(carId) => engineRef.current?.previewDealershipCar(carId)}
          onRevDealershipCar={(carId) => engineRef.current?.revDealershipCar(carId)}
          onTouchWalk={(k, active) => engineRef.current?.setTouchControl(k, active)}
        />
      )}

      {hud.mode === 'HIGHWAY' && (
        <HighwayHUD
          profile={profile}
          settings={settings}
          hud={hud}
          onExitHighway={() => engineRef.current?.exitToShowroom()}
          onOpenSettings={handleOpenSettings}
          onTogglePointerLock={() => engineRef.current?.togglePointerLock()}
          onToggleTransmission={() => engineRef.current?.toggleTransmission()}
          onToggleTcs={() => updateAndPersistSettings({ tcsEnabled: !settings.tcsEnabled })}
          onToggleAbs={() => updateAndPersistSettings({ absEnabled: !settings.absEnabled })}
          onShiftGear={(d) => engineRef.current?.shiftGear(d)}
          onTouchControl={(k, active) => engineRef.current?.setTouchControl(k, active)}
        />
      )}

      {/* Global Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onUpdateSettings={updateAndPersistSettings}
        onResetProgress={handleResetProgress}
        onReturnToMenu={
          hud.mode !== 'START_MENU'
            ? () => {
                setTuningOpen(false);
                setDealershipOpen(false);
                engineRef.current?.setMode('START_MENU');
              }
            : undefined
        }
      />
    </main>
  );
}
