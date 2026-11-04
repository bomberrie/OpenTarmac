import JSZip from 'jszip';
import type { ExportArtifacts, GeneratedTrackScene } from '../../types/track.ts';
import {
  buildCamerasIni,
  buildLightingIni,
  buildMapIni,
  buildModelsIni,
  buildSectionsIni,
  buildSurfacesIni,
  buildTrackIni,
  buildUiTrackJson,
} from './acConfigs.ts';
import { buildAiLineBytes } from './aiLineWriter.ts';
import { buildGlbBytes, buildObjText } from './glbObjWriter.ts';
import { buildKn5Bytes } from './kn5Writer.ts';
import { encodeRgbaToPng } from './pngEncoder.ts';
import { sanitizeSingleLineText, sanitizeSlug } from './sanitize.ts';

function drawThickLine(
  rgba: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  a: number,
  radius: number
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = Math.round(x0 + dx * t);
    const cy = Math.round(y0 + dy * t);
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius + 0.5) continue;
        const px = cx + ox;
        const py = cy + oy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const idx = (py * width + px) * 4;
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = a;
      }
    }
  }
}

function getSceneMapLines(scene: GeneratedTrackScene): Array<Array<{ x: number; z: number }>> {
  if (scene.config.freeRoam && scene.networkRoadsXZ && scene.networkRoadsXZ.length > 0) {
    return scene.networkRoadsXZ.filter((line) => line.length >= 2);
  }
  if (scene.centerline.length >= 2) {
    return [scene.centerline.map((pt) => ({ x: pt.position.x, z: pt.position.z }))];
  }
  return [];
}

function buildTrackMapPngAndIni(scene: GeneratedTrackScene): {
  mapPng: Uint8Array;
  mapIni: string;
} {
  const margin = 20;
  const maxInner = 472;
  const pts = scene.centerline;
  const lines = getSceneMapLines(scene);

  let minX = -50;
  let maxX = 50;
  let minZ = -50;
  let maxZ = 50;

  if (lines.length > 0) {
    minX = Infinity;
    maxX = -Infinity;
    minZ = Infinity;
    maxZ = -Infinity;
    for (const line of lines) {
      for (const pt of line) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      }
    }
  }

  const spanX = Math.max(10, maxX - minX);
  const spanZ = Math.max(10, maxZ - minZ);
  const scale = maxInner / Math.max(spanX, spanZ);
  const innerW = Math.max(64, Math.ceil(spanX * scale));
  const innerH = Math.max(64, Math.ceil(spanZ * scale));
  const width = innerW + margin * 2;
  const height = innerH + margin * 2;

  const rgba = new Uint8Array(width * height * 4); // transparent background

  // Draw secondary roads first, then primary centerline so spawn road stands out cleanly
  for (let lIdx = lines.length - 1; lIdx >= 0; lIdx--) {
    const line = lines[lIdx];
    const isPrimary = lIdx === 0;
    const radius = isPrimary ? 3 : 2;
    const colR = isPrimary ? 245 : 195;
    const colG = isPrimary ? 248 : 205;
    const colB = isPrimary ? 252 : 218;
    for (let i = 0; i < line.length - 1; i++) {
      const x0 = margin + (line[i].x - minX) * scale;
      const y0 = margin + (line[i].z - minZ) * scale;
      const x1 = margin + (line[i + 1].x - minX) * scale;
      const y1 = margin + (line[i + 1].z - minZ) * scale;
      drawThickLine(rgba, width, height, x0, y0, x1, y1, colR, colG, colB, 255, radius);
    }
  }

  if (pts.length >= 2) {
    const sx = margin + (pts[0].position.x - minX) * scale;
    const sy = margin + (pts[0].position.z - minZ) * scale;
    drawThickLine(rgba, width, height, sx, sy, sx, sy, 239, 68, 68, 255, 5);
  }

  const mapPng = encodeRgbaToPng(width, height, rgba);
  const mapIni = buildMapIni({
    width: innerW,
    height: innerH,
    margin,
    scaleFactor: 1 / scale,
    xOffset: -minX + margin / scale,
    zOffset: -minZ + margin / scale,
  });

  return { mapPng, mapIni };
}

function buildFallbackOutlinePng(scene: GeneratedTrackScene): Uint8Array {
  const w = 256;
  const h = 256;
  const rgba = new Uint8Array(w * h * 4);
  const pts = scene.centerline;
  const lines = getSceneMapLines(scene);

  if (lines.length > 0) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const line of lines) {
      for (const pt of line) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.z < minZ) minZ = pt.z;
        if (pt.z > maxZ) maxZ = pt.z;
      }
    }
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const scale = Math.min((w - 40) / spanX, (h - 40) / spanZ);
    const ox = (w - spanX * scale) * 0.5;
    const oy = (h - spanZ * scale) * 0.5;

    const toPx = (x: number, z: number): [number, number] => [
      ox + (x - minX) * scale,
      oy + (z - minZ) * scale,
    ];

    for (let lIdx = lines.length - 1; lIdx >= 0; lIdx--) {
      const line = lines[lIdx];
      const radius = lIdx === 0 ? 2 : 1;
      for (let i = 0; i < line.length - 1; i++) {
        const [x0, y0] = toPx(line[i].x, line[i].z);
        const [x1, y1] = toPx(line[i + 1].x, line[i + 1].z);
        drawThickLine(rgba, w, h, x0, y0, x1, y1, 248, 250, 252, 255, radius);
      }
    }

    if (pts.length >= 1) {
      // Start marker dot
      const [sx, sy] = toPx(pts[0].position.x, pts[0].position.z);
      drawThickLine(rgba, w, h, sx, sy, sx, sy, 239, 68, 68, 255, 5);
    }
  }

  return encodeRgbaToPng(w, h, rgba);
}

function buildFallbackPreviewPng(scene: GeneratedTrackScene): Uint8Array {
  const w = 320;
  const h = 180;
  const rgba = new Uint8Array(w * h * 4);

  // Subtle dark slate gradient background
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const r = Math.round(15 + t * 14);
    const g = Math.round(23 + t * 20);
    const b = Math.round(42 + t * 28);
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }

  const pts = scene.centerline;
  if (pts.length >= 2) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const pt of pts) {
      if (pt.position.x < minX) minX = pt.position.x;
      if (pt.position.x > maxX) maxX = pt.position.x;
      if (pt.position.z < minZ) minZ = pt.position.z;
      if (pt.position.z > maxZ) maxZ = pt.position.z;
    }
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const scale = Math.min((w - 48) / spanX, (h - 48) / spanZ);
    const ox = (w - spanX * scale) * 0.5;
    const oy = (h - spanZ * scale) * 0.5;

    for (let i = 0; i < pts.length - 1; i++) {
      const x0 = ox + (pts[i].position.x - minX) * scale;
      const y0 = oy + (pts[i].position.z - minZ) * scale;
      const x1 = ox + (pts[i + 1].position.x - minX) * scale;
      const y1 = oy + (pts[i + 1].position.z - minZ) * scale;
      drawThickLine(rgba, w, h, x0, y0, x1, y1, 56, 189, 248, 255, 2);
    }
  }

  return encodeRgbaToPng(w, h, rgba);
}

function buildReadmeInstall(scene: GeneratedTrackScene, slug: string): string {
  const safeName = sanitizeSingleLineText(scene.config.trackName) || 'OpenTarmac Track';
  return [
    `OpenTarmac - Assetto Corsa Track Package`,
    `========================================`,
    `Track Name : ${safeName}`,
    `Track Slug : ${slug}`,
    `Run Mode   : ${scene.config.runMode}`,
    `Length     : ${Math.round(scene.stats.lengthMeters)} m`,
    `Elev Gain  : ${Math.round(scene.stats.elevationGainMeters)} m`,
    `Pit Boxes  : ${scene.config.pitBoxCount}`,
    `Grid Slots : ${scene.config.gridSlotCount}`,
    ``,
    `HOW TO INSTALL IN ASSETTO CORSA`,
    `-------------------------------`,
    `1. Extract this archive so the folder:`,
    `   content/tracks/${slug}/`,
    `   is copied directly into your Assetto Corsa installation folder:`,
    `   <SteamLibrary>/steamapps/common/assettocorsa/content/tracks/${slug}/`,
    ``,
    `2. Launch Assetto Corsa or Content Manager and select "${safeName}".`,
    ``,
    `3. Optional 3D Editing:`,
    `   - source/${slug}.glb and source/${slug}.obj are included so you can`,
    `     customize terrain, textures, or objects in Blender or ksEditor.`,
    ``,
  ].join('\n');
}

/**
 * Generates all binary and text export artifacts for an Assetto Corsa track
 * and packages them into a ready-to-install `.zip` archive under `content/tracks/<slug>/`.
 */
export async function generateTrackExport(
  scene: GeneratedTrackScene,
  options?: { previewPng?: Uint8Array; outlinePng?: Uint8Array }
): Promise<ExportArtifacts> {
  const slug = sanitizeSlug(scene.config.trackSlug);
  const root = `content/tracks/${slug}`;

  const kn5Bytes = buildKn5Bytes(scene);
  const glbBytes = buildGlbBytes(scene);
  const objText = buildObjText(scene);
  const aiBytes = buildAiLineBytes(scene);

  const modelsIni = buildModelsIni(slug);
  const trackIni = buildTrackIni(scene.config);
  const surfacesIni = buildSurfacesIni();
  const lightingIni = buildLightingIni();
  const camerasIni = buildCamerasIni(scene);
  const sectionsIni = buildSectionsIni(scene);
  const uiTrackJson = buildUiTrackJson(scene);
  const readmeText = buildReadmeInstall(scene, slug);
  const { mapPng, mapIni } = buildTrackMapPngAndIni(scene);

  const previewPng =
    options?.previewPng && options.previewPng.length > 0
      ? options.previewPng
      : buildFallbackPreviewPng(scene);
  const outlinePng =
    options?.outlinePng && options.outlinePng.length > 0
      ? options.outlinePng
      : buildFallbackOutlinePng(scene);

  const zip = new JSZip();
  const entries: Array<[string, Uint8Array | string]> = [
    [`${root}/${slug}.kn5`, kn5Bytes],
    [`${root}/models.ini`, modelsIni],
    [`${root}/${slug}.ini`, trackIni],
    [`${root}/map.png`, mapPng],
    [`${root}/data/map.ini`, mapIni],
    [`${root}/data/surfaces.ini`, surfacesIni],
    [`${root}/data/lighting.ini`, lightingIni],
    [`${root}/data/cameras.ini`, camerasIni],
    [`${root}/data/sections.ini`, sectionsIni],
    [`${root}/ai/fast_lane.ai`, aiBytes],
    [`${root}/ai/pit_lane.ai`, aiBytes],
    [`${root}/ui/ui_track.json`, uiTrackJson],
    [`${root}/ui/preview.png`, previewPng],
    [`${root}/ui/outline.png`, outlinePng],
    [`${root}/source/${slug}.glb`, glbBytes],
    [`${root}/source/${slug}.obj`, objText],
    [`${root}/README_INSTALL.txt`, readmeText],
  ];

  for (const [path, content] of entries) {
    zip.file(path, content);
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    zipBlob,
    kn5Bytes,
    glbBytes,
    objText,
    aiBytes,
    fileList: entries.map(([path]) => path),
  };
}
