import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export class EnvLighting {
  private scene: THREE.Scene;

  private readonly sampleW = 32;
  private readonly sampleH = 18;
  private sampleCanvas: HTMLCanvasElement;
  private sampleCtx: CanvasRenderingContext2D;

  private envCanvas: HTMLCanvasElement;
  private envCtx: CanvasRenderingContext2D;
  private envTex: THREE.CanvasTexture;

  private pmrem: THREE.PMREMGenerator;
  private currentEnvRT: THREE.WebGLRenderTarget | null = null;

  public readonly hemiLight: THREE.HemisphereLight;
  public readonly keyLight: THREE.DirectionalLight;
  public readonly rimLight: THREE.DirectionalLight;
  public readonly arcPointLight: THREE.PointLight;

  private lastUpdateMs = 0;
  public lumaSummary = 0.55;

  private readonly _targetLightPos = new THREE.Vector3();
  private readonly _targetLightColor = new THREE.Color();
  private readonly _skyColor = new THREE.Color();
  private readonly _groundColor = new THREE.Color();
  private readonly _white = new THREE.Color(0xffffff);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.scene = scene;

    this.sampleCanvas = document.createElement('canvas');
    this.sampleCanvas.width = this.sampleW;
    this.sampleCanvas.height = this.sampleH;
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true })!;

    this.envCanvas = document.createElement('canvas');
    this.envCanvas.width = 64;
    this.envCanvas.height = 32;
    this.envCtx = this.envCanvas.getContext('2d')!;
    this.envTex = new THREE.CanvasTexture(this.envCanvas);
    this.envTex.mapping = THREE.EquirectangularReflectionMapping;
    this.envTex.colorSpace = THREE.SRGBColorSpace;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    // Studio RoomEnvironment reflection immediately available (essential for Demo 3D & startup)
    const roomEnv = new RoomEnvironment();
    this.currentEnvRT = this.pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this.currentEnvRT.texture;
    roomEnv.dispose();

    // Warm/Cool 3-point lighting rig
    this.hemiLight = new THREE.HemisphereLight(0xfff4e6, 0x2a3240, 1.35);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff5e8, 2.35);
    this.keyLight.position.set(0.8, 1.6, 1.8);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x7ad8ff, 1.05);
    this.rimLight.position.set(-1.4, 0.5, -1.2);
    this.scene.add(this.rimLight);

    this.arcPointLight = new THREE.PointLight(0x3beeff, 0.9, 1.2);
    this.scene.add(this.arcPointLight);
  }

  update(
    videoEl: HTMLVideoElement | null,
    arcWorldPos: THREE.Vector3,
    isMirrored: boolean,
    nowMs: number,
    isDemoMode = false
  ): void {
    this.arcPointLight.position.copy(arcWorldPos);
    if (isDemoMode || !videoEl || videoEl.readyState < 2) return;
    if (nowMs - this.lastUpdateMs < 180) return;
    this.lastUpdateMs = nowMs;

    const w = this.sampleW;
    const h = this.sampleH;
    this.sampleCtx.save();
    if (isMirrored) {
      this.sampleCtx.translate(w, 0);
      this.sampleCtx.scale(-1, 1);
    }
    this.sampleCtx.drawImage(videoEl, 0, 0, w, h);
    this.sampleCtx.restore();

    const data = this.sampleCtx.getImageData(0, 0, w, h).data;

    let topR = 0, topG = 0, topB = 0, topCount = 0;
    let botR = 0, botG = 0, botB = 0, botCount = 0;
    let maxLuma = 0;
    let hotX = 0.5, hotY = 0.25;
    let hotR = 255, hotG = 248, hotB = 235;
    let totalLuma = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        totalLuma += luma;

        if (y < h * 0.45) {
          topR += r;
          topG += g;
          topB += b;
          topCount++;
        } else {
          botR += r;
          botG += g;
          botB += b;
          botCount++;
        }

        if (luma > maxLuma) {
          maxLuma = luma;
          hotX = x / w;
          hotY = y / h;
          hotR = r;
          hotG = g;
          hotB = b;
        }
      }
    }

    this.lumaSummary = totalLuma / (w * h * 255);

    this._skyColor
      .setRGB(topR / topCount / 255, topG / topCount / 255, topB / topCount / 255)
      .lerp(this._white, 0.35);

    this._groundColor.setRGB(botR / botCount / 255, botG / botCount / 255, botB / botCount / 255);

    this.hemiLight.color.lerp(this._skyColor, 0.28);
    this.hemiLight.groundColor.lerp(this._groundColor, 0.28);
    this.hemiLight.intensity = THREE.MathUtils.clamp(0.95 + this.lumaSummary * 1.1, 0.85, 2.1);

    const dirX = (hotX - 0.5) * 3.2;
    const dirY = (0.5 - hotY) * 2.8 + 0.6;
    this._targetLightPos.set(dirX, dirY, 2.0);
    this.keyLight.position.lerp(this._targetLightPos, 0.25);

    this._targetLightColor.setRGB(hotR / 255, hotG / 255, hotB / 255).lerp(this._white, 0.45);
    this.keyLight.color.lerp(this._targetLightColor, 0.25);
    this.keyLight.intensity = THREE.MathUtils.clamp(1.6 + this.lumaSummary * 1.4, 1.4, 3.0);

    this.envCtx.filter = 'blur(4px)';
    this.envCtx.drawImage(this.sampleCanvas, 0, 0, this.envCanvas.width, this.envCanvas.height);
    this.envTex.needsUpdate = true;

    const newEnvRT = this.pmrem.fromEquirectangular(this.envTex);
    this.currentEnvRT?.dispose();
    this.currentEnvRT = newEnvRT;
    this.scene.environment = newEnvRT.texture;
  }

  dispose(): void {
    this.currentEnvRT?.dispose();
    this.envTex.dispose();
    this.pmrem.dispose();
  }
}
