import * as THREE from 'three';
import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { Face as KalidoFace, Pose as KalidoPose } from 'kalidokit';
import { LandmarkFilterBank, OneEuroFilter } from './OneEuroFilter';

export interface TrackingFrameResult {
  poseLandmarks: NormalizedLandmark[] | null;
  poseWorldLandmarks: Landmark[] | null;
  faceLandmarks: NormalizedLandmark[] | null;
  faceBlendshapes: unknown[] | null;
  leftHandLandmarks: NormalizedLandmark[] | null;
  leftHandWorldLandmarks: Landmark[] | null;
  rightHandLandmarks: NormalizedLandmark[] | null;
  rightHandWorldLandmarks: Landmark[] | null;
}

export class CalibrationEngine {
  private camera: THREE.PerspectiveCamera;
  public isMirrored = true;

  public readonly poseBank = new LandmarkFilterBank(33, 1.55, 0.11, 1.0);
  public readonly leftHandBank = new LandmarkFilterBank(21, 2.0, 0.16, 1.2);
  public readonly rightHandBank = new LandmarkFilterBank(21, 2.0, 0.16, 1.2);
  // [10 foreheadTop, 152 chin, 234 leftEarCheek, 454 rightEarCheek, 1 noseTip, 168 browBridge, 6 midNose]
  public readonly faceAnchorBank = new LandmarkFilterBank(7, 1.85, 0.12, 1.0);
  private readonly depthFilter = new OneEuroFilter(60, 1.05, 0.05, 1.0);
  private readonly torsoWidthRatioFilter = new OneEuroFilter(60, 0.7, 0.02, 1.0);

  public calibrated = false;
  public sampleCount = 0;
  public metricShoulderWidth = 0.40;
  public torsoAspectRatio = 1.38;
  public userDepth = 1.65;
  public calibratedHeadW = 0.165;
  public calibratedHeadH = 0.23;
  public silhouetteChestWidthFactor = 1.0;

  public hasPose = false;
  public hasLeftHand = false;
  public hasRightHand = false;
  public hasFace = false;
  public syncPercent = 0;

  // Angles biomécaniques Kalidokit lissés (torsion axiale bras/avant-bras + rotation tête)
  public readonly kinematics = {
    armTwistL: 0,
    armTwistR: 0,
    forearmTwistL: 0,
    forearmTwistR: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
  };
  private _kalidoTick = 0;

  private readonly _tmpA = new THREE.Vector3();
  private readonly _tmpB = new THREE.Vector3();
  private readonly _rawVec = new THREE.Vector3();
  private readonly _vShoulderMid = new THREE.Vector3();
  private readonly _vHipMid = new THREE.Vector3();
  private readonly _virtualHipL = new THREE.Vector3();
  private readonly _virtualHipR = new THREE.Vector3();
  private readonly _handDelta = new THREE.Vector3();
  private readonly _faceIndices = [10, 152, 234, 454, 1, 168, 6];
  private readonly _keyIndices = [0, 11, 12, 13, 14, 15, 16];

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  resetCalibration(): void {
    this.calibrated = false;
    this.sampleCount = 0;
    this.metricShoulderWidth = 0.40;
    this.torsoAspectRatio = 1.38;
    this.calibratedHeadW = 0.165;
    this.calibratedHeadH = 0.23;
    this.silhouetteChestWidthFactor = 1.0;
    this.poseBank.resetAll();
    this.leftHandBank.resetAll();
    this.rightHandBank.resetAll();
    this.faceAnchorBank.resetAll();
    this.depthFilter.reset();
    this.torsoWidthRatioFilter.reset();
    this.kinematics.armTwistL = 0;
    this.kinematics.armTwistR = 0;
    this.kinematics.forearmTwistL = 0;
    this.kinematics.forearmTwistR = 0;
    this.kinematics.headPitch = 0;
    this.kinematics.headYaw = 0;
    this.kinematics.headRoll = 0;
  }

  videoToScreenNorm(
    lm: { x: number; y: number },
    videoW: number,
    videoH: number,
    canvasW: number,
    canvasH: number
  ): { sx: number; sy: number } {
    const videoAspect = videoW / Math.max(videoH, 1);
    const canvasAspect = canvasW / Math.max(canvasH, 1);

    let sx = lm.x;
    let sy = lm.y;

    if (canvasAspect > videoAspect) {
      const scaleY = canvasAspect / videoAspect;
      sy = (sy - 0.5) * scaleY + 0.5;
    } else {
      const scaleX = videoAspect / canvasAspect;
      sx = (sx - 0.5) * scaleX + 0.5;
    }

    if (this.isMirrored) {
      sx = 1.0 - sx;
    }
    return { sx, sy };
  }

  unprojectToCameraSpace(sx: number, sy: number, zCam: number, out: THREE.Vector3): THREE.Vector3 {
    const ndcX = sx * 2.0 - 1.0;
    const ndcY = -(sy * 2.0 - 1.0);
    const halfFovRad = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const tanHalfFov = Math.tan(halfFovRad);
    const dist = Math.max(-zCam, 0.35);

    out.set(ndcX * dist * tanHalfFov * this.camera.aspect, ndcY * dist * tanHalfFov, -dist);
    return out;
  }

  update(
    trackingResult: TrackingFrameResult,
    videoW: number,
    videoH: number,
    canvasW: number,
    canvasH: number,
    timestampSec: number,
    maskBuffer: Uint8Array | null = null,
    maskW = 0,
    maskH = 0
  ): void {
    const poseNorm = trackingResult.poseLandmarks;
    const poseWorld = trackingResult.poseWorldLandmarks;

    if (!poseNorm || poseNorm.length < 33) {
      this.hasPose = false;
      this.hasLeftHand = false;
      this.hasRightHand = false;
      this.hasFace = false;
      this.syncPercent = Math.max(0, this.syncPercent - 3);
      return;
    }

    this.hasPose = true;
    const halfFovRad = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const tanHalfFov = Math.tan(halfFovRad);

    const sLNorm = poseNorm[11];
    const sRNorm = poseNorm[12];
    const sLScreen = this.videoToScreenNorm(sLNorm, videoW, videoH, canvasW, canvasH);
    const sRScreen = this.videoToScreenNorm(sRNorm, videoW, videoH, canvasW, canvasH);

    // 1. Auto-calibration métrique anatomique (épaules, ratio torse, silhouette)
    if (poseWorld && poseWorld.length >= 33) {
      const wSL = poseWorld[11];
      const wSR = poseWorld[12];
      const dxW = wSL.x - wSR.x;
      const dyW = wSL.y - wSR.y;
      const dzW = wSL.z - wSR.z;
      const worldSpan = Math.sqrt(dxW * dxW + dyW * dyW + dzW * dzW);

      if (worldSpan > 0.24 && worldSpan < 0.62 && (sLNorm.visibility ?? 1) > 0.45 && (sRNorm.visibility ?? 1) > 0.45) {
        const alpha = this.sampleCount < 45 ? 0.16 : 0.02;
        this.metricShoulderWidth = THREE.MathUtils.lerp(this.metricShoulderWidth, worldSpan, alpha);

        const hL = poseWorld[23];
        const hR = poseWorld[24];
        const sMidY = (wSL.y + wSR.y) * 0.5;
        const hMidY = (hL.y + hR.y) * 0.5;
        const tH = Math.abs(hMidY - sMidY);
        if (tH > 0.3 && tH < 0.78) {
          this.torsoAspectRatio = THREE.MathUtils.lerp(this.torsoAspectRatio, tH / worldSpan, alpha);
        }

        this.sampleCount++;
        if (this.sampleCount >= 20) this.calibrated = true;
      }
    }

    const ndcDx = (sLScreen.sx - sRScreen.sx) * 2.0 * tanHalfFov * this.camera.aspect;
    const ndcDy = (sLScreen.sy - sRScreen.sy) * 2.0 * tanHalfFov;
    const apparentSpan = Math.sqrt(ndcDx * ndcDx + ndcDy * ndcDy);

    const face = trackingResult.faceLandmarks;
    let faceDepthEst: number | null = null;
    if (face && face.length >= 468) {
      const fL = this.videoToScreenNorm(face[234], videoW, videoH, canvasW, canvasH);
      const fR = this.videoToScreenNorm(face[454], videoW, videoH, canvasW, canvasH);
      const fDx = (fL.sx - fR.sx) * 2.0 * tanHalfFov * this.camera.aspect;
      const fDy = (fL.sy - fR.sy) * 2.0 * tanHalfFov;
      const fSpan = Math.sqrt(fDx * fDx + fDy * fDy);
      if (fSpan > 0.04) {
        faceDepthEst = THREE.MathUtils.clamp(0.148 / fSpan, 0.45, 3.8);
      }
    }

    if (apparentSpan > 0.055) {
      let foreshorten = 1.0;
      if (poseWorld && poseWorld.length >= 33) {
        const wDx = poseWorld[11].x - poseWorld[12].x;
        const wDy = poseWorld[11].y - poseWorld[12].y;
        const proj2d = Math.sqrt(wDx * wDx + wDy * wDy);
        const full3d = Math.sqrt(proj2d * proj2d + Math.pow(poseWorld[11].z - poseWorld[12].z, 2));
        if (full3d > 0.1) foreshorten = Math.max(proj2d / full3d, 0.38);
      }
      const shoulderDepth = THREE.MathUtils.clamp((this.metricShoulderWidth * foreshorten) / apparentSpan, 0.48, 4.5);
      // En plan rapproché ou quand un bord d'épaule sort du cadre, stabilise la profondeur grâce à la largeur faciale
      const shoulderClipped = sLNorm.x < 0.06 || sLNorm.x > 0.94 || sRNorm.x < 0.06 || sRNorm.x > 0.94;
      const rawDepth =
        faceDepthEst !== null
          ? THREE.MathUtils.lerp(shoulderDepth, faceDepthEst, shoulderClipped ? 0.65 : 0.25)
          : shoulderDepth;
      this.userDepth = this.depthFilter.filter(rawDepth, timestampSec);
    } else if (faceDepthEst !== null) {
      this.userDepth = this.depthFilter.filter(faceDepthEst, timestampSec);
    }

    // 2. Mesure largeur réelle du buste via masque de segmentation (verrouillage athlétique serré)
    if (maskBuffer && maskW > 16 && maskH > 16) {
      const chestNormY = THREE.MathUtils.clamp(((sLNorm.y + sRNorm.y) * 0.5) + 0.07, 0.1, 0.85);
      const row = Math.min(maskH - 1, Math.max(0, Math.round(chestNormY * maskH)));
      const rowOffset = row * maskW;
      let minX = maskW;
      let maxX = -1;
      for (let x = 0; x < maskW; x++) {
        if (maskBuffer[rowOffset + x] > 125) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      const normBodySpan = (maxX - minX) / maskW;
      const normShoulderSpan = Math.abs(sLNorm.x - sRNorm.x);
      if (maxX > minX && normShoulderSpan > 0.08 && normBodySpan > normShoulderSpan * 0.85 && normBodySpan < normShoulderSpan * 1.75) {
        const ratio = THREE.MathUtils.clamp(normBodySpan / (normShoulderSpan * 1.14), 0.96, 1.12);
        this.silhouetteChestWidthFactor = this.torsoWidthRatioFilter.filter(ratio, timestampSec);
      }
    }

    let worldChestZ = 0;
    if (poseWorld && poseWorld.length >= 33) {
      worldChestZ = (poseWorld[11].z + poseWorld[12].z) * 0.5;
    }

    for (let i = 0; i < 33; i++) {
      const lm = poseNorm[i];
      const { sx, sy } = this.videoToScreenNorm(lm, videoW, videoH, canvasW, canvasH);

      let zOffset = 0;
      if (poseWorld && poseWorld[i]) {
        zOffset = -(poseWorld[i].z - worldChestZ);
      } else {
        zOffset = -(lm.z ?? 0) * this.userDepth * 0.52;
      }

      const zCam = -this.userDepth + THREE.MathUtils.clamp(zOffset, -0.85, 0.85);
      this.unprojectToCameraSpace(sx, sy, zCam, this._rawVec);
      const vis = lm.visibility ?? 0.9;
      this.poseBank.updatePoint(i, this._rawVec, vis, timestampSec);
    }

    // 3. Synthèse / stabilisation des hanches quand l'utilisateur est cadré au buste
    const hipLVis = poseNorm[23]?.visibility ?? 0;
    const hipRVis = poseNorm[24]?.visibility ?? 0;
    const hipLInFrame = poseNorm[23] && poseNorm[23].y < 1.04 && hipLVis > 0.45;
    const hipRInFrame = poseNorm[24] && poseNorm[24].y < 1.04 && hipRVis > 0.45;

    if (!hipLInFrame || !hipRInFrame) {
      const pSL = this.poseBank.points[11];
      const pSR = this.poseBank.points[12];
      this._vShoulderMid.addVectors(pSL, pSR).multiplyScalar(0.5);
      const sw = pSL.distanceTo(pSR);
      const estTorsoH = sw * this.torsoAspectRatio;

      this._tmpA.subVectors(pSL, pSR).normalize();
      this._tmpB.set(0, -1, 0);
      if (poseWorld && poseWorld[23] && poseWorld[24]) {
        const wHipX = (poseWorld[23].x + poseWorld[24].x) * 0.5 - (poseWorld[11].x + poseWorld[12].x) * 0.5;
        const wHipY = (poseWorld[23].y + poseWorld[24].y) * 0.5 - (poseWorld[11].y + poseWorld[12].y) * 0.5;
        const wHipZ = (poseWorld[23].z + poseWorld[24].z) * 0.5 - (poseWorld[11].z + poseWorld[12].z) * 0.5;
        const signX = this.isMirrored ? -1 : 1;
        this._tmpB.set(wHipX * signX, -wHipY, -wHipZ).normalize();
      }

      const hipCenter = this._vHipMid.copy(this._vShoulderMid).addScaledVector(this._tmpB, estTorsoH);
      const halfHipW = sw * 0.35;
      this._virtualHipL.copy(hipCenter).addScaledVector(this._tmpA, halfHipW);
      this._virtualHipR.copy(hipCenter).addScaledVector(this._tmpA, -halfHipW);

      if (!hipLInFrame) {
        this.poseBank.points[23].lerp(this._virtualHipL, 0.48);
        this.poseBank.visibility[23] = 0.72;
      }
      if (!hipRInFrame) {
        this.poseBank.points[24].lerp(this._virtualHipR, 0.48);
        this.poseBank.visibility[24] = 0.72;
      }
    }

    // 4. Verrouillage des mains directement sur les poignets filtrés (élimine le jeu poignet/avant-bras)
    this.hasLeftHand = this._updateHand(
      trackingResult.leftHandLandmarks,
      trackingResult.leftHandWorldLandmarks,
      this.poseBank.points[15],
      this.leftHandBank,
      videoW,
      videoH,
      canvasW,
      canvasH,
      timestampSec
    );

    this.hasRightHand = this._updateHand(
      trackingResult.rightHandLandmarks,
      trackingResult.rightHandWorldLandmarks,
      this.poseBank.points[16],
      this.rightHandBank,
      videoW,
      videoH,
      canvasW,
      canvasH,
      timestampSec
    );

    // 5. Ancrage crânien haute précision via FaceLandmarker (robuste même avec casque audio sur les oreilles)
    if (face && face.length >= 468) {
      this.hasFace = true;
      const poseNoseZ = this.poseBank.points[0].z;
      const shoulderMidZ = (this.poseBank.points[11].z + this.poseBank.points[12].z) * 0.5;
      const poseHeadZ = THREE.MathUtils.clamp(poseNoseZ, shoulderMidZ - 0.16, shoulderMidZ + 0.24);

      const faceScaleZ = this.metricShoulderWidth * 0.34;
      for (let k = 0; k < this._faceIndices.length; k++) {
        const idx = this._faceIndices[k];
        const flm = face[idx];
        const { sx, sy } = this.videoToScreenNorm(flm, videoW, videoH, canvasW, canvasH);
        const zCam = poseHeadZ - (flm.z ?? 0) * faceScaleZ;
        this.unprojectToCameraSpace(sx, sy, zCam, this._rawVec);
        this.faceAnchorBank.updatePoint(k, this._rawVec, 1.0, timestampSec);
      }

      const rawFaceH = this.faceAnchorBank.points[0].distanceTo(this.faceAnchorBank.points[1]);
      const rawFaceW = this.faceAnchorBank.points[2].distanceTo(this.faceAnchorBank.points[3]);
      if (rawFaceH > 0.10 && rawFaceH < 0.36 && rawFaceW > 0.08 && rawFaceW < 0.28) {
        this.calibratedHeadH = THREE.MathUtils.lerp(this.calibratedHeadH, rawFaceH, 0.10);
        this.calibratedHeadW = THREE.MathUtils.lerp(this.calibratedHeadW, rawFaceW, 0.10);
      }
    } else {
      this.hasFace = false;
    }

    // 6. Solveur cinématique Kalidokit (torsion axiale avant-bras/biceps & stabilisation crânienne)
    this._kalidoTick++;
    if ((this._kalidoTick & 1) === 0 && poseWorld && poseWorld.length >= 33) {
      try {
        const solvedPose = KalidoPose.solve(poseWorld, poseNorm, {
          runtime: 'mediapipe',
          imageSize: { width: videoW, height: videoH },
          enableLegs: false,
        });
        if (solvedPose) {
          const mirrorSign = this.isMirrored ? -1 : 1;
          this.kinematics.armTwistL = THREE.MathUtils.lerp(
            this.kinematics.armTwistL,
            THREE.MathUtils.clamp((solvedPose.LeftUpperArm.y || 0) * mirrorSign, -0.55, 0.55),
            0.25
          );
          this.kinematics.armTwistR = THREE.MathUtils.lerp(
            this.kinematics.armTwistR,
            THREE.MathUtils.clamp((solvedPose.RightUpperArm.y || 0) * mirrorSign, -0.55, 0.55),
            0.25
          );
          this.kinematics.forearmTwistL = THREE.MathUtils.lerp(
            this.kinematics.forearmTwistL,
            THREE.MathUtils.clamp((solvedPose.LeftLowerArm.y || 0) * mirrorSign, -0.65, 0.65),
            0.25
          );
          this.kinematics.forearmTwistR = THREE.MathUtils.lerp(
            this.kinematics.forearmTwistR,
            THREE.MathUtils.clamp((solvedPose.RightLowerArm.y || 0) * mirrorSign, -0.65, 0.65),
            0.25
          );
        }
      } catch {
        // Ignore transient malformed landmarks
      }
    }

    if ((this._kalidoTick & 1) === 1 && face && face.length >= 468) {
      try {
        const solvedFace = KalidoFace.solve(face, {
          runtime: 'mediapipe',
          imageSize: { width: videoW, height: videoH },
        });
        if (solvedFace?.head) {
          const mirrorSign = this.isMirrored ? -1 : 1;
          this.kinematics.headPitch = THREE.MathUtils.lerp(
            this.kinematics.headPitch,
            THREE.MathUtils.clamp(solvedFace.head.x || 0, -0.45, 0.45),
            0.28
          );
          this.kinematics.headYaw = THREE.MathUtils.lerp(
            this.kinematics.headYaw,
            THREE.MathUtils.clamp((solvedFace.head.y || 0) * mirrorSign, -0.65, 0.65),
            0.28
          );
          this.kinematics.headRoll = THREE.MathUtils.lerp(
            this.kinematics.headRoll,
            THREE.MathUtils.clamp((solvedFace.head.z || 0) * mirrorSign, -0.45, 0.45),
            0.28
          );
        }
      } catch {
        // Ignore transient face solver edge cases
      }
    }

    let visSum = 0;
    for (let i = 0; i < this._keyIndices.length; i++) {
      const idx = this._keyIndices[i];
      visSum += Math.min(poseNorm[idx]?.visibility ?? 0, 1);
    }
    const poseScore = (visSum / this._keyIndices.length) * 65;
    const faceBonus = this.hasFace ? 15 : 5;
    const handBonus = (this.hasLeftHand ? 10 : 0) + (this.hasRightHand ? 10 : 0);
    const targetSync = Math.min(99.8, poseScore + faceBonus + handBonus);
    this.syncPercent = THREE.MathUtils.lerp(this.syncPercent, targetSync, 0.15);
  }

  private _updateHand(
    handNorm: NormalizedLandmark[] | null,
    handWorld: Landmark[] | null,
    poseWristPos: THREE.Vector3,
    handBank: LandmarkFilterBank,
    videoW: number,
    videoH: number,
    canvasW: number,
    canvasH: number,
    timestampSec: number
  ): boolean {
    if (!handNorm || handNorm.length < 21) return false;
    const wristZ = poseWristPos.z;
    const wristWorldZ = handWorld?.[0]?.z ?? 0;

    for (let i = 0; i < 21; i++) {
      const lm = handNorm[i];
      const { sx, sy } = this.videoToScreenNorm(lm, videoW, videoH, canvasW, canvasH);
      let zOffset = 0;
      if (handWorld && handWorld[i]) {
        zOffset = -(handWorld[i].z - wristWorldZ);
      } else {
        zOffset = -(lm.z ?? 0) * 0.22;
      }
      const zCam = wristZ + THREE.MathUtils.clamp(zOffset, -0.28, 0.28);
      this.unprojectToCameraSpace(sx, sy, zCam, this._rawVec);
      handBank.updatePoint(i, this._rawVec, 1.0, timestampSec);
    }

    // Attache rigide du poignet du gantelet sur l'articulation poignet de l'avant-bras
    this._handDelta.subVectors(poseWristPos, handBank.points[0]);
    if (this._handDelta.lengthSq() < 0.08) {
      for (let i = 0; i < 21; i++) {
        handBank.points[i].addScaledVector(this._handDelta, 0.72);
      }
    }

    return true;
  }

  getCalibratedReadout(): string {
    const cm = Math.round(this.metricShoulderWidth * 100);
    const dist = this.userDepth.toFixed(2);
    return `${cm}CM // ${dist}M`;
  }
}
