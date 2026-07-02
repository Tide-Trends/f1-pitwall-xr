import { useEffect, useState } from 'react';
import { pitwallApi } from '../lib/api';
import { useAppStore } from '../store/appStore';

export interface OpenF1Weather {
  air_temperature: number;
  track_temperature: number;
  humidity: number;
  wind_speed: number;
  wind_direction: number;
  rainfall: number;
  date: string;
}

export interface OpenF1Stint {
  driver_number: number;
  stint_number: number;
  compound: string;
  lap_start: number;
  lap_end: number;
  tyre_age_at_start: number;
}

export interface OpenF1Pit {
  driver_number: number;
  lap_number: number;
  pit_duration: number;
  date: string;
}

export interface OpenF1Radio {
  driver_number: number;
  date: string;
  recording_url: string;
}

export interface OpenF1Lap {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  is_pit_out_lap: boolean;
  date_start: string;
}

export interface OpenF1Interval {
  driver_number: number;
  gap_to_leader: number | string | null;
  interval: number | string | null;
  date: string;
}

/** Session key for the active replay (undefined when live/unmatched) */
export function useSessionKey(): number | undefined {
  return useAppStore((s) => s.activeSession?.openF1SessionKey);
}

function useResource<T>(
  resource: string,
  sessionKey: number | undefined,
  refreshMs = 0,
): T[] {
  const [data, setData] = useState<T[]>([]);

  useEffect(() => {
    if (!sessionKey) {
      setData([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      pitwallApi
        .openF1<T[]>(resource, { session_key: sessionKey })
        .then((d) => {
          if (!cancelled) setData(Array.isArray(d) ? d : []);
        })
        .catch(() => {});
    load();
    if (refreshMs > 0) {
      const id = setInterval(load, refreshMs);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [resource, sessionKey, refreshMs]);

  return data;
}

export function useWeather(sessionKey: number | undefined): OpenF1Weather | null {
  const rows = useResource<OpenF1Weather>('weather', sessionKey, 60000);
  return rows.length ? rows[rows.length - 1] : null;
}

export function useStints(sessionKey: number | undefined): OpenF1Stint[] {
  return useResource<OpenF1Stint>('stints', sessionKey, 60000);
}

export function usePitStops(sessionKey: number | undefined): OpenF1Pit[] {
  return useResource<OpenF1Pit>('pit', sessionKey, 60000);
}

export function useTeamRadio(sessionKey: number | undefined): OpenF1Radio[] {
  return useResource<OpenF1Radio>('team_radio', sessionKey, 120000);
}

export function useLaps(sessionKey: number | undefined): OpenF1Lap[] {
  return useResource<OpenF1Lap>('laps', sessionKey, 60000);
}
