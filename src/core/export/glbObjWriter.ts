import type {
  AcDummyNode,
  GeneratedTrackScene,
  ProceduralMesh,
} from '../../types/track.ts';
import { cross3, normalize3 } from '../mesh/math.ts';
import { sanitizeSingleLineText, sanitizeSlug } from './sanitize.ts';

type MaterialKey = ProceduralMesh['materialKey'];

interface GlbMaterialDef {
  key: MaterialKey;
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
}

const GLB_MATERIALS: GlbMaterialDef[] = [
  { key: 'ROAD', baseColor: [0.18, 0.19, 0.21, 1], metallic: 0.05, roughness: 0.85 },
  { key: 'KERB', baseColor: [0.85, 0.16, 0.16, 1], metallic: 0.0, roughness: 0.75 },
  { key: 'GRASS', baseColor: [0.24, 0.44, 0.19, 1], metallic: 0.0, roughness: 0.95 },
  { key: 'WALL', baseColor: [0.64, 0.66, 0.68, 1], metallic: 0.3, roughness: 0.65 },
  { key: 'BUILDING', baseColor: [0.72, 0.69, 0.64, 1], metallic: 0.05, roughness: 0.8 },
  { key: 'TREE', baseColor: [0.16, 0.37, 0.15, 1], metallic: 0.0, roughness: 0.92 },
];

const MATERIAL_INDEX = new Map<MaterialKey, number>(
  GLB_MATERIALS.map((m, idx) => [m.key, idx])
);

function dummyToQuaternion(dummy: AcDummyNode): [number, number, number, number] {
  const f = normalize3(dummy.forward, { x: 0, y: 0, z: 1 });
  const uRaw = normalize3(dummy.up, { x: 0, y: 1, z: 0 });
  const r = normalize3(cross3(uRaw, f), { x: 1, y: 0, z: 0 });
  const u = normalize3(cross3(f, r), { x: 0, y: 1, z: 0 });

  // Rotation matrix columns: X = r, Y = u, Z = f
  const m00 = r.x, m01 = u.x, m02 = f.x;
  const m10 = r.y, m11 = u.y, m12 = f.y;
  const m20 = r.z, m21 = u.z, m22 = f.z;

  const trace = m00 + m11 + m22;
  let qx: number, qy: number, qz: number, qw: number;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1.0) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }

  return [qx, qy, qz, qw];
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(5) : '0.00000';
}

/**
 * Generates a Wavefront `.obj` file with `o <mesh.name>` object groups,
 * vertex/normal/UV buffers, faces, and AC dummy transform comments.
 */
export function buildObjText(scene: GeneratedTrackScene): string {
  const safeName = sanitizeSingleLineText(scene.config.trackName) || 'OpenTarmac Track';
  const safeSlug = sanitizeSlug(scene.config.trackSlug);
  const lines: string[] = [
    `# OpenTarmac Wavefront OBJ Export`,
    `# Track: ${safeName} (${safeSlug})`,
    `# Length: ${scene.stats.lengthMeters.toFixed(1)}m | Triangles: ${scene.stats.triangleCount}`,
    '',
  ];

  if (scene.dummies.length > 0) {
    lines.push('# Assetto Corsa Dummy Nodes');
    for (const d of scene.dummies) {
      const dummyName = sanitizeSingleLineText(d.name, 80);
      lines.push(
        `# AC_DUMMY ${dummyName} kind=${d.kind} pos=(${fmt(d.position.x)},${fmt(d.position.y)},${fmt(d.position.z)}) fwd=(${fmt(d.forward.x)},${fmt(d.forward.y)},${fmt(d.forward.z)}) up=(${fmt(d.up.x)},${fmt(d.up.y)},${fmt(d.up.z)})`
      );
    }
    lines.push('');
  }

  let vertexOffset = 1;
  let uvOffset = 1;
  let normalOffset = 1;

  for (const mesh of scene.meshes) {
    const vertCount = Math.floor(mesh.positions.length / 3);
    if (vertCount === 0 || mesh.indices.length === 0) continue;

    lines.push(`o ${sanitizeSingleLineText(mesh.name, 80)}`);
    lines.push(`usemtl ${mesh.materialKey}`);

    for (let i = 0; i < vertCount; i++) {
      lines.push(
        `v ${fmt(mesh.positions[i * 3])} ${fmt(mesh.positions[i * 3 + 1])} ${fmt(mesh.positions[i * 3 + 2])}`
      );
    }

    const uvCount = Math.floor(mesh.uvs.length / 2);
    for (let i = 0; i < vertCount; i++) {
      const u = i < uvCount ? mesh.uvs[i * 2] : 0;
      const v = i < uvCount ? mesh.uvs[i * 2 + 1] : 0;
      lines.push(`vt ${fmt(u)} ${fmt(v)}`);
    }

    const normCount = Math.floor(mesh.normals.length / 3);
    for (let i = 0; i < vertCount; i++) {
      const nx = i < normCount ? mesh.normals[i * 3] : 0;
      const ny = i < normCount ? mesh.normals[i * 3 + 1] : 1;
      const nz = i < normCount ? mesh.normals[i * 3 + 2] : 0;
      lines.push(`vn ${fmt(nx)} ${fmt(ny)} ${fmt(nz)}`);
    }

    for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
      const a = mesh.indices[i];
      const b = mesh.indices[i + 1];
      const c = mesh.indices[i + 2];
      lines.push(
        `f ${a + vertexOffset}/${a + uvOffset}/${a + normalOffset} ${b + vertexOffset}/${b + uvOffset}/${b + normalOffset} ${c + vertexOffset}/${c + uvOffset}/${c + normalOffset}`
      );
    }

    lines.push('');
    vertexOffset += vertCount;
    uvOffset += vertCount;
    normalOffset += vertCount;
  }

  return lines.join('\n');
}

function padTo4(n: number): number {
  return (n + 3) & ~3;
}

function computeVec3MinMax(arr: Float32Array, count: number): { min: [number, number, number]; max: [number, number, number] } {
  if (count === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = arr[i * 3];
    const y = arr[i * 3 + 1];
    const z = arr[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/**
 * Generates a valid glTF 2.0 binary (`.glb`) containing all track meshes,
 * PBR materials, and AC dummy empty nodes for inspection in Blender / ksEditor.
 */
export function buildGlbBytes(scene: GeneratedTrackScene): Uint8Array {
  const binChunks: Uint8Array[] = [];
  let binByteOffset = 0;

  interface BufferViewJson {
    buffer: number;
    byteOffset: number;
    byteLength: number;
    target?: number;
  }

  interface AccessorJson {
    bufferView: number;
    componentType: number;
    count: number;
    type: 'SCALAR' | 'VEC2' | 'VEC3';
    min?: number[];
    max?: number[];
  }

  interface GltfNodeJson {
    name: string;
    mesh?: number;
    translation?: [number, number, number];
    rotation?: [number, number, number, number];
  }

  const bufferViews: BufferViewJson[] = [];
  const accessors: AccessorJson[] = [];
  const gltfMeshes: Array<{
    name: string;
    primitives: Array<{
      attributes: Record<string, number>;
      indices: number;
      material: number;
    }>;
  }> = [];
  const nodes: GltfNodeJson[] = [];

  const appendBin = (typed: ArrayBufferView, target: number): number => {
    const raw = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const paddedLen = padTo4(raw.byteLength);
    const slice = new Uint8Array(paddedLen);
    slice.set(raw);
    const bvIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: binByteOffset,
      byteLength: raw.byteLength,
      target,
    });
    binChunks.push(slice);
    binByteOffset += paddedLen;
    return bvIdx;
  };

  for (const mesh of scene.meshes) {
    const vertCount = Math.floor(mesh.positions.length / 3);
    if (vertCount === 0 || mesh.indices.length === 0) continue;

    // Ensure normals & UVs match vertCount cleanly
    const positions = mesh.positions.subarray(0, vertCount * 3);
    const normals =
      mesh.normals.length >= vertCount * 3
        ? mesh.normals.subarray(0, vertCount * 3)
        : (() => {
            const arr = new Float32Array(vertCount * 3);
            for (let i = 0; i < vertCount; i++) arr[i * 3 + 1] = 1;
            return arr;
          })();
    const uvs =
      mesh.uvs.length >= vertCount * 2
        ? mesh.uvs.subarray(0, vertCount * 2)
        : new Float32Array(vertCount * 2);

    const posBv = appendBin(positions, 34962); // ARRAY_BUFFER
    const normBv = appendBin(normals, 34962);
    const uvBv = appendBin(uvs, 34962);
    const idxBv = appendBin(mesh.indices, 34963); // ELEMENT_ARRAY_BUFFER

    const { min, max } = computeVec3MinMax(positions, vertCount);

    const posAcc = accessors.length;
    accessors.push({ bufferView: posBv, componentType: 5126, count: vertCount, type: 'VEC3', min, max });

    const normAcc = accessors.length;
    accessors.push({ bufferView: normBv, componentType: 5126, count: vertCount, type: 'VEC3' });

    const uvAcc = accessors.length;
    accessors.push({ bufferView: uvBv, componentType: 5126, count: vertCount, type: 'VEC2' });

    const idxAcc = accessors.length;
    accessors.push({ bufferView: idxBv, componentType: 5125, count: mesh.indices.length, type: 'SCALAR' });

    const meshIdx = gltfMeshes.length;
    gltfMeshes.push({
      name: mesh.name,
      primitives: [
        {
          attributes: {
            POSITION: posAcc,
            NORMAL: normAcc,
            TEXCOORD_0: uvAcc,
          },
          indices: idxAcc,
          material: MATERIAL_INDEX.get(mesh.materialKey) ?? 0,
        },
      ],
    });

    nodes.push({
      name: mesh.name,
      mesh: meshIdx,
    });
  }

  for (const dummy of scene.dummies) {
    nodes.push({
      name: dummy.name,
      translation: [dummy.position.x, dummy.position.y, dummy.position.z],
      rotation: dummyToQuaternion(dummy),
    });
  }

  const rootIndices = nodes.map((_, i) => i);

  const gltfJson: Record<string, unknown> = {
    asset: {
      version: '2.0',
      generator: 'OpenTarmac',
    },
    scene: 0,
    scenes: [
      {
        name: sanitizeSlug(scene.config.trackSlug, 'track'),
        nodes: rootIndices,
      },
    ],
    nodes,
    materials: GLB_MATERIALS.map((m) => ({
      name: m.key,
      pbrMetallicRoughness: {
        baseColorFactor: m.baseColor,
        metallicFactor: m.metallic,
        roughnessFactor: m.roughness,
      },
    })),
  };

  if (gltfMeshes.length > 0) {
    gltfJson.meshes = gltfMeshes;
    gltfJson.bufferViews = bufferViews;
    gltfJson.accessors = accessors;
    gltfJson.buffers = [{ byteLength: binByteOffset }];
  }

  const jsonBytesRaw = new TextEncoder().encode(JSON.stringify(gltfJson));
  const jsonPaddedLen = padTo4(jsonBytesRaw.length);
  const binPaddedLen = padTo4(binByteOffset);
  const hasBin = binPaddedLen > 0;

  const totalLength = 12 + 8 + jsonPaddedLen + (hasBin ? 8 + binPaddedLen : 0);
  const out = new Uint8Array(totalLength);
  const view = new DataView(out.buffer);

  // Header
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true); // version 2
  view.setUint32(8, totalLength, true);

  // JSON chunk
  let offset = 12;
  view.setUint32(offset, jsonPaddedLen, true);
  view.setUint32(offset + 4, 0x4e4f534a, true); // "JSON"
  offset += 8;
  out.set(jsonBytesRaw, offset);
  for (let i = jsonBytesRaw.length; i < jsonPaddedLen; i++) {
    out[offset + i] = 0x20; // space padding per glTF spec
  }
  offset += jsonPaddedLen;

  // BIN chunk
  if (hasBin) {
    view.setUint32(offset, binPaddedLen, true);
    view.setUint32(offset + 4, 0x004e4942, true); // "BIN\0"
    offset += 8;
    for (const chunk of binChunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
  }

  return out;
}
