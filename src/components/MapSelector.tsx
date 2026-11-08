import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import L from 'leaflet';
import {
  ArrowLeftRight,
  Check,
  Crosshair,
  DownloadCloud,
  Globe,
  Loader2,
  Map as MapIcon,
  PenTool,
  Scan,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { SelectionMode } from '../types/track';
import {
  bboxDimensionsMeters,
  createCenteredBbox,
  searchNominatimLocations,
  type NominatimLocation,
} from '../core/geo';
import type { BoundingBox, LatLon, OsmDataset, TracedRoute } from '../types/track';

type BaseLayerKind = 'osm' | 'satellite';
type BoxSizeOption = '600' | '1200' | '2000' | '5000' | '10000' | 'fit';

interface MapSelectorProps {
  dataset: OsmDataset | null;
  selectedBbox: BoundingBox;
  onSelectedBboxChange: (bbox: BoundingBox) => void;
  selectionMode: SelectionMode;
  tracedRoute: TracedRoute | null;
  areaStartEnd: { start: LatLon; end: LatLon } | null;
  areaSelectedRoadIds: number[];
  areaHighlightBbox: BoundingBox | null;
  isSelectingArea: boolean;
  onToggleSelectingArea: () => void;
  onCompleteAreaHighlight: (bbox: BoundingBox) => void;
  onSelectAllLoadedRoads: () => void;
  onClearAreaHighlight: () => void;
  onSelectRoadAtPoint: (roadId: number, clickCoord: LatLon) => void;
  onSelectJunctionOption: (junctionKey: string, optionKey: string) => void;
  onFlipDirection: () => void;
  onFetchArea: (bbox: BoundingBox) => void;
  onCancelFetch: () => void;
  isLoading: boolean;
  isDrawingRoad: boolean;
  onToggleDrawingRoad: () => void;
  customWaypoints: LatLon[];
  onAddCustomWaypoint: (pt: LatLon) => void;
  onUndoCustomWaypoint: () => void;
  onClearCustomWaypoints: () => void;
}

const TILE_URLS: Record<BaseLayerKind, { url: string; attribution: string; maxZoom: number }> = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
};

function createTooltipElement(title: string, subtitle: string, subtitleOpacity = '0.75'): HTMLElement {
  const container = document.createElement('div');
  container.style.fontSize = '11px';
  container.style.lineHeight = '1.3';

  const strong = document.createElement('strong');
  strong.textContent = title;
  container.appendChild(strong);
  container.appendChild(document.createElement('br'));

  const sub = document.createElement('span');
  sub.style.opacity = subtitleOpacity;
  sub.textContent = subtitle;
  container.appendChild(sub);

  return container;
}

function bboxCenterLatLon(bbox: BoundingBox): [number, number] {
  return [(bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2];
}

export function MapSelector({
  dataset,
  selectedBbox,
  onSelectedBboxChange,
  selectionMode,
  tracedRoute,
  areaStartEnd,
  areaSelectedRoadIds,
  areaHighlightBbox,
  isSelectingArea,
  onToggleSelectingArea,
  onCompleteAreaHighlight,
  onSelectAllLoadedRoads,
  onClearAreaHighlight,
  onSelectRoadAtPoint,
  onSelectJunctionOption,
  onFlipDirection,
  onFetchArea,
  onCancelFetch,
  isLoading,
  isDrawingRoad,
  onToggleDrawingRoad,
  customWaypoints,
  onAddCustomWaypoint,
  onUndoCustomWaypoint,
  onClearCustomWaypoints,
}: MapSelectorProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const selectionRectRef = useRef<L.Rectangle | null>(null);
  const datasetRectRef = useRef<L.Rectangle | null>(null);
  const areaHighlightRectRef = useRef<L.Rectangle | null>(null);
  const dragPreviewRectRef = useRef<L.Rectangle | null>(null);
  const roadsGroupRef = useRef<L.LayerGroup | null>(null);
  const routeGroupRef = useRef<L.LayerGroup | null>(null);
  const customGroupRef = useRef<L.LayerGroup | null>(null);
  const searchMarkerRef = useRef<L.CircleMarker | null>(null);

  const [baseLayer, setBaseLayer] = useState<BaseLayerKind>('osm');
  const [boxSize, setBoxSize] = useState<BoxSizeOption>('2000');
  const [followCenter, setFollowCenter] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimLocation[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const followCenterRef = useRef(followCenter);
  followCenterRef.current = followCenter;
  const boxSizeRef = useRef(boxSize);
  boxSizeRef.current = boxSize;
  const onSelectedBboxChangeRef = useRef(onSelectedBboxChange);
  onSelectedBboxChangeRef.current = onSelectedBboxChange;
  const onSelectRoadAtPointRef = useRef(onSelectRoadAtPoint);
  onSelectRoadAtPointRef.current = onSelectRoadAtPoint;
  const onSelectJunctionOptionRef = useRef(onSelectJunctionOption);
  onSelectJunctionOptionRef.current = onSelectJunctionOption;
  const isDrawingRoadRef = useRef(isDrawingRoad);
  isDrawingRoadRef.current = isDrawingRoad;
  const onAddCustomWaypointRef = useRef(onAddCustomWaypoint);
  onAddCustomWaypointRef.current = onAddCustomWaypoint;
  const isSelectingAreaRef = useRef(isSelectingArea);
  isSelectingAreaRef.current = isSelectingArea;
  const onCompleteAreaHighlightRef = useRef(onCompleteAreaHighlight);
  onCompleteAreaHighlightRef.current = onCompleteAreaHighlight;
  const dragStartRef = useRef<L.LatLng | null>(null);

  const computeBoxFromMap = useCallback((map: L.Map, mode: BoxSizeOption): BoundingBox => {
    if (mode === 'fit') {
      const b = map.getBounds();
      return {
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      };
    }
    const center = map.getCenter();
    return createCenteredBbox(center.lat, center.lng, Number(mode));
  }, []);

  // Initialize Leaflet map once
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el || mapRef.current) return;

    const [initLat, initLon] = bboxCenterLatLon(selectedBbox);
    const map = L.map(el, {
      center: [initLat, initLon],
      zoom: 14,
      zoomControl: true,
      preferCanvas: true,
    });

    const tileCfg = TILE_URLS.osm;
    const tileLayer = L.tileLayer(tileCfg.url, {
      attribution: tileCfg.attribution,
      maxZoom: tileCfg.maxZoom,
    }).addTo(map);

    const datasetRect = L.rectangle(
      [
        [selectedBbox.south, selectedBbox.west],
        [selectedBbox.north, selectedBbox.east],
      ],
      {
        color: '#3f3f46',
        weight: 1.5,
        dashArray: '4 4',
        fillOpacity: 0.02,
        interactive: false,
      },
    ).addTo(map);

    const selectionRect = L.rectangle(
      [
        [selectedBbox.south, selectedBbox.west],
        [selectedBbox.north, selectedBbox.east],
      ],
      {
        color: '#f59e0b',
        weight: 2,
        dashArray: '6 4',
        fillColor: '#f59e0b',
        fillOpacity: 0.05,
        interactive: false,
      },
    ).addTo(map);

    const roadsGroup = L.layerGroup().addTo(map);
    const routeGroup = L.layerGroup().addTo(map);
    const customGroup = L.layerGroup().addTo(map);

    const handleMoveEnd = () => {
      if (!followCenterRef.current) return;
      const next = computeBoxFromMap(map, boxSizeRef.current);
      onSelectedBboxChangeRef.current(next);
    };

    const handleMapClick = (ev: L.LeafletMouseEvent) => {
      if (!isDrawingRoadRef.current) return;
      onAddCustomWaypointRef.current({ lat: ev.latlng.lat, lon: ev.latlng.lng });
    };

    const handleMouseDown = (ev: L.LeafletMouseEvent) => {
      if (!isSelectingAreaRef.current) return;
      dragStartRef.current = ev.latlng;
      if (dragPreviewRectRef.current) {
        map.removeLayer(dragPreviewRectRef.current);
        dragPreviewRectRef.current = null;
      }
      dragPreviewRectRef.current = L.rectangle(L.latLngBounds(ev.latlng, ev.latlng), {
        color: '#ef4444',
        weight: 2.5,
        fillColor: '#ef4444',
        fillOpacity: 0.14,
        interactive: false,
      }).addTo(map);
    };

    const handleMouseMove = (ev: L.LeafletMouseEvent) => {
      if (!isSelectingAreaRef.current || !dragStartRef.current || !dragPreviewRectRef.current) {
        return;
      }
      dragPreviewRectRef.current.setBounds(L.latLngBounds(dragStartRef.current, ev.latlng));
    };

    const handleMouseUp = (ev: L.LeafletMouseEvent) => {
      if (!isSelectingAreaRef.current || !dragStartRef.current) return;
      const start = dragStartRef.current;
      dragStartRef.current = null;
      if (dragPreviewRectRef.current) {
        map.removeLayer(dragPreviewRectRef.current);
        dragPreviewRectRef.current = null;
      }

      const bounds = L.latLngBounds(start, ev.latlng);
      const south = bounds.getSouth();
      const north = bounds.getNorth();
      const west = bounds.getWest();
      const east = bounds.getEast();

      // Ignore tiny accidental clicks (< ~25m)
      if ((north - south) * 111320 < 25 && (east - west) * 80000 < 25) {
        return;
      }

      onCompleteAreaHighlightRef.current({ south, west, north, east });
    };

    map.on('moveend', handleMoveEnd);
    map.on('click', handleMapClick);
    map.on('mousedown', handleMouseDown);
    map.on('mousemove', handleMouseMove);
    map.on('mouseup', handleMouseUp);

    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    selectionRectRef.current = selectionRect;
    datasetRectRef.current = datasetRect;
    roadsGroupRef.current = roadsGroup;
    routeGroupRef.current = routeGroup;
    customGroupRef.current = customGroup;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      map.off('moveend', handleMoveEnd);
      map.off('click', handleMapClick);
      map.off('mousedown', handleMouseDown);
      map.off('mousemove', handleMouseMove);
      map.off('mouseup', handleMouseUp);
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      selectionRectRef.current = null;
      datasetRectRef.current = null;
      areaHighlightRectRef.current = null;
      dragPreviewRectRef.current = null;
      roadsGroupRef.current = null;
      routeGroupRef.current = null;
      customGroupRef.current = null;
      searchMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch OSM / Satellite tiles
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const cfg = TILE_URLS[baseLayer];
    const nextLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    }).addTo(map);
    nextLayer.bringToBack();
    tileLayerRef.current = nextLayer;
  }, [baseLayer]);

  // Update selection rectangle on bbox change
  useEffect(() => {
    const rect = selectionRectRef.current;
    if (!rect) return;
    rect.setBounds([
      [selectedBbox.south, selectedBbox.west],
      [selectedBbox.north, selectedBbox.east],
    ]);
  }, [selectedBbox]);

  // Render active highlighted area rectangle when in 'area' mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (areaHighlightRectRef.current) {
      map.removeLayer(areaHighlightRectRef.current);
      areaHighlightRectRef.current = null;
    }

    if (selectionMode === 'area' && areaHighlightBbox) {
      areaHighlightRectRef.current = L.rectangle(
        [
          [areaHighlightBbox.south, areaHighlightBbox.west],
          [areaHighlightBbox.north, areaHighlightBbox.east],
        ],
        {
          color: '#ef4444',
          weight: 2.5,
          fillColor: '#ef4444',
          fillOpacity: 0.1,
          interactive: false,
        },
      ).addTo(map);
    }
  }, [selectionMode, areaHighlightBbox]);

  // Cursor, dragging & double-click zoom toggles for Draw / Highlight Area tools
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    container.style.cursor = isDrawingRoad || isSelectingArea ? 'crosshair' : '';
    if (isDrawingRoad) {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
    if (isSelectingArea) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [isDrawingRoad, isSelectingArea]);

  // Fit map when dataset bbox changes
  const datasetBboxKey = dataset
    ? `${dataset.bbox.south.toFixed(6)},${dataset.bbox.west.toFixed(6)},${dataset.bbox.north.toFixed(6)},${dataset.bbox.east.toFixed(6)}`
    : '';
  useEffect(() => {
    const map = mapRef.current;
    const dRect = datasetRectRef.current;
    if (!map || !dRect || !dataset) return;

    const bounds: L.LatLngBoundsExpression = [
      [dataset.bbox.south, dataset.bbox.west],
      [dataset.bbox.north, dataset.bbox.east],
    ];
    dRect.setBounds(bounds);
    if (!isDrawingRoadRef.current && !isSelectingAreaRef.current) {
      setFollowCenter(false);
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetBboxKey]);

  // Render clickable OSM road polylines (highlighting all areaSelectedRoadIds in 'area' mode)
  useEffect(() => {
    const group = roadsGroupRef.current;
    if (!group) return;
    group.clearLayers();
    if (!dataset) return;

    const areaSet = new Set(selectionMode === 'area' ? areaSelectedRoadIds : []);
    const denseNetwork = dataset.roads.length > 350;

    for (const road of dataset.roads) {
      if (road.coords.length < 2) continue;
      const inHighlightedArea = areaSet.has(road.id);
      const latLngs: L.LatLngExpression[] = road.coords.map((c) => [c.lat, c.lon]);

      const polyline = L.polyline(latLngs, {
        color: inHighlightedArea ? '#ef4444' : '#38bdf8',
        weight: inHighlightedArea ? (denseNetwork ? 3.5 : 5) : denseNetwork ? 2.5 : 4,
        opacity: inHighlightedArea ? 0.92 : 0.65,
      });

      if (!denseNetwork) {
        const roadLabel = road.name || `${road.highway} #${road.id}`;
        const roadDetail = `${road.highway}${road.widthMeters ? ` · ${road.widthMeters}m` : ''} · Click to start point-to-point route here`;
        polyline.bindTooltip(
          () => createTooltipElement(roadLabel, roadDetail, '0.75'),
          { sticky: true },
        );
      }

      polyline.on('mouseover', () => {
        if (!inHighlightedArea) {
          polyline.setStyle({ color: '#f59e0b', weight: denseNetwork ? 4 : 5, opacity: 0.95 });
        }
      });

      polyline.on('mouseout', () => {
        polyline.setStyle({
          color: inHighlightedArea ? '#ef4444' : '#38bdf8',
          weight: inHighlightedArea ? (denseNetwork ? 3.5 : 5) : denseNetwork ? 2.5 : 4,
          opacity: inHighlightedArea ? 0.92 : 0.65,
        });
      });

      polyline.on('click', (ev) => {
        if (isSelectingAreaRef.current) return;
        if (isDrawingRoadRef.current) {
          onAddCustomWaypointRef.current({ lat: ev.latlng.lat, lon: ev.latlng.lng });
          return;
        }
        L.DomEvent.stopPropagation(ev);
        onSelectRoadAtPointRef.current(road.id, {
          lat: ev.latlng.lat,
          lon: ev.latlng.lng,
        });
      });

      polyline.addTo(group);
    }
  }, [dataset, selectionMode, areaSelectedRoadIds]);

  // Render traced route (red), start/end pins, and clickable connecting branch options (amber)
  useEffect(() => {
    const group = routeGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (selectionMode === 'area' && areaStartEnd) {
      L.circleMarker([areaStartEnd.start.lat, areaStartEnd.start.lon], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#10b981',
        fillOpacity: 1,
        interactive: false,
      })
        .bindTooltip('START (AC_START_0 / AC_PIT_0)', { permanent: false, direction: 'top' })
        .addTo(group);

      L.circleMarker([areaStartEnd.end.lat, areaStartEnd.end.lon], {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 1,
        interactive: false,
      })
        .bindTooltip('FINISH', { permanent: false, direction: 'top' })
        .addTo(group);
      return;
    }

    if (selectionMode !== 'route' || !tracedRoute || tracedRoute.coords.length < 2) return;

    for (const junction of tracedRoute.junctions) {
      for (const opt of junction.options) {
        if (opt.optionKey === junction.selectedOptionKey || opt.previewCoords.length < 2) {
          continue;
        }
        const branchLine = L.polyline(
          opt.previewCoords.map((p) => [p.lat, p.lon] as L.LatLngExpression),
          {
            color: '#f59e0b',
            weight: 5,
            opacity: 0.85,
            dashArray: '6 5',
          },
        );
        branchLine.bindTooltip(
          () =>
            createTooltipElement(
              `Follow connecting road: ${opt.roadName}`,
              `Turn ${opt.turnAngleDeg}° at end of ${junction.fromRoadName} · Click to switch`,
              '0.8',
            ),
          { sticky: true },
        );
        branchLine.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          onSelectJunctionOptionRef.current(junction.junctionKey, opt.optionKey);
        });
        branchLine.addTo(group);
      }
    }

    L.polyline(
      tracedRoute.coords.map((p) => [p.lat, p.lon] as L.LatLngExpression),
      {
        color: '#ef4444',
        weight: 6,
        opacity: 0.95,
        interactive: false,
      },
    ).addTo(group);

    for (const junction of tracedRoute.junctions) {
      if (junction.options.length > 1) {
        L.circleMarker([junction.atCoord.lat, junction.atCoord.lon], {
          radius: 5,
          color: '#ffffff',
          weight: 1.5,
          fillColor: '#f59e0b',
          fillOpacity: 1,
          interactive: false,
        }).addTo(group);
      }
    }

    L.circleMarker([tracedRoute.startCoord.lat, tracedRoute.startCoord.lon], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#10b981',
      fillOpacity: 1,
      interactive: false,
    })
      .bindTooltip('START', { permanent: false, direction: 'top' })
      .addTo(group);

    L.circleMarker([tracedRoute.endCoord.lat, tracedRoute.endCoord.lon], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#ef4444',
      fillOpacity: 1,
      interactive: false,
    })
      .bindTooltip(
        `END (${(tracedRoute.totalDistanceMeters / 1000).toFixed(2)} km)`,
        { permanent: false, direction: 'top' },
      )
      .addTo(group);
  }, [selectionMode, tracedRoute, areaStartEnd]);

  // Render custom drawn road waypoints & preview polyline
  useEffect(() => {
    const group = customGroupRef.current;
    if (!group) return;
    group.clearLayers();
    if (customWaypoints.length === 0) return;

    if (customWaypoints.length >= 2) {
      L.polyline(
        customWaypoints.map((p) => [p.lat, p.lon] as L.LatLngExpression),
        {
          color: '#f59e0b',
          weight: 5,
          opacity: 0.95,
          dashArray: isDrawingRoad ? '8 6' : undefined,
          interactive: false,
        },
      ).addTo(group);
    }

    customWaypoints.forEach((pt, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === customWaypoints.length - 1 && idx > 0;
      const color = isStart ? '#10b981' : isEnd ? '#ef4444' : '#f59e0b';
      const marker = L.circleMarker([pt.lat, pt.lon], {
        radius: isStart || isEnd ? 7 : 5,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
        interactive: true,
      });
      marker.bindTooltip(
        isStart ? 'Start Point' : isEnd ? `Finish (WP #${idx + 1})` : `Waypoint #${idx + 1}`,
        { direction: 'top' },
      );
      marker.addTo(group);
    });
  }, [customWaypoints, isDrawingRoad]);

  const handleSizeClick = (size: BoxSizeOption) => {
    setBoxSize(size);
    setFollowCenter(true);
    const map = mapRef.current;
    if (!map) return;
    onSelectedBboxChange(computeBoxFromMap(map, size));
  };

  const handleCenterHere = () => {
    const map = mapRef.current;
    if (!map) return;
    setFollowCenter(true);
    onSelectedBboxChange(computeBoxFromMap(map, boxSize));
  };

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsSearching(true);
    setSearchError(null);

    try {
      const data = await searchNominatimLocations(query, {
        limit: 5,
        timeoutMs: 10000,
        signal: controller.signal,
      });
      setSearchResults(data);
      if (data.length === 0) {
        setSearchError('No locations found. Try another road, pass, or city.');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setSearchError(
          err instanceof Error
            ? err.message
            : 'Location search unavailable. Check network connection.',
        );
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handlePickSearchResult = (item: NominatimLocation) => {
    const { lat, lon } = item;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const sizeMeters = boxSize === 'fit' ? 2000 : Number(boxSize);
    const nextBbox = createCenteredBbox(lat, lon, sizeMeters);
    setFollowCenter(false);
    onSelectedBboxChange(nextBbox);
    setSearchResults([]);

    const map = mapRef.current;
    if (map) {
      map.setView([lat, lon], 14, { animate: true });
      if (searchMarkerRef.current) {
        map.removeLayer(searchMarkerRef.current);
      }
      searchMarkerRef.current = L.circleMarker([lat, lon], {
        radius: 6,
        color: '#ef4444',
        fillColor: '#ef4444',
        fillOpacity: 0.9,
        weight: 2,
      }).addTo(map);
    }

    onFetchArea(nextBbox);
  };

  const boxDims = useMemo(() => bboxDimensionsMeters(selectedBbox), [selectedBbox]);

  return (
    <div className="relative flex-1 h-full flex flex-col bg-[#0b0d10] overflow-hidden">
      {/* Top Toolbar */}
      <div className="shrink-0 bg-[#101318] border-b border-white/[0.08] px-3 py-2 space-y-2 z-[500]">
        {/* Row 1: Search + Base Layer Switcher */}
        <div className="flex items-center gap-2">
          <form onSubmit={handleSearch} className="relative flex-1 min-w-0 flex gap-1.5">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search road, pass, or city..."
                className="studio-input w-full bg-[#141820] border border-white/[0.09] focus:border-white/[0.24] rounded-md pl-8 pr-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="studio-press shrink-0 px-2.5 py-1.5 rounded-md bg-[#1b202b] hover:bg-[#232a38] border border-white/[0.09] text-xs font-medium text-zinc-200 disabled:opacity-50"
            >
              {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Find'}
            </button>

            {searchResults.length > 0 || searchError ? (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[#141820] border border-white/[0.14] rounded-lg shadow-2xl z-[1000] overflow-hidden">
                {searchError ? (
                  <div className="px-3 py-2 text-xs text-amber-300 flex items-center justify-between">
                    <span>{searchError}</span>
                    <button
                      type="button"
                      onClick={() => setSearchError(null)}
                      className="text-zinc-400 hover:text-zinc-200 ml-2"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <ul className="divide-y divide-white/[0.06] max-h-52 overflow-y-auto">
                    {searchResults.map((item) => (
                      <li key={item.place_id}>
                        <button
                          type="button"
                          onClick={() => handlePickSearchResult(item)}
                          className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-white/[0.06] transition-colors"
                        >
                          {item.display_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </form>

          {/* Map Layer Switcher */}
          <div className="flex items-center bg-[#0b0d10] border border-white/[0.08] rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setBaseLayer('osm')}
              className={`studio-press flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium ${
                baseLayer === 'osm'
                  ? 'bg-[#1b202b] text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <MapIcon className="w-3 h-3" />
              <span className="hidden sm:inline">Street</span>
            </button>
            <button
              type="button"
              onClick={() => setBaseLayer('satellite')}
              className={`studio-press flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium ${
                baseLayer === 'satellite'
                  ? 'bg-[#1b202b] text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Globe className="w-3 h-3" />
              <span className="hidden sm:inline">Satellite</span>
            </button>
          </div>
        </div>

        {/* Row 2: Area Sizing + Selection Tools */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { id: '600', label: '600m' },
                { id: '1200', label: '1.2km' },
                { id: '2000', label: '2km' },
                { id: '5000', label: '5km' },
                { id: '10000', label: '10km' },
                { id: 'fit', label: 'Fit' },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleSizeClick(id)}
                className={`studio-press px-2 py-1 rounded-md text-[11px] font-mono tabular-nums border ${
                  boxSize === id && followCenter
                    ? 'bg-[#1b202b] border-white/[0.22] text-zinc-100'
                    : 'bg-[#141820] border-white/[0.07] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.14]'
                }`}
              >
                {label}
              </button>
            ))}

            <button
              type="button"
              onClick={handleCenterHere}
              title="Snap selection box to current map center"
              className={`studio-press flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border ${
                followCenter
                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                  : 'bg-[#141820] border-white/[0.07] text-zinc-300 hover:border-white/[0.16]'
              }`}
            >
              <Crosshair className="w-3 h-3" />
              {followCenter ? 'Locked' : 'Center'}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleSelectingArea}
              title="Drag a box on the map to select all roads inside that area"
              className={`studio-press flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border shrink-0 ${
                isSelectingArea
                  ? 'bg-[#e53935] border-[#e53935] text-white'
                  : selectionMode === 'area'
                    ? 'bg-[#e53935]/15 border-[#e53935]/45 text-red-200 hover:bg-[#e53935]/25'
                    : 'bg-[#141820] border-white/[0.08] text-zinc-200 hover:bg-[#1b202b]'
              }`}
            >
              <Scan className="w-3 h-3" />
              {isSelectingArea ? 'Drag...' : 'Highlight'}
            </button>

            <button
              type="button"
              onClick={onSelectAllLoadedRoads}
              title="Select all OSM roads in the current loaded area"
              className={`studio-press px-2 py-1 rounded-md text-[11px] font-medium border shrink-0 ${
                selectionMode === 'area'
                  ? 'bg-[#e53935]/15 border-[#e53935]/45 text-red-200'
                  : 'bg-[#141820] border-white/[0.08] text-zinc-300 hover:border-white/[0.16]'
              }`}
            >
              All ({dataset?.roads.length ?? 0})
            </button>

            <button
              type="button"
              onClick={onToggleDrawingRoad}
              title="Click points to draw a custom path anywhere on the map"
              className={`studio-press flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border shrink-0 ${
                isDrawingRoad
                  ? 'bg-[#e53935] border-[#e53935] text-white'
                  : customWaypoints.length >= 2
                    ? 'bg-amber-500/15 border-amber-400/45 text-amber-200 hover:bg-amber-500/25'
                    : 'bg-[#141820] border-white/[0.08] text-zinc-200 hover:bg-[#1b202b]'
              }`}
            >
              <PenTool className="w-3 h-3" />
              {isDrawingRoad ? 'Done' : 'Draw'}
            </button>
          </div>
        </div>
      </div>

      {/* Leaflet Canvas */}
      <div className="relative flex-1 min-h-0">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Floating Highlight Area HUD */}
        {(isSelectingArea || selectionMode === 'area') && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[460] flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-full bg-[#101318]/92 border border-white/[0.14] shadow-xl backdrop-blur-md">
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-100">
              <span
                className={`w-2 h-2 rounded-full bg-[#e53935] ${
                  isSelectingArea ? 'animate-pulse' : ''
                }`}
              />
              {isSelectingArea
                ? 'Click & drag a box on the map'
                : `${areaSelectedRoadIds.length} roads active in area`}
            </span>

            {!isSelectingArea && (
              <button
                type="button"
                onClick={onToggleSelectingArea}
                className="studio-press flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[11px] text-zinc-200"
              >
                <Scan className="w-3 h-3" />
                Redraw
              </button>
            )}

            <button
              type="button"
              onClick={onClearAreaHighlight}
              className="studio-press flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-zinc-300"
            >
              <X className="w-3 h-3" />
              Exit
            </button>
          </div>
        )}

        {/* Floating Custom Road Drawing HUD */}
        {(isDrawingRoad || (selectionMode === 'draw' && customWaypoints.length > 0)) && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[460] flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-full bg-[#101318]/92 border border-white/[0.14] shadow-xl backdrop-blur-md">
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-100">
              <span
                className={`w-2 h-2 rounded-full ${
                  isDrawingRoad ? 'bg-[#e53935] animate-pulse' : 'bg-amber-400'
                }`}
              />
              {isDrawingRoad
                ? `Placing points (${customWaypoints.length})`
                : `Drawn path (${customWaypoints.length} pts)`}
            </span>

            {customWaypoints.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={onUndoCustomWaypoint}
                  title="Undo last waypoint"
                  className="studio-press flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-[11px] text-zinc-200"
                >
                  <Undo2 className="w-3 h-3" />
                  Undo
                </button>
                <button
                  type="button"
                  onClick={onClearCustomWaypoints}
                  title="Clear custom road"
                  className="studio-press flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] hover:bg-red-950/80 text-[11px] text-zinc-300 hover:text-red-200"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onToggleDrawingRoad}
              className={`studio-press flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                isDrawingRoad
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-white/[0.1] hover:bg-white/[0.18] text-zinc-100'
              }`}
            >
              {isDrawingRoad ? (
                <>
                  <Check className="w-3 h-3" />
                  Done
                </>
              ) : (
                <>
                  <PenTool className="w-3 h-3" />
                  Add points
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Bottom Status & Fetch Strip */}
      <div className="shrink-0 bg-[#101318] border-t border-white/[0.08] px-3 py-2 flex flex-wrap items-center justify-between gap-2 z-[450]">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#e53935]" />
              {selectionMode === 'area'
                ? `Area (${areaSelectedRoadIds.length})`
                : tracedRoute
                  ? `Route (${(tracedRoute.totalDistanceMeters / 1000).toFixed(2)} km)`
                  : 'Selected'}
            </span>
            {selectionMode === 'route' && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Forks ({tracedRoute?.junctions.reduce((s, j) => s + Math.max(0, j.options.length - 1), 0) ?? 0})
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              Loaded ({dataset?.roads.length ?? 0})
            </span>
          </div>
          <span className="font-mono tabular-nums text-[11px] text-zinc-500">
            {Math.round(boxDims.width)} &times; {Math.round(boxDims.height)} m
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {selectionMode === 'route' && tracedRoute && (
            <button
              type="button"
              onClick={onFlipDirection}
              title="Reverse direction from the starting point"
              className="studio-press flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#141820] hover:bg-[#1b202b] border border-white/[0.09] text-xs font-medium text-zinc-200"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-zinc-400" />
              Flip
            </button>
          )}
          {isLoading ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onCancelFetch}
                className="studio-press flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#141820] hover:bg-red-950/60 border border-white/[0.09] text-xs font-medium text-zinc-200"
              >
                <X className="w-3.5 h-3.5 text-[#e53935]" />
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onFetchArea(selectedBbox)}
                title="Restart fetch for the current selection box"
                className="studio-press flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1b202b] border border-white/[0.12] text-zinc-200 text-xs font-medium"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                Loading...
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onFetchArea(selectedBbox)}
              className="studio-press flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1b202b] hover:bg-[#242b3a] border border-white/[0.14] text-zinc-100 text-xs font-medium"
            >
              <DownloadCloud className="w-3.5 h-3.5 text-emerald-400" />
              Load roads here
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
