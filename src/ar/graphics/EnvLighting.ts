import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

function createIndoorRoomEnvironmentScene(): THREE.Scene {
  // Environnement architectural intérieur neutre/chaud cohérent avec un éclairage caméra domestique
  const room = new RoomEnvironment();
  const envScene = new THREE.Scene();
  envScene.add(room);

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(40, 40, 40),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x282623).multiplyScalar(0.45),
      side: THREE.BackSide,
    })
  );
  envScene.add(shell);

  const addPanel = (
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

  // Plafonnier doux + murs neutres + légère fenêtre latérale (zéro néon bleu artificiel)
  addPanel(11.0, 4.5, [0.0, 9.2, 3.2], 2.25, 0xfff5e6); // Plafonnier principal chaud/neutre
  addPanel(4.0, 8.5, [-10.0, 2.0, 3.8], 1.35, 0xf2f4f8); // Fenêtre / mur gauche doux
  addPanel(4.0, 8.5, [10.0, 1.5, 3.2], 1.15, 0xf6ebd9); // Rebonds mur droit
  addPanel(8.0, 5.5, [0.0, 1.4, 11.5], 0.92, 0xfff8ee); // Remplissage frontal doux axe caméra
  addPanel(10.0, 2.5, [0.0, 5.5, -8.5], 1.15, 0xeef2f7); // Séparation dorsale douce
  addPanel(12.0, 12.0, [0.0, -9.0, 0.0], 0.35, 0x5c5349); // Rebond sol bois/carrelage chaud

  return envScene;
}

function createStudioContactFloorTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const half = size / 2;

  const grad = ctx.createRadialGradient(half, half, 10, half, half, half);
  grad.addColorStop(0.0, 'rgba(0, 8, 16, 0.72)');
  grad.addColorStop(0.45, 'rgba(10, 24, 38, 0.34)');
  grad.addColorStop(0.78, 'rgba(0, 160, 200, 0.10)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(0, 220, 245, 0.24)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(half, half, size * 0.36, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
  public readonly underFillLight: THREE.DirectionalLight;
  public readonly arcPointLight: THREE.PointLight;
  public readonly demoFloorDisc: THREE.Mesh;
  private demoFloorTex: THREE.CanvasTexture;

  private lastUpdateMs = 0;
  public lumaSummary = 0.55;

  private readonly _targetLightPos = new THREE.Vector3();
  private readonly _targetLightColor = new THREE.Color();
  private readonly _skyColor = new THREE.Color();
  private readonly _groundColor = new THREE.Color();
  private readonly _sideColor = new THREE.Color();
  private readonly _white = new THREE.Color(0xffffff);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, isSoftwareGl = false) {
    this.scene = scene;

    this.sampleCanvas = document.createElement('canvas');
    this.sampleCanvas.width = this.sampleW;
    this.sampleCanvas.height = this.sampleH;
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true })!;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    const studioScene = createIndoorRoomEnvironmentScene();
    this.currentEnvRT = this.pmrem.fromScene(studioScene, 0.045);
    this.scene.environment = this.currentEnvRT.texture;
    studioScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
        else (mesh.material as THREE.Material).dispose();
      }
    });

    // Éclairage naturel de pièce (plafond chaud/neutre + sol sombre naturel)
    this.hemiLight = new THREE.HemisphereLight(0xf6efe6, 0x2c2824, 0.82);
    this.scene.add(this.hemiLight);

    // 1. Source plafonnier principale alignée caméra
    this.keyLight = new THREE.DirectionalLight(0xfff5e8, 2.05);
    this.keyLight.position.set(-0.9, 2.8, 2.4);
    if (!isSoftwareGl) {
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(1024, 1024);
      this.keyLight.shadow.camera.near = 0.2;
      this.keyLight.shadow.camera.far = 8.0;
      this.keyLight.shadow.camera.left = -1.6;
      this.keyLight.shadow.camera.right = 1.6;
      this.keyLight.shadow.camera.top = 1.8;
      this.keyLight.shadow.camera.bottom = -1.8;
      this.keyLight.shadow.bias = -0.0004;
      this.keyLight.shadow.normalBias = 0.012;
    }
    this.scene.add(this.keyLight);

    // 2. Remplissage latéral neutre (rebond mur de la pièce)
    this.fillLight = new THREE.DirectionalLight(0xeef2f6, 0.72);
    this.fillLight.position.set(1.9, 0.7, 1.8);
    this.scene.add(this.fillLight);

    // 3. Rim light discret pour détacher les épaules et biseaux sans halo artificiel
    this.rimLight = new THREE.DirectionalLight(0xf3f5f8, 0.95);
    this.rimLight.position.set(0.6, 1.9, -2.2);
    this.scene.add(this.rimLight);

    // 4. Rebond inférieur neutre (remplace le bleu néon irréaliste)
    this.underFillLight = new THREE.DirectionalLight(0x6b655e, 0.36);
    this.underFillLight.position.set(0.0, -2.0, 1.1);
    this.scene.add(this.underFillLight);

    // 5. Éclat discret du réacteur Arc blanc-cyan sur le chanfrein thoracique
    this.arcPointLight = new THREE.PointLight(0xd4f6ff, 0.95, 1.25);
    this.scene.add(this.arcPointLight);

    // 6. Disque de contact en mode Démo 3D
    this.demoFloorTex = createStudioContactFloorTexture();
    this.demoFloorDisc = new THREE.Mesh(
      new THREE.PlaneGeometry(1.75, 1.75),
      new THREE.MeshBasicMaterial({
        map: this.demoFloorTex,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      })
    );
    this.demoFloorDisc.rotation.x = -Math.PI * 0.5;
    this.demoFloorDisc.position.set(0, -1.02, -1.85);
    this.demoFloorDisc.visible = false;
    this.scene.add(this.demoFloorDisc);
  }

  update(
    videoEl: HTMLVideoElement | null,
    arcWorldPos: THREE.Vector3,
    isMirrored: boolean,
    nowMs: number,
    isDemoMode = false,
    unibeamBoost = 0,
    demoFloorY = -1.02,
    demoFloorZ = -1.85
  ): void {
    this.arcPointLight.position.copy(arcWorldPos);
    this.arcPointLight.intensity = 0.92 + unibeamBoost * 3.8;
    this.arcPointLight.distance = 1.25 + unibeamBoost * 2.0;

    this.demoFloorDisc.visible = isDemoMode;
    if (isDemoMode) {
      this.demoFloorDisc.position.set(arcWorldPos.x, demoFloorY, demoFloorZ);
    }

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
    let sideR = 0, sideG = 0, sideB = 0, sideCount = 0;
    let maxLuma = 0;
    let hotX = 0.5, hotY = 0.22;
    let hotR = 255, hotG = 246, hotB = 234;
    let totalLuma = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        totalLuma += luma;

        if (y < h * 0.40) {
          topR += r;
          topG += g;
          topB += b;
          topCount++;
        } else if (y > h * 0.65) {
          botR += r;
          botG += g;
          botB += b;
          botCount++;
        } else {
          sideR += r;
          sideG += g;
          sideB += b;
          sideCount++;
        }

        if (y < h * 0.55 && luma > maxLuma) {
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
    const invTop = 1 / Math.max(topCount * 255, 1);
    const invBot = 1 / Math.max(botCount * 255, 1);
    const invSide = 1 / Math.max(sideCount * 255, 1);

    this._skyColor.setRGB(topR * invTop, topG * invTop, topB * invTop).lerp(this._white, 0.42);
    this._groundColor.setRGB(botR * invBot, botG * invBot, botB * invBot);
    this._sideColor.setRGB(sideR * invSide, sideG * invSide, sideB * invSide).lerp(this._white, 0.35);

    this.hemiLight.color.lerp(this._skyColor, 0.25);
    this.hemiLight.groundColor.lerp(this._groundColor, 0.25);
    this.hemiLight.intensity = THREE.MathUtils.clamp(0.58 + this.lumaSummary * 0.55, 0.55, 1.05);

    this.fillLight.color.lerp(this._sideColor, 0.25);
    this.fillLight.intensity = THREE.MathUtils.clamp(0.45 + this.lumaSummary * 0.48, 0.42, 0.92);

    const dirX = (hotX - 0.5) * 3.2;
    const dirY = (0.5 - hotY) * 2.2 + 1.1;
    this._targetLightPos.set(dirX, dirY, 2.5);
    this.keyLight.position.lerp(this._targetLightPos, 0.22);

    this._targetLightColor.setRGB(hotR / 255, hotG / 255, hotB / 255).lerp(this._white, 0.62);
    this.keyLight.color.lerp(this._targetLightColor, 0.22);
    this.keyLight.intensity = THREE.MathUtils.clamp(1.45 + this.lumaSummary * 0.95, 1.4, 2.35);
  }

  dispose(): void {
    this.currentEnvRT.dispose();
    this.pmrem.dispose();
    this.demoFloorTex.dispose();
    this.demoFloorDisc.geometry.dispose();
    (this.demoFloorDisc.material as THREE.Material).dispose();
  }
}
