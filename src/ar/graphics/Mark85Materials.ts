import * as THREE from 'three';

function createArmorSurfaceMaps(maxAnisotropy: number) {
  const size = 1024;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  // Subtle neutral white-grey mottled metal base for albedo tint modulation
  aCtx.fillStyle = '#efefef';
  aCtx.fillRect(0, 0, size, size);

  // Mid-low brushed satin roughness base (0.24 - 0.34 effective after roughness scalar)
  rCtx.fillStyle = '#5e5e5e';
  rCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  // Subtle metallic cloudy variation / weathered alloy patina (Sketchfab Mark 85 crimson/gold look)
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const rad = 22 + Math.random() * 88;
    const dark = Math.random() > 0.45;
    const aGrad = aCtx.createRadialGradient(x, y, 2, x, y, rad);
    aGrad.addColorStop(0, dark ? 'rgba(185,185,185,0.08)' : 'rgba(255,255,255,0.07)');
    aGrad.addColorStop(1, 'rgba(240,240,240,0)');
    aCtx.fillStyle = aGrad;
    aCtx.beginPath();
    aCtx.arc(x, y, rad, 0, Math.PI * 2);
    aCtx.fill();

    const rGrad = rCtx.createRadialGradient(x, y, 2, x, y, rad);
    rGrad.addColorStop(0, dark ? 'rgba(145,145,145,0.12)' : 'rgba(70,70,70,0.10)');
    rGrad.addColorStop(1, 'rgba(100,100,100,0)');
    rCtx.fillStyle = rGrad;
    rCtx.beginPath();
    rCtx.arc(x, y, rad, 0, Math.PI * 2);
    rCtx.fill();
  }

  // Fine directional anisotropic brushed metal streaks
  for (let i = 0; i < 9500; i++) {
    const y = Math.random() * size;
    const x = Math.random() * size;
    const len = 36 + Math.random() * 140;
    const rv = (76 + Math.random() * 68) | 0;
    rCtx.strokeStyle = `rgba(${rv},${rv},${rv},0.14)`;
    rCtx.lineWidth = 0.8;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x, y + len);
    rCtx.stroke();

    const bv = (116 + Math.random() * 28) | 0;
    bCtx.strokeStyle = `rgba(${bv},${bv},${bv},0.12)`;
    bCtx.lineWidth = 0.75;
    bCtx.beginPath();
    bCtx.moveTo(x, y);
    bCtx.lineTo(x, y + len);
    bCtx.stroke();

    if ((i & 3) === 0) {
      const av = (210 + Math.random() * 45) | 0;
      aCtx.strokeStyle = `rgba(${av},${av},${av},0.07)`;
      aCtx.lineWidth = 0.7;
      aCtx.beginPath();
      aCtx.moveTo(x, y);
      aCtx.lineTo(x, y + len * 0.7);
      aCtx.stroke();
    }
  }

  // Crisp machined micro-scratches & edge wear scuffs
  for (let i = 0; i < 190; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const angle = Math.random() * Math.PI * 2;
    const len = 8 + Math.random() * 32;
    aCtx.strokeStyle = 'rgba(255,255,255,0.12)';
    aCtx.lineWidth = 0.65;
    aCtx.beginPath();
    aCtx.moveTo(x, y);
    aCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    aCtx.stroke();

    rCtx.strokeStyle = 'rgba(215,215,215,0.18)';
    rCtx.lineWidth = 0.85;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    rCtx.stroke();
  }

  const albedoModMap = new THREE.CanvasTexture(albedoCanvas);
  albedoModMap.wrapS = albedoModMap.wrapT = THREE.RepeatWrapping;
  albedoModMap.repeat.set(2, 2);
  albedoModMap.colorSpace = THREE.SRGBColorSpace;
  albedoModMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2, 2);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(2, 2);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.anisotropy = maxAnisotropy;

  return { albedoModMap, roughnessMap, bumpMap };
}

function createCarbonHexMeshMap(maxAnisotropy: number) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#12151c';
  ctx.fillRect(0, 0, size, size);

  const cell = 12;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const alt = ((x + y) / cell) % 2 === 0;
      ctx.fillStyle = alt ? '#232934' : '#161b23';
      ctx.fillRect(x, y, cell - 1, cell - 1);
      ctx.fillStyle = alt ? '#2e3645' : '#1b2029';
      ctx.fillRect(x + 1, y + 1, cell - 4, 3);
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(6, 6);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;
  return map;
}

export interface Mark85MaterialLibrary {
  sharedUniforms: {
    uSuitProgress: { value: number };
    uArcOrigin: { value: THREE.Vector3 };
    uBodyScale: { value: number };
    uTime: { value: number };
    uStealthMix: { value: number };
    uNanoColor: { value: THREE.Color };
  };
  crimson: THREE.MeshPhysicalMaterial;
  crimsonDark: THREE.MeshPhysicalMaterial;
  crimsonInner: THREE.MeshPhysicalMaterial;
  gold: THREE.MeshPhysicalMaterial;
  titanium: THREE.MeshPhysicalMaterial;
  chrome: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshPhysicalMaterial;
  gunmetal: THREE.MeshPhysicalMaterial;
  bellows: THREE.MeshStandardMaterial;
  carbon: THREE.MeshStandardMaterial;
  cableBlue: THREE.MeshPhysicalMaterial;
  cableAzure: THREE.MeshPhysicalMaterial;
  cableRed: THREE.MeshPhysicalMaterial;
  emissiveCyan: THREE.MeshStandardMaterial;
  diodeBlue: THREE.MeshStandardMaterial;
  pulseGlow: THREE.MeshBasicMaterial;
  depthOccluder: THREE.MeshBasicMaterial;
  dispose: () => void;
}

export function createMark85Materials(maxAnisotropy = 4): Mark85MaterialLibrary {
  const { albedoModMap, roughnessMap, bumpMap } = createArmorSurfaceMaps(maxAnisotropy);
  const carbonMap = createCarbonHexMeshMap(maxAnisotropy);

  const sharedUniforms = {
    uSuitProgress: { value: 0.0 },
    uArcOrigin: { value: new THREE.Vector3(0, 0, -1.6) },
    uBodyScale: { value: 0.42 },
    uTime: { value: 0.0 },
    uStealthMix: { value: 0.0 },
    uNanoColor: { value: new THREE.Color(0x38f2ff) },
  };

  const applyNanotechShader = <T extends THREE.Material>(
    material: T,
    allowStealth = true,
    usePanelSeams = true
  ): T => {
    material.customProgramCacheKey = () =>
      `mk85-sketchfab-${allowStealth ? 's' : 'n'}-${usePanelSeams ? 'p' : 'f'}-v5`;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSuitProgress = sharedUniforms.uSuitProgress;
      shader.uniforms.uArcOrigin = sharedUniforms.uArcOrigin;
      shader.uniforms.uBodyScale = sharedUniforms.uBodyScale;
      shader.uniforms.uTime = sharedUniforms.uTime;
      shader.uniforms.uStealthMix = sharedUniforms.uStealthMix;
      shader.uniforms.uNanoColor = sharedUniforms.uNanoColor;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vNanoWorldPos;
           varying vec2 vArmorUv;`
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
           vNanoWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vArmorUv = uv;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uSuitProgress;
           uniform vec3 uArcOrigin;
           uniform float uBodyScale;
           uniform float uTime;
           uniform float uStealthMix;
           uniform vec3 uNanoColor;
           varying vec3 vNanoWorldPos;
           varying vec2 vArmorUv;

           float hexDist(vec2 p) {
             p = abs(p);
             float c = dot(p, normalize(vec2(1.0, 1.7320508)));
             return max(c, p.x);
           }

           float hexGridVal(vec2 uv) {
             vec2 r = vec2(1.0, 1.7320508);
             vec2 h = r * 0.5;
             vec2 a = mod(uv, r) - h;
             vec2 b = mod(uv - h, r) - h;
             vec2 gv = dot(a, a) < dot(b, b) ? a : b;
             return hexDist(gv);
           }

           float hexPattern3D(vec3 p) {
             float hxy = hexGridVal(p.xy);
             float hyz = hexGridVal(p.yz);
             return mix(hxy, hyz, 0.38);
           }

           float nanoHash(vec3 p) {
             p = fract(p * 0.3183099 + 0.1);
             p *= 17.0;
             return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
           }

           float nanoGranule3D(vec3 p) {
             vec3 i = floor(p);
             vec3 f = fract(p);
             f = f * f * (3.0 - 2.0 * f);
             return mix(
               mix(mix(nanoHash(i + vec3(0,0,0)), nanoHash(i + vec3(1,0,0)), f.x),
                   mix(nanoHash(i + vec3(0,1,0)), nanoHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(nanoHash(i + vec3(0,0,1)), nanoHash(i + vec3(1,0,1)), f.x),
                   mix(nanoHash(i + vec3(0,1,1)), nanoHash(i + vec3(1,1,1)), f.x), f.y),
               f.z
             );
           }`
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
           float invBody = 1.0 / max(uBodyScale, 0.14);
           float nanoDist = length((vNanoWorldPos - uArcOrigin) * vec3(1.0, 0.72, 1.15)) * invBody;
           float nanoHex = hexPattern3D(vNanoWorldPos / max(uBodyScale * 0.030, 0.006));
           float nanoCluster = nanoGranule3D(vNanoWorldPos / max(uBodyScale * 0.018, 0.004));
           float nanoWave = mix(-0.18, 3.1, uSuitProgress);
           float nanoDelta = nanoDist + nanoHex * 0.08 + nanoCluster * 0.085 - nanoWave;
           if (uSuitProgress < 0.996 && nanoDelta > 0.05) {
             discard;
           }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           ${
             usePanelSeams
               ? `// Machined cavity seams along UV borders & micro patina variation
                  float seamU = smoothstep(0.0, 0.022, min(fract(vArmorUv.x * 2.0), 1.0 - fract(vArmorUv.x * 2.0)));
                  float seamV = smoothstep(0.0, 0.022, min(fract(vArmorUv.y * 3.0), 1.0 - fract(vArmorUv.y * 3.0)));
                  float seamMask = 0.68 + 0.32 * (seamU * seamV);
                  diffuseColor.rgb *= seamMask;`
               : ''
           }
           float nanoCrustMix = 0.0;
           if (uSuitProgress < 0.996 && nanoDelta > -0.24) {
             nanoCrustMix = 1.0 - smoothstep(-0.24, -0.02, nanoDelta);
             float flake = nanoGranule3D(vNanoWorldPos / max(uBodyScale * 0.008, 0.002));
             vec3 rawNanoMetal = mix(vec3(0.16, 0.19, 0.24), vec3(0.55, 0.64, 0.76), flake);
             diffuseColor.rgb = mix(diffuseColor.rgb, rawNanoMetal, nanoCrustMix * 0.94);
           }
           ${
             allowStealth
               ? `float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                  vec3 stealthBase = vec3(0.065, 0.078, 0.095) * (0.65 + luma * 0.7);
                  diffuseColor.rgb = mix(diffuseColor.rgb, stealthBase, uStealthMix * 0.90);`
               : ''
           }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           if (uSuitProgress < 0.996 && nanoCrustMix > 0.01) {
             roughnessFactor = mix(roughnessFactor, 0.64, nanoCrustMix * 0.88);
           }
           ${
             allowStealth
               ? `roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor + 0.30, 0.0, 0.92), uStealthMix);`
               : ''
           }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           if (uSuitProgress < 0.996 && nanoDelta > -0.09) {
             float band = 1.0 - smoothstep(-0.09, 0.05, nanoDelta);
             float hexBorder = smoothstep(0.32, 0.46, nanoHex);
             float flicker = 0.78 + 0.22 * sin(uTime * 24.0 + nanoDist * 16.0);
             totalEmissiveRadiance += uNanoColor * (band * 1.3 + hexBorder * band * 3.6) * flicker;
           }`
        );
    };
    return material;
  };

  // Rich weathered cherry-crimson anodized titanium (exact Sketchfab Mark 85 metallic look)
  const crimson = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x821118),
      map: albedoModMap,
      metalness: 0.82,
      roughness: 0.28,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0028,
      anisotropy: 0.65,
      clearcoat: 0.42,
      clearcoatRoughness: 0.18,
      ior: 1.54,
      envMapIntensity: 1.25,
      side: THREE.DoubleSide,
    }),
    true,
    true
  );

  const crimsonDark = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x4a090e),
      map: albedoModMap,
      metalness: 0.82,
      roughness: 0.35,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0024,
      clearcoat: 0.28,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.05,
      side: THREE.DoubleSide,
    }),
    true,
    true
  );

  const crimsonInner = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x320508),
      metalness: 0.65,
      roughness: 0.48,
      envMapIntensity: 0.85,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  // Satin brushed antique champagne gold-titanium alloy (Sketchfab Mark 85 faceplate & arms/thighs)
  const gold = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xb98d44),
      map: albedoModMap,
      metalness: 0.90,
      roughness: 0.25,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0024,
      anisotropy: 0.85,
      clearcoat: 0.22,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.28,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const titanium = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x9aa2ad),
      map: albedoModMap,
      metalness: 0.92,
      roughness: 0.26,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0022,
      anisotropy: 0.72,
      clearcoat: 0.20,
      envMapIntensity: 1.25,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const chrome = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xd2dae4),
      metalness: 0.96,
      roughness: 0.14,
      clearcoat: 0.22,
      envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const brass = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xb68635),
      metalness: 0.92,
      roughness: 0.24,
      anisotropy: 0.6,
      clearcoat: 0.2,
      envMapIntensity: 1.2,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const gunmetal = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x282d36),
      map: albedoModMap,
      metalness: 0.84,
      roughness: 0.40,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0022,
      envMapIntensity: 1.0,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const bellows = applyNanotechShader(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x161920),
      metalness: 0.28,
      roughness: 0.64,
      envMapIntensity: 0.7,
    }),
    false,
    false
  );

  const carbon = applyNanotechShader(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x181c24),
      map: carbonMap,
      metalness: 0.38,
      roughness: 0.58,
      bumpMap: carbonMap,
      bumpScale: 0.004,
      envMapIntensity: 0.8,
    }),
    false,
    false
  );

  const cableBlue = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x26549a),
      metalness: 0.22,
      roughness: 0.4,
      clearcoat: 0.2,
    }),
    false,
    false
  );

  const cableAzure = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x3684d4),
      metalness: 0.22,
      roughness: 0.35,
      clearcoat: 0.25,
    }),
    false,
    false
  );

  const cableRed = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x9a1c22),
      metalness: 0.2,
      roughness: 0.44,
      clearcoat: 0.18,
    }),
    false,
    false
  );

  const emissiveCyan = applyNanotechShader(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      emissive: new THREE.Color(0x96faff),
      emissiveIntensity: 3.8,
      roughness: 0.08,
      metalness: 0.05,
    }),
    false,
    false
  );

  const diodeBlue = applyNanotechShader(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x78c8ff),
      emissive: new THREE.Color(0x1e88ff),
      emissiveIntensity: 1.5,
      roughness: 0.22,
      metalness: 0.3,
    }),
    false,
    false
  );

  const pulseGlow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x9ef7ff),
  });

  const depthOccluder = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

  return {
    sharedUniforms,
    crimson,
    crimsonDark,
    crimsonInner,
    gold,
    titanium,
    chrome,
    brass,
    gunmetal,
    bellows,
    carbon,
    cableBlue,
    cableAzure,
    cableRed,
    emissiveCyan,
    diodeBlue,
    pulseGlow,
    depthOccluder,
    dispose() {
      albedoModMap.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
      carbonMap.dispose();
      crimson.dispose();
      crimsonDark.dispose();
      crimsonInner.dispose();
      gold.dispose();
      titanium.dispose();
      chrome.dispose();
      brass.dispose();
      gunmetal.dispose();
      bellows.dispose();
      carbon.dispose();
      cableBlue.dispose();
      cableAzure.dispose();
      cableRed.dispose();
      emissiveCyan.dispose();
      diodeBlue.dispose();
      pulseGlow.dispose();
      depthOccluder.dispose();
    },
  };
}
