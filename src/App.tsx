import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { JarvisARController, type HudSnapshot } from './ar/JarvisARController';
import { DEFAULT_SUIT_PRESETS } from './ar/types/SuitPreset';

const INITIAL_HUD: HudSnapshot = {
  bootState: 'loading',
  bootProgress: 8,
  bootTitle: 'STARK INDUSTRIES — MK-85',
  bootMessage: 'Activation des capteurs optiques et post-traitement HDR...',
  systemState: 'INITIALISATION OPTIQUE...',
  webcamStatus: 'ATTENTE',
  holisticInfo: 'CHARGEMENT',
  fps: 60,
  syncPercent: 0,
  arcEnergy: 100,
  calibReadout: '39CM // 1.65M',
  calibrated: false,
  luma: 0.55,
  helmetOpen: false,
  mechaInspect: false,
  repL: 0,
  repR: 0,
  isStealth: false,
  debugEnabled: false,
  voiceEnabled: false,
  audioEnabled: true,
  isDemoMode: false,
  fitScale: 1.0,
  presets: DEFAULT_SUIT_PRESETS,
  selectedPresetId: 'MK85_ENDGAME',
  bloomEnabled: true,
  backendOnline: false,
  telemetrySummary: null,
  logs: [],
};

const RING_CIRCUMFERENCE = 251.3;

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<JarvisARController | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [dockCollapsed, setDockCollapsed] = useState(false);

  useEffect(() => {
    const videoEl = videoRef.current;
    const webglCanvas = webglCanvasRef.current;
    const debugCanvas = debugCanvasRef.current;
    if (!videoEl || !webglCanvas || !debugCanvas) return;

    const ctrl = new JarvisARController(videoEl, webglCanvas, debugCanvas, (snap) => {
      setHud(snap);
    });
    controllerRef.current = ctrl;
    void ctrl.start();

    return () => {
      ctrl.dispose();
      controllerRef.current = null;
    };
  }, []);

  const syncClamped = Math.round(Math.min(100, Math.max(0, hud.syncPercent)));
  const arcClamped = Math.round(Math.min(100, Math.max(0, hud.arcEnergy)));
  const syncOffset = RING_CIRCUMFERENCE * (1 - syncClamped / 100);
  const arcOffset = RING_CIRCUMFERENCE * (1 - arcClamped / 100);
  const activePreset = hud.presets.find((p) => p.id === hud.selectedPresetId) ?? hud.presets[0];

  return (
    <div
      className={`relative w-screen h-screen overflow-hidden bg-[#03070d] select-none ${
        hud.isDemoMode ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      {/* Studio Tactical Backdrop for Demo 3D mode (when no webcam feed) */}
      {hud.isDemoMode && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0"
          style={{
            background:
              'radial-gradient(circle at 50% 42%, rgba(20, 56, 86, 0.52) 0%, rgba(6, 15, 28, 0.94) 62%, #03070d 100%)',
          }}
        />
      )}

      {/* Isolated Video & WebGL/Debug Canvases */}
      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted
        className={`absolute inset-0 w-full h-full object-cover z-[1] -scale-x-100 ${
          hud.isDemoMode ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      />
      <canvas
        ref={webglCanvasRef}
        className="absolute inset-0 w-full h-full z-[2] pointer-events-none"
      />
      <canvas
        ref={debugCanvasRef}
        className="absolute inset-0 w-full h-full z-[3] pointer-events-none"
      />

      {/* Peripheral Vignette & Reticles */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-[4] pointer-events-none"
        style={{
          background: 'radial-gradient(circle at center, transparent 60%, rgba(0, 14, 26, 0.55) 100%)',
        }}
      />
      <div className="hud-reticle-corner tl z-[4]" />
      <div className="hud-reticle-corner tr z-[4]" />
      <div className="hud-reticle-corner bl z-[4]" />
      <div className="hud-reticle-corner br z-[4]" />

      {/* Top-Left Panel: Biometric Sensors & System Telemetry */}
      <motion.aside
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35 }}
        className="hud-panel absolute top-3 left-3 z-[5] w-[238px] px-3 py-2.5 max-md:w-auto max-md:max-w-[46vw]"
      >
        <div className="font-display text-[12px] font-bold tracking-[0.09em] text-[var(--hud-cyan)] flex items-center justify-between gap-2">
          <span>J.A.R.V.I.S. · MK-85</span>
          <span className="font-mono-tech text-[10px] text-[var(--hud-gold)]">
            {hud.isDemoMode ? 'DÉMO 3D' : 'AR LIVE'}
          </span>
        </div>
        <div className="font-mono-tech text-[10px] text-[var(--hud-gold)] mt-0.5 mb-2 tracking-[0.04em] truncate">
          {hud.systemState}
        </div>

        <div className="flex flex-col gap-0.5 font-mono-tech text-[10.5px]">
          <div className="flex justify-between border-b border-[rgba(59,240,255,0.12)] pb-0.5">
            <span className="text-[#d2f6ff]/70">OPTIQUE</span>
            <span className="text-[var(--hud-cyan)] font-semibold">{hud.webcamStatus}</span>
          </div>
          <div className="flex justify-between border-b border-[rgba(59,240,255,0.12)] pb-0.5">
            <span className="text-[#d2f6ff]/70">TRACKING</span>
            <span className="text-[var(--hud-cyan)] font-semibold truncate max-w-[120px]">
              {hud.holisticInfo}
            </span>
          </div>
          <div className="flex justify-between border-b border-[rgba(59,240,255,0.12)] pb-0.5">
            <span className="text-[#d2f6ff]/70">CADENCE</span>
            <span className="text-[var(--hud-cyan)] font-semibold">{Math.round(hud.fps)} FPS</span>
          </div>
          <div className="flex justify-between border-b border-[rgba(59,240,255,0.12)] pb-0.5">
            <span className="text-[#d2f6ff]/70">CORPS</span>
            <span className="text-[var(--hud-cyan)] font-semibold">
              {hud.calibrated ? hud.calibReadout : `CALIB ${hud.calibReadout}`}
            </span>
          </div>
          <div className="flex justify-between border-b border-[rgba(59,240,255,0.12)] pb-0.5">
            <span className="text-[#d2f6ff]/70">RENDU HDR</span>
            <span className="text-[var(--hud-cyan)] font-semibold">
              {hud.bloomEnabled ? 'BLOOM ACES' : 'PBR STD'}
            </span>
          </div>
        </div>
      </motion.aside>

      {/* Top-Right Panel: Sync, ARC Reactor & Live Finish Presets */}
      <motion.aside
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35 }}
        className="hud-panel absolute top-3 right-3 z-[5] w-[224px] px-3 py-2.5 max-md:w-auto max-md:max-w-[46vw]"
      >
        <div className="flex justify-around gap-2">
          <div className="relative w-[66px] h-[66px]">
            <svg viewBox="0 0 100 100" className="arc-svg">
              <circle cx="50" cy="50" r="40" className="arc-bg" />
              <circle
                cx="50"
                cy="50"
                r="40"
                className="arc-fill"
                style={{ strokeDashoffset: syncOffset }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display font-mono-tech text-[13px] font-bold text-white">
                {syncClamped}%
              </span>
              <span className="font-mono-tech text-[8.5px] text-[var(--hud-cyan)] tracking-[0.08em]">
                SYNC
              </span>
            </div>
          </div>

          <div className="relative w-[66px] h-[66px]">
            <svg viewBox="0 0 100 100" className="arc-svg">
              <circle cx="50" cy="50" r="40" className="arc-bg" />
              <circle
                cx="50"
                cy="50"
                r="40"
                className="arc-fill arc-energy"
                style={{ strokeDashoffset: arcOffset }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display font-mono-tech text-[13px] font-bold text-white">
                {arcClamped}%
              </span>
              <span className="font-mono-tech text-[8.5px] text-[var(--hud-cyan)] tracking-[0.08em]">
                ARC
              </span>
            </div>
          </div>
        </div>

        <div className="mt-2 px-2 py-0.5 border border-[var(--hud-border)] bg-[rgba(59,240,255,0.08)] flex items-center justify-between text-[10px] font-mono-tech tracking-[0.05em] text-[var(--hud-cyan)]">
          <span className="truncate">{activePreset?.name ?? 'Mark 85'}</span>
          <span className="text-[var(--hud-gold)] shrink-0 ml-1">
            {hud.backendOnline ? 'CORE OK' : 'LOCAL'}
          </span>
        </div>

        {/* 4 Profils Alliage Serveur ([1]..[4]) */}
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {hud.presets.map((preset, index) => {
            const active = preset.id === hud.selectedPresetId;
            return (
              <button
                key={preset.id}
                type="button"
                title={`${preset.name} (touche ${index + 1})`}
                onClick={() => controllerRef.current?.selectPreset(preset.id)}
                className={`py-0.5 px-1 border font-mono-tech text-[9px] tracking-tight cursor-pointer transition-colors ${
                  active
                    ? 'bg-[rgba(59,240,255,0.24)] border-[var(--hud-gold)] text-white font-semibold'
                    : 'bg-[rgba(10,26,44,0.82)] border-[var(--hud-border)] text-[#cdefff]/80 hover:border-[var(--hud-cyan)] hover:text-white'
                }`}
              >
                {preset.shortLabel}
              </button>
            );
          })}
        </div>
      </motion.aside>

      {/* Bottom-Left Panel: Gesture State & Telemetry Log */}
      {!dockCollapsed && (
        <aside className="hud-panel absolute bottom-14 left-3 z-[5] w-[252px] px-3 py-2 max-xl:hidden">
          <div className="font-display text-[10px] text-[var(--hud-cyan)] mb-1 tracking-[0.08em]">
            TÉLÉMÉTRIE &amp; GESTES
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono-tech text-[#bfefff] mb-1 whitespace-nowrap overflow-hidden">
            <span className={hud.helmetOpen ? 'text-[var(--hud-gold)] font-semibold' : ''}>
              {hud.helmetOpen ? 'Casque: Ouvert' : 'Casque: Scellé'}
            </span>
            <span aria-hidden="true">·</span>
            <span className={hud.repL > 0.45 ? 'text-[var(--hud-cyan)] font-semibold' : ''}>
              {hud.repL > 0.45 ? 'G: Actif' : 'G: Prêt'}
            </span>
            <span aria-hidden="true">·</span>
            <span className={hud.repR > 0.45 ? 'text-[var(--hud-cyan)] font-semibold' : ''}>
              {hud.repR > 0.45 ? 'D: Actif' : 'D: Prêt'}
            </span>
          </div>
          <div className="h-[36px] overflow-hidden font-mono-tech text-[9.5px] leading-[1.3] text-[#d7f8ff]/80">
            {hud.logs.map((entry, idx) => (
              <div key={idx} className="truncate">
                {entry}
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* Collapsible Single-Row Bottom Tactical Control Dock */}
      <div
        className={`fixed bottom-2 left-1/2 -translate-x-1/2 z-[6] flex flex-col items-center max-w-[98vw] transition-transform duration-200 ${
          dockCollapsed ? 'translate-y-[calc(100%-22px)]' : 'translate-y-0'
        }`}
      >
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="px-2.5 py-0.5 bg-[var(--hud-bg)] border border-b-0 border-[var(--hud-border)] text-[10px] font-mono-tech text-[var(--hud-cyan)] hover:text-white flex items-center gap-1 cursor-pointer whitespace-nowrap"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3 h-3" />
              <span>Commandes</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              <span>Masquer</span>
            </>
          )}
        </button>

        <div className="hud-panel px-1.5 py-1 max-w-[97vw] flex flex-nowrap items-center gap-1 overflow-x-auto">
          <HudActionButton
            kbd="S"
            label="Suit-Up"
            onClick={() => controllerRef.current?.triggerSuitUp()}
          />
          <HudActionButton
            kbd="H"
            label={hud.helmetOpen ? 'Sceller' : 'Casque'}
            active={hud.helmetOpen}
            onClick={() => controllerRef.current?.toggleHelmet()}
          />
          <HudActionButton
            kbd="X"
            label="Méca"
            active={hud.mechaInspect}
            onClick={() => controllerRef.current?.toggleMechaInspect()}
          />
          <HudActionButton
            kbd="R"
            label="Tir"
            onClick={() => controllerRef.current?.fireRepulsor('right')}
          />
          <HudActionButton
            kbd="D"
            label="Squel."
            active={hud.debugEnabled}
            onClick={() => controllerRef.current?.toggleDebug()}
          />
          <HudActionButton
            kbd="M"
            label={hud.isStealth ? 'Combat' : 'Furtif'}
            active={hud.isStealth}
            onClick={() => controllerRef.current?.toggleStealthMode()}
          />
          <HudActionButton
            kbd="V"
            label="Voix"
            active={hud.voiceEnabled}
            onClick={() => controllerRef.current?.toggleVoiceControl()}
          />
          <HudActionButton
            kbd="C"
            label="Calib"
            onClick={() => controllerRef.current?.resetCalibration()}
          />
          <HudActionButton
            kbd="♪"
            label={hud.audioEnabled ? 'Son' : 'Muet'}
            active={hud.audioEnabled}
            onClick={() => controllerRef.current?.toggleAudio()}
          />
          <HudActionButton
            kbd="3D"
            label={hud.isDemoMode ? 'Webcam' : 'Démo 3D'}
            active={hud.isDemoMode}
            onClick={() => {
              if (hud.isDemoMode) void controllerRef.current?.start();
              else controllerRef.current?.startDemoMode();
            }}
          />
          <div className="flex items-center border border-[var(--hud-border)] bg-[rgba(10,26,44,0.82)] shrink-0">
            <button
              type="button"
              aria-label="Réduire la taille de l'armure"
              onClick={() => controllerRef.current?.adjustFitScale(-0.05)}
              className="px-1.5 py-1 font-display text-[10px] font-bold text-[var(--hud-cyan)] hover:text-white hover:bg-[rgba(59,240,255,0.18)] cursor-pointer transition-colors"
            >
              −
            </button>
            <span className="px-1.5 py-1 font-mono-tech text-[10px] text-[#dff9ff] border-x border-[var(--hud-border)] whitespace-nowrap">
              {Math.round(hud.fitScale * 100)}%
            </span>
            <button
              type="button"
              aria-label="Agrandir la taille de l'armure"
              onClick={() => controllerRef.current?.adjustFitScale(0.05)}
              className="px-1.5 py-1 font-display text-[10px] font-bold text-[var(--hud-cyan)] hover:text-white hover:bg-[rgba(59,240,255,0.18)] cursor-pointer transition-colors"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Boot / Webcam Error Overlay */}
      <AnimatePresence>
        {hud.bootState !== 'ready' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 z-20 bg-[#030912]/90 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              className="hud-panel w-full max-w-[460px] p-6 text-center"
            >
              {hud.bootState === 'loading' && <div className="arc-spinner mx-auto mb-4" />}
              <h1 className="font-display text-[17px] font-bold text-[var(--hud-cyan)] tracking-[0.1em] mb-2.5">
                {hud.bootTitle}
              </h1>
              <p className="text-[13.5px] text-[#cbeeff] leading-relaxed mb-4">{hud.bootMessage}</p>
              <div className="w-full h-1.5 bg-white/10 overflow-hidden mb-5">
                <div
                  className="h-full transition-all duration-200"
                  style={{
                    width: `${Math.min(100, Math.max(0, hud.bootProgress))}%`,
                    background: 'linear-gradient(90deg, var(--hud-cyan), var(--hud-gold))',
                  }}
                />
              </div>

              {hud.bootState === 'error' && (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => void controllerRef.current?.start()}
                    className="px-4 py-2.5 bg-[rgba(255,59,78,0.22)] border border-[var(--hud-red)] text-white font-display text-[12px] tracking-wider cursor-pointer hover:bg-[rgba(255,59,78,0.34)] transition-colors whitespace-nowrap"
                  >
                    Réactiver la webcam
                  </button>
                  <button
                    type="button"
                    onClick={() => controllerRef.current?.startDemoMode()}
                    className="px-4 py-2.5 bg-[rgba(59,240,255,0.18)] border border-[var(--hud-cyan)] text-[#dff9ff] font-display text-[12px] tracking-wider cursor-pointer hover:bg-[rgba(59,240,255,0.30)] transition-colors whitespace-nowrap"
                  >
                    Lancer Démo 3D (Sans Webcam)
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface HudActionButtonProps {
  kbd: string;
  label: string;
  active?: boolean;
  onClick: () => void;
}

function HudActionButton({ kbd, label, active = false, onClick }: HudActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 border font-mono-tech text-[10.5px] flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
        active
          ? 'bg-[rgba(59,240,255,0.24)] border-[var(--hud-gold)] text-white'
          : 'bg-[rgba(10,26,44,0.82)] border-[var(--hud-border)] text-[#dff9ff] hover:bg-[rgba(59,240,255,0.18)] hover:border-[var(--hud-cyan)]'
      }`}
    >
      <kbd className="inline-block min-w-[16px] text-center px-1 py-0.5 font-display text-[9px] font-bold bg-[rgba(59,240,255,0.16)] border border-[var(--hud-cyan)] text-[var(--hud-cyan)]">
        {kbd}
      </kbd>
      <span>{label}</span>
    </button>
  );
}
