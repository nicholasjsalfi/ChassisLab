import JSZip from "jszip";
import type {
  DragyPoint,
  RunTelemetry,
  TelemetrySplits,
} from "../types";

export type TelemetryFileResult = {
  points: DragyPoint[];
  telemetry: RunTelemetry | null;
  message: string;
  needsConversion: boolean;
};

function numeric(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.+-]/g, ""));
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function normalizeTelemetryTime(points: DragyPoint[]) {
  if (points.length < 2) return points;

  const sorted = [...points].sort((a, b) => a.time - b.time);
  const deltas = sorted
    .slice(1)
    .map((point, index) => point.time - sorted[index].time)
    .filter((delta) => Number.isFinite(delta) && delta > 0)
    .sort((a, b) => a - b);

  const medianDelta =
    deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : 0;

  let timeScale = 1;
  if (medianDelta >= 10000) {
    timeScale = 0.000001;
  } else if (medianDelta >= 5) {
    timeScale = 0.001;
  }

  const firstTime = sorted[0].time;
  return sorted.map((point) => ({
    ...point,
    time: (point.time - firstTime) * timeScale,
  }));
}

export function deriveGFromSpeed(points: DragyPoint[]) {
  if (points.length < 3 || !points.some((point) => point.speed !== null)) {
    return points;
  }

  return points.map((point, index) => {
    if (point.g !== null && Number.isFinite(point.g)) return point;

    const leftIndex = Math.max(0, index - 3);
    const rightIndex = Math.min(points.length - 1, index + 3);
    const left = points[leftIndex];
    const right = points[rightIndex];

    if (
      leftIndex === rightIndex ||
      left.speed === null ||
      right.speed === null
    ) {
      return point;
    }

    const dt = right.time - left.time;
    if (dt <= 0) return point;

    const mphPerSecond = (right.speed - left.speed) / dt;
    return {
      ...point,
      // 1 mph/s = 0.04556 g.
      g: mphPerSecond * 0.04556,
    };
  });
}

export function finalizeTelemetry(points: DragyPoint[]) {
  return deriveGFromSpeed(normalizeTelemetryTime(points));
}

function buildTelemetry(
  source: RunTelemetry["source"],
  fileName: string,
  points: DragyPoint[],
  splits: TelemetrySplits = {}
): RunTelemetry {
  return {
    source,
    fileName,
    importedAt: new Date().toISOString(),
    points: finalizeTelemetry(points),
    splits,
  };
}

function parseNativeDragyJson(
  parsed: unknown,
  fileName: string
): RunTelemetry | null {
  if (!parsed || typeof parsed !== "object") return null;

  const root = parsed as Record<string, unknown>;
  const dataInfo = root.dataInfo ?? root.datainfo;
  if (!dataInfo || typeof dataInfo !== "object") return null;

  const info = dataInfo as Record<string, unknown>;
  const dataArr = info.dataArr;
  if (!Array.isArray(dataArr) || dataArr.length < 2) return null;

  const points: DragyPoint[] = [];

  for (const raw of dataArr) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;

    const time = numeric(row.time);
    const speedKmh = numeric(row.speed);
    const accelerationG = numeric(
      row.avgAcceleraion ?? row.avgAcceleration ?? row.acceleration ?? row.g
    );

    if (!Number.isFinite(time)) continue;

    points.push({
      time,
      // Native Dragy JSON stores this generic speed field in km/h even when
      // the UI/export is configured for miles. Normalize the app to mph.
      speed: Number.isFinite(speedKmh) ? speedKmh * 0.621371 : null,
      g: Number.isFinite(accelerationG) ? accelerationG : null,
    });
  }

  if (points.length < 2) return null;

  const splits: TelemetrySplits = {};
  const dataDetails = info.dataDetails;

  if (Array.isArray(dataDetails)) {
    for (const raw of dataDetails) {
      if (!raw || typeof raw !== "object") continue;
      const detail = raw as Record<string, unknown>;
      const name = String(detail.name ?? "").toLowerCase().replace(/\s+/g, "");
      const time = numeric(detail.time);
      const speedKmh = numeric(detail.speed);

      if (name === "60ft" && Number.isFinite(time)) {
        splits.sixtyFoot = time;
      } else if (name === "330ft" && Number.isFinite(time)) {
        splits.threeThirty = time;
      } else if ((name === "1/8" || name === "1/8mile") && Number.isFinite(time)) {
        splits.eighthEt = time;
        if (Number.isFinite(speedKmh)) {
          splits.eighthMph = speedKmh * 0.621371;
        }
      }
    }
  }

  if (splits.eighthMph === undefined) {
    const endSpeedKmh = numeric(root.endSpeed);
    if (Number.isFinite(endSpeedKmh)) {
      splits.eighthMph = endSpeedKmh * 0.621371;
    }
  }

  return buildTelemetry("dragy-json", fileName, points, splits);
}

export function parseDragyCsv(text: string): DragyPoint[] {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length < 2) return [];

  const delimiter = rows[0].includes("\t")
    ? "\t"
    : rows[0].includes(";")
      ? ";"
      : ",";

  const split = (row: string) =>
    row
      .split(delimiter)
      .map((value) => value.trim().replace(/^"|"$/g, ""));

  const headers = split(rows[0]).map((value) => value.toLowerCase());
  const findHeader = (tests: RegExp[]) =>
    headers.findIndex((header) => tests.some((test) => test.test(header)));

  const timeIndex = findHeader([
    /^time$/,
    /elapsed.*time/,
    /seconds?/,
    /timestamp/,
  ]);

  let speedIndex = findHeader([/^speed\s*\(mph\)$/i, /\bmph\b/]);
  let speedIsKmh = false;

  if (speedIndex < 0) {
    speedIndex = findHeader([/km\/?h/, /kmph/, /kph/]);
    speedIsKmh = speedIndex >= 0;
  }

  if (speedIndex < 0) {
    speedIndex = findHeader([/^speed$/, /^velocity$/, /ground.*speed/]);
  }

  const gIndex = findHeader([
    /^g$/,
    /long.*g/,
    /accel.*g/,
    /g.?force/,
    /^acceleration$/,
  ]);

  if (timeIndex < 0) return [];

  const points: DragyPoint[] = [];

  for (const row of rows.slice(1)) {
    const values = split(row);
    const time = numeric(values[timeIndex]);
    if (!Number.isFinite(time)) continue;

    let speedValue = speedIndex >= 0 ? numeric(values[speedIndex]) : NaN;
    let gValue = gIndex >= 0 ? numeric(values[gIndex]) : NaN;

    if (Number.isFinite(speedValue) && speedIsKmh) {
      speedValue *= 0.621371;
    }

    const gHeader = gIndex >= 0 ? headers[gIndex] : "";
    if (Number.isFinite(gValue) && /m\/?s(?:\^?2|²)/.test(gHeader)) {
      gValue /= 9.80665;
    }

    points.push({
      time,
      speed: Number.isFinite(speedValue) ? speedValue : null,
      g: Number.isFinite(gValue) ? gValue : null,
    });
  }

  return finalizeTelemetry(points);
}

export function parseTelemetryJson(text: string, fileName = "telemetry.json") {
  try {
    const parsed = JSON.parse(text) as unknown;

    const nativeDragy = parseNativeDragyJson(parsed, fileName);
    if (nativeDragy) return nativeDragy;

    const candidates: unknown[] = [];

    const collect = (value: unknown, depth = 0) => {
      if (depth > 5 || value === null || value === undefined) return;
      if (Array.isArray(value)) {
        if (
          value.length > 1 &&
          value.every((item) => typeof item === "object" && item !== null)
        ) {
          candidates.push(value);
        }
        value.forEach((item) => collect(item, depth + 1));
      } else if (typeof value === "object") {
        Object.values(value as Record<string, unknown>).forEach((item) =>
          collect(item, depth + 1)
        );
      }
    };

    collect(parsed);

    for (const candidate of candidates) {
      const rows = candidate as Record<string, unknown>[];
      const points: DragyPoint[] = [];

      for (const row of rows) {
        const entries = Object.entries(row);
        const findEntry = (tests: RegExp[]) =>
          entries.find(([key]) =>
            tests.some((test) => test.test(key.toLowerCase()))
          );

        const timeEntry = findEntry([
          /^time$/,
          /elapsed.*time/,
          /seconds?/,
          /timestamp/,
        ]);
        const time = numeric(timeEntry?.[1]);
        if (!Number.isFinite(time)) continue;

        let speedEntry = findEntry([/\bmph\b/]);
        let speedIsKmh = false;

        if (!speedEntry) {
          speedEntry = findEntry([/km\/?h/, /kmph/, /kph/]);
          speedIsKmh = Boolean(speedEntry);
        }

        if (!speedEntry) {
          speedEntry = findEntry([/^speed$/, /^velocity$/, /ground.*speed/]);
        }

        const gEntry = findEntry([
          /^g$/,
          /long.*g/,
          /accel.*g/,
          /g.?force/,
          /^acceleration$/,
        ]);

        let speedValue = numeric(speedEntry?.[1]);
        let gValue = numeric(gEntry?.[1]);

        if (Number.isFinite(speedValue) && speedIsKmh) {
          speedValue *= 0.621371;
        }

        const gKey = gEntry?.[0]?.toLowerCase() ?? "";
        if (Number.isFinite(gValue) && /m\/?s(?:\^?2|²)/.test(gKey)) {
          gValue /= 9.80665;
        }

        points.push({
          time,
          speed: Number.isFinite(speedValue) ? speedValue : null,
          g: Number.isFinite(gValue) ? gValue : null,
        });
      }

      if (points.length >= 2) {
        return buildTelemetry("json", fileName, points);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function parseVboTime(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const valueNumber = Number(cleaned);
  if (!Number.isFinite(valueNumber)) return NaN;

  if (valueNumber >= 10000) {
    const whole = Math.floor(valueNumber);
    const hours = Math.floor(whole / 10000);
    const minutes = Math.floor((whole % 10000) / 100);
    const seconds = valueNumber - hours * 10000 - minutes * 100;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return valueNumber;
}

export function parseVbo(text: string): DragyPoint[] {
  const rows = text.split(/\r?\n/).map((row) => row.trim());
  const columnMarker = rows.findIndex((row) => /^\[column names\]$/i.test(row));
  const dataMarker = rows.findIndex((row) => /^\[data\]$/i.test(row));

  if (columnMarker < 0 || dataMarker < 0 || dataMarker <= columnMarker) {
    return [];
  }

  const headerRow = rows
    .slice(columnMarker + 1, dataMarker)
    .find((row) => row && !row.startsWith("["));

  if (!headerRow) return [];

  const headers = headerRow.split(/\s+/).map((value) => value.toLowerCase());
  const findHeader = (tests: RegExp[]) =>
    headers.findIndex((header) => tests.some((test) => test.test(header)));

  const timeIndex = findHeader([/^time$/, /elapsed/]);
  const speedIndex = findHeader([/velocity/, /speed/, /mph/, /kmh/, /km\/h/]);
  const gIndex = findHeader([/long.*g/, /accel.*g/, /^g$/]);

  if (timeIndex < 0 || speedIndex < 0) return [];

  const speedHeader = headers[speedIndex] ?? "";
  const points: DragyPoint[] = [];

  for (const row of rows.slice(dataMarker + 1)) {
    if (!row || row.startsWith("[")) continue;
    const values = row.split(/\s+/);
    if (values.length <= Math.max(timeIndex, speedIndex)) continue;

    const time = parseVboTime(values[timeIndex]);
    let speed = Number(values[speedIndex]);
    const g = gIndex >= 0 ? Number(values[gIndex]) : NaN;

    if (!Number.isFinite(time) || !Number.isFinite(speed)) continue;
    if (!/mph/.test(speedHeader)) speed *= 0.621371;

    points.push({
      time,
      speed,
      g: Number.isFinite(g) ? g : null,
    });
  }

  return finalizeTelemetry(points);
}

function looksEncrypted(bytes: Uint8Array) {
  if (bytes.length < 64) return false;

  let printable = 0;
  const sampleLength = Math.min(bytes.length, 4096);
  for (let index = 0; index < sampleLength; index++) {
    const byte = bytes[index];
    if (
      byte === 9 ||
      byte === 10 ||
      byte === 13 ||
      (byte >= 32 && byte <= 126)
    ) {
      printable += 1;
    }
  }

  return printable / sampleLength < 0.35 && bytes.length % 16 === 0;
}

const DRAGY_KEY = new Uint8Array([0x69,0x32,0x46,0x6c,0x65,0x5a,0x6e,0x64,0,0,0,0,0,0,0,0]);
const DRAGY_IV = new Uint8Array([0x69,0x33,0x65,0x76,0x38,0x6c,0x65,0x6e,0,0,0,0,0,0,0,0]);

async function tryDecryptNativeDragy(bytes: Uint8Array): Promise<string | null> {
  try {
    console.log("[Dragy] encrypted bytes:", bytes.length);
    console.log("[Dragy] crypto.subtle available:", Boolean(globalThis.crypto?.subtle));

    const key = await crypto.subtle.importKey(
      "raw",
      DRAGY_KEY,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );

    console.log("[Dragy] AES key imported");

    const decryptBytes = Uint8Array.from(bytes);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-CBC",
        iv: Uint8Array.from(DRAGY_IV),
      },
      key,
      decryptBytes.buffer
    );

    console.log("[Dragy] decrypted bytes:", decrypted.byteLength);

    const decoded = new TextDecoder().decode(decrypted);

    console.log("[Dragy] decrypted preview:", decoded.slice(0, 300));

    try {
      const parsed = JSON.parse(decoded);
      console.log("[Dragy] JSON parsed successfully");
      console.log("[Dragy] top-level keys:", Object.keys(parsed ?? {}));
    } catch (jsonError) {
      console.error("[Dragy] JSON parse failed:", jsonError);
    }

    return decoded;
  } catch (error) {
    console.error("[Dragy] DECRYPTION FAILED:", error);
    return null;
  }
}

function normalizeDecryptedDragyText(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) return JSON.stringify(parsed[0]);
  } catch {
    // Let the normal parser report the failure.
  }
  return text;
}

export async function parseTelemetryFile(file: File): Promise<TelemetryFileResult> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder().decode(bytes);
  const looksLikeZip =
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (extension === "json") {
    let telemetry = parseTelemetryJson(text, file.name);
    if (!telemetry && looksEncrypted(bytes)) {
      const decryptedText = await tryDecryptNativeDragy(bytes);
      if (decryptedText) {
        telemetry = parseTelemetryJson(normalizeDecryptedDragyText(decryptedText), file.name);
        if (telemetry) telemetry.source = "dragy-encrypted";
      }
    }
    return {
      points: telemetry?.points ?? [],
      telemetry,
      message: telemetry
        ? `${telemetry.source === "dragy-encrypted" ? "Encrypted Dragy" : telemetry.source === "dragy-json" ? "Dragy JSON" : "JSON"} telemetry`
        : "No usable telemetry found in this JSON file.",
      needsConversion: false,
    };
  }

  if (extension === "vbo") {
    const points = parseVbo(text);
    const telemetry =
      points.length >= 2 ? buildTelemetry("vbo", file.name, points) : null;
    return {
      points: telemetry?.points ?? [],
      telemetry,
      message: telemetry ? "VBO telemetry" : "No usable telemetry found in this VBO file.",
      needsConversion: false,
    };
  }

  if (extension === "dragy") {
    const readableJson = parseTelemetryJson(text, file.name);
    if (readableJson) {
      return {
        points: readableJson.points,
        telemetry: { ...readableJson, source: "dragy-readable" },
        message: "Readable Dragy telemetry",
        needsConversion: false,
      };
    }

    const csvPoints = parseDragyCsv(text);
    if (csvPoints.length >= 2) {
      const telemetry = buildTelemetry("dragy-csv", file.name, csvPoints);
      return {
        points: telemetry.points,
        telemetry,
        message: "Readable Dragy telemetry",
        needsConversion: false,
      };
    }

    if (bytes.length >= 16 && bytes.length % 16 === 0) {
      const decryptedText = await tryDecryptNativeDragy(bytes);

      if (!decryptedText) {
        return {
          points: [],
          telemetry: null,
          message: `DRAGY DEBUG: AES decryption FAILED. Encrypted file size: ${bytes.length} bytes.`,
          needsConversion: false,
        };
      }

      const preview = decryptedText.slice(0, 120).replace(/\s+/g, " ");

      let jsonValid = false;
      let topKeys = "";
      try {
        const debugParsed = JSON.parse(decryptedText);
        jsonValid = true;
        topKeys =
          debugParsed && typeof debugParsed === "object"
            ? Object.keys(debugParsed).slice(0, 12).join(", ")
            : "";
      } catch {
        jsonValid = false;
      }

      const normalized = normalizeDecryptedDragyText(decryptedText);
      const telemetry = parseTelemetryJson(normalized, file.name);

      if (telemetry) {
        telemetry.source = "dragy-encrypted";
        return {
          points: telemetry.points,
          telemetry,
          message: `SUCCESS: Dragy decrypted and parsed — ${telemetry.points.length} telemetry points.`,
          needsConversion: false,
        };
      }

      return {
        points: [],
        telemetry: null,
        message:
          `DRAGY DEBUG: AES SUCCESS, parser FAILED. ` +
          `JSON valid: ${jsonValid}. ` +
          `Top keys: ${topKeys || "(none)"}. ` +
          `Preview: ${preview}`,
        needsConversion: false,
      };
    }

    return {
      points: [],
      telemetry: null,
      message:
        `DRAGY DEBUG: File was NOT recognized as encrypted. Size: ${bytes.length} bytes. Mod16: ${bytes.length % 16}.`,
      needsConversion: false,
    };
  }

  if (extension === "zip" || looksLikeZip) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const entry = Object.values(zip.files).find((candidate) => !candidate.dir && /\.(dragy|json)$/i.test(candidate.name));
      if (!entry) throw new Error("No Dragy payload found");
      const payload = await entry.async("uint8array");
      const payloadName = entry.name.split("/").pop() || entry.name;
      const payloadBytes = Uint8Array.from(payload);
      const payloadFile = new File([payloadBytes.buffer], payloadName, { type: "application/octet-stream" });
      const result = await parseTelemetryFile(payloadFile);
      return result.telemetry ? { ...result, message: `Dragy ZIP → ${result.message}` } : result;
    } catch {
      return { points: [], telemetry: null, message: "The ZIP did not contain a readable Dragy .dragy/.json payload.", needsConversion: false };
    }
  }

  const csvPoints = parseDragyCsv(text);
  if (csvPoints.length >= 2) {
    const telemetry = buildTelemetry("csv", file.name, csvPoints);
    return {
      points: telemetry.points,
      telemetry,
      message: "CSV telemetry",
      needsConversion: false,
    };
  }

  const jsonTelemetry = parseTelemetryJson(text, file.name);
  if (jsonTelemetry) {
    return {
      points: jsonTelemetry.points,
      telemetry: jsonTelemetry,
      message: "JSON telemetry",
      needsConversion: false,
    };
  }

  return {
    points: [],
    telemetry: null,
    message:
      "No usable time/speed/G data was found. Dragy JSON/CSV should include time plus speed and/or acceleration.",
    needsConversion: false,
  };
}

export function interpolateDragy(points: DragyPoint[], time: number) {
  if (points.length === 0) return null;
  if (time <= points[0].time) return points[0];
  if (time >= points[points.length - 1].time) return points[points.length - 1];

  let low = 0;
  let high = points.length - 1;

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].time <= time) {
      low = middle;
    } else {
      high = middle;
    }
  }

  const a = points[low];
  const b = points[high];
  const span = b.time - a.time;
  const ratio = span > 0 ? (time - a.time) / span : 0;

  const interpolateMaybe = (first: number | null, second: number | null) => {
    if (first === null && second === null) return null;
    if (first === null) return second;
    if (second === null) return first;
    return first + (second - first) * ratio;
  };

  return {
    time,
    speed: interpolateMaybe(a.speed, b.speed),
    g: interpolateMaybe(a.g, b.g),
  } satisfies DragyPoint;
}

export function formatTelemetrySplits(splits: TelemetrySplits) {
  return {
    sixtyFoot:
      splits.sixtyFoot !== undefined ? round(splits.sixtyFoot, 3).toFixed(3) : "",
    threeThirty:
      splits.threeThirty !== undefined ? round(splits.threeThirty, 3).toFixed(3) : "",
    eighthEt:
      splits.eighthEt !== undefined ? round(splits.eighthEt, 3).toFixed(3) : "",
    eighthMph:
      splits.eighthMph !== undefined ? round(splits.eighthMph, 1).toFixed(1) : "",
  };
}
