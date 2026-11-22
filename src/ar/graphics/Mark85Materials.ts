import * as THREE from 'three';
import { DEFAULT_SUIT_PRESETS, type SuitPreset } from '../types/SuitPreset';

function createCadArmorSurfaceMaps(maxAnisotropy: number) {
  const size = 1024;
  const height = new Float32Array(size * size);
  height.fill(0.56);

  // 1. Subtil grain anisotrope aérospatial + micro-stries directionnelles (aucun bruit plastique grossier)
  let seed = 133742;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < 14000; i++) {
    const x = (rand() * size) | 0;
    const y0 = (rand() * size) | 0;
    const len = 28 + ((rand() * 140) | 0);
    const delta = (rand() - 0.48) * 0.045;
    for (let k = 0; k < len; k++) {
      const yy = (y0 + k) & (size - 1);
      height[yy * size + x] += delta;
    }
  }

  // 2. Dessin CAD des panneaux biseautés et rainures d'assemblage sur canvas haute précision
  const seamCanvas = document.createElement('canvas');
  seamCanvas.width = size;
  seamCanvas.height = size;
  const sCtx = seamCanvas.getContext('2d')!;
  sCtx.fillStyle = 'rgb(142,142,142)';
  sCtx.fillRect(0, 0, size, size);

  const drawPanelGroove = (pts: [number, number][], width: number) => {
    // Chanfrein clair autour de la rainure
    sCtx.lineCap = 'round';
    sCtx.lineJoin = 'round';
    sCtx.strokeStyle = 'rgba(182,182,182,0.55)';
    sCtx.lineWidth = width + 6;
    sCtx.beginPath();
    sCtx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sCtx.lineTo(pts[i][0], pts[i][1]);
    sCtx.stroke();

    // Rainure profonde usinée CNC
    sCtx.strokeStyle = 'rgb(28,28,28)';
    sCtx.lineWidth = width;
    sCtx.beginPath();
    sCtx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sCtx.lineTo(pts[i][0], pts[i][1]);
    sCtx.stroke();
  };

  // Lignes de panneaux diagonales & hexagonales style Mark 85 Endgame
  drawPanelGroove(
    [
      [0, 220],
      [260, 220],
      [340, 300],
      [680, 300],
      [760, 220],
      [size, 220],
    ],
    4.5
  );
  drawPanelGroove(
    [
      [0, 740],
      [210, 740],
      [310, 640],
      [710, 640],
      [810, 740],
      [size, 740],
    ],
    4.5
  );
  drawPanelGroove(
    [
      [512, 0],
      [512, 180],
      [440, 252],
      [440, 690],
      [512, 762],
      [512, size],
    ],
    3.5
  );
  drawPanelGroove(
    [
      [180, 0],
      [180, 440],
      [250, 512],
      [180, 584],
      [180, size],
    ],
    3.2
  );
  drawPanelGroove(
    [
      [844, 0],
      [844, 440],
      [774, 512],
      [844, 584],
      [844, size],
    ],
    3.2
  );

  // Micro-boulons / rivets encastrés aux intersections
  const rivets: [number, number][] = [
    [252, 236],
    [772, 236],
    [352, 316],
    [672, 316],
    [322, 624],
    [702, 624],
    [458, 480],
    [566, 480],
  ];
  for (const [rx, ry] of rivets) {
    sCtx.fillStyle = 'rgb(205,205,205)';
    sCtx.beginPath();
    sCtx.arc(rx, ry, 7, 0, Math.PI * 2);
    sCtx.fill();
    sCtx.fillStyle = 'rgb(24,24,24)';
    sCtx.beginPath();
    sCtx.arc(rx, ry, 3.6, 0, Math.PI * 2);
    sCtx.fill();
  }

  const seamPixels = sCtx.getImageData(0, 0, size, size).data;
  for (let i = 0; i < size * size; i++) {
    const seamH = seamPixels[i * 4] / 255;
    height[i] = Math.min(1, Math.max(0, height[i] * 0.35 + seamH * 0.65));
  }

  // 3. Génération des textures Albedo/AO, Roughness et Normal Map tangent-space par filtre de Sobel 3x3
  const albedoData = new Uint8Array(size * size * 4);
  const roughData = new Uint8Array(size * size * 4);
  const normalData = new Uint8Array(size * size * 4);

  const strength = 4.2;
  const idx = (x: number, y: number) => ((y & (size - 1)) * size + (x & (size - 1)));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const h = height[i];

      // Sobel 3x3 pour normales nettes sur les chanfreins
      const tl = height[idx(x - 1, y - 1)];
      const t = height[idx(x, y - 1)];
      const tr = height[idx(x + 1, y - 1)];
      const l = height[idx(x - 1, y)];
      const r = height[idx(x + 1, y)];
      const bl = height[idx(x - 1, y + 1)];
      const b = height[idx(x, y + 1)];
      const br = height[idx(x + 1, y + 1)];

      const dX = tr + 2 * r + br - (tl + 2 * l + bl);
      const dY = bl + 2 * b + br - (tl + 2 * t + tr);

      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const p = i * 4;
      normalData[p] = ((nx * 0.5 + 0.5) * 255) | 0;
      normalData[p + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
      normalData[p + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
      normalData[p + 3] = 255;

      // Occlusion ambiante dans les rainures + éclat métallique subtil sur chanfreins
      const cavity = h < 0.40 ? Math.max(0.28, h / 0.40) : 0.94 + (h - 0.5) * 0.14;
      const alb = Math.min(255, Math.max(60, (cavity * 246) | 0));
      albedoData[p] = alb;
      albedoData[p + 1] = alb;
      albedoData[p + 2] = alb;
      albedoData[p + 3] = 255;

      // Roughness : lisse anodisé sur les plaques (~68/255), satiné sombre dans les creux (~175/255)
      const roughVal = h < 0.40 ? 182 : Math.min(130, Math.max(48, (74 + (0.56 - h) * 180) | 0));
      roughData[p] = roughVal;
      roughData[p + 1] = roughVal;
      roughData[p + 2] = roughVal;
      roughData[p + 3] = 255;
    }
  }

  const makeDataTex = (buf: Uint8Array, colorSpace: THREE.ColorSpace) => {
    const tex = new THREE.DataTexture(buf, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.colorSpace = colorSpace;
    tex.anisotropy = maxAnisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };

  const albedoModMap = makeDataTex(albedoData, THREE.SRGBColorSpace);
  const roughnessMap = makeDataTex(roughData, THREE.NoColorSpace);
  const normalMap = makeDataTex(normalData, THREE.NoColorSpace);

  return { albedoModMap, roughnessMap, normalMap };
}

function createPerforatedHexGrilleMaps(maxAnisotropy: number) {
  const size = 512;
  const colCanvas = document.createElement('canvas');
  colCanvas.width = size;
  colCanvas.height = size;
  const cCtx = colCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  cCtx.fillStyle = '#4e5868';
  cCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#d4d4d4';
  bCtx.fillRect(0, 0, size, size);

  const stepX = 16;
  const stepY = 14;
  for (let row = 0; row * stepY < size + stepY; row++) {
    const offset = (row & 1) * (stepX * 0.5);
    for (let col = -1; col * stepX < size + stepX; col++) {
      const cx = col * stepX + offset;
      const cy = row * stepY;

      cCtx.fillStyle = '#090c11';
      cCtx.beginPath();
      cCtx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      cCtx.fill();

      cCtx.strokeStyle = '#7b8798';
      cCtx.lineWidth = 1.05;
      cCtx.stroke();

      bCtx.fillStyle = '#141414';
      bCtx.beginPath();
      bCtx.arc(cx, cy, 4.8, 0, Math.PI * 2);
      bCtx.fill();
    }
  }

  const map = new THREE.CanvasTexture(colCanvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 3);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(3, 3);
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.anisotropy = maxAnisotropy;

  return { map, bumpMap };
}

function createCarbonHexMeshMap(maxAnisotropy: number) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0f131a';
  ctx.fillRect(0, 0, size, size);

  const cell = 12;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const alt = ((x + y) / cell) % 2 === 0;
      ctx.fillStyle = alt ? '#202836' : '#131822';
      ctx.fillRect(x, y, cell - 1, cell - 1);
      ctx.fillStyle = alt ? '#303b4d' : '#1b212d';
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
    uWearAmount: { value: number };
    uNanoColor: { value: THREE.Color };
  };
  crimson: THREE.MeshPhysicalMaterial;
  crimsonDark: THREE.MeshPhysicalMaterial;
  crimsonInner: THREE.MeshPhysicalMaterial;
  gold: THREE.MeshPhysicalMaterial;
  titanium: THREE.MeshPhysicalMaterial;
  chrome: THREE.MeshPhysicalMaterial;
  perforatedGrille: THREE.MeshPhysicalMaterial;
  brass: THREE.MeshPhysicalMaterial;
  gunmetal: THREE.MeshPhysicalMaterial;
  bellows: THREE.MeshStandardMaterial;
  carbon: THREE.MeshStandardMaterial;
  undersuitGrid: THREE.MeshStandardMaterial;
  cableBlue: THREE.MeshPhysicalMaterial;
  cableAzure: THREE.MeshPhysicalMaterial;
  cableRed: THREE.MeshPhysicalMaterial;
  emissiveCyan: THREE.MeshStandardMaterial;
  diodeBlue: THREE.MeshStandardMaterial;
  pulseGlow: THREE.MeshBasicMaterial;
  depthOccluder: THREE.MeshBasicMaterial;
  applyPreset: (preset: SuitPreset) => void;
  dispose: () => void;
}

export function createMark85Materials(maxAnisotropy = 4): Mark85MaterialLibrary {
  const { albedoModMap, roughnessMap, normalMap } = createCadArmorSurfaceMaps(maxAnisotropy);
  const { map: grilleMap, bumpMap: grilleBump } = createPerforatedHexGrilleMaps(maxAnisotropy);
  const carbonMap = createCarbonHexMeshMap(maxAnisotropy);
  const defaultPreset = DEFAULT_SUIT_PRESETS[0];

  const sharedUniforms = {
    uSuitProgress: { value: 0.0 },
    uArcOrigin: { value: new THREE.Vector3(0, 0, -1.6) },
    uBodyScale: { value: 0.42 },
    uTime: { value: 0.0 },
    uStealthMix: { value: 0.0 },
    uWearAmount: { value: defaultPreset.wearAmount },
    uNanoColor: { value: new THREE.Color(defaultPreset.emissiveHex) },
  };

  /**
   * Shader PBR cinéma : coutures CAD biseautées + patine de combat dynamique (uWearAmount)
   * + onde Nanotech lors du Suit-Up + mode Furtif.
   */
  const applyArmorShader = <T extends THREE.Material>(
    material: T,
    allowStealth = true,
    usePanelSeams = true
  ): T => {
    material.customProgramCacheKey = () =>
      `mk85-cinema-cad-${allowStealth ? 's' : 'n'}-${usePanelSeams ? 'p' : 'f'}-v7`;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSuitProgress = sharedUniforms.uSuitProgress;
      shader.uniforms.uTime = sharedUniforms.uTime;
      shader.uniforms.uStealthMix = sharedUniforms.uStealthMix;
      shader.uniforms.uWearAmount = sharedUniforms.uWearAmount;
      shader.uniforms.uNanoColor = sharedUniforms.uNanoColor;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec2 vArmorUv;`
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
           vArmorUv = uv;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uSuitProgress;
           uniform float uTime;
           uniform float uStealthMix;
           uniform float uWearAmount;
           uniform vec3 uNanoColor;
           varying vec2 vArmorUv;

           float mk85Hash(vec2 p) {
             return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
           }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           ${
             usePanelSeams
               ? `float seamU = smoothstep(0.0, 0.016, min(fract(vArmorUv.x * 2.0), 1.0 - fract(vArmorUv.x * 2.0)));
                  float seamV = smoothstep(0.0, 0.016, min(fract(vArmorUv.y * 3.0), 1.0 - fract(vArmorUv.y * 3.0)));
                  float edgeWear = (1.0 - seamU * seamV) * uWearAmount;
                  diffuseColor.rgb *= (0.64 + 0.36 * (seamU * seamV));
                  float chip = step(0.68, mk85Hash(floor(vArmorUv * 42.0))) * uWearAmount;
                  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.76, 0.79, 0.84), clamp(edgeWear * 0.55 + chip * 0.32, 0.0, 0.72));`
               : ''
           }
           ${
             allowStealth
               ? `float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                  vec3 stealthBase = vec3(0.055, 0.068, 0.088) * (0.62 + luma * 0.72);
                  diffuseColor.rgb = mix(diffuseColor.rgb, stealthBase, uStealthMix * 0.92);`
               : ''
           }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           ${
             allowStealth
               ? `roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor + 0.28, 0.0, 0.92), uStealthMix);`
               : ''
           }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           if (uSuitProgress > 0.02 && uSuitProgress < 0.96) {
             float gridPulse = smoothstep(0.91, 0.99, sin(vArmorUv.y * 46.0 - uTime * 11.0));
             float fadeOut = 1.0 - smoothstep(0.55, 0.96, uSuitProgress);
             totalEmissiveRadiance += uNanoColor * (gridPulse * 0.55 * fadeOut);
           }`
        );
    };
    return material;
  };

  const undersuitGrid = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x141a24),
    map: carbonMap,
    metalness: 0.38,
    roughness: 0.54,
    bumpMap: carbonMap,
    bumpScale: 0.004,
    envMapIntensity: 0.85,
  });
  undersuitGrid.customProgramCacheKey = () => 'mk85-blueprint-undersuit-v2';
  undersuitGrid.onBeforeCompile = (shader) => {
    shader.uniforms.uSuitProgress = sharedUniforms.uSuitProgress;
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uNanoColor = sharedUniforms.uNanoColor;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec2 vGridUv;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vGridUv = uv;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uSuitProgress;
         uniform float uTime;
         uniform vec3 uNanoColor;
         varying vec2 vGridUv;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float holoPhase = 1.0 - smoothstep(0.34, 0.74, uSuitProgress);
         if (holoPhase > 0.01) {
           vec2 g = abs(fract(vGridUv * vec2(20.0, 28.0) - 0.5) - 0.5) / 0.075;
           float line = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
           float scan = 0.65 + 0.35 * sin(vGridUv.y * 30.0 - uTime * 9.0);
           totalEmissiveRadiance += uNanoColor * (line * 1.25 + 0.12) * holoPhase * scan;
         }`
      );
  };

  const crimson = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(defaultPreset.crimsonHex),
      map: albedoModMap,
      metalness: defaultPreset.metalness,
      roughness: defaultPreset.roughness,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      anisotropy: 0.78,
      clearcoat: defaultPreset.clearcoat,
      clearcoatRoughness: defaultPreset.clearcoatRoughness,
      ior: 1.58,
      envMapIntensity: 1.48,
      side: THREE.DoubleSide,
    }),
    true,
    true
  );

  const crimsonDark = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(defaultPreset.crimsonDarkHex),
      map: albedoModMap,
      metalness: Math.max(0.75, defaultPreset.metalness - 0.03),
      roughness: Math.min(0.65, defaultPreset.roughness + 0.09),
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      clearcoat: defaultPreset.clearcoat * 0.65,
      clearcoatRoughness: defaultPreset.clearcoatRoughness + 0.08,
      envMapIntensity: 1.22,
      side: THREE.DoubleSide,
    }),
    true,
    true
  );

  const crimsonInner = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x280508),
      metalness: 0.70,
      roughness: 0.44,
      envMapIntensity: 0.92,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const gold = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(defaultPreset.goldHex),
      map: albedoModMap,
      metalness: 0.94,
      roughness: Math.max(0.14, defaultPreset.roughness - 0.01),
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      anisotropy: 0.90,
      clearcoat: defaultPreset.clearcoat * 0.45,
      clearcoatRoughness: 0.14,
      envMapIntensity: 1.45,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const titanium = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(defaultPreset.titaniumHex),
      map: albedoModMap,
      metalness: 0.94,
      roughness: 0.21,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.70, 0.70),
      anisotropy: 0.80,
      clearcoat: 0.25,
      envMapIntensity: 1.38,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const chrome = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xdce4ef),
      metalness: 0.98,
      roughness: 0.12,
      clearcoat: 0.28,
      envMapIntensity: 1.65,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const perforatedGrille = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x7c8798),
      map: grilleMap,
      bumpMap: grilleBump,
      bumpScale: 0.006,
      metalness: 0.88,
      roughness: 0.36,
      envMapIntensity: 1.18,
      side: THREE.DoubleSide,
    }),
    false,
    false
  );

  const brass = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xc48e36),
      metalness: 0.93,
      roughness: 0.21,
      anisotropy: 0.68,
      clearcoat: 0.24,
      envMapIntensity: 1.30,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const gunmetal = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x252b35),
      map: albedoModMap,
      metalness: 0.86,
      roughness: 0.36,
      roughnessMap,
      normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      envMapIntensity: 1.10,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const bellows = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x141820),
    metalness: 0.34,
    roughness: 0.60,
    envMapIntensity: 0.78,
  });

  const carbon = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x161a22),
    map: carbonMap,
    metalness: 0.40,
    roughness: 0.56,
    bumpMap: carbonMap,
    bumpScale: 0.004,
    envMapIntensity: 0.88,
  });

  const cableBlue = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x255ab0),
    metalness: 0.24,
    roughness: 0.36,
    clearcoat: 0.26,
  });

  const cableAzure = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x3a94eb),
    metalness: 0.24,
    roughness: 0.30,
    clearcoat: 0.30,
  });

  const cableRed = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xa91e26),
    metalness: 0.22,
    roughness: 0.40,
    clearcoat: 0.22,
  });

  const emissiveCyan = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    emissive: new THREE.Color(defaultPreset.emissiveHex),
    emissiveIntensity: defaultPreset.emissiveIntensity,
    roughness: 0.06,
    metalness: 0.04,
  });

  const diodeBlue = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x88d4ff),
    emissive: new THREE.Color(0x2496ff),
    emissiveIntensity: 2.2,
    roughness: 0.18,
    metalness: 0.28,
  });

  const pulseGlow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xb2fcff),
  });

  const depthOccluder = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

  const applyPreset = (preset: SuitPreset): void => {
    crimson.color.set(preset.crimsonHex);
    crimson.metalness = preset.metalness;
    crimson.roughness = preset.roughness;
    crimson.clearcoat = preset.clearcoat;
    crimson.clearcoatRoughness = preset.clearcoatRoughness;

    crimsonDark.color.set(preset.crimsonDarkHex);
    crimsonDark.metalness = Math.max(0.74, preset.metalness - 0.03);
    crimsonDark.roughness = Math.min(0.68, preset.roughness + 0.09);
    crimsonDark.clearcoat = preset.clearcoat * 0.65;

    gold.color.set(preset.goldHex);
    gold.roughness = Math.max(0.14, preset.roughness - 0.01);
    gold.clearcoat = preset.clearcoat * 0.45;

    titanium.color.set(preset.titaniumHex);
    sharedUniforms.uWearAmount.value = preset.wearAmount;
    sharedUniforms.uNanoColor.value.set(preset.emissiveHex);

    emissiveCyan.emissive.set(preset.emissiveHex);
    emissiveCyan.emissiveIntensity = preset.emissiveIntensity;
  };

  return {
    sharedUniforms,
    crimson,
    crimsonDark,
    crimsonInner,
    gold,
    titanium,
    chrome,
    perforatedGrille,
    brass,
    gunmetal,
    bellows,
    carbon,
    undersuitGrid,
    cableBlue,
    cableAzure,
    cableRed,
    emissiveCyan,
    diodeBlue,
    pulseGlow,
    depthOccluder,
    applyPreset,
    dispose() {
      albedoModMap.dispose();
      roughnessMap.dispose();
      normalMap.dispose();
      grilleMap.dispose();
      grilleBump.dispose();
      carbonMap.dispose();
      crimson.dispose();
      crimsonDark.dispose();
      crimsonInner.dispose();
      gold.dispose();
      titanium.dispose();
      chrome.dispose();
      perforatedGrille.dispose();
      brass.dispose();
      gunmetal.dispose();
      bellows.dispose();
      carbon.dispose();
      undersuitGrid.dispose();
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
