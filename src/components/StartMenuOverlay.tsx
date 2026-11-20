import React from 'react';
import { Play, Sliders } from 'lucide-react';
import {
  CAR_CATALOG,
  formatPrimaryKeyLabel,
  Keybindings,
  SaveProfile,
} from '../game/types';

interface StartMenuOverlayProps {
  profile: SaveProfile;
  keybindings: Keybindings;
  onStart: () => void;
  onOpenSettings: () => void;
}

export const StartMenuOverlay: React.FC<StartMenuOverlayProps> = ({
  profile,
  keybindings,
  onStart,
  onOpenSettings,
}) => {
  const activeSpec = CAR_CATALOG[profile.activeCarId] ?? CAR_CATALOG.kuruma_2008;
  const enterKey = formatPrimaryKeyLabel(keybindings.enterExitCar);
  const nitroKey = formatPrimaryKeyLabel(keybindings.nitro);
  const pointerKey = formatPrimaryKeyLabel(keybindings.togglePointerLock);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-6 md:p-10">
      {/* Top gradient scrim leaving central 3D parking & Highway traffic unobstructed */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-44"
        style={{
          background:
            'linear-gradient(180deg, rgba(6,8,12,0.88) 0%, rgba(6,8,12,0.45) 60%, rgba(6,8,12,0) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-56"
        style={{
          background:
            'linear-gradient(0deg, rgba(6,8,12,0.92) 0%, rgba(6,8,12,0.5) 58%, rgba(6,8,12,0) 100%)',
        }}
      />

      {/* Top Brand Header */}
      <header className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="mt-1 h-11 w-[3px] bg-[#e10600]" />
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.26em] text-slate-300">
              Tokyo Wangan · Simulador Urbano
            </div>
            <h1 className="font-display text-4xl md:text-6xl font-bold tracking-[0.1em] text-white uppercase leading-none mt-1">
              Midnight Club
            </h1>
            <div className="mt-1.5 text-xs md:text-sm tracking-[0.22em] text-slate-400 uppercase">
              No Hesi Web 3D · {activeSpec.name}
            </div>
          </div>
        </div>

        <div className="border border-white/[0.1] bg-[#090b10]/90 px-4 py-2.5 text-right">
          <div className="text-[9px] uppercase tracking-[0.2em] text-slate-400">
            Fondos Disponibles
          </div>
          <div className="font-telemetry text-lg font-semibold text-white">
            ${profile.cash.toLocaleString()}
          </div>
        </div>
      </header>

      {/* Bottom Action Bar */}
      <footer className="relative flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="pointer-events-auto flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onStart}
            className="flex items-center gap-3 bg-[#e10600] px-8 py-3.5 text-sm font-bold uppercase tracking-[0.2em] text-white hover:bg-[#ff1812] transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xl"
          >
            <Play className="h-4 w-4 fill-current" />
            Iniciar
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-2.5 border border-white/20 bg-[#090b10]/90 px-6 py-3.5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100 hover:border-white/45 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sliders className="h-4 w-4 text-[#e10600]" />
            Ajustes
          </button>
        </div>

        <div className="border-l border-white/15 pl-4 text-[11px] leading-relaxed text-slate-300 max-w-md">
          <div className="uppercase tracking-[0.18em] text-slate-400 text-[10px] mb-1">
            Parking Central · Circuito Cerrado
          </div>
          <div>
            Aparecerás a pie frente al Taller y el Concesionario. Pulsa{' '}
            <span className="font-telemetry text-white font-semibold">{enterKey}</span> para subir al coche,{' '}
            <span className="font-telemetry text-white font-semibold">{nitroKey}</span> para Nitro y{' '}
            <span className="font-telemetry text-white font-semibold">{pointerKey}</span> para cámara libre 360°.
          </div>
        </div>
      </footer>
    </div>
  );
};
