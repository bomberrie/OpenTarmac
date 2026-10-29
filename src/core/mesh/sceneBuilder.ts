import type {
  CenterlinePoint,
  ElevationGrid,
  GeneratedTrackScene,
  GeoOrigin,
  OsmDataset,
  ProceduralMesh,
  SatelliteImagery,
  TrackGenerationConfig,
} from '../../types/track';
import { unprojectXZ } from '../geo/projection';
import { sampleRoadSurfaceTint } from '../geo/satellite';
import { buildAcDummies } from './acDummies';
import { buildRoadMeshes } from './roadBuilder';
import { buildSceneryMeshes } from './sceneryBuilder';
import { buildTerrainMesh } from './terrainBuilder';

function resolveLocalOrigin(
  dataset: OsmDataset,
  elevation: ElevationGrid
): GeoOrigin {
  if (dataset.origin.baseElevation !== 0) {
    return dataset.origin;
  }
  const midElevation = (elevation.minElevation + elevation.maxElevation) * 0.5;
  return {
    lat: dataset.origin.lat,
    lon: dataset.origin.lon,
    baseElevation: Math.abs(midElevation) > 1e-3 ? midElevation : 0,
  };
}

function computeCenterlineStats(
  centerline: CenterlinePoint[],
  origin: GeoOrigin,
  isCircuit: boolean
): {
  lengthMeters: number;
  elevationGainMeters: number;
  minElevationMeters: number;
  maxElevationMeters: number;
} {
  if (centerline.length === 0) {
    return {
      lengthMeters: 0,
      elevationGainMeters: 0,
      minElevationMeters: origin.baseElevation,
      maxElevationMeters: origin.baseElevation,
    };
  }

  let lengthMeters = centerline[centerline.length - 1].distanceFromStart;
  if (isCircuit && centerline.length >= 2) {
    const first = centerline[0].position;
    const last = centerline[centerline.length - 1].position;
    lengthMeters += Math.hypot(
      first.x - last.x,
      first.y - last.y,
      first.z - last.z
    );
  }

  let elevationGainMeters = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < centerline.length; i++) {
    const y = centerline[i].position.y;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (i > 0) {
      const dy = y - centerline[i - 1].position.y;
      if (dy > 0) elevationGainMeters += dy;
    }
  }

  return {
    lengthMeters,
    elevationGainMeters,
    minElevationMeters: origin.baseElevation + minY,
    maxElevationMeters: origin.baseElevation + maxY,
  };
}

/**
 * Assemble the complete Assetto Corsa 3D track scene (terrain, roads, kerbs, barriers,
 * buildings, trees, AC dummies, and centerline) from OSM & DEM data.
 */
export function buildTrackScene(
  dataset: OsmDataset,
  elevation: ElevationGrid,
  config: TrackGenerationConfig,
  satellite?: SatelliteImagery | null
): GeneratedTrackScene {
  const origin = resolveLocalOrigin(dataset, elevation);
  const activeSatellite =
    config.satelliteImagery !== false && satellite ? satellite : null;

  const terrainMesh = buildTerrainMesh(
    dataset.bbox,
    origin,
    elevation,
    config,
    { satellite: activeSatellite }
  );
  const roadResult = buildRoadMeshes(dataset, origin, elevation, config);
  const sceneryResult = buildSceneryMeshes(
    dataset,
    origin,
    elevation,
    config,
    activeSatellite
  );
  const dummies = buildAcDummies(roadResult.centerline, config);

  let sampledRoadTintRgb: { r: number; g: number; b: number } | undefined;
  if (activeSatellite && roadResult.centerline.length >= 2) {
    const sampleCoords = roadResult.centerline.map((pt) =>
      unprojectXZ(pt.position.x, pt.position.z, origin)
    );
    sampledRoadTintRgb = sampleRoadSurfaceTint(sampleCoords, activeSatellite);
  }

  const meshes: ProceduralMesh[] = [
    terrainMesh,
    ...roadResult.meshes,
    ...sceneryResult.meshes,
  ];

  let triangleCount = 0;
  for (const mesh of meshes) {
    triangleCount += mesh.indices.length / 3;
  }

  const elevStats = computeCenterlineStats(
    roadResult.centerline,
    origin,
    config.runMode === 'circuit'
  );

  return {
    config,
    origin,
    bbox: dataset.bbox,
    meshes,
    dummies,
    centerline: roadResult.centerline,
    networkRoadsXZ: roadResult.networkRoadsXZ,
    satellite: activeSatellite,
    sampledRoadTintRgb,
    stats: {
      lengthMeters: elevStats.lengthMeters,
      elevationGainMeters: elevStats.elevationGainMeters,
      minElevationMeters: elevStats.minElevationMeters,
      maxElevationMeters: elevStats.maxElevationMeters,
      roadCount: roadResult.roadCount,
      buildingCount: sceneryResult.buildingCount,
      treeCount: sceneryResult.treeCount,
      triangleCount,
    },
  };
}
