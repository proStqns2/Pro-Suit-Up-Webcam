import * as THREE from 'three';
import { CalibrationEngine } from './core/CalibrationEngine';
import { TrackingEngine } from './vision/TrackingEngine';
import { DebugSkeleton } from './vision/DebugSkeleton';
import { createMark85Materials, type Mark85MaterialLibrary } from './graphics/Mark85Materials';
import { Mark85ArmorRig } from './graphics/Mark85ArmorRig';
import { NanotechVFX } from './graphics/NanotechVFX';
import { EnvLighting } from './graphics/EnvLighting';
import { AudioSynth } from './audio/AudioSynth';

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
  luma: number;
  helmetOpen: boolean;
  repL: number;
  repR: number;
  isStealth: boolean;
  debugEnabled: boolean;
  voiceEnabled: boolean;
  audioEnabled: boolean;
  isDemoMode: boolean;
  logs: string[];
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

  private calibration: CalibrationEngine;
  private tracking: TrackingEngine;
  private debugSkeleton: DebugSkeleton;
  private materials: Mark85MaterialLibrary;
  private armorRig: Mark85ArmorRig;
  private vfx: NanotechVFX;
  private envLighting: EnvLighting;
  private audio: AudioSynth;

  private stream: MediaStream | null = null;
  private recognition: SpeechRecognitionLike | null = null;

  private suitProgress = 0.0;
  private suitAnimating = false;
  private isStealth = false;
  private stealthMix = 0.0;
  private arcEnergy = 100.0;
  private voiceEnabled = false;
  private isDemoMode = false;

  private bootState: 'loading' | 'ready' | 'error' = 'loading';
  private bootProgress = 5;
  private bootTitle = 'STARK INDUSTRIES — MK-85';
  private bootMessage = 'Activation des capteurs optiques et shaders Nanotech...';
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
  private readonly _onPointerDownBound: () => void;
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

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / Math.max(window.innerHeight, 1), 0.05, 30);
    this.camera.position.set(0, 0, 0);

    this.calibration = new CalibrationEngine(this.camera);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.materials = createMark85Materials(maxAniso);
    this.armorRig = new Mark85ArmorRig(this.materials);
    this.scene.add(this.armorRig.root);

    this.vfx = new NanotechVFX(this.scene);
    this.envLighting = new EnvLighting(this.renderer, this.scene);
    this.audio = new AudioSynth();
    this.tracking = new TrackingEngine();
    this.debugSkeleton = new DebugSkeleton(this.debugCanvas);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this._onResizeBound = () => this._onResize();
    this._onKeyDownBound = (e: KeyboardEvent) => this._handleKeyDown(e);
    this._onPointerDownBound = () => {
      this.audio.unlock();
      window.removeEventListener('pointerdown', this._onPointerDownBound);
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
    this.webglCanvas.addEventListener('webglcontextlost', this._onContextLostBound);
    this.webglCanvas.addEventListener('webglcontextrestored', this._onContextRestoredBound);
  }

  private _onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
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
      luma: this.envLighting.lumaSummary,
      helmetOpen: this.armorRig.helmetOpenTarget > 0.5,
      repL: this.armorRig.repulsorCharge.left,
      repR: this.armorRig.repulsorCharge.right,
      isStealth: this.isStealth,
      debugEnabled: this.debugSkeleton.enabled,
      voiceEnabled: this.voiceEnabled,
      audioEnabled: this.audio.enabled,
      isDemoMode: this.isDemoMode,
      logs: this.logs,
    });
  }

  async start(): Promise<void> {
    this._stopLoop();
    this.isDemoMode = false;
    this.bootState = 'loading';
    this.bootTitle = 'STARK INDUSTRIES — MK-85';
    this.bootProgress = 10;
    this.bootMessage = 'Demande d’accès au flux webcam HD...';
    this.emitSnapshot();

    try {
      await this._startWebcam();
      if (this.disposed) return;

      this.webcamStatus = `${this.videoEl.videoWidth}x${this.videoEl.videoHeight}`;
      await this.tracking.init((pct, msg) => {
        if (this.disposed) return;
        this.bootProgress = pct;
        this.bootMessage = msg;
        this.emitSnapshot();
      });
      if (this.disposed) return;

      this.holisticInfo = `${this.tracking.mode.toUpperCase()} (${this.tracking.delegate})`;
      this.bootProgress = 100;
      this.bootMessage = 'Systèmes tactiques prêts. Déploiement Nanotech...';
      this.emitSnapshot();

      setTimeout(() => {
        if (this.disposed) return;
        this.bootState = 'ready';
        this.systemState = 'OPÉRATIONNEL — VERROUILLAGE BIOMÉTRIQUE';
        this.addLog('J.A.R.V.I.S. en ligne. Calibrage automatique activé.');
        this.triggerSuitUp();
        this.emitSnapshot();
      }, 360);

      this.lastFrameTime = performance.now();
      this._scheduleNextFrame();
    } catch (err) {
      if (this.disposed) return;
      const error = err as Error;
      this.webcamStatus = 'ERREUR';
      this.systemState = 'DÉFAUT CAPTEUR OPTIQUE';
      this.bootState = 'error';
      this.bootProgress = 100;
      this.bootTitle = 'CAPTEUR WEBCAM INDISPONIBLE';
      this.bootMessage = this._formatWebcamError(error);
      this.emitSnapshot();
    }
  }

  startDemoMode(): void {
    this._stopLoop();
    this._stopWebcamStream();

    this.isDemoMode = true;
    this.tracking.enableDemoMode();
    this.calibration.resetCalibration();

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

  private async _startWebcam(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('WebRTC getUserMedia non supporté par ce navigateur (HTTPS ou localhost requis).');
    }
    this._stopWebcamStream();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60, min: 24 },
      },
    });
    this.stream = stream;
    this.videoEl.srcObject = stream;
    await new Promise<void>((resolve) => {
      if (this.videoEl.readyState >= 1) resolve();
      else this.videoEl.onloadedmetadata = () => resolve();
    });
    await this.videoEl.play();
  }

  private _stopWebcamStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.videoEl.srcObject = null;
  }

  private _formatWebcamError(err: Error): string {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'Permission webcam refusée. Autorisez l’accès caméra ou lancez la simulation 3D sans webcam.';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'Aucune caméra détectée sur ce poste. Vous pouvez explorer l’armure en mode Démo 3D.';
    }
    if (err.name === 'NotReadableError') {
      return 'La webcam est déjà utilisée par une autre application.';
    }
    return err.message || 'Erreur lors de l’initialisation optique AR.';
  }

  triggerSuitUp(): void {
    this.suitProgress = 0.0;
    this.suitAnimating = true;
    this.audio.playSuitUp();
    this.addLog('Séquence Nanotech Suit-Up lancée depuis le réacteur ARC.');
    this.emitSnapshot();
  }

  toggleHelmet(forceState: boolean | null = null): void {
    const next = forceState !== null ? (forceState ? 1 : 0) : this.armorRig.helmetOpenTarget > 0.5 ? 0 : 1;
    this.armorRig.helmetOpenTarget = next;
    this.audio.playHelmetServo(next === 1);
    this.addLog(next === 1 ? 'Plaque faciale rétractée.' : 'Casque Mark 85 scellé.');
    this.emitSnapshot();
  }

  fireRepulsor(side: 'left' | 'right' = 'right'): void {
    this.vfx.triggerBlast(side);
    this.audio.playRepulsorBlast();
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
    this.isStealth = forceState !== null ? forceState : !this.isStealth;
    document.body.classList.toggle('stealth-theme', this.isStealth);
    this.addLog(this.isStealth ? 'Revêtement Furtif activé.' : 'Armure Mark 85 mode Combat.');
    this.emitSnapshot();
  }

  resetCalibration(): void {
    this.calibration.resetCalibration();
    this.addLog('Recalibrage morphologique lancé...');
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
    else if (key === 'r') this.fireRepulsor('right');
    else if (key === 'd') this.toggleDebug();
    else if (key === 'm') this.toggleStealthMode();
    else if (key === 'v') this.toggleVoiceControl();
    else if (key === 'c') this.resetCalibration();
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

    const trackRes = this.tracking.processFrame(this.isDemoMode ? null : this.videoEl, timeSec);

    this.calibration.update(trackRes, videoW, videoH, canvasW, canvasH, timeSec);
    this.armorRig.update(this.calibration, dt);
    this._evaluateGestures(dt, nowMs);

    if (this.suitAnimating) {
      this.suitProgress = Math.min(1.0, this.suitProgress + dt * 0.62);
      if (this.suitProgress >= 1.0) this.suitAnimating = false;
    }
    this.stealthMix = THREE.MathUtils.damp(this.stealthMix, this.isStealth ? 1.0 : 0.0, 6.0, dt);
    this.arcEnergy = Math.min(100, this.arcEnergy + dt * 2.2);

    const u = this.materials.sharedUniforms;
    u.uSuitProgress.value = this.suitProgress;
    u.uTime.value = timeSec;
    u.uStealthMix.value = this.stealthMix;
    u.uNanoColor.value.setHex(this.isStealth ? 0x2cf59c : 0x38f2ff);
    this.materials.emissiveCyan.emissive.setHex(this.isStealth ? 0x1ee88c : 0x28e4ff);

    this.envLighting.update(
      this.videoEl,
      this.armorRig.arcWorldPos,
      this.calibration.isMirrored,
      nowMs,
      this.isDemoMode
    );
    this.vfx.updateSegmentationMask(this.tracking, this.calibration.isMirrored);
    this.vfx.update(dt, timeSec, this.armorRig, this.suitProgress, this.isStealth);

    this.debugSkeleton.draw(trackRes, this.calibration, videoW, videoH);

    this.renderer.render(this.scene, this.camera);

    this.hudTimer += dt;
    if (this.hudTimer > 0.066) {
      this.hudTimer = 0;
      this.emitSnapshot();
    }

    this._scheduleNextFrame();
  }

  dispose(): void {
    this.disposed = true;
    this._stopLoop();
    window.removeEventListener('resize', this._onResizeBound);
    window.removeEventListener('keydown', this._onKeyDownBound);
    window.removeEventListener('pointerdown', this._onPointerDownBound);
    this.webglCanvas.removeEventListener('webglcontextlost', this._onContextLostBound);
    this.webglCanvas.removeEventListener('webglcontextrestored', this._onContextRestoredBound);

    if (this.recognition) {
      this.voiceEnabled = false;
      this.recognition.stop();
      this.recognition = null;
    }
    this._stopWebcamStream();
    this.tracking.dispose();
    this.armorRig.dispose();
    this.materials.dispose();
    this.vfx.dispose();
    this.envLighting.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    document.body.classList.remove('stealth-theme');
  }
}
