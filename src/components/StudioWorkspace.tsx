import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Info, RefreshCw, X } from 'lucide-react';
import type { CaptureResult } from './ExportModal';
import { HeaderBar, type StudioViewMode } from './HeaderBar';
import { MapSelector } from './MapSelector';
import { SidebarControls } from './SidebarControls';
import { Viewport3D } from './Viewport3D';
import { sanitizeSlug, stripControlChars } from '../core/export';
import {
  bboxCenter,
  createCenteredBbox,
  createFlatElevationGrid,
  createProceduralElevationGrid,
  expandBoundingBoxMeters,
  fetchElevationGrid,
  fetchOsmDataset,
  fetchSatelliteImagery,
  pickDefaultStartRoad,
  searchNominatimLocations,
  traceRouteFromRoad,
  unprojectXZ,
} from '../core/geo';
import { buildTrackScene } from '../core/mesh';
import type {
  BoundingBox,
  ElevationGrid,
  GeneratedTrackScene,
  LatLon,
  MeshLayerKind,
  OsmDataset,
  OsmRoadWay,
  SatelliteImagery,
  SelectionMode,
  TrackGenerationConfig,
  TracedRoute,
} from '../types/track';

const ExportModal = lazy(() =>
  import('./ExportModal').then((m) => ({ default: m.ExportModal })),
);

const CUSTOM_ROAD_ID = -9001;
const TRACED_ROUTE_ID = -9002;

const INITIAL_BBOX: BoundingBox = {
  south: 46.526,
  west: 10.449,
  north: 46.541,
  east: 10.471,
};

function buildPaddedBboxFromPoints(points: LatLon[], minSpanMeters = 800): BoundingBox {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const p of points) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
  }
  const midLat = (south + north) / 2;
  const cosLat = Math.max(0.15, Math.cos((midLat * Math.PI) / 180));
  const padLat = Math.max(200 / 111320, (minSpanMeters / 111320 - (north - south)) / 2);
  const padLon = Math.max(
    200 / (111320 * cosLat),
    (minSpanMeters / (111320 * cosLat) - (east - west)) / 2,
  );
  return {
    south: south - padLat,
    west: west - padLon,
    north: north + padLat,
    east: east + padLon,
  };
}

function pointsInsideBbox(points: LatLon[], bbox: BoundingBox): boolean {
  for (const p of points) {
    if (
      p.lat < bbox.south ||
      p.lat > bbox.north ||
      p.lon < bbox.west ||
      p.lon > bbox.east
    ) {
      return false;
    }
  }
  return true;
}

function anyPointInBbox(points: LatLon[], bbox: BoundingBox): boolean {
  for (const p of points) {
    if (
      p.lat >= bbox.south &&
      p.lat <= bbox.north &&
      p.lon >= bbox.west &&
      p.lon <= bbox.east
    ) {
      return true;
    }
  }
  return false;
}

function bboxContainsBbox(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    inner.south >= outer.south &&
    inner.north <= outer.north &&
    inner.west >= outer.west &&
    inner.east <= outer.east
  );
}

export function StudioWorkspace({
  initialQuery,
  onBackHome,
}: {
  initialQuery?: string;
  onBackHome: () => void;
}) {
  const [dataset, setDataset] = useState<OsmDataset | null>(null);
  const [elevation, setElevation] = useState<ElevationGrid | null>(null);
  const [satellite, setSatellite] = useState<SatelliteImagery | null>(null);
  const [selectedBbox, setSelectedBbox] = useState<BoundingBox>(INITIAL_BBOX);
  const [slugLocked, setSlugLocked] = useState(false);
  const [nameLocked, setNameLocked] = useState(false);

  const [selectionMode, setSelectionMode] = useState<SelectionMode>('route');

  const [startRoadId, setStartRoadId] = useState<number | null>(null);
  const [startCoord, setStartCoord] = useState<LatLon | null>(null);
  const [reverseDirection, setReverseDirection] = useState(false);
  const [followDistanceMeters, setFollowDistanceMeters] = useState(2000);
  const [junctionChoices, setJunctionChoices] = useState<Record<string, string>>({});

  const [isSelectingArea, setIsSelectingArea] = useState(false);
  const [areaHighlightBbox, setAreaHighlightBbox] = useState<BoundingBox | null>(null);

  const [customWaypoints, setCustomWaypoints] = useState<LatLon[]>([]);
  const [isDrawingRoad, setIsDrawingRoad] = useState(false);

  const [config, setConfig] = useState<TrackGenerationConfig>({
    trackName: 'Custom Road Track',
    trackSlug: 'custom_road_track',
    country: 'Custom',
    city: 'OpenStreetMap',
    runMode: 'point-to-point',
    roadWidthMultiplier: 1.0,
    defaultRoadWidth: 9.0,
    roadSmoothing: 0.35,
    elevationScale: 1.0,
    generateKerbs: true,
    generateGuardrails: false,
    generateBuildings: true,
    generateTrees: true,
    pitBoxCount: 12,
    gridSlotCount: 12,
    selectedRoadIds: [],
    freeRoam: false,
    satelliteImagery: true,
  });

  const [viewMode, setViewMode] = useState<StudioViewMode>('split');
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 900 : true,
  );
  const [exportOpen, setExportOpen] = useState(false);

  const [visibleLayers, setVisibleLayers] = useState<Record<MeshLayerKind, boolean>>({
    road: true,
    kerb: true,
    terrain: true,
    wall: true,
    building: true,
    tree: true,
  });
  const [showDummies, setShowDummies] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [flyThrough, setFlyThrough] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);

  const fetchAbortRef = useRef<AbortController | null>(null);
  const captureFnRef = useRef<(() => CaptureResult | Promise<CaptureResult>) | null>(null);
  const didInitFetchRef = useRef(false);

  const handleCancelFetch = useCallback(() => {
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    setIsLoading(false);
  }, []);

  const handleFetchArea = useCallback(
    async (bbox: BoundingBox, nextMode?: SelectionMode, initialNotice?: string) => {
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      setIsLoading(true);
      setFetchError(null);
      setFetchNotice(initialNotice ?? null);

      try {
        const paddedGeoBox = expandBoundingBoxMeters(bbox, 140);
        const [osmResult, elevResult, satResult] = await Promise.allSettled([
          fetchOsmDataset(bbox, { signal: controller.signal }),
          fetchElevationGrid(paddedGeoBox, { zoom: 15, signal: controller.signal }),
          fetchSatelliteImagery(paddedGeoBox, { signal: controller.signal }),
        ]);

        if (controller.signal.aborted) return;

        if (osmResult.status === 'rejected') {
          const reason =
            osmResult.reason instanceof Error
              ? osmResult.reason.message
              : 'OpenStreetMap Overpass request failed.';
          setFetchError(
            `Could not fetch OSM road data (${reason}). Pan to another area or click Retry.`,
          );
          return;
        }

        const nextDataset = osmResult.value;
        const notices: string[] = initialNotice ? [initialNotice] : [];
        let nextElevation: ElevationGrid;
        if (elevResult.status === 'fulfilled') {
          nextElevation = elevResult.value;
        } else {
          nextElevation = createFlatElevationGrid(
            nextDataset.bbox,
            nextDataset.origin.baseElevation,
          );
          notices.push('Terrain elevation tiles unavailable — using flat elevation fallback.');
        }

        const nextSatellite =
          satResult.status === 'fulfilled' ? satResult.value : null;
        if (!nextSatellite) {
          notices.push('Satellite aerial imagery unavailable — using procedural terrain textures.');
        }

        setDataset(nextDataset);
        setElevation(nextElevation);
        setSatellite(nextSatellite);
        setSelectedBbox(nextDataset.bbox);

        if (nextMode === 'area') {
          setSelectionMode('area');
          setAreaHighlightBbox(nextDataset.bbox);
          setConfig((prev) => (prev.freeRoam ? prev : { ...prev, freeRoam: true }));
        }

        if (nextDataset.roads.length > 0) {
          const defaultRoad = pickDefaultStartRoad(nextDataset.roads, nextDataset.origin);
          if (defaultRoad) {
            setStartRoadId(defaultRoad.id);
            setStartCoord(defaultRoad.coords[0]);
            setReverseDirection(false);
            setJunctionChoices({});
            if (!nameLocked && defaultRoad.name) {
              const safeRoadName = stripControlChars(defaultRoad.name);
              setConfig((prev) => ({
                ...prev,
                trackName: safeRoadName,
                trackSlug: slugLocked ? prev.trackSlug : sanitizeSlug(safeRoadName, 'opentarmac_track'),
              }));
            }
          }
        } else {
          setStartRoadId(null);
          setStartCoord(null);
          setJunctionChoices({});
          if (customWaypoints.length < 2) {
            notices.push(
              'No drivable roads found inside this box. Expand the box, move the map, or use Draw Road.',
            );
          }
        }

        if (notices.length > 0) {
          setFetchNotice(notices.join(' '));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [customWaypoints.length, nameLocked, slugLocked],
  );

  useEffect(() => {
    if (didInitFetchRef.current) return;
    didInitFetchRef.current = true;

    const query = initialQuery?.trim();
    if (!query) {
      void handleFetchArea(INITIAL_BBOX);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const list = await searchNominatimLocations(query, {
          limit: 1,
          timeoutMs: 10000,
          signal: controller.signal,
        });
        if (!cancelled && list.length > 0) {
          const targetBox = createCenteredBbox(list[0].lat, list[0].lon, 1800);
          setSelectedBbox(targetBox);
          void handleFetchArea(targetBox);
          return;
        }
        if (!cancelled) {
          void handleFetchArea(
            INITIAL_BBOX,
            undefined,
            `No location found for "${stripControlChars(query, 60)}" — loaded Stelvio Pass instead.`,
          );
        }
      } catch (err) {
        if (!cancelled && (err as Error).name !== 'AbortError') {
          const msg = err instanceof Error ? err.message : 'Location search failed.';
          void handleFetchArea(
            INITIAL_BBOX,
            undefined,
            `Could not look up "${stripControlChars(query, 60)}" (${msg}) — loaded Stelvio Pass instead.`,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deferredConfig = useDeferredValue(config);

  const areaSelectedRoads = useMemo<OsmRoadWay[]>(() => {
    if (selectionMode !== 'area' || !dataset) return [];
    if (!areaHighlightBbox) return dataset.roads;
    return dataset.roads.filter((r) => anyPointInBbox(r.coords, areaHighlightBbox));
  }, [selectionMode, dataset, areaHighlightBbox]);

  const areaSelectedRoadIds = useMemo(
    () => areaSelectedRoads.map((r) => r.id),
    [areaSelectedRoads],
  );

  const tracedRoute = useMemo<TracedRoute | null>(() => {
    if (selectionMode !== 'route' || customWaypoints.length >= 2) return null;
    if (!dataset || dataset.roads.length === 0 || startRoadId === null) return null;
    return traceRouteFromRoad(dataset.roads, dataset.origin, {
      startRoadId,
      startCoord: startCoord ?? undefined,
      reverseDirection,
      maxDistanceMeters: followDistanceMeters,
      junctionChoices,
    });
  }, [
    selectionMode,
    customWaypoints.length,
    dataset,
    startRoadId,
    startCoord,
    reverseDirection,
    followDistanceMeters,
    junctionChoices,
  ]);

  const { effectiveDataset, effectiveElevation, effectiveConfig } = useMemo(() => {
    if (selectionMode === 'draw' && customWaypoints.length >= 2) {
      const customRoad: OsmRoadWay = {
        id: CUSTOM_ROAD_ID,
        name: 'Custom Drawn Road',
        highway: 'raceway',
        widthMeters: deferredConfig.defaultRoadWidth,
        coords: customWaypoints,
      };

      const fitsCurrent =
        dataset !== null &&
        elevation !== null &&
        pointsInsideBbox(customWaypoints, dataset.bbox);

      if (fitsCurrent && dataset && elevation) {
        const drawBbox = buildPaddedBboxFromPoints(customWaypoints, 700);
        const center = bboxCenter(drawBbox);
        return {
          effectiveDataset: {
            ...dataset,
            bbox: drawBbox,
            origin: {
              lat: center.lat,
              lon: center.lon,
              baseElevation: dataset.origin.baseElevation,
            },
            roads: [customRoad],
            buildings: dataset.buildings.filter((b) => anyPointInBbox(b.polygon, drawBbox)),
            forests: dataset.forests.filter((f) => anyPointInBbox(f.polygon, drawBbox)),
            barriers: [],
          },
          effectiveElevation: elevation,
          effectiveConfig: { ...deferredConfig, selectedRoadIds: [CUSTOM_ROAD_ID] },
        };
      }

      const customBbox = buildPaddedBboxFromPoints(customWaypoints, 900);
      const center = bboxCenter(customBbox);
      const baseElev = dataset?.origin.baseElevation ?? 120;
      const nextDs: OsmDataset = {
        bbox: customBbox,
        origin: { lat: center.lat, lon: center.lon, baseElevation: baseElev },
        roads: [customRoad],
        buildings: [],
        forests: [],
        barriers: [],
        source: 'overpass',
      };
      return {
        effectiveDataset: nextDs,
        effectiveElevation: createProceduralElevationGrid(customBbox, baseElev, 32),
        effectiveConfig: { ...deferredConfig, selectedRoadIds: [CUSTOM_ROAD_ID] },
      };
    }

    if (selectionMode === 'area' && dataset && elevation) {
      const box = areaHighlightBbox ?? dataset.bbox;
      const roadsInArea = areaSelectedRoads.length > 0 ? areaSelectedRoads : dataset.roads;
      const areaBbox: BoundingBox = { ...box };
      for (const r of roadsInArea) {
        for (const c of r.coords) {
          if (c.lat < areaBbox.south) areaBbox.south = c.lat;
          if (c.lat > areaBbox.north) areaBbox.north = c.lat;
          if (c.lon < areaBbox.west) areaBbox.west = c.lon;
          if (c.lon > areaBbox.east) areaBbox.east = c.lon;
        }
      }
      const center = bboxCenter(areaBbox);
      const buildingsInArea = dataset.buildings.filter((b) =>
        anyPointInBbox(b.polygon, box),
      );
      const forestsInArea = dataset.forests.filter((f) =>
        anyPointInBbox(f.polygon, box),
      );
      const barriersInArea = dataset.barriers.filter((b) =>
        anyPointInBbox(b.coords, box),
      );

      const areaPrimaryIds =
        startRoadId !== null && roadsInArea.some((r) => r.id === startRoadId)
          ? [startRoadId]
          : [];

      return {
        effectiveDataset: {
          ...dataset,
          bbox: areaBbox,
          origin: {
            lat: center.lat,
            lon: center.lon,
            baseElevation: dataset.origin.baseElevation,
          },
          roads: roadsInArea,
          buildings: buildingsInArea,
          forests: forestsInArea,
          barriers: barriersInArea,
        },
        effectiveElevation: elevation,
        effectiveConfig: {
          ...deferredConfig,
          selectedRoadIds: areaPrimaryIds,
          freeRoam: deferredConfig.freeRoam ?? true,
        },
      };
    }

    if (tracedRoute && dataset && elevation) {
      const tracedWay: OsmRoadWay = {
        id: TRACED_ROUTE_ID,
        name: 'Traced Route',
        highway: 'raceway',
        widthMeters: tracedRoute.averageWidthMeters ?? deferredConfig.defaultRoadWidth,
        coords: tracedRoute.coords,
      };
      const routeBbox = buildPaddedBboxFromPoints(tracedWay.coords, 700);
      const center = bboxCenter(routeBbox);
      return {
        effectiveDataset: {
          ...dataset,
          bbox: routeBbox,
          origin: {
            lat: center.lat,
            lon: center.lon,
            baseElevation: dataset.origin.baseElevation,
          },
          roads: [tracedWay],
          buildings: dataset.buildings.filter((b) => anyPointInBbox(b.polygon, routeBbox)),
          forests: dataset.forests.filter((f) => anyPointInBbox(f.polygon, routeBbox)),
          barriers: dataset.barriers.filter((b) => anyPointInBbox(b.coords, routeBbox)),
        },
        effectiveElevation: elevation,
        effectiveConfig: { ...deferredConfig, selectedRoadIds: [TRACED_ROUTE_ID] },
      };
    }

    return {
      effectiveDataset: dataset,
      effectiveElevation: elevation,
      effectiveConfig: deferredConfig,
    };
  }, [
    selectionMode,
    customWaypoints,
    areaHighlightBbox,
    areaSelectedRoads,
    startRoadId,
    tracedRoute,
    dataset,
    elevation,
    deferredConfig,
  ]);

  const { scene, sceneBuildError } = useMemo<{
    scene: GeneratedTrackScene | null;
    sceneBuildError: string | null;
  }>(() => {
    if (!effectiveDataset || !effectiveElevation || effectiveDataset.roads.length === 0) {
      return { scene: null, sceneBuildError: null };
    }
    try {
      return {
        scene: buildTrackScene(
          effectiveDataset,
          effectiveElevation,
          effectiveConfig,
          satellite,
        ),
        sceneBuildError: null,
      };
    } catch (err) {
      return {
        scene: null,
        sceneBuildError:
          err instanceof Error ? err.message : 'Failed to generate 3D track geometry.',
      };
    }
  }, [effectiveDataset, effectiveElevation, effectiveConfig, satellite]);

  const handleTrackNameChange = useCallback(
    (name: string) => {
      setNameLocked(true);
      const safeName = stripControlChars(name, 120);
      setConfig((prev) => ({
        ...prev,
        trackName: safeName,
        trackSlug: slugLocked ? prev.trackSlug : sanitizeSlug(safeName, 'opentarmac_track'),
      }));
    },
    [slugLocked],
  );

  const handleSlugChange = useCallback((rawSlug: string) => {
    setSlugLocked(true);
    const cleaned = rawSlug
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+/, '');
    setConfig((prev) => ({
      ...prev,
      trackSlug: cleaned,
    }));
  }, []);

  const handleToggleLayer = useCallback((layer: MeshLayerKind) => {
    setVisibleLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  const handleSelectRoadAtPoint = useCallback(
    (roadId: number, clickCoord: LatLon) => {
      setSelectionMode('route');
      setIsDrawingRoad(false);
      setIsSelectingArea(false);
      setCustomWaypoints([]);
      setStartRoadId(roadId);
      setStartCoord(clickCoord);
      setReverseDirection(false);
      setJunctionChoices({});
      setConfig((prev) => {
        const pickedName = dataset?.roads.find((r) => r.id === roadId)?.name;
        const safePickedName = pickedName ? stripControlChars(pickedName, 120) : '';
        return {
          ...prev,
          freeRoam: false,
          ...(safePickedName && !nameLocked
            ? {
                trackName: safePickedName,
                trackSlug: slugLocked
                  ? prev.trackSlug
                  : sanitizeSlug(safePickedName, 'opentarmac_track'),
              }
            : {}),
        };
      });
    },
    [dataset, nameLocked, slugLocked],
  );

  const handleSelectJunctionOption = useCallback((junctionKey: string, optionKey: string) => {
    setJunctionChoices((prev) => ({
      ...prev,
      [junctionKey]: optionKey,
    }));
  }, []);

  const handleFlipDirection = useCallback(() => {
    setReverseDirection((prev) => !prev);
    setJunctionChoices({});
  }, []);

  const handleToggleSelectingArea = useCallback(() => {
    setIsSelectingArea((prev) => {
      const next = !prev;
      if (next) {
        setIsDrawingRoad(false);
        if (viewMode === '3d') setViewMode('split');
      }
      return next;
    });
  }, [viewMode]);

  const handleCompleteAreaHighlight = useCallback(
    (box: BoundingBox) => {
      setIsSelectingArea(false);
      setSelectionMode('area');
      setAreaHighlightBbox(box);
      setConfig((prev) => (prev.freeRoam ? prev : { ...prev, freeRoam: true }));

      const hasDatasetCoverage =
        dataset !== null && bboxContainsBbox(dataset.bbox, box);

      if (!hasDatasetCoverage) {
        setSelectedBbox(box);
        void handleFetchArea(box, 'area');
      }
    },
    [dataset, handleFetchArea],
  );

  const handleSelectAllLoadedRoads = useCallback(() => {
    setIsSelectingArea(false);
    setIsDrawingRoad(false);
    setSelectionMode('area');
    setAreaHighlightBbox(dataset?.bbox ?? selectedBbox);
    setConfig((prev) => (prev.freeRoam ? prev : { ...prev, freeRoam: true }));
  }, [dataset, selectedBbox]);

  const handleClearAreaHighlight = useCallback(() => {
    setIsSelectingArea(false);
    setAreaHighlightBbox(null);
    setSelectionMode('route');
    setConfig((prev) => (!prev.freeRoam ? prev : { ...prev, freeRoam: false }));
  }, []);

  const handleToggleDrawingRoad = useCallback(() => {
    setIsDrawingRoad((prev) => {
      const next = !prev;
      if (next) {
        setIsSelectingArea(false);
        setSelectionMode('draw');
        if (viewMode === '3d') {
          setViewMode('split');
        }
      }
      return next;
    });
  }, [viewMode]);

  const handleAddCustomWaypoint = useCallback((pt: LatLon) => {
    setSelectionMode('draw');
    setCustomWaypoints((prev) => {
      const next = [...prev, pt];
      if (next.length >= 2) {
        setSelectedBbox(buildPaddedBboxFromPoints(next, 900));
      }
      return next;
    });
    setConfig((prev) =>
      prev.runMode === 'point-to-point' ? prev : { ...prev, runMode: 'point-to-point' },
    );
  }, []);

  const handleUndoCustomWaypoint = useCallback(() => {
    setCustomWaypoints((prev) => prev.slice(0, -1));
  }, []);

  const handleClearCustomWaypoints = useCallback(() => {
    setCustomWaypoints([]);
    setIsDrawingRoad(false);
    setSelectionMode('route');
  }, []);

  const handleCaptureViewport = useCallback(async (): Promise<CaptureResult> => {
    if (!captureFnRef.current) return {};
    return await captureFnRef.current();
  }, []);

  const handleBindCaptureRef = useCallback(
    (fn: (() => CaptureResult | Promise<CaptureResult>) | null) => {
      captureFnRef.current = fn;
    },
    [],
  );

  const areaStartEnd = useMemo<{ start: LatLon; end: LatLon } | null>(() => {
    if (selectionMode !== 'area' || !scene || scene.centerline.length < 2) {
      return null;
    }
    const first = scene.centerline[0].position;
    const last = scene.centerline[scene.centerline.length - 1].position;
    return {
      start: unprojectXZ(first.x, first.z, scene.origin),
      end: unprojectXZ(last.x, last.z, scene.origin),
    };
  }, [selectionMode, scene]);

  const selectedStartRoad = useMemo(
    () => dataset?.roads.find((r) => r.id === startRoadId) ?? null,
    [dataset, startRoadId],
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0b0d10] text-zinc-100 flex flex-col">
      <HeaderBar
        trackName={config.trackName}
        onTrackNameChange={handleTrackNameChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        scene={scene}
        datasetSource={dataset?.source ?? null}
        isLoading={isLoading}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        onOpenExport={() => setExportOpen(true)}
        onBackHome={onBackHome}
      />

      {(fetchError || sceneBuildError || fetchNotice) && (
        <div
          className={`shrink-0 px-4 py-2 border-b flex items-center justify-between gap-3 text-xs ${
            fetchError || sceneBuildError
              ? 'bg-red-950/55 border-red-800/60 text-red-100'
              : 'bg-amber-950/45 border-amber-800/50 text-amber-100'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {fetchError || sceneBuildError ? (
              <AlertTriangle className="w-4 h-4 text-[#e53935] shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span className="truncate">{fetchError ?? sceneBuildError ?? fetchNotice}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {fetchError && (
              <button
                type="button"
                onClick={() => void handleFetchArea(selectedBbox)}
                className="studio-press flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#141820] hover:bg-[#1b202b] border border-white/[0.1] text-xs font-medium text-zinc-100"
              >
                <RefreshCw className="w-3 h-3 text-emerald-400" />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setFetchError(null);
                setFetchNotice(null);
              }}
              aria-label="Dismiss banner"
              className="studio-press p-1 rounded hover:bg-white/[0.08] text-zinc-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="relative flex-1 min-h-0 flex overflow-hidden">
        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 top-12 bg-black/50 backdrop-blur-[1px] z-[1150] md:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 top-12 left-0 z-[1200] md:static md:inset-auto md:z-auto flex">
              <SidebarControls
                config={config}
                onChangeConfig={setConfig}
                onTrackNameChange={handleTrackNameChange}
                onSlugChange={handleSlugChange}
                visibleLayers={visibleLayers}
                onToggleLayer={handleToggleLayer}
                showDummies={showDummies}
                onToggleShowDummies={() => setShowDummies((prev) => !prev)}
                wireframe={wireframe}
                onToggleWireframe={() => setWireframe((prev) => !prev)}
                flyThrough={flyThrough}
                onToggleFlyThrough={() => setFlyThrough((prev) => !prev)}
                scene={scene}
                selectionMode={selectionMode}
                followDistanceMeters={followDistanceMeters}
                onChangeFollowDistance={setFollowDistanceMeters}
                reverseDirection={reverseDirection}
                onFlipDirection={handleFlipDirection}
                startRoadName={
                  selectedStartRoad?.name ||
                  (selectedStartRoad ? `${selectedStartRoad.highway} #${selectedStartRoad.id}` : null)
                }
                tracedRoute={tracedRoute}
                onSelectJunctionOption={handleSelectJunctionOption}
                areaSelectedCount={areaSelectedRoads.length}
                totalLoadedRoadCount={dataset?.roads.length ?? 0}
                isSelectingArea={isSelectingArea}
                onToggleSelectingArea={handleToggleSelectingArea}
                onSelectAllLoadedRoads={handleSelectAllLoadedRoads}
                onClearAreaHighlight={handleClearAreaHighlight}
                isDrawingRoad={isDrawingRoad}
                customWaypointCount={customWaypoints.length}
                onStartDrawingRoad={handleToggleDrawingRoad}
                onUndoCustomWaypoint={handleUndoCustomWaypoint}
                onClearCustomWaypoints={handleClearCustomWaypoints}
              />
            </div>
          </>
        )}

        <main className="flex-1 min-w-0 h-full flex flex-col lg:flex-row overflow-hidden">
          <div
            className={`min-w-0 min-h-0 flex flex-col ${
              viewMode === 'split'
                ? 'h-1/2 lg:h-full lg:w-1/2 border-b lg:border-b-0 lg:border-r border-white/[0.08]'
                : viewMode === 'map'
                  ? 'h-full w-full'
                  : 'hidden'
            }`}
          >
            <MapSelector
              dataset={dataset}
              selectedBbox={selectedBbox}
              onSelectedBboxChange={setSelectedBbox}
              selectionMode={selectionMode}
              tracedRoute={tracedRoute}
              areaStartEnd={areaStartEnd}
              areaSelectedRoadIds={areaSelectedRoadIds}
              areaHighlightBbox={areaHighlightBbox}
              isSelectingArea={isSelectingArea}
              onToggleSelectingArea={handleToggleSelectingArea}
              onCompleteAreaHighlight={handleCompleteAreaHighlight}
              onSelectAllLoadedRoads={handleSelectAllLoadedRoads}
              onClearAreaHighlight={handleClearAreaHighlight}
              onSelectRoadAtPoint={handleSelectRoadAtPoint}
              onSelectJunctionOption={handleSelectJunctionOption}
              onFlipDirection={handleFlipDirection}
              onFetchArea={(bbox) =>
                void handleFetchArea(bbox, selectionMode === 'area' ? 'area' : undefined)
              }
              onCancelFetch={handleCancelFetch}
              isLoading={isLoading}
              isDrawingRoad={isDrawingRoad}
              onToggleDrawingRoad={handleToggleDrawingRoad}
              customWaypoints={customWaypoints}
              onAddCustomWaypoint={handleAddCustomWaypoint}
              onUndoCustomWaypoint={handleUndoCustomWaypoint}
              onClearCustomWaypoints={handleClearCustomWaypoints}
            />
          </div>

          <div
            className={`min-w-0 min-h-0 flex flex-col relative bg-[#0b0d10] ${
              viewMode === 'split'
                ? 'h-1/2 lg:h-full lg:w-1/2'
                : viewMode === '3d'
                  ? 'h-full w-full'
                  : 'hidden'
            }`}
          >
            <Viewport3D
              scene={scene}
              visibleLayers={visibleLayers}
              showDummies={showDummies}
              wireframe={wireframe}
              flyThrough={flyThrough}
              onCaptureRef={handleBindCaptureRef}
            />
          </div>
        </main>
      </div>

      {exportOpen && (
        <Suspense fallback={null}>
          <ExportModal
            isOpen={exportOpen}
            onClose={() => setExportOpen(false)}
            scene={scene}
            onCaptureViewport={handleCaptureViewport}
          />
        </Suspense>
      )}
    </div>
  );
}
