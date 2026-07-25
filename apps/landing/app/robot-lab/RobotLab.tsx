"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import "./robot-lab.css";

type Joint = {
  object: THREE.Object3D;
  base: THREE.Quaternion;
  side: -1 | 1;
  basePosition?: THREE.Vector3;
};

type Rig = {
  root: THREE.Group;
  torso?: Joint;
  head?: Joint;
  arms: Joint[];
  forearms: Joint[];
  hands: Joint[];
};

type VisorReflection = {
  material: THREE.ShaderMaterial;
  down: { value: number };
};

type RuntimeCodeToken = {
  text: string;
  tone?: "keyword" | "method" | "string" | "value" | "comment";
};

type CodeRibbon = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  speed: number;
  span: number;
  baseOpacity: number;
};

const RUNTIME_CODE_TRACKS: RuntimeCodeToken[][] = [
  [
    { text: "const", tone: "keyword" },
    { text: " plan " },
    { text: "= await ", tone: "keyword" },
    { text: "djl.route", tone: "method" },
    { text: "(task, { runtime: " },
    { text: '"local"', tone: "string" },
    { text: ", policy: " },
    { text: '"private"', tone: "string" },
    { text: " });" },
    { text: "  // route resolved", tone: "comment" },
  ],
  [
    { text: "context.", tone: "value" },
    { text: "align", tone: "method" },
    { text: "({ input: " },
    { text: '"zh-CN"', tone: "string" },
    { text: ", output: " },
    { text: '"en-US"', tone: "string" },
    { text: ", intent: " },
    { text: '"shared"', tone: "string" },
    { text: " });" },
    { text: "  // semantic lock", tone: "comment" },
  ],
  [
    { text: "for", tone: "keyword" },
    { text: " (const step of workflow) " },
    { text: "await", tone: "keyword" },
    { text: " tools.execute", tone: "method" },
    { text: "(step, { sandbox: " },
    { text: "true", tone: "value" },
    { text: ", audit: " },
    { text: '"live"', tone: "string" },
    { text: " });" },
    { text: "  // 06 nodes online", tone: "comment" },
  ],
  [
    { text: "release.", tone: "value" },
    { text: "verify", tone: "method" },
    { text: "({ tests: " },
    { text: '"passed"', tone: "string" },
    { text: ", secrets: " },
    { text: '"sealed"', tone: "string" },
    { text: ", status: " },
    { text: "200", tone: "value" },
    { text: " });" },
    { text: "  // ready to ship", tone: "comment" },
  ],
  [
    { text: "memory.", tone: "value" },
    { text: "scope", tone: "method" },
    { text: "({ project: " },
    { text: '"DJL"', tone: "string" },
    { text: ", files: " },
    { text: '"local-only"', tone: "string" },
    { text: ", ttl: " },
    { text: "∞", tone: "value" },
    { text: " });" },
    { text: "  // context retained", tone: "comment" },
  ],
  [
    { text: "pipeline.", tone: "value" },
    { text: "commit", tone: "method" },
    { text: "({ branch: " },
    { text: '"main"', tone: "string" },
    { text: ", checks: " },
    { text: "6", tone: "value" },
    { text: ", approval: " },
    { text: '"required"', tone: "string" },
    { text: " });" },
    { text: "  // trace 7F2A", tone: "comment" },
  ],
];

const MODEL_URL = "/models/nexbot-djl-base.glb";
const CAP_URL = "/models/djl-baseball-cap-fitted.glb";
const HOODIE_URL = "/models/djl-hoodie-fitted.glb";
const CARBON_URL = "/textures/djl-carbon-v1.png";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const modelName = (name: string) =>
  name.replace(/_\d+$/, "").replaceAll("_", " ");
const isModelPart = (name: string, expected: string) => {
  const normalized = name.replaceAll("_", " ");
  return normalized === expected || normalized.startsWith(`${expected} `);
};

function makePivot(
  parent: THREE.Object3D,
  worldPosition: THREE.Vector3,
  name: string,
) {
  parent.updateMatrixWorld(true);
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.copy(parent.worldToLocal(worldPosition.clone()));
  parent.add(pivot);
  parent.updateMatrixWorld(true);
  return pivot;
}

function buildRig(root: THREE.Group): Rig {
  const arms: Joint[] = [];
  const forearms: Joint[] = [];
  const hands: Joint[] = [];
  let torso: Joint | undefined;
  let head: Joint | undefined;

  root.updateMatrixWorld(true);
  const originalHead = root.getObjectByName("Head");
  if (originalHead) {
    const box = new THREE.Box3().setFromObject(originalHead);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const pivot = makePivot(
      root,
      new THREE.Vector3(center.x, box.min.y + size.y * 0.08, center.z),
      "DJL head pivot",
    );
    pivot.attach(originalHead);
    head = { object: pivot, base: pivot.quaternion.clone(), side: 1 };
  }

  const armRoots: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (modelName(object.name) === "Hand LEFT") armRoots.push(object);
  });

  for (const armRoot of armRoots) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(armRoot);
    const center = box.getCenter(new THREE.Vector3());
    const side: -1 | 1 = center.x < 0 ? -1 : 1;
    let forearm: THREE.Object3D | undefined;
    armRoot.traverse((object) => {
      if (!forearm && modelName(object.name) === "forearm") forearm = object;
    });
    const handMesh = armRoot.children
      .flatMap((child) => {
        const descendants: THREE.Object3D[] = [];
        child.traverse((object) => descendants.push(object));
        return descendants;
      })
      .find((object) => modelName(object.name) === "Hand" && object instanceof THREE.Mesh);

    const shoulderPivot = makePivot(
      root,
      new THREE.Vector3(side * 0.6, box.max.y - 0.39, center.z),
      `DJL shoulder pivot ${side}`,
    );
    shoulderPivot.attach(armRoot);
    arms.push({
      object: shoulderPivot,
      base: shoulderPivot.quaternion.clone(),
      side,
    });

    if (!forearm) continue;
    shoulderPivot.updateMatrixWorld(true);
    const forearmBox = new THREE.Box3().setFromObject(forearm);
    const forearmCenter = forearmBox.getCenter(new THREE.Vector3());
    const elbowPivot = makePivot(
      shoulderPivot,
      new THREE.Vector3(side * 1.0, forearmBox.max.y - 0.05, forearmCenter.z),
      `DJL elbow pivot ${side}`,
    );
    elbowPivot.attach(forearm);
    forearms.push({
      object: elbowPivot,
      base: elbowPivot.quaternion.clone(),
      side,
    });

    if (!(handMesh instanceof THREE.Mesh)) continue;
    elbowPivot.updateMatrixWorld(true);
    const handBox = new THREE.Box3().setFromObject(handMesh);
    const handCenter = handBox.getCenter(new THREE.Vector3());
    const handPivot = makePivot(
      elbowPivot,
      new THREE.Vector3(side * 0.96, handBox.max.y - 0.12, handCenter.z),
      `DJL hand pivot ${side}`,
    );
    handPivot.attach(handMesh);
    hands.push({
      object: handPivot,
      base: handPivot.quaternion.clone(),
      side,
    });
  }

  let topPart = root.getObjectByName("Top part");
  let body = root.getObjectByName("Body");
  root.traverse((object) => {
    const name = modelName(object.name);
    if (!topPart && name === "Top part") topPart = object;
    if (!body && name === "Body") body = object;
  });
  if (topPart && body) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const pivot = makePivot(
      root,
      new THREE.Vector3(center.x, box.min.y + size.y * 0.025, center.z),
      "DJL waist pivot",
    );
    pivot.attach(topPart);
    if (head) {
      pivot.attach(head.object);
      head.base.copy(head.object.quaternion);
    }
    for (const arm of arms) {
      pivot.attach(arm.object);
      arm.base.copy(arm.object.quaternion);
    }
    torso = {
      object: pivot,
      base: pivot.quaternion.clone(),
      basePosition: pivot.position.clone(),
      side: 1,
    };
  }

  return { root, torso, head, arms, forearms, hands };
}

function applyJoint(
  joint: Joint,
  x: number,
  y: number,
  z: number,
  euler: THREE.Euler,
  delta: THREE.Quaternion,
) {
  euler.set(x, y, z, "XYZ");
  delta.setFromEuler(euler);
  joint.object.quaternion.copy(joint.base).multiply(delta);
}

function addVisorReflection(head: THREE.Object3D): VisorReflection | null {
  let visor: THREE.Mesh | null = null;
  head.traverse((object) => {
    if (
      !visor
      && object instanceof THREE.Mesh
      && isModelPart(object.name, "Head 2")
    ) {
      visor = object;
    }
  });
  if (!visor) return null;

  const visorMesh = visor as THREE.Mesh;
  visorMesh.geometry.computeBoundingBox();
  const bounds = visorMesh.geometry.boundingBox;
  if (!bounds) return null;

  const down = { value: 0.04 };
  const material = new THREE.ShaderMaterial({
    name: "DJL dynamic visor reflection",
    uniforms: {
      uDown: down,
      uMinY: { value: bounds.min.y },
      uMaxY: { value: bounds.max.y },
    },
    vertexShader: `
      uniform float uMinY;
      uniform float uMaxY;
      varying float vHeight;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;

      void main() {
        vHeight = clamp(
          (position.y - uMinY) / max(uMaxY - uMinY, 0.0001),
          0.0,
          1.0
        );
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = viewPosition.xyz;
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uDown;
      varying float vHeight;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;

      void main() {
        vec3 viewDirection = normalize(-vViewPosition);
        float facing = pow(
          max(dot(normalize(vViewNormal), viewDirection), 0.0),
          0.72
        );
        float edge = 0.30 + uDown * 0.39;
        float lowerWash = 1.0 - smoothstep(edge - 0.16, edge + 0.20, vHeight);
        float sweepCenter = 0.22 + uDown * 0.34;
        float sweep = exp(-pow((vHeight - sweepCenter) * 5.2, 2.0));
        float rim = pow(
          1.0 - max(dot(normalize(vViewNormal), viewDirection), 0.0),
          2.2
        );
        float strength = 0.045 + uDown * 0.70;
        float alpha = clamp(
          (lowerWash * 0.58 + sweep * 0.78 + rim * 0.12)
          * facing
          * strength,
          0.0,
          0.64
        );
        vec3 silver = mix(
          vec3(0.46, 0.55, 0.61),
          vec3(0.94, 0.975, 1.0),
          clamp(sweep * 0.82 + lowerWash * 0.34, 0.0, 1.0)
        );
        gl_FragColor = vec4(silver, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  const reflection = new THREE.Mesh(visorMesh.geometry, material);
  reflection.name = "DJL visor reflection";
  reflection.renderOrder = 6;
  visorMesh.add(reflection);

  return { material, down };
}

function addMatrixEyes(headPivot: THREE.Object3D, head: THREE.Object3D) {
  headPivot.updateMatrixWorld(true);
  const headBox = new THREE.Box3().setFromObject(head);
  const center = headBox.getCenter(new THREE.Vector3());
  const size = headBox.getSize(new THREE.Vector3());
  const eyeGroup = new THREE.Group();
  eyeGroup.name = "DJL matrix eyes";

  const led = new THREE.MeshBasicMaterial({
    color: 0xf4fbff,
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
    depthWrite: false,
  });
  const halo = new THREE.MeshBasicMaterial({
    color: 0xbce8ff,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    depthWrite: false,
  });
  const dotGeometry = new THREE.CircleGeometry(size.x * 0.0095, 12);
  const haloGeometry = new THREE.CircleGeometry(size.x * 0.018, 16);
  const rows = [
    [-1.5, -0.5, 0.5, 1.5],
    [-2, -1, 0, 1, 2],
    [-2, -1, 0, 1, 2],
    [-1.5, -0.5, 0.5, 1.5],
  ];
  const stepX = size.x * 0.033;
  const stepY = size.y * 0.027;
  const eyeY = headBox.min.y + size.y * 0.43;
  const eyeZ = headBox.max.z + size.z * 0.03;
  const eyeOffset = size.x * 0.18;
  const eyeCenter = new THREE.Vector3(center.x, eyeY, eyeZ);
  eyeGroup.position.copy(headPivot.worldToLocal(eyeCenter.clone()));
  headPivot.add(eyeGroup);
  headPivot.updateMatrixWorld(true);
  const pivotWorldQuaternion = headPivot.getWorldQuaternion(new THREE.Quaternion());
  const inversePivotQuaternion = pivotWorldQuaternion.clone().invert();

  for (const side of [-1, 1] as const) {
    rows.forEach((columns, row) => {
      columns.forEach((column) => {
        const world = new THREE.Vector3(
          eyeCenter.x + side * eyeOffset + column * stepX,
          eyeY - (row - 1.5) * stepY,
          eyeZ,
        );
        const local = world.sub(eyeCenter).applyQuaternion(inversePivotQuaternion);
        const glow = new THREE.Mesh(haloGeometry, halo);
        glow.position.copy(local);
        glow.position.z -= size.z * 0.002;
        glow.renderOrder = 7;
        eyeGroup.add(glow);

        const dot = new THREE.Mesh(dotGeometry, led);
        dot.position.copy(local);
        dot.renderOrder = 8;
        eyeGroup.add(dot);
      });
    });
  }

  return eyeGroup;
}

function attachFittedCap(
  headPivot: THREE.Object3D,
  robot: THREE.Group,
  cap: THREE.Group,
) {
  cap.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  robot.add(cap);
  robot.updateMatrixWorld(true);
  headPivot.attach(cap);
  return cap;
}

function attachFittedHoodie(robot: THREE.Group, hoodie: THREE.Group) {
  robot.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const part = modelName(object.name);
    const parents: string[] = [];
    let parent = object.parent;
    while (parent && parent !== robot) {
      parents.push(modelName(parent.name));
      parent = parent.parent;
    }

    const isUpperArmShell =
      part === "Cube 2" && parents.some((name) => name === "arm");
    if (isUpperArmShell) object.visible = false;
  });

  hoodie.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  robot.add(hoodie);
  return hoodie;
}

function makeCarbonMaterial(texture: THREE.Texture) {
  const source = texture.image as CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const width = source.naturalWidth ?? source.width ?? 1;
  const height = source.naturalHeight ?? source.height ?? 1;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (context) {
    context.drawImage(source, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);

    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const luma =
        pixels.data[offset] * 0.299
        + pixels.data[offset + 1] * 0.587
        + pixels.data[offset + 2] * 0.114;
      const weave = clamp01((luma - 8) / 61);
      const graphite = Math.round(188 + weave * 34);
      pixels.data[offset] = graphite;
      pixels.data[offset + 1] = graphite;
      pixels.data[offset + 2] = graphite;
    }

    context.putImageData(pixels, 0, 0);
    texture.image = canvas;
  }

  const map = texture;
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  // Most shell meshes have generated planar UVs. This density keeps the
  // weave at a believable physical scale instead of stretching one tile
  // across the entire torso.
  map.repeat.set(1.35, 1.35);
  map.anisotropy = 8;
  map.needsUpdate = true;

  return new THREE.MeshPhysicalMaterial({
    color: 0x343a40,
    map,
    bumpMap: map,
    bumpScale: 0.011,
    metalness: 0.02,
    roughness: 0.68,
    roughnessMap: map,
    clearcoat: 0.065,
    clearcoatRoughness: 0.44,
    specularIntensity: 0.22,
    envMapIntensity: 0.64,
  });
}

function ensureCarbonUv(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  if (geometry.getAttribute("uv")) return;
  const position = geometry.getAttribute("position");
  if (!position) return;

  const projectionScale = 0.22;
  const uv = new Float32Array(position.count * 2);
  const projected = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);

  for (let index = 0; index < position.count; index += 1) {
    projected.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
    uv[index * 2] = projected.x * projectionScale;
    uv[index * 2 + 1] = projected.y * projectionScale;
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

function materializeRobot(root: THREE.Group, carbonTexture: THREE.Texture) {
  const visor = new THREE.MeshPhysicalMaterial({
    color: 0x020304,
    metalness: 0.68,
    roughness: 0.055,
    clearcoat: 1,
    clearcoatRoughness: 0.018,
    envMapIntensity: 2.7,
  });
  const carbon = makeCarbonMaterial(carbonTexture);
  const satinShell = new THREE.MeshPhysicalMaterial({
    color: 0x111419,
    metalness: 0.62,
    roughness: 0.19,
    clearcoat: 0.92,
    clearcoatRoughness: 0.09,
    envMapIntensity: 1.85,
  });
  const jointMetal = new THREE.MeshStandardMaterial({
    color: 0x111419,
    metalness: 0.93,
    roughness: 0.24,
    envMapIntensity: 1.6,
  });
  const neckMetal = new THREE.MeshPhysicalMaterial({
    color: 0x8d949a,
    metalness: 1,
    roughness: 0.14,
    clearcoat: 0.55,
    clearcoatRoughness: 0.09,
    envMapIntensity: 2.25,
  });
  const handRubber = new THREE.MeshPhysicalMaterial({
    color: 0x07090b,
    metalness: 0.18,
    roughness: 0.38,
    clearcoat: 0.34,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.08,
  });

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = true;

    const parentNames: string[] = [];
    let parent: THREE.Object3D | null = object.parent;
    while (parent) {
      parentNames.push(parent.name);
      parent = parent.parent;
    }
    const ancestry = parentNames.join("/");
    const name = modelName(object.name);
    const shell =
      isModelPart(object.name, "Body")
      || isModelPart(object.name, "Cube 2")
      || isModelPart(object.name, "Cube 3")
      || isModelPart(object.name, "Cube 4");

    if (isModelPart(object.name, "Head 2")) {
      object.material = visor;
    } else if (shell) {
      ensureCarbonUv(object);
      object.material = carbon;
    } else if (isModelPart(object.name, "Hand")) {
      object.material = handRubber;
    } else if (ancestry.includes("Neck") && name.startsWith("Cylinder")) {
      object.material = neckMetal;
    } else if (isModelPart(object.name, "Cube 5")) {
      object.material = satinShell;
    } else {
      object.material = jointMetal;
    }
  });

  return [visor, carbon, satinShell, jointMetal, neckMetal, handRubber];
}

function makeRuntimeCodeTexture(tokens: RuntimeCodeToken[], index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 112;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.clearRect(0, 0, canvas.width, canvas.height);
  const rail = context.createLinearGradient(0, 0, canvas.width, 0);
  rail.addColorStop(0, "rgba(67, 132, 176, 0)");
  rail.addColorStop(0.15, "rgba(67, 132, 176, 0.18)");
  rail.addColorStop(0.78, "rgba(67, 132, 176, 0.1)");
  rail.addColorStop(1, "rgba(67, 132, 176, 0)");
  context.fillStyle = rail;
  context.fillRect(0, 60, canvas.width, 1);

  const haze = context.createLinearGradient(160, 0, 1900, 0);
  haze.addColorStop(0, "rgba(212, 233, 245, 0)");
  haze.addColorStop(0.12, "rgba(212, 233, 245, 0.1)");
  haze.addColorStop(0.78, "rgba(212, 233, 245, 0.07)");
  haze.addColorStop(1, "rgba(212, 233, 245, 0)");
  context.fillStyle = haze;
  context.fillRect(140, 25, 1800, 66);

  context.fillStyle = "rgba(24, 99, 151, 0.76)";
  context.fillRect(48, 51, 24, 2);
  context.font = '600 15px "Consolas", monospace';
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText(
    `DJL.RUNTIME / ${String(index + 1).padStart(2, "0")}`,
    86,
    65,
  );

  context.strokeStyle = "rgba(47, 119, 170, 0.24)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(196, 41);
  context.lineTo(196, 80);
  context.moveTo(196, 41);
  context.lineTo(215, 41);
  context.moveTo(196, 80);
  context.lineTo(215, 80);
  context.stroke();

  const colors: Record<NonNullable<RuntimeCodeToken["tone"]> | "plain", string> = {
    plain: "rgba(22, 43, 57, 0.82)",
    keyword: "rgba(18, 92, 151, 0.88)",
    method: "rgba(11, 70, 107, 0.86)",
    string: "rgba(130, 87, 50, 0.72)",
    value: "rgba(19, 105, 84, 0.76)",
    comment: "rgba(55, 72, 83, 0.4)",
  };
  context.font = '500 24px "Consolas", monospace';
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  let x = 238;
  for (const token of tokens) {
    context.fillStyle = colors[token.tone ?? "plain"];
    context.fillText(token.text, x, 69);
    x += context.measureText(token.text).width;
  }

  context.fillStyle = "rgba(20, 105, 166, 0.56)";
  context.beginPath();
  context.arc(1912, 60, 3, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(62, 133, 181, 0.18)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(1912, 60, 9, 0, Math.PI * 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function RobotLab({
  embedded = false,
  onReady,
}: {
  embedded?: boolean;
  onReady?: () => void;
} = {}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(0);
  const [ready, setReady] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const includeHoodie =
      new URLSearchParams(window.location.search).get("hoodie") === "1";
    const scene = new THREE.Scene();
    const dark = new THREE.Color(0x020304);
    const light = new THREE.Color(0xf2f4f6);
    scene.background = (embedded ? light : dark).clone();
    scene.fog = new THREE.Fog(0xf2f4f6, 11, 25);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 80);
    camera.position.set(0, 5.02, 2.42);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(dark, 1);
    mount.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentScene = new RoomEnvironment();
    const environment = pmrem.fromScene(environmentScene, 0.035).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.62;

    const ambient = new THREE.HemisphereLight(0xffffff, 0xcfd6dc, 0.26);
    scene.add(ambient);

    const key = new THREE.RectAreaLight(0xffffff, 2.05, 2.8, 4.5);
    key.position.set(-4.8, 6.7, 3.2);
    key.lookAt(0, 3.35, 0);
    scene.add(key);

    const fill = new THREE.RectAreaLight(0xc9e6ff, 0.8, 2.4, 4.2);
    fill.position.set(4.7, 5.3, 3.5);
    fill.lookAt(0, 3.2, 0);
    scene.add(fill);

    const rim = new THREE.RectAreaLight(0xffffff, 4.5, 3.2, 5.2);
    rim.position.set(-2.2, 5.7, -4.3);
    rim.lookAt(0, 3.5, 0);
    scene.add(rim);

    const top = new THREE.DirectionalLight(0xffffff, 0.84);
    top.position.set(2.5, 8.6, 4.8);
    top.castShadow = true;
    top.shadow.mapSize.set(1536, 1536);
    top.shadow.camera.left = -5;
    top.shadow.camera.right = 5;
    top.shadow.camera.top = 7;
    top.shadow.camera.bottom = -2;
    top.shadow.bias = -0.0004;
    scene.add(top);

    const floorMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe9ecef,
      metalness: 0.04,
      roughness: 0.83,
      clearcoat: 0.08,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 32), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.012;
    floor.receiveShadow = true;
    scene.add(floor);

    const plinthMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe1e5e9,
      metalness: 0.34,
      roughness: 0.3,
      clearcoat: 0.78,
      clearcoatRoughness: 0.13,
    });
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(2.08, 2.18, 0.075, 112),
      plinthMaterial,
    );
    plinth.position.y = -0.035;
    plinth.receiveShadow = true;
    scene.add(plinth);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x91a4b4,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      toneMapped: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.08, 2.095, 128), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    scene.add(ring);

    let rig: Rig | null = null;
    let robot: THREE.Group | null = null;
    let eyeGroup: THREE.Group | null = null;
    let visorReflection: VisorReflection | null = null;
    let introStart = 0;
    let bootTimer = 0;
    const ownedMaterials: THREE.Material[] = [
      floorMaterial,
      plinthMaterial,
      ringMaterial,
    ];
    const ownedTextures: THREE.Texture[] = [environment];
    const codeField = new THREE.Group();
    const codeRibbons: CodeRibbon[] = [];

    if (embedded) {
      codeField.name = "DJL runtime code field";
      const trackY = [5.66, 5.18, 4.7, 4.22, 3.74, 3.26];
      const trackZ = [-1.34, -1.02, -1.26, -0.96, -1.3, -1.08];
      const trackOpacity = [0.27, 0.34, 0.29, 0.37, 0.26, 0.32];
      const spacing = 6.8;
      const copies = 3;
      const span = spacing * copies;
      const maxAnisotropy = Math.min(
        4,
        renderer.capabilities.getMaxAnisotropy(),
      );

      RUNTIME_CODE_TRACKS.forEach((tokens, trackIndex) => {
        const texture = makeRuntimeCodeTexture(tokens, trackIndex);
        if (!texture) return;
        texture.anisotropy = maxAnisotropy;
        ownedTextures.push(texture);

        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: trackOpacity[trackIndex] ?? 0.74,
          depthTest: true,
          depthWrite: false,
          toneMapped: false,
          fog: false,
          side: THREE.FrontSide,
        });
        ownedMaterials.push(material);

        const stagger = (trackIndex * 1.13) % spacing;
        for (let copy = 0; copy < copies; copy += 1) {
          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(6.2, 0.32),
            material,
          );
          mesh.name = `DJL code ribbon ${trackIndex + 1}.${copy + 1}`;
          mesh.position.set(
            -10.2 + copy * spacing - stagger,
            trackY[trackIndex],
            trackZ[trackIndex],
          );
          mesh.frustumCulled = false;
          codeField.add(mesh);
          codeRibbons.push({
            mesh,
            speed: 0.32 + trackIndex * 0.026,
            span,
            baseOpacity: trackOpacity[trackIndex] ?? 0.74,
          });
        }
      });

      scene.add(codeField);
    }

    const loader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();
    const hoodiePromise: Promise<THREE.Group | null> = includeHoodie
      ? new Promise((resolve, reject) => {
          loader.load(HOODIE_URL, (gltf) => resolve(gltf.scene), undefined, reject);
        })
      : Promise.resolve(null);

    Promise.all([
      new Promise<THREE.Group>((resolve, reject) => {
        loader.load(
          MODEL_URL,
          (gltf) => resolve(gltf.scene),
          (event) => {
            if (event.total > 0) setLoading(Math.round((event.loaded / event.total) * 82));
          },
          reject,
        );
      }),
      new Promise<THREE.Group>((resolve, reject) => {
        loader.load(CAP_URL, (gltf) => resolve(gltf.scene), undefined, reject);
      }),
      hoodiePromise,
      textureLoader.loadAsync(CARBON_URL),
    ])
      .then(([model, cap, hoodie, carbonTexture]) => {
        ownedTextures.push(carbonTexture);
        model.name = "DJL NEXBOT";
        model.position.set(0.03, 2.44, 0);
        model.updateMatrixWorld(true);
        ownedMaterials.push(...materializeRobot(model, carbonTexture));
        model.updateMatrixWorld(true);

        const originalHead = model.getObjectByName("Head");
        rig = buildRig(model);
        if (originalHead && rig.head) {
          visorReflection = addVisorReflection(originalHead);
          if (visorReflection) ownedMaterials.push(visorReflection.material);
          eyeGroup = addMatrixEyes(rig.head.object, originalHead);
          attachFittedCap(rig.head.object, model, cap);
        }
        if (hoodie) attachFittedHoodie(model, hoodie);

        robot = model;
        scene.add(model);
        introStart = performance.now();
        setLoading(100);
        setReady(true);
        onReady?.();
        bootTimer = window.setTimeout(() => setBooting(false), reduceMotion ? 0 : 760);
      })
      .catch((error) => {
        console.error("DJL robot failed to load", error);
        setBooting(false);
      });

    const targetPointer = new THREE.Vector2();
    const headPointer = new THREE.Vector2();
    const bodyPointer = new THREE.Vector2();
    const cameraTarget = new THREE.Vector3(0, 5.02, 0.16);
    const background = dark.clone();
    const closeCamera = new THREE.Vector3(
      0,
      embedded ? 5.1 : 5.02,
      embedded ? 2.76 : 2.42,
    );
    const endCamera = new THREE.Vector3();
    const closeTarget = new THREE.Vector3(
      0,
      embedded ? 5.12 : 5.02,
      0.15,
    );
    const endTarget = new THREE.Vector3();
    const euler = new THREE.Euler();
    const delta = new THREE.Quaternion();
    let lastFrameTime = performance.now();
    let frame = 0;
    let disposed = false;
    let robotVisible = true;
    let gatewayState = document.documentElement.dataset.djlGatewayState ?? "hero-ready";
    const frozenForGateway = (value: string) => (
      value.startsWith("playing")
      || value.startsWith("settling")
      || value === "rail-ready"
    );
    const onPointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      targetPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      targetPointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const onPointerLeave = () => targetPointer.set(0, 0);
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerleave", onPointerLeave);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      const mobile = width < 720;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.7));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = mobile ? 35 : 32;
      camera.updateProjectionMatrix();
      if (embedded) {
        endCamera.set(0, mobile ? 4.42 : 4.4, mobile ? 7.62 : 7.35);
        endTarget.set(0, mobile ? 4.3 : 4.24, 0.08);
      } else {
        endCamera.set(0, mobile ? 4.4 : 4.36, mobile ? 6.2 : 5.95);
        endTarget.set(0, mobile ? 4.36 : 4.32, 0.08);
      }
      codeRibbons.forEach((ribbon, ribbonIndex) => {
        const trackIndex = Math.floor(ribbonIndex / 3);
        ribbon.mesh.visible = !mobile || trackIndex % 2 === 0;
      });
    };
    resize();
    window.addEventListener("resize", resize);
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        robotVisible = entry?.isIntersecting ?? false;
        if (robotVisible) lastFrameTime = performance.now();
      },
      { rootMargin: "5% 0px", threshold: 0 },
    );
    visibilityObserver.observe(mount);
    const onGatewayState = (event: Event) => {
      const wasFrozen = frozenForGateway(gatewayState);
      const nextState = (
        event as CustomEvent<{ state?: string }>
      ).detail?.state ?? gatewayState;
      gatewayState = nextState;
      if (wasFrozen && !frozenForGateway(nextState)) {
        lastFrameTime = performance.now();
      }
    };
    window.addEventListener("djl:gateway-state", onGatewayState);

    const render = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      if (!robotVisible || document.hidden || frozenForGateway(gatewayState)) {
        lastFrameTime = now;
        return;
      }
      const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;
      const pointerDistance = headPointer.distanceTo(targetPointer);
      const headResponse = THREE.MathUtils.lerp(
        19,
        36,
        clamp01(pointerDistance * 1.65),
      );
      headPointer.x = THREE.MathUtils.damp(
        headPointer.x,
        targetPointer.x,
        headResponse,
        dt,
      );
      headPointer.y = THREE.MathUtils.damp(
        headPointer.y,
        targetPointer.y,
        headResponse,
        dt,
      );
      bodyPointer.x = THREE.MathUtils.damp(bodyPointer.x, targetPointer.x, 10, dt);
      bodyPointer.y = THREE.MathUtils.damp(bodyPointer.y, targetPointer.y, 10, dt);
      if (visorReflection) {
        const reflectionTarget = 0.04 + clamp01(-headPointer.y) * 0.96;
        visorReflection.down.value = THREE.MathUtils.damp(
          visorReflection.down.value,
          reflectionTarget,
          17,
          dt,
        );
      }

      let intro = 1;
      if (introStart > 0 && !reduceMotion) {
        intro = smooth((now - introStart - 280) / 3100);
      }
      const reveal = embedded ? 1 : smooth((intro - 0.04) / 0.72);
      background.copy(dark).lerp(light, reveal);
      scene.background = background;
      if (scene.fog) scene.fog.color.copy(light);
      key.intensity = THREE.MathUtils.lerp(0.08, 1.7, reveal);
      fill.intensity = THREE.MathUtils.lerp(0.02, 0.28, reveal);
      rim.intensity = THREE.MathUtils.lerp(0.08, 3.2, reveal);
      top.intensity = THREE.MathUtils.lerp(0.03, 0.32, reveal);
      ringMaterial.opacity = 0.28 * reveal;

      camera.position.lerpVectors(closeCamera, endCamera, intro);
      cameraTarget.lerpVectors(closeTarget, endTarget, intro);
      camera.lookAt(cameraTarget);

      if (embedded && codeRibbons.length > 0) {
        for (const ribbon of codeRibbons) {
          if (!reduceMotion) {
            ribbon.mesh.position.x += ribbon.speed * dt;
            if (ribbon.mesh.position.x > 10.2) {
              ribbon.mesh.position.x -= ribbon.span;
            }
          }
          ribbon.mesh.material.opacity = ribbon.baseOpacity * reveal;
        }
      }

      if (rig) {
        const idle = reduceMotion ? 0 : Math.sin(now * 0.00165) * 0.018;
        const armPhase =
          introStart > 0 ? ((now - introStart) / 10800) * Math.PI * 2 : 0;
        const armLift = reduceMotion ? 0.22 : 0.5 + Math.sin(armPhase) * 0.5;
        const armEase = smooth(armLift);
        const palmTurn = smooth((armEase - 0.16) / 0.84);
        const palmDrift = reduceMotion ? 0 : Math.sin(armPhase * 2 - 0.45) * 0.035;
        const wristDrift = reduceMotion ? 0 : Math.sin(armPhase * 2 + 0.7) * 0.018;

        if (rig.torso) {
          const torsoBase = rig.torso.basePosition;
          if (torsoBase) {
            rig.torso.object.position.set(
              torsoBase.x + bodyPointer.x * 0.022,
              torsoBase.y + bodyPointer.y * 0.008,
              torsoBase.z,
            );
          }
          applyJoint(
            rig.torso,
            -bodyPointer.y * 0.045 + idle * 0.22,
            bodyPointer.x * 0.1,
            -bodyPointer.x * 0.018,
            euler,
            delta,
          );
        }

        if (rig.head) {
          applyJoint(
            rig.head,
            -headPointer.y * 0.145,
            headPointer.x * 0.32,
            -headPointer.x * 0.032,
            euler,
            delta,
          );
        }

        for (const shoulder of rig.arms) {
          const spread = 0.19 + armEase * 0.035 + idle * shoulder.side * 0.2;
          applyJoint(
            shoulder,
            -0.025 - armEase * 0.025,
            shoulder.side * wristDrift * 0.08,
            shoulder.side * spread,
            euler,
            delta,
          );
        }

        for (const forearm of rig.forearms) {
          applyJoint(
            forearm,
            -0.02 - armEase * 1.48,
            forearm.side * wristDrift * 0.2,
            forearm.side * (0.01 + armEase * 0.14),
            euler,
            delta,
          );
        }

        for (const hand of rig.hands) {
          applyJoint(
            hand,
            -0.02 - palmTurn * 0.16,
            hand.side * (0.015 + palmTurn * 1.26 + palmDrift),
            hand.side * (0.01 + palmTurn * 0.1) + wristDrift * 0.45,
            euler,
            delta,
          );
        }
      }

      if (eyeGroup) {
        const blinkPhase = (now * 0.0017) % 7;
        const blink = blinkPhase > 6.82 ? Math.max(0.12, Math.abs(blinkPhase - 6.91) * 11) : 1;
        eyeGroup.scale.y = THREE.MathUtils.damp(eyeGroup.scale.y, blink, 24, dt);
      }
      if (robot) {
        robot.position.y = 2.44 + Math.sin(now * 0.0011) * 0.006 * intro;
      }

      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(bootTimer);
      window.removeEventListener("resize", resize);
      window.removeEventListener("djl:gateway-state", onGatewayState);
      visibilityObserver.disconnect();
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerleave", onPointerLeave);
      renderer.dispose();
      pmrem.dispose();
      environmentScene.dispose();
      ownedMaterials.forEach((material) => material.dispose());
      ownedTextures.forEach((texture) => texture.dispose());
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      renderer.domElement.remove();
    };
  }, [embedded, onReady]);

  return (
    <main className={`robot-lab${embedded ? " robot-lab--embedded" : ""}`}>
      <div ref={mountRef} className="robot-lab__viewport" aria-label="DJL robot interactive preview" />

      {!embedded ? (
        <>
          <header className="robot-lab__header">
            <div className="robot-lab__brand">
              <strong>DJL</strong>
              <span>ROBOT LAB / 01</span>
            </div>
            <div className="robot-lab__status" data-ready={ready}>
              <i />
              <span>{ready ? "LOCAL MODEL ONLINE" : `LOADING ${loading}%`}</span>
            </div>
          </header>

          <aside className="robot-lab__spec robot-lab__spec--left" aria-hidden="true">
            <span>MODEL</span>
            <strong>NEXBOT / DJL-01</strong>
            <small>CARBON COMPOSITE</small>
          </aside>

          <aside className="robot-lab__spec robot-lab__spec--right" aria-hidden="true">
            <span>RESPONSE</span>
            <strong>HEAD / WAIST / ARMS</strong>
            <small>TRACKING + IDLE CYCLE</small>
          </aside>

          <footer className="robot-lab__footer" aria-hidden="true">
            <span>DESIGN</span>
            <i />
            <span>JUDGMENT</span>
            <i />
            <span>LOGIC</span>
          </footer>

          <div className="robot-lab__boot" data-open={booting}>
            <strong>DJL</strong>
            <span />
          </div>
        </>
      ) : null}
    </main>
  );
}
