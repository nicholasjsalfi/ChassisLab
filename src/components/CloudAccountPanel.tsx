import { useState, type FormEvent } from "react";
import type { CloudGarageState } from "../cloud/useCloudGarageSync";
import "./CloudAccountPanel.css";

export function CloudAccountPanel({ cloud }: { cloud: CloudGarageState }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function submit(event: FormEvent<HTMLFormElement>, mode: "signin" | "signup") {
    event.preventDefault();
    if (!email.trim() || !password) return;
    if (mode === "signin") {
      void cloud.signIn(email, password);
    } else {
      void cloud.signUp(email, password);
    }
  }

  if (!cloud.configured) {
    return (
      <div className="cloud-account-card">
        <strong>Cloud sync not configured</strong>
        <p>
          Local Garage storage still works. Add the Supabase project URL and
          publishable key to enable optional sign-in and cross-device sync.
        </p>
      </div>
    );
  }

  if (cloud.userEmail) {
    return (
      <div className="cloud-account-card">
        <div className="cloud-account-row">
          <div>
            <strong>{cloud.userEmail}</strong>
            <p>
              Local-first sync is active. Changes save on this device first and
              are mirrored to your Supabase Garage when online.
            </p>
          </div>
          <span className="cloud-status-dot" aria-label="Cloud connected" />
        </div>

        <div className="cloud-status-text">{cloud.status}</div>

        <div className="cloud-account-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={cloud.syncing}
            onClick={() => void cloud.syncNow()}
          >
            {cloud.syncing ? "Syncing…" : "Sync now"}
          </button>

          <button
            type="button"
            className="secondary-button"
            disabled={cloud.syncing}
            onClick={() => void cloud.signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cloud-account-card">
      <strong>Optional cloud account</strong>
      <p>
        Sign in to carry the same Garage between the website and iPhone app.
        ChassisLab continues to work locally when you are offline.
      </p>

      <form className="cloud-auth-form" onSubmit={(event) => submit(event, "signin")}>
        <label>
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label>
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            minLength={6}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <div className="cloud-account-actions">
          <button type="submit" className="primary-button" disabled={cloud.syncing}>
            Sign in
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={cloud.syncing || !email.trim() || !password}
            onClick={() => void cloud.signUp(email, password)}
          >
            Create account
          </button>
        </div>
      </form>

      <div className="cloud-status-text">{cloud.status}</div>
    </div>
  );
}
