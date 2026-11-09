import { Router } from 'express';
import { getConfig, setConfig } from '../services/db.js';

// The phone keeps its fast first-paint copy in local storage, then mirrors the
// portable parts of that setup here so another browser can hydrate from the
// same house. This is deliberately a separate key from /api/settings: that
// endpoint is the agent's flat config KV API, while this one stores one nested
// phone-settings document.
const APP_SETTINGS_KEY = 'phone.app_settings';

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readAppSettings(): JsonObject | null {
  const raw = getConfig(APP_SETTINGS_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    // A damaged legacy value should not take the Settings screen down. Treat
    // it as an empty house copy; the next successful PUT repairs the value.
    return null;
  }
}

export function createAppSettingsRoutes(): Router {
  const router = Router();

  router.get('/app-settings', (_req, res) => {
    res.json({ settings: readAppSettings() });
  });

  router.put('/app-settings', (req, res) => {
    const settings: unknown = req.body?.settings;
    if (!isJsonObject(settings)) {
      res.status(400).json({ error: 'settings must be a JSON object' });
      return;
    }

    setConfig(APP_SETTINGS_KEY, JSON.stringify(settings));
    res.json({ settings });
  });

  return router;
}

