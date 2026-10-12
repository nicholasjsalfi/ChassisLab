import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import { interpolateDragy, parseTelemetryFile } from "../telemetry/dragy";
import type { DragyPoint, RunTelemetry } from "../types";
import { supabase } from "../cloud/supabaseClient";

type Slot = "A" | "B";
type AxisMode = "time" | "distance";

type StoredLog = {
  name: string;
  telemetry: RunTelemetry;
};

type CloudTelemetryLog = {
  id: string;
  user_id: string;
  name: string;
  source: string;
  telemetry: RunTelemetry;
  created_at: string;
};

type Sample = {
  time: number;
  speed: number | null;
  g: number | null;
  distance: number;
};

const STORAGE_KEY = "chassislab-datalog-v1";

function nums(values: Array<number | null | undefined>) {
  return values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value)
  );
}

function fmt(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "—";
}

function withDistance(points: DragyPoint[]) {
  let distance = 0;

  return points.map((point, index) => {
    if (index > 0) {
      const previous = points[index - 1];
      const dt = Math.max(0, point.time - previous.time);

      const previousSpeed =
        previous.speed ?? point.speed ?? 0;

      const currentSpeed =
        point.speed ?? previous.speed ?? 0;

      const averageFps =
        ((previousSpeed + currentSpeed) / 2) * 1.4666667;

      distance += averageFps * dt;
    }

    return {
      ...point,
      distance,
    };
  });
}

function sampleDistance(
  points: DragyPoint[],
  target: number
): Sample | null {
  const data = withDistance(points);

  if (!data.length) return null;

  if (target <= 0) {
    return {
      time: data[0].time,
      speed: data[0].speed,
      g: data[0].g,
      distance: 0,
    };
  }

  const last = data[data.length - 1];

  if (target >= last.distance) {
    return {
      time: last.time,
      speed: last.speed,
      g: last.g,
      distance: last.distance,
    };
  }

  let low = 0;
  let high = data.length - 1;

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);

    if (data[middle].distance <= target) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const a = data[low];
  const b = data[high];

  const span = Math.max(
    0.000001,
    b.distance - a.distance
  );

  const ratio =
    (target - a.distance) / span;

  const interpolateNullable = (
    first: number | null,
    second: number | null
  ) => {
    if (first == null && second == null) return null;
    if (first == null) return second;
    if (second == null) return first;

    return first + (second - first) * ratio;
  };

  return {
    time:
      a.time +
      (b.time - a.time) * ratio,

    speed: interpolateNullable(
      a.speed,
      b.speed
    ),

    g: interpolateNullable(
      a.g,
      b.g
    ),

    distance: target,
  };
}

function sampleTime(
  points: DragyPoint[],
  target: number
): Sample | null {
  const point = interpolateDragy(
    points,
    target
  );

  if (!point) return null;

  const data = withDistance(points);

  let distance = 0;

  for (
    let index = 1;
    index < data.length;
    index++
  ) {
    if (data[index].time >= target) {
      const a = data[index - 1];
      const b = data[index];

      const ratio =
        (target - a.time) /
        Math.max(
          0.000001,
          b.time - a.time
        );

      distance =
        a.distance +
        (b.distance - a.distance) *
          ratio;

      break;
    }

    distance =
      data[index].distance;
  }

  return {
    ...point,
    distance,
  };
}

function buildPath(
  points: DragyPoint[],
  key: "speed" | "g",
  width: number,
  height: number,
  xMax: number,
  yMin: number,
  yMax: number,
  axis: AxisMode,
  splits?: {
    sixtyFoot?: number;
    threeThirty?: number;
    eighthEt?: number;
  }
) {
  // Display-only origin point.
  // This makes every graph begin at:
  // 0.000 sec / 0 mph / 0 g
  // without modifying the imported telemetry.
  const graphPoints: DragyPoint[] = [
    {
      time: 0,
      speed: 0,
      g: 0,
    },
    ...points.filter(
      (point) => point.time > 0
    ),
  ];

  const rawData = withDistance(graphPoints);

  const anchors: Array<{
    time: number;
    distance: number;
  }> = [
    { time: 0, distance: 0 },
  ];

  if (
    splits?.sixtyFoot !== undefined &&
    Number.isFinite(splits.sixtyFoot)
  ) {
    anchors.push({
      time: splits.sixtyFoot,
      distance: 60,
    });
  }

  if (
    splits?.threeThirty !== undefined &&
    Number.isFinite(splits.threeThirty)
  ) {
    anchors.push({
      time: splits.threeThirty,
      distance: 330,
    });
  }

  if (
    splits?.eighthEt !== undefined &&
    Number.isFinite(splits.eighthEt)
  ) {
    anchors.push({
      time: splits.eighthEt,
      distance: 660,
    });
  }

  anchors.sort((a, b) => a.time - b.time);

  const calibratedDistance = (
    time: number,
    rawDistance: number
  ) => {
    if (
      axis !== "distance" ||
      anchors.length <= 1
    ) {
      return rawDistance;
    }

    if (time <= anchors[0].time) {
      return anchors[0].distance;
    }

    for (
      let index = 1;
      index < anchors.length;
      index++
    ) {
      const a = anchors[index - 1];
      const b = anchors[index];

      if (time <= b.time) {
        const ratio =
          (time - a.time) /
          Math.max(
            0.000001,
            b.time - a.time
          );

        return (
          a.distance +
          (b.distance - a.distance) *
            ratio
        );
      }
    }

    const last =
      anchors[anchors.length - 1];

    const rawAtLast =
      sampleTime(
        graphPoints,
        last.time
      )?.distance ?? last.distance;

    return (
      last.distance +
      (rawDistance - rawAtLast)
    );
  };

  const data = rawData.map((point) => ({
    ...point,
    distance: calibratedDistance(
      point.time,
      point.distance
    ),
  }));

  return data
    .map((point) => {
      const value = point[key];

      const xValue =
        axis === "time"
          ? point.time
          : point.distance;

      if (
        value == null ||
        !Number.isFinite(value)
      ) {
        return null;
      }

      const x =
        (xValue /
          Math.max(xMax, 0.001)) *
        width;

      const y =
        height -
        ((value - yMin) /
          Math.max(
            yMax - yMin,
            0.001
          )) *
          height;

      return [x, y] as const;
    })
    .filter(
      (
        value
      ): value is readonly [
        number,
        number
      ] => value !== null
    )
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point[0].toFixed(
          1
        )},${point[1].toFixed(1)}`
    )
    .join(" ");
}

function timeAtSpeed(
  points: DragyPoint[],
  targetSpeed: number
): number | null {
  if (
    !Number.isFinite(targetSpeed) ||
    targetSpeed < 0
  ) {
    return null;
  }

  // A drag run is assumed to begin at
  // 0.000 sec / 0 mph.
  const data: DragyPoint[] = [
    {
      time: 0,
      speed: 0,
      g: 0,
    },
    ...points
      .filter(
        (point) =>
          point.time > 0 &&
          point.speed !== null &&
          Number.isFinite(point.speed)
      )
      .sort((a, b) => a.time - b.time),
  ];

  if (targetSpeed === 0) {
    return 0;
  }

  for (
    let index = 1;
    index < data.length;
    index += 1
  ) {
    const previous = data[index - 1];
    const current = data[index];

    const previousSpeed =
      previous.speed;

    const currentSpeed =
      current.speed;

    if (
      previousSpeed === null ||
      currentSpeed === null
    ) {
      continue;
    }

    // Find the first upward crossing of the
    // requested speed.
    if (
      previousSpeed <= targetSpeed &&
      currentSpeed >= targetSpeed
    ) {
      const speedChange =
        currentSpeed - previousSpeed;

      if (
        Math.abs(speedChange) < 0.000001
      ) {
        return current.time;
      }

      const fraction =
        (targetSpeed - previousSpeed) /
        speedChange;

      return (
        previous.time +
        fraction *
          (current.time - previous.time)
      );
    }
  }

  return null;
}

function speedIntervalTime(
  points: DragyPoint[],
  startSpeed: number,
  endSpeed: number
): number | null {
  if (
    !Number.isFinite(startSpeed) ||
    !Number.isFinite(endSpeed) ||
    startSpeed < 0 ||
    endSpeed <= startSpeed
  ) {
    return null;
  }

  const startTime =
    timeAtSpeed(points, startSpeed);

  const endTime =
    timeAtSpeed(points, endSpeed);

  if (
    startTime === null ||
    endTime === null ||
    endTime < startTime
  ) {
    return null;
  }

  return endTime - startTime;
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="datalog-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Readout({
  title,
  data,
}: {
  title: string;
  data: Sample | null;
}) {
  return (
    <div className="screen-card datalog-readout">
      <strong>{title}</strong>

      <Metric
        label="Time"
        value={
          data
            ? `${fmt(data.time, 3)} s`
            : "—"
        }
      />

      <Metric
        label="Distance"
        value={
          data
            ? `${fmt(
                data.distance,
                1
              )} ft`
            : "—"
        }
      />

      <Metric
        label="Speed"
        value={
          data
            ? `${fmt(
                data.speed,
                2
              )} mph`
            : "—"
        }
      />

      <Metric
        label="G-force"
        value={
          data
            ? `${fmt(
                data.g,
                3
              )} g`
            : "—"
        }
      />
    </div>
  );
}

function Summary({
  title,
  log,
}: {
  title: string;
  log: StoredLog | null;
}) {
  const points =
    log?.telemetry.points ?? [];

  const calculatedSixty =
    log
      ? sampleDistance(
          points,
          60
        )
      : null;

  const sixty =
    log?.telemetry.splits.sixtyFoot !== undefined
      ? {
          ...(calculatedSixty ?? {
            speed: null,
            g: null,
            distance: 60,
          }),
          time: log.telemetry.splits.sixtyFoot,
          distance: 60,
        }
      : calculatedSixty;

  const gValues =
    nums(
      points.map(
        (point) => point.g
      )
    );

  const earlyG =
    sixty
      ? nums(
          points
            .filter(
              (point) =>
                point.time <=
                sixty.time
            )
            .map(
              (point) =>
                point.g
            )
        )
      : [];

  const averageG =
    earlyG.length
      ? earlyG.reduce(
          (sum, value) =>
            sum + value,
          0
        ) / earlyG.length
      : null;

  return (
    <div className="screen-card datalog-summary">
      <strong>
        {title} summary
      </strong>

      <Metric
        label="Peak G"
        value={
          gValues.length
            ? `${fmt(
                Math.max(
                  ...gValues
                ),
                3
              )} g`
            : "—"
        }
      />

      <Metric
        label="Avg G to 60 ft"
        value={
          averageG != null
            ? `${fmt(
                averageG,
                3
              )} g`
            : "—"
        }
      />

      <Metric
        label="60 ft"
        value={
          sixty
            ? `${fmt(
                sixty.time,
                3
              )} s`
            : "—"
        }
      />

      <Metric
        label="Speed @ 60"
        value={
          sixty
            ? `${fmt(
                sixty.speed,
                1
              )} mph`
            : "—"
        }
      />
    </div>
  );
}

export default function DataLogScreen({
  userId,
  userEmail,
}: {
  userId: string | null;
  userEmail: string | null;
}) {
  const [runA, setRunA] =
    useState<StoredLog | null>(
      null
    );

  const [runB, setRunB] =
    useState<StoredLog | null>(
      null
    );

  const [note, setNote] =
    useState("");

  const [savedLogs, setSavedLogs] =
    useState<CloudTelemetryLog[]>([]);

  const [savedLogsLoading, setSavedLogsLoading] =
    useState(false);

  const [savedLogsError, setSavedLogsError] =
    useState("");

  const [renamingLogId, setRenamingLogId] =
    useState<string | null>(null);

  const [renameValue, setRenameValue] =
    useState("");

  const [savedLogsOpen, setSavedLogsOpen] =
    useState(false);

  const axis: AxisMode = "time";

  const [
    showSpeed,
    setShowSpeed,
  ] = useState(true);

  const [showG, setShowG] =
    useState(true);

  // null = use the calculated value from the loaded runs.
  // Typing into a box overrides that end of the graph scale.
  const [speedScaleMin, setSpeedScaleMin] =
    useState<number | null>(null);

  const [speedScaleMax, setSpeedScaleMax] =
    useState<number | null>(null);

  const [gScaleMin, setGScaleMin] =
    useState<number | null>(null);

  const [gScaleMax, setGScaleMax] =
    useState<number | null>(null);

  const [intervalStartSpeed, setIntervalStartSpeed] =
    useState(60);

  const [intervalEndSpeed, setIntervalEndSpeed] =
    useState(130);

  const [cursor, setCursor] =
    useState(0);

  const chartRef =
    useRef<HTMLDivElement>(
      null
    );

  useEffect(() => {
    try {
      const stored =
        JSON.parse(
          localStorage.getItem(
            STORAGE_KEY
          ) || "{}"
        );

      if (stored.runA) {
        setRunA(
          stored.runA
        );
      }

      if (stored.runB) {
        setRunB(
          stored.runB
        );
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        runA,
        runB,
      })
    );
  }, [runA, runB]);

  const xMax =
    useMemo(() => {
      const logs = [
        runA,
        runB,
      ].filter(
        Boolean
      ) as StoredLog[];

      if (!logs.length) {
        return 1;
      }

      if (axis === "time") {
        return Math.max(
          1,
          ...logs.map(
            (log) =>
              log.telemetry.points[
                log.telemetry
                  .points.length -
                  1
              ]?.time ?? 0
          )
        );
      }

      return Math.max(
        1,
        ...logs.map(
          (log) => {
            const data =
              withDistance(
                log.telemetry
                  .points
              );

            return (
              data[
                data.length -
                  1
              ]?.distance ??
              0
            );
          }
        )
      );
    }, [
      runA,
      runB,
      axis,
    ]);

  useEffect(() => {
    setCursor((value) =>
      Math.min(
        value,
        xMax
      )
    );
  }, [xMax]);

  function readLog(
    log: StoredLog | null
  ) {
    if (!log) {
      return null;
    }

    return sampleTime(
      log.telemetry.points,
      cursor
    );
  }

  const a =
    readLog(runA);

  const b =
    readLog(runB);

  async function loadSavedLogs() {
    if (!supabase || !userId) {
      setSavedLogs([]);
      setSavedLogsError("");
      return;
    }

    setSavedLogsLoading(true);
    setSavedLogsError("");

    const { data, error } = await supabase
      .from("chassislab_telemetry")
      .select(
        "id, user_id, name, source, telemetry, created_at"
      )
      .eq("user_id", userId)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error(
        "Could not load saved telemetry:",
        error
      );

      setSavedLogsError(
        "Could not load saved Data Logs."
      );

      setSavedLogsLoading(false);
      return;
    }

    setSavedLogs(
      (data ?? []) as CloudTelemetryLog[]
    );

    setSavedLogsLoading(false);
  }

  function loadCloudLog(
    cloudLog: CloudTelemetryLog,
    slot: Slot
  ) {
    const log: StoredLog = {
      name: cloudLog.name,
      telemetry: cloudLog.telemetry,
    };

    if (slot === "A") {
      setRunA(log);
    } else {
      setRunB(log);
    }

    setCursor(0);

    setNote(
      `Loaded ${cloudLog.name} into Run ${slot}.`
    );
  }

  function beginRename(
    cloudLog: CloudTelemetryLog
  ) {
    setRenamingLogId(cloudLog.id);
    setRenameValue(cloudLog.name);
  }

  async function renameCloudLog(
    cloudLog: CloudTelemetryLog
  ) {
    if (!supabase || !userId) {
      return;
    }

    const nextName = renameValue.trim();

    if (!nextName) {
      setNote(
        "A saved Data Log needs a name."
      );
      return;
    }

    const { error } = await supabase
      .from("chassislab_telemetry")
      .update({
        name: nextName,
      })
      .eq("id", cloudLog.id)
      .eq("user_id", userId);

    if (error) {
      console.error(
        "Could not rename telemetry:",
        error
      );

      setNote(
        "Could not rename the saved Data Log."
      );

      return;
    }

    setRenamingLogId(null);
    setRenameValue("");

    setSavedLogs((logs) =>
      logs.map((log) =>
        log.id === cloudLog.id
          ? {
              ...log,
              name: nextName,
            }
          : log
      )
    );

    setNote(
      `Renamed saved Data Log to ${nextName}.`
    );
  }

  async function deleteCloudLog(
    cloudLog: CloudTelemetryLog
  ) {
    if (!supabase || !userId) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${cloudLog.name}" from Saved Data Logs?`
    );

    if (!confirmed) {
      return;
    }

    const { error } = await supabase
      .from("chassislab_telemetry")
      .delete()
      .eq("id", cloudLog.id)
      .eq("user_id", userId);

    if (error) {
      console.error(
        "Could not delete telemetry:",
        error
      );

      setNote(
        "Could not delete the saved Data Log."
      );

      return;
    }

    setSavedLogs((logs) =>
      logs.filter(
        (log) => log.id !== cloudLog.id
      )
    );

    if (renamingLogId === cloudLog.id) {
      setRenamingLogId(null);
      setRenameValue("");
    }

    setNote(
      `Deleted ${cloudLog.name} from Saved Data Logs.`
    );
  }

  async function saveTelemetryToCloud(
    name: string,
    telemetry: RunTelemetry
  ) {
    if (!supabase || !userId) {
      return;
    }

    const { error } = await supabase
      .from("chassislab_telemetry")
      .insert({
        user_id: userId,
        name,
        source: telemetry.source || "dragy",
        telemetry,
      });

    if (error) {
      throw error;
    }
  }

  useEffect(() => {
    void loadSavedLogs();
  }, [userId]);

  async function importFile(
    slot: Slot,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target
        .files?.[0];

    event.target.value =
      "";

    if (!file) return;

    setNote(
      `Reading ${file.name}...`
    );

    const result =
      await parseTelemetryFile(
        file
      );

    if (
      !result.telemetry ||
      result.telemetry
        .points.length < 2
    ) {
      setNote(
        result.message ||
          "No usable telemetry was found."
      );

      return;
    }

    const log = {
      name: file.name,
      telemetry:
        result.telemetry,
    };

    let cloudMessage = "";

    if (userId) {
      try {
        await saveTelemetryToCloud(
          file.name,
          result.telemetry
        );

        cloudMessage = userEmail
          ? ` Saved to ${userEmail}.`
          : " Saved to your ChassisLab account.";

        await loadSavedLogs();

        await loadSavedLogs();

        await loadSavedLogs();
      } catch (error) {
        console.error(
          "Telemetry cloud save failed:",
          error
        );

        cloudMessage =
          " Imported locally, but cloud save failed.";
      }
    }

    if (slot === "A") {
      setRunA(log);
    } else {
      setRunB(log);
    }

    setCursor(0);

    setNote(
      `${slot}: ${file.name} — ${result.telemetry.points.length} points — ${result.message}${cloudMessage}`
    );
  }

  function moveCursor(
    event: PointerEvent<HTMLDivElement>
  ) {
    const rect =
      chartRef.current?.getBoundingClientRect();

    if (!rect) return;

    const ratio =
      (event.clientX -
        rect.left) /
      rect.width;

    setCursor(
      Math.max(
        0,
        Math.min(
          xMax,
          ratio * xMax
        )
      )
    );
  }

  const speedValues =
    nums([
      ...(runA?.telemetry.points.map(
        (point) =>
          point.speed
      ) ?? []),

      ...(runB?.telemetry.points.map(
        (point) =>
          point.speed
      ) ?? []),
    ]);

  const gValues =
    nums([
      ...(runA?.telemetry.points.map(
        (point) =>
          point.g
      ) ?? []),

      ...(runB?.telemetry.points.map(
        (point) =>
          point.g
      ) ?? []),
    ]);

  const speedMax =
    Math.max(
      10,
      ...speedValues
    ) * 1.05;

  const gMin =
    Math.min(
      0,
      ...gValues
    ) - 0.1;

  const gMax =
    Math.max(
      1,
      ...gValues
    ) + 0.1;

  const WIDTH = 1000;
  const HEIGHT = 330;

  const cursorX =
    (cursor / xMax) *
    WIDTH;

  // ----------------------------------------------------------
  // GRAPH AXES
  // Left  = G-force
  // Right = MPH
  // Bottom = Time
  // ----------------------------------------------------------

  // ----------------------------------------------------------
  // CLEAN SHARED GRAPH SCALES
  //
  // Both runs always use the same Y-axis scales so their
  // traces can be compared directly.
  //
  // MPH rounds upward to the next 10 mph.
  // G rounds outward to the next 0.5 g.
  // ----------------------------------------------------------

  const speedAxisStep = 10;
  const gAxisStep = 0.5;

  // Automatic defaults based on whichever loaded run
  // requires the larger range.
  const autoSpeedAxisMin = 0;

  const autoSpeedAxisMax = Math.max(
    speedAxisStep,
    Math.ceil(speedMax / speedAxisStep) *
      speedAxisStep
  );

  const autoGAxisMin =
    gMin < 0
      ? Math.floor(gMin / gAxisStep) *
        gAxisStep
      : 0;

  const autoGAxisMax = Math.max(
    gAxisStep,
    Math.ceil(gMax / gAxisStep) *
      gAxisStep
  );

  // The calculated values populate the boxes initially.
  // Once edited, that end of the scale uses the user's value.
  const speedAxisMin =
    speedScaleMin ?? autoSpeedAxisMin;

  const speedAxisMax =
    speedScaleMax ?? autoSpeedAxisMax;

  const gAxisMin =
    gScaleMin ?? autoGAxisMin;

  const gAxisMax =
    gScaleMax ?? autoGAxisMax;

  const speedRange = Math.max(
    speedAxisMax - speedAxisMin,
    0.001
  );

  const gRange = Math.max(
    gAxisMax - gAxisMin,
    0.001
  );

  const speedTickStart =
    Math.ceil(
      speedAxisMin / speedAxisStep
    ) * speedAxisStep;

  const speedTickEnd =
    Math.floor(
      speedAxisMax / speedAxisStep
    ) * speedAxisStep;

  const speedTicks: {
    value: number;
    y: number;
  }[] = [];

  for (
    let value = speedTickEnd;
    value >= speedTickStart - 0.0001;
    value -= speedAxisStep
  ) {
    speedTicks.push({
      value,
      y:
        ((speedAxisMax - value) /
          speedRange) *
        HEIGHT,
    });
  }

  const gTickStart =
    Math.ceil(
      gAxisMin / gAxisStep
    ) * gAxisStep;

  const gTickEnd =
    Math.floor(
      gAxisMax / gAxisStep
    ) * gAxisStep;

  const gTicks: {
    value: number;
    y: number;
  }[] = [];

  for (
    let value = gTickEnd;
    value >= gTickStart - 0.0001;
    value -= gAxisStep
  ) {
    const cleanValue =
      Number(value.toFixed(2));

    gTicks.push({
      value: cleanValue,
      y:
        ((gAxisMax - cleanValue) /
          gRange) *
        HEIGHT,
    });
  }

  const splitDefinitions = [
    { label: "60", feet: 60 },
    { label: "330", feet: 330 },
    { label: "1/8", feet: 660 },
  ];

  function officialSplitTime(
    log: StoredLog,
    feet: number
  ): number | null {
    const splits =
      log.telemetry.splits;

    if (
      feet === 60 &&
      splits.sixtyFoot !== undefined
    ) {
      return splits.sixtyFoot;
    }

    if (
      feet === 330 &&
      splits.threeThirty !== undefined
    ) {
      return splits.threeThirty;
    }

    if (
      feet === 660 &&
      splits.eighthEt !== undefined
    ) {
      return splits.eighthEt;
    }

    // Fallback for telemetry sources that do not
    // contain official timing splits.
    const calculated =
      sampleDistance(
        log.telemetry.points,
        feet
      );

    return calculated?.time ?? null;
  }

  const splitMarkers: {
    label: string;
    feet: number;
    x: number;
    run: "A" | "B" | "distance";
  }[] = [];

    const addRunMarkers = (
      log: StoredLog | null,
      run: "A" | "B"
    ) => {
      if (!log) return;

      for (const split of splitDefinitions) {
        const splitTime =
          officialSplitTime(
            log,
            split.feet
          );

        if (
          splitTime == null ||
          splitTime < 0 ||
          splitTime > xMax
        ) {
          continue;
        }

        splitMarkers.push({
          ...split,
          x:
            (splitTime /
              Math.max(xMax, 0.001)) *
            WIDTH,
          run,
        });
      }
    };

    addRunMarkers(runA, "A");
    addRunMarkers(runB, "B");
  

  const splits = [
    ["60 ft", 60],
    ["330 ft", 330],
    ["1/8", 660],
  ] as const;

  return (
    <div className="datalog-screen">
      <div className="screen-heading-row">
        <div>
          <p className="section-eyebrow">
            TELEMETRY ANALYSIS
          </p>

          <h2>
            Data Log
          </h2>

          <p className="muted">
            Inspect one Dragy pass or overlay two runs to see exactly where ET, speed and acceleration changed.
          </p>
        </div>
      </div>

      <section className="screen-card datalog-imports">
        {(
          [
            "A",
            "B",
          ] as Slot[]
        ).map(
          (slot) => {
            const log =
              slot === "A"
                ? runA
                : runB;

  return (
              <div
                className={`datalog-slot slot-${slot.toLowerCase()}`}
                key={slot}
              >
                <div>
                  <strong>
                    Run {slot}
                  </strong>

                  <span>
                    {log?.name ??
                      "No log loaded"}
                  </span>
                </div>

                <label className="secondary-button datalog-file-button">
                  {log
                    ? "Replace"
                    : "Import Dragy"}

                  <input
                    type="file"
                    accept=".dragy,.json,.csv,.vbo,.zip"
                    onChange={(
                      event
                    ) =>
                      importFile(
                        slot,
                        event
                      )
                    }
                  />
                </label>

                {log && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      slot === "A"
                        ? setRunA(
                            null
                          )
                        : setRunB(
                            null
                          )
                    }
                  >
                    Clear
                  </button>
                )}
              </div>
            );
          }
        )}

        {note && (
          <div className="datalog-note">
            {note}
          </div>
        )}
      </section>

      {userId && (
        <section
          className={`screen-card datalog-saved-library ${
            savedLogsOpen ? "open" : ""
          }`}
        >
          <button
            type="button"
            className="datalog-saved-folder"
            onClick={() =>
              setSavedLogsOpen(
                (open) => !open
              )
            }
            aria-expanded={savedLogsOpen}
          >
            <div className="datalog-saved-folder-icon">
              {savedLogsOpen ? "▾" : "›"}
            </div>

            <div className="datalog-saved-folder-text">
              <strong>
                Saved Data Logs
              </strong>

              <span>
                {savedLogsLoading
                  ? "Loading saved runs..."
                  : savedLogs.length === 1
                    ? "1 saved run"
                    : `${savedLogs.length} saved runs`}
              </span>
            </div>

            <div className="datalog-saved-folder-action">
              {savedLogsOpen
                ? "Close"
                : "Open"}
            </div>
          </button>

          {savedLogsOpen && (
            <div className="datalog-saved-content">
              <div className="datalog-saved-content-header">
                <span>
                  Your cloud Dragy library
                </span>

                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void loadSavedLogs()
                  }
                  disabled={savedLogsLoading}
                >
                  {savedLogsLoading
                    ? "Refreshing..."
                    : "Refresh"}
                </button>
              </div>

              {savedLogsError && (
                <div className="datalog-note">
                  {savedLogsError}
                </div>
              )}

              {!savedLogsLoading &&
                !savedLogsError &&
                savedLogs.length === 0 && (
                  <div className="datalog-saved-empty">
                    Import a Dragy file and it will be saved here for quick access.
                  </div>
                )}

              {savedLogs.length > 0 && (
                <div className="datalog-saved-list">
                  {savedLogs.map(
                    (cloudLog) => {
                      const points =
                        cloudLog.telemetry
                          ?.points ?? [];

                      const calculatedSixty =
                        points.length
                          ? sampleDistance(
                              points,
                              60
                            )
                          : null;

                      const calculatedEighth =
                        points.length
                          ? sampleDistance(
                              points,
                              660
                            )
                          : null;

                      const sixty =
                        cloudLog.telemetry.splits
                          .sixtyFoot !== undefined
                          ? {
                              ...(calculatedSixty ?? {
                                speed: null,
                                g: null,
                                distance: 60,
                              }),
                              time:
                                cloudLog.telemetry.splits
                                  .sixtyFoot,
                              distance: 60,
                            }
                          : calculatedSixty;

                      const eighth =
                        cloudLog.telemetry.splits
                          .eighthEt !== undefined
                          ? {
                              ...(calculatedEighth ?? {
                                speed: null,
                                g: null,
                                distance: 660,
                              }),
                              time:
                                cloudLog.telemetry.splits
                                  .eighthEt,
                              speed:
                                cloudLog.telemetry.splits
                                  .eighthMph ??
                                calculatedEighth?.speed ??
                                null,
                              distance: 660,
                            }
                          : calculatedEighth;

                      const isRenaming =
                        renamingLogId ===
                        cloudLog.id;

                      return (
                        <div
                          className="datalog-saved-item"
                          key={cloudLog.id}
                        >
                          <div className="datalog-saved-info">
                            {isRenaming ? (
                              <div className="datalog-saved-rename">
                                <input
                                  type="text"
                                  value={renameValue}
                                  autoFocus
                                  onChange={(event) =>
                                    setRenameValue(
                                      event.target.value
                                    )
                                  }
                                  onKeyDown={(event) => {
                                    if (
                                      event.key ===
                                      "Enter"
                                    ) {
                                      void renameCloudLog(
                                        cloudLog
                                      );
                                    }

                                    if (
                                      event.key ===
                                      "Escape"
                                    ) {
                                      setRenamingLogId(
                                        null
                                      );

                                      setRenameValue(
                                        ""
                                      );
                                    }
                                  }}
                                  aria-label="Saved Data Log name"
                                />

                                <div className="datalog-saved-rename-actions">
                                  <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() =>
                                      void renameCloudLog(
                                        cloudLog
                                      )
                                    }
                                  >
                                    Save
                                  </button>

                                  <button
                                    type="button"
                                    className="text-button"
                                    onClick={() => {
                                      setRenamingLogId(
                                        null
                                      );

                                      setRenameValue(
                                        ""
                                      );
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <strong className="datalog-saved-name">
                                  {cloudLog.name}
                                </strong>

                                <span className="datalog-saved-date">
                                  {new Date(
                                    cloudLog.created_at
                                  ).toLocaleString()}
                                </span>

                                <div className="datalog-saved-stats">
                                  {sixty && (
                                    <span>
                                      <small>60 FT</small>
                                      <b>
                                        {fmt(
                                          sixty.time,
                                          3
                                        )} s
                                      </b>
                                    </span>
                                  )}

                                  {eighth && (
                                    <>
                                      <span>
                                        <small>1/8 ET</small>
                                        <b>
                                          {fmt(
                                            eighth.time,
                                            3
                                          )} s
                                        </b>
                                      </span>

                                      <span>
                                        <small>MPH</small>
                                        <b>
                                          {fmt(
                                            eighth.speed,
                                            1
                                          )}
                                        </b>
                                      </span>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </div>

                          {!isRenaming && (
                            <div className="datalog-saved-actions">
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() =>
                                  loadCloudLog(
                                    cloudLog,
                                    "A"
                                  )
                                }
                              >
                                Load A
                              </button>

                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() =>
                                  loadCloudLog(
                                    cloudLog,
                                    "B"
                                  )
                                }
                              >
                                Load B
                              </button>

                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  beginRename(
                                    cloudLog
                                  )
                                }
                              >
                                Rename
                              </button>

                              <button
                                type="button"
                                className="text-button danger"
                                onClick={() =>
                                  void deleteCloudLog(
                                    cloudLog
                                  )
                                }
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    }
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {(runA || runB) && (
        <>
          <section className="screen-card datalog-toolbar">
            <div className="datalog-channel-control">
              <label className="datalog-channel-check">
                <input
                  type="checkbox"
                  checked={showSpeed}
                  onChange={(event) =>
                    setShowSpeed(
                      event.target.checked
                    )
                  }
                />
                <span>Speed</span>
              </label>

              <div className="datalog-scale-row">
                <span className="datalog-scale-bound">
                  Min
                </span>

                <input
                  className="datalog-scale-number"
                  type="number"
                  step="10"
                  value={
                    speedScaleMin ??
                    autoSpeedAxisMin
                  }
                  onChange={(event) => {
                    const value =
                      Number(event.target.value);

                    if (Number.isFinite(value)) {
                      setSpeedScaleMin(value);
                    }
                  }}
                  aria-label="Speed scale minimum"
                />

                <span className="datalog-scale-bound">
                  Max
                </span>

                <input
                  className="datalog-scale-number"
                  type="number"
                  step="10"
                  value={
                    speedScaleMax ??
                    autoSpeedAxisMax
                  }
                  onChange={(event) => {
                    const value =
                      Number(event.target.value);

                    if (Number.isFinite(value)) {
                      setSpeedScaleMax(value);
                    }
                  }}
                  aria-label="Speed scale maximum"
                />

                <span className="datalog-scale-unit">
                  mph
                </span>
              </div>
            </div>

            <div className="datalog-channel-control">
              <label className="datalog-channel-check">
                <input
                  type="checkbox"
                  checked={showG}
                  onChange={(event) =>
                    setShowG(
                      event.target.checked
                    )
                  }
                />
                <span>G-force</span>
              </label>

              <div className="datalog-scale-row">
                <span className="datalog-scale-bound">
                  Min
                </span>

                <input
                  className="datalog-scale-number"
                  type="number"
                  step="0.5"
                  value={
                    gScaleMin ??
                    autoGAxisMin
                  }
                  onChange={(event) => {
                    const value =
                      Number(event.target.value);

                    if (Number.isFinite(value)) {
                      setGScaleMin(value);
                    }
                  }}
                  aria-label="G-force scale minimum"
                />

                <span className="datalog-scale-bound">
                  Max
                </span>

                <input
                  className="datalog-scale-number"
                  type="number"
                  step="0.5"
                  value={
                    gScaleMax ??
                    autoGAxisMax
                  }
                  onChange={(event) => {
                    const value =
                      Number(event.target.value);

                    if (Number.isFinite(value)) {
                      setGScaleMax(value);
                    }
                  }}
                  aria-label="G-force scale maximum"
                />

                <span className="datalog-scale-unit">
                  g
                </span>
              </div>
            </div>

            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                const oldA =
                  runA;

                setRunA(
                  runB
                );

                setRunB(
                  oldA
                );
              }}
            >
              Swap A/B
            </button>
          </section>

          <section className="screen-card datalog-speed-interval">
            <div className="datalog-interval-header">
              <div>
                <strong>Speed Interval</strong>
                <small>
                  Custom acceleration time
                </small>
              </div>

              <div className="datalog-interval-inputs">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={intervalStartSpeed}
                  onChange={(event) =>
                    setIntervalStartSpeed(
                      Number(event.target.value)
                    )
                  }
                  aria-label="Starting speed"
                />

                <span>to</span>

                <input
                  type="number"
                  min="0"
                  step="1"
                  value={intervalEndSpeed}
                  onChange={(event) =>
                    setIntervalEndSpeed(
                      Number(event.target.value)
                    )
                  }
                  aria-label="Ending speed"
                />

                <span>mph</span>
              </div>
            </div>

            <div className="datalog-interval-results">
              <div>
                <span>Run A</span>
                <b>
                  {runA
                    ? (() => {
                        const value =
                          speedIntervalTime(
                            runA.telemetry.points,
                            intervalStartSpeed,
                            intervalEndSpeed
                          );

                        return value !== null
                          ? `${value.toFixed(3)} s`
                          : "—";
                      })()
                    : "—"}
                </b>
              </div>

              <div>
                <span>Run B</span>
                <b>
                  {runB
                    ? (() => {
                        const value =
                          speedIntervalTime(
                            runB.telemetry.points,
                            intervalStartSpeed,
                            intervalEndSpeed
                          );

                        return value !== null
                          ? `${value.toFixed(3)} s`
                          : "—";
                      })()
                    : "—"}
                </b>
              </div>

              <div>
                <span>Difference</span>
                <b>
                  {runA && runB
                    ? (() => {
                        const timeA =
                          speedIntervalTime(
                            runA.telemetry.points,
                            intervalStartSpeed,
                            intervalEndSpeed
                          );

                        const timeB =
                          speedIntervalTime(
                            runB.telemetry.points,
                            intervalStartSpeed,
                            intervalEndSpeed
                          );

                        if (
                          timeA === null ||
                          timeB === null
                        ) {
                          return "—";
                        }

                        const difference =
                          timeB - timeA;

                        return `${difference >= 0 ? "+" : ""}${difference.toFixed(3)} s`;
                      })()
                    : "—"}
                </b>
              </div>
            </div>
          </section>

          <section className="screen-card datalog-chart-card">
            <div className="datalog-legend">
              <span>
                <i className="legend-a" />
                Run A
              </span>

              <span>
                <i className="legend-b" />
                Run B
              </span>

              <small>
                {`${cursor.toFixed(
                  3
                )} s`}
              </small>
            </div>

            <div className="datalog-plot-layout">
              <div className="datalog-y-axis datalog-g-axis">
                <span className="datalog-y-axis-title">g</span>

                {gTicks.map((tick, index) => (
                  <span
                    key={`g-gutter-${index}`}
                    className="datalog-y-tick"
                    style={{
                      top: `${(tick.y / HEIGHT) * 100}%`,
                    }}
                  >
                    {tick.value.toFixed(1)}
                  </span>
                ))}
              </div>

              <div
                className="datalog-chart"
                ref={chartRef}
              onPointerDown={
                moveCursor
              }
              onPointerMove={(
                event
              ) => {
                if (
                  event.buttons ===
                  1
                ) {
                  moveCursor(
                    event
                  );
                }
              }}
            >
              <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                preserveAspectRatio="none"
              >
                {[
                  0,
                  0.25,
                  0.5,
                  0.75,
                  1,
                ].map(
                  (value) => (
                    <line
                      key={`v${value}`}
                      x1={
                        value *
                        WIDTH
                      }
                      x2={
                        value *
                        WIDTH
                      }
                      y1="0"
                      y2={
                        HEIGHT
                      }
                      className="datalog-grid"
                    />
                  )
                )}

                {[
                  0,
                  0.25,
                  0.5,
                  0.75,
                  1,
                ].map(
                  (value) => (
                    <line
                      key={`h${value}`}
                      x1="0"
                      x2={
                        WIDTH
                      }
                      y1={
                        value *
                        HEIGHT
                      }
                      y2={
                        value *
                        HEIGHT
                      }
                      className="datalog-grid"
                    />
                  )
                )}

                {showSpeed &&
                  runA && (
                    <path
                      d={buildPath(
                        runA
                          .telemetry
                          .points,
                        "speed",
                        WIDTH,
                        HEIGHT,
                        xMax,
                        speedAxisMin,
                        speedAxisMax,
                        axis,
                        runA.telemetry.splits
                      )}
                      className="trace trace-a"
                    />
                  )}

                {showSpeed &&
                  runB && (
                    <path
                      d={buildPath(
                        runB
                          .telemetry
                          .points,
                        "speed",
                        WIDTH,
                        HEIGHT,
                        xMax,
                        speedAxisMin,
                        speedAxisMax,
                        axis,
                        runB.telemetry.splits
                      )}
                      className="trace trace-b"
                    />
                  )}

                {showG &&
                  runA && (
                    <path
                      d={buildPath(
                        runA
                          .telemetry
                          .points,
                        "g",
                        WIDTH,
                        HEIGHT,
                        xMax,
                        gAxisMin,
                        gAxisMax,
                        axis,
                        runA.telemetry.splits
                      )}
                      className="trace trace-a g-trace"
                    />
                  )}

                {showG &&
                  runB && (
                    <path
                      d={buildPath(
                        runB
                          .telemetry
                          .points,
                        "g",
                        WIDTH,
                        HEIGHT,
                        xMax,
                        gAxisMin,
                        gAxisMax,
                        axis,
                        runB.telemetry.splits
                      )}
                      className="trace trace-b g-trace"
                    />
                  )}

                {/* Track split reference markers */}
                {splitMarkers.map((marker, index) => (
                  <g
                    key={`split-${marker.run}-${marker.feet}-${index}`}
                  >
                    <line
                      x1={marker.x}
                      x2={marker.x}
                      y1="0"
                      y2={HEIGHT}
                      className={`datalog-split-marker split-${marker.run}`}
                    />

                    <text
                      x={marker.x + 6}
                      y={
                        marker.run === "B"
                          ? 31
                          : 17
                      }
                      className={`datalog-split-label split-label-${marker.run}`}
                    >
                      {marker.run === "distance"
                        ? marker.label
                        : `${marker.run} ${marker.label}`}
                    </text>
                  </g>
                ))}

                <line
                  x1={cursorX}
                  x2={cursorX}
                  y1="0"
                  y2={HEIGHT}
                  className="datalog-cursor"
                />
              </svg>
              </div>

              <div className="datalog-y-axis datalog-mph-axis">
                <span className="datalog-y-axis-title">mph</span>

                {speedTicks.map((tick, index) => (
                  <span
                    key={`mph-gutter-${index}`}
                    className="datalog-y-tick"
                    style={{
                      top: `${(tick.y / HEIGHT) * 100}%`,
                    }}
                  >
                    {Math.round(tick.value)}
                  </span>
                ))}
              </div>
            </div>

            <input
              className="datalog-scrubber"
              type="range"
              min="0"
              max={xMax}
              step={0.001}
              value={
                cursor
              }
              onChange={(
                event
              ) =>
                setCursor(
                  Number(
                    event
                      .target
                      .value
                  )
                )
              }
            />

            <div className="datalog-split-row">
              {splits.map(
                ([
                  label,
                  feet,
                ]) => (
                  <button
                    key={
                      label
                    }
                    type="button"
                    onClick={() => {
                      const source =
                        runA ??
                        runB;

                      if (
                        !source
                      ) {
                        return;
                      }

                      const splitTime =
                        officialSplitTime(
                          source,
                          feet
                        );

                      if (
                        splitTime != null
                      ) {
                        setCursor(
                          Math.min(
                            splitTime,
                            xMax
                          )
                        );
                      }
                    }}
                  >
                    {label}
                  </button>
                )
              )}
            </div>
          </section>

          <section className="datalog-readout-grid">
            <Readout
              title="Run A"
              data={a}
            />

            <Readout
              title="Run B"
              data={b}
            />

            <div className="screen-card datalog-readout delta">
              <strong>
                A − B
              </strong>

              <Metric
                label="Speed"
                value={
                  a && b
                    ? `${fmt(
                        (a.speed ??
                          0) -
                          (b.speed ??
                            0),
                        2
                      )} mph`
                    : "—"
                }
              />

              <Metric
                label="G-force"
                value={
                  a && b
                    ? `${fmt(
                        (a.g ??
                          0) -
                          (b.g ??
                            0),
                        3
                      )} g`
                    : "—"
                }
              />

              <Metric
                label="Time"
                value={
                  a && b
                    ? `${fmt(
                        a.time -
                          b.time,
                        3
                      )} s`
                    : "—"
                }
              />

              <Metric
                label="Distance"
                value={
                  a && b
                    ? `${fmt(
                        a.distance -
                          b.distance,
                        1
                      )} ft`
                    : "—"
                }
              />
            </div>
          </section>

          <section className="datalog-summary-grid">
            <Summary
              title="Run A"
              log={runA}
            />

            <Summary
              title="Run B"
              log={runB}
            />
          </section>
        </>
      )}
    </div>
  );
}
