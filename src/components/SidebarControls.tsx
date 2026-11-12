import { useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  GitFork,
  Layers,
  MapPin,
  PenTool,
  Route,
  Scan,
  Sliders,
  Trash2,
  Undo2,
} from 'lucide-react';
import type {
  GeneratedTrackScene,
  MeshLayerKind,
  SelectionMode,
  TrackGenerationConfig,
  TrackRunMode,
  TracedRoute,
} from '../types/track';

interface SidebarControlsProps {
  config: TrackGenerationConfig;
  onChangeConfig: (updater: (prev: TrackGenerationConfig) => TrackGenerationConfig) => void;
  onTrackNameChange: (name: string) => void;
  onSlugChange: (slug: string) => void;
  visibleLayers: Record<MeshLayerKind, boolean>;
  onToggleLayer: (layer: MeshLayerKind) => void;
  showDummies: boolean;
  onToggleShowDummies: () => void;
  wireframe: boolean;
  onToggleWireframe: () => void;
  flyThrough: boolean;
  onToggleFlyThrough: () => void;
  scene: GeneratedTrackScene | null;
  selectionMode: SelectionMode;
  followDistanceMeters: number;
  onChangeFollowDistance: (meters: number) => void;
  reverseDirection: boolean;
  onFlipDirection: () => void;
  startRoadName: string | null;
  tracedRoute: TracedRoute | null;
  onSelectJunctionOption: (junctionKey: string, optionKey: string) => void;
  areaSelectedCount: number;
  totalLoadedRoadCount: number;
  isSelectingArea: boolean;
  onToggleSelectingArea: () => void;
  onSelectAllLoadedRoads: () => void;
  onClearAreaHighlight: () => void;
  isDrawingRoad: boolean;
  customWaypointCount: number;
  onStartDrawingRoad: () => void;
  onUndoCustomWaypoint: () => void;
  onClearCustomWaypoints: () => void;
}

const LAYER_META: ReadonlyArray<{
  key: MeshLayerKind;
  label: string;
  acTag: string;
  swatch: string;
}> = [
  { key: 'road', label: 'Asphalt road', acTag: '1ROAD', swatch: 'bg-zinc-400' },
  { key: 'kerb', label: 'Apex kerbs', acTag: '1KERB', swatch: 'bg-[#e53935]' },
  { key: 'terrain', label: 'Terrain ground', acTag: '1GRASS', swatch: 'bg-emerald-500' },
  { key: 'wall', label: 'Guardrails', acTag: '1WALL', swatch: 'bg-amber-400' },
  { key: 'building', label: 'OSM buildings', acTag: 'BLDG', swatch: 'bg-sky-400' },
  { key: 'tree', label: 'Canopy trees', acTag: 'TREE', swatch: 'bg-lime-500' },
];

interface CollapsibleSectionProps {
  title: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-white/[0.07]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="studio-press w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/[0.03]"
      >
        <span className="flex items-center gap-2 text-xs font-semibold tracking-[-0.01em] text-zinc-200">
          <span className="text-zinc-400">{icon}</span>
          {title}
        </span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-0.5 space-y-3">{children}</div>}
    </section>
  );
}

interface SliderFieldProps {
  label: string;
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function SliderField({
  label,
  valueLabel,
  value,
  min,
  max,
  step,
  onChange,
}: SliderFieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono tabular-nums text-[11px] text-zinc-200 font-medium">
          {valueLabel}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="studio-slider"
      />
    </div>
  );
}

interface ToggleSwitchProps {
  label: string;
  sublabel?: string;
  checked: boolean;
  muted?: boolean;
  onToggle: () => void;
}

function ToggleSwitch({
  label,
  sublabel,
  checked,
  muted = false,
  onToggle,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="studio-press w-full flex items-center justify-between py-1 text-left group"
    >
      <div className="min-w-0 pr-3">
        <div
          className={`text-xs transition-colors ${
            muted ? 'text-zinc-500' : 'text-zinc-300 group-hover:text-zinc-100'
          }`}
        >
          {label}
        </div>
        {sublabel && (
          <div className="text-[11px] text-zinc-500 leading-tight mt-0.5">{sublabel}</div>
        )}
      </div>
      <span
        className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors duration-150 ${
          checked
            ? 'bg-[#e53935]'
            : 'bg-[#1b202b] border border-white/[0.12]'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${
            checked ? 'translate-x-[15px]' : 'translate-x-[2px]'
          }`}
        />
      </span>
    </button>
  );
}

export function SidebarControls({
  config,
  onChangeConfig,
  onTrackNameChange,
  onSlugChange,
  visibleLayers,
  onToggleLayer,
  showDummies,
  onToggleShowDummies,
  wireframe,
  onToggleWireframe,
  flyThrough,
  onToggleFlyThrough,
  scene,
  selectionMode,
  followDistanceMeters,
  onChangeFollowDistance,
  reverseDirection,
  onFlipDirection,
  startRoadName,
  tracedRoute,
  onSelectJunctionOption,
  areaSelectedCount,
  totalLoadedRoadCount,
  isSelectingArea,
  onToggleSelectingArea,
  onSelectAllLoadedRoads,
  onClearAreaHighlight,
  isDrawingRoad,
  customWaypointCount,
  onStartDrawingRoad,
  onUndoCustomWaypoint,
  onClearCustomWaypoints,
}: SidebarControlsProps) {
  const updateField = <K extends keyof TrackGenerationConfig>(
    key: K,
    value: TrackGenerationConfig[K],
  ) => {
    onChangeConfig((prev) => ({ ...prev, [key]: value }));
  };

  const setRunMode = (mode: TrackRunMode) => {
    updateField('runMode', mode);
  };

  return (
    <aside className="w-[304px] shrink-0 h-full bg-[#101318] border-r border-white/[0.08] overflow-y-auto flex flex-col">
      {/* 1. Route & Area Selection */}
      <CollapsibleSection title="Route & Area" icon={<Route className="w-3.5 h-3.5" />}>
        <div className="space-y-3">
          {/* Active Mode Summary */}
          <div className="flex items-center justify-between gap-2 bg-[#141820] border border-white/[0.07] rounded-lg px-3 py-2">
            <div className="min-w-0">
              <div className="text-[11px] text-zinc-400">
                {selectionMode === 'area'
                  ? 'Area free roam'
                  : selectionMode === 'draw'
                    ? 'Custom path'
                    : 'Start road'}
              </div>
              <div className="text-xs font-medium text-zinc-100 truncate mt-0.5">
                {selectionMode === 'draw' && customWaypointCount >= 2
                  ? `Drawn route (${customWaypointCount} points)`
                  : selectionMode === 'area'
                    ? `${areaSelectedCount} open roads selected`
                    : startRoadName ?? 'Click any road on the map'}
              </div>
            </div>
            {selectionMode === 'route' && tracedRoute && (
              <button
                type="button"
                onClick={onFlipDirection}
                title="Reverse travel direction along this road"
                className={`studio-press shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border ${
                  reverseDirection
                    ? 'bg-[#e53935]/15 border-[#e53935]/50 text-red-200'
                    : 'bg-[#1b202b] border-white/[0.08] text-zinc-200 hover:border-white/[0.16]'
                }`}
              >
                <ArrowLeftRight className="w-3 h-3" />
                Flip
              </button>
            )}
          </div>

          {/* Area Selection Actions */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onToggleSelectingArea}
              className={`studio-press flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-medium border ${
                isSelectingArea
                  ? 'bg-[#e53935] border-[#e53935] text-white'
                  : 'bg-[#141820] border-white/[0.08] text-zinc-200 hover:bg-[#1b202b]'
              }`}
            >
              <Scan className="w-3.5 h-3.5" />
              {isSelectingArea ? 'Drag box...' : 'Highlight box'}
            </button>
            <button
              type="button"
              onClick={selectionMode === 'area' ? onClearAreaHighlight : onSelectAllLoadedRoads}
              className={`studio-press py-1.5 px-2.5 rounded-md text-xs font-medium border ${
                selectionMode === 'area'
                  ? 'bg-[#e53935]/15 border-[#e53935]/45 text-red-200 hover:bg-[#e53935]/25'
                  : 'bg-[#141820] border-white/[0.08] text-zinc-200 hover:bg-[#1b202b]'
              }`}
            >
              {selectionMode === 'area'
                ? 'Exit area'
                : `All roads (${totalLoadedRoadCount})`}
            </button>
          </div>

          {selectionMode === 'route' && (
            <>
              <SliderField
                label="Follow distance"
                valueLabel={`${(followDistanceMeters / 1000).toFixed(2)} km`}
                value={followDistanceMeters}
                min={200}
                max={25000}
                step={100}
                onChange={onChangeFollowDistance}
              />

              {tracedRoute && !tracedRoute.reachedTargetDistance && (
                <p className="text-[11px] text-amber-300/90 leading-snug">
                  Road ended at {(tracedRoute.totalDistanceMeters / 1000).toFixed(2)} km. Expand the area box on the map to follow further.
                </p>
              )}

              {/* Junction / Connecting Road Picker */}
              {tracedRoute && tracedRoute.junctions.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                    <GitFork className="w-3.5 h-3.5 text-zinc-400" />
                    Connecting junctions ({tracedRoute.junctions.length})
                  </div>
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {tracedRoute.junctions.map((j, idx) => (
                      <div
                        key={j.junctionKey}
                        className="bg-[#141820] border border-white/[0.07] rounded-md p-2 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-[11px] text-zinc-400">
                          <span className="truncate font-medium text-zinc-300">
                            {idx + 1}. {j.fromRoadName}
                          </span>
                          <span className="shrink-0 font-mono tabular-nums text-zinc-500 ml-2">
                            {(j.distanceAtJunction / 1000).toFixed(2)} km
                          </span>
                        </div>
                        <select
                          value={j.selectedOptionKey}
                          onChange={(e) => onSelectJunctionOption(j.junctionKey, e.target.value)}
                          className="studio-input w-full bg-[#0b0d10] border border-white/[0.1] focus:border-white/[0.25] rounded px-2 py-1 text-xs text-zinc-100"
                        >
                          {j.options.map((opt) => (
                            <option key={opt.optionKey} value={opt.optionKey}>
                              Follow {opt.roadName} ({opt.turnAngleDeg}&deg;)
                            </option>
                          ))}
                          <option value="__STOP__">Stop at this junction</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* 2. Track Metadata */}
      <CollapsibleSection title="Track details" icon={<MapPin className="w-3.5 h-3.5" />}>
        <div className="space-y-2.5">
          <div>
            <label htmlFor="sidebar-track-name" className="block text-xs text-zinc-400 mb-1">
              Track name
            </label>
            <input
              id="sidebar-track-name"
              type="text"
              value={config.trackName}
              onChange={(e) => onTrackNameChange(e.target.value)}
              className="studio-input w-full bg-[#141820] border border-white/[0.09] focus:border-white/[0.24] rounded-md px-2.5 py-1.5 text-xs text-zinc-100"
            />
          </div>

          <div>
            <label htmlFor="sidebar-track-slug" className="block text-xs text-zinc-400 mb-1">
              Folder / KN5 slug
            </label>
            <input
              id="sidebar-track-slug"
              type="text"
              value={config.trackSlug}
              onChange={(e) => onSlugChange(e.target.value)}
              className="studio-input w-full bg-[#141820] border border-white/[0.09] focus:border-white/[0.24] rounded-md px-2.5 py-1.5 text-xs font-mono text-zinc-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="sidebar-country" className="block text-xs text-zinc-400 mb-1">
                Country
              </label>
              <input
                id="sidebar-country"
                type="text"
                value={config.country}
                onChange={(e) => updateField('country', e.target.value)}
                className="studio-input w-full bg-[#141820] border border-white/[0.09] focus:border-white/[0.24] rounded-md px-2.5 py-1 text-xs text-zinc-200"
              />
            </div>
            <div>
              <label htmlFor="sidebar-city" className="block text-xs text-zinc-400 mb-1">
                City / region
              </label>
              <input
                id="sidebar-city"
                type="text"
                value={config.city}
                onChange={(e) => updateField('city', e.target.value)}
                className="studio-input w-full bg-[#141820] border border-white/[0.09] focus:border-white/[0.24] rounded-md px-2.5 py-1 text-xs text-zinc-200"
              />
            </div>
          </div>

          <div>
            <span className="block text-xs text-zinc-400 mb-1">Session format</span>
            <div className="grid grid-cols-2 gap-1 bg-[#0b0d10] p-0.5 rounded-lg border border-white/[0.08]">
              {(['circuit', 'point-to-point'] as const).map((mode) => {
                const active = config.runMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRunMode(mode)}
                    className={`studio-press py-1 px-2 rounded-md text-xs font-medium ${
                      active
                        ? 'bg-[#1b202b] text-zinc-100 shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {mode === 'circuit' ? 'Circuit' : 'Point-to-point'}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-0.5 space-y-1.5">
            <button
              type="button"
              onClick={onStartDrawingRoad}
              className={`studio-press w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-medium border ${
                isDrawingRoad
                  ? 'bg-[#e53935] border-[#e53935] text-white'
                  : 'bg-[#141820] border-white/[0.08] text-zinc-200 hover:bg-[#1b202b]'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              {isDrawingRoad
                ? 'Click map to place points'
                : customWaypointCount > 0
                  ? `Edit drawn path (${customWaypointCount} pts)`
                  : 'Draw custom path'}
            </button>
            {customWaypointCount > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onUndoCustomWaypoint}
                  className="studio-press flex-1 flex items-center justify-center gap-1 py-1 rounded-md bg-[#141820] hover:bg-[#1b202b] border border-white/[0.08] text-xs text-zinc-300"
                >
                  <Undo2 className="w-3 h-3" />
                  Undo
                </button>
                <button
                  type="button"
                  onClick={onClearCustomWaypoints}
                  className="studio-press flex-1 flex items-center justify-center gap-1 py-1 rounded-md bg-[#141820] hover:bg-red-950/60 border border-white/[0.08] text-xs text-zinc-300 hover:text-red-200"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>
      </CollapsibleSection>

      {/* 3. Road & Terrain Tuning */}
      <CollapsibleSection title="Geometry & scale" icon={<Sliders className="w-3.5 h-3.5" />}>
        <SliderField
          label="Width multiplier"
          valueLabel={`${config.roadWidthMultiplier.toFixed(2)}×`}
          value={config.roadWidthMultiplier}
          min={0.7}
          max={2.0}
          step={0.05}
          onChange={(v) => updateField('roadWidthMultiplier', v)}
        />
        <SliderField
          label="Default road width"
          valueLabel={`${config.defaultRoadWidth.toFixed(1)} m`}
          value={config.defaultRoadWidth}
          min={6}
          max={16}
          step={0.5}
          onChange={(v) => updateField('defaultRoadWidth', v)}
        />
        <SliderField
          label="Elevation scale"
          valueLabel={`${config.elevationScale.toFixed(1)}×`}
          value={config.elevationScale}
          min={0}
          max={2.0}
          step={0.1}
          onChange={(v) => updateField('elevationScale', v)}
        />
        <SliderField
          label="Road grade smoothing"
          valueLabel={`${Math.round(config.roadSmoothing * 100)}%`}
          value={config.roadSmoothing}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => updateField('roadSmoothing', v)}
        />
        <div className="grid grid-cols-2 gap-3 pt-1">
          <SliderField
            label="Pit boxes"
            valueLabel={`${config.pitBoxCount}`}
            value={config.pitBoxCount}
            min={2}
            max={24}
            step={1}
            onChange={(v) => updateField('pitBoxCount', Math.round(v))}
          />
          <SliderField
            label="Grid slots"
            valueLabel={`${config.gridSlotCount}`}
            value={config.gridSlotCount}
            min={2}
            max={24}
            step={1}
            onChange={(v) => updateField('gridSlotCount', Math.round(v))}
          />
        </div>
      </CollapsibleSection>

      {/* 4. Scenery, Satellite & Viewport Layers */}
      <CollapsibleSection title="Surface & scenery" icon={<Layers className="w-3.5 h-3.5" />}>
        <div className="space-y-1">
          <ToggleSwitch
            label="Satellite terrain & foliage"
            sublabel="Ortho ground, canopy trees & road tint"
            checked={config.satelliteImagery !== false}
            onToggle={() =>
              updateField('satelliteImagery', config.satelliteImagery === false)
            }
          />
          <ToggleSwitch
            label="Free roam (open roads)"
            sublabel="Omit per-road barriers at junctions"
            checked={Boolean(config.freeRoam)}
            onToggle={() => updateField('freeRoam', !config.freeRoam)}
          />
          <ToggleSwitch
            label="Trackside kerbs"
            sublabel={config.freeRoam ? 'Disabled in free roam' : 'Apex edge strips'}
            checked={!config.freeRoam && config.generateKerbs}
            muted={Boolean(config.freeRoam)}
            onToggle={() => {
              if (config.freeRoam) updateField('freeRoam', false);
              updateField('generateKerbs', !config.generateKerbs);
            }}
          />
          <ToggleSwitch
            label="Safety guardrails"
            sublabel={config.freeRoam ? 'Disabled in free roam' : 'Solid edge walls'}
            checked={!config.freeRoam && config.generateGuardrails}
            muted={Boolean(config.freeRoam)}
            onToggle={() => {
              if (config.freeRoam) updateField('freeRoam', false);
              updateField('generateGuardrails', !config.generateGuardrails);
            }}
          />
          <ToggleSwitch
            label="OSM buildings"
            sublabel="Extruded walls & 3D roofs"
            checked={config.generateBuildings}
            onToggle={() => updateField('generateBuildings', !config.generateBuildings)}
          />
          <ToggleSwitch
            label="3D foliage trees"
            sublabel="Forest & satellite canopy models"
            checked={config.generateTrees}
            onToggle={() => updateField('generateTrees', !config.generateTrees)}
          />
        </div>

        <div className="border-t border-white/[0.07] pt-3 space-y-1">
          <div className="text-[11px] font-medium text-zinc-400 mb-1">
            Studio helpers
          </div>
          <ToggleSwitch
            label="Spawn & gate markers"
            checked={showDummies}
            onToggle={onToggleShowDummies}
          />
          <ToggleSwitch
            label="Wireframe mesh"
            checked={wireframe}
            onToggle={onToggleWireframe}
          />
          <ToggleSwitch
            label="Camera fly-through"
            checked={flyThrough}
            onToggle={onToggleFlyThrough}
          />
        </div>

        <div className="border-t border-white/[0.07] pt-3 space-y-1">
          <div className="text-[11px] font-medium text-zinc-400 mb-1.5">
            Visible layers
          </div>
          <div className="space-y-1">
            {LAYER_META.map(({ key, label, acTag, swatch }) => {
              const visible = visibleLayers[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onToggleLayer(key)}
                  className={`studio-press w-full flex items-center justify-between px-2.5 py-1.5 rounded-md border text-xs ${
                    visible
                      ? 'bg-[#141820] border-white/[0.07] text-zinc-200 hover:border-white/[0.14]'
                      : 'bg-transparent border-white/[0.04] text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${swatch} ${
                        visible ? 'opacity-100' : 'opacity-25'
                      }`}
                    />
                    <span className="truncate">{label}</span>
                    <span className="text-[10px] font-mono text-zinc-500">{acTag}</span>
                  </span>
                  {visible ? (
                    <Eye className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </CollapsibleSection>

      {/* 5. Spec Sheet Telemetry */}
      <CollapsibleSection title="Track telemetry" icon={<Activity className="w-3.5 h-3.5" />}>
        {scene ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
            <div>
              <dt className="text-[11px] text-zinc-500">Length</dt>
              <dd className="font-mono tabular-nums font-medium text-zinc-100 mt-0.5">
                {(scene.stats.lengthMeters / 1000).toFixed(2)} km
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-zinc-500">Elevation gain</dt>
              <dd className="font-mono tabular-nums font-medium text-zinc-100 mt-0.5">
                +{Math.round(scene.stats.elevationGainMeters)} m
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-zinc-500">Altitude range</dt>
              <dd className="font-mono tabular-nums font-medium text-zinc-200 mt-0.5">
                {Math.round(scene.stats.minElevationMeters)}&ndash;{Math.round(scene.stats.maxElevationMeters)} m
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-zinc-500">Triangles</dt>
              <dd className="font-mono tabular-nums font-medium text-zinc-200 mt-0.5">
                {scene.stats.triangleCount.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-zinc-500">Roads &middot; Bldgs</dt>
              <dd className="font-mono tabular-nums font-medium text-zinc-200 mt-0.5">
                {scene.stats.roadCount} &middot; {scene.stats.buildingCount}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-zinc-500">3D Trees</dt>
              <dd className="font-mono tabular-nums font-medium text-zinc-200 mt-0.5">
                {scene.stats.treeCount}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-zinc-500 leading-relaxed">
            Select a road or area on the map to compute length, elevation profile, and triangle budget.
          </p>
        )}
      </CollapsibleSection>
    </aside>
  );
}
