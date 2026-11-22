import * as THREE from 'three';

function createStudioEnvironmentScene(): THREE.Scene {
  const envScene = new THREE.Scene();

  // Dark matte studio enclosure so dark steel & crimson reflections have deep rich contrast
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(34, 34, 34),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.095, 0.12), side: THREE.BackSide })
  );
  envScene.add(shell);

  const addSoftbox = (
    w: number,
    h: number,
    pos: [number, number, number],
    intensity: number,
    hex: number
  ) => {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity) })
    );
    panel.position.set(pos[0], pos[1], pos[2]);
    panel.lookAt(0, 0, 0);
    envScene.add(panel);
  };

  // Controlled cinematic 3-point bounce cards (crisp metallic edge highlights without plastic washout)
  addSoftbox(6.5, 3.8, [-3.5, 7.5, 4.5], 2.1, 0xfff3e6);
  addSoftbox(7.2, 2.2, [4.5, 5.5, -5.8], 1.45, 0xdcf0ff);
  addSoftbox(3.8, 7.8, [0.8, 2.5, 10.5], 1.35, 0xfff8f2);
  addSoftbox(2.6, 5.5, [-10.0, 2.8, -2.0], 1.25, 0xe8f2ff);
  addSoftbox(1.9, 6.8, [8.4, 1.4, 3.0], 1.75, 0xffd5a8);
  addSoftbox(6.0, 6.0, [0.0, -7.5, 0.0], 0.28, 0x7084a8);

  return envScene;
}

export class EnvLighting {
  private scene: THREE.Scene;

  private readonly sampleW = 32;
  private readonly sampleH = 18;
  private sampleCanvas: HTMLCanvasElement;
  private sampleCtx: CanvasRenderingContext2D;

  private pmrem: THREE.PMREMGenerator;
  private currentEnvRT: THREE.WebGLRenderTarget;

  public readonly hemiLight: THREE.HemisphereLight;
  public readonly keyLight: THREE.DirectionalLight;
  public readonly fillLight: THREE.DirectionalLight;
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

    this.pmrem = new THREE.PMREMGenerator(renderer);
    const studioScene = createStudioEnvironmentScene();
    this.currentEnvRT = this.pmrem.fromScene(studioScene, 0.04);
    this.scene.environment = this.currentEnvRT.texture;
    studioScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) (mesh.material as THREE.Material).dispose();
    });

    // Cinema contrast lighting: deep shadows + warm key + cool rim edge
    this.hemiLight = new THREE.HemisphereLight(0xdce8fa, 0x161b24, 0.72);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1e0, 1.85);
    this.keyLight.position.set(-1.3, 2.2, 2.4);
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0xc2dcf8, 0.72);
    this.fillLight.position.set(1.8, 0.4, 1.4);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0x9be9ff, 1.15);
    this.rimLight.position.set(0.9, 1.5, -2.1);
    this.scene.add(this.rimLight);

    this.arcPointLight = new THREE.PointLight(0x66f0ff, 1.35, 1.45);
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
    if (nowMs - this.lastUpdateMs < 200) return;
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
      .lerp(this._white, 0.5);

    this._groundColor.setRGB(botR / botCount / 255, botG / botCount / 255, botB / botCount / 255);

    this.hemiLight.color.lerp(this._skyColor, 0.22);
    this.hemiLight.groundColor.lerp(this._groundColor, 0.22);
    this.hemiLight.intensity = THREE.MathUtils.clamp(0.55 + this.lumaSummary * 0.55, 0.52, 1.05);

    const dirX = (hotX - 0.5) * 3.0;
    const dirY = (0.5 - hotY) * 2.5 + 0.8;
    this._targetLightPos.set(dirX, dirY, 2.3);
    this.keyLight.position.lerp(this._targetLightPos, 0.2);

    this._targetLightColor.setRGB(hotR / 255, hotG / 255, hotB / 255).lerp(this._white, 0.62);
    this.keyLight.color.lerp(this._targetLightColor, 0.2);
    this.keyLight.intensity = THREE.MathUtils.clamp(1.4 + this.lumaSummary * 0.9, 1.35, 2.15);
  }

  dispose(): void {
    this.currentEnvRT.dispose();
    this.pmrem.dispose();
  }
}
