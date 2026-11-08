import { Box, Columns2, Download, Loader2, Map as MapIcon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { GeneratedTrackScene, OsmDataset } from '../types/track';
import { BrandMark } from './BrandMark';

export type StudioViewMode = 'split' | 'map' | '3d';

interface HeaderBarProps {
  trackName: string;
  onTrackNameChange: (name: string) => void;
  viewMode: StudioViewMode;
  onViewModeChange: (mode: StudioViewMode) => void;
  scene: GeneratedTrackScene | null;
  datasetSource: OsmDataset['source'] | null;
  isLoading: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenExport: () => void;
  onBackHome?: () => void;
}

const VIEW_MODES: ReadonlyArray<{ id: StudioViewMode; label: string; icon: typeof Columns2 }> = [
  { id: 'split', label: 'Split', icon: Columns2 },
  { id: 'map', label: '2D Map', icon: MapIcon },
  { id: '3d', label: '3D Studio', icon: Box },
];

export function HeaderBar({
  trackName,
  onTrackNameChange,
  viewMode,
  onViewModeChange,
  scene,
  datasetSource,
  isLoading,
  sidebarOpen,
  onToggleSidebar,
  onOpenExport,
  onBackHome,
}: HeaderBarProps) {
  const lengthKm = scene ? (scene.stats.lengthMeters / 1000).toFixed(2) : '0.00';
  const triangleLabel = scene
    ? scene.stats.triangleCount >= 1000
      ? `${(scene.stats.triangleCount / 1000).toFixed(1)}k`
      : `${scene.stats.triangleCount}`
    : '0';

  return (
    <header className="h-12 shrink-0 bg-[#101318] border-b border-white/[0.08] px-3 sm:px-4 flex items-center justify-between gap-3 select-none">
      {/* Left: Brand & Inline Track Title */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Hide parameters sidebar' : 'Show parameters sidebar'}
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          className="studio-press p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]"
        >
          {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={onBackHome}
          title="Back to OpenTarmac home"
          className="studio-press flex items-center gap-2 shrink-0 rounded-md px-1 py-0.5 hover:bg-white/[0.04]"
        >
          <BrandMark className="w-6 h-6" />
          <span className="hidden sm:inline text-[13px] font-semibold tracking-[-0.02em] text-zinc-100">
            OpenTarmac
          </span>
        </button>

        <span className="text-zinc-700 hidden md:inline select-none">/</span>

        <div className="flex items-center min-w-0">
          <label htmlFor="header-track-name" className="sr-only">
            Track Name
          </label>
          <input
            id="header-track-name"
            type="text"
            value={trackName}
            onChange={(e) => onTrackNameChange(e.target.value)}
            placeholder="Untitled track..."
            className="studio-input w-36 sm:w-52 md:w-64 bg-transparent hover:bg-white/[0.04] focus:bg-[#141820] border border-transparent hover:border-white/[0.08] focus:border-white/[0.2] rounded-md px-2 py-1 text-[13px] font-medium text-zinc-100 placeholder:text-zinc-500 truncate transition-colors"
          />
        </div>
      </div>

      {/* Center: View Mode Segmented Control */}
      <nav
        aria-label="Workspace view mode"
        className="flex items-center bg-[#0b0d10] border border-white/[0.08] rounded-lg p-0.5 shrink-0"
      >
        {VIEW_MODES.map(({ id, label, icon: Icon }) => {
          const active = viewMode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onViewModeChange(id)}
              className={`studio-press flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                active
                  ? 'bg-[#1b202b] text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#e53935]' : ''}`} />
              <span className="hidden md:inline">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right: Quiet Telemetry Status & Export */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#141820] border border-white/[0.07] text-[11px] text-zinc-400">
          {isLoading ? (
            <span className="flex items-center gap-1.5 text-amber-400 font-medium">
              <Loader2 className="w-3 h-3 animate-spin" />
              Fetching map
            </span>
          ) : datasetSource === 'overpass' ? (
            <span className="flex items-center gap-1.5 text-zinc-300 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              OSM Live
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              Ready
            </span>
          )}

          {scene && (
            <>
              <span className="text-zinc-700">&middot;</span>
              <span className="font-mono tabular-nums text-zinc-200" title="Primary route length">
                {lengthKm} km
              </span>
              <span className="text-zinc-700">&middot;</span>
              <span className="font-mono tabular-nums text-zinc-400" title="Generated triangle count">
                {triangleLabel} tris
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenExport}
          disabled={!scene || isLoading}
          className="studio-press flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#e53935] hover:bg-[#ef4444] disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-medium shadow-sm"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Export Track</span>
          <span className="sm:hidden">Export</span>
        </button>
      </div>
    </header>
  );
}
