import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import "./App.css";

/* =========================================================
   TYPES
========================================================= */

type SuspensionType = "4-link" | "ladder-bar";
type Tab = "calculator" | "bar-change" | "dynamic" | "garage";
type ThemePreference = "system" | "dark" | "light";

type Inputs = {
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
};

type NumericInputs = {
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

type LadderInputs = {
  ladderLength: number;
  ladderFrontHeight: number;
  wheelbase: number;
  cgHeight: number;
  tireDiameter: number;
};

type LadderResult = {
  horizontalRun: number;
  barAngle: number;
  icLength: number;
  icHeight: number;
  antiSquat: number;
};

type LadderCalcResult =
  | LadderResult
  | { error: string }
  | null;

type SuccessfulResult = {
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

type CalcResult =
  | SuccessfulResult
  | { error: string }
  | null;

type RunLog = {
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
};

type SavedSetup = {
  id: string;
  name: string;
  createdAt: string;
  inputs: Inputs;
  runs?: RunLog[];
};

type Car = {
  id: string;
  name: string;
  suspensionType: SuspensionType;
  calculatorInputs: Inputs;
  savedSetups: SavedSetup[];
};

type BracketOffsets = {
  upperFront: number;
  upperRear: number;
  lowerFront: number;
  lowerRear: number;
};

/* =========================================================
   CONSTANTS
========================================================= */

const emptyInputs: Inputs = {
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
};

const CARS_STORAGE_KEY = "chassislab-cars";
const LEGACY_CARS_STORAGE_KEY = "drag-suspension-cars";

const ACTIVE_CAR_STORAGE_KEY = "chassislab-active-car";
const LEGACY_ACTIVE_CAR_STORAGE_KEY =
  "drag-suspension-active-car";

const THEME_STORAGE_KEY = "chassislab-theme";

/* =========================================================
   HELPERS / CALCULATION ENGINE
========================================================= */

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return NaN;
  }

  return Number(value);
}

function toNumericInputs(inputs: Inputs): NumericInputs {
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

function toLadderInputs(inputs: Inputs): LadderInputs {
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

function calculateLadderBar(
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

function normalizeInputs(
  inputs: Partial<Inputs> | undefined
): Inputs {
  return {
    ...emptyInputs,
    ...(inputs ?? {}),
  };
}

function normalizeCars(value: unknown): Car[] {
  if (!Array.isArray(value)) return [];

  return value.map((car) => {
    const raw = car as Partial<Car>;

    return {
      id: raw.id ?? makeId(),
      name: raw.name ?? "Untitled Car",
      suspensionType:
        raw.suspensionType === "ladder-bar"
          ? "ladder-bar"
          : "4-link",
      calculatorInputs: normalizeInputs(
        raw.calculatorInputs
      ),
      savedSetups: Array.isArray(raw.savedSetups)
        ? raw.savedSetups.map((setup) => ({
            ...setup,
            inputs: normalizeInputs(setup.inputs),
            runs: (setup.runs ?? []).map((run) => ({
              ...run,
              rearWeightBias: run.rearWeightBias ?? "",
            })),
          }))
        : [],
    };
  });
}

function calculateFourLink(n: NumericInputs): CalcResult {
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

function loadCars(): Car[] {
  try {
    const current = localStorage.getItem(CARS_STORAGE_KEY);

    if (current) {
      const parsed = JSON.parse(current);
      return normalizeCars(parsed);
    }

    const legacy = localStorage.getItem(
      LEGACY_CARS_STORAGE_KEY
    );

    if (legacy) {
      const parsed = JSON.parse(legacy);
      return normalizeCars(parsed);
    }

    return [];
  } catch {
    return [];
  }
}

function loadTheme(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);

  if (
    stored === "system" ||
    stored === "dark" ||
    stored === "light"
  ) {
    return stored;
  }

  return "system";
}

/* =========================================================
   APP
========================================================= */

function App() {
  const [cars, setCars] = useState<Car[]>(loadCars);
  const [activeTab, setActiveTab] =
    useState<Tab>("calculator");
  const [showAddCar, setShowAddCar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] =
    useState<ThemePreference>(loadTheme);

  const [activeCarId, setActiveCarId] =
    useState<string | null>(() => {
      return (
        localStorage.getItem(ACTIVE_CAR_STORAGE_KEY) ??
        localStorage.getItem(
          LEGACY_ACTIVE_CAR_STORAGE_KEY
        )
      );
    });

  useEffect(() => {
    localStorage.setItem(
      CARS_STORAGE_KEY,
      JSON.stringify(cars)
    );
  }, [cars]);

  useEffect(() => {
    if (activeCarId) {
      localStorage.setItem(
        ACTIVE_CAR_STORAGE_KEY,
        activeCarId
      );
    } else {
      localStorage.removeItem(ACTIVE_CAR_STORAGE_KEY);
    }
  }, [activeCarId]);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    const media = window.matchMedia(
      "(prefers-color-scheme: dark)"
    );

    function applyTheme() {
      const resolved =
        theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : theme;

      document.documentElement.dataset.theme = resolved;
    }

    applyTheme();

    if (theme === "system") {
      media.addEventListener("change", applyTheme);

      return () => {
        media.removeEventListener("change", applyTheme);
      };
    }
  }, [theme]);

  useEffect(() => {
    if (cars.length === 0) {
      setActiveCarId(null);
      return;
    }

    const activeExists = cars.some(
      (car) => car.id === activeCarId
    );

    if (!activeExists) {
      setActiveCarId(cars[0].id);
    }
  }, [cars, activeCarId]);

  const activeCar =
    cars.find((car) => car.id === activeCarId) ?? null;

  function createCar(
    name: string,
    suspensionType: SuspensionType
  ) {
    const newCar: Car = {
      id: makeId(),
      name,
      suspensionType,
      calculatorInputs: { ...emptyInputs },
      savedSetups: [],
    };

    setCars((current) => [...current, newCar]);
    setActiveCarId(newCar.id);
    setActiveTab("calculator");
    setShowAddCar(false);
  }

  function updateActiveCarInputs(inputs: Inputs) {
    if (!activeCarId) return;

    setCars((current) =>
      current.map((car) =>
        car.id === activeCarId
          ? {
              ...car,
              calculatorInputs: inputs,
            }
          : car
      )
    );
  }

  function saveCurrentSetup() {
    if (!activeCar) return;

    const name = window.prompt("Name this setup:");

    if (!name?.trim()) return;

    const setup: SavedSetup = {
      id: makeId(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      inputs: { ...activeCar.calculatorInputs },
      runs: [],
    };

    setCars((current) =>
      current.map((car) =>
        car.id === activeCar.id
          ? {
              ...car,
              savedSetups: [...car.savedSetups, setup],
            }
          : car
      )
    );
  }

  function loadSetup(carId: string, setup: SavedSetup) {
    setCars((current) =>
      current.map((car) =>
        car.id === carId
          ? {
              ...car,
              calculatorInputs: { ...setup.inputs },
            }
          : car
      )
    );

    setActiveCarId(carId);
    setActiveTab("calculator");
  }

  function deleteSetup(carId: string, setupId: string) {
    setCars((current) =>
      current.map((car) =>
        car.id === carId
          ? {
              ...car,
              savedSetups: car.savedSetups.filter(
                (setup) => setup.id !== setupId
              ),
            }
          : car
      )
    );
  }


  function addRun(
    carId: string,
    setupId: string,
    run: Omit<RunLog, "id" | "createdAt">
  ) {
    const savedRun: RunLog = {
      ...run,
      id: makeId(),
      createdAt: new Date().toISOString(),
    };

    setCars((current) =>
      current.map((car) =>
        car.id === carId
          ? {
              ...car,
              savedSetups: car.savedSetups.map((setup) =>
                setup.id === setupId
                  ? {
                      ...setup,
                      runs: [...(setup.runs ?? []), savedRun],
                    }
                  : setup
              ),
            }
          : car
      )
    );
  }

  function deleteRun(
    carId: string,
    setupId: string,
    runId: string
  ) {
    setCars((current) =>
      current.map((car) =>
        car.id === carId
          ? {
              ...car,
              savedSetups: car.savedSetups.map((setup) =>
                setup.id === setupId
                  ? {
                      ...setup,
                      runs: (setup.runs ?? []).filter(
                        (run) => run.id !== runId
                      ),
                    }
                  : setup
              ),
            }
          : car
      )
    );
  }

  function updateRun(
    carId: string,
    setupId: string,
    runId: string,
    updatedRun: Omit<RunLog, "id" | "createdAt">
  ) {
    setCars((current) =>
      current.map((car) =>
        car.id === carId
          ? {
              ...car,
              savedSetups: car.savedSetups.map((setup) =>
                setup.id === setupId
                  ? {
                      ...setup,
                      runs: (setup.runs ?? []).map((run) =>
                        run.id === runId
                          ? {
                              ...run,
                              ...updatedRun,
                            }
                          : run
                      ),
                    }
                  : setup
              ),
            }
          : car
      )
    );
  }

  function deleteCar(carId: string) {
    const car = cars.find(
      (candidate) => candidate.id === carId
    );

    if (!car) return;

    const confirmation = window.prompt(
      `Delete ${car.name}? This permanently removes the car, saved setups, and run logs. Type "${car.name}" to confirm.`
    );

    if (confirmation !== car.name) return;

    const remainingCars = cars.filter(
      (candidate) => candidate.id !== carId
    );

    setCars(remainingCars);

    if (activeCarId === carId) {
      setActiveCarId(
        remainingCars.length > 0
          ? remainingCars[0].id
          : null
      );
    }
  }

  if (cars.length === 0) {
    return (
      <>
        <FirstLaunchScreen onCreate={createCar} />

        <SettingsButton
          onClick={() => setShowSettings(true)}
        />

        {showSettings && (
          <SettingsPanel
            theme={theme}
            onThemeChange={setTheme}
            onClose={() => setShowSettings(false)}
          />
        )}
      </>
    );
  }

  if (!activeCar) return null;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="brand-name">ChassisLab</p>
          <h1>{activeCar.name}</h1>

          <div className="car-type-line">
            {activeCar.suspensionType === "4-link"
              ? "4-Link"
              : "Ladder Bar"}
          </div>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Open settings"
            title="Settings"
            onClick={() => setShowSettings(true)}
          >
            ⚙
          </button>

          <button
            type="button"
            className="car-switch-button"
            onClick={() => setActiveTab("garage")}
          >
            Garage
          </button>
        </div>
      </header>

      <div className="screen-container">
        {activeTab === "calculator" && (
          <CalculatorScreen
            car={activeCar}
            onInputsChange={updateActiveCarInputs}
            onSaveSetup={saveCurrentSetup}
          />
        )}

        {activeTab === "bar-change" && (
          <BarChangeScreen car={activeCar} />
        )}

        {activeTab === "dynamic" && (
          <DynamicScreen car={activeCar} />
        )}

        {activeTab === "garage" && (
          <GarageScreen
            cars={cars}
            activeCarId={activeCarId}
            showAddCar={showAddCar}
            onShowAddCar={() => setShowAddCar(true)}
            onHideAddCar={() => setShowAddCar(false)}
            onCreateCar={createCar}
            onSelectCar={(carId) => {
              setActiveCarId(carId);
              setActiveTab("calculator");
            }}
            onLoadSetup={loadSetup}
            onDeleteSetup={deleteSetup}
            onAddRun={addRun}
            onUpdateRun={updateRun}
            onDeleteRun={deleteRun}
            onDeleteCar={deleteCar}
          />
        )}
      </div>

      <BottomNav
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {showSettings && (
        <SettingsPanel
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => setShowSettings(false)}
        />
      )}
    </main>
  );
}

/* =========================================================
   SETTINGS
========================================================= */

function SettingsButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="floating-settings-button"
      aria-label="Open settings"
      title="Settings"
      onClick={onClick}
    >
      ⚙
    </button>
  );
}

function SettingsPanel({
  theme,
  onThemeChange,
  onClose,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onClose: () => void;
}) {
  const themes: {
    id: ThemePreference;
    label: string;
  }[] = [
    { id: "system", label: "System" },
    { id: "dark", label: "Dark" },
    { id: "light", label: "Light" },
  ];

  return (
    <div
      className="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="settings-panel"
        aria-label="Settings"
      >
        <div className="settings-header">
          <div>
            <p className="eyebrow">CHASSISLAB</p>
            <h2>Settings</h2>
          </div>

          <button
            type="button"
            className="settings-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h3>Appearance</h3>
            <p>
              Match your device or choose a fixed theme.
            </p>
          </div>

          <div className="theme-picker">
            {themes.map((option) => (
              <button
                type="button"
                key={option.id}
                className={
                  theme === option.id ? "selected" : ""
                }
                onClick={() =>
                  onThemeChange(option.id)
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h3>Account</h3>
            <p>
              Your garage is currently saved on this
              device.
            </p>
          </div>

          <div className="account-card">
            <div>
              <strong>Not signed in</strong>
              <span>
                Optional account sync will let ChassisLab
                keep cars and setups synchronized between
                the website and mobile app.
              </span>
            </div>

            <button
              type="button"
              className="secondary-button"
              disabled
            >
              Sign in — coming later
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* =========================================================
   FIRST LAUNCH / ADD CAR
========================================================= */

function FirstLaunchScreen({
  onCreate,
}: {
  onCreate: (
    name: string,
    type: SuspensionType
  ) => void;
}) {
  return (
    <main className="welcome-page">
      <div className="welcome-card">
        <p className="welcome-brand">ChassisLab</p>

        <h1>Set up your first car</h1>

        <p className="welcome-description">
          Create a car profile and choose the rear
          suspension type.
        </p>

        <AddCarForm onCreate={onCreate} />
      </div>
    </main>
  );
}

function AddCarForm({
  onCreate,
  onCancel,
}: {
  onCreate: (
    name: string,
    type: SuspensionType
  ) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] =
    useState<SuspensionType>("4-link");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!name.trim()) return;

    onCreate(name.trim(), type);
  }

  return (
    <form className="add-car-form" onSubmit={submit}>
      <label className="field">
        <div className="field-header">
          <span>Car name</span>
          <small className="empty-help">&nbsp;</small>
        </div>

        <div className="input-wrap">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Foxbody No Prep"
          />
        </div>
      </label>

      <div className="suspension-type-picker">
        <button
          type="button"
          className={`suspension-choice ${
            type === "4-link" ? "selected" : ""
          }`}
          onClick={() => setType("4-link")}
        >
          <strong>4-Link</strong>
          <span>
            Parallel or triangulated side-view geometry
          </span>
        </button>

        <button
          type="button"
          className={`suspension-choice ${
            type === "ladder-bar" ? "selected" : ""
          }`}
          onClick={() => setType("ladder-bar")}
        >
          <strong>Ladder Bar</strong>
          <span>
            Front ladder-bar pivot defines the instant
            center
          </span>
        </button>
      </div>

      <div className="form-actions">
        {onCancel && (
          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}

        <button
          type="submit"
          className="primary-button"
          disabled={!name.trim()}
        >
          Create Car
        </button>
      </div>
    </form>
  );
}

/* =========================================================
   STATIC CALCULATOR
========================================================= */

function CalculatorScreen({
  car,
  onInputsChange,
  onSaveSetup,
}: {
  car: Car;
  onInputsChange: (inputs: Inputs) => void;
  onSaveSetup: () => void;
}) {
  if (car.suspensionType === "ladder-bar") {
    return (
      <LadderBarCalculator
        inputs={car.calculatorInputs}
        onInputsChange={onInputsChange}
        onSaveSetup={onSaveSetup}
      />
    );
  }

  return (
    <FourLinkCalculator
      inputs={car.calculatorInputs}
      onInputsChange={onInputsChange}
      onSaveSetup={onSaveSetup}
    />
  );
}

function FourLinkCalculator({
  inputs,
  onInputsChange,
  onSaveSetup,
}: {
  inputs: Inputs;
  onInputsChange: (inputs: Inputs) => void;
  onSaveSetup: () => void;
}) {
  const numericInputs = useMemo(
    () => toNumericInputs(inputs),
    [inputs]
  );

  const result = useMemo(
    () => calculateFourLink(numericInputs),
    [numericInputs]
  );

  function updateInput(
    key: keyof Inputs,
    value: string
  ) {
    onInputsChange({
      ...inputs,
      [key]: value,
    });
  }

  const hasResult =
    result !== null && !("error" in result);

  return (
    <>
      <div className="screen-heading-row">
        <ScreenHeading
          eyebrow="STATIC CALCULATION"
          title="IC & AS Calculation"
          description="Current static 4-link geometry."
        />

        <div className="calculator-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onInputsChange({ ...emptyInputs })
            }
          >
            Reset
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={onSaveSetup}
            disabled={!hasResult}
          >
            Save Setup
          </button>
        </div>
      </div>

      <div className="calculator-layout">
        <section className="input-panel">
          <div className="section first-section">
            <div className="section-title-with-note">
              <h2>Upper Link</h2>

              <span className="tiny-section-note">
                * Triangulated: use theoretical side-view
                length.
              </span>
            </div>

            <MeasurementField
              label="Bar length"
              value={inputs.upperLength}
              help="bolt center to bolt center"
              onChange={(value) =>
                updateInput("upperLength", value)
              }
            />

            <div className="two-column">
  <MeasurementField
    label="Rear height"
    value={inputs.upperRearHeight}
    help="ground to bolt center"
    onChange={(value) =>
      updateInput(
        "upperRearHeight",
        value
      )
    }
  />

  <MeasurementField
    label="Front height"
    value={inputs.upperFrontHeight}
    help="ground to bolt center"
    onChange={(value) =>
      updateInput(
        "upperFrontHeight",
        value
      )
    }
  />
</div>
          </div>

          <div className="section">
            <h2>Lower Link</h2>

            <MeasurementField
              label="Bar length"
              value={inputs.lowerLength}
              help="bolt center to bolt center"
              onChange={(value) =>
                updateInput("lowerLength", value)
              }
            />

            <div className="two-column">
  <MeasurementField
    label="Rear height"
    value={inputs.lowerRearHeight}
    help="ground to bolt center"
    onChange={(value) =>
      updateInput(
        "lowerRearHeight",
        value
      )
    }
  />

  <MeasurementField
    label="Front height"
    value={inputs.lowerFrontHeight}
    help="ground to bolt center"
    onChange={(value) =>
      updateInput(
        "lowerFrontHeight",
        value
      )
    }
  />
</div>
          </div>

          <div className="section">
            <h2>Vehicle</h2>

            <div className="two-column">
              <MeasurementField
                label="Wheelbase"
                value={inputs.wheelbase}
                onChange={(value) =>
                  updateInput("wheelbase", value)
                }
              />

              <MeasurementField
                label="Cam / CG height"
                value={inputs.cgHeight}
                help="cam height used as CG estimate"
                onChange={(value) =>
                  updateInput("cgHeight", value)
                }
              />
            </div>

            <MeasurementField
              label="Tire diameter"
              value={inputs.tireDiameter}
              onChange={(value) =>
                updateInput("tireDiameter", value)
              }
            />
          </div>
        </section>

        <section className="results-panel">
          <p className="eyebrow">CALCULATED GEOMETRY</p>
          <h2>Results</h2>

          {!result && (
            <div className="empty-state">
              Enter the suspension measurements to
              calculate the geometry.
            </div>
          )}

          {result && "error" in result && (
            <div className="error-box">
              {result.error}
            </div>
          )}

          {hasResult && (
            <>
              <SuspensionPlot
                inputs={numericInputs}
                result={result}
              />

              <ResultGrid result={result} />
            </>
          )}
        </section>
      </div>
    </>
  );
}


function LadderBarCalculator({
  inputs,
  onInputsChange,
  onSaveSetup,
}: {
  inputs: Inputs;
  onInputsChange: (inputs: Inputs) => void;
  onSaveSetup: () => void;
}) {
  const numericInputs = useMemo(
    () => toLadderInputs(inputs),
    [inputs]
  );

  const result = useMemo(
    () => calculateLadderBar(numericInputs),
    [numericInputs]
  );

  function updateInput(
    key: keyof Inputs,
    value: string
  ) {
    onInputsChange({
      ...inputs,
      [key]: value,
    });
  }

  const hasResult =
    result !== null && !("error" in result);

  return (
    <>
      <div className="screen-heading-row">
        <ScreenHeading
          eyebrow="STATIC CALCULATION"
          title="IC & AS Calculation"
          description="Current static ladder-bar geometry."
        />

        <div className="calculator-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onInputsChange({ ...emptyInputs })
            }
          >
            Reset
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={onSaveSetup}
            disabled={!hasResult}
          >
            Save Setup
          </button>
        </div>
      </div>

      <div className="calculator-layout">
        <section className="input-panel">
          <div className="section first-section">
            <h2>Ladder Bar</h2>

            <MeasurementField
              label="Bar length"
              value={inputs.ladderLength}
              help="axle center to front mount"
              onChange={(value) =>
                updateInput("ladderLength", value)
              }
            />

            <MeasurementField
              label="Front mount height"
              value={inputs.ladderFrontHeight}
              help="ground to mounting point"
              onChange={(value) =>
                updateInput(
                  "ladderFrontHeight",
                  value
                )
              }
            />
          </div>

          <div className="section">
            <h2>Vehicle</h2>

            <div className="two-column">
              <MeasurementField
                label="Wheelbase"
                value={inputs.wheelbase}
                onChange={(value) =>
                  updateInput("wheelbase", value)
                }
              />

              <MeasurementField
                label="Cam / CG height"
                value={inputs.cgHeight}
                help="cam height used as CG estimate"
                onChange={(value) =>
                  updateInput("cgHeight", value)
                }
              />
            </div>

            <MeasurementField
              label="Tire diameter"
              value={inputs.tireDiameter}
              onChange={(value) =>
                updateInput("tireDiameter", value)
              }
            />
          </div>
        </section>

        <section className="results-panel">
          <p className="eyebrow">CALCULATED GEOMETRY</p>
          <h2>Results</h2>

          {!result && (
            <div className="empty-state">
              Enter the ladder-bar and vehicle
              measurements to calculate the geometry.
            </div>
          )}

          {result && "error" in result && (
            <div className="error-box">
              {result.error}
            </div>
          )}

          {hasResult && (
            <>
              <LadderBarPlot
                inputs={numericInputs}
                result={result}
              />

              <LadderResultGrid result={result} />
            </>
          )}
        </section>
      </div>
    </>
  );
}

/* =========================================================
   THEORETICAL BAR CHANGE
========================================================= */

function BarChangeScreen({
  car,
}: {
  car: Car;
}) {
  const [spacing, setSpacing] = useState("0.625");

  const [offsets, setOffsets] =
    useState<BracketOffsets>({
      upperFront: 0,
      upperRear: 0,
      lowerFront: 0,
      lowerRear: 0,
    });

  if (car.suspensionType === "ladder-bar") {
    return (
      <LadderBarChangeScreen
        car={car}
        spacing={spacing}
        setSpacing={setSpacing}
      />
    );
  }

  const baseline = toNumericInputs(
    car.calculatorInputs
  );

  const baselineResult =
    calculateFourLink(baseline);

  if (
    baselineResult === null ||
    "error" in baselineResult
  ) {
    return (
      <section className="screen-card">
        <ScreenHeading
          eyebrow="THEORETICAL GEOMETRY"
          title="Theoretical Bar Change"
          description="Use your static setup as the baseline, then move any chassis-side or axle-side pin."
        />

        <div className="coming-soon-box">
          Finish a valid static setup on the IC & AS
          screen first. Bar Change uses those
          measurements as its baseline.
        </div>
      </section>
    );
  }

  const holeSpacing = Number(spacing);

  const validSpacing =
    Number.isFinite(holeSpacing) &&
    holeSpacing > 0;

  const spacingValue =
    validSpacing ? holeSpacing : 0;

  const theoreticalInputs: NumericInputs = {
    ...baseline,

    upperFrontHeight:
      baseline.upperFrontHeight +
      offsets.upperFront * spacingValue,

    upperRearHeight:
      baseline.upperRearHeight +
      offsets.upperRear * spacingValue,

    lowerFrontHeight:
      baseline.lowerFrontHeight +
      offsets.lowerFront * spacingValue,

    lowerRearHeight:
      baseline.lowerRearHeight +
      offsets.lowerRear * spacingValue,
  };

  const theoreticalResult: CalcResult =
    validSpacing
      ? calculateFourLink(theoreticalInputs)
      : {
          error:
            "Enter a hole spacing greater than zero.",
        };

  const selectedDescription =
    offsets.upperFront === 0 &&
    offsets.upperRear === 0 &&
    offsets.lowerFront === 0 &&
    offsets.lowerRear === 0
      ? "Current baseline holes"
      : "Theoretical bracket position";

  return (
    <>
      <div className="screen-heading-row">
        <ScreenHeading
          eyebrow="THEORETICAL GEOMETRY"
          title="Theoretical Bar Change"
          description="Move any upper or lower pin through the bracket holes and see the resulting geometry instantly."
        />

        <label className="compact-setting">
          <span>Hole spacing</span>

          <div className="compact-input">
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={spacing}
              onChange={(e) =>
                setSpacing(e.target.value)
              }
            />
            <span>in</span>
          </div>
        </label>
      </div>

      <div className="bar-change-layout">
        <section className="bracket-panel">
          <div className="bracket-section-heading">
            <div>
              <p className="eyebrow">UPPER LINK</p>
              <h2>Pin Position</h2>
            </div>

            <span>
              Physical bar length stays fixed.
            </span>
          </div>

          <div className="bracket-pair">
            <BracketSelector
              title="Axle Side"
              baselineHeight={
                baseline.upperRearHeight
              }
              selectedOffset={
                offsets.upperRear
              }
              spacing={spacingValue}
              onChange={(value) =>
                setOffsets((current) => ({
                  ...current,
                  upperRear: value,
                }))
              }
            />

            <BracketSelector
              title="Chassis Side"
              baselineHeight={
                baseline.upperFrontHeight
              }
              selectedOffset={
                offsets.upperFront
              }
              spacing={spacingValue}
              onChange={(value) =>
                setOffsets((current) => ({
                  ...current,
                  upperFront: value,
                }))
              }
            />
          </div>

          <div className="bracket-divider" />

          <div className="bracket-section-heading">
            <div>
              <p className="eyebrow">LOWER LINK</p>
              <h2>Pin Position</h2>
            </div>
          </div>

          <div className="bracket-pair">
            <BracketSelector
              title="Axle Side"
              baselineHeight={
                baseline.lowerRearHeight
              }
              selectedOffset={
                offsets.lowerRear
              }
              spacing={spacingValue}
              onChange={(value) =>
                setOffsets((current) => ({
                  ...current,
                  lowerRear: value,
                }))
              }
            />

            <BracketSelector
              title="Chassis Side"
              baselineHeight={
                baseline.lowerFrontHeight
              }
              selectedOffset={
                offsets.lowerFront
              }
              spacing={spacingValue}
              onChange={(value) =>
                setOffsets((current) => ({
                  ...current,
                  lowerFront: value,
                }))
              }
            />
          </div>

          <button
            type="button"
            className="secondary-button reset-holes"
            onClick={() =>
              setOffsets({
                upperFront: 0,
                upperRear: 0,
                lowerFront: 0,
                lowerRear: 0,
              })
            }
          >
            Return to Current Holes
          </button>
        </section>

        <section className="results-panel bar-results">
          <p className="eyebrow">
            {selectedDescription.toUpperCase()}
          </p>

          <h2>Results</h2>

          {theoreticalResult &&
            "error" in theoreticalResult && (
              <div className="error-box">
                {theoreticalResult.error}
              </div>
            )}

          {theoreticalResult &&
            !("error" in theoreticalResult) && (
              <>
                <SuspensionPlot
                  inputs={theoreticalInputs}
                  result={theoreticalResult}
                />

                <ResultGrid
                  result={theoreticalResult}
                />

                <GeometryDifference
                  baseline={baselineResult}
                  changed={theoreticalResult}
                />
              </>
            )}
        </section>
      </div>
    </>
  );
}

function LadderBarChangeScreen({
  car,
  spacing,
  setSpacing,
}: {
  car: Car;
  spacing: string;
  setSpacing: (value: string) => void;
}) {
  const [offset, setOffset] = useState(0);

  const baseline = toLadderInputs(
    car.calculatorInputs
  );

  const baselineResult =
    calculateLadderBar(baseline);

  if (
    baselineResult === null ||
    "error" in baselineResult
  ) {
    return (
      <section className="screen-card">
        <ScreenHeading
          eyebrow="THEORETICAL GEOMETRY"
          title="Theoretical Bar Change"
          description="Move the ladder-bar front mounting point through the available holes."
        />

        <div className="coming-soon-box">
          Finish a valid ladder-bar setup on the IC & AS
          screen first.
        </div>
      </section>
    );
  }

  const holeSpacing = Number(spacing);

  const validSpacing =
    Number.isFinite(holeSpacing) &&
    holeSpacing > 0;

  const spacingValue =
    validSpacing ? holeSpacing : 0;

  const theoreticalInputs: LadderInputs = {
    ...baseline,
    ladderFrontHeight:
      baseline.ladderFrontHeight +
      offset * spacingValue,
  };

  const theoreticalResult: LadderCalcResult =
    validSpacing
      ? calculateLadderBar(theoreticalInputs)
      : {
          error:
            "Enter a hole spacing greater than zero.",
        };

  return (
    <>
      <div className="screen-heading-row">
        <ScreenHeading
          eyebrow="THEORETICAL GEOMETRY"
          title="Theoretical Bar Change"
          description="Move the ladder-bar front mounting point up or down and see the new instant center and anti-squat."
        />

        <label className="compact-setting">
          <span>Hole spacing</span>

          <div className="compact-input">
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={spacing}
              onChange={(e) =>
                setSpacing(e.target.value)
              }
            />
            <span>in</span>
          </div>
        </label>
      </div>

      <div className="bar-change-layout">
        <section className="bracket-panel">
          <div className="bracket-section-heading">
            <div>
              <p className="eyebrow">LADDER BAR</p>
              <h2>Front Mount</h2>
            </div>

            <span>
              Physical bar length stays fixed.
            </span>
          </div>

          <div className="ladder-selector-wrap">
            <BracketSelector
              title="Chassis Mount"
              baselineHeight={
                baseline.ladderFrontHeight
              }
              selectedOffset={offset}
              spacing={spacingValue}
              onChange={setOffset}
            />
          </div>

          <button
            type="button"
            className="secondary-button reset-holes"
            onClick={() => setOffset(0)}
          >
            Return to Current Hole
          </button>
        </section>

        <section className="results-panel bar-results">
          <p className="eyebrow">
            {offset === 0
              ? "CURRENT BASELINE HOLE"
              : "THEORETICAL MOUNT POSITION"}
          </p>

          <h2>Results</h2>

          {theoreticalResult &&
            "error" in theoreticalResult && (
              <div className="error-box">
                {theoreticalResult.error}
              </div>
            )}

          {theoreticalResult &&
            !("error" in theoreticalResult) && (
              <>
                <LadderBarPlot
                  inputs={theoreticalInputs}
                  result={theoreticalResult}
                />

                <LadderResultGrid
                  result={theoreticalResult}
                />

                <LadderDifference
                  baseline={baselineResult}
                  changed={theoreticalResult}
                />
              </>
            )}
        </section>
      </div>
    </>
  );
}

function BracketSelector({
  title,
  baselineHeight,
  selectedOffset,
  spacing,
  onChange,
}: {
  title: string;
  baselineHeight: number;
  selectedOffset: number;
  spacing: number;
  onChange: (offset: number) => void;
}) {
  const [showMoreUp, setShowMoreUp] = useState(
    selectedOffset >= 3
  );

  const [showMoreDown, setShowMoreDown] = useState(
    selectedOffset <= -3
  );

  const upperExtra = [6, 5, 4, 3];
  const normal = [2, 1, 0, -1, -2];
  const lowerExtra = [-3, -4, -5, -6];

  function renderHole(offset: number) {
    const height =
      baselineHeight + offset * spacing;

    let label = "Current";

    if (offset > 0) {
      label = `+${offset} hole${
        offset === 1 ? "" : "s"
      }`;
    }

    if (offset < 0) {
      const amount = Math.abs(offset);
      label = `${amount} hole${
        amount === 1 ? "" : "s"
      } down`;
    }

    return (
      <button
        type="button"
        key={offset}
        className={`hole-option ${
          selectedOffset === offset ? "selected" : ""
        }`}
        onClick={() => onChange(offset)}
      >
        <span className="hole-circle" />

        <span className="hole-position">
          {label}
        </span>

        <strong>
          {Number.isFinite(height)
            ? `${height.toFixed(3)}"`
            : "—"}
        </strong>
      </button>
    );
  }

  return (
    <div className="bracket-selector">
      <div className="bracket-selector-title">
        <h3>{title}</h3>
        <span>
          Current {baselineHeight.toFixed(3)}"
        </span>
      </div>

      <div className="hole-stack">
        <button
          type="button"
          className={`more-holes-button ${
            showMoreUp ? "expanded" : ""
          }`}
          aria-label="Show more holes above"
          title="More holes above"
          onClick={() =>
            setShowMoreUp((current) => !current)
          }
        >
          <span>⌃</span>
          <small>
            {showMoreUp ? "less" : "3–6"}
          </small>
        </button>

        {showMoreUp &&
          upperExtra.map((offset) =>
            renderHole(offset)
          )}

        {normal.map((offset) =>
          renderHole(offset)
        )}

        {showMoreDown &&
          lowerExtra.map((offset) =>
            renderHole(offset)
          )}

        <button
          type="button"
          className={`more-holes-button ${
            showMoreDown ? "expanded" : ""
          }`}
          aria-label="Show more holes below"
          title="More holes below"
          onClick={() =>
            setShowMoreDown((current) => !current)
          }
        >
          <span>⌄</span>
          <small>
            {showMoreDown ? "less" : "3–6"}
          </small>
        </button>
      </div>
    </div>
  );
}

function GeometryDifference({
  baseline,
  changed,
}: {
  baseline: SuccessfulResult;
  changed: SuccessfulResult;
}) {
  return (
    <div className="difference-strip">
      <DifferenceItem
        label="IC Length"
        value={changed.icLength - baseline.icLength}
        suffix={`"`}
      />

      <DifferenceItem
        label="IC Height"
        value={changed.icHeight - baseline.icHeight}
        suffix={`"`}
      />

      <DifferenceItem
        label="Anti-Squat"
        value={changed.antiSquat - baseline.antiSquat}
        suffix="%"
      />
    </div>
  );
}

function DifferenceItem({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix: string;
}) {
  const sign = value > 0 ? "+" : "";

  return (
    <div>
      <span>{label} change</span>
      <strong>
        {sign}
        {value.toFixed(1)}
        {suffix}
      </strong>
    </div>
  );
}

/* =========================================================
   DYNAMIC GEOMETRY
========================================================= */

function DynamicScreen({
  car,
}: {
  car: Car;
}) {
  const [travel, setTravel] = useState(0);

  const travelSteps: number[] = [];

  for (
    let value = -2;
    value <= 7.0001;
    value += 0.5
  ) {
    travelSteps.push(Number(value.toFixed(1)));
  }

  if (car.suspensionType === "ladder-bar") {
    const baseline = toLadderInputs(
      car.calculatorInputs
    );

    const baselineResult =
      calculateLadderBar(baseline);

    if (
      baselineResult === null ||
      "error" in baselineResult
    ) {
      return (
        <section className="screen-card">
          <ScreenHeading
            eyebrow="SUSPENSION TRAVEL"
            title="Dynamic Geometry"
            description="Sweep the current ladder-bar geometry through squat and separation."
          />

          <div className="coming-soon-box">
            Finish a valid ladder-bar setup on the IC &
            AS screen first.
          </div>
        </section>
      );
    }

    const dynamicInputs: LadderInputs = {
      ...baseline,
      ladderFrontHeight:
        baseline.ladderFrontHeight + travel,
    };

    const dynamicResult =
      calculateLadderBar(dynamicInputs);

    return (
      <>
        <ScreenHeading
          eyebrow="SUSPENSION TRAVEL"
          title="Dynamic Geometry"
          description="Move the chassis-mounted ladder-bar pivot with rear suspension travel while the rear axle center and physical bar length stay fixed."
        />

        <div className="dynamic-layout">
          <TravelControls
            travel={travel}
            onTravelChange={setTravel}
            travelSteps={travelSteps}
          />

          <section className="results-panel dynamic-results">
            <DynamicResultEyebrow travel={travel} />

            <h2>Results</h2>

            {dynamicResult &&
              "error" in dynamicResult && (
                <div className="error-box">
                  {dynamicResult.error}
                </div>
              )}

            {dynamicResult &&
              !("error" in dynamicResult) && (
                <>
                  <LadderBarPlot
                    inputs={dynamicInputs}
                    result={dynamicResult}
                  />

                  <LadderResultGrid
                    result={dynamicResult}
                  />

                  <LadderDifference
                    baseline={baselineResult}
                    changed={dynamicResult}
                  />
                </>
              )}
          </section>
        </div>
      </>
    );
  }

  const baseline = toNumericInputs(
    car.calculatorInputs
  );

  const baselineResult =
    calculateFourLink(baseline);

  if (
    baselineResult === null ||
    "error" in baselineResult
  ) {
    return (
      <section className="screen-card">
        <ScreenHeading
          eyebrow="SUSPENSION TRAVEL"
          title="Dynamic Geometry"
          description="Sweep the current 4-link through squat and separation."
        />

        <div className="coming-soon-box">
          Finish a valid static setup on the IC & AS
          screen first.
        </div>
      </section>
    );
  }

  const dynamicInputs: NumericInputs = {
    ...baseline,
    upperFrontHeight:
      baseline.upperFrontHeight + travel,
    lowerFrontHeight:
      baseline.lowerFrontHeight + travel,
  };

  const dynamicResult =
    calculateFourLink(dynamicInputs);

  return (
    <>
      <ScreenHeading
        eyebrow="SUSPENSION TRAVEL"
        title="Dynamic Geometry"
        description="Move the chassis-side pivots through squat or separation while the axle-side pivots and physical bar lengths stay fixed."
      />

      <div className="dynamic-layout">
        <TravelControls
          travel={travel}
          onTravelChange={setTravel}
          travelSteps={travelSteps}
        />

        <section className="results-panel dynamic-results">
          <DynamicResultEyebrow travel={travel} />

          <h2>Results</h2>

          {dynamicResult &&
            "error" in dynamicResult && (
              <div className="error-box">
                {dynamicResult.error}
              </div>
            )}

          {dynamicResult &&
            !("error" in dynamicResult) && (
              <>
                <SuspensionPlot
                  inputs={dynamicInputs}
                  result={dynamicResult}
                />

                <ResultGrid result={dynamicResult} />

                <GeometryDifference
                  baseline={baselineResult}
                  changed={dynamicResult}
                />
              </>
            )}
        </section>
      </div>
    </>
  );
}

function TravelControls({
  travel,
  onTravelChange,
  travelSteps,
}: {
  travel: number;
  onTravelChange: (value: number) => void;
  travelSteps: number[];
}) {
  return (
    <section className="travel-control-panel">
      <div className="travel-readout">
        <span>Rear suspension movement</span>

        <strong>
          {travel > 0 ? "+" : ""}
          {travel.toFixed(1)}"
        </strong>

        <small>
          {travel > 0
            ? "Separation"
            : travel < 0
              ? "Squat"
              : "Static"}
        </small>
      </div>

      <input
        className="travel-slider"
        type="range"
        min="-2"
        max="7"
        step="0.5"
        value={travel}
        onChange={(e) =>
          onTravelChange(Number(e.target.value))
        }
      />

      <div className="travel-scale">
        <span>-2" squat</span>
        <span>0"</span>
        <span>+7" separation</span>
      </div>

      <div className="travel-step-grid">
        {travelSteps.map((step) => (
          <button
            type="button"
            key={step}
            className={
              travel === step ? "selected" : ""
            }
            onClick={() => onTravelChange(step)}
          >
            {step > 0 ? "+" : ""}
            {step.toFixed(1)}
          </button>
        ))}
      </div>

      <p className="dynamic-note">
        IC location and bar angle are calculated directly
        from the changed geometry. Dynamic anti-squat
        currently keeps the entered cam/CG height fixed,
        so treat AS as an estimate until chassis pitch /
        CG movement is added.
      </p>
    </section>
  );
}

function DynamicResultEyebrow({
  travel,
}: {
  travel: number;
}) {
  return (
    <p className="eyebrow">
      {travel > 0
        ? "SEPARATED GEOMETRY"
        : travel < 0
          ? "SQUATTED GEOMETRY"
          : "STATIC GEOMETRY"}
    </p>
  );
}

/* =========================================================
   GARAGE
========================================================= */

function GarageScreen({
  cars,
  activeCarId,
  showAddCar,
  onShowAddCar,
  onHideAddCar,
  onCreateCar,
  onSelectCar,
  onLoadSetup,
  onDeleteSetup,
  onAddRun,
  onUpdateRun,
  onDeleteRun,
  onDeleteCar,
}: {
  cars: Car[];
  activeCarId: string | null;
  showAddCar: boolean;
  onShowAddCar: () => void;
  onHideAddCar: () => void;
  onCreateCar: (
    name: string,
    type: SuspensionType
  ) => void;
  onSelectCar: (id: string) => void;
  onLoadSetup: (
    carId: string,
    setup: SavedSetup
  ) => void;
  onDeleteSetup: (
    carId: string,
    setupId: string
  ) => void;
  onAddRun: (
    carId: string,
    setupId: string,
    run: Omit<RunLog, "id" | "createdAt">
  ) => void;
  onUpdateRun: (
    carId: string,
    setupId: string,
    runId: string,
    run: Omit<RunLog, "id" | "createdAt">
  ) => void;
  onDeleteRun: (
    carId: string,
    setupId: string,
    runId: string
  ) => void;
  onDeleteCar: (carId: string) => void;
}) {
  return (
    <>
      <div className="screen-heading-row">
        <ScreenHeading
          eyebrow="SAVED VEHICLES"
          title="Garage"
          description="Cars, saved suspension setups, and run logs."
        />

        <button
          type="button"
          className="primary-button"
          onClick={onShowAddCar}
        >
          + Add Car
        </button>
      </div>

      {showAddCar && (
        <section className="screen-card add-car-card">
          <h2>Add another car</h2>

          <AddCarForm
            onCreate={onCreateCar}
            onCancel={onHideAddCar}
          />
        </section>
      )}

      <div className="garage-grid">
        {cars.map((car) => (
          <section
            className={`garage-car ${
              car.id === activeCarId ? "active" : ""
            }`}
            key={car.id}
          >
            <div className="garage-car-header">
              <div>
                <h2>{car.name}</h2>

                <span className="suspension-badge">
                  {car.suspensionType === "4-link"
                    ? "4-Link"
                    : "Ladder Bar"}
                </span>
              </div>

              <div className="garage-car-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onSelectCar(car.id)}
                >
                  Open
                </button>

                <button
                  type="button"
                  className="danger-button"
                  onClick={() => onDeleteCar(car.id)}
                >
                  Delete
                </button>
              </div>
            </div>

            <div className="saved-setup-heading">
              Saved Setups
              <span>{car.savedSetups.length}</span>
            </div>

            {car.savedSetups.length === 0 ? (
              <div className="no-setups">
                No saved setups yet.
              </div>
            ) : (
              <div className="setup-list">
                {car.savedSetups.map((setup) => (
                  <SavedSetupRunLog
                    key={setup.id}
                    carId={car.id}
                    setup={setup}
                    onLoadSetup={onLoadSetup}
                    onDeleteSetup={onDeleteSetup}
                    suspensionType={car.suspensionType}
                    onAddRun={onAddRun}
                    onUpdateRun={onUpdateRun}
                    onDeleteRun={onDeleteRun}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

function SavedSetupRunLog({
  carId,
  setup,
  suspensionType,
  onLoadSetup,
  onDeleteSetup,
  onAddRun,
  onUpdateRun,
  onDeleteRun,
}: {
  carId: string;
  setup: SavedSetup;
  suspensionType: SuspensionType;
  onLoadSetup: (
    carId: string,
    setup: SavedSetup
  ) => void;
  onDeleteSetup: (
    carId: string,
    setupId: string
  ) => void;
  onAddRun: (
    carId: string,
    setupId: string,
    run: Omit<RunLog, "id" | "createdAt">
  ) => void;
  onUpdateRun: (
    carId: string,
    setupId: string,
    runId: string,
    run: Omit<RunLog, "id" | "createdAt">
  ) => void;
  onDeleteRun: (
    carId: string,
    setupId: string,
    runId: string
  ) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingRun, setAddingRun] = useState(false);
  const [editingRunId, setEditingRunId] =
    useState<string | null>(null);

  const runs = setup.runs ?? [];

  const fourLinkResult =
    suspensionType === "4-link"
      ? calculateFourLink(
          toNumericInputs(setup.inputs)
        )
      : null;

  const ladderResult =
    suspensionType === "ladder-bar"
      ? calculateLadderBar(
          toLadderInputs(setup.inputs)
        )
      : null;

  return (
    <div className="saved-setup-card">
      <div className="saved-setup-top-row">
        <button
          type="button"
          className="setup-main"
          onClick={() => onLoadSetup(carId, setup)}
        >
          <strong>{setup.name}</strong>

          <span>
            {new Date(
              setup.createdAt
            ).toLocaleDateString()}
          </span>
        </button>

        <button
          type="button"
          className="setup-delete"
          aria-label={`Delete ${setup.name}`}
          onClick={() =>
            onDeleteSetup(carId, setup.id)
          }
        >
          ×
        </button>
      </div>

      {fourLinkResult &&
        !("error" in fourLinkResult) && (
          <div className="setup-geometry-summary">
            <span>
              IC {fourLinkResult.icLength.toFixed(1)}" ×{" "}
              {fourLinkResult.icHeight.toFixed(1)}"
            </span>
            <span>
              AS {fourLinkResult.antiSquat.toFixed(0)}%
            </span>
          </div>
        )}

      {ladderResult &&
        !("error" in ladderResult) && (
          <div className="setup-geometry-summary">
            <span>
              IC {ladderResult.icLength.toFixed(1)}" ×{" "}
              {ladderResult.icHeight.toFixed(1)}"
            </span>
            <span>
              AS {ladderResult.antiSquat.toFixed(0)}%
            </span>
          </div>
        )}

      <button
        type="button"
        className="run-log-toggle"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <span className="run-log-arrow">
          {expanded ? "⌃" : "⌄"}
        </span>

        <span>Run Log</span>

        <small>
          {runs.length} {runs.length === 1 ? "run" : "runs"}
        </small>
      </button>

      {expanded && (
        <div className="run-log-panel">
          {runs.length === 0 ? (
            <div className="empty-run-log">
              No runs saved for this setup.
            </div>
          ) : (
            <div className="run-list">
              {runs.map((run, index) => (
                <RunLogCard
                  key={run.id}
                  run={run}
                  runNumber={index + 1}
                  editing={editingRunId === run.id}
                  onEdit={() => {
                    setAddingRun(false);
                    setEditingRunId(run.id);
                  }}
                  onCancelEdit={() =>
                    setEditingRunId(null)
                  }
                  onSaveEdit={(updatedRun) => {
                    onUpdateRun(
                      carId,
                      setup.id,
                      run.id,
                      updatedRun
                    );
                    setEditingRunId(null);
                  }}
                  onDelete={() => {
                    setEditingRunId(null);
                    onDeleteRun(
                      carId,
                      setup.id,
                      run.id
                    );
                  }}
                />
              ))}
            </div>
          )}

          {addingRun ? (
            <RunLogForm
              onCancel={() => setAddingRun(false)}
              onSave={(run) => {
                onAddRun(carId, setup.id, run);
                setAddingRun(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="add-run-button"
              onClick={() => {
                setEditingRunId(null);
                setAddingRun(true);
              }}
            >
              + Add Run
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RunLogCard({
  run,
  runNumber,
  editing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  run: RunLog;
  runNumber: number;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (
    run: Omit<RunLog, "id" | "createdAt">
  ) => void;
  onDelete: () => void;
}) {
  const performance = [
    run.sixtyFoot && `60' ${run.sixtyFoot}`,
    run.threeThirty && `330' ${run.threeThirty}`,
    run.eighthEt && `1/8 ${run.eighthEt}`,
    run.eighthMph && `${run.eighthMph} mph`,
  ].filter(Boolean);

  const setupData = [
    run.frontRebound && `F Reb ${run.frontRebound}`,
    run.frontCompression && `F Comp ${run.frontCompression}`,
    run.rearRebound && `R Reb ${run.rearRebound}`,
    run.rearCompression && `R Comp ${run.rearCompression}`,
    run.rearTirePressure &&
      `Rear tire ${run.rearTirePressure} psi`,
    run.rearWeightBias &&
      `Rear bias ${run.rearWeightBias}%`,
  ].filter(Boolean);

  if (editing) {
    return (
      <RunLogForm
        initialRun={run}
        title={`Edit Run ${runNumber}`}
        submitLabel="Save Changes"
        onCancel={onCancelEdit}
        onSave={onSaveEdit}
      />
    );
  }

  return (
    <div className="run-card">
      <div className="run-card-header">
        <div>
          <strong>
            Run {runNumber}
            {run.trackSurface
              ? ` — ${run.trackSurface}`
              : ""}
          </strong>

          <span>
            {new Date(
              run.createdAt
            ).toLocaleDateString()}
          </span>
        </div>

        <div className="run-card-actions">
          <button
            type="button"
            className="run-edit"
            onClick={onEdit}
          >
            Edit
          </button>

          <button
            type="button"
            className="run-delete"
            aria-label={`Delete run ${runNumber}`}
            onClick={onDelete}
          >
            ×
          </button>
        </div>
      </div>

      {performance.length > 0 && (
        <div className="run-performance">
          {performance.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}

      {setupData.length > 0 && (
        <div className="run-setup-data">
          {setupData.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}

      {run.notes && (
        <p className="run-notes">{run.notes}</p>
      )}
    </div>
  );
}

function RunLogForm({
  onSave,
  onCancel,
  initialRun,
  title = "Run Data",
  submitLabel = "Save Run",
}: {
  onSave: (
    run: Omit<RunLog, "id" | "createdAt">
  ) => void;
  onCancel: () => void;
  initialRun?: RunLog;
  title?: string;
  submitLabel?: string;
}) {
  const [run, setRun] = useState<
    Omit<RunLog, "id" | "createdAt">
  >(() => ({
    trackSurface: initialRun?.trackSurface ?? "",
    frontRebound: initialRun?.frontRebound ?? "",
    frontCompression:
      initialRun?.frontCompression ?? "",
    rearRebound: initialRun?.rearRebound ?? "",
    rearCompression:
      initialRun?.rearCompression ?? "",
    rearTirePressure:
      initialRun?.rearTirePressure ?? "",
    rearWeightBias:
      initialRun?.rearWeightBias ?? "",
    sixtyFoot: initialRun?.sixtyFoot ?? "",
    threeThirty: initialRun?.threeThirty ?? "",
    eighthEt: initialRun?.eighthEt ?? "",
    eighthMph: initialRun?.eighthMph ?? "",
    notes: initialRun?.notes ?? "",
  }));

  function update(
    key: keyof Omit<RunLog, "id" | "createdAt">,
    value: string
  ) {
    setRun((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSave(run);
  }

  return (
    <form className="run-form" onSubmit={submit}>
      <div className="run-form-heading">
        <div>
          <p className="eyebrow">NEW RUN</p>
          <h3>{title}</h3>
        </div>

        <span>Everything is optional.</span>
      </div>

      <label className="run-field run-field-full">
        <span>Track / surface</span>
        <input
          type="text"
          value={run.trackSurface}
          placeholder="Airport asphalt"
          onChange={(e) =>
            update("trackSurface", e.target.value)
          }
        />
      </label>

      <div className="run-form-grid">
        <RunField
          label="Front rebound"
          value={run.frontRebound}
          onChange={(value) =>
            update("frontRebound", value)
          }
        />

        <RunField
          label="Front compression"
          value={run.frontCompression}
          onChange={(value) =>
            update("frontCompression", value)
          }
        />

        <RunField
          label="Rear rebound"
          value={run.rearRebound}
          onChange={(value) =>
            update("rearRebound", value)
          }
        />

        <RunField
          label="Rear compression"
          value={run.rearCompression}
          onChange={(value) =>
            update("rearCompression", value)
          }
        />

        <RunField
          label="Rear tire pressure"
          value={run.rearTirePressure}
          suffix="psi"
          inputMode="decimal"
          onChange={(value) =>
            update("rearTirePressure", value)
          }
        />

        <RunField
          label="Rear weight bias"
          value={run.rearWeightBias}
          suffix="%"
          inputMode="decimal"
          onChange={(value) =>
            update("rearWeightBias", value)
          }
        />

        <RunField
          label="60 ft"
          value={run.sixtyFoot}
          inputMode="decimal"
          onChange={(value) =>
            update("sixtyFoot", value)
          }
        />

        <RunField
          label="330 ft"
          value={run.threeThirty}
          inputMode="decimal"
          onChange={(value) =>
            update("threeThirty", value)
          }
        />

        <RunField
          label="1/8 ET"
          value={run.eighthEt}
          inputMode="decimal"
          onChange={(value) =>
            update("eighthEt", value)
          }
        />

        <RunField
          label="1/8 MPH"
          value={run.eighthMph}
          inputMode="decimal"
          onChange={(value) =>
            update("eighthMph", value)
          }
        />
      </div>

      <label className="run-field run-field-full">
        <span>Notes</span>
        <textarea
          value={run.notes}
          placeholder="Track came around, carried the front, small wheel speed..."
          onChange={(e) =>
            update("notes", e.target.value)
          }
        />
      </label>

      <div className="run-form-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={onCancel}
        >
          Cancel
        </button>

        <button
          type="submit"
          className="primary-button"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function RunField({
  label,
  value,
  onChange,
  suffix,
  inputMode = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  inputMode?: "text" | "decimal";
}) {
  return (
    <label className="run-field">
      <span>{label}</span>

      <div className="run-input-wrap">
        <input
          type="text"
          inputMode={inputMode}
          value={value}
          onChange={(e) =>
            onChange(e.target.value)
          }
        />

        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}

/* =========================================================
   BOTTOM NAVIGATION
========================================================= */

function BottomNav({
  activeTab,
  onChange,
}: {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}) {
  const tabs: {
    id: Tab;
    short: string;
    label: string;
  }[] = [
    {
      id: "calculator",
      short: "IC & AS",
      label: "IC & AS Calculation",
    },
    {
      id: "bar-change",
      short: "Bar Change",
      label: "Theoretical Bar Change",
    },
    {
      id: "dynamic",
      short: "Dynamic",
      label: "Dynamic Geometry",
    },
    {
      id: "garage",
      short: "Garage",
      label: "Garage",
    },
  ];

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={
            activeTab === tab.id ? "active" : ""
          }
          onClick={() => onChange(tab.id)}
          aria-label={tab.label}
        >
          {tab.short}
        </button>
      ))}
    </nav>
  );
}

/* =========================================================
   SHARED UI
========================================================= */

function MeasurementField({
  label,
  value,
  help,
  onChange,
}: {
  label: string;
  value: string;
  help?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <div className="field-header">
        <span>{label}</span>

        <small
          className={!help ? "empty-help" : ""}
        >
          {help || "\u00A0"}
        </small>
      </div>

      <div className="input-wrap">
        <input
          type="number"
          step="0.001"
          value={value}
          onChange={(e) =>
            onChange(e.target.value)
          }
          placeholder="0.000"
        />

        <span>in</span>
      </div>
    </label>
  );
}

function ScreenHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="screen-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function ResultGrid({
  result,
}: {
  result: SuccessfulResult;
}) {
  return (
    <>
      <div className="primary-results">
        <ResultCard
          label="IC Length"
          value={`${result.icLength.toFixed(2)}"`}
        />

        <ResultCard
          label="IC Height"
          value={`${result.icHeight.toFixed(2)}"`}
        />

        <ResultCard
          label="Anti-Squat"
          value={`${result.antiSquat.toFixed(1)}%`}
          large
        />
      </div>

      <div className="secondary-results">
        <ResultCard
          label="Upper Angle"
          value={`${result.upperAngle.toFixed(2)}°`}
        />

        <ResultCard
          label="Lower Angle"
          value={`${result.lowerAngle.toFixed(2)}°`}
        />

        <ResultCard
          label="Upper Horizontal"
          value={`${result.upperRun.toFixed(2)}"`}
        />

        <ResultCard
          label="Lower Horizontal"
          value={`${result.lowerRun.toFixed(2)}"`}
        />
      </div>
    </>
  );
}

function ResultCard({
  label,
  value,
  large = false,
}: {
  label: string;
  value: string;
  large?: boolean;
}) {
  return (
    <div
      className={`result-card ${
        large ? "large" : ""
      }`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}


function LadderResultGrid({
  result,
}: {
  result: LadderResult;
}) {
  return (
    <>
      <div className="primary-results">
        <ResultCard
          label="IC Length"
          value={`${result.icLength.toFixed(2)}"`}
        />

        <ResultCard
          label="IC Height"
          value={`${result.icHeight.toFixed(2)}"`}
        />

        <ResultCard
          label="Anti-Squat"
          value={`${result.antiSquat.toFixed(1)}%`}
          large
        />
      </div>

      <div className="secondary-results ladder-secondary-results">
        <ResultCard
          label="Bar Angle"
          value={`${result.barAngle.toFixed(2)}°`}
        />

        <ResultCard
          label="Horizontal Length"
          value={`${result.horizontalRun.toFixed(2)}"`}
        />
      </div>
    </>
  );
}

function LadderDifference({
  baseline,
  changed,
}: {
  baseline: LadderResult;
  changed: LadderResult;
}) {
  return (
    <div className="difference-strip">
      <DifferenceItem
        label="IC Length"
        value={changed.icLength - baseline.icLength}
        suffix={`"`}
      />

      <DifferenceItem
        label="IC Height"
        value={changed.icHeight - baseline.icHeight}
        suffix={`"`}
      />

      <DifferenceItem
        label="Anti-Squat"
        value={changed.antiSquat - baseline.antiSquat}
        suffix="%"
      />
    </div>
  );
}

function LadderBarPlot({
  inputs,
  result,
}: {
  inputs: LadderInputs;
  result: LadderResult;
}) {
  const tireRadius = inputs.tireDiameter / 2;

  const rearAxle = {
    x: 0,
    y: tireRadius,
  };

  const frontAxle = {
    x: inputs.wheelbase,
    y: tireRadius,
  };

  const frontPivot = {
    x: result.icLength,
    y: result.icHeight,
  };

  const contactPatch = {
    x: 0,
    y: 0,
  };

  const cgReference = {
    x: inputs.wheelbase,
    y: inputs.cgHeight,
  };

  const minX = -tireRadius - 10;

  const maxX =
    Math.max(
      inputs.wheelbase + tireRadius + 10,
      frontPivot.x
    ) + 2;

  const maxY =
    Math.max(
      tireRadius * 2,
      frontPivot.y,
      inputs.cgHeight
    ) + 10;

  const width = 760;
  const height = 340;

  const padding = {
    left: 28,
    right: 28,
    top: 24,
    bottom: 28,
  };

  const availableWidth =
    width - padding.left - padding.right;

  const availableHeight =
    height - padding.top - padding.bottom;

  const scale = Math.min(
    availableWidth /
      Math.max(maxX - minX, 1),
    availableHeight /
      Math.max(maxY, 1)
  );

  const drawingWidth =
    (maxX - minX) * scale;

  const drawingHeight = maxY * scale;

  const offsetX =
    padding.left +
    (availableWidth - drawingWidth) / 2;

  const groundY =
    height -
    padding.bottom -
    (availableHeight - drawingHeight) / 2;

  function mapPoint(point: {
    x: number;
    y: number;
  }) {
    return {
      x:
        offsetX +
        (point.x - minX) * scale,
      y:
        groundY -
        point.y * scale,
    };
  }

  const rearAxleSvg = mapPoint(rearAxle);
  const frontAxleSvg = mapPoint(frontAxle);
  const frontPivotSvg = mapPoint(frontPivot);
  const contactSvg = mapPoint(contactPatch);
  const cgSvg = mapPoint(cgReference);

  return (
    <div className="geometry-card">
      <div className="geometry-title-row">
        <div>
          <p className="eyebrow">SIDE VIEW</p>
          <h3>Ladder-Bar Geometry</h3>
        </div>

        <div className="geometry-ic-readout">
          IC {result.icLength.toFixed(1)}" ×{" "}
          {result.icHeight.toFixed(1)}"
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="geometry-svg"
        role="img"
        aria-label="Scaled side view of ladder-bar suspension geometry"
      >
        <line
          x1={padding.left}
          y1={groundY}
          x2={width - padding.right}
          y2={groundY}
          className="geometry-ground"
        />

        <circle
          cx={rearAxleSvg.x}
          cy={rearAxleSvg.y}
          r={tireRadius * scale}
          className="geometry-tire"
        />

        <circle
          cx={frontAxleSvg.x}
          cy={frontAxleSvg.y}
          r={tireRadius * scale}
          className="geometry-tire front-tire"
        />

        <circle
          cx={rearAxleSvg.x}
          cy={rearAxleSvg.y}
          r={4}
          className="geometry-axle"
        />

        <circle
          cx={frontAxleSvg.x}
          cy={frontAxleSvg.y}
          r={3}
          className="geometry-axle front-axle"
        />

        <line
          x1={contactSvg.x}
          y1={contactSvg.y}
          x2={cgSvg.x}
          y2={cgSvg.y}
          className="reference-line"
        />

        <line
          x1={contactSvg.x}
          y1={contactSvg.y}
          x2={frontPivotSvg.x}
          y2={frontPivotSvg.y}
          className="antisquat-line"
        />

        <line
          x1={rearAxleSvg.x}
          y1={rearAxleSvg.y}
          x2={frontPivotSvg.x}
          y2={frontPivotSvg.y}
          className="geometry-bar ladder-bar-line"
        />

        <circle
          cx={frontPivotSvg.x}
          cy={frontPivotSvg.y}
          r={6}
          className="geometry-ic"
        />

        <text
          x={frontPivotSvg.x + 10}
          y={frontPivotSvg.y - 9}
          className="geometry-ic-label"
        >
          IC
        </text>
      </svg>
    </div>
  );
}

/* =========================================================
   SUSPENSION PLOT
========================================================= */

function SuspensionPlot({
  inputs,
  result,
}: {
  inputs: NumericInputs;
  result: SuccessfulResult;
}) {
  const tireRadius =
    Number.isFinite(inputs.tireDiameter) &&
    inputs.tireDiameter > 0
      ? inputs.tireDiameter / 2
      : 14;

  const rearAxle = {
    x: 0,
    y: tireRadius,
  };

  const frontAxle = {
    x: inputs.wheelbase,
    y: tireRadius,
  };

  const contactPatch = {
    x: 0,
    y: 0,
  };

  const upperRear = {
    x: 0,
    y: inputs.upperRearHeight,
  };

  const lowerRear = {
    x: 0,
    y: inputs.lowerRearHeight,
  };

  const upperFront = {
    x: result.upperRun,
    y: inputs.upperFrontHeight,
  };

  const lowerFront = {
    x: result.lowerRun,
    y: inputs.lowerFrontHeight,
  };

  const ic = {
    x: result.icLength,
    y: result.icHeight,
  };

  const cgReference = {
    x: inputs.wheelbase,
    y: inputs.cgHeight,
  };

  const minX = -tireRadius - 10;

  const maxX =
    Math.max(
      inputs.wheelbase + tireRadius + 10,
      upperFront.x,
      lowerFront.x,
      ic.x
    ) + 2;

  const maxY =
    Math.max(
      tireRadius * 2,
      upperRear.y,
      upperFront.y,
      lowerRear.y,
      lowerFront.y,
      ic.y,
      inputs.cgHeight
    ) + 10;

  const width = 760;
  const height = 340;

  const padding = {
    left: 28,
    right: 28,
    top: 24,
    bottom: 28,
  };

  const availableWidth =
    width - padding.left - padding.right;

  const availableHeight =
    height - padding.top - padding.bottom;

  const scale = Math.min(
    availableWidth /
      Math.max(maxX - minX, 1),

    availableHeight /
      Math.max(maxY, 1)
  );

  const drawingWidth =
    (maxX - minX) * scale;

  const drawingHeight = maxY * scale;

  const offsetX =
    padding.left +
    (availableWidth - drawingWidth) / 2;

  const groundY =
    height -
    padding.bottom -
    (availableHeight - drawingHeight) / 2;

  function mapPoint(point: {
    x: number;
    y: number;
  }) {
    return {
      x:
        offsetX +
        (point.x - minX) * scale,

      y:
        groundY -
        point.y * scale,
    };
  }

  const rearAxleSvg = mapPoint(rearAxle);
  const frontAxleSvg = mapPoint(frontAxle);
  const contactSvg = mapPoint(contactPatch);
  const upperRearSvg = mapPoint(upperRear);
  const upperFrontSvg = mapPoint(upperFront);
  const lowerRearSvg = mapPoint(lowerRear);
  const lowerFrontSvg = mapPoint(lowerFront);
  const icSvg = mapPoint(ic);
  const cgSvg = mapPoint(cgReference);

  return (
    <div className="geometry-card">
      <div className="geometry-title-row">
        <div>
          <p className="eyebrow">SIDE VIEW</p>
          <h3>4-Link Geometry</h3>
        </div>

        <div className="geometry-ic-readout">
          IC {result.icLength.toFixed(1)}" ×{" "}
          {result.icHeight.toFixed(1)}"
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="geometry-svg"
        role="img"
        aria-label="Scaled side view of four-link suspension geometry"
      >
        <line
          x1={padding.left}
          y1={groundY}
          x2={width - padding.right}
          y2={groundY}
          className="geometry-ground"
        />

        <circle
          cx={rearAxleSvg.x}
          cy={rearAxleSvg.y}
          r={tireRadius * scale}
          className="geometry-tire"
        />

        <circle
          cx={frontAxleSvg.x}
          cy={frontAxleSvg.y}
          r={tireRadius * scale}
          className="geometry-tire front-tire"
        />

        <circle
          cx={rearAxleSvg.x}
          cy={rearAxleSvg.y}
          r={4}
          className="geometry-axle"
        />

        <circle
          cx={frontAxleSvg.x}
          cy={frontAxleSvg.y}
          r={3}
          className="geometry-axle front-axle"
        />

        <line
          x1={contactSvg.x}
          y1={contactSvg.y}
          x2={cgSvg.x}
          y2={cgSvg.y}
          className="reference-line"
        />

        <line
          x1={contactSvg.x}
          y1={contactSvg.y}
          x2={icSvg.x}
          y2={icSvg.y}
          className="antisquat-line"
        />

        <line
          x1={upperRearSvg.x}
          y1={upperRearSvg.y}
          x2={icSvg.x}
          y2={icSvg.y}
          className="link-extension upper-extension"
        />

        <line
          x1={lowerRearSvg.x}
          y1={lowerRearSvg.y}
          x2={icSvg.x}
          y2={icSvg.y}
          className="link-extension lower-extension"
        />

        <line
          x1={upperRearSvg.x}
          y1={upperRearSvg.y}
          x2={upperFrontSvg.x}
          y2={upperFrontSvg.y}
          className="geometry-bar upper-bar"
        />

        <line
          x1={lowerRearSvg.x}
          y1={lowerRearSvg.y}
          x2={lowerFrontSvg.x}
          y2={lowerFrontSvg.y}
          className="geometry-bar lower-bar"
        />

        <circle
          cx={upperRearSvg.x}
          cy={upperRearSvg.y}
          r={4.5}
          className="geometry-pivot"
        />

        <circle
          cx={upperFrontSvg.x}
          cy={upperFrontSvg.y}
          r={4.5}
          className="geometry-pivot"
        />

        <circle
          cx={lowerRearSvg.x}
          cy={lowerRearSvg.y}
          r={4.5}
          className="geometry-pivot"
        />

        <circle
          cx={lowerFrontSvg.x}
          cy={lowerFrontSvg.y}
          r={4.5}
          className="geometry-pivot"
        />

        <circle
          cx={icSvg.x}
          cy={icSvg.y}
          r={6}
          className="geometry-ic"
        />

        <text
          x={icSvg.x + 10}
          y={icSvg.y - 9}
          className="geometry-ic-label"
        >
          IC
        </text>
      </svg>
    </div>
  );
}

export default App;
