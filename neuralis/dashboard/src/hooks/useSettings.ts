import { useState, useCallback } from "react";

export interface AppSettings {
  theme_mode: "dark" | "light";
  accent_color: string;
  mood_sync: boolean;
}

const STORAGE_KEY = "neuralis_settings";

const DEFAULTS: AppSettings = {
  theme_mode: "dark",
  accent_color: "#a855f7",
  mood_sync: true,
};

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULTS;
}

function save(settings: AppSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(load);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  return { settings, updateSettings };
}
