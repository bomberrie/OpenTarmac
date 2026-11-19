import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { GeneratedTrackScene, ProceduralMesh } from '../../types/track.ts';
import {
  buildAiLineBytes,
  buildGlbBytes,
  buildKn5Bytes,
  buildModelsIni,
  buildObjText,
  buildSectionsIni,
  buildSurfacesIni,
  buildTrackIni,
  buildUiTrackJson,
  encodeRgbaToPng,
  generateTrackExport,
  sanitizeSlug,
} from '../export/index.ts';
import { encodeRgbaToDds } from '../export/ddsEncoder.ts';

function createSampleScene(): GeneratedTrackScene {
  const roadMesh: ProceduralMesh = {
    name: '1ROAD_main',
    layer: 'road',
    materialKey: 'ROAD',
    positions: new Float32Array([
      -4, 0, 0,
       4, 0, 0,
       4, 0, 50,
      -4, 0, 50,
    ]),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    uvs: new Float32Array([
      0, 0,
      1, 0,
      1, 5,
      0, 5,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };

  const wallMesh: ProceduralMesh = {
    name: '1WALL_guardrail',
    layer: 'wall',
    materialKey: 'WALL',
    positions: new Float32Array([
      -5, 0, 0,
      -5, 1, 0,
      -5, 1, 50,
      -5, 0, 50,
    ]),
    normals: new Float32Array([
      1, 0, 0,
      1, 0, 0,
      1, 0, 0,
      1, 0, 0,
    ]),
    uvs: new Float32Array([
      0, 0,
      0, 1,
      5, 1,
      5, 0,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };

  return {
    config: {
      trackName: 'Hakone Turnpike Test',
      trackSlug: 'hakone_turnpike_test',
      country: 'Japan',
      city: 'Hakone',
      runMode: 'point-to-point',
      roadWidthMultiplier: 1,
      defaultRoadWidth: 8,
      roadSmoothing: 0.5,
      elevationScale: 1,
      generateKerbs: true,
      generateGuardrails: true,
      generateBuildings: true,
      generateTrees: true,
      pitBoxCount: 4,
      gridSlotCount: 4,
      selectedRoadIds: [101],
    },
    origin: {
      lat: 35.195,
      lon: 139.045,
      baseElevation: 620,
    },
    bbox: {
      south: 35.19,
      west: 139.04,
      north: 35.2,
      east: 139.05,
    },
    meshes: [roadMesh, wallMesh],
    dummies: [
      {
        name: 'AC_START_0',
        kind: 'start',
        position: { x: 0, y: 0, z: 5 },
        forward: { x: 0, y: 0, z: 1 },
        up: { x: 0, y: 1, z: 0 },
      },
      {
        name: 'AC_PIT_0',
        kind: 'pit',
        position: { x: 3, y: 0, z: 2 },
        forward: { x: 0, y: 0, z: 1 },
        up: { x: 0, y: 1, z: 0 },
      },
      {
        name: 'AC_TIME_0_L',
        kind: 'time_l',
        position: { x: -4.5, y: 0, z: 10 },
        forward: { x: 0, y: 0, z: 1 },
        up: { x: 0, y: 1, z: 0 },
      },
    ],
    centerline: [
      {
        position: { x: 0, y: 0, z: 0 },
        forward: { x: 0, y: 0, z: 1 },
        right: { x: 1, y: 0, z: 0 },
        leftWidth: 4,
        rightWidth: 4,
        distanceFromStart: 0,
      },
      {
        position: { x: 0, y: 0.5, z: 25 },
        forward: { x: 0, y: 0.02, z: 0.9998 },
        right: { x: 1, y: 0, z: 0 },
        leftWidth: 4,
        rightWidth: 4,
        distanceFromStart: 25.005,
      },
      {
        position: { x: 0, y: 1.0, z: 50 },
        forward: { x: 0, y: 0.02, z: 0.9998 },
        right: { x: 1, y: 0, z: 0 },
        leftWidth: 4,
        rightWidth: 4,
        distanceFromStart: 50.01,
      },
    ],
    stats: {
      lengthMeters: 50.01,
      elevationGainMeters: 1.0,
      minElevationMeters: 620,
      maxElevationMeters: 621,
      roadCount: 1,
      buildingCount: 0,
      treeCount: 0,
      triangleCount: 4,
    },
  };
}

function readKn5String(view: DataView, bytes: Uint8Array, offset: number): { value: string; nextOffset: number } {
  const len = view.getInt32(offset, true);
  const value = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 4 + len));
  return { value, nextOffset: offset + 4 + len };
}

describe('Assetto Corsa Export Engine', () => {
  it('writes valid .kn5 v5 binary with magic, embedded PNG textures, materials, meshes, and AC dummies', () => {
    const scene = createSampleScene();
    const kn5 = buildKn5Bytes(scene);
    const view = new DataView(kn5.buffer, kn5.byteOffset, kn5.byteLength);

    // Header
    const magic = new TextDecoder().decode(kn5.subarray(0, 6));
    expect(magic).toBe('sc6969');
    expect(view.getInt32(6, true)).toBe(5);

    // Textures
    let offset = 10;
    const textureCount = view.getInt32(offset, true);
    offset += 4;
    expect(textureCount).toBe(6);

    const texNames: string[] = [];
    for (let i = 0; i < textureCount; i++) {
      const active = view.getInt32(offset, true);
      expect(active).toBe(1);
      offset += 4;
      const nameRead = readKn5String(view, kn5, offset);
      texNames.push(nameRead.value);
      offset = nameRead.nextOffset;
      const dataLen = view.getInt32(offset, true);
      offset += 4;
      // Check valid DDS header signature ("DDS ")
      expect(kn5[offset]).toBe(0x44);
      expect(kn5[offset + 1]).toBe(0x44);
      expect(kn5[offset + 2]).toBe(0x53);
      expect(kn5[offset + 3]).toBe(0x20);
      offset += dataLen;
    }
    expect(texNames).toEqual([
      'asphalt.dds',
      'kerb.dds',
      'grass.dds',
      'wall.dds',
      'building.dds',
      'tree.dds',
    ]);

    // Materials
    const matCount = view.getInt32(offset, true);
    offset += 4;
    expect(matCount).toBe(6);

    for (let m = 0; m < matCount; m++) {
      const matName = readKn5String(view, kn5, offset);
      offset = matName.nextOffset;
      const shaderName = readKn5String(view, kn5, offset);
      expect(shaderName.value).toBe('ksPerPixel');
      offset = shaderName.nextOffset;
      offset += 1 + 1 + 4; // blendMode + alphaTested + depthMode
      const propCount = view.getInt32(offset, true);
      offset += 4;
      for (let p = 0; p < propCount; p++) {
        const propName = readKn5String(view, kn5, offset);
        offset = propName.nextOffset + 10 * 4; // ValueA (1) + ValueB (2) + ValueC (3) + ValueD (4) = 10 floats
      }
      const texSlotCount = view.getInt32(offset, true);
      offset += 4;
      for (let t = 0; t < texSlotCount; t++) {
        const slotName = readKn5String(view, kn5, offset);
        offset = slotName.nextOffset + 4;
        const texRef = readKn5String(view, kn5, offset);
        offset = texRef.nextOffset;
      }
    }

    // Root Dummy Node
    expect(view.getInt32(offset, true)).toBe(1); // Dummy
    offset += 4;
    const rootName = readKn5String(view, kn5, offset);
    expect(rootName.value).toBe('hakone_turnpike_test');
    offset = rootName.nextOffset;
    const rootChildren = view.getInt32(offset, true);
    expect(rootChildren).toBe(scene.meshes.length + scene.dummies.length);
    offset += 4 + 1 + 16 * 4; // active + 4x4 matrix

    // First child mesh node: 1ROAD_main — walk ALL child nodes and assert exact EOF
    let childIdx = 0;
    for (; childIdx < rootChildren; childIdx++) {
      const nodeClass = view.getInt32(offset, true);
      offset += 4;
      const nodeName = readKn5String(view, kn5, offset);
      offset = nodeName.nextOffset;
      const subChildren = view.getInt32(offset, true);
      expect(subChildren).toBe(0);
      offset += 4 + 1; // childCount + active

      if (nodeClass === 1) {
        offset += 16 * 4; // 4x4 matrix
      } else if (nodeClass === 2) {
        offset += 3; // castShadows, isVisible, isTransparent
        const vCount = view.getInt32(offset, true);
        offset += 4 + vCount * 44;
        const iCount = view.getInt32(offset, true);
        offset += 4 + iCount * 2;
        offset += 4 + 4 + 4 + 4 + 12 + 4 + 1; // materialId, layer, lodIn, lodOut, sphere(3f+1f), isRenderable
      } else {
        throw new Error(`Unexpected nodeClass ${nodeClass}`);
      }
    }
    expect(childIdx).toBe(rootChildren);
    expect(offset).toBe(kn5.byteLength);
  });

  it('automatically splits meshes exceeding 65,000 vertices in .kn5 so uint16 indices stay valid', () => {
    const scene = createSampleScene();
    const triCount = 24000; // 72,000 unique vertices
    const positions = new Float32Array(triCount * 3 * 3);
    const normals = new Float32Array(triCount * 3 * 3);
    const uvs = new Float32Array(triCount * 3 * 2);
    const indices = new Uint32Array(triCount * 3);
    for (let i = 0; i < triCount * 3; i++) {
      positions[i * 3] = i * 0.01;
      normals[i * 3 + 1] = 1;
      indices[i] = i;
    }
    scene.meshes = [
      {
        name: '1GRASS_huge',
        layer: 'terrain',
        materialKey: 'GRASS',
        positions,
        normals,
        uvs,
        indices,
      },
    ];
    scene.dummies = [];

    const kn5 = buildKn5Bytes(scene);
    const decoder = new TextDecoder();
    const ascii = decoder.decode(kn5);
    expect(ascii).toContain('1GRASS_huge_part0');
    expect(ascii).toContain('1GRASS_huge_part1');
  });

  it('writes valid fast_lane.ai v7 binary matching AcTools AiPoint and AiPointExtra layout', () => {
    const scene = createSampleScene();
    const aiBytes = buildAiLineBytes(scene);
    const n = scene.centerline.length;
    expect(aiBytes.byteLength).toBe(16 + n * 20 + 4 + n * 72 + 4);

    const view = new DataView(aiBytes.buffer, aiBytes.byteOffset, aiBytes.byteLength);
    expect(view.getInt32(0, true)).toBe(7);
    expect(view.getInt32(4, true)).toBe(n);

    // Ideal point 1
    const ideal1 = 16 + 20;
    expect(view.getFloat32(ideal1 + 4, true)).toBeCloseTo(0.5, 4);
    expect(view.getFloat32(ideal1 + 8, true)).toBeCloseTo(25, 4);
    expect(view.getInt32(ideal1 + 16, true)).toBe(1);

    // PointsExtra count
    const extraCountOffset = 16 + n * 20;
    expect(view.getInt32(extraCountOffset, true)).toBe(n);

    // Detail block 0: f[0]=Speed, f[5..6]=SideLeft/SideRight, f[9..11]=Normal, f[12]=Length, f[13..15]=Forward
    const detail0 = extraCountOffset + 4;
    expect(view.getFloat32(detail0 + 0 * 4, true)).toBeCloseTo(25, 5);
    expect(view.getFloat32(detail0 + 5 * 4, true)).toBeCloseTo(4, 5);
    expect(view.getFloat32(detail0 + 6 * 4, true)).toBeCloseTo(4, 5);
    expect(view.getFloat32(detail0 + 10 * 4, true)).toBeCloseTo(1, 5); // Normal.Y
    expect(view.getFloat32(detail0 + 15 * 4, true)).toBeCloseTo(1, 5); // Forward.Z

    // Detail block 1: f[12] = distanceFromStart (25.005)
    const detail1 = detail0 + 72;
    expect(view.getFloat32(detail1 + 12 * 4, true)).toBeCloseTo(25.005, 3);
  });

  it('writes valid glTF 2.0 .glb binary and Wavefront .obj text', () => {
    const scene = createSampleScene();
    const glb = buildGlbBytes(scene);
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);

    expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(glb.byteLength);

    const jsonLen = view.getUint32(12, true);
    expect(view.getUint32(16, true)).toBe(0x4e4f534a); // "JSON"
    const jsonStr = new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)).trim();
    const gltf = JSON.parse(jsonStr);

    expect(gltf.asset.version).toBe('2.0');
    expect(gltf.meshes).toHaveLength(2);
    expect(gltf.nodes.map((n: { name: string }) => n.name)).toEqual([
      '1ROAD_main',
      '1WALL_guardrail',
      'AC_START_0',
      'AC_PIT_0',
      'AC_TIME_0_L',
    ]);
    expect(gltf.accessors[0].min).toEqual([-4, 0, 0]);
    expect(gltf.accessors[0].max).toEqual([4, 0, 50]);

    const binHeaderOffset = 20 + jsonLen;
    expect(view.getUint32(binHeaderOffset + 4, true)).toBe(0x004e4942); // "BIN\0"

    const obj = buildObjText(scene);
    expect(obj).toContain('o 1ROAD_main');
    expect(obj).toContain('o 1WALL_guardrail');
    expect(obj).toContain('usemtl ROAD');
    expect(obj).toContain('f 1/1/1 2/2/2 3/3/3');
    expect(obj).toContain('# AC_DUMMY AC_START_0');
  });

  it('generates valid AC config files (surfaces.ini, models.ini, track.ini, ui_track.json)', () => {
    const scene = createSampleScene();

    const surfaces = buildSurfacesIni();
    expect(surfaces).toContain('KEY=ROAD');
    expect(surfaces).toContain('KEY=KERB');
    expect(surfaces).toContain('KEY=GRASS');
    expect(surfaces).toContain('KEY=WALL');
    expect(surfaces).toContain('KEY=GRAVEL');
    expect(surfaces).toContain('IS_VALID_TRACK=1');

    const models = buildModelsIni('hakone_turnpike_test');
    expect(models).toContain('FILE=hakone_turnpike_test.kn5');

    const trackIni = buildTrackIni(scene.config);
    expect(trackIni).toContain('[LIGHTING]');
    expect(trackIni).toContain('[GROOVE]');

    const uiJson = JSON.parse(buildUiTrackJson(scene));
    expect(uiJson.name).toBe('Hakone Turnpike Test');
    expect(uiJson.country).toBe('Japan');
    expect(uiJson.city).toBe('Hakone');
    expect(uiJson.pitboxes).toBe('4');
    expect(uiJson.geotags).toHaveLength(2);
  });

  it('packages a complete Assetto Corsa content/tracks/<slug>/ zip archive', async () => {
    const scene = createSampleScene();
    const artifacts = await generateTrackExport(scene);

    expect(artifacts.fileList).toEqual([
      'content/tracks/hakone_turnpike_test/hakone_turnpike_test.kn5',
      'content/tracks/hakone_turnpike_test/models.ini',
      'content/tracks/hakone_turnpike_test/hakone_turnpike_test.ini',
      'content/tracks/hakone_turnpike_test/map.png',
      'content/tracks/hakone_turnpike_test/data/map.ini',
      'content/tracks/hakone_turnpike_test/data/surfaces.ini',
      'content/tracks/hakone_turnpike_test/data/lighting.ini',
      'content/tracks/hakone_turnpike_test/data/cameras.ini',
      'content/tracks/hakone_turnpike_test/data/sections.ini',
      'content/tracks/hakone_turnpike_test/ai/fast_lane.ai',
      'content/tracks/hakone_turnpike_test/ai/pit_lane.ai',
      'content/tracks/hakone_turnpike_test/ui/ui_track.json',
      'content/tracks/hakone_turnpike_test/ui/preview.png',
      'content/tracks/hakone_turnpike_test/ui/outline.png',
      'content/tracks/hakone_turnpike_test/source/hakone_turnpike_test.glb',
      'content/tracks/hakone_turnpike_test/source/hakone_turnpike_test.obj',
      'content/tracks/hakone_turnpike_test/README_INSTALL.txt',
    ]);

    const zipBytes = new Uint8Array(await artifacts.zipBlob.arrayBuffer());
    const loadedZip = await JSZip.loadAsync(zipBytes);
    for (const path of artifacts.fileList) {
      const entry = loadedZip.file(path);
      expect(entry).not.toBeNull();
      const data = await entry!.async('uint8array');
      expect(data.byteLength).toBeGreaterThan(0);
    }
  });

  it('sanitizes trackName and trackSlug against INI/comment injection and path traversal', async () => {
    const scene = createSampleScene();
    scene.config.trackName = 'Test\r\n[EVIL_SECTION]\nFILE=malicious.kn5';
    scene.config.trackSlug = '../../evil/Track Slug!';

    const trackIni = buildTrackIni(scene.config);
    expect(trackIni).not.toContain('\n[EVIL_SECTION]');
    expect(trackIni).toContain('NAME=Test [EVIL_SECTION] FILE=malicious.kn5');

    const sectionsIni = buildSectionsIni(scene);
    expect(sectionsIni).not.toContain('\nFILE=malicious.kn5');

    const modelsIni = buildModelsIni(scene.config.trackSlug);
    expect(modelsIni).toContain(`FILE=${sanitizeSlug(scene.config.trackSlug)}.kn5`);
    expect(modelsIni).not.toContain('..');

    const obj = buildObjText(scene);
    expect(obj.split('\n')[1]).not.toContain('[EVIL_SECTION]\n');

    const artifacts = await generateTrackExport(scene);
    for (const path of artifacts.fileList) {
      expect(path.startsWith('content/tracks/evil_track_slug/')).toBe(true);
      expect(path).not.toContain('..');
    }
  });

  it('enforces dimension and buffer bounds on DDS, PNG, and KN5 binary encoders', () => {
    expect(() => encodeRgbaToDds(0, 16, new Uint8Array(64))).toThrow(RangeError);
    expect(() => encodeRgbaToDds(8, 8, new Uint8Array(10))).toThrow(RangeError);
    expect(() => encodeRgbaToPng(-4, 4, new Uint8Array(64))).toThrow(RangeError);
    expect(() => encodeRgbaToPng(8, 8, new Uint8Array(10))).toThrow(RangeError);

    const scene = createSampleScene();
    scene.meshes = [
      {
        name: '1ROAD_bad',
        layer: 'road',
        materialKey: 'ROAD',
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
        uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 99]),
      },
    ];
    expect(() => buildKn5Bytes(scene)).toThrow(RangeError);
  });
});
