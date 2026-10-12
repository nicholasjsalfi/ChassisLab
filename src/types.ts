export type SuspensionType = "4-link" | "ladder-bar";
export type Tab = "calculator" | "bar-change" | "dynamic" | "modeling" | "surface" | "data-log"
  | "garage";
export type ThemePreference = "system" | "dark" | "light";

export type Inputs = {
  upperLength: string;
  upperFrontHeight: string;
  upperRearHeight: string;
  /** Rear upper pivot fore/aft location from axle centerline. Positive = forward. */
  upperRearX: string;

  lowerLength: string;
  lowerFrontHeight: string;
  lowerRearHeight: string;
  /** Rear lower pivot fore/aft location from axle centerline. Positive = forward. */
  lowerRearX: string;

  /** Axle-center to front-pivot physical distance. */
  ladderLength: string;
  ladderFrontHeight: string;
  ladderRearUpperHeight: string;
  ladderRearLowerHeight: string;
  ladderRearUpperX: string;
  ladderRearLowerX: string;

  wheelbase: string;
  cgHeight: string;
  tireDiameter: string;

  frontWeight: string;
  rearWeight: string;

  /** Maximum available front suspension extension used by the model. */
  frontTravelAvailable: string;
  /** Optional physical spring rate for each rear coilover. */
  rearSpringRate: string;
  /** spring/shock travel divided by wheel travel; 1.0 for direct acting. */
  rearSpringMotionRatio: string;
};

export type NumericInputs = {
  upperLength: number;
  upperFrontHeight: number;
  upperRearHeight: number;
  upperRearX: number;
  lowerLength: number;
  lowerFrontHeight: number;
  lowerRearHeight: number;
  lowerRearX: number;
  wheelbase: number;
  cgHeight: number;
  tireDiameter: number;
};

export type LadderInputs = {
  ladderLength: number;
  ladderFrontHeight: number;
  ladderRearUpperHeight: number;
  ladderRearLowerHeight: number;
  ladderRearUpperX: number;
  ladderRearLowerX: number;
  wheelbase: number;
  cgHeight: number;
  tireDiameter: number;
};

export type LadderResult = {
  horizontalRun: number;
  barAngle: number;
  icLength: number;
  icHeight: number;
  antiSquat: number;
  rearSpread: number | null;
};

export type LadderCalcResult = LadderResult | { error: string } | null;

export type SuccessfulResult = {
  upperRun: number;
  lowerRun: number;
  upperAngle: number;
  lowerAngle: number;
  upperSlope: number;
  lowerSlope: number;
  icLength: number;
  icHeight: number;
  antiSquat: number;
  rearSpread: number;
  frontSpread: number;
};

export type CalcResult = SuccessfulResult | { error: string } | null;

export type DragyPoint = {
  time: number;
  speed: number | null;
  g: number | null;
};

export type TelemetrySplits = {
  sixtyFoot?: number;
  threeThirty?: number;
  eighthEt?: number;
  eighthMph?: number;
};

export type RunTelemetry = {
  source: "dragy-json" | "dragy-csv" | "csv" | "json" | "vbo" | "dragy-readable" | "dragy-encrypted";
  fileName: string;
  importedAt: string;
  points: DragyPoint[];
  splits: TelemetrySplits;
};


export type SurfaceRecord = {
  id: string;
  name: string;
  date: string;
  rating: number;
  lane: string;
  notes: string;
};

export type SurfaceSnapshot = {
  surfaceId?: string;
  name: string;
  date: string;
  rating: number | null;
  lane: string;
  notes: string;
};

export type RunLog = {
  id: string;
  createdAt: string;
  trackSurface: string;
  sessionName: string;
  surfaceId: string;
  surfaceSnapshot?: SurfaceSnapshot | null;
  frontRebound: string;
  frontCompression: string;
  rearRebound: string;
  rearCompression: string;
  rearTirePressure: string;
  rearWeightBias: string;
  sixtyFoot: string;
  threeThirty: string;
  eighthEt: string;
  eighthMph: string;
  notes: string;
  telemetry?: RunTelemetry | null;
};

export type SavedSetup = {
  id: string;
  name: string;
  createdAt: string;
  inputs: Inputs;
  holeSpacing: string;
  runs?: RunLog[];
};

export type Car = {
  id: string;
  name: string;
  suspensionType: SuspensionType;
  calculatorInputs: Inputs;
  holeSpacing: string;
  savedSetups: SavedSetup[];
  surfaces?: SurfaceRecord[];
};

export type WeightData = {
  frontWeight: number;
  rearWeight: number;
  totalWeight: number;
  frontBias: number;
  rearBias: number;
  cgXFromRear: number;
};
