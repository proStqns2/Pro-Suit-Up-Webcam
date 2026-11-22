import {
  FilesetResolver,
  HolisticLandmarker,
  PoseLandmarker,
  HandLandmarker,
  FaceLandmarker,
  type Landmark,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import type { TrackingFrameResult } from '../core/CalibrationEngine';

const LOCAL_WASM_URL = '/mediapipe-wasm';
const CDN_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const HOLISTIC_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task';

const TFLITE_BENIGN_STDERR_RE =
  /^(?:INFO:\s*(?:Created TensorFlow Lite|Initialized TensorFlow Lite)|WARNING:\s*All log messages before absl::InitializeLog\(\))/;

let tfliteLogFilterInstalled = false;

function installTfliteStderrFilter(): void {
  if (tfliteLogFilterInstalled || typeof console === 'undefined') return;
  tfliteLogFilterInstalled = true;
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && TFLITE_BENIGN_STDERR_RE.test(args[0].trimStart())) {
      console.debug(...args);
      return;
    }
    origError(...args);
  };
}

export class TrackingEngine {
  public mode: 'none' | 'holistic' | 'modular' | 'demo' = 'none';
  public delegate = 'GPU';

  private holistic: HolisticLandmarker | null = null;
  private poseFallback: PoseLandmarker | null = null;
  private handFallback: HandLandmarker | null = null;
  private faceFallback: FaceLandmarker | null = null;

  private lastVideoTime = -1;
  private lastTimestampMs = 0;
  private _maskFrameCounter = 0;

  public maskWidth = 0;
  public maskHeight = 0;
  public maskBuffer: Uint8Array | null = null;
  public maskUpdated = false;

  public readonly latestResult: TrackingFrameResult = {
    poseLandmarks: null,
    poseWorldLandmarks: null,
    faceLandmarks: null,
    faceBlendshapes: null,
    leftHandLandmarks: null,
    leftHandWorldLandmarks: null,
    rightHandLandmarks: null,
    rightHandWorldLandmarks: null,
  };

  // Pre-allocated demo landmarks to avoid per-frame allocations in Demo 3D mode
  private demoPoseNorm: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.98 }));
  private demoPoseWorld: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.98 }));
  private demoLeftHand: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  private demoRightHand: NormalizedLandmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  private demoFace: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.25, z: 0, visibility: 1 }));

  async init(onProgress?: (pct: number, msg: string) => void): Promise<void> {
    installTfliteStderrFilter();
    onProgress?.(25, 'Chargement du runtime WebAssembly MediaPipe...');
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(LOCAL_WASM_URL);
    } catch {
      vision = await FilesetResolver.forVisionTasks(CDN_WASM_URL);
    }

    onProgress?.(50, 'Initialisation MediaPipe HolisticLandmarker (GPU)...');
    try {
      this.holistic = await this._createHolistic(vision, 'GPU');
      this.mode = 'holistic';
      this.delegate = 'GPU';
      return;
    } catch (errGpu) {
      console.warn('Holistic GPU delegate fallback -> CPU:', errGpu);
      try {
        onProgress?.(60, 'Fallback HolisticLandmarker vers CPU...');
        this.holistic = await this._createHolistic(vision, 'CPU');
        this.mode = 'holistic';
        this.delegate = 'CPU';
        return;
      } catch (errCpu) {
        console.warn('HolisticLandmarker indisponible, activation pipeline modulaire:', errCpu);
      }
    }

    onProgress?.(70, 'Chargement fallback Pose + Hands + FaceLandmarker...');
    const [pose, hand, face] = await Promise.all([
      PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        outputSegmentationMasks: true,
      }),
      HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      }),
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      }),
    ]);

    this.poseFallback = pose;
    this.handFallback = hand;
    this.faceFallback = face;
    this.mode = 'modular';
    this.delegate = 'GPU-MOD';
  }

  private async _createHolistic(
    vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    delegate: 'GPU' | 'CPU'
  ): Promise<HolisticLandmarker> {
    return HolisticLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: HOLISTIC_MODEL_URL,
        delegate,
      },
      runningMode: 'VIDEO',
      minFaceDetectionConfidence: 0.45,
      minFacePresenceConfidence: 0.45,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minHandLandmarksConfidence: 0.45,
      outputFaceBlendshapes: true,
      outputPoseSegmentationMasks: true,
    });
  }

  enableDemoMode(): void {
    this.mode = 'demo';
    this.delegate = 'SIM-3D';
  }

  processFrame(videoEl: HTMLVideoElement | null, timeSec = 0): TrackingFrameResult {
    if (this.mode === 'demo') {
      return this._generateDemoFrame(timeSec);
    }

    if (!videoEl || videoEl.readyState < 2) return this.latestResult;
    if (videoEl.currentTime === this.lastVideoTime) return this.latestResult;
    this.lastVideoTime = videoEl.currentTime;

    let ts = Math.round(performance.now());
    if (ts <= this.lastTimestampMs) ts = this.lastTimestampMs + 1;
    this.lastTimestampMs = ts;

    this.maskUpdated = false;
    const copyMaskThisFrame = (this._maskFrameCounter++ % 3) === 0;

    if (this.mode === 'holistic' && this.holistic) {
      this.holistic.detectForVideo(videoEl, ts, (res) => {
        this.latestResult.poseLandmarks = res.poseLandmarks?.[0] || null;
        this.latestResult.poseWorldLandmarks = res.poseWorldLandmarks?.[0] || null;
        this.latestResult.faceLandmarks = res.faceLandmarks?.[0] || null;
        this.latestResult.faceBlendshapes = res.faceBlendshapes?.[0]?.categories || null;
        this.latestResult.leftHandLandmarks = res.leftHandLandmarks?.[0] || null;
        this.latestResult.leftHandWorldLandmarks = res.leftHandWorldLandmarks?.[0] || null;
        this.latestResult.rightHandLandmarks = res.rightHandLandmarks?.[0] || null;
        this.latestResult.rightHandWorldLandmarks = res.rightHandWorldLandmarks?.[0] || null;

        if (copyMaskThisFrame) {
          const mask = res.poseSegmentationMasks?.[0];
          if (mask) this._copyMask(mask);
        }
      });
    } else if (this.mode === 'modular' && this.poseFallback && this.handFallback && this.faceFallback) {
      const pRes = this.poseFallback.detectForVideo(videoEl, ts);
      const hRes = this.handFallback.detectForVideo(videoEl, ts);
      const fRes = this.faceFallback.detectForVideo(videoEl, ts);

      this.latestResult.poseLandmarks = pRes.landmarks?.[0] || null;
      this.latestResult.poseWorldLandmarks = pRes.worldLandmarks?.[0] || null;
      this.latestResult.faceLandmarks = fRes.faceLandmarks?.[0] || null;
      this.latestResult.faceBlendshapes = fRes.faceBlendshapes?.[0]?.categories || null;

      let leftH: NormalizedLandmark[] | null = null;
      let leftHW: Landmark[] | null = null;
      let rightH: NormalizedLandmark[] | null = null;
      let rightHW: Landmark[] | null = null;
      if (hRes.landmarks && hRes.handednesses) {
        for (let i = 0; i < hRes.landmarks.length; i++) {
          const cat = hRes.handednesses[i]?.[0]?.categoryName;
          if (cat === 'Left') {
            leftH = hRes.landmarks[i];
            leftHW = hRes.worldLandmarks?.[i] || null;
          } else {
            rightH = hRes.landmarks[i];
            rightHW = hRes.worldLandmarks?.[i] || null;
          }
        }
      }
      this.latestResult.leftHandLandmarks = leftH;
      this.latestResult.leftHandWorldLandmarks = leftHW;
      this.latestResult.rightHandLandmarks = rightH;
      this.latestResult.rightHandWorldLandmarks = rightHW;

      if (copyMaskThisFrame) {
        const mask = pRes.segmentationMasks?.[0];
        if (mask) this._copyMask(mask);
      }
    }

    return this.latestResult;
  }

  public demoYaw = 0;

  private _generateDemoFrame(timeSec: number): TrackingFrameResult {
    const breathe = Math.sin(timeSec * 1.8) * 0.005;
    const sway = Math.sin(timeSec * 0.65) * 0.01;
    const headTurn = Math.sin(timeSec * 0.85) * 0.01;
    const rRaise = 0.5 + 0.5 * Math.sin(timeSec * 1.1);
    const yawCos = Math.cos(this.demoYaw);
    const yawSin = Math.sin(this.demoYaw);

    const setPose = (idx: number, nx: number, ny: number, nz: number, vis = 0.98) => {
      const dx = nx - 0.5;
      const rotX = dx * yawCos - nz * 0.32 * yawSin;
      const rotZ = dx * yawSin * 1.6 + nz * yawCos;

      this.demoPoseNorm[idx].x = 0.5 + rotX;
      this.demoPoseNorm[idx].y = ny;
      this.demoPoseNorm[idx].z = rotZ;
      this.demoPoseNorm[idx].visibility = vis;

      this.demoPoseWorld[idx].x = -rotX * 1.45;
      this.demoPoseWorld[idx].y = (ny - 0.5) * 1.45;
      this.demoPoseWorld[idx].z = rotZ * 0.55;
      this.demoPoseWorld[idx].visibility = vis;
    };

    // Head & Ears (y ~ 0.145)
    setPose(0, 0.5 + sway + headTurn * 0.5, 0.145 + breathe, -0.09);
    setPose(7, 0.535 + sway, 0.14 + breathe, -0.02);
    setPose(8, 0.465 + sway, 0.14 + breathe, -0.02);

    // Shoulders (heroic V-taper stance)
    setPose(11, 0.595 + sway, 0.255 + breathe, 0.0);
    setPose(12, 0.405 + sway, 0.255 + breathe, 0.0);

    // Left Arm
    setPose(13, 0.64 + sway, 0.39 + breathe, 0.02);
    setPose(15, 0.65 + sway, 0.515 + breathe, -0.05);
    setPose(17, 0.655 + sway, 0.55 + breathe, -0.07);
    setPose(19, 0.642 + sway, 0.55 + breathe, -0.08);

    // Right Arm (aiming repulsor dynamically)
    const rElbowX = 0.35 - sway * 0.3 - rRaise * 0.015;
    const rElbowY = 0.385 + breathe - rRaise * 0.04;
    const rWristX = 0.345 + sway + rRaise * 0.02;
    const rWristY = 0.48 + breathe - rRaise * 0.11;
    const rWristZ = -0.09 - rRaise * 0.16;
    setPose(14, rElbowX, rElbowY, 0.02);
    setPose(16, rWristX, rWristY, rWristZ);
    setPose(18, rWristX - 0.012, rWristY - 0.022, rWristZ - 0.02);
    setPose(20, rWristX + 0.012, rWristY - 0.022, rWristZ - 0.02);

    // Hips, Knees, Ankles & Armored Boots (full body cleanly visible in frame)
    setPose(23, 0.552 + sway * 0.5, 0.515, 0.02, 0.98);
    setPose(24, 0.448 + sway * 0.5, 0.515, 0.02, 0.98);
    setPose(25, 0.56 + sway * 0.3, 0.695, 0.02, 0.96);
    setPose(26, 0.44 + sway * 0.3, 0.695, 0.02, 0.96);
    setPose(27, 0.568, 0.865, 0.04, 0.94);
    setPose(28, 0.432, 0.865, 0.04, 0.94);
    setPose(31, 0.576, 0.905, -0.09, 0.92);
    setPose(32, 0.424, 0.905, -0.09, 0.92);

    // Face anchors [10 top, 152 chin, 234 leftCheek, 454 rightCheek, 1 noseTip, 168 bridge, 6]
    const cx = 0.5 + (sway + headTurn * 0.5) * yawCos;
    const cy = 0.145 + breathe;
    const setFace = (idx: number, x: number, y: number, z: number) => {
      this.demoFace[idx].x = x;
      this.demoFace[idx].y = y;
      this.demoFace[idx].z = z;
    };
    setFace(10, cx, cy - 0.06, -0.04);
    setFace(152, cx, cy + 0.06, -0.02);
    setFace(234, cx + 0.04 * yawCos, cy, 0.035 + 0.04 * yawSin);
    setFace(454, cx - 0.04 * yawCos, cy, 0.035 - 0.04 * yawSin);
    setFace(1, cx + headTurn * 0.3 - 0.045 * yawSin, cy + 0.006, -0.065 * yawCos);
    setFace(168, cx + headTurn * 0.2 - 0.035 * yawSin, cy - 0.015, -0.058 * yawCos);
    setFace(6, cx + headTurn * 0.2 - 0.04 * yawSin, cy - 0.008, -0.062 * yawCos);

    // Build realistic 21-point hands (with dynamic articulated finger curl cycle)
    const leftCurl = 0.22 + 0.62 * (0.5 + 0.5 * Math.sin(timeSec * 1.45));
    const rightOpen = rRaise > 0.52;
    const rightCurl = rightOpen ? 0.04 : 0.65 * (1 - rRaise * 1.4);

    this._populateDemoHand(
      this.demoLeftHand,
      0.5 + (0.15 + sway) * yawCos - (-0.05) * 0.32 * yawSin,
      0.515 + breathe,
      -0.05,
      1,
      false,
      leftCurl
    );
    this._populateDemoHand(
      this.demoRightHand,
      0.5 + (rWristX - 0.5) * yawCos - rWristZ * 0.32 * yawSin,
      rWristY,
      rWristZ,
      -1,
      rightOpen,
      Math.max(0, rightCurl)
    );

    this.latestResult.poseLandmarks = this.demoPoseNorm;
    this.latestResult.poseWorldLandmarks = this.demoPoseWorld;
    this.latestResult.faceLandmarks = this.demoFace;
    this.latestResult.leftHandLandmarks = this.demoLeftHand;
    this.latestResult.rightHandLandmarks = this.demoRightHand;
    this.latestResult.leftHandWorldLandmarks = null;
    this.latestResult.rightHandWorldLandmarks = null;
    this.latestResult.faceBlendshapes = null;
    return this.latestResult;
  }

  private _populateDemoHand(
    hand: NormalizedLandmark[],
    wx: number,
    wy: number,
    wz: number,
    sideSign: number,
    openPalm: boolean,
    curl = 0.25
  ): void {
    const spread = openPalm ? 1.05 : 0.68;
    const ext = 1.0 - curl * 0.62;
    const zCurl = curl * 0.036;
    const setH = (i: number, dx: number, dy: number, dz: number) => {
      hand[i].x = wx + dx * sideSign;
      hand[i].y = wy + dy;
      hand[i].z = wz + dz;
    };
    // Wrist
    setH(0, 0, 0, 0);
    // Thumb
    setH(1, -0.018, -0.015, -0.01);
    setH(2, -0.032, -0.032, -0.018);
    setH(3, -0.044 + curl * 0.012, -0.047 + curl * 0.006, -0.025 - zCurl * 0.35);
    setH(4, -0.054 + curl * 0.02, -0.058 + curl * 0.014, -0.030 - zCurl * 0.65);

    // 4 fingers (MCP -> PIP -> DIP -> TIP)
    const fingerOffsets = [-0.018, -0.005, 0.008, 0.021];
    for (let f = 0; f < 4; f++) {
      const baseIdx = 5 + f * 4;
      const fx = fingerOffsets[f] * spread;
      const lenScale = f === 1 ? 1.08 : f === 3 ? 0.82 : 0.96;
      setH(baseIdx, fx, -0.052, -0.005);
      setH(baseIdx + 1, fx * 1.15, -0.052 - 0.026 * lenScale * ext, -0.009 - zCurl * 0.45);
      setH(baseIdx + 2, fx * 1.24, -0.052 - 0.047 * lenScale * (ext * 0.92), -0.012 - zCurl * 0.95);
      setH(baseIdx + 3, fx * 1.28, -0.052 - 0.064 * lenScale * (ext * 0.82), -0.014 - zCurl * 1.25);
    }
  }

  private _copyMask(mpMask: { width: number; height: number; getAsFloat32Array: () => Float32Array }): void {
    const w = mpMask.width;
    const h = mpMask.height;
    const f32 = mpMask.getAsFloat32Array();
    if (!f32 || w <= 0 || h <= 0) return;

    if (!this.maskBuffer || this.maskWidth !== w || this.maskHeight !== h) {
      this.maskWidth = w;
      this.maskHeight = h;
      this.maskBuffer = new Uint8Array(w * h);
    }
    const len = w * h;
    for (let i = 0; i < len; i++) {
      this.maskBuffer[i] = Math.max(0, Math.min(255, (f32[i] * 255) | 0));
    }
    this.maskUpdated = true;
  }

  dispose(): void {
    this.holistic?.close();
    this.poseFallback?.close();
    this.handFallback?.close();
    this.faceFallback?.close();
  }
}
