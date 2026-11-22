import * as THREE from 'three';

function createStudioEnvironmentScene(): THREE.Scene {
  const envScene = new THREE.Scene();

  // Dark high-contrast cinema studio shell so clearcoated cherry-crimson & brushed gold catch crisp reflections
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(36, 36, 36),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.065, 0.09), side: THREE.BackSide })
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

  // Sharp architectural light-strips (MCU suit showcase reflections like Endgame / Stark Lab)
  addSoftbox(8.5, 2.1, [-2.8, 8.2, 4.0], 2.75, 0xfff6ea); // Overhead warm key strip
  addSoftbox(1.4, 9.0, [-8.5, 1.5, 4.8], 2.15, 0xfff0dd); // Left crisp vertical edge strip
  addSoftbox(1.4, 9.0, [8.5, 1.5, 4.2], 2.25, 0xd8f0ff);  // Right cool cyan-silver edge strip
  addSoftbox(9.5, 1.6, [0.0, 6.0, -7.2], 2.10, 0xbfe8ff); // High rim crown strip
  addSoftbox(4.2, 4.2, [0.5, 1.8, 11.2], 1.15, 0xfffaf2); // Front subtle specular card
  addSoftbox(8.0, 8.0, [0.0, -8.0, 0.0], 0.25, 0x3b4a62); // Subtle cool floor bounce

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
    this.currentEnvRT = this.pmrem.fromScene(studioScene, 0.03);
    this.scene.environment = this.currentEnvRT.texture;
    studioScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) (mesh.material as THREE.Material).dispose();
    });

    this.hemiLight = new THREE.HemisphereLight(0xdce8fa, 0x10151e, 0.68);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff4e6, 2.15);
    this.keyLight.position.set(-1.5, 2.5, 2.5);
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0xbcd8f8, 0.72);
    this.fillLight.position.set(1.9, 0.5, 1.4);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0x9beeff, 1.45);
    this.rimLight.position.set(0.9, 1.6, -2.2);
    this.scene.add(this.rimLight);

    this.arcPointLight = new THREE.PointLight(0x66f2ff, 1.65, 1.55);
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
    this.hemiLight.intensity = THREE.MathUtils.clamp(0.55 + this.lumaSummary * 0.52, 0.52, 1.02);

    const dirX = (hotX - 0.5) * 3.0;
    const dirY = (0.5 - hotY) * 2.5 + 0.8;
    this._targetLightPos.set(dirX, dirY, 2.4);
    this.keyLight.position.lerp(this._targetLightPos, 0.2);

    this._targetLightColor.setRGB(hotR / 255, hotG / 255, hotB / 255).lerp(this._white, 0.65);
    this.keyLight.color.lerp(this._targetLightColor, 0.2);
    this.keyLight.intensity = THREE.MathUtils.clamp(1.65 + this.lumaSummary * 0.9, 1.6, 2.4);
  }

  dispose(): void {
    this.currentEnvRT.dispose();
    this.pmrem.dispose();
  }
}
