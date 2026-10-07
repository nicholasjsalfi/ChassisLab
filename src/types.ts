export type SuspensionType = "4-link" | "ladder-bar";
export type Tab = "calculator" | "bar-change" | "dynamic" | "modeling" | "garage";
export type ThemePreference = "system" | "dark" | "light";

export type Inputs = {
  upperLength: string;
  upperFrontHeight: string;
  upperRearHeight: string;
  lowerLength: string;
  lowerFrontHeight: string;
  lowerRearHeight: string;

  ladderLength: string;
  ladderFrontHeight: string;

  wheelbase: string;
  cgHeight: string;
  tireDiameter: string;

  frontWeight: string;
  rearWeight: string;
};

export type NumericInputs = {
  upperLength: number;
  upperFrontHeight: number;
  upperRearHeight: number;
  lowerLength: number;
  lowerFrontHeight: number;
  lowerRearHeight: number;
  wheelbase: number;
  cgHeight: number;
  tireDiameter: number;
};

export type LadderInputs = {
  ladderLength: number;
  ladderFrontHeight: number;
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
  source: "dragy-json" | "dragy-csv" | "csv" | "json" | "vbo" | "dragy-readable";
  fileName: string;
  importedAt: string;
  points: DragyPoint[];
  splits: TelemetrySplits;
};

export type RunLog = {
  id: string;
  createdAt: string;
  trackSurface: string;
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
};

export type WeightData = {
  frontWeight: number;
  rearWeight: number;
  totalWeight: number;
  frontBias: number;
  rearBias: number;
  cgXFromRear: number;
};
