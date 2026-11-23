import * as THREE from 'three';
import type { CalibrationEngine } from '../core/CalibrationEngine';
import type { Mark85MaterialLibrary } from './Mark85Materials';
import type { ArmorSocketEntry, ArmorSocketId } from './ArmorSockets';

type LoftSection = [y: number, rx: number, rz: number, offZ?: number, power?: number];

/**
 * Maillage lofté organique/mécanique à section super-elliptique contrôlée
 * pour obtenir des membres et bustes galbés sans primitives géométriques brutes.
 */
function createContouredArmorGeometry(sections: LoftSection[], radialSegs = 28): THREE.BufferGeometry {
  const rows = sections.length;
  const cols = radialSegs + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r < rows; r++) {
    const [y, rx, rz, offZ = 0, power = 1.0] = sections[r];
    const v = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = c / radialSegs;
      const theta = u * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const sx = Math.sign(cosT) * Math.pow(Math.abs(cosT), power);
      const sz = Math.sign(sinT) * Math.pow(Math.abs(sinT), power);
      const microFacet = 1.0 + 0.015 * Math.cos(theta * 6.0);
      const x = sx * rx * microFacet;
      const z = sz * rz * microFacet + offZ;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < radialSegs; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Coque loftée paramétrique double-paroi avec bords biseautés.
 */
function createDualLoftedShellGroup(
  evalFn: (u: number, v: number, depthOffset: number) => [number, number, number],
  outerMat: THREE.Material,
  innerMat: THREE.Material | null,
  rimMat: THREE.Material | null,
  nx = 16,
  ny = 16,
  thick = 0.04
): THREE.Group {
  const grp = new THREE.Group();

  const buildSurface = (isInner: boolean): THREE.BufferGeometry => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const offset = isInner ? thick : 0;
    for (let g = 0; g <= nx; g++) {
      const u = g / nx;
      for (let b = 0; b <= ny; b++) {
        const v = b / ny;
        const pt = evalFn(u, v, offset);
        pos.push(pt[0], pt[1], pt[2]);
        uv.push(u, v);
      }
    }
    for (let g = 0; g < nx; g++) {
      for (let b = 0; b < ny; b++) {
        const x = g * (ny + 1) + b;
        const p = x + ny + 1;
        const c = x + 1;
        const d = p + 1;
        if (isInner) idx.push(x, p, c, c, p, d);
        else idx.push(x, c, p, c, d, p);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  };

  grp.add(new THREE.Mesh(buildSurface(false), outerMat));
  if (innerMat) grp.add(new THREE.Mesh(buildSurface(true), innerMat));

  if (rimMat) {
    const rimPos: number[] = [];
    const rimUv: number[] = [];
    const edges: [(t: number, d: number) => [number, number, number], number, boolean][] = [
      [(t, d) => evalFn(t, 0, d), nx, true],
      [(t, d) => evalFn(t, 1, d), nx, false],
      [(t, d) => evalFn(0, t, d), ny, false],
      [(t, d) => evalFn(1, t, d), ny, true],
    ];
    for (const [edgeFn, steps, flip] of edges) {
      for (let i = 0; i < steps; i++) {
        const p0 = edgeFn(i / steps, 0);
        const p1 = edgeFn((i + 1) / steps, 0);
        const q0 = edgeFn(i / steps, thick);
        const q1 = edgeFn((i + 1) / steps, thick);
        if (flip) {
          rimPos.push(...p0, ...p1, ...q0, ...q0, ...p1, ...q1);
        } else {
          rimPos.push(...p0, ...q0, ...p1, ...q0, ...q1, ...p1);
        }
        rimUv.push(0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1);
      }
    }
    const rimGeo = new THREE.BufferGeometry();
    rimGeo.setAttribute('position', new THREE.Float32BufferAttribute(rimPos, 3));
    rimGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rimUv, 2));
    rimGeo.computeVertexNormals();
    grp.add(new THREE.Mesh(rimGeo, rimMat));
  }

  return grp;
}

function createExtrudedPlate(
  points2D: [number, number][],
  depth: number,
  bevelSize = 0.016,
  centerZ = true,
  holes?: [number, number, number][]
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points2D[0][0], points2D[0][1]);
  for (let i = 1; i < points2D.length; i++) {
    shape.lineTo(points2D[i][0], points2D[i][1]);
  }
  shape.closePath();

  if (holes) {
    for (const [hx, hy, hr] of holes) {
      const holePath = new THREE.Path();
      holePath.absarc(hx, hy, hr, 0, Math.PI * 2, true);
      shape.holes.push(holePath);
    }
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelSize > 0,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 3,
    curveSegments: 14,
  });
  if (centerZ) geo.translate(0, 0, -depth * 0.5);
  geo.computeVertexNormals();
  return geo;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Courbe de verrouillage mécanique : déplacement rapide puis léger rebond d'amortissement au clic final.
 */
function easeServoLock(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  const c1 = 1.45;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

const _boltUp = new THREE.Vector3(0, 1, 0);
const _boltDir = new THREE.Vector3();

function addMachinedBolt(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  normal: THREE.Vector3,
  mats: Mark85MaterialLibrary,
  radius = 0.042
): void {
  _boltDir.copy(normal).normalize();
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.92, radius * 0.48, 16), mats.chrome);
  outer.position.copy(pos);
  outer.quaternion.setFromUnitVectors(_boltUp, _boltDir);
  parent.add(outer);

  const socket = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, radius * 0.16, 6),
    mats.gunmetal
  );
  socket.position.copy(pos).addScaledVector(_boltDir, radius * 0.22);
  socket.quaternion.copy(outer.quaternion);
  parent.add(socket);
}

function addBellowsStack(
  parent: THREE.Object3D,
  startY: number,
  stepY: number,
  count: number,
  radius: number,
  tubeRadius: number,
  mats: Mark85MaterialLibrary,
  scaleX = 1.0,
  scaleZ = 1.0
): void {
  const ringGeo = new THREE.TorusGeometry(radius, tubeRadius, 8, 24);
  ringGeo.rotateX(Math.PI * 0.5);
  for (let i = 0; i < count; i++) {
    const ring = new THREE.Mesh(ringGeo, i % 2 === 0 ? mats.bellows : mats.gunmetal);
    ring.position.set(0, startY + i * stepY, 0);
    ring.scale.set(scaleX, 1.0, scaleZ);
    parent.add(ring);
  }
}

interface AssemblyPart {
  group: THREE.Object3D;
  restPos: [number, number, number];
  restRot: [number, number, number];
  explodeOffset: [number, number, number];
  explodeRot: [number, number, number];
  startT: number;
  endT: number;
}

interface ActuatorAssembly {
  armPivot: THREE.Group;
  cylPivot: THREE.Group;
  rodMesh: THREE.Mesh;
  hingeX: number;
  hingeY: number;
  baseX: number;
  baseY: number;
}

interface PulseRunner {
  mesh: THREE.Mesh;
  curve: THREE.CatmullRomCurve3;
  offset: number;
}

interface ArmRig {
  pauldron: THREE.Group;
  upper: THREE.Group;
  elbow: THREE.Group;
  forearm: THREE.Group;
  dorsalCover: THREE.Group;
  actuators: ActuatorAssembly[];
  pulses: PulseRunner[];
  chassisRing: THREE.Mesh;
  turbineRing: THREE.Mesh;
}

interface PhalanxLink {
  group: THREE.Group;
  outerCap: THREE.Mesh;
}

interface HandRig {
  group: THREE.Group;
  palm: THREE.Group;
  repulsorHousing: THREE.Group;
  repulsorCore: THREE.Mesh;
  repulsorDiodeRing: THREE.Mesh;
  dorsalEmitter: THREE.Mesh;
  dorsalCover: THREE.Group;
  segments: PhalanxLink[];
}

interface LegRig {
  thigh: THREE.Group;
  knee: THREE.Group;
  shin: THREE.Group;
  boot: THREE.Group;
}

interface RibPiston {
  barrel: THREE.Group;
  rod: THREE.Mesh;
  side: number;
}

interface ChestFlapRig {
  group: THREE.Group;
  side: number;
}

export class Mark85ArmorRig {
  public readonly mats: Mark85MaterialLibrary;
  public readonly root = new THREE.Group();

  public helmetOpenTarget = 0;
  public helmetOpenCurrent = 0;
  public mechaInspectTarget = 0;
  public mechaInspectCurrent = 0;

  public readonly repulsorCharge = { left: 0, right: 0 };
  public readonly palmOpen = { left: false, right: false };

  public readonly arcWorldPos = new THREE.Vector3(0, 0, -1.6);
  public readonly headWorldPos = new THREE.Vector3(0, 0.35, -1.6);
  public readonly shoulderWorldPos = {
    left: new THREE.Vector3(-0.2, 0.2, -1.6),
    right: new THREE.Vector3(0.2, 0.2, -1.6),
  };
  public readonly palmWorldPos = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  public readonly palmWorldNormal = { left: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(0, 0, 1) };
  public readonly activeClampAnchor = new THREE.Vector3(0, 0, -1.6);
  public activeStageLabel = 'ARMURE VERROUILLÉE';

  private readonly assemblyParts: AssemblyPart[] = [];
  private readonly socketEntries: ArmorSocketEntry[] = [];

  private helmetGroup!: THREE.Group;
  private neckGroup!: THREE.Group;
  private headWireCore!: THREE.Mesh;
  private faceOccluder!: THREE.Mesh;
  private faceplatePivot!: THREE.Group;
  private faceplateGroup!: THREE.Group;
  private openBrowCage!: THREE.Group;
  private jawGroup!: THREE.Group;
  private skullGroup!: THREE.Group;
  private templeServos: THREE.Mesh[] = [];

  private chestGroup!: THREE.Group;
  private chestShellProc!: THREE.Group;
  private backAssembly!: THREE.Group;
  private arcReactorGroup!: THREE.Group;
  private arcCoreMesh!: THREE.Mesh;
  private arcTurbineRing!: THREE.Mesh;
  private chestFlaps: ChestFlapRig[] = [];
  private sternalHatch!: THREE.Group;
  private ribPistons: RibPiston[] = [];
  private abBands: THREE.Group[] = [];
  private abBandProcGroups: THREE.Group[] = [];
  private abCustomAnchor!: THREE.Group;
  private abCustomRoot!: THREE.Group;
  private pelvisGroup!: THREE.Group;

  private leftArm!: ArmRig;
  private rightArm!: ArmRig;
  private leftHand!: HandRig;
  private rightHand!: HandRig;
  private leftLeg!: LegRig;
  private rightLeg!: LegRig;

  // Scratch math objects (zéro allocation GC par frame)
  private readonly _v1 = new THREE.Vector3();
  private readonly _v2 = new THREE.Vector3();
  private readonly _v3 = new THREE.Vector3();
  private readonly _xAxis = new THREE.Vector3();
  private readonly _yAxis = new THREE.Vector3();
  private readonly _zAxis = new THREE.Vector3();
  private readonly _mat4 = new THREE.Matrix4();

  private readonly _shoulderVec = new THREE.Vector3();
  private readonly _spineUp = new THREE.Vector3();
  private readonly _chestX = new THREE.Vector3();
  private readonly _chestY = new THREE.Vector3();
  private readonly _chestZ = new THREE.Vector3();
  private readonly _chestXOrtho = new THREE.Vector3();
  private readonly _chestQuat = new THREE.Quaternion();
  private readonly _chestCenter = new THREE.Vector3();

  private readonly _hipVec = new THREE.Vector3();
  private readonly _hipZ = new THREE.Vector3();
  private readonly _hipX = new THREE.Vector3();
  private readonly _hipQuat = new THREE.Quaternion();

  private readonly _headCenter = new THREE.Vector3();
  private readonly _headQuat = new THREE.Quaternion();
  private readonly _faceHVec = new THREE.Vector3();
  private readonly _faceWVec = new THREE.Vector3();
  private readonly _hX = new THREE.Vector3();
  private readonly _hY = new THREE.Vector3();
  private readonly _hZ = new THREE.Vector3();
  private readonly _hXOrtho = new THREE.Vector3();
  private readonly _earMid = new THREE.Vector3();
  private readonly _earVec = new THREE.Vector3();
  private readonly _neckTop = new THREE.Vector3();
  private readonly _sternumRoot = new THREE.Vector3();
  private readonly _neckDir = new THREE.Vector3();
  private readonly _upVec = new THREE.Vector3();

  private readonly _palmCenter = new THREE.Vector3();
  private readonly _palmUp = new THREE.Vector3();
  private readonly _palmSide = new THREE.Vector3();
  private readonly _pX = new THREE.Vector3();
  private readonly _pY = new THREE.Vector3();
  private readonly _pZ = new THREE.Vector3();
  private readonly _pXOrtho = new THREE.Vector3();
  private readonly _deltaVec = new THREE.Vector3();
  private readonly _virtKneeL = new THREE.Vector3();
  private readonly _virtKneeR = new THREE.Vector3();
  private readonly _virtFootL = new THREE.Vector3();
  private readonly _virtFootR = new THREE.Vector3();
  private readonly _pauldronPos = new THREE.Vector3();
  private readonly _upperDir = new THREE.Vector3();
  private readonly _foreDir = new THREE.Vector3();
  private readonly _fallbackElbowL = new THREE.Vector3();
  private readonly _fallbackWristL = new THREE.Vector3();
  private readonly _fallbackElbowR = new THREE.Vector3();
  private readonly _fallbackWristR = new THREE.Vector3();

  private readonly _lastHandPoints = {
    left: Array.from({ length: 21 }, () => new THREE.Vector3()),
    right: Array.from({ length: 21 }, () => new THREE.Vector3()),
  };
  private readonly _hasLastHand = { left: false, right: false };

  private readonly _synthHand = {
    left: Array.from({ length: 21 }, () => new THREE.Vector3()),
    right: Array.from({ length: 21 }, () => new THREE.Vector3()),
  };

  private readonly _fingerBases = [5, 9, 13, 17];
  private readonly _fingerTips = [8, 12, 16, 20];
  private readonly _fingerChains = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ];

  constructor(materials: Mark85MaterialLibrary) {
    this.mats = materials;

    this._buildHelmet();
    this._buildTorso();
    this._buildArms();
    this._buildHands();
    this._buildLegs();
    this._registerAllSockets();

    this.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.renderOrder = obj === this.faceOccluder ? 1 : 2;
      }
    });
  }

  public getSocketEntries(): ArmorSocketEntry[] {
    return this.socketEntries;
  }

  private _createSocket(
    id: ArmorSocketId,
    label: string,
    hostGroup: THREE.Group,
    targetSize: [number, number, number],
    proceduralNodes?: THREE.Object3D[]
  ): THREE.Group {
    const slotGroup = new THREE.Group();
    const proceduralRoot = new THREE.Group();
    const customRoot = new THREE.Group();

    if (proceduralNodes && proceduralNodes.length > 0) {
      for (const node of proceduralNodes) {
        proceduralRoot.add(node);
      }
    }
    slotGroup.add(proceduralRoot);
    slotGroup.add(customRoot);
    hostGroup.add(slotGroup);

    this.socketEntries.push({
      id,
      label,
      slotGroup,
      proceduralRoot,
      customRoot,
      targetSize: new THREE.Vector3(targetSize[0], targetSize[1], targetSize[2]),
      customSourceName: null,
    });
    return customRoot;
  }

  private _registerAllSockets(): void {
    const wrapChildren = (
      id: ArmorSocketId,
      label: string,
      host: THREE.Group,
      size: [number, number, number],
      skip?: THREE.Object3D
    ) => {
      const children = host.children.filter((c) => c !== skip);
      return this._createSocket(id, label, host, size, children);
    };

    wrapChildren('helmet_skull', 'Casque — Crâne & Arceaux', this.skullGroup, [0.95, 1.05, 1.0]);
    wrapChildren('helmet_faceplate', 'Casque — Visière / Masque', this.faceplateGroup, [0.72, 0.88, 0.45]);
    wrapChildren('helmet_jaw', 'Casque — Mâchoire & Menton', this.jawGroup, [0.85, 0.55, 0.85]);
    wrapChildren('neck', 'Collier Mécatronique', this.neckGroup, [1.0, 1.0, 0.95]);
    wrapChildren('back', 'Carapace Dorsale & Propulseurs', this.backAssembly, [1.05, 0.9, 0.45]);
    this._createSocket('chest', 'Plastron & Réacteur Arc', this.chestShellProc, [1.15, 0.92, 0.72], [...this.chestShellProc.children]);

    this.abCustomAnchor = new THREE.Group();
    this.root.add(this.abCustomAnchor);
    const abProcDummy = new THREE.Group();
    this.abCustomRoot = this._createSocket('abdomen', 'Abdomen — Lamelles', this.abCustomAnchor, [0.92, 0.9, 0.62], [abProcDummy]);
    wrapChildren('pelvis', 'Bassin & Hanches', this.pelvisGroup, [0.95, 0.52, 0.62]);

    wrapChildren('pauldron_left', 'Épaulette Gauche', this.leftArm.pauldron, [1.9, 1.4, 1.8]);
    wrapChildren('pauldron_right', 'Épaulette Droite', this.rightArm.pauldron, [1.9, 1.4, 1.8]);
    wrapChildren('upper_arm_left', 'Biceps Gauche', this.leftArm.upper, [1.9, 1.0, 1.9]);
    wrapChildren('upper_arm_right', 'Biceps Droit', this.rightArm.upper, [1.9, 1.0, 1.9]);
    wrapChildren('forearm_left', 'Avant-bras Gauche', this.leftArm.forearm, [1.85, 1.05, 1.85]);
    wrapChildren('forearm_right', 'Avant-bras Droit', this.rightArm.forearm, [1.85, 1.05, 1.85]);
    wrapChildren('gauntlet_left', 'Gantelet Gauche', this.leftHand.palm, [1.25, 1.25, 0.75]);
    wrapChildren('gauntlet_right', 'Gantelet Droit', this.rightHand.palm, [1.25, 1.25, 0.75]);

    wrapChildren('thigh_left', 'Cuisse Gauche', this.leftLeg.thigh, [1.95, 1.0, 1.95]);
    wrapChildren('thigh_right', 'Cuisse Droite', this.rightLeg.thigh, [1.95, 1.0, 1.95]);
    wrapChildren('shin_left', 'Tibia / Mollet Gauche', this.leftLeg.shin, [1.85, 1.0, 1.85]);
    wrapChildren('shin_right', 'Tibia / Mollet Droit', this.rightLeg.shin, [1.85, 1.0, 1.85]);
    wrapChildren('boot_left', 'Botte Gauche', this.leftLeg.boot, [1.5, 1.0, 1.75]);
    wrapChildren('boot_right', 'Botte Droite', this.rightLeg.boot, [1.5, 1.0, 1.75]);
  }

  private _registerAssembly(
    group: THREE.Object3D,
    explodeOffset: [number, number, number],
    explodeRot: [number, number, number],
    startT: number,
    endT: number
  ): THREE.Object3D {
    this.assemblyParts.push({
      group,
      restPos: [group.position.x, group.position.y, group.position.z],
      restRot: [group.rotation.x, group.rotation.y, group.rotation.z],
      explodeOffset,
      explodeRot,
      startT,
      endT,
    });
    return group;
  }

  private _buildHelmet(): void {
    this.helmetGroup = new THREE.Group();
    this.root.add(this.helmetGroup);

    // === 1. Cou blindé anatomique (y = 0 -> -1) ===
    this.neckGroup = new THREE.Group();
    this.root.add(this.neckGroup);

    const neckCoreGeo = createContouredArmorGeometry(
      [
        [0.0, 0.45, 0.43, 0.0, 0.88],
        [-0.32, 0.43, 0.41, 0.01, 0.88],
        [-0.68, 0.49, 0.45, 0.02, 0.86],
        [-1.0, 0.58, 0.49, 0.02, 0.84],
      ],
      24
    );
    this.neckGroup.add(new THREE.Mesh(neckCoreGeo, this.mats.undersuitGrid));

    const neckEndo = new THREE.Group();
    addBellowsStack(neckEndo, -0.09, -0.14, 6, 0.42, 0.028, this.mats, 1.02, 0.94);
    this.neckGroup.add(this._registerAssembly(neckEndo, [0, 0, -1.25], [0, 0, 0], 0.64, 0.78));

    const neckOuterArmor = new THREE.Group();
    for (const side of [-1, 1]) {
      const neckColumn = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = -0.06 - u * 0.86;
          const flare = smoothstep(0.45, 1.0, u) * 0.16;
          const ang = THREE.MathUtils.lerp(0.24, 1.45, v) * side;
          const rx = 0.45 + flare - d;
          const rz = 0.44 + flare * 0.45 - d;
          return [Math.sin(ang) * rx, y, Math.cos(ang) * rz];
        },
        this.mats.crimson,
        this.mats.gunmetal,
        this.mats.crimsonDark,
        10,
        10,
        0.032
      );
      neckOuterArmor.add(neckColumn);
    }
    const throatGuard = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = -0.18 - u * 0.72;
        const x = lat * THREE.MathUtils.lerp(0.18, 0.26, u);
        const z = 0.445 - lat * lat * 0.08 - d;
        return [x, y, z];
      },
      this.mats.gunmetal,
      this.mats.carbon,
      this.mats.titanium,
      8,
      10,
      0.03
    );
    neckOuterArmor.add(throatGuard);
    this.neckGroup.add(this._registerAssembly(neckOuterArmor, [0, -0.35, 1.45], [0.22, 0, 0], 0.68, 0.82));

    // === 2. Sous-couche balistique crânienne + moteurs d'oreille ===
    this.headWireCore = new THREE.Mesh(new THREE.SphereGeometry(0.40, 20, 16), this.mats.undersuitGrid);
    this.headWireCore.scale.set(0.84, 1.02, 0.86);
    this.headWireCore.position.set(0, 0.02, 0.0);
    this.helmetGroup.add(this._registerAssembly(this.headWireCore, [0, 0, 0], [0, 0, 0], 0.01, 0.12));

    const headEndoGroup = new THREE.Group();
    for (const side of [-1, 1]) {
      const earPod = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.095, 0.055, 20), this.mats.chrome);
      earPod.rotation.z = Math.PI * 0.5;
      earPod.position.set(side * 0.44, -0.03, -0.02);
      headEndoGroup.add(earPod);

      const templeArc = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.26), this.mats.titanium);
      templeArc.position.set(side * 0.42, 0.14, -0.04);
      templeArc.rotation.x = -0.35;
      headEndoGroup.add(templeArc);
    }
    const rearSpine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.38, 0.06), this.mats.titanium);
    rearSpine.position.set(0, -0.18, -0.45);
    rearSpine.rotation.x = 0.24;
    headEndoGroup.add(rearSpine);
    this.helmetGroup.add(this._registerAssembly(headEndoGroup, [0, 1.15, -1.35], [0, 0, 0], 0.68, 0.82));

    // === 3. Coque arrière + mâchoires latérales + triangles de nuque (Mark 85 / Reference wearable frame) ===
    this.skullGroup = new THREE.Group();
    this.helmetGroup.add(this.skullGroup);
    this.jawGroup = new THREE.Group();
    this.helmetGroup.add(this.jawGroup);

    const skullAssembly = new THREE.Group();
    const skullShell = createDualLoftedShellGroup(
      (u, v, d) => {
        const phi = THREE.MathUtils.lerp(Math.PI * 0.05, Math.PI * 0.75, 1.0 - u);
        const theta = THREE.MathUtils.lerp(Math.PI * 0.36, Math.PI * 1.64, v);
        const r = 0.482 - d;
        const x = Math.sin(phi) * Math.sin(theta) * r * 0.90;
        const y = Math.cos(phi) * r * 1.14 + 0.06;
        const z = Math.sin(phi) * Math.cos(theta) * r * 1.06 - 0.02;
        return [x, y, z];
      },
      this.mats.crimson,
      this.mats.crimsonInner,
      this.mats.crimsonDark,
      22,
      26,
      0.034
    );
    skullAssembly.add(skullShell);

    const crownCap = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const lon = THREE.MathUtils.lerp(0.18, Math.PI * 0.68, u);
        const halfAng = THREE.MathUtils.lerp(0.66, 0.84, Math.sin(u * Math.PI));
        const theta = lat * halfAng;
        const ridge = (1.0 - smoothstep(0.0, 0.22, Math.abs(lat))) * 0.018;
        const r = 0.478 + ridge - d;
        const x = Math.sin(lon) * Math.sin(theta) * r * 0.91;
        const y = Math.cos(lon) * r * 1.10 + 0.08;
        const z = Math.sin(lon) * Math.cos(theta) * r * 1.06 - 0.02;
        return [x, y, z];
      },
      this.mats.crimson,
      this.mats.crimsonInner,
      this.mats.crimsonDark,
      16,
      16,
      0.03
    );
    skullAssembly.add(crownCap);

    const crownVent = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = THREE.MathUtils.lerp(0.46, 0.54, u);
        const x = lat * THREE.MathUtils.lerp(0.08, 0.05, u);
        const z = THREE.MathUtils.lerp(0.10, -0.18, u) - lat * lat * 0.03 - d;
        return [x, y, z];
      },
      this.mats.gunmetal,
      this.mats.carbon,
      this.mats.titanium,
      6,
      8,
      0.022
    );
    skullAssembly.add(crownVent);

    const napeVentGeo = createExtrudedPlate(
      [
        [0.0, 0.052],
        [0.072, -0.018],
        [-0.032, -0.042],
      ],
      0.028,
      0.003
    );

    this.templeServos = [];
    for (const side of [-1, 1]) {
      const jawAssembly = new THREE.Group();
      const jawWrap = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(0.06, -0.49, u);
          const taper = THREE.MathUtils.lerp(1.0, 0.72, u);
          const ang = THREE.MathUtils.lerp(Math.PI * 0.56, Math.PI * 0.22, v);
          const rX = (0.455 - d) * taper;
          const rZ = (0.478 - d) * (0.95 + 0.05 * (1 - u));
          return [side * Math.sin(ang) * rX, y, Math.cos(ang) * rZ - 0.02];
        },
        this.mats.crimson,
        this.mats.gunmetal,
        this.mats.crimsonDark,
        14,
        12,
        0.032
      );
      jawAssembly.add(jawWrap);

      const jawTrim = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(0.02, -0.44, u);
          const taper = THREE.MathUtils.lerp(0.98, 0.74, u);
          const ang = THREE.MathUtils.lerp(Math.PI * 0.48, Math.PI * 0.35, v);
          const rX = (0.462 - d) * taper;
          const rZ = 0.474 - d;
          return [side * Math.sin(ang) * rX, y, Math.cos(ang) * rZ - 0.02];
        },
        this.mats.gold,
        this.mats.gunmetal,
        this.mats.titanium,
        8,
        6,
        0.018
      );
      jawAssembly.add(jawTrim);

      this.jawGroup.add(
        this._registerAssembly(jawAssembly, [side * 1.65, -0.35, 1.25], [0, side * 0.55, 0], 0.76, 0.89)
      );

      const napeVent = new THREE.Mesh(napeVentGeo, this.mats.emissiveCyan);
      napeVent.scale.x = side;
      napeVent.position.set(side * 0.21, -0.08, -0.445);
      napeVent.rotation.y = Math.PI - side * 0.35;
      napeVent.rotation.x = 0.12;
      skullAssembly.add(napeVent);

      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.12, 12), this.mats.gunmetal);
      hinge.position.set(side * 0.36, 0.21, 0.20);
      hinge.rotation.z = side * 0.22;
      hinge.rotation.x = -0.35;
      skullAssembly.add(hinge);
      this.templeServos.push(hinge);
    }

    const chinGuard = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = THREE.MathUtils.lerp(-0.39, -0.53, u);
        const wFactor = THREE.MathUtils.lerp(0.28, 0.165, u);
        const x = lat * wFactor;
        const z = 0.448 - lat * lat * 0.14 - u * 0.055 - d;
        return [x, y, z];
      },
      this.mats.crimson,
      this.mats.gunmetal,
      this.mats.crimsonDark,
      10,
      14,
      0.032
    );
    const chinGoldRim = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = THREE.MathUtils.lerp(-0.41, -0.48, u);
        const wFactor = THREE.MathUtils.lerp(0.18, 0.12, u);
        const x = lat * wFactor;
        const z = 0.456 - lat * lat * 0.08 - d;
        return [x, y, z];
      },
      this.mats.gold,
      this.mats.gunmetal,
      this.mats.titanium,
      6,
      10,
      0.018
    );
    const chinAssembly = new THREE.Group();
    chinAssembly.add(chinGuard, chinGoldRim);
    this.jawGroup.add(this._registerAssembly(chinAssembly, [0, -1.45, 1.85], [0.5, 0, 0], 0.80, 0.91));
    this.skullGroup.add(this._registerAssembly(skullAssembly, [0, 1.95, -1.65], [-0.45, 0, 0], 0.72, 0.87));

    // === 4. Armature crânienne ouverte mécatronique (visage & lunettes 100% dégagés, style mark86_frame_repulsor.png) ===
    this.openBrowCage = new THREE.Group();
    this.skullGroup.add(this.openBrowCage);

    const browCrimsonArch = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const absLat = Math.abs(lat);
        const archDip = Math.max(0, 0.045 - absLat * 0.18);
        const x = lat * 0.39;
        const y = THREE.MathUtils.lerp(0.32, 0.40, u) - archDip;
        const z = 0.415 - lat * lat * 0.22 - u * 0.055 - d;
        return [x, y, z];
      },
      this.mats.crimson,
      this.mats.gunmetal,
      this.mats.crimsonDark,
      8,
      20,
      0.024
    );
    this.openBrowCage.add(browCrimsonArch);

    const browGoldKeystone = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const absLat = Math.abs(lat);
        const x = lat * 0.34;
        const y = THREE.MathUtils.lerp(0.28, 0.34, u) - Math.max(0, 0.055 - absLat * 0.22);
        const z = 0.422 - lat * lat * 0.20 - u * 0.035 - d;
        return [x, y, z];
      },
      this.mats.gold,
      this.mats.gunmetal,
      this.mats.titanium,
      6,
      18,
      0.02
    );
    this.openBrowCage.add(browGoldKeystone);

    const crownArches = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const x = lat * 0.32;
        const y = THREE.MathUtils.lerp(0.43, 0.51, u);
        const z = 0.31 - lat * lat * 0.17 - u * 0.11 - d;
        return [x, y, z];
      },
      this.mats.gold,
      this.mats.gunmetal,
      this.mats.titanium,
      6,
      16,
      0.022
    );
    this.openBrowCage.add(crownArches);

    // Nervures courbes latérales + arête médiane reliant l'arceau frontal à la calotte supérieure
    for (const latSide of [-0.62, 0.0, 0.62]) {
      const ribCurve = createDualLoftedShellGroup(
        (u, v, d) => {
          const w = (v - 0.5) * (latSide === 0 ? 0.055 : 0.042);
          const x = latSide * THREE.MathUtils.lerp(0.32, 0.25, u) + w;
          const y = THREE.MathUtils.lerp(0.32, 0.49, u);
          const z = THREE.MathUtils.lerp(0.405 - Math.abs(latSide) * 0.10, 0.21 - Math.abs(latSide) * 0.07, u) - d;
          return [x, y, z];
        },
        latSide === 0 ? this.mats.gold : this.mats.crimson,
        this.mats.gunmetal,
        this.mats.titanium,
        8,
        6,
        0.022
      );
      this.openBrowCage.add(ribCurve);
    }

    this.faceOccluder = new THREE.Mesh(new THREE.SphereGeometry(0.40, 22, 18), this.mats.depthOccluder);
    this.faceOccluder.scale.set(0.84, 0.98, 0.78);
    this.faceOccluder.position.set(0, -0.02, 0.09);
    this.helmetGroup.add(this.faceOccluder);

    // === 5. Masque facial Champagne Gold sculpté (claque final Mark 42 / [H]) ===
    const faceplateAssembly = new THREE.Group();
    this.helmetGroup.add(
      this._registerAssembly(faceplateAssembly, [0, 2.05, 2.65], [-1.05, 0, 0], 0.85, 0.99)
    );

    this.faceplatePivot = new THREE.Group();
    this.faceplatePivot.position.set(0, 0.48, 0.24);
    faceplateAssembly.add(this.faceplatePivot);

    this.faceplateGroup = new THREE.Group();
    this.faceplateGroup.position.set(0, -0.48, -0.24);
    this.faceplatePivot.add(this.faceplateGroup);

    const maskShell = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const absLat = Math.abs(lat);
        const foreheadTop = 0.29 + 0.14 * smoothstep(0.14, 0.62, absLat) - 0.04 * smoothstep(0.76, 1.0, absLat);
        const y = THREE.MathUtils.lerp(-0.42, foreheadTop, u);
        const halfW = 0.182 + 0.175 * smoothstep(0.06, 0.54, u) - 0.07 * smoothstep(0.72, 1.0, u);
        const x = lat * halfW;

        let z =
          0.468 -
          absLat * absLat * (0.148 + 0.038 * u) -
          smoothstep(0.66, 1.0, u) * 0.11 -
          smoothstep(0.24, 0.0, u) * 0.035;

        // Cavités orbitales nettes pour accueillir les optiques cyan
        const eyeCenterU = 0.59 - (1.0 - absLat) * 0.055;
        const eyeBandV = Math.exp(-Math.pow((u - eyeCenterU) / 0.048, 2));
        const eyeSideU = smoothstep(0.14, 0.27, absLat) * (1.0 - smoothstep(0.66, 0.86, absLat));
        z -= 0.052 * eyeBandV * eyeSideU;

        // Arcade sourcilière agressive
        const browCenterU = eyeCenterU + 0.084;
        const browRidgeV = Math.exp(-Math.pow((u - browCenterU) / 0.038, 2));
        const browWide = smoothstep(0.04, 0.24, absLat) * (1.0 - smoothstep(0.68, 0.90, absLat));
        z += 0.022 * browRidgeV * browWide;

        // Arête nasale tendue + pli buccal gravé (sans barre flottante)
        const noseSpan =
          (1.0 - smoothstep(0.0, 0.15, absLat)) * smoothstep(0.26, 0.48, u) * (1.0 - smoothstep(0.62, 0.78, u));
        z += 0.028 * noseSpan * (1.0 - smoothstep(0.0, 0.13, absLat));

        const mouthCrease =
          Math.exp(-Math.pow((u - 0.165) / 0.018, 2)) * (1.0 - smoothstep(0.22, 0.52, absLat));
        z -= 0.018 * mouthCrease;

        // Facettes latérales de pommettes
        const cheekPlane =
          smoothstep(0.54, 0.92, absLat) * smoothstep(0.12, 0.48, u) * (1.0 - smoothstep(0.48, 0.66, u));
        z -= 0.022 * cheekPlane;

        return [x, y, z - d];
      },
      this.mats.gold,
      this.mats.gunmetal,
      this.mats.titanium,
      28,
      32,
      0.03
    );
    this.faceplateGroup.add(maskShell);

    const foreheadCrest = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = THREE.MathUtils.lerp(0.295, 0.46, u) + Math.abs(lat) * 0.04;
        const w = THREE.MathUtils.lerp(0.062, 0.148, smoothstep(0.0, 0.8, u));
        const x = lat * w;
        const z = 0.465 - lat * lat * 0.04 - smoothstep(0.2, 1.0, u) * 0.105 - d;
        return [x, y, z];
      },
      this.mats.crimson,
      this.mats.gunmetal,
      this.mats.crimsonDark,
      10,
      14,
      0.022
    );
    this.faceplateGroup.add(foreheadCrest);

    // Mentonnière sculptée Champagne Gold + jointure de mâchoire
    const chinGoldTip = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = THREE.MathUtils.lerp(-0.425, -0.34, u);
        const w = THREE.MathUtils.lerp(0.105, 0.155, u);
        const x = lat * w;
        const z = 0.448 - lat * lat * 0.06 - d;
        return [x, y, z];
      },
      this.mats.gold,
      this.mats.gunmetal,
      this.mats.titanium,
      6,
      10,
      0.018
    );
    this.faceplateGroup.add(chinGoldTip);

    for (const side of [-1, 1]) {
      const cheekVents = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(-0.28, -0.02, u);
          const x = side * THREE.MathUtils.lerp(0.21, 0.33, v) * THREE.MathUtils.lerp(0.80, 1.0, u);
          const z = 0.398 - (v - 0.28) * 0.08 - d;
          return [x, y, z];
        },
        this.mats.gunmetal,
        this.mats.carbon,
        this.mats.titanium,
        8,
        8,
        0.018
      );
      this.faceplateGroup.add(cheekVents);
    }

    const eyeSocketGeo = createExtrudedPlate(
      [
        [-0.084, 0.021],
        [0.080, 0.010],
        [0.068, -0.017],
        [-0.072, -0.012],
      ],
      0.02,
      0.004
    );
    const eyeLensGeo = createExtrudedPlate(
      [
        [-0.073, 0.014],
        [0.069, 0.006],
        [0.058, -0.012],
        [-0.062, -0.008],
      ],
      0.016,
      0.002
    );

    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(eyeSocketGeo, this.mats.gunmetal);
      socket.scale.x = side;
      socket.position.set(side * 0.128, 0.098, 0.436);
      socket.rotation.z = side * 0.20;
      socket.rotation.y = side * 0.22;
      this.faceplateGroup.add(socket);

      const lens = new THREE.Mesh(eyeLensGeo, this.mats.emissiveCyan);
      lens.scale.x = side;
      lens.position.set(side * 0.128, 0.097, 0.448);
      lens.rotation.z = side * 0.20;
      lens.rotation.y = side * 0.22;
      this.faceplateGroup.add(lens);
    }
  }

  private _buildTorso(): void {
    this.chestGroup = new THREE.Group();
    this.root.add(this.chestGroup);
    this.chestShellProc = new THREE.Group();
    this.chestGroup.add(this.chestShellProc);

    const chestCoreGeo = createContouredArmorGeometry(
      [
        [-0.62, 0.44, 0.29, 0.0, 0.84],
        [-0.20, 0.52, 0.34, 0.02, 0.84],
        [0.20, 0.59, 0.37, 0.03, 0.82],
        [0.48, 0.55, 0.31, 0.01, 0.85],
        [0.64, 0.35, 0.25, 0.0, 0.88],
      ],
      26
    );
    const chestUndersuit = new THREE.Mesh(chestCoreGeo, this.mats.undersuitGrid);
    this.chestShellProc.add(this._registerAssembly(chestUndersuit, [0, 0, 0], [0, 0, 0], 0.0, 0.14));

    // Baie endosquelette thoracique (fly-in autonome)
    const chestEndoBay = new THREE.Group();
    this.chestShellProc.add(this._registerAssembly(chestEndoBay, [0, 0.85, 2.25], [0, 0, 0], 0.48, 0.65));

    for (const side of [-1, 1]) {
      const hexShroud = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(-0.14, 0.36, u);
          const x = side * THREE.MathUtils.lerp(0.09, 0.44, v);
          const z = 0.31 - v * v * 0.14 - u * 0.04 - d;
          return [x, y, z];
        },
        this.mats.perforatedGrille,
        this.mats.carbon,
        this.mats.gunmetal,
        10,
        10,
        0.025
      );
      chestEndoBay.add(hexShroud);

      for (let h = 0; h < 3; h++) {
        const hoseCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.09, 0.12 + h * 0.06, 0.32),
          new THREE.Vector3(side * (0.24 + h * 0.05), 0.22 + h * 0.04, 0.31),
          new THREE.Vector3(side * 0.46, 0.18 - h * 0.07, 0.21),
        ]);
        const mat = h === 1 ? this.mats.cableAzure : this.mats.gunmetal;
        chestEndoBay.add(new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 16, 0.015, 7, false), mat));
      }

      for (let r = 0; r < 4; r++) {
        const ang = (r / 3) * 1.15 - 0.55;
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.026, 0.03), this.mats.chrome);
        strut.position.set(
          side * (0.17 + Math.cos(ang) * 0.07),
          0.085 + Math.sin(ang) * 0.13,
          0.335
        );
        strut.rotation.z = side * ang;
        chestEndoBay.add(strut);
      }

      const endoGear = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.03, 14), this.mats.brass);
      endoGear.rotation.x = Math.PI * 0.5;
      endoGear.position.set(side * 0.25, -0.05, 0.325);
      chestEndoBay.add(endoGear);
    }

    // Réacteur ARC & Bloc sternal
    this.arcReactorGroup = new THREE.Group();
    this.arcReactorGroup.position.set(0, 0.085, 0.372);
    this.chestShellProc.add(this._registerAssembly(this.arcReactorGroup, [0, 0.55, 2.55], [0, 0, 0], 0.52, 0.68));

    const arcHousing = new THREE.Mesh(
      createExtrudedPlate(
        [
          [-0.148, 0.118],
          [0.148, 0.118],
          [0.13, 0.015],
          [0.044, -0.138],
          [-0.044, -0.138],
          [-0.13, 0.015],
        ],
        0.048,
        0.012
      ),
      this.mats.gunmetal
    );
    this.arcReactorGroup.add(arcHousing);

    this.arcTurbineRing = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.016, 10, 24), this.mats.chrome);
    this.arcTurbineRing.position.z = 0.018;
    this.arcReactorGroup.add(this.arcTurbineRing);

    const arcBezel = new THREE.Mesh(
      createExtrudedPlate(
        [
          [-0.118, 0.092],
          [0.118, 0.092],
          [0.102, 0.012],
          [0.032, -0.108],
          [-0.032, -0.108],
          [-0.102, 0.012],
        ],
        0.036,
        0.008
      ),
      this.mats.titanium
    );
    arcBezel.position.z = 0.014;
    this.arcReactorGroup.add(arcBezel);

    this.arcCoreMesh = new THREE.Mesh(
      createExtrudedPlate(
        [
          [-0.088, 0.068],
          [0.088, 0.068],
          [0.075, 0.01],
          [0.02, -0.082],
          [-0.02, -0.082],
          [-0.075, 0.01],
        ],
        0.032,
        0.006
      ),
      this.mats.emissiveCyan
    );
    this.arcCoreMesh.position.z = 0.024;
    this.arcReactorGroup.add(this.arcCoreMesh);

    this.chestFlaps = [];
    this.ribPistons = [];
    for (const side of [-1, 1]) {
      const pecAssembly = new THREE.Group();
      this.chestShellProc.add(
        this._registerAssembly(
          pecAssembly,
          [side * 2.25, 0.72, 1.85],
          [0.25, side * -0.55, side * -0.35],
          0.56,
          0.75
        )
      );

      const pecFlap = new THREE.Group();
      pecAssembly.add(pecFlap);
      this.chestFlaps.push({ group: pecFlap, side });

      const pecPlate = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(-0.08, 0.42, u) - v * 0.05;
          const x = side * THREE.MathUtils.lerp(0.055 + (1 - u) * 0.035, 0.57 * (0.86 + 0.16 * u), v);
          const bulge = Math.sin(u * Math.PI * 0.88) * Math.sin(v * Math.PI * 0.85) * 0.075;
          const arcNotch = (1.0 - smoothstep(0.0, 0.34, v)) * smoothstep(0.16, 0.58, u) * 0.032;
          const z = 0.355 + bulge - arcNotch - v * v * 0.22 - u * 0.065 - d;
          return [x, y, z];
        },
        this.mats.crimson,
        this.mats.gunmetal,
        this.mats.crimsonDark,
        14,
        16,
        0.046
      );
      pecFlap.add(pecPlate);

      const pecLowerBezel = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(-0.10, -0.04, u) - v * 0.05;
          const x = side * THREE.MathUtils.lerp(0.08, 0.53, v);
          const z = 0.362 - v * v * 0.22 - d;
          return [x, y, z];
        },
        this.mats.gunmetal,
        this.mats.carbon,
        this.mats.titanium,
        6,
        12,
        0.024
      );
      pecFlap.add(pecLowerBezel);

      for (let rib = 0; rib < 3; rib++) {
        const ribY = -0.13 - rib * 0.068;
        const ribFin = createDualLoftedShellGroup(
          (u, v, d) => {
            const y = ribY + u * 0.045 - v * 0.03;
            const x = side * THREE.MathUtils.lerp(0.32, 0.49 - rib * 0.025, v);
            const z = 0.29 - v * 0.16 - d;
            return [x, y, z];
          },
          rib === 1 ? this.mats.gunmetal : this.mats.crimsonDark,
          this.mats.carbon,
          this.mats.titanium,
          6,
          8,
          0.022
        );
        pecAssembly.add(ribFin);
      }

      const trapAssembly = new THREE.Group();
      const trapMuscle = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(0.38, 0.64, u) - v * 0.14;
          const x = side * THREE.MathUtils.lerp(0.16, 0.52, v) * THREE.MathUtils.lerp(1.0, 0.72, u);
          const z = 0.22 - u * 0.14 - v * 0.11 - d;
          return [x, y, z];
        },
        this.mats.crimson,
        this.mats.carbon,
        this.mats.crimsonDark,
        8,
        10,
        0.042
      );
      trapAssembly.add(trapMuscle);
      this.chestShellProc.add(
        this._registerAssembly(trapAssembly, [side * 1.45, 1.55, -1.25], [-0.35, 0, 0], 0.60, 0.78)
      );

      const clavAssembly = new THREE.Group();
      const clavSilverShell = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(0.30, 0.52, u) - v * 0.06;
          const x = side * THREE.MathUtils.lerp(0.18, 0.56, v);
          const z = 0.31 - u * 0.16 - v * 0.14 - d;
          return [x, y, z];
        },
        this.mats.titanium,
        this.mats.gunmetal,
        this.mats.gunmetal,
        8,
        12,
        0.04
      );
      clavAssembly.add(clavSilverShell);

      const collarGoldPin = createDualLoftedShellGroup(
        (u, v, d) => {
          const lat = (v - 0.5) * 2.0;
          const y = THREE.MathUtils.lerp(0.37, 0.53, u);
          const x = side * THREE.MathUtils.lerp(0.17, 0.27, u) + lat * 0.032;
          const z = 0.28 - u * 0.10 - lat * lat * 0.015 - d;
          return [x, y, z];
        },
        this.mats.gold,
        this.mats.gunmetal,
        this.mats.titanium,
        6,
        6,
        0.022
      );
      clavAssembly.add(collarGoldPin);

      const clavVentFrame = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.018, 0.018), this.mats.gunmetal);
      clavVentFrame.position.set(side * 0.35, 0.365, 0.238);
      clavVentFrame.rotation.z = side * -0.22;
      clavVentFrame.rotation.y = side * 0.36;
      clavAssembly.add(clavVentFrame);

      const shoulderFrontGlow = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.005, 0.012), this.mats.emissiveCyan);
      shoulderFrontGlow.position.set(side * 0.35, 0.365, 0.242);
      shoulderFrontGlow.rotation.z = side * -0.22;
      shoulderFrontGlow.rotation.y = side * 0.36;
      clavAssembly.add(shoulderFrontGlow);

      this.chestShellProc.add(
        this._registerAssembly(clavAssembly, [side * 1.65, 1.45, 1.10], [-0.4, 0, side * -0.35], 0.58, 0.77)
      );

      const subPecAssembly = new THREE.Group();
      const subPecPlate = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(-0.28, -0.06, u);
          const x = side * THREE.MathUtils.lerp(0.08, 0.49, v);
          const z = 0.335 - v * v * 0.22 - (1 - u) * 0.03 - d;
          return [x, y, z];
        },
        this.mats.crimsonDark,
        this.mats.gunmetal,
        this.mats.titanium,
        8,
        10,
        0.038
      );
      subPecAssembly.add(subPecPlate);

      const underPecBezel = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.016, 0.018), this.mats.gunmetal);
      underPecBezel.position.set(side * 0.39, -0.02, 0.258);
      underPecBezel.rotation.z = side * -0.24;
      underPecBezel.rotation.y = side * 0.56;
      subPecAssembly.add(underPecBezel);

      const underPecCyanSlit = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.005, 0.012), this.mats.emissiveCyan);
      underPecCyanSlit.position.set(side * 0.39, -0.02, 0.262);
      underPecCyanSlit.rotation.z = side * -0.24;
      underPecCyanSlit.rotation.y = side * 0.56;
      subPecAssembly.add(underPecCyanSlit);

      this.chestShellProc.add(
        this._registerAssembly(subPecAssembly, [side * 1.85, -0.45, 1.55], [0, side * 0.4, 0], 0.50, 0.69)
      );

      addMachinedBolt(
        chestEndoBay,
        new THREE.Vector3(side * 0.47, -0.22, 0.19),
        new THREE.Vector3(side * 0.9, -0.05, 0.42),
        this.mats,
        0.048
      );

      const barrel = new THREE.Group();
      barrel.position.set(side * 0.45, -0.26, 0.13);
      barrel.rotation.z = side * 0.14;
      barrel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.040, 0.20, 14), this.mats.chrome));
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.20, 12), this.mats.brass);
      rod.position.y = -0.13;
      barrel.add(rod);
      chestEndoBay.add(barrel);
      this.ribPistons.push({ barrel, rod, side });
    }

    const sternalAssembly = new THREE.Group();
    this.chestShellProc.add(this._registerAssembly(sternalAssembly, [0, 1.65, 1.75], [-0.55, 0, 0], 0.62, 0.80));
    this.sternalHatch = new THREE.Group();
    sternalAssembly.add(this.sternalHatch);

    const sternalBridge = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = THREE.MathUtils.lerp(0.22, 0.49, u);
        const x = lat * THREE.MathUtils.lerp(0.08, 0.13, u);
        const z = 0.35 - u * 0.14 - lat * lat * 0.03 - d;
        return [x, y, z];
      },
      this.mats.gunmetal,
      this.mats.carbon,
      this.mats.titanium,
      8,
      8,
      0.032
    );
    this.sternalHatch.add(sternalBridge);

    // Carapace dorsale 360°
    this.backAssembly = new THREE.Group();
    const backShellHolder = new THREE.Group();
    for (const side of [-1, 1]) {
      const scapulaWing = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(-0.28, 0.46, u);
          const x = side * THREE.MathUtils.lerp(0.12 + (1 - u) * 0.04, 0.52, v);
          const z = -0.32 + v * v * 0.18 + (1 - Math.sin(u * Math.PI)) * 0.03 + d;
          return [x, y, z];
        },
        this.mats.crimson,
        this.mats.gunmetal,
        this.mats.crimsonDark,
        10,
        12,
        0.04
      );
      backShellHolder.add(scapulaWing);
    }
    const backGoldSpine = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = THREE.MathUtils.lerp(-0.34, 0.42, u);
        const w = THREE.MathUtils.lerp(0.08, 0.25, smoothstep(0.2, 1.0, u));
        const x = lat * w;
        const z = -0.335 + lat * lat * 0.05 + d;
        return [x, y, z];
      },
      this.mats.gold,
      this.mats.gunmetal,
      this.mats.titanium,
      10,
      10,
      0.036
    );
    backShellHolder.add(backGoldSpine);
    for (const side of [-1, 1]) {
      const thrusterPod = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.088, 0.22, 16), this.mats.gunmetal);
      thrusterPod.position.set(side * 0.19, 0.12, -0.34);
      thrusterPod.rotation.x = 0.24;
      backShellHolder.add(thrusterPod);

      const thrusterGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.04, 14), this.mats.emissiveCyan);
      thrusterGlow.position.set(side * 0.19, 0.03, -0.365);
      thrusterGlow.rotation.x = 0.24;
      backShellHolder.add(thrusterGlow);
    }
    this.backAssembly.add(this._registerAssembly(backShellHolder, [0, 0.65, -2.55], [0.35, 0, 0], 0.54, 0.72));
    this.chestGroup.add(this.backAssembly);

    // === 5 Lamelles abdominales articulées (compression & torsion naturelles sans espace nu) ===
    this.abBands = [];
    this.abBandProcGroups = [];
    const abCoreGeo = createContouredArmorGeometry(
      [
        [-0.14, 0.42, 0.28, 0, 0.85],
        [0.14, 0.44, 0.30, 0, 0.85],
      ],
      20
    );

    for (let i = 0; i < 5; i++) {
      const bandGroup = new THREE.Group();
      const s = 1.0 - i * 0.035;

      const core = new THREE.Mesh(abCoreGeo, this.mats.undersuitGrid);
      core.scale.set(s, 1.0, s);
      bandGroup.add(this._registerAssembly(core, [0, 0, 0], [0, 0, 0], 0.01, 0.14));

      const abPlates = new THREE.Group();
      const abChevron = createDualLoftedShellGroup(
        (u, v, d) => {
          const lat = (v - 0.5) * 2.0;
          const y = THREE.MathUtils.lerp(-0.075, 0.075, u) - Math.abs(lat) * 0.025;
          const x = lat * 0.26 * s;
          const z = (0.30 - lat * lat * 0.068) * s - d;
          return [x, y, z];
        },
        i % 2 === 0 ? this.mats.crimson : this.mats.crimsonDark,
        this.mats.gunmetal,
        this.mats.titanium,
        8,
        12,
        0.032
      );
      abPlates.add(abChevron);

      for (const side of [-1, 1]) {
        const oblique = createDualLoftedShellGroup(
          (u, v, d) => {
            const y = THREE.MathUtils.lerp(-0.075, 0.075, u);
            const ang = THREE.MathUtils.lerp(0.55, 1.48, v);
            const rx = 0.44 * s - d;
            const rz = 0.298 * s - d;
            return [side * Math.sin(ang) * rx, y, Math.cos(ang) * rz];
          },
          i % 2 === 1 ? this.mats.gunmetal : this.mats.gold,
          this.mats.gunmetal,
          this.mats.titanium,
          6,
          8,
          0.028
        );
        abPlates.add(oblique);
      }
      const revIdx = 4 - i;
      bandGroup.add(
        this._registerAssembly(abPlates, [0, -0.55, 2.05], [0.28, 0, 0], 0.34 + revIdx * 0.032, 0.46 + revIdx * 0.032)
      );

      this.root.add(bandGroup);
      this.abBands.push(bandGroup);
      this.abBandProcGroups.push(bandGroup);
    }

    // === Bassin & Évents latéraux ===
    this.pelvisGroup = new THREE.Group();
    this.root.add(this.pelvisGroup);

    const pelvisCore = new THREE.Mesh(
      createContouredArmorGeometry(
        [
          [-0.24, 0.34, 0.26, 0, 0.82],
          [0.02, 0.43, 0.30, 0, 0.85],
          [0.18, 0.41, 0.29, 0, 0.85],
        ],
        22
      ),
      this.mats.undersuitGrid
    );
    this.pelvisGroup.add(this._registerAssembly(pelvisCore, [0, 0, 0], [0, 0, 0], 0.01, 0.14));

    const pelvisShellAssembly = new THREE.Group();
    const pelvisFront = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = THREE.MathUtils.lerp(-0.22, 0.14, u);
        const w = THREE.MathUtils.lerp(0.14, 0.38, smoothstep(0.0, 0.75, u));
        const x = lat * w;
        const z = 0.30 - lat * lat * 0.095 - smoothstep(0.45, 0.0, u) * 0.04 - d;
        return [x, y, z];
      },
      this.mats.crimson,
      this.mats.gunmetal,
      this.mats.crimsonDark,
      10,
      14,
      0.036
    );
    pelvisShellAssembly.add(pelvisFront);

    for (const side of [-1, 1]) {
      const hipPod = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(-0.18, 0.14, u);
          const ang = THREE.MathUtils.lerp(0.75, 2.25, v);
          const rx = 0.435 - d;
          const rz = 0.28 - d;
          return [side * Math.sin(ang) * rx, y, Math.cos(ang) * rz];
        },
        this.mats.crimson,
        this.mats.gunmetal,
        this.mats.titanium,
        8,
        10,
        0.032
      );
      pelvisShellAssembly.add(hipPod);

      const hipServoDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.075, 22), this.mats.chrome);
      hipServoDrum.rotation.z = Math.PI * 0.5;
      hipServoDrum.position.set(side * 0.44, -0.07, 0.03);
      pelvisShellAssembly.add(hipServoDrum);

      const hipServoRing = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.016, 8, 22), this.mats.titanium);
      hipServoRing.rotation.y = Math.PI * 0.5;
      hipServoRing.position.set(side * 0.48, -0.07, 0.03);
      pelvisShellAssembly.add(hipServoRing);

      // Micro-évent latéral de hanche encastré (zéro bloc saillant)
      const hipVentHousing = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.046, 0.026), this.mats.gunmetal);
      hipVentHousing.position.set(side * 0.29, 0.06, 0.242);
      hipVentHousing.rotation.y = side * 0.52;
      hipVentHousing.rotation.z = side * -0.25;
      pelvisShellAssembly.add(hipVentHousing);

      const hipLed = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.032, 0.014), this.mats.emissiveCyan);
      hipLed.position.set(side * 0.292, 0.06, 0.246);
      hipLed.rotation.y = side * 0.52;
      hipLed.rotation.z = side * -0.25;
      pelvisShellAssembly.add(hipLed);
    }
    this.pelvisGroup.add(this._registerAssembly(pelvisShellAssembly, [0, -1.25, 1.95], [0.25, 0, 0], 0.28, 0.48));
  }

  private _buildArms(): void {
    const upperCoreGeo = createContouredArmorGeometry(
      [
        [0.0, 0.80, 0.82, 0, 0.88],
        [-0.50, 0.88, 0.90, 0, 0.86],
        [-0.98, 0.76, 0.78, 0, 0.9],
      ],
      20
    );
    const upperShellGeo = createContouredArmorGeometry(
      [
        [0.0, 0.96, 0.98, 0, 0.88],
        [-0.28, 1.09, 1.11, 0.02, 0.86],
        [-0.64, 0.99, 1.01, 0.01, 0.88],
        [-0.98, 0.86, 0.88, 0, 0.9],
      ],
      24
    );

    const buildSide = (isRight: boolean): ArmRig => {
      const sideSign = isRight ? 1 : -1;

      // 1. Épaulette Mark 85 multi-étage (Stage 1 gimbal -> Stage 2 deltoïde or)
      const pauldron = new THREE.Group();
      const shoulderCore = new THREE.Mesh(new THREE.SphereGeometry(0.84, 18, 14), this.mats.undersuitGrid);
      pauldron.add(this._registerAssembly(shoulderCore, [0, 0, 0], [0, 0, 0], 0.01, 0.14));

      const shoulderEndo = new THREE.Group();
      addBellowsStack(shoulderEndo, -0.14, -0.15, 4, 0.84, 0.08, this.mats, 1.0, 1.02);
      const gimbalRing = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.065, 10, 22), this.mats.chrome);
      gimbalRing.rotation.y = Math.PI * 0.5;
      shoulderEndo.add(gimbalRing);
      pauldron.add(
        this._registerAssembly(shoulderEndo, [sideSign * 1.95, 0.95, -0.65], [0, 0, sideSign * -0.45], 0.56, 0.72)
      );

      const pauldronOuter = new THREE.Group();
      const deltoidGoldCap = createDualLoftedShellGroup(
        (u, v, d) => {
          const phi = THREE.MathUtils.lerp(0.24, Math.PI * 0.66, u);
          const theta = THREE.MathUtils.lerp(-Math.PI * 0.46, Math.PI * 0.46, v);
          const dome = 1.0 + 0.07 * Math.sin(u * Math.PI);
          const r = 1.08 * dome - d;
          const x = sideSign * (0.14 + Math.sin(phi) * Math.cos(theta) * r * 0.94);
          const y = Math.cos(phi) * r * 0.90 - 0.12;
          const z = Math.sin(phi) * Math.sin(theta) * r * 0.98;
          return [x, y, z];
        },
        this.mats.gold,
        this.mats.gunmetal,
        this.mats.titanium,
        14,
        16,
        0.09
      );
      pauldronOuter.add(deltoidGoldCap);

      const deltoidTopHood = createDualLoftedShellGroup(
        (u, v, d) => {
          const phi = THREE.MathUtils.lerp(0.05, 0.48, u);
          const theta = THREE.MathUtils.lerp(-Math.PI * 0.42, Math.PI * 0.42, v);
          const r = 1.13 - d;
          const x = sideSign * (0.10 + Math.sin(phi) * Math.cos(theta) * r * 0.88);
          const y = Math.cos(phi) * r * 0.90 - 0.04;
          const z = Math.sin(phi) * Math.sin(theta) * r * 0.94;
          return [x, y, z];
        },
        this.mats.gunmetal,
        this.mats.carbon,
        this.mats.crimsonDark,
        8,
        12,
        0.068
      );
      pauldronOuter.add(deltoidTopHood);

      const deltoidCrimsonCap = createDualLoftedShellGroup(
        (u, v, d) => {
          const phi = THREE.MathUtils.lerp(0.18, 0.56, u);
          const theta = THREE.MathUtils.lerp(-Math.PI * 0.34, Math.PI * 0.34, v);
          const r = 1.155 - d;
          const x = sideSign * (0.12 + Math.sin(phi) * Math.cos(theta) * r * 0.90);
          const y = Math.cos(phi) * r * 0.89 - 0.08;
          const z = Math.sin(phi) * Math.sin(theta) * r * 0.94;
          return [x, y, z];
        },
        this.mats.crimson,
        this.mats.gunmetal,
        this.mats.titanium,
        10,
        12,
        0.055
      );
      pauldronOuter.add(deltoidCrimsonCap);

      // Rainure d'aération titane sombre sur l'épaulette (aucun bloc saillant)
      const shoulderSlitBezel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.36), this.mats.gunmetal);
      shoulderSlitBezel.position.set(sideSign * 0.62, 0.40, 0.0);
      shoulderSlitBezel.rotation.z = sideSign * -0.45;
      pauldronOuter.add(shoulderSlitBezel);

      addMachinedBolt(
        pauldronOuter,
        new THREE.Vector3(sideSign * 1.05, -0.24, 0.0),
        new THREE.Vector3(sideSign, 0, 0),
        this.mats,
        0.12
      );
      pauldron.add(
        this._registerAssembly(pauldronOuter, [sideSign * 2.55, 1.45, 0.95], [0, 0, sideSign * -0.55], 0.62, 0.80)
      );
      this.root.add(pauldron);

      // 2. Bicep : Sous-châssis chrome + coque musclée
      const upper = new THREE.Group();
      const upperGrid = new THREE.Mesh(upperCoreGeo, this.mats.undersuitGrid);
      upper.add(this._registerAssembly(upperGrid, [0, 0, 0], [0, 0, 0], 0.01, 0.14));

      const upperEndo = new THREE.Group();
      addBellowsStack(upperEndo, -0.78, -0.075, 4, 0.84, 0.065, this.mats, 1.0, 1.0);
      for (const zOff of [-0.72, 0.72]) {
        const pistonRod = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.78, 12), this.mats.chrome);
        pistonRod.position.set(sideSign * 0.45, -0.45, zOff * 0.45);
        upperEndo.add(pistonRod);
      }
      upper.add(this._registerAssembly(upperEndo, [sideSign * 1.65, 0.35, -0.45], [0, 0, 0], 0.50, 0.68));

      const upperOuter = new THREE.Group();
      upperOuter.add(new THREE.Mesh(upperShellGeo, this.mats.gold));
      const bicepSeamTrim = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = -0.24 - u * 0.56;
          const r = THREE.MathUtils.lerp(1.09, 0.95, u) - d;
          const ang = THREE.MathUtils.lerp(-0.48, 0.48, v);
          return [sideSign * Math.cos(ang) * r, y, Math.sin(ang) * r];
        },
        this.mats.gunmetal,
        this.mats.carbon,
        this.mats.titanium,
        8,
        8,
        0.055
      );
      upperOuter.add(bicepSeamTrim);
      const upperCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.84, 0.14, 18), this.mats.gunmetal);
      upperCuff.position.y = -0.9;
      upperOuter.add(upperCuff);
      upper.add(
        this._registerAssembly(upperOuter, [sideSign * 2.15, 0.55, 1.45], [0, sideSign * 0.45, 0], 0.58, 0.76)
      );
      this.root.add(upper);

      // 3. Articulation mécanique du coude + soufflets annelés continus
      const elbow = new THREE.Group();
      const elbowCore = new THREE.Group();
      elbowCore.add(new THREE.Mesh(new THREE.SphereGeometry(0.90, 18, 14), this.mats.bellows));
      addBellowsStack(elbowCore, 0.26, -0.095, 6, 0.86, 0.055, this.mats, 1.0, 1.0);
      const elbowDisk = new THREE.Mesh(new THREE.CylinderGeometry(0.94, 0.94, 0.64, 18), this.mats.chrome);
      elbowDisk.rotation.z = Math.PI * 0.5;
      elbowCore.add(elbowDisk);
      for (const s of [-1, 1]) {
        addMachinedBolt(
          elbowCore,
          new THREE.Vector3(s * 0.34, 0, 0),
          new THREE.Vector3(s, 0, 0),
          this.mats,
          0.26
        );
      }
      elbow.add(this._registerAssembly(elbowCore, [sideSign * 1.35, 0, -1.15], [0, 0, 0], 0.46, 0.64));

      const elbowCap = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(-0.42, 0.42, u);
          const ang = THREE.MathUtils.lerp(-0.75, 0.75, v);
          const bulge = Math.cos((u - 0.5) * Math.PI) * 0.16;
          const r = 0.90 + bulge - d;
          return [Math.sin(ang) * r, y, -Math.cos(ang) * r];
        },
        this.mats.crimson,
        this.mats.gunmetal,
        this.mats.crimsonDark,
        8,
        10,
        0.08
      );
      elbow.add(this._registerAssembly(elbowCap, [sideSign * 0.55, 0.25, -1.95], [0.45, 0, 0], 0.52, 0.70));
      this.root.add(elbow);

      // === 4. AVANT-BRAS MÉCATRONIQUE + MANCHETTE POIGNET ÉVASÉE ===
      const forearm = new THREE.Group();

      const foreCoreGeo = createContouredArmorGeometry(
        [
          [-0.02, 0.82, 0.86, 0, 0.86],
          [-0.35, 0.86, 0.90, 0.02, 0.84],
          [-0.75, 0.72, 0.76, 0.02, 0.85],
          [-1.04, 0.68, 0.70, 0, 0.88],
        ],
        20
      );
      const foreGrid = new THREE.Mesh(foreCoreGeo, this.mats.undersuitGrid);
      forearm.add(this._registerAssembly(foreGrid, [0, 0, 0], [0, 0, 0], 0.01, 0.14));

      const frameGroup = new THREE.Group();
      forearm.add(this._registerAssembly(frameGroup, [sideSign * 1.75, 0.25, -1.45], [0, 0, 0], 0.44, 0.62));

      const elbowRing = new THREE.Mesh(new THREE.TorusGeometry(0.90, 0.062, 10, 24), this.mats.chrome);
      elbowRing.rotation.x = Math.PI * 0.5;
      elbowRing.position.set(0, -0.14, 0);
      frameGroup.add(elbowRing);

      const midRing = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.052, 8, 22), this.mats.titanium);
      midRing.rotation.x = Math.PI * 0.5;
      midRing.position.set(0, -0.48, 0);
      frameGroup.add(midRing);

      // Turbine rotative dorsale inspirée de la Vidéo 2 (Iron Man 3 gauntlet bay)
      const turbineRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 8, 16), this.mats.emissiveCyan);
      turbineRing.position.set(0, -0.44, -0.78);
      frameGroup.add(turbineRing);

      const chassisRing = new THREE.Mesh(new THREE.TorusGeometry(0.71, 0.056, 10, 24), this.mats.chrome);
      chassisRing.rotation.x = Math.PI * 0.5;
      chassisRing.position.set(0, -0.92, 0);
      frameGroup.add(chassisRing);

      for (const sx of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.84, 0.13), this.mats.chrome);
        rail.position.set(sx * 0.76, -0.50, -0.35);
        rail.rotation.z = sx * -0.12;
        frameGroup.add(rail);

        const clevis = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 0.085, 16), this.mats.titanium);
        clevis.rotation.z = Math.PI * 0.5;
        clevis.position.set(sx * 0.72, -0.02, -0.24);
        frameGroup.add(clevis);

        const magCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.075, 16), this.mats.chrome);
        magCollar.rotation.x = Math.PI * 0.5;
        magCollar.position.set(sx * 0.42, -0.34, -0.80);
        frameGroup.add(magCollar);
      }

      const pcbBoard = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.32, 0.048), this.mats.gunmetal);
      pcbBoard.position.set(0, -0.52, -0.72);
      frameGroup.add(pcbBoard);
      for (let d = 0; d < 3; d++) {
        const diode = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.056, 10), this.mats.diodeBlue);
        diode.rotation.x = Math.PI * 0.5;
        diode.position.set(-0.14 + d * 0.14, -0.44, -0.74);
        frameGroup.add(diode);
      }

      const actuators: ActuatorAssembly[] = [];
      for (const sx of [-1, 1]) {
        const baseX = sx * 0.33;
        const baseY = -0.20;
        const hingeX = sx * 0.29;
        const hingeY = -0.84;

        const armPivot = new THREE.Group();
        armPivot.position.set(hingeX, hingeY, -0.74);
        const crank = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.23, 0.075), this.mats.brass);
        crank.position.set(0, 0.09, 0);
        armPivot.add(crank);
        addMachinedBolt(armPivot, new THREE.Vector3(0, 0, -0.045), new THREE.Vector3(0, 0, -1), this.mats, 0.06);
        frameGroup.add(armPivot);

        const cylPivot = new THREE.Group();
        cylPivot.position.set(baseX, baseY, -0.76);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.074, 0.080, 0.35, 12), this.mats.gunmetal);
        barrel.position.set(0, -0.18, 0);
        cylPivot.add(barrel);

        const rodMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.40, 12), this.mats.chrome);
        rodMesh.position.set(0, -0.44, 0);
        cylPivot.add(rodMesh);
        frameGroup.add(cylPivot);

        actuators.push({ armPivot, cylPivot, rodMesh, hingeX, hingeY, baseX, baseY });
      }

      const pulses: PulseRunner[] = [];
      for (const sx of [-1, 1]) {
        for (let m = 0; m < 3; m++) {
          const offsetX = sx * (0.21 + m * 0.15);
          const curve = new THREE.CatmullRomCurve3(
            [
              new THREE.Vector3(offsetX * 0.9, -0.10, -0.62),
              new THREE.Vector3(offsetX * 1.15, -0.32, -0.77 - m * 0.024),
              new THREE.Vector3(offsetX * 1.1, -0.62, -0.74 - m * 0.02),
              new THREE.Vector3(offsetX * 0.75, -0.90, -0.60),
            ],
            false,
            'centripetal'
          );
          const cableMat = m === 1 ? this.mats.cableAzure : m === 2 ? this.mats.cableRed : this.mats.cableBlue;
          const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.024, 7, false), cableMat);
          frameGroup.add(tube);

          if (m !== 2) {
            const pMesh = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 8), this.mats.pulseGlow);
            frameGroup.add(pMesh);
            pulses.push({ mesh: pMesh, curve, offset: (sx < 0 ? 0.32 : 0.0) + m * 0.45 });
          }
        }
      }
      addBellowsStack(frameGroup, -0.93, -0.045, 5, 0.68, 0.034, this.mats, 1.0, 0.96);

      // Coque palmaire cramoisie + manchette poignet évasée recouvrant totalement le poignet réel
      const palmForeAssembly = new THREE.Group();
      const palmShell = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = -0.04 - u * 1.02;
          const profileR = THREE.MathUtils.lerp(1.02, 0.78, u) + 0.06 * Math.sin(u * Math.PI) + smoothstep(0.84, 1.0, u) * 0.14;
          const angle = THREE.MathUtils.lerp(-Math.PI * 0.66, Math.PI * 0.66, v);
          const radX = profileR * 1.04 - d;
          const radZ = profileR * 1.08 - d;
          return [Math.sin(angle) * radX, y, Math.cos(angle) * radZ];
        },
        this.mats.crimson,
        this.mats.crimsonInner,
        this.mats.crimsonDark,
        10,
        14,
        0.09
      );
      palmForeAssembly.add(palmShell);

      const goldWristShell = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = -0.72 - u * 0.34;
          const r = THREE.MathUtils.lerp(0.84, 0.90, u) - d;
          const ang = THREE.MathUtils.lerp(-0.92, 0.92, v);
          return [Math.sin(ang) * r, y, Math.cos(ang) * r];
        },
        this.mats.gold,
        this.mats.gunmetal,
        this.mats.titanium,
        6,
        10,
        0.065
      );
      palmForeAssembly.add(goldWristShell);
      forearm.add(this._registerAssembly(palmForeAssembly, [sideSign * 1.65, 0.45, 2.35], [0.35, 0, 0], 0.46, 0.66));

      // Capot dorsal amovible double-paroi (fly-in autonome Mark 42 + [X] Inspection Méca)
      const dorsalAssembly = new THREE.Group();
      forearm.add(
        this._registerAssembly(dorsalAssembly, [sideSign * 1.85, 0.65, -2.45], [-0.45, 0, sideSign * 0.35], 0.49, 0.68)
      );

      const dorsalCover = new THREE.Group();
      dorsalAssembly.add(dorsalCover);
      const dorsalShell = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = -0.02 - u * 1.04;
          const profileR = THREE.MathUtils.lerp(1.08, 0.84, u) + 0.06 * Math.sin(u * Math.PI) + smoothstep(0.84, 1.0, u) * 0.14;
          const angle = THREE.MathUtils.lerp(Math.PI * 0.60, Math.PI * 1.40, v);
          const radX = profileR * 1.04 - d;
          const radZ = profileR * 1.10 - d;
          return [Math.sin(angle) * radX, y, Math.cos(angle) * radZ];
        },
        this.mats.crimson,
        this.mats.crimsonInner,
        this.mats.crimsonDark,
        12,
        14,
        0.085
      );
      dorsalCover.add(dorsalShell);

      const dorsalSpineFin = createDualLoftedShellGroup(
        (u, v, d) => {
          const lat = (v - 0.5) * 2.0;
          const y = -0.06 - u * 0.88;
          const x = lat * THREE.MathUtils.lerp(0.24, 0.18, u);
          const z = THREE.MathUtils.lerp(-1.10, -0.88, u) + lat * lat * 0.08 + d;
          return [x, y, z];
        },
        this.mats.gunmetal,
        this.mats.carbon,
        this.mats.titanium,
        8,
        8,
        0.045
      );
      dorsalCover.add(dorsalSpineFin);

      // Micro-fente optique encastrée dans la crête dorsale (aucun bloc saillant)
      const gauntletCyanSlit = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.24, 0.018), this.mats.emissiveCyan);
      gauntletCyanSlit.position.set(0, -0.54, -0.98);
      gauntletCyanSlit.rotation.x = 0.26;
      dorsalCover.add(gauntletCyanSlit);

      const dorsalLatch = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 14), this.mats.titanium);
      dorsalLatch.rotation.x = Math.PI * 0.5;
      dorsalLatch.position.set(sideSign * 0.12, -0.22, -0.96);
      dorsalCover.add(dorsalLatch);

      this.root.add(forearm);

      return { pauldron, upper, elbow, forearm, dorsalCover, actuators, pulses, chassisRing, turbineRing };
    };

    this.leftArm = buildSide(false);
    this.rightArm = buildSide(true);
  }

  private _buildHands(): void {
    // Phalange étendue à -1.18 (dépassement protecteur du bout des doigts) + volume complet anti-peau
    const buildPhalanxGeo = createContouredArmorGeometry(
      [
        [0.08, 0.94, 0.90, 0, 0.68],
        [-0.32, 1.12, 1.04, 0.03, 0.64],
        [-0.88, 1.00, 0.94, 0.02, 0.66],
        [-1.18, 0.72, 0.68, 0, 0.72],
      ],
      18
    );
    // Soufflet annelé sombre dense (4 nervures d'articulation, fidèle au gantelet mark86_frame_repulsor.png)
    const knuckleBellowsGeo = new THREE.CylinderGeometry(0.82, 0.82, 0.40, 14);
    const bellowsRidgeGeo = new THREE.TorusGeometry(0.84, 0.09, 8, 16);
    bellowsRidgeGeo.rotateX(Math.PI * 0.5);
    const hingePinGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.96, 10);
    hingePinGeo.rotateZ(Math.PI * 0.5);

    const buildHand = (): HandRig => {
      const group = new THREE.Group();
      this.root.add(group);

      const palm = new THREE.Group();
      // Sous-gant balistique étendu jusqu'au poignet + commissure du pouce (0% peau exposée)
      const palmCore = createContouredArmorGeometry(
        [
          [-0.86, 0.60, 0.30, 0, 0.68],
          [-0.45, 0.64, 0.30, 0, 0.66],
          [0.05, 0.68, 0.28, 0, 0.64],
          [0.62, 0.62, 0.25, 0, 0.68],
        ],
        20
      );
      const palmBase = new THREE.Mesh(palmCore, this.mats.undersuitGrid);
      palm.add(this._registerAssembly(palmBase, [0, 0, 0], [0, 0, 0], 0.02, 0.14));

      // Plaques palmaires biseautées cramoisies + soufflets de poignet évasés
      const palmArmorPlates = new THREE.Group();
      const palmShield = createDualLoftedShellGroup(
        (u, v, d) => {
          const lat = (v - 0.5) * 2.0;
          const y = THREE.MathUtils.lerp(-0.62, 0.54, u);
          const x = lat * THREE.MathUtils.lerp(0.60, 0.64, u);
          const z = 0.265 - lat * lat * 0.06 - d;
          return [x, y, z];
        },
        this.mats.crimson,
        this.mats.crimsonInner,
        this.mats.crimsonDark,
        10,
        12,
        0.048
      );
      palmArmorPlates.add(palmShield);

      // Garde latérale pour fermer la tranche de la main et la base du pouce
      for (const sx of [-1, 1]) {
        const edgeFairing = createDualLoftedShellGroup(
          (u, v, d) => {
            const y = THREE.MathUtils.lerp(-0.56, 0.48, u);
            const ang = THREE.MathUtils.lerp(0.32, 2.82, v) * sx;
            const rx = 0.64 - d;
            const rz = 0.29 - d;
            return [Math.sin(ang) * rx, y, Math.cos(ang) * rz];
          },
          this.mats.crimsonDark,
          this.mats.gunmetal,
          this.mats.crimson,
          8,
          10,
          0.04
        );
        palmArmorPlates.add(edgeFairing);
      }

      // Manchette & soufflet poignet couvrant la jonction avant-bras/paume sur toute flexion
      const wristArmorCuff = new THREE.Mesh(
        createContouredArmorGeometry(
          [
            [-0.48, 0.60, 0.29, 0, 0.70],
            [-0.86, 0.68, 0.34, 0, 0.70],
          ],
          20
        ),
        this.mats.crimsonDark
      );
      palmArmorPlates.add(wristArmorCuff);
      addBellowsStack(palmArmorPlates, -0.50, -0.09, 4, 0.62, 0.042, this.mats, 1.0, 0.54);

      palm.add(this._registerAssembly(palmArmorPlates, [0, -0.35, 1.55], [0.35, 0, 0], 0.48, 0.68));

      const dorsalAssembly = new THREE.Group();
      palm.add(this._registerAssembly(dorsalAssembly, [0, 0.75, -1.75], [-0.45, 0, 0], 0.52, 0.72));

      const dorsalCover = new THREE.Group();
      dorsalAssembly.add(dorsalCover);
      const dorsalShield = createDualLoftedShellGroup(
        (u, v, d) => {
          const lat = (v - 0.5) * 2.0;
          const y = THREE.MathUtils.lerp(-0.58, 0.54, u);
          const x = lat * THREE.MathUtils.lerp(0.58, 0.62, u);
          const z = -0.265 + lat * lat * 0.06 + d;
          return [x, y, z];
        },
        this.mats.crimson,
        this.mats.crimsonInner,
        this.mats.crimsonDark,
        10,
        12,
        0.048
      );
      dorsalCover.add(dorsalShield);

      const knuckleBridge = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.16, 0.28), this.mats.titanium);
      knuckleBridge.position.set(0, 0.50, -0.04);
      dorsalCover.add(knuckleBridge);

      const dorsalRing = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.07, 16), this.mats.titanium);
      dorsalRing.rotation.x = Math.PI * 0.5;
      dorsalRing.position.set(0, -0.02, -0.265);
      dorsalCover.add(dorsalRing);

      const dorsalEmitter = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.075, 16), this.mats.emissiveCyan);
      dorsalEmitter.rotation.x = Math.PI * 0.5;
      dorsalEmitter.position.set(0, -0.02, -0.27);
      dorsalCover.add(dorsalEmitter);

      // Répulseur palmaire radial encastré (style mark86_frame_repulsor.png : cœur blanc-cyan lisse dans anneau gunmetal)
      const repulsorHousing = new THREE.Group();
      repulsorHousing.position.set(0, -0.01, 0.23);

      const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.35, 0.06, 24), this.mats.gunmetal);
      bezel.rotation.x = Math.PI * 0.5;
      repulsorHousing.add(bezel);

      const chromeRing = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.032, 10, 24), this.mats.titanium);
      chromeRing.position.z = 0.022;
      repulsorHousing.add(chromeRing);

      const repulsorDiodeRing = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.018, 8, 22), this.mats.diodeBlue);
      repulsorDiodeRing.position.z = 0.028;
      repulsorHousing.add(repulsorDiodeRing);

      const repulsorCore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.195, 0.195, 0.036, 24),
        this.mats.emissiveCyan
      );
      repulsorCore.rotation.x = Math.PI * 0.5;
      repulsorCore.position.z = 0.026;
      repulsorHousing.add(repulsorCore);

      palm.add(this._registerAssembly(repulsorHousing, [0, 0.25, 1.35], [0, 0, 1.4], 0.54, 0.74));
      group.add(palm);

      const segments: PhalanxLink[] = [];
      for (let f = 0; f < 5; f++) {
        for (let s = 0; s < 3; s++) {
          const seg = new THREE.Group();
          const joint = new THREE.Group();
          joint.add(new THREE.Mesh(knuckleBellowsGeo, this.mats.bellows));
          for (const ry of [-0.14, -0.05, 0.04, 0.13]) {
            const ridge = new THREE.Mesh(bellowsRidgeGeo, this.mats.gunmetal);
            ridge.position.y = ry;
            joint.add(ridge);
          }
          joint.add(new THREE.Mesh(hingePinGeo, this.mats.chrome));
          seg.add(this._registerAssembly(joint, [0, 0, 0], [0, 0, 0], 0.44 + s * 0.04, 0.62 + s * 0.04));

          const outerCap = new THREE.Mesh(
            buildPhalanxGeo,
            s === 1 ? this.mats.crimsonDark : this.mats.crimson
          );
          seg.add(
            this._registerAssembly(
              outerCap,
              [0, 0.95, -1.35],
              [-0.45, 0, 0],
              0.58 + s * 0.04 + f * 0.014,
              0.76 + s * 0.04 + f * 0.014
            )
          );
          group.add(seg);
          segments.push({ group: seg, outerCap });
        }
      }

      return {
        group,
        palm,
        repulsorHousing,
        repulsorCore,
        repulsorDiodeRing,
        dorsalEmitter,
        dorsalCover,
        segments,
      };
    };

    this.leftHand = buildHand();
    this.rightHand = buildHand();
  }

  private _buildLegs(): void {
    const thighCoreGeo = createContouredArmorGeometry(
      [
        [0.0, 0.88, 0.88, 0, 0.85],
        [-0.45, 0.82, 0.84, 0, 0.85],
        [-0.96, 0.68, 0.72, 0, 0.88],
      ],
      18
    );
    const thighGeo = createContouredArmorGeometry(
      [
        [0.0, 1.04, 1.04, 0, 0.85],
        [-0.45, 0.96, 1.00, 0.03, 0.84],
        [-0.96, 0.78, 0.82, 0, 0.88],
      ],
      22
    );

    const shinCoreGeo = createContouredArmorGeometry(
      [
        [0.0, 0.80, 0.82, 0, 0.86],
        [-0.42, 0.76, 0.78, 0, 0.86],
        [-0.96, 0.62, 0.64, 0, 0.88],
      ],
      18
    );
    const shinGeo = createContouredArmorGeometry(
      [
        [0.0, 0.96, 0.98, 0, 0.85],
        [-0.42, 0.92, 0.96, 0.03, 0.84],
        [-0.96, 0.72, 0.76, 0, 0.88],
      ],
      22
    );

    const buildLeg = (isRight: boolean): LegRig => {
      const sideSign = isRight ? 1 : -1;
      const thigh = new THREE.Group();
      const thighUnder = new THREE.Mesh(thighCoreGeo, this.mats.undersuitGrid);
      thigh.add(this._registerAssembly(thighUnder, [0, 0, 0], [0, 0, 0], 0.01, 0.14));

      const thighStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.86, 12), this.mats.chrome);
      thighStrut.position.set(sideSign * 0.56, -0.48, 0.0);
      thigh.add(this._registerAssembly(thighStrut, [sideSign * 1.45, 0, -0.55], [0, 0, 0], 0.22, 0.38));

      const thighOuterShells = new THREE.Group();
      thighOuterShells.add(new THREE.Mesh(thighGeo, this.mats.gold));

      const thighOuterCrimson = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = -0.10 - u * 0.76;
          const r = THREE.MathUtils.lerp(1.07, 0.86, u) - d;
          const ang = THREE.MathUtils.lerp(0.65, 2.35, v) * sideSign;
          return [Math.sin(ang) * r, y, Math.cos(ang) * r];
        },
        this.mats.crimson,
        this.mats.gunmetal,
        this.mats.titanium,
        10,
        12,
        0.06
      );
      thighOuterShells.add(thighOuterCrimson);

      const thighCenterSeam = createDualLoftedShellGroup(
        (u, v, d) => {
          const lat = (v - 0.5) * 2.0;
          const y = -0.12 - u * 0.74;
          const x = lat * THREE.MathUtils.lerp(0.24, 0.16, u);
          const z = THREE.MathUtils.lerp(1.06, 0.84, u) - lat * lat * 0.08 - d;
          return [x, y, z];
        },
        this.mats.gunmetal,
        this.mats.carbon,
        this.mats.titanium,
        8,
        8,
        0.045
      );
      thighOuterShells.add(thighCenterSeam);
      thigh.add(
        this._registerAssembly(thighOuterShells, [sideSign * 2.25, -0.35, 1.85], [0, sideSign * 0.35, 0], 0.24, 0.44)
      );
      this.root.add(thigh);

      const knee = new THREE.Group();
      const kneeCore = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.90, 16), this.mats.chrome);
      knee.add(this._registerAssembly(kneeCore, [0, 0, -1.15], [0, 0, 0], 0.18, 0.34));

      const kneeCap = createDualLoftedShellGroup(
        (u, v, d) => {
          const lat = (v - 0.5) * 2.0;
          const y = THREE.MathUtils.lerp(-0.55, 0.65, u);
          const x = lat * THREE.MathUtils.lerp(0.42, 0.62, u);
          const z = 0.88 - lat * lat * 0.25 - (1 - Math.sin(u * Math.PI)) * 0.14 - d;
          return [x, y, z];
        },
        this.mats.gold,
        this.mats.gunmetal,
        this.mats.crimsonDark,
        8,
        10,
        0.075
      );
      knee.add(this._registerAssembly(kneeCap, [0, 0.45, 2.35], [-0.45, 0, 0], 0.20, 0.38));
      this.root.add(knee);

      const shin = new THREE.Group();
      const shinUnder = new THREE.Mesh(shinCoreGeo, this.mats.undersuitGrid);
      shin.add(this._registerAssembly(shinUnder, [0, 0, 0], [0, 0, 0], 0.01, 0.14));

      const shinShells = new THREE.Group();
      shinShells.add(new THREE.Mesh(shinGeo, this.mats.crimson));
      const shinCrest = createDualLoftedShellGroup(
        (u, v, d) => {
          const lat = (v - 0.5) * 2.0;
          const y = -0.10 - u * 0.76;
          const x = lat * 0.28;
          const z = THREE.MathUtils.lerp(0.95, 0.75, u) - lat * lat * 0.08 - d;
          return [x, y, z];
        },
        this.mats.crimsonDark,
        this.mats.gunmetal,
        this.mats.titanium,
        8,
        8,
        0.055
      );
      shinShells.add(shinCrest);
      // Ailette arrière de mollet (vue dos 360° réaliste)
      const calfArmorBack = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.48, 0.22), this.mats.gunmetal);
      calfArmorBack.position.set(0, -0.34, -0.84);
      calfArmorBack.rotation.x = 0.15;
      shinShells.add(calfArmorBack);

      shin.add(this._registerAssembly(shinShells, [sideSign * 1.85, -1.25, 2.45], [0.3, 0, 0], 0.14, 0.34));
      this.root.add(shin);

      const boot = new THREE.Group();
      const bootCore = createContouredArmorGeometry(
        [
          [0.0, 0.68, 0.78, 0.08, 0.78],
          [-0.5, 0.74, 0.96, 0.14, 0.72],
          [-0.95, 0.66, 0.88, 0.12, 0.72],
        ],
        18
      );
      const bootShellGroup = new THREE.Group();
      bootShellGroup.add(new THREE.Mesh(bootCore, this.mats.crimson));
      const bootSole = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.92, 0.34), this.mats.gunmetal);
      bootSole.position.set(0, -0.52, -0.62);
      bootShellGroup.add(bootSole);
      const bootReactorRing = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.055, 8, 16), this.mats.titanium);
      bootReactorRing.position.set(0, -0.52, -0.80);
      bootShellGroup.add(bootReactorRing);
      // Premières pièces Mark 42 à verrouiller dès l'impact au sol !
      boot.add(this._registerAssembly(bootShellGroup, [sideSign * 0.45, -2.45, 1.55], [0.45, 0, 0], 0.06, 0.25));
      this.root.add(boot);

      return { thigh, knee, shin, boot };
    };

    this.leftLeg = buildLeg(false);
    this.rightLeg = buildLeg(true);
  }

  private _updateAssemblyStates(suitProgress: number): void {
    if (suitProgress >= 0.995) {
      for (let i = 0; i < this.assemblyParts.length; i++) {
        const p = this.assemblyParts[i];
        p.group.visible = true;
        p.group.position.set(p.restPos[0], p.restPos[1], p.restPos[2]);
        p.group.rotation.set(p.restRot[0], p.restRot[1], p.restRot[2]);
        p.group.scale.setScalar(1.0);
      }
      return;
    }

    for (let i = 0; i < this.assemblyParts.length; i++) {
      const p = this.assemblyParts[i];
      if (suitProgress < p.startT) {
        p.group.visible = false;
        continue;
      }
      p.group.visible = true;
      const rawU = THREE.MathUtils.clamp((suitProgress - p.startT) / Math.max(p.endT - p.startT, 0.01), 0, 1);
      const lock = easeServoLock(rawU);
      const inv = 1.0 - lock;

      p.group.position.set(
        p.restPos[0] + p.explodeOffset[0] * inv,
        p.restPos[1] + p.explodeOffset[1] * inv,
        p.restPos[2] + p.explodeOffset[2] * inv
      );
      p.group.rotation.set(
        p.restRot[0] + p.explodeRot[0] * inv,
        p.restRot[1] + p.explodeRot[1] * inv,
        p.restRot[2] + p.explodeRot[2] * inv
      );
      const s = THREE.MathUtils.clamp(0.68 + 0.32 * lock, 0.5, 1.06);
      p.group.scale.setScalar(s);
    }
  }

  private _alignSegmentDownY(
    group: THREE.Object3D,
    pStart: THREE.Vector3,
    pEnd: THREE.Vector3,
    forwardHint: THREE.Vector3,
    scaleX: number,
    scaleZ: number,
    axialTwist = 0
  ): void {
    this._v1.subVectors(pEnd, pStart);
    const len = this._v1.length();
    if (len < 0.008) {
      group.visible = false;
      return;
    }
    group.visible = true;
    group.position.copy(pStart);

    this._yAxis.copy(this._v1).divideScalar(-len);
    this._zAxis.copy(forwardHint);
    this._xAxis.crossVectors(this._yAxis, this._zAxis);
    if (this._xAxis.lengthSq() < 1e-5) {
      this._xAxis.set(1, 0, 0);
    } else {
      this._xAxis.normalize();
    }
    this._zAxis.crossVectors(this._xAxis, this._yAxis).normalize();

    this._mat4.makeBasis(this._xAxis, this._yAxis, this._zAxis);
    group.quaternion.setFromRotationMatrix(this._mat4);
    if (Math.abs(axialTwist) > 1e-4) {
      group.rotateY(axialTwist);
    }
    group.scale.set(scaleX, len, scaleZ);
  }

  private _synthesizeHandFromPose(
    side: 'left' | 'right',
    wrist: THREE.Vector3,
    indexPt: THREE.Vector3,
    pinkyPt: THREE.Vector3,
    forwardHint: THREE.Vector3,
    shoulderWidth: number
  ): THREE.Vector3[] {
    const out = this._synthHand[side];
    out[0].copy(wrist);

    this._palmUp.subVectors(indexPt, wrist).add(this._v1.subVectors(pinkyPt, wrist)).multiplyScalar(0.5);
    if (this._palmUp.lengthSq() < 1e-5) {
      this._palmUp.set(0, -1, 0);
    }
    const len = Math.max(this._palmUp.length(), shoulderWidth * 0.16);
    this._palmUp.normalize();

    this._palmSide.subVectors(indexPt, pinkyPt);
    if (this._palmSide.lengthSq() < 1e-5) {
      this._palmSide.set(side === 'left' ? 1 : -1, 0, 0);
    }
    this._palmSide.normalize();

    const palmW = shoulderWidth * 0.16;
    out[5].copy(wrist).addScaledVector(this._palmUp, len * 0.72).addScaledVector(this._palmSide, palmW * 0.45);
    out[9].copy(wrist).addScaledVector(this._palmUp, len * 0.75);
    out[17].copy(wrist).addScaledVector(this._palmUp, len * 0.68).addScaledVector(this._palmSide, -palmW * 0.45);
    out[13].copy(out[9]).lerp(out[17], 0.5);

    out[1].copy(wrist).addScaledVector(this._palmUp, len * 0.25).addScaledVector(this._palmSide, palmW * 0.52);
    out[2].copy(out[1]).addScaledVector(this._palmUp, len * 0.22).addScaledVector(this._palmSide, palmW * 0.25);
    out[3].copy(out[2]).addScaledVector(this._palmUp, len * 0.18).addScaledVector(forwardHint, 0.015);
    out[4].copy(out[3]).addScaledVector(this._palmUp, len * 0.14).addScaledVector(forwardHint, 0.015);

    for (let f = 0; f < 4; f++) {
      const mcpIdx = 5 + f * 4;
      const mcp = out[mcpIdx];
      out[mcpIdx + 1].copy(mcp).addScaledVector(this._palmUp, len * 0.26).addScaledVector(forwardHint, 0.012);
      out[mcpIdx + 2].copy(out[mcpIdx + 1]).addScaledVector(this._palmUp, len * 0.18).addScaledVector(forwardHint, 0.025);
      out[mcpIdx + 3].copy(out[mcpIdx + 2]).addScaledVector(this._palmUp, len * 0.12).addScaledVector(forwardHint, 0.03);
    }

    return out;
  }

  update(calib: CalibrationEngine, dt: number, fitScale = 1.0, timeSec = 0, suitProgress = 1.0): void {
    if (!calib.hasPose) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    // 1. Cinématique multi-étage du Suit-Up (Grille Holo -> Endosquelette Chrome -> Coques Crimson/Or)
    this._updateAssemblyStates(suitProgress);

    const pts = calib.poseBank.points;
    const vis = calib.poseBank.visibility;

    const pNose = pts[0];
    const pEarL = pts[7];
    const pEarR = pts[8];
    const pSL = pts[11];
    const pSR = pts[12];
    const pEL = pts[13];
    const pER = pts[14];
    const pWL = pts[15];
    const pWR = pts[16];
    const pPL = pts[17];
    const pPR = pts[18];
    const pIL = pts[19];
    const pIR = pts[20];
    const pHL = pts[23];
    const pHR = pts[24];
    const pKL = pts[25];
    const pKR = pts[26];
    const pAL = pts[27];
    const pAR = pts[28];
    const pFL = pts[31];
    const pFR = pts[32];

    const shoulderMid = this._v2.addVectors(pSL, pSR).multiplyScalar(0.5);
    const hipMid = this._v3.addVectors(pHL, pHR).multiplyScalar(0.5);

    const mirrorSign = calib.isMirrored ? 1 : -1;
    this._shoulderVec.subVectors(pSR, pSL).multiplyScalar(mirrorSign);
    const rawShoulderW = Math.max(this._shoulderVec.length(), 0.16);
    const shoulderWidth = rawShoulderW * fitScale;
    const bodyWidthMul = calib.silhouetteChestWidthFactor;
    const waistWidthMul = calib.waistWidthFactor;
    const armGirthMul = calib.armGirthFactor;
    this._spineUp.subVectors(shoulderMid, hipMid);
    const torsoHeight = Math.max(this._spineUp.length(), shoulderWidth * 1.15);

    // Orientation 360° réelle du torse (AUCUN .negate() forcé : tourner le dos révèle la carapace dorsale !)
    this._chestX.copy(this._shoulderVec).normalize();
    this._chestY.copy(this._spineUp).normalize();
    this._chestZ.crossVectors(this._chestX, this._chestY).normalize();
    this._chestXOrtho.crossVectors(this._chestY, this._chestZ).normalize();
    this._mat4.makeBasis(this._chestXOrtho, this._chestY, this._chestZ);
    this._chestQuat.setFromRotationMatrix(this._mat4);

    // 2. Torse & Inspection mécatronique thoracique
    this._chestCenter.copy(shoulderMid).lerp(hipMid, 0.16);
    this.chestGroup.position.copy(this._chestCenter);
    this.chestGroup.quaternion.copy(this._chestQuat);
    this.chestGroup.scale.set(
      shoulderWidth * 1.18 * bodyWidthMul,
      torsoHeight * 0.64,
      shoulderWidth * 0.72 * bodyWidthMul
    );

    this.mechaInspectCurrent = THREE.MathUtils.damp(this.mechaInspectCurrent, this.mechaInspectTarget, 8.5, dt);
    const inspect = this.mechaInspectCurrent;
    for (let i = 0; i < this.chestFlaps.length; i++) {
      const flap = this.chestFlaps[i];
      flap.group.position.set(flap.side * inspect * 0.22, inspect * 0.11, inspect * 0.12);
      flap.group.rotation.set(-inspect * 0.18, flap.side * -inspect * 0.36, flap.side * inspect * 0.14);
    }
    this.sternalHatch.position.set(0, inspect * 0.16, inspect * 0.08);
    this.sternalHatch.rotation.set(-inspect * 0.38, 0, 0);
    this.arcTurbineRing.rotation.z = timeSec * (inspect > 0.1 || suitProgress < 0.95 ? 2.6 : 0.45);

    this.shoulderWorldPos.left.copy(pSL);
    this.shoulderWorldPos.right.copy(pSR);

    this.arcCoreMesh.getWorldPosition(this.arcWorldPos);
    this.mats.sharedUniforms.uArcOrigin.value.copy(this.arcWorldPos);
    this.mats.sharedUniforms.uBodyScale.value = shoulderWidth;

    this._hipVec.subVectors(pHR, pHL).multiplyScalar(mirrorSign).normalize();
    const torsoTwist = THREE.MathUtils.clamp(this._hipVec.dot(this._chestZ) * 2.0, -0.6, 0.6);
    for (const rp of this.ribPistons) {
      const comp = Math.sin(timeSec * 2.2) * 0.014 + rp.side * torsoTwist * 0.04;
      rp.rod.position.y = -0.13 + comp;
    }

    // 3. Bandes abdominales & Bassin (rotation 360° réelle sans inversion forcée)
    this._hipZ.crossVectors(this._hipVec, this._chestY).normalize();
    this._hipX.crossVectors(this._chestY, this._hipZ).normalize();
    this._mat4.makeBasis(this._hipX, this._chestY, this._hipZ);
    this._hipQuat.setFromRotationMatrix(this._mat4);

    const useCustomAb = this.abCustomRoot && this.abCustomRoot.children.length > 0;
    for (let i = 0; i < 5; i++) {
      const t = 0.34 + i * 0.118;
      const band = this.abBands[i];
      band.visible = !useCustomAb;
      band.position.copy(shoulderMid).lerp(hipMid, t);
      band.quaternion.slerpQuaternions(this._chestQuat, this._hipQuat, i / 4);
      const waistBlend = THREE.MathUtils.lerp(bodyWidthMul, waistWidthMul, i / 4);
      band.scale.set(shoulderWidth * 1.12 * waistBlend, torsoHeight * 0.44, shoulderWidth * 0.66 * waistBlend);
    }
    if (this.abCustomAnchor) {
      this.abCustomAnchor.visible = useCustomAb;
      this.abCustomAnchor.position.copy(shoulderMid).lerp(hipMid, 0.58);
      this.abCustomAnchor.quaternion.slerpQuaternions(this._chestQuat, this._hipQuat, 0.5);
      const waistBlendMid = THREE.MathUtils.lerp(bodyWidthMul, waistWidthMul, 0.5);
      this.abCustomAnchor.scale.set(shoulderWidth * 1.12 * waistBlendMid, torsoHeight * 0.48, shoulderWidth * 0.66 * waistBlendMid);
    }

    this.pelvisGroup.position.copy(hipMid);
    this.pelvisGroup.quaternion.copy(this._hipQuat);
    this.pelvisGroup.scale.set(shoulderWidth * 1.14 * waistWidthMul, torsoHeight * 0.50, shoulderWidth * 0.66 * waistWidthMul);

    // 4. Tête, cou & casque 360° (suit la rotation naturelle du crâne & dos)
    this._headCenter.copy(pNose);
    let headW = Math.max(calib.calibratedHeadW * 1.32, shoulderWidth * 0.45) * fitScale;
    let headH = Math.max(calib.calibratedHeadH * 1.28, shoulderWidth * 0.60) * fitScale;
    this._headQuat.copy(this._chestQuat);

    if (calib.hasFace && !calib.isBackFacing) {
      const fPts = calib.faceAnchorBank.points;
      const fTop = fPts[0];
      const fChin = fPts[1];
      const fLeft = fPts[2];
      const fRight = fPts[3];
      const fNoseTip = fPts[4];

      this._headCenter.addVectors(fTop, fChin).multiplyScalar(0.5);
      this._faceHVec.subVectors(fTop, fChin);
      this._faceWVec.subVectors(fRight, fLeft);
      headH = Math.max(this._faceHVec.length() * 1.28, shoulderWidth * 0.48) * fitScale;
      headW = Math.max(this._faceWVec.length() * 1.28, shoulderWidth * 0.42) * fitScale;

      this._hY.copy(this._faceHVec).normalize();
      this._hX.copy(this._faceWVec).normalize();
      this._hZ.crossVectors(this._hX, this._hY).normalize();

      // Aligne _hZ avec la vraie direction anatomique avant (milieu joues -> bout du nez) et jamais caméra forcée
      this._earMid.addVectors(fLeft, fRight).multiplyScalar(0.5);
      this._earVec.subVectors(fNoseTip, this._earMid);
      if (this._earVec.lengthSq() > 1e-6 && this._hZ.dot(this._earVec) < 0) {
        this._hZ.negate();
        this._hX.negate();
      }
      this._hXOrtho.crossVectors(this._hY, this._hZ).normalize();
      this._mat4.makeBasis(this._hXOrtho, this._hY, this._hZ);
      this._headQuat.setFromRotationMatrix(this._mat4);
      this._headCenter.addScaledVector(this._hZ, -headW * 0.25);
      this._headCenter.addScaledVector(this._hY, headH * 0.04);
    } else {
      // Vue profil fort ou vue arrière 180° : suit _chestQuat & l'axe des oreilles sans jamais retourner le casque à l'envers
      this._earMid.addVectors(pEarL, pEarR).multiplyScalar(0.5);
      this._earVec.subVectors(pEarR, pEarL).multiplyScalar(mirrorSign);
      if (this._earVec.lengthSq() > 0.002) {
        this._hX.copy(this._earVec).normalize();
        this._hY.copy(this._chestY);
        this._hZ.crossVectors(this._hX, this._hY).normalize();
        // Cohérence face/dos avec le torse quand le visage n'est plus visible
        if (this._hZ.dot(this._chestZ) < 0) {
          this._hZ.negate();
        }
        this._hXOrtho.crossVectors(this._hY, this._hZ).normalize();
        this._mat4.makeBasis(this._hXOrtho, this._hY, this._hZ);
        this._headQuat.setFromRotationMatrix(this._mat4);
        this._headCenter.copy(this._earMid).addScaledVector(this._hZ, calib.isBackFacing ? -headW * 0.05 : headW * 0.06);
      }
    }

    this.headWorldPos.copy(this._headCenter);
    this.helmetGroup.position.copy(this._headCenter);
    this.helmetGroup.quaternion.copy(this._headQuat);
    this.helmetGroup.scale.set(headW * 1.0, headH * 0.96, headW * 1.04);

    this._upVec.set(0, 1, 0).applyQuaternion(this._headQuat);
    this._neckTop.copy(this._headCenter).addScaledVector(this._upVec, -headH * 0.40);
    this._sternumRoot.copy(shoulderMid).addScaledVector(this._chestY, -torsoHeight * 0.06);
    this._neckDir.subVectors(this._sternumRoot, this._neckTop);
    if (this._neckDir.y > -0.015) {
      this._sternumRoot.copy(this._neckTop).addScaledVector(this._chestY, -Math.max(headH * 0.38, 0.09));
    }
    this._alignSegmentDownY(
      this.neckGroup,
      this._neckTop,
      this._sternumRoot,
      this._chestZ,
      shoulderWidth * 0.34,
      shoulderWidth * 0.32
    );

    this.helmetOpenCurrent = THREE.MathUtils.damp(this.helmetOpenCurrent, this.helmetOpenTarget, 9.0, dt);
    const open = this.helmetOpenCurrent;
    this.faceplatePivot.rotation.x = -open * 1.42;
    this.faceplatePivot.position.y = 0.48 + open * 0.16;
    this.faceplatePivot.position.z = 0.24 - open * 0.28;
    this.faceplateGroup.visible = open < 0.38;
    this.openBrowCage.visible = open > 0.12 && suitProgress > 0.85;
    this.faceOccluder.visible = open > 0.10;
    if (this.headWireCore.visible && (open > 0.08 || suitProgress >= 0.86)) {
      this.headWireCore.visible = false;
    }
    for (let i = 0; i < this.templeServos.length; i++) {
      this.templeServos[i].rotation.x = open * 0.48;
    }

    // 5. Bras complets verrouillés aux vrais poignets HandLandmarker (0 jour de peau au poignet!)
    const armRadius = shoulderWidth * 0.23 * armGirthMul;
    const forearmRadius = shoulderWidth * 0.205 * armGirthMul;
    const leftSideSign = calib.isMirrored ? -1 : 1;
    const rightSideSign = calib.isMirrored ? 1 : -1;

    const armLenUpper = shoulderWidth * 0.72;
    const armLenFore = shoulderWidth * 0.66;

    const effElbowL =
      vis[13] > 0.08
        ? pEL
        : this._fallbackElbowL
            .copy(pSL)
            .addScaledVector(this._chestY, -armLenUpper * 0.92)
            .addScaledVector(this._chestXOrtho, -armLenUpper * 0.25);
    const effWristL = calib.hasLeftHand
      ? calib.leftHandBank.points[0]
      : vis[15] > 0.08
        ? pWL
        : this._fallbackWristL
            .copy(effElbowL)
            .addScaledVector(this._chestY, -armLenFore * 0.9)
            .addScaledVector(this._chestZ, 0.08);

    const effElbowR =
      vis[14] > 0.08
        ? pER
        : this._fallbackElbowR
            .copy(pSR)
            .addScaledVector(this._chestY, -armLenUpper * 0.92)
            .addScaledVector(this._chestXOrtho, armLenUpper * 0.25);
    const effWristR = calib.hasRightHand
      ? calib.rightHandBank.points[0]
      : vis[16] > 0.08
        ? pWR
        : this._fallbackWristR
            .copy(effElbowR)
            .addScaledVector(this._chestY, -armLenFore * 0.9)
            .addScaledVector(this._chestZ, 0.08);

    const gripL = 1.0 - this.repulsorCharge.left * 0.85;
    const gripR = 1.0 - this.repulsorCharge.right * 0.85;

    this._updateArm(
      this.leftArm,
      leftSideSign,
      pSL,
      effElbowL,
      effWristL,
      this._chestZ,
      this._chestXOrtho,
      armRadius,
      forearmRadius,
      Math.max(vis[11], 0.4),
      Math.max(vis[13], 0.4),
      Math.max(vis[15], 0.4),
      gripL,
      timeSec,
      suitProgress,
      calib.kinematics.armTwistL,
      calib.kinematics.forearmTwistL
    );
    this._updateArm(
      this.rightArm,
      rightSideSign,
      pSR,
      effElbowR,
      effWristR,
      this._chestZ,
      this._chestXOrtho,
      armRadius,
      forearmRadius,
      Math.max(vis[12], 0.4),
      Math.max(vis[14], 0.4),
      Math.max(vis[16], 0.4),
      gripR,
      timeSec,
      suitProgress,
      calib.kinematics.armTwistR,
      calib.kinematics.forearmTwistR
    );

    // 6. Gantelets & 5 doigts articulés
    const synthLeft =
      !calib.hasLeftHand && vis[15] > 0.15
        ? this._synthesizeHandFromPose('left', pWL, pIL, pPL, this._chestZ, shoulderWidth)
        : null;
    const synthRight =
      !calib.hasRightHand && vis[16] > 0.15
        ? this._synthesizeHandFromPose('right', pWR, pIR, pPR, this._chestZ, shoulderWidth)
        : null;

    this._updateHand(
      'left',
      this.leftHand,
      calib.hasLeftHand ? calib.leftHandBank.points : synthLeft,
      effWristL,
      shoulderWidth,
      dt,
      calib.hasLeftHand,
      calib.isMirrored
    );
    this._updateHand(
      'right',
      this.rightHand,
      calib.hasRightHand ? calib.rightHandBank.points : synthRight,
      effWristR,
      shoulderWidth,
      dt,
      calib.hasRightHand,
      calib.isMirrored
    );

    // 7. Jambes & bottes complètes
    const thighRadius = shoulderWidth * 0.27;
    const estThighLen = torsoHeight * 0.74;
    this._virtKneeL.copy(pHL).addScaledVector(this._chestY, -estThighLen);
    this._virtKneeR.copy(pHR).addScaledVector(this._chestY, -estThighLen);

    const kneeL = vis[25] > 0.28 ? pKL : this._virtKneeL;
    const kneeR = vis[26] > 0.28 ? pKR : this._virtKneeR;

    this._virtFootL
      .copy(pAL)
      .addScaledVector(this._hipZ, shoulderWidth * 0.36)
      .addScaledVector(this._chestY, -shoulderWidth * 0.08);
    this._virtFootR
      .copy(pAR)
      .addScaledVector(this._hipZ, shoulderWidth * 0.36)
      .addScaledVector(this._chestY, -shoulderWidth * 0.08);
    const footL = vis[31] > 0.3 ? pFL : this._virtFootL;
    const footR = vis[32] > 0.3 ? pFR : this._virtFootR;

    this._updateLeg(
      this.leftLeg,
      pHL,
      kneeL,
      pAL,
      footL,
      this._hipZ,
      thighRadius,
      vis[25] > 0.28 ? vis[25] : 0.75,
      vis[27]
    );
    this._updateLeg(
      this.rightLeg,
      pHR,
      kneeR,
      pAR,
      footR,
      this._hipZ,
      thighRadius,
      vis[26] > 0.28 ? vis[26] : 0.75,
      vis[28]
    );

    // Ancre d'étincelles mécaniques Mark 42 selon la séquence d'arrimage en cours
    if (suitProgress < 0.24) {
      this.activeStageLabel = 'ARRIMAGE BOTTES & PROP.';
      this.activeClampAnchor.copy(footL).lerp(footR, 0.5);
    } else if (suitProgress < 0.46) {
      this.activeStageLabel = 'VERROUILLAGE JAMBES & BASSIN';
      this.activeClampAnchor.copy(kneeL).lerp(hipMid, 0.5);
    } else if (suitProgress < 0.66) {
      this.activeStageLabel = 'VERROUILLAGE AVANT-BRAS & GANTELETS';
      this.activeClampAnchor.copy(effWristL).lerp(effWristR, 0.5);
    } else if (suitProgress < 0.80) {
      this.activeStageLabel = 'ARRIMAGE TORSE & ÉPAULES';
      this.activeClampAnchor.copy(this.arcWorldPos);
    } else if (suitProgress < 0.99) {
      this.activeStageLabel = 'SCELLAGE CASQUE & VISIÈRE';
      this.activeClampAnchor.copy(this.headWorldPos);
    } else {
      this.activeStageLabel = 'ARMURE VERROUILLÉE 360°';
      this.activeClampAnchor.copy(this.arcWorldPos);
    }
  }

  private _updateArm(
    arm: ArmRig,
    sideSign: number,
    pShoulder: THREE.Vector3,
    pElbow: THREE.Vector3,
    pWrist: THREE.Vector3,
    forwardHint: THREE.Vector3,
    lateralHint: THREE.Vector3,
    rUpper: number,
    rFore: number,
    vS: number,
    vE: number,
    vW: number,
    gripVal: number,
    timeSec: number,
    suitProgress: number,
    upperTwist = 0,
    foreTwist = 0
  ): void {
    const showShoulder = vS > 0.05;
    const showUpper = vS > 0.05 && vE > 0.05;
    const showFore = vE > 0.05 && vW > 0.05;

    arm.pauldron.visible = showShoulder;
    if (showShoulder) {
      this._pauldronPos.copy(pShoulder).addScaledVector(lateralHint, sideSign * rUpper * 0.02);
      arm.pauldron.position.copy(this._pauldronPos);
      arm.pauldron.quaternion.copy(this.chestGroup.quaternion);
      arm.pauldron.scale.setScalar(rUpper * 1.04);
    }

    if (showUpper) {
      this._alignSegmentDownY(arm.upper, pShoulder, pElbow, forwardHint, rUpper, rUpper, upperTwist * 0.45);
      arm.elbow.visible = true;
      arm.elbow.position.copy(pElbow);
      arm.elbow.quaternion.copy(arm.upper.quaternion);
      arm.elbow.scale.setScalar(rUpper * 0.88);
    } else {
      arm.upper.visible = false;
      arm.elbow.visible = false;
    }

    if (showFore) {
      this._alignSegmentDownY(arm.forearm, pElbow, pWrist, forwardHint, rFore, rFore, foreTwist * 0.55);

      this._upperDir.subVectors(pShoulder, pElbow).normalize();
      this._foreDir.subVectors(pWrist, pElbow).normalize();
      const cosElbow = THREE.MathUtils.clamp(this._upperDir.dot(this._foreDir), -1, 1);
      const flexNorm = THREE.MathUtils.clamp((1.0 - cosElbow) * 0.45 + gripVal * 0.55, 0.08, 1.0);

      for (const act of arm.actuators) {
        const armAngle = -0.1 - 0.85 * flexNorm;
        act.armPivot.rotation.z = armAngle;
        const tipX = act.hingeX + 0.06 * Math.cos(armAngle) - 0.15 * Math.sin(armAngle);
        const tipY = act.hingeY + 0.06 * Math.sin(armAngle) + 0.15 * Math.cos(armAngle);
        const dx = tipX - act.baseX;
        const dy = tipY - act.baseY;
        act.cylPivot.rotation.z = Math.atan2(dy, dx) + Math.PI * 0.5;
        act.rodMesh.position.y = -Math.hypot(dx, dy) * 0.62;
      }

      const inspect = this.mechaInspectCurrent;
      arm.dorsalCover.position.set(sideSign * inspect * 0.35, inspect * 0.14, -inspect * 1.05);
      arm.dorsalCover.rotation.set(-inspect * 0.18, 0, sideSign * inspect * 0.14);
      arm.turbineRing.rotation.z = timeSec * 4.2;

      const pulseActive = inspect > 0.08 || suitProgress < 0.88 || 1.0 - gripVal > 0.35;
      for (const p of arm.pulses) {
        p.mesh.visible = pulseActive;
        if (pulseActive) {
          const t = (timeSec * 0.72 + p.offset) % 1;
          p.curve.getPointAt(t, p.mesh.position);
          p.mesh.scale.setScalar(0.85 + 0.35 * Math.sin(timeSec * 12.0 + p.offset));
        }
      }
    } else {
      arm.forearm.visible = false;
    }
  }

  private _updateHand(
    side: 'left' | 'right',
    handRig: HandRig,
    hPts: THREE.Vector3[] | null,
    poseWrist: THREE.Vector3,
    shoulderWidth: number,
    dt: number,
    realHandTracked: boolean,
    isMirrored = true
  ): void {
    let points = hPts;
    if (realHandTracked && hPts) {
      for (let i = 0; i < 21; i++) this._lastHandPoints[side][i].copy(hPts[i]);
      this._hasLastHand[side] = true;
    } else if (!points && this._hasLastHand[side]) {
      points = this._lastHandPoints[side];
      this._deltaVec.subVectors(poseWrist, points[0]);
      for (let i = 0; i < 21; i++) points[i].add(this._deltaVec);
    }

    if (!points) {
      handRig.group.visible = false;
      this.palmOpen[side] = false;
      this.repulsorCharge[side] = Math.max(0, this.repulsorCharge[side] - dt * 4);
      return;
    }

    handRig.group.visible = true;
    const wrist = points[0];
    const indexMcp = points[5];
    const middleMcp = points[9];
    const pinkyMcp = points[17];

    this._palmCenter.copy(wrist).add(indexMcp).add(pinkyMcp).divideScalar(3);

    this._palmUp.subVectors(middleMcp, wrist);
    const palmLen = Math.max(this._palmUp.length(), shoulderWidth * 0.18);
    this._palmSide.subVectors(indexMcp, pinkyMcp);
    const palmW = Math.max(this._palmSide.length(), shoulderWidth * 0.16);

    this._pY.copy(this._palmUp).normalize();
    this._pX.copy(this._palmSide).normalize();
    this._pZ.crossVectors(this._pX, this._pY).normalize();
    this._pXOrtho.crossVectors(this._pY, this._pZ).normalize();
    this._mat4.makeBasis(this._pXOrtho, this._pY, this._pZ);

    // Chiralité anatomique exacte : le répulseur reste TOUJOURS côté paume réelle, jamais sur le dos de la main !
    const palmLocalSign = (side === 'left') === isMirrored ? 1 : -1;

    handRig.palm.position.copy(this._palmCenter);
    handRig.palm.quaternion.setFromRotationMatrix(this._mat4);
    // Enveloppe palmaire 1.54x largeur, 1.34x longueur, 0.96x épaisseur -> occulte 100% la paume et les bords
    handRig.palm.scale.set(palmW * 1.54, palmLen * 1.34, palmW * 0.96);

    let extendedCount = 0;
    if (realHandTracked) {
      for (let f = 0; f < 4; f++) {
        const dTip = points[this._fingerTips[f]].distanceTo(wrist);
        const dBase = points[this._fingerBases[f]].distanceTo(wrist);
        if (dTip > dBase * 1.48) extendedCount++;
      }
    }

    this.palmWorldNormal[side].copy(this._pZ).multiplyScalar(palmLocalSign);
    const palmFacingCam = this.palmWorldNormal[side].z > 0.52;
    this.palmOpen[side] = realHandTracked && extendedCount >= 4 && palmFacingCam;

    handRig.repulsorHousing.position.z = palmLocalSign * 0.22;
    handRig.repulsorHousing.rotation.y = palmLocalSign < 0 ? Math.PI : 0;
    handRig.dorsalCover.position.z = (palmLocalSign > 0 ? 0 : 0.48) - this.mechaInspectCurrent * 0.24;
    handRig.dorsalCover.rotation.y = palmLocalSign < 0 ? Math.PI : 0;
    handRig.repulsorCore.getWorldPosition(this.palmWorldPos[side]);

    const targetCharge = this.palmOpen[side] ? 1.0 : 0.0;
    this.repulsorCharge[side] = THREE.MathUtils.damp(this.repulsorCharge[side], targetCharge, 10.0, dt);

    let segIdx = 0;
    for (let f = 0; f < 5; f++) {
      const chain = this._fingerChains[f];
      // Épaisseur blindée (1.55x) pour masquer 100% chaque doigt naturel sous les coques et soufflets
      const baseRadius = (f === 0 ? 0.255 : 0.212) * palmW;
      for (let s = 0; s < 3; s++) {
        const link = handRig.segments[segIdx++];
        const pA = points[chain[s]];
        const pB = points[chain[s + 1]];
        const r = baseRadius * (1.0 - s * 0.12);
        this._alignSegmentDownY(link.group, pA, pB, this._pZ, r, r);
      }
    }
  }

  private _updateLeg(
    leg: LegRig,
    pHip: THREE.Vector3,
    pKnee: THREE.Vector3,
    pAnkle: THREE.Vector3,
    pFoot: THREE.Vector3,
    forwardHint: THREE.Vector3,
    rThigh: number,
    vKnee: number,
    vAnkle: number
  ): void {
    if (vKnee > 0.28 && pKnee.y > -3.0) {
      this._alignSegmentDownY(leg.thigh, pHip, pKnee, forwardHint, rThigh, rThigh);
      leg.knee.visible = true;
      leg.knee.position.copy(pKnee);
      leg.knee.quaternion.copy(this.pelvisGroup.quaternion);
      leg.knee.scale.setScalar(rThigh * 0.88);
    } else {
      leg.thigh.visible = false;
      leg.knee.visible = false;
    }

    if (vKnee > 0.28 && vAnkle > 0.32) {
      this._alignSegmentDownY(leg.shin, pKnee, pAnkle, forwardHint, rThigh * 0.82, rThigh * 0.82);
      this._alignSegmentDownY(leg.boot, pAnkle, pFoot, this._chestY, rThigh * 0.68, rThigh * 0.65);
    } else {
      leg.shin.visible = false;
      leg.boot.visible = false;
    }
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    this.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
      }
    });
    geometries.forEach((g) => g.dispose());
  }
}
