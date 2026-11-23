import * as THREE from 'three';
import { CalibrationEngine } from './core/CalibrationEngine';
import { TrackingEngine } from './vision/TrackingEngine';
import { DebugSkeleton } from './vision/DebugSkeleton';
import { createMark85Materials, type Mark85MaterialLibrary } from './graphics/Mark85Materials';
import { Mark85ArmorRig } from './graphics/Mark85ArmorRig';
import {
  ArmorSocketManager,
  type ArmorSocketId,
  type ArmorSocketStatus,
  type CustomPartAttachOptions,
} from './graphics/ArmorSockets';
import { NanotechVFX } from './graphics/NanotechVFX';
import { EnvLighting } from './graphics/EnvLighting';
import { CinemaPostProcess } from './graphics/CinemaPostProcess';
import { AudioSynth } from './audio/AudioSynth';
import { BackendClient } from './services/BackendClient';
import {
  DEFAULT_SUIT_PRESETS,
  type SuitPreset,
  type SuitPresetId,
  type TelemetrySummary,
} from './types/SuitPreset';

interface JarvisWindowBridge {
  JARVIS_AR?: {
    attachCustomPart: (
      socketId: ArmorSocketId,
      source: string | File,
      options?: CustomPartAttachOptions
    ) => Promise<void>;
    detachCustomPart: (socketId: ArmorSocketId) => void;
    listSockets: () => ArmorSocketStatus[];
  };
}

export interface HudSnapshot {
  bootState: 'loading' | 'ready' | 'error';
  bootProgress: number;
  bootTitle: string;
  bootMessage: string;
  systemState: string;
  webcamStatus: string;
  holisticInfo: string;
  fps: number;
  syncPercent: number;
  arcEnergy: number;
  calibReadout: string;
  calibrated: boolean;
  scanProgress: number;
  frontScanned: boolean;
  backScanned: boolean;
  isBackFacing: boolean;
  suitStageLabel: string;
  luma: number;
  helmetOpen: boolean;
  mechaInspect: boolean;
  repL: number;
  repR: number;
  isStealth: boolean;
  debugEnabled: boolean;
  voiceEnabled: boolean;
  audioEnabled: boolean;
  isDemoMode: boolean;
  fitScale: number;
  presets: SuitPreset[];
  selectedPresetId: SuitPresetId;
  bloomEnabled: boolean;
  backendOnline: boolean;
  telemetrySummary: TelemetrySummary | null;
  socketStatuses: ArmorSocketStatus[];
  videoDevices: VideoDeviceOption[];
  selectedVideoDeviceId: string;
  logs: string[];
}

export interface VideoDeviceOption {
  deviceId: string;
  label: string;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export class JarvisARController {
  private videoEl: HTMLVideoElement;
  private webglCanvas: HTMLCanvasElement;
  private debugCanvas: HTMLCanvasElement;
  private onSnapshot: (snap: HudSnapshot) => void;

  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private postProcess: CinemaPostProcess | null = null;

  private calibration: CalibrationEngine;
  private tracking: TrackingEngine;
  private debugSkeleton: DebugSkeleton;
  private materials: Mark85MaterialLibrary;
  private armorRig: Mark85ArmorRig;
  private socketManager: ArmorSocketManager;
  private vfx: NanotechVFX;
  private envLighting: EnvLighting;
  private audio: AudioSynth;
  private backend = new BackendClient();

  private stream: MediaStream | null = null;
  private startSeq = 0;
  private videoDevices: VideoDeviceOption[] = [];
  private selectedVideoDeviceId = '';
  private recognition: SpeechRecognitionLike | null = null;

  private presets: SuitPreset[] = DEFAULT_SUIT_PRESETS;
  private selectedPresetId: SuitPresetId = 'MK85_ENDGAME';
  private lastCombatPresetId: SuitPresetId = 'MK85_ENDGAME';
  private backendOnline = false;
  private telemetrySummary: TelemetrySummary | null = null;
  private pendingSuitUpTelemetry = 0;
  private pendingShotsTelemetry = 0;
  private telemetrySyncTimer = 0;
  private calibrationSavedOnLock = false;
  private backScanSavedOnLock = false;

  private suitProgress = 0.0;
  private suitAnimating = false;
  private isStealth = false;
  private stealthMix = 0.0;
  private arcEnergy = 100.0;
  private voiceEnabled = false;
  private isDemoMode = false;
  private fitScale = 1.0;

  private demoYawTarget = 0;
  private isDraggingYaw = false;
  private dragStartX = 0;
  private dragStartYaw = 0;

  private bootState: 'loading' | 'ready' | 'error' = 'loading';
  private bootProgress = 5;
  private bootTitle = 'STARK INDUSTRIES — MK-42 / MK-85';
  private bootMessage = 'Activation des capteurs optiques 360° et rendu métallique ACES...';
  private systemState = 'INITIALISATION OPTIQUE...';
  private webcamStatus = 'ATTENTE';
  private holisticInfo = 'CHARGEMENT';

  private prevPalmOpen = { left: false, right: false };
  private palmChargeTimer = { left: 0, right: 0 };
  private lastGestureActionMs = 0;

  private lastFrameTime = performance.now();
  private fpsSmooth = 60;
  private hudTimer = 0;
  private frameId = 0;
  private isTimeoutFrame = false;
  private disposed = false;
  private logs: string[] = [];

  private readonly _onResizeBound: () => void;
  private readonly _onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly _onPointerDownBound: (e: PointerEvent) => void;
  private readonly _onPointerMoveBound: (e: PointerEvent) => void;
  private readonly _onPointerUpBound: () => void;
  private readonly _onContextLostBound: (e: Event) => void;
  private readonly _onContextRestoredBound: () => void;

  constructor(
    videoEl: HTMLVideoElement,
    webglCanvas: HTMLCanvasElement,
    debugCanvas: HTMLCanvasElement,
    onSnapshot: (snap: HudSnapshot) => void
  ) {
    this.videoEl = videoEl;
    this.webglCanvas = webglCanvas;
    this.debugCanvas = debugCanvas;
    this.onSnapshot = onSnapshot;

    this.isSoftwareGl = detectSoftwareWebGL();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.webglCanvas,
      alpha: true,
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    // Focale verticale 41° alignée sur l'optique réelle d'une webcam 16:9 (zéro déformation grand-angle)
    this.camera = new THREE.PerspectiveCamera(41, window.innerWidth / Math.max(window.innerHeight, 1), 0.05, 30);
    this.camera.position.set(0, 0, 0);

    this.calibration = new CalibrationEngine(this.camera);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.materials = createMark85Materials(maxAniso);
    this.armorRig = new Mark85ArmorRig(this.materials);
    if (!this.isSoftwareGl) {
      this.armorRig.root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (
          mesh.isMesh &&
          mesh.material !== this.materials.depthOccluder &&
          mesh.material !== this.materials.emissiveCyan &&
          mesh.material !== this.materials.pulseGlow &&
          (mesh.material as THREE.Material).colorWrite !== false
        ) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
    }
    this.scene.add(this.armorRig.root);
    this.socketManager = new ArmorSocketManager(this.armorRig.getSocketEntries());

    this.vfx = new NanotechVFX(this.scene);
    this.envLighting = new EnvLighting(this.renderer, this.scene, this.isSoftwareGl);
    this.audio = new AudioSynth();
    this.tracking = new TrackingEngine();
    this.debugSkeleton = new DebugSkeleton(this.debugCanvas);

    if (!this.isSoftwareGl) {
      this.postProcess = new CinemaPostProcess(this.renderer, this.scene, this.camera);
      this.renderer.compile(this.scene, this.camera);
    }

    this._onResizeBound = () => this._onResize();
    this._onKeyDownBound = (e: KeyboardEvent) => this._handleKeyDown(e);
    this._onPointerDownBound = (e: PointerEvent) => {
      this.audio.unlock();
      if (this.isDemoMode && e.button === 0) {
        const target = e.target as HTMLElement | null;
        if (!target || !target.closest('button')) {
          this.isDraggingYaw = true;
          this.dragStartX = e.clientX;
          this.dragStartYaw = this.demoYawTarget;
        }
      }
    };
    this._onPointerMoveBound = (e: PointerEvent) => {
      if (!this.isDraggingYaw || !this.isDemoMode) return;
      const dx = e.clientX - this.dragStartX;
      this.demoYawTarget = this.dragStartYaw + (dx / Math.max(window.innerWidth, 360)) * 5.2;
    };
    this._onPointerUpBound = () => {
      this.isDraggingYaw = false;
    };
    this._onContextLostBound = (e: Event) => {
      e.preventDefault();
      this.addLog('Contexte WebGL interrompu. Récupération...');
    };
    this._onContextRestoredBound = () => {
      this.addLog('Contexte WebGL restauré.');
    };

    this._onResize();
    window.addEventListener('resize', this._onResizeBound);
    window.addEventListener('keydown', this._onKeyDownBound);
    window.addEventListener('pointerdown', this._onPointerDownBound);
    window.addEventListener('pointermove', this._onPointerMoveBound);
    window.addEventListener('pointerup', this._onPointerUpBound);
    window.addEventListener('pointercancel', this._onPointerUpBound);
    this.webglCanvas.addEventListener('webglcontextlost', this._onContextLostBound);
    this.webglCanvas.addEventListener('webglcontextrestored', this._onContextRestoredBound);

    (window as unknown as JarvisWindowBridge).JARVIS_AR = {
      attachCustomPart: (socketId, source, options) => this.attachCustomPart(socketId, source, options),
      detachCustomPart: (socketId) => this.detachCustomPart(socketId),
      listSockets: () => this.getSocketStatuses(),
    };

    void this._bootstrapBackend();
    void this._loadSocketManifest();
  }

  private async _loadSocketManifest(): Promise<void> {
    const count = await this.socketManager.loadManifest('/assets/suit-parts/manifest.json');
    if (this.disposed) return;
    if (count > 0) {
      this.addLog(`${count} pièce(s) .GLB personnalisée(s) montée(s) depuis manifest.json.`);
      this.emitSnapshot();
    }
  }

  getSocketStatuses(): ArmorSocketStatus[] {
    return this.socketManager.listStatuses();
  }

  async attachCustomPart(
    socketId: ArmorSocketId,
    source: string | File,
    options?: CustomPartAttachOptions
  ): Promise<void> {
    await this.socketManager.attachCustomPart(socketId, source, options);
    if (this.disposed) return;
    const entry = this.armorRig.getSocketEntries().find((s) => s.id === socketId);
    if (entry) {
      entry.customRoot.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.renderOrder = 2;
          mesh.castShadow = !this.isSoftwareGl;
          mesh.receiveShadow = !this.isSoftwareGl;
        }
      });
    }
    const label = entry?.customSourceName ?? 'modèle 3D';
    this.addLog(`Pièce personnalisée montée sur [${socketId}] : ${label}`);
    this.emitSnapshot();
  }

  detachCustomPart(socketId: ArmorSocketId): void {
    this.socketManager.detachCustomPart(socketId);
    this.addLog(`Socket [${socketId}] restauré sur le maillage mécatronique natif.`);
    this.emitSnapshot();
  }

  private async _bootstrapBackend(): Promise<void> {
    const [health, presets, savedCal] = await Promise.all([
      this.backend.getHealth(),
      this.backend.getSuitPresets(),
      this.backend.getCalibration(),
    ]);
    if (this.disposed) return;

    this.backendOnline = Boolean(health && health.status === 'operational');
    this.presets = presets;
    this.fitScale = savedCal.fitScale;
    this.calibration.metricShoulderWidth = savedCal.metricShoulderWidth;
    this.calibration.torsoAspectRatio = savedCal.torsoAspectRatio;
    this.calibration.waistWidthFactor = savedCal.waistWidthFactor;
    this.calibration.armGirthFactor = savedCal.armGirthFactor;
    this.calibration.frontScanned = savedCal.frontScanned;
    this.calibration.backScanned = savedCal.backScanned;
    this.selectPreset(savedCal.selectedPresetId, false);
    if (this.backendOnline) {
      this.addLog('Noyau serveur J.A.R.V.I.S. connecté (profil 360° restauré).');
    }
    this.emitSnapshot();
  }

  private _onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.postProcess?.setSize(w, h);
    this.debugCanvas.width = w;
    this.debugCanvas.height = h;
  }

  private addLog(msg: string): void {
    const time = new Date().toLocaleTimeString('fr-FR', { hour12: false });
    this.logs = [`[${time}] ${msg}`, ...this.logs].slice(0, 4);
  }

  private emitSnapshot(): void {
    this.onSnapshot({
      bootState: this.bootState,
      bootProgress: this.bootProgress,
      bootTitle: this.bootTitle,
      bootMessage: this.bootMessage,
      systemState: this.systemState,
      webcamStatus: this.webcamStatus,
      holisticInfo: this.holisticInfo,
      fps: this.fpsSmooth,
      syncPercent: this.calibration.syncPercent,
      arcEnergy: this.arcEnergy,
      calibReadout: this.calibration.getCalibratedReadout(),
      calibrated: this.calibration.calibrated,
      scanProgress: this.calibration.scanProgress,
      frontScanned: this.calibration.frontScanned,
      backScanned: this.calibration.backScanned,
      isBackFacing: this.calibration.isBackFacing,
      suitStageLabel: this.armorRig.activeStageLabel,
      luma: this.envLighting.lumaSummary,
      helmetOpen: this.armorRig.helmetOpenTarget > 0.5,
      mechaInspect: this.armorRig.mechaInspectTarget > 0.5,
      repL: this.armorRig.repulsorCharge.left,
      repR: this.armorRig.repulsorCharge.right,
      isStealth: this.isStealth,
      debugEnabled: this.debugSkeleton.enabled,
      voiceEnabled: this.voiceEnabled,
      audioEnabled: this.audio.enabled,
      isDemoMode: this.isDemoMode,
      fitScale: this.fitScale,
      presets: this.presets,
      selectedPresetId: this.selectedPresetId,
      bloomEnabled: this.postProcess !== null,
      backendOnline: this.backendOnline,
      telemetrySummary: this.telemetrySummary,
      socketStatuses: this.socketManager.listStatuses(),
      videoDevices: this.videoDevices,
      selectedVideoDeviceId: this.selectedVideoDeviceId,
      logs: this.logs,
    });
  }

  selectPreset(presetId: SuitPresetId, persist = true): void {
    const preset = this.presets.find((p) => p.id === presetId) ?? this.presets[0];
    if (!preset) return;

    this.selectedPresetId = preset.id;
    if (preset.id !== 'MK85_STEALTH_OPS') {
      this.lastCombatPresetId = preset.id;
    }

    this.isStealth = preset.id === 'MK85_STEALTH_OPS';
    document.body.classList.toggle('stealth-theme', this.isStealth);

    this.materials.applyPreset(preset);
    this.postProcess?.setBloomStrength(preset.bloomStrength);

    if (persist) {
      this.addLog(`Profil armure activé : ${preset.name}.`);
      void this.backend.saveCalibration({
        selectedPresetId: preset.id,
        bloomStrength: preset.bloomStrength,
      });
    }
    this.emitSnapshot();
  }

  async start(preferredDeviceId?: string): Promise<void> {
    const seq = ++this.startSeq;
    const wasDemo = this.isDemoMode;

    this._stopLoop();
    this.isDemoMode = false;
    this.demoYawTarget = 0;
    this.tracking.demoYaw = 0;
    this.isDraggingYaw = false;
    if (wasDemo) {
      this.calibration.resetCalibration();
    }
    this.calibrationSavedOnLock = false;
    this.backScanSavedOnLock = false;

    if (typeof preferredDeviceId === 'string') {
      this.selectedVideoDeviceId = preferredDeviceId;
    }

    this.bootState = 'loading';
    this.bootTitle = 'STARK INDUSTRIES — MK-42 / MK-85';
    this.bootProgress = 12;
    this.bootMessage = 'Initialisation de la caméra HD...';
    this.emitSnapshot();

    let webcamReady = false;
    try {
      await this._startWebcam(seq, this.selectedVideoDeviceId || undefined);
      if (this.disposed || seq !== this.startSeq) return;
      webcamReady = true;

      this.webcamStatus = `${this.videoEl.videoWidth || 1280}x${this.videoEl.videoHeight || 720}`;
      await this.tracking.init((pct, msg) => {
        if (this.disposed || seq !== this.startSeq) return;
        this.bootProgress = pct;
        this.bootMessage = msg;
        this.emitSnapshot();
      });
      if (this.disposed || seq !== this.startSeq) return;

      this.holisticInfo = `${this.tracking.mode.toUpperCase()} (${this.tracking.delegate})`;
      this.armorRig.helmetOpenTarget = 1;
      this.bootProgress = 100;
      this.bootMessage = 'Systèmes tactiques prêts. Arrimage mécatronique Mark 42...';
      this.emitSnapshot();

      setTimeout(() => {
        if (this.disposed || seq !== this.startSeq) return;
        this.bootState = 'ready';
        this.systemState = 'OPÉRATIONNEL — SCAN 360° & VERROUILLAGE';
        this.addLog('J.A.R.V.I.S. en ligne. Casque ouvert autour du visage ([H] pour sceller).');
        this.triggerSuitUp();
        this.emitSnapshot();
      }, 320);

      this.lastFrameTime = performance.now();
      this._scheduleNextFrame();
    } catch (err) {
      if (this.disposed || seq !== this.startSeq) return;
      this._stopWebcamStream();
      const error = err as Error;
      this.webcamStatus = webcamReady ? 'PAUSE' : 'ERREUR';
      this.systemState = webcamReady ? 'DÉFAUT PIPELINE TRACKING' : 'DÉFAUT CAPTEUR OPTIQUE';
      this.bootState = 'error';
      this.bootProgress = 100;
      this.bootTitle = webcamReady ? 'PIPELINE MEDIAPIPE INDISPONIBLE' : 'CAPTEUR WEBCAM INDISPONIBLE';
      this.bootMessage = webcamReady
        ? `Le suivi corporel n’a pas pu démarrer (${error.message || 'erreur WASM/GPU'}). Réessayez ou passez en Démo 3D.`
        : this._formatWebcamError(error);
      await this._refreshVideoDevices();
      if (!this.disposed && seq === this.startSeq) {
        this.emitSnapshot();
      }
    }
  }

  startDemoMode(): void {
    this.startSeq++;
    this._stopLoop();
    this._stopWebcamStream();

    this.isDemoMode = true;
    this.demoYawTarget = 0;
    this.tracking.demoYaw = 0;
    this.isDraggingYaw = false;
    this.tracking.enableDemoMode();
    this.calibration.resetCalibration();
    this.armorRig.helmetOpenTarget = 0;

    this.webcamStatus = 'SIMULATION 3D';
    this.holisticInfo = 'DEMO MK-85 (SIM-3D)';
    this.bootState = 'ready';
    this.bootProgress = 100;
    this.systemState = 'SIMULATION TACTIQUE 3D ACTIVE';
    this.addLog('Mode Démo 3D activé (sans webcam physique).');
    this.triggerSuitUp();
    this.emitSnapshot();

    this.lastFrameTime = performance.now();
    this._scheduleNextFrame();
  }

  private async _refreshVideoDevices(): Promise<VideoDeviceOption[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return this.videoDevices;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label.trim() || `Caméra ${idx + 1}`,
        }));
      this.videoDevices = cams;
      return cams;
    } catch {
      return this.videoDevices;
    }
  }

  private async _acquireStreamWithFallbacks(preferredDeviceId?: string): Promise<MediaStream> {
    const candidates: MediaStreamConstraints[] = [];

    if (preferredDeviceId) {
      candidates.push({
        audio: false,
        video: {
          deviceId: { exact: preferredDeviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
      candidates.push({
        audio: false,
        video: { deviceId: { exact: preferredDeviceId } },
      });
    }

    // Contraintes souples sans min-FPS bloquant ni facingMode strict
    candidates.push({
      audio: false,
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });
    candidates.push({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    candidates.push({ audio: false, video: true });

    let lastErr: unknown = null;
    for (let i = 0; i < candidates.length; i++) {
      try {
        return await navigator.mediaDevices.getUserMedia(candidates[i]);
      } catch (err) {
        lastErr = err;
        const name = (err as Error)?.name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
          throw err;
        }
        if (name === 'NotReadableError' || name === 'AbortError') {
          await new Promise((r) => setTimeout(r, 180));
        }
      }
    }

    // Dernier recours : tester chaque caméra physique détectée (évite une caméra virtuelle bloquée en #0)
    const cams = await this._refreshVideoDevices();
    for (const cam of cams) {
      if (!cam.deviceId || cam.deviceId === preferredDeviceId) continue;
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: cam.deviceId } },
        });
      } catch (err) {
        lastErr = err;
        const name = (err as Error)?.name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw err;
        }
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error('Impossible d’ouvrir le flux vidéo.');
  }

  private async _startWebcam(seq: number, preferredDeviceId?: string): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('WebRTC getUserMedia non supporté par ce navigateur (HTTPS ou localhost requis).');
    }

    const hadActiveStream = Boolean(this.stream);
    this._stopWebcamStream();
    if (hadActiveStream) {
      // Laisse le pilote matériel libérer la webcam avant réouverture
      await new Promise((r) => setTimeout(r, 120));
    }
    if (this.disposed || seq !== this.startSeq) return;

    const stream = await this._acquireStreamWithFallbacks(preferredDeviceId);
    if (this.disposed || seq !== this.startSeq) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const settings = videoTrack.getSettings?.();
      if (settings?.deviceId) {
        this.selectedVideoDeviceId = settings.deviceId;
      }
      videoTrack.onended = () => {
        if (this.disposed || seq !== this.startSeq || this.isDemoMode) return;
        this.addLog('Flux webcam interrompu par le système.');
        this.webcamStatus = 'COUPÉE';
        this.bootState = 'error';
        this.bootTitle = 'CAMÉRA DÉCONNECTÉE';
        this.bootMessage = 'Le signal vidéo a été interrompu. Vérifiez votre webcam puis cliquez sur Réactiver.';
        this.emitSnapshot();
      };
    }

    this.stream = stream;
    this.videoEl.muted = true;
    this.videoEl.playsInline = true;
    this.videoEl.setAttribute('playsinline', 'true');
    this.videoEl.srcObject = stream;

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.videoEl.removeEventListener('loadedmetadata', checkReady);
        this.videoEl.removeEventListener('loadeddata', checkReady);
        resolve();
      };
      const checkReady = () => {
        if (this.videoEl.readyState >= 1 && this.videoEl.videoWidth > 0) done();
      };
      const timer = window.setTimeout(done, 3500);
      this.videoEl.addEventListener('loadedmetadata', checkReady);
      this.videoEl.addEventListener('loadeddata', checkReady);
      checkReady();
    });

    if (this.disposed || seq !== this.startSeq) return;

    try {
      await this.videoEl.play();
    } catch (playErr) {
      const errName = (playErr as Error)?.name;
      if (errName !== 'AbortError') {
        throw playErr;
      }
    }

    await this._refreshVideoDevices();
  }

  private _stopWebcamStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      this.stream = null;
    }
    this.videoEl.pause();
    this.videoEl.srcObject = null;
  }

  private _formatWebcamError(err: Error): string {
    const inIframe = typeof window !== 'undefined' && window.self !== window.top;
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'SecurityError') {
      return inIframe
        ? 'Accès caméra bloqué dans l’aperçu. Autorisez la caméra dans la barre d’adresse (icône cadenas/caméra) ou ouvrez l’app dans un nouvel onglet.'
        : 'Permission webcam refusée. Autorisez la caméra dans votre navigateur puis cliquez sur Réactiver la webcam.';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'Aucune caméra détectée sur ce poste. Branchez une webcam ou lancez le mode Démo 3D.';
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return 'La webcam est occupée ou verrouillée par une autre application (ou une caméra virtuelle). Fermez-la ou sélectionnez une autre caméra ci-dessous.';
    }
    if (err.name === 'OverconstrainedError') {
      return 'Résolution non supportée par ce capteur. Sélectionnez une autre caméra ou cliquez sur Réactiver la webcam.';
    }
    return err.message || 'Erreur lors de l’initialisation optique AR.';
  }

  triggerSuitUp(): void {
    this.suitProgress = 0.0;
    this.suitAnimating = true;
    this.pendingSuitUpTelemetry += 1;
    this.audio.playSuitUp();
    this.addLog('Séquence mécatronique Mark 42 : arrimage modulaire pièce par pièce.');
    this.emitSnapshot();
  }

  toggleHelmet(forceState: boolean | null = null): void {
    const next = forceState !== null ? (forceState ? 1 : 0) : this.armorRig.helmetOpenTarget > 0.5 ? 0 : 1;
    this.armorRig.helmetOpenTarget = next;
    this.audio.playHelmetServo(next === 1);
    this.addLog(next === 1 ? 'Plaque faciale rétractée.' : 'Casque Mark 85 scellé.');
    this.emitSnapshot();
  }

  toggleMechaInspect(forceState: boolean | null = null): void {
    const next = forceState !== null ? (forceState ? 1 : 0) : this.armorRig.mechaInspectTarget > 0.5 ? 0 : 1;
    this.armorRig.mechaInspectTarget = next;
    this.audio.playHelmetServo(next === 1);
    this.addLog(next === 1 ? 'Inspection mécatronique : capots ouverts.' : 'Capots d’avant-bras verrouillés.');
    this.emitSnapshot();
  }

  fireRepulsor(side: 'left' | 'right' = 'right'): void {
    this.vfx.triggerBlast(side);
    this.audio.playRepulsorBlast();
    this.pendingShotsTelemetry += 1;
    this.arcEnergy = Math.max(12, this.arcEnergy - 4.5);
    this.addLog(`Tir répulseur [${side === 'left' ? 'GAUCHE' : 'DROIT'}] déclenché.`);
    this.emitSnapshot();
  }

  toggleDebug(): void {
    const active = this.debugSkeleton.toggle();
    this.addLog(active ? 'Squelette MediaPipe affiché.' : 'Squelette MediaPipe masqué.');
    this.emitSnapshot();
  }

  toggleStealthMode(forceState: boolean | null = null): void {
    const nextStealth = forceState !== null ? forceState : !this.isStealth;
    this.selectPreset(nextStealth ? 'MK85_STEALTH_OPS' : this.lastCombatPresetId);
  }

  resetCalibration(): void {
    this.calibration.resetCalibration();
    this.calibrationSavedOnLock = false;
    this.backScanSavedOnLock = false;
    this.addLog('Scan corporel 360° (avant puis arrière) réinitialisé...');
    this.emitSnapshot();
  }

  adjustFitScale(delta: number): void {
    const next = Math.min(1.35, Math.max(0.8, Math.round((this.fitScale + delta) * 20) / 20));
    if (Math.abs(next - this.fitScale) < 1e-4) return;
    this.fitScale = next;
    this.addLog(`Enveloppe armure ajustée à ${Math.round(this.fitScale * 100)}%.`);
    void this.backend.saveCalibration({ fitScale: this.fitScale });
    this.emitSnapshot();
  }

  toggleAudio(): void {
    const on = this.audio.toggleMute();
    if (on) this.audio.unlock();
    this.addLog(on ? 'Audio SFX activé.' : 'Audio SFX coupé.');
    this.emitSnapshot();
  }

  toggleVoiceControl(): void {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      this.addLog('Reconnaissance vocale non supportée sur ce navigateur.');
      this.emitSnapshot();
      return;
    }

    if (this.voiceEnabled && this.recognition) {
      this.voiceEnabled = false;
      this.recognition.stop();
      this.addLog('Commandes vocales désactivées.');
      this.emitSnapshot();
      return;
    }

    this.recognition = new SpeechRec();
    this.recognition.lang = 'fr-FR';
    this.recognition.continuous = true;
    this.recognition.interimResults = false;

    this.recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const text = last[0].transcript.toLowerCase().trim();
      this.addLog(`Voix détectée : "${text}"`);

      if (text.includes('ouvre') || text.includes('open')) this.toggleHelmet(true);
      else if (text.includes('ferme') || text.includes('close') || text.includes('seal')) this.toggleHelmet(false);
      else if (text.includes('mécanique') || text.includes('inspection')) this.toggleMechaInspect();
      else if (text.includes('armure') || text.includes('suit') || text.includes('nanotech')) this.triggerSuitUp();
      else if (text.includes('tir') || text.includes('répulseur') || text.includes('repulsor') || text.includes('fire')) {
        this.fireRepulsor('right');
      } else if (text.includes('furtif') || text.includes('stealth')) this.toggleStealthMode(true);
      else if (text.includes('combat') || text.includes('normal')) this.toggleStealthMode(false);
      else this.emitSnapshot();
    };

    this.recognition.onerror = () => {
      this.voiceEnabled = false;
      this.emitSnapshot();
    };
    this.recognition.onend = () => {
      if (this.voiceEnabled && !this.disposed) {
        try {
          this.recognition?.start();
        } catch {
          this.voiceEnabled = false;
          this.emitSnapshot();
        }
      }
    };

    this.recognition.start();
    this.voiceEnabled = true;
    this.addLog('Écoute vocale active ("ouvre", "ferme", "armure", "tir", "furtif").');
    this.emitSnapshot();
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.audio.unlock();
    const key = e.key.toLowerCase();
    if (key === 's') this.triggerSuitUp();
    else if (key === 'h') this.toggleHelmet();
    else if (key === 'x') this.toggleMechaInspect();
    else if (key === 'r') this.fireRepulsor('right');
    else if (key === 'd') this.toggleDebug();
    else if (key === 'm') this.toggleStealthMode();
    else if (key === 'v') this.toggleVoiceControl();
    else if (key === 'c') this.resetCalibration();
    else if (key === '1') this.selectPreset('MK85_ENDGAME');
    else if (key === '2') this.selectPreset('MK42_PRODIGAL_SON');
    else if (key === '3') this.selectPreset('MK85_STEALTH_OPS');
    else if (key === '4') this.selectPreset('MK85_BATTLE_DAMAGED');
    else if (key === '[' || key === '-') this.adjustFitScale(-0.05);
    else if (key === ']' || key === '+' || key === '=') this.adjustFitScale(0.05);
  }

  private _evaluateGestures(dt: number, nowMs: number): void {
    for (const side of ['left', 'right'] as const) {
      const open = this.armorRig.palmOpen[side];
      if (open && !this.prevPalmOpen[side]) {
        this.audio.playRepulsorCharge();
        this.addLog(`Répulseur ${side === 'left' ? 'gauche' : 'droit'} armé.`);
        this.emitSnapshot();
      }
      if (open) {
        this.palmChargeTimer[side] += dt;
        if (this.palmChargeTimer[side] > 0.72 && nowMs - this.lastGestureActionMs > 1200) {
          this.fireRepulsor(side);
          this.palmChargeTimer[side] = -0.8;
          this.lastGestureActionMs = nowMs;
        }
      } else {
        this.palmChargeTimer[side] = 0;
      }
      this.prevPalmOpen[side] = open;
    }

    if (!this.isDemoMode && this.calibration.hasPose && nowMs - this.lastGestureActionMs > 2200) {
      const pts = this.calibration.poseBank.points;
      const shoulderW = Math.max(pts[11].distanceTo(pts[12]), 0.2);
      const earR = pts[8];
      const wristR = pts[16];
      if ((this.calibration.poseBank.visibility[16] ?? 0) > 0.65 && wristR.distanceTo(earR) < shoulderW * 0.34) {
        this.toggleHelmet();
        this.lastGestureActionMs = nowMs;
      }
    }
  }

  private _scheduleNextFrame(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this._afterDraw(() => this._tick(performance.now()));
    } else {
      this.isTimeoutFrame = false;
      this.frameId = requestAnimationFrame((t) => this._tick(t));
    }
  }

  private _afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          this.isTimeoutFrame = true;
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.isTimeoutFrame = true;
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.isTimeoutFrame = true;
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.isTimeoutFrame = true;
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private _stopLoop(): void {
    if (this.frameId) {
      if (this.isTimeoutFrame) clearTimeout(this.frameId);
      else cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  }

  private _tick(nowMs: number): void {
    if (this.disposed) return;

    const dt = Math.min(Math.max((nowMs - this.lastFrameTime) / 1000, 0.001), 0.05);
    this.lastFrameTime = nowMs;
    const timeSec = nowMs * 0.001;
    if (dt > 0) this.fpsSmooth = THREE.MathUtils.lerp(this.fpsSmooth, 1 / dt, 0.1);

    const videoW = this.isDemoMode ? 1280 : this.videoEl.videoWidth || 1280;
    const videoH = this.isDemoMode ? 720 : this.videoEl.videoHeight || 720;
    const canvasW = this.webglCanvas.clientWidth || window.innerWidth;
    const canvasH = this.webglCanvas.clientHeight || window.innerHeight;

    if (this.isDemoMode) {
      this.tracking.demoYaw = THREE.MathUtils.damp(this.tracking.demoYaw, this.demoYawTarget, 9.0, dt);
    }

    const trackRes = this.tracking.processFrame(this.isDemoMode ? null : this.videoEl, timeSec);

    this.calibration.update(
      trackRes,
      videoW,
      videoH,
      canvasW,
      canvasH,
      timeSec,
      this.tracking.maskBuffer,
      this.tracking.maskWidth,
      this.tracking.maskHeight
    );

    if (!this.isDemoMode && this.calibration.calibrated && !this.calibrationSavedOnLock) {
      this.calibrationSavedOnLock = true;
      void this.backend.saveCalibration({
        metricShoulderWidth: Number(this.calibration.metricShoulderWidth.toFixed(3)),
        torsoAspectRatio: Number(this.calibration.torsoAspectRatio.toFixed(3)),
        waistWidthFactor: Number(this.calibration.waistWidthFactor.toFixed(3)),
        armGirthFactor: Number(this.calibration.armGirthFactor.toFixed(3)),
        frontScanned: this.calibration.frontScanned,
        backScanned: this.calibration.backScanned,
      });
    }
    if (!this.isDemoMode && this.calibration.backScanned && !this.backScanSavedOnLock) {
      this.backScanSavedOnLock = true;
      this.addLog('Scan dorsal 360° verrouillé sur la carapace arrière.');
      void this.backend.saveCalibration({
        backScanned: true,
        frontScanned: this.calibration.frontScanned,
      });
    }

    this.armorRig.update(this.calibration, dt, this.fitScale, timeSec, this.suitProgress);
    this._evaluateGestures(dt, nowMs);

    if (this.suitAnimating) {
      this.suitProgress = Math.min(1.0, this.suitProgress + dt * 0.24);
      if (this.suitProgress >= 1.0) this.suitAnimating = false;
    }
    this.stealthMix = THREE.MathUtils.damp(this.stealthMix, this.isStealth ? 1.0 : 0.0, 6.0, dt);
    this.arcEnergy = Math.min(100, this.arcEnergy + dt * 2.2);

    const activePreset = this.presets.find((p) => p.id === this.selectedPresetId) ?? this.presets[0];
    const u = this.materials.sharedUniforms;
    u.uSuitProgress.value = this.suitProgress;
    u.uTime.value = timeSec;
    u.uStealthMix.value = this.stealthMix;
    if (!this.isStealth && activePreset) {
      u.uNanoColor.value.set(activePreset.emissiveHex);
      this.materials.emissiveCyan.emissive.set(activePreset.emissiveHex);
    } else if (this.isStealth) {
      u.uNanoColor.value.setHex(0x2cf59c);
      this.materials.emissiveCyan.emissive.setHex(0x1ee88c);
    }

    this.envLighting.update(
      this.videoEl,
      this.armorRig.arcWorldPos,
      this.calibration.isMirrored,
      nowMs,
      this.isDemoMode
    );
    const scanActive = !this.isDemoMode && !this.calibration.calibrated;
    this.vfx.updateSegmentationMask(this.tracking, this.calibration.isMirrored);
    this.vfx.update(dt, timeSec, this.armorRig, this.suitProgress, this.isStealth, scanActive);

    this.debugSkeleton.draw(trackRes, this.calibration, videoW, videoH);

    if (this.postProcess) {
      this.postProcess.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    this.telemetrySyncTimer += dt;
    if (this.telemetrySyncTimer > 12.0 || this.pendingShotsTelemetry > 0 || this.pendingSuitUpTelemetry > 0) {
      if (this.telemetrySyncTimer > 6.0) {
        this.telemetrySyncTimer = 0;
        const suitDelta = this.pendingSuitUpTelemetry;
        const shotDelta = this.pendingShotsTelemetry;
        this.pendingSuitUpTelemetry = 0;
        this.pendingShotsTelemetry = 0;
        void this.backend
          .sendTelemetry({
            mode: this.isDemoMode ? 'DEMO_3D' : this.tracking.mode.toUpperCase(),
            fps: this.fpsSmooth,
            syncPercent: this.calibration.syncPercent,
            arcEnergy: this.arcEnergy,
            suitUpCountDelta: suitDelta,
            repulsorShotsDelta: shotDelta,
          })
          .then((summary) => {
            if (!this.disposed && summary) this.telemetrySummary = summary;
          });
      }
    }

    this.hudTimer += dt;
    if (this.hudTimer > 0.066) {
      this.hudTimer = 0;
      this.emitSnapshot();
    }

    this._scheduleNextFrame();
  }

  dispose(): void {
    this.disposed = true;
    this.startSeq++;
    this._stopLoop();
    window.removeEventListener('resize', this._onResizeBound);
    window.removeEventListener('keydown', this._onKeyDownBound);
    window.removeEventListener('pointerdown', this._onPointerDownBound);
    window.removeEventListener('pointermove', this._onPointerMoveBound);
    window.removeEventListener('pointerup', this._onPointerUpBound);
    window.removeEventListener('pointercancel', this._onPointerUpBound);
    this.webglCanvas.removeEventListener('webglcontextlost', this._onContextLostBound);
    this.webglCanvas.removeEventListener('webglcontextrestored', this._onContextRestoredBound);

    if (this.recognition) {
      this.voiceEnabled = false;
      this.recognition.stop();
      this.recognition = null;
    }
    this._stopWebcamStream();
    delete (window as unknown as JarvisWindowBridge).JARVIS_AR;
    this.tracking.dispose();
    this.socketManager.dispose();
    this.armorRig.dispose();
    this.materials.dispose();
    this.vfx.dispose();
    this.envLighting.dispose();
    this.postProcess?.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    document.body.classList.remove('stealth-theme');
  }
}
