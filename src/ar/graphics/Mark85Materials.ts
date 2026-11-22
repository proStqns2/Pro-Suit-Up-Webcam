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

  // Rich brushed metal base (keeps deep cherry-crimson & champagne gold contrast crisp)
  aCtx.fillStyle = '#f2f2f2';
  aCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#525252';
  rCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  // Subtle alloy patina mottling (realistic aerospace anodized finish, zero plastic flat look)
  for (let i = 0; i < 480; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const rad = 18 + Math.random() * 80;
    const dark = Math.random() > 0.46;
    const aGrad = aCtx.createRadialGradient(x, y, 2, x, y, rad);
    aGrad.addColorStop(0, dark ? 'rgba(182,182,182,0.08)' : 'rgba(255,255,255,0.08)');
    aGrad.addColorStop(1, 'rgba(240,240,240,0)');
    aCtx.fillStyle = aGrad;
    aCtx.beginPath();
    aCtx.arc(x, y, rad, 0, Math.PI * 2);
    aCtx.fill();

    const rGrad = rCtx.createRadialGradient(x, y, 2, x, y, rad);
    rGrad.addColorStop(0, dark ? 'rgba(138,138,138,0.12)' : 'rgba(58,58,58,0.11)');
    rGrad.addColorStop(1, 'rgba(95,95,95,0)');
    rCtx.fillStyle = rGrad;
    rCtx.beginPath();
    rCtx.arc(x, y, rad, 0, Math.PI * 2);
    rCtx.fill();
  }

  // High-frequency directional anisotropic brushed streaks
  for (let i = 0; i < 11000; i++) {
    const y = Math.random() * size;
    const x = Math.random() * size;
    const len = 34 + Math.random() * 145;
    const rv = (68 + Math.random() * 72) | 0;
    rCtx.strokeStyle = `rgba(${rv},${rv},${rv},0.15)`;
    rCtx.lineWidth = 0.75;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x, y + len);
    rCtx.stroke();

    const bv = (114 + Math.random() * 32) | 0;
    bCtx.strokeStyle = `rgba(${bv},${bv},${bv},0.12)`;
    bCtx.lineWidth = 0.75;
    bCtx.beginPath();
    bCtx.moveTo(x, y);
    bCtx.lineTo(x, y + len);
    bCtx.stroke();

    if ((i & 3) === 0) {
      const av = (212 + Math.random() * 43) | 0;
      aCtx.strokeStyle = `rgba(${av},${av},${av},0.075)`;
      aCtx.lineWidth = 0.65;
      aCtx.beginPath();
      aCtx.moveTo(x, y);
      aCtx.lineTo(x, y + len * 0.75);
      aCtx.stroke();
    }
  }

  // Micro-machined edge wear scratches
  for (let i = 0; i < 210; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const angle = Math.random() * Math.PI * 2;
    const len = 8 + Math.random() * 34;
    aCtx.strokeStyle = 'rgba(255,255,255,0.14)';
    aCtx.lineWidth = 0.65;
    aCtx.beginPath();
    aCtx.moveTo(x, y);
    aCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    aCtx.stroke();

    rCtx.strokeStyle = 'rgba(220,220,220,0.20)';
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

  cCtx.fillStyle = '#4c5563';
  cCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#d0d0d0';
  bCtx.fillRect(0, 0, size, size);

  const stepX = 16;
  const stepY = 14;
  for (let row = 0; row * stepY < size + stepY; row++) {
    const offset = (row & 1) * (stepX * 0.5);
    for (let col = -1; col * stepX < size + stepX; col++) {
      const cx = col * stepX + offset;
      const cy = row * stepY;

      // Dark perforated ventilation hole inside machined titanium plate (Video 1 chest bay!)
      cCtx.fillStyle = '#0c0f14';
      cCtx.beginPath();
      cCtx.arc(cx, cy, 4.4, 0, Math.PI * 2);
      cCtx.fill();

      cCtx.strokeStyle = '#6d7787';
      cCtx.lineWidth = 1.0;
      cCtx.stroke();

      bCtx.fillStyle = '#181818';
      bCtx.beginPath();
      bCtx.arc(cx, cy, 4.7, 0, Math.PI * 2);
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

  ctx.fillStyle = '#10141b';
  ctx.fillRect(0, 0, size, size);

  const cell = 12;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const alt = ((x + y) / cell) % 2 === 0;
      ctx.fillStyle = alt ? '#212834' : '#141922';
      ctx.fillRect(x, y, cell - 1, cell - 1);
      ctx.fillStyle = alt ? '#2e3747' : '#1b202a';
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
  dispose: () => void;
}

export function createMark85Materials(maxAnisotropy = 4): Mark85MaterialLibrary {
  const { albedoModMap, roughnessMap, bumpMap } = createArmorSurfaceMaps(maxAnisotropy);
  const { map: grilleMap, bumpMap: grilleBump } = createPerforatedHexGrilleMaps(maxAnisotropy);
  const carbonMap = createCarbonHexMeshMap(maxAnisotropy);

  const sharedUniforms = {
    uSuitProgress: { value: 0.0 },
    uArcOrigin: { value: new THREE.Vector3(0, 0, -1.6) },
    uBodyScale: { value: 0.42 },
    uTime: { value: 0.0 },
    uStealthMix: { value: 0.0 },
    uNanoColor: { value: new THREE.Color(0x38f2ff) },
  };

  /**
   * Shader PBR pour plaques d'armure & endosquelette :
   * Pas de découpe fragment brutale au milieu des maillages — chaque pièce s'anime physiquement en 3D
   * (fly-in / déploiement / verrouillage) tout en conservant coutures usinées & mode Furtif.
   */
  const applyArmorShader = <T extends THREE.Material>(
    material: T,
    allowStealth = true,
    usePanelSeams = true
  ): T => {
    material.customProgramCacheKey = () =>
      `mk85-cinema-${allowStealth ? 's' : 'n'}-${usePanelSeams ? 'p' : 'f'}-v6`;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSuitProgress = sharedUniforms.uSuitProgress;
      shader.uniforms.uTime = sharedUniforms.uTime;
      shader.uniforms.uStealthMix = sharedUniforms.uStealthMix;
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
           uniform vec3 uNanoColor;
           varying vec2 vArmorUv;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           ${
             usePanelSeams
               ? `float seamU = smoothstep(0.0, 0.018, min(fract(vArmorUv.x * 2.0), 1.0 - fract(vArmorUv.x * 2.0)));
                  float seamV = smoothstep(0.0, 0.018, min(fract(vArmorUv.y * 3.0), 1.0 - fract(vArmorUv.y * 3.0)));
                  diffuseColor.rgb *= (0.72 + 0.28 * (seamU * seamV));`
               : ''
           }
           ${
             allowStealth
               ? `float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                  vec3 stealthBase = vec3(0.06, 0.074, 0.092) * (0.65 + luma * 0.7);
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
           if (uSuitProgress > 0.02 && uSuitProgress < 0.96) {
             float gridPulse = smoothstep(0.90, 0.99, sin(vArmorUv.y * 42.0 - uTime * 10.0));
             float fadeOut = 1.0 - smoothstep(0.55, 0.96, uSuitProgress);
             totalEmissiveRadiance += uNanoColor * (gridPulse * 0.45 * fadeOut);
           }`
        );
    };
    return material;
  };

  /**
   * Shader Sous-Combinaison Holographique (Vidéo 3 WANOCO) :
   * Apparaît d'abord comme une grille tactique cyan lumineuse sur armature sombre,
   * puis s'assombrit en carbone hex-weave mat lorsque l'armure se verrouille.
   */
  const undersuitGrid = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x161c26),
    map: carbonMap,
    metalness: 0.36,
    roughness: 0.56,
    bumpMap: carbonMap,
    bumpScale: 0.004,
    envMapIntensity: 0.85,
  });
  undersuitGrid.customProgramCacheKey = () => 'mk85-blueprint-undersuit-v1';
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
         float holoPhase = 1.0 - smoothstep(0.32, 0.72, uSuitProgress);
         if (holoPhase > 0.01) {
           vec2 g = abs(fract(vGridUv * vec2(18.0, 26.0) - 0.5) - 0.5) / 0.08;
           float line = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
           float scan = 0.65 + 0.35 * sin(vGridUv.y * 28.0 - uTime * 8.0);
           totalEmissiveRadiance += uNanoColor * (line * 0.95 + 0.08) * holoPhase * scan;
         }`
      );
  };

  // Finition Cherry-Crimson anodisée clearcoat haute brillance (Vidéo 1, 3, 4)
  const crimson = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x880f17),
      map: albedoModMap,
      metalness: 0.85,
      roughness: 0.24,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0028,
      anisotropy: 0.72,
      clearcoat: 0.72,
      clearcoatRoughness: 0.11,
      ior: 1.56,
      envMapIntensity: 1.38,
      side: THREE.DoubleSide,
    }),
    true,
    true
  );

  const crimsonDark = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x47080d),
      map: albedoModMap,
      metalness: 0.84,
      roughness: 0.32,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0024,
      clearcoat: 0.45,
      clearcoatRoughness: 0.18,
      envMapIntensity: 1.15,
      side: THREE.DoubleSide,
    }),
    true,
    true
  );

  const crimsonInner = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x2a0508),
      metalness: 0.68,
      roughness: 0.46,
      envMapIntensity: 0.9,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const gold = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xc59746),
      map: albedoModMap,
      metalness: 0.92,
      roughness: 0.22,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0024,
      anisotropy: 0.88,
      clearcoat: 0.30,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.35,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const titanium = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x9ea8b6),
      map: albedoModMap,
      metalness: 0.93,
      roughness: 0.22,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0022,
      anisotropy: 0.78,
      clearcoat: 0.22,
      envMapIntensity: 1.32,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const chrome = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xdbe3ee),
      metalness: 0.97,
      roughness: 0.13,
      clearcoat: 0.25,
      envMapIntensity: 1.60,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const perforatedGrille = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x768090),
      map: grilleMap,
      bumpMap: grilleBump,
      bumpScale: 0.006,
      metalness: 0.86,
      roughness: 0.38,
      envMapIntensity: 1.15,
      side: THREE.DoubleSide,
    }),
    false,
    false
  );

  const brass = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xbe8b36),
      metalness: 0.92,
      roughness: 0.22,
      anisotropy: 0.65,
      clearcoat: 0.22,
      envMapIntensity: 1.25,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const gunmetal = applyArmorShader(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x282e38),
      map: albedoModMap,
      metalness: 0.85,
      roughness: 0.38,
      roughnessMap,
      bumpMap,
      bumpScale: 0.0024,
      envMapIntensity: 1.05,
      side: THREE.DoubleSide,
    }),
    true,
    false
  );

  const bellows = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x161a22),
    metalness: 0.32,
    roughness: 0.62,
    envMapIntensity: 0.75,
  });

  const carbon = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x161a22),
    map: carbonMap,
    metalness: 0.38,
    roughness: 0.58,
    bumpMap: carbonMap,
    bumpScale: 0.004,
    envMapIntensity: 0.85,
  });

  const cableBlue = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x2758a4),
    metalness: 0.24,
    roughness: 0.38,
    clearcoat: 0.24,
  });

  const cableAzure = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x3a8ee2),
    metalness: 0.24,
    roughness: 0.32,
    clearcoat: 0.28,
  });

  const cableRed = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xa21e24),
    metalness: 0.22,
    roughness: 0.42,
    clearcoat: 0.20,
  });

  const emissiveCyan = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    emissive: new THREE.Color(0x98faff),
    emissiveIntensity: 4.0,
    roughness: 0.08,
    metalness: 0.05,
  });

  const diodeBlue = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x78c8ff),
    emissive: new THREE.Color(0x1e88ff),
    emissiveIntensity: 1.65,
    roughness: 0.20,
    metalness: 0.30,
  });

  const pulseGlow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xa6f9ff),
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
    dispose() {
      albedoModMap.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
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
