import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Car } from "../types";
import { cloudConfigured, supabase } from "./supabaseClient";
import { normalizeCars } from "../storage/garageData";

export type CloudGarageState = {
  configured: boolean;
  userEmail: string | null;
  syncing: boolean;
  hydrated: boolean;
  status: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
};

function cleanGarageForCloud(cars: Car[]) {
  // Run telemetry stored by ChassisLab is already normalized to time/speed/G
  // and deliberately excludes Dragy's GPS/device/account metadata.
  return cars;
}

export function useCloudGarageSync(
  cars: Car[],
  setCars: Dispatch<SetStateAction<Car[]>>
): CloudGarageState {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState(
    cloudConfigured
      ? "Cloud ready. Sign in to sync this Garage."
      : "Cloud sync is not configured yet."
  );

  const carsRef = useRef(cars);
  const skipNextPush = useRef(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    carsRef.current = cars;
  }, [cars]);

  const pushGarage = useCallback(
    async (targetUserId: string, nextCars = carsRef.current) => {
      if (!supabase) return;

      setSyncing(true);
      try {
        const { error } = await supabase.from("chassislab_garages").upsert(
          {
            user_id: targetUserId,
            garage: cleanGarageForCloud(nextCars),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

        if (error) throw error;
        setStatus(`Synced ${new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })}.`);
      } catch (error) {
        setStatus(
          error instanceof Error
            ? `Cloud sync failed: ${error.message}`
            : "Cloud sync failed."
        );
      } finally {
        setSyncing(false);
      }
    },
    []
  );

  const hydrateFromCloud = useCallback(
    async (targetUserId: string) => {
      if (!supabase) return;

      setSyncing(true);
      setHydrated(false);
      try {
        const { data, error } = await supabase
          .from("chassislab_garages")
          .select("garage, updated_at")
          .eq("user_id", targetUserId)
          .maybeSingle();

        if (error) throw error;

        if (data?.garage && Array.isArray(data.garage)) {
          skipNextPush.current = true;
          setCars(normalizeCars(data.garage));
          setStatus("Cloud Garage loaded on this device.");
        } else {
          await pushGarage(targetUserId, carsRef.current);
          setStatus("This device's Garage was uploaded to your account.");
        }

        setHydrated(true);
      } catch (error) {
        setStatus(
          error instanceof Error
            ? `Cloud load failed: ${error.message}`
            : "Cloud load failed."
        );
      } finally {
        setSyncing(false);
      }
    },
    [pushGarage, setCars]
  );

  useEffect(() => {
    if (!supabase) return;

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const user = data.session?.user ?? null;
      setUserId(user?.id ?? null);
      setUserEmail(user?.email ?? null);
      if (user) {
        void hydrateFromCloud(user.id);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setUserId(user?.id ?? null);
      setUserEmail(user?.email ?? null);

      if (user) {
        void hydrateFromCloud(user.id);
      } else {
        setHydrated(false);
        setStatus("Signed out. Garage remains saved on this device.");
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [hydrateFromCloud]);

  useEffect(() => {
    if (!userId || !hydrated || !supabase) return;

    if (skipNextPush.current) {
      skipNextPush.current = false;
      return;
    }

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      void pushGarage(userId, carsRef.current);
    }, 900);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [cars, hydrated, pushGarage, userId]);

  async function signIn(email: string, password: string) {
    if (!supabase) {
      setStatus("Add the Supabase URL and publishable key first.");
      return;
    }

    setSyncing(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSyncing(false);

    if (error) {
      setStatus(`Sign in failed: ${error.message}`);
    } else {
      setStatus("Signed in. Loading your Garage…");
    }
  }

  async function signUp(email: string, password: string) {
    if (!supabase) {
      setStatus("Add the Supabase URL and publishable key first.");
      return;
    }

    setSyncing(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setSyncing(false);

    if (error) {
      setStatus(`Account creation failed: ${error.message}`);
      return;
    }

    if (data.session) {
      setStatus("Account created. Loading cloud Garage…");
    } else {
      setStatus("Account created. Check your email if confirmation is enabled.");
    }
  }

  async function signOut() {
    if (!supabase) return;
    setSyncing(true);
    const { error } = await supabase.auth.signOut();
    setSyncing(false);
    if (error) setStatus(`Sign out failed: ${error.message}`);
  }

  async function syncNow() {
    if (!userId) {
      setStatus("Sign in before syncing.");
      return;
    }
    await pushGarage(userId, carsRef.current);
  }

  return {
    configured: cloudConfigured,
    userEmail,
    syncing,
    hydrated,
    status,
    signIn,
    signUp,
    signOut,
    syncNow,
  };
}
