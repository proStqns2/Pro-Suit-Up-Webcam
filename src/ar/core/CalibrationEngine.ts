import * as THREE from 'three';
import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';
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

  public readonly poseBank = new LandmarkFilterBank(33, 1.35, 0.09, 1.0);
  public readonly leftHandBank = new LandmarkFilterBank(21, 1.85, 0.14, 1.2);
  public readonly rightHandBank = new LandmarkFilterBank(21, 1.85, 0.14, 1.2);
  public readonly faceAnchorBank = new LandmarkFilterBank(7, 1.65, 0.1, 1.0); // [10, 152, 234, 454, 1, 168, 6]
  private readonly depthFilter = new OneEuroFilter(60, 0.9, 0.04, 1.0);

  public calibrated = false;
  public sampleCount = 0;
  public metricShoulderWidth = 0.39;
  public torsoAspectRatio = 1.42;
  public userDepth = 1.65;

  public hasPose = false;
  public hasLeftHand = false;
  public hasRightHand = false;
  public hasFace = false;
  public syncPercent = 0;

  private readonly _tmpA = new THREE.Vector3();
  private readonly _tmpB = new THREE.Vector3();
  private readonly _rawVec = new THREE.Vector3();
  private readonly _vShoulderMid = new THREE.Vector3();
  private readonly _vHipMid = new THREE.Vector3();
  private readonly _virtualHipL = new THREE.Vector3();
  private readonly _virtualHipR = new THREE.Vector3();
  private readonly _faceIndices = [10, 152, 234, 454, 1, 168, 6];
  private readonly _keyIndices = [0, 11, 12, 13, 14, 15, 16];

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  resetCalibration(): void {
    this.calibrated = false;
    this.sampleCount = 0;
    this.metricShoulderWidth = 0.39;
    this.torsoAspectRatio = 1.42;
    this.poseBank.resetAll();
    this.leftHandBank.resetAll();
    this.rightHandBank.resetAll();
    this.faceAnchorBank.resetAll();
    this.depthFilter.reset();
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
    timestampSec: number
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

    if (poseWorld && poseWorld.length >= 33) {
      const wSL = poseWorld[11];
      const wSR = poseWorld[12];
      const dxW = wSL.x - wSR.x;
      const dyW = wSL.y - wSR.y;
      const dzW = wSL.z - wSR.z;
      const worldSpan = Math.sqrt(dxW * dxW + dyW * dyW + dzW * dzW);

      if (worldSpan > 0.22 && worldSpan < 0.65 && (sLNorm.visibility ?? 1) > 0.5 && (sRNorm.visibility ?? 1) > 0.5) {
        const alpha = this.sampleCount < 45 ? 0.14 : 0.015;
        this.metricShoulderWidth = THREE.MathUtils.lerp(this.metricShoulderWidth, worldSpan, alpha);

        const hL = poseWorld[23];
        const hR = poseWorld[24];
        const sMidY = (wSL.y + wSR.y) * 0.5;
        const hMidY = (hL.y + hR.y) * 0.5;
        const tH = Math.abs(hMidY - sMidY);
        if (tH > 0.3 && tH < 0.8) {
          this.torsoAspectRatio = THREE.MathUtils.lerp(this.torsoAspectRatio, tH / worldSpan, alpha);
        }

        this.sampleCount++;
        if (this.sampleCount >= 24) this.calibrated = true;
      }
    }

    const ndcDx = (sLScreen.sx - sRScreen.sx) * 2.0 * tanHalfFov * this.camera.aspect;
    const ndcDy = (sLScreen.sy - sRScreen.sy) * 2.0 * tanHalfFov;
    const apparentSpan = Math.sqrt(ndcDx * ndcDx + ndcDy * ndcDy);

    if (apparentSpan > 0.06) {
      let foreshorten = 1.0;
      if (poseWorld && poseWorld.length >= 33) {
        const wDx = poseWorld[11].x - poseWorld[12].x;
        const wDy = poseWorld[11].y - poseWorld[12].y;
        const proj2d = Math.sqrt(wDx * wDx + wDy * wDy);
        const full3d = Math.sqrt(proj2d * proj2d + Math.pow(poseWorld[11].z - poseWorld[12].z, 2));
        if (full3d > 0.1) foreshorten = Math.max(proj2d / full3d, 0.35);
      }
      const rawDepth = THREE.MathUtils.clamp((this.metricShoulderWidth * foreshorten) / apparentSpan, 0.65, 4.5);
      this.userDepth = this.depthFilter.filter(rawDepth, timestampSec);
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
        zOffset = -(lm.z ?? 0) * this.userDepth * 0.55;
      }

      const zCam = -this.userDepth + THREE.MathUtils.clamp(zOffset, -0.85, 0.85);
      this.unprojectToCameraSpace(sx, sy, zCam, this._rawVec);
      const vis = lm.visibility ?? 0.9;
      this.poseBank.updatePoint(i, this._rawVec, vis, timestampSec);
    }

    // Synthèse de hanches virtuelles si l'utilisateur est assis (hanches hors-champ)
    const hipLVis = poseNorm[23]?.visibility ?? 0;
    const hipRVis = poseNorm[24]?.visibility ?? 0;
    const hipLInFrame = poseNorm[23] && poseNorm[23].y < 1.06 && hipLVis > 0.42;
    const hipRInFrame = poseNorm[24] && poseNorm[24].y < 1.06 && hipRVis > 0.42;

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
      const halfHipW = sw * 0.34;
      this._virtualHipL.copy(hipCenter).addScaledVector(this._tmpA, halfHipW);
      this._virtualHipR.copy(hipCenter).addScaledVector(this._tmpA, -halfHipW);

      if (!hipLInFrame) {
        this.poseBank.points[23].lerp(this._virtualHipL, 0.35);
        this.poseBank.visibility[23] = 0.65;
      }
      if (!hipRInFrame) {
        this.poseBank.points[24].lerp(this._virtualHipR, 0.35);
        this.poseBank.visibility[24] = 0.65;
      }
    }

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

    const face = trackingResult.faceLandmarks;
    if (face && face.length >= 468) {
      this.hasFace = true;
      const headZ = this.poseBank.points[0].z;
      const faceScaleZ = this.metricShoulderWidth * 0.45;
      for (let k = 0; k < this._faceIndices.length; k++) {
        const idx = this._faceIndices[k];
        const flm = face[idx];
        const { sx, sy } = this.videoToScreenNorm(flm, videoW, videoH, canvasW, canvasH);
        const zCam = headZ - (flm.z ?? 0) * faceScaleZ;
        this.unprojectToCameraSpace(sx, sy, zCam, this._rawVec);
        this.faceAnchorBank.updatePoint(k, this._rawVec, 1.0, timestampSec);
      }
    } else {
      this.hasFace = false;
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
        zOffset = -(lm.z ?? 0) * 0.25;
      }
      const zCam = wristZ + THREE.MathUtils.clamp(zOffset, -0.35, 0.35);
      this.unprojectToCameraSpace(sx, sy, zCam, this._rawVec);
      handBank.updatePoint(i, this._rawVec, 1.0, timestampSec);
    }
    return true;
  }

  getCalibratedReadout(): string {
    const cm = Math.round(this.metricShoulderWidth * 100);
    const dist = this.userDepth.toFixed(2);
    return `${cm}CM // ${dist}M`;
  }
}
