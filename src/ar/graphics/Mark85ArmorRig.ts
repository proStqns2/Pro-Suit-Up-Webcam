import * as THREE from 'three';
import type { CalibrationEngine } from '../core/CalibrationEngine';
import type { Mark85MaterialLibrary } from './Mark85Materials';

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

  private readonly assemblyParts: AssemblyPart[] = [];

  private helmetGroup!: THREE.Group;
  private neckGroup!: THREE.Group;
  private headWireCore!: THREE.Mesh;
  private faceOccluder!: THREE.Mesh;
  private faceplatePivot!: THREE.Group;
  private faceplateGroup!: THREE.Group;
  private openBrowCage!: THREE.Group;
  private templeServos: THREE.Mesh[] = [];

  private chestGroup!: THREE.Group;
  private arcReactorGroup!: THREE.Group;
  private arcCoreMesh!: THREE.Mesh;
  private arcTurbineRing!: THREE.Mesh;
  private chestFlaps: ChestFlapRig[] = [];
  private sternalHatch!: THREE.Group;
  private ribPistons: RibPiston[] = [];
  private abBands: THREE.Group[] = [];
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

    this.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.renderOrder = obj === this.faceOccluder ? 1 : 2;
      }
    });
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
    this.neckGroup.add(this._registerAssembly(neckEndo, [0, 0, -0.18], [0, 0, 0], 0.14, 0.36));

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
    this.neckGroup.add(this._registerAssembly(neckOuterArmor, [0, -0.12, 0.22], [0.2, 0, 0], 0.48, 0.72));

    // === 2. Squelette crânien holographique + moteurs d'oreille ===
    this.headWireCore = new THREE.Mesh(new THREE.SphereGeometry(0.40, 20, 16), this.mats.undersuitGrid);
    this.headWireCore.scale.set(0.84, 1.02, 0.86);
    this.headWireCore.position.set(0, 0.02, 0.0);
    this.helmetGroup.add(this._registerAssembly(this.headWireCore, [0, 0, 0], [0, 0, 0], 0.04, 0.22));

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
    this.helmetGroup.add(this._registerAssembly(headEndoGroup, [0, 0.14, -0.25], [0, 0, 0], 0.22, 0.48));

    // === 3. Coque arrière + mâchoires latérales + triangles de nuque cyan ===
    const skullAssembly = new THREE.Group();
    const skullShell = createDualLoftedShellGroup(
      (u, v, d) => {
        const phi = THREE.MathUtils.lerp(Math.PI * 0.05, Math.PI * 0.74, 1.0 - u);
        const theta = THREE.MathUtils.lerp(Math.PI * 0.34, Math.PI * 1.66, v);
        const r = 0.485 - d;
        const x = Math.sin(phi) * Math.sin(theta) * r * 0.90;
        const y = Math.cos(phi) * r * 1.15 + 0.06;
        const z = Math.sin(phi) * Math.cos(theta) * r * 1.08 - 0.02;
        return [x, y, z];
      },
      this.mats.crimson,
      this.mats.crimsonInner,
      this.mats.crimsonDark,
      20,
      24,
      0.036
    );
    skullAssembly.add(skullShell);

    const crownCap = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const lon = THREE.MathUtils.lerp(0.16, Math.PI * 0.68, u);
        const halfAng = THREE.MathUtils.lerp(0.66, 0.84, Math.sin(u * Math.PI));
        const theta = lat * halfAng;
        const ridge = (1.0 - smoothstep(0.0, 0.24, Math.abs(lat))) * 0.022;
        const r = 0.480 + ridge - d;
        const x = Math.sin(lon) * Math.sin(theta) * r * 0.92;
        const y = Math.cos(lon) * r * 1.11 + 0.08;
        const z = Math.sin(lon) * Math.cos(theta) * r * 1.08 - 0.02;
        return [x, y, z];
      },
      this.mats.crimson,
      this.mats.crimsonInner,
      this.mats.crimsonDark,
      16,
      16,
      0.032
    );
    skullAssembly.add(crownCap);

    const napeVentGeo = createExtrudedPlate(
      [
        [0.0, 0.055],
        [0.075, -0.02],
        [-0.035, -0.045],
      ],
      0.03,
      0.003
    );

    this.templeServos = [];
    for (const side of [-1, 1]) {
      const jawAssembly = new THREE.Group();
      const jawWrap = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(0.08, -0.51, u);
          const taper = THREE.MathUtils.lerp(1.0, 0.72, u);
          const ang = THREE.MathUtils.lerp(Math.PI * 0.56, Math.PI * 0.18, v);
          const rX = (0.45 - d) * taper;
          const rZ = (0.48 - d) * (0.95 + 0.05 * (1 - u));
          return [side * Math.sin(ang) * rX, y, Math.cos(ang) * rZ - 0.02];
        },
        this.mats.crimson,
        this.mats.gunmetal,
        this.mats.crimsonDark,
        12,
        10,
        0.032
      );
      jawAssembly.add(jawWrap);
      this.helmetGroup.add(
        this._registerAssembly(jawAssembly, [side * 0.36, -0.10, 0.16], [0, side * 0.45, 0], 0.72, 0.87)
      );

      const napeVent = new THREE.Mesh(napeVentGeo, this.mats.emissiveCyan);
      napeVent.scale.x = side;
      napeVent.position.set(side * 0.21, -0.08, -0.455);
      napeVent.rotation.y = Math.PI - side * 0.35;
      napeVent.rotation.x = 0.12;
      skullAssembly.add(napeVent);

      const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.14, 0.09), this.mats.titanium);
      hinge.position.set(side * 0.35, 0.24, 0.24);
      skullAssembly.add(hinge);
      this.templeServos.push(hinge);
    }

    const chinGuard = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = THREE.MathUtils.lerp(-0.37, -0.54, u);
        const wFactor = THREE.MathUtils.lerp(0.30, 0.175, u);
        const x = lat * wFactor;
        const z = 0.445 - lat * lat * 0.15 - u * 0.055 - d;
        return [x, y, z];
      },
      this.mats.crimson,
      this.mats.gunmetal,
      this.mats.crimsonDark,
      10,
      14,
      0.034
    );
    const chinAssembly = new THREE.Group();
    chinAssembly.add(chinGuard);
    this.helmetGroup.add(this._registerAssembly(chinAssembly, [0, -0.35, 0.38], [0.45, 0, 0], 0.76, 0.90));
    this.helmetGroup.add(this._registerAssembly(skullAssembly, [0, 0.38, -0.32], [-0.35, 0, 0], 0.68, 0.85));

    // === 4. Cage frontale ouverte Mark 86 ([H]) ===
    this.openBrowCage = new THREE.Group();
    this.helmetGroup.add(this.openBrowCage);

    const browRib = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const x = lat * 0.36;
        const y = THREE.MathUtils.lerp(0.27, 0.35, u) + (1.0 - Math.abs(lat)) * 0.02;
        const z = 0.445 - lat * lat * 0.18 - u * 0.04 - d;
        return [x, y, z];
      },
      this.mats.gold,
      this.mats.gunmetal,
      this.mats.titanium,
      6,
      16,
      0.026
    );
    this.openBrowCage.add(browRib);

    const crownRib = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const x = lat * 0.32;
        const y = THREE.MathUtils.lerp(0.41, 0.49, u);
        const z = 0.36 - lat * lat * 0.15 - u * 0.08 - d;
        return [x, y, z];
      },
      this.mats.gold,
      this.mats.gunmetal,
      this.mats.titanium,
      6,
      14,
      0.024
    );
    this.openBrowCage.add(crownRib);

    for (const xPos of [-0.15, 0.0, 0.15]) {
      const strut = new THREE.Mesh(
        new THREE.BoxGeometry(xPos === 0 ? 0.052 : 0.04, 0.19, 0.03),
        xPos === 0 ? this.mats.gold : this.mats.crimson
      );
      strut.position.set(xPos, 0.36, 0.40 - Math.abs(xPos) * 0.35);
      strut.rotation.x = -0.44;
      strut.rotation.z = -xPos * 0.35;
      this.openBrowCage.add(strut);
    }

    this.faceOccluder = new THREE.Mesh(new THREE.SphereGeometry(0.40, 20, 16), this.mats.depthOccluder);
    this.faceOccluder.scale.set(0.84, 1.0, 0.78);
    this.faceOccluder.position.set(0, -0.02, 0.14);
    this.helmetGroup.add(this.faceOccluder);

    // === 5. Masque facial Champagne Gold (scelle en dernier Vidéo 3 & Vidéo 4!) ===
    const faceplateAssembly = new THREE.Group();
    this.helmetGroup.add(
      this._registerAssembly(faceplateAssembly, [0, 0.48, 0.45], [-0.85, 0, 0], 0.83, 0.98)
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
        const foreheadTop = 0.31 + 0.14 * smoothstep(0.14, 0.62, absLat) - 0.04 * smoothstep(0.75, 1.0, absLat);
        const y = THREE.MathUtils.lerp(-0.44, foreheadTop, u);
        const halfW = 0.195 + 0.175 * smoothstep(0.06, 0.52, u) - 0.07 * smoothstep(0.70, 1.0, u);
        const x = lat * halfW;

        let z =
          0.48 -
          absLat * absLat * (0.145 + 0.04 * u) -
          smoothstep(0.66, 1.0, u) * 0.11 -
          smoothstep(0.28, 0.0, u) * 0.04;

        const eyeCenterU = 0.59 - (1.0 - absLat) * 0.055;
        const eyeBandV = Math.exp(-Math.pow((u - eyeCenterU) / 0.052, 2));
        const eyeSideU = smoothstep(0.14, 0.28, absLat) * (1.0 - smoothstep(0.65, 0.86, absLat));
        z -= 0.055 * eyeBandV * eyeSideU;

        const browCenterU = eyeCenterU + 0.085;
        const browRidgeV = Math.exp(-Math.pow((u - browCenterU) / 0.04, 2));
        const browWide = smoothstep(0.05, 0.24, absLat) * (1.0 - smoothstep(0.68, 0.90, absLat));
        z += 0.022 * browRidgeV * browWide;

        const noseSpan =
          (1.0 - smoothstep(0.0, 0.17, absLat)) * smoothstep(0.26, 0.46, u) * (1.0 - smoothstep(0.62, 0.78, u));
        z += 0.030 * noseSpan * (1.0 - smoothstep(0.0, 0.14, absLat));

        const cheekPlane =
          smoothstep(0.54, 0.92, absLat) * smoothstep(0.12, 0.48, u) * (1.0 - smoothstep(0.48, 0.64, u));
        z -= 0.02 * cheekPlane;

        return [x, y, z - d];
      },
      this.mats.gold,
      this.mats.gunmetal,
      this.mats.titanium,
      26,
      30,
      0.034
    );
    this.faceplateGroup.add(maskShell);

    const foreheadCrest = createDualLoftedShellGroup(
      (u, v, d) => {
        const lat = (v - 0.5) * 2.0;
        const y = THREE.MathUtils.lerp(0.315, 0.47, u) + Math.abs(lat) * 0.04;
        const w = THREE.MathUtils.lerp(0.068, 0.155, smoothstep(0.0, 0.8, u));
        const x = lat * w;
        const z = 0.478 - lat * lat * 0.04 - smoothstep(0.2, 1.0, u) * 0.105 - d;
        return [x, y, z];
      },
      this.mats.crimson,
      this.mats.gunmetal,
      this.mats.crimsonDark,
      10,
      14,
      0.024
    );
    this.faceplateGroup.add(foreheadCrest);

    for (const side of [-1, 1]) {
      const cheekVents = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = THREE.MathUtils.lerp(-0.29, -0.02, u);
          const x = side * THREE.MathUtils.lerp(0.22, 0.34, v) * THREE.MathUtils.lerp(0.80, 1.0, u);
          const z = 0.405 - (v - 0.28) * 0.08 - d;
          return [x, y, z];
        },
        this.mats.gunmetal,
        this.mats.carbon,
        this.mats.titanium,
        8,
        8,
        0.02
      );
      this.faceplateGroup.add(cheekVents);
    }

    const mouthSlit = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.014, 0.024), this.mats.gunmetal);
    mouthSlit.position.set(0, -0.29, 0.468);
    mouthSlit.rotation.x = 0.08;
    this.faceplateGroup.add(mouthSlit);

    const eyeSocketGeo = createExtrudedPlate(
      [
        [-0.086, 0.024],
        [0.082, 0.012],
        [0.072, -0.020],
        [-0.074, -0.014],
      ],
      0.022,
      0.004
    );
    const eyeLensGeo = createExtrudedPlate(
      [
        [-0.076, 0.017],
        [0.072, 0.007],
        [0.062, -0.014],
        [-0.066, -0.009],
      ],
      0.018,
      0.002
    );

    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(eyeSocketGeo, this.mats.gunmetal);
      socket.scale.x = side;
      socket.position.set(side * 0.135, 0.105, 0.448);
      socket.rotation.z = side * 0.19;
      socket.rotation.y = side * 0.22;
      this.faceplateGroup.add(socket);

      const lens = new THREE.Mesh(eyeLensGeo, this.mats.emissiveCyan);
      lens.scale.x = side;
      lens.position.set(side * 0.135, 0.104, 0.460);
      lens.rotation.z = side * 0.19;
      lens.rotation.y = side * 0.22;
      this.faceplateGroup.add(lens);
    }
  }

  private _buildTorso(): void {
    this.chestGroup = new THREE.Group();
    this.root.add(this.chestGroup);

    // Stage 0 : Sous-combinaison holographique complète (Vidéo 3)
    const chestCoreGeo = createContouredArmorGeometry(
      [
        [-0.62, 0.42, 0.28, 0.0, 0.84],
        [-0.20, 0.51, 0.34, 0.02, 0.84],
        [0.20, 0.58, 0.37, 0.03, 0.82],
        [0.48, 0.54, 0.31, 0.01, 0.85],
        [0.64, 0.34, 0.24, 0.0, 0.88],
      ],
      26
    );
    const chestUndersuit = new THREE.Mesh(chestCoreGeo, this.mats.undersuitGrid);
    this.chestGroup.add(this._registerAssembly(chestUndersuit, [0, 0, 0], [0, 0, 0], 0.0, 0.18));

    // === Stage 1 : BAIE ENDOSQUELETTE THORACIQUE (VIDÉO 1 & VIDÉO 3) ===
    // Exposée pendant Stage 1 du Suit-Up ET lorsque l'utilisateur active [X] Inspection Méca !
    const chestEndoBay = new THREE.Group();
    this.chestGroup.add(this._registerAssembly(chestEndoBay, [0, 0.06, 0.16], [0, 0, 0], 0.10, 0.36));

    // Grille hexagonale perforée titane (exact look Vidéo 1 autour du réacteur ARC!)
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

      // Faisceau de câbles hydrauliques + tubes bleus sous-pectoraux (Vidéo 1)
      for (let h = 0; h < 3; h++) {
        const hoseCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.09, 0.12 + h * 0.06, 0.32),
          new THREE.Vector3(side * (0.24 + h * 0.05), 0.22 + h * 0.04, 0.31),
          new THREE.Vector3(side * 0.46, 0.18 - h * 0.07, 0.21),
        ]);
        const mat = h === 1 ? this.mats.cableAzure : this.mats.gunmetal;
        chestEndoBay.add(new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 16, 0.015, 7, false), mat));
      }

      // Ailerons mécaniques radiaux & pistons chrome autour du réacteur
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

      // Plaque d'engrenage dorée latérale (Vidéo 1 bas droit/gauche de la baie)
      const endoGear = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.03, 14), this.mats.brass);
      endoGear.rotation.x = Math.PI * 0.5;
      endoGear.position.set(side * 0.25, -0.05, 0.325);
      chestEndoBay.add(endoGear);
    }

    // === Réacteur ARC Mark 85 + Anneau turbine tournant (allumé dès le départ!) ===
    this.arcReactorGroup = new THREE.Group();
    this.arcReactorGroup.position.set(0, 0.085, 0.372);
    this.chestGroup.add(this._registerAssembly(this.arcReactorGroup, [0, 0, 0.25], [0, 0, 0], 0.02, 0.24));

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

    // === Stage 2 : Cuirasses pectorales articulées (Vidéo 1 ouverture mécanique [X] + Suit-Up fly-in!) ===
    this.chestFlaps = [];
    this.ribPistons = [];
    for (const side of [-1, 1]) {
      const pecAssembly = new THREE.Group();
      this.chestGroup.add(
        this._registerAssembly(
          pecAssembly,
          [side * 0.42, 0.14, 0.34],
          [0.15, side * -0.42, side * -0.18],
          0.38,
          0.62
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
      this.chestGroup.add(
        this._registerAssembly(trapAssembly, [side * 0.18, 0.32, -0.18], [-0.25, 0, 0], 0.44, 0.66)
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

      const collarGoldPin = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.16, 0.045), this.mats.gold);
      collarGoldPin.position.set(side * 0.24, 0.48, 0.21);
      collarGoldPin.rotation.z = side * -0.28;
      collarGoldPin.rotation.x = 0.55;
      clavAssembly.add(collarGoldPin);

      const shoulderFrontGlow = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.032, 0.04), this.mats.emissiveCyan);
      shoulderFrontGlow.position.set(side * 0.36, 0.37, 0.25);
      shoulderFrontGlow.rotation.z = side * -0.22;
      shoulderFrontGlow.rotation.y = side * 0.36;
      clavAssembly.add(shoulderFrontGlow);

      const shoulderBackGlow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.028, 0.045), this.mats.emissiveCyan);
      shoulderBackGlow.position.set(side * 0.32, 0.43, -0.18);
      shoulderBackGlow.rotation.z = side * 0.18;
      shoulderBackGlow.rotation.y = side * -0.28;
      clavAssembly.add(shoulderBackGlow);

      this.chestGroup.add(
        this._registerAssembly(clavAssembly, [side * 0.28, 0.35, 0.12], [-0.3, 0, side * -0.25], 0.40, 0.64)
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

      const underPecCyanSlit = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.04), this.mats.emissiveCyan);
      underPecCyanSlit.position.set(side * 0.39, -0.02, 0.275);
      underPecCyanSlit.rotation.z = side * -0.24;
      underPecCyanSlit.rotation.y = side * 0.56;
      subPecAssembly.add(underPecCyanSlit);
      this.chestGroup.add(
        this._registerAssembly(subPecAssembly, [side * 0.32, -0.12, 0.22], [0, side * 0.3, 0], 0.36, 0.58)
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

    // Capot sternal supérieur articulé (bascule vers le haut en [X] Inspection Méca comme Vidéo 1 !)
    const sternalAssembly = new THREE.Group();
    this.chestGroup.add(this._registerAssembly(sternalAssembly, [0, 0.35, 0.28], [-0.45, 0, 0], 0.44, 0.65));
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

    // Carapace dorsale (ailes cramoisies + épine or)
    const backAssembly = new THREE.Group();
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
      backAssembly.add(scapulaWing);
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
    backAssembly.add(backGoldSpine);
    this.chestGroup.add(this._registerAssembly(backAssembly, [0, 0.14, -0.40], [0.22, 0, 0], 0.36, 0.60));

    // === 4 Bandes abdominales séquentielles ===
    this.abBands = [];
    const abCoreGeo = createContouredArmorGeometry(
      [
        [-0.14, 0.41, 0.27, 0, 0.85],
        [0.14, 0.43, 0.29, 0, 0.85],
      ],
      20
    );

    for (let i = 0; i < 4; i++) {
      const bandGroup = new THREE.Group();
      const s = 1.0 - i * 0.042;

      const core = new THREE.Mesh(abCoreGeo, this.mats.undersuitGrid);
      core.scale.set(s, 1.0, s);
      bandGroup.add(this._registerAssembly(core, [0, 0, 0], [0, 0, 0], 0.04, 0.22));

      const abPlates = new THREE.Group();
      const abChevron = createDualLoftedShellGroup(
        (u, v, d) => {
          const lat = (v - 0.5) * 2.0;
          const y = THREE.MathUtils.lerp(-0.085, 0.085, u) - Math.abs(lat) * 0.026;
          const x = lat * 0.26 * s;
          const z = (0.292 - lat * lat * 0.068) * s - d;
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
            const y = THREE.MathUtils.lerp(-0.085, 0.085, u);
            const ang = THREE.MathUtils.lerp(0.55, 1.48, v);
            const rx = 0.435 * s - d;
            const rz = 0.29 * s - d;
            return [side * Math.sin(ang) * rx, y, Math.cos(ang) * rz];
          },
          this.mats.gold,
          this.mats.gunmetal,
          this.mats.titanium,
          6,
          8,
          0.028
        );
        abPlates.add(oblique);
      }
      bandGroup.add(
        this._registerAssembly(abPlates, [0, -0.08, 0.28], [0.22, 0, 0], 0.34 + i * 0.04, 0.54 + i * 0.04)
      );

      this.root.add(bandGroup);
      this.abBands.push(bandGroup);
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
    this.pelvisGroup.add(this._registerAssembly(pelvisCore, [0, 0, 0], [0, 0, 0], 0.05, 0.24));

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

      const hipLed = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.055, 0.045), this.mats.emissiveCyan);
      hipLed.position.set(side * 0.29, 0.06, 0.255);
      hipLed.rotation.y = side * 0.52;
      hipLed.rotation.z = side * -0.25;
      pelvisShellAssembly.add(hipLed);
    }
    this.pelvisGroup.add(this._registerAssembly(pelvisShellAssembly, [0, -0.22, 0.24], [0.2, 0, 0], 0.42, 0.65));
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
      pauldron.add(this._registerAssembly(shoulderCore, [0, 0, 0], [0, 0, 0], 0.05, 0.24));

      const shoulderEndo = new THREE.Group();
      addBellowsStack(shoulderEndo, -0.14, -0.15, 4, 0.84, 0.08, this.mats, 1.0, 1.02);
      const gimbalRing = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.065, 10, 22), this.mats.chrome);
      gimbalRing.rotation.y = Math.PI * 0.5;
      shoulderEndo.add(gimbalRing);
      pauldron.add(
        this._registerAssembly(shoulderEndo, [sideSign * 0.45, 0.15, 0], [0, 0, sideSign * -0.4], 0.18, 0.42)
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
      addMachinedBolt(
        pauldronOuter,
        new THREE.Vector3(sideSign * 1.05, -0.24, 0.0),
        new THREE.Vector3(sideSign, 0, 0),
        this.mats,
        0.12
      );
      pauldron.add(
        this._registerAssembly(pauldronOuter, [sideSign * 0.72, 0.42, 0.12], [0, 0, sideSign * -0.5], 0.45, 0.68)
      );
      this.root.add(pauldron);

      // 2. Bicep : Sous-châssis chrome + coque musclée Champagne Gold (Vidéo 3!)
      const upper = new THREE.Group();
      const upperGrid = new THREE.Mesh(upperCoreGeo, this.mats.undersuitGrid);
      upper.add(this._registerAssembly(upperGrid, [0, 0, 0], [0, 0, 0], 0.06, 0.24));

      const upperEndo = new THREE.Group();
      addBellowsStack(upperEndo, -0.78, -0.075, 4, 0.84, 0.065, this.mats, 1.0, 1.0);
      for (const zOff of [-0.72, 0.72]) {
        const pistonRod = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.78, 12), this.mats.chrome);
        pistonRod.position.set(sideSign * 0.45, -0.45, zOff * 0.45);
        upperEndo.add(pistonRod);
      }
      upper.add(this._registerAssembly(upperEndo, [sideSign * 0.45, 0, 0], [0, 0, 0], 0.22, 0.45));

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
        this._registerAssembly(upperOuter, [sideSign * 0.65, 0.08, 0.35], [0, sideSign * 0.35, 0], 0.48, 0.71)
      );
      this.root.add(upper);

      // 3. Articulation mécanique du coude
      const elbow = new THREE.Group();
      const elbowCore = new THREE.Group();
      elbowCore.add(new THREE.Mesh(new THREE.SphereGeometry(0.88, 18, 14), this.mats.gunmetal));
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
      elbow.add(this._registerAssembly(elbowCore, [sideSign * 0.3, 0, -0.3], [0, 0, 0], 0.24, 0.46));

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
      elbow.add(this._registerAssembly(elbowCap, [0, 0, -0.75], [0.4, 0, 0], 0.52, 0.74));
      this.root.add(elbow);

      // === 4. AVANT-BRAS MÉCATRONIQUE (Vidéo 2 & Vidéo 3!) ===
      const forearm = new THREE.Group();

      const foreCoreGeo = createContouredArmorGeometry(
        [
          [-0.02, 0.82, 0.86, 0, 0.86],
          [-0.35, 0.86, 0.90, 0.02, 0.84],
          [-0.75, 0.72, 0.76, 0.02, 0.85],
          [-0.98, 0.66, 0.68, 0, 0.88],
        ],
        20
      );
      const foreGrid = new THREE.Mesh(foreCoreGeo, this.mats.undersuitGrid);
      forearm.add(this._registerAssembly(foreGrid, [0, 0, 0], [0, 0, 0], 0.08, 0.26));

      // Châssis mécatronique interne (Stage 1 : anneaux chrome, turbines, pistons, PCB, câbles optiques!)
      const frameGroup = new THREE.Group();
      forearm.add(this._registerAssembly(frameGroup, [sideSign * 0.35, 0, -0.35], [0, 0, 0], 0.25, 0.50));

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

      // Coque palmaire cramoisie + manchette or (Stage 2 fly-in!)
      const palmForeAssembly = new THREE.Group();
      const palmShell = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = -0.05 - u * 0.91;
          const profileR = THREE.MathUtils.lerp(1.0, 0.70, u) + 0.05 * Math.sin(u * Math.PI);
          const angle = THREE.MathUtils.lerp(-Math.PI * 0.62, Math.PI * 0.62, v);
          const radX = profileR * 0.98 - d;
          const radZ = profileR * 1.04 - d;
          return [Math.sin(angle) * radX, y, Math.cos(angle) * radZ];
        },
        this.mats.crimson,
        this.mats.crimsonInner,
        this.mats.crimsonDark,
        10,
        14,
        0.085
      );
      palmForeAssembly.add(palmShell);

      const goldWristShell = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = -0.66 - u * 0.25;
          const r = THREE.MathUtils.lerp(0.81, 0.72, u) - d;
          const ang = THREE.MathUtils.lerp(-0.78, 0.78, v);
          return [Math.sin(ang) * r, y, Math.cos(ang) * r];
        },
        this.mats.gold,
        this.mats.gunmetal,
        this.mats.titanium,
        6,
        10,
        0.06
      );
      palmForeAssembly.add(goldWristShell);
      forearm.add(this._registerAssembly(palmForeAssembly, [0, 0.15, 0.85], [0.2, 0, 0], 0.56, 0.78));

      // Capot dorsal amovible double-paroi (fly-in en Stage 2 + s'ouvre en [X] Inspection Méca)
      const dorsalAssembly = new THREE.Group();
      forearm.add(
        this._registerAssembly(dorsalAssembly, [sideSign * 0.45, 0.18, -0.95], [-0.35, 0, sideSign * 0.25], 0.62, 0.84)
      );

      const dorsalCover = new THREE.Group();
      dorsalAssembly.add(dorsalCover);
      const dorsalShell = createDualLoftedShellGroup(
        (u, v, d) => {
          const y = -0.02 - u * 0.88;
          const profileR = THREE.MathUtils.lerp(1.06, 0.78, u) + 0.06 * Math.sin(u * Math.PI);
          const angle = THREE.MathUtils.lerp(Math.PI * 0.62, Math.PI * 1.38, v);
          const radX = profileR * 1.0 - d;
          const radZ = profileR * 1.08 - d;
          return [Math.sin(angle) * radX, y, Math.cos(angle) * radZ];
        },
        this.mats.crimson,
        this.mats.crimsonInner,
        this.mats.crimsonDark,
        12,
        14,
        0.08
      );
      dorsalCover.add(dorsalShell);

      const dorsalLatch = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 14), this.mats.titanium);
      dorsalLatch.rotation.x = Math.PI * 0.5;
      dorsalLatch.position.set(sideSign * 0.12, -0.22, -0.96);
      dorsalCover.add(dorsalLatch);

      this.root.add(forearm);

      return { pauldron, upper, elbow, forearm, dorsalCover, actuators, pulses, chassisRing, turbineRing };
    };

    this.leftArm = buildSide(true);
    this.rightArm = buildSide(false);
  }

  private _buildHands(): void {
    const buildPhalanxGeo = createContouredArmorGeometry(
      [
        [-0.08, 0.74, 0.74, 0, 0.74],
        [-0.30, 0.88, 0.86, 0.03, 0.68],
        [-0.76, 0.78, 0.76, 0.02, 0.70],
        [-0.98, 0.62, 0.60, 0, 0.76],
      ],
      14
    );
    const knuckleBellowsGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.24, 12);
    const hingePinGeo = new THREE.CylinderGeometry(0.17, 0.17, 1.62, 10);
    hingePinGeo.rotateZ(Math.PI * 0.5);

    const buildHand = (): HandRig => {
      const group = new THREE.Group();
      this.root.add(group);

      const palm = new THREE.Group();
      const palmCore = createContouredArmorGeometry(
        [
          [-0.45, 0.44, 0.17, 0, 0.76],
          [0.0, 0.50, 0.19, 0, 0.72],
          [0.45, 0.47, 0.17, 0, 0.76],
        ],
        16
      );
      const palmBase = new THREE.Mesh(palmCore, this.mats.undersuitGrid);
      palm.add(this._registerAssembly(palmBase, [0, 0, 0], [0, 0, 0], 0.10, 0.28));

      const dorsalAssembly = new THREE.Group();
      palm.add(this._registerAssembly(dorsalAssembly, [0, 0.25, -0.65], [-0.4, 0, 0], 0.60, 0.82));

      const dorsalCover = new THREE.Group();
      dorsalAssembly.add(dorsalCover);
      const dorsalShield = createDualLoftedShellGroup(
        (u, v, d) => {
          const lat = (v - 0.5) * 2.0;
          const y = THREE.MathUtils.lerp(-0.42, 0.44, u);
          const x = lat * THREE.MathUtils.lerp(0.46, 0.50, u);
          const z = -0.21 + lat * lat * 0.05 + d;
          return [x, y, z];
        },
        this.mats.crimson,
        this.mats.crimsonInner,
        this.mats.crimsonDark,
        8,
        10,
        0.045
      );
      dorsalCover.add(dorsalShield);

      const knuckleBridge = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.14, 0.20), this.mats.titanium);
      knuckleBridge.position.set(0, 0.42, -0.06);
      dorsalCover.add(knuckleBridge);

      const dorsalRing = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.07, 16), this.mats.titanium);
      dorsalRing.rotation.x = Math.PI * 0.5;
      dorsalRing.position.set(0, -0.02, -0.24);
      dorsalCover.add(dorsalRing);

      const dorsalEmitter = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.08, 16), this.mats.emissiveCyan);
      dorsalEmitter.rotation.x = Math.PI * 0.5;
      dorsalEmitter.position.set(0, -0.02, -0.245);
      dorsalCover.add(dorsalEmitter);

      const repulsorHousing = new THREE.Group();
      repulsorHousing.position.set(0, 0, 0.18);

      const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.31, 0.075, 22), this.mats.gunmetal);
      bezel.rotation.x = Math.PI * 0.5;
      repulsorHousing.add(bezel);

      const chromeRing = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.034, 10, 24), this.mats.chrome);
      chromeRing.position.z = 0.028;
      repulsorHousing.add(chromeRing);

      const repulsorDiodeRing = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.02, 8, 22), this.mats.diodeBlue);
      repulsorDiodeRing.position.z = 0.036;
      repulsorHousing.add(repulsorDiodeRing);

      const repulsorCore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.175, 0.175, 0.042, 22),
        this.mats.emissiveCyan
      );
      repulsorCore.rotation.x = Math.PI * 0.5;
      repulsorCore.position.z = 0.032;
      repulsorHousing.add(repulsorCore);

      for (let m = 0; m < 8; m++) {
        const a = (m * Math.PI) / 4;
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.045, 8), this.mats.chrome);
        pin.rotation.x = Math.PI * 0.5;
        pin.position.set(Math.cos(a) * 0.265, Math.sin(a) * 0.265, 0.032);
        repulsorHousing.add(pin);
      }

      palm.add(this._registerAssembly(repulsorHousing, [0, 0, 0.48], [0, 0, 1.4], 0.54, 0.74));
      group.add(palm);

      const segments: PhalanxLink[] = [];
      for (let f = 0; f < 5; f++) {
        for (let s = 0; s < 3; s++) {
          const seg = new THREE.Group();
          const joint = new THREE.Group();
          joint.add(new THREE.Mesh(knuckleBellowsGeo, this.mats.bellows));
          joint.add(new THREE.Mesh(hingePinGeo, this.mats.chrome));
          seg.add(this._registerAssembly(joint, [0, 0, 0], [0, 0, 0], 0.28 + s * 0.05, 0.44 + s * 0.05));

          const outerCap = new THREE.Mesh(
            buildPhalanxGeo,
            s === 1 ? this.mats.crimsonDark : this.mats.crimson
          );
          seg.add(
            this._registerAssembly(
              outerCap,
              [0, 0.35, -0.55],
              [-0.4, 0, 0],
              0.66 + s * 0.04 + f * 0.012,
              0.80 + s * 0.04 + f * 0.012
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
      thigh.add(this._registerAssembly(thighUnder, [0, 0, 0], [0, 0, 0], 0.06, 0.25));

      const thighStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.86, 12), this.mats.chrome);
      thighStrut.position.set(sideSign * 0.56, -0.48, 0.0);
      thigh.add(this._registerAssembly(thighStrut, [sideSign * 0.45, 0, 0], [0, 0, 0], 0.26, 0.48));

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
        this._registerAssembly(thighOuterShells, [sideSign * 0.42, 0.05, 0.45], [0, sideSign * 0.3, 0], 0.48, 0.72)
      );
      this.root.add(thigh);

      const knee = new THREE.Group();
      const kneeCore = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.90, 16), this.mats.chrome);
      knee.add(this._registerAssembly(kneeCore, [0, 0, -0.35], [0, 0, 0], 0.28, 0.50));

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
      knee.add(this._registerAssembly(kneeCap, [0, 0.2, 0.75], [-0.45, 0, 0], 0.54, 0.75));
      this.root.add(knee);

      const shin = new THREE.Group();
      const shinUnder = new THREE.Mesh(shinCoreGeo, this.mats.undersuitGrid);
      shin.add(this._registerAssembly(shinUnder, [0, 0, 0], [0, 0, 0], 0.08, 0.26));

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
      shin.add(this._registerAssembly(shinShells, [sideSign * 0.35, -0.1, 0.55], [0.25, 0, 0], 0.54, 0.77));
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
      boot.add(this._registerAssembly(bootShellGroup, [0, -0.45, 0.35], [0.4, 0, 0], 0.58, 0.80));
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
    scaleZ: number
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

    this._shoulderVec.subVectors(pSR, pSL);
    const rawShoulderW = Math.max(this._shoulderVec.length(), 0.16);
    const shoulderWidth = rawShoulderW * fitScale;
    const bodyWidthMul = calib.silhouetteChestWidthFactor;
    this._spineUp.subVectors(shoulderMid, hipMid);
    const torsoHeight = Math.max(this._spineUp.length(), shoulderWidth * 1.15);

    this._chestX.copy(this._shoulderVec).normalize();
    this._chestY.copy(this._spineUp).normalize();
    this._chestZ.crossVectors(this._chestX, this._chestY).normalize();
    if (this._chestZ.z < 0) {
      this._chestZ.negate();
      this._chestX.negate();
    }
    this._chestXOrtho.crossVectors(this._chestY, this._chestZ).normalize();
    this._mat4.makeBasis(this._chestXOrtho, this._chestY, this._chestZ);
    this._chestQuat.setFromRotationMatrix(this._mat4);

    // 2. Torse & Inspection mécatronique thoracique (Vidéo 1 : pectoraux glissent & s'écartent!)
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

    this._hipVec.subVectors(pHR, pHL).normalize();
    const torsoTwist = THREE.MathUtils.clamp(this._hipVec.dot(this._chestZ) * 2.0, -0.6, 0.6);
    for (const rp of this.ribPistons) {
      const comp = Math.sin(timeSec * 2.2) * 0.014 + rp.side * torsoTwist * 0.04;
      rp.rod.position.y = -0.13 + comp;
    }

    // 3. Bandes abdominales & Bassin
    this._hipZ.crossVectors(this._hipVec, this._chestY).normalize();
    if (this._hipZ.z < 0) this._hipZ.negate();
    this._hipX.crossVectors(this._chestY, this._hipZ).normalize();
    this._mat4.makeBasis(this._hipX, this._chestY, this._hipZ);
    this._hipQuat.setFromRotationMatrix(this._mat4);

    for (let i = 0; i < 4; i++) {
      const t = 0.41 + i * 0.135;
      const band = this.abBands[i];
      band.position.copy(shoulderMid).lerp(hipMid, t);
      band.quaternion.slerpQuaternions(this._chestQuat, this._hipQuat, i / 3);
      band.scale.set(shoulderWidth * 1.12 * bodyWidthMul, torsoHeight * 0.48, shoulderWidth * 0.66);
    }

    this.pelvisGroup.position.copy(hipMid);
    this.pelvisGroup.quaternion.copy(this._hipQuat);
    this.pelvisGroup.scale.set(shoulderWidth * 1.14 * bodyWidthMul, torsoHeight * 0.50, shoulderWidth * 0.66);

    // 4. Tête, cou & casque Mark 85
    this._headCenter.copy(pNose);
    let headW = Math.max(calib.calibratedHeadW * 1.32, shoulderWidth * 0.45) * fitScale;
    let headH = Math.max(calib.calibratedHeadH * 1.28, shoulderWidth * 0.60) * fitScale;
    this._headQuat.copy(this._chestQuat);

    if (calib.hasFace) {
      const fPts = calib.faceAnchorBank.points;
      const fTop = fPts[0];
      const fChin = fPts[1];
      const fLeft = fPts[2];
      const fRight = fPts[3];

      this._headCenter.addVectors(fTop, fChin).multiplyScalar(0.5);
      this._faceHVec.subVectors(fTop, fChin);
      this._faceWVec.subVectors(fRight, fLeft);
      headH = Math.max(this._faceHVec.length() * 1.28, shoulderWidth * 0.48) * fitScale;
      headW = Math.max(this._faceWVec.length() * 1.28, shoulderWidth * 0.42) * fitScale;

      this._hY.copy(this._faceHVec).normalize();
      this._hX.copy(this._faceWVec).normalize();
      this._hZ.crossVectors(this._hX, this._hY).normalize();
      if (this._hZ.z < 0) {
        this._hZ.negate();
        this._hX.negate();
      }
      this._hXOrtho.crossVectors(this._hY, this._hZ).normalize();
      this._mat4.makeBasis(this._hXOrtho, this._hY, this._hZ);
      this._headQuat.setFromRotationMatrix(this._mat4);
      this._headCenter.addScaledVector(this._hZ, -headW * 0.25);
      this._headCenter.addScaledVector(this._hY, headH * 0.04);
    } else {
      this._earMid.addVectors(pEarL, pEarR).multiplyScalar(0.5);
      this._earVec.subVectors(pEarR, pEarL);
      if (this._earVec.lengthSq() > 0.002) {
        this._hX.copy(this._earVec).normalize();
        this._hZ.subVectors(pNose, this._earMid).normalize();
        this._hY.crossVectors(this._hZ, this._hX).normalize();
        this._mat4.makeBasis(this._hX, this._hY, this._hZ);
        this._headQuat.setFromRotationMatrix(this._mat4);
        this._headCenter.copy(this._earMid).lerp(pNose, 0.25);
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
    this.openBrowCage.visible = open > 0.12 && suitProgress > 0.7;
    this.faceOccluder.visible = open > 0.10;
    if (this.headWireCore.visible && (open > 0.08 || suitProgress >= 0.78)) {
      this.headWireCore.visible = false;
    }
    for (let i = 0; i < this.templeServos.length; i++) {
      this.templeServos[i].rotation.x = open * 0.48;
    }

    // 5. Bras complets
    const armRadius = shoulderWidth * 0.225 * bodyWidthMul;
    const forearmRadius = shoulderWidth * 0.195;
    const leftSideSign = calib.isMirrored ? 1 : -1;
    const rightSideSign = -leftSideSign;

    const armLenUpper = shoulderWidth * 0.72;
    const armLenFore = shoulderWidth * 0.66;

    const effElbowL =
      vis[13] > 0.08
        ? pEL
        : this._fallbackElbowL
            .copy(pSL)
            .addScaledVector(this._chestY, -armLenUpper * 0.92)
            .addScaledVector(this._chestXOrtho, leftSideSign * armLenUpper * 0.25);
    const effWristL =
      vis[15] > 0.08
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
            .addScaledVector(this._chestXOrtho, rightSideSign * armLenUpper * 0.25);
    const effWristR =
      vis[16] > 0.08
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
      suitProgress
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
      suitProgress
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
      calib.hasLeftHand
    );
    this._updateHand(
      'right',
      this.rightHand,
      calib.hasRightHand ? calib.rightHandBank.points : synthRight,
      effWristR,
      shoulderWidth,
      dt,
      calib.hasRightHand
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
    suitProgress: number
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
      this._alignSegmentDownY(arm.upper, pShoulder, pElbow, forwardHint, rUpper, rUpper);
      arm.elbow.visible = true;
      arm.elbow.position.copy(pElbow);
      arm.elbow.quaternion.copy(arm.upper.quaternion);
      arm.elbow.scale.setScalar(rUpper * 0.88);
    } else {
      arm.upper.visible = false;
      arm.elbow.visible = false;
    }

    if (showFore) {
      this._alignSegmentDownY(arm.forearm, pElbow, pWrist, forwardHint, rFore, rFore);

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
    realHandTracked: boolean
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
    const palmLen = Math.max(this._palmUp.length(), shoulderWidth * 0.17);
    this._palmSide.subVectors(indexMcp, pinkyMcp);
    const palmW = Math.max(this._palmSide.length(), shoulderWidth * 0.15);

    this._pY.copy(this._palmUp).normalize();
    this._pX.copy(this._palmSide).normalize();
    this._pZ.crossVectors(this._pX, this._pY).normalize();
    this._pXOrtho.crossVectors(this._pY, this._pZ).normalize();
    this._mat4.makeBasis(this._pXOrtho, this._pY, this._pZ);

    handRig.palm.position.copy(this._palmCenter);
    handRig.palm.quaternion.setFromRotationMatrix(this._mat4);
    handRig.palm.scale.set(palmW * 1.24, palmLen * 1.12, palmW * 0.74);

    let extendedCount = 0;
    if (realHandTracked) {
      for (let f = 0; f < 4; f++) {
        const dTip = points[this._fingerTips[f]].distanceTo(wrist);
        const dBase = points[this._fingerBases[f]].distanceTo(wrist);
        if (dTip > dBase * 1.48) extendedCount++;
      }
    }

    const palmSign = this._pZ.z >= 0 ? 1 : -1;
    if (palmSign < 0) {
      const palmFacingCam = -this._pZ.z > 0.55;
      this.palmWorldNormal[side].copy(this._pZ).negate();
      this.palmOpen[side] = realHandTracked && extendedCount >= 4 && palmFacingCam;
    } else {
      const palmFacingCam = this._pZ.z > 0.55;
      this.palmWorldNormal[side].copy(this._pZ);
      this.palmOpen[side] = realHandTracked && extendedCount >= 4 && palmFacingCam;
    }

    handRig.repulsorHousing.position.z = palmSign * 0.18;
    handRig.repulsorHousing.rotation.y = palmSign < 0 ? Math.PI : 0;
    handRig.dorsalCover.position.z = (palmSign > 0 ? 0 : 0.17) - this.mechaInspectCurrent * 0.24;
    handRig.repulsorCore.getWorldPosition(this.palmWorldPos[side]);

    const targetCharge = this.palmOpen[side] ? 1.0 : 0.0;
    this.repulsorCharge[side] = THREE.MathUtils.damp(this.repulsorCharge[side], targetCharge, 10.0, dt);

    let segIdx = 0;
    for (let f = 0; f < 5; f++) {
      const chain = this._fingerChains[f];
      const baseRadius = (f === 0 ? 0.17 : 0.138) * palmW;
      for (let s = 0; s < 3; s++) {
        const link = handRig.segments[segIdx++];
        const pA = points[chain[s]];
        const pB = points[chain[s + 1]];
        const r = baseRadius * (1.0 - s * 0.14);
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
