import { sanitizeSingleLineText } from '../export/sanitize';

export interface NominatimLocation {
  place_id: number;
  display_name: string;
  lat: number;
  lon: number;
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/**
 * Query OpenStreetMap Nominatim with timeout, rate-limit handling, and strict schema/coordinate validation.
 */
export async function searchNominatimLocations(
  query: string,
  options?: { limit?: number; timeoutMs?: number; signal?: AbortSignal }
): Promise<NominatimLocation[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = Math.max(1, Math.min(10, Math.round(options?.limit ?? 5)));
  const timeoutMs = options?.timeoutMs ?? 10000;

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onParentAbort, { once: true });
  let timedOut = false;
  const timerId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const url = `${NOMINATIM_SEARCH_URL}?format=json&limit=${limit}&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (res.status === 429) {
      throw new Error('Location search is temporarily rate-limited by Nominatim. Wait a few seconds and retry.');
    }
    if (!res.ok) {
      throw new Error(`Location search failed (HTTP ${res.status}).`);
    }

    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) {
      throw new Error('Invalid Nominatim response payload.');
    }

    const results: NominatimLocation[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const lat = typeof rec.lat === 'string' || typeof rec.lat === 'number'
        ? Number.parseFloat(String(rec.lat))
        : NaN;
      const lon = typeof rec.lon === 'string' || typeof rec.lon === 'number'
        ? Number.parseFloat(String(rec.lon))
        : NaN;
      const displayName =
        typeof rec.display_name === 'string'
          ? sanitizeSingleLineText(rec.display_name, 200)
          : '';
      const placeId =
        typeof rec.place_id === 'number' && Number.isSafeInteger(rec.place_id)
          ? rec.place_id
          : results.length + 1;

      if (
        !displayName ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        continue;
      }

      results.push({
        place_id: placeId,
        display_name: displayName,
        lat,
        lon,
      });
    }

    return results;
  } catch (err) {
    if (timedOut) {
      throw new Error('Location search timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timerId);
    options?.signal?.removeEventListener('abort', onParentAbort);
  }
}
