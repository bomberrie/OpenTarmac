/**
 * Pure-TypeScript DirectDraw Surface (.dds) encoder producing uncompressed
 * 32-bit BGRA (A8R8G8B8) DDS textures natively supported by Assetto Corsa,
 * ksEditor, and Content Manager without external codecs.
 */
export function encodeRgbaToDds(
  width: number,
  height: number,
  rgba: Uint8Array
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid DDS dimensions: ${width}x${height}`);
  }
  const pixelBytes = width * height * 4;
  if (rgba.length < pixelBytes) {
    throw new RangeError(
      `RGBA buffer too small for ${width}x${height} DDS: expected at least ${pixelBytes} bytes, got ${rgba.length}`
    );
  }
  const headerSize = 128;
  const out = new Uint8Array(headerSize + pixelBytes);
  const view = new DataView(out.buffer);

  // Magic "DDS " (0x20534444)
  view.setUint32(0, 0x20534444, true);
  // DDS_HEADER.dwSize = 124
  view.setUint32(4, 124, true);
  // dwFlags: CAPS (0x1) | HEIGHT (0x2) | WIDTH (0x4) | PITCH (0x8) | PIXELFORMAT (0x1000)
  view.setUint32(8, 0x0000100f, true);
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(20, width * 4, true); // dwPitchOrLinearSize
  view.setUint32(24, 0, true); // dwDepth
  view.setUint32(28, 1, true); // dwMipMapCount

  // DDS_PIXELFORMAT starting at offset 76
  view.setUint32(76, 32, true); // ddspf.dwSize
  view.setUint32(80, 0x41, true); // DDPF_ALPHAPIXELS (0x1) | DDPF_RGB (0x40)
  view.setUint32(84, 0, true); // dwFourCC
  view.setUint32(88, 32, true); // dwRGBBitCount
  view.setUint32(92, 0x00ff0000, true); // R
  view.setUint32(96, 0x0000ff00, true); // G
  view.setUint32(100, 0x000000ff, true); // B
  view.setUint32(104, 0xff000000, true); // A

  // dwCaps = DDSCAPS_TEXTURE (0x1000)
  view.setUint32(108, 0x00001000, true);

  // Convert RGBA -> BGRA pixels
  let dst = headerSize;
  for (let i = 0; i < pixelBytes; i += 4) {
    out[dst++] = rgba[i + 2]; // B
    out[dst++] = rgba[i + 1]; // G
    out[dst++] = rgba[i]; // R
    out[dst++] = rgba[i + 3]; // A
  }

  return out;
}
