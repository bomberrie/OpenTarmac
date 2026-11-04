import type { GeneratedTrackScene, TrackGenerationConfig } from '../../types/track.ts';
import { sanitizeSingleLineText, sanitizeSlug } from './sanitize.ts';

interface SurfaceDef {
  key: string;
  friction: number;
  damping: number;
  wav: string;
  wavPitch: number;
  ffEffect: string;
  dirtAdditive: number;
  isValidTrack: 0 | 1;
  blackFlagTime: number;
  sinHeight: number;
  sinLength: number;
  isPitlane: 0 | 1;
  vibrationGain: number;
  vibrationLength: number;
}

const SURFACES: SurfaceDef[] = [
  {
    key: 'ROAD',
    friction: 0.98,
    damping: 0,
    wav: '',
    wavPitch: 0,
    ffEffect: 'NULL',
    dirtAdditive: 0,
    isValidTrack: 1,
    blackFlagTime: 0,
    sinHeight: 0,
    sinLength: 0,
    isPitlane: 0,
    vibrationGain: 0,
    vibrationLength: 0,
  },
  {
    key: 'KERB',
    friction: 0.94,
    damping: 0,
    wav: 'kerb.wav',
    wavPitch: 1.3,
    ffEffect: 'NULL',
    dirtAdditive: 0,
    isValidTrack: 1,
    blackFlagTime: 0,
    sinHeight: 0.02,
    sinLength: 0.5,
    isPitlane: 0,
    vibrationGain: 0.4,
    vibrationLength: 1.2,
  },
  {
    key: 'GRASS',
    friction: 0.62,
    damping: 0.06,
    wav: 'grass.wav',
    wavPitch: 0.9,
    ffEffect: 'NULL',
    dirtAdditive: 0.65,
    isValidTrack: 0,
    blackFlagTime: 0,
    sinHeight: 0.04,
    sinLength: 0.8,
    isPitlane: 0,
    vibrationGain: 0.15,
    vibrationLength: 0.8,
  },
  {
    key: 'WALL',
    friction: 0.5,
    damping: 0.2,
    wav: '',
    wavPitch: 0,
    ffEffect: 'NULL',
    dirtAdditive: 0,
    isValidTrack: 0,
    blackFlagTime: 0,
    sinHeight: 0,
    sinLength: 0,
    isPitlane: 0,
    vibrationGain: 0,
    vibrationLength: 0,
  },
  {
    key: 'GRAVEL',
    friction: 0.6,
    damping: 0.08,
    wav: 'gravel.wav',
    wavPitch: 1.0,
    ffEffect: 'NULL',
    dirtAdditive: 0.85,
    isValidTrack: 0,
    blackFlagTime: 0,
    sinHeight: 0.03,
    sinLength: 0.6,
    isPitlane: 0,
    vibrationGain: 0.25,
    vibrationLength: 0.9,
  },
];

/**
 * Generates Assetto Corsa `data/surfaces.ini` defining physical properties for
 * ROAD, KERB, GRASS, WALL, and GRAVEL surface keys.
 */
export function buildSurfacesIni(): string {
  const sections = SURFACES.map((s, idx) =>
    [
      `[SURFACE_${idx}]`,
      `KEY=${s.key}`,
      `FRICTION=${s.friction}`,
      `DAMPING=${s.damping}`,
      `WAV=${s.wav}`,
      `WAV_PITCH=${s.wavPitch}`,
      `FF_EFFECT=${s.ffEffect}`,
      `DIRT_ADDITIVE=${s.dirtAdditive}`,
      `IS_VALID_TRACK=${s.isValidTrack}`,
      `BLACK_FLAG_TIME=${s.blackFlagTime}`,
      `SIN_HEIGHT=${s.sinHeight}`,
      `SIN_LENGTH=${s.sinLength}`,
      `IS_PITLANE=${s.isPitlane}`,
      `VIBRATION_GAIN=${s.vibrationGain}`,
      `VIBRATION_LENGTH=${s.vibrationLength}`,
    ].join('\n')
  );

  return sections.join('\n\n') + '\n';
}

/**
 * Generates Assetto Corsa `models.ini` pointing to `<trackSlug>.kn5`.
 */
export function buildModelsIni(trackSlug: string): string {
  const safeSlug = sanitizeSlug(trackSlug);
  return [
    '[MODEL_0]',
    `FILE=${safeSlug}.kn5`,
    'POSITION=0,0,0',
    'ROTATION=0,0,0',
    '',
  ].join('\n');
}

/**
 * Generates Assetto Corsa `<trackSlug>.ini` with lighting and groove settings.
 */
export function buildTrackIni(config: TrackGenerationConfig): string {
  const safeName = sanitizeSingleLineText(config.trackName) || 'OpenTarmac Track';
  return [
    '[LIGHTING]',
    'SUN_ANGLE=-35',
    'TIME_MULT=1.0',
    'CLOUD_SPEED=0.2',
    'SPECULAR_MULT=1.0',
    '',
    '[GROOVE]',
    'NAME=GROOVE',
    'MIN=0.1',
    'MAX=0.8',
    'MULT=1.0',
    '',
    '[TRACK]',
    `NAME=${safeName}`,
    `RUN=${config.runMode}`,
    '',
  ].join('\n');
}

/**
 * Generates Assetto Corsa `data/lighting.ini` required for track sun/lighting setup.
 */
export function buildLightingIni(): string {
  return [
    '[LIGHTING]',
    'SUN_ANGLE=-35',
    'TIME_MULT=1.0',
    'CLOUD_SPEED=0.2',
    'SPECULAR_MULT=1.0',
    '',
  ].join('\n');
}

/**
 * Generates Assetto Corsa `data/cameras.ini` with a valid trackside camera overlooking the start area.
 */
export function buildCamerasIni(scene: GeneratedTrackScene): string {
  const startPt = scene.centerline[0]?.position ?? { x: 0, y: 0, z: 0 };
  const camX = (startPt.x + 18).toFixed(2);
  const camY = (startPt.y + 9).toFixed(2);
  const camZ = (startPt.z + 18).toFixed(2);

  return [
    '[HEADER]',
    'VERSION=3',
    'CAMERA_COUNT=1',
    'SET_NAME=MAIN',
    '',
    '[CAMERA_0]',
    'NAME=CAM_0',
    `POSITION=${camX} ,${camY} ,${camZ}`,
    'FORWARD=0 ,-0.2 ,-1',
    'UP=0 ,1 ,0',
    'MIN_FOV=15',
    'MAX_FOV=60',
    'IN_POINT=0',
    'OUT_POINT=1',
    'SHADOW_SPLIT0=1.8',
    'SHADOW_SPLIT1=20',
    'SHADOW_SPLIT2=180',
    'NEAR_PLANE=0.1',
    'FAR_PLANE=10000',
    'MIN_EXPOSURE=0',
    'MAX_EXPOSURE=10000',
    'DOF_FACTOR=0',
    'DOF_RANGE=10000',
    'DOF_FOCUS=0',
    'DOF_MANUAL=0',
    'SPLINE=',
    'SPLINE_ROTATION=0',
    'FOV_GAMMA=0',
    'SPLINE_ANIMATION_LENGTH=15',
    'IS_FIXED=0',
    '',
  ].join('\n');
}

/**
 * Generates Assetto Corsa `data/sections.ini` defining track sectors.
 */
export function buildSectionsIni(scene: GeneratedTrackScene): string {
  const safeName = sanitizeSingleLineText(scene.config.trackName) || 'OpenTarmac Track';
  return [
    '[SECTION_0]',
    'IN=0',
    'OUT=0.33',
    `TEXT=${safeName} - Sector 1`,
    '',
    '[SECTION_1]',
    'IN=0.33',
    'OUT=0.66',
    'TEXT=Sector 2',
    '',
    '[SECTION_2]',
    'IN=0.66',
    'OUT=1',
    'TEXT=Final Sector',
    '',
  ].join('\n');
}

/**
 * Generates Assetto Corsa `data/map.ini` parameters matching `map.png`.
 */
export function buildMapIni(params: {
  width: number;
  height: number;
  margin: number;
  scaleFactor: number;
  xOffset: number;
  zOffset: number;
}): string {
  return [
    '[PARAMETERS]',
    `WIDTH=${Math.round(params.width)}`,
    `HEIGHT=${Math.round(params.height)}`,
    `MARGIN=${Math.round(params.margin)}`,
    `SCALE_FACTOR=${params.scaleFactor.toFixed(4)}`,
    'MAX_SIZE=1600',
    `X_OFFSET=${params.xOffset.toFixed(4)}`,
    `Z_OFFSET=${params.zOffset.toFixed(4)}`,
    'DRAWING_SIZE=10',
    '',
  ].join('\n');
}

/**
 * Generates Assetto Corsa `ui/ui_track.json` metadata consumed by the launcher and Content Manager.
 */
export function buildUiTrackJson(scene: GeneratedTrackScene): string {
  const lengthRounded = Math.round(scene.stats.lengthMeters);
  const elevGain = Math.round(scene.stats.elevationGainMeters);
  const runLabel = scene.config.runMode === 'circuit' ? 'clockwise' : 'point-to-point';
  const safeName = sanitizeSingleLineText(scene.config.trackName) || 'OpenTarmac Track';
  const safeCountry = sanitizeSingleLineText(scene.config.country, 80) || 'Custom';
  const safeCity = sanitizeSingleLineText(scene.config.city, 80) || 'OpenStreetMap';

  const payload = {
    name: safeName,
    description: `${safeName} (${lengthRounded} m, +${elevGain} m elevation gain) generated from real-world OSM & elevation data via OpenTarmac.`,
    tags: [scene.config.runMode, 'road', 'osm', 'opentarmac'],
    geotags: [
      scene.origin.lat.toFixed(5),
      scene.origin.lon.toFixed(5),
    ],
    country: safeCountry,
    city: safeCity,
    length: `${lengthRounded} m`,
    width: `${scene.config.defaultRoadWidth.toFixed(1)} m`,
    pitboxes: String(scene.config.pitBoxCount),
    run: runLabel,
  };

  return JSON.stringify(payload, null, 2) + '\n';
}
