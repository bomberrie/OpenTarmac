import type { BoundingBox, ElevationGrid } from '../../types/track';
import {
  canDecodeBrowserImages,
  latToTileYFloat,
  lonToTileXFloat,
} from './tileUtils';

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const TILE_SIZE = 256;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Decode Mapzen/AWS Terrarium RGB pixel values to elevation in meters.
 */
export function decodeTerrariumPixel(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Create a bilinear `sample(lat, lon)` function for a row-major (south-to-north) grid.
 */
function createBilinearSampler(
  bbox: BoundingBox,
  cols: number,
  rows: number,
  heights: Float32Array
): (lat: number, lon: number) => number {
  const latSpan = Math.max(1e-9, bbox.north - bbox.south);
  const lonSpan = Math.max(1e-9, bbox.east - bbox.west);

  return (lat: number, lon: number): number => {
    const uNorm = clamp((lon - bbox.west) / lonSpan, 0, 1);
    const vNorm = clamp((lat - bbox.south) / latSpan, 0, 1);

    const gx = uNorm * (cols - 1);
    const gy = vNorm * (rows - 1);

    const c0 = Math.floor(gx);
    const r0 = Math.floor(gy);
    const c1 = Math.min(cols - 1, c0 + 1);
    const r1 = Math.min(rows - 1, r0 + 1);

    const tx = gx - c0;
    const ty = gy - r0;

    const h00 = heights[r0 * cols + c0];
    const h10 = heights[r0 * cols + c1];
    const h01 = heights[r1 * cols + c0];
    const h11 = heights[r1 * cols + c1];

    const h0 = h00 + (h10 - h00) * tx;
    const h1 = h01 + (h11 - h01) * tx;
    return h0 + (h1 - h0) * ty;
  };
}

function buildElevationGrid(
  bbox: BoundingBox,
  cols: number,
  rows: number,
  heights: Float32Array
): ElevationGrid {
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (h < minElevation) minElevation = h;
    if (h > maxElevation) maxElevation = h;
  }
  if (!Number.isFinite(minElevation)) minElevation = 0;
  if (!Number.isFinite(maxElevation)) maxElevation = 0;

  return {
    bbox,
    cols,
    rows,
    minElevation,
    maxElevation,
    heights,
    sample: createBilinearSampler(bbox, cols, rows, heights),
  };
}

/**
 * Create a flat `ElevationGrid` with uniform `baseElevation` (meters).
 */
export function createFlatElevationGrid(
  bbox: BoundingBox,
  baseElevation = 0
): ElevationGrid {
  const cols = 32;
  const rows = 32;
  const heights = new Float32Array(cols * rows);
  heights.fill(baseElevation);
  return buildElevationGrid(bbox, cols, rows, heights);
}

/**
 * Create a smooth deterministic procedural `ElevationGrid` fallback for offline/Node usage.
 */
export function createProceduralElevationGrid(
  bbox: BoundingBox,
  baseElevation = 0,
  amplitude = 18
): ElevationGrid {
  const cols = 64;
  const rows = 64;
  const heights = new Float32Array(cols * rows);

  // Subtle realistic rolling elevation relief around baseElevation
  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const ridge =
        Math.sin(u * Math.PI * 2.1 + 0.4) * Math.cos(v * Math.PI * 1.7 - 0.3) * 0.6 +
        Math.sin((u + v) * Math.PI * 3.2) * 0.25 +
        (v - 0.5) * 0.8;
      heights[r * cols + c] = baseElevation + ridge * amplitude;
    }
  }

  return buildElevationGrid(bbox, cols, rows, heights);
}

interface TileWindow {
  zoom: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function selectTileWindow(
  bbox: BoundingBox,
  startZoom: number,
  maxTiles = 16
): TileWindow {
  let zoom = clamp(Math.round(startZoom), 1, 15);
  while (zoom > 1) {
    const minX = Math.floor(lonToTileXFloat(bbox.west, zoom));
    const maxX = Math.floor(lonToTileXFloat(bbox.east, zoom));
    const minY = Math.floor(latToTileYFloat(bbox.north, zoom));
    const maxY = Math.floor(latToTileYFloat(bbox.south, zoom));
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    if (count <= maxTiles) {
      return { zoom, minX, maxX, minY, maxY };
    }
    zoom--;
  }

  const minX = Math.floor(lonToTileXFloat(bbox.west, zoom));
  const maxX = Math.floor(lonToTileXFloat(bbox.east, zoom));
  const minY = Math.floor(latToTileYFloat(bbox.north, zoom));
  const maxY = Math.floor(latToTileYFloat(bbox.south, zoom));
  return { zoom, minX, maxX, minY, maxY };
}

async function fetchTileRgba(
  zoom: number,
  x: number,
  y: number,
  signal?: AbortSignal
): Promise<Uint8ClampedArray> {
  const url = `${TERRARIUM_URL}/${zoom}/${x}/${y}.png`;
  const tileController = new AbortController();
  const onParentAbort = () => tileController.abort();
  signal?.addEventListener('abort', onParentAbort, { once: true });
  const timeoutId = setTimeout(() => tileController.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(url, { signal: tileController.signal, mode: 'cors' });
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onParentAbort);
  }
  if (!response.ok) {
    throw new Error(`Terrarium tile HTTP ${response.status} (${url})`);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to acquire 2D canvas context for DEM decoding.');
  }
  ctx.drawImage(bitmap, 0, 0, TILE_SIZE, TILE_SIZE);
  bitmap.close();
  return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
}

/**
 * Fetch elevation tiles from AWS Terrarium DEM and build a bilinearly sampled `ElevationGrid`.
 * Falls back to a procedural `ElevationGrid` in Node/non-browser environments; in browsers,
 * rejects on tile failure so callers can surface a clear flat-terrain notice instead of masking errors.
 */
export async function fetchElevationGrid(
  bbox: BoundingBox,
  options?: {
    zoom?: number;
    fallbackBaseElevation?: number;
    signal?: AbortSignal;
  }
): Promise<ElevationGrid> {
  const fallbackBase = options?.fallbackBaseElevation ?? 0;

  if (!canDecodeBrowserImages()) {
    return createProceduralElevationGrid(bbox, fallbackBase);
  }

  const win = selectTileWindow(bbox, options?.zoom ?? 15, 16);
  const tilesWide = win.maxX - win.minX + 1;
  const tilesHigh = win.maxY - win.minY + 1;

  const tilePromises: Promise<{
    tx: number;
    ty: number;
    rgba: Uint8ClampedArray;
  }>[] = [];

  for (let ty = win.minY; ty <= win.maxY; ty++) {
    for (let tx = win.minX; tx <= win.maxX; tx++) {
      tilePromises.push(
        fetchTileRgba(win.zoom, tx, ty, options?.signal).then((rgba) => ({
          tx,
          ty,
          rgba,
        }))
      );
    }
  }

  const decodedTiles = await Promise.all(tilePromises);
  const stitchedCols = tilesWide * TILE_SIZE;
  const stitchedRows = tilesHigh * TILE_SIZE;
  const stitchedMeters = new Float32Array(stitchedCols * stitchedRows);

  for (const tile of decodedTiles) {
    const offsetX = (tile.tx - win.minX) * TILE_SIZE;
    const offsetY = (tile.ty - win.minY) * TILE_SIZE;
    for (let py = 0; py < TILE_SIZE; py++) {
      for (let px = 0; px < TILE_SIZE; px++) {
        const rgbaIdx = (py * TILE_SIZE + px) * 4;
        const elev = decodeTerrariumPixel(
          tile.rgba[rgbaIdx],
          tile.rgba[rgbaIdx + 1],
          tile.rgba[rgbaIdx + 2]
        );
        stitchedMeters[(offsetY + py) * stitchedCols + (offsetX + px)] = elev;
      }
    }
  }

  // Resample stitched Mercator tile pixels onto a fine lat/lon grid covering bbox
  const cols = 192;
  const rows = 192;
  const heights = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const lat = bbox.south + (r / (rows - 1)) * (bbox.north - bbox.south);
    const tileY = latToTileYFloat(lat, win.zoom);
    const py = clamp((tileY - win.minY) * TILE_SIZE, 0, stitchedRows - 1);
    const y0 = Math.floor(py);
    const y1 = Math.min(stitchedRows - 1, y0 + 1);
    const ty = py - y0;

    for (let c = 0; c < cols; c++) {
      const lon = bbox.west + (c / (cols - 1)) * (bbox.east - bbox.west);
      const tileX = lonToTileXFloat(lon, win.zoom);
      const px = clamp((tileX - win.minX) * TILE_SIZE, 0, stitchedCols - 1);
      const x0 = Math.floor(px);
      const x1 = Math.min(stitchedCols - 1, x0 + 1);
      const tx = px - x0;

      const h00 = stitchedMeters[y0 * stitchedCols + x0];
      const h10 = stitchedMeters[y0 * stitchedCols + x1];
      const h01 = stitchedMeters[y1 * stitchedCols + x0];
      const h11 = stitchedMeters[y1 * stitchedCols + x1];

      const h0 = h00 + (h10 - h00) * tx;
      const h1 = h01 + (h11 - h01) * tx;
      heights[r * cols + c] = h0 + (h1 - h0) * ty;
    }
  }

  return buildElevationGrid(bbox, cols, rows, heights);
}
