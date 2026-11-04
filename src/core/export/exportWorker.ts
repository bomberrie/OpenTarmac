import type { ExportArtifacts, GeneratedTrackScene } from '../../types/track.ts';
import { generateTrackExport } from './packageZip.ts';

export interface ExportWorkerRequest {
  scene: GeneratedTrackScene;
  options?: { previewPng?: Uint8Array; outlinePng?: Uint8Array };
}

export type ExportWorkerResponse =
  | { ok: true; artifacts: ExportArtifacts }
  | { ok: false; error: string };

self.onmessage = async (event: MessageEvent<ExportWorkerRequest>) => {
  try {
    const artifacts = await generateTrackExport(event.data.scene, event.data.options);
    const response: ExportWorkerResponse = { ok: true, artifacts };
    self.postMessage(response);
  } catch (err) {
    const response: ExportWorkerResponse = {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to build export package.',
    };
    self.postMessage(response);
  }
};
