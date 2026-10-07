import type {
  CalcResult,
  Car,
  DragyPoint,
  LadderInputs,
  LadderResult,
  NumericInputs,
  SuccessfulResult,
  WeightData,
} from "../types";
import {
  calculateFourLink,
  calculateLadderBar,
  parseNumber,
  toLadderInputs,
  toNumericInputs,
} from "./geometry";
import { interpolateDragy } from "../telemetry/dragy";

export type ModelPoint = {
  x: number;
  y: number;
};

export type FourLinkKinematics = {
  rearUpper: ModelPoint;
  rearLower: ModelPoint;
  frontUpper: ModelPoint;
  frontLower: ModelPoint;
  axleRotation: number;
  chassisForeAftShift: number;
};

export type ModelGeometryState = {
  result: SuccessfulResult | LadderResult;
  fourLinkInputs?: NumericInputs;
  ladderInputs?: LadderInputs;
  kinematics?: FourLinkKinematics;
  dynamicCgHeight: number;
};

export type ModelSnapshot = {
  travel: number;
  velocity: number;
  acceleration: number;
  currentG: number;
  speed: number | null;
  geometry: ModelGeometryState;
  driveForce: number;
  inertialLoadTransfer: number;
  geometryVerticalReaction: number;
  excessAntiSquatReaction: number;
  rearTireLoadEstimate: number;
  frontTireLoadEstimate: number;
  springForce: number;
  dampingForce: number;
  jackingTireLoad: number;
  baseRearTireLoad: number;
  estimatedWheelRate: number;
  travelLimited: boolean;
  asSensitivity: number;
  icSensitivity: number;
  frontVisualLift: number;
  dynamicCgHeight: number;
  wheelie: boolean;
  rearSpread: number | null;
  upperLinkForce: number | null;
  lowerLinkForce: number | null;
  axleTorqueCouple: number | null;
};

function rotateModelPoint(
  point: ModelPoint,
  origin: ModelPoint,
  radians: number
): ModelPoint {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return {
    x: origin.x + dx * cosine - dy * sine,
    y: origin.y + dx * sine + dy * cosine,
  };
}

function calculateFourLinkFromPoints(
  upperRear: ModelPoint,
  upperFront: ModelPoint,
  lowerRear: ModelPoint,
  lowerFront: ModelPoint,
  wheelbase: number,
  cgHeight: number
): CalcResult {
  const upperDx = upperFront.x - upperRear.x;
  const upperDy = upperFront.y - upperRear.y;
  const lowerDx = lowerFront.x - lowerRear.x;
  const lowerDy = lowerFront.y - lowerRear.y;

  if (
    Math.abs(upperDx) < 0.000001 ||
    Math.abs(lowerDx) < 0.000001
  ) {
    return { error: "A link is too close to vertical for a usable side-view instant center." };
  }

  const upperSlope = upperDy / upperDx;
  const lowerSlope = lowerDy / lowerDx;
  const denominator = upperSlope - lowerSlope;

  if (Math.abs(denominator) < 0.000001) {
    return { error: "The upper and lower links are parallel or nearly parallel, so there is no usable finite instant center." };
  }

  const icLength =
    (lowerRear.y - upperRear.y +
      upperSlope * upperRear.x -
      lowerSlope * lowerRear.x) /
    denominator;

  const icHeight =
    upperRear.y + upperSlope * (icLength - upperRear.x);

  if (
    !Number.isFinite(icLength) ||
    !Number.isFinite(icHeight) ||
    Math.abs(icLength) < 0.000001 ||
    cgHeight <= 0 ||
    wheelbase <= 0
  ) {
    return { error: "The current linkage position does not produce a usable instant center." };
  }

  return {
    upperRun: upperDx,
    lowerRun: lowerDx,
    upperAngle: Math.atan2(upperDy, upperDx) * (180 / Math.PI),
    lowerAngle: Math.atan2(lowerDy, lowerDx) * (180 / Math.PI),
    upperSlope,
    lowerSlope,
    icLength,
    icHeight,
    antiSquat:
      ((icHeight * wheelbase) / (icLength * cgHeight)) * 100,
  };
}

function solveRigidFourLinkAtTravel(
  car: Car,
  travel: number,
  dynamicCgHeight: number
): ModelGeometryState | null {
  const baseline = toNumericInputs(car.calculatorInputs);
  const staticResult = calculateFourLink(baseline);

  if (!staticResult || "error" in staticResult) return null;

  const tireRadius =
    Number.isFinite(baseline.tireDiameter) && baseline.tireDiameter > 0
      ? baseline.tireDiameter / 2
      : 14;

  const axleCenter: ModelPoint = { x: 0, y: tireRadius };
  const rearUpper0: ModelPoint = { x: 0, y: baseline.upperRearHeight };
  const rearLower0: ModelPoint = { x: 0, y: baseline.lowerRearHeight };
  const frontUpper0: ModelPoint = {
    x: staticResult.upperRun,
    y: baseline.upperFrontHeight,
  };
  const frontLower0: ModelPoint = {
    x: staticResult.lowerRun,
    y: baseline.lowerFrontHeight,
  };

  let chassisShift = 0;
  let axleRotation = 0;

  const evaluate = (shift: number, rotation: number, stepTravel: number) => {
    const rearUpper = rotateModelPoint(rearUpper0, axleCenter, rotation);
    const rearLower = rotateModelPoint(rearLower0, axleCenter, rotation);
    const frontUpper = {
      x: frontUpper0.x + shift,
      y: frontUpper0.y + stepTravel,
    };
    const frontLower = {
      x: frontLower0.x + shift,
      y: frontLower0.y + stepTravel,
    };

    const upperDx = frontUpper.x - rearUpper.x;
    const upperDy = frontUpper.y - rearUpper.y;
    const lowerDx = frontLower.x - rearLower.x;
    const lowerDy = frontLower.y - rearLower.y;

    return {
      rearUpper,
      rearLower,
      frontUpper,
      frontLower,
      f1: upperDx * upperDx + upperDy * upperDy - baseline.upperLength ** 2,
      f2: lowerDx * lowerDx + lowerDy * lowerDy - baseline.lowerLength ** 2,
    };
  };

  // Continuation keeps Newton's method on the same physical linkage branch as
  // the static setup instead of allowing it to jump to a mirrored solution.
  const segments = Math.max(1, Math.ceil(Math.abs(travel) / 0.2));

  for (let segment = 1; segment <= segments; segment += 1) {
    const stepTravel = travel * (segment / segments);

    for (let iteration = 0; iteration < 28; iteration += 1) {
      const state = evaluate(chassisShift, axleRotation, stepTravel);
      const error = Math.hypot(state.f1, state.f2);
      if (error < 0.000001) break;

      const shiftStep = 0.0001;
      const rotationStep = 0.000001;
      const shiftState = evaluate(
        chassisShift + shiftStep,
        axleRotation,
        stepTravel
      );
      const rotationState = evaluate(
        chassisShift,
        axleRotation + rotationStep,
        stepTravel
      );

      const j11 = (shiftState.f1 - state.f1) / shiftStep;
      const j21 = (shiftState.f2 - state.f2) / shiftStep;
      const j12 = (rotationState.f1 - state.f1) / rotationStep;
      const j22 = (rotationState.f2 - state.f2) / rotationStep;
      const determinant = j11 * j22 - j12 * j21;

      if (!Number.isFinite(determinant) || Math.abs(determinant) < 0.0000001) {
        return null;
      }

      let shiftCorrection = (-state.f1 * j22 + j12 * state.f2) / determinant;
      let rotationCorrection = (-j11 * state.f2 + state.f1 * j21) / determinant;

      const correctionMagnitude = Math.hypot(
        shiftCorrection,
        rotationCorrection * 20
      );
      if (correctionMagnitude > 1) {
        shiftCorrection /= correctionMagnitude;
        rotationCorrection /= correctionMagnitude;
      }

      chassisShift += shiftCorrection;
      axleRotation += rotationCorrection;
    }
  }

  const state = evaluate(chassisShift, axleRotation, travel);
  if (Math.hypot(state.f1, state.f2) > 0.02) return null;

  const result = calculateFourLinkFromPoints(
    state.rearUpper,
    state.frontUpper,
    state.rearLower,
    state.frontLower,
    baseline.wheelbase,
    dynamicCgHeight
  );

  if (!result || "error" in result) return null;

  return {
    result,
    dynamicCgHeight,
    fourLinkInputs: {
      ...baseline,
      upperRearHeight: state.rearUpper.y,
      upperFrontHeight: state.frontUpper.y,
      lowerRearHeight: state.rearLower.y,
      lowerFrontHeight: state.frontLower.y,
      cgHeight: dynamicCgHeight,
    },
    kinematics: {
      rearUpper: state.rearUpper,
      rearLower: state.rearLower,
      frontUpper: state.frontUpper,
      frontLower: state.frontLower,
      axleRotation,
      chassisForeAftShift: chassisShift,
    },
  };
}

function getModelCgHeightFromRearTravel(
  car: Car,
  weights: WeightData,
  rearTravel: number
) {
  const wheelbase = parseNumber(car.calculatorInputs.wheelbase);
  const staticCgHeight = parseNumber(car.calculatorInputs.cgHeight);

  if (
    !Number.isFinite(wheelbase) ||
    wheelbase <= 0 ||
    !Number.isFinite(staticCgHeight) ||
    staticCgHeight <= 0
  ) {
    return null;
  }

  // Rear travel changes rear geometry. The CG follows only the fraction of
  // that rear body motion implied by its fore/aft position. Front rise is not
  // fed back into the rear force solution unless measured front travel exists.
  const rearMotionFraction =
    1 - weights.cgXFromRear / wheelbase;

  return Math.max(
    1,
    staticCgHeight +
      rearTravel * rearMotionFraction
  );
}

function estimateFrontVisualLift(
  car: Car,
  weights: WeightData,
  currentG: number,
  dynamicCgHeight: number
) {
  const wheelbase = parseNumber(car.calculatorInputs.wheelbase);

  if (
    !Number.isFinite(wheelbase) ||
    wheelbase <= 0
  ) {
    return 0;
  }

  // Front travel is visualization only in the beta model. Rear suspension
  // force is solved independently from this estimate.
  const loadTransfer =
    (weights.totalWeight * currentG * dynamicCgHeight) /
    wheelbase;

  const frontSprungWeight = Math.max(
    1,
    weights.frontWeight * 0.9
  );
  const frontMass = frontSprungWeight / 386.09;
  const frontNaturalFrequencyHz = 1.75;
  const frontWheelRate = Math.max(
    90,
    frontMass * (2 * Math.PI * frontNaturalFrequencyHz) ** 2
  );

  return Math.max(
    0,
    Math.min(
      4.5,
      loadTransfer / frontWheelRate
    )
  );
}

export function getModelGeometryAtTravel(
  car: Car,
  travel: number,
  dynamicCgHeight: number
): ModelGeometryState | null {
  if (car.suspensionType === "ladder-bar") {
    const baseline = toLadderInputs(car.calculatorInputs);
    const ladderInputs: LadderInputs = {
      ...baseline,
      ladderFrontHeight: baseline.ladderFrontHeight + travel,
      cgHeight: dynamicCgHeight,
    };
    const result = calculateLadderBar(ladderInputs);

    if (!result || "error" in result) return null;

    return { result, ladderInputs, dynamicCgHeight };
  }

  return solveRigidFourLinkAtTravel(car, travel, dynamicCgHeight);
}

function getModelGAtTime(
  dragyPoints: DragyPoint[],
  peakG: number,
  time: number
) {
  if (dragyPoints.length > 0) {
    const point = interpolateDragy(dragyPoints, time);
    if (point?.g !== null && point?.g !== undefined) {
      return Math.max(0, point.g);
    }
  }

  if (time <= 0) return 0;

  // Generic transbrake-release trace for bench testing only. Imported
  // telemetry replaces this curve.
  const rise = Math.min(
    1,
    1 - Math.exp(-time / 0.04)
  );
  const decayProgress = Math.max(
    0,
    Math.min(1, (time - 0.22) / 1.28)
  );
  const decay =
    1 - 0.34 * decayProgress;

  return Math.max(
    0,
    peakG * rise * decay
  );
}

function getModelSpeedAtTime(
  dragyPoints: DragyPoint[],
  time: number
) {
  if (dragyPoints.length === 0) return null;
  return interpolateDragy(dragyPoints, time)?.speed ?? null;
}

function getGeometrySensitivity(
  car: Car,
  weights: WeightData,
  travel: number
) {
  const sample = 0.2;

  const lowCg = getModelCgHeightFromRearTravel(
    car,
    weights,
    travel - sample
  );
  const highCg = getModelCgHeightFromRearTravel(
    car,
    weights,
    travel + sample
  );

  if (lowCg === null || highCg === null) {
    return {
      asSensitivity: 0,
      icSensitivity: 0,
    };
  }

  const low = getModelGeometryAtTravel(
    car,
    travel - sample,
    lowCg
  );
  const high = getModelGeometryAtTravel(
    car,
    travel + sample,
    highCg
  );

  if (!low || !high) {
    return {
      asSensitivity: 0,
      icSensitivity: 0,
    };
  }

  const span = sample * 2;

  return {
    asSensitivity:
      (high.result.antiSquat -
        low.result.antiSquat) /
      span,
    icSensitivity:
      (high.result.icLength -
        low.result.icLength) /
      span,
  };
}

function getFourLinkForceBreakdown(
  car: Car,
  geometry: ModelGeometryState,
  driveForce: number,
  geometryVerticalReaction: number
) {
  if (
    car.suspensionType !== "4-link" ||
    !geometry.kinematics
  ) {
    return {
      rearSpread: null,
      upperLinkForce: null,
      lowerLinkForce: null,
      axleTorqueCouple: null,
    };
  }

  const k = geometry.kinematics;
  const upperDx = k.frontUpper.x - k.rearUpper.x;
  const upperDy = k.frontUpper.y - k.rearUpper.y;
  const lowerDx = k.frontLower.x - k.rearLower.x;
  const lowerDy = k.frontLower.y - k.rearLower.y;
  const upperLength = Math.hypot(upperDx, upperDy);
  const lowerLength = Math.hypot(lowerDx, lowerDy);

  if (upperLength < 0.001 || lowerLength < 0.001) {
    return {
      rearSpread: Math.abs(k.rearUpper.y - k.rearLower.y),
      upperLinkForce: null,
      lowerLinkForce: null,
      axleTorqueCouple: null,
    };
  }

  const ux = upperDx / upperLength;
  const uy = upperDy / upperLength;
  const lx = lowerDx / lowerLength;
  const ly = lowerDy / lowerLength;
  const determinant = ux * ly - lx * uy;

  if (Math.abs(determinant) < 0.00001) {
    return {
      rearSpread: Math.abs(k.rearUpper.y - k.rearLower.y),
      upperLinkForce: null,
      lowerLinkForce: null,
      axleTorqueCouple: null,
    };
  }

  // Resolve the suspension reaction into the actual two-force-member link
  // directions. Positive coefficient = compression at the chassis; negative =
  // tension. This makes bar angle/spread influence the displayed link loads
  // through the geometry instead of through an arbitrary spread multiplier.
  const upperLinkForce =
    (driveForce * ly - lx * geometryVerticalReaction) / determinant;
  const lowerLinkForce =
    (ux * geometryVerticalReaction - driveForce * uy) / determinant;

  const tireDiameter = parseNumber(car.calculatorInputs.tireDiameter);
  const tireRadius =
    Number.isFinite(tireDiameter) && tireDiameter > 0
      ? tireDiameter / 2
      : 14;

  return {
    rearSpread: Math.abs(k.rearUpper.y - k.rearLower.y),
    upperLinkForce,
    lowerLinkForce,
    axleTorqueCouple: driveForce * tireRadius,
  };
}

export function simulateModelState(
  car: Car,
  weights: WeightData,
  dragyPoints: DragyPoint[],
  peakG: number,
  endTime: number
): ModelSnapshot | null {
  const wheelbase = parseNumber(
    car.calculatorInputs.wheelbase
  );
  const staticCgHeight = parseNumber(
    car.calculatorInputs.cgHeight
  );

  if (
    !Number.isFinite(wheelbase) ||
    wheelbase <= 0 ||
    !Number.isFinite(staticCgHeight) ||
    staticCgHeight <= 0
  ) {
    return null;
  }

  // Fixed physical defaults only supply spring/damper information that
  // geometry alone cannot know. They are not a user response control.
  const rearSprungWeight = Math.max(
    1,
    weights.rearWeight * 0.86
  );
  const rearMass =
    rearSprungWeight / 386.09;

  // Geometry cannot determine spring/shock force by itself. Use one fixed,
  // physically-scaled drag-car baseline rather than an arbitrary travel knob:
  // a 1.40 Hz rear ride frequency automatically scales wheel rate with sprung
  // mass. This is only the default when real spring/shock data is unavailable.
  const rearNaturalFrequencyHz = 1.4;
  const estimatedWheelRate = Math.max(
    90,
    rearMass * (2 * Math.PI * rearNaturalFrequencyHz) ** 2
  );

  const dampingRatio = 0.55;
  const damping =
    2 *
    dampingRatio *
    Math.sqrt(
      estimatedWheelRate * rearMass
    );

  const nominalStep = 0.0015;
  const steps = Math.max(
    1,
    Math.ceil(
      Math.max(0, endTime) /
        nominalStep
    )
  );
  const dt =
    endTime > 0
      ? endTime / steps
      : nominalStep;

  let travel = 0;
  let velocity = 0;
  let acceleration = 0;
  let travelLimited = false;

  for (
    let index = 0;
    index < steps;
    index += 1
  ) {
    const t = index * dt;
    const currentG = getModelGAtTime(
      dragyPoints,
      peakG,
      t
    );

    const dynamicCgHeight =
      getModelCgHeightFromRearTravel(
        car,
        weights,
        travel
      );

    if (dynamicCgHeight === null) {
      return null;
    }

    const geometry =
      getModelGeometryAtTravel(
        car,
        travel,
        dynamicCgHeight
      );

    if (!geometry) break;

    const driveForce =
      weights.totalWeight * currentG;

    // Live contact-patch -> IC slope gives the geometric vertical reaction.
    const geometryVerticalReaction =
      Math.abs(
        geometry.result.icLength
      ) > 0.000001
        ? driveForce *
          (geometry.result.icHeight /
            geometry.result.icLength)
        : 0;

    // Longitudinal load-transfer demand at the current CG height.
    const inertialLoadTransfer =
      (driveForce *
        dynamicCgHeight) /
      wheelbase;

    // Positive = separation tendency, negative = squat tendency.
    const excessAntiSquatReaction =
      geometryVerticalReaction -
      inertialLoadTransfer;

    const springForce =
      estimatedWheelRate * travel;
    const dampingForce =
      damping * velocity;

    const netVerticalForce =
      excessAntiSquatReaction -
      springForce -
      dampingForce;

    acceleration =
      netVerticalForce / rearMass;

    velocity +=
      acceleration * dt;
    travel += velocity * dt;

    if (travel >= 5) {
      travel = 5;
      velocity = 0;
      acceleration = 0;
      travelLimited = true;
      break;
    }

    if (travel <= -5) {
      travel = -5;
      velocity = 0;
      acceleration = 0;
      travelLimited = true;
      break;
    }
  }

  const currentG = getModelGAtTime(
    dragyPoints,
    peakG,
    endTime
  );

  const dynamicCgHeight =
    getModelCgHeightFromRearTravel(
      car,
      weights,
      travel
    );

  if (dynamicCgHeight === null) {
    return null;
  }

  const geometry =
    getModelGeometryAtTravel(
      car,
      travel,
      dynamicCgHeight
    );

  if (!geometry) return null;

  const speed =
    getModelSpeedAtTime(
      dragyPoints,
      endTime
    );

  const driveForce =
    weights.totalWeight * currentG;

  const geometryVerticalReaction =
    Math.abs(
      geometry.result.icLength
    ) > 0.000001
      ? driveForce *
        (geometry.result.icHeight /
          geometry.result.icLength)
      : 0;

  const inertialLoadTransfer =
    (driveForce *
      dynamicCgHeight) /
    wheelbase;

  const excessAntiSquatReaction =
    geometryVerticalReaction -
    inertialLoadTransfer;

  const springForce =
    estimatedWheelRate * travel;
  const dampingForce =
    damping * velocity;

  if (!travelLimited) {
    acceleration =
      (excessAntiSquatReaction -
        springForce -
        dampingForce) /
      rearMass;
  } else {
    acceleration = 0;
  }

  // Base axle loads are the quasi-static longitudinal load-transfer result.
  const requestedBaseRear =
    weights.rearWeight +
    inertialLoadTransfer;

  const baseRearTireLoad =
    Math.max(
      0,
      Math.min(
        weights.totalWeight,
        requestedBaseRear
      )
    );

  const baseFrontTireLoad =
    Math.max(
      0,
      weights.totalWeight -
        baseRearTireLoad
    );

  // Vertical chassis acceleration changes total normal force. It should NOT be
  // forced to sum back to vehicle weight while the body is accelerating.
  const rawJackingTireLoad =
    travelLimited
      ? 0
      : rearMass * acceleration;

  const rearTireLoadEstimate =
    Math.max(
      0,
      baseRearTireLoad +
        rawJackingTireLoad
    );

  const frontTireLoadEstimate =
    baseFrontTireLoad;

  const jackingTireLoad =
    rearTireLoadEstimate -
    baseRearTireLoad;

  const sensitivity =
    getGeometrySensitivity(
      car,
      weights,
      travel
    );

  const linkForces =
    getFourLinkForceBreakdown(
      car,
      geometry,
      driveForce,
      geometryVerticalReaction
    );

  const frontVisualLift =
    estimateFrontVisualLift(
      car,
      weights,
      currentG,
      dynamicCgHeight
    );

  return {
    travel,
    velocity,
    acceleration,
    currentG,
    speed,
    geometry,
    driveForce,
    inertialLoadTransfer,
    geometryVerticalReaction,
    excessAntiSquatReaction,
    rearTireLoadEstimate,
    frontTireLoadEstimate,
    springForce,
    dampingForce,
    jackingTireLoad,
    baseRearTireLoad,
    estimatedWheelRate,
    travelLimited,
    asSensitivity:
      sensitivity.asSensitivity,
    icSensitivity:
      sensitivity.icSensitivity,
    frontVisualLift,
    dynamicCgHeight,
    wheelie:
      baseFrontTireLoad <= 0.5,
    ...linkForces,
  };
}

