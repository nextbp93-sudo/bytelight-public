import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchHealthScores,
  fetchInnerWeather,
  fetchEntities,
  fetchRecent,
  fetchSubconscious,
  fetchHeat,
  fetchPatterns,
  fetchStats,
  fetchTensions,
  fetchJournals,
  fetchThreads,
  fetchIdentity,
  fetchPersonality,
} from "../api/endpoints";
import type {
  Entity,
  HealthScores,
  InnerWeather,
  HeatResponse,
  RecentResponse,
  SubconsciousState,
  PatternsResponse,
  StatsResponse,
  TensionsResponse,
  Journal,
  Thread,
  IdentityResponse,
  PersonalityResponse,
} from "../api/types";

export interface NeuralStateData {
  healthScores: HealthScores | null;
  innerWeather: InnerWeather | null;
  entities: Entity[];
  journals: Journal[];
  recent: RecentResponse | null;
  subconscious: SubconsciousState | null;
  heat: HeatResponse | null;
  patterns: PatternsResponse | null;
  stats: StatsResponse | null;
  tensions: TensionsResponse | null;
  threads: Thread[];
  identity: IdentityResponse | null;
  personality: PersonalityResponse | null;
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
}

const POLL_INTERVAL = 15_000;

export function useNeuralState(enabled: boolean) {
  const [state, setState] = useState<NeuralStateData>({
    healthScores: null,
    innerWeather: null,
    entities: [],
    journals: [],
    recent: null,
    subconscious: null,
    heat: null,
    patterns: null,
    stats: null,
    tensions: null,
    threads: [],
    identity: null,
    personality: null,
    loading: true,
    error: null,
    lastFetched: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const results = await Promise.allSettled([
        fetchHealthScores(),
        fetchInnerWeather(),
        fetchEntities(),
        fetchRecent(),
        fetchSubconscious(),
        fetchHeat(),
        fetchPatterns(),
        fetchStats(),
        fetchTensions(),
        fetchJournals(),
        fetchThreads(),
        fetchIdentity(),
        fetchPersonality(),
      ]);

      const val = <T,>(r: PromiseSettledResult<T>): T | null =>
        r.status === "fulfilled" ? r.value : null;

      setState({
        healthScores: val(results[0]),
        innerWeather: val(results[1]),
        entities: val(results[2]) || [],
        recent: val(results[3]),
        subconscious: val(results[4]),
        heat: val(results[5]),
        patterns: val(results[6]),
        stats: val(results[7]),
        tensions: val(results[8]),
        journals: val(results[9]) || [],
        threads: val(results[10]) || [],
        identity: val(results[11]),
        personality: val(results[12]),
        loading: false,
        error: null,
        lastFetched: Date.now(),
      });
    } catch (e) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : "Unknown error",
      }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    fetchAll();
    intervalRef.current = setInterval(fetchAll, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, fetchAll]);

  return { ...state, refetch: fetchAll };
}
