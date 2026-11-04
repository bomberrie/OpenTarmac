import type { GeneratedTrackScene } from '../../types/track.ts';

const AC_AI_VERSION = 7;
const HEADER_INTS = 4; // version, pointCount, lapTimeMs, sampleCount
const IDEAL_NODE_BYTES = 20; // 4 x float32 + 1 x int32
const DETAIL_FLOATS_PER_NODE = 18;
const DETAIL_NODE_BYTES = DETAIL_FLOATS_PER_NODE * 4; // 72 bytes
const TRAILING_BYTES = 4; // int32 HasGrid = 0

/**
 * Generates a little-endian Assetto Corsa `fast_lane.ai` (v7) binary spline
 * matching AcTools `AiSpline` / `AiPoint` / `AiPointExtra` layout.
 */
export function buildAiLineBytes(scene: GeneratedTrackScene): Uint8Array {
  const points = scene.centerline;
  const count = points.length;

  const totalBytes =
    HEADER_INTS * 4 +
    count * IDEAL_NODE_BYTES +
    4 + // pointsExtra length (int32)
    count * DETAIL_NODE_BYTES +
    TRAILING_BYTES;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;

  // 1. Header (4 x int32, little-endian)
  view.setInt32(offset, AC_AI_VERSION, true);
  offset += 4;
  view.setInt32(offset, count, true);
  offset += 4;
  view.setInt32(offset, 0, true); // lapTimeMs
  offset += 4;
  view.setInt32(offset, 0, true); // sampleCount
  offset += 4;

  // 2. AiPoint[] (Position Vec3, Length float32, Id int32)
  for (let i = 0; i < count; i++) {
    const pt = points[i];
    view.setFloat32(offset, pt.position.x, true);
    view.setFloat32(offset + 4, pt.position.y, true);
    view.setFloat32(offset + 8, pt.position.z, true);
    view.setFloat32(offset + 12, pt.distanceFromStart, true);
    view.setInt32(offset + 16, i, true);
    offset += IDEAL_NODE_BYTES;
  }

  // 3. AiPointExtra[] count + 18-float blocks per node (matches AcTools AiPointExtra)
  view.setInt32(offset, count, true);
  offset += 4;

  for (let i = 0; i < count; i++) {
    const pt = points[i];
    const base = offset;

    // f[0]: Speed (m/s), f[1]: Gas, f[2]: Brake, f[3]: ObsoleteLatG, f[4]: Radius
    view.setFloat32(base + 0 * 4, 25.0, true);
    view.setFloat32(base + 1 * 4, 1.0, true);
    view.setFloat32(base + 2 * 4, 0.0, true);
    view.setFloat32(base + 3 * 4, 0.0, true);
    view.setFloat32(base + 4 * 4, 0.0, true);
    // f[5..6]: SideLeft, SideRight track widths in meters
    view.setFloat32(base + 5 * 4, pt.leftWidth, true);
    view.setFloat32(base + 6 * 4, pt.rightWidth, true);
    // f[7]: Camber, f[8]: Direction
    view.setFloat32(base + 7 * 4, 0.0, true);
    view.setFloat32(base + 8 * 4, 0.0, true);
    // f[9..11]: Surface Normal Vec3 (Y-up)
    view.setFloat32(base + 9 * 4, 0.0, true);
    view.setFloat32(base + 10 * 4, 1.0, true);
    view.setFloat32(base + 11 * 4, 0.0, true);
    // f[12]: Length (distanceFromStart)
    view.setFloat32(base + 12 * 4, pt.distanceFromStart, true);
    // f[13..15]: ForwardVector Vec3
    view.setFloat32(base + 13 * 4, pt.forward.x, true);
    view.setFloat32(base + 14 * 4, pt.forward.y, true);
    view.setFloat32(base + 15 * 4, pt.forward.z, true);
    // f[16]: Tag, f[17]: Grade
    view.setFloat32(base + 16 * 4, 0.0, true);
    view.setFloat32(base + 17 * 4, 0.0, true);

    offset += DETAIL_NODE_BYTES;
  }

  // 4. HasGrid = 0 (no pre-baked grid)
  view.setInt32(offset, 0, true);

  return new Uint8Array(buffer);
}
