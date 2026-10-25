import type {
  GeoOrigin,
  LatLon,
  OsmBarrier,
  OsmBuilding,
  OsmDataset,
  OsmForestArea,
  OsmRoadWay,
  TrackPreset,
} from '../../types/track';
import { unprojectXZ } from './projection';

export const TRACK_PRESETS: TrackPreset[] = [
  {
    id: 'monaco-harbor',
    name: 'Monaco Harbor Circuit',
    subtitle: 'Harbor Street Circuit · Monte Carlo',
    country: 'Monaco',
    city: 'Monte Carlo',
    runMode: 'circuit',
    bbox: {
      south: 43.7305,
      west: 7.418,
      north: 43.7392,
      east: 7.4295,
    },
    center: { lat: 43.73485, lon: 7.42375 },
    zoom: 15,
  },
  {
    id: 'stelvio-pass',
    name: 'Stelvio Pass Touge',
    subtitle: 'Alpine Switchbacks · Lombardy',
    country: 'Italy',
    city: 'Lombardy',
    runMode: 'point-to-point',
    bbox: {
      south: 46.526,
      west: 10.451,
      north: 46.541,
      east: 10.474,
    },
    center: { lat: 46.5335, lon: 10.4625 },
    zoom: 14,
  },
  {
    id: 'hakone-turnpike',
    name: 'Hakone Turnpike',
    subtitle: 'Mountain Touge · Kanagawa',
    country: 'Japan',
    city: 'Kanagawa',
    runMode: 'point-to-point',
    bbox: {
      south: 35.188,
      west: 139.038,
      north: 35.203,
      east: 139.059,
    },
    center: { lat: 35.1955, lon: 139.0485 },
    zoom: 14,
  },
];

function xzPathToLatLon(
  points: ReadonlyArray<[number, number]>,
  origin: GeoOrigin
): LatLon[] {
  return points.map(([x, z]) => unprojectXZ(x, z, origin));
}

function makeBoxPolygon(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  angleRad: number,
  origin: GeoOrigin
): LatLon[] {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const corners: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return corners.map(([lx, lz]) =>
    unprojectXZ(cx + lx * cos - lz * sin, cz + lx * sin + lz * cos, origin)
  );
}

function buildMonacoDataset(preset: TrackPreset): OsmDataset {
  const origin: GeoOrigin = {
    lat: preset.center.lat,
    lon: preset.center.lon,
    baseElevation: 6,
  };

  // Closed harbor circuit loop in local XZ meters (+X East, -Z North)
  const mainLoopXZ: [number, number][] = [
    [-250, 140], // Start/Finish Straight (Boulevard Albert 1er)
    [-250, -40], // Braking into Sainte-Devote
    [-235, -140], // Sainte-Devote apex
    [-160, -220], // Beau Rivage climb
    [-55, -260], // Massenet / Casino
    [85, -245], // Mirabeau approach
    [165, -185], // Fairmont Hairpin entry
    [120, -140], // Fairmont apex
    [225, -110], // Portier
    [260, -25], // Tunnel entry
    [235, 75], // Tunnel exit
    [145, 95], // Nouvelle Chicane
    [45, 115], // Tabac approach
    [-25, 155], // Tabac
    [-65, 210], // Swimming Pool entry
    [-115, 225], // Swimming Pool exit
    [-175, 255], // La Rascasse entry
    [-215, 240], // La Rascasse apex
    [-245, 200], // Anthony Noghes
    [-250, 140], // Close loop
  ];

  const roads: OsmRoadWay[] = [
    {
      id: 1001,
      name: 'Circuit de Monaco - Harbor Loop',
      highway: 'raceway',
      lanes: 3,
      widthMeters: 11,
      surface: 'asphalt',
      oneway: true,
      coords: xzPathToLatLon(mainLoopXZ, origin),
    },
    {
      id: 1002,
      name: 'Quai Antoine 1er',
      highway: 'secondary',
      lanes: 2,
      widthMeters: 7.5,
      surface: 'asphalt',
      coords: xzPathToLatLon(
        [
          [-340, 220],
          [-265, 275],
          [-160, 295],
          [-40, 295],
        ],
        origin
      ),
    },
    {
      id: 1003,
      name: 'Avenue Ostende',
      highway: 'primary',
      lanes: 2,
      widthMeters: 8.5,
      surface: 'asphalt',
      coords: xzPathToLatLon(
        [
          [-350, -90],
          [-260, -155],
          [-195, -265],
          [-120, -330],
        ],
        origin
      ),
    },
    {
      id: 1004,
      name: 'Rue Grimaldi',
      highway: 'residential',
      lanes: 2,
      widthMeters: 6,
      surface: 'asphalt',
      coords: xzPathToLatLon(
        [
          [-355, 10],
          [-295, 25],
          [-295, 155],
          [-345, 185],
        ],
        origin
      ),
    },
  ];

  const buildingSpecs: Array<[number, number, number, number, number, number, string]> = [
    [-335, 95, 42, 75, 0.05, 18, 'Pit & Paddock Complex'],
    [-335, -15, 38, 60, 0.02, 16, 'Automobile Club de Monaco'],
    [-315, -125, 45, 40, -0.2, 24, 'Residence Sainte-Devote'],
    [-210, -310, 60, 42, 0.25, 28, 'Hotel Hermitage'],
    [-60, -335, 72, 48, 0.05, 32, 'Casino de Monte-Carlo'],
    [100, -325, 65, 40, -0.15, 26, 'Cafe de Paris'],
    [245, -245, 55, 45, 0.4, 22, 'Fairmont Monte Carlo'],
    [325, -80, 48, 65, 0.1, 20, 'Grimaldi Wing'],
    [325, 45, 45, 70, -0.05, 19, 'Portier Residence'],
    [240, 175, 58, 42, -0.3, 14, 'Yacht Club de Monaco'],
    [75, 30, 50, 34, 0.12, 12, 'Harbor Quay Terminal'],
    [-55, 70, 44, 32, -0.1, 15, 'Piscine Tribune'],
    [-130, 300, 62, 36, 0.08, 17, 'Quai Antoine Building'],
    [-305, 265, 48, 44, 0.3, 21, 'Fort Antoine Terrace'],
  ];

  const buildings: OsmBuilding[] = buildingSpecs.map(
    ([cx, cz, w, d, rot, h, name], idx) => ({
      id: 1100 + idx,
      name,
      heightMeters: h,
      polygon: makeBoxPolygon(cx, cz, w, d, rot, origin),
    })
  );

  const forests: OsmForestArea[] = [
    {
      id: 1201,
      polygon: xzPathToLatLon(
        [
          [-120, -295],
          [-20, -305],
          [30, -280],
          [-35, -275],
        ],
        origin
      ),
    },
    {
      id: 1202,
      polygon: xzPathToLatLon(
        [
          [-390, 240],
          [-320, 290],
          [-260, 340],
          [-375, 340],
        ],
        origin
      ),
    },
  ];

  const barriers: OsmBarrier[] = [
    {
      id: 1301,
      kind: 'guard_rail',
      coords: xzPathToLatLon(
        [
          [-234, 140],
          [-234, -40],
          [-218, -135],
        ],
        origin
      ),
    },
    {
      id: 1302,
      kind: 'wall',
      coords: xzPathToLatLon(
        [
          [242, 85],
          [148, 110],
          [48, 130],
          [-20, 170],
        ],
        origin
      ),
    },
  ];

  return {
    bbox: preset.bbox,
    origin,
    roads,
    buildings,
    forests,
    barriers,
    source: 'preset',
  };
}

function buildStelvioDataset(preset: TrackPreset): OsmDataset {
  const origin: GeoOrigin = {
    lat: preset.center.lat,
    lon: preset.center.lon,
    baseElevation: 2200,
  };

  // Dramatic alpine switchback pass climbing from SE to NW
  const passXZ: [number, number][] = [
    [620, 560],
    [470, 500],
    [330, 440],
    [490, 365],
    [540, 305],
    [360, 245],
    [165, 220],
    [35, 165],
    [220, 105],
    [310, 55],
    [130, -5],
    [-90, -20],
    [-250, -75],
    [-40, -135],
    [70, -185],
    [-140, -245],
    [-355, -260],
    [-490, -320],
    [-290, -380],
    [-210, -430],
    [-420, -490],
    [-640, -540],
  ];

  const roads: OsmRoadWay[] = [
    {
      id: 2001,
      name: 'SS38 Passo dello Stelvio',
      highway: 'secondary',
      lanes: 2,
      widthMeters: 7.5,
      surface: 'asphalt',
      coords: xzPathToLatLon(passXZ, origin),
    },
    {
      id: 2002,
      name: 'Belvedere Rifugio Spur',
      highway: 'unclassified',
      lanes: 1,
      widthMeters: 5,
      surface: 'asphalt',
      coords: xzPathToLatLon(
        [
          [-640, -540],
          [-700, -520],
          [-725, -470],
        ],
        origin
      ),
    },
  ];

  const buildingSpecs: Array<[number, number, number, number, number, number, string]> = [
    [-695, -435, 26, 18, 0.2, 10, 'Rifugio Garibaldi'],
    [-650, -445, 20, 14, -0.1, 9, 'Tibet Hut'],
    [560, 415, 22, 16, 0.35, 9, 'Franzenshohe Chalet'],
    [-290, -190, 18, 14, -0.25, 8, 'Alpine Maintenance Shed'],
    [160, -145, 20, 15, 0.1, 10, 'Pass Overlook Lodge'],
  ];

  const buildings: OsmBuilding[] = buildingSpecs.map(
    ([cx, cz, w, d, rot, h, name], idx) => ({
      id: 2100 + idx,
      name,
      heightMeters: h,
      polygon: makeBoxPolygon(cx, cz, w, d, rot, origin),
    })
  );

  const forests: OsmForestArea[] = [
    {
      id: 2201,
      polygon: xzPathToLatLon(
        [
          [420, 590],
          [720, 590],
          [720, 420],
          [580, 460],
        ],
        origin
      ),
    },
    {
      id: 2202,
      polygon: xzPathToLatLon(
        [
          [-680, 120],
          [-360, 120],
          [-380, 380],
          [-680, 380],
        ],
        origin
      ),
    },
    {
      id: 2203,
      polygon: xzPathToLatLon(
        [
          [260, -480],
          [660, -480],
          [660, -210],
          [290, -240],
        ],
        origin
      ),
    },
  ];

  const barriers: OsmBarrier[] = [
    {
      id: 2301,
      kind: 'wall',
      coords: xzPathToLatLon(
        [
          [510, 375],
          [558, 305],
          [380, 232],
        ],
        origin
      ),
    },
    {
      id: 2302,
      kind: 'guard_rail',
      coords: xzPathToLatLon(
        [
          [-265, -75],
          [-35, -125],
          [85, -185],
        ],
        origin
      ),
    },
  ];

  return {
    bbox: preset.bbox,
    origin,
    roads,
    buildings,
    forests,
    barriers,
    source: 'preset',
  };
}

function buildHakoneDataset(preset: TrackPreset): OsmDataset {
  const origin: GeoOrigin = {
    lat: preset.center.lat,
    lon: preset.center.lon,
    baseElevation: 760,
  };

  // High-speed sweeping mountain touge running SW to NE
  const tougeXZ: [number, number][] = [
    [-780, 560],
    [-620, 470],
    [-460, 360],
    [-340, 210],
    [-210, 125],
    [-55, 145],
    [105, 85],
    [185, -35],
    [155, -175],
    [255, -265],
    [415, -240],
    [545, -315],
    [625, -455],
    [765, -560],
  ];

  const roads: OsmRoadWay[] = [
    {
      id: 3001,
      name: 'Anest Iwata Turnpike Hakone',
      highway: 'primary',
      lanes: 2,
      widthMeters: 9,
      surface: 'asphalt',
      coords: xzPathToLatLon(tougeXZ, origin),
    },
    {
      id: 3002,
      name: 'Taikanzan Sky Lounge Access',
      highway: 'service',
      lanes: 2,
      widthMeters: 6,
      surface: 'asphalt',
      coords: xzPathToLatLon(
        [
          [545, -315],
          [635, -265],
          [690, -210],
          [615, -170],
        ],
        origin
      ),
    },
  ];

  const buildingSpecs: Array<[number, number, number, number, number, number, string]> = [
    [715, -175, 42, 24, -0.35, 11, 'Taikanzan Sky Lounge'],
    [665, -135, 22, 16, -0.35, 8, 'Hakone Toll Booth Office'],
    [-645, 540, 28, 18, 0.45, 9, 'Odawara Gatehouse'],
    [-125, 215, 24, 16, 0.15, 9, 'Mountain Rest Pavilion'],
  ];

  const buildings: OsmBuilding[] = buildingSpecs.map(
    ([cx, cz, w, d, rot, h, name], idx) => ({
      id: 3100 + idx,
      name,
      heightMeters: h,
      polygon: makeBoxPolygon(cx, cz, w, d, rot, origin),
    })
  );

  const forests: OsmForestArea[] = [
    {
      id: 3201,
      polygon: xzPathToLatLon(
        [
          [-820, -560],
          [-120, -560],
          [-120, -40],
          [-820, 120],
        ],
        origin
      ),
    },
    {
      id: 3202,
      polygon: xzPathToLatLon(
        [
          [-320, 380],
          [680, 380],
          [680, 80],
          [-60, 260],
        ],
        origin
      ),
    },
    {
      id: 3203,
      polygon: xzPathToLatLon(
        [
          [260, -580],
          [520, -580],
          [480, -370],
          [240, -370],
        ],
        origin
      ),
    },
  ];

  const barriers: OsmBarrier[] = [
    {
      id: 3301,
      kind: 'guard_rail',
      coords: xzPathToLatLon(
        [
          [-215, 142],
          [-55, 162],
          [115, 102],
          [202, -30],
        ],
        origin
      ),
    },
    {
      id: 3302,
      kind: 'guard_rail',
      coords: xzPathToLatLon(
        [
          [250, -280],
          [415, -255],
          [540, -330],
        ],
        origin
      ),
    },
  ];

  return {
    bbox: preset.bbox,
    origin,
    roads,
    buildings,
    forests,
    barriers,
    source: 'preset',
  };
}

/**
 * Return a rich, realistic offline `OsmDataset` for one of the built-in `TRACK_PRESETS`.
 */
export function getPresetOsmDataset(presetId: string): OsmDataset | null {
  const preset = TRACK_PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;

  switch (preset.id) {
    case 'monaco-harbor':
      return buildMonacoDataset(preset);
    case 'stelvio-pass':
      return buildStelvioDataset(preset);
    case 'hakone-turnpike':
      return buildHakoneDataset(preset);
    default:
      return null;
  }
}
