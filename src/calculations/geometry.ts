import type {
  CalcResult,
  Inputs,
  LadderCalcResult,
  LadderInputs,
  NumericInputs,
  SuccessfulResult,
  WeightData,
} from "../types";

export type GeometryPoint = {
  x: number;
  y: number;
};

const EPS = 1e-9;

export function parseNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return NaN;
  }

  return Number(value);
}

export function parseOptionalNumber(
  value: string | undefined,
  fallback = 0
) {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toNumericInputs(inputs: Inputs): NumericInputs {
  return {
    upperLength: parseNumber(inputs.upperLength),
    upperFrontHeight: parseNumber(inputs.upperFrontHeight),
    upperRearHeight: parseNumber(inputs.upperRearHeight),
    upperRearX: parseOptionalNumber(inputs.upperRearX, 0),
    lowerLength: parseNumber(inputs.lowerLength),
    lowerFrontHeight: parseNumber(inputs.lowerFrontHeight),
    lowerRearHeight: parseNumber(inputs.lowerRearHeight),
    lowerRearX: parseOptionalNumber(inputs.lowerRearX, 0),
    wheelbase: parseNumber(inputs.wheelbase),
    cgHeight: parseNumber(inputs.cgHeight),
    tireDiameter: parseNumber(inputs.tireDiameter),
  };
}

export function toLadderInputs(inputs: Inputs): LadderInputs {
  return {
    ladderLength: parseNumber(inputs.ladderLength),
    ladderFrontHeight: parseNumber(inputs.ladderFrontHeight),
    ladderRearUpperHeight: parseNumber(inputs.ladderRearUpperHeight),
    ladderRearLowerHeight: parseNumber(inputs.ladderRearLowerHeight),
    ladderRearUpperX: parseOptionalNumber(inputs.ladderRearUpperX, 0),
    ladderRearLowerX: parseOptionalNumber(inputs.ladderRearLowerX, 0),
    wheelbase: parseNumber(inputs.wheelbase),
    cgHeight: parseNumber(inputs.cgHeight),
    tireDiameter: parseNumber(inputs.tireDiameter),
  };
}

function cross(a: GeometryPoint, b: GeometryPoint) {
  return a.x * b.y - a.y * b.x;
}

/**
 * Classical side-view four-link solution using axle-centered coordinates.
 * X positive is forward from the rear axle centerline; Y positive is up.
 * This same routine is used by both the static calculator and the live model,
 * so the IC/AS math cannot drift between screens.
 */
export function calculateFourLinkFromCoordinates(
  upperRear: GeometryPoint,
  upperFront: GeometryPoint,
  lowerRear: GeometryPoint,
  lowerFront: GeometryPoint,
  wheelbase: number,
  cgHeight: number
): CalcResult {
  const values = [
    upperRear.x,
    upperRear.y,
    upperFront.x,
    upperFront.y,
    lowerRear.x,
    lowerRear.y,
    lowerFront.x,
    lowerFront.y,
    wheelbase,
    cgHeight,
  ];

  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  if (wheelbase <= 0 || cgHeight <= 0) {
    return {
      error: "Wheelbase and CG height must be greater than zero.",
    };
  }

  const upperVector = {
    x: upperFront.x - upperRear.x,
    y: upperFront.y - upperRear.y,
  };
  const lowerVector = {
    x: lowerFront.x - lowerRear.x,
    y: lowerFront.y - lowerRear.y,
  };

  const upperLength = Math.hypot(upperVector.x, upperVector.y);
  const lowerLength = Math.hypot(lowerVector.x, lowerVector.y);

  if (upperLength <= EPS || lowerLength <= EPS) {
    return { error: "A suspension link has zero usable length." };
  }

  // A drag-race 4-link side-view bar must have a usable fore/aft component.
  if (Math.abs(upperVector.x) <= EPS || Math.abs(lowerVector.x) <= EPS) {
    return {
      error: "A link is too close to vertical for a usable side-view instant center.",
    };
  }

  const denominator = cross(upperVector, lowerVector);
  const normalizedCross = Math.abs(denominator) / (upperLength * lowerLength);

  // This is effectively sin(the angle between the links). At extremely small
  // values the finite IC is numerically meaningless and can be millions of
  // inches away, so report it as a parallel-link condition instead of NaN/∞.
  if (!Number.isFinite(normalizedCross) || normalizedCross < 1e-8) {
    return {
      error:
        "The upper and lower links are parallel or nearly parallel, so there is no usable finite instant center.",
    };
  }

  const betweenRears = {
    x: lowerRear.x - upperRear.x,
    y: lowerRear.y - upperRear.y,
  };
  const t = cross(betweenRears, lowerVector) / denominator;

  const icLength = upperRear.x + t * upperVector.x;
  const icHeight = upperRear.y + t * upperVector.y;

  if (
    !Number.isFinite(icLength) ||
    !Number.isFinite(icHeight) ||
    Math.abs(icLength) < 1e-7
  ) {
    return {
      error: "The current geometry does not produce a usable finite instant center.",
    };
  }

  const antiSquat =
    ((icHeight * wheelbase) / (icLength * cgHeight)) * 100;

  if (!Number.isFinite(antiSquat)) {
    return {
      error: "Anti-squat could not be calculated from the current geometry.",
    };
  }

  return {
    upperRun: upperVector.x,
    lowerRun: lowerVector.x,
    upperAngle: Math.atan2(upperVector.y, upperVector.x) * (180 / Math.PI),
    lowerAngle: Math.atan2(lowerVector.y, lowerVector.x) * (180 / Math.PI),
    upperSlope: upperVector.y / upperVector.x,
    lowerSlope: lowerVector.y / lowerVector.x,
    icLength,
    icHeight,
    antiSquat,
    rearSpread: Math.abs(upperRear.y - lowerRear.y),
    frontSpread: Math.abs(upperFront.y - lowerFront.y),
  } satisfies SuccessfulResult;
}

export function calculateFourLink(n: NumericInputs): CalcResult {
  const required = [
    n.upperLength,
    n.upperFrontHeight,
    n.upperRearHeight,
    n.lowerLength,
    n.lowerFrontHeight,
    n.lowerRearHeight,
    n.wheelbase,
    n.cgHeight,
    n.upperRearX,
    n.lowerRearX,
  ];

  if (required.some((value) => !Number.isFinite(value))) {
    return null;
  }

  if (
    n.upperLength <= 0 ||
    n.lowerLength <= 0 ||
    n.wheelbase <= 0 ||
    n.cgHeight <= 0
  ) {
    return {
      error: "Lengths, wheelbase, and CG height must be greater than zero.",
    };
  }

  const upperRise = n.upperFrontHeight - n.upperRearHeight;
  const lowerRise = n.lowerFrontHeight - n.lowerRearHeight;

  // Equality would leave a vertical bar with zero horizontal projection.
  if (
    Math.abs(upperRise) >= n.upperLength ||
    Math.abs(lowerRise) >= n.lowerLength
  ) {
    return {
      error:
        "A bar length must be longer than the vertical difference between its mounting points.",
    };
  }

  const upperRunSquared = n.upperLength ** 2 - upperRise ** 2;
  const lowerRunSquared = n.lowerLength ** 2 - lowerRise ** 2;

  if (upperRunSquared <= 0 || lowerRunSquared <= 0) {
    return {
      error:
        "The entered bar length and mounting heights do not create a physical side-view link.",
    };
  }

  const upperRun = Math.sqrt(upperRunSquared);
  const lowerRun = Math.sqrt(lowerRunSquared);

  return calculateFourLinkFromCoordinates(
    { x: n.upperRearX, y: n.upperRearHeight },
    { x: n.upperRearX + upperRun, y: n.upperFrontHeight },
    { x: n.lowerRearX, y: n.lowerRearHeight },
    { x: n.lowerRearX + lowerRun, y: n.lowerFrontHeight },
    n.wheelbase,
    n.cgHeight
  );
}

export function calculateLadderBar(n: LadderInputs): LadderCalcResult {
  const required = [
    n.ladderLength,
    n.ladderFrontHeight,
    n.wheelbase,
    n.cgHeight,
    n.tireDiameter,
  ];

  if (required.some((value) => !Number.isFinite(value))) {
    return null;
  }

  if (
    n.ladderLength <= 0 ||
    n.wheelbase <= 0 ||
    n.cgHeight <= 0 ||
    n.tireDiameter <= 0
  ) {
    return {
      error:
        "Ladder-bar length, wheelbase, CG height, and tire diameter must be greater than zero.",
    };
  }

  const hasUpperRear = Number.isFinite(n.ladderRearUpperHeight);
  const hasLowerRear = Number.isFinite(n.ladderRearLowerHeight);

  if (hasUpperRear !== hasLowerRear) {
    return {
      error:
        "Enter both ladder-bar rear mount heights, or leave both blank. Both are needed to calculate rear spread.",
    };
  }

  const axleHeight = n.tireDiameter / 2;
  const verticalDifference = n.ladderFrontHeight - axleHeight;

  if (Math.abs(verticalDifference) >= n.ladderLength) {
    return {
      error:
        "The ladder-bar length must be longer than the vertical difference between the axle center and front mounting point.",
    };
  }

  const runSquared = n.ladderLength ** 2 - verticalDifference ** 2;
  if (runSquared <= 0) {
    return {
      error: "The ladder-bar geometry cannot reach the entered front mounting point.",
    };
  }

  const horizontalRun = Math.sqrt(runSquared);
  const icLength = horizontalRun;
  const icHeight = n.ladderFrontHeight;

  if (Math.abs(icLength) < 1e-7) {
    return {
      error: "Instant center length is too close to zero to calculate anti-squat.",
    };
  }

  const antiSquat =
    ((icHeight * n.wheelbase) / (icLength * n.cgHeight)) * 100;

  if (!Number.isFinite(antiSquat)) {
    return { error: "Anti-squat could not be calculated from the current ladder-bar geometry." };
  }

  return {
    horizontalRun,
    barAngle: Math.atan2(verticalDifference, horizontalRun) * (180 / Math.PI),
    icLength,
    icHeight,
    antiSquat,
    rearSpread:
      hasUpperRear && hasLowerRear
        ? Math.abs(n.ladderRearUpperHeight - n.ladderRearLowerHeight)
        : null,
  };
}

export function getWeightData(inputs: Inputs): WeightData | null {
  const frontWeight = parseNumber(inputs.frontWeight);
  const rearWeight = parseNumber(inputs.rearWeight);
  const wheelbase = parseNumber(inputs.wheelbase);

  if (
    !Number.isFinite(frontWeight) ||
    !Number.isFinite(rearWeight) ||
    frontWeight <= 0 ||
    rearWeight <= 0
  ) {
    return null;
  }

  const totalWeight = frontWeight + rearWeight;
  const frontBias = frontWeight / totalWeight;
  const rearBias = rearWeight / totalWeight;

  return {
    frontWeight,
    rearWeight,
    totalWeight,
    frontBias,
    rearBias,
    cgXFromRear:
      Number.isFinite(wheelbase) && wheelbase > 0
        ? wheelbase * frontBias
        : NaN,
  };
}

export function getRearBiasString(inputs: Inputs) {
  const weights = getWeightData(inputs);
  return weights ? (weights.rearBias * 100).toFixed(1) : "";
}

export function calculateDynamicCg(
  inputs: Inputs,
  rearTravel: number,
  frontTravel: number
) {
  const wheelbase = parseNumber(inputs.wheelbase);
  const staticCgHeight = parseNumber(inputs.cgHeight);
  const tireDiameter = parseNumber(inputs.tireDiameter);
  const weights = getWeightData(inputs);

  if (
    !Number.isFinite(wheelbase) ||
    wheelbase <= 0 ||
    !Number.isFinite(staticCgHeight) ||
    staticCgHeight <= 0 ||
    !Number.isFinite(rearTravel) ||
    !Number.isFinite(frontTravel)
  ) {
    return null;
  }

  // A rigid chassis cannot have a front/rear vertical difference larger than
  // its wheelbase. Reject it rather than silently feeding asin an impossible
  // value and hiding a bad model state.
  const relativeFrontRise = frontTravel - rearTravel;
  if (Math.abs(relativeFrontRise) >= wheelbase) {
    return null;
  }

  const axleHeight =
    Number.isFinite(tireDiameter) && tireDiameter > 0
      ? tireDiameter / 2
      : 0;

  const cgX =
    weights && Number.isFinite(weights.cgXFromRear)
      ? weights.cgXFromRear
      : wheelbase * 0.5;

  const pitchAngle = Math.asin(relativeFrontRise / wheelbase);

  // Rotate the CG vector about the rear-axle station, then add rear chassis
  // translation. This is exact rigid-body planar geometry for the assumed
  // axle-station displacements.
  const cgYRelativeToRearAxle = staticCgHeight - axleHeight;
  const dynamicCgHeight =
    axleHeight +
    rearTravel +
    cgX * Math.sin(pitchAngle) +
    cgYRelativeToRearAxle * Math.cos(pitchAngle);

  const dynamicCgX =
    cgX * Math.cos(pitchAngle) -
    cgYRelativeToRearAxle * Math.sin(pitchAngle);

  if (!Number.isFinite(dynamicCgHeight) || dynamicCgHeight <= 0) {
    return null;
  }

  return {
    dynamicCgHeight,
    dynamicCgX,
    pitchDegrees: pitchAngle * (180 / Math.PI),
    usedWeightBias: Boolean(weights),
  };
}
