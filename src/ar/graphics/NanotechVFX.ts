import * as THREE from 'three';
import type { TrackingEngine } from '../vision/TrackingEngine';
import type { Mark85ArmorRig } from './Mark85ArmorRig';

function createGlowSpriteTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.24, 'rgba(185, 245, 255, 0.88)');
  grad.addColorStop(0.58, 'rgba(60, 195, 255, 0.30)');
  grad.addColorStop(1.0, 'rgba(0, 80, 160, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSparkSpriteTexture(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.28, 'rgba(255, 214, 120, 0.95)');
  grad.addColorStop(0.65, 'rgba(255, 132, 32, 0.42)');
  grad.addColorStop(1.0, 'rgba(255, 90, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface RepulsorFX {
  sprite: THREE.Sprite;
  beam: THREE.Mesh;
}

/**
 * VFX Mécatronique Mark 42 / Mark 85 :
 * - Aucune particule ou grille hologramme nanotech.
 * - Étincelles d'impact métal chaud (ambre/or) aux points d'arrimage mécanique pendant le Suit-Up.
 * - Balayage biométrique discret uniquement pendant le scan corporel actif [C].
 * - Faisceau & noyau répulseur palmaire réaliste.
 */
export class NanotechVFX {
  private scene: THREE.Scene;
  private glowTex: THREE.CanvasTexture;
  private sparkTex: THREE.CanvasTexture;

  private arcSprite: THREE.Sprite;
  private repulsorSprites: { left: RepulsorFX; right: RepulsorFX };
  private blastPulses = { left: 0, right: 0 };

  private sparkCount = 120;
  private sparkPos: Float32Array;
  private sparkVel: Float32Array;
  private sparkLife: Float32Array;
  private sparkPoints: THREE.Points;

  private segTexture: THREE.DataTexture | null = null;
  private segUniforms: {
    uMask: { value: THREE.DataTexture | null };
    uHasMask: { value: number };
    uTime: { value: number };
    uIntensity: { value: number };
    uMirrored: { value: number };
    uTexel: { value: THREE.Vector2 };
    uColor: { value: THREE.Color };
  };
  private segQuad: THREE.Mesh;

  private readonly _targetPt = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.glowTex = createGlowSpriteTexture();
    this.sparkTex = createSparkSpriteTexture();

    this.arcSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color: 0xbef9ff,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(this.arcSprite);

    this.repulsorSprites = {
      left: this._makeRepulsorFX(),
      right: this._makeRepulsorFX(),
    };

    // Étincelles mécaniques ambre/or (verrouillage plaques Mark 42 + répulseur)
    this.sparkPos = new Float32Array(this.sparkCount * 3);
    this.sparkVel = new Float32Array(this.sparkCount * 3);
    this.sparkLife = new Float32Array(this.sparkCount);
    this.sparkPos.fill(999);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkPoints = new THREE.Points(
      sparkGeo,
      new THREE.PointsMaterial({
        map: this.sparkTex,
        color: 0xffd07a,
        size: 0.048,
        transparent: true,
        opacity: 0.96,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);

    // Calibre biométrique neutre actif uniquement pendant l'acquisition scan corporel 360°
    this.segUniforms = {
      uMask: { value: null },
      uHasMask: { value: 0.0 },
      uTime: { value: 0.0 },
      uIntensity: { value: 0.0 },
      uMirrored: { value: 1.0 },
      uTexel: { value: new THREE.Vector2(1 / 256, 1 / 144) },
      uColor: { value: new THREE.Color(0xd8e8f8) },
    };

    const segMat = new THREE.ShaderMaterial({
      uniforms: this.segUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMask;
        uniform float uHasMask;
        uniform float uTime;
        uniform float uIntensity;
        uniform float uMirrored;
        uniform vec2 uTexel;
        uniform vec3 uColor;
        varying vec2 vUv;

        void main() {
          if (uHasMask < 0.5 || uIntensity <= 0.005) discard;
          vec2 uv = vUv;
          if (uMirrored > 0.5) uv.x = 1.0 - uv.x;

          float c = texture2D(uMask, uv).r;
          float l = texture2D(uMask, uv - vec2(uTexel.x, 0.0)).r;
          float r = texture2D(uMask, uv + vec2(uTexel.x, 0.0)).r;
          float u = texture2D(uMask, uv + vec2(0.0, uTexel.y)).r;
          float d = texture2D(uMask, uv - vec2(0.0, uTexel.y)).r;

          float edge = clamp((abs(l - r) + abs(u - d)) * 2.2, 0.0, 1.0);
          float bar = exp(-pow(fract(vUv.y - uTime * 0.45) - 0.5, 2.0) * 180.0) * smoothstep(0.45, 0.85, c);
          float alpha = (edge * 0.42 + bar * 0.35) * uIntensity;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });
    this.segQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), segMat);
    this.segQuad.frustumCulled = false;
    this.segQuad.renderOrder = 0;
    this.scene.add(this.segQuad);
  }

  private _makeRepulsorFX(): RepulsorFX {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color: 0xcffbff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(sprite);

    const beamGeo = new THREE.ConeGeometry(0.075, 1.35, 14, 1, true);
    beamGeo.translate(0, 0.675, 0);
    beamGeo.rotateX(Math.PI * 0.5);
    const beam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({
        color: 0xa6f8ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.scene.add(beam);

    return { sprite, beam };
  }

  triggerBlast(side: 'left' | 'right' = 'right'): void {
    this.blastPulses[side] = 1.0;
  }

  updateSegmentationMask(trackingEngine: TrackingEngine, isMirrored: boolean): void {
    this.segUniforms.uMirrored.value = isMirrored ? 1.0 : 0.0;
    if (!trackingEngine.maskUpdated || !trackingEngine.maskBuffer) return;

    const w = trackingEngine.maskWidth;
    const h = trackingEngine.maskHeight;
    if (!this.segTexture || this.segTexture.image.width !== w || this.segTexture.image.height !== h) {
      this.segTexture?.dispose();
      this.segTexture = new THREE.DataTexture(
        trackingEngine.maskBuffer,
        w,
        h,
        THREE.RedFormat,
        THREE.UnsignedByteType
      );
      this.segTexture.minFilter = THREE.LinearFilter;
      this.segTexture.magFilter = THREE.LinearFilter;
      this.segTexture.flipY = true;
      this.segUniforms.uMask.value = this.segTexture;
      this.segUniforms.uTexel.value.set(1 / w, 1 / h);
      this.segUniforms.uHasMask.value = 1.0;
    }
    this.segTexture.needsUpdate = true;
  }

  update(
    dt: number,
    time: number,
    rig: Mark85ArmorRig,
    suitProgress: number,
    isStealth: boolean,
    scanActive = false
  ): void {
    this.segUniforms.uTime.value = time;
    this.segUniforms.uColor.value.setHex(isStealth ? 0x2cf59c : 0xd0e6f8);

    // Pas de contour nanotech cyan : discret balayage uniquement pendant le scan [C]
    const targetSegGlow = scanActive ? 0.42 : 0.0;
    this.segUniforms.uIntensity.value = THREE.MathUtils.lerp(this.segUniforms.uIntensity.value, targetSegGlow, 0.14);

    if (!rig.root.visible) {
      this.arcSprite.visible = false;
      this.repulsorSprites.left.sprite.visible = false;
      this.repulsorSprites.right.sprite.visible = false;
      return;
    }

    const bodyScale = rig.mats.sharedUniforms.uBodyScale.value;
    const arcScale = bodyScale * 0.36;
    // Le réacteur s'allume au verrouillage du bloc pectoral (stage torse >= 0.56)
    this.arcSprite.visible = suitProgress > 0.56;
    this.arcSprite.position.copy(rig.arcWorldPos);
    const arcPulse = 1.0 + 0.04 * Math.sin(time * 8.0);
    this.arcSprite.scale.setScalar(arcScale * arcPulse);
    this.arcSprite.material.opacity =
      THREE.MathUtils.clamp((suitProgress - 0.56) * 3.0, 0, 1) * (isStealth ? 0.25 : 0.62);

    // Étincelles d'impact mécanique Mark 42 sur la partie en cours d'arrimage
    if (suitProgress > 0.08 && suitProgress < 0.98 && Math.random() < 0.55) {
      const lockAnchor = rig.activeClampAnchor;
      this._targetPt.set((Math.random() - 0.5) * 0.4, 0.45, (Math.random() - 0.5) * 0.4);
      this._spawnSpark(lockAnchor, this._targetPt, 0.65);
    }

    for (const side of ['left', 'right'] as const) {
      const fx = this.repulsorSprites[side];
      const charge = rig.repulsorCharge[side];
      this.blastPulses[side] = Math.max(0, this.blastPulses[side] - dt * 2.6);
      const blast = this.blastPulses[side];
      const energy = Math.min(1.4, charge + blast * 1.2);

      if (energy > 0.04 && suitProgress > 0.58) {
        fx.sprite.visible = true;
        fx.sprite.position.copy(rig.palmWorldPos[side]);
        const s = bodyScale * (0.36 + energy * 0.46) * (1.0 + 0.08 * Math.sin(time * 26.0));
        fx.sprite.scale.setScalar(s);
        fx.sprite.material.opacity = Math.min(0.95, energy * 0.85);

        fx.beam.visible = blast > 0.05;
        if (fx.beam.visible) {
          fx.beam.position.copy(rig.palmWorldPos[side]);
          this._targetPt.copy(rig.palmWorldPos[side]).add(rig.palmWorldNormal[side]);
          fx.beam.lookAt(this._targetPt);
          fx.beam.scale.set(0.6 + blast * 1.1, 0.6 + blast * 1.1, 0.5 + blast * 1.2);
          (fx.beam.material as THREE.MeshBasicMaterial).opacity = blast * 0.78;
        }

        if (blast > 0.15 && Math.random() < 0.7) {
          this._spawnSpark(rig.palmWorldPos[side], rig.palmWorldNormal[side], 2.0);
        }
      } else {
        fx.sprite.visible = false;
        fx.beam.visible = false;
      }
    }

    for (let i = 0; i < this.sparkCount; i++) {
      if (this.sparkLife[i] > 0) {
        this.sparkLife[i] -= dt;
        this.sparkVel[i * 3 + 1] -= 2.8 * dt;
        this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
        this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
        this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      } else {
        this.sparkPos[i * 3 + 2] = 999;
      }
    }
    (this.sparkPoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private _spawnSpark(origin: THREE.Vector3, normal: THREE.Vector3, speed: number): void {
    for (let i = 0; i < this.sparkCount; i++) {
      if (this.sparkLife[i] <= 0) {
        this.sparkPos[i * 3] = origin.x + (Math.random() - 0.5) * 0.035;
        this.sparkPos[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.035;
        this.sparkPos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.035;
        this.sparkVel[i * 3] = normal.x * speed + (Math.random() - 0.5) * 0.85;
        this.sparkVel[i * 3 + 1] = normal.y * speed + (Math.random() - 0.5) * 0.85;
        this.sparkVel[i * 3 + 2] = normal.z * speed + (Math.random() - 0.5) * 0.85;
        this.sparkLife[i] = 0.16 + Math.random() * 0.22;
        break;
      }
    }
  }

  dispose(): void {
    this.glowTex.dispose();
    this.sparkTex.dispose();
    this.segTexture?.dispose();
    this.sparkPoints.geometry.dispose();
    (this.sparkPoints.material as THREE.Material).dispose();
    this.segQuad.geometry.dispose();
    (this.segQuad.material as THREE.Material).dispose();
    this.arcSprite.material.dispose();
    for (const side of ['left', 'right'] as const) {
      this.repulsorSprites[side].sprite.material.dispose();
      this.repulsorSprites[side].beam.geometry.dispose();
      (this.repulsorSprites[side].beam.material as THREE.Material).dispose();
    }
  }
}
