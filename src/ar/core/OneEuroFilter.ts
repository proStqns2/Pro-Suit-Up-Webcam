import * as THREE from 'three';

class LowPassFilter {
  private y: number;
  private s: number;
  public initialized = false;

  constructor(initVal = 0) {
    this.y = initVal;
    this.s = initVal;
  }

  filter(value: number, alpha: number): number {
    if (!this.initialized) {
      this.s = value;
      this.initialized = true;
    } else {
      this.s = alpha * value + (1.0 - alpha) * this.s;
    }
    this.y = value;
    return this.s;
  }

  lastValue(): number {
    return this.s;
  }

  reset(): void {
    this.initialized = false;
  }
}

export class OneEuroFilter {
  private freq: number;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private x: LowPassFilter;
  private dx: LowPassFilter;
  private lastTime: number | null = null;

  constructor(freq = 60, minCutoff = 1.2, beta = 0.06, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPassFilter();
    this.dx = new LowPassFilter();
  }

  private _alpha(cutoff: number): number {
    const te = 1.0 / Math.max(this.freq, 1e-4);
    const tau = 1.0 / (2.0 * Math.PI * Math.max(cutoff, 1e-4));
    return 1.0 / (1.0 + tau / te);
  }

  filter(value: number, timestampSec: number): number {
    if (this.lastTime !== null && timestampSec > this.lastTime) {
      const dt = Math.min(Math.max(timestampSec - this.lastTime, 1e-4), 0.25);
      this.freq = 1.0 / dt;
    }
    this.lastTime = timestampSec;

    const dValue = this.x.initialized ? (value - this.x.lastValue()) * this.freq : 0.0;
    const edValue = this.dx.filter(dValue, this._alpha(this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);
    return this.x.filter(value, this._alpha(cutoff));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }
}

export class OneEuroFilter3D {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;
  private fz: OneEuroFilter;
  public readonly value = new THREE.Vector3();
  public initialized = false;

  constructor(minCutoff = 1.3, beta = 0.08, dCutoff = 1.0) {
    this.fx = new OneEuroFilter(60, minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter(60, minCutoff, beta, dCutoff);
    this.fz = new OneEuroFilter(60, minCutoff, beta, dCutoff);
  }

  filter(v: THREE.Vector3, timestampSec: number, out = this.value): THREE.Vector3 {
    out.set(
      this.fx.filter(v.x, timestampSec),
      this.fy.filter(v.y, timestampSec),
      this.fz.filter(v.z, timestampSec)
    );
    this.initialized = true;
    return out;
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
    this.initialized = false;
  }
}

export class LandmarkFilterBank {
  public readonly filters: OneEuroFilter3D[];
  public readonly points: THREE.Vector3[];
  public readonly visibility: Float32Array;

  constructor(count: number, minCutoff = 1.3, beta = 0.08, dCutoff = 1.0) {
    this.filters = Array.from({ length: count }, () => new OneEuroFilter3D(minCutoff, beta, dCutoff));
    this.points = Array.from({ length: count }, () => new THREE.Vector3());
    this.visibility = new Float32Array(count);
  }

  updatePoint(index: number, rawVec: THREE.Vector3, visibility: number, timestampSec: number): THREE.Vector3 {
    this.visibility[index] = visibility;
    if (visibility < 0.2 && this.filters[index].initialized) {
      return this.points[index];
    }
    return this.filters[index].filter(rawVec, timestampSec, this.points[index]);
  }

  resetAll(): void {
    for (let i = 0; i < this.filters.length; i++) {
      this.filters[i].reset();
      this.visibility[i] = 0;
    }
  }
}
