const CONTROL_CHARS_RE = /[\r\n\u0000-\u001f\u007f]+/g;

/**
 * Strip ASCII control characters and line breaks without trimming spaces (safe for live text inputs).
 */
export function stripControlChars(value: string, maxLen = 120): string {
  return value.replace(CONTROL_CHARS_RE, ' ').slice(0, maxLen);
}

/**
 * Normalize untrusted text into a safe single-line string for INI, OBJ, and README outputs.
 */
export function sanitizeSingleLineText(value: string, maxLen = 120): string {
  return value.replace(CONTROL_CHARS_RE, ' ').trim().slice(0, maxLen);
}

/**
 * Sanitize a track folder/file slug to lowercase ASCII `[a-z0-9_-]`.
 */
export function sanitizeSlug(slug: string, fallback = 'opentarmac_track'): string {
  const cleaned = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}
