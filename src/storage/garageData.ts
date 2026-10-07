import type { Car, Inputs } from "../types";

export const DEFAULT_HOLE_SPACING = "0.625";
export const CARS_STORAGE_KEY = "chassislab-cars";
export const LEGACY_CARS_STORAGE_KEY = "drag-suspension-cars";
export const ACTIVE_CAR_STORAGE_KEY = "chassislab-active-car";
export const LEGACY_ACTIVE_CAR_STORAGE_KEY = "drag-suspension-active-car";

export const emptyInputs: Inputs = {
  upperLength: "",
  upperFrontHeight: "",
  upperRearHeight: "",
  lowerLength: "",
  lowerFrontHeight: "",
  lowerRearHeight: "",
  ladderLength: "",
  ladderFrontHeight: "",
  wheelbase: "",
  cgHeight: "",
  tireDiameter: "",
  frontWeight: "",
  rearWeight: "",
};

export function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeInputs(
  inputs: Partial<Inputs> | undefined
): Inputs {
  return {
    ...emptyInputs,
    ...(inputs ?? {}),
  };
}

export function normalizeCars(value: unknown): Car[] {
  if (!Array.isArray(value)) return [];

  return value.map((car) => {
    const raw = car as Partial<Car>;

    return {
      id: raw.id ?? makeId(),
      name: raw.name ?? "Untitled Car",
      suspensionType:
        raw.suspensionType === "ladder-bar" ? "ladder-bar" : "4-link",
      calculatorInputs: normalizeInputs(raw.calculatorInputs),
      holeSpacing:
        typeof raw.holeSpacing === "string" && raw.holeSpacing.trim() !== ""
          ? raw.holeSpacing
          : DEFAULT_HOLE_SPACING,
      savedSetups: Array.isArray(raw.savedSetups)
        ? raw.savedSetups.map((setup) => ({
            ...setup,
            id: setup.id ?? makeId(),
            name: setup.name ?? "Untitled Setup",
            createdAt: setup.createdAt ?? new Date().toISOString(),
            inputs: normalizeInputs(setup.inputs),
            holeSpacing:
              typeof setup.holeSpacing === "string" && setup.holeSpacing.trim() !== ""
                ? setup.holeSpacing
                : DEFAULT_HOLE_SPACING,
            runs: (setup.runs ?? []).map((run) => ({
              ...run,
              id: run.id ?? makeId(),
              createdAt: run.createdAt ?? new Date().toISOString(),
              trackSurface: run.trackSurface ?? "",
              frontRebound: run.frontRebound ?? "",
              frontCompression: run.frontCompression ?? "",
              rearRebound: run.rearRebound ?? "",
              rearCompression: run.rearCompression ?? "",
              rearTirePressure: run.rearTirePressure ?? "",
              rearWeightBias: run.rearWeightBias ?? "",
              sixtyFoot: run.sixtyFoot ?? "",
              threeThirty: run.threeThirty ?? "",
              eighthEt: run.eighthEt ?? "",
              eighthMph: run.eighthMph ?? "",
              notes: run.notes ?? "",
              telemetry: run.telemetry ?? null,
            })),
          }))
        : [],
    } satisfies Car;
  });
}

export function loadCarsFromLocalStorage(): Car[] {
  try {
    const current = localStorage.getItem(CARS_STORAGE_KEY);
    if (current) return normalizeCars(JSON.parse(current));

    const legacy = localStorage.getItem(LEGACY_CARS_STORAGE_KEY);
    if (legacy) return normalizeCars(JSON.parse(legacy));
  } catch {
    // Keep the calculator usable even if local storage contains bad data.
  }

  return [];
}
