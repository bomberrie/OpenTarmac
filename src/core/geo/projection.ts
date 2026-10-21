import type { BoundingBox, GeoOrigin, LatLon } from '../../types/track';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const WGS84_A = 6378137.0;
const WGS84_E2 = 0.0066943799901413165;

interface TangentScale {
  metersPerRadLat: number;
  metersPerRadLon: number;
}

/**
 * Compute local WGS84 meridional and transverse meters-per-radian scales at a given latitude.
 */
function getTangentScale(originLat: number): TangentScale {
  const latRad = originLat * DEG_TO_RAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.max(1e-6, Math.cos(latRad));
  const denom = Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const rMeridional = (WGS84_A * (1 - WGS84_E2)) / (denom * denom * denom);
  const rPrimeVertical = WGS84_A / denom;

  return {
    metersPerRadLat: rMeridional,
    metersPerRadLon: rPrimeVertical * cosLat,
  };
}

/**
 * Project WGS84 latitude/longitude into local right-handed Y-up meters centered at `origin`.
 * +X = East, -Z = North (+Z = South).
 */
export function projectLatLon(
  lat: number,
  lon: number,
  origin: GeoOrigin
): { x: number; z: number } {
  const { metersPerRadLat, metersPerRadLon } = getTangentScale(origin.lat);
  const x = (lon - origin.lon) * DEG_TO_RAD * metersPerRadLon;
  const z = -(lat - origin.lat) * DEG_TO_RAD * metersPerRadLat;
  return { x, z };
}

/**
 * Exact inverse of `projectLatLon`: converts local XZ meters back to WGS84 lat/lon.
 */
export function unprojectXZ(x: number, z: number, origin: GeoOrigin): LatLon {
  const { metersPerRadLat, metersPerRadLon } = getTangentScale(origin.lat);
  const lon = origin.lon + (x / metersPerRadLon) * RAD_TO_DEG;
  const lat = origin.lat - (z / metersPerRadLat) * RAD_TO_DEG;
  return { lat, lon };
}

/**
 * Compute the geographic center of a bounding box.
 */
export function bboxCenter(bbox: BoundingBox): LatLon {
  return {
    lat: (bbox.south + bbox.north) * 0.5,
    lon: (bbox.west + bbox.east) * 0.5,
  };
}

/**
 * Create a square bounding box in meters centered at `(lat, lon)`.
 */
export function createCenteredBbox(
  lat: number,
  lon: number,
  sizeMeters = 2000
): BoundingBox {
  const halfLat = sizeMeters / 2 / 111320;
  const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const halfLon = sizeMeters / 2 / (111320 * cosLat);
  return {
    south: lat - halfLat,
    west: lon - halfLon,
    north: lat + halfLat,
    east: lon + halfLon,
  };
}

/**
 * Compute the East-West (`width`) and North-South (`height`) span of a bounding box in meters.
 */
export function bboxDimensionsMeters(bbox: BoundingBox): {
  width: number;
  height: number;
} {
  const center = bboxCenter(bbox);
  const origin: GeoOrigin = { lat: center.lat, lon: center.lon, baseElevation: 0 };
  const sw = projectLatLon(bbox.south, bbox.west, origin);
  const ne = projectLatLon(bbox.north, bbox.east, origin);
  return {
    width: Math.abs(ne.x - sw.x),
    height: Math.abs(sw.z - ne.z),
  };
}
