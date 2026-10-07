import { useState, type ChangeEvent } from "react";
import { parseTelemetryFile } from "../telemetry/dragy";
import type { RunTelemetry } from "../types";
import "./RunTelemetryImporter.css";

export type RunTelemetryImportPayload = {
  telemetry: RunTelemetry;
  sixtyFoot: string;
  threeThirty: string;
  eighthEt: string;
  eighthMph: string;
};

function format(value: number | undefined, digits: number) {
  return value === undefined ? "" : value.toFixed(digits);
}

export function RunTelemetryImporter({
  currentTelemetry,
  onImported,
  onClear,
}: {
  currentTelemetry?: RunTelemetry | null;
  onImported: (payload: RunTelemetryImportPayload) => void;
  onClear?: () => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      const result = await parseTelemetryFile(file);

      if (!result.telemetry || result.telemetry.points.length < 2) {
        setMessage(result.message);
        return;
      }

      const { splits } = result.telemetry;
      onImported({
        telemetry: result.telemetry,
        sixtyFoot: format(splits.sixtyFoot, 3),
        threeThirty: format(splits.threeThirty, 3),
        eighthEt: format(splits.eighthEt, 3),
        eighthMph: format(splits.eighthMph, 1),
      });

      setMessage(
        `${result.message}: ${result.telemetry.points.length} samples loaded${
          splits.sixtyFoot !== undefined ||
          splits.threeThirty !== undefined ||
          splits.eighthEt !== undefined
            ? " and Dragy split times were filled in."
            : "."
        }`
      );
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="run-telemetry-importer">
      <div className="run-telemetry-heading">
        <div>
          <span>Dragy / telemetry</span>
          <small>
            Import a decrypted Dragy JSON/CSV or VBO. Native encrypted .dragy
            detection is included, but decryption is only enabled after the
            cipher/key handling is verified.
          </small>
        </div>

        <label className="run-import-button">
          <span>{busy ? "Reading…" : currentTelemetry ? "Replace file" : "Import Dragy"}</span>
          <input
            type="file"
            accept=".dragy,.zip,.json,.csv,.txt,.vbo,application/json,text/csv,text/plain,application/zip"
            disabled={busy}
            onChange={handleFile}
          />
        </label>
      </div>

      {currentTelemetry && (
        <div className="run-telemetry-loaded">
          <div>
            <strong>{currentTelemetry.fileName}</strong>
            <span>{currentTelemetry.points.length} normalized samples</span>
          </div>
          {onClear && (
            <button type="button" onClick={onClear}>
              Remove
            </button>
          )}
        </div>
      )}

      {message && <p className="run-telemetry-message">{message}</p>}
    </div>
  );
}
