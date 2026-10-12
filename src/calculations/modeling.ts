import type {
  Car,
  DragyPoint,
  LadderInputs,
  LadderResult,
  NumericInputs,
  SuccessfulResult,
  WeightData,
} from "../types";
import {
  calculateDynamicCg,
  calculateFourLink,
  calculateFourLinkFromCoordinates,
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

export type LadderKinematics = {
  frontPivot: ModelPoint;
  rearUpper?: ModelPoint;
  rearLower?: ModelPoint;
  axleRotation: number;
  chassisForeAftShift: number;
};

export type ModelGeometryState = {
  result: SuccessfulResult | LadderResult;
  fourLinkInputs?: NumericInputs;
  ladderInputs?: LadderInputs;
  kinematics?: FourLinkKinematics;
  ladderKinematics?: LadderKinematics;
  dynamicCgHeight: number;
};

export type ModelSimulationOptions = {
  frontTravelLimit?: number;
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
  wheelRateSource: "entered-spring-rate" | "estimated-ride-frequency" | "geometry-only";
  travelLimited: boolean;
  kinematicLimited: boolean;
  asSensitivity: number;
  icSensitivity: number;
  frontVisualLift: number;
  frontTravelLimit: number;
  frontTravelLimited: boolean;
  dynamicCgHeight: number;
  wheelie: boolean;
  rearSpread: number | null;
  upperLinkForce: number | null;
  lowerLinkForce: number | null;
  axleTorqueCouple: number | null;
};

const GRAVITY_IN_PER_SEC2 = 386.09;
const REAR_TRAVEL_ENVELOPE = 5;

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

function solveRigidFourLinkAtTravel(
  car: Car,
  travel: number,
  dynamicCgHeight: number,
  frontTravel = 0
): ModelGeometryState | null {
  const baseline = toNumericInputs(car.calculatorInputs);
  const staticResult = calculateFourLink(baseline);

  if (!staticResult || "error" in staticResult) return null;
  if (
    !Number.isFinite(travel) ||
    !Number.isFinite(frontTravel) ||
    !Number.isFinite(dynamicCgHeight) ||
    dynamicCgHeight <= 0
  ) {
    return null;
  }

  const tireRadius =
    Number.isFinite(baseline.tireDiameter) && baseline.tireDiameter > 0
      ? baseline.tireDiameter / 2
      : 14;

  const axleCenter: ModelPoint = { x: 0, y: tireRadius };
  const rearUpper0: ModelPoint = {
    x: baseline.upperRearX,
    y: baseline.upperRearHeight,
  };
  const rearLower0: ModelPoint = {
    x: baseline.lowerRearX,
    y: baseline.lowerRearHeight,
  };
  const frontUpper0: ModelPoint = {
    x: baseline.upperRearX + staticResult.upperRun,
    y: baseline.upperFrontHeight,
  };
  const frontLower0: ModelPoint = {
    x: baseline.lowerRearX + staticResult.lowerRun,
    y: baseline.lowerFrontHeight,
  };

  let chassisShift = 0;
  let axleRotation = 0;

  // Rear travel and front travel define the rigid-body pitch of the chassis
  // between axle stations. The chassis-side bracket pair must rotate with the
  // body; translating both pivots straight upward gives the wrong IC migration
  // once the nose is appreciably higher or lower than the rear of the car.
  const getPitchAtRearTravel = (stepTravel: number) => {
    const relativeFrontRise = frontTravel - stepTravel;
    if (Math.abs(relativeFrontRise) >= baseline.wheelbase) return null;
    return Math.asin(relativeFrontRise / baseline.wheelbase);
  };

  const evaluate = (shift: number, rotation: number, stepTravel: number) => {
    const chassisPitch = getPitchAtRearTravel(stepTravel);
    if (chassisPitch === null) return null;

    const rearUpper = rotateModelPoint(rearUpper0, axleCenter, rotation);
    const rearLower = rotateModelPoint(rearLower0, axleCenter, rotation);

    const rotatedFrontUpper = rotateModelPoint(frontUpper0, axleCenter, chassisPitch);
    const rotatedFrontLower = rotateModelPoint(frontLower0, axleCenter, chassisPitch);
    const frontUpper = {
      x: rotatedFrontUpper.x + shift,
      y: rotatedFrontUpper.y + stepTravel,
    };
    const frontLower = {
      x: rotatedFrontLower.x + shift,
      y: rotatedFrontLower.y + stepTravel,
    };

    const upperDx = frontUpper.x - rearUpper.x;
    const upperDy = frontUpper.y - rearUpper.y;
    const lowerDx = frontLower.x - rearLower.x;
    const lowerDy = frontLower.y - rearLower.y;

    const upperRearDx0 = rearUpper0.x - axleCenter.x;
    const upperRearDy0 = rearUpper0.y - axleCenter.y;
    const lowerRearDx0 = rearLower0.x - axleCenter.x;
    const lowerRearDy0 = rearLower0.y - axleCenter.y;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);

    const dRearUpperDxDphi = -upperRearDx0 * sine - upperRearDy0 * cosine;
    const dRearUpperDyDphi = upperRearDx0 * cosine - upperRearDy0 * sine;
    const dRearLowerDxDphi = -lowerRearDx0 * sine - lowerRearDy0 * cosine;
    const dRearLowerDyDphi = lowerRearDx0 * cosine - lowerRearDy0 * sine;

    const f1 = upperDx * upperDx + upperDy * upperDy - baseline.upperLength ** 2;
    const f2 = lowerDx * lowerDx + lowerDy * lowerDy - baseline.lowerLength ** 2;

    // Exact Jacobian of the two fixed-link-length constraints.
    const j11 = 2 * upperDx;
    const j21 = 2 * lowerDx;
    const j12 =
      -2 *
      (upperDx * dRearUpperDxDphi + upperDy * dRearUpperDyDphi);
    const j22 =
      -2 *
      (lowerDx * dRearLowerDxDphi + lowerDy * dRearLowerDyDphi);

    return {
      rearUpper,
      rearLower,
      frontUpper,
      frontLower,
      f1,
      f2,
      j11,
      j12,
      j21,
      j22,
    };
  };

  // Continuation prevents the nonlinear solve from jumping to the mirrored
  // linkage branch. 0.10 in steps are small enough for the very short upper
  // bars commonly used in drag-race 4-links.
  const segments = Math.max(1, Math.ceil(Math.abs(travel) / 0.1));

  for (let segment = 1; segment <= segments; segment += 1) {
    const stepTravel = travel * (segment / segments);
    let converged = false;

    for (let iteration = 0; iteration < 40; iteration += 1) {
      const state = evaluate(chassisShift, axleRotation, stepTravel);
      if (!state) return null;
      const error = Math.hypot(state.f1, state.f2);

      if (error < 1e-8) {
        converged = true;
        break;
      }

      const determinant = state.j11 * state.j22 - state.j12 * state.j21;
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) {
        return null;
      }

      let shiftCorrection =
        (-state.f1 * state.j22 + state.j12 * state.f2) / determinant;
      let rotationCorrection =
        (-state.j11 * state.f2 + state.f1 * state.j21) / determinant;

      if (!Number.isFinite(shiftCorrection) || !Number.isFinite(rotationCorrection)) {
        return null;
      }

      // Damped Newton step. These are numerical safeguards, not suspension
      // behavior limits; the continuation loop still converges to the exact
      // rigid-link closure when a physical branch exists.
      const scale = Math.max(
        1,
        Math.abs(shiftCorrection) / 0.5,
        Math.abs(rotationCorrection) / 0.03
      );
      shiftCorrection /= scale;
      rotationCorrection /= scale;

      chassisShift += shiftCorrection;
      axleRotation += rotationCorrection;
    }

    if (!converged) {
      const check = evaluate(chassisShift, axleRotation, stepTravel);
      if (!check || Math.hypot(check.f1, check.f2) > 1e-5) return null;
    }
  }

  const state = evaluate(chassisShift, axleRotation, travel);
  if (!state || Math.hypot(state.f1, state.f2) > 1e-5) return null;

  const result = calculateFourLinkFromCoordinates(
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
      upperRearX: state.rearUpper.x,
      lowerRearX: state.rearLower.x,
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

function solveLadderAtTravel(
  car: Car,
  travel: number,
  dynamicCgHeight: number,
  frontTravel = 0
): ModelGeometryState | null {
  const baseline = toLadderInputs(car.calculatorInputs);
  const baselineResult = calculateLadderBar(baseline);
  if (!baselineResult || "error" in baselineResult) return null;

  const axleHeight = baseline.tireDiameter / 2;
  const axleCenter = { x: 0, y: axleHeight };
  const relativeFrontRise = frontTravel - travel;
  if (Math.abs(relativeFrontRise) >= baseline.wheelbase) return null;
  const chassisPitch = Math.asin(relativeFrontRise / baseline.wheelbase);

  const staticFrontPivot = {
    x: baselineResult.horizontalRun,
    y: baseline.ladderFrontHeight,
  };
  const pitchedFrontPivot = rotateModelPoint(
    staticFrontPivot,
    axleCenter,
    chassisPitch
  );
  const liveFrontY = pitchedFrontPivot.y + travel;
  const verticalDifference = liveFrontY - axleHeight;
  const runSquared = baseline.ladderLength ** 2 - verticalDifference ** 2;
  if (runSquared <= 0) return null;

  // Choose the forward branch of the front-pivot circle and solve the chassis
  // fore/aft translation required to close the rigid ladder bar exactly.
  const liveFrontX = Math.sqrt(runSquared);
  const chassisShift = liveFrontX - pitchedFrontPivot.x;

  const ladderInputs: LadderInputs = {
    ...baseline,
    ladderFrontHeight: liveFrontY,
    cgHeight: dynamicCgHeight,
  };
  const result = calculateLadderBar(ladderInputs);
  if (!result || "error" in result) return null;

  const baselineAngle = Math.atan2(
    baseline.ladderFrontHeight - axleHeight,
    baselineResult.horizontalRun
  );
  const liveAngle = Math.atan2(verticalDifference, liveFrontX);
  const axleRotation = liveAngle - baselineAngle;

  const ladderKinematics: LadderKinematics = {
    frontPivot: {
      x: liveFrontX,
      y: liveFrontY,
    },
    axleRotation,
    chassisForeAftShift: chassisShift,
  };

  if (
    Number.isFinite(baseline.ladderRearUpperHeight) &&
    Number.isFinite(baseline.ladderRearLowerHeight)
  ) {
    ladderKinematics.rearUpper = rotateModelPoint(
      {
        x: baseline.ladderRearUpperX,
        y: baseline.ladderRearUpperHeight,
      },
      axleCenter,
      axleRotation
    );
    ladderKinematics.rearLower = rotateModelPoint(
      {
        x: baseline.ladderRearLowerX,
        y: baseline.ladderRearLowerHeight,
      },
      axleCenter,
      axleRotation
    );
  }

  return {
    result: {
      ...result,
      rearSpread:
        ladderKinematics.rearUpper && ladderKinematics.rearLower
          ? Math.abs(ladderKinematics.rearUpper.y - ladderKinematics.rearLower.y)
          : result.rearSpread,
    },
    ladderInputs,
    ladderKinematics,
    dynamicCgHeight,
  };
}

function getModelCgHeightFromRearTravel(
  car: Car,
  rearTravel: number,
  frontTravel = 0
) {
  // Rear and front axle-station travel define the rigid-body pitch used for CG
  // height. The model's front estimate is now fed into geometry only as chassis
  // attitude; it does not directly create or multiply rear suspension force.
  return (
    calculateDynamicCg(car.calculatorInputs, rearTravel, frontTravel)
      ?.dynamicCgHeight ?? null
  );
}

export function getModelGeometryAtTravel(
  car: Car,
  travel: number,
  dynamicCgHeight: number,
  frontTravel = 0
): ModelGeometryState | null {
  if (car.suspensionType === "ladder-bar") {
    return solveLadderAtTravel(car, travel, dynamicCgHeight, frontTravel);
  }

  return solveRigidFourLinkAtTravel(car, travel, dynamicCgHeight, frontTravel);
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
  const rise = Math.min(1, 1 - Math.exp(-time / 0.04));
  const decayProgress = Math.max(0, Math.min(1, (time - 0.22) / 1.28));
  const decay = 1 - 0.34 * decayProgress;

  return Math.max(0, peakG * rise * decay);
}

function getModelSpeedAtTime(dragyPoints: DragyPoint[], time: number) {
  if (dragyPoints.length === 0) return null;
  return interpolateDragy(dragyPoints, time)?.speed ?? null;
}

function getFrontTravelLimit(car: Car, override?: number) {
  const entered = parseNumber(car.calculatorInputs.frontTravelAvailable);
  const raw = Number.isFinite(override)
    ? override!
    : Number.isFinite(entered) && entered > 0
      ? entered
      : 5;

  return Math.max(0.5, Math.min(12, raw));
}

function getGeometrySensitivity(
  car: Car,
  travel: number,
  frontTravel = 0
) {
  const sample = 0.1;
  const lowCg = getModelCgHeightFromRearTravel(car, travel - sample, frontTravel);
  const highCg = getModelCgHeightFromRearTravel(car, travel + sample, frontTravel);

  if (lowCg === null || highCg === null) {
    return { asSensitivity: 0, icSensitivity: 0 };
  }

  const low = getModelGeometryAtTravel(
    car,
    travel - sample,
    lowCg,
    frontTravel
  );
  const high = getModelGeometryAtTravel(
    car,
    travel + sample,
    highCg,
    frontTravel
  );

  if (!low || !high) {
    return { asSensitivity: 0, icSensitivity: 0 };
  }

  const span = sample * 2;
  return {
    asSensitivity: (high.result.antiSquat - low.result.antiSquat) / span,
    icSensitivity: (high.result.icLength - low.result.icLength) / span,
  };
}

function getFourLinkForceBreakdown(
  car: Car,
  geometry: ModelGeometryState,
  driveForce: number,
  geometryVerticalReaction: number
) {
  if (car.suspensionType !== "4-link" || !geometry.kinematics) {
    const ladderRearSpread =
      geometry.ladderKinematics?.rearUpper && geometry.ladderKinematics?.rearLower
        ? Math.abs(
            geometry.ladderKinematics.rearUpper.y -
              geometry.ladderKinematics.rearLower.y
          )
        : "rearSpread" in geometry.result
          ? geometry.result.rearSpread
          : null;

    return {
      rearSpread: ladderRearSpread,
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

  // Resolve the exact contact-patch-to-IC resultant into the two link axes.
  // Because the two link lines intersect at the IC, this force balance also
  // satisfies the axle moment balance; rear spread and bar angle therefore
  // change individual link loads without an arbitrary spread multiplier.
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

function findLastValidTravel(
  car: Car,
  fromTravel: number,
  toTravel: number,
  frontTravel = 0
) {
  let low = fromTravel;
  let high = toTravel;
  let best = fromTravel;

  for (let i = 0; i < 28; i += 1) {
    const mid = (low + high) / 2;
    const cg = getModelCgHeightFromRearTravel(car, mid, frontTravel);
    const valid =
      cg !== null &&
      getModelGeometryAtTravel(car, mid, cg, frontTravel) !== null;

    if (valid) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  return best;
}

export function simulateModelState(
  car: Car,
  weights: WeightData,
  dragyPoints: DragyPoint[],
  peakG: number,
  endTime: number,
  options: ModelSimulationOptions = {}
): ModelSnapshot | null {
  const wheelbase = parseNumber(car.calculatorInputs.wheelbase);
  const staticCgHeight = parseNumber(car.calculatorInputs.cgHeight);

  if (
    !Number.isFinite(wheelbase) ||
    wheelbase <= 0 ||
    !Number.isFinite(staticCgHeight) ||
    staticCgHeight <= 0 ||
    !Number.isFinite(endTime) ||
    endTime < 0
  ) {
    return null;
  }

  const rearSprungWeight = Math.max(1, weights.rearWeight * 0.86);
  const rearMass = rearSprungWeight / GRAVITY_IN_PER_SEC2;
  const frontTravelLimit = getFrontTravelLimit(car, options.frontTravelLimit);

  // Rear travel cannot be solved uniquely from IC/AS + longitudinal G alone;
  // real displacement also depends on the spring, damper, tire and masses.
  // Keep those unknowns hidden and use a conservative normalized response:
  // live AS and G establish a moving equilibrium, while a critically damped
  // response approaches that equilibrium. This prevents the old force
  // integrator from treating the +/-5 in safety envelope as a destination.
  // The live geometry is recalculated every step, so short/long bars and
  // geometry migration still change the response rather than using a fixed AS.
  const rearResponseOmega = 7.0; // rad/s; settles quickly without oscillation
  const rearTravelPerAsG = 3.25; // normalized inches per (AS-1.0)*G
  const rearModelTravelCap = 3.25; // normal model cap; 5 in remains safety only

  // Front extension is a load-unloading response, not a commanded travel.
  // Sustained longitudinal load transfer keeps extending the front until the
  // physical travel stop; it only returns when front loading materially comes
  // back. This is intentionally a comparative visual model, not a shock dyno.
  // Generic front-response calibration: a sustained hard ~1.8 G launch can
  // use the available travel in about one second. Below roughly 0.95 G the
  // front is allowed to recover, so a pedal event is visible instead of
  // leaving the suspension latched at full extension.
  const frontExtensionRate = Math.max(4, frontTravelLimit);
  const frontReturnRate = Math.max(4, frontTravelLimit * 0.85);

  const nominalStep = 0.0015;
  const steps =
    endTime > 0 ? Math.max(1, Math.ceil(endTime / nominalStep)) : 0;
  const dt = steps > 0 ? endTime / steps : 0;

  let travel = 0;
  let velocity = 0;
  let acceleration = 0;
  let frontVisualLift = 0;
  let frontVisualVelocity = 0;
  let travelLimited = false;
  let kinematicLimited = false;
  let frontTravelLimited = false;

  for (let index = 0; index < steps; index += 1) {
    const t = index * dt;
    const currentG = getModelGAtTime(dragyPoints, peakG, t);
    const dynamicCgHeight = getModelCgHeightFromRearTravel(
      car,
      travel,
      frontVisualLift
    );
    if (dynamicCgHeight === null) return null;

    const geometry = getModelGeometryAtTravel(
      car,
      travel,
      dynamicCgHeight,
      frontVisualLift
    );
    if (!geometry) return null;

    const driveForce = weights.totalWeight * currentG;
    const inertialLoadTransfer = (driveForce * dynamicCgHeight) / wheelbase;
    const liveAntiSquat = geometry.result.antiSquat / 100;
    const targetRearTravel = Math.max(
      -rearModelTravelCap,
      Math.min(
        rearModelTravelCap,
        (liveAntiSquat - 1) * currentG * rearTravelPerAsG
      )
    );

    // Critically damped second-order response to the live geometry/G target.
    // A pedal event immediately moves the target back toward neutral, allowing
    // both separation and squat to unload instead of latching at a travel stop.
    acceleration =
      rearResponseOmega * rearResponseOmega * (targetRearTravel - travel) -
      2 * rearResponseOmega * velocity;
    velocity += acceleration * dt;

    const previousTravel = travel;
    travel += velocity * dt;

    // Limit flags describe the current step, not a permanent latched state.
    // This allows the suspension to move back inward when G/load later falls.
    travelLimited = false;
    kinematicLimited = false;

    if (travel >= REAR_TRAVEL_ENVELOPE) {
      travel = REAR_TRAVEL_ENVELOPE;
      velocity = 0;
      acceleration = 0;
      travelLimited = true;
    } else if (travel <= -REAR_TRAVEL_ENVELOPE) {
      travel = -REAR_TRAVEL_ENVELOPE;
      velocity = 0;
      acceleration = 0;
      travelLimited = true;
    }

    if (!travelLimited) {
      const nextCg = getModelCgHeightFromRearTravel(
        car,
        travel,
        frontVisualLift
      );
      const nextGeometry =
        nextCg !== null
          ? getModelGeometryAtTravel(
              car,
              travel,
              nextCg,
              frontVisualLift
            )
          : null;

      if (!nextGeometry) {
        travel = findLastValidTravel(
          car,
          previousTravel,
          travel,
          frontVisualLift
        );
        velocity = 0;
        acceleration = 0;
        kinematicLimited = true;
      }
    }

    const requestedBaseRear = weights.rearWeight + inertialLoadTransfer;
    const baseRear = Math.max(0, Math.min(weights.totalWeight, requestedBaseRear));
    const baseFront = Math.max(0, weights.totalWeight - baseRear);
    const wheelie = baseFront <= 0.5;

    // Longitudinal G is the primary observable input for the generic front
    // response. The load-transfer calculation still determines wheelie state,
    // while these thresholds make a real pedal event reversible without asking
    // the user for spring/shock data.
    const extensionDemand = Math.max(
      0,
      Math.min(1, (currentG - 0.95) / (1.8 - 0.95))
    );
    const returnDemand = Math.max(
      0,
      Math.min(1, (0.95 - currentG) / 0.45)
    );

    if (wheelie || extensionDemand > 0) {
      frontVisualVelocity = frontExtensionRate * (wheelie ? 1 : extensionDemand);
    } else if (returnDemand > 0) {
      frontVisualVelocity = -frontReturnRate * returnDemand;
    } else {
      frontVisualVelocity = 0;
    }
    frontVisualLift += frontVisualVelocity * dt;

    if (frontVisualLift >= frontTravelLimit) {
      frontVisualLift = frontTravelLimit;
      if (frontVisualVelocity > 0) frontVisualVelocity = 0;
      frontTravelLimited = true;
    } else if (frontVisualLift <= 0) {
      frontVisualLift = 0;
      if (frontVisualVelocity < 0) frontVisualVelocity = 0;
      frontTravelLimited = false;
    } else {
      frontTravelLimited = false;
    }

  }

  const currentG = getModelGAtTime(dragyPoints, peakG, endTime);
  const dynamicCgHeight = getModelCgHeightFromRearTravel(
    car,
    travel,
    frontVisualLift
  );
  if (dynamicCgHeight === null) return null;

  const geometry = getModelGeometryAtTravel(
    car,
    travel,
    dynamicCgHeight,
    frontVisualLift
  );
  if (!geometry) return null;

  const speed = getModelSpeedAtTime(dragyPoints, endTime);
  const driveForce = weights.totalWeight * currentG;
  const geometryVerticalReaction =
    Math.abs(geometry.result.icLength) > 1e-7
      ? driveForce * (geometry.result.icHeight / geometry.result.icLength)
      : 0;
  const inertialLoadTransfer = (driveForce * dynamicCgHeight) / wheelbase;
  const excessAntiSquatReaction =
    geometryVerticalReaction - inertialLoadTransfer;
  const finalLiveAntiSquat = geometry.result.antiSquat / 100;
  const finalTargetRearTravel = Math.max(
    -rearModelTravelCap,
    Math.min(
      rearModelTravelCap,
      (finalLiveAntiSquat - 1) * currentG * rearTravelPerAsG
    )
  );
  const springForce =
    rearMass * rearResponseOmega * rearResponseOmega * (finalTargetRearTravel - travel);
  const dampingForce = -rearMass * 2 * rearResponseOmega * velocity;

  if (!travelLimited && !kinematicLimited) {
    acceleration =
      rearResponseOmega * rearResponseOmega * (finalTargetRearTravel - travel) -
      2 * rearResponseOmega * velocity;
  } else {
    acceleration = 0;
  }

  const requestedBaseRear = weights.rearWeight + inertialLoadTransfer;
  const baseRearTireLoad = Math.max(
    0,
    Math.min(weights.totalWeight, requestedBaseRear)
  );
  const baseFrontTireLoad = Math.max(0, weights.totalWeight - baseRearTireLoad);

  const rawJackingTireLoadUnclamped =
    travelLimited || kinematicLimited ? 0 : rearMass * acceleration;
  const rawJackingTireLoad = Math.max(
    -0.35 * weights.totalWeight,
    Math.min(0.35 * weights.totalWeight, rawJackingTireLoadUnclamped)
  );
  const rearTireLoadEstimate = Math.max(0, baseRearTireLoad + rawJackingTireLoad);
  const frontTireLoadEstimate = baseFrontTireLoad;
  const jackingTireLoad = rearTireLoadEstimate - baseRearTireLoad;

  const sensitivity = getGeometrySensitivity(car, travel, frontVisualLift);
  const linkForces = getFourLinkForceBreakdown(
    car,
    geometry,
    driveForce,
    geometryVerticalReaction
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
    estimatedWheelRate: 0,
    wheelRateSource: "geometry-only",
    travelLimited,
    kinematicLimited,
    asSensitivity: sensitivity.asSensitivity,
    icSensitivity: sensitivity.icSensitivity,
    frontVisualLift,
    frontTravelLimit,
    frontTravelLimited,
    dynamicCgHeight,
    wheelie: baseFrontTireLoad <= 0.5,
    ...linkForces,
  };
}
