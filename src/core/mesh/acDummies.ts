import type {
  AcDummyNode,
  CenterlinePoint,
  TrackGenerationConfig,
  Vec3,
} from '../../types/track';
import { add3, normalize3, scale3 } from './math';

interface SampledCenterlineFrame {
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  leftWidth: number;
  rightWidth: number;
}

export function getCenterlineTotalLength(
  centerline: CenterlinePoint[],
  isCircuit: boolean
): number {
  if (centerline.length < 2) return 0;
  const last = centerline[centerline.length - 1];
  if (!isCircuit) return last.distanceFromStart;
  const first = centerline[0];
  const closingDist = Math.hypot(
    first.position.x - last.position.x,
    first.position.y - last.position.y,
    first.position.z - last.position.z
  );
  return last.distanceFromStart + closingDist;
}

export function sampleCenterlineAtDistance(
  centerline: CenterlinePoint[],
  distance: number,
  isCircuit: boolean,
  totalLength = getCenterlineTotalLength(centerline, isCircuit)
): SampledCenterlineFrame {
  const n = centerline.length;
  if (n === 1 || totalLength <= 1e-6) {
    const p = centerline[0];
    return {
      position: { ...p.position },
      forward: { ...p.forward },
      right: { ...p.right },
      leftWidth: p.leftWidth,
      rightWidth: p.rightWidth,
    };
  }

  let d = distance;
  if (isCircuit) {
    d = ((d % totalLength) + totalLength) % totalLength;
  } else {
    d = Math.max(0, Math.min(totalLength, d));
  }

  const last = centerline[n - 1];
  if (d >= last.distanceFromStart) {
    if (!isCircuit) {
      return {
        position: { ...last.position },
        forward: { ...last.forward },
        right: { ...last.right },
        leftWidth: last.leftWidth,
        rightWidth: last.rightWidth,
      };
    }
    const first = centerline[0];
    const segLen = Math.max(1e-6, totalLength - last.distanceFromStart);
    const t = (d - last.distanceFromStart) / segLen;
    return lerpFrame(last, first, t);
  }

  // Binary search for segment containing d
  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (centerline[mid].distanceFromStart <= d) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const a = centerline[lo];
  const b = centerline[hi];
  const segLen = Math.max(1e-6, b.distanceFromStart - a.distanceFromStart);
  const t = (d - a.distanceFromStart) / segLen;
  return lerpFrame(a, b, t);
}

function lerpFrame(
  a: CenterlinePoint,
  b: CenterlinePoint,
  t: number
): SampledCenterlineFrame {
  const lerpNum = (x: number, y: number) => x + (y - x) * t;
  const position: Vec3 = {
    x: lerpNum(a.position.x, b.position.x),
    y: lerpNum(a.position.y, b.position.y),
    z: lerpNum(a.position.z, b.position.z),
  };
  const forward = normalize3(
    {
      x: lerpNum(a.forward.x, b.forward.x),
      y: lerpNum(a.forward.y, b.forward.y),
      z: lerpNum(a.forward.z, b.forward.z),
    },
    a.forward
  );
  const right = normalize3(
    {
      x: lerpNum(a.right.x, b.right.x),
      y: lerpNum(a.right.y, b.right.y),
      z: lerpNum(a.right.z, b.right.z),
    },
    a.right
  );
  return {
    position,
    forward,
    right,
    leftWidth: lerpNum(a.leftWidth, b.leftWidth),
    rightWidth: lerpNum(a.rightWidth, b.rightWidth),
  };
}

/**
 * Generate Assetto Corsa spawn (`AC_START_*`), pit (`AC_PIT_*`), and timing gate (`AC_TIME_*_L/_R`) nodes.
 */
export function buildAcDummies(
  centerline: CenterlinePoint[],
  config: TrackGenerationConfig
): AcDummyNode[] {
  if (centerline.length < 2) return [];

  const isCircuit = config.runMode === 'circuit';
  const totalLength = getCenterlineTotalLength(centerline, isCircuit);
  if (totalLength < 5) return [];

  const dummies: AcDummyNode[] = [];
  const up: Vec3 = { x: 0, y: 1, z: 0 };

  const gridCount = Math.max(0, Math.floor(config.gridSlotCount));
  const pitCount = Math.max(0, Math.floor(config.pitBoxCount));

  const slotLongitudinalSpacing = 4.5;
  const startGateDist = isCircuit
    ? 0
    : Math.min(totalLength * 0.15, 6 + Math.max(1, gridCount) * slotLongitudinalSpacing + 4);

  // 1. Staggered 2-by-2 starting grid behind AC_TIME_0
  for (let i = 0; i < gridCount; i++) {
    const rawDist = startGateDist - (6 + i * slotLongitudinalSpacing);
    const dist = isCircuit ? rawDist : Math.max(1, rawDist);
    const frame = sampleCenterlineAtDistance(
      centerline,
      dist,
      isCircuit,
      totalLength
    );
    const sideSign = i % 2 === 0 ? -1 : 1;
    const lateralOffset = sideSign * (frame.leftWidth * 0.36);
    const pos = add3(frame.position, scale3(frame.right, lateralOffset));
    pos.y += 0.35;

    dummies.push({
      name: `AC_START_${i}`,
      kind: 'start',
      position: pos,
      forward: frame.forward,
      up,
    });
  }

  // 2. Pit boxes placed safely on the road shoulder so cars never spawn underground on slopes
  for (let i = 0; i < pitCount; i++) {
    const rawDist = isCircuit
      ? totalLength - 8 - i * 7
      : Math.min(totalLength - 2, 6 + i * 7);
    const frame = sampleCenterlineAtDistance(
      centerline,
      rawDist,
      isCircuit,
      totalLength
    );
    const pitOffset = frame.rightWidth * 0.45;
    const pos = add3(frame.position, scale3(frame.right, pitOffset));
    pos.y += 0.35;

    dummies.push({
      name: `AC_PIT_${i}`,
      kind: 'pit',
      position: pos,
      forward: frame.forward,
      up,
    });
  }

  // 3. Hotlap start dummy (required by AC Hotlap mode)
  {
    const hotlapDist = isCircuit
      ? Math.max(0, totalLength - 35)
      : Math.max(1, startGateDist - 4);
    const frame = sampleCenterlineAtDistance(
      centerline,
      hotlapDist,
      isCircuit,
      totalLength
    );
    const pos = { ...frame.position };
    pos.y += 0.35;
    dummies.push({
      name: 'AC_HOTLAP_START_0',
      kind: 'hotlap_start',
      position: pos,
      forward: frame.forward,
      up,
    });
  }

  // 4. Timing gates: AC_TIME_0 (start/finish), AC_TIME_1 (33%), AC_TIME_2 (66%)
  const gateDistances = [
    startGateDist,
    totalLength * 0.33,
    totalLength * 0.66,
  ];

  gateDistances.forEach((gateDist, gateIdx) => {
    const frame = sampleCenterlineAtDistance(
      centerline,
      gateDist,
      isCircuit,
      totalLength
    );
    const leftPos = add3(
      frame.position,
      scale3(frame.right, -(frame.leftWidth + 1.2))
    );
    const rightPos = add3(
      frame.position,
      scale3(frame.right, frame.rightWidth + 1.2)
    );
    leftPos.y += 0.1;
    rightPos.y += 0.1;

    dummies.push({
      name: `AC_TIME_${gateIdx}_L`,
      kind: 'time_l',
      position: leftPos,
      forward: frame.forward,
      up,
    });
    dummies.push({
      name: `AC_TIME_${gateIdx}_R`,
      kind: 'time_r',
      position: rightPos,
      forward: frame.forward,
      up,
    });
  });

  // 5. Point-to-Point native A-to-B gates (AC_AB_START_L/R & AC_AB_FINISH_L/R)
  if (!isCircuit) {
    const abStartFrame = sampleCenterlineAtDistance(
      centerline,
      startGateDist,
      false,
      totalLength
    );
    const abStartL = add3(
      abStartFrame.position,
      scale3(abStartFrame.right, -(abStartFrame.leftWidth + 1.2))
    );
    const abStartR = add3(
      abStartFrame.position,
      scale3(abStartFrame.right, abStartFrame.rightWidth + 1.2)
    );
    abStartL.y += 0.1;
    abStartR.y += 0.1;
    dummies.push(
      {
        name: 'AC_AB_START_L',
        kind: 'ab_start_l',
        position: abStartL,
        forward: abStartFrame.forward,
        up,
      },
      {
        name: 'AC_AB_START_R',
        kind: 'ab_start_r',
        position: abStartR,
        forward: abStartFrame.forward,
        up,
      }
    );

    const finishDist = Math.max(startGateDist + 5, totalLength - 4);
    const abFinishFrame = sampleCenterlineAtDistance(
      centerline,
      finishDist,
      false,
      totalLength
    );
    const abFinishL = add3(
      abFinishFrame.position,
      scale3(abFinishFrame.right, -(abFinishFrame.leftWidth + 1.2))
    );
    const abFinishR = add3(
      abFinishFrame.position,
      scale3(abFinishFrame.right, abFinishFrame.rightWidth + 1.2)
    );
    abFinishL.y += 0.1;
    abFinishR.y += 0.1;
    dummies.push(
      {
        name: 'AC_AB_FINISH_L',
        kind: 'ab_finish_l',
        position: abFinishL,
        forward: abFinishFrame.forward,
        up,
      },
      {
        name: 'AC_AB_FINISH_R',
        kind: 'ab_finish_r',
        position: abFinishR,
        forward: abFinishFrame.forward,
        up,
      }
    );
  }

  return dummies;
}
