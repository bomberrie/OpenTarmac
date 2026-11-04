import type {
  AcDummyNode,
  GeneratedTrackScene,
  ProceduralMesh,
} from '../../types/track.ts';
import { cross3, normalize3 } from '../mesh/math.ts';
import { encodeRgbaToDds } from './ddsEncoder.ts';
import { sanitizeSlug } from './sanitize.ts';

const TEXT_ENCODER = new TextEncoder();
const MAX_KN5_VERTICES = 65000;

type MaterialKey = ProceduralMesh['materialKey'];

interface MaterialSpec {
  key: MaterialKey;
  textureName: string;
  ambient: number;
  diffuse: number;
  specular: number;
  specularExp: number;
}

const MATERIAL_SPECS: MaterialSpec[] = [
  { key: 'ROAD', textureName: 'asphalt.dds', ambient: 0.35, diffuse: 0.72, specular: 0.12, specularExp: 24 },
  { key: 'KERB', textureName: 'kerb.dds', ambient: 0.4, diffuse: 0.85, specular: 0.08, specularExp: 16 },
  { key: 'GRASS', textureName: 'grass.dds', ambient: 0.38, diffuse: 0.75, specular: 0.02, specularExp: 8 },
  { key: 'WALL', textureName: 'wall.dds', ambient: 0.36, diffuse: 0.78, specular: 0.18, specularExp: 20 },
  { key: 'BUILDING', textureName: 'building.dds', ambient: 0.4, diffuse: 0.8, specular: 0.08, specularExp: 12 },
  { key: 'TREE', textureName: 'tree.dds', ambient: 0.38, diffuse: 0.72, specular: 0.02, specularExp: 6 },
];

const MATERIAL_INDEX_MAP = new Map<MaterialKey, number>(
  MATERIAL_SPECS.map((m, idx) => [m.key, idx])
);

class BinaryWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(initialCapacity = 65536) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    const needed = this.pos + extra;
    if (needed <= this.buf.length) return;
    let nextCap = this.buf.length * 2;
    while (nextCap < needed) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  writeUint8(v: number): void {
    this.ensure(1);
    this.buf[this.pos++] = v & 0xff;
  }

  writeUint16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v & 0xffff, true);
    this.pos += 2;
  }

  writeInt32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, v | 0, true);
    this.pos += 4;
  }

  writeFloat32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  writeRawAscii(str: string): void {
    this.ensure(str.length);
    for (let i = 0; i < str.length; i++) {
      this.buf[this.pos++] = str.charCodeAt(i) & 0xff;
    }
  }

  writeKn5String(str: string): void {
    const bytes = TEXT_ENCODER.encode(str);
    if (bytes.length > 1024) {
      throw new RangeError(`KN5 string exceeds max length (1024 bytes): ${bytes.length}`);
    }
    this.writeInt32(bytes.length);
    this.writeBytes(bytes);
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

function hash2d(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function generateProceduralTexturePng(
  key: MaterialKey,
  scene: GeneratedTrackScene
): Uint8Array {
  if (
    key === 'GRASS' &&
    scene.config.satelliteImagery !== false &&
    scene.satellite &&
    scene.satellite.rgba.length === scene.satellite.width * scene.satellite.height * 4
  ) {
    return encodeRgbaToDds(
      scene.satellite.width,
      scene.satellite.height,
      scene.satellite.rgba
    );
  }

  const size = 256;
  const rgba = new Uint8Array(size * size * 4);
  const tint = scene.sampledRoadTintRgb;
  const roadBaseR = tint ? Math.round(54 * 0.55 + clampByte(tint.r) * 0.45) : 58;
  const roadBaseG = tint ? Math.round(56 * 0.55 + clampByte(tint.g) * 0.45) : 60;
  const roadBaseB = tint ? Math.round(60 * 0.55 + clampByte(tint.b) * 0.45) : 64;

  for (let y = 0; y < size; y++) {
    const u = y / size;
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nFine = hash2d(x, y, key.charCodeAt(0));
      const nCoarse = hash2d(x >> 3, y >> 3, key.charCodeAt(0) + 17);
      let r = 128;
      let g = 128;
      let b = 128;

      switch (key) {
        case 'ROAD': {
          const uNorm = x / size;
          // Subtle aggregate micro-grain + macro asphalt weathering + tire wear tracks
          const trackDistL = Math.abs(uNorm - 0.27);
          const trackDistR = Math.abs(uNorm - 0.73);
          const wearL = Math.exp(-(trackDistL * trackDistL) / 0.0045);
          const wearR = Math.exp(-(trackDistR * trackDistR) / 0.0045);
          const wearShade = -(wearL + wearR) * 7;
          const grain = (nFine - 0.5) * 18 + (nCoarse - 0.5) * 10 + wearShade;

          r = roadBaseR + grain;
          g = roadBaseG + grain;
          b = roadBaseB + grain;

          // Weathered edge lines & dashed center divider
          const isEdgeLine =
            (x >= 7 && x <= 11) || (x >= size - 12 && x <= size - 8);
          const isCenterDash =
            x >= size / 2 - 2 && x <= size / 2 + 1 && u % 0.5 < 0.26;
          if (isEdgeLine || isCenterDash) {
            const blend = isEdgeLine ? 0.52 : 0.62;
            const paint = 225 + (nFine - 0.5) * 16;
            r = r * (1 - blend) + paint * blend;
            g = g * (1 - blend) + paint * blend;
            b = b * (1 - blend) + paint * blend;
          }
          break;
        }
        case 'KERB': {
          const isRed = Math.floor(y / 64) % 2 === 0;
          const jitter = (nFine - 0.5) * 12 + (nCoarse - 0.5) * 8;
          const edgeBevel = x < 10 || x > size - 10 ? -16 : 0;
          if (isRed) {
            r = 210 + jitter + edgeBevel;
            g = 38 + jitter + edgeBevel;
            b = 38 + jitter + edgeBevel;
          } else {
            r = 234 + jitter + edgeBevel;
            g = 234 + jitter + edgeBevel;
            b = 232 + jitter + edgeBevel;
          }
          break;
        }
        case 'GRASS': {
          const v = (nFine - 0.5) * 20 + (nCoarse - 0.5) * 22;
          r = 66 + v * 0.85;
          g = 114 + v;
          b = 50 + v * 0.55;
          break;
        }
        case 'WALL': {
          const band = y % 32 < 4 ? -20 : 0;
          const v = (nFine - 0.5) * 12 + band;
          r = 160 + v;
          g = 164 + v;
          b = 170 + v;
          break;
        }
        case 'BUILDING': {
          const vNorm = y / size;
          const v = (nFine - 0.5) * 12 + (nCoarse - 0.5) * 8;
          if (vNorm >= 0.8) {
            // Architectural slate / terracotta roof tile band [0.80..1.0]
            const tileRib = x % 16 < 2 ? -10 : 0;
            r = 112 + v + tileRib;
            g = 94 + v + tileRib;
            b = 88 + v + tileRib;
          } else {
            // Wall masonry + dark glass windows in facade band [0.0..0.78]
            const isWindow = x % 32 >= 8 && x % 32 <= 22 && y % 32 >= 8 && y % 32 <= 22;
            if (isWindow) {
              r = 66 + v;
              g = 86 + v;
              b = 112 + v;
            } else {
              r = 188 + v;
              g = 180 + v;
              b = 168 + v;
            }
          }
          break;
        }
        case 'TREE': {
          const vNorm = y / size;
          if (vNorm < 0.19) {
            // Woody bark texture band [0..0.19]
            const barkStreak = hash2d(x, y >> 3, 41) - 0.5;
            const v = (nFine - 0.5) * 18 + barkStreak * 28;
            r = 96 + v;
            g = 68 + v * 0.7;
            b = 44 + v * 0.5;
          } else {
            // Layered canopy foliage needles/leaves [0.19..1.0]
            const leafCluster = hash2d(x >> 2, y >> 2, 91);
            const heightShade = ((vNorm - 0.2) / 0.8 - 0.35) * 22;
            const v = (nFine - 0.5) * 26 + (leafCluster - 0.5) * 30 + heightShade;
            r = 46 + v * 0.65;
            g = 98 + v;
            b = 38 + v * 0.5;
          }
          break;
        }
      }

      rgba[idx] = clampByte(r);
      rgba[idx + 1] = clampByte(g);
      rgba[idx + 2] = clampByte(b);
      rgba[idx + 3] = 255;
    }
  }

  return encodeRgbaToDds(size, size, rgba);
}

function buildDummyMatrix(dummy: AcDummyNode): Float32Array {
  const f = normalize3(dummy.forward, { x: 0, y: 0, z: 1 });
  const uRaw = normalize3(dummy.up, { x: 0, y: 1, z: 0 });
  const r = normalize3(cross3(uRaw, f), { x: 1, y: 0, z: 0 });
  const u = normalize3(cross3(f, r), { x: 0, y: 1, z: 0 });

  return new Float32Array([
    r.x, r.y, r.z, 0,
    u.x, u.y, u.z, 0,
    f.x, f.y, f.z, 0,
    dummy.position.x, dummy.position.y, dummy.position.z, 1,
  ]);
}

function computeTangents(mesh: ProceduralMesh): Float32Array {
  const vertCount = Math.floor(mesh.positions.length / 3);
  const tangents = new Float32Array(vertCount * 3);
  const pos = mesh.positions;
  const norm = mesh.normals;
  const uvs = mesh.uvs;
  const idx = mesh.indices;

  for (let i = 0; i + 2 < idx.length; i += 3) {
    const i0 = idx[i];
    const i1 = idx[i + 1];
    const i2 = idx[i + 2];
    if (i0 >= vertCount || i1 >= vertCount || i2 >= vertCount) continue;

    const x0 = pos[i0 * 3], y0 = pos[i0 * 3 + 1], z0 = pos[i0 * 3 + 2];
    const x1 = pos[i1 * 3], y1 = pos[i1 * 3 + 1], z1 = pos[i1 * 3 + 2];
    const x2 = pos[i2 * 3], y2 = pos[i2 * 3 + 1], z2 = pos[i2 * 3 + 2];

    const u0 = uvs[i0 * 2] ?? 0, v0 = uvs[i0 * 2 + 1] ?? 0;
    const u1 = uvs[i1 * 2] ?? 0, v1 = uvs[i1 * 2 + 1] ?? 0;
    const u2 = uvs[i2 * 2] ?? 0, v2 = uvs[i2 * 2 + 1] ?? 0;

    const dx1 = x1 - x0, dy1 = y1 - y0, dz1 = z1 - z0;
    const dx2 = x2 - x0, dy2 = y2 - y0, dz2 = z2 - z0;
    const du1 = u1 - u0, dv1 = v1 - v0;
    const du2 = u2 - u0, dv2 = v2 - v0;

    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-8) continue;
    const invDet = 1 / det;

    const tx = (dx1 * dv2 - dx2 * dv1) * invDet;
    const ty = (dy1 * dv2 - dy2 * dv1) * invDet;
    const tz = (dz1 * dv2 - dz2 * dv1) * invDet;

    for (const vi of [i0, i1, i2]) {
      tangents[vi * 3] += tx;
      tangents[vi * 3 + 1] += ty;
      tangents[vi * 3 + 2] += tz;
    }
  }

  for (let v = 0; v < vertCount; v++) {
    const nx = norm[v * 3] ?? 0;
    const ny = norm[v * 3 + 1] ?? 1;
    const nz = norm[v * 3 + 2] ?? 0;
    let tx = tangents[v * 3];
    let ty = tangents[v * 3 + 1];
    let tz = tangents[v * 3 + 2];

    // Gram-Schmidt orthogonalize
    const dot = nx * tx + ny * ty + nz * tz;
    tx -= nx * dot;
    ty -= ny * dot;
    tz -= nz * dot;

    const len = Math.hypot(tx, ty, tz);
    if (len > 1e-6) {
      tangents[v * 3] = tx / len;
      tangents[v * 3 + 1] = ty / len;
      tangents[v * 3 + 2] = tz / len;
    } else {
      // Safe fallback orthogonal vector
      const axis = Math.abs(ny) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      const ortho = normalize3(cross3(axis, { x: nx, y: ny, z: nz }), { x: 1, y: 0, z: 0 });
      tangents[v * 3] = ortho.x;
      tangents[v * 3 + 1] = ortho.y;
      tangents[v * 3 + 2] = ortho.z;
    }
  }

  return tangents;
}

function splitMeshForKn5(mesh: ProceduralMesh): ProceduralMesh[] {
  const vertCount = Math.floor(mesh.positions.length / 3);
  if (vertCount <= MAX_KN5_VERTICES) {
    return [mesh];
  }

  const chunks: ProceduralMesh[] = [];
  const remap = new Int32Array(vertCount);
  remap.fill(-1);

  let partIndex = 0;
  let chunkPositions: number[] = [];
  let chunkNormals: number[] = [];
  let chunkUvs: number[] = [];
  let chunkIndices: number[] = [];
  let touchedVerts: number[] = [];

  const flushChunk = () => {
    if (chunkIndices.length === 0) return;
    chunks.push({
      name: `${mesh.name}_part${partIndex++}`,
      layer: mesh.layer,
      materialKey: mesh.materialKey,
      positions: new Float32Array(chunkPositions),
      normals: new Float32Array(chunkNormals),
      uvs: new Float32Array(chunkUvs),
      indices: new Uint32Array(chunkIndices),
    });
    for (const v of touchedVerts) remap[v] = -1;
    chunkPositions = [];
    chunkNormals = [];
    chunkUvs = [];
    chunkIndices = [];
    touchedVerts = [];
  };

  for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
    const tri = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    let neededNew = 0;
    for (const v of tri) {
      if (remap[v] === -1) neededNew++;
    }
    if (chunkPositions.length / 3 + neededNew > MAX_KN5_VERTICES) {
      flushChunk();
    }
    for (const v of tri) {
      let localIdx = remap[v];
      if (localIdx === -1) {
        localIdx = chunkPositions.length / 3;
        remap[v] = localIdx;
        touchedVerts.push(v);
        chunkPositions.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]);
        chunkNormals.push(mesh.normals[v * 3] ?? 0, mesh.normals[v * 3 + 1] ?? 1, mesh.normals[v * 3 + 2] ?? 0);
        chunkUvs.push(mesh.uvs[v * 2] ?? 0, mesh.uvs[v * 2 + 1] ?? 0);
      }
      chunkIndices.push(localIdx);
    }
  }
  flushChunk();

  return chunks;
}

function computeBoundingSphere(positions: Float32Array): { cx: number; cy: number; cz: number; radius: number } {
  const vertCount = Math.floor(positions.length / 3);
  if (vertCount === 0) return { cx: 0, cy: 0, cz: 0, radius: 0 };

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  let maxDistSq = 0;
  for (let i = 0; i < vertCount; i++) {
    const dx = positions[i * 3] - cx;
    const dy = positions[i * 3 + 1] - cy;
    const dz = positions[i * 3 + 2] - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > maxDistSq) maxDistSq = d2;
  }

  return { cx, cy, cz, radius: Math.sqrt(maxDistSq) };
}

function writeMaterialProperty(
  w: BinaryWriter,
  name: string,
  valueA: number
): void {
  w.writeKn5String(name);
  w.writeFloat32(valueA);
  // valueB (Vec2 = 2 floats), valueC (Vec3 = 3 floats), valueD (Vec4 = 4 floats) => 9 floats
  for (let i = 0; i < 9; i++) {
    w.writeFloat32(0);
  }
}

function writeDummyNode(
  w: BinaryWriter,
  name: string,
  childCount: number,
  matrix: Float32Array
): void {
  w.writeInt32(1); // nodeClass = 1 (Dummy)
  w.writeKn5String(name);
  w.writeInt32(childCount);
  w.writeUint8(1); // active
  for (let i = 0; i < 16; i++) {
    w.writeFloat32(matrix[i]);
  }
}

function writeMeshNode(w: BinaryWriter, mesh: ProceduralMesh): void {
  const vertCount = Math.floor(mesh.positions.length / 3);
  if (vertCount > 65535) {
    throw new RangeError(`KN5 mesh "${mesh.name}" exceeds uint16 vertex limit: ${vertCount}`);
  }
  const tangents = computeTangents(mesh);
  const bounds = computeBoundingSphere(mesh.positions);
  const materialId = MATERIAL_INDEX_MAP.get(mesh.materialKey) ?? 0;
  const castsShadows = mesh.layer === 'building' || mesh.layer === 'wall' || mesh.layer === 'tree' ? 1 : 0;

  w.writeInt32(2); // nodeClass = 2 (Mesh)
  w.writeKn5String(mesh.name);
  w.writeInt32(0); // childCount
  w.writeUint8(1); // active
  w.writeUint8(castsShadows);
  w.writeUint8(1); // isVisible
  w.writeUint8(0); // isTransparent

  w.writeInt32(vertCount);
  for (let v = 0; v < vertCount; v++) {
    w.writeFloat32(mesh.positions[v * 3]);
    w.writeFloat32(mesh.positions[v * 3 + 1]);
    w.writeFloat32(mesh.positions[v * 3 + 2]);

    w.writeFloat32(mesh.normals[v * 3] ?? 0);
    w.writeFloat32(mesh.normals[v * 3 + 1] ?? 1);
    w.writeFloat32(mesh.normals[v * 3 + 2] ?? 0);

    w.writeFloat32(mesh.uvs[v * 2] ?? 0);
    w.writeFloat32(mesh.uvs[v * 2 + 1] ?? 0);

    w.writeFloat32(tangents[v * 3]);
    w.writeFloat32(tangents[v * 3 + 1]);
    w.writeFloat32(tangents[v * 3 + 2]);
  }

  w.writeInt32(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) {
    const idx = mesh.indices[i];
    if (idx < 0 || idx >= vertCount) {
      throw new RangeError(`KN5 mesh "${mesh.name}" has out-of-range index ${idx} (vertCount=${vertCount})`);
    }
    w.writeUint16(idx);
  }

  w.writeInt32(materialId);
  w.writeInt32(0); // layer
  w.writeFloat32(0); // lodIn
  w.writeFloat32(0); // lodOut
  w.writeFloat32(bounds.cx);
  w.writeFloat32(bounds.cy);
  w.writeFloat32(bounds.cz);
  w.writeFloat32(bounds.radius);
  w.writeUint8(1); // isRenderable
}

/**
 * Generates a valid little-endian Assetto Corsa `.kn5` v5 binary container
 * with embedded procedural PNG textures, `ksPerPixel` materials, mesh geometry,
 * and AC dummy nodes (`AC_START_*`, `AC_PIT_*`, `AC_TIME_*`).
 */
export function buildKn5Bytes(scene: GeneratedTrackScene): Uint8Array {
  const writer = new BinaryWriter(262144);

  // 1. Header: "sc6969" + int32 version 5
  writer.writeRawAscii('sc6969');
  writer.writeInt32(5);

  // 2. Embedded textures
  writer.writeInt32(MATERIAL_SPECS.length);
  for (const spec of MATERIAL_SPECS) {
    const ddsBytes = generateProceduralTexturePng(spec.key, scene);
    writer.writeInt32(1); // active
    writer.writeKn5String(spec.textureName);
    writer.writeInt32(ddsBytes.length);
    writer.writeBytes(ddsBytes);
  }

  // 3. Materials (ksPerPixel)
  writer.writeInt32(MATERIAL_SPECS.length);
  for (const spec of MATERIAL_SPECS) {
    writer.writeKn5String(spec.key);
    writer.writeKn5String('ksPerPixel');
    writer.writeUint8(0); // blendMode (opaque)
    writer.writeUint8(0); // alphaTested
    writer.writeInt32(0); // depthMode

    // 6 standard ksPerPixel scalar/color properties
    writer.writeInt32(6);
    writeMaterialProperty(writer, 'ksAmbient', spec.ambient);
    writeMaterialProperty(writer, 'ksDiffuse', spec.diffuse);
    writeMaterialProperty(writer, 'ksSpecular', spec.specular);
    writeMaterialProperty(writer, 'ksSpecularEXP', spec.specularExp);
    writeMaterialProperty(writer, 'ksEmissive', 0);
    writeMaterialProperty(writer, 'ksAlphaRef', 0);

    // 1 texture slot mapping
    writer.writeInt32(1);
    writer.writeKn5String('txDiffuse');
    writer.writeInt32(0);
    writer.writeKn5String(spec.textureName);
  }

  // 4. Recursive Node Hierarchy
  const kn5Meshes = scene.meshes
    .filter((m) => m.positions.length > 0 && m.indices.length > 0)
    .flatMap(splitMeshForKn5);
  const rootName = sanitizeSlug(scene.config.trackSlug, 'track_root');
  const identityMatrix = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);

  const totalChildren = kn5Meshes.length + scene.dummies.length;
  writeDummyNode(writer, rootName, totalChildren, identityMatrix);

  for (const mesh of kn5Meshes) {
    writeMeshNode(writer, mesh);
  }

  for (const dummy of scene.dummies) {
    writeDummyNode(writer, dummy.name, 0, buildDummyMatrix(dummy));
  }

  return writer.toUint8Array();
}
