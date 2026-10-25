import type {
  GeoOrigin,
  JunctionOption,
  LatLon,
  OsmRoadWay,
  TracedJunction,
  TracedRoute,
} from '../../types/track';
import { projectLatLon, unprojectXZ } from './projection';

interface XZPoint {
  x: number;
  z: number;
}

export interface TraceRouteParams {
  startRoadId: number;
  startCoord?: LatLon;
  reverseDirection?: boolean;
  maxDistanceMeters: number;
  junctionChoices?: Record<string, string>;
}

const JUNCTION_ENDPOINT_SNAP_M = 24;
const JUNCTION_INTERIOR_SNAP_M = 18;
const MIN_BRANCH_LENGTH_M = 12;

function dist2D(a: XZPoint, b: XZPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function polylineLenXZ(pts: XZPoint[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += dist2D(pts[i - 1], pts[i]);
  }
  return total;
}

function closestPointOnPolyline(
  target: XZPoint,
  pts: XZPoint[],
): { segIndex: number; t: number; point: XZPoint; dist: number } {
  let bestDist = Infinity;
  let bestSeg = 0;
  let bestT = 0;
  let bestPt = pts[0];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    let t = 0;
    if (lenSq > 1e-8) {
      t = Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.z - a.z) * dz) / lenSq));
    }
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(target.x - px, target.z - pz);
    if (d < bestDist) {
      bestDist = d;
      bestSeg = i;
      bestT = t;
      bestPt = { x: px, z: pz };
    }
  }

  return { segIndex: bestSeg, t: bestT, point: bestPt, dist: bestDist };
}

function sliceRoadFromPoint(
  coords: LatLon[],
  xzPts: XZPoint[],
  origin: GeoOrigin,
  targetXZ: XZPoint,
  reverse: boolean,
): { coords: LatLon[]; xz: XZPoint[] } {
  const { segIndex, t, point } = closestPointOnPolyline(targetXZ, xzPts);
  const hitLatLon = unprojectXZ(point.x, point.z, origin);

  if (!reverse) {
    const outCoords: LatLon[] = [hitLatLon];
    const outXZ: XZPoint[] = [point];
    const startIdx = t >= 0.999 ? segIndex + 2 : segIndex + 1;
    for (let i = startIdx; i < coords.length; i++) {
      outCoords.push(coords[i]);
      outXZ.push(xzPts[i]);
    }
    if (outCoords.length < 2 && coords.length >= 2) {
      return { coords: [coords[0], coords[coords.length - 1]], xz: [xzPts[0], xzPts[xzPts.length - 1]] };
    }
    return { coords: outCoords, xz: outXZ };
  }

  const outCoords: LatLon[] = [hitLatLon];
  const outXZ: XZPoint[] = [point];
  const endIdx = t <= 0.001 ? segIndex - 1 : segIndex;
  for (let i = endIdx; i >= 0; i--) {
    outCoords.push(coords[i]);
    outXZ.push(xzPts[i]);
  }
  if (outCoords.length < 2 && coords.length >= 2) {
    return {
      coords: [coords[coords.length - 1], coords[0]],
      xz: [xzPts[xzPts.length - 1], xzPts[0]],
    };
  }
  return { coords: outCoords, xz: outXZ };
}

function computeTailDirection(pts: XZPoint[]): XZPoint {
  if (pts.length < 2) return { x: 0, z: -1 };
  const tail = pts[pts.length - 1];
  for (let i = pts.length - 2; i >= 0; i--) {
    const dx = tail.x - pts[i].x;
    const dz = tail.z - pts[i].z;
    const len = Math.hypot(dx, dz);
    if (len > 0.5) {
      return { x: dx / len, z: dz / len };
    }
  }
  return { x: 0, z: -1 };
}

function computeHeadDirection(pts: XZPoint[]): XZPoint {
  if (pts.length < 2) return { x: 0, z: -1 };
  const head = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - head.x;
    const dz = pts[i].z - head.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.5) {
      return { x: dx / len, z: dz / len };
    }
  }
  return { x: 0, z: -1 };
}

function angleDegBetween(a: XZPoint, b: XZPoint): number {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z));
  return Math.round((Math.acos(dot) * 180) / Math.PI);
}

/**
 * Find the closest road and projected coordinate to a clicked LatLon on the map.
 */
export function findNearestRoadAtCoord(
  roads: OsmRoadWay[],
  origin: GeoOrigin,
  coord: LatLon,
): { road: OsmRoadWay; snappedCoord: LatLon; distMeters: number } | null {
  if (roads.length === 0) return null;
  const target = projectLatLon(coord.lat, coord.lon, origin);

  let bestRoad = roads[0];
  let bestDist = Infinity;
  let bestPt: XZPoint = projectLatLon(roads[0].coords[0].lat, roads[0].coords[0].lon, origin);

  for (const road of roads) {
    if (road.coords.length < 2) continue;
    const xz = road.coords.map((c) => projectLatLon(c.lat, c.lon, origin));
    const hit = closestPointOnPolyline(target, xz);
    if (hit.dist < bestDist) {
      bestDist = hit.dist;
      bestRoad = road;
      bestPt = hit.point;
    }
  }

  return {
    road: bestRoad,
    snappedCoord: unprojectXZ(bestPt.x, bestPt.z, origin),
    distMeters: bestDist,
  };
}

/**
 * Pick a sensible default starting road from a dataset (longest main/named road).
 */
export function pickDefaultStartRoad(roads: OsmRoadWay[], origin: GeoOrigin): OsmRoadWay | null {
  if (roads.length === 0) return null;
  let best = roads[0];
  let bestLen = -1;
  for (const r of roads) {
    if (r.coords.length < 2) continue;
    const xz = r.coords.map((c) => projectLatLon(c.lat, c.lon, origin));
    const len = polylineLenXZ(xz);
    if (len > bestLen) {
      bestLen = len;
      best = r;
    }
  }
  return best;
}

/**
 * Trace a continuous route from a starting road + starting coordinate, following
 * connected road segments up to `maxDistanceMeters`, and recording any junctions/ends
 * where connecting roads branch off so the user can choose which road to follow.
 */
export function traceRouteFromRoad(
  roads: OsmRoadWay[],
  origin: GeoOrigin,
  params: TraceRouteParams,
): TracedRoute | null {
  const startRoad = roads.find((r) => r.id === params.startRoadId);
  if (!startRoad || startRoad.coords.length < 2) return null;

  const maxDist = Math.max(50, params.maxDistanceMeters);
  const junctionChoices = params.junctionChoices ?? {};

  const roadXZMap = new Map<number, XZPoint[]>();
  for (const r of roads) {
    if (r.coords.length >= 2) {
      roadXZMap.set(
        r.id,
        r.coords.map((c) => projectLatLon(c.lat, c.lon, origin)),
      );
    }
  }

  const startXZAll = roadXZMap.get(startRoad.id)!;
  const reverse = Boolean(params.reverseDirection);

  let initSlice: { coords: LatLon[]; xz: XZPoint[] };
  if (params.startCoord) {
    const clickXZ = projectLatLon(params.startCoord.lat, params.startCoord.lon, origin);
    initSlice = sliceRoadFromPoint(startRoad.coords, startXZAll, origin, clickXZ, reverse);
  } else {
    initSlice = reverse
      ? { coords: [...startRoad.coords].reverse(), xz: [...startXZAll].reverse() }
      : { coords: [...startRoad.coords], xz: [...startXZAll] };
  }

  const outCoords: LatLon[] = [];
  const outXZ: XZPoint[] = [];
  const roadIds: number[] = [];
  const visitedRoadIds = new Set<number>();
  const junctions: TracedJunction[] = [];
  const widths: number[] = [];

  let currentRoad = startRoad;
  let currentCoords = initSlice.coords;
  let currentXZ = initSlice.xz;
  let accumDist = 0;
  let reachedTarget = false;

  const MAX_HOPS = 60;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    visitedRoadIds.add(currentRoad.id);
    roadIds.push(currentRoad.id);
    if (currentRoad.widthMeters) widths.push(currentRoad.widthMeters);

    for (let i = 0; i < currentCoords.length; i++) {
      const ptXZ = currentXZ[i];
      const ptLatLon = currentCoords[i];

      if (outXZ.length === 0) {
        outXZ.push(ptXZ);
        outCoords.push(ptLatLon);
        continue;
      }

      const prevXZ = outXZ[outXZ.length - 1];
      const segLen = dist2D(prevXZ, ptXZ);
      if (segLen < 0.05) continue;

      if (accumDist + segLen >= maxDist) {
        const remaining = maxDist - accumDist;
        const t = Math.max(0, Math.min(1, remaining / segLen));
        const cutXZ: XZPoint = {
          x: prevXZ.x + (ptXZ.x - prevXZ.x) * t,
          z: prevXZ.z + (ptXZ.z - prevXZ.z) * t,
        };
        outXZ.push(cutXZ);
        outCoords.push(unprojectXZ(cutXZ.x, cutXZ.z, origin));
        accumDist = maxDist;
        reachedTarget = true;
        break;
      }

      outXZ.push(ptXZ);
      outCoords.push(ptLatLon);
      accumDist += segLen;
    }

    if (reachedTarget || accumDist >= maxDist - 0.5) {
      reachedTarget = true;
      break;
    }

    // Current road segment ended before reaching maxDist -> look for connecting roads
    const tailXZ = outXZ[outXZ.length - 1];
    const tailDir = computeTailDirection(outXZ);
    const tailLatLon = outCoords[outCoords.length - 1];

    interface InternalOption {
      option: JunctionOption;
      score: number;
      road: OsmRoadWay;
      coords: LatLon[];
      xz: XZPoint[];
    }

    const candidates: InternalOption[] = [];

    for (const cand of roads) {
      if (cand.id === currentRoad.id || visitedRoadIds.has(cand.id)) continue;
      const candXZ = roadXZMap.get(cand.id);
      if (!candXZ || candXZ.length < 2) continue;

      const dStart = dist2D(tailXZ, candXZ[0]);
      const dEnd = dist2D(tailXZ, candXZ[candXZ.length - 1]);
      const interiorHit = closestPointOnPolyline(tailXZ, candXZ);

      const pushCandidate = (
        direction: 'forward' | 'backward',
        slicedCoords: LatLon[],
        slicedXZ: XZPoint[],
      ) => {
        if (slicedXZ.length < 2 || polylineLenXZ(slicedXZ) < MIN_BRANCH_LENGTH_M) return;
        const headDir = computeHeadDirection(slicedXZ);
        const turnAngleDeg = angleDegBetween(tailDir, headDir);
        const sameName =
          Boolean(currentRoad.name) &&
          Boolean(cand.name) &&
          currentRoad.name.toLowerCase() === cand.name.toLowerCase();

        // Prefer same road name + straightest forward continuation
        const cosAngle = tailDir.x * headDir.x + tailDir.z * headDir.z;
        const score = (sameName ? 2.5 : 0) + cosAngle;
        const optionKey = `${cand.id}:${direction}`;

        candidates.push({
          score,
          road: cand,
          coords: slicedCoords,
          xz: slicedXZ,
          option: {
            optionKey,
            roadId: cand.id,
            roadName: cand.name || `${cand.highway} #${cand.id}`,
            highway: cand.highway,
            direction,
            turnAngleDeg,
            previewCoords: slicedCoords.slice(0, 40),
          },
        });
      };

      if (dStart <= JUNCTION_ENDPOINT_SNAP_M) {
        pushCandidate('forward', cand.coords, candXZ);
      } else if (dEnd <= JUNCTION_ENDPOINT_SNAP_M) {
        pushCandidate('backward', [...cand.coords].reverse(), [...candXZ].reverse());
      } else if (interiorHit.dist <= JUNCTION_INTERIOR_SNAP_M) {
        const fwd = sliceRoadFromPoint(cand.coords, candXZ, origin, interiorHit.point, false);
        const bwd = sliceRoadFromPoint(cand.coords, candXZ, origin, interiorHit.point, true);
        pushCandidate('forward', fwd.coords, fwd.xz);
        pushCandidate('backward', bwd.coords, bwd.xz);
      }
    }

    if (candidates.length === 0) break;

    candidates.sort((a, b) => b.score - a.score);
    const junctionKey = `${currentRoad.id}_${hop}`;
    const chosenKey = junctionChoices[junctionKey];

    if (chosenKey === '__STOP__') {
      junctions.push({
        junctionKey,
        fromRoadId: currentRoad.id,
        fromRoadName: currentRoad.name || `${currentRoad.highway} #${currentRoad.id}`,
        atCoord: tailLatLon,
        distanceAtJunction: accumDist,
        selectedOptionKey: '__STOP__',
        options: candidates.map((c) => c.option),
      });
      break;
    }

    const picked =
      candidates.find((c) => c.option.optionKey === chosenKey) ?? candidates[0];

    junctions.push({
      junctionKey,
      fromRoadId: currentRoad.id,
      fromRoadName: currentRoad.name || `${currentRoad.highway} #${currentRoad.id}`,
      atCoord: tailLatLon,
      distanceAtJunction: accumDist,
      selectedOptionKey: picked.option.optionKey,
      options: candidates.map((c) => c.option),
    });

    currentRoad = picked.road;
    currentCoords = picked.coords;
    currentXZ = picked.xz;
  }

  if (outCoords.length < 2) return null;

  const avgWidth =
    widths.length > 0
      ? widths.reduce((sum, w) => sum + w, 0) / widths.length
      : undefined;

  return {
    coords: outCoords,
    roadIds,
    totalDistanceMeters: accumDist,
    reachedTargetDistance: reachedTarget,
    startCoord: outCoords[0],
    endCoord: outCoords[outCoords.length - 1],
    junctions,
    averageWidthMeters: avgWidth,
  };
}
