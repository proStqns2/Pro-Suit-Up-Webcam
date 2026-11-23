import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export type ArmorSocketId =
  | 'helmet_skull'
  | 'helmet_faceplate'
  | 'helmet_jaw'
  | 'neck'
  | 'chest'
  | 'back'
  | 'abdomen'
  | 'pelvis'
  | 'pauldron_left'
  | 'pauldron_right'
  | 'upper_arm_left'
  | 'upper_arm_right'
  | 'forearm_left'
  | 'forearm_right'
  | 'gauntlet_left'
  | 'gauntlet_right'
  | 'thigh_left'
  | 'thigh_right'
  | 'shin_left'
  | 'shin_right'
  | 'boot_left'
  | 'boot_right';

export interface ArmorSocketEntry {
  id: ArmorSocketId;
  label: string;
  slotGroup: THREE.Group;
  proceduralRoot: THREE.Object3D;
  customRoot: THREE.Group;
  targetSize: THREE.Vector3;
  customSourceName: string | null;
}

export interface ArmorSocketStatus {
  id: ArmorSocketId;
  label: string;
  hasCustomPart: boolean;
  customSourceName: string | null;
}

export interface CustomPartAttachOptions {
  scale?: number;
  offset?: [number, number, number];
  rotationDeg?: [number, number, number];
  hideProcedural?: boolean;
  sourceLabel?: string;
}

interface ManifestPartEntry extends CustomPartAttachOptions {
  url: string;
}

interface SuitPartsManifest {
  parts?: Partial<Record<ArmorSocketId, string | ManifestPartEntry>>;
}

export class ArmorSocketManager {
  private sockets = new Map<ArmorSocketId, ArmorSocketEntry>();
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private tempBox = new THREE.Box3();
  private tempSize = new THREE.Vector3();
  private tempCenter = new THREE.Vector3();

  constructor(entries: ArmorSocketEntry[]) {
    for (const entry of entries) {
      this.sockets.set(entry.id, entry);
    }

    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
  }

  listStatuses(): ArmorSocketStatus[] {
    return Array.from(this.sockets.values()).map((entry) => ({
      id: entry.id,
      label: entry.label,
      hasCustomPart: entry.customRoot.children.length > 0,
      customSourceName: entry.customSourceName,
    }));
  }

  async loadManifest(manifestUrl = '/assets/suit-parts/manifest.json'): Promise<number> {
    try {
      const res = await fetch(manifestUrl, { cache: 'no-store' });
      if (!res.ok) return 0;
      const json = (await res.json()) as SuitPartsManifest;
      if (!json.parts) return 0;

      let loaded = 0;
      const tasks = Object.entries(json.parts).map(async ([socketKey, cfg]) => {
        const socketId = socketKey as ArmorSocketId;
        if (!this.sockets.has(socketId) || !cfg) return;
        if (typeof cfg === 'string') {
          await this.attachCustomPart(socketId, cfg);
        } else if (cfg.url) {
          await this.attachCustomPart(socketId, cfg.url, cfg);
        }
        loaded++;
      });

      await Promise.all(tasks);
      return loaded;
    } catch {
      return 0;
    }
  }

  async attachCustomPart(
    socketId: ArmorSocketId,
    source: string | File,
    options: CustomPartAttachOptions = {}
  ): Promise<void> {
    const entry = this.sockets.get(socketId);
    if (!entry) {
      throw new Error(`Socket anatomique inconnu : ${socketId}`);
    }

    let objectUrl: string | null = null;
    const url =
      typeof source === 'string'
        ? source
        : ((objectUrl = URL.createObjectURL(source)), objectUrl);
    const label =
      options.sourceLabel ?? (typeof source === 'string' ? source.split('/').pop() || source : source.name);

    try {
      const gltf = await this.gltfLoader.loadAsync(url);
      this.detachCustomPart(socketId);

      const wrapper = new THREE.Group();
      const model = gltf.scene;
      model.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            if (mat && 'envMapIntensity' in mat) {
              (mat as THREE.MeshStandardMaterial).envMapIntensity = 1.25;
              mat.needsUpdate = true;
            }
          }
        }
      });

      // Normalisation automatique sur la boîte englobante du socket anatomique
      model.updateMatrixWorld(true);
      this.tempBox.setFromObject(model);
      if (!this.tempBox.isEmpty()) {
        this.tempBox.getSize(this.tempSize);
        this.tempBox.getCenter(this.tempCenter);
        const maxSrcDim = Math.max(this.tempSize.x, this.tempSize.y, this.tempSize.z, 1e-4);
        const maxDstDim = Math.max(entry.targetSize.x, entry.targetSize.y, entry.targetSize.z, 1e-4);
        const autoScale = (maxDstDim / maxSrcDim) * (options.scale ?? 1.0);
        model.position.sub(this.tempCenter).multiplyScalar(autoScale);
        model.scale.setScalar(autoScale);
      }

      if (options.rotationDeg) {
        wrapper.rotation.set(
          THREE.MathUtils.degToRad(options.rotationDeg[0]),
          THREE.MathUtils.degToRad(options.rotationDeg[1]),
          THREE.MathUtils.degToRad(options.rotationDeg[2])
        );
      }
      if (options.offset) {
        wrapper.position.set(options.offset[0], options.offset[1], options.offset[2]);
      }

      wrapper.add(model);
      entry.customRoot.add(wrapper);
      entry.customSourceName = label;
      if (options.hideProcedural !== false) {
        entry.proceduralRoot.visible = false;
      }
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  detachCustomPart(socketId: ArmorSocketId): void {
    const entry = this.sockets.get(socketId);
    if (!entry) return;

    entry.customRoot.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
          else (mesh.material as THREE.Material).dispose();
        }
      }
    });
    entry.customRoot.clear();
    entry.customSourceName = null;
    entry.proceduralRoot.visible = true;
  }

  dispose(): void {
    for (const socketId of this.sockets.keys()) {
      this.detachCustomPart(socketId);
    }
    this.dracoLoader.dispose();
  }
}
