import type {
  BoundingBox,
  LatLon,
  OsmBarrier,
  OsmBuilding,
  OsmDataset,
  OsmForestArea,
  OsmRoadWay,
} from '../../types/track';
import { sanitizeSingleLineText } from '../export/sanitize';
import { bboxCenter, bboxDimensionsMeters } from './projection';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const PER_WAVE_TIMEOUT_MS = 16000;
const MAX_OVERPASS_BYTES = 25 * 1024 * 1024;
const MAX_OVERPASS_ELEMENTS = 120_000;
const MAX_ROADS = 15_000;
const MAX_WAY_NODES = 10_000;

const NON_DRIVABLE_HIGHWAYS = new Set([
  'footway',
  'steps',
  'path',
  'cycleway',
  'pedestrian',
  'bridleway',
  'corridor',
  'proposed',
  'construction',
  'elevator',
  'platform',
]);

const HIGHWAY_DEFAULT_WIDTHS: Record<string, number> = {
  raceway: 11,
  motorway: 10.5,
  motorway_link: 8,
  trunk: 10,
  trunk_link: 7.5,
  primary: 8.5,
  primary_link: 7,
  secondary: 7.5,
  secondary_link: 6.5,
  tertiary: 7,
  tertiary_link: 6,
  residential: 6,
  living_street: 5.5,
  unclassified: 6,
  service: 4.5,
  track: 4,
};

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

function parseNumericTag(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const val = Number.parseFloat(match[1]);
  return Number.isFinite(val) && val > 0 ? val : undefined;
}

function inferRoadWidth(tags: Record<string, string>): number {
  const explicitWidth = parseNumericTag(tags.width);
  if (explicitWidth !== undefined) {
    return Math.min(30, Math.max(3, explicitWidth));
  }

  const lanes = parseNumericTag(tags.lanes);
  if (lanes !== undefined) {
    return Math.min(28, Math.max(4, Math.round(lanes) * 3.5));
  }

  return HIGHWAY_DEFAULT_WIDTHS[tags.highway] ?? 6.5;
}

function inferBuildingHeight(tags: Record<string, string>, wayId: number): number {
  const explicitHeight = parseNumericTag(tags.height);
  if (explicitHeight !== undefined) {
    return Math.min(200, Math.max(3, explicitHeight));
  }

  const levels = parseNumericTag(tags['building:levels']);
  if (levels !== undefined) {
    return Math.min(180, Math.max(3.5, levels * 3.2));
  }

  // Deterministic height between 9m and 18m when tags omit height/levels
  return 9 + (Math.abs(wayId) % 10);
}

function stripClosingPoint(coords: LatLon[]): LatLon[] {
  if (coords.length < 2) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (Math.abs(first.lat - last.lat) < 1e-8 && Math.abs(first.lon - last.lon) < 1e-8) {
    return coords.slice(0, -1);
  }
  return coords;
}

function parseBarrierKind(tag: string): OsmBarrier['kind'] | null {
  if (tag === 'guard_rail') return 'guard_rail';
  if (tag === 'wall') return 'wall';
  if (tag === 'fence') return 'fence';
  return null;
}

/**
 * Build an Overpass QL query string covering roads, barriers, and (for smaller boxes) buildings & forests.
 */
export function buildOverpassQuery(bbox: BoundingBox): string {
  const dims = bboxDimensionsMeters(bbox);
  const areaKm2 = (dims.width * dims.height) / 1_000_000;
  const includeHeavyScenery = areaKm2 <= 45;

  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const highwaySelector =
    areaKm2 > 30
      ? `  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|raceway)$"](${box});`
      : areaKm2 > 12
        ? `  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|raceway)$"](${box});`
        : `  way["highway"](${box});`;

  const lines = ['[out:json][timeout:20];', '(', highwaySelector];
  if (includeHeavyScenery) {
    lines.push(`  way["building"](${box});`);
    lines.push(`  way["natural"="wood"](${box});`);
    lines.push(`  way["landuse"="forest"](${box});`);
    lines.push(`  way["barrier"~"guard_rail|wall|fence"](${box});`);
  }
  lines.push(');', 'out body;', '>;', 'out skel qt;');
  return lines.join('\n');
}

function safeTagString(
  tags: Record<string, unknown>,
  key: string,
  maxLen = 160
): string | undefined {
  const raw = tags[key];
  if (typeof raw !== 'string') return undefined;
  const cleaned = sanitizeSingleLineText(raw, maxLen);
  return cleaned || undefined;
}

function isValidCoord(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Parse raw Overpass JSON into a normalized `OsmDataset` with strict bounds and tag validation.
 */
export function parseOverpassJson(raw: unknown, bbox: BoundingBox): OsmDataset {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid Overpass response: expected JSON object.');
  }
  const payload = raw as OverpassResponse;
  const elements = payload.elements;
  if (!Array.isArray(elements)) {
    throw new Error('Invalid Overpass response: missing elements array.');
  }
  if (elements.length > MAX_OVERPASS_ELEMENTS) {
    throw new Error(
      `Overpass response too large (${elements.length} elements; limit ${MAX_OVERPASS_ELEMENTS}). Try a smaller bounding box.`
    );
  }

  const nodeMap = new Map<number, LatLon>();
  for (const el of elements) {
    if (
      el &&
      typeof el === 'object' &&
      el.type === 'node' &&
      typeof el.id === 'number' &&
      Number.isSafeInteger(el.id) &&
      isValidCoord(el.lat, el.lon)
    ) {
      nodeMap.set(el.id, { lat: el.lat, lon: el.lon as number });
    }
  }

  const roads: OsmRoadWay[] = [];
  const buildings: OsmBuilding[] = [];
  const forests: OsmForestArea[] = [];
  const barriers: OsmBarrier[] = [];

  for (const el of elements) {
    if (
      !el ||
      typeof el !== 'object' ||
      el.type !== 'way' ||
      typeof el.id !== 'number' ||
      !Number.isSafeInteger(el.id) ||
      !el.tags ||
      typeof el.tags !== 'object' ||
      Array.isArray(el.tags) ||
      !Array.isArray(el.nodes)
    ) {
      continue;
    }

    const rawTags = el.tags as Record<string, unknown>;
    const nodeLimit = Math.min(el.nodes.length, MAX_WAY_NODES);
    const coords: LatLon[] = [];
    for (let ni = 0; ni < nodeLimit; ni++) {
      const nodeId = el.nodes[ni];
      if (typeof nodeId !== 'number') continue;
      const pt = nodeMap.get(nodeId);
      if (pt) coords.push(pt);
    }
    if (coords.length < 2) continue;

    const highway = safeTagString(rawTags, 'highway', 64);
    const nameTag = safeTagString(rawTags, 'name', 160);
    const refTag = safeTagString(rawTags, 'ref', 64);
    const widthTag = safeTagString(rawTags, 'width', 32);
    const lanesTag = safeTagString(rawTags, 'lanes', 16);
    const surfaceTag = safeTagString(rawTags, 'surface', 64);
    const onewayTag = safeTagString(rawTags, 'oneway', 16);
    const bridgeTag = safeTagString(rawTags, 'bridge', 16);
    const buildingTag = safeTagString(rawTags, 'building', 64);
    const heightTag = safeTagString(rawTags, 'height', 32);
    const levelsTag = safeTagString(rawTags, 'building:levels', 16);
    const naturalTag = safeTagString(rawTags, 'natural', 64);
    const landuseTag = safeTagString(rawTags, 'landuse', 64);
    const barrierTag = safeTagString(rawTags, 'barrier', 64);

    const sanitizedTags: Record<string, string> = {};
    if (highway) sanitizedTags.highway = highway;
    if (widthTag) sanitizedTags.width = widthTag;
    if (lanesTag) sanitizedTags.lanes = lanesTag;
    if (heightTag) sanitizedTags.height = heightTag;
    if (levelsTag) sanitizedTags['building:levels'] = levelsTag;

    if (highway && !NON_DRIVABLE_HIGHWAYS.has(highway) && roads.length < MAX_ROADS) {
      const lanes = parseNumericTag(lanesTag);
      const oneway =
        onewayTag === 'yes' || onewayTag === '1' || onewayTag === 'true';
      const bridge = bridgeTag === 'yes' || bridgeTag === 'viaduct';

      roads.push({
        id: el.id,
        name: nameTag || refTag || `${highway}_${el.id}`,
        highway,
        lanes: lanes !== undefined ? Math.round(lanes) : undefined,
        widthMeters: inferRoadWidth(sanitizedTags),
        surface: surfaceTag,
        oneway,
        bridge,
        coords,
      });
    }

    if (buildingTag) {
      const polygon = stripClosingPoint(coords);
      if (polygon.length >= 3) {
        buildings.push({
          id: el.id,
          name: nameTag,
          heightMeters: inferBuildingHeight(sanitizedTags, el.id),
          polygon,
        });
      }
    }

    if (naturalTag === 'wood' || landuseTag === 'forest') {
      const polygon = stripClosingPoint(coords);
      if (polygon.length >= 3) {
        forests.push({
          id: el.id,
          polygon,
        });
      }
    }

    if (barrierTag) {
      const kind = parseBarrierKind(barrierTag);
      if (kind) {
        barriers.push({
          id: el.id,
          kind,
          coords,
        });
      }
    }
  }

  if (roads.length === 0) {
    throw new Error(
      'Overpass returned no drivable roads in the selected bounding box.'
    );
  }

  const center = bboxCenter(bbox);
  return {
    bbox,
    origin: { lat: center.lat, lon: center.lon, baseElevation: 0 },
    roads,
    buildings,
    forests,
    barriers,
    source: 'overpass',
  };
}

async function querySingleOverpassEndpoint(
  endpoint: string,
  body: string,
  bbox: BoundingBox,
  signal: AbortSignal
): Promise<OsmDataset> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body,
    signal,
  });

  if (response.status === 429) {
    throw new Error(`Overpass rate-limited (HTTP 429) at ${endpoint}`);
  }
  if (!response.ok) {
    throw new Error(`Overpass HTTP ${response.status} from ${endpoint}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const len = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(len) && len > MAX_OVERPASS_BYTES) {
      throw new Error(`Overpass response exceeds ${MAX_OVERPASS_BYTES} byte limit.`);
    }
  }

  const json: unknown = await response.json();
  return parseOverpassJson(json, bbox);
}

/**
 * Fetch OSM roads, buildings, forests, and barriers for a bounding box from Overpass API.
 * Races pairs of Overpass mirrors in parallel so the fastest healthy mirror wins immediately.
 */
export async function fetchOsmDataset(
  bbox: BoundingBox,
  options?: { signal?: AbortSignal }
): Promise<OsmDataset> {
  const query = buildOverpassQuery(bbox);
  const body = `data=${encodeURIComponent(query)}`;
  let lastError: unknown = null;

  // Wave 1 & Wave 2: race up to 2 mirrors at a time with a 16s timeout per wave
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i += 2) {
    if (options?.signal?.aborted) {
      throw new DOMException('Overpass request aborted', 'AbortError');
    }

    const waveEndpoints = OVERPASS_ENDPOINTS.slice(i, i + 2);
    const waveController = new AbortController();
    let timedOut = false;
    const onParentAbort = () => waveController.abort();
    options?.signal?.addEventListener('abort', onParentAbort, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      waveController.abort();
    }, PER_WAVE_TIMEOUT_MS);

    try {
      const winner = await Promise.any(
        waveEndpoints.map((endpoint) =>
          querySingleOverpassEndpoint(endpoint, body, bbox, waveController.signal)
        )
      );
      // Cancel the slower mirror immediately once the fastest responds
      waveController.abort();
      return winner;
    } catch (err) {
      if (options?.signal?.aborted) {
        throw new DOMException('Overpass request aborted', 'AbortError');
      }
      if (timedOut) {
        lastError = new Error(
          `Overpass servers timed out after ${PER_WAVE_TIMEOUT_MS / 1000}s — try a smaller area box or Retry.`
        );
      } else if (err instanceof AggregateError && err.errors.length > 0) {
        const nonAbort = err.errors.find(
          (e) => !(e instanceof Error && e.name === 'AbortError')
        );
        lastError = nonAbort ?? new Error('Overpass mirrors failed to respond.');
      } else {
        lastError = err;
      }
    } finally {
      clearTimeout(timeoutId);
      options?.signal?.removeEventListener('abort', onParentAbort);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to fetch OSM data from Overpass API.');
}
