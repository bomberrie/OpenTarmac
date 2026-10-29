import type {
  BoundingBox,
  ElevationGrid,
  GeoOrigin,
  ProceduralMesh,
  SatelliteImagery,
  TrackGenerationConfig,
} from '../../types/track';
import { projectLatLon } from '../geo/projection';
import { computeSmoothNormals, sampleLocalYAtXZ } from './math';

export interface TerrainBuildOptions {
  paddingMeters?: number;
  segmentsX?: number;
  segmentsZ?: number;
  uvTileMeters?: number;
  satellite?: SatelliteImagery | null;
}

function clamp01(v: number, pad = 0.002): number {
  return Math.max(pad, Math.min(1 - pad, v));
}

/**
 * Build a subdivided `1GRASS_terrain` mesh covering `bbox` plus padding margin.
 * When `options.satellite` is provided and enabled, UVs map 1:1 to the orthophoto bbox.
 */
export function buildTerrainMesh(
  bbox: BoundingBox,
  origin: GeoOrigin,
  elevation: ElevationGrid,
  config: TrackGenerationConfig,
  options: TerrainBuildOptions = {}
): ProceduralMesh {
  const sw = projectLatLon(bbox.south, bbox.west, origin);
  const ne = projectLatLon(bbox.north, bbox.east, origin);

  const spanX = Math.abs(ne.x - sw.x);
  const spanZ = Math.abs(ne.z - sw.z);
  const autoSegX = Math.min(200, Math.max(96, Math.round(spanX / 14)));
  const autoSegZ = Math.min(200, Math.max(96, Math.round(spanZ / 14)));

  const padding = options.paddingMeters ?? 120;
  const segX = Math.max(8, options.segmentsX ?? autoSegX);
  const segZ = Math.max(8, options.segmentsZ ?? autoSegZ);
  const uvTileMeters = options.uvTileMeters ?? 25;

  const minX = Math.min(sw.x, ne.x) - padding;
  const maxX = Math.max(sw.x, ne.x) + padding;
  const minZ = Math.min(sw.z, ne.z) - padding;
  const maxZ = Math.max(sw.z, ne.z) + padding;

  const sat =
    config.satelliteImagery !== false && options.satellite
      ? options.satellite
      : null;
  let satMinX = 0;
  let satSpanX = 1;
  let satMinZ = 0;
  let satSpanZ = 1;
  if (sat) {
    const sSw = projectLatLon(sat.bbox.south, sat.bbox.west, origin);
    const sNe = projectLatLon(sat.bbox.north, sat.bbox.east, origin);
    satMinX = Math.min(sSw.x, sNe.x);
    satSpanX = Math.max(1, Math.abs(sNe.x - sSw.x));
    // North is -Z (top row 0 -> v = 0), South is +Z (bottom row -> v = 1)
    satMinZ = Math.min(sSw.z, sNe.z);
    satSpanZ = Math.max(1, Math.abs(sSw.z - sNe.z));
  }

  const cols = segX + 1;
  const rows = segZ + 1;
  const vertexCount = cols * rows;

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let r = 0; r < rows; r++) {
    const vz = r / segZ;
    const z = minZ + vz * (maxZ - minZ);

    for (let c = 0; c < cols; c++) {
      const ux = c / segX;
      const x = minX + ux * (maxX - minX);
      const y = sampleLocalYAtXZ(x, z, origin, elevation, config.elevationScale);

      const vIdx = r * cols + c;
      positions[vIdx * 3] = x;
      positions[vIdx * 3 + 1] = y;
      positions[vIdx * 3 + 2] = z;

      if (sat) {
        uvs[vIdx * 2] = clamp01((x - satMinX) / satSpanX);
        uvs[vIdx * 2 + 1] = clamp01((z - satMinZ) / satSpanZ);
      } else {
        uvs[vIdx * 2] = (x - minX) / uvTileMeters;
        uvs[vIdx * 2 + 1] = (z - minZ) / uvTileMeters;
      }
    }
  }

  const indices = new Uint32Array(segX * segZ * 6);
  let ptr = 0;
  for (let r = 0; r < segZ; r++) {
    for (let c = 0; c < segX; c++) {
      const tl = r * cols + c;
      const tr = tl + 1;
      const bl = tl + cols;
      const br = bl + 1;

      // CCW winding viewed from +Y
      indices[ptr++] = tl;
      indices[ptr++] = bl;
      indices[ptr++] = br;

      indices[ptr++] = tl;
      indices[ptr++] = br;
      indices[ptr++] = tr;
    }
  }

  const normals = computeSmoothNormals(positions, indices);

  return {
    name: '1GRASS_terrain',
    layer: 'terrain',
    materialKey: 'GRASS',
    positions,
    normals,
    uvs,
    indices,
  };
}
