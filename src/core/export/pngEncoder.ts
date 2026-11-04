/**
 * Pure-TypeScript PNG encoder producing RFC 2083 compliant RGBA PNG bytes
 * using uncompressed zlib deflate stored blocks (no external zlib dependency).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  const MOD = 65521;
  for (let i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % MOD;
    s2 = (s2 + s1) % MOD;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crcInput = chunk.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return chunk;
}

function wrapZlibStored(raw: Uint8Array): Uint8Array {
  // Split into max 65535-byte stored DEFLATE blocks
  const maxBlock = 65535;
  const blockCount = Math.max(1, Math.ceil(raw.length / maxBlock));
  const out = new Uint8Array(2 + raw.length + blockCount * 5 + 4);
  let pos = 0;
  // zlib CMF=0x78 (32K deflate), FLG=0x01 (no dict, fastest, FCHECK ok)
  out[pos++] = 0x78;
  out[pos++] = 0x01;

  let offset = 0;
  for (let b = 0; b < blockCount; b++) {
    const remaining = raw.length - offset;
    const len = Math.min(maxBlock, remaining);
    const isFinal = b === blockCount - 1 ? 1 : 0;
    const nlen = (~len) & 0xffff;
    out[pos++] = isFinal;
    out[pos++] = len & 0xff;
    out[pos++] = (len >>> 8) & 0xff;
    out[pos++] = nlen & 0xff;
    out[pos++] = (nlen >>> 8) & 0xff;
    out.set(raw.subarray(offset, offset + len), pos);
    pos += len;
    offset += len;
  }

  const adler = adler32(raw);
  const view = new DataView(out.buffer);
  view.setUint32(pos, adler, false);
  return out;
}

/**
 * Encodes an RGBA pixel buffer (width * height * 4 bytes) into a valid PNG Uint8Array.
 */
export function encodeRgbaToPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid PNG dimensions: ${width}x${height}`);
  }
  const rowBytes = width * 4;
  if (rgba.length < rowBytes * height) {
    throw new RangeError(
      `RGBA buffer too small for ${width}x${height} PNG: expected at least ${rowBytes * height} bytes, got ${rgba.length}`
    );
  }
  const rawScanlines = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const dstRow = y * (rowBytes + 1);
    rawScanlines[dstRow] = 0; // filter type 0 (None)
    const srcRow = y * rowBytes;
    rawScanlines.set(rgba.subarray(srcRow, srcRow + rowBytes), dstRow + 1);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idatPayload = wrapZlibStored(rawScanlines);

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', idatPayload);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let p = 0;
  out.set(signature, p);
  p += signature.length;
  out.set(ihdrChunk, p);
  p += ihdrChunk.length;
  out.set(idatChunk, p);
  p += idatChunk.length;
  out.set(iendChunk, p);
  return out;
}
