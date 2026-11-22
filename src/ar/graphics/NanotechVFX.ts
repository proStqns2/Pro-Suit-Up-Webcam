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
  grad.addColorStop(0.22, 'rgba(130, 245, 255, 0.92)');
  grad.addColorStop(0.55, 'rgba(30, 185, 255, 0.35)');
  grad.addColorStop(1.0, 'rgba(0, 80, 160, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createHexParticleTexture(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;

  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 6;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(140, 252, 255, 0.85)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface RepulsorFX {
  sprite: THREE.Sprite;
  beam: THREE.Mesh;
}

export class NanotechVFX {
  private scene: THREE.Scene;
  private glowTex: THREE.CanvasTexture;
  private hexTex: THREE.CanvasTexture;

  private arcSprite: THREE.Sprite;
  private repulsorSprites: { left: RepulsorFX; right: RepulsorFX };
  private blastPulses = { left: 0, right: 0 };

  private nanoCount = 160;
  private nanoPositions: Float32Array;
  private nanoVelocities: Float32Array;
  private nanoLives: Float32Array;
  private nanoPoints: THREE.Points;

  private sparkCount = 90;
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
    this.hexTex = createHexParticleTexture();

    this.arcSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTex,
        color: 0x6ef6ff,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(this.arcSprite);

    this.repulsorSprites = {
      left: this._makeRepulsorFX(),
      right: this._makeRepulsorFX(),
    };

    this.nanoPositions = new Float32Array(this.nanoCount * 3);
    this.nanoVelocities = new Float32Array(this.nanoCount * 3);
    this.nanoLives = new Float32Array(this.nanoCount);

    const nanoGeo = new THREE.BufferGeometry();
    nanoGeo.setAttribute('position', new THREE.BufferAttribute(this.nanoPositions, 3));
    this.nanoPoints = new THREE.Points(
      nanoGeo,
      new THREE.PointsMaterial({
        map: this.hexTex,
        color: 0x4bf4ff,
        size: 0.042,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.nanoPoints.frustumCulled = false;
    this.scene.add(this.nanoPoints);

    this.sparkPos = new Float32Array(this.sparkCount * 3);
    this.sparkVel = new Float32Array(this.sparkCount * 3);
    this.sparkLife = new Float32Array(this.sparkCount);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkPoints = new THREE.Points(
      sparkGeo,
      new THREE.PointsMaterial({
        map: this.glowTex,
        color: 0x9ef9ff,
        size: 0.055,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);

    this.segUniforms = {
      uMask: { value: null },
      uHasMask: { value: 0.0 },
      uTime: { value: 0.0 },
      uIntensity: { value: 0.0 },
      uMirrored: { value: 1.0 },
      uTexel: { value: new THREE.Vector2(1 / 256, 1 / 144) },
      uColor: { value: new THREE.Color(0x38f2ff) },
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

          float edge = clamp((abs(l - r) + abs(u - d)) * 2.8, 0.0, 1.0);
          float scan = pow(0.5 + 0.5 * sin(vUv.y * 110.0 - uTime * 14.0), 4.0) * smoothstep(0.4, 0.85, c);
          float alpha = (edge * 0.95 + scan * 0.25) * uIntensity;
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
        color: 0xaafaff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(sprite);

    const beamGeo = new THREE.ConeGeometry(0.08, 1.35, 14, 1, true);
    beamGeo.translate(0, 0.675, 0);
    beamGeo.rotateX(Math.PI * 0.5);
    const beam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({
        color: 0x80f6ff,
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

  update(dt: number, time: number, rig: Mark85ArmorRig, suitProgress: number, isStealth: boolean): void {
    this.segUniforms.uTime.value = time;
    this.segUniforms.uColor.value.setHex(isStealth ? 0x2cf59c : 0x38f2ff);

    const targetSegGlow = suitProgress < 0.98 ? Math.sin(suitProgress * Math.PI) * 0.85 : 0.08;
    this.segUniforms.uIntensity.value = THREE.MathUtils.lerp(this.segUniforms.uIntensity.value, targetSegGlow, 0.15);

    if (!rig.root.visible) {
      this.arcSprite.visible = false;
      this.repulsorSprites.left.sprite.visible = false;
      this.repulsorSprites.right.sprite.visible = false;
      return;
    }

    const arcScale = rig.mats.sharedUniforms.uBodyScale.value * 0.42;
    this.arcSprite.visible = suitProgress > 0.06;
    this.arcSprite.position.copy(rig.arcWorldPos);
    const arcPulse = 1.0 + 0.06 * Math.sin(time * 9.0);
    this.arcSprite.scale.setScalar(arcScale * arcPulse);
    this.arcSprite.material.opacity = Math.min(suitProgress * 1.4, 0.72) * (isStealth ? 0.35 : 0.85);

    const spawning = suitProgress > 0.02 && suitProgress < 0.97;
    const bodyScale = rig.mats.sharedUniforms.uBodyScale.value;

    for (let i = 0; i < this.nanoCount; i++) {
      if (this.nanoLives[i] <= 0) {
        if (spawning && Math.random() < 0.45) {
          const branch = i % 5;
          const anchor =
            branch === 0
              ? rig.headWorldPos
              : branch === 1
                ? rig.shoulderWorldPos.left
                : branch === 2
                  ? rig.shoulderWorldPos.right
                  : branch === 3
                    ? rig.palmWorldPos.left
                    : rig.palmWorldPos.right;

          const swarmT = THREE.MathUtils.clamp(suitProgress * 1.15 - Math.random() * 0.25, 0, 1);
          const ox = THREE.MathUtils.lerp(rig.arcWorldPos.x, anchor.x, swarmT);
          const oy = THREE.MathUtils.lerp(rig.arcWorldPos.y, anchor.y, swarmT);
          const oz = THREE.MathUtils.lerp(rig.arcWorldPos.z, anchor.z, swarmT);

          const jitter = bodyScale * 0.16;
          this.nanoPositions[i * 3] = ox + (Math.random() - 0.5) * jitter;
          this.nanoPositions[i * 3 + 1] = oy + (Math.random() - 0.5) * jitter;
          this.nanoPositions[i * 3 + 2] = oz + (Math.random() - 0.5) * jitter;

          this.nanoVelocities[i * 3] = (anchor.x - ox) * 1.4 + (Math.random() - 0.5) * 0.22;
          this.nanoVelocities[i * 3 + 1] = (anchor.y - oy) * 1.4 + (Math.random() - 0.5) * 0.22;
          this.nanoVelocities[i * 3 + 2] = (anchor.z - oz) * 1.4 + (Math.random() - 0.5) * 0.18;
          this.nanoLives[i] = 0.28 + Math.random() * 0.28;
        } else {
          this.nanoPositions[i * 3 + 2] = 999;
        }
      } else {
        this.nanoLives[i] -= dt;
        this.nanoPositions[i * 3] += this.nanoVelocities[i * 3] * dt;
        this.nanoPositions[i * 3 + 1] += this.nanoVelocities[i * 3 + 1] * dt;
        this.nanoPositions[i * 3 + 2] += this.nanoVelocities[i * 3 + 2] * dt;
      }
    }
    (this.nanoPoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    for (const side of ['left', 'right'] as const) {
      const fx = this.repulsorSprites[side];
      const charge = rig.repulsorCharge[side];
      this.blastPulses[side] = Math.max(0, this.blastPulses[side] - dt * 2.6);
      const blast = this.blastPulses[side];
      const energy = Math.min(1.4, charge + blast * 1.2);

      if (energy > 0.04 && suitProgress > 0.6) {
        fx.sprite.visible = true;
        fx.sprite.position.copy(rig.palmWorldPos[side]);
        const s = bodyScale * (0.38 + energy * 0.48) * (1.0 + 0.1 * Math.sin(time * 28.0));
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

        if (Math.random() < 0.75) {
          this._spawnSpark(rig.palmWorldPos[side], rig.palmWorldNormal[side], blast > 0.2 ? 2.2 : 0.7);
        }
      } else {
        fx.sprite.visible = false;
        fx.beam.visible = false;
      }
    }

    for (let i = 0; i < this.sparkCount; i++) {
      if (this.sparkLife[i] > 0) {
        this.sparkLife[i] -= dt;
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
        this.sparkPos[i * 3] = origin.x + (Math.random() - 0.5) * 0.03;
        this.sparkPos[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.03;
        this.sparkPos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.03;
        this.sparkVel[i * 3] = normal.x * speed + (Math.random() - 0.5) * 0.5;
        this.sparkVel[i * 3 + 1] = normal.y * speed + (Math.random() - 0.5) * 0.5;
        this.sparkVel[i * 3 + 2] = normal.z * speed + (Math.random() - 0.5) * 0.5;
        this.sparkLife[i] = 0.2 + Math.random() * 0.25;
        break;
      }
    }
  }

  dispose(): void {
    this.glowTex.dispose();
    this.hexTex.dispose();
    this.segTexture?.dispose();
    this.nanoPoints.geometry.dispose();
    (this.nanoPoints.material as THREE.Material).dispose();
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
