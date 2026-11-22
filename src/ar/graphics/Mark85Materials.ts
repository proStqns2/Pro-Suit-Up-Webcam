import * as THREE from 'three';

function createBrushedMetalMaps(maxAnisotropy: number) {
  const size = 256;
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  rCtx.fillStyle = '#888888';
  rCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 1600; i++) {
    const y = Math.random() * size;
    const x = Math.random() * size;
    const len = 18 + Math.random() * 90;
    const v = (105 + Math.random() * 65) | 0;
    rCtx.strokeStyle = `rgba(${v},${v},${v},0.22)`;
    rCtx.lineWidth = 0.8;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x + len, y);
    rCtx.stroke();

    const bv = (110 + Math.random() * 45) | 0;
    bCtx.strokeStyle = `rgba(${bv},${bv},${bv},0.25)`;
    bCtx.beginPath();
    bCtx.moveTo(x, y);
    bCtx.lineTo(x + len, y);
    bCtx.stroke();
  }

  for (let i = 0; i < 65; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const angle = (Math.random() - 0.5) * 0.9;
    const len = 6 + Math.random() * 24;
    rCtx.strokeStyle = 'rgba(225,225,225,0.28)';
    rCtx.lineWidth = 0.7;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    rCtx.stroke();
  }

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(3, 3);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(3, 3);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.anisotropy = maxAnisotropy;

  return { roughnessMap, bumpMap };
}

function createCarbonFiberMap(maxAnisotropy: number) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#12151a';
  ctx.fillRect(0, 0, size, size);

  const cell = 8;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const alt = ((x + y) / cell) % 2 === 0;
      ctx.fillStyle = alt ? '#232833' : '#161a21';
      ctx.fillRect(x, y, cell - 1, cell - 1);
      ctx.fillStyle = alt ? '#2d3442' : '#1b2029';
      ctx.fillRect(x + 1, y + 1, cell - 3, 2);
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(8, 8);
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
  gold: THREE.MeshPhysicalMaterial;
  titanium: THREE.MeshPhysicalMaterial;
  carbon: THREE.MeshStandardMaterial;
  emissiveCyan: THREE.MeshStandardMaterial;
  depthOccluder: THREE.MeshBasicMaterial;
  dispose: () => void;
}

export function createMark85Materials(maxAnisotropy = 4): Mark85MaterialLibrary {
  const { roughnessMap, bumpMap } = createBrushedMetalMaps(maxAnisotropy);
  const carbonMap = createCarbonFiberMap(maxAnisotropy);

  const sharedUniforms = {
    uSuitProgress: { value: 0.0 },
    uArcOrigin: { value: new THREE.Vector3(0, 0, -1.6) },
    uBodyScale: { value: 0.4 },
    uTime: { value: 0.0 },
    uStealthMix: { value: 0.0 },
    uNanoColor: { value: new THREE.Color(0x38f2ff) },
  };

  const applyNanotechShader = <T extends THREE.Material>(material: T, allowStealth = true): T => {
    material.customProgramCacheKey = () => (allowStealth ? 'mk85-nano-stealth' : 'mk85-nano');
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
           varying vec3 vNanoWorldPos;`
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
           vNanoWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
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
           }`
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
           float nanoDist = length((vNanoWorldPos - uArcOrigin) * vec3(1.0, 0.72, 1.15)) / max(uBodyScale, 0.14);
           float nanoHex = hexPattern3D(vNanoWorldPos / max(uBodyScale * 0.042, 0.008));
           float nanoWave = mix(-0.18, 2.45, uSuitProgress);
           float nanoDelta = nanoDist + nanoHex * 0.10 - nanoWave;
           if (uSuitProgress < 0.996 && nanoDelta > 0.055) {
             discard;
           }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
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
           ${
             allowStealth
               ? `roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor + 0.30, 0.0, 0.92), uStealthMix);`
               : ''
           }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           if (uSuitProgress < 0.996 && nanoDelta > -0.11) {
             float band = 1.0 - smoothstep(-0.11, 0.055, nanoDelta);
             float hexBorder = smoothstep(0.32, 0.48, nanoHex);
             float flicker = 0.78 + 0.22 * sin(uTime * 22.0 + nanoDist * 14.0);
             totalEmissiveRadiance += uNanoColor * (band * 1.8 + hexBorder * band * 4.2) * flicker;
           }`
        );
    };
    return material;
  };

  const crimson = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x9b1118),
      metalness: 0.88,
      roughness: 0.24,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0025,
      anisotropy: 0.65,
      clearcoat: 0.48,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.45,
      side: THREE.DoubleSide,
    })
  );

  const gold = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xd2ad68),
      metalness: 0.92,
      roughness: 0.2,
      roughnessMap,
      bumpMap,
      bumpScale: 0.002,
      anisotropy: 0.75,
      clearcoat: 0.36,
      clearcoatRoughness: 0.14,
      envMapIntensity: 1.55,
      side: THREE.DoubleSide,
    })
  );

  const titanium = applyNanotechShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x7c8591),
      metalness: 0.88,
      roughness: 0.28,
      roughnessMap,
      bumpMap,
      bumpScale: 0.002,
      anisotropy: 0.6,
      envMapIntensity: 1.35,
    })
  );

  const carbon = applyNanotechShader(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x20242c),
      map: carbonMap,
      metalness: 0.45,
      roughness: 0.52,
      bumpMap: carbonMap,
      bumpScale: 0.004,
      envMapIntensity: 0.9,
    }),
    false
  );

  const emissiveCyan = applyNanotechShader(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xb8fcff),
      emissive: new THREE.Color(0x28e4ff),
      emissiveIntensity: 3.0,
      roughness: 0.15,
      metalness: 0.1,
    }),
    false
  );

  const depthOccluder = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

  return {
    sharedUniforms,
    crimson,
    gold,
    titanium,
    carbon,
    emissiveCyan,
    depthOccluder,
    dispose() {
      roughnessMap.dispose();
      bumpMap.dispose();
      carbonMap.dispose();
      crimson.dispose();
      gold.dispose();
      titanium.dispose();
      carbon.dispose();
      emissiveCyan.dispose();
      depthOccluder.dispose();
    },
  };
}
