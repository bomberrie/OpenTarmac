import type {
  CenterlinePoint,
  ElevationGrid,
  GeoOrigin,
  LatLon,
  OsmBarrier,
  OsmDataset,
  OsmRoadWay,
  ProceduralMesh,
  TrackGenerationConfig,
  Vec3,
} from '../../types/track';
import { projectLatLon } from '../geo/projection';
import {
  add3,
  distXZ,
  MeshAccumulator,
  normalize3,
  sampleLocalYAtXZ,
  scale3,
  sub3,
} from './math';

export interface RoadBuildResult {
  meshes: ProceduralMesh[];
  centerline: CenterlinePoint[];
  networkRoadsXZ: Array<Array<{ x: number; z: number }>>;
  roadCount: number;
}

interface XZPoint {
  x: number;
  z: number;
}

const HIGHWAY_PRIORITY: Record<string, number> = {
  raceway: 3.0,
  motorway: 2.2,
  trunk: 2.0,
  primary: 1.7,
  secondary: 1.4,
  tertiary: 1.2,
  unclassified: 1.0,
  residential: 0.9,
  living_street: 0.8,
  service: 0.6,
  track: 0.5,
};

function polylineLengthXZ(pts: XZPoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += distXZ(pts[i - 1], pts[i]);
  }
  return len;
}

function deduplicateXZ(pts: XZPoint[], minDist = 0.25): XZPoint[] {
  if (pts.length === 0) return [];
  const out: XZPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (distXZ(out[out.length - 1], pts[i]) >= minDist) {
      out.push(pts[i]);
    }
  }
  return out;
}

/**
 * Evaluate a 2D centripetal Catmull-Rom point between p1 and p2 given neighbors p0, p3.
 */
function centripetalCatmullRom2D(
  p0: XZPoint,
  p1: XZPoint,
  p2: XZPoint,
  p3: XZPoint,
  tNormalized: number
): XZPoint {
  const alpha = 0.5;
  const distPow = (a: XZPoint, b: XZPoint) =>
    Math.max(1e-4, Math.pow(distXZ(a, b), alpha));

  const t0 = 0;
  const t1 = t0 + distPow(p0, p1);
  const t2 = t1 + distPow(p1, p2);
  const t3 = t2 + distPow(p2, p3);

  const t = t1 + (t2 - t1) * tNormalized;

  const lerpPt = (a: XZPoint, b: XZPoint, ta: number, tb: number): XZPoint => {
    const denom = Math.max(1e-6, tb - ta);
    const w = (t - ta) / denom;
    return {
      x: a.x + (b.x - a.x) * w,
      z: a.z + (b.z - a.z) * w,
    };
  };

  const a1 = lerpPt(p0, p1, t0, t1);
  const a2 = lerpPt(p1, p2, t1, t2);
  const a3 = lerpPt(p2, p3, t2, t3);

  const b1 = lerpPt(a1, a2, t0, t2);
  const b2 = lerpPt(a2, a3, t1, t3);

  return lerpPt(b1, b2, t1, t2);
}

/**
 * Resample a polyline with Catmull-Rom interpolation at approximately `stepMeters`.
 */
function resampleSplineXZ(
  rawPts: XZPoint[],
  closed: boolean,
  stepMeters: number,
  maxPoints = 1200
): XZPoint[] {
  let pts = deduplicateXZ(rawPts, 0.25);
  if (closed && pts.length > 2 && distXZ(pts[0], pts[pts.length - 1]) < 12) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 2) return pts;

  const totalLen = polylineLengthXZ(pts);
  const effectiveStep = Math.max(stepMeters, totalLen / maxPoints);
  const segCount = closed ? pts.length : pts.length - 1;

  const sampled: XZPoint[] = [];

  for (let i = 0; i < segCount; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const p0 = closed
      ? pts[(i - 1 + pts.length) % pts.length]
      : i === 0
      ? { x: 2 * p1.x - p2.x, z: 2 * p1.z - p2.z }
      : pts[i - 1];
    const p3 = closed
      ? pts[(i + 2) % pts.length]
      : i + 2 >= pts.length
      ? { x: 2 * p2.x - p1.x, z: 2 * p2.z - p1.z }
      : pts[i + 2];

    const segLen = distXZ(p1, p2);
    const steps = Math.max(1, Math.min(80, Math.ceil(segLen / effectiveStep)));

    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      sampled.push(centripetalCatmullRom2D(p0, p1, p2, p3, t));
    }
  }

  if (!closed) {
    sampled.push(pts[pts.length - 1]);
  }

  return sampled;
}

/**
 * Smooth Y elevations along a path to eliminate DEM staircase noise.
 */
function smoothElevations(
  rawY: number[],
  closed: boolean,
  smoothingFactor: number
): number[] {
  const n = rawY.length;
  if (n < 3 || smoothingFactor <= 0.01) return rawY.slice();

  const clamped = Math.max(0, Math.min(1, smoothingFactor));
  const passes = Math.max(1, Math.round(1 + clamped * 5));
  const radius = Math.max(1, Math.round(2 + clamped * 12));

  let curr = rawY.slice();
  let next = new Array<number>(n);

  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let weightSum = 0;
      for (let k = -radius; k <= radius; k++) {
        const idx = closed
          ? (i + k + n) % n
          : Math.max(0, Math.min(n - 1, i + k));
        const w = radius + 1 - Math.abs(k);
        sum += curr[idx] * w;
        weightSum += w;
      }
      next[i] = sum / weightSum;
    }
    const tmp = curr;
    curr = next;
    next = tmp;
  }

  return curr;
}

/**
 * Build `CenterlinePoint[]` from smoothed 3D points.
 */
function buildCenterlinePoints(
  ptsXZ: XZPoint[],
  ys: number[],
  halfWidth: number,
  closed: boolean
): CenterlinePoint[] {
  const n = ptsXZ.length;
  const result: CenterlinePoint[] = [];
  let distanceFromStart = 0;

  for (let i = 0; i < n; i++) {
    const pos: Vec3 = { x: ptsXZ[i].x, y: ys[i], z: ptsXZ[i].z };
    if (i > 0) {
      const prev = ptsXZ[i - 1];
      const prevY = ys[i - 1];
      distanceFromStart += Math.hypot(
        pos.x - prev.x,
        pos.y - prevY,
        pos.z - prev.z
      );
    }

    const iPrev = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const iNext = closed ? (i + 1) % n : Math.min(n - 1, i + 1);

    const tangent = normalize3(
      {
        x: ptsXZ[iNext].x - ptsXZ[iPrev].x,
        y: ys[iNext] - ys[iPrev],
        z: ptsXZ[iNext].z - ptsXZ[iPrev].z,
      },
      { x: 0, y: 0, z: -1 }
    );

    // Right vector in horizontal XZ plane: forward x +Y = (-forward.z, 0, forward.x)
    const right = normalize3(
      { x: -tangent.z, y: 0, z: tangent.x },
      { x: 1, y: 0, z: 0 }
    );

    result.push({
      position: pos,
      forward: tangent,
      right,
      leftWidth: halfWidth,
      rightWidth: halfWidth,
      distanceFromStart,
    });
  }

  return result;
}

/**
 * Build a ribbon mesh along `centerline` with lateral offsets `[leftOffset, rightOffset]` and Y offsets.
 */
function appendRibbonStrip(
  acc: MeshAccumulator,
  centerline: CenterlinePoint[],
  closed: boolean,
  leftOffset: number,
  rightOffset: number,
  leftYOffset: number,
  rightYOffset: number,
  uvWidthScale: number
): void {
  const n = centerline.length;
  if (n < 2) return;

  const baseVertex = acc.vertexCount;
  const totalCount = closed ? n + 1 : n;

  let closingDist = centerline[n - 1].distanceFromStart;
  if (closed) {
    const a = centerline[n - 1].position;
    const b = centerline[0].position;
    closingDist += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }

  for (let i = 0; i < totalCount; i++) {
    const pt = centerline[i % n];
    const dist = i === n ? closingDist : pt.distanceFromStart;
    const vCoord = dist / Math.max(1, uvWidthScale);

    const lx = pt.position.x + pt.right.x * leftOffset;
    const ly = pt.position.y + leftYOffset;
    const lz = pt.position.z + pt.right.z * leftOffset;

    const rx = pt.position.x + pt.right.x * rightOffset;
    const ry = pt.position.y + rightYOffset;
    const rz = pt.position.z + pt.right.z * rightOffset;

    acc.addVertex(lx, ly, lz, 0, 1, 0, 0, vCoord);
    acc.addVertex(rx, ry, rz, 0, 1, 0, 1, vCoord);
  }

  for (let i = 0; i < totalCount - 1; i++) {
    const l0 = baseVertex + i * 2;
    const r0 = l0 + 1;
    const l1 = l0 + 2;
    const r1 = l0 + 3;

    // CCW winding viewed from +Y
    acc.addTriangle(l0, r0, r1);
    acc.addTriangle(l0, r1, l1);
  }
}

/**
 * Extrude a 3D rectangular guardrail/wall beam along a sequence of 3D points.
 */
function appendBarrierBeam(
  acc: MeshAccumulator,
  points: Vec3[],
  closed: boolean,
  width = 0.22,
  height = 0.85
): void {
  const n = points.length;
  if (n < 2) return;

  const halfW = width * 0.5;
  const segCount = closed ? n : n - 1;

  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const seg = sub3(b, a);
    const len = Math.hypot(seg.x, seg.z);
    if (len < 0.05) continue;

    const right = normalize3({ x: -seg.z, y: 0, z: seg.x }, { x: 1, y: 0, z: 0 });
    const offset = scale3(right, halfW);
    const upOffset: Vec3 = { x: 0, y: height, z: 0 };

    const aL = sub3(a, offset);
    const aR = add3(a, offset);
    const bL = sub3(b, offset);
    const bR = add3(b, offset);

    const aLT = add3(aL, upOffset);
    const aRT = add3(aR, upOffset);
    const bLT = add3(bL, upOffset);
    const bRT = add3(bR, upOffset);

    const uSeg = len * 0.5;
    // Left wall (facing -right)
    acc.addQuad(bL, aL, aLT, bLT, uSeg, 1);
    // Right wall (facing +right)
    acc.addQuad(aR, bR, bRT, aRT, uSeg, 1);
    // Top cap (facing +Y)
    acc.addQuad(aLT, aRT, bRT, bLT, uSeg, 1);
  }
}

/**
 * Pick primary road(s) and secondary roads based on `config.selectedRoadIds` or automatic scoring.
 */
function selectRoads(
  roads: OsmRoadWay[],
  origin: GeoOrigin,
  config: TrackGenerationConfig
): { primaryCoords: LatLon[]; primaryRoad: OsmRoadWay; secondaryRoads: OsmRoadWay[] } {
  if (roads.length === 0) {
    throw new Error('Cannot build track meshes: OsmDataset contains zero roads.');
  }

  if (config.selectedRoadIds.length > 0) {
    const selectedSet = new Set(config.selectedRoadIds);
    const selected = roads.filter((r) => selectedSet.has(r.id));
    if (selected.length > 0) {
      // Stitch selected roads if multiple connect end-to-end; otherwise pick longest selected
      const primaryRoad = selected[0];
      const mergedCoords = [...primaryRoad.coords];

      if (selected.length > 1) {
        const used = new Set<number>([primaryRoad.id]);
        let added = true;
        while (added) {
          added = false;
          const tail = projectLatLon(
            mergedCoords[mergedCoords.length - 1].lat,
            mergedCoords[mergedCoords.length - 1].lon,
            origin
          );

          for (const candidate of selected) {
            if (used.has(candidate.id) || candidate.coords.length < 2) continue;
            const startXZ = projectLatLon(
              candidate.coords[0].lat,
              candidate.coords[0].lon,
              origin
            );
            const endXZ = projectLatLon(
              candidate.coords[candidate.coords.length - 1].lat,
              candidate.coords[candidate.coords.length - 1].lon,
              origin
            );

            if (distXZ(tail, startXZ) < 25) {
              mergedCoords.push(...candidate.coords.slice(1));
              used.add(candidate.id);
              added = true;
              break;
            }
            if (distXZ(tail, endXZ) < 25) {
              mergedCoords.push(...[...candidate.coords].reverse().slice(1));
              used.add(candidate.id);
              added = true;
              break;
            }
          }
        }
      }

      const secondaryRoads = roads.filter((r) => !selectedSet.has(r.id));
      return { primaryCoords: mergedCoords, primaryRoad, secondaryRoads };
    }
  }

  // Auto-select highest-scoring road
  let bestRoad = roads[0];
  let bestScore = -1;

  for (const road of roads) {
    const xz = road.coords.map((c) => projectLatLon(c.lat, c.lon, origin));
    const len = polylineLengthXZ(xz);
    const priority = HIGHWAY_PRIORITY[road.highway] ?? 0.75;
    const score = len * priority;
    if (score > bestScore) {
      bestScore = score;
      bestRoad = road;
    }
  }

  return {
    primaryCoords: bestRoad.coords,
    primaryRoad: bestRoad,
    secondaryRoads: roads.filter((r) => r.id !== bestRoad.id),
  };
}

function buildSingleRoadGeometry(
  coords: LatLon[],
  road: OsmRoadWay,
  isPrimary: boolean,
  origin: GeoOrigin,
  elevation: ElevationGrid,
  config: TrackGenerationConfig,
  secondaryStepMeters = 6.0,
  targetAcc?: MeshAccumulator
): { mesh: ProceduralMesh | null; centerline: CenterlinePoint[]; closed: boolean } {
  const rawXZ = coords.map((c) => projectLatLon(c.lat, c.lon, origin));
  const startEndDist =
    rawXZ.length >= 2 ? distXZ(rawXZ[0], rawXZ[rawXZ.length - 1]) : Infinity;

  const closed =
    rawXZ.length >= 3 &&
    (isPrimary
      ? config.runMode === 'circuit' && startEndDist < 120
      : startEndDist < 12);

  const stepMeters = isPrimary ? 3.0 : secondaryStepMeters;
  const maxPts = isPrimary ? 2400 : 120;
  const resampledXZ = resampleSplineXZ(rawXZ, closed, stepMeters, maxPts);
  const rawY = resampledXZ.map((pt) =>
    sampleLocalYAtXZ(pt.x, pt.z, origin, elevation, config.elevationScale)
  );
  const smoothedY = smoothElevations(rawY, closed, config.roadSmoothing);

  const widthMeters =
    (road.widthMeters ?? config.defaultRoadWidth) * config.roadWidthMultiplier;
  const halfWidth = Math.max(1.5, widthMeters * 0.5);

  const centerline = buildCenterlinePoints(
    resampledXZ,
    smoothedY,
    halfWidth,
    closed
  );

  const yOffset = road.bridge ? 0.55 : 0.28;
  const acc = targetAcc ?? new MeshAccumulator();
  appendRibbonStrip(
    acc,
    centerline,
    closed,
    -halfWidth,
    halfWidth,
    yOffset,
    yOffset,
    widthMeters
  );

  if (targetAcc) {
    return { mesh: null, centerline, closed };
  }

  const built = acc.build(
    isPrimary ? '1ROAD_main' : `1ROAD_${road.id}`,
    'road',
    'ROAD',
    true
  );

  return { mesh: built, centerline, closed };
}

function buildBarrierMesh(
  centerline: CenterlinePoint[],
  primaryClosed: boolean,
  halfWidth: number,
  kerbOffset: number,
  barriers: OsmBarrier[],
  origin: GeoOrigin,
  elevation: ElevationGrid,
  config: TrackGenerationConfig
): ProceduralMesh | null {
  const acc = new MeshAccumulator();
  const barrierOffset = halfWidth + kerbOffset + 0.4;

  // Guardrails flanking the primary track
  const leftLine: Vec3[] = [];
  const rightLine: Vec3[] = [];
  for (let i = 0; i < centerline.length; i += 2) {
    const pt = centerline[i];
    leftLine.push({
      x: pt.position.x - pt.right.x * barrierOffset,
      y: pt.position.y + 0.04,
      z: pt.position.z - pt.right.z * barrierOffset,
    });
    rightLine.push({
      x: pt.position.x + pt.right.x * barrierOffset,
      y: pt.position.y + 0.04,
      z: pt.position.z + pt.right.z * barrierOffset,
    });
  }

  appendBarrierBeam(acc, leftLine, primaryClosed, 0.22, 0.85);
  appendBarrierBeam(acc, rightLine, primaryClosed, 0.22, 0.85);

  // Explicit OSM barriers
  for (const barrier of barriers) {
    if (barrier.coords.length < 2) continue;
    const pts: Vec3[] = barrier.coords.map((c) => {
      const xz = projectLatLon(c.lat, c.lon, origin);
      const y = sampleLocalYAtXZ(
        xz.x,
        xz.z,
        origin,
        elevation,
        config.elevationScale
      );
      return { x: xz.x, y, z: xz.z };
    });
    const height = barrier.kind === 'wall' ? 1.1 : 0.85;
    appendBarrierBeam(acc, pts, false, 0.24, height);
  }

  if (acc.triangleCount === 0) return null;
  return acc.build('1WALL_guardrail', 'wall', 'WALL', false);
}

/**
 * Build all road (`1ROAD_*`), kerb (`1KERB_*`), and guardrail (`1WALL_*`) meshes
 * and compute the primary drivable `CenterlinePoint[]`.
 */
export function buildRoadMeshes(
  dataset: OsmDataset,
  origin: GeoOrigin,
  elevation: ElevationGrid,
  config: TrackGenerationConfig
): RoadBuildResult {
  const { primaryCoords, primaryRoad, secondaryRoads } = selectRoads(
    dataset.roads,
    origin,
    config
  );

  const meshes: ProceduralMesh[] = [];
  const networkRoadsXZ: Array<Array<{ x: number; z: number }>> = [];
  const primary = buildSingleRoadGeometry(
    primaryCoords,
    primaryRoad,
    true,
    origin,
    elevation,
    config
  );
  if (primary.mesh) meshes.push(primary.mesh);
  if (primary.centerline.length >= 2) {
    networkRoadsXZ.push(
      primary.centerline.map((pt) => ({ x: pt.position.x, z: pt.position.z }))
    );
  }

  // Batch all secondary roads into chunked meshes (<= 55,000 verts each) so
  // massive 1000+ road networks render in 1-3 WebGL draw calls without stalling.
  const secondaryCount = secondaryRoads.length;
  const secondaryStep =
    secondaryCount > 400 ? 14.0 : secondaryCount > 150 ? 9.0 : 5.5;
  let networkAcc = new MeshAccumulator();
  let chunkIndex = 0;
  const MAX_BATCH_VERTS = 55000;

  for (const secRoad of secondaryRoads) {
    if (secRoad.coords.length < 2) continue;
    const secResult = buildSingleRoadGeometry(
      secRoad.coords,
      secRoad,
      false,
      origin,
      elevation,
      config,
      secondaryStep,
      networkAcc
    );
    if (secResult.centerline.length >= 2) {
      networkRoadsXZ.push(
        secResult.centerline.map((pt) => ({ x: pt.position.x, z: pt.position.z }))
      );
    }
    if (networkAcc.vertexCount >= MAX_BATCH_VERTS) {
      const name = chunkIndex === 0 ? '1ROAD_network' : `1ROAD_network_${chunkIndex}`;
      meshes.push(networkAcc.build(name, 'road', 'ROAD', true));
      networkAcc = new MeshAccumulator();
      chunkIndex++;
    }
  }
  if (networkAcc.triangleCount > 0) {
    const name = chunkIndex === 0 ? '1ROAD_network' : `1ROAD_network_${chunkIndex}`;
    meshes.push(networkAcc.build(name, 'road', 'ROAD', true));
  }

  const isFreeRoam = Boolean(config.freeRoam);
  const primaryHalfWidth =
    primary.centerline.length > 0 ? primary.centerline[0].leftWidth : 4.5;
  const kerbWidth = !isFreeRoam && config.generateKerbs ? 0.65 : 0;

  if (!isFreeRoam && config.generateKerbs && primary.centerline.length >= 2) {
    const kerbAcc = new MeshAccumulator();
    // Left kerb shoulder (outer lip slightly raised)
    appendRibbonStrip(
      kerbAcc,
      primary.centerline,
      primary.closed,
      -(primaryHalfWidth + kerbWidth),
      -primaryHalfWidth,
      0.095,
      0.062,
      1.5
    );
    // Right kerb shoulder
    appendRibbonStrip(
      kerbAcc,
      primary.centerline,
      primary.closed,
      primaryHalfWidth,
      primaryHalfWidth + kerbWidth,
      0.062,
      0.095,
      1.5
    );
    meshes.push(kerbAcc.build('1KERB_main', 'kerb', 'KERB', true));
  }

  if (!isFreeRoam && config.generateGuardrails && primary.centerline.length >= 2) {
    const wallMesh = buildBarrierMesh(
      primary.centerline,
      primary.closed,
      primaryHalfWidth,
      kerbWidth,
      dataset.barriers,
      origin,
      elevation,
      config
    );
    if (wallMesh) meshes.push(wallMesh);
  }

  return {
    meshes,
    centerline: primary.centerline,
    networkRoadsXZ,
    roadCount: dataset.roads.length,
  };
}
