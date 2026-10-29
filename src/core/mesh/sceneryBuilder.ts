import type {
  ElevationGrid,
  GeoOrigin,
  OsmDataset,
  ProceduralMesh,
  SatelliteImagery,
  TrackGenerationConfig,
  Vec3,
} from '../../types/track';
import { projectLatLon, unprojectXZ } from '../geo/projection';
import { isSatelliteTreeCanopyPixel, findBestTreeSpotInCell } from '../geo/satellite';
import {
  distXZ,
  MeshAccumulator,
  pointToSegmentDistXZ,
  sampleLocalYAtXZ,
} from './math';

export interface SceneryBuildResult {
  meshes: ProceduralMesh[];
  buildingCount: number;
  treeCount: number;
}

interface XZ {
  x: number;
  z: number;
}

function signedAreaXZ(poly: XZ[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area * 0.5;
}

/**
 * Ensure polygon winds CCW when viewed from +Y (negative signed area in (x, z)).
 */
function ensureCcwFromTop(poly: XZ[]): XZ[] {
  return signedAreaXZ(poly) > 0 ? [...poly].reverse() : poly;
}

function pointInPolygonXZ(px: number, pz: number, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    const intersect =
      zi > pz !== zj > pz &&
      px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInTriangleXZ(
  px: number,
  pz: number,
  a: XZ,
  b: XZ,
  c: XZ
): boolean {
  const cross = (p1: XZ, p2: XZ, p3: XZ) =>
    (p1.x - p3.x) * (p2.z - p3.z) - (p2.x - p3.x) * (p1.z - p3.z);
  const d1 = cross({ x: px, z: pz }, a, b);
  const d2 = cross({ x: px, z: pz }, b, c);
  const d3 = cross({ x: px, z: pz }, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Ear-clipping triangulation for a simple polygon wound CCW from +Y (`signedAreaXZ < 0`).
 * Returns index triples referencing `poly`.
 */
function triangulatePolygonXZ(poly: XZ[]): Array<[number, number, number]> {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  if (n > 80) {
    const fan: Array<[number, number, number]> = [];
    for (let i = 1; i < n - 1; i++) {
      fan.push([0, i, i + 1]);
    }
    return fan;
  }

  const remaining = poly.map((_, idx) => idx);
  const triangles: Array<[number, number, number]> = [];
  let guard = n * n;

  while (remaining.length > 3 && guard-- > 0) {
    let earFound = false;

    for (let i = 0; i < remaining.length; i++) {
      const iPrev = (i - 1 + remaining.length) % remaining.length;
      const iNext = (i + 1) % remaining.length;

      const ia = remaining[iPrev];
      const ib = remaining[i];
      const ic = remaining[iNext];

      const a = poly[ia];
      const b = poly[ib];
      const c = poly[ic];

      // In XZ viewed from +Y, CCW convex vertex has (b-a) x (c-a) with positive Y = (b.z-a.z)*(c.x-a.x) - (b.x-a.x)*(c.z-a.z) > 0
      const crossY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      if (crossY <= 1e-6) continue;

      let containsOther = false;
      for (let k = 0; k < remaining.length; k++) {
        if (k === iPrev || k === i || k === iNext) continue;
        const p = poly[remaining[k]];
        if (pointInTriangleXZ(p.x, p.z, a, b, c)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;

      triangles.push([ia, ib, ic]);
      remaining.splice(i, 1);
      earFound = true;
      break;
    }

    if (!earFound) break;
  }

  if (remaining.length === 3) {
    triangles.push([remaining[0], remaining[1], remaining[2]]);
  } else if (remaining.length > 3 && triangles.length === 0) {
    // Fallback triangle fan for degenerate polygons
    for (let i = 1; i < n - 1; i++) {
      triangles.push([0, i, i + 1]);
    }
  }

  return triangles;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function appendConeRing(
  acc: MeshAccumulator,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  height: number,
  sides: number,
  rotOffset: number,
  vMin = 0,
  vMax = 1
): void {
  const baseVerts: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    // Negative angle step gives CCW order viewed from +Y
    const angle = rotOffset - (i / sides) * Math.PI * 2;
    baseVerts.push({
      x: cx + Math.cos(angle) * radius,
      y: cy,
      z: cz + Math.sin(angle) * radius,
    });
  }
  const apex: Vec3 = { x: cx, y: cy + height, z: cz };

  for (let i = 0; i < sides; i++) {
    const a = baseVerts[i];
    const b = baseVerts[(i + 1) % sides];
    // Outward side face (CCW viewed from outside)
    const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const e2 = { x: apex.x - a.x, y: apex.y - a.y, z: apex.z - a.z };
    const nx = e1.y * e2.z - e1.z * e2.y;
    const ny = e1.z * e2.x - e1.x * e2.z;
    const nz = e1.x * e2.y - e1.y * e2.x;
    const len = Math.hypot(nx, ny, nz) || 1;

    const ia = acc.addVertex(a.x, a.y, a.z, nx / len, ny / len, nz / len, 0, vMin);
    const ib = acc.addVertex(b.x, b.y, b.z, nx / len, ny / len, nz / len, 1, vMin);
    const ic = acc.addVertex(
      apex.x,
      apex.y,
      apex.z,
      nx / len,
      ny / len,
      nz / len,
      0.5,
      vMax
    );
    acc.addTriangle(ia, ib, ic);
  }
}

function appendWallQuad(
  acc: MeshAccumulator,
  aBot: Vec3,
  bBot: Vec3,
  bTop: Vec3,
  aTop: Vec3,
  uScale: number,
  vMin: number,
  vMax: number
): void {
  const e1 = { x: bBot.x - aBot.x, y: bBot.y - aBot.y, z: bBot.z - aBot.z };
  const e2 = { x: bTop.x - aBot.x, y: bTop.y - aBot.y, z: bTop.z - aBot.z };
  const nx = e1.y * e2.z - e1.z * e2.y;
  const ny = e1.z * e2.x - e1.x * e2.z;
  const nz = e1.x * e2.y - e1.y * e2.x;
  const len = Math.hypot(nx, ny, nz) || 1;
  const unx = nx / len;
  const uny = ny / len;
  const unz = nz / len;

  const ia = acc.addVertex(aBot.x, aBot.y, aBot.z, unx, uny, unz, 0, vMin);
  const ib = acc.addVertex(bBot.x, bBot.y, bBot.z, unx, uny, unz, uScale, vMin);
  const ic = acc.addVertex(bTop.x, bTop.y, bTop.z, unx, uny, unz, uScale, vMax);
  const id = acc.addVertex(aTop.x, aTop.y, aTop.z, unx, uny, unz, 0, vMax);
  acc.addTriangle(ia, ib, ic);
  acc.addTriangle(ia, ic, id);
}

function buildBuildingsMesh(
  dataset: OsmDataset,
  origin: GeoOrigin,
  elevation: ElevationGrid,
  config: TrackGenerationConfig
): { mesh: ProceduralMesh | null; count: number } {
  const acc = new MeshAccumulator();
  let count = 0;
  const maxBuildings = 3500;

  for (const building of dataset.buildings) {
    if (count >= maxBuildings) break;
    if (building.polygon.length < 3) continue;

    const projected = building.polygon.map((pt) =>
      projectLatLon(pt.lat, pt.lon, origin)
    );
    const deduped: XZ[] = [projected[0]];
    for (let i = 1; i < projected.length; i++) {
      if (distXZ(deduped[deduped.length - 1], projected[i]) >= 0.25) {
        deduped.push(projected[i]);
      }
    }
    if (
      deduped.length > 2 &&
      distXZ(deduped[0], deduped[deduped.length - 1]) < 0.25
    ) {
      deduped.pop();
    }
    if (deduped.length < 3) continue;

    const poly = ensureCcwFromTop(deduped);

    let minY = Infinity;
    let maxY = -Infinity;
    let sumX = 0;
    let sumZ = 0;
    for (const p of poly) {
      sumX += p.x;
      sumZ += p.z;
      const y = sampleLocalYAtXZ(p.x, p.z, origin, elevation, config.elevationScale);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const baseY = minY - 1.8; // Skirt below lowest corner so sloped terrain has no gap
    const topY = maxY + building.heightMeters;

    // Extrude outer walls into masonry/window facade band [0.02..0.76]
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const edgeLen = distXZ(a, b);
      if (edgeLen < 0.1) continue;

      const aBot: Vec3 = { x: a.x, y: baseY, z: a.z };
      const bBot: Vec3 = { x: b.x, y: baseY, z: b.z };
      const bTop: Vec3 = { x: b.x, y: topY, z: b.z };
      const aTop: Vec3 = { x: a.x, y: topY, z: a.z };

      appendWallQuad(acc, aBot, bBot, bTop, aTop, Math.max(1, edgeLen / 5), 0.02, 0.76);
    }

    // 3D hipped roof for 4-corner residential buildings; flat triangulated roof for complex footprints
    if (poly.length === 4 && building.heightMeters <= 20) {
      const cx = sumX / 4;
      const cz = sumZ / 4;
      const roofPeakY = topY + Math.min(3.2, Math.max(1.4, building.heightMeters * 0.22));
      const peak: Vec3 = { x: cx, y: roofPeakY, z: cz };
      for (let i = 0; i < 4; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % 4];
        const e1 = { x: b.x - a.x, y: 0, z: b.z - a.z };
        const e2 = { x: peak.x - a.x, y: peak.y - topY, z: peak.z - a.z };
        const nx = e1.y * e2.z - e1.z * e2.y;
        const ny = e1.z * e2.x - e1.x * e2.z;
        const nz = e1.x * e2.y - e1.y * e2.x;
        const len = Math.hypot(nx, ny, nz) || 1;
        const ia = acc.addVertex(a.x, topY, a.z, nx / len, ny / len, nz / len, 0, 0.84);
        const ib = acc.addVertex(b.x, topY, b.z, nx / len, ny / len, nz / len, 1, 0.84);
        const ic = acc.addVertex(peak.x, peak.y, peak.z, nx / len, ny / len, nz / len, 0.5, 0.98);
        acc.addTriangle(ia, ib, ic);
      }
    } else {
      const roofTris = triangulatePolygonXZ(poly);
      const roofVertOffset = acc.vertexCount;
      for (const p of poly) {
        acc.addVertex(p.x, topY, p.z, 0, 1, 0, (p.x % 10) * 0.1, 0.9);
      }
      for (const [ia, ib, ic] of roofTris) {
        acc.addTriangle(
          roofVertOffset + ia,
          roofVertOffset + ib,
          roofVertOffset + ic
        );
      }
    }

    count++;
  }

  if (count === 0 || acc.triangleCount === 0) {
    return { mesh: null, count: 0 };
  }

  return {
    mesh: acc.build('building_batch', 'building', 'BUILDING', false),
    count,
  };
}

function appendTreeMesh(
  acc: MeshAccumulator,
  tx: number,
  ty: number,
  tz: number,
  height: number,
  radius: number,
  rot: number
): void {
  // Grounded woody trunk mapped to bark UV band [0.02..0.16]
  appendConeRing(
    acc,
    tx,
    ty - 0.5,
    tz,
    Math.max(0.36, radius * 0.22),
    height * 0.45,
    5,
    rot * 0.5,
    0.02,
    0.16
  );
  // 3 fuller 7-sided foliage tiers mapped to leafy canopy UV band [0.24..0.98]
  appendConeRing(
    acc,
    tx,
    ty + height * 0.2,
    tz,
    radius,
    height * 0.44,
    7,
    rot,
    0.24,
    0.96
  );
  appendConeRing(
    acc,
    tx,
    ty + height * 0.43,
    tz,
    radius * 0.82,
    height * 0.4,
    7,
    rot + 0.45,
    0.26,
    0.98
  );
  appendConeRing(
    acc,
    tx,
    ty + height * 0.64,
    tz,
    radius * 0.58,
    height * 0.36,
    7,
    rot + 0.9,
    0.28,
    0.98
  );
}

function buildTreesMesh(
  dataset: OsmDataset,
  origin: GeoOrigin,
  elevation: ElevationGrid,
  config: TrackGenerationConfig,
  satellite?: SatelliteImagery | null
): { mesh: ProceduralMesh | null; count: number } {
  const sat = config.satelliteImagery !== false ? satellite : null;
  if (dataset.forests.length === 0 && !sat) return { mesh: null, count: 0 };

  // Precompute road segments in local XZ to keep trees off roads
  const roadSegments: Array<{
    ax: number;
    az: number;
    bx: number;
    bz: number;
    clearance: number;
  }> = [];

  for (const road of dataset.roads) {
    const halfW =
      ((road.widthMeters ?? config.defaultRoadWidth) *
        config.roadWidthMultiplier) *
      0.5;
    const clearance = halfW + 4.8;
    const pts = road.coords.map((c) => projectLatLon(c.lat, c.lon, origin));
    for (let i = 1; i < pts.length; i++) {
      roadSegments.push({
        ax: pts[i - 1].x,
        az: pts[i - 1].z,
        bx: pts[i].x,
        bz: pts[i].z,
        clearance,
      });
    }
  }

  // Precompute building bounding boxes in local XZ so satellite trees don't spawn inside houses
  const buildingBoxes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  for (const b of dataset.buildings) {
    if (b.polygon.length < 3) continue;
    let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
    for (const c of b.polygon) {
      const p = projectLatLon(c.lat, c.lon, origin);
      if (p.x < bMinX) bMinX = p.x;
      if (p.x > bMaxX) bMaxX = p.x;
      if (p.z < bMinZ) bMinZ = p.z;
      if (p.z > bMaxZ) bMaxZ = p.z;
    }
    buildingBoxes.push({
      minX: bMinX - 2,
      maxX: bMaxX + 2,
      minZ: bMinZ - 2,
      maxZ: bMaxZ + 2,
    });
  }

  const isBlockedPos = (
    tx: number,
    tz: number,
    nearbyRoadSegs: typeof roadSegments
  ): boolean => {
    for (const seg of nearbyRoadSegs) {
      if (
        pointToSegmentDistXZ(tx, tz, seg.ax, seg.az, seg.bx, seg.bz) <
        seg.clearance
      ) {
        return true;
      }
    }
    for (const bb of buildingBoxes) {
      if (tx >= bb.minX && tx <= bb.maxX && tz >= bb.minZ && tz <= bb.maxZ) {
        return true;
      }
    }
    return false;
  };

  const acc = new MeshAccumulator();
  const maxTrees = sat ? 1400 : 600;
  let treeCount = 0;

  // 1. Place explicit OSM forest polygon trees (enhanced by satellite canopy hints if present)
  for (const forest of dataset.forests) {
    if (treeCount >= maxTrees) break;
    if (forest.polygon.length < 3) continue;

    const poly = forest.polygon.map((c) => projectLatLon(c.lat, c.lon, origin));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const rand = mulberry32(forest.id ^ 0x9e3779b9);
    const spacing = 14;
    const forestSegments = roadSegments.filter((seg) => {
      const sMinX = Math.min(seg.ax, seg.bx) - seg.clearance;
      const sMaxX = Math.max(seg.ax, seg.bx) + seg.clearance;
      const sMinZ = Math.min(seg.az, seg.bz) - seg.clearance;
      const sMaxZ = Math.max(seg.az, seg.bz) + seg.clearance;
      return !(sMaxX < minX || sMinX > maxX || sMaxZ < minZ || sMinZ > maxZ);
    });

    for (let gx = minX + spacing * 0.5; gx < maxX; gx += spacing) {
      for (let gz = minZ + spacing * 0.5; gz < maxZ; gz += spacing) {
        if (treeCount >= maxTrees) break;

        const tx = gx + (rand() - 0.5) * spacing * 0.72;
        const tz = gz + (rand() - 0.5) * spacing * 0.72;
        if (!pointInPolygonXZ(tx, tz, poly)) continue;
        if (isBlockedPos(tx, tz, forestSegments)) continue;

        let scaleHint = 1.0;
        if (sat) {
          const ll = unprojectXZ(tx, tz, origin);
          const satInfo = isSatelliteTreeCanopyPixel(sat, ll.lat, ll.lon);
          scaleHint = satInfo.scaleHint;
        }

        const ty = sampleLocalYAtXZ(tx, tz, origin, elevation, config.elevationScale);
        const height = (7.2 + rand() * 6.5) * scaleHint;
        const radius = (2.2 + rand() * 1.45) * scaleHint;
        const rot = rand() * Math.PI * 2;

        appendTreeMesh(acc, tx, ty, tz, height, radius, rot);
        treeCount++;
      }
    }
  }

  // 2. Detect roadside & hillside tree canopies directly from real satellite imagery
  if (sat && treeCount < maxTrees) {
    const sw = projectLatLon(dataset.bbox.south, dataset.bbox.west, origin);
    const ne = projectLatLon(dataset.bbox.north, dataset.bbox.east, origin);
    const minX = Math.min(sw.x, ne.x);
    const maxX = Math.max(sw.x, ne.x);
    const minZ = Math.min(sw.z, ne.z);
    const maxZ = Math.max(sw.z, ne.z);

    const spanX = Math.max(50, maxX - minX);
    const spanZ = Math.max(50, maxZ - minZ);
    const areaSq = spanX * spanZ;
    // Choose adaptive sampling spacing and snap each cell onto the actual aerial canopy peak
    const satSpacing = Math.max(12, Math.min(40, Math.sqrt(areaSq / 2600)));
    const halfCell = satSpacing * 0.45;
    const midLat = (dataset.bbox.south + dataset.bbox.north) * 0.5;
    const cosLat = Math.max(0.15, Math.cos((midLat * Math.PI) / 180));
    const halfCellLat = halfCell / 111320;
    const halfCellLon = halfCell / (111320 * cosLat);
    const satRand = mulberry32(0x517cc1b7);

    for (let gx = minX + satSpacing * 0.5; gx < maxX; gx += satSpacing) {
      for (let gz = minZ + satSpacing * 0.5; gz < maxZ; gz += satSpacing) {
        if (treeCount >= maxTrees) break;

        const cellCenter = unprojectXZ(gx, gz, origin);
        const canopy = findBestTreeSpotInCell(
          sat,
          cellCenter.lat,
          cellCenter.lon,
          halfCellLat,
          halfCellLon
        );
        if (!canopy) continue;

        const snappedXZ = projectLatLon(canopy.lat, canopy.lon, origin);
        const tx = snappedXZ.x + (satRand() - 0.5) * 2.0;
        const tz = snappedXZ.z + (satRand() - 0.5) * 2.0;

        if (isBlockedPos(tx, tz, roadSegments)) continue;

        const ty = sampleLocalYAtXZ(tx, tz, origin, elevation, config.elevationScale);
        const height = (8.0 + satRand() * 6.8) * canopy.scaleHint;
        const radius = (2.5 + satRand() * 1.6) * canopy.scaleHint;
        const rot = satRand() * Math.PI * 2;

        appendTreeMesh(acc, tx, ty, tz, height, radius, rot);
        treeCount++;
      }
    }
  }

  if (treeCount === 0 || acc.triangleCount === 0) {
    return { mesh: null, count: 0 };
  }

  return {
    mesh: acc.build('trees_batch', 'tree', 'TREE', false),
    count: treeCount,
  };
}

/**
 * Build extruded `building_batch` and low-poly `trees_batch` scenery meshes.
 */
export function buildSceneryMeshes(
  dataset: OsmDataset,
  origin: GeoOrigin,
  elevation: ElevationGrid,
  config: TrackGenerationConfig,
  satellite?: SatelliteImagery | null
): SceneryBuildResult {
  const meshes: ProceduralMesh[] = [];
  let buildingCount = 0;
  let treeCount = 0;

  if (config.generateBuildings) {
    const b = buildBuildingsMesh(dataset, origin, elevation, config);
    if (b.mesh) meshes.push(b.mesh);
    buildingCount = b.count;
  }

  if (config.generateTrees) {
    const t = buildTreesMesh(dataset, origin, elevation, config, satellite);
    if (t.mesh) meshes.push(t.mesh);
    treeCount = t.count;
  }

  return { meshes, buildingCount, treeCount };
}
