import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import "./App.css";
import { parseTelemetryFile } from "./telemetry/dragy";
import type {
  CalcResult,
  Car,
  DragyPoint,
  Inputs,
  LadderCalcResult,
  LadderInputs,
  LadderResult,
  NumericInputs,
  RunLog,
  RunTelemetry,
  SavedSetup,
  SurfaceRecord,
  SuccessfulResult,
  SuspensionType,
  Tab,
  ThemePreference,
  WeightData,
} from "./types";
import { RunTelemetryImporter } from "./components/RunTelemetryImporter";
import DataLogScreen from "./components/DataLogScreen";
import { CloudAccountPanel } from "./components/CloudAccountPanel";
import { useCloudGarageSync } from "./cloud/useCloudGarageSync";
import {
  calculateDynamicCg,
  calculateFourLink,
  calculateLadderBar,
  getRearBiasString,
  getWeightData,
  parseNumber,
  toLadderInputs,
  toNumericInputs,
} from "./calculations/geometry";
import {
  getModelGeometryAtTravel,
  simulateModelState,
  type ModelSnapshot,
} from "./calculations/modeling";
import {
  ACTIVE_CAR_STORAGE_KEY,
  CARS_STORAGE_KEY,
  DEFAULT_HOLE_SPACING,
  LEGACY_ACTIVE_CAR_STORAGE_KEY,
  emptyInputs,
  loadCarsFromLocalStorage,
  makeId,
  normalizeInputs,
} from "./storage/garageData";

/* =========================================================
   LOCAL UI TYPES
========================================================= */

type BracketOffsets = {
  upperFront: number;
  upperRear: number;
  lowerFront: number;
  lowerRear: number;
};

/* =========================================================
   CONSTANTS
========================================================= */

const THEME_STORAGE_KEY = "chassislab-theme";

/* =========================================================
   HELPERS / CALCULATION ENGINE
========================================================= */

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
  const [cars, setCars] = useState<Car[]>(loadCarsFromLocalStorage);
  const [activeTab, setActiveTab] =
    useState<Tab>("calculator");
  const [showAddCar, setShowAddCar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] =
    useState<ThemePreference>(loadTheme);

  const cloud = useCloudGarageSync(cars, setCars);
  const [modelTelemetry, setModelTelemetry] =
    useState<RunTelemetry | null>(null);
  const [theoreticalOffsets, setTheoreticalOffsets] = useState<BracketOffsets>({
    upperFront: 0,
    upperRear: 0,
    lowerFront: 0,
    lowerRear: 0,
  });

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
    setTheoreticalOffsets({ upperFront: 0, upperRear: 0, lowerFront: 0, lowerRear: 0 });
  }, [activeCarId]);

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

  useEffect(() => {
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => undefined);
    }
  }, []);

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
      holeSpacing: DEFAULT_HOLE_SPACING,
      savedSetups: [],
      surfaces: [],
    };

    setCars((current) => [...current, newCar]);
    setActiveCarId(newCar.id);
    setModelTelemetry(null);
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

  function updateActiveCarHoleSpacing(value: string) {
    if (!activeCarId) return;

    setCars((current) =>
      current.map((car) =>
        car.id === activeCarId
          ? { ...car, holeSpacing: value }
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
      holeSpacing:
        activeCar.holeSpacing || DEFAULT_HOLE_SPACING,
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
              calculatorInputs: { ...normalizeInputs(setup.inputs) },
              holeSpacing:
                setup.holeSpacing || DEFAULT_HOLE_SPACING,
            }
          : car
      )
    );

    setActiveCarId(carId);
    setModelTelemetry(null);
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

  function renameSetup(carId: string, setupId: string) {
    const setup = cars.find((car) => car.id === carId)?.savedSetups.find((item) => item.id === setupId);
    if (!setup) return;
    const name = window.prompt("Rename setup:", setup.name)?.trim();
    if (!name) return;
    setCars((current) => current.map((car) => car.id === carId ? { ...car, savedSetups: car.savedSetups.map((item) => item.id === setupId ? { ...item, name } : item) } : car));
  }

  function duplicateSetup(carId: string, setupId: string) {
    setCars((current) => current.map((car) => {
      if (car.id !== carId) return car;
      const source = car.savedSetups.find((item) => item.id === setupId);
      if (!source) return car;
      const copy: SavedSetup = { ...source, id: makeId(), name: `${source.name} Copy`, createdAt: new Date().toISOString(), inputs: { ...source.inputs }, runs: [] };
      return { ...car, savedSetups: [...car.savedSetups, copy] };
    }));
  }

  function addSurface(surface: Omit<SurfaceRecord, "id">) {
    if (!activeCarId) return;
    setCars((current) => current.map((car) => car.id === activeCarId ? { ...car, surfaces: [...(car.surfaces ?? []), { ...surface, id: makeId() }] } : car));
  }

  function deleteSurface(surfaceId: string) {
    if (!activeCarId) return;
    setCars((current) => current.map((car) => car.id === activeCarId ? { ...car, surfaces: (car.surfaces ?? []).filter((surface) => surface.id !== surfaceId) } : car));
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

  function modelRun(
    carId: string,
    setup: SavedSetup,
    run: RunLog
  ) {
    if (!run.telemetry) return;

    setCars((current) =>
      current.map((car) =>
        car.id === carId
          ? {
              ...car,
              calculatorInputs: { ...normalizeInputs(setup.inputs) },
              holeSpacing: setup.holeSpacing || DEFAULT_HOLE_SPACING,
            }
          : car
      )
    );

    setActiveCarId(carId);
    setModelTelemetry(run.telemetry);
    setActiveTab("modeling");
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
      setModelTelemetry(null);
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
            cloud={cloud}
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
          <BarChangeScreen
            car={activeCar}
            onHoleSpacingChange={updateActiveCarHoleSpacing}
            offsets={theoreticalOffsets}
            setOffsets={setTheoreticalOffsets}
          />
        )}

        {activeTab === "dynamic" && (
          <DynamicScreen car={activeCar} />
        )}

        {activeTab === "modeling" && (
          <ModelingScreen
            car={activeCar}
            cars={cars}
            theoreticalOffsets={theoreticalOffsets}
            initialTelemetry={modelTelemetry}
          />
        )}

        {activeTab === "surface" && (
          <SurfaceScreen car={activeCar} onAdd={addSurface} onDelete={deleteSurface} />
        )}

        {activeTab === "data-log" && (
          <DataLogScreen
            userId={cloud.userId}
            userEmail={cloud.userEmail}
          />
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
              setModelTelemetry(null);
              setActiveTab("calculator");
            }}
            onLoadSetup={loadSetup}
            onDeleteSetup={deleteSetup}
            onRenameSetup={renameSetup}
            onDuplicateSetup={duplicateSetup}
            onAddRun={addRun}
            onUpdateRun={updateRun}
            onDeleteRun={deleteRun}
            onModelRun={modelRun}
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
          cloud={cloud}
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
  cloud,
  onClose,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  cloud: ReturnType<typeof useCloudGarageSync>;
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
      onMouseDown={(e: MouseEvent<HTMLDivElement>) => {
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
              Local-first storage stays active. Sign in only if
              you want automatic browser / iPhone sync.
            </p>
          </div>

<CloudAccountPanel cloud={cloud} />
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
            onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
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
              <h2>Upper Link*</h2>

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

            <div className="optional-weight-section">
              <div className="optional-weight-heading">
                <div>
                  <p className="eyebrow">OPTIONAL</p>
                  <h3>Scale Weights</h3>
                </div>
                <span>Used for CG position, Dynamic and Modeling.</span>
              </div>

              <div className="two-column">
                <MeasurementField
                  label="Front weight"
                  value={inputs.frontWeight}
                  unit="lb"
                  onChange={(value) =>
                    updateInput("frontWeight", value)
                  }
                />

                <MeasurementField
                  label="Rear weight"
                  value={inputs.rearWeight}
                  unit="lb"
                  onChange={(value) =>
                    updateInput("rearWeight", value)
                  }
                />
              </div>

              <WeightSummary inputs={inputs} />
            </div>
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

            <div className="optional-weight-section">
              <div className="optional-weight-heading">
                <div>
                  <p className="eyebrow">MODEL GEOMETRY</p>
                  <h3>Rear Ladder-Bar Mounts</h3>
                </div>
                <span>Used for rear spread and rigid housing visualization; the front pivot still defines ladder-bar IC.</span>
              </div>

              <div className="two-column">
                <MeasurementField
                  label="Rear upper height"
                  value={inputs.ladderRearUpperHeight}
                  help="ground to mount center"
                  onChange={(value) =>
                    updateInput("ladderRearUpperHeight", value)
                  }
                />
                <MeasurementField
                  label="Rear lower height"
                  value={inputs.ladderRearLowerHeight}
                  help="ground to mount center"
                  onChange={(value) =>
                    updateInput("ladderRearLowerHeight", value)
                  }
                />
              </div>
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

            <div className="optional-weight-section">
              <div className="optional-weight-heading">
                <div>
                  <p className="eyebrow">OPTIONAL</p>
                  <h3>Scale Weights</h3>
                </div>
                <span>Used for CG position, Dynamic and Modeling.</span>
              </div>

              <div className="two-column">
                <MeasurementField
                  label="Front weight"
                  value={inputs.frontWeight}
                  unit="lb"
                  onChange={(value) =>
                    updateInput("frontWeight", value)
                  }
                />

                <MeasurementField
                  label="Rear weight"
                  value={inputs.rearWeight}
                  unit="lb"
                  onChange={(value) =>
                    updateInput("rearWeight", value)
                  }
                />
              </div>

              <WeightSummary inputs={inputs} />
            </div>
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
  onHoleSpacingChange,
  offsets,
  setOffsets,
}: {
  car: Car;
  onHoleSpacingChange: (value: string) => void;
  offsets: BracketOffsets;
  setOffsets: (value: BracketOffsets | ((current: BracketOffsets) => BracketOffsets)) => void;
}) {
  const spacing = car.holeSpacing || DEFAULT_HOLE_SPACING;

  if (car.suspensionType === "ladder-bar") {
    return (
      <LadderBarChangeScreen
        car={car}
        spacing={spacing}
        setSpacing={onHoleSpacingChange}
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
          description="Use your static setup as the baseline, then move any chassis-side or axle-side bar mounting point."
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
          description="Move any upper or lower bar through the bracket holes and see the resulting geometry instantly."
        />

        <label className="compact-setting">
          <span>Hole spacing</span>

          <div className="compact-input">
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={spacing}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onHoleSpacingChange(e.target.value)
              }
            />
            <span>in</span>
          </div>
          <small className="hole-spacing-note">
            Saved with the car and each saved setup.
          </small>
        </label>
      </div>

      <div className="bar-change-layout">
        <section className="bracket-panel">
          <div className="bracket-section-heading">
            <div>
              <p className="eyebrow">UPPER LINK</p>
              <h2>Bar Position</h2>
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
              <h2>Bar Position</h2>
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

  useEffect(() => {
    setOffset(0);
  }, [car.id]);

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
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setSpacing(e.target.value)
              }
            />
            <span>in</span>
          </div>
          <small className="hole-spacing-note">
            Saved with the car and each saved setup.
          </small>
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
  const [rearTravel, setRearTravel] = useState(0);
  const [frontTravel, setFrontTravel] = useState(0);

  useEffect(() => {
    setRearTravel(0);
    setFrontTravel(0);
  }, [car.id]);

  const dynamicCg = calculateDynamicCg(
    car.calculatorInputs,
    rearTravel,
    frontTravel
  );

  if (car.suspensionType === "ladder-bar") {
    const baseline = toLadderInputs(car.calculatorInputs);
    const baselineResult = calculateLadderBar(baseline);

    if (baselineResult === null || "error" in baselineResult) {
      return <DynamicInvalidState type="ladder-bar" />;
    }

    const liveState = dynamicCg
      ? getModelGeometryAtTravel(
          car,
          rearTravel,
          dynamicCg.dynamicCgHeight
        )
      : null;

    return (
      <>
        <ScreenHeading
          eyebrow="SUSPENSION TRAVEL"
          title="Dynamic Geometry"
          description="The ladder bar is swept as a rigid axle-to-front-pivot assembly. Front travel changes chassis pitch and the CG reference without changing the rear mechanism itself."
        />

        <div className="dynamic-layout">
          <DynamicControls
            rearTravel={rearTravel}
            frontTravel={frontTravel}
            onRearTravelChange={setRearTravel}
            onFrontTravelChange={setFrontTravel}
            dynamicCg={dynamicCg}
          />

          <section className="results-panel dynamic-results">
            <DynamicResultEyebrow rearTravel={rearTravel} />
            <h2>Results</h2>

            {!dynamicCg && (
              <div className="error-box">
                The entered front/rear movement does not create a valid rigid-body CG position.
              </div>
            )}

            {dynamicCg && !liveState && (
              <div className="error-box">
                This ladder-bar geometry cannot physically reach the selected rear travel position.
              </div>
            )}

            {liveState && liveState.ladderInputs && (
              <>
                <LadderBarPlot
                  inputs={liveState.ladderInputs}
                  result={liveState.result as LadderResult}
                />
                <LadderResultGrid result={liveState.result as LadderResult} />
                <LadderDifference
                  baseline={baselineResult}
                  changed={liveState.result as LadderResult}
                />
              </>
            )}
          </section>
        </div>
      </>
    );
  }

  const baseline = toNumericInputs(car.calculatorInputs);
  const baselineResult = calculateFourLink(baseline);

  if (baselineResult === null || "error" in baselineResult) {
    return <DynamicInvalidState type="4-link" />;
  }

  const liveState = dynamicCg
    ? getModelGeometryAtTravel(
        car,
        rearTravel,
        dynamicCg.dynamicCgHeight
      )
    : null;

  return (
    <>
      <ScreenHeading
        eyebrow="SUSPENSION TRAVEL"
        title="Dynamic Geometry"
        description="Both bars keep their physical lengths while the rigid chassis bracket and axle housing move through the selected rear travel. Front travel changes chassis pitch and CG height without inventing a different rear-link position."
      />

      <div className="dynamic-layout">
        <DynamicControls
          rearTravel={rearTravel}
          frontTravel={frontTravel}
          onRearTravelChange={setRearTravel}
          onFrontTravelChange={setFrontTravel}
          dynamicCg={dynamicCg}
        />

        <section className="results-panel dynamic-results">
          <DynamicResultEyebrow rearTravel={rearTravel} />
          <h2>Results</h2>

          {!dynamicCg && (
            <div className="error-box">
              The entered front/rear movement does not create a valid rigid-body CG position.
            </div>
          )}

          {dynamicCg && !liveState && (
            <div className="error-box">
              This four-link cannot physically close at the selected travel position. ChassisLab stops here instead of extrapolating an impossible linkage.
            </div>
          )}

          {liveState && liveState.fourLinkInputs && (
            <>
              <SuspensionPlot
                inputs={liveState.fourLinkInputs}
                result={liveState.result as SuccessfulResult}
              />
              <ResultGrid result={liveState.result as SuccessfulResult} />
              <GeometryDifference
                baseline={baselineResult}
                changed={liveState.result as SuccessfulResult}
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}

function DynamicInvalidState({
  type,
}: {
  type: SuspensionType;
}) {
  return (
    <section className="screen-card">
      <ScreenHeading
        eyebrow="SUSPENSION TRAVEL"
        title="Dynamic Geometry"
        description="Sweep the current suspension geometry through travel."
      />
      <div className="coming-soon-box">
        Finish a valid {type === "4-link" ? "4-link" : "ladder-bar"} setup on the IC & AS screen first.
      </div>
    </section>
  );
}

function DynamicControls({
  rearTravel,
  frontTravel,
  onRearTravelChange,
  onFrontTravelChange,
  dynamicCg,
}: {
  rearTravel: number;
  frontTravel: number;
  onRearTravelChange: (value: number) => void;
  onFrontTravelChange: (value: number) => void;
  dynamicCg: ReturnType<typeof calculateDynamicCg>;
}) {
  return (
    <section className="travel-control-panel">
      <TravelSlider
        label="Rear suspension movement"
        value={rearTravel}
        min={-5}
        max={5}
        step={0.5}
        leftLabel={'-5" squat'}
        rightLabel={'+5" separation'}
        onChange={onRearTravelChange}
      />

      <div className="dynamic-divider" />

      <TravelSlider
        label="Front suspension extension"
        value={frontTravel}
        min={0}
        max={9}
        step={0.5}
        leftLabel={'0" static'}
        rightLabel={'+9" extension'}
        onChange={onFrontTravelChange}
        showSteps={false}
      />

      {dynamicCg && (
        <div className="dynamic-cg-card">
          <div>
            <span>Dynamic CG height</span>
            <strong>{dynamicCg.dynamicCgHeight.toFixed(2)}"</strong>
          </div>
          <div>
            <span>Chassis pitch</span>
            <strong>{dynamicCg.pitchDegrees.toFixed(2)}°</strong>
          </div>
          <small>
            {dynamicCg.usedWeightBias
              ? "CG fore/aft position is calculated from the entered front and rear scale weights."
              : "No scale weights entered — CG fore/aft position is estimated at 50% of wheelbase."}
          </small>
        </div>
      )}

      <p className="dynamic-note">
        The chassis is modeled as a rigid body. Rear movement translates the chassis at the rear axle station; front-minus-rear movement sets pitch. The CG vector rotates with the chassis, so front extension changes the anti-squat reference without falsely moving the rear suspension instant center.
      </p>
    </section>
  );
}

function TravelSlider({
  label,
  value,
  min,
  max,
  step,
  leftLabel,
  rightLabel,
  onChange,
  showSteps = true,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  leftLabel: string;
  rightLabel: string;
  onChange: (value: number) => void;
  showSteps?: boolean;
}) {
  const steps: number[] = [];
  for (let current = min; current <= max + 0.0001; current += step) {
    steps.push(Number(current.toFixed(2)));
  }

  return (
    <div className="travel-block">
      <div className="travel-readout">
        <span>{label}</span>
        <strong>
          {value > 0 ? "+" : ""}
          {value.toFixed(1)}"
        </strong>
      </div>

      <input
        className="travel-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />

      <div className="travel-scale">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>

      {showSteps && (
        <div className="travel-step-grid">
          {steps.map((item) => (
            <button
              type="button"
              key={item}
              className={value === item ? "selected" : ""}
              onClick={() => onChange(item)}
            >
              {item > 0 ? "+" : ""}
              {item.toFixed(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DynamicResultEyebrow({
  rearTravel,
}: {
  rearTravel: number;
}) {
  return (
    <p className="eyebrow">
      {rearTravel > 0
        ? "SEPARATED GEOMETRY"
        : rearTravel < 0
          ? "SQUATTED GEOMETRY"
          : "STATIC REAR GEOMETRY"}
    </p>
  );
}

/* =========================================================
   MODELING BETA
========================================================= */

function formatLinkLoad(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(Math.abs(value))} lb ${
    value >= 0 ? "compression" : "tension"
  }`;
}

function getModelCharacter(snapshot: ModelSnapshot) {
  const speed = snapshot.velocity;
  const verticalAccel = snapshot.acceleration;

  const tendency =
    Math.abs(speed) < 0.12 && Math.abs(verticalAccel) < 2
      ? "Near equilibrium"
      : speed > 0.12
        ? "Separating"
        : speed < -0.12
          ? "Returning / squatting"
          : verticalAccel > 0
            ? "Building separation"
            : "Settling";

  const direction = snapshot.travel >= 0 ? 1 : -1;
  const asChangeInTravelDirection = snapshot.asSensitivity * direction;

  const migration =
    Math.abs(snapshot.asSensitivity) < 3
      ? "AS stays relatively stable with travel"
      : asChangeInTravelDirection < -3
        ? "AS falls with movement — the geometric hit decays"
        : "AS builds with movement — the geometry reinforces separation";

  return { tendency, migration };
}

function carWithTheoreticalOffsets(car: Car, offsets: BracketOffsets): Car {
  if (car.suspensionType !== "4-link") return car;
  const spacing = parseNumber(car.holeSpacing || DEFAULT_HOLE_SPACING);
  if (!Number.isFinite(spacing) || spacing <= 0) return car;
  const base = car.calculatorInputs;
  const move = (value: string, holes: number) => {
    const n = parseNumber(value);
    return Number.isFinite(n) ? String(n + holes * spacing) : value;
  };
  return {
    ...car,
    calculatorInputs: {
      ...base,
      upperFrontHeight: move(base.upperFrontHeight, offsets.upperFront),
      upperRearHeight: move(base.upperRearHeight, offsets.upperRear),
      lowerFrontHeight: move(base.lowerFrontHeight, offsets.lowerFront),
      lowerRearHeight: move(base.lowerRearHeight, offsets.lowerRear),
    },
  };
}

function hasTheoreticalOffset(offsets: BracketOffsets) {
  return Object.values(offsets).some((value) => value !== 0);
}

function ModelingScreen({
  car,
  cars,
  theoreticalOffsets,
  initialTelemetry,
}: {
  car: Car;
  cars: Car[];
  theoreticalOffsets: BracketOffsets;
  initialTelemetry?: RunTelemetry | null;
}) {
  const [time, setTime] = useState(0);
  const [peakG, setPeakG] = useState(1.6);
  const savedFrontTravel = parseNumber(car.calculatorInputs.frontTravelAvailable);
  const [frontTravelLimit, setFrontTravelLimit] = useState(
    Number.isFinite(savedFrontTravel) && savedFrontTravel > 0
      ? Math.max(0.5, Math.min(12, savedFrontTravel))
      : 5
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [useTheoretical, setUseTheoretical] = useState(hasTheoreticalOffset(theoreticalOffsets));
  const [ghostMode, setGhostMode] = useState<string>("off");
  const [dragyPoints, setDragyPoints] = useState<DragyPoint[]>([]);
  const [importName, setImportName] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [needsDragyConversion, setNeedsDragyConversion] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<
    "contact" | "ic" | "cg" | "upper" | "lower" | null
  >(null);

  const animationRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setTime(0);
    setIsPlaying(false);
    setSelectedPoint(null);
    setUseTheoretical(hasTheoreticalOffset(theoreticalOffsets));
    setGhostMode("off");
    const enteredFrontTravel = parseNumber(car.calculatorInputs.frontTravelAvailable);
    setFrontTravelLimit(
      Number.isFinite(enteredFrontTravel) && enteredFrontTravel > 0
        ? Math.max(0.5, Math.min(12, enteredFrontTravel))
        : 5
    );

    if (initialTelemetry?.points?.length) {
      setDragyPoints(initialTelemetry.points);
      setImportName(initialTelemetry.fileName);
      setImportMessage(
        `Garage run: loaded ${initialTelemetry.points.length} saved telemetry samples.`
      );
      setNeedsDragyConversion(false);
    } else {
      setDragyPoints([]);
      setImportName("");
      setImportMessage("");
      setNeedsDragyConversion(false);
    }
  }, [car.id, car.calculatorInputs.frontTravelAvailable, initialTelemetry]);

  const theoreticalCar = carWithTheoreticalOffsets(car, theoreticalOffsets);
  const theoreticalAvailable = hasTheoreticalOffset(theoreticalOffsets);
  const modelCar = useTheoretical && theoreticalAvailable ? theoreticalCar : car;
  const weights = getWeightData(modelCar.calculatorInputs);
  const baseCgHeight = parseNumber(modelCar.calculatorInputs.cgHeight);
  const baseGeometry = getModelGeometryAtTravel(
    modelCar,
    0,
    Number.isFinite(baseCgHeight) && baseCgHeight > 0 ? baseCgHeight : 1
  );
  const validGeometry = baseGeometry !== null;

  const maxTime =
    dragyPoints.length > 0
      ? Math.max(
          0.1,
          Math.min(1.5, dragyPoints[dragyPoints.length - 1].time)
        )
      : 1.5;

  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      animationRef.current = null;
      lastFrameRef.current = null;
      return;
    }

    function frame(timestamp: number) {
      if (lastFrameRef.current === null) {
        lastFrameRef.current = timestamp;
      }

      const elapsed = (timestamp - lastFrameRef.current) / 1000;
      lastFrameRef.current = timestamp;

      setTime((current) => {
        const next = current + elapsed;
        if (next >= maxTime) {
          setIsPlaying(false);
          return maxTime;
        }
        return next;
      });

      animationRef.current = requestAnimationFrame(frame);
    }

    animationRef.current = requestAnimationFrame(frame);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, maxTime]);

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const parsed = await parseTelemetryFile(file);
    const points = parsed.telemetry?.points ?? parsed.points;

    setImportName(file.name);
    setNeedsDragyConversion(Boolean(parsed.needsConversion));

    if (points.length < 2) {
      setDragyPoints([]);
      setImportMessage(parsed.message);
      e.target.value = "";
      return;
    }

    setNeedsDragyConversion(false);
    setDragyPoints(points);
    setImportMessage(
      `${parsed.message}: loaded ${points.length} samples${
        points.some((point) => point.g !== null) ? " with longitudinal G." : ". G is being derived from speed."
      }`
    );
    setTime(0);
    setIsPlaying(false);
    e.target.value = "";
  }

  if (!validGeometry) {
    return (
      <section className="screen-card">
        <ScreenHeading
          eyebrow="MODELING BETA"
          title="Chassis Response Model"
          description="Animate how the current suspension geometry tends to move the chassis during the hit."
        />
        <div className="coming-soon-box">
          Finish a valid static setup first.
        </div>
      </section>
    );
  }

  if (!weights) {
    return (
      <section className="screen-card">
        <ScreenHeading
          eyebrow="MODELING BETA"
          title="Chassis Response Model"
          description="Animate how the current suspension geometry tends to move the chassis during the hit."
        />
        <div className="coming-soon-box">
          Enter optional front and rear scale weights on the IC & AS page to enable the model.
        </div>
      </section>
    );
  }

  const snapshot = simulateModelState(
    modelCar,
    weights,
    dragyPoints,
    peakG,
    time,
    { frontTravelLimit }
  );

  const ghostCar = ghostMode === "current"
    ? car
    : ghostMode === "theoretical" && theoreticalAvailable
      ? theoreticalCar
      : cars.find((candidate) => candidate.id === ghostMode) ?? null;
  const ghostWeights = ghostCar ? getWeightData(ghostCar.calculatorInputs) : null;
  const ghostSnapshot = ghostCar && ghostWeights
    ? simulateModelState(ghostCar, ghostWeights, dragyPoints, peakG, time, { frontTravelLimit })
    : null;

  if (!snapshot) {
    return (
      <section className="screen-card">
        <div className="error-box">
          The current geometry could not be swept through this modeled travel position.
        </div>
      </section>
    );
  }

  const character = getModelCharacter(snapshot);

  return (
    <>
      <div className="screen-heading-row">
        <ScreenHeading
          eyebrow="MODELING BETA V3.0"
          title="Chassis Response Model"
          description="Watch the chassis squat or separate while ChassisLab recalculates the actual bars, IC and anti-squat throughout the hit."
        />

        <label className="import-log-button">
          <span>Import Dragy / CSV</span>
          <input
            type="file"
            accept=".csv,.txt,.json,.vbo,.dragy,.zip,text/csv,text/plain,application/json,application/zip"
            onChange={handleImport}
          />
        </label>
      </div>

      <div className="model-state-card" style={{ marginBottom: 14 }}>
        <div>
          <span>Geometry being modeled</span>
          <strong>{useTheoretical && theoreticalAvailable ? "Theoretical Bar Change" : "Current Bar Positions"}</strong>
          <small>{theoreticalAvailable ? "Bar Change positions transfer here automatically." : "Move a bar in Theoretical Bar Change to compare it here."}</small>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {theoreticalAvailable && (
            <button type="button" className="secondary-button" onClick={() => setUseTheoretical(true)}>Use Theoretical</button>
          )}
          <button type="button" className="secondary-button" onClick={() => setUseTheoretical(false)}>Reset to Current Bar Positions</button>
          <label className="compact-setting">
            <span>Ghost overlay</span>
            <select value={ghostMode} onChange={(e) => setGhostMode(e.target.value)}>
              <option value="off">Off</option>
              <option value="current">Current bar positions</option>
              {theoreticalAvailable && <option value="theoretical">Theoretical bar change</option>}
              {cars.filter((candidate) => candidate.id !== car.id && candidate.suspensionType === "4-link").map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="model-layout">
        <section className="model-main-panel">
          <ForceModelDiagram
            car={modelCar}
            snapshot={snapshot}
            ghostSnapshot={ghostSnapshot}
            weights={weights}
            selectedPoint={selectedPoint}
            onSelectPoint={setSelectedPoint}
          />

          <div className="model-timeline-panel">
            <div className="model-timeline-top">
              <button
                type="button"
                className="primary-button model-play-button"
                onClick={() => {
                  if (time >= maxTime) setTime(0);
                  setIsPlaying((current) => !current);
                }}
              >
                {isPlaying ? "Pause" : "Play"}
              </button>

              <div>
                <span>Hit timeline</span>
                <strong>{time.toFixed(2)} s</strong>
              </div>
            </div>

            <input
              className="model-timeline-slider"
              type="range"
              min="0"
              max={maxTime}
              step="0.01"
              value={time}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setIsPlaying(false);
                setTime(Number(e.target.value));
              }}
            />

            <div className="travel-scale">
              <span>0.00 s</span>
              <span>{maxTime.toFixed(2)} s</span>
            </div>
          </div>
        </section>

        <aside className="model-side-panel">
          <div className="model-state-card">
            <div>
              <span>Estimated rear motion</span>
              <strong className={snapshot.travel >= 0 ? "separation-value" : "squat-value"}>
                {snapshot.travel > 0 ? "+" : ""}
                {snapshot.travel.toFixed(2)}"
              </strong>
              <small>{snapshot.wheelie ? "Front axle unloaded / wheelie threshold" : character.tendency}</small>
            </div>
            <div>
              <span>Current anti-squat</span>
              <strong>{snapshot.geometry.result.antiSquat.toFixed(1)}%</strong>
              <small>
                IC {snapshot.geometry.result.icLength.toFixed(1)}" × {snapshot.geometry.result.icHeight.toFixed(1)}"
              </small>
            </div>
          </div>

          {snapshot.travelLimited && (
            <div className="model-limit-warning">
              Model travel envelope reached. ChassisLab freezes the transient jacking load here instead of inventing additional tire force outside the ±5" model envelope.
            </div>
          )}

          {snapshot.kinematicLimited && (
            <div className="model-limit-warning">
              Physical linkage limit reached. The rigid bars could not close beyond this position, so the model stopped at the last valid geometry instead of jumping to a mirrored or impossible solution.
            </div>
          )}

          <div className="model-character-card">
            <p className="eyebrow">GEOMETRY CHARACTER</p>
            <strong>{character.migration}</strong>
            <div className="model-character-row">
              <span>AS change / 1" travel</span>
              <b>
                {snapshot.asSensitivity > 0 ? "+" : ""}
                {snapshot.asSensitivity.toFixed(1)}%
              </b>
            </div>
            <div className="model-character-row">
              <span>IC length change / 1"</span>
              <b>
                {snapshot.icSensitivity > 0 ? "+" : ""}
                {snapshot.icSensitivity.toFixed(1)}"
              </b>
            </div>
            {snapshot.rearSpread !== null && (
              <div className="model-character-row">
                <span>Rear bar spread</span>
                <b>{snapshot.rearSpread.toFixed(2)}"</b>
              </div>
            )}
            {"upperAngle" in snapshot.geometry.result && (
              <>
                <div className="model-character-row">
                  <span>Upper bar angle</span>
                  <b>{snapshot.geometry.result.upperAngle.toFixed(2)}°</b>
                </div>
                <div className="model-character-row">
                  <span>Lower bar angle</span>
                  <b>{snapshot.geometry.result.lowerAngle.toFixed(2)}°</b>
                </div>
              </>
            )}
          </div>

          <div className="model-source-card">
            <p className="eyebrow">DATA SOURCE</p>
            <strong>
              {dragyPoints.length > 0
                ? importName || "Imported CSV"
                : "Manual beta curve"}
            </strong>
            <span>
              {dragyPoints.length > 0
                ? importMessage
                : "Use peak G for testing, or import CSV, JSON, VBO, or a readable Dragy trace for measured speed/G."}
            </span>
            {dragyPoints.length === 0 && importMessage && (
              <div className={needsDragyConversion ? "model-import-error" : "model-import-warning"}>
                <strong>{needsDragyConversion ? "Telemetry not loaded" : "Import note"}</strong>
                <span>{importMessage}</span>
                {needsDragyConversion && (
                  <a
                    href="https://dragy-decryptor.d3vl.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Convert Dragy file to CSV / JSON
                  </a>
                )}
              </div>
            )}
          </div>

          {dragyPoints.length === 0 && (
            <label className="model-g-control">
              <span>Peak longitudinal G</span>
              <strong>{peakG.toFixed(2)} g</strong>
              <input
                type="range"
                min="0.2"
                max="2.5"
                step="0.05"
                value={peakG}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setPeakG(Number(e.target.value))
                }
              />
            </label>
          )}

          <label className="model-g-control">
            <span>Maximum front suspension extension</span>
            <strong>{frontTravelLimit.toFixed(2)} in</strong>
            <input
              type="range"
              min="0.5"
              max="9"
              step="0.25"
              value={frontTravelLimit}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setFrontTravelLimit(Number(e.target.value))
              }
            />
            <small>
              Simulation override only. The saved vehicle value remains {
                Number.isFinite(savedFrontTravel) && savedFrontTravel > 0
                  ? `${savedFrontTravel.toFixed(2)} in`
                  : "5.00 in"
              }. The model only uses the available travel when the load-transfer solution calls for it.
            </small>
          </label>

          <div className="model-metric-grid">
            <ModelMetric label="Longitudinal G" value={`${snapshot.currentG.toFixed(2)} g`} />
            <ModelMetric label="Dynamic CG height" value={`${snapshot.dynamicCgHeight.toFixed(2)}"`} />
            <ModelMetric
              label="Front travel est."
              value={`${snapshot.frontVisualLift.toFixed(2)} / ${snapshot.frontTravelLimit.toFixed(2)}"${snapshot.frontTravelLimited ? " — full extension" : ""}`}
            />
            {snapshot.speed !== null && (
              <ModelMetric label="Speed" value={`${snapshot.speed.toFixed(1)} mph`} />
            )}
            <ModelMetric label="Drive force" value={`${Math.round(snapshot.driveForce)} lb`} />
            <ModelMetric
              label="Rear tire normal load"
              value={`${Math.round(snapshot.rearTireLoadEstimate)} lb`}
              emphasis
            />
            <ModelMetric
              label="Base rear load"
              value={`${Math.round(snapshot.baseRearTireLoad)} lb`}
            />
            <ModelMetric
              label="Jacking transient"
              value={`${snapshot.jackingTireLoad >= 0 ? "+" : ""}${Math.round(
                snapshot.jackingTireLoad
              )} lb`}
            />
            <ModelMetric
              label="AS excess / deficit"
              value={`${snapshot.excessAntiSquatReaction >= 0 ? "+" : ""}${Math.round(
                snapshot.excessAntiSquatReaction
              )} lb`}
            />
          </div>

          {car.suspensionType === "4-link" && (
            <div className="model-link-loads">
              <p className="eyebrow">LINK FORCE ESTIMATE</p>
              <div>
                <span>Upper bar</span>
                <strong>{formatLinkLoad(snapshot.upperLinkForce)}</strong>
              </div>
              <div>
                <span>Lower bar</span>
                <strong>{formatLinkLoad(snapshot.lowerLinkForce)}</strong>
              </div>
              <div>
                <span>Axle torque couple</span>
                <strong>
                  {snapshot.axleTorqueCouple === null
                    ? "—"
                    : `${Math.round(snapshot.axleTorqueCouple / 12)} lb-ft`}
                </strong>
              </div>
            </div>
          )}

          <div className="model-beta-note">
            <strong>Beta model</strong>
            <p>
              The four-link is solved as a rigid mechanism with both physical bar lengths fixed, optional axle-centerline offsets, rigid chassis bracket spacing, axle-housing rotation, chassis pitch and fore/aft migration. Short/long bars and spread affect the result through actual geometry migration rather than tuning multipliers. Ladder bars use the front pivot as the live IC and rotate the axle/ladder assembly as one rigid mechanism. Rear motion follows the sign and magnitude of the live anti-squat force balance without an invented spring-rate oscillator, so it does not reverse direction merely because an assumed spring model overshot. Front extension is driven by sustained front-axle unloading and is capped by the travel slider. Exact shock-travel inches still require shock, spring, tire and mass data, so absolute displacement remains a comparative engineering estimate rather than a guarantee.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function ModelMetric({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`model-metric ${emphasis ? "emphasis" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ForceModelDiagram({
  car,
  snapshot,
  ghostSnapshot,
  weights,
  selectedPoint,
  onSelectPoint,
}: {
  car: Car;
  snapshot: ModelSnapshot;
  ghostSnapshot?: ModelSnapshot | null;
  weights: WeightData;
  selectedPoint: "contact" | "ic" | "cg" | "upper" | "lower" | null;
  onSelectPoint: (
    point: "contact" | "ic" | "cg" | "upper" | "lower" | null
  ) => void;
}) {
  const inputs = car.calculatorInputs;
  const wheelbase = parseNumber(inputs.wheelbase);
  const cgHeight = parseNumber(inputs.cgHeight);

  // The model drawing uses slightly undersized visual tires so they sit cleanly inside the supplied silhouette wheel openings. Tire
  // diameter here is visual only; the suspension calculations still use the
  // vehicle measurements entered elsewhere in ChassisLab.
  const modelTireRadius = 13;

  const width = 820;
  const height = 390;
  const groundY = 315;
  const rearX = 175;
  const chassisScale = 650 / Math.max(wheelbase + 70, 1);
  const frontX = rearX + wheelbase * chassisScale;
  const wheelRadiusPx = Math.min(
    54,
    Math.max(30, modelTireRadius * chassisScale)
  );
  const rearWheelRadiusPx = wheelRadiusPx;
  const frontWheelRadiusPx = wheelRadiusPx;
  const rearAxleY = groundY - rearWheelRadiusPx;
  const frontAxleY = groundY - frontWheelRadiusPx;

  const result = snapshot.geometry.result;
  const rearTravel = snapshot.travel;
  const bodyRearRise = rearTravel;
  const bodyFrontRise = snapshot.frontVisualLift;
  const bodyPitchRadians = Math.asin(
    Math.max(
      -1,
      Math.min(
        1,
        (bodyFrontRise - bodyRearRise) /
          Math.max(wheelbase, 1)
      )
    )
  );
  const bodyPitchDegrees = bodyPitchRadians * (180 / Math.PI);

  // Ghost comparison uses the same Foxbody silhouette and the same timeline.
  // Only the compared suspension geometry changes its modeled chassis motion.
  const ghostBodyRearRise = ghostSnapshot?.travel ?? 0;
  const ghostBodyFrontRise = ghostSnapshot?.frontVisualLift ?? 0;
  const ghostBodyPitchRadians = Math.asin(
    Math.max(
      -1,
      Math.min(
        1,
        (ghostBodyFrontRise - ghostBodyRearRise) / Math.max(wheelbase, 1)
      )
    )
  );
  const ghostBodyPitchDegrees = ghostBodyPitchRadians * (180 / Math.PI);

  // The supplied notchback trace has wheel-center references at roughly
  // (165,160) and (625,160), a 460 px wheelbase. Scale it from the vehicle's
  // entered wheelbase, then move/rotate the body while both 28-inch tires stay
  // planted on the road.
  const silhouetteRearAxleX = 165;
  const silhouetteRearAxleY = 160;
  const silhouetteWheelbase = 460;
  const silhouetteScale =
    (frontX - rearX) / silhouetteWheelbase;

  function bodyPoint(
    xFromRear: number,
    heightFromGround: number
  ) {
    const x = xFromRear * chassisScale;
    const y =
      (heightFromGround - modelTireRadius) *
      chassisScale;
    const cosine = Math.cos(bodyPitchRadians);
    const sine = Math.sin(bodyPitchRadians);

    return {
      x:
        rearX +
        x * cosine -
        y * sine,
      y:
        rearAxleY -
        bodyRearRise * chassisScale -
        (x * sine + y * cosine),
    };
  }

  const cgBody = bodyPoint(
    weights.cgXFromRear,
    cgHeight
  );
  const rawIcX = rearX + result.icLength * chassisScale;
  const rawIcY = groundY - result.icHeight * chassisScale;
  const icX = Math.max(45, Math.min(width - 45, rawIcX));
  const icY = Math.max(35, Math.min(groundY - 18, rawIcY));

  let upperRear: { x: number; y: number } | null = null;
  let upperFront: { x: number; y: number } | null = null;
  let lowerRear: { x: number; y: number } | null = null;
  let lowerFront: { x: number; y: number } | null = null;
  let ladderFront: { x: number; y: number } | null = null;
  let ladderRearUpper: { x: number; y: number } | null = null;
  let ladderRearLower: { x: number; y: number } | null = null;

  if (snapshot.geometry.kinematics) {
    const k = snapshot.geometry.kinematics;
    upperRear = {
      x: rearX + k.rearUpper.x * chassisScale,
      y: groundY - k.rearUpper.y * chassisScale,
    };
    upperFront = {
      x: rearX + k.frontUpper.x * chassisScale,
      y: groundY - k.frontUpper.y * chassisScale,
    };
    lowerRear = {
      x: rearX + k.rearLower.x * chassisScale,
      y: groundY - k.rearLower.y * chassisScale,
    };
    lowerFront = {
      x: rearX + k.frontLower.x * chassisScale,
      y: groundY - k.frontLower.y * chassisScale,
    };
  } else if (snapshot.geometry.ladderInputs) {
    const n = snapshot.geometry.ladderInputs;
    const lk = snapshot.geometry.ladderKinematics;
    const liveFront = lk?.frontPivot ?? {
      x: result.icLength,
      y: n.ladderFrontHeight,
    };

    ladderFront = {
      x: rearX + liveFront.x * chassisScale,
      y: groundY - liveFront.y * chassisScale,
    };

    if (lk?.rearUpper) {
      ladderRearUpper = {
        x: rearX + lk.rearUpper.x * chassisScale,
        y: groundY - lk.rearUpper.y * chassisScale,
      };
    }

    if (lk?.rearLower) {
      ladderRearLower = {
        x: rearX + lk.rearLower.x * chassisScale,
        y: groundY - lk.rearLower.y * chassisScale,
      };
    }
  }

  const driveArrow = Math.min(
    72,
    Math.max(18, Math.abs(snapshot.driveForce) / 45)
  );
  const verticalArrow = Math.min(
    58,
    Math.max(15, Math.abs(snapshot.excessAntiSquatReaction) / 18)
  );
  const verticalDirection = snapshot.excessAntiSquatReaction >= 0 ? -1 : 1;

  const details =
    selectedPoint === "contact"
      ? {
          title: "Rear tire / contact patch",
          values: [
            `Drive force ${Math.round(snapshot.driveForce)} lb`,
            `Rear normal load ${Math.round(snapshot.rearTireLoadEstimate)} lb`,
            `Base rear load ${Math.round(snapshot.baseRearTireLoad)} lb`,
            `Jacking transient ${snapshot.jackingTireLoad >= 0 ? "+" : ""}${Math.round(snapshot.jackingTireLoad)} lb`,
          ],
        }
      : selectedPoint === "ic"
        ? {
            title: "Instant center",
            values: [
              `IC ${result.icLength.toFixed(1)}\" × ${result.icHeight.toFixed(1)}\"`,
              `Anti-squat ${result.antiSquat.toFixed(1)}%`,
              `AS change ${snapshot.asSensitivity > 0 ? "+" : ""}${snapshot.asSensitivity.toFixed(1)}% / in`,
            ],
          }
        : selectedPoint === "cg"
          ? {
              title: "Vehicle CG",
              values: [
                `CG ${weights.cgXFromRear.toFixed(1)}\" forward of rear axle`,
                `CG height ${cgHeight.toFixed(1)}\"`,
                `Front visual lift ${snapshot.frontVisualLift.toFixed(1)}\"`,
              ],
            }
          : selectedPoint === "upper"
            ? {
                title: "Upper link",
                values: [
                  `Load ${formatLinkLoad(snapshot.upperLinkForce)}`,
                  snapshot.rearSpread !== null
                    ? `Rear spread ${snapshot.rearSpread.toFixed(2)}\"`
                    : "Rear spread —",
                ],
              }
            : selectedPoint === "lower"
              ? {
                  title: "Lower link",
                  values: [
                    `Load ${formatLinkLoad(snapshot.lowerLinkForce)}`,
                    `Rear travel ${snapshot.travel > 0 ? "+" : ""}${snapshot.travel.toFixed(2)}\"`,
                  ],
                }
              : null;

  return (
    <div className="model-diagram-card model-car-diagram-card">
      <div className="geometry-title-row">
        <div>
          <p className="eyebrow">LIVE CHASSIS VIEW</p>
          <h3>
            {snapshot.currentG.toFixed(2)} g · {snapshot.travel >= 0 ? "separating" : "squatting"} {Math.abs(snapshot.travel).toFixed(2)}"
          </h3>
        </div>
        <span className="model-tap-note">Tap IC, CG, tire or a bar</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="model-force-svg model-car-svg"
        role="img"
        aria-label="Animated side-view chassis and suspension response model"
      >
        <defs>
          <marker
            id="model-drive-arrow"
            markerWidth="5"
            markerHeight="5"
            refX="4.4"
            refY="2.5"
            orient="auto"
          >
            <path d="M0,0 L5,2.5 L0,5 z" className="model-drive-arrow-head" />
          </marker>
          <marker
            id="model-vertical-arrow"
            markerWidth="5"
            markerHeight="5"
            refX="4.4"
            refY="2.5"
            orient="auto"
          >
            <path d="M0,0 L5,2.5 L0,5 z" className="model-vertical-arrow-head" />
          </marker>
        </defs>

        <line x1="35" y1={groundY} x2={width - 35} y2={groundY} className="geometry-ground" />

        <circle cx={rearX} cy={rearAxleY} r={rearWheelRadiusPx} className="geometry-tire model-rear-tire" />
        <circle cx={frontX} cy={frontAxleY} r={frontWheelRadiusPx} className="geometry-tire front-tire" />
        <circle cx={rearX} cy={rearAxleY} r="5" className="geometry-axle" />
        <circle cx={frontX} cy={frontAxleY} r="4" className="geometry-axle front-axle" />

        {ghostSnapshot && (
          <g
            transform={`translate(${rearX} ${(
              rearAxleY - ghostBodyRearRise * chassisScale
            ).toFixed(2)}) rotate(${-ghostBodyPitchDegrees})`}
            className="model-car-image-group"
            opacity="0.24"
            pointerEvents="none"
          >
            <g transform={`scale(${silhouetteScale})`}>
              <image
                href="/model-car-outline.png"
                x={-silhouetteRearAxleX}
                y={-silhouetteRearAxleY}
                width="796"
                height="223"
                preserveAspectRatio="xMidYMid meet"
                className="model-car-image"
              />
            </g>
          </g>
        )}

        <g
          transform={`translate(${rearX} ${(
            rearAxleY - bodyRearRise * chassisScale
          ).toFixed(2)}) rotate(${-bodyPitchDegrees})`}
          className="model-car-image-group"
        >
          <g transform={`scale(${silhouetteScale})`}>
            <image
              href="/model-car-outline.png"
              x={-silhouetteRearAxleX}
              y={-silhouetteRearAxleY}
              width="796"
              height="223"
              preserveAspectRatio="xMidYMid meet"
              className="model-car-image"
            />
          </g>
        </g>

        <line x1={rearX} y1={groundY} x2={icX} y2={icY} className="model-ic-force-line" />

        {ghostSnapshot?.geometry.kinematics && (() => {
          const gk = ghostSnapshot.geometry.kinematics;
          const gp = (point: { x: number; y: number }) => ({ x: rearX + point.x * chassisScale, y: groundY - point.y * chassisScale });
          const gur = gp(gk.rearUpper); const guf = gp(gk.frontUpper);
          const glr = gp(gk.rearLower); const glf = gp(gk.frontLower);
          const gr = ghostSnapshot.geometry.result;
          const gicX = Math.max(45, Math.min(width - 45, rearX + gr.icLength * chassisScale));
          const gicY = Math.max(35, Math.min(groundY - 18, groundY - gr.icHeight * chassisScale));
          return (
            <g opacity="0.38" pointerEvents="none">
              <line x1={gur.x} y1={gur.y} x2={guf.x} y2={guf.y} className="model-live-link" strokeDasharray="8 7" />
              <line x1={glr.x} y1={glr.y} x2={glf.x} y2={glf.y} className="model-live-link" strokeDasharray="8 7" />
              <line x1={rearX} y1={groundY} x2={gicX} y2={gicY} className="model-ic-force-line" strokeDasharray="6 7" />
              <circle cx={gicX} cy={gicY} r="6" fill="none" stroke="currentColor" strokeWidth="2" />
              <text x={gicX + 9} y={gicY + 14} className="model-svg-label">GHOST IC</text>
            </g>
          );
        })()}

        {upperRear && upperFront && lowerRear && lowerFront && (
          <>
            <line
              x1={upperRear.x}
              y1={upperRear.y}
              x2={upperFront.x}
              y2={upperFront.y}
              className={`model-live-link model-live-upper ${selectedPoint === "upper" ? "selected" : ""}`}
              onClick={() => onSelectPoint(selectedPoint === "upper" ? null : "upper")}
            />
            <line
              x1={lowerRear.x}
              y1={lowerRear.y}
              x2={lowerFront.x}
              y2={lowerFront.y}
              className={`model-live-link model-live-lower ${selectedPoint === "lower" ? "selected" : ""}`}
              onClick={() => onSelectPoint(selectedPoint === "lower" ? null : "lower")}
            />
            {[upperRear, upperFront, lowerRear, lowerFront].map((point, index) => (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r="4"
                className="geometry-pivot model-live-pivot"
              />
            ))}
          </>
        )}

        {ladderFront && ladderRearUpper && ladderRearLower ? (
          <>
            <line
              x1={ladderRearUpper.x}
              y1={ladderRearUpper.y}
              x2={ladderFront.x}
              y2={ladderFront.y}
              className="model-live-link model-live-upper"
            />
            <line
              x1={ladderRearLower.x}
              y1={ladderRearLower.y}
              x2={ladderFront.x}
              y2={ladderFront.y}
              className="model-live-link model-live-lower"
            />
            {[ladderRearUpper, ladderRearLower, ladderFront].map((point, index) => (
              <circle
                key={`ladder-${index}`}
                cx={point.x}
                cy={point.y}
                r="4"
                className="geometry-pivot model-live-pivot"
              />
            ))}
          </>
        ) : ladderFront ? (
          <line
            x1={rearX}
            y1={rearAxleY}
            x2={ladderFront.x}
            y2={ladderFront.y}
            className="model-live-link model-live-lower"
          />
        ) : null}

        <line
          x1={rearX + 8}
          y1={groundY - 8}
          x2={rearX + 8 + driveArrow}
          y2={groundY - 8}
          className="model-drive-force"
          markerEnd="url(#model-drive-arrow)"
        />

        <line
          x1={rearX + 18}
          y1={rearAxleY}
          x2={rearX + 18}
          y2={rearAxleY + verticalDirection * verticalArrow}
          className="model-vertical-force"
          markerEnd="url(#model-vertical-arrow)"
        />

        <circle
          cx={rearX}
          cy={groundY}
          r="7"
          className={`model-node ${selectedPoint === "contact" ? "selected" : ""}`}
          onClick={() => onSelectPoint(selectedPoint === "contact" ? null : "contact")}
        />
        <circle
          cx={icX}
          cy={icY}
          r="7"
          className={`model-node model-ic-node ${selectedPoint === "ic" ? "selected" : ""}`}
          onClick={() => onSelectPoint(selectedPoint === "ic" ? null : "ic")}
        />
        <circle
          cx={cgBody.x}
          cy={cgBody.y}
          r="7"
          className={`model-node model-cg-node ${selectedPoint === "cg" ? "selected" : ""}`}
          onClick={() => onSelectPoint(selectedPoint === "cg" ? null : "cg")}
        />

        <text x={icX + 10} y={icY - 9} className="model-svg-label">IC</text>
        <text x={cgBody.x + 10} y={cgBody.y - 9} className="model-svg-label">CG</text>
        <text x={rearX + 28} y={rearAxleY - 12} className="model-motion-label">
          {snapshot.excessAntiSquatReaction >= 0 ? "separation force" : "squat force"}
        </text>
      </svg>

      {ghostSnapshot && (
        <div className="model-live-readout" style={{ opacity: 0.72 }}>
          <span>Ghost rear <strong>{ghostSnapshot.travel > 0 ? "+" : ""}{ghostSnapshot.travel.toFixed(2)}"</strong></span>
          <span>Ghost AS <strong>{ghostSnapshot.geometry.result.antiSquat.toFixed(1)}%</strong></span>
          <span>Ghost IC <strong>{ghostSnapshot.geometry.result.icLength.toFixed(1)} × {ghostSnapshot.geometry.result.icHeight.toFixed(1)}"</strong></span>
        </div>
      )}

      <div className="model-live-readout">
        <span>
          Rear chassis <strong>{snapshot.travel > 0 ? "+" : ""}{snapshot.travel.toFixed(2)}"</strong>
        </span>
        <span>
          AS <strong>{result.antiSquat.toFixed(1)}%</strong>
        </span>
        <span>
          Rear normal load <strong>{Math.round(snapshot.rearTireLoadEstimate)} lb</strong>
        </span>
      </div>

      {details && (
        <div className="model-point-detail">
          <strong>{details.title}</strong>
          <div>
            {details.values.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}



/* =========================================================
   SURFACE RECORDS
========================================================= */

function SurfaceScreen({ car, onAdd, onDelete }: { car: Car; onAdd: (surface: Omit<SurfaceRecord, "id">) => void; onDelete: (id: string) => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rating, setRating] = useState(5);
  const [lane, setLane] = useState("");
  const [notes, setNotes] = useState("");
  const surfaces = car.surfaces ?? [];
  return (
    <>
      <ScreenHeading eyebrow="TRACK NOTEBOOK" title="Surface" description="Save a track/lane condition once, rate grip 1–10, then attach that snapshot to runs." />
      <section className="screen-card surface-entry-card">
        <div className="run-form-grid">
          <RunField label="Track / surface" value={name} onChange={setName} />
          <RunField label="Lane" value={lane} onChange={setLane} />
          <label className="run-field"><span>Date</span><div className="run-input-wrap"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div></label>
          <label className="run-field"><span>Grip rating</span><div className="run-input-wrap"><input type="range" min="1" max="10" step="1" value={rating} onChange={(e) => setRating(Number(e.target.value))} /><small>{rating}/10</small></div></label>
        </div>
        <label className="run-field run-field-full"><span>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bare asphalt, right lane cleaner, starting line came around..." /></label>
        <button type="button" className="primary-button" onClick={() => { if (!name.trim()) return; onAdd({ name: name.trim(), date, rating, lane: lane.trim(), notes: notes.trim() }); setName(""); setLane(""); setNotes(""); }}>Save Surface</button>
      </section>
      <div className="surface-list">
        {surfaces.length === 0 ? <div className="no-setups">No saved surface records yet.</div> : surfaces.slice().reverse().map((surface) => (
          <section className="saved-setup-card surface-card" key={surface.id}>
            <div><strong>{surface.name}</strong><span>{surface.date || "No date"}{surface.lane ? ` · ${surface.lane}` : ""}</span></div>
            <div className="surface-rating">Grip {surface.rating}/10</div>
            {surface.notes && <p className="run-notes">{surface.notes}</p>}
            <button type="button" className="run-delete" onClick={() => onDelete(surface.id)}>Delete</button>
          </section>
        ))}
      </div>
    </>
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
  onRenameSetup,
  onDuplicateSetup,
  onAddRun,
  onUpdateRun,
  onDeleteRun,
  onModelRun,
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
  onRenameSetup: (carId: string, setupId: string) => void;
  onDuplicateSetup: (carId: string, setupId: string) => void;
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
  onModelRun: (carId: string, setup: SavedSetup, run: RunLog) => void;
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
                    onRenameSetup={onRenameSetup}
                    onDuplicateSetup={onDuplicateSetup}
                    surfaces={car.surfaces ?? []}
                    suspensionType={car.suspensionType}
                    onAddRun={onAddRun}
                    onUpdateRun={onUpdateRun}
                    onDeleteRun={onDeleteRun}
                    onModelRun={onModelRun}
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
  onRenameSetup,
  onDuplicateSetup,
  surfaces,
  onAddRun,
  onUpdateRun,
  onDeleteRun,
  onModelRun,
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
  onRenameSetup: (carId: string, setupId: string) => void;
  onDuplicateSetup: (carId: string, setupId: string) => void;
  surfaces: SurfaceRecord[];
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
  onModelRun: (carId: string, setup: SavedSetup, run: RunLog) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingRun, setAddingRun] = useState(false);
  const [editingRunId, setEditingRunId] =
    useState<string | null>(null);

  const runs = setup.runs ?? [];
  const setupRearBias = getRearBiasString(setup.inputs);

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
            {` · ${setup.holeSpacing || DEFAULT_HOLE_SPACING}" holes`}
          </span>
        </button>

        <button type="button" className="run-edit" onClick={() => onRenameSetup(carId, setup.id)}>Rename</button>
        <button type="button" className="run-edit" onClick={() => onDuplicateSetup(carId, setup.id)}>Copy</button>

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
            {setupRearBias && (
              <span>Rear {setupRearBias}%</span>
            )}
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
            {setupRearBias && (
              <span>Rear {setupRearBias}%</span>
            )}
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
                  surfaces={surfaces}
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
                  onModel={
                    run.telemetry
                      ? () => onModelRun(carId, setup, run)
                      : undefined
                  }
                />
              ))}
            </div>
          )}

          {addingRun ? (
            <RunLogForm
              initialRearWeightBias={setupRearBias}
              copyFromRun={runs.length ? runs[runs.length - 1] : undefined}
              surfaces={surfaces}
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
  surfaces,
  editing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onModel,
}: {
  run: RunLog;
  runNumber: number;
  surfaces: SurfaceRecord[];
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (
    run: Omit<RunLog, "id" | "createdAt">
  ) => void;
  onDelete: () => void;
  onModel?: () => void;
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
        surfaces={surfaces}
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
            {run.trackSurface ? ` — ${run.trackSurface}` : ""}
          </strong>

          <span>
            {new Date(
              run.createdAt
            ).toLocaleDateString()}
          </span>
        </div>

        <div className="run-card-actions">
          {onModel && (
            <button
              type="button"
              className="run-edit"
              onClick={onModel}
            >
              Model
            </button>
          )}

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

      {(run.sessionName || run.surfaceSnapshot?.rating) && (
        <div className="run-session-line">{run.sessionName || "Race session"}{run.surfaceSnapshot?.rating ? ` · Surface ${run.surfaceSnapshot.rating}/10${run.surfaceSnapshot.lane ? ` · ${run.surfaceSnapshot.lane}` : ""}` : ""}</div>
      )}

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

      {run.telemetry && (
        <div className="run-telemetry-summary">
          Dragy · {run.telemetry.points.length} samples
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
  copyFromRun,
  surfaces = [],
  initialRearWeightBias = "",
  title = "Run Data",
  submitLabel = "Save Run",
}: {
  onSave: (
    run: Omit<RunLog, "id" | "createdAt">
  ) => void;
  onCancel: () => void;
  initialRun?: RunLog;
  copyFromRun?: RunLog;
  surfaces?: SurfaceRecord[];
  initialRearWeightBias?: string;
  title?: string;
  submitLabel?: string;
}) {
  const [run, setRun] = useState<
    Omit<RunLog, "id" | "createdAt">
  >(() => {
    const source = initialRun ?? copyFromRun;
    return {
    trackSurface: source?.trackSurface ?? "",
    sessionName: source?.sessionName ?? "",
    surfaceId: source?.surfaceId ?? "",
    surfaceSnapshot: initialRun?.surfaceSnapshot ?? null,
    frontRebound: source?.frontRebound ?? "",
    frontCompression:
      source?.frontCompression ?? "",
    rearRebound: source?.rearRebound ?? "",
    rearCompression:
      source?.rearCompression ?? "",
    rearTirePressure:
      source?.rearTirePressure ?? "",
    rearWeightBias:
      source?.rearWeightBias ?? initialRearWeightBias,
    sixtyFoot: initialRun?.sixtyFoot ?? "",
    threeThirty: initialRun?.threeThirty ?? "",
    eighthEt: initialRun?.eighthEt ?? "",
    eighthMph: initialRun?.eighthMph ?? "",
    notes: initialRun?.notes ?? "",
    telemetry: initialRun?.telemetry ?? null,
  };
  });

  function update(
    key: Exclude<
      keyof Omit<RunLog, "id" | "createdAt">,
      "telemetry"
    >,
    value: string
  ) {
    setRun((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const surface = surfaces.find((item) => item.id === run.surfaceId);
    onSave({
      ...run,
      trackSurface: surface?.name ?? run.trackSurface,
      surfaceSnapshot: surface ? { surfaceId: surface.id, name: surface.name, date: surface.date, rating: surface.rating, lane: surface.lane, notes: surface.notes } : run.surfaceSnapshot ?? null,
    });
  }

  return (
    <form className="run-form" onSubmit={submit}>
      <div className="run-form-heading">
        <div>
          <p className="eyebrow">NEW RUN</p>
          <h3>{title}</h3>
        </div>

        <span>{copyFromRun && !initialRun ? "Previous setup copied — change only what changed." : "Everything is optional."}</span>
      </div>

      <RunTelemetryImporter
        currentTelemetry={run.telemetry}
        onClear={() =>
          setRun((current) => ({ ...current, telemetry: null }))
        }
        onImported={(payload) =>
          setRun((current) => ({
            ...current,
            telemetry: payload.telemetry,
            sixtyFoot: payload.sixtyFoot || current.sixtyFoot,
            threeThirty: payload.threeThirty || current.threeThirty,
            eighthEt: payload.eighthEt || current.eighthEt,
            eighthMph: payload.eighthMph || current.eighthMph,
          }))
        }
      />

      <label className="run-field run-field-full">
        <span>Race session</span>
        <input type="text" value={run.sessionName} placeholder="Airport Backside — Oct 11" onChange={(e) => update("sessionName", e.target.value)} />
      </label>

      {surfaces.length > 0 && (
        <label className="run-field run-field-full">
          <span>Saved surface</span>
          <select value={run.surfaceId} onChange={(e) => update("surfaceId", e.target.value)}>
            <option value="">Manual / none</option>
            {surfaces.map((surface) => <option key={surface.id} value={surface.id}>{surface.name} · grip {surface.rating}/10{surface.lane ? ` · ${surface.lane}` : ""}</option>)}
          </select>
        </label>
      )}

      <label className="run-field run-field-full">
        <span>Track / surface</span>
        <input
          type="text"
          value={run.trackSurface}
          placeholder="Airport asphalt"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
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
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
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
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
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
      short: "Bar",
      label: "Theoretical Bar Change",
    },
    {
      id: "dynamic",
      short: "Dynamic",
      label: "Dynamic Geometry",
    },
    {
      id: "modeling",
      short: "Model(beta)",
      label: "Modeling Beta",
    },
    {
      id: "surface",
      short: "Surface",
      label: "Surface Records",
    },
    {
      id: "data-log",
      short: "Dragy Viewer",
      label: "Dragy Viewer",
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
  unit = "in",
  onChange,
}: {
  label: string;
  value: string;
  help?: string;
  unit?: string;
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
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onChange(e.target.value)
          }
          placeholder="0.000"
        />

        {unit && <span>{unit}</span>}
      </div>
    </label>
  );
}

function WeightSummary({ inputs }: { inputs: Inputs }) {
  const weights = getWeightData(inputs);
  if (!weights) return null;

  return (
    <div className="weight-summary">
      <span>Front {(weights.frontBias * 100).toFixed(1)}%</span>
      <strong>Rear {(weights.rearBias * 100).toFixed(1)}%</strong>
      <span>Total {weights.totalWeight.toFixed(0)} lb</span>
    </div>
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
          label="Rear Bar Spread"
          value={`${result.rearSpread.toFixed(3)}"`}
        />

        <ResultCard
          label="Front Bar Spread"
          value={`${result.frontSpread.toFixed(3)}"`}
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
        {result.rearSpread !== null && (
          <ResultCard
            label="Rear Bar Spread"
            value={`${result.rearSpread.toFixed(3)}"`}
          />
        )}
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

  const hasRearMounts =
    Number.isFinite(inputs.ladderRearUpperHeight) &&
    Number.isFinite(inputs.ladderRearLowerHeight);

  const rearUpper = hasRearMounts
    ? {
        x: inputs.ladderRearUpperX,
        y: inputs.ladderRearUpperHeight,
      }
    : null;

  const rearLower = hasRearMounts
    ? {
        x: inputs.ladderRearLowerX,
        y: inputs.ladderRearLowerHeight,
      }
    : null;

  const contactPatch = {
    x: 0,
    y: 0,
  };

  const cgReference = {
    x: inputs.wheelbase,
    y: inputs.cgHeight,
  };

  const rearMountXs = [rearUpper?.x, rearLower?.x].filter(
    (value): value is number => Number.isFinite(value)
  );
  const rearMountYs = [rearUpper?.y, rearLower?.y].filter(
    (value): value is number => Number.isFinite(value)
  );

  const minX =
    Math.min(-tireRadius - 10, frontPivot.x, ...rearMountXs) - 2;

  const maxX =
    Math.max(
      inputs.wheelbase + tireRadius + 10,
      frontPivot.x,
      ...rearMountXs
    ) + 2;

  const maxY =
    Math.max(
      tireRadius * 2,
      frontPivot.y,
      inputs.cgHeight,
      ...rearMountYs
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
  const rearUpperSvg = rearUpper ? mapPoint(rearUpper) : null;
  const rearLowerSvg = rearLower ? mapPoint(rearLower) : null;
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

        {rearUpperSvg && rearLowerSvg ? (
          <>
            <line
              x1={rearUpperSvg.x}
              y1={rearUpperSvg.y}
              x2={frontPivotSvg.x}
              y2={frontPivotSvg.y}
              className="geometry-bar upper-bar"
            />
            <line
              x1={rearLowerSvg.x}
              y1={rearLowerSvg.y}
              x2={frontPivotSvg.x}
              y2={frontPivotSvg.y}
              className="geometry-bar lower-bar"
            />
            <circle
              cx={rearUpperSvg.x}
              cy={rearUpperSvg.y}
              r={4.5}
              className="geometry-pivot"
            />
            <circle
              cx={rearLowerSvg.x}
              cy={rearLowerSvg.y}
              r={4.5}
              className="geometry-pivot"
            />
          </>
        ) : (
          <line
            x1={rearAxleSvg.x}
            y1={rearAxleSvg.y}
            x2={frontPivotSvg.x}
            y2={frontPivotSvg.y}
            className="geometry-bar ladder-bar-line"
          />
        )}

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
    x: inputs.upperRearX,
    y: inputs.upperRearHeight,
  };

  const lowerRear = {
    x: inputs.lowerRearX,
    y: inputs.lowerRearHeight,
  };

  const upperFront = {
    x: inputs.upperRearX + result.upperRun,
    y: inputs.upperFrontHeight,
  };

  const lowerFront = {
    x: inputs.lowerRearX + result.lowerRun,
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

  // Keep extreme/near-parallel ICs from shrinking the suspension drawing to
  // a few pixels. The numerical IC remains exact in the readout; when it is
  // far outside a useful chassis-scale view, only its direction line is shown.
  const baseMinX = Math.min(
    -tireRadius - 10,
    upperRear.x,
    lowerRear.x,
    upperFront.x,
    lowerFront.x
  );
  const baseMaxX = Math.max(
    inputs.wheelbase + tireRadius + 10,
    upperRear.x,
    lowerRear.x,
    upperFront.x,
    lowerFront.x
  );
  const baseMaxY = Math.max(
    tireRadius * 2,
    upperRear.y,
    upperFront.y,
    lowerRear.y,
    lowerFront.y,
    inputs.cgHeight
  );
  const baseSpanX = Math.max(1, baseMaxX - baseMinX);
  const icOnScale =
    ic.x >= baseMinX - baseSpanX * 0.35 &&
    ic.x <= baseMaxX + baseSpanX * 0.75 &&
    ic.y >= 0 &&
    ic.y <= baseMaxY * 1.75;

  const minX = (icOnScale ? Math.min(baseMinX, ic.x) : baseMinX) - 2;
  const maxX = (icOnScale ? Math.max(baseMaxX, ic.x) : baseMaxX) + 2;
  const maxY =
    (icOnScale ? Math.max(baseMaxY, ic.y) : baseMaxY) + 10;

  let icForPlot = ic;
  if (!icOnScale) {
    const xReach = baseSpanX * 1.35;
    const yReach = Math.max(baseMaxY, 1) * 1.35;
    const xFactor = Math.abs(ic.x) > 1e-9 ? xReach / Math.abs(ic.x) : 1;
    const yFactor = Math.abs(ic.y) > 1e-9 ? yReach / Math.abs(ic.y) : 1;
    const factor = Math.max(0, Math.min(1, xFactor, yFactor));
    icForPlot = { x: ic.x * factor, y: ic.y * factor };
  }

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
  const icSvg = mapPoint(icForPlot);
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
          {!icOnScale ? " · off-scale" : ""}
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

        {icOnScale && (
          <>
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
          </>
        )}

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

        {icOnScale && (
          <>
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
          </>
        )}
      </svg>
    </div>
  );
}

export default App;
