export function lonToTileXFloat(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * Math.pow(2, zoom);
}

export function latToTileYFloat(lat: number, zoom: number): number {
  const latRad = Math.max(-85.05112878, Math.min(85.05112878, lat)) * (Math.PI / 180);
  const n = Math.pow(2, zoom);
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
}

export function canDecodeBrowserImages(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof fetch === 'function'
  );
}
