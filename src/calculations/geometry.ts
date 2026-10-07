import type {
  CalcResult,
  Inputs,
  LadderCalcResult,
  LadderInputs,
  NumericInputs,
  WeightData,
} from "../types";

export function parseNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return NaN;
  }

  return Number(value);
}

export function toNumericInputs(inputs: Inputs): NumericInputs {
  return {
    upperLength: parseNumber(inputs.upperLength),
    upperFrontHeight: parseNumber(inputs.upperFrontHeight),
    upperRearHeight: parseNumber(inputs.upperRearHeight),
    lowerLength: parseNumber(inputs.lowerLength),
    lowerFrontHeight: parseNumber(inputs.lowerFrontHeight),
    lowerRearHeight: parseNumber(inputs.lowerRearHeight),
    wheelbase: parseNumber(inputs.wheelbase),
    cgHeight: parseNumber(inputs.cgHeight),
    tireDiameter: parseNumber(inputs.tireDiameter),
  };
}

export function toLadderInputs(inputs: Inputs): LadderInputs {
  return {
    ladderLength: parseNumber(inputs.ladderLength),
    ladderFrontHeight: parseNumber(
      inputs.ladderFrontHeight
    ),
    wheelbase: parseNumber(inputs.wheelbase),
    cgHeight: parseNumber(inputs.cgHeight),
    tireDiameter: parseNumber(inputs.tireDiameter),
  };
}

export function calculateLadderBar(
  n: LadderInputs
): LadderCalcResult {
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

  const axleHeight = n.tireDiameter / 2;
  const verticalDifference =
    n.ladderFrontHeight - axleHeight;

  if (
    Math.abs(verticalDifference) >= n.ladderLength
  ) {
    return {
      error:
        "The ladder-bar length must be longer than the vertical difference between the axle center and front mounting point.",
    };
  }

  const horizontalRun = Math.sqrt(
    n.ladderLength ** 2 -
      verticalDifference ** 2
  );

  const barAngle =
    Math.atan2(
      verticalDifference,
      horizontalRun
    ) *
    (180 / Math.PI);

  const icLength = horizontalRun;
  const icHeight = n.ladderFrontHeight;

  if (Math.abs(icLength) < 0.000001) {
    return {
      error:
        "Instant center length is too close to zero to calculate anti-squat.",
    };
  }

  const antiSquat =
    ((icHeight * n.wheelbase) /
      (icLength * n.cgHeight)) *
    100;

  return {
    horizontalRun,
    barAngle,
    icLength,
    icHeight,
    antiSquat,
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
    staticCgHeight <= 0
  ) {
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

  // Rear/front travel are chassis vertical displacements at the
  // rear/front axle stations. Their difference defines pitch.
  const relativeFrontRise = frontTravel - rearTravel;
  const pitchAngle = Math.asin(
    Math.max(
      -1,
      Math.min(1, relativeFrontRise / wheelbase)
    )
  );

  // Rotate the CG vector about the rear-axle station, then add
  // rear chassis translation. Including the CG's vertical offset
  // keeps this more accurate than simply adding x*sin(theta).
  const cgYRelativeToRearAxle = staticCgHeight - axleHeight;
  const dynamicCgHeight =
    axleHeight +
    rearTravel +
    cgX * Math.sin(pitchAngle) +
    cgYRelativeToRearAxle * Math.cos(pitchAngle);

  const dynamicCgX =
    cgX * Math.cos(pitchAngle) -
    cgYRelativeToRearAxle * Math.sin(pitchAngle);

  return {
    dynamicCgHeight,
    dynamicCgX,
    pitchDegrees: pitchAngle * (180 / Math.PI),
    usedWeightBias: Boolean(weights),
  };
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
      error:
        "Lengths, wheelbase, and CG height must be greater than zero.",
    };
  }

  const upperRise =
    n.upperFrontHeight - n.upperRearHeight;

  const lowerRise =
    n.lowerFrontHeight - n.lowerRearHeight;

  if (
    Math.abs(upperRise) >= n.upperLength ||
    Math.abs(lowerRise) >= n.lowerLength
  ) {
    return {
      error:
        "A bar length must be longer than the vertical difference between its mounting points.",
    };
  }

  const upperRun = Math.sqrt(
    n.upperLength ** 2 - upperRise ** 2
  );

  const lowerRun = Math.sqrt(
    n.lowerLength ** 2 - lowerRise ** 2
  );

  const upperSlope = upperRise / upperRun;
  const lowerSlope = lowerRise / lowerRun;
  const denominator = upperSlope - lowerSlope;

  if (Math.abs(denominator) < 0.000001) {
    return {
      error:
        "The upper and lower links are parallel or nearly parallel, so there is no usable finite instant center.",
    };
  }

  const icLength =
    (n.lowerRearHeight - n.upperRearHeight) /
    denominator;

  const icHeight =
    n.upperRearHeight + upperSlope * icLength;

  const upperAngle =
    Math.atan2(upperRise, upperRun) * (180 / Math.PI);

  const lowerAngle =
    Math.atan2(lowerRise, lowerRun) * (180 / Math.PI);

  if (Math.abs(icLength) < 0.000001) {
    return {
      error:
        "Instant center length is too close to zero to calculate anti-squat.",
    };
  }

  const antiSquat =
    ((icHeight * n.wheelbase) /
      (icLength * n.cgHeight)) *
    100;

  return {
    upperRun,
    lowerRun,
    upperAngle,
    lowerAngle,
    upperSlope,
    lowerSlope,
    icLength,
    icHeight,
    antiSquat,
  };
}

