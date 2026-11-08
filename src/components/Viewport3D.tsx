import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { sampleCenterlineAtDistance } from '../core/mesh';
import type {
  AcDummyNode,
  CenterlinePoint,
  GeneratedTrackScene,
  MeshLayerKind,
  ProceduralMesh,
} from '../types/track.ts';

export interface Viewport3DProps {
  scene: GeneratedTrackScene | null;
  visibleLayers: Record<MeshLayerKind, boolean>;
  showDummies: boolean;
  wireframe: boolean;
  flyThrough: boolean;
  onCaptureRef?: (captureFn: () => { previewPng?: Uint8Array; outlinePng?: Uint8Array }) => void;
}

type MaterialKey = ProceduralMesh['materialKey'];

const MATERIAL_STYLE: Record<
  MaterialKey,
  { color: number; roughness: number; metalness: number }
> = {
  ROAD: { color: 0x3b414a, roughness: 0.82, metalness: 0.06 },
  KERB: { color: 0xdc2626, roughness: 0.72, metalness: 0.02 },
  GRASS: { color: 0x35642a, roughness: 0.94, metalness: 0.0 },
  WALL: { color: 0x9ca3af, roughness: 0.6, metalness: 0.25 },
  BUILDING: { color: 0xb8b0a4, roughness: 0.8, metalness: 0.05 },
  TREE: { color: 0x2b5e26, roughness: 0.9, metalness: 0.0 },
};

function dataUrlToUint8Array(dataUrl: string): Uint8Array | undefined {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return undefined;
  const base64 = dataUrl.slice(commaIdx + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function createSceneTexture(
  key: MaterialKey,
  scene: GeneratedTrackScene
): THREE.Texture | null {
  if (
    key === 'GRASS' &&
    scene.config.satelliteImagery !== false &&
    scene.satellite &&
    scene.satellite.rgba.length === scene.satellite.width * scene.satellite.height * 4
  ) {
    const satTex = new THREE.DataTexture(
      scene.satellite.rgba,
      scene.satellite.width,
      scene.satellite.height,
      THREE.RGBAFormat
    );
    satTex.wrapS = THREE.ClampToEdgeWrapping;
    satTex.wrapT = THREE.ClampToEdgeWrapping;
    satTex.flipY = false;
    satTex.colorSpace = THREE.SRGBColorSpace;
    satTex.magFilter = THREE.LinearFilter;
    satTex.minFilter = THREE.LinearMipmapLinearFilter;
    satTex.generateMipmaps = true;
    satTex.needsUpdate = true;
    return satTex;
  }

  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (key === 'KERB') {
    ctx.fillStyle = '#ececec';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(0, 0, size, size / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, 10, size);
    ctx.fillRect(size - 10, 0, 10, size);
  } else if (key === 'ROAD') {
    const tint = scene.sampledRoadTintRgb;
    const baseR = tint ? Math.round(56 * 0.55 + tint.r * 0.45) : 58;
    const baseG = tint ? Math.round(58 * 0.55 + tint.g * 0.45) : 60;
    const baseB = tint ? Math.round(62 * 0.55 + tint.b * 0.45) : 64;
    ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
    ctx.fillRect(0, 0, size, size);

    // Subtle tire wear tracks along left & right wheel lanes
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(Math.round(size * 0.2), 0, Math.round(size * 0.14), size);
    ctx.fillRect(Math.round(size * 0.66), 0, Math.round(size * 0.14), size);

    // Asphalt mineral grain
    for (let i = 0; i < 1400; i++) {
      const x = (i * 73) % size;
      const y = (i * 139) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.14)';
      ctx.fillRect(x, y, 2, 2);
    }

    // Crisp shoulder edges & dashed center stripe
    ctx.fillStyle = 'rgba(236,242,248,0.52)';
    ctx.fillRect(6, 0, 5, size);
    ctx.fillRect(size - 11, 0, 5, size);
    ctx.fillStyle = 'rgba(248,250,252,0.58)';
    ctx.fillRect(size / 2 - 2, 14, 4, 52);
    ctx.fillRect(size / 2 - 2, 142, 4, 52);
  } else if (key === 'BUILDING') {
    const facadeH = Math.round(size * 0.8);
    ctx.fillStyle = '#bab2a6';
    ctx.fillRect(0, 0, size, facadeH);
    for (let y = 8; y < facadeH - 16; y += 32) {
      for (let x = 8; x < size; x += 32) {
        ctx.fillStyle = '#425670';
        ctx.fillRect(x, y, 14, 14);
      }
    }
    ctx.fillStyle = '#6f5c55';
    ctx.fillRect(0, facadeH, size, size - facadeH);
    for (let x = 0; x < size; x += 16) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, facadeH, 2, size - facadeH);
    }
  } else if (key === 'TREE') {
    const barkH = Math.round(size * 0.19);
    ctx.fillStyle = '#5e422b';
    ctx.fillRect(0, 0, size, barkH);
    for (let i = 0; i < 120; i++) {
      const x = (i * 43) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(160,120,84,0.18)';
      ctx.fillRect(x, 0, 3, barkH);
    }
    ctx.fillStyle = '#2d5c28';
    ctx.fillRect(0, barkH, size, size - barkH);
    for (let i = 0; i < 650; i++) {
      const x = (i * 59) % size;
      const y = barkH + ((i * 97) % (size - barkH));
      const rad = 4 + (i % 5);
      ctx.fillStyle =
        i % 3 === 0
          ? 'rgba(101,163,13,0.24)'
          : i % 3 === 1
            ? 'rgba(20,83,45,0.34)'
            : 'rgba(134,239,172,0.14)';
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (key === 'GRASS') {
    ctx.fillStyle = '#3b6e2f';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 600; i++) {
      const x = (i * 53) % size;
      const y = (i * 89) % size;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(134,239,172,0.09)' : 'rgba(20,83,45,0.16)';
      ctx.fillRect(x, y, 4, 4);
    }
  } else {
    const hex = `#${MATERIAL_STYLE[key].color.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function renderOutlinePng(scene: GeneratedTrackScene): Uint8Array | undefined {
  if (typeof document === 'undefined' || scene.centerline.length < 2) {
    return undefined;
  }
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  ctx.clearRect(0, 0, size, size);

  const lines =
    scene.config.freeRoam && scene.networkRoadsXZ && scene.networkRoadsXZ.length > 0
      ? scene.networkRoadsXZ.filter((l) => l.length >= 2)
      : [scene.centerline.map((pt) => ({ x: pt.position.x, z: pt.position.z }))];

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const line of lines) {
    for (const pt of line) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.z > maxZ) maxZ = pt.z;
    }
  }
  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const pad = 48;
  const scale = Math.min((size - pad * 2) / spanX, (size - pad * 2) / spanZ);
  const offsetX = (size - spanX * scale) * 0.5;
  const offsetY = (size - spanZ * scale) * 0.5;

  const mapPt = (x: number, z: number): [number, number] => [
    offsetX + (x - minX) * scale,
    offsetY + (z - minZ) * scale,
  ];

  // Outer shadow stroke & inner light outline across all included roads
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let lIdx = lines.length - 1; lIdx >= 0; lIdx--) {
    const line = lines[lIdx];
    const isPrimary = lIdx === 0;
    ctx.beginPath();
    line.forEach((pt, idx) => {
      const [px, py] = mapPt(pt.x, pt.z);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.lineWidth = isPrimary ? 10 : 6;
    ctx.stroke();

    ctx.strokeStyle = isPrimary ? '#f8fafc' : '#cbd5e1';
    ctx.lineWidth = isPrimary ? 5 : 3;
    ctx.stroke();
  }

  // Start/finish marker
  const [sx, sy] = mapPt(scene.centerline[0].position.x, scene.centerline[0].position.z);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(sx, sy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  return dataUrlToUint8Array(canvas.toDataURL('image/png'));
}

function createDummyGizmo(
  dummy: AcDummyNode,
  disposables: Array<{ dispose: () => void }>
): THREE.Group {
  const group = new THREE.Group();
  group.name = dummy.name;
  group.position.set(dummy.position.x, dummy.position.y, dummy.position.z);

  const f = new THREE.Vector3(dummy.forward.x, dummy.forward.y, dummy.forward.z);
  if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
  f.normalize();

  const u = new THREE.Vector3(dummy.up.x, dummy.up.y, dummy.up.z);
  if (u.lengthSq() < 1e-6) u.set(0, 1, 0);
  u.normalize();

  const r = new THREE.Vector3().crossVectors(u, f);
  if (r.lengthSq() < 1e-6) r.set(1, 0, 0);
  r.normalize();
  u.crossVectors(f, r).normalize();

  const basis = new THREE.Matrix4().makeBasis(r, u, f);
  group.quaternion.setFromRotationMatrix(basis);

  if (dummy.kind === 'start' || dummy.kind === 'pit' || dummy.kind === 'hotlap_start') {
    const color =
      dummy.kind === 'start'
        ? 0x10b981
        : dummy.kind === 'hotlap_start'
          ? 0x38bdf8
          : 0xf59e0b;
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.35,
      roughness: 0.4,
    });
    disposables.push(mat);

    const padGeo = new THREE.BoxGeometry(1.8, 0.1, 3.4);
    disposables.push(padGeo);
    const pad = new THREE.Mesh(padGeo, mat);
    pad.position.set(0, 0.08, 0);
    group.add(pad);

    const shaftGeo = new THREE.BoxGeometry(0.24, 0.14, 2.0);
    disposables.push(shaftGeo);
    const shaft = new THREE.Mesh(shaftGeo, mat);
    shaft.position.set(0, 0.32, 0.5);
    group.add(shaft);

    const coneGeo = new THREE.ConeGeometry(0.42, 0.9, 10);
    coneGeo.rotateX(Math.PI / 2);
    disposables.push(coneGeo);
    const cone = new THREE.Mesh(coneGeo, mat);
    cone.position.set(0, 0.32, 1.85);
    group.add(cone);
  } else {
    // Timing gate post (AC_TIME_*_L / AC_TIME_*_R)
    const redMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 0.25,
      roughness: 0.45,
    });
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.45,
    });
    disposables.push(redMat, whiteMat);

    const segGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.85, 12);
    disposables.push(segGeo);
    for (let s = 0; s < 4; s++) {
      const seg = new THREE.Mesh(segGeo, s % 2 === 0 ? redMat : whiteMat);
      seg.position.set(0, 0.425 + s * 0.85, 0);
      group.add(seg);
    }

    const capGeo = new THREE.SphereGeometry(0.26, 12, 12);
    disposables.push(capGeo);
    const cap = new THREE.Mesh(capGeo, redMat);
    cap.position.set(0, 3.6, 0);
    group.add(cap);
  }

  return group;
}

function sampleFlyPose(
  points: CenterlinePoint[],
  dist: number
): { pos: THREE.Vector3; forward: THREE.Vector3 } {
  const frame = sampleCenterlineAtDistance(points, dist, true);
  return {
    pos: new THREE.Vector3(frame.position.x, frame.position.y, frame.position.z),
    forward: new THREE.Vector3(frame.forward.x, frame.forward.y, frame.forward.z),
  };
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  scene,
  visibleLayers,
  showDummies,
  wireframe,
  flyThrough,
  onCaptureRef,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const threeSceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const dummyGroupRef = useRef<THREE.Group | null>(null);
  const layerMeshesRef = useRef<Map<MeshLayerKind, THREE.Mesh[]>>(new Map());
  const materialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const dirLightRef = useRef<THREE.DirectionalLight | null>(null);

  const [webglUnavailable, setWebglUnavailable] = useState(false);

  const visibleLayersRef = useRef(visibleLayers);
  visibleLayersRef.current = visibleLayers;
  const showDummiesRef = useRef(showDummies);
  showDummiesRef.current = showDummies;
  const wireframeRef = useRef(wireframe);
  wireframeRef.current = wireframe;
  const flyThroughRef = useRef(flyThrough);
  flyThroughRef.current = flyThrough;
  const scenePropRef = useRef(scene);
  scenePropRef.current = scene;

  const flyDistanceRef = useRef(0);
  const flySmoothPosRef = useRef<THREE.Vector3 | null>(null);
  const flySmoothTargetRef = useRef<THREE.Vector3 | null>(null);

  // Initialize Three.js WebGLRenderer, Scene, Camera, Controls, Lights, and animation loop
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: false,
          preserveDrawingBuffer: false,
        });
      } catch {
        setWebglUnavailable(true);
        return;
      }
    }
    setWebglUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x0b1120);
    threeScene.fog = new THREE.FogExp2(0x0b1120, 0.00038);

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.5, 12000);
    camera.position.set(160, 140, 180);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 5;
    controls.maxDistance = 5000;

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.85);
    threeScene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfff7ed, 1.85);
    dirLight.position.set(220, 320, 180);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 2500;
    const shadowExtent = 450;
    dirLight.shadow.camera.left = -shadowExtent;
    dirLight.shadow.camera.right = shadowExtent;
    dirLight.shadow.camera.top = shadowExtent;
    dirLight.shadow.camera.bottom = -shadowExtent;
    dirLight.shadow.bias = -0.0005;
    threeScene.add(dirLight);
    threeScene.add(dirLight.target);

    const gridHelper = new THREE.GridHelper(2400, 80, 0x334155, 0x1e293b);
    gridHelper.position.y = -0.25;
    threeScene.add(gridHelper);

    const sceneGroup = new THREE.Group();
    const dummyGroup = new THREE.Group();
    threeScene.add(sceneGroup);
    threeScene.add(dummyGroup);

    rendererRef.current = renderer;
    threeSceneRef.current = threeScene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    sceneGroupRef.current = sceneGroup;
    dummyGroupRef.current = dummyGroup;
    gridHelperRef.current = gridHelper;
    dirLightRef.current = dirLight;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(1, Math.floor(entry.contentRect.width));
      const h = Math.max(1, Math.floor(entry.contentRect.height));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    let rafId = 0;
    let lastTime = performance.now();

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const currentScene = scenePropRef.current;
      if (
        flyThroughRef.current &&
        currentScene &&
        currentScene.centerline.length >= 2
      ) {
        controls.enabled = false;
        const flySpeed = 38; // meters per second
        flyDistanceRef.current += flySpeed * dt;
        const totalLen =
          currentScene.centerline[currentScene.centerline.length - 1].distanceFromStart;
        if (totalLen > 0) {
          flyDistanceRef.current = flyDistanceRef.current % totalLen;
        }

        const curr = sampleFlyPose(
          currentScene.centerline,
          flyDistanceRef.current
        );
        const ahead = sampleFlyPose(
          currentScene.centerline,
          flyDistanceRef.current + 24
        );

        const desiredPos = curr.pos
          .clone()
          .addScaledVector(curr.forward, -4.5)
          .add(new THREE.Vector3(0, 2.8, 0));
        const desiredTarget = ahead.pos
          .clone()
          .add(new THREE.Vector3(0, 1.3, 0));

        if (!flySmoothPosRef.current || !flySmoothTargetRef.current) {
          flySmoothPosRef.current = desiredPos.clone();
          flySmoothTargetRef.current = desiredTarget.clone();
        } else {
          const alpha = 1 - Math.exp(-6 * dt);
          flySmoothPosRef.current.lerp(desiredPos, alpha);
          flySmoothTargetRef.current.lerp(desiredTarget, alpha);
        }

        camera.position.copy(flySmoothPosRef.current);
        camera.lookAt(flySmoothTargetRef.current);
        controls.target.copy(flySmoothTargetRef.current);
      } else {
        controls.enabled = true;
        controls.update();
      }

      renderer.render(threeScene, camera);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.dispose();
      gridHelper.geometry.dispose();
      if (Array.isArray(gridHelper.material)) {
        gridHelper.material.forEach((m) => m.dispose());
      } else {
        gridHelper.material.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      threeSceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      sceneGroupRef.current = null;
      dummyGroupRef.current = null;
    };
  }, []);

  // Register snapshot capture function for UI / ZIP export
  useEffect(() => {
    if (!onCaptureRef) return;
    onCaptureRef(() => {
      const renderer = rendererRef.current;
      const threeScene = threeSceneRef.current;
      const camera = cameraRef.current;
      const currentScene = scenePropRef.current;

      let previewPng: Uint8Array | undefined;
      if (renderer && threeScene && camera) {
        try {
          renderer.render(threeScene, camera);
          previewPng = dataUrlToUint8Array(renderer.domElement.toDataURL('image/png'));
        } catch {
          previewPng = undefined;
        }
      }

      let outlinePng: Uint8Array | undefined;
      if (currentScene) {
        try {
          outlinePng = renderOutlinePng(currentScene);
        } catch {
          outlinePng = undefined;
        }
      }

      return { previewPng, outlinePng };
    });
  }, [onCaptureRef]);

  // Rebuild Three.js geometry and dummy gizmos whenever `scene` changes
  useEffect(() => {
    const sceneGroup = sceneGroupRef.current;
    const dummyGroup = dummyGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const gridHelper = gridHelperRef.current;
    const dirLight = dirLightRef.current;
    if (!sceneGroup || !dummyGroup || !camera || !controls) return;

    const disposables: Array<{ dispose: () => void }> = [];

    // Clear previous scene contents
    while (sceneGroup.children.length > 0) {
      sceneGroup.remove(sceneGroup.children[0]);
    }
    while (dummyGroup.children.length > 0) {
      dummyGroup.remove(dummyGroup.children[0]);
    }
    layerMeshesRef.current.clear();
    materialsRef.current = [];
    flyDistanceRef.current = 0;
    flySmoothPosRef.current = null;
    flySmoothTargetRef.current = null;

    if (!scene) {
      return;
    }

    // Build shared materials per materialKey
    const matMap = new Map<MaterialKey, THREE.MeshStandardMaterial>();
    (Object.keys(MATERIAL_STYLE) as MaterialKey[]).forEach((key) => {
      const style = MATERIAL_STYLE[key];
      const tex = createSceneTexture(key, scene);
      if (tex) disposables.push(tex);
      const isRoadLike = key === 'ROAD' || key === 'KERB';
      const mat = new THREE.MeshStandardMaterial({
        color: tex ? 0xffffff : style.color,
        map: tex ?? undefined,
        roughness: style.roughness,
        metalness: style.metalness,
        side: THREE.DoubleSide,
        wireframe: wireframeRef.current,
        polygonOffset: isRoadLike,
        polygonOffsetFactor: isRoadLike ? -3 : 0,
        polygonOffsetUnits: isRoadLike ? -3 : 0,
      });
      disposables.push(mat);
      matMap.set(key, mat);
      materialsRef.current.push(mat);
    });

    const overallBounds = new THREE.Box3();

    for (const proc of scene.meshes) {
      if (proc.positions.length === 0 || proc.indices.length === 0) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(proc.positions, 3));
      if (proc.normals.length === proc.positions.length) {
        geo.setAttribute('normal', new THREE.BufferAttribute(proc.normals, 3));
      } else {
        geo.computeVertexNormals();
      }
      if (proc.uvs.length >= (proc.positions.length / 3) * 2) {
        geo.setAttribute('uv', new THREE.BufferAttribute(proc.uvs, 2));
      }
      geo.setIndex(new THREE.BufferAttribute(proc.indices, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      disposables.push(geo);

      if (geo.boundingBox) {
        overallBounds.union(geo.boundingBox);
      }

      const material = matMap.get(proc.materialKey)!;
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = proc.name;
      mesh.visible = visibleLayersRef.current[proc.layer] ?? true;
      mesh.renderOrder = proc.layer === 'road' ? 2 : proc.layer === 'kerb' ? 3 : 0;
      mesh.receiveShadow = proc.layer === 'road' || proc.layer === 'terrain' || proc.layer === 'kerb';
      mesh.castShadow = proc.layer === 'building' || proc.layer === 'wall' || proc.layer === 'tree';

      sceneGroup.add(mesh);
      const bucket = layerMeshesRef.current.get(proc.layer) ?? [];
      bucket.push(mesh);
      layerMeshesRef.current.set(proc.layer, bucket);
    }

    // Build AC Dummy Gizmos
    for (const dummy of scene.dummies) {
      const gizmo = createDummyGizmo(dummy, disposables);
      dummyGroup.add(gizmo);
    }
    dummyGroup.visible = showDummiesRef.current;

    // Frame camera around scene bounds & scale fog/far-plane/grid for massive networks
    if (!overallBounds.isEmpty()) {
      const center = overallBounds.getCenter(new THREE.Vector3());
      const size = overallBounds.getSize(new THREE.Vector3());
      const radius = Math.max(40, size.length() * 0.5);

      camera.near = radius > 2500 ? 2.5 : 0.5;
      camera.far = Math.max(15000, radius * 10);
      camera.updateProjectionMatrix();

      controls.maxDistance = Math.max(6000, radius * 5);
      controls.target.copy(center);
      camera.position.set(
        center.x + radius * 0.68,
        center.y + Math.max(55, radius * 0.45),
        center.z + radius * 0.68
      );
      camera.lookAt(center);
      controls.update();

      const threeScene = threeSceneRef.current;
      if (threeScene) {
        const fogDensity = Math.min(0.00032, 0.25 / Math.max(600, radius));
        threeScene.fog = new THREE.FogExp2(0x0b1120, fogDensity);
      }

      if (gridHelper) {
        const gridScale = Math.max(1, (radius * 2.5) / 2400);
        gridHelper.scale.set(gridScale, 1, gridScale);
        gridHelper.position.set(center.x, overallBounds.min.y - 0.5, center.z);
      }
      if (dirLight) {
        const shadowExtent = Math.min(1100, Math.max(240, radius * 0.55));
        dirLight.shadow.camera.left = -shadowExtent;
        dirLight.shadow.camera.right = shadowExtent;
        dirLight.shadow.camera.top = shadowExtent;
        dirLight.shadow.camera.bottom = -shadowExtent;
        dirLight.shadow.camera.far = Math.max(2500, radius * 4);
        dirLight.shadow.bias = -0.00025;
        dirLight.shadow.camera.updateProjectionMatrix();
        dirLight.position.set(
          center.x + radius * 0.6,
          center.y + Math.max(250, radius),
          center.z + radius * 0.4
        );
        dirLight.target.position.copy(center);
        dirLight.target.updateMatrixWorld();
      }
    }

    return () => {
      while (sceneGroup.children.length > 0) {
        sceneGroup.remove(sceneGroup.children[0]);
      }
      while (dummyGroup.children.length > 0) {
        dummyGroup.remove(dummyGroup.children[0]);
      }
      for (const item of disposables) {
        item.dispose();
      }
      layerMeshesRef.current.clear();
      materialsRef.current = [];
    };
  }, [scene]);

  // Layer visibility sync without rebuilding meshes
  useEffect(() => {
    layerMeshesRef.current.forEach((meshes, layer) => {
      const isVisible = visibleLayers[layer] ?? true;
      for (const m of meshes) {
        m.visible = isVisible;
      }
    });
  }, [visibleLayers]);

  // Dummy gizmos visibility sync
  useEffect(() => {
    if (dummyGroupRef.current) {
      dummyGroupRef.current.visible = showDummies;
    }
  }, [showDummies]);

  // Wireframe sync
  useEffect(() => {
    for (const mat of materialsRef.current) {
      mat.wireframe = wireframe;
      mat.needsUpdate = true;
    }
  }, [wireframe]);

  // Reset smooth fly-through interpolators when toggling off
  useEffect(() => {
    if (!flyThrough) {
      flySmoothPosRef.current = null;
      flySmoothTargetRef.current = null;
    }
  }, [flyThrough]);

  // Render 2D fallback canvas when WebGL is disabled/unavailable
  useEffect(() => {
    if (!webglUnavailable) return;
    const canvas = fallbackCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, width, height);

    if (!scene || scene.centerline.length < 2) return;

    const lines =
      scene.networkRoadsXZ && scene.networkRoadsXZ.length > 0
        ? scene.networkRoadsXZ.filter((l) => l.length >= 2)
        : [scene.centerline.map((pt) => ({ x: pt.position.x, z: pt.position.z }))];

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const line of lines) {
      for (const pt of line) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      }
    }
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const pad = 48;
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanZ);
    const ox = (width - spanX * scale) * 0.5;
    const oy = (height - spanZ * scale) * 0.5;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let lIdx = lines.length - 1; lIdx >= 0; lIdx--) {
      const line = lines[lIdx];
      const isPrimary = lIdx === 0;
      ctx.beginPath();
      line.forEach((pt, idx) => {
        const px = ox + (pt.x - minX) * scale;
        const py = oy + (pt.z - minZ) * scale;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = isPrimary ? '#e53935' : '#64748b';
      ctx.lineWidth = isPrimary ? 3.5 : 1.75;
      ctx.stroke();
    }
  }, [webglUnavailable, scene]);

  return (
    <div className="relative w-full h-full bg-[#0b0d10] overflow-hidden select-none">
      <div ref={containerRef} className={webglUnavailable ? 'hidden' : 'w-full h-full'} />
      {webglUnavailable && (
        <canvas ref={fallbackCanvasRef} className="w-full h-full block" />
      )}

      {webglUnavailable && (
        <div className="absolute top-3 left-3 right-3 pointer-events-none flex justify-center">
          <div className="bg-[#101318]/92 border border-amber-500/35 rounded-lg px-3.5 py-2 text-xs text-amber-100 shadow-xl backdrop-blur-md max-w-md text-center">
            WebGL 3D context is disabled in this browser — showing 2D geometry fallback. Track generation and <span className="font-mono">.kn5/.zip</span> export still work normally.
          </div>
        </div>
      )}

      {!scene && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-4">
          <div className="bg-[#101318]/92 border border-white/[0.08] rounded-xl px-5 py-4 text-center max-w-sm shadow-xl backdrop-blur-md">
            <p className="text-[13px] font-semibold tracking-[-0.01em] text-zinc-100">
              Waiting for road selection
            </p>
            <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
              Click any road on the map to trace a route, or drag Highlight Area to build a free-roam network.
            </p>
          </div>
        </div>
      )}

      {scene && (
        <div className="absolute bottom-3 left-3 pointer-events-none flex items-center gap-2 bg-[#101318]/88 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-400 shadow-lg backdrop-blur-md">
          <span className="text-zinc-300">
            {flyThrough ? 'Fly-through active' : 'Drag orbit \u00B7 Right-drag pan \u00B7 Scroll zoom'}
          </span>
          <span className="text-zinc-700">&middot;</span>
          <span className="font-mono tabular-nums text-zinc-300">
            {scene.stats.triangleCount.toLocaleString()} tris
          </span>
        </div>
      )}
    </div>
  );
};
