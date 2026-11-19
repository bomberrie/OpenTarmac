import { describe, expect, it } from 'vitest';
import type {
  BoundingBox,
  GeoOrigin,
  ProceduralMesh,
  TrackGenerationConfig,
} from '../../types/track';
import {
  bboxCenter,
  bboxDimensionsMeters,
  buildOverpassQuery,
  createFlatElevationGrid,
  decodeTerrariumPixel,
  fetchElevationGrid,
  findNearestRoadAtCoord,
  getPresetOsmDataset,
  parseOverpassJson,
  projectLatLon,
  traceRouteFromRoad,
  TRACK_PRESETS,
  unprojectXZ,
} from '../geo';
import { buildTrackScene } from '../mesh';

function makeConfig(
  overrides: Partial<TrackGenerationConfig> = {}
): TrackGenerationConfig {
  return {
    trackName: 'Test Track',
    trackSlug: 'test_track',
    country: 'Monaco',
    city: 'Monte Carlo',
    runMode: 'circuit',
    roadWidthMultiplier: 1.0,
    defaultRoadWidth: 8.0,
    roadSmoothing: 0.7,
    elevationScale: 1.0,
    generateKerbs: true,
    generateGuardrails: true,
    generateBuildings: true,
    generateTrees: true,
    pitBoxCount: 8,
    gridSlotCount: 12,
    selectedRoadIds: [],
    ...overrides,
  };
}

function assertValidMesh(mesh: ProceduralMesh): void {
  expect(mesh.positions.length).toBeGreaterThan(0);
  expect(mesh.positions.length % 3).toBe(0);
  expect(mesh.normals.length).toBe(mesh.positions.length);

  const vertexCount = mesh.positions.length / 3;
  expect(mesh.uvs.length).toBe(vertexCount * 2);
  expect(mesh.indices.length).toBeGreaterThan(0);
  expect(mesh.indices.length % 3).toBe(0);

  let nonFinitePos = 0;
  let nonFiniteNorm = 0;
  let badNormLen = 0;
  for (let i = 0; i < mesh.positions.length; i++) {
    if (!Number.isFinite(mesh.positions[i])) nonFinitePos++;
    if (!Number.isFinite(mesh.normals[i])) nonFiniteNorm++;
  }
  expect(nonFinitePos).toBe(0);
  expect(nonFiniteNorm).toBe(0);

  let nonFiniteUv = 0;
  for (let i = 0; i < mesh.uvs.length; i++) {
    if (!Number.isFinite(mesh.uvs[i])) nonFiniteUv++;
  }
  expect(nonFiniteUv).toBe(0);

  for (let i = 0; i < vertexCount; i++) {
    const nx = mesh.normals[i * 3];
    const ny = mesh.normals[i * 3 + 1];
    const nz = mesh.normals[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    if (Math.abs(len - 1) > 1e-3) badNormLen++;
  }
  expect(badNormLen).toBe(0);

  let badIndex = 0;
  for (let i = 0; i < mesh.indices.length; i++) {
    const idx = mesh.indices[i];
    if (!Number.isInteger(idx) || idx < 0 || idx >= vertexCount) badIndex++;
  }
  expect(badIndex).toBe(0);
}

describe('geo/projection', () => {
  it('projects origin to (0, 0) and round-trips lat/lon accurately', () => {
    const origin: GeoOrigin = { lat: 43.73485, lon: 7.42375, baseElevation: 10 };
    const atOrigin = projectLatLon(origin.lat, origin.lon, origin);
    expect(atOrigin.x).toBe(0);
    expect(atOrigin.z).toBe(-0);

    const testPoints = [
      { lat: 43.739, lon: 7.429 },
      { lat: 43.7305, lon: 7.418 },
      { lat: 46.5335, lon: 10.4625 },
      { lat: -33.8688, lon: 151.2093 },
    ];

    for (const pt of testPoints) {
      const localOrigin: GeoOrigin = {
        lat: pt.lat - 0.005,
        lon: pt.lon - 0.005,
        baseElevation: 0,
      };
      const projected = projectLatLon(pt.lat, pt.lon, localOrigin);
      expect(projected.x).toBeGreaterThan(0); // East is +X
      expect(projected.z).toBeLessThan(0); // North is -Z

      const roundTripped = unprojectXZ(projected.x, projected.z, localOrigin);
      expect(roundTripped.lat).toBeCloseTo(pt.lat, 10);
      expect(roundTripped.lon).toBeCloseTo(pt.lon, 10);
    }
  });

  it('computes bboxCenter and bboxDimensionsMeters', () => {
    const monaco = TRACK_PRESETS.find((p) => p.id === 'monaco-harbor')!;
    const center = bboxCenter(monaco.bbox);
    expect(center.lat).toBeCloseTo((monaco.bbox.south + monaco.bbox.north) / 2, 8);
    expect(center.lon).toBeCloseTo((monaco.bbox.west + monaco.bbox.east) / 2, 8);

    const dims = bboxDimensionsMeters(monaco.bbox);
    expect(dims.width).toBeGreaterThan(700);
    expect(dims.width).toBeLessThan(1200);
    expect(dims.height).toBeGreaterThan(800);
    expect(dims.height).toBeLessThan(1200);
  });
});

describe('geo/elevation', () => {
  it('decodes AWS Terrarium RGB pixels to meters', () => {
    expect(decodeTerrariumPixel(128, 0, 0)).toBe(0);
    expect(decodeTerrariumPixel(136, 152, 0)).toBe(2200);
    expect(decodeTerrariumPixel(0, 0, 0)).toBe(-32768);
    expect(decodeTerrariumPixel(128, 10, 128)).toBeCloseTo(10.5, 6);
  });

  it('creates flat elevation grid with clamped bilinear sampling', () => {
    const bbox: BoundingBox = {
      south: 43.73,
      west: 7.418,
      north: 43.74,
      east: 7.43,
    };
    const grid = createFlatElevationGrid(bbox, 125.5);
    expect(grid.minElevation).toBeCloseTo(125.5, 4);
    expect(grid.maxElevation).toBeCloseTo(125.5, 4);
    expect(grid.sample(43.735, 7.424)).toBeCloseTo(125.5, 4);
    expect(grid.sample(44.0, 8.0)).toBeCloseTo(125.5, 4);
  });

  it('falls back smoothly in Node environment for fetchElevationGrid', async () => {
    const bbox: BoundingBox = {
      south: 46.526,
      west: 10.451,
      north: 46.541,
      east: 10.474,
    };
    const grid = await fetchElevationGrid(bbox, { fallbackBaseElevation: 2200 });
    expect(grid.cols).toBeGreaterThan(10);
    expect(grid.rows).toBeGreaterThan(10);
    expect(grid.heights.length).toBe(grid.cols * grid.rows);

    const s = grid.sample(46.5335, 10.4625);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(2150);
    expect(s).toBeLessThan(2250);
  });
});

describe('geo/overpass', () => {
  it('builds Overpass QL query with required feature selectors', () => {
    const bbox: BoundingBox = {
      south: 43.73,
      west: 7.418,
      north: 43.74,
      east: 7.43,
    };
    const q = buildOverpassQuery(bbox);
    expect(q).toContain('way["highway"](43.73,7.418,43.74,7.43)');
    expect(q).toContain('way["building"](43.73,7.418,43.74,7.43)');
    expect(q).toContain('way["natural"="wood"](43.73,7.418,43.74,7.43)');
    expect(q).toContain('way["landuse"="forest"](43.73,7.418,43.74,7.43)');
    expect(q).toContain('way["barrier"~"guard_rail|wall|fence"](43.73,7.418,43.74,7.43)');
    expect(q).toContain('out body;');
    expect(q).toContain('out skel qt;');
  });

  it('parses Overpass JSON elements into OsmDataset with inferred widths & heights', () => {
    const bbox: BoundingBox = {
      south: 43.73,
      west: 7.418,
      north: 43.74,
      east: 7.43,
    };
    const sampleJson = {
      elements: [
        { type: 'node', id: 1, lat: 43.732, lon: 7.42 },
        { type: 'node', id: 2, lat: 43.735, lon: 7.423 },
        { type: 'node', id: 3, lat: 43.738, lon: 7.426 },
        { type: 'node', id: 4, lat: 43.733, lon: 7.421 },
        { type: 'node', id: 5, lat: 43.733, lon: 7.422 },
        { type: 'node', id: 6, lat: 43.734, lon: 7.422 },
        { type: 'node', id: 7, lat: 43.734, lon: 7.421 },
        {
          type: 'way',
          id: 101,
          nodes: [1, 2, 3],
          tags: { highway: 'primary', lanes: '2', name: 'Main Ave', oneway: 'yes' },
        },
        {
          type: 'way',
          id: 102,
          nodes: [1, 2],
          tags: { highway: 'footway' },
        },
        {
          type: 'way',
          id: 201,
          nodes: [4, 5, 6, 7, 4],
          tags: { building: 'yes', 'building:levels': '5', name: 'Harbor Tower' },
        },
        {
          type: 'way',
          id: 301,
          nodes: [4, 5, 6, 7, 4],
          tags: { natural: 'wood' },
        },
        {
          type: 'way',
          id: 401,
          nodes: [1, 2],
          tags: { barrier: 'guard_rail' },
        },
      ],
    };

    const dataset = parseOverpassJson(sampleJson, bbox);
    expect(dataset.source).toBe('overpass');
    expect(dataset.roads).toHaveLength(1); // footway filtered out
    expect(dataset.roads[0].name).toBe('Main Ave');
    expect(dataset.roads[0].widthMeters).toBe(7); // 2 lanes * 3.5m
    expect(dataset.roads[0].oneway).toBe(true);

    expect(dataset.buildings).toHaveLength(1);
    expect(dataset.buildings[0].heightMeters).toBeCloseTo(16, 4); // 5 * 3.2m
    expect(dataset.buildings[0].polygon).toHaveLength(4); // duplicate closing vertex stripped

    expect(dataset.forests).toHaveLength(1);
    expect(dataset.barriers).toHaveLength(1);
    expect(dataset.barriers[0].kind).toBe('guard_rail');
  });

  it('throws descriptive error when Overpass response has no drivable roads', () => {
    const bbox: BoundingBox = { south: 0, west: 0, north: 0.01, east: 0.01 };
    expect(() => parseOverpassJson({ elements: [] }, bbox)).toThrow(/no drivable roads/i);
  });

  it('rejects non-finite/out-of-range coordinates and strips control characters from OSM tags', () => {
    const bbox: BoundingBox = { south: 43.73, west: 7.418, north: 43.74, east: 7.43 };
    const raw = {
      elements: [
        { type: 'node', id: 1, lat: 43.732, lon: 7.42 },
        { type: 'node', id: 2, lat: 43.735, lon: 7.423 },
        { type: 'node', id: 3, lat: Number.NaN, lon: 7.425 },
        { type: 'node', id: 4, lat: 120, lon: 7.426 },
        {
          type: 'way',
          id: 101,
          nodes: [1, 2, 3, 4],
          tags: { highway: 'primary\r\n', name: 'Bad\nName\u0007Road' },
        },
        {
          type: 'way',
          id: 102,
          nodes: [3, 4],
          tags: { highway: 'secondary', name: 'Invalid Coords Only' },
        },
      ],
    };

    const dataset = parseOverpassJson(raw, bbox);
    expect(dataset.roads).toHaveLength(1);
    expect(dataset.roads[0].coords).toHaveLength(2);
    expect(dataset.roads[0].highway).toBe('primary');
    expect(dataset.roads[0].name).toBe('Bad Name Road');
  });
});

describe('geo/presets', () => {
  it('defines all three real-world track presets and valid fallback datasets', () => {
    const ids = TRACK_PRESETS.map((p) => p.id);
    expect(ids).toEqual(['monaco-harbor', 'stelvio-pass', 'hakone-turnpike']);

    for (const preset of TRACK_PRESETS) {
      const ds = getPresetOsmDataset(preset.id);
      expect(ds).not.toBeNull();
      expect(ds!.source).toBe('preset');
      expect(ds!.roads.length).toBeGreaterThanOrEqual(2);
      expect(ds!.buildings.length).toBeGreaterThan(0);
      expect(ds!.forests.length).toBeGreaterThan(0);
      expect(ds!.barriers.length).toBeGreaterThan(0);
    }

    expect(getPresetOsmDataset('non-existent')).toBeNull();
  });
});

describe('mesh/sceneBuilder', () => {
  it('builds complete valid meshes and AC dummies for Monaco circuit preset', async () => {
    const preset = TRACK_PRESETS.find((p) => p.id === 'monaco-harbor')!;
    const dataset = getPresetOsmDataset(preset.id)!;
    const elevation = await fetchElevationGrid(dataset.bbox, {
      fallbackBaseElevation: dataset.origin.baseElevation,
    });
    const config = makeConfig({
      trackName: preset.name,
      trackSlug: 'monaco_harbor',
      country: preset.country,
      city: preset.city,
      runMode: preset.runMode,
      gridSlotCount: 10,
      pitBoxCount: 6,
    });

    const scene = buildTrackScene(dataset, elevation, config);
    expect(scene.meshes.length).toBeGreaterThanOrEqual(6);

    for (const mesh of scene.meshes) {
      assertValidMesh(mesh);
    }

    const names = scene.meshes.map((m) => m.name);
    expect(names).toContain('1GRASS_terrain');
    expect(names).toContain('1ROAD_main');
    expect(names).toContain('1KERB_main');
    expect(names).toContain('1WALL_guardrail');
    expect(names).toContain('building_batch');
    expect(names).toContain('trees_batch');

    expect(scene.centerline.length).toBeGreaterThan(50);
    expect(scene.stats.lengthMeters).toBeGreaterThan(1000);
    expect(scene.stats.buildingCount).toBe(dataset.buildings.length);
    expect(scene.stats.treeCount).toBeGreaterThan(0);
    expect(scene.stats.triangleCount).toBeGreaterThan(1000);

    // Verify AC dummies
    const dummyNames = scene.dummies.map((d) => d.name);
    expect(dummyNames).toContain('AC_START_0');
    expect(dummyNames).toContain('AC_START_9');
    expect(dummyNames).toContain('AC_PIT_0');
    expect(dummyNames).toContain('AC_PIT_5');
    expect(dummyNames).toContain('AC_TIME_0_L');
    expect(dummyNames).toContain('AC_TIME_0_R');
    expect(dummyNames).toContain('AC_TIME_1_L');
    expect(dummyNames).toContain('AC_TIME_1_R');
    expect(dummyNames).toContain('AC_TIME_2_L');
    expect(dummyNames).toContain('AC_TIME_2_R');

    for (const dummy of scene.dummies) {
      expect(Number.isFinite(dummy.position.x)).toBe(true);
      expect(Number.isFinite(dummy.position.y)).toBe(true);
      expect(Number.isFinite(dummy.position.z)).toBe(true);
      const fLen = Math.hypot(dummy.forward.x, dummy.forward.y, dummy.forward.z);
      expect(fLen).toBeCloseTo(1, 4);
      expect(dummy.up).toEqual({ x: 0, y: 1, z: 0 });
    }

    // Timing gate left & right should span across track width (> 10m apart)
    const gate0L = scene.dummies.find((d) => d.name === 'AC_TIME_0_L')!;
    const gate0R = scene.dummies.find((d) => d.name === 'AC_TIME_0_R')!;
    const gateSpan = Math.hypot(
      gate0R.position.x - gate0L.position.x,
      gate0R.position.z - gate0L.position.z
    );
    expect(gateSpan).toBeGreaterThan(10);
  });

  it('builds point-to-point scenes for Stelvio Pass and Hakone Turnpike', async () => {
    for (const presetId of ['stelvio-pass', 'hakone-turnpike']) {
      const preset = TRACK_PRESETS.find((p) => p.id === presetId)!;
      const dataset = getPresetOsmDataset(preset.id)!;
      const elevation = await fetchElevationGrid(dataset.bbox, {
        fallbackBaseElevation: dataset.origin.baseElevation,
      });
      const config = makeConfig({
        trackName: preset.name,
        trackSlug: preset.id.replace('-', '_'),
        country: preset.country,
        city: preset.city,
        runMode: preset.runMode,
        gridSlotCount: 8,
        pitBoxCount: 4,
      });

      const scene = buildTrackScene(dataset, elevation, config);
      for (const mesh of scene.meshes) {
        assertValidMesh(mesh);
      }

      const start0 = scene.dummies.find((d) => d.name === 'AC_START_0')!;
      const time0L = scene.dummies.find((d) => d.name === 'AC_TIME_0_L')!;
      const time1L = scene.dummies.find((d) => d.name === 'AC_TIME_1_L')!;
      const time2L = scene.dummies.find((d) => d.name === 'AC_TIME_2_L')!;
      expect(start0).toBeDefined();
      expect(time0L).toBeDefined();
      expect(time1L).toBeDefined();
      expect(time2L).toBeDefined();
    }
  });

  it('respects toggle flags and roadSmoothing parameter', () => {
    const dataset = getPresetOsmDataset('hakone-turnpike')!;
    // Create noisy staircase elevation grid to test smoothing
    const baseGrid = createFlatElevationGrid(dataset.bbox, dataset.origin.baseElevation);
    for (let i = 0; i < baseGrid.heights.length; i++) {
      baseGrid.heights[i] += (i % 2 === 0 ? 1 : -1) * 4;
    }

    const rawScene = buildTrackScene(
      dataset,
      baseGrid,
      makeConfig({
        runMode: 'point-to-point',
        roadSmoothing: 0,
        generateKerbs: false,
        generateGuardrails: false,
        generateBuildings: false,
        generateTrees: false,
      })
    );

    const smoothScene = buildTrackScene(
      dataset,
      baseGrid,
      makeConfig({
        runMode: 'point-to-point',
        roadSmoothing: 1,
        generateKerbs: false,
        generateGuardrails: false,
        generateBuildings: false,
        generateTrees: false,
      })
    );

    // Verify optional layers omitted
    const layerSet = new Set(rawScene.meshes.map((m) => m.layer));
    expect(layerSet.has('kerb')).toBe(false);
    expect(layerSet.has('wall')).toBe(false);
    expect(layerSet.has('building')).toBe(false);
    expect(layerSet.has('tree')).toBe(false);

    // Measure vertical roughness (sum of abs second-differences along centerline)
    const roughness = (pts: typeof rawScene.centerline) => {
      let sum = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const d2 =
          pts[i + 1].position.y -
          2 * pts[i].position.y +
          pts[i - 1].position.y;
        sum += Math.abs(d2);
      }
      return sum;
    };

    expect(roughness(smoothScene.centerline)).toBeLessThan(
      roughness(rawScene.centerline) * 0.35
    );
  });

  it('honors selectedRoadIds when selecting primary centerline', () => {
    const dataset = getPresetOsmDataset('monaco-harbor')!;
    const secondaryRoad = dataset.roads[1];
    const elevation = createFlatElevationGrid(
      dataset.bbox,
      dataset.origin.baseElevation
    );

    const scene = buildTrackScene(
      dataset,
      elevation,
      makeConfig({
        runMode: 'point-to-point',
        selectedRoadIds: [secondaryRoad.id],
      })
    );

    // Secondary road is shorter than the full harbor circuit (~320m vs ~1600m)
    expect(scene.stats.lengthMeters).toBeLessThan(600);
    expect(scene.stats.lengthMeters).toBeGreaterThan(200);
  });

  it('traces a road to an exact follow distance and switches connecting roads at junctions', () => {
    const origin: GeoOrigin = { lat: 46.53, lon: 10.46, baseElevation: 100 };
    const p0 = unprojectXZ(0, 0, origin);
    const p1 = unprojectXZ(500, 0, origin);
    const p2East = unprojectXZ(1200, 0, origin);
    const p2North = unprojectXZ(500, -700, origin);

    const roads = [
      {
        id: 1,
        name: 'Start Pass',
        highway: 'primary',
        widthMeters: 8,
        coords: [p0, p1],
      },
      {
        id: 2,
        name: 'Start Pass',
        highway: 'primary',
        widthMeters: 8,
        coords: [p1, p2East],
      },
      {
        id: 3,
        name: 'Mountain Fork',
        highway: 'secondary',
        widthMeters: 7,
        coords: [p1, p2North],
      },
    ];

    const nearest = findNearestRoadAtCoord(roads, origin, unprojectXZ(100, 2, origin));
    expect(nearest?.road.id).toBe(1);

    // Auto-continue onto same-named road #2 and cut off cleanly at 800m
    const tracedAuto = traceRouteFromRoad(roads, origin, {
      startRoadId: 1,
      startCoord: p0,
      maxDistanceMeters: 800,
    });
    expect(tracedAuto).not.toBeNull();
    expect(tracedAuto!.totalDistanceMeters).toBeCloseTo(800, 1);
    expect(tracedAuto!.roadIds).toEqual([1, 2]);
    expect(tracedAuto!.junctions).toHaveLength(1);
    expect(tracedAuto!.junctions[0].options.length).toBe(2);

    // Override junction to follow connecting road #3 instead
    const jKey = tracedAuto!.junctions[0].junctionKey;
    const tracedFork = traceRouteFromRoad(roads, origin, {
      startRoadId: 1,
      startCoord: p0,
      maxDistanceMeters: 800,
      junctionChoices: { [jKey]: '3:forward' },
    });
    expect(tracedFork).not.toBeNull();
    expect(tracedFork!.roadIds).toEqual([1, 3]);
    expect(tracedFork!.totalDistanceMeters).toBeCloseTo(800, 1);
  });

  it('batches massive 1000-road 10km networks into low-draw-call meshes cleanly', () => {
    const origin: GeoOrigin = { lat: 34.25, lon: -118.15, baseElevation: 500 };
    const sw = unprojectXZ(-5000, 5000, origin);
    const ne = unprojectXZ(5000, -5000, origin);
    const bbox: BoundingBox = {
      south: sw.lat,
      west: sw.lon,
      north: ne.lat,
      east: ne.lon,
    };

    const roads = [];
    for (let i = 0; i < 1000; i++) {
      const x0 = ((i % 32) - 16) * 280;
      const z0 = (Math.floor(i / 32) - 16) * 280;
      roads.push({
        id: 1000 + i,
        name: `Grid Road ${i}`,
        highway: 'secondary',
        widthMeters: 8,
        coords: [
          unprojectXZ(x0, z0, origin),
          unprojectXZ(x0 + 250, z0 + 60, origin),
          unprojectXZ(x0 + 250, z0 + 240, origin),
        ],
      });
    }

    const dataset = {
      bbox,
      origin,
      roads,
      buildings: [],
      forests: [],
      barriers: [],
      source: 'overpass' as const,
    };
    const elevation = createFlatElevationGrid(bbox, 500);
    const scene = buildTrackScene(
      dataset,
      elevation,
      makeConfig({ runMode: 'point-to-point' })
    );

    expect(scene.stats.roadCount).toBe(1000);
    // Secondary roads are batched so total mesh count stays tiny (< 10) instead of 1000+
    expect(scene.meshes.length).toBeLessThan(10);
    expect(scene.meshes.some((m) => m.name.startsWith('1ROAD_network'))).toBe(true);
    for (const mesh of scene.meshes) {
      assertValidMesh(mesh);
    }
  });

  it('omits per-road kerbs and guardrails in freeRoam mode so junctions remain open', () => {
    const origin: GeoOrigin = { lat: 43.735, lon: 7.42, baseElevation: 5 };
    const sw = unprojectXZ(-300, 300, origin);
    const ne = unprojectXZ(300, -300, origin);
    const bbox: BoundingBox = { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
    const dataset = {
      bbox,
      origin,
      roads: [
        {
          id: 1,
          name: 'Main Blvd',
          highway: 'primary',
          widthMeters: 9,
          coords: [unprojectXZ(-200, 0, origin), unprojectXZ(200, 0, origin)],
        },
        {
          id: 2,
          name: 'Cross Street',
          highway: 'secondary',
          widthMeters: 8,
          coords: [unprojectXZ(0, -180, origin), unprojectXZ(0, 180, origin)],
        },
      ],
      buildings: [],
      forests: [],
      barriers: [],
      source: 'overpass' as const,
    };
    const elevation = createFlatElevationGrid(bbox, 5);
    const scene = buildTrackScene(
      dataset,
      elevation,
      makeConfig({
        runMode: 'point-to-point',
        freeRoam: true,
        generateKerbs: true,
        generateGuardrails: true,
      })
    );

    expect(scene.meshes.some((m) => m.name.startsWith('1ROAD_main'))).toBe(true);
    expect(scene.meshes.some((m) => m.name.startsWith('1ROAD_network'))).toBe(true);
    expect(scene.meshes.some((m) => m.name.startsWith('1KERB_'))).toBe(false);
    expect(scene.meshes.some((m) => m.name.startsWith('1WALL_'))).toBe(false);
    expect(scene.networkRoadsXZ?.length).toBe(dataset.roads.length);
  });

  it('uses satellite imagery for ortho terrain UVs, canopy trees, and road surface tint', () => {
    const origin: GeoOrigin = { lat: 43.735, lon: 7.42, baseElevation: 10 };
    const sw = unprojectXZ(-150, 150, origin);
    const ne = unprojectXZ(150, -150, origin);
    const bbox: BoundingBox = { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };

    const satSize = 64;
    const rgba = new Uint8Array(satSize * satSize * 4);
    for (let y = 0; y < satSize; y++) {
      for (let x = 0; x < satSize; x++) {
        const idx = (y * satSize + x) * 4;
        // Center horizontal road band (y in 28..36): weathered asphalt (92, 95, 100)
        if (y >= 28 && y <= 36) {
          rgba[idx] = 92;
          rgba[idx + 1] = 95;
          rgba[idx + 2] = 100;
        } else {
          // Dense green tree canopy everywhere else
          rgba[idx] = 30;
          rgba[idx + 1] = 88;
          rgba[idx + 2] = 28;
        }
        rgba[idx + 3] = 255;
      }
    }

    const dataset = {
      bbox,
      origin,
      roads: [
        {
          id: 10,
          name: 'Canopy Lane',
          highway: 'secondary',
          widthMeters: 8,
          coords: [unprojectXZ(-120, 0, origin), unprojectXZ(120, 0, origin)],
        },
      ],
      buildings: [],
      forests: [],
      barriers: [],
      source: 'overpass' as const,
    };

    const elevation = createFlatElevationGrid(bbox, 10);
    const scene = buildTrackScene(
      dataset,
      elevation,
      makeConfig({ runMode: 'point-to-point', satelliteImagery: true }),
      { bbox, width: satSize, height: satSize, rgba }
    );

    expect(scene.stats.treeCount).toBeGreaterThan(0);
    expect(scene.sampledRoadTintRgb).toBeDefined();
    expect(scene.sampledRoadTintRgb!.r).toBeCloseTo(92, -1);

    const terrain = scene.meshes.find((m) => m.name === '1GRASS_terrain')!;
    for (let i = 0; i < terrain.uvs.length; i++) {
      expect(terrain.uvs[i]).toBeGreaterThanOrEqual(0);
      expect(terrain.uvs[i]).toBeLessThanOrEqual(1);
    }
    assertValidMesh(terrain);
    const trees = scene.meshes.find((m) => m.name === 'trees_batch')!;
    assertValidMesh(trees);
  });
});
