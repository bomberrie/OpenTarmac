import type { BoundingBox, LatLon, SatelliteImagery } from '../../types/track';
import {
  canDecodeBrowserImages,
  latToTileYFloat,
  lonToTileXFloat,
} from './tileUtils';

const ESRI_SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const TILE_SIZE = 256;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function tileXToLon(x: number, zoom: number): number {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}

function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function expandBoundingBoxMeters(bbox: BoundingBox, padMeters: number): BoundingBox {
  const midLat = (bbox.south + bbox.north) * 0.5;
  const cosLat = Math.max(0.15, Math.cos((midLat * Math.PI) / 180));
  const dLat = padMeters / 111320;
  const dLon = padMeters / (111320 * cosLat);
  return {
    south: bbox.south - dLat,
    west: bbox.west - dLon,
    north: bbox.north + dLat,
    east: bbox.east + dLon,
  };
}

interface TileWindow {
  zoom: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function selectSatelliteTileWindow(bbox: BoundingBox, maxTiles = 16): TileWindow {
  for (let zoom = 17; zoom >= 11; zoom--) {
    const minX = Math.floor(lonToTileXFloat(bbox.west, zoom));
    const maxX = Math.floor(lonToTileXFloat(bbox.east, zoom));
    const minY = Math.floor(latToTileYFloat(bbox.north, zoom));
    const maxY = Math.floor(latToTileYFloat(bbox.south, zoom));
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    if (count <= maxTiles) {
      return { zoom, minX, maxX, minY, maxY };
    }
  }
  const zoom = 11;
  return {
    zoom,
    minX: Math.floor(lonToTileXFloat(bbox.west, zoom)),
    maxX: Math.floor(lonToTileXFloat(bbox.east, zoom)),
    minY: Math.floor(latToTileYFloat(bbox.north, zoom)),
    maxY: Math.floor(latToTileYFloat(bbox.south, zoom)),
  };
}

async function fetchTileBitmap(
  zoom: number,
  x: number,
  y: number,
  signal?: AbortSignal
): Promise<ImageBitmap> {
  const url = `${ESRI_SATELLITE_URL}/${zoom}/${y}/${x}`;
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  signal?.addEventListener('abort', onParentAbort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal, mode: 'cors' });
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onParentAbort);
  }

  if (!response.ok) {
    throw new Error(`Satellite tile HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return await createImageBitmap(blob);
}

/**
 * Fetch Esri World Imagery aerial tiles covering `bbox` and crop/resample cleanly
 * into a power-of-2 north-to-south `SatelliteImagery` RGBA buffer.
 * Returns `null` gracefully in Node/offline environments or on tile failures.
 */
export async function fetchSatelliteImagery(
  bbox: BoundingBox,
  options?: {
    outputSize?: number;
    maxTiles?: number;
    signal?: AbortSignal;
  }
): Promise<SatelliteImagery | null> {
  if (!canDecodeBrowserImages()) {
    return null;
  }

  const outSize = options?.outputSize ?? 1024;
  const maxTiles = options?.maxTiles ?? 16;

  try {
    const win = selectSatelliteTileWindow(bbox, maxTiles);
    const tilesWide = win.maxX - win.minX + 1;
    const tilesHigh = win.maxY - win.minY + 1;

    const tileTasks: Array<Promise<{ tx: number; ty: number; bitmap: ImageBitmap }>> = [];
    for (let ty = win.minY; ty <= win.maxY; ty++) {
      for (let tx = win.minX; tx <= win.maxX; tx++) {
        tileTasks.push(
          fetchTileBitmap(win.zoom, tx, ty, options?.signal).then((bitmap) => ({
            tx,
            ty,
            bitmap,
          }))
        );
      }
    }

    const tiles = await Promise.all(tileTasks);

    // Stitch full tile mosaic onto a source canvas
    const mosaicCanvas = document.createElement('canvas');
    mosaicCanvas.width = tilesWide * TILE_SIZE;
    mosaicCanvas.height = tilesHigh * TILE_SIZE;
    const mosaicCtx = mosaicCanvas.getContext('2d');
    if (!mosaicCtx) {
      tiles.forEach((t) => t.bitmap.close());
      return null;
    }

    for (const tile of tiles) {
      mosaicCtx.drawImage(
        tile.bitmap,
        (tile.tx - win.minX) * TILE_SIZE,
        (tile.ty - win.minY) * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE
      );
      tile.bitmap.close();
    }

    // Crop exact Mercator sub-window corresponding to bbox into outSize x outSize ortho buffer
    const minPxX = (lonToTileXFloat(bbox.west, win.zoom) - win.minX) * TILE_SIZE;
    const maxPxX = (lonToTileXFloat(bbox.east, win.zoom) - win.minX) * TILE_SIZE;
    const minPxY = (latToTileYFloat(bbox.north, win.zoom) - win.minY) * TILE_SIZE;
    const maxPxY = (latToTileYFloat(bbox.south, win.zoom) - win.minY) * TILE_SIZE;

    const srcW = Math.max(1, maxPxX - minPxX);
    const srcH = Math.max(1, maxPxY - minPxY);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outSize;
    outCanvas.height = outSize;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return null;

    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(mosaicCanvas, minPxX, minPxY, srcW, srcH, 0, 0, outSize, outSize);

    const imgData = outCtx.getImageData(0, 0, outSize, outSize);
    // Snap bbox edges cleanly to the Mercator tile extents represented by minPxX..maxPxX
    const resolvedBbox: BoundingBox = {
      west: tileXToLon(win.minX + minPxX / TILE_SIZE, win.zoom),
      east: tileXToLon(win.minX + maxPxX / TILE_SIZE, win.zoom),
      north: tileYToLat(win.minY + minPxY / TILE_SIZE, win.zoom),
      south: tileYToLat(win.minY + maxPxY / TILE_SIZE, win.zoom),
    };

    return {
      bbox: resolvedBbox,
      width: outSize,
      height: outSize,
      rgba: new Uint8Array(imgData.data),
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    return null;
  }
}

/**
 * Sample RGB pixel values (0-255) from `SatelliteImagery` at `(lat, lon)`.
 */
export function sampleSatellitePixel(
  sat: SatelliteImagery,
  lat: number,
  lon: number
): { r: number; g: number; b: number } {
  const lonSpan = Math.max(1e-9, sat.bbox.east - sat.bbox.west);
  const latSpan = Math.max(1e-9, sat.bbox.north - sat.bbox.south);

  const u = clamp((lon - sat.bbox.west) / lonSpan, 0, 1);
  // North (row 0) -> South (row height - 1)
  const v = clamp((sat.bbox.north - lat) / latSpan, 0, 1);

  const px = clamp(Math.round(u * (sat.width - 1)), 0, sat.width - 1);
  const py = clamp(Math.round(v * (sat.height - 1)), 0, sat.height - 1);
  const idx = (py * sat.width + px) * 4;

  return {
    r: sat.rgba[idx],
    g: sat.rgba[idx + 1],
    b: sat.rgba[idx + 2],
  };
}

/**
 * Estimate whether a satellite pixel (plus optional neighborhood) looks like tree canopy / dense foliage.
 * Filters out pale lawn grass and grey concrete/rock while catching conifers & deciduous crowns.
 */
export function isSatelliteTreeCanopyPixel(
  sat: SatelliteImagery,
  lat: number,
  lon: number
): { isTree: boolean; scaleHint: number } {
  const lonSpan = Math.max(1e-9, sat.bbox.east - sat.bbox.west);
  const latSpan = Math.max(1e-9, sat.bbox.north - sat.bbox.south);
  const u = clamp((lon - sat.bbox.west) / lonSpan, 0, 1);
  const v = clamp((sat.bbox.north - lat) / latSpan, 0, 1);

  const cx = clamp(Math.round(u * (sat.width - 1)), 0, sat.width - 1);
  const cy = clamp(Math.round(v * (sat.height - 1)), 0, sat.height - 1);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let minLuma = 255;
  let maxLuma = 0;
  let samples = 0;

  for (let dy = -1; dy <= 1; dy++) {
    const py = clamp(cy + dy, 0, sat.height - 1);
    for (let dx = -1; dx <= 1; dx++) {
      const px = clamp(cx + dx, 0, sat.width - 1);
      const idx = (py * sat.width + px) * 4;
      const r = sat.rgba[idx];
      const g = sat.rgba[idx + 1];
      const b = sat.rgba[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luma < minLuma) minLuma = luma;
      if (luma > maxLuma) maxLuma = luma;
      sumR += r;
      sumG += g;
      sumB += b;
      samples++;
    }
  }

  const r = sumR / samples;
  const g = sumG / samples;
  const b = sumB / samples;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const excessGreen = 2 * g - r - b;
  const greenDominance = g - Math.max(r, b);
  const localContrast = maxLuma - minLuma;

  // Real tree canopies exhibit leaf greenness combined with canopy shading / dark shadows
  // (unlike flat bright lawns or grey roofs/pavement).
  const hasCanopyTexture = localContrast >= 15 || minLuma <= 70;
  const isDenseFoliage =
    hasCanopyTexture &&
    ((excessGreen >= 10 && greenDominance >= 2 && luma >= 18 && luma <= 118) ||
      (excessGreen >= 22 && greenDominance >= 6 && localContrast >= 20 && luma <= 145));

  const scaleHint = clamp(1.2 - (luma - 30) / 140, 0.8, 1.4);
  return { isTree: isDenseFoliage, scaleHint };
}

/**
 * Search a local 3x3 sub-grid inside a terrain cell around `(centerLat, centerLon)`
 * and snap onto the strongest tree-canopy location if present.
 */
export function findBestTreeSpotInCell(
  sat: SatelliteImagery,
  centerLat: number,
  centerLon: number,
  halfSpanLat: number,
  halfSpanLon: number
): { lat: number; lon: number; scaleHint: number } | null {
  let bestScore = -1;
  let bestSpot: { lat: number; lon: number; scaleHint: number } | null = null;

  for (let sy = -1; sy <= 1; sy++) {
    const lat = centerLat + sy * halfSpanLat * 0.55;
    for (let sx = -1; sx <= 1; sx++) {
      const lon = centerLon + sx * halfSpanLon * 0.55;
      const hit = isSatelliteTreeCanopyPixel(sat, lat, lon);
      if (!hit.isTree) continue;
      const px = sampleSatellitePixel(sat, lat, lon);
      const exG = 2 * px.g - px.r - px.b;
      const luma = 0.299 * px.r + 0.587 * px.g + 0.114 * px.b;
      const score = exG + Math.max(0, 90 - luma) * 0.35;
      if (score > bestScore) {
        bestScore = score;
        bestSpot = { lat, lon, scaleHint: hit.scaleHint };
      }
    }
  }

  return bestSpot;
}

/**
 * Sample realistic average road surface tint RGB directly from satellite pixels along `coords`,
 * trimming extreme shadows and bright white markings.
 */
export function sampleRoadSurfaceTint(
  coords: LatLon[],
  sat: SatelliteImagery
): { r: number; g: number; b: number } | undefined {
  if (coords.length === 0) return undefined;

  const stride = Math.max(1, Math.floor(coords.length / 80));
  const samples: Array<{ r: number; g: number; b: number; luma: number }> = [];

  for (let i = 0; i < coords.length; i += stride) {
    const px = sampleSatellitePixel(sat, coords[i].lat, coords[i].lon);
    const luma = 0.299 * px.r + 0.587 * px.g + 0.114 * px.b;
    // Reject obvious tree canopy over road or clipped pure-white markings
    const exG = 2 * px.g - px.r - px.b;
    if (luma < 28 || luma > 215 || (exG > 24 && px.g > px.r + 10)) continue;
    samples.push({ ...px, luma });
  }

  if (samples.length < 3) return undefined;

  // Use middle 50% by luminance (trimmed mean) for authentic asphalt/concrete color
  samples.sort((a, b) => a.luma - b.luma);
  const lo = Math.floor(samples.length * 0.2);
  const hi = Math.max(lo + 1, Math.ceil(samples.length * 0.7));

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (let i = lo; i < hi; i++) {
    rSum += samples[i].r;
    gSum += samples[i].g;
    bSum += samples[i].b;
  }
  const count = hi - lo;
  return {
    r: Math.round(rSum / count),
    g: Math.round(gSum / count),
    b: Math.round(bSum / count),
  };
}
