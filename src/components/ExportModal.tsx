import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileArchive,
  FileBox,
  FileCode2,
  FolderOpen,
  Loader2,
  PackageCheck,
  X,
} from 'lucide-react';
import { generateTrackExport, sanitizeSlug } from '../core/export';
import type {
  ExportWorkerRequest,
  ExportWorkerResponse,
} from '../core/export/exportWorker';
import type { ExportArtifacts, GeneratedTrackScene } from '../types/track';

export interface CaptureResult {
  previewPng?: Uint8Array;
  outlinePng?: Uint8Array;
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  scene: GeneratedTrackScene | null;
  onCaptureViewport?: () => CaptureResult | Promise<CaptureResult>;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function uint8ToBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mime });
}

function runExportInWorker(
  scene: GeneratedTrackScene,
  options?: { previewPng?: Uint8Array; outlinePng?: Uint8Array }
): { promise: Promise<ExportArtifacts>; cancel: () => void } {
  if (typeof Worker === 'undefined') {
    return {
      promise: generateTrackExport(scene, options),
      cancel: () => undefined,
    };
  }

  let worker: Worker | null = null;
  let settled = false;

  const promise = new Promise<ExportArtifacts>((resolve, reject) => {
    try {
      worker = new Worker(
        new URL('../core/export/exportWorker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
        settled = true;
        worker?.terminate();
        worker = null;
        if (event.data.ok) {
          resolve(event.data.artifacts);
        } else {
          reject(new Error(event.data.error));
        }
      };
      worker.onerror = (ev) => {
        if (settled) return;
        settled = true;
        worker?.terminate();
        worker = null;
        reject(new Error(ev.message || 'Export worker failed.'));
      };
      const payload: ExportWorkerRequest = { scene, options };
      worker.postMessage(payload);
    } catch {
      worker?.terminate();
      worker = null;
      generateTrackExport(scene, options).then(resolve, reject);
    }
  });

  return {
    promise,
    cancel: () => {
      if (!settled && worker) {
        settled = true;
        worker.terminate();
        worker = null;
      }
    },
  };
}

export function ExportModal({
  isOpen,
  onClose,
  scene,
  onCaptureViewport,
}: ExportModalProps) {
  const [artifacts, setArtifacts] = useState<ExportArtifacts | null>(null);
  const [captured, setCaptured] = useState<CaptureResult>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    closeBtnRef.current?.focus();
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !scene) {
      setArtifacts(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let cancelWorker: (() => void) | null = null;

    const run = async () => {
      setIsGenerating(true);
      setError(null);
      try {
        let capture: CaptureResult = {};
        if (onCaptureViewport) {
          try {
            capture = await onCaptureViewport();
          } catch {
            capture = {};
          }
        }
        if (cancelled) return;
        setCaptured(capture);

        const task = runExportInWorker(scene, {
          previewPng: capture.previewPng,
          outlinePng: capture.outlinePng,
        });
        cancelWorker = task.cancel;
        const result = await task.promise;
        if (!cancelled) {
          setArtifacts(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to build export package.');
        }
      } finally {
        if (!cancelled) {
          setIsGenerating(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      cancelWorker?.();
    };
  }, [isOpen, scene, onCaptureViewport]);

  const previewUrl = useMemo(() => {
    if (!captured.previewPng) return null;
    return URL.createObjectURL(uint8ToBlob(captured.previewPng, 'image/png'));
  }, [captured.previewPng]);

  const outlineUrl = useMemo(() => {
    if (!captured.outlinePng) return null;
    return URL.createObjectURL(uint8ToBlob(captured.outlinePng, 'image/png'));
  }, [captured.outlinePng]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (outlineUrl) URL.revokeObjectURL(outlineUrl);
    };
  }, [previewUrl, outlineUrl]);

  if (!isOpen || !scene) return null;

  const slug = sanitizeSlug(scene.config.trackSlug);

  const expectedFiles = [
    `${slug}.kn5`,
    'map.png',
    'data/map.ini',
    'data/surfaces.ini',
    'data/lighting.ini',
    'data/cameras.ini',
    'ai/fast_lane.ai',
    'ai/pit_lane.ai',
    'ui/ui_track.json',
    'ui/preview.png',
    'ui/outline.png',
    'models.ini',
  ];

  const fileSet = new Set(artifacts?.fileList ?? []);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="studio-modal-backdrop fixed inset-0 z-[2000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="studio-modal-panel w-full max-w-xl bg-[#101318] border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <PackageCheck className="w-4.5 h-4.5 text-[#e53935] shrink-0" />
            <div className="min-w-0">
              <h2 id="export-modal-title" className="text-sm font-semibold tracking-[-0.015em] text-zinc-100 truncate">
                Export track package
              </h2>
              <p className="text-xs text-zinc-400 truncate">
                {scene.config.trackName} &middot;{' '}
                <span className="font-mono text-zinc-300">{slug}</span>
              </p>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="studio-press p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]"
            aria-label="Close export modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Summary Spec Strip */}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-b border-white/[0.07]">
            <div>
              <dt className="text-[11px] text-zinc-500">Length</dt>
              <dd className="text-sm font-mono tabular-nums font-medium text-zinc-100 mt-0.5">
                {(scene.stats.lengthMeters / 1000).toFixed(2)} km
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-zinc-500">Triangles</dt>
              <dd className="text-sm font-mono tabular-nums font-medium text-zinc-100 mt-0.5">
                {scene.stats.triangleCount.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-zinc-500">Grid / Pit</dt>
              <dd className="text-sm font-mono tabular-nums font-medium text-zinc-100 mt-0.5">
                {scene.config.gridSlotCount} / {scene.config.pitBoxCount}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-zinc-500">Archive</dt>
              <dd className="text-sm font-mono tabular-nums font-medium text-emerald-400 mt-0.5">
                {artifacts ? formatBytes(artifacts.zipBlob.size) : '...'}
              </dd>
            </div>
          </dl>

          {/* Live Captures if available */}
          {(previewUrl || outlineUrl) && (
            <div className="grid grid-cols-2 gap-3">
              {previewUrl && (
                <div className="bg-[#141820] border border-white/[0.08] rounded-lg overflow-hidden">
                  <div className="px-2.5 py-1 border-b border-white/[0.06] text-[11px] font-mono text-zinc-400">
                    ui/preview.png
                  </div>
                  <img
                    src={previewUrl}
                    alt="Track preview"
                    className="w-full h-24 object-cover"
                  />
                </div>
              )}
              {outlineUrl && (
                <div className="bg-[#141820] border border-white/[0.08] rounded-lg overflow-hidden">
                  <div className="px-2.5 py-1 border-b border-white/[0.06] text-[11px] font-mono text-zinc-400">
                    ui/outline.png
                  </div>
                  <img
                    src={outlineUrl}
                    alt="Track outline"
                    className="w-full h-24 object-contain bg-[#0b0d10]"
                  />
                </div>
              )}
            </div>
          )}

          {/* Package Files */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300">
                Included track files
              </span>
              {isGenerating && (
                <span className="flex items-center gap-1.5 text-xs text-amber-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Building KN5 &amp; AI...
                </span>
              )}
            </div>

            {error && (
              <div className="p-2.5 rounded-md bg-red-950/60 border border-red-800/70 text-xs text-red-200">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {expectedFiles.map((file) => {
                const ready =
                  !isGenerating &&
                  artifacts !== null &&
                  (fileSet.size === 0 ||
                    fileSet.has(file) ||
                    fileSet.has(`${slug}/${file}`));
                return (
                  <div
                    key={file}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#141820] border border-white/[0.06] text-xs font-mono"
                  >
                    <CheckCircle2
                      className={`w-3.5 h-3.5 shrink-0 ${
                        ready ? 'text-emerald-400' : 'text-zinc-600'
                      }`}
                    />
                    <span className={ready ? 'text-zinc-200' : 'text-zinc-500'}>
                      {file}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Download Buttons */}
          <div className="space-y-2">
            <button
              type="button"
              disabled={!artifacts || isGenerating}
              onClick={() => {
                if (artifacts) triggerDownload(artifacts.zipBlob, `${slug}.zip`);
              }}
              className="studio-press w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#e53935] hover:bg-[#ef4444] disabled:opacity-50 disabled:pointer-events-none text-white text-xs font-medium shadow-sm"
            >
              <FileArchive className="w-4 h-4" />
              Download Assetto Corsa package (.zip)
              {artifacts && (
                <span className="font-mono text-[11px] opacity-85">
                  ({formatBytes(artifacts.zipBlob.size)})
                </span>
              )}
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                disabled={!artifacts || isGenerating}
                onClick={() => {
                  if (artifacts) {
                    triggerDownload(
                      uint8ToBlob(artifacts.kn5Bytes, 'application/octet-stream'),
                      `${slug}.kn5`,
                    );
                  }
                }}
                className="studio-press flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-[#141820] hover:bg-[#1b202b] border border-white/[0.09] disabled:opacity-50 text-xs font-medium text-zinc-200"
              >
                <Download className="w-3.5 h-3.5 text-zinc-400" />
                .kn5 only
              </button>

              <button
                type="button"
                disabled={!artifacts || isGenerating}
                onClick={() => {
                  if (artifacts) {
                    triggerDownload(
                      uint8ToBlob(artifacts.glbBytes, 'model/gltf-binary'),
                      `${slug}.glb`,
                    );
                  }
                }}
                className="studio-press flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-[#141820] hover:bg-[#1b202b] border border-white/[0.09] disabled:opacity-50 text-xs font-medium text-zinc-200"
              >
                <FileBox className="w-3.5 h-3.5 text-zinc-400" />
                .glb model
              </button>

              <button
                type="button"
                disabled={!artifacts || isGenerating}
                onClick={() => {
                  if (artifacts) {
                    triggerDownload(
                      new Blob([artifacts.objText], { type: 'text/plain;charset=utf-8' }),
                      `${slug}.obj`,
                    );
                  }
                }}
                className="studio-press flex items-center justify-center gap-1.5 py-2 px-3 rounded-md bg-[#141820] hover:bg-[#1b202b] border border-white/[0.09] disabled:opacity-50 text-xs font-medium text-zinc-200"
              >
                <FileCode2 className="w-3.5 h-3.5 text-zinc-400" />
                .obj mesh
              </button>
            </div>
          </div>

          {/* Concise Install Note */}
          <div className="flex items-start gap-2.5 pt-2 border-t border-white/[0.07] text-xs text-zinc-400 leading-relaxed">
            <FolderOpen className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
            <p>
              Extract <span className="font-mono text-zinc-200">{slug}.zip</span> into{' '}
              <span className="font-mono text-zinc-200">assettocorsa\content\tracks\</span> so{' '}
              <span className="font-mono text-zinc-200">{slug}\{slug}.kn5</span> sits directly inside the track folder, then launch in Content Manager or Assetto Corsa.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
