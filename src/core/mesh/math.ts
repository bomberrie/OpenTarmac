import type {
  ElevationGrid,
  GeoOrigin,
  MeshLayerKind,
  ProceduralMesh,
  Vec3,
} from '../../types/track';
import { unprojectXZ } from '../geo/projection';

export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalize3(v: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 {
  const len = length3(v);
  if (len < 1e-8) return fallback;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function distXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Shortest distance in the XZ plane from point `p` to line segment `[a, b]`.
 */
export function pointToSegmentDistXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-10) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  const projX = ax + t * dx;
  const projZ = az + t * dz;
  return Math.hypot(px - projX, pz - projZ);
}

/**
 * Sample terrain Y coordinate in local space (meters above `origin.baseElevation`).
 */
export function sampleLocalY(
  lat: number,
  lon: number,
  origin: GeoOrigin,
  elevation: ElevationGrid,
  elevationScale: number
): number {
  const meters = elevation.sample(lat, lon);
  return (meters - origin.baseElevation) * elevationScale;
}

/**
 * Sample terrain Y coordinate from local XZ coordinates.
 */
export function sampleLocalYAtXZ(
  x: number,
  z: number,
  origin: GeoOrigin,
  elevation: ElevationGrid,
  elevationScale: number
): number {
  const { lat, lon } = unprojectXZ(x, z, origin);
  return sampleLocalY(lat, lon, origin, elevation, elevationScale);
}

/**
 * Compute area-weighted smooth vertex normals from positions and triangle indices.
 */
export function computeSmoothNormals(
  positions: Float32Array,
  indices: Uint32Array
): Float32Array {
  const normals = new Float32Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const e1x = positions[i1] - positions[i0];
    const e1y = positions[i1 + 1] - positions[i0 + 1];
    const e1z = positions[i1 + 2] - positions[i0 + 2];

    const e2x = positions[i2] - positions[i0];
    const e2y = positions[i2 + 1] - positions[i0 + 1];
    const e2z = positions[i2 + 2] - positions[i0 + 2];

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    normals[i0] += nx;
    normals[i0 + 1] += ny;
    normals[i0 + 2] += nz;

    normals[i1] += nx;
    normals[i1 + 1] += ny;
    normals[i1 + 2] += nz;

    normals[i2] += nx;
    normals[i2 + 1] += ny;
    normals[i2 + 2] += nz;
  }

  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (len > 1e-8) {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    } else {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    }
  }

  return normals;
}

/**
 * Incremental buffer builder for `ProceduralMesh`.
 */
export class MeshAccumulator {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  addVertex(
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number
  ): number {
    const idx = this.vertexCount;
    this.positions.push(px, py, pz);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    return idx;
  }

  addTriangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /**
   * Add a flat-shaded quad `(a, b, c, d)` in CCW order when viewed from `normal`.
   */
  addQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, uScale = 1, vScale = 1): void {
    const edge1 = sub3(b, a);
    const edge2 = sub3(c, a);
    const n = normalize3(cross3(edge1, edge2));

    const ia = this.addVertex(a.x, a.y, a.z, n.x, n.y, n.z, 0, 0);
    const ib = this.addVertex(b.x, b.y, b.z, n.x, n.y, n.z, uScale, 0);
    const ic = this.addVertex(c.x, c.y, c.z, n.x, n.y, n.z, uScale, vScale);
    const id = this.addVertex(d.x, d.y, d.z, n.x, n.y, n.z, 0, vScale);

    this.addTriangle(ia, ib, ic);
    this.addTriangle(ia, ic, id);
  }

  build(
    name: string,
    layer: MeshLayerKind,
    materialKey: ProceduralMesh['materialKey'],
    recomputeNormals = false
  ): ProceduralMesh {
    const positions = new Float32Array(this.positions);
    const indices = new Uint32Array(this.indices);
    const normals = recomputeNormals
      ? computeSmoothNormals(positions, indices)
      : new Float32Array(this.normals);
    const uvs = new Float32Array(this.uvs);

    return {
      name,
      layer,
      materialKey,
      positions,
      normals,
      uvs,
      indices,
    };
  }
}
