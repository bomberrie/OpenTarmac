export interface LatLon {
  lat: number;
  lon: number;
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface GeoOrigin {
  lat: number;
  lon: number;
  baseElevation: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface OsmRoadWay {
  id: number;
  name: string;
  highway: string;
  lanes?: number;
  widthMeters?: number;
  surface?: string;
  oneway?: boolean;
  bridge?: boolean;
  coords: LatLon[];
}

export interface OsmBuilding {
  id: number;
  name?: string;
  heightMeters: number;
  polygon: LatLon[];
}

export interface OsmForestArea {
  id: number;
  polygon: LatLon[];
}

export interface OsmBarrier {
  id: number;
  kind: 'guard_rail' | 'wall' | 'fence';
  coords: LatLon[];
}

export interface OsmDataset {
  bbox: BoundingBox;
  origin: GeoOrigin;
  roads: OsmRoadWay[];
  buildings: OsmBuilding[];
  forests: OsmForestArea[];
  barriers: OsmBarrier[];
  source: 'overpass' | 'preset';
}

export interface ElevationGrid {
  bbox: BoundingBox;
  cols: number;
  rows: number;
  minElevation: number;
  maxElevation: number;
  /** Row-major elevations in meters, north-to-south or south-to-north documented by sample() */
  heights: Float32Array;
  sample: (lat: number, lon: number) => number;
}

export type TrackRunMode = 'circuit' | 'point-to-point';

export type SelectionMode = 'route' | 'area' | 'draw';

export interface TrackGenerationConfig {
  trackName: string;
  trackSlug: string;
  country: string;
  city: string;
  runMode: TrackRunMode;
  roadWidthMultiplier: number;
  defaultRoadWidth: number;
  roadSmoothing: number; // 0 to 1
  elevationScale: number; // 0 to 2
  generateKerbs: boolean;
  generateGuardrails: boolean;
  generateBuildings: boolean;
  generateTrees: boolean;
  pitBoxCount: number;
  gridSlotCount: number;
  selectedRoadIds: number[]; // empty = auto-pick longest/main road for AI & spawns
  /** When true (default in Area selection), omit per-road kerbs/guardrails so all intersections stay open */
  freeRoam?: boolean;
  /** When true (default), use Esri satellite imagery for terrain texture, foliage detection, and road tone */
  satelliteImagery?: boolean;
}

export interface SatelliteImagery {
  bbox: BoundingBox;
  width: number;
  height: number;
  rgba: Uint8Array;
}

export type MeshLayerKind =
  | 'road'
  | 'kerb'
  | 'terrain'
  | 'wall'
  | 'building'
  | 'tree';

export interface ProceduralMesh {
  /** AC naming convention: e.g. 1ROAD_main, 1GRASS_terrain, 1WALL_guardrail, building_01 */
  name: string;
  layer: MeshLayerKind;
  materialKey: 'ROAD' | 'KERB' | 'GRASS' | 'WALL' | 'BUILDING' | 'TREE';
  /** Flat XYZ float array (length = vertexCount * 3) */
  positions: Float32Array;
  /** Flat XYZ float array (length = vertexCount * 3) */
  normals: Float32Array;
  /** Flat UV float array (length = vertexCount * 2) */
  uvs: Float32Array;
  /** Triangle indices (length = triangleCount * 3) */
  indices: Uint32Array;
}

export interface AcDummyNode {
  /** e.g. AC_START_0, AC_PIT_0, AC_HOTLAP_START_0, AC_TIME_0_L/_R, AC_AB_START_L/_R */
  name: string;
  kind:
    | 'start'
    | 'pit'
    | 'hotlap_start'
    | 'time_l'
    | 'time_r'
    | 'ab_start_l'
    | 'ab_start_r'
    | 'ab_finish_l'
    | 'ab_finish_r';
  position: Vec3;
  /** Unit forward vector (+Z local axis in AC) */
  forward: Vec3;
  /** Unit up vector (+Y local axis in AC) */
  up: Vec3;
}

export interface CenterlinePoint {
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  leftWidth: number;
  rightWidth: number;
  distanceFromStart: number;
}

export interface GeneratedTrackScene {
  config: TrackGenerationConfig;
  origin: GeoOrigin;
  bbox: BoundingBox;
  meshes: ProceduralMesh[];
  dummies: AcDummyNode[];
  centerline: CenterlinePoint[];
  /** Local XZ polylines of every generated road (primary + network) for maps & outlines */
  networkRoadsXZ?: Array<Array<{ x: number; z: number }>>;
  /** Optional orthorectified satellite ground texture covering the terrain bbox */
  satellite?: SatelliteImagery | null;
  /** Real road surface tint estimated from satellite pixels along the road centerline */
  sampledRoadTintRgb?: { r: number; g: number; b: number };
  stats: {
    lengthMeters: number;
    elevationGainMeters: number;
    minElevationMeters: number;
    maxElevationMeters: number;
    roadCount: number;
    buildingCount: number;
    treeCount: number;
    triangleCount: number;
  };
}

export interface JunctionOption {
  optionKey: string;
  roadId: number;
  roadName: string;
  highway: string;
  direction: 'forward' | 'backward';
  turnAngleDeg: number;
  previewCoords: LatLon[];
}

export interface TracedJunction {
  junctionKey: string;
  fromRoadId: number;
  fromRoadName: string;
  atCoord: LatLon;
  distanceAtJunction: number;
  selectedOptionKey: string;
  options: JunctionOption[];
}

export interface TracedRoute {
  coords: LatLon[];
  roadIds: number[];
  totalDistanceMeters: number;
  reachedTargetDistance: boolean;
  startCoord: LatLon;
  endCoord: LatLon;
  junctions: TracedJunction[];
  averageWidthMeters?: number;
}

export interface TrackPreset {
  id: string;
  name: string;
  subtitle: string;
  country: string;
  city: string;
  runMode: TrackRunMode;
  bbox: BoundingBox;
  center: LatLon;
  zoom: number;
}

export interface ExportArtifacts {
  zipBlob: Blob;
  kn5Bytes: Uint8Array;
  glbBytes: Uint8Array;
  objText: string;
  aiBytes: Uint8Array;
  fileList: string[];
}
