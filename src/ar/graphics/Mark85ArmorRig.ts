import * as THREE from 'three';
import type { CalibrationEngine } from '../core/CalibrationEngine';
import type { Mark85MaterialLibrary } from './Mark85Materials';

type LoftSection = [y: number, rx: number, rz: number, offZ?: number];

function createLoftedArmorGeometry(sections: LoftSection[], radialSegs = 18): THREE.BufferGeometry {
  const rows = sections.length;
  const cols = radialSegs + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r < rows; r++) {
    const [y, rx, rz, offZ = 0] = sections[r];
    const v = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = c / radialSegs;
      const theta = u * Math.PI * 2;
      const facet = 1.0 + 0.035 * Math.cos(theta * 4.0);
      const x = Math.cos(theta) * rx * facet;
      const z = Math.sin(theta) * rz * facet + offZ;
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

function createExtrudedPlate(
  points2D: [number, number][],
  depth: number,
  bevelSize = 0.025,
  centerZ = true
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points2D[0][0], points2D[0][1]);
  for (let i = 1; i < points2D.length; i++) {
    shape.lineTo(points2D[i][0], points2D[i][1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 2,
    curveSegments: 8,
  });
  if (centerZ) geo.translate(0, 0, -depth * 0.5);
  geo.computeVertexNormals();
  return geo;
}

interface ArmRig {
  pauldron: THREE.Group;
  upper: THREE.Group;
  elbow: THREE.Mesh;
  forearm: THREE.Group;
}

interface HandRig {
  group: THREE.Group;
  palm: THREE.Group;
  repulsorCore: THREE.Mesh;
  segments: THREE.Group[];
}

interface LegRig {
  thigh: THREE.Group;
  knee: THREE.Group;
  shin: THREE.Mesh;
}

export class Mark85ArmorRig {
  public readonly mats: Mark85MaterialLibrary;
  public readonly root = new THREE.Group();

  public helmetOpenTarget = 0;
  public helmetOpenCurrent = 0;
  public readonly repulsorCharge = { left: 0, right: 0 };
  public readonly palmOpen = { left: false, right: false };

  public readonly arcWorldPos = new THREE.Vector3(0, 0, -1.6);
  public readonly palmWorldPos = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  public readonly palmWorldNormal = { left: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(0, 0, 1) };

  private helmetGroup!: THREE.Group;
  private neckGroup!: THREE.Group;
  private faceOccluder!: THREE.Mesh;
  private faceplatePivot!: THREE.Group;
  private faceplateGroup!: THREE.Group;
  private chestGroup!: THREE.Group;
  private arcReactorGroup!: THREE.Group;
  private arcCoreMesh!: THREE.Mesh;
  private abBands: THREE.Group[] = [];
  private pelvisGroup!: THREE.Group;
  private leftArm!: ArmRig;
  private rightArm!: ArmRig;
  private leftHand!: HandRig;
  private rightHand!: HandRig;
  private leftLeg!: LegRig;
  private rightLeg!: LegRig;

  // Scratch math objects (zero allocations per frame)
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
  private readonly _upVec = new THREE.Vector3();

  private readonly _palmCenter = new THREE.Vector3();
  private readonly _palmUp = new THREE.Vector3();
  private readonly _palmSide = new THREE.Vector3();
  private readonly _pX = new THREE.Vector3();
  private readonly _pY = new THREE.Vector3();
  private readonly _pZ = new THREE.Vector3();
  private readonly _pXOrtho = new THREE.Vector3();
  private readonly _deltaVec = new THREE.Vector3();

  private readonly _lastHandPoints = {
    left: Array.from({ length: 21 }, () => new THREE.Vector3()),
    right: Array.from({ length: 21 }, () => new THREE.Vector3()),
  };
  private readonly _hasLastHand = { left: false, right: false };

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
    this.root.renderOrder = 2;

    this._buildHelmet();
    this._buildTorso();
    this._buildArms();
    this._buildHands();
    this._buildLegs();
  }

  private _buildHelmet(): void {
    this.helmetGroup = new THREE.Group();
    this.root.add(this.helmetGroup);

    this.neckGroup = new THREE.Group();
    this.root.add(this.neckGroup);
    const neckGeo = createLoftedArmorGeometry(
      [
        [0.0, 0.52, 0.5],
        [0.35, 0.45, 0.44],
        [0.72, 0.42, 0.42],
        [1.0, 0.44, 0.44],
      ],
      16
    );
    this.neckGroup.add(new THREE.Mesh(neckGeo, this.mats.carbon));

    const collarRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.065, 10, 24), this.mats.crimson);
    collarRing.rotation.x = Math.PI * 0.5;
    collarRing.position.y = 0.08;
    this.neckGroup.add(collarRing);

    const backDomeGeo = new THREE.SphereGeometry(0.56, 28, 22, Math.PI * 0.62, Math.PI * 1.76, 0, Math.PI * 0.74);
    const backDome = new THREE.Mesh(backDomeGeo, this.mats.crimson);
    backDome.scale.set(0.92, 1.12, 1.06);
    backDome.position.set(0, 0.08, -0.02);
    this.helmetGroup.add(backDome);

    const crownGeo = new THREE.SphereGeometry(0.555, 24, 14, -Math.PI * 0.42, Math.PI * 0.84, 0.04, Math.PI * 0.3);
    const crown = new THREE.Mesh(crownGeo, this.mats.crimson);
    crown.scale.set(0.92, 1.12, 1.05);
    crown.position.set(0, 0.09, -0.01);
    this.helmetGroup.add(crown);

    const cheekShape: [number, number][] = [
      [0.34, 0.14],
      [0.51, 0.22],
      [0.52, -0.3],
      [0.36, -0.58],
      [0.22, -0.55],
      [0.32, -0.22],
    ];
    const cheekGeo = createExtrudedPlate(cheekShape, 0.44, 0.025, true);
    const leftCheek = new THREE.Mesh(cheekGeo, this.mats.crimson);
    leftCheek.position.set(0, 0.0, 0.06);
    leftCheek.rotation.y = 0.28;
    this.helmetGroup.add(leftCheek);

    const rightCheek = new THREE.Mesh(cheekGeo, this.mats.crimson);
    rightCheek.scale.x = -1;
    rightCheek.position.set(0, 0.0, 0.06);
    rightCheek.rotation.y = -0.28;
    this.helmetGroup.add(rightCheek);

    const chinGuardGeo = createExtrudedPlate(
      [
        [-0.28, -0.44],
        [0.28, -0.44],
        [0.19, -0.66],
        [-0.19, -0.66],
      ],
      0.16,
      0.022
    );
    const chinGuard = new THREE.Mesh(chinGuardGeo, this.mats.crimson);
    chinGuard.position.set(0, -0.02, 0.42);
    chinGuard.rotation.x = -0.28;
    this.helmetGroup.add(chinGuard);

    const chinGoldTrim = new THREE.Mesh(
      createExtrudedPlate(
        [
          [-0.18, -0.45],
          [0.18, -0.45],
          [0.13, -0.58],
          [-0.13, -0.58],
        ],
        0.05,
        0.015
      ),
      this.mats.gold
    );
    chinGoldTrim.position.set(0, -0.03, 0.51);
    chinGoldTrim.rotation.x = -0.28;
    this.helmetGroup.add(chinGoldTrim);

    const faceOcclGeo = new THREE.SphereGeometry(0.45, 20, 18);
    this.faceOccluder = new THREE.Mesh(faceOcclGeo, this.mats.depthOccluder);
    this.faceOccluder.scale.set(0.84, 1.06, 0.88);
    this.faceOccluder.position.set(0, -0.02, 0.14);
    this.faceOccluder.renderOrder = 1;
    this.helmetGroup.add(this.faceOccluder);

    this.faceplatePivot = new THREE.Group();
    this.faceplatePivot.position.set(0, 0.48, 0.24);
    this.helmetGroup.add(this.faceplatePivot);

    this.faceplateGroup = new THREE.Group();
    this.faceplateGroup.position.set(0, -0.48, -0.24);
    this.faceplatePivot.add(this.faceplateGroup);

    const maskFrontGeo = createExtrudedPlate(
      [
        [-0.25, 0.5],
        [-0.08, 0.38],
        [0.08, 0.38],
        [0.25, 0.5],
        [0.41, 0.24],
        [0.39, -0.08],
        [0.27, -0.42],
        [0.14, -0.5],
        [-0.14, -0.5],
        [-0.27, -0.42],
        [-0.39, -0.08],
        [-0.41, 0.24],
      ],
      0.16,
      0.032
    );
    const goldMask = new THREE.Mesh(maskFrontGeo, this.mats.gold);
    goldMask.position.set(0, 0.02, 0.44);
    this.faceplateGroup.add(goldMask);

    const browCrest = new THREE.Mesh(
      createExtrudedPlate(
        [
          [-0.1, 0.54],
          [0.1, 0.54],
          [0.06, 0.34],
          [-0.06, 0.34],
        ],
        0.12,
        0.018
      ),
      this.mats.crimson
    );
    browCrest.position.set(0, 0.04, 0.5);
    browCrest.rotation.x = -0.18;
    this.faceplateGroup.add(browCrest);

    const noseBridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), this.mats.gold);
    noseBridge.position.set(0, -0.02, 0.54);
    noseBridge.rotation.x = -0.12;
    this.faceplateGroup.add(noseBridge);

    const mouthSlit = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.028, 0.05), this.mats.carbon);
    mouthSlit.position.set(0, -0.34, 0.52);
    this.faceplateGroup.add(mouthSlit);

    const eyeShape: [number, number][] = [
      [-0.11, 0.032],
      [0.1, 0.012],
      [0.085, -0.026],
      [-0.09, -0.016],
    ];
    const eyeGeo = createExtrudedPlate(eyeShape, 0.04, 0.004);
    const leftEyeMesh = new THREE.Mesh(eyeGeo, this.mats.emissiveCyan);
    leftEyeMesh.position.set(-0.18, 0.14, 0.535);
    leftEyeMesh.rotation.z = -0.12;
    leftEyeMesh.rotation.y = -0.18;
    this.faceplateGroup.add(leftEyeMesh);

    const rightEyeMesh = new THREE.Mesh(eyeGeo, this.mats.emissiveCyan);
    rightEyeMesh.scale.x = -1;
    rightEyeMesh.position.set(0.18, 0.14, 0.535);
    rightEyeMesh.rotation.z = 0.12;
    rightEyeMesh.rotation.y = 0.18;
    this.faceplateGroup.add(rightEyeMesh);
  }

  private _buildTorso(): void {
    this.chestGroup = new THREE.Group();
    this.root.add(this.chestGroup);

    const chestCoreGeo = createLoftedArmorGeometry(
      [
        [-0.55, 0.42, 0.28, 0.0],
        [-0.2, 0.5, 0.34, 0.02],
        [0.2, 0.56, 0.36, 0.03],
        [0.48, 0.52, 0.3, 0.0],
      ],
      22
    );
    this.chestGroup.add(new THREE.Mesh(chestCoreGeo, this.mats.carbon));

    const pecShape: [number, number][] = [
      [0.03, 0.34],
      [0.48, 0.38],
      [0.56, 0.04],
      [0.46, -0.22],
      [0.05, -0.24],
    ];
    const pecGeo = createExtrudedPlate(pecShape, 0.22, 0.035);

    const pecL = new THREE.Mesh(pecGeo, this.mats.crimson);
    pecL.position.set(-0.56, 0.08, 0.24);
    pecL.rotation.y = -0.22;
    pecL.rotation.x = -0.06;
    this.chestGroup.add(pecL);

    const pecR = new THREE.Mesh(pecGeo, this.mats.crimson);
    pecR.scale.x = -1;
    pecR.position.set(0.56, 0.08, 0.24);
    pecR.rotation.y = 0.22;
    pecR.rotation.x = -0.06;
    this.chestGroup.add(pecR);

    const clavGeo = createExtrudedPlate(
      [
        [-0.46, 0.45],
        [-0.14, 0.42],
        [-0.12, 0.28],
        [-0.5, 0.32],
      ],
      0.14,
      0.02
    );
    const clavL = new THREE.Mesh(clavGeo, this.mats.titanium);
    clavL.position.set(0, 0.02, 0.24);
    this.chestGroup.add(clavL);
    const clavR = new THREE.Mesh(clavGeo, this.mats.titanium);
    clavR.scale.x = -1;
    clavR.position.set(0, 0.02, 0.24);
    this.chestGroup.add(clavR);

    const ventGeo = new THREE.BoxGeometry(0.11, 0.028, 0.05);
    const ventPositions: [number, number, number, number][] = [
      [-0.36, 0.36, 0.33, 0.25],
      [0.36, 0.36, 0.33, -0.25],
      [-0.42, -0.18, 0.31, -0.35],
      [0.42, -0.18, 0.31, 0.35],
    ];
    for (const [vx, vy, vz, rz] of ventPositions) {
      const vent = new THREE.Mesh(ventGeo, this.mats.emissiveCyan);
      vent.position.set(vx, vy, vz);
      vent.rotation.z = rz;
      this.chestGroup.add(vent);
    }

    this.arcReactorGroup = new THREE.Group();
    this.arcReactorGroup.position.set(0, 0.07, 0.37);
    this.chestGroup.add(this.arcReactorGroup);

    const arcBezelGeo = createExtrudedPlate(
      [
        [-0.17, 0.12],
        [0.17, 0.12],
        [0.13, 0.02],
        [0.0, -0.17],
        [-0.13, 0.02],
      ],
      0.05,
      0.015
    );
    this.arcReactorGroup.add(new THREE.Mesh(arcBezelGeo, this.mats.titanium));

    const arcCoreGeo = createExtrudedPlate(
      [
        [-0.12, 0.09],
        [0.12, 0.09],
        [0.0, -0.12],
      ],
      0.04,
      0.008
    );
    this.arcCoreMesh = new THREE.Mesh(arcCoreGeo, this.mats.emissiveCyan);
    this.arcCoreMesh.position.z = 0.022;
    this.arcReactorGroup.add(this.arcCoreMesh);

    this.abBands = [];
    const abBandGeo = createExtrudedPlate(
      [
        [-0.36, 0.06],
        [0.0, 0.02],
        [0.36, 0.06],
        [0.32, -0.08],
        [0.0, -0.12],
        [-0.32, -0.08],
      ],
      0.42,
      0.022
    );
    const abGoldSideGeo = new THREE.BoxGeometry(0.11, 0.12, 0.24);

    for (let i = 0; i < 4; i++) {
      const bandGroup = new THREE.Group();
      const s = 1.0 - i * 0.055;
      const plate = new THREE.Mesh(abBandGeo, this.mats.crimson);
      plate.scale.set(s, 1.0, s);
      bandGroup.add(plate);

      const gL = new THREE.Mesh(abGoldSideGeo, this.mats.gold);
      gL.position.set(-0.37 * s, 0, 0.06);
      gL.rotation.z = -0.2;
      bandGroup.add(gL);

      const gR = new THREE.Mesh(abGoldSideGeo, this.mats.gold);
      gR.position.set(0.37 * s, 0, 0.06);
      gR.rotation.z = 0.2;
      bandGroup.add(gR);

      this.root.add(bandGroup);
      this.abBands.push(bandGroup);
    }

    this.pelvisGroup = new THREE.Group();
    this.root.add(this.pelvisGroup);
    const pelvisGeo = createExtrudedPlate(
      [
        [-0.44, 0.16],
        [0.44, 0.16],
        [0.38, -0.1],
        [0.12, -0.26],
        [-0.12, -0.26],
        [-0.38, -0.1],
      ],
      0.44,
      0.03
    );
    this.pelvisGroup.add(new THREE.Mesh(pelvisGeo, this.mats.crimson));

    const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.11, 0.48), this.mats.gold);
    beltBuckle.position.y = 0.08;
    this.pelvisGroup.add(beltBuckle);
  }

  private _buildArms(): void {
    const upperGeo = createLoftedArmorGeometry(
      [
        [0.0, 0.95, 0.95],
        [-0.25, 1.06, 1.06],
        [-0.6, 0.96, 0.96],
        [-0.95, 0.8, 0.8],
      ],
      16
    );

    const forearmGeo = createLoftedArmorGeometry(
      [
        [0.0, 0.9, 0.9],
        [-0.3, 0.96, 1.02],
        [-0.7, 0.76, 0.82],
        [-1.0, 0.62, 0.66],
      ],
      16
    );

    const pauldronGeo = new THREE.SphereGeometry(1.0, 18, 14, 0, Math.PI, 0, Math.PI * 0.62);
    const occlGeo = new THREE.CylinderGeometry(0.85, 0.72, 1.0, 10);
    occlGeo.translate(0, -0.5, 0);

    const buildSide = (isRight: boolean): ArmRig => {
      const pauldron = new THREE.Group();
      const pShell = new THREE.Mesh(pauldronGeo, this.mats.crimson);
      pShell.rotation.z = isRight ? -0.35 : 0.35;
      pShell.rotation.y = Math.PI * 0.5;
      pauldron.add(pShell);
      const pTrim = new THREE.Mesh(pauldronGeo, this.mats.gold);
      pTrim.scale.set(1.03, 0.55, 1.03);
      pTrim.position.y = -0.15;
      pTrim.rotation.z = isRight ? -0.35 : 0.35;
      pTrim.rotation.y = Math.PI * 0.5;
      pauldron.add(pTrim);
      this.root.add(pauldron);

      const upper = new THREE.Group();
      upper.add(new THREE.Mesh(upperGeo, this.mats.gold));
      const upperCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.14, 14), this.mats.crimson);
      upperCuff.position.y = -0.88;
      upper.add(upperCuff);
      const upperOccl = new THREE.Mesh(occlGeo, this.mats.depthOccluder);
      upperOccl.renderOrder = 1;
      upper.add(upperOccl);
      this.root.add(upper);

      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.92, 14, 12), this.mats.titanium);
      this.root.add(elbow);

      const forearm = new THREE.Group();
      forearm.add(new THREE.Mesh(forearmGeo, this.mats.crimson));
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.65, 0.35), this.mats.gold);
      fin.position.set(0, -0.45, -0.85);
      forearm.add(fin);
      const wristRing = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.68, 0.11, 14), this.mats.titanium);
      wristRing.position.y = -0.94;
      forearm.add(wristRing);
      const forearmOccl = new THREE.Mesh(occlGeo, this.mats.depthOccluder);
      forearmOccl.renderOrder = 1;
      forearm.add(forearmOccl);
      this.root.add(forearm);

      return { pauldron, upper, elbow, forearm };
    };

    this.leftArm = buildSide(false);
    this.rightArm = buildSide(true);
  }

  private _buildHands(): void {
    const phalanxGeo = new THREE.CylinderGeometry(0.85, 0.72, 1.0, 8);
    phalanxGeo.translate(0, -0.5, 0);
    const jointGeo = new THREE.SphereGeometry(0.82, 8, 8);

    const buildHand = (): HandRig => {
      const group = new THREE.Group();
      this.root.add(group);

      const palm = new THREE.Group();
      palm.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.34), this.mats.crimson));

      const dorsalPlate = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.78, 0.14), this.mats.gold);
      dorsalPlate.position.set(0, 0.04, -0.18);
      palm.add(dorsalPlate);

      const repulsorRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 10, 20), this.mats.titanium);
      repulsorRing.position.set(0, 0, 0.18);
      palm.add(repulsorRing);

      const repulsorCore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.21, 0.21, 0.04, 18),
        this.mats.emissiveCyan
      );
      repulsorCore.rotation.x = Math.PI * 0.5;
      repulsorCore.position.set(0, 0, 0.175);
      palm.add(repulsorCore);

      group.add(palm);

      const segments: THREE.Group[] = [];
      for (let f = 0; f < 5; f++) {
        for (let s = 0; s < 3; s++) {
          const seg = new THREE.Group();
          seg.add(new THREE.Mesh(phalanxGeo, s === 1 ? this.mats.titanium : this.mats.crimson));
          seg.add(new THREE.Mesh(jointGeo, this.mats.carbon));
          group.add(seg);
          segments.push(seg);
        }
      }

      return { group, palm, repulsorCore, segments };
    };

    this.leftHand = buildHand();
    this.rightHand = buildHand();
  }

  private _buildLegs(): void {
    const thighGeo = createLoftedArmorGeometry(
      [
        [0.0, 1.02, 1.02],
        [-0.45, 0.94, 0.96],
        [-0.95, 0.72, 0.76],
      ],
      16
    );

    const buildLeg = (): LegRig => {
      const thigh = new THREE.Group();
      thigh.add(new THREE.Mesh(thighGeo, this.mats.gold));
      const tPlate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.68, 0.42), this.mats.crimson);
      tPlate.position.set(0, -0.45, 0.65);
      thigh.add(tPlate);
      this.root.add(thigh);

      const knee = new THREE.Group();
      const kCap = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 12), this.mats.crimson);
      kCap.scale.set(0.95, 1.15, 0.85);
      knee.add(kCap);
      knee.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 0.8), this.mats.titanium));
      this.root.add(knee);

      const shin = new THREE.Mesh(thighGeo, this.mats.crimson);
      this.root.add(shin);

      return { thigh, knee, shin };
    };

    this.leftLeg = buildLeg();
    this.rightLeg = buildLeg();
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
    if (len < 0.01) {
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

  update(calib: CalibrationEngine, dt: number): void {
    if (!calib.hasPose) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

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
    const pHL = pts[23];
    const pHR = pts[24];
    const pKL = pts[25];
    const pKR = pts[26];
    const pAL = pts[27];
    const pAR = pts[28];

    const shoulderMid = this._v2.addVectors(pSL, pSR).multiplyScalar(0.5);
    const hipMid = this._v3.addVectors(pHL, pHR).multiplyScalar(0.5);

    this._shoulderVec.subVectors(pSR, pSL);
    const shoulderWidth = Math.max(this._shoulderVec.length(), 0.16);
    this._spineUp.subVectors(shoulderMid, hipMid);
    const torsoHeight = Math.max(this._spineUp.length(), shoulderWidth * 1.1);

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

    // 1. Torse pectoral & réacteur ARC
    this._chestCenter.copy(shoulderMid).lerp(hipMid, 0.24);
    this.chestGroup.position.copy(this._chestCenter);
    this.chestGroup.quaternion.copy(this._chestQuat);
    this.chestGroup.scale.set(shoulderWidth * 0.94, torsoHeight * 0.56, shoulderWidth * 0.52);

    this.arcCoreMesh.getWorldPosition(this.arcWorldPos);
    this.mats.sharedUniforms.uArcOrigin.value.copy(this.arcWorldPos);
    this.mats.sharedUniforms.uBodyScale.value = shoulderWidth;

    // 2. Bandes abdominales
    this._hipVec.subVectors(pHR, pHL).normalize();
    this._hipZ.crossVectors(this._hipVec, this._chestY).normalize();
    if (this._hipZ.z < 0) this._hipZ.negate();
    this._hipX.crossVectors(this._chestY, this._hipZ).normalize();
    this._mat4.makeBasis(this._hipX, this._chestY, this._hipZ);
    this._hipQuat.setFromRotationMatrix(this._mat4);

    for (let i = 0; i < 4; i++) {
      const t = 0.5 + i * 0.105;
      const band = this.abBands[i];
      band.position.copy(shoulderMid).lerp(hipMid, t);
      band.quaternion.slerpQuaternions(this._chestQuat, this._hipQuat, i / 3);
      band.scale.set(shoulderWidth * 0.92, torsoHeight * 0.34, shoulderWidth * 0.44);
    }

    // 3. Bassin
    this.pelvisGroup.position.copy(hipMid);
    this.pelvisGroup.quaternion.copy(this._hipQuat);
    this.pelvisGroup.scale.set(shoulderWidth * 0.88, torsoHeight * 0.42, shoulderWidth * 0.44);

    // 4. Tête, cou & casque articulé
    this._headCenter.copy(pNose);
    let headW = shoulderWidth * 0.47;
    let headH = shoulderWidth * 0.62;
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
      headH = Math.max(this._faceHVec.length() * 1.18, shoulderWidth * 0.48);
      headW = Math.max(this._faceWVec.length() * 1.14, shoulderWidth * 0.38);

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
    } else {
      this._earMid.addVectors(pEarL, pEarR).multiplyScalar(0.5);
      this._earVec.subVectors(pEarR, pEarL);
      if (this._earVec.lengthSq() > 0.002) {
        this._hX.copy(this._earVec).normalize();
        this._hZ.subVectors(pNose, this._earMid).normalize();
        this._hY.crossVectors(this._hZ, this._hX).normalize();
        this._mat4.makeBasis(this._hX, this._hY, this._hZ);
        this._headQuat.setFromRotationMatrix(this._mat4);
        this._headCenter.copy(this._earMid).lerp(pNose, 0.35);
      }
    }

    this.helmetGroup.position.copy(this._headCenter);
    this.helmetGroup.quaternion.copy(this._headQuat);
    this.helmetGroup.scale.set(headW * 0.96, headH * 0.92, headW * 1.02);

    this._upVec.set(0, 1, 0).applyQuaternion(this._headQuat);
    this._neckTop.copy(this._headCenter).addScaledVector(this._upVec, -headH * 0.36);
    this._alignSegmentDownY(
      this.neckGroup,
      this._neckTop,
      shoulderMid,
      this._chestZ,
      shoulderWidth * 0.28,
      shoulderWidth * 0.26
    );

    this.helmetOpenCurrent = THREE.MathUtils.damp(this.helmetOpenCurrent, this.helmetOpenTarget, 9.0, dt);
    const open = this.helmetOpenCurrent;
    this.faceplatePivot.rotation.x = -open * 1.12;
    this.faceplatePivot.position.y = 0.48 + open * 0.14;
    this.faceplatePivot.position.z = 0.24 - open * 0.18;
    this.faceOccluder.visible = open > 0.04;

    // 5. Bras & épaules
    const armRadius = shoulderWidth * 0.15;
    const forearmRadius = shoulderWidth * 0.125;

    this._updateArm(this.leftArm, pSL, pEL, pWL, this._chestZ, armRadius, forearmRadius, vis[11], vis[13], vis[15]);
    this._updateArm(this.rightArm, pSR, pER, pWR, this._chestZ, armRadius, forearmRadius, vis[12], vis[14], vis[16]);

    // 6. Gantelets & 5 doigts articulés
    this._updateHand(
      'left',
      this.leftHand,
      calib.hasLeftHand ? calib.leftHandBank.points : null,
      pWL,
      shoulderWidth,
      dt
    );
    this._updateHand(
      'right',
      this.rightHand,
      calib.hasRightHand ? calib.rightHandBank.points : null,
      pWR,
      shoulderWidth,
      dt
    );

    // 7. Jambes
    const thighRadius = shoulderWidth * 0.21;
    this._updateLeg(this.leftLeg, pHL, pKL, pAL, this._hipZ, thighRadius, vis[25], vis[27]);
    this._updateLeg(this.rightLeg, pHR, pKR, pAR, this._hipZ, thighRadius, vis[26], vis[28]);
  }

  private _updateArm(
    arm: ArmRig,
    pShoulder: THREE.Vector3,
    pElbow: THREE.Vector3,
    pWrist: THREE.Vector3,
    forwardHint: THREE.Vector3,
    rUpper: number,
    rFore: number,
    vS: number,
    vE: number,
    vW: number
  ): void {
    const showUpper = vS > 0.3 && vE > 0.3;
    const showFore = vE > 0.3 && vW > 0.3;

    arm.pauldron.visible = vS > 0.3;
    if (arm.pauldron.visible) {
      arm.pauldron.position.copy(pShoulder);
      arm.pauldron.quaternion.copy(this.chestGroup.quaternion);
      arm.pauldron.scale.setScalar(rUpper * 1.48);
    }

    if (showUpper) {
      this._alignSegmentDownY(arm.upper, pShoulder, pElbow, forwardHint, rUpper, rUpper);
      arm.elbow.visible = true;
      arm.elbow.position.copy(pElbow);
      arm.elbow.scale.setScalar(rUpper * 0.88);
    } else {
      arm.upper.visible = false;
      arm.elbow.visible = false;
    }

    if (showFore) {
      this._alignSegmentDownY(arm.forearm, pElbow, pWrist, forwardHint, rFore, rFore);
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
    dt: number
  ): void {
    let points = hPts;
    if (hPts) {
      for (let i = 0; i < 21; i++) this._lastHandPoints[side][i].copy(hPts[i]);
      this._hasLastHand[side] = true;
    } else if (this._hasLastHand[side]) {
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
    const palmLen = Math.max(this._palmUp.length(), shoulderWidth * 0.16);
    this._palmSide.subVectors(indexMcp, pinkyMcp);
    const palmW = Math.max(this._palmSide.length(), shoulderWidth * 0.14);

    this._pY.copy(this._palmUp).normalize();
    this._pX.copy(this._palmSide).normalize();
    this._pZ.crossVectors(this._pX, this._pY).normalize();
    this._pXOrtho.crossVectors(this._pY, this._pZ).normalize();
    this._mat4.makeBasis(this._pXOrtho, this._pY, this._pZ);

    handRig.palm.position.copy(this._palmCenter);
    handRig.palm.quaternion.setFromRotationMatrix(this._mat4);
    handRig.palm.scale.set(palmW * 1.15, palmLen * 1.05, palmW * 0.65);

    let extendedCount = 0;
    for (let f = 0; f < 4; f++) {
      const dTip = points[this._fingerTips[f]].distanceTo(wrist);
      const dBase = points[this._fingerBases[f]].distanceTo(wrist);
      if (dTip > dBase * 1.48) extendedCount++;
    }

    if (this._pZ.z < 0) {
      const palmFacingCam = -this._pZ.z > 0.55;
      this.palmWorldNormal[side].copy(this._pZ).negate();
      this.palmOpen[side] = extendedCount >= 4 && palmFacingCam;
    } else {
      const palmFacingCam = this._pZ.z > 0.55;
      this.palmWorldNormal[side].copy(this._pZ);
      this.palmOpen[side] = extendedCount >= 4 && palmFacingCam;
    }

    handRig.repulsorCore.position.z = this._pZ.z >= 0 ? 0.175 : -0.175;
    handRig.repulsorCore.getWorldPosition(this.palmWorldPos[side]);

    const targetCharge = this.palmOpen[side] ? 1.0 : 0.0;
    this.repulsorCharge[side] = THREE.MathUtils.damp(this.repulsorCharge[side], targetCharge, 10.0, dt);

    let segIdx = 0;
    for (let f = 0; f < 5; f++) {
      const chain = this._fingerChains[f];
      const baseRadius = (f === 0 ? 0.145 : 0.115) * palmW;
      for (let s = 0; s < 3; s++) {
        const seg = handRig.segments[segIdx++];
        const pA = points[chain[s]];
        const pB = points[chain[s + 1]];
        const r = baseRadius * (1.0 - s * 0.14);
        this._alignSegmentDownY(seg, pA, pB, this._pZ, r, r);
      }
    }
  }

  private _updateLeg(
    leg: LegRig,
    pHip: THREE.Vector3,
    pKnee: THREE.Vector3,
    pAnkle: THREE.Vector3,
    forwardHint: THREE.Vector3,
    rThigh: number,
    vKnee: number,
    vAnkle: number
  ): void {
    if (vKnee > 0.45 && pKnee.y > -2.5) {
      this._alignSegmentDownY(leg.thigh, pHip, pKnee, forwardHint, rThigh, rThigh);
      leg.knee.visible = true;
      leg.knee.position.copy(pKnee);
      leg.knee.quaternion.copy(this.pelvisGroup.quaternion);
      leg.knee.scale.setScalar(rThigh * 0.85);
    } else {
      leg.thigh.visible = false;
      leg.knee.visible = false;
    }

    if (vKnee > 0.45 && vAnkle > 0.45) {
      this._alignSegmentDownY(leg.shin, pKnee, pAnkle, forwardHint, rThigh * 0.78, rThigh * 0.78);
    } else {
      leg.shin.visible = false;
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
