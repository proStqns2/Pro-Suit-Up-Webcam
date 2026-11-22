import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const ARCompositeBloomShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tBloom: { value: null as THREE.Texture | null },
    uBloomStrength: { value: 0.62 },
    uExposure: { value: 1.08 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uBloomStrength;
    uniform float uExposure;
    varying vec2 vUv;

    vec3 ACESFilmic(vec3 x) {
      x *= 0.6;
      float a = 2.51;
      float b = 0.03;
      float c = 2.43;
      float d = 0.59;
      float e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    vec3 linearToSrgb(vec3 c) {
      vec3 lo = c * 12.92;
      vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
      return mix(lo, hi, step(vec3(0.0031308), c));
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 bloom = texture2D(tBloom, vUv).rgb * uBloomStrength;

      //HDR linear combine -> ACES Filmic -> sRGB
      vec3 hdr = (base.rgb + bloom) * uExposure;
      vec3 ldr = linearToSrgb(ACESFilmic(hdr));

      // Préservation alpha AR : armure opaque = 1.0, halo bloom sur vidéo = alpha doux sans bord noir
      float bloomEnergy = max(bloom.r, max(bloom.g, bloom.b));
      float haloAlpha = clamp(bloomEnergy * 0.42, 0.0, 0.85);
      float outAlpha = clamp(max(base.a, haloAlpha), 0.0, 1.0);

      // WebGL premultipliedAlpha=true : les pixels d'armure sont déjà multipliés par base.a=1,
      // les pixels de halo additif s'additionnent proprement au flux <video> sous-jacent.
      vec3 outRgb = mix(ldr * outAlpha, ldr, clamp(base.a + clamp(bloomEnergy * 1.4, 0.0, 1.0), 0.0, 1.0));
      gl_FragColor = vec4(outRgb, outAlpha);
    }
  `,
};

export class CinemaPostProcess {
  private renderer: THREE.WebGLRenderer;
  private sceneComposer: EffectComposer;
  private bloomComposer: EffectComposer;
  private compositePass: ShaderPass;
  private bloomPass: UnrealBloomPass;
  private sceneTarget: THREE.WebGLRenderTarget;
  private bloomTarget: THREE.WebGLRenderTarget;
  private quadScene: THREE.Scene;
  private quadCamera: THREE.OrthographicCamera;
  private quadMesh: THREE.Mesh;
  private compositeMaterial: THREE.ShaderMaterial;
  private bloomStrength = 0.62;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer;
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const maxSamples = Math.min(4, renderer.capabilities.maxSamples || 0);
    this.sceneTarget = new THREE.WebGLRenderTarget(Math.round(width * dpr), Math.round(height * dpr), {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples: maxSamples,
    });

    this.bloomTarget = new THREE.WebGLRenderTarget(
      Math.max(Math.round(width * 0.5), 1),
      Math.max(Math.round(height * 0.5), 1),
      {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }
    );

    // Passe 1 : Rendu HDR RGBA + Alpha exact du maillage Mark 85
    this.sceneComposer = new EffectComposer(renderer, this.sceneTarget);
    this.sceneComposer.renderToScreen = false;
    const sceneRenderPass = new RenderPass(scene, camera);
    sceneRenderPass.clearColor = new THREE.Color(0x000000);
    sceneRenderPass.clearAlpha = 0.0;
    this.sceneComposer.addPass(sceneRenderPass);

    // Passe 2 : Extraction sélective HDR UnrealBloomPass (seules les émissions > 0.96 rayonnent)
    this.bloomComposer = new EffectComposer(renderer, this.bloomTarget);
    this.bloomComposer.renderToScreen = false;
    const bloomRenderPass = new RenderPass(scene, camera);
    bloomRenderPass.clearColor = new THREE.Color(0x000000);
    bloomRenderPass.clearAlpha = 1.0;
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(Math.round(width * 0.5), 1), Math.max(Math.round(height * 0.5), 1)),
      this.bloomStrength,
      0.52,
      0.96
    );
    this.bloomComposer.addPass(bloomRenderPass);
    this.bloomComposer.addPass(this.bloomPass);

    // Passe 3 : Composite transparent sur le backbuffer écran via ShaderPass / plein écran
    this.compositePass = new ShaderPass(ARCompositeBloomShader);
    this.compositeMaterial = this.compositePass.material;
    this.compositeMaterial.transparent = false;
    this.compositeMaterial.blending = THREE.NoBlending;
    this.compositeMaterial.depthTest = false;
    this.compositeMaterial.depthWrite = false;

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);
  }

  setBloomStrength(strength: number): void {
    this.bloomStrength = THREE.MathUtils.clamp(strength, 0, 1.4);
    this.bloomPass.strength = this.bloomStrength;
    this.compositeMaterial.uniforms.uBloomStrength.value = this.bloomStrength;
  }

  setSize(width: number, height: number): void {
    if (this.disposed) return;
    const w = Math.max(width, 1);
    const h = Math.max(height, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.sceneComposer.setPixelRatio(dpr);
    this.sceneComposer.setSize(w, h);

    const bw = Math.max(Math.round(w * 0.5), 1);
    const bh = Math.max(Math.round(h * 0.5), 1);
    this.bloomComposer.setPixelRatio(1);
    this.bloomComposer.setSize(bw, bh);
    this.bloomPass.resolution.set(bw, bh);
  }

  render(): void {
    if (this.disposed) return;

    const prevToneMapping = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.sceneComposer.render();
    this.bloomComposer.render();

    this.compositeMaterial.uniforms.tDiffuse.value = this.sceneComposer.readBuffer.texture;
    this.compositeMaterial.uniforms.tBloom.value = this.bloomComposer.readBuffer.texture;
    this.compositeMaterial.uniforms.uBloomStrength.value = this.bloomStrength;

    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.quadScene, this.quadCamera);

    this.renderer.toneMapping = prevToneMapping;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sceneComposer.dispose();
    this.bloomComposer.dispose();
    this.bloomPass.dispose();
    this.compositePass.dispose();
    this.sceneTarget.dispose();
    this.bloomTarget.dispose();
    this.quadMesh.geometry.dispose();
    this.compositeMaterial.dispose();
  }
}
