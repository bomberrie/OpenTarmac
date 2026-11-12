import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Compass,
  Copy,
  FileArchive,
  MapPin,
  Route,
  Scan,
} from 'lucide-react';
import { BrandMark } from './BrandMark';

interface LandingPageProps {
  onLaunchStudio: (initialSearchQuery?: string) => void;
}

type FormatKey = 'route' | 'area' | 'draw';

const QUICK_PLACES = [
  'Stelvio Pass',
  'Hakone Turnpike',
  'Tail of the Dragon',
  'Col de Turini',
];

const FORMAT_DETAILS: Record<
  FormatKey,
  {
    id: FormatKey;
    label: string;
    lead: string;
    detail: string;
    specs: Array<[string, string]>;
  }
> = {
  route: {
    id: 'route',
    label: 'Route Follow',
    lead: 'Click any real street and trace a continuous stage up to 25 km.',
    detail:
      'Built for alpine passes, coastal roads, and point-to-point time attacks. OpenTarmac follows connected OSM ways automatically and surfaces every Y-fork or roundabout so you pick the exact branch to keep.',
    specs: [
      ['Trace reach', '200 m – 25.0 km'],
      ['Junctions', 'Interactive fork & U-turn control'],
      ['Timing gates', 'AC_TIME_0..2 + AC_AB_START / FINISH'],
    ],
  },
  area: {
    id: 'area',
    label: 'Highlight Area',
    lead: 'Drag one bounding box to turn an entire town or canyon loop into open free roam.',
    detail:
      'Every loaded street inside your selection batches into chunked 1ROAD_network meshes with per-road guardrails turned off by default so intersections stay open across the whole district.',
    specs: [
      ['Road batching', 'Chunked <= 55,000 verts per mesh'],
      ['Intersections', 'Per-road walls disabled in free roam'],
      ['Minimap & HUD', 'Full multi-road network map.png'],
    ],
  },
  draw: {
    id: 'draw',
    label: 'Custom Path',
    lead: 'Plot custom waypoints directly over real Terrarium elevation contours.',
    detail:
      'Drop points anywhere on the globe to design rallycross loops, cut-throughs, or fantasy hillclimbs. Centripetal Catmull-Rom splines resample the centerline while preserving true terrain relief.',
    specs: [
      ['Spline curve', 'Centripetal Catmull-Rom (alpha = 0.5)'],
      ['Elevation grid', 'Zoom-15 Terrarium bilinear DEM'],
      ['Road width', '6.0 m – 16.0 m + multiplier'],
    ],
  },
};

interface ManifestEntry {
  path: string;
  role: string;
  spec: string;
  details: string[];
}

const PACKAGE_MANIFEST: ReadonlyArray<ManifestEntry> = [
  {
    path: '<slug>.kn5',
    role: 'Kunos v5 binary scene',
    spec: 'sc6969 · ksPerPixel · 32-bit BGRA DDS',
    details: [
      'Pure-TypeScript Kunos v5 binary container with embedded 32-bit A8R8G8B8 .dds textures (including 1024×1024 Esri ortho ground).',
      'Meshes exceeding 65,000 vertices split automatically into _partN submeshes so uint16 indices stay valid in Assetto Corsa.',
      'Carries AC_START_*, AC_PIT_*, AC_HOTLAP_START_0, and AC_TIME_* transform matrices.',
    ],
  },
  {
    path: 'ai/fast_lane.ai',
    role: 'Version 7 racing spline',
    spec: 'AiPoint (20 B) + AiPointExtra (72 B)',
    details: [
      'Binary v7 spline serialized directly from the smoothed 3D road centerline.',
      'Stores left/right track boundary widths, cumulative arc-length, and forward vectors per sample node.',
      'Paired with ai/pit_lane.ai so Practice, Track Day, and Hotlap sessions initialize cleanly.',
    ],
  },
  {
    path: 'data/surfaces.ini',
    role: 'Physics surface presets',
    spec: 'ROAD · KERB · GRASS · WALL · GRAVEL',
    details: [
      'Maps 1ROAD_* meshes to 0.98 friction tarmac, 1KERB_* to vibrating rumble strips, and 1GRASS_terrain to off-track dirt.',
      'Includes lighting.ini, sections.ini, trackside cameras.ini, and calibrated map.ini coordinates.',
    ],
  },
  {
    path: 'ui/ & map.png',
    role: 'Content Manager telemetry',
    spec: 'ui_track.json · preview.png · outline.png',
    details: [
      'Captures a live WebGL viewport snapshot for preview.png alongside a crisp vector outline.png.',
      'Generates transparent HUD minimap map.png aligned to data/map.ini scale and offsets.',
    ],
  },
  {
    path: 'source/<slug>.glb',
    role: 'Blender-ready 3D source',
    spec: 'glTF 2.0 binary + Wavefront .obj',
    details: [
      'Exports all procedural meshes with PBR base materials and AC dummy empty nodes for optional detailing in Blender.',
      'Includes a plain Wavefront .obj with object groups and dummy transform comments.',
    ],
  },
];

export function LandingPage({ onLaunchStudio }: LandingPageProps) {
  const [searchInput, setSearchInput] = useState('');
  const [activeFormat, setActiveFormat] = useState<FormatKey>('route');
  const [selectedManifestIdx, setSelectedManifestIdx] = useState(0);
  const [copiedPath, setCopiedPath] = useState(false);

  // Refs for Emil clip-path tab bar
  const tabRowRef = useRef<HTMLDivElement | null>(null);
  const tabButtonRefs = useRef<Record<FormatKey, HTMLButtonElement | null>>({
    route: null,
    area: null,
    draw: null,
  });
  const [tabClip, setTabClip] = useState('inset(0 66.6% 0 0 round 6px)');

  useLayoutEffect(() => {
    const updateClip = () => {
      const container = tabRowRef.current;
      const activeBtn = tabButtonRefs.current[activeFormat];
      if (!container || !activeBtn) return;
      const cWidth = container.clientWidth;
      if (cWidth <= 0) return;
      const left = activeBtn.offsetLeft;
      const right = Math.max(0, cWidth - (left + activeBtn.offsetWidth));
      setTabClip(`inset(0px ${right}px 0px ${left}px round 6px)`);
    };
    updateClip();
    window.addEventListener('resize', updateClip);
    return () => window.removeEventListener('resize', updateClip);
  }, [activeFormat]);

  const handleLaunchSearch = (e: FormEvent) => {
    e.preventDefault();
    onLaunchStudio(searchInput.trim() || undefined);
  };

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText('assettocorsa\\content\\tracks\\');
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1800);
    } catch {
      setCopiedPath(false);
    }
  };

  const currentFormat = FORMAT_DETAILS[activeFormat];
  const currentManifest = PACKAGE_MANIFEST[selectedManifestIdx] ?? PACKAGE_MANIFEST[0];

  return (
    <div className="min-h-screen bg-[#090b0e] text-[#f2f2ef] flex flex-col relative">
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 h-14 bg-[#090b0e]/90 border-b border-white/[0.08] backdrop-blur-md">
        <div className="max-w-[1200px] mx-auto h-full px-5 sm:px-8 flex items-center justify-between gap-4">
          <a
            href="#"
            className="flex items-center gap-2.5 text-[#f2f2ef] hover:opacity-90 transition-opacity"
          >
            <BrandMark className="w-6 h-6" />
            <span className="font-display text-[15px] font-semibold tracking-[-0.02em]">
              OpenTarmac
            </span>
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-[13px] text-zinc-400"
          >
            <a href="#modes" className="hover:text-[#f2f2ef] transition-colors">
              Driving modes
            </a>
            <a href="#package" className="hover:text-[#f2f2ef] transition-colors">
              Export manifest
            </a>
            <a href="#install" className="hover:text-[#f2f2ef] transition-colors">
              Install
            </a>
            <a
              href="https://github.com/bomberrie/OpenTarmac"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-[#f2f2ef] transition-colors"
            >
              GitHub
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </nav>

          <button
            type="button"
            onClick={() => onLaunchStudio()}
            className="studio-press inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#e53935] hover:bg-[#ef4444] text-white text-xs font-medium shadow-[0_2px_10px_rgba(229,57,53,0.28)]"
          >
            Open Studio
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero: Direct Thesis, Location Launcher & Actual Studio Screenshot */}
        <section className="relative overflow-hidden border-b border-white/[0.08]">
          <div className="absolute inset-0 ot-grain pointer-events-none opacity-65" />

          <div className="relative max-w-[1200px] mx-auto px-5 sm:px-8 pt-10 pb-14 lg:pt-16 lg:pb-20">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-10 items-center">
              {/* Left Column: Headline, Search Launcher, Real Data Specs */}
              <div className="lg:col-span-5 space-y-7">
                <div className="space-y-4">
                  <h1 className="font-display text-4xl sm:text-[52px] font-bold tracking-[-0.035em] leading-[0.98] text-[#f4f4f1] [text-wrap:balance]">
                    Real roads in. Playable Assetto Corsa tracks out.
                  </h1>
                  <p className="text-[15px] text-[#a1a7b3] leading-[1.6] max-w-[46ch]">
                    Stream OpenStreetMap street networks, zoom-15 Terrarium elevation grids, and Esri aerial imagery into your browser—then compile a ready-to-drive{' '}
                    <span className="font-mono text-[13px] text-[#e4e6eb]">.kn5</span> track folder without opening Blender or ksEditor.
                  </p>
                </div>

                {/* Working Action: Search any road, pass, or city directly into Studio */}
                <form onSubmit={handleLaunchSearch} className="space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1 min-w-0">
                      <MapPin className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search any pass, circuit, or town..."
                        aria-label="Search location to load in OpenTarmac Studio"
                        className="studio-input w-full bg-[#11141a] border border-white/[0.12] hover:border-white/[0.2] focus:border-white/[0.34] rounded-md pl-9 pr-3 py-2.5 text-sm text-[#f2f2ef] placeholder:text-zinc-500 transition-colors"
                      />
                    </div>
                    <button
                      type="submit"
                      className="studio-press shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-[#e53935] hover:bg-[#ef4444] text-white text-sm font-medium shadow-[0_2px_12px_rgba(229,57,53,0.3)]"
                    >
                      Launch
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                    <span className="text-zinc-500 mr-0.5">Presets:</span>
                    {QUICK_PLACES.map((place) => (
                      <button
                        key={place}
                        type="button"
                        onClick={() => onLaunchStudio(place)}
                        className="studio-press px-2.5 py-1 rounded bg-[#12161d] hover:bg-[#1a202a] border border-white/[0.08] hover:border-white/[0.18] text-zinc-300 hover:text-white"
                      >
                        {place}
                      </button>
                    ))}
                  </div>
                </form>

                {/* Architectural Data Sources Ledger */}
                <dl className="grid grid-cols-3 gap-4 pt-5 border-t border-white/[0.08] text-xs">
                  <div>
                    <dt className="text-zinc-500">Road geometry</dt>
                    <dd className="font-mono text-[#e5e7eb] tabular-nums mt-1">
                      OSM Overpass
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Elevation DEM</dt>
                    <dd className="font-mono text-[#e5e7eb] tabular-nums mt-1">
                      192×192 z15
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Ground ortho</dt>
                    <dd className="font-mono text-[#e5e7eb] tabular-nums mt-1">
                      1024px DDS
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Right Column: Real Studio Screenshot */}
              <div className="lg:col-span-7">
                <figure className="bg-[#0e1116] border border-white/[0.12] rounded-lg overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.62)]">
                  <button
                    type="button"
                    onClick={() => onLaunchStudio('Stelvio Pass')}
                    className="block w-full text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e53935]"
                    aria-label="Open Stelvio Pass in OpenTarmac Studio"
                  >
                    <img
                      src="./studio-preview.png"
                      width={1440}
                      height={880}
                      alt="OpenTarmac Studio split view showing Passo dello Stelvio roads highlighted in 2D Leaflet map alongside the live 3D WebGL terrain and road mesh"
                      className="w-full h-auto block bg-[#0b0d10]"
                    />
                  </button>
                  <figcaption className="px-4 py-2.5 bg-[#101318] border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-zinc-400 font-mono tabular-nums">
                      Passo dello Stelvio &middot; 49 roads &middot; 6.65 km &middot; 100.1k tris
                    </span>
                    <button
                      type="button"
                      onClick={() => onLaunchStudio('Stelvio Pass')}
                      className="studio-press inline-flex items-center gap-1.5 text-xs font-medium text-[#f2f2ef] hover:text-white bg-[#1a202a] hover:bg-[#222937] border border-white/[0.12] px-3 py-1 rounded"
                    >
                      Open in Studio
                      <ArrowRight className="w-3.5 h-3.5 text-[#e53935]" />
                    </button>
                  </figcaption>
                </figure>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Three Ways to Carve a Map (Emil clip-path tabs + architectural spec) */}
        <section id="modes" className="border-b border-white/[0.08] bg-[#0b0e12]">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-16 lg:py-24">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-white/[0.08]">
              <div className="max-w-xl">
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.03em] text-[#f4f4f1]">
                  Three ways to carve a drivable map
                </h2>
                <p className="text-sm text-[#a1a7b3] mt-2 leading-relaxed">
                  Switch seamlessly between single-stage hillclimbs, open-world city street networks, and custom-plotted rally paths without losing your elevation or surface settings.
                </p>
              </div>

              {/* Emil-style duplicated clip-path tab bar */}
              <div className="relative self-start shrink-0 bg-[#090b0e] border border-white/[0.1] rounded-lg p-1">
                <div ref={tabRowRef} className="relative grid grid-cols-3">
                  {/* Base inactive tab layer */}
                  {(['route', 'area', 'draw'] as const).map((key) => {
                    const item = FORMAT_DETAILS[key];
                    const Icon = key === 'route' ? Route : key === 'area' ? Scan : Compass;
                    return (
                      <button
                        key={key}
                        ref={(el) => {
                          tabButtonRefs.current[key] = el;
                        }}
                        type="button"
                        onClick={() => setActiveFormat(key)}
                        className="studio-press relative z-10 flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 whitespace-nowrap"
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}

                  {/* Active clipped duplicate layer */}
                  <div
                    aria-hidden="true"
                    style={{ clipPath: tabClip }}
                    className="ot-tab-overlay pointer-events-none absolute inset-0 z-20 grid grid-cols-3 bg-[#f2f2ef] text-[#090b0e]"
                  >
                    {(['route', 'area', 'draw'] as const).map((key) => {
                      const item = FORMAT_DETAILS[key];
                      const Icon = key === 'route' ? Route : key === 'area' ? Scan : Compass;
                      return (
                        <div
                          key={key}
                          className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold whitespace-nowrap"
                        >
                          <Icon className="w-3.5 h-3.5 text-[#e53935]" />
                          <span>{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 pt-10 items-start">
              <div className="lg:col-span-6 space-y-4">
                <h3 className="font-display text-xl sm:text-2xl font-semibold tracking-[-0.02em] text-[#f4f4f1] [text-wrap:balance]">
                  {currentFormat.lead}
                </h3>
                <p className="text-sm text-[#a1a7b3] leading-[1.65] max-w-[58ch]">
                  {currentFormat.detail}
                </p>
              </div>

              <dl className="lg:col-span-6 divide-y divide-white/[0.08] border-t border-b border-white/[0.08]">
                {currentFormat.specs.map(([label, value]) => (
                  <div
                    key={label}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
                  >
                    <dt className="text-zinc-400">{label}</dt>
                    <dd className="font-mono text-[#e5e7eb] tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* Section 3: Interactive Export Package Inspector */}
        <section id="package" className="border-b border-white/[0.08]">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-16 lg:py-24">
            <div className="max-w-2xl pb-10">
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.03em] text-[#f4f4f1]">
                Built in pure TypeScript, ready for Content Manager
              </h2>
              <p className="text-sm text-[#a1a7b3] mt-2 leading-relaxed">
                Every export compiles a complete <span className="font-mono text-zinc-200">content/tracks/&lt;slug&gt;/</span> directory locally in your browser. Inspect any file in the manifest below.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left: Interactive File Tree */}
              <div className="lg:col-span-5 border border-white/[0.09] rounded-lg bg-[#0e1116] divide-y divide-white/[0.07] overflow-hidden">
                {PACKAGE_MANIFEST.map((entry, idx) => {
                  const active = idx === selectedManifestIdx;
                  return (
                    <button
                      key={entry.path}
                      type="button"
                      onClick={() => setSelectedManifestIdx(idx)}
                      className={`studio-press w-full text-left px-4 py-3.5 flex items-center justify-between gap-3 transition-colors ${
                        active
                          ? 'bg-[#171c25] text-[#f4f4f1]'
                          : 'hover:bg-white/[0.03] text-zinc-400'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-medium text-inherit truncate">
                          {entry.path}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                          {entry.role}
                        </div>
                      </div>
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                          active ? 'bg-[#e53935]' : 'bg-zinc-700'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>

              {/* Right: Selected Binary/Config Specification */}
              <div className="lg:col-span-7 border border-white/[0.09] rounded-lg bg-[#0e1116] p-6 sm:p-8 space-y-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3 pb-4 border-b border-white/[0.08]">
                  <div className="flex items-center gap-2.5">
                    <FileArchive className="w-4 h-4 text-[#e53935] shrink-0" />
                    <span className="font-mono text-sm font-semibold text-[#f4f4f1]">
                      {currentManifest.path}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-zinc-400">
                    {currentManifest.spec}
                  </span>
                </div>

                <ul className="space-y-3 text-sm text-[#b4bac6] leading-relaxed">
                  {currentManifest.details.map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <span className="w-1 h-1 rounded-full bg-[#e53935] mt-2.5 shrink-0" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: Install & Studio Entry */}
        <section id="install" className="bg-[#0b0e12]">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-16 lg:py-20 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="space-y-3 max-w-xl">
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.03em] text-[#f4f4f1]">
                Unzip and drive in minutes
              </h2>
              <p className="text-sm text-[#a1a7b3] leading-relaxed">
                Extract your track folder directly into Assetto Corsa, pick <strong className="text-zinc-200 font-medium">Practice</strong>, <strong className="text-zinc-200 font-medium">Hotlap</strong>, or <strong className="text-zinc-200 font-medium">Track Day</strong>, and hit the tarmac.
              </p>

              <div className="inline-flex items-center gap-2 bg-[#12161d] border border-white/[0.1] rounded-md pl-3 pr-1.5 py-1.5">
                <code className="font-mono text-xs text-zinc-200">
                  assettocorsa\content\tracks\
                </code>
                <button
                  type="button"
                  onClick={handleCopyPath}
                  aria-label="Copy Assetto Corsa tracks directory path"
                  className="studio-press inline-flex items-center gap-1 px-2 py-1 rounded bg-[#1b202b] hover:bg-[#232a38] text-[11px] text-zinc-300 hover:text-white"
                >
                  {copiedPath ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onLaunchStudio()}
              className="studio-press self-start lg:self-auto inline-flex items-center gap-2 px-5 py-3 rounded-md bg-[#e53935] hover:bg-[#ef4444] text-white text-sm font-medium shadow-[0_4px_18px_rgba(229,57,53,0.32)]"
            >
              Open OpenTarmac Studio
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.08] px-5 sm:px-8 py-6 text-xs text-zinc-500">
        <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <span>OpenTarmac &middot; OpenStreetMap, Mapzen Terrarium DEM &amp; Esri World Imagery</span>
          <a
            href="https://github.com/bomberrie/OpenTarmac"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-300 transition-colors"
          >
            bomberrie/OpenTarmac
          </a>
        </div>
      </footer>
    </div>
  );
}
