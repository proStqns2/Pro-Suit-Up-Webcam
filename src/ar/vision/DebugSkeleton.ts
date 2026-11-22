import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { CalibrationEngine, TrackingFrameResult } from '../core/CalibrationEngine';

const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [0, 11], [0, 12], [7, 8],
];

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10,
];

export class DebugSkeleton {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public enabled = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for DebugSkeleton');
    this.ctx = ctx;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) this.clear();
    return this.enabled;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(result: TrackingFrameResult, calibration: CalibrationEngine, videoW: number, videoH: number): void {
    if (!this.enabled) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const toPx = (lm: NormalizedLandmark): [number, number] => {
      const { sx, sy } = calibration.videoToScreenNorm(lm, videoW, videoH, w, h);
      return [sx * w, sy * h];
    };

    if (result.poseLandmarks) {
      ctx.strokeStyle = 'rgba(59, 240, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of POSE_CONNECTIONS) {
        const la = result.poseLandmarks[a];
        const lb = result.poseLandmarks[b];
        if (!la || !lb || (la.visibility ?? 1) < 0.35 || (lb.visibility ?? 1) < 0.35) continue;
        const [x1, y1] = toPx(la);
        const [x2, y2] = toPx(lb);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();

      ctx.fillStyle = '#f5c35b';
      for (let i = 0; i < result.poseLandmarks.length; i++) {
        const lm = result.poseLandmarks[i];
        if ((lm.visibility ?? 1) < 0.35) continue;
        const [px, py] = toPx(lm);
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const drawHand = (hand: NormalizedLandmark[] | null, color: string) => {
      if (!hand) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        const [x1, y1] = toPx(hand[a]);
        const [x2, y2] = toPx(hand[b]);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      for (const lm of hand) {
        const [px, py] = toPx(lm);
        ctx.beginPath();
        ctx.arc(px, py, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    drawHand(result.leftHandLandmarks, '#3bf0ff');
    drawHand(result.rightHandLandmarks, '#ff6877');

    if (result.faceLandmarks) {
      ctx.strokeStyle = 'rgba(245, 195, 91, 0.72)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i < FACE_OVAL.length; i++) {
        const lm = result.faceLandmarks[FACE_OVAL[i]];
        if (!lm) continue;
        const [px, py] = toPx(lm);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
}
