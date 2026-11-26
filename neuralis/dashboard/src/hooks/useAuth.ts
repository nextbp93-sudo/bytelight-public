import { useState, useCallback } from "react";
import { hasApiKey, setApiKey, clearApiKey, testConnection } from "../api/client";

export function useAuth() {
  const [authenticated, setAuthenticated] = useState(hasApiKey());
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const login = useCallback(async (key: string) => {
    setTesting(true);
    setError(null);
    setApiKey(key);

    const ok = await testConnection();
    if (ok) {
      setAuthenticated(true);
    } else {
      clearApiKey();
      setError("Invalid API key or backend unreachable");
    }
    setTesting(false);
  }, []);

  const logout = useCallback(() => {
    clearApiKey();
    setAuthenticated(false);
  }, []);

  return { authenticated, error, testing, login, logout };
}
