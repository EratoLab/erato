/**
 * Audio Input Device Store
 *
 * Holds the user's preferred audio input device id. Lives in a shared store
 * so the preferences dialog and the long-lived recorder hooks in ChatInput
 * stay in sync — changing the device in settings must reach the active
 * recorder without a reload.
 */
/* eslint-disable lingui/no-unlocalized-strings */
import { create } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";

const STORE_KEY = "audio-input-device-store";
const LEGACY_LOCAL_STORAGE_KEY = "erato.audioTranscription.audioInputDeviceId";

function migrateLegacyAudioInputDeviceId() {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    if (localStorage.getItem(STORE_KEY) !== null) {
      return;
    }
    const legacy = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
    if (legacy === null) {
      return;
    }
    const trimmed = legacy.trim();
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    if (trimmed) {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          state: { selectedDeviceId: trimmed },
          version: 0,
        }),
      );
    }
  } catch {
    // Best-effort migration; absence of persistence is non-fatal.
  }
}

migrateLegacyAudioInputDeviceId();

export interface AudioInputDeviceState {
  selectedDeviceId: string;
  setSelectedDeviceId: (deviceId: string) => void;
}

export const useAudioInputDeviceStore = create<AudioInputDeviceState>()(
  devtools(
    persist(
      (set) => ({
        selectedDeviceId: "",
        setSelectedDeviceId: (deviceId) =>
          set(
            { selectedDeviceId: deviceId },
            false,
            "audioInputDevice/setSelectedDeviceId",
          ),
      }),
      {
        name: STORE_KEY,
        // Wrap localStorage in fresh methods that re-resolve the
        // global on every call. `createJSONStorage` caches the result
        // of its factory once at create time, so handing it
        // `localStorage` directly would freeze a reference that
        // `vi.stubGlobal` can't replace in tests. The closures here
        // re-look-up `localStorage` per operation, picking up the
        // stub. `createJSONStorage` still handles the JSON wrapping.
        storage: createJSONStorage(() => ({
          getItem: (key) => {
            try {
              return localStorage.getItem(key);
            } catch {
              return null;
            }
          },
          setItem: (key, value) => {
            try {
              localStorage.setItem(key, value);
            } catch {
              // Persistence is best-effort.
            }
          },
          removeItem: (key) => {
            try {
              localStorage.removeItem(key);
            } catch {
              // Persistence is best-effort.
            }
          },
        })),
        partialize: (state) => ({ selectedDeviceId: state.selectedDeviceId }),
      },
    ),
    {
      name: "Audio Input Device Store",
      store: STORE_KEY,
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);
