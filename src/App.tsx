import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { JarvisARController, type HudSnapshot } from './ar/JarvisARController';

const INITIAL_HUD: HudSnapshot = {
  bootState: 'loading',
  bootProgress: 8,
  bootTitle: 'STARK INDUSTRIES — MK-85',
  bootMessage: 'Activation des capteurs optiques et shaders Nanotech...',
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
  repL: 0,
  repR: 0,
  isStealth: false,
  debugEnabled: false,
  voiceEnabled: false,
  audioEnabled: true,
  isDemoMode: false,
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

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#03070d] select-none">
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
      <aside className="hud-panel absolute top-5 left-5 z-[5] w-[268px] px-3.5 py-3 max-md:w-auto max-md:max-w-[46vw]">
        <div className="font-display text-[13px] font-bold tracking-[0.1em] text-[var(--hud-cyan)] flex items-center justify-between gap-2">
          <span>J.A.R.V.I.S. · MK-85</span>
          <span className="font-mono-tech text-[11px] text-[var(--hud-gold)]">
            {hud.isDemoMode ? 'DÉMO 3D' : 'AR LIVE'}
          </span>
        </div>
        <div className="font-mono-tech text-[11px] text-[var(--hud-gold)] mt-1 mb-2.5 tracking-[0.05em] truncate">
          {hud.systemState}
        </div>

        <div className="flex flex-col gap-1 font-mono-tech text-[11.5px]">
          <div className="flex justify-between border-b border-[rgba(59,240,255,0.12)] pb-0.5">
            <span className="text-[#d2f6ff]/70">SOURCE OPTIQUE</span>
            <span className="text-[var(--hud-cyan)] font-semibold">{hud.webcamStatus}</span>
          </div>
          <div className="flex justify-between border-b border-[rgba(59,240,255,0.12)] pb-0.5">
            <span className="text-[#d2f6ff]/70">HOLISTIC MESH</span>
            <span className="text-[var(--hud-cyan)] font-semibold truncate max-w-[132px]">
              {hud.holisticInfo}
            </span>
          </div>
          <div className="flex justify-between border-b border-[rgba(59,240,255,0.12)] pb-0.5">
            <span className="text-[#d2f6ff]/70">ONE-EURO 60FPS</span>
            <span className="text-[var(--hud-cyan)] font-semibold">{Math.round(hud.fps)} FPS</span>
          </div>
          <div className="flex justify-between border-b border-[rgba(59,240,255,0.12)] pb-0.5">
            <span className="text-[#d2f6ff]/70">MORPHOLOGIE</span>
            <span className="text-[var(--hud-cyan)] font-semibold">
              {hud.calibrated ? hud.calibReadout : `CALIB... ${hud.calibReadout}`}
            </span>
          </div>
          <div className="flex justify-between border-b border-[rgba(59,240,255,0.12)] pb-0.5">
            <span className="text-[#d2f6ff]/70">ENV LIGHTING</span>
            <span className="text-[var(--hud-cyan)] font-semibold">{Math.round(hud.luma * 100)}% LUM</span>
          </div>
        </div>
      </aside>

      {/* Top-Right Panel: Sync & ARC Reactor Gauges */}
      <aside className="hud-panel absolute top-5 right-5 z-[5] w-[244px] px-3.5 py-3 max-md:w-auto max-md:max-w-[46vw]">
        <div className="flex justify-around gap-2.5">
          <div className="relative w-[80px] h-[80px]">
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
              <span className="font-display font-mono-tech text-[14px] font-bold text-white">
                {syncClamped}%
              </span>
              <span className="font-mono-tech text-[9.5px] text-[var(--hud-cyan)] tracking-[0.08em]">
                SYNC
              </span>
            </div>
          </div>

          <div className="relative w-[80px] h-[80px]">
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
              <span className="font-display font-mono-tech text-[14px] font-bold text-white">
                {arcClamped}%
              </span>
              <span className="font-mono-tech text-[9.5px] text-[var(--hud-cyan)] tracking-[0.08em]">
                ARC CORE
              </span>
            </div>
          </div>
        </div>

        <div className="mt-2.5 px-2 py-1 border border-[var(--hud-border)] bg-[rgba(59,240,255,0.08)] flex items-center justify-between text-[11px] font-mono-tech tracking-[0.06em] text-[var(--hud-cyan)]">
          <span>{hud.isStealth ? 'MODE FURTIF ACTIF' : 'MODE COMBAT ACTIF'}</span>
          <span className="text-[var(--hud-gold)]">{hud.isStealth ? 'STEALTH' : 'MK-85'}</span>
        </div>
      </aside>

      {/* Bottom-Left Panel: Gesture State & Telemetry Log */}
      {!dockCollapsed && (
        <aside className="hud-panel absolute bottom-5 left-5 z-[5] w-[305px] px-3.5 py-2.5 max-lg:hidden">
          <div className="font-display text-[11px] text-[var(--hud-cyan)] mb-1.5 tracking-[0.08em]">
            TÉLÉMÉTRIE &amp; GESTES
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono-tech text-[#bfefff] mb-1.5 whitespace-nowrap overflow-hidden">
            <span className={hud.helmetOpen ? 'text-[var(--hud-gold)] font-semibold' : ''}>
              {hud.helmetOpen ? 'Casque: Ouvert' : 'Casque: Scellé'}
            </span>
            <span aria-hidden="true">·</span>
            <span className={hud.repL > 0.45 ? 'text-[var(--hud-cyan)] font-semibold' : ''}>
              {hud.repL > 0.45 ? 'G-Rép: Actif' : 'G-Rép: Veille'}
            </span>
            <span aria-hidden="true">·</span>
            <span className={hud.repR > 0.45 ? 'text-[var(--hud-cyan)] font-semibold' : ''}>
              {hud.repR > 0.45 ? 'D-Rép: Actif' : 'D-Rép: Veille'}
            </span>
          </div>
          <div className="h-[52px] overflow-hidden font-mono-tech text-[10.5px] leading-[1.35] text-[#d7f8ff]/85">
            {hud.logs.map((entry, idx) => (
              <div key={idx} className="truncate">
                {entry}
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* Collapsible Bottom Tactical Control Dock */}
      <div
        className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[6] flex flex-col items-center transition-transform duration-200 ${
          dockCollapsed ? 'translate-y-[calc(100%-24px)]' : 'translate-y-0'
        }`}
      >
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="px-3 py-1 bg-[var(--hud-bg)] border border-b-0 border-[var(--hud-border)] text-[11px] font-mono-tech text-[var(--hud-cyan)] hover:text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>Afficher les commandes</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>Masquer les commandes</span>
            </>
          )}
        </button>

        <div className="hud-panel px-2.5 py-2 max-w-[94vw] flex flex-wrap items-center justify-center gap-1.5">
          <HudActionButton
            kbd="S"
            label="Suit-Up Nanotech"
            onClick={() => controllerRef.current?.triggerSuitUp()}
          />
          <HudActionButton
            kbd="H"
            label={hud.helmetOpen ? 'Fermer casque' : 'Ouvrir casque'}
            active={hud.helmetOpen}
            onClick={() => controllerRef.current?.toggleHelmet()}
          />
          <HudActionButton
            kbd="R"
            label="Tir répulseur"
            onClick={() => controllerRef.current?.fireRepulsor('right')}
          />
          <HudActionButton
            kbd="D"
            label="Squelette 2D"
            active={hud.debugEnabled}
            onClick={() => controllerRef.current?.toggleDebug()}
          />
          <HudActionButton
            kbd="M"
            label={hud.isStealth ? 'Mode Combat' : 'Mode Furtif'}
            active={hud.isStealth}
            onClick={() => controllerRef.current?.toggleStealthMode()}
          />
          <HudActionButton
            kbd="V"
            label="Voix J.A.R.V.I.S."
            active={hud.voiceEnabled}
            onClick={() => controllerRef.current?.toggleVoiceControl()}
          />
          <HudActionButton
            kbd="C"
            label="Recalibrer"
            onClick={() => controllerRef.current?.resetCalibration()}
          />
          <HudActionButton
            kbd="♪"
            label={hud.audioEnabled ? 'Audio actif' : 'Audio muet'}
            active={hud.audioEnabled}
            onClick={() => controllerRef.current?.toggleAudio()}
          />
          <HudActionButton
            kbd="3D"
            label={hud.isDemoMode ? 'Activer Webcam' : 'Démo 3D'}
            active={hud.isDemoMode}
            onClick={() => {
              if (hud.isDemoMode) void controllerRef.current?.start();
              else controllerRef.current?.startDemoMode();
            }}
          />
        </div>
      </div>

      {/* Boot / Webcam Error Overlay */}
      {hud.bootState !== 'ready' && (
        <div className="absolute inset-0 z-20 bg-[#030912]/90 flex items-center justify-center p-4">
          <div className="hud-panel w-full max-w-[460px] p-6 text-center">
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
          </div>
        </div>
      )}
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
      className={`px-2.5 py-1.5 border font-mono-tech text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
        active
          ? 'bg-[rgba(59,240,255,0.24)] border-[var(--hud-gold)] text-white'
          : 'bg-[rgba(10,26,44,0.82)] border-[var(--hud-border)] text-[#dff9ff] hover:bg-[rgba(59,240,255,0.18)] hover:border-[var(--hud-cyan)]'
      }`}
    >
      <kbd className="inline-block min-w-[18px] text-center px-1 py-0.5 font-display text-[10px] font-bold bg-[rgba(59,240,255,0.16)] border border-[var(--hud-cyan)] text-[var(--hud-cyan)]">
        {kbd}
      </kbd>
      <span>{label}</span>
    </button>
  );
}
