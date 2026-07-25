"use client";

import { useEffect, useRef, useState } from "react";
import {
  Apple,
  Cpu,
  Download,
  FileText,
  LockKeyhole,
  Monitor,
  PanelsTopLeft,
  ScanSearch,
  WifiOff,
} from "lucide-react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import "./context-rail-pbr-scene.css";

type Locale = "zh" | "en";
type Platform = "mac" | "windows";
type HitKey =
  | `capability-${number}`
  | `terminal-${Platform}`
  | `robot-${number}`
  | "task";

export type ContextRailPbrSceneProps = {
  locale: Locale;
  activeIndex: number;
  progress: number;
  onSelect: (index: number) => void;
  onTerminal: (platform: Platform) => void;
};

type CapabilityNode = {
  group: THREE.Group;
  labelAnchor: THREE.Object3D;
  glowMaterials: THREE.Material[];
  shellMaterials: THREE.MeshPhysicalMaterial[];
  light?: THREE.PointLight;
  base: THREE.Vector3;
  yaw: number;
};

type TerminalNode = {
  group: THREE.Group;
  labelAnchor: THREE.Object3D;
  glowMaterials: THREE.Material[];
  shellMaterials: THREE.MeshPhysicalMaterial[];
  base: THREE.Vector3;
};

type RobotDownloadToken = {
  group: THREE.Group;
  labelAnchor: THREE.Object3D;
  glowMaterial: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
  platform: Platform;
};

const labels = {
  zh: ["本地", "在线", "双语", "工具", "生产", "密钥"],
  en: ["Local", "Online", "Bilingual", "Tools", "Production", "Keys"],
} as const;

const details = {
  zh: [
    {
      title: "本地执行",
      summary: "任务在设备内完成，敏感资料不离开本机。",
      facts: ["设备内完成", "可离线", "私有资料不出设备"],
      flow: ["任务资料", "本地处理", "设备内结果"],
    },
    {
      title: "受控在线",
      summary: "仅在需要实时信息时连接外部服务。",
      facts: ["按需启用", "安全通道", "断线回到本地"],
      flow: ["本地任务", "在线能力", "上下文回写"],
    },
    {
      title: "双语上下文",
      summary: "中英文共享同一任务状态与术语。",
      facts: ["中 / EN", "状态同步", "术语保持"],
      flow: ["任一语言", "语义对齐", "一致输出"],
    },
    {
      title: "工具编排",
      summary: "工具在正确阶段接入，结果写回任务。",
      facts: ["按需触发", "权限受控", "结果回写"],
      flow: ["任务意图", "工具执行", "结果返回"],
    },
    {
      title: "生产交付",
      summary: "交付前校验环境、参数与输出。",
      facts: ["交付准备", "环境校验", "输出可追踪"],
      flow: ["任务结果", "交付校验", "生产输出"],
    },
    {
      title: "密钥与策略",
      summary: "调用前验证权限，凭据始终隔离保存。",
      facts: ["凭据隔离", "执行前校验", "策略已锁定"],
      flow: ["任务请求", "策略验证", "授权执行"],
    },
  ],
  en: [
    {
      title: "Local execution",
      summary: "Tasks finish on-device and private material stays local.",
      facts: ["On-device", "Offline ready", "Private by default"],
      flow: ["Task data", "Local processing", "Local result"],
    },
    {
      title: "Controlled online",
      summary: "External services connect only when live data is needed.",
      facts: ["On demand", "Secure channel", "Local fallback"],
      flow: ["Local task", "Online capability", "Context returned"],
    },
    {
      title: "Bilingual context",
      summary: "Chinese and English share one task state and terminology.",
      facts: ["ZH / EN", "Shared state", "Terms retained"],
      flow: ["Either language", "Semantic alignment", "One result"],
    },
    {
      title: "Tool orchestration",
      summary: "Tools connect at the right stage and return their results.",
      facts: ["On demand", "Policy aware", "Results returned"],
      flow: ["Task intent", "Tool action", "Result returned"],
    },
    {
      title: "Production delivery",
      summary: "Environment, parameters and output are checked before delivery.",
      facts: ["Delivery ready", "Environment checked", "Traceable output"],
      flow: ["Task result", "Delivery check", "Production output"],
    },
    {
      title: "Keys and policy",
      summary: "Permission is verified before use while credentials stay isolated.",
      facts: ["Isolated keys", "Preflight policy", "Locked state"],
      flow: ["Task request", "Policy check", "Authorized action"],
    },
  ],
} as const;

const capabilityPoints = [
  new THREE.Vector3(-4.44, 0.3, 1.55),
  new THREE.Vector3(-2.25, 0.28, -0.3),
  new THREE.Vector3(-0.27, 0.3, -1.53),
  new THREE.Vector3(0.6, 0.3, -3.07),
  new THREE.Vector3(1.44, 0.3, -4.38),
  new THREE.Vector3(2.53, 0.3, -5.52),
] as const;

const terminalPoints = {
  mac: new THREE.Vector3(4.15, 0.52, -7.07),
  windows: new THREE.Vector3(5.58, 0.52, -7.1),
} as const;

const ROBOT_MODEL_URL = "/models/djl-web-bot-v2.glb";
const ROBOT_STANCE_RATIO = 0.62;
const ROBOT_STRIDE_LENGTH = 0.09;
const ROBOT_LEG_LENGTH = 0.17;
const ROBOT_FOOT_LIFT = 0.058;
const ROBOT_PLATFORM_COUNT = 5;
const robotPlatformForIndex = (index: number): Platform => (
  index < ROBOT_PLATFORM_COUNT ? "mac" : "windows"
);

// Disjoint patrol islands keep the fleet physically clear without runtime
// position pushes (which would make the feet slide). At desktop scale the
// closest paths stay ~1.72 world units apart and ~2.21 from the rail center.
const robotPatrolConfigs = [
  {
    minWidth: 700,
    targetHeight: 1.12,
    phase: 0.08,
    speed: 0.066,
    points: [
      [7.25, -5.5],
      [7.94, -5.58],
      [8.02, -5.04],
      [7.3, -4.98],
    ],
  },
  {
    minWidth: 760,
    targetHeight: 1.18,
    phase: 0.67,
    speed: 0.061,
    points: [
      [-1.9, -6.4],
      [-1.21, -6.48],
      [-1.13, -5.94],
      [-1.85, -5.88],
    ],
  },
  {
    minWidth: 860,
    targetHeight: 1.2,
    phase: 0.39,
    speed: 0.057,
    points: [
      [0.35, -7.7],
      [1.04, -7.78],
      [1.12, -7.24],
      [0.4, -7.18],
    ],
  },
  {
    minWidth: 940,
    targetHeight: 1.16,
    phase: 0.84,
    speed: 0.052,
    points: [
      [5.25, -3.8],
      [5.94, -3.88],
      [6.02, -3.34],
      [5.3, -3.28],
    ],
  },
  {
    minWidth: 1020,
    targetHeight: 1.08,
    phase: 0.31,
    speed: 0.054,
    points: [
      [-9.15, -1.45],
      [-8.46, -1.53],
      [-8.38, -0.99],
      [-9.1, -0.93],
    ],
  },
  {
    minWidth: 1020,
    targetHeight: 1.06,
    phase: 0.24,
    speed: 0.048,
    points: [
      [3.45, -1.9],
      [4.14, -1.98],
      [4.22, -1.44],
      [3.5, -1.38],
    ],
  },
  {
    minWidth: 1120,
    targetHeight: 1.08,
    phase: 0.56,
    speed: 0.046,
    points: [
      [5.95, -1],
      [6.64, -1.08],
      [6.72, -0.54],
      [6, -0.48],
    ],
  },
  {
    minWidth: 1180,
    targetHeight: 1.14,
    phase: 0.72,
    speed: 0.044,
    points: [
      [2.65, 1.1],
      [3.34, 1.02],
      [3.42, 1.56],
      [2.7, 1.62],
    ],
  },
  {
    minWidth: 1240,
    targetHeight: 1.1,
    phase: 0.18,
    speed: 0.043,
    points: [
      [5.85, 2],
      [6.54, 1.92],
      [6.62, 2.46],
      [5.9, 2.52],
    ],
  },
  {
    minWidth: 1020,
    targetHeight: 1.12,
    phase: 0.63,
    speed: 0.05,
    points: [
      [-8.4, 1.72],
      [-7.71, 1.64],
      [-7.63, 2.18],
      [-8.35, 2.24],
    ],
  },
] as const;

type RobotPartMotion =
  | "body"
  | "head"
  | "arm-left-upper"
  | "arm-left-lower"
  | "arm-right-upper"
  | "arm-right-lower"
  | "leg-left"
  | "leg-right";

type RobotFleetPart = {
  mesh: THREE.InstancedMesh;
  localMatrix: THREE.Matrix4;
  motion: RobotPartMotion;
  pivot: THREE.Vector3;
  parentPivot: THREE.Vector3 | null;
};

type RobotMotionState = {
  travel: number;
  travelSpeed: number;
  gaitPhase: number;
  previousPoint: THREE.Vector3;
  initialized: boolean;
  bodyYaw: number;
  headYaw: number;
  turnRate: number;
  leftLeg: number;
  rightLeg: number;
  leftArm: number;
  rightArm: number;
  leftElbow: number;
  rightElbow: number;
  leftFootLift: number;
  rightFootLift: number;
  shoulderSpread: number;
  bodyBob: number;
  bodyPitch: number;
  bodyRoll: number;
};

function robotPartMotion(name: string): RobotPartMotion {
  switch (name) {
    case "tripo_part_0":
    case "tripo_part_4":
    case "tripo_part_7":
    case "tripo_part_9":
      return "head";
    case "tripo_part_6":
      return "arm-left-lower";
    case "tripo_part_10":
      return "arm-left-upper";
    case "tripo_part_5":
      return "arm-right-lower";
    case "tripo_part_8":
      return "arm-right-upper";
    case "tripo_part_2":
      return "leg-left";
    case "tripo_part_3":
      return "leg-right";
    default:
      return "body";
  }
}

function robotPartPivot(motion: RobotPartMotion) {
  switch (motion) {
    case "head":
      return new THREE.Vector3(0, 0.475, 0);
    case "arm-left-upper":
      return new THREE.Vector3(0.167826, 0.393267, 0.015318);
    case "arm-left-lower":
      return new THREE.Vector3(0.242023, 0.324064, 0.030821);
    case "arm-right-upper":
      return new THREE.Vector3(-0.167141, 0.393022, 0.022752);
    case "arm-right-lower":
      return new THREE.Vector3(-0.240321, 0.323787, 0.043593);
    case "leg-left":
      return new THREE.Vector3(0.128977, 0.198374, 0.009445);
    case "leg-right":
      return new THREE.Vector3(-0.128186, 0.199129, 0.020146);
    default:
      return new THREE.Vector3();
  }
}

function robotPartParentPivot(motion: RobotPartMotion) {
  switch (motion) {
    case "arm-left-lower":
      return new THREE.Vector3(0.167826, 0.393267, 0.015318);
    case "arm-right-lower":
      return new THREE.Vector3(-0.167141, 0.393022, 0.022752);
    default:
      return null;
  }
}

const clampProgress = (value: number) => Math.max(0, Math.min(5, value));
const clampIndex = (value: number) => Math.max(0, Math.min(5, Math.round(value)));
const damp = (from: number, to: number, lambda: number, dt: number) =>
  THREE.MathUtils.lerp(from, to, 1 - Math.exp(-lambda * dt));
const dampAngle = (from: number, to: number, lambda: number, dt: number) =>
  from
  + Math.atan2(Math.sin(to - from), Math.cos(to - from))
  * (1 - Math.exp(-lambda * dt));
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smootherStep = (value: number) => {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const walkCycle = (phase: number) => (
  ((phase / (Math.PI * 2)) % 1) + 1
) % 1;
const walkStridePosition = (cycle: number) => {
  if (cycle < ROBOT_STANCE_RATIO) {
    return 0.5 - cycle / ROBOT_STANCE_RATIO;
  }
  return -0.5 + smootherStep(
    (cycle - ROBOT_STANCE_RATIO) / (1 - ROBOT_STANCE_RATIO),
  );
};
const walkFootLift = (cycle: number) => {
  if (cycle < ROBOT_STANCE_RATIO) return 0;
  const swing = (
    cycle - ROBOT_STANCE_RATIO
  ) / (1 - ROBOT_STANCE_RATIO);
  return Math.pow(Math.max(0, Math.sin(Math.PI * swing)), 1.15);
};

function disposeObjectResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh)
      && !(object instanceof THREE.LineSegments)
    ) {
      return;
    }
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    objectMaterials.forEach((material) => {
      if (!material) return;
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
    });
  });

  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function physical(
  color: THREE.ColorRepresentation,
  options: Partial<THREE.MeshPhysicalMaterialParameters> = {},
) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.12,
    roughness: 0.29,
    clearcoat: 0.62,
    clearcoatRoughness: 0.16,
    envMapIntensity: 1.18,
    ...options,
  });
}

function rounded(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  segments = 4,
) {
  const geometry = new RoundedBoxGeometry(width, height, depth, segments, Math.min(radius, width / 2, height / 2, depth / 2));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(
  radius: number,
  height: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  radialSegments = 28,
) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radialSegments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function chamferedShape(width: number, depth: number, chamfer: number) {
  const x = width / 2;
  const y = depth / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-x + chamfer, -y);
  shape.lineTo(x - chamfer, -y);
  shape.lineTo(x, -y + chamfer);
  shape.lineTo(x, y - chamfer);
  shape.lineTo(x - chamfer, y);
  shape.lineTo(-x + chamfer, y);
  shape.lineTo(-x, y - chamfer);
  shape.lineTo(-x, -y + chamfer);
  shape.closePath();
  return shape;
}

function chamferedPlate(
  width: number,
  depth: number,
  height: number,
  material: THREE.Material,
  chamfer = 0.18,
  bevel = 0.045,
) {
  const geometry = new THREE.ExtrudeGeometry(chamferedShape(width, depth, chamfer), {
    depth: height,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 3,
    steps: 1,
  });
  geometry.center();
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function ring(
  innerRadius: number,
  outerRadius: number,
  material: THREE.Material,
  y: number,
  segments = 72,
) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(innerRadius, outerRadius, segments), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

function tubeThrough(points: THREE.Vector3[], radius: number, material: THREE.Material, segments = 160) {
  const curve = new THREE.CatmullRomCurve3(points);
  curve.curveType = "centripetal";
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 16, false), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function roundedRectTube(
  width: number,
  depth: number,
  radius: number,
  tubeRadius: number,
  y: number,
  material: THREE.Material,
) {
  const x = width / 2;
  const z = depth / 2;
  const path = new THREE.CurvePath<THREE.Vector3>();
  path.add(new THREE.LineCurve3(new THREE.Vector3(-x + radius, y, -z), new THREE.Vector3(x - radius, y, -z)));
  path.add(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(x - radius, y, -z),
    new THREE.Vector3(x, y, -z),
    new THREE.Vector3(x, y, -z + radius),
  ));
  path.add(new THREE.LineCurve3(new THREE.Vector3(x, y, -z + radius), new THREE.Vector3(x, y, z - radius)));
  path.add(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(x, y, z - radius),
    new THREE.Vector3(x, y, z),
    new THREE.Vector3(x - radius, y, z),
  ));
  path.add(new THREE.LineCurve3(new THREE.Vector3(x - radius, y, z), new THREE.Vector3(-x + radius, y, z)));
  path.add(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-x + radius, y, z),
    new THREE.Vector3(-x, y, z),
    new THREE.Vector3(-x, y, z - radius),
  ));
  path.add(new THREE.LineCurve3(new THREE.Vector3(-x, y, z - radius), new THREE.Vector3(-x, y, -z + radius)));
  path.add(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-x, y, -z + radius),
    new THREE.Vector3(-x, y, -z),
    new THREE.Vector3(-x + radius, y, -z),
  ));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 128, tubeRadius, 16, true), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function ribbonGeometry(curve: THREE.Curve<THREE.Vector3>, width: number, thickness: number, samples = 180) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);
    side.set(-tangent.z, 0, tangent.x).normalize().multiplyScalar(width / 2);
    const left = point.clone().add(side);
    const right = point.clone().sub(side);
    positions.push(
      left.x, left.y + thickness / 2, left.z,
      right.x, right.y + thickness / 2, right.z,
      left.x, left.y - thickness / 2, left.z,
      right.x, right.y - thickness / 2, right.z,
    );
    uvs.push(t, 0, t, 1, t, 0, t, 1);
  }

  for (let index = 0; index < samples; index += 1) {
    const a = index * 4;
    const b = a + 4;
    indices.push(
      a, b, a + 1, a + 1, b, b + 1,
      a + 2, a + 3, b + 2, a + 3, b + 3, b + 2,
      a, a + 2, b, a + 2, b + 2, b,
      a + 1, b + 1, a + 3, a + 3, b + 1, b + 3,
    );
  }
  const end = samples * 4;
  indices.push(
    0, 2, 1, 1, 2, 3,
    end, end + 1, end + 2, end + 1, end + 3, end + 2,
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function offsetCurve(curve: THREE.Curve<THREE.Vector3>, distance: number, samples = 90) {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(distance);
    points.push(point.add(side));
  }
  const result = new THREE.CatmullRomCurve3(points);
  result.curveType = "centripetal";
  return result;
}

function addOutline(mesh: THREE.Mesh, parent: THREE.Object3D, opacity = 0.28) {
  void parent;
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 22),
    new THREE.LineBasicMaterial({
      color: 0x74777a,
      transparent: true,
      opacity: opacity * 0.34,
      depthWrite: false,
    }),
  );
  outline.scale.setScalar(1.002);
  outline.renderOrder = 3;
  mesh.add(outline);
}

function addContactShadow(group: THREE.Group, radiusX: number, radiusZ: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 3, 64, 64, 62);
    gradient.addColorStop(0, "rgba(35, 31, 29, 0.52)");
    gradient.addColorStop(0.46, "rgba(35, 31, 29, 0.25)");
    gradient.addColorStop(1, "rgba(30, 34, 40, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: texture,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  shadow.scale.set(radiusX, radiusZ, 1);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.3;
  shadow.userData.ignoreHit = true;
  group.add(shadow);
}

function bolt(material: THREE.Material, x: number, z: number, y = 0.7) {
  const mesh = cylinder(0.055, 0.055, material, x, y, z, 20);
  const slot = rounded(0.06, 0.025, 0.012, 0.003, physical(0x33363b, { roughness: 0.3 }), x, y + 0.031, z);
  return [mesh, slot] as const;
}

function buildLocalWell(): CapabilityNode {
  const group = new THREE.Group();
  const white = physical(0xf2efea, { roughness: 0.27 });
  const warm = physical(0xd8d2cc, { roughness: 0.31 });
  const chrome = physical(0xb4bcc3, { metalness: 0.9, roughness: 0.12, envMapIntensity: 1.78 });
  const dark = physical(0x92999f, { metalness: 0.68, roughness: 0.2 });
  const blue = physical(0x176cff, {
    metalness: 0.35,
    roughness: 0.14,
    emissive: 0x0753ff,
    emissiveIntensity: 1.8,
    clearcoat: 1,
  });
  const glowMaterials: THREE.Material[] = [];
  const shellMaterials = [white, warm];

  const bottom = chamferedPlate(3.02, 2.68, 0.26, warm, 0.31, 0.07);
  bottom.position.y = 0.02;
  group.add(bottom);
  addOutline(bottom, group, 0.36);

  const outer = chamferedPlate(2.78, 2.45, 0.34, white, 0.28, 0.06);
  outer.position.y = 0.23;
  group.add(outer);
  addOutline(outer, group, 0.32);

  const recess = chamferedPlate(2.18, 1.86, 0.17, dark, 0.25, 0.04);
  recess.position.y = 0.47;
  group.add(recess);

  const glass = physical(0x2b79ff, {
    metalness: 0.05,
    roughness: 0.04,
    transmission: 0.28,
    transparent: true,
    opacity: 0.63,
    emissive: 0x075cff,
    emissiveIntensity: 1.6,
    clearcoat: 1,
  });
  const glassBed = chamferedPlate(1.78, 1.48, 0.12, glass, 0.22, 0.04);
  glassBed.position.y = 0.51;
  group.add(glassBed);
  glowMaterials.push(glass);

  const torusMaterial = physical(0xb8c1ca, { metalness: 0.94, roughness: 0.08, envMapIntensity: 2.05 });
  const torus = new THREE.Mesh(new THREE.TorusGeometry(0.69, 0.12, 16, 72), torusMaterial);
  torus.position.y = 0.74;
  torus.rotation.x = Math.PI / 2;
  torus.castShadow = true;
  group.add(torus);
  const torusGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0x1684ff,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const torusGlow = new THREE.Mesh(new THREE.TorusGeometry(0.69, 0.045, 12, 72), torusGlowMaterial);
  torusGlow.position.y = 0.755;
  torusGlow.rotation.x = Math.PI / 2;
  group.add(torusGlow);
  glowMaterials.push(torusGlowMaterial);

  const starMaterial = new THREE.MeshBasicMaterial({
    color: 0xc9efff,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  starMaterial.userData.opacityScale = 1.12;
  const starCore = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), starMaterial);
  starCore.position.set(0, 0.5, 0.58);
  group.add(starCore);
  const starHorizontal = rounded(0.84, 0.018, 0.025, 0.006, starMaterial.clone(), 0, 0.5, 0.58);
  const starVertical = rounded(0.024, 0.92, 0.024, 0.006, starMaterial.clone(), 0, 0.76, 0.58);
  for (const ray of [starHorizontal, starVertical]) {
    ray.castShadow = false;
    ray.receiveShadow = false;
    group.add(ray);
    glowMaterials.push(ray.material);
  }
  glowMaterials.push(starMaterial);

  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    const x = Math.cos(angle) * 1.18;
    const z = Math.sin(angle) * 0.98;
    const [head, slot] = bolt(chrome, x, z, 0.55);
    group.add(head, slot);
  }

  for (const x of [-1.18, 1.18]) {
    for (const z of [-0.66, 0.66]) {
      const guard = rounded(0.23, 0.35, 0.62, 0.06, chrome, x, 0.59, z);
      guard.rotation.z = x < 0 ? -0.05 : 0.05;
      group.add(guard);
    }
  }

  const pulseMaterial = new THREE.MeshBasicMaterial({
    color: 0x0872ff,
    transparent: true,
    opacity: 0.58,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  pulseMaterial.userData.opacityScale = 0.4;
  group.add(ring(1.66, 1.7, pulseMaterial, 0.68));
  const outerPulseMaterial = pulseMaterial.clone();
  outerPulseMaterial.opacity = 0.24;
  outerPulseMaterial.userData.opacityScale = 0.24;
  group.add(ring(1.88, 1.91, outerPulseMaterial, 0.67));
  const fieldPulseMaterial = pulseMaterial.clone();
  fieldPulseMaterial.opacity = 0.2;
  fieldPulseMaterial.userData.opacityScale = 0.15;
  group.add(ring(2.17, 2.2, fieldPulseMaterial, 0.66));
  const fieldPulseOuterMaterial = pulseMaterial.clone();
  fieldPulseOuterMaterial.opacity = 0.11;
  fieldPulseOuterMaterial.userData.opacityScale = 0.09;
  group.add(ring(2.53, 2.56, fieldPulseOuterMaterial, 0.65));
  glowMaterials.push(pulseMaterial);
  glowMaterials.push(outerPulseMaterial);
  glowMaterials.push(fieldPulseMaterial);
  glowMaterials.push(fieldPulseOuterMaterial);
  const sparkMaterial = new THREE.MeshBasicMaterial({
    color: 0x70b9ff,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let index = 0; index < 28; index += 1) {
    const angle = index * 2.21;
    const radius = 1.48 + (index % 5) * 0.21;
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.018 + (index % 3) * 0.008, 8, 8),
      sparkMaterial,
    );
    spark.position.set(
      Math.cos(angle) * radius,
      0.72 + (index % 7) * 0.115,
      Math.sin(angle) * radius * 0.82,
    );
    group.add(spark);
  }
  glowMaterials.push(sparkMaterial);

  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, 1.6, -0.08);
  group.add(labelAnchor);
  const light = new THREE.PointLight(0x2a7fff, 9, 5.4, 2);
  light.position.set(0, 1.05, 0);
  group.add(light);
  addContactShadow(group, 1.78, 1.48);

  group.userData.taskMaterial = blue;
  return {
    group,
    labelAnchor,
    glowMaterials,
    shellMaterials,
    light,
    base: capabilityPoints[0].clone().add(new THREE.Vector3(0, -0.22, 0)),
    yaw: -0.18,
  };
}

function buildOnlineBeacon(): CapabilityNode {
  const group = new THREE.Group();
  const white = physical(0xeee9e2, { metalness: 0.08, roughness: 0.27 });
  const warm = physical(0xc8c2bb, { metalness: 0.38, roughness: 0.27 });
  const chrome = physical(0x93999f, { metalness: 1, roughness: 0.14, envMapIntensity: 1.48 });
  const dark = physical(0x4c5054, { metalness: 0.7, roughness: 0.24 });
  const blue = physical(0x1d72ff, {
    metalness: 0.18,
    roughness: 0.04,
    transmission: 0.24,
    transparent: true,
    opacity: 0.82,
    emissive: 0x075dff,
    emissiveIntensity: 1.85,
    clearcoat: 1,
  });
  const glowMaterials: THREE.Material[] = [blue];
  const shellMaterials = [white, warm];

  // Keep Online as a real interactive machine, but make it a compact embedded
  // gateway rather than a tower that competes with the four capability sockets.
  const underBase = chamferedPlate(1.3, 1.18, 0.18, warm, 0.2, 0.04);
  underBase.position.y = 0.09;
  group.add(underBase);
  addOutline(underBase, group, 0.32);
  const base = chamferedPlate(1.18, 1.06, 0.22, white, 0.18, 0.045);
  base.position.y = 0.26;
  group.add(base);
  addOutline(base, group);
  const lowerBand = chamferedPlate(1.04, 0.92, 0.13, chrome, 0.16, 0.03);
  lowerBand.position.y = 0.42;
  group.add(lowerBand);
  const well = chamferedPlate(0.76, 0.68, 0.1, dark, 0.14, 0.025);
  well.position.y = 0.52;
  group.add(well);
  const channelMaterial = new THREE.MeshBasicMaterial({
    color: 0x2a8cff,
    transparent: true,
    opacity: 0.52,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const channel = roundedRectTube(0.86, 0.76, 0.18, 0.024, 0.6, channelMaterial);
  group.add(channel);
  glowMaterials.push(channelMaterial);
  for (const [x, z, width, depth] of [
    [-0.42, 0, 0.15, 0.68],
    [0.42, 0, 0.15, 0.68],
    [0, 0.34, 0.7, 0.15],
  ] as const) {
    const wall = rounded(width, 0.28, depth, 0.055, white, x, 0.68, z);
    group.add(wall);
    addOutline(wall, group, 0.24);
    const inset = rounded(
      width * (width > depth ? 0.78 : 0.58),
      0.13,
      depth * (depth > width ? 0.78 : 0.58),
      0.025,
      chrome,
      x,
      0.81,
      z,
    );
    group.add(inset);
  }
  const recess = cylinder(0.29, 0.12, dark, 0, 0.49, 0);
  group.add(recess);
  const emitter = cylinder(0.16, 0.36, blue, 0, 0.69, 0, 32);
  group.add(emitter);
  const cap = cylinder(0.23, 0.08, chrome, 0, 0.91, 0);
  group.add(cap);
  for (const y of [0.57, 0.78]) {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.022, 10, 48), chrome);
    halo.position.y = y;
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
  }
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    const x = Math.cos(angle) * 0.33;
    const z = Math.sin(angle) * 0.33;
    group.add(cylinder(0.03, 0.11, chrome, x, 0.49, z, 16));
  }
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0x4b96ff,
    transparent: true,
    opacity: 0.018,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.9, 32, 1, true), beamMaterial);
  beam.position.y = 1.88;
  beam.userData.ignoreHit = true;
  beamMaterial.userData.opacityScale = 0.06;
  group.add(beam);
  glowMaterials.push(beamMaterial);
  const filamentMaterials: THREE.MeshBasicMaterial[] = [];
  for (const [x, height, opacity] of [
    [-0.13, 1.32, 0.24],
    [-0.065, 1.68, 0.36],
    [0, 2.08, 0.6],
    [0.065, 1.74, 0.36],
    [0.13, 1.4, 0.22],
  ] as const) {
    const filamentMaterial = new THREE.MeshBasicMaterial({
      color: 0x7cc5ff,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const filament = cylinder(0.007, height, filamentMaterial, x, 0.9 + height / 2, 0, 8);
    filament.castShadow = false;
    filament.receiveShadow = false;
    filament.userData.ignoreHit = true;
    filamentMaterial.userData.opacityScale = Math.max(0.28, opacity / 0.82);
    group.add(filament);
    filamentMaterials.push(filamentMaterial);
    glowMaterials.push(filamentMaterial);
  }
  for (let index = 0; index < 14; index += 1) {
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: index % 3 === 0 ? 0xffffff : 0x4da1ff,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.018 + (index % 3) * 0.006, 10, 10), particleMaterial);
    const angle = index * 2.31;
    particle.position.set(
      Math.cos(angle) * (0.14 + (index % 4) * 0.045),
      0.9 + (index / 13) * 1.8,
      Math.sin(angle) * (0.1 + (index % 3) * 0.04),
    );
    particle.userData.ignoreHit = true;
    particleMaterial.userData.opacityScale = 0.72;
    group.add(particle);
    glowMaterials.push(particleMaterial);
  }
  group.userData.filamentMaterials = filamentMaterials;

  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, 1.82, 0);
  group.add(labelAnchor);
  const light = new THREE.PointLight(0x2582ff, 7, 3.4, 2);
  light.position.set(0, 0.9, 0);
  group.add(light);
  addContactShadow(group, 0.64, 0.57);
  return {
    group,
    labelAnchor,
    glowMaterials,
    shellMaterials,
    light,
    base: capabilityPoints[1].clone().add(new THREE.Vector3(0, 0.04, 0)),
    yaw: 0,
  };
}

function buildPrecisionSocket(index: number): CapabilityNode {
  const group = new THREE.Group();
  const white = physical(0xebe6df, { metalness: 0.1, roughness: 0.28 });
  const warm = physical(0xc6c0b9, { metalness: 0.34, roughness: 0.29 });
  const chrome = physical(0xb4bac0, { metalness: 0.88, roughness: 0.14, envMapIntensity: 1.72 });
  const chromeBright = physical(0xd8dde0, { metalness: 0.82, roughness: 0.14, envMapIntensity: 1.78 });
  const inset = physical(0x8f989f, { metalness: 0.52, roughness: 0.27 });
  const blue = physical(0x355f8f, {
    metalness: 0.62,
    roughness: 0.2,
    emissive: 0x0645ad,
    emissiveIntensity: 0.75,
  });
  const shellMaterials = [white, warm];
  const glowMaterials: THREE.Material[] = [blue];

  const base = chamferedPlate(1.56, 1.42, 0.24, warm, 0.22, 0.05);
  base.position.y = 0.11;
  group.add(base);
  addOutline(base, group, 0.22);
  const top = chamferedPlate(1.42, 1.28, 0.22, white, 0.2, 0.045);
  top.position.y = 0.35;
  group.add(top);
  addOutline(top, group, 0.2);
  const cavity = chamferedPlate(1.03, 0.9, 0.1, inset, 0.18, 0.025);
  cavity.position.y = 0.52;
  group.add(cavity);
  const blueBed = chamferedPlate(0.85, 0.72, 0.045, blue, 0.15, 0.014);
  blueBed.position.y = 0.59;
  group.add(blueBed);
  const pipe = roundedRectTube(0.98, 0.84, 0.23, 0.135, 0.78, chromeBright);
  group.add(pipe);
  const pipeGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0x176cff,
    transparent: true,
    opacity: 0.52,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  pipeGlowMaterial.userData.opacityScale = 0.9;
  const pipeGlow = roundedRectTube(1.015, 0.875, 0.24, 0.05, 0.84, pipeGlowMaterial);
  group.add(pipeGlow);
  glowMaterials.push(pipeGlowMaterial);
  const pipeHaloMaterial = new THREE.MeshBasicMaterial({
    color: 0x176cff,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  pipeHaloMaterial.userData.opacityScale = 0.3;
  const pipeHalo = roundedRectTube(1.04, 0.9, 0.25, 0.12, 0.82, pipeHaloMaterial);
  group.add(pipeHalo);
  glowMaterials.push(pipeHaloMaterial);
  const pipeCoreMaterial = new THREE.MeshBasicMaterial({
    color: 0xcad9ef,
    transparent: true,
    opacity: 0.78,
    blending: THREE.NormalBlending,
    depthWrite: false,
  });
  pipeCoreMaterial.userData.opacityScale = 0.72;
  const pipeCore = roundedRectTube(0.99, 0.85, 0.23, 0.027, 0.85, pipeCoreMaterial);
  group.add(pipeCore);
  glowMaterials.push(pipeCoreMaterial);

  // Four low bridge clamps make the ring read as one precision-machined socket
  // instead of a dark hole surrounded by blocky corner furniture.
  for (const [x, z, width, depth] of [
    [0, -0.48, 0.44, 0.18],
    [0, 0.48, 0.44, 0.18],
    [-0.55, 0, 0.18, 0.4],
    [0.55, 0, 0.18, 0.4],
  ] as const) {
    const clamp = rounded(width, 0.15, depth, 0.055, chrome, x, 0.86, z, 6);
    group.add(clamp);
    const bridge = rounded(width * 0.58, 0.06, depth * 0.58, 0.02, chromeBright, x, 0.96, z, 5);
    group.add(bridge);
  }
  for (const [x, z] of [
    [-0.63, -0.49],
    [0.63, -0.49],
    [-0.63, 0.49],
    [0.63, 0.49],
  ] as const) {
    group.add(cylinder(0.032, 0.08, chrome, x, 0.61, z, 16));
  }

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x2378ff,
    transparent: true,
    opacity: 0.44,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glow = ring(0.73, 0.91, glowMaterial, -0.12, 56);
  group.add(glow);
  glowMaterials.push(glowMaterial);

  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, 1.35 + (index % 2) * 0.12, 0);
  group.add(labelAnchor);
  addContactShadow(group, 0.94, 0.82);
  return {
    group,
    labelAnchor,
    glowMaterials,
    shellMaterials,
    base: capabilityPoints[index].clone(),
    yaw: -0.1 + index * 0.025,
  };
}

function buildTerminal(platform: Platform): TerminalNode {
  const group = new THREE.Group();
  const white = physical(platform === "mac" ? 0xece7e0 : 0xe0dcd6, { roughness: 0.28 });
  const warm = physical(0xbcb8b2, { roughness: 0.3 });
  const chrome = physical(0x858c93, { metalness: 1, roughness: 0.13, envMapIntensity: 1.5 });
  const blue = physical(0x176cff, {
    metalness: 0.28,
    roughness: 0.12,
    emissive: 0x075cff,
    emissiveIntensity: 1.3,
  });
  const shellMaterials = [white, warm];
  const glowMaterials: THREE.Material[] = [blue];

  const base = chamferedPlate(1.64, 2.05, 0.2, warm, 0.22, 0.05);
  base.position.y = 0.1;
  group.add(base);
  addOutline(base, group, 0.36);
  const pad = chamferedPlate(1.5, 1.88, 0.28, white, 0.2, 0.045);
  pad.position.y = 0.34;
  group.add(pad);
  addOutline(pad, group);
  const header = rounded(1.12, 0.045, 0.13, 0.018, chrome, 0, 0.49, -0.62);
  group.add(header);
  const seam = rounded(1.38, 0.05, 0.06, 0.016, blue, 0, 0.5, 0.82);
  group.add(seam);

  for (const x of [-0.54, 0.54]) {
    for (const z of [-0.77, 0.76]) {
      const [head, slot] = bolt(chrome, x, z, 0.5);
      group.add(head, slot);
    }
  }
  for (let index = 0; index < 4; index += 1) {
    const key = rounded(0.22, 0.07, 0.22, 0.025, index === 0 ? chrome : warm, -0.39 + index * 0.27, 0.52, 0.46);
    group.add(key);
  }

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.82, 2.25),
    new THREE.MeshBasicMaterial({
      color: 0x247cff,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.1;
  glow.userData.ignoreHit = true;
  group.add(glow);
  glowMaterials.push(glow.material);

  const labelAnchor = new THREE.Object3D();
  // Anchor the HTML control to the physical keycap instead of a detached
  // design-space coordinate, so both terminals follow the same perspective.
  labelAnchor.position.set(0, 0.57, 0.02);
  group.add(labelAnchor);
  addContactShadow(group, 1.1, 1.28);
  return {
    group,
    labelAnchor,
    glowMaterials,
    shellMaterials,
    base: terminalPoints[platform].clone(),
  };
}

function buildRobotDownloadToken(platform: Platform): RobotDownloadToken {
  const group = new THREE.Group();
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const panelGradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    panelGradient.addColorStop(0, platform === "mac" ? "#f7fbff" : "#0a2b63");
    panelGradient.addColorStop(0.58, platform === "mac" ? "#dcecff" : "#0b55bb");
    panelGradient.addColorStop(1, platform === "mac" ? "#b9d9ff" : "#061a3d");
    context.fillStyle = panelGradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = platform === "mac"
      ? "rgba(42, 119, 220, 0.72)"
      : "rgba(137, 211, 255, 0.92)";
    context.lineWidth = 18;
    context.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
    context.fillStyle = platform === "mac" ? "#0a2347" : "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 110px Arial, sans-serif";
    context.fillText(platform === "mac" ? "MAC" : "WIN", 256, 196);
    context.fillStyle = platform === "mac" ? "#166ad7" : "#9fe2ff";
    context.font = "700 42px Arial, sans-serif";
    context.fillText("DOWNLOAD", 256, 292);
    context.beginPath();
    context.arc(256, 392, 52, 0, Math.PI * 2);
    context.strokeStyle = platform === "mac" ? "#176df5" : "#b6ecff";
    context.lineWidth = 10;
    context.stroke();
    context.fillStyle = platform === "mac" ? "#176df5" : "#ffffff";
    context.font = "700 74px Arial, sans-serif";
    context.fillText("↓", 256, 385);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  const frameMaterial = physical(platform === "mac" ? 0xdfeaf5 : 0x176df5, {
    metalness: 0.42,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    emissive: platform === "mac" ? 0x0b315f : 0x063a9d,
    emissiveIntensity: platform === "mac" ? 0.18 : 0.72,
    transparent: true,
    opacity: 0.93,
  });
  const faceMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.96,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: platform === "mac" ? 0x69b5ff : 0x176df5,
    transparent: true,
    opacity: 0.2,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const rodMaterial = physical(0x8c969f, {
    metalness: 0.96,
    roughness: 0.12,
    envMapIntensity: 1.5,
  });

  const shell = rounded(0.52, 0.52, 0.2, 0.105, frameMaterial, 0, 0, 0, 8);
  group.add(shell);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), faceMaterial);
  face.position.z = 0.102;
  face.renderOrder = 7;
  group.add(face);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78), glowMaterial);
  glow.position.z = -0.112;
  glow.renderOrder = 1;
  group.add(glow);

  const edgeMaterial = new THREE.MeshBasicMaterial({
    color: platform === "mac" ? 0x8bc9ff : 0x9fe7ff,
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.014, 10, 56),
    edgeMaterial,
  );
  ring.position.z = -0.13;
  ring.userData.ignoreHit = true;
  group.add(ring);

  // A short illuminated grip links the compact download chip to one hand.
  group.add(rounded(0.34, 0.045, 0.045, 0.015, rodMaterial, -0.34, -0.05, 0));
  group.add(rounded(0.12, 0.11, 0.1, 0.04, frameMaterial, -0.54, -0.05, 0));

  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, 0.33, 0.05);
  group.add(labelAnchor);
  group.scale.setScalar(0.94);
  return { group, labelAnchor, glowMaterial, ring, platform };
}

export function createTaskCore() {
  const group = new THREE.Group();
  // Keep the floor halo, light and HTML label stable while the physical core
  // tumbles around its own centre. Rotating the root used to tilt those UI
  // elements with the cube and made the motion read like a camera transform.
  const body = new THREE.Group();
  const bodyContent = new THREE.Group();
  body.position.y = 0.34;
  bodyContent.position.y = -0.34;
  body.add(bodyContent);
  group.add(body);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x1478ed,
    metalness: 0.02,
    roughness: 0.065,
    clearcoat: 1,
    clearcoatRoughness: 0.012,
    transparent: true,
    opacity: 0.58,
    transmission: 0.12,
    thickness: 0.52,
    ior: 1.46,
    attenuationColor: new THREE.Color(0x00348f),
    attenuationDistance: 0.72,
    specularIntensity: 1,
    specularColor: new THREE.Color(0xdce7ff),
    emissive: 0x002c88,
    emissiveIntensity: 0.9,
    envMapIntensity: 1.84,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0x003daa,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const edgeMaterial = new THREE.MeshBasicMaterial({
    color: 0x5b9eff,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  const core = rounded(0.84, 0.6, 0.82, 0.085, glass, 0, 0.34, 0, 10);
  core.castShadow = false;
  core.receiveShadow = false;
  core.renderOrder = 8;
  bodyContent.add(core);
  const innerCore = rounded(0.68, 0.48, 0.66, 0.055, innerMaterial, 0, 0.34, 0, 7);
  innerCore.castShadow = false;
  innerCore.receiveShadow = false;
  innerCore.renderOrder = 5;
  bodyContent.add(innerCore);

  const alloy = physical(0x3977d8, {
    metalness: 0.86,
    roughness: 0.17,
    emissive: 0x002b73,
    emissiveIntensity: 0.5,
    envMapIntensity: 1.62,
  });
  const innerDark = physical(0x03142f, { metalness: 0.58, roughness: 0.19 });
  [0.15, 0.3, 0.45].forEach((y, index) => {
    const size = 0.58 - index * 0.055;
    const plate = chamferedPlate(
      size,
      size,
      0.055,
      index === 1 ? alloy : innerDark,
      0.075,
      0.015,
    );
    plate.position.y = y;
    plate.castShadow = false;
    plate.renderOrder = 6;
    bodyContent.add(plate);
  });
  const emitter = cylinder(0.125, 0.4, alloy, 0, 0.32, 0, 24);
  emitter.castShadow = false;
  emitter.renderOrder = 6;
  bodyContent.add(emitter);
  for (const y of [0.18, 0.32, 0.46]) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.018, 8, 40), alloy);
    coil.rotation.x = Math.PI / 2;
    coil.position.y = y;
    coil.castShadow = false;
    coil.renderOrder = 6;
    bodyContent.add(coil);
  }

  for (const y of [0.06, 0.61]) {
    const edgeRing = roundedRectTube(0.72, 0.7, 0.1, 0.016, y, edgeMaterial);
    edgeRing.renderOrder = 9;
    bodyContent.add(edgeRing);
  }
  for (const x of [-0.32, 0.32]) {
    for (const z of [-0.31, 0.31]) {
      const guide = rounded(0.028, 0.55, 0.028, 0.008, edgeMaterial, x, 0.335, z);
      guide.castShadow = false;
      guide.receiveShadow = false;
      guide.renderOrder = 9;
      bodyContent.add(guide);
    }
  }

  const logoTexture = new THREE.TextureLoader().load("/djl-task-logo.png");
  logoTexture.colorSpace = THREE.SRGBColorSpace;
  logoTexture.anisotropy = 4;
  const logoMaterial = new THREE.MeshBasicMaterial({
    map: logoTexture,
    color: 0x10141c,
    transparent: true,
    alphaTest: 0.08,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const logoPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.27), logoMaterial);
  logoPlane.position.set(0, 0.646, -0.035);
  logoPlane.rotation.x = -Math.PI / 2;
  logoPlane.renderOrder = 12;
  bodyContent.add(logoPlane);

  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0x168cff,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const halo = new THREE.Group();
  for (const [innerRadius, outerRadius] of [
    [0.55, 0.565],
    [0.71, 0.725],
    [0.87, 0.885],
  ] as const) {
    halo.add(ring(innerRadius, outerRadius, haloMaterial, -0.54));
  }
  // The field is a separate visual system: enlarge it independently from the
  // task body so the core stays dense while its influence reads at a distance.
  // The task body grows in the scene, so counter-scale this field to make the
  // visible halo finish about eight percent smaller than the previous pass.
  halo.scale.setScalar(0.92);
  group.add(halo);

  const light = new THREE.PointLight(0x168cff, 12, 3.3, 2);
  light.position.set(0, -0.28, 0.24);
  group.add(light);
  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, 0.68, 0);
  group.add(labelAnchor);
  return { group, body, core, innerCore, halo, haloMaterial, light, labelAnchor, logoTexture };
}

function buildDossierBoard() {
  const group = new THREE.Group();
  const white = physical(0xf5f2ec, { roughness: 0.3 });
  const chrome = physical(0xaab2ba, { metalness: 1, roughness: 0.12 });
  const dark = physical(0x171b20, { roughness: 0.22 });
  const blue = physical(0x176cff, {
    emissive: 0x075cff,
    emissiveIntensity: 0.75,
    metalness: 0.3,
    roughness: 0.14,
  });
  const board = chamferedPlate(2.56, 3.14, 0.18, white, 0.25, 0.045);
  group.add(board);
  addOutline(board, group, 0.38);
  const railLeft = rounded(0.11, 0.14, 2.7, 0.025, chrome, -1.16, 0.15, 0);
  const railRight = rounded(0.11, 0.14, 2.7, 0.025, chrome, 1.16, 0.15, 0);
  group.add(railLeft, railRight);
  group.add(rounded(1.62, 0.08, 0.065, 0.018, dark, 0, 0.15, -0.98));
  group.add(rounded(1.98, 0.07, 0.04, 0.015, blue, 0, 0.15, 1.24));
  for (const z of [-0.56, -0.17, 0.22, 0.61]) {
    group.add(rounded(1.78, 0.025, 0.025, 0.01, chrome, 0, 0.14, z));
  }
  const hinge = rounded(0.72, 0.28, 0.32, 0.07, chrome, 0, 0.13, -1.65);
  group.add(hinge);
  const anchor = new THREE.Object3D();
  anchor.position.set(0, 0.65, 0);
  group.add(anchor);
  return { group, anchor };
}

function markInteractive(root: THREE.Object3D, key: HitKey, meshes: THREE.Object3D[]) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.ignoreHit) return;
    object.userData.hitKey = key;
    meshes.push(object);
  });
}

export function ContextRailPbrScene({
  locale,
  activeIndex,
  progress,
  onSelect,
  onTerminal,
}: ContextRailPbrSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const capabilityLabelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const terminalLabelRefs = useRef<Partial<Record<Platform, HTMLButtonElement | null>>>({});
  const robotDownloadRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const taskLabelRef = useRef<HTMLButtonElement>(null);
  const dossierRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(clampProgress(progress));
  const activeRef = useRef(clampIndex(activeIndex));
  const onSelectRef = useRef(onSelect);
  const onTerminalRef = useRef(onTerminal);
  const hoverRef = useRef<HitKey | null>(null);
  const [hovered, setHovered] = useState<HitKey | null>(null);

  useEffect(() => { progressRef.current = clampProgress(progress); }, [progress]);
  useEffect(() => { activeRef.current = clampIndex(activeIndex); }, [activeIndex]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onTerminalRef.current = onTerminal; }, [onTerminal]);

  useEffect(() => {
    const mount = canvasHostRef.current;
    if (!mount) return;

    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = reducedQuery.matches;
    let viewportWidth = 1;
    let viewportHeight = 1;
    let designOffsetX = 0;
    let frame = 0;
    let lastTime = performance.now();
    let transitionSnapshotRendered = false;
    let sceneVisible = false;
    let gatewayState = document.documentElement.dataset.djlGatewayState ?? "hero-ready";
    let smoothProgress = progressRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfff9f4);
    const orthographicHeight = 11;
    const camera = new THREE.OrthographicCamera(-9, 9, orthographicHeight / 2, -orthographicHeight / 2, 0.1, 80);
    const compositionOffset = new THREE.Vector3(-0.47, 1.08, -0.77);
    const cameraBase = new THREE.Vector3(2.8, 18, 23).add(compositionOffset);
    const lookBase = compositionOffset.clone();
    const cameraVector = cameraBase.clone().sub(lookBase);
    camera.position.copy(cameraBase);
    camera.lookAt(lookBase);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    renderer.setClearColor(0xfff9f4, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = "crp-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environmentTarget = pmrem.fromScene(room, 0.04);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.74;
    room.dispose();

    scene.add(new THREE.HemisphereLight(0xfffbf4, 0x847a73, 0.28));
    const key = new THREE.DirectionalLight(0xffe7d6, 2.12);
    key.position.set(-6, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -11;
    key.shadow.camera.right = 11;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.bias = -0.00032;
    key.shadow.radius = 2.4;
    key.shadow.normalBias = 0.018;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xd7e3f2, 0.26);
    fill.position.set(9, 6, -9);
    scene.add(fill);
    const front = new THREE.DirectionalLight(0xfff3e9, 0.09);
    front.position.set(0, 5, 12);
    scene.add(front);
    const rim = new THREE.DirectionalLight(0xb7cee9, 0.34);
    rim.position.set(10, 8, -10);
    scene.add(rim);

    const floorMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xfff8f2,
      roughness: 0.96,
      metalness: 0,
      clearcoat: 0,
      emissive: 0xf4e7df,
      emissiveIntensity: 0.08,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(42, 32), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.42;
    floor.receiveShadow = true;
    scene.add(floor);

    const route = new THREE.CatmullRomCurve3(capabilityPoints.map((point) => point.clone()));
    route.curveType = "catmullrom";
    route.tension = 0.38;
    const deckPoints = [
      ...capabilityPoints.map((point) => new THREE.Vector3(point.x, 0.3, point.z)),
      new THREE.Vector3(3.52, 0.18, -5.92),
      new THREE.Vector3(4.72, 0.06, -6.76),
      // The physical route terminates inside the shared download dock. Keeping
      // the end below the opaque shell prevents the layered ribbons and metal
      // tubes from exposing their open ends past the Windows module.
      new THREE.Vector3(4.98, 0.06, -7.48),
    ];
    const deckRoute = new THREE.CatmullRomCurve3(deckPoints, false, "centripetal");
    const underSkirt = new THREE.Mesh(
      ribbonGeometry(deckRoute, 2.62, 0.205),
      physical(0xa8a19a, { metalness: 0.52, roughness: 0.34 }),
    );
    underSkirt.position.y = -0.25;
    underSkirt.castShadow = true;
    underSkirt.receiveShadow = true;
    scene.add(underSkirt);
    const baseTrack = new THREE.Mesh(
      ribbonGeometry(deckRoute, 2.48, 0.31),
      physical(0xc8c1b9, { metalness: 0.44, roughness: 0.31 }),
    );
    baseTrack.position.y = -0.02;
    baseTrack.castShadow = true;
    baseTrack.receiveShadow = true;
    scene.add(baseTrack);
    const topTrack = new THREE.Mesh(
      ribbonGeometry(deckRoute, 2.4, 0.16),
      physical(0xe0dad3, { metalness: 0.2, roughness: 0.32 }),
    );
    topTrack.position.y = 0.15;
    topTrack.castShadow = true;
    topTrack.receiveShadow = true;
    scene.add(topTrack);
    const innerTrack = new THREE.Mesh(
      ribbonGeometry(deckRoute, 2.13, 0.035),
      physical(0xeee8e1, { metalness: 0.12, roughness: 0.34 }),
    );
    innerTrack.position.y = 0.255;
    innerTrack.castShadow = false;
    innerTrack.receiveShadow = true;
    scene.add(innerTrack);

    const edgeMaterial = physical(0x858b91, { metalness: 0.9, roughness: 0.18, envMapIntensity: 1.46 });
    const leftEdge = new THREE.Mesh(
      new THREE.TubeGeometry(offsetCurve(deckRoute, 1.17), 180, 0.045, 16, false),
      edgeMaterial,
    );
    const rightEdge = new THREE.Mesh(
      new THREE.TubeGeometry(offsetCurve(deckRoute, -1.17), 180, 0.045, 16, false),
      edgeMaterial.clone(),
    );
    leftEdge.position.y = rightEdge.position.y = 0.29;
    leftEdge.castShadow = rightEdge.castShadow = true;
    scene.add(leftEdge, rightEdge);
    const insetRailMaterial = physical(0x969ca1, { metalness: 0.96, roughness: 0.14, envMapIntensity: 1.62 });
    const insetLeft = new THREE.Mesh(
      new THREE.TubeGeometry(offsetCurve(deckRoute, 0.98), 180, 0.018, 14, false),
      insetRailMaterial,
    );
    const insetRight = new THREE.Mesh(
      new THREE.TubeGeometry(offsetCurve(deckRoute, -0.98), 180, 0.018, 14, false),
      insetRailMaterial.clone(),
    );
    insetLeft.position.y = insetRight.position.y = 0.292;
    scene.add(insetLeft, insetRight);

    const energy = new THREE.MeshBasicMaterial({
      color: 0x4aa1ff,
      transparent: true,
      opacity: 0.94,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    const energyCoreMaterial = energy.clone();
    energyCoreMaterial.color.setHex(0x096fff);
    const energyHaloMaterial = new THREE.MeshBasicMaterial({
      color: 0x1280ff,
      transparent: true,
      opacity: 0.23,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const energyHalo = new THREE.Mesh(
      new THREE.TubeGeometry(deckRoute, 180, 0.2, 12, false),
      energyHaloMaterial,
    );
    const energyMidMaterial = new THREE.MeshBasicMaterial({
      color: 0x218cff,
      transparent: true,
      opacity: 0.44,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const energyMid = new THREE.Mesh(
      new THREE.TubeGeometry(deckRoute, 180, 0.09, 12, false),
      energyMidMaterial,
    );
    const energyCore = new THREE.Mesh(
      new THREE.TubeGeometry(deckRoute, 180, 0.026, 12, false),
      energyCoreMaterial,
    );
    const energyLeft = new THREE.Mesh(
      new THREE.TubeGeometry(offsetCurve(deckRoute, 0.14), 180, 0.04, 12, false),
      energy.clone(),
    );
    const energyRight = new THREE.Mesh(
      new THREE.TubeGeometry(offsetCurve(deckRoute, -0.14), 180, 0.04, 12, false),
      energy.clone(),
    );
    energyHalo.position.y = energyMid.position.y = energyCore.position.y = energyLeft.position.y = energyRight.position.y = 0.31;
    scene.add(energyHalo, energyMid, energyCore, energyLeft, energyRight);

    const routeSignals = new THREE.Group();
    const chevronMaterial = new THREE.MeshBasicMaterial({
      color: 0x64b1ff,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const chevronGeometry = new THREE.BufferGeometry();
    chevronGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([
        -0.12, 0, -0.12,
        0.16, 0, 0,
        -0.12, 0, 0.12,
        -0.02, 0, 0,
      ], 3),
    );
    chevronGeometry.setIndex([0, 1, 3, 3, 1, 2]);
    chevronGeometry.computeVertexNormals();
    for (const t of [0.12, 0.22, 0.34, 0.47, 0.6, 0.73, 0.86]) {
      const routePoint = deckRoute.getPointAt(t);
      const tangent = deckRoute.getTangentAt(t);
      const arrow = new THREE.Mesh(chevronGeometry.clone(), chevronMaterial.clone());
      arrow.position.copy(routePoint);
      arrow.position.y += 0.31;
      arrow.rotation.y = Math.atan2(tangent.x, tangent.z) + Math.PI / 2;
      routeSignals.add(arrow);
    }
    for (const t of [0.03, 0.2, 0.41, 0.62, 0.82, 0.98]) {
      const point = deckRoute.getPointAt(t);
      const sparkMaterial = new THREE.MeshBasicMaterial({
        color: 0xd8ecff,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 12, 12),
        sparkMaterial,
      );
      spark.position.copy(point);
      spark.position.y += 0.31;
      routeSignals.add(spark);
    }
    scene.add(routeSignals);

    const tickMaterial = physical(0x9ca4ac, { metalness: 0.84, roughness: 0.23 });
    const tickGroup = new THREE.Group();
    for (let index = 3; index < 88; index += 1) {
      const t = index / 90;
      const point = deckRoute.getPointAt(t);
      const tangent = deckRoute.getTangentAt(t);
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      for (const direction of [-1, 1]) {
        const tick = rounded(0.014, 0.025, index % 5 === 0 ? 0.24 : 0.14, 0.003, tickMaterial);
        tick.position.copy(point).add(side.clone().multiplyScalar(direction * 0.86));
        tick.position.y += 0.34;
        tick.rotation.y = Math.atan2(tangent.x, tangent.z);
        tickGroup.add(tick);
      }
    }
    scene.add(tickGroup);

    const local = buildLocalWell();
    const online = buildOnlineBeacon();
    const sockets = [2, 3, 4, 5].map(buildPrecisionSocket);
    const nodes: CapabilityNode[] = [local, online, ...sockets];
    const interactiveMeshes: THREE.Object3D[] = [];
    const nodeScales = [1.02, 0.59, 1.07, 1.05, 1.03, 1.02] as const;
    nodes.forEach((node, index) => {
      node.group.position.copy(node.base);
      if (index === 0) {
        node.group.scale.set(1.33, 1.38, 1.33);
      } else if (index === 1) {
        node.group.scale.setScalar(nodeScales[index]);
      } else {
        const socketScale = nodeScales[index];
        node.group.scale.set(socketScale * 0.76, socketScale, socketScale * 0.76);
      }
      node.group.rotation.y = 0;
      scene.add(node.group);
      markInteractive(node.group, `capability-${index}`, interactiveMeshes);
    });

    const terminalNodes = (["mac", "windows"] as const).reduce<Record<Platform, TerminalNode>>((all, platform) => {
      const node = buildTerminal(platform);
      node.group.position.copy(node.base);
      // Preserve a narrow, readable centre seam instead of letting the two
      // chamfered module bases overlap into a white wedge.
      node.group.position.x += platform === "mac" ? -0.015 : 0.095;
      node.group.position.z += 0.19;
      node.group.scale.set(0.93, 0.93, 1.12);
      node.group.rotation.y = -0.02;
      scene.add(node.group);
      markInteractive(node.group, `terminal-${platform}`, interactiveMeshes);
      all[platform] = node;
      return all;
    }, {} as Record<Platform, TerminalNode>);

    const terminalDock = new THREE.Group();
    const terminalDockLower = chamferedPlate(
      3.32,
      2.26,
      0.28,
      physical(0xaaa49e, { metalness: 0.7, roughness: 0.25 }),
      0.34,
      0.065,
    );
    terminalDockLower.position.y = 0.18;
    terminalDock.add(terminalDockLower);
    addOutline(terminalDockLower, terminalDock, 0.3);
    const terminalDockTop = chamferedPlate(
      3.18,
      2.24,
      0.2,
      physical(0xded8d1, { metalness: 0.26, roughness: 0.23 }),
      0.3,
      0.055,
    );
    terminalDockTop.position.y = 0.42;
    terminalDock.add(terminalDockTop);
    addOutline(terminalDockTop, terminalDock, 0.23);
    const terminalDockSeamMaterial = new THREE.MeshBasicMaterial({
      color: 0x1980ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const terminalDockSeam = rounded(0.055, 0.05, 2.06, 0.015, terminalDockSeamMaterial, 0, 0.54, 0.02);
    terminalDock.add(terminalDockSeam);
    terminalDock.position.set(4.905, 0, -6.895);
    terminalDock.rotation.y = -0.02;
    terminalDock.scale.set(0.93, 0.93, 1.12);
    addContactShadow(terminalDock, 1.82, 1.3);
    scene.add(terminalDock);

    const robotDownloadTokens = robotPatrolConfigs.map((_, index) => {
      const platform = robotPlatformForIndex(index);
      const token = buildRobotDownloadToken(platform);
      token.group.visible = false;
      token.group.renderOrder = 8;
      markInteractive(token.group, `robot-${index}`, interactiveMeshes);
      scene.add(token.group);
      return token;
    });
    const robotHitGeometry = new THREE.BoxGeometry(0.62, 1.18, 0.5);
    const robotHitMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    robotHitMaterial.colorWrite = false;
    const robotHitProxies = robotPatrolConfigs.map((_, index) => {
      const proxy = new THREE.Mesh(robotHitGeometry, robotHitMaterial);
      proxy.visible = false;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
      proxy.userData.hitKey = `robot-${index}` as HitKey;
      interactiveMeshes.push(proxy);
      scene.add(proxy);
      return proxy;
    });

    const task = createTaskCore();
    task.body.scale.set(0.92, 1.43, 0.92);
    task.group.position.copy(capabilityPoints[0]).add(new THREE.Vector3(0, 1.36, 0));
    task.group.rotation.set(0, 0, 0);
    task.group.scale.setScalar(2.01);
    const taskBaseOrientation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, -0.2, 0, "XYZ"),
    );
    const taskRollUp = new THREE.Vector3(0, 1, 0);
    const taskRollAxis = new THREE.Vector3();
    const taskRollTangent = new THREE.Vector3();
    const taskRollDelta = new THREE.Quaternion();
    const orientTaskBody = (progressValue: number) => {
      const clamped = clampProgress(progressValue);
      const routeT = clamped / 5;
      const segmentIndex = Math.min(4, Math.floor(clamped));
      const segmentProgress = clamped >= 5 ? 1 : clamped - segmentIndex;
      route.getTangent(routeT, taskRollTangent);
      taskRollTangent.y = 0;
      taskRollTangent.normalize();
      taskRollAxis.crossVectors(taskRollUp, taskRollTangent).normalize();
      // One deterministic full turn per capability interval makes forward and
      // reverse scrolling exact inverses. The sinusoidal phase bias keeps the
      // half-step visibly tilted while every integer stop returns upright.
      const rollPhase = (
        segmentProgress * Math.PI * 2
        + Math.sin(segmentProgress * Math.PI) * Math.PI * 0.25
      );
      taskRollDelta.setFromAxisAngle(
        taskRollAxis,
        rollPhase,
      );
      task.body.quaternion.copy(taskBaseOrientation).premultiply(taskRollDelta);
    };
    task.body.quaternion.copy(taskBaseOrientation);
    scene.add(task.group);
    markInteractive(task.group, "task", interactiveMeshes);

    const dossier = buildDossierBoard();
    dossier.group.position.set(-3.56, -0.08, 4.95);
    dossier.group.rotation.y = 0.28;
    dossier.group.scale.set(1.22, 1.22, 1.72);
    scene.add(dossier.group);
    const boardLink = tubeThrough(
      [
        new THREE.Vector3(-4.232, 0.22, 2.86),
        new THREE.Vector3(-4.25, 0.2, 3.34),
        new THREE.Vector3(-4.232, 0.18, 3.82),
      ],
      0.075,
      physical(0xaab2bb, { metalness: 1, roughness: 0.1 }),
      48,
    );
    scene.add(boardLink);

    let robotLoadAlive = true;
    let robotFleet: {
      parts: RobotFleetPart[];
      modelHeight: number;
      paths: THREE.CatmullRomCurve3[];
      pathLengths: number[];
      shadow: THREE.InstancedMesh;
    } | null = null;
    let robotLoadStarted = false;
    const robotDummy = new THREE.Object3D();
    const robotShadowDummy = new THREE.Object3D();
    const robotPoint = new THREE.Vector3();
    const robotNextPoint = new THREE.Vector3();
    const robotTangent = new THREE.Vector3();
    const robotTurnPreviousPoint = new THREE.Vector3();
    const robotTurnAheadPoint = new THREE.Vector3();
    const robotIncomingTangent = new THREE.Vector3();
    const robotOutgoingTangent = new THREE.Vector3();
    const robotScreenRight = new THREE.Vector3();
    const hiddenRobotScale = new THREE.Vector3(0.00001, 0.00001, 0.00001);
    const robotMotionStates: RobotMotionState[] = robotPatrolConfigs.map(
      (config, index) => ({
        travel: config.phase,
        travelSpeed: config.speed,
        gaitPhase: index * 1.47,
        previousPoint: new THREE.Vector3(),
        initialized: false,
        bodyYaw: 0,
        headYaw: 0,
        turnRate: 0,
        leftLeg: 0,
        rightLeg: 0,
        leftArm: 0,
        rightArm: 0,
        leftElbow: 0,
        rightElbow: 0,
        leftFootLift: 0,
        rightFootLift: 0,
        shoulderSpread: 0,
        bodyBob: 0,
        bodyPitch: 0,
        bodyRoll: 0,
      }),
    );
    const robotPartMotionMatrix = new THREE.Matrix4();
    const robotPartRotationMatrix = new THREE.Matrix4();
    const robotPartTiltMatrix = new THREE.Matrix4();
    const robotPartNegativePivotMatrix = new THREE.Matrix4();
    const robotPartParentMotionMatrix = new THREE.Matrix4();
    const robotPartParentRotationMatrix = new THREE.Matrix4();
    const robotPartParentNegativePivotMatrix = new THREE.Matrix4();
    const robotPartLocalMatrix = new THREE.Matrix4();
    const robotInstanceMatrix = new THREE.Matrix4();
    const robotLoader = new GLTFLoader();

    const ensureRobotFleet = () => {
      if (robotLoadStarted || !robotLoadAlive || viewportWidth < 700) return;
      robotLoadStarted = true;

      void robotLoader.loadAsync(ROBOT_MODEL_URL)
        .then((gltf) => {
          if (!robotLoadAlive) {
            disposeObjectResources(gltf.scene);
            return;
          }

          gltf.scene.updateMatrixWorld(true);
          const sourceParts: THREE.Mesh[] = [];
          gltf.scene.traverse((object) => {
            if (
              object instanceof THREE.Mesh
              && (object.geometry.getAttribute("position")?.count ?? 0) > 100
            ) {
              sourceParts.push(object);
            }
          });
          if (sourceParts.length === 0) {
            disposeObjectResources(gltf.scene);
            return;
          }

          const sourceBounds = new THREE.Box3();
          const partBounds = new THREE.Box3();
          sourceParts.forEach((part) => {
            part.geometry.computeBoundingBox();
            if (!part.geometry.boundingBox) return;
            partBounds.copy(part.geometry.boundingBox).applyMatrix4(part.matrixWorld);
            sourceBounds.union(partBounds);
          });
          if (sourceBounds.isEmpty()) {
            disposeObjectResources(gltf.scene);
            return;
          }

          const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
          const normalization = new THREE.Matrix4().makeTranslation(
            -sourceCenter.x,
            -sourceBounds.min.y,
            -sourceCenter.z,
          );
          const modelHeight = Math.max(
            0.001,
            sourceBounds.getSize(new THREE.Vector3()).y,
          );

          const robotMaterials = new Set<THREE.Material>();
          sourceParts.forEach((part) => {
            const materials = Array.isArray(part.material)
              ? part.material
              : [part.material];
            materials.forEach((material) => robotMaterials.add(material));
          });
          robotMaterials.forEach((material) => {
            material.transparent = false;
            material.opacity = 1;
            material.depthWrite = true;
            material.depthTest = true;
            if (material instanceof THREE.MeshStandardMaterial) {
              material.envMapIntensity = 0.92;
            }
          });

          const parts = sourceParts.map((sourcePart) => {
            const motion = robotPartMotion(sourcePart.name);
            const robotMesh = new THREE.InstancedMesh(
              sourcePart.geometry,
              sourcePart.material,
              robotPatrolConfigs.length,
            );
            robotMesh.name = `DJL web bot ${sourcePart.name}`;
            robotMesh.castShadow = false;
            robotMesh.receiveShadow = true;
            robotMesh.frustumCulled = false;
            robotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            robotMesh.userData.ignoreHit = true;
            for (let index = 0; index < robotPatrolConfigs.length; index += 1) {
              robotDummy.position.set(0, -20, 0);
              robotDummy.rotation.set(0, 0, 0);
              robotDummy.scale.copy(hiddenRobotScale);
              robotDummy.updateMatrix();
              robotMesh.setMatrixAt(index, robotDummy.matrix);
            }
            robotMesh.instanceMatrix.needsUpdate = true;
            scene.add(robotMesh);

            return {
              mesh: robotMesh,
              localMatrix: new THREE.Matrix4().multiplyMatrices(
                normalization,
                sourcePart.matrixWorld,
              ),
              motion,
              pivot: robotPartPivot(motion),
              parentPivot: robotPartParentPivot(motion),
            };
          });

          const robotShadowGeometry = new THREE.CircleGeometry(0.36, 32);
          robotShadowGeometry.rotateX(-Math.PI / 2);
          const robotShadow = new THREE.InstancedMesh(
            robotShadowGeometry,
            new THREE.MeshBasicMaterial({
              color: 0x5b6470,
              transparent: true,
              opacity: 0.12,
              depthWrite: false,
            }),
            robotPatrolConfigs.length,
          );
          robotShadow.name = "DJL web bot soft contact shadows";
          robotShadow.castShadow = false;
          robotShadow.receiveShadow = false;
          robotShadow.frustumCulled = false;
          robotShadow.renderOrder = 2;
          robotShadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          robotShadow.userData.ignoreHit = true;
          for (let index = 0; index < robotPatrolConfigs.length; index += 1) {
            robotShadowDummy.position.set(0, -20, 0);
            robotShadowDummy.rotation.set(0, 0, 0);
            robotShadowDummy.scale.copy(hiddenRobotScale);
            robotShadowDummy.updateMatrix();
            robotShadow.setMatrixAt(index, robotShadowDummy.matrix);
          }
          robotShadow.instanceMatrix.needsUpdate = true;
          scene.add(robotShadow);

          sourceParts.forEach((sourcePart) => sourcePart.parent?.remove(sourcePart));
          disposeObjectResources(gltf.scene);

          const paths = robotPatrolConfigs.map((config) => (
            new THREE.CatmullRomCurve3(
              config.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
              true,
              "centripetal",
            )
          ));
          robotFleet = {
            parts,
            modelHeight,
            paths,
            pathLengths: paths.map((path) => path.getLength()),
            shadow: robotShadow,
          };
        })
        .catch(() => {
          // The capability rail remains fully usable if the optional ambient
          // robot model is unavailable.
        });
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.45);
    const dragWorld = new THREE.Vector3();
    const dragGrabOffset = new THREE.Vector3();
    const dragCandidate = new THREE.Vector3();
    const dragRouteProbe = new THREE.Vector3();
    const dragRouteSampleCount = 160;
    const dragRouteSamples = Array.from(
      { length: dragRouteSampleCount + 1 },
      (_, index) => route.getPoint(index / dragRouteSampleCount),
    );
    const distanceToRouteSq = (routeT: number, point: THREE.Vector3) => {
      route.getPoint(routeT, dragRouteProbe);
      const dx = dragRouteProbe.x - point.x;
      const dz = dragRouteProbe.z - point.z;
      return dx * dx + dz * dz;
    };
    const closestRouteProgress = (point: THREE.Vector3) => {
      let nearestSample = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      dragRouteSamples.forEach((sample, index) => {
        const dx = sample.x - point.x;
        const dz = sample.z - point.z;
        const distance = dx * dx + dz * dz;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestSample = index;
        }
      });

      let lower = Math.max(0, (nearestSample - 1) / dragRouteSampleCount);
      let upper = Math.min(1, (nearestSample + 1) / dragRouteSampleCount);
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const left = lower + (upper - lower) / 3;
        const right = upper - (upper - lower) / 3;
        if (distanceToRouteSq(left, point) <= distanceToRouteSq(right, point)) {
          upper = right;
        } else {
          lower = left;
        }
      }
      return ((lower + upper) / 2) * 5;
    };
    let draggingTask = false;
    let dragProgress = smoothProgress;
    let dragNearestIndex = activeRef.current;
    let pressState: {
      pointerId: number;
      startX: number;
      startY: number;
      hit: HitKey | null;
    } | null = null;

    const setHover = (keyValue: HitKey | null) => {
      if (hoverRef.current === keyValue) return;
      hoverRef.current = keyValue;
      setHovered(keyValue);
      renderer.domElement.style.cursor = keyValue ? "pointer" : "default";
    };

    const raycastAt = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      pointerTarget.copy(pointer);
      raycaster.setFromCamera(pointer, camera);
      const isVisibleInScene = (object: THREE.Object3D) => {
        let current: THREE.Object3D | null = object;
        while (current) {
          if (!current.visible) return false;
          current = current.parent;
        }
        return true;
      };
      const hit = raycaster
        .intersectObjects(interactiveMeshes, false)
        .find((intersection) => isVisibleInScene(intersection.object));
      return (hit?.object.userData.hitKey as HitKey | undefined) ?? null;
    };

    const onPointerMove = (event: PointerEvent) => {
      const directHit = raycastAt(event);
      if (draggingTask) {
        event.preventDefault();
        if (raycaster.ray.intersectPlane(dragPlane, dragWorld)) {
          dragCandidate.copy(dragWorld).add(dragGrabOffset);
          dragProgress = closestRouteProgress(dragCandidate);
          dragNearestIndex = clampIndex(dragProgress);
          setHover(`capability-${dragNearestIndex}`);
        }
        return;
      }
      setHover(directHit);
    };

    const onPointerLeave = () => {
      pointerTarget.set(0, 0);
      if (draggingTask) return;
      setHover(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const hit = raycastAt(event);
      pressState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        hit,
      };
      if (!hit) return;
      setHover(hit);
      if (hit === "task") {
        draggingTask = true;
        dragProgress = smoothProgress;
        dragNearestIndex = clampIndex(dragProgress);
        dragPlane.setFromNormalAndCoplanarPoint(
          new THREE.Vector3(0, 1, 0),
          task.group.position,
        );
        if (raycaster.ray.intersectPlane(dragPlane, dragWorld)) {
          dragGrabOffset.copy(task.group.position).sub(dragWorld);
        } else {
          dragGrabOffset.set(0, 0, 0);
        }
        renderer.domElement.style.touchAction = "none";
        renderer.domElement.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (draggingTask) {
        event.preventDefault();
        draggingTask = false;
        smoothProgress = dragProgress;
        progressRef.current = dragNearestIndex;
        renderer.domElement.style.touchAction = "pan-y";
        if (renderer.domElement.hasPointerCapture(event.pointerId)) {
          renderer.domElement.releasePointerCapture(event.pointerId);
        }
        onSelectRef.current(dragNearestIndex);
        pressState = null;
        setHover(null);
        return;
      }
      const releasedHit = raycastAt(event);
      const pressed = pressState;
      pressState = null;
      if (
        !pressed
        || pressed.pointerId !== event.pointerId
        || !pressed.hit
        || releasedHit !== pressed.hit
        || Math.hypot(event.clientX - pressed.startX, event.clientY - pressed.startY) >= 6
      ) {
        return;
      }
      if (pressed.hit.startsWith("capability-")) {
        onSelectRef.current(Number(pressed.hit.replace("capability-", "")));
      }
      if (pressed.hit === "terminal-mac") onTerminalRef.current("mac");
      if (pressed.hit === "terminal-windows") onTerminalRef.current("windows");
      if (pressed.hit.startsWith("robot-")) {
        const robotIndex = Number(pressed.hit.replace("robot-", ""));
        onTerminalRef.current(robotPlatformForIndex(robotIndex));
      }
    };
    const onPointerCancel = (event: PointerEvent) => {
      const wasDragging = draggingTask;
      draggingTask = false;
      pressState = null;
      if (wasDragging) smoothProgress = dragProgress;
      renderer.domElement.style.touchAction = "pan-y";
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      setHover(null);
    };

    const onReduced = () => { reduced = reducedQuery.matches; };
    reducedQuery.addEventListener("change", onReduced);
    renderer.domElement.addEventListener("pointermove", onPointerMove, { passive: false });
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerdown", onPointerDown, { passive: false });
    renderer.domElement.addEventListener("pointerup", onPointerUp, { passive: false });
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);

    const project = (
      element: HTMLElement | null,
      anchor: THREE.Object3D,
      offsetY = 0,
      transform = "translate(-50%, -100%)",
    ) => {
      if (!element) return;
      const projected = new THREE.Vector3();
      anchor.getWorldPosition(projected);
      projected.project(camera);
      const x = (projected.x * 0.5 + 0.5) * viewportWidth;
      const y = (-projected.y * 0.5 + 0.5) * viewportHeight + offsetY;
      element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) ${transform}`;
      element.style.visibility = projected.z < -1 || projected.z > 1 ? "hidden" : "visible";
    };
    const placeDesignOverlay = (
      element: HTMLElement | null,
      x: number,
      y: number,
      transform = "translate(-50%, -50%)",
    ) => {
      if (!element) return;
      const scale = viewportHeight / 1058;
      element.style.transform = `translate3d(${(designOffsetX + x * scale).toFixed(1)}px, ${(y * scale).toFixed(1)}px, 0) ${transform}`;
      element.style.visibility = "visible";
    };

    const resize = () => {
      const bounds = mount.getBoundingClientRect();
      viewportWidth = Math.max(1, bounds.width);
      viewportHeight = Math.max(1, bounds.height);
      const aspect = viewportWidth / viewportHeight;
      const designAspect = 1487 / 1058;
      // Keep both download terminals and the six walking robots in-frame on
      // narrower desktop browser panes without changing the wide-screen art.
      const fittedHeight = Math.max(orthographicHeight, 16.8 / aspect);
      const worldWidth = fittedHeight * aspect;
      designOffsetX = Math.max(0, (viewportWidth - viewportHeight * designAspect) / 2);
      hostRef.current?.style.setProperty("--crp-design-offset-x", `${designOffsetX}px`);
      camera.left = -worldWidth / 2;
      camera.right = worldWidth / 2;
      camera.top = fittedHeight / 2;
      camera.bottom = -fittedHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(viewportWidth, viewportHeight, false);
      ensureRobotFleet();
    };
    resize();
    // Warm the physical materials and shadow programs while the hero is still
    // visible. Without this pass the first exposed rail frame can pay the full
    // shader-compilation cost right in the middle of the gateway transition.
    void renderer.compileAsync(scene, camera).catch(() => undefined);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    const onGatewayState = (event: Event) => {
      gatewayState = (
        event as CustomEvent<{ state?: string }>
      ).detail?.state ?? gatewayState;
      transitionSnapshotRendered = false;
      lastTime = performance.now();
    };
    window.addEventListener("djl:gateway-state", onGatewayState);

    const render = (time: number) => {
      frame = window.requestAnimationFrame(render);
      if (!sceneVisible || document.hidden) {
        lastTime = time;
        return;
      }
      const transitionBudget = (
        gatewayState.startsWith("playing")
        || gatewayState.startsWith("settling")
      );
      // During the gateway, the canvas is already being animated by the outer
      // 60fps clip/transform layer. Keep one crisp PBR snapshot underneath it
      // instead of re-running shadows, robots and materials on every frame.
      if (transitionBudget && transitionSnapshotRendered && !draggingTask) {
        lastTime = time;
        return;
      }
      const dt = Math.min(0.05, Math.max(0.001, (time - lastTime) / 1000));
      lastTime = time;
      const targetProgress = progressRef.current;
      if (!draggingTask) {
        smoothProgress = reduced ? targetProgress : damp(smoothProgress, targetProgress, 9.5, dt);
        if (Math.abs(smoothProgress - targetProgress) < 0.0005) {
          smoothProgress = targetProgress;
        }
      }
      const visualProgress = draggingTask ? dragProgress : smoothProgress;
      const routeT = clampProgress(visualProgress) / 5;
      const taskPoint = route.getPoint(routeT);
      const localBlend = 1 - THREE.MathUtils.smoothstep(routeT, 0, 0.12);
      const taskHeight = 0.28 - localBlend * 0.12;
      task.group.position.set(
        taskPoint.x - 0.09,
        taskPoint.y + taskHeight,
        taskPoint.z,
      );
      if (reduced) {
        task.body.quaternion.copy(taskBaseOrientation);
      } else {
        orientTaskBody(visualProgress);
      }
      if (!reduced) {
        task.group.position.y += Math.sin(time * 0.0028) * 0.024;
        task.halo.rotation.z = time * 0.00072;
        task.haloMaterial.opacity = 0.26 + Math.sin(time * 0.0032) * 0.05;
      }

      const active = activeRef.current;
      nodes.forEach((node, index) => {
        const selected = active === index;
        const hover = hoverRef.current === `capability-${index}`;
        const lift = hover ? 0.21 : selected ? 0.08 : 0;
        node.group.position.y = reduced ? node.base.y + lift : damp(node.group.position.y, node.base.y + lift, 11, dt);
        node.group.rotation.z = reduced ? 0 : damp(node.group.rotation.z, hover ? -pointer.x * 0.04 : 0, 10, dt);
        node.group.rotation.x = reduced ? 0 : damp(node.group.rotation.x, hover ? pointer.y * 0.028 : 0, 10, dt);
        const shellGlow = selected ? 0.08 : hover ? 0.04 : 0;
        node.shellMaterials.forEach((material) => {
          material.emissive.setHex(0x176cff);
          material.emissiveIntensity = reduced
            ? shellGlow
            : damp(material.emissiveIntensity, shellGlow, 9, dt);
        });
        node.glowMaterials.forEach((material) => {
          if ("opacity" in material && typeof material.opacity === "number") {
            const opacityScale = typeof material.userData.opacityScale === "number"
              ? material.userData.opacityScale
              : 1;
            const baseOpacity = (selected ? 0.84 : hover ? 0.68 : 0.34) * opacityScale;
            material.opacity = reduced ? baseOpacity : damp(material.opacity, baseOpacity, 9, dt);
          }
        });
        if (node.light) {
          const selectedIntensity = index === 0 ? 14 : 7.5;
          const targetIntensity = selected ? selectedIntensity : hover ? 5 : 1.8;
          node.light.intensity = reduced
            ? targetIntensity
            : damp(node.light.intensity, targetIntensity, 8, dt);
        }
      });

      (["mac", "windows"] as const).forEach((platform) => {
        const node = terminalNodes[platform];
        const hoveredRobot = hoverRef.current?.startsWith("robot-")
          ? Number(hoverRef.current.replace("robot-", ""))
          : -1;
        const hover = (
          hoverRef.current === `terminal-${platform}`
          || (
            hoveredRobot >= 0
            && robotPlatformForIndex(hoveredRobot) === platform
          )
        );
        const lift = hover ? 0.2 : 0;
        node.group.position.y = reduced ? node.base.y + lift : damp(node.group.position.y, node.base.y + lift, 11, dt);
        node.group.rotation.z = reduced ? 0 : damp(node.group.rotation.z, hover ? -pointer.x * 0.035 : 0, 10, dt);
        node.shellMaterials.forEach((material) => {
          material.emissive.setHex(0x176cff);
          material.emissiveIntensity = reduced
            ? (hover ? 0.18 : 0)
            : damp(material.emissiveIntensity, hover ? 0.18 : 0, 9, dt);
        });
        node.glowMaterials.forEach((material) => {
          if ("opacity" in material && typeof material.opacity === "number") {
            material.opacity = reduced ? (hover ? 0.55 : 0.12) : damp(material.opacity, hover ? 0.55 : 0.12, 9, dt);
          }
        });
      });

      let renderedRobotCount = 0;
      if (robotFleet) {
        const fleet = robotFleet;
        camera.updateMatrixWorld();
        robotScreenRight
          .setFromMatrixColumn(camera.matrixWorld, 0)
          .normalize();
        const visibleRobotCount = viewportWidth >= 1021
          ? robotPatrolConfigs.length
          : 0;
        renderedRobotCount = visibleRobotCount;
        robotDownloadTokens.forEach((token, index) => {
          token.group.visible = index < visibleRobotCount;
        });
        robotHitProxies.forEach((proxy, index) => {
          proxy.visible = index < visibleRobotCount;
        });
        fleet.parts.forEach((part) => {
          part.mesh.count = visibleRobotCount;
        });
        fleet.shadow.count = visibleRobotCount;
        for (let index = 0; index < visibleRobotCount; index += 1) {
          const config = robotPatrolConfigs[index];
          const state = robotMotionStates[index];
          const path = fleet.paths[index];
          const robotScale = config.targetHeight / fleet.modelHeight;
          path.getPointAt(state.travel, robotPoint);
          path.getPointAt(
            (state.travel - 0.012 + 1) % 1,
            robotTurnPreviousPoint,
          );
          path.getPointAt(
            (state.travel + 0.012) % 1,
            robotTurnAheadPoint,
          );
          robotIncomingTangent
            .subVectors(robotPoint, robotTurnPreviousPoint)
            .setY(0)
            .normalize();
          robotOutgoingTangent
            .subVectors(robotTurnAheadPoint, robotPoint)
            .setY(0)
            .normalize();
          const turnAngle = Math.acos(THREE.MathUtils.clamp(
            robotIncomingTangent.dot(robotOutgoingTangent),
            -1,
            1,
          ));
          const turnSeverity = smootherStep(
            clamp01((turnAngle - 0.035) / 0.24),
          );
          const pace = 0.98 + Math.sin(time * 0.00024 + index * 1.7) * 0.05;
          const robotHovered = hoverRef.current === `robot-${index}`;
          const targetTravelSpeed = robotHovered
            ? 0
            : config.speed * pace * (1 - turnSeverity * 0.3);
          if (reduced) {
            state.travelSpeed = 0;
          } else {
            state.travelSpeed = damp(
              state.travelSpeed,
              targetTravelSpeed,
              turnSeverity > 0.05 ? 9 : 4.5,
              dt,
            );
            state.travel = (state.travel + dt * state.travelSpeed) % 1;
          }

          path.getPointAt(state.travel, robotPoint);
          path.getPointAt(
            (state.travel + 0.0005) % 1,
            robotNextPoint,
          );
          robotTangent.subVectors(robotNextPoint, robotPoint);
          if (viewportWidth < 900 && index === 0) {
            const compactOrbit = state.travel * Math.PI * 2;
            robotPoint.set(
              taskPoint.x + 2.9 + Math.cos(compactOrbit) * 0.28,
              0,
              taskPoint.z + 1.1 + Math.sin(compactOrbit) * 0.22,
            );
            robotTangent.set(
              -Math.sin(compactOrbit),
              0,
              Math.cos(compactOrbit),
            );
          }
          robotTangent.y = 0;
          robotTangent.normalize();
          const targetBodyYaw = Math.atan2(robotTangent.x, robotTangent.z);
          const wasInitialized = state.initialized;
          const previousBodyYaw = state.bodyYaw;
          if (!wasInitialized) {
            state.previousPoint.copy(robotPoint);
            state.bodyYaw = targetBodyYaw;
            state.initialized = true;
          } else if (reduced) {
            state.bodyYaw = targetBodyYaw;
          } else {
            const travelledDistance = state.previousPoint.distanceTo(robotPoint);
            const cycleDistance = Math.max(
              0.001,
              robotScale * ROBOT_STRIDE_LENGTH / ROBOT_STANCE_RATIO,
            );
            state.gaitPhase = (
              state.gaitPhase
              + (travelledDistance / cycleDistance) * Math.PI * 2
            ) % (Math.PI * 2);
            state.bodyYaw = dampAngle(
              state.bodyYaw,
              targetBodyYaw,
              13,
              dt,
            );
          }
          if (!wasInitialized || reduced) {
            state.turnRate = 0;
          } else {
            const yawDelta = Math.atan2(
              Math.sin(state.bodyYaw - previousBodyYaw),
              Math.cos(state.bodyYaw - previousBodyYaw),
            );
            state.turnRate = damp(
              state.turnRate,
              yawDelta / Math.max(dt, 0.001),
              10,
              dt,
            );
          }
          state.previousPoint.copy(robotPoint);

          const taskFacingYaw = Math.atan2(
            taskPoint.x - robotPoint.x,
            taskPoint.z - robotPoint.z,
          );
          const taskFacingDelta = Math.atan2(
            Math.sin(taskFacingYaw - state.bodyYaw),
            Math.cos(taskFacingYaw - state.bodyYaw),
          );
          const targetHeadYaw = THREE.MathUtils.clamp(
            taskFacingDelta
            + (reduced ? 0 : Math.sin(time * 0.00078 + index * 1.37) * 0.065),
            -0.85,
            0.85,
          );
          state.headYaw = reduced
            ? targetHeadYaw
            : damp(state.headYaw, targetHeadYaw, 4.2, dt);

          const gaitPhase = state.gaitPhase;
          if (reduced) {
            state.leftLeg = 0;
            state.rightLeg = 0;
            state.leftArm = 0;
            state.rightArm = 0;
            state.leftElbow = 0;
            state.rightElbow = 0;
            state.leftFootLift = 0;
            state.rightFootLift = 0;
            state.shoulderSpread = 0;
            state.bodyBob = 0;
            state.bodyPitch = 0;
            state.bodyRoll = 0;
          } else {
            const leftCycle = walkCycle(gaitPhase);
            const rightCycle = walkCycle(gaitPhase + Math.PI);
            const leftFootZ = walkStridePosition(leftCycle)
              * ROBOT_STRIDE_LENGTH;
            const rightFootZ = walkStridePosition(rightCycle)
              * ROBOT_STRIDE_LENGTH;
            const leftLegTarget = -Math.atan2(leftFootZ, ROBOT_LEG_LENGTH);
            const rightLegTarget = -Math.atan2(rightFootZ, ROBOT_LEG_LENGTH);
            const leftFootLiftTarget = walkFootLift(leftCycle) * ROBOT_FOOT_LIFT
              + Math.max(0, leftLegTarget) * 0.065;
            const rightFootLiftTarget = walkFootLift(rightCycle) * ROBOT_FOOT_LIFT
              + Math.max(0, rightLegTarget) * 0.065;
            const leftArmTarget = THREE.MathUtils.clamp(
              -leftLegTarget * 1.32,
              -0.42,
              0.42,
            );
            const rightArmTarget = THREE.MathUtils.clamp(
              -rightLegTarget * 1.32,
              -0.42,
              0.42,
            );
            const leftArmForward = clamp01(
              (leftArmTarget / 0.42 + 1) * 0.5,
            );
            const rightArmForward = clamp01(
              (rightArmTarget / 0.42 + 1) * 0.5,
            );
            const leftElbowTarget = -(0.1 + leftArmForward * 0.14);
            const rightElbowTarget = -(0.1 + rightArmForward * 0.14);
            const shoulderSpreadTarget = 0.028
              + Math.abs(leftArmTarget - rightArmTarget) * 0.02;
            const speedRatio = THREE.MathUtils.clamp(
              state.travelSpeed / config.speed,
              0,
              1.2,
            );
            const bodyBobTarget = config.targetHeight * (
              0.009
              + 0.015 * (0.5 + Math.cos(gaitPhase * 2) * 0.5)
            );
            const bodyPitchTarget = 0.02
              + speedRatio * 0.018
              + Math.cos(gaitPhase * 2) * 0.007;
            const bodyRollTarget = THREE.MathUtils.clamp(
              -state.turnRate * 0.055,
              -0.055,
              0.055,
            ) + Math.sin(gaitPhase) * 0.017;

            state.leftLeg = damp(state.leftLeg, leftLegTarget, 18, dt);
            state.rightLeg = damp(state.rightLeg, rightLegTarget, 18, dt);
            state.leftArm = damp(state.leftArm, leftArmTarget, 14, dt);
            state.rightArm = damp(state.rightArm, rightArmTarget, 14, dt);
            state.leftElbow = damp(
              state.leftElbow,
              leftElbowTarget,
              15,
              dt,
            );
            state.rightElbow = damp(
              state.rightElbow,
              rightElbowTarget,
              15,
              dt,
            );
            state.leftFootLift = damp(
              state.leftFootLift,
              leftFootLiftTarget,
              24,
              dt,
            );
            state.rightFootLift = damp(
              state.rightFootLift,
              rightFootLiftTarget,
              24,
              dt,
            );
            state.shoulderSpread = damp(
              state.shoulderSpread,
              shoulderSpreadTarget,
              8,
              dt,
            );
            state.bodyBob = damp(state.bodyBob, bodyBobTarget, 14, dt);
            state.bodyPitch = damp(
              state.bodyPitch,
              bodyPitchTarget,
              9,
              dt,
            );
            state.bodyRoll = damp(
              state.bodyRoll,
              bodyRollTarget,
              10,
              dt,
            );
          }
          robotDummy.position.set(
            robotPoint.x,
            -0.42 + state.bodyBob,
            robotPoint.z,
          );
          robotDummy.rotation.set(
            state.bodyPitch,
            state.bodyYaw,
            state.bodyRoll,
            "XYZ",
          );
          robotDummy.scale.setScalar(robotScale);
          robotDummy.updateMatrix();

          const hitProxy = robotHitProxies[index];
          const hitScale = config.targetHeight / 1.12;
          hitProxy.position.set(
            robotPoint.x,
            -0.42 + config.targetHeight * 0.52 + state.bodyBob,
            robotPoint.z,
          );
          hitProxy.rotation.set(0, state.bodyYaw, 0);
          hitProxy.scale.setScalar(hitScale);

          const downloadToken = robotDownloadTokens[index];
          const tokenHovered = hoverRef.current === `robot-${index}`;
          const tokenScaleTarget = (
            (tokenHovered ? 1.04 : 0.86)
            * THREE.MathUtils.clamp(config.targetHeight / 1.12, 0.92, 1.08)
          );
          downloadToken.group.position.copy(robotPoint).addScaledVector(
            robotScreenRight,
            0.38 * THREE.MathUtils.clamp(config.targetHeight / 1.12, 0.9, 1.1),
          );
          downloadToken.group.position.y = (
            -0.42
            + config.targetHeight * 0.46
            + state.bodyBob
            + (reduced ? 0 : Math.sin(time * 0.0032 + index) * 0.018)
          );
          downloadToken.group.lookAt(
            camera.position.x,
            downloadToken.group.position.y,
            camera.position.z,
          );
          downloadToken.group.scale.x = reduced
            ? tokenScaleTarget
            : damp(downloadToken.group.scale.x, tokenScaleTarget, 11, dt);
          downloadToken.group.scale.y = reduced
            ? tokenScaleTarget
            : damp(downloadToken.group.scale.y, tokenScaleTarget, 11, dt);
          downloadToken.group.scale.z = reduced
            ? tokenScaleTarget
            : damp(downloadToken.group.scale.z, tokenScaleTarget, 11, dt);
          downloadToken.glowMaterial.opacity = reduced
            ? (tokenHovered ? 0.56 : 0.2)
            : damp(
              downloadToken.glowMaterial.opacity,
              tokenHovered ? 0.56 : 0.2,
              9,
              dt,
            );
          if (!reduced) {
            downloadToken.ring.rotation.z += dt * (tokenHovered ? 2.4 : 0.72);
          }

          robotShadowDummy.position.set(robotPoint.x, -0.412, robotPoint.z);
          robotShadowDummy.rotation.set(0, state.bodyYaw, 0);
          robotShadowDummy.scale.set(
            robotScale * 1.15,
            robotScale,
            robotScale * 0.78,
          );
          robotShadowDummy.updateMatrix();
          fleet.shadow.setMatrixAt(index, robotShadowDummy.matrix);

          fleet.parts.forEach((part) => {
            let partLift = 0;
            switch (part.motion) {
              case "head":
                robotPartRotationMatrix.makeRotationY(state.headYaw);
                robotPartTiltMatrix.makeRotationX(
                  reduced
                    ? 0
                    : Math.sin(time * 0.00092 + index * 0.81) * 0.022,
                );
                robotPartRotationMatrix.multiply(robotPartTiltMatrix);
                break;
              case "arm-left-upper":
                robotPartRotationMatrix.makeRotationX(state.leftArm);
                robotPartTiltMatrix.makeRotationZ(state.shoulderSpread);
                robotPartRotationMatrix.multiply(robotPartTiltMatrix);
                break;
              case "arm-left-lower":
                robotPartRotationMatrix.makeRotationX(state.leftElbow);
                robotPartParentRotationMatrix.makeRotationX(state.leftArm);
                robotPartTiltMatrix.makeRotationZ(state.shoulderSpread);
                robotPartParentRotationMatrix.multiply(robotPartTiltMatrix);
                break;
              case "arm-right-upper":
                robotPartRotationMatrix.makeRotationX(state.rightArm);
                robotPartTiltMatrix.makeRotationZ(-state.shoulderSpread);
                robotPartRotationMatrix.multiply(robotPartTiltMatrix);
                break;
              case "arm-right-lower":
                robotPartRotationMatrix.makeRotationX(state.rightElbow);
                robotPartParentRotationMatrix.makeRotationX(state.rightArm);
                robotPartTiltMatrix.makeRotationZ(-state.shoulderSpread);
                robotPartParentRotationMatrix.multiply(robotPartTiltMatrix);
                break;
              case "leg-left":
                robotPartRotationMatrix.makeRotationX(state.leftLeg);
                partLift = state.leftFootLift;
                break;
              case "leg-right":
                robotPartRotationMatrix.makeRotationX(state.rightLeg);
                partLift = state.rightFootLift;
                break;
              default:
                robotPartRotationMatrix.identity();
                break;
            }

            if (part.motion === "body") {
              robotPartLocalMatrix.copy(part.localMatrix);
            } else {
              robotPartMotionMatrix.makeTranslation(
                part.pivot.x,
                part.pivot.y + partLift,
                part.pivot.z,
              );
              robotPartMotionMatrix.multiply(robotPartRotationMatrix);
              robotPartNegativePivotMatrix.makeTranslation(
                -part.pivot.x,
                -part.pivot.y,
                -part.pivot.z,
              );
              robotPartMotionMatrix.multiply(robotPartNegativePivotMatrix);
              if (part.parentPivot) {
                robotPartParentMotionMatrix.makeTranslation(
                  part.parentPivot.x,
                  part.parentPivot.y,
                  part.parentPivot.z,
                );
                robotPartParentMotionMatrix.multiply(robotPartParentRotationMatrix);
                robotPartParentNegativePivotMatrix.makeTranslation(
                  -part.parentPivot.x,
                  -part.parentPivot.y,
                  -part.parentPivot.z,
                );
                robotPartParentMotionMatrix.multiply(
                  robotPartParentNegativePivotMatrix,
                );
                robotPartParentMotionMatrix.multiply(robotPartMotionMatrix);
                robotPartLocalMatrix.multiplyMatrices(
                  robotPartParentMotionMatrix,
                  part.localMatrix,
                );
              } else {
                robotPartLocalMatrix.multiplyMatrices(
                  robotPartMotionMatrix,
                  part.localMatrix,
                );
              }
            }

            robotInstanceMatrix.multiplyMatrices(
              robotDummy.matrix,
              robotPartLocalMatrix,
            );
            part.mesh.setMatrixAt(index, robotInstanceMatrix);
          });
        }
        fleet.parts.forEach((part) => {
          part.mesh.instanceMatrix.needsUpdate = true;
        });
        fleet.shadow.instanceMatrix.needsUpdate = true;
      }

      const taskHovered = hoverRef.current === "task";
      const taskScale = draggingTask ? 2.2 : taskHovered ? 2.05 : 1.92;
      task.group.scale.x = reduced ? taskScale : damp(task.group.scale.x, taskScale, 12, dt);
      task.group.scale.y = reduced ? taskScale : damp(task.group.scale.y, taskScale, 12, dt);
      task.group.scale.z = reduced ? taskScale : damp(task.group.scale.z, taskScale, 12, dt);
      task.light.intensity = reduced
        ? (taskHovered ? 12.5 : 9.2)
        : damp(task.light.intensity, taskHovered ? 12.5 : 9.2, 10, dt);

      if (viewportWidth < 900) {
        const terminalBias = Math.pow(routeT, 4);
        const mobileLook = new THREE.Vector3(
          taskPoint.x + terminalBias * 1.3,
          1.9,
          taskPoint.z - terminalBias * 0.45,
        );
        camera.position.copy(mobileLook).add(cameraVector);
        camera.lookAt(mobileLook);
      } else {
        camera.position.copy(cameraBase);
        camera.lookAt(lookBase);
      }

      if (viewportWidth >= 900) {
        const labelPositions = [
          [318, 508],
          [557, 445],
          [722, 375],
          [833, 319],
          [951, 259],
          [1071, 213],
        ] as const;
        labelPositions.forEach(([x, y], index) => {
          // Keep the selected capability name readable while the physical
          // task core is seated on top of that module. The local well only
          // needs a small lift; the compact rail modules need more clearance.
          const selectedLift = activeRef.current === index
            ? (index === 0 ? 0 : 48)
            : 0;
          placeDesignOverlay(capabilityLabelRefs.current[index], x, y - selectedLift);
        });
        project(
          terminalLabelRefs.current.mac ?? null,
          terminalNodes.mac.labelAnchor,
          0,
          "translate(-50%, -50%) rotate(5deg)",
        );
        project(
          terminalLabelRefs.current.windows ?? null,
          terminalNodes.windows.labelAnchor,
          0,
          "translate(-50%, -50%) rotate(5deg)",
        );
      } else {
        nodes.forEach((node, index) => project(capabilityLabelRefs.current[index], node.labelAnchor, -5));
        project(terminalLabelRefs.current.mac ?? null, terminalNodes.mac.labelAnchor, -2);
        project(terminalLabelRefs.current.windows ?? null, terminalNodes.windows.labelAnchor, -2);
      }
      robotDownloadTokens.forEach((token, index) => {
        const element = robotDownloadRefs.current[index];
        if (!element || index >= renderedRobotCount || !token.group.visible) {
          if (element) element.style.visibility = "hidden";
          return;
        }
        project(
          element,
          token.labelAnchor,
          0,
          "translate(-50%, -50%)",
        );
      });
      project(taskLabelRef.current, task.labelAnchor, 0, "translate(-50%, -50%)");
      project(
        dossierRef.current,
        dossier.anchor,
        0,
        "translate(-50%, -50%) perspective(2200px) rotateX(29deg) rotateZ(-8.6deg) skewX(2deg)",
      );
      renderer.render(scene, camera);
      if (transitionBudget && !draggingTask) {
        transitionSnapshotRendered = true;
      }
    };
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        sceneVisible = entry?.isIntersecting ?? false;
        if (sceneVisible) lastTime = performance.now();
      },
      { rootMargin: "35% 0px", threshold: 0 },
    );
    visibilityObserver.observe(mount);
    frame = window.requestAnimationFrame(render);

    return () => {
      robotLoadAlive = false;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("djl:gateway-state", onGatewayState);
      reducedQuery.removeEventListener("change", onReduced);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      task.logoTexture.dispose();
      disposeObjectResources(scene);
      environmentTarget.dispose();
      pmrem.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  const safeActive = clampIndex(activeIndex);
  const current = details[locale][safeActive];

  return (
    <div
      ref={hostRef}
      className="crp-scene"
      data-active={safeActive}
      data-hovered={hovered ?? ""}
      role="group"
      aria-label={locale === "zh" ? "DJL 高精度六能力物理轨道" : "DJL high-detail six-capability physical rail"}
    >
      <div ref={canvasHostRef} className="crp-canvas-host" />
      <div className="crp-overlay">
        <div className="crp-source-title">
          <small>CONTEXT IN MOTION</small>
          <h1>
            {locale === "zh" ? <>让任务<br />开始流动</> : <>Put tasks<br />in motion</>}
          </h1>
          <p>
            {locale === "zh"
              ? "拖动蓝色任务核，连接下一项能力"
              : "Drag the blue task core to connect the next capability"}
          </p>
          <div>
            <strong>{String(safeActive + 1).padStart(2, "0")}</strong>
            <span>/ 06</span>
            <i />
            <b>{locale === "zh" ? "已连接" : "connected"}</b>
          </div>
        </div>

        {labels[locale].map((label, index) => (
          <button
            key={label}
            ref={(element) => { capabilityLabelRefs.current[index] = element; }}
            type="button"
            className="crp-module-label"
            data-index={index}
            data-active={safeActive === index}
            data-hovered={hovered === `capability-${index}`}
            aria-pressed={safeActive === index}
            onPointerEnter={() => {
              hoverRef.current = `capability-${index}`;
              setHovered(`capability-${index}`);
            }}
            onPointerLeave={() => {
              hoverRef.current = null;
              setHovered(null);
            }}
            onClick={() => onSelect(index)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{label}</strong>
            <i />
          </button>
        ))}

        {(["mac", "windows"] as const).map((platform) => (
          <button
            key={platform}
            ref={(element) => { terminalLabelRefs.current[platform] = element; }}
            type="button"
            className="crp-terminal-label"
            data-platform={platform}
            data-hovered={hovered === `terminal-${platform}`}
            onPointerEnter={() => {
              hoverRef.current = `terminal-${platform}`;
              setHovered(`terminal-${platform}`);
            }}
            onPointerLeave={() => {
              hoverRef.current = null;
              setHovered(null);
            }}
            onClick={() => onTerminal(platform)}
          >
            <span aria-hidden="true">
              {platform === "mac" ? <Apple /> : <PanelsTopLeft />}
            </span>
            <strong>{locale === "zh" ? "下载" : "Download"}</strong>
            <small>
              {platform === "mac"
                ? (locale === "zh" ? "macOS 版" : "macOS")
                : (locale === "zh" ? "Windows 版" : "Windows")}
            </small>
          </button>
        ))}

        {robotPatrolConfigs.map((_, index) => {
          const platform = robotPlatformForIndex(index);
          const robotKey = `robot-${index}` as HitKey;
          const platformName = platform === "mac" ? "macOS" : "Windows";
          const platformOrder = (index % ROBOT_PLATFORM_COUNT) + 1;
          return (
            <button
              key={robotKey}
              ref={(element) => { robotDownloadRefs.current[index] = element; }}
              type="button"
              className="crp-robot-download-hit"
              data-platform={platform}
              data-hovered={hovered === robotKey}
              aria-label={
                locale === "zh"
                  ? `下载 ${platformName} 版本，${platformName} 机器人 ${platformOrder}/${ROBOT_PLATFORM_COUNT}`
                  : `Download the ${platformName} release, ${platformName} robot ${platformOrder} of ${ROBOT_PLATFORM_COUNT}`
              }
              onPointerEnter={() => {
                hoverRef.current = robotKey;
                setHovered(robotKey);
              }}
              onPointerLeave={(event) => {
                if (document.activeElement === event.currentTarget) return;
                hoverRef.current = null;
                setHovered(null);
              }}
              onFocus={() => {
                hoverRef.current = robotKey;
                setHovered(robotKey);
              }}
              onBlur={() => {
                hoverRef.current = null;
                setHovered(null);
              }}
              onClick={() => onTerminal(platform)}
            >
              <span>
                {platform === "mac"
                  ? <Apple aria-hidden="true" />
                  : <PanelsTopLeft aria-hidden="true" />}
                <strong>{platformName}</strong>
                <small>{locale === "zh" ? "点击下载" : "Download"}</small>
                <Download aria-hidden="true" />
              </span>
            </button>
          );
        })}

        <div className="crp-robot-download-guide">
          <span aria-hidden="true"><Download /></span>
          <p>
            <strong>
              {locale === "zh" ? "点击机器人手中的下载芯片" : "Click a robot download chip"}
            </strong>
            <small>{ROBOT_PLATFORM_COUNT} macOS · {ROBOT_PLATFORM_COUNT} Windows</small>
          </p>
        </div>

        <button
          ref={taskLabelRef}
          type="button"
          className="crp-task-label"
          aria-label={locale === "zh" ? "DJL 蓝色任务核" : "DJL blue task core"}
          onPointerEnter={() => {
            hoverRef.current = "task";
            setHovered("task");
          }}
          onPointerLeave={() => {
            hoverRef.current = null;
            setHovered(null);
          }}
          onClick={() => onSelect(safeActive)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/djl-logo.png" alt="" aria-hidden="true" />
          <small>{locale === "zh" ? "任务核" : "TASK CORE"}</small>
        </button>

        <div ref={dossierRef} className="crp-dossier" aria-live="polite">
          <header>
            <span>{locale === "zh" ? "能力资料" : "CAPABILITY"}</span>
            <b>{String(safeActive + 1).padStart(2, "0")} / 06</b>
          </header>
          <h2>{current.title}</h2>
          <p>{current.summary}</p>
          <ul>
            {current.facts.map((fact, index) => (
              <li key={fact}>
                {safeActive === 0
                  ? (index === 0
                    ? <Monitor aria-hidden="true" />
                    : index === 1
                      ? <WifiOff aria-hidden="true" />
                      : <LockKeyhole aria-hidden="true" />)
                  : <i />}
                {fact}
              </li>
            ))}
          </ul>
          <div className="crp-dossier-flow">
            {current.flow.map((step, index) => (
              <span key={step}>
                {safeActive === 0 && (index === 0
                  ? <FileText aria-hidden="true" />
                  : index === 1
                    ? <Cpu aria-hidden="true" />
                    : <ScanSearch aria-hidden="true" />)}
                <b>{step}</b>
                {index < 2 && <i aria-hidden="true">→</i>}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="crp-scroll-status" aria-hidden="true">
        <span><i />{locale === "zh" ? "任务核沿轨道流动" : "Task core on rail"}</span>
        <b>{String(safeActive + 1).padStart(2, "0")} / 06</b>
      </div>
    </div>
  );
}
