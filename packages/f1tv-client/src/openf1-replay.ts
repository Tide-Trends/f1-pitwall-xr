import type { DriverPosition, DriverTiming, RaceControlMessage, TelemetrySnapshot } from '@pitwall/shared';

const OPENF1_BASE = 'https://api.openf1.org/v1';

export interface OpenF1Session {
  session_key: number;
  session_name: string;
  session_type: string;
  meeting_key: number;
  circuit_short_name: string;
  country_name: string;
  date_start: string;
  year: number;
}

export interface ReplayTelemetryOptions {
  sessionKey: number;
  /** Video currentTime in seconds from session start */
  videoTimeSec: number;
  /** F1 TV replay start time, used when OpenF1 session metadata is rate-limited */
  sessionStartDate?: string | number;
}

/** Fetch OpenF1 sessions for a year — used to match replay content to telemetry */
export async function getOpenF1Sessions(year?: number): Promise<OpenF1Session[]> {
  const y = year ?? new Date().getFullYear();
  const res = await fetch(`${OPENF1_BASE}/sessions?year=${y}`);
  if (!res.ok) throw new Error(`OpenF1 sessions failed: ${res.status}`);
  return res.json() as Promise<OpenF1Session[]>;
}

/** Find OpenF1 session_key from F1 meeting/session metadata */
export async function matchOpenF1Session(
  meetingKey: string,
  sessionName: string,
  year?: number,
): Promise<number | undefined> {
  const sessions = await fetchOpenF1<OpenF1Session[]>(`sessions?meeting_key=${encodeURIComponent(meetingKey)}`)
    .catch(() => getOpenF1Sessions(year))
    .catch(() => []);
  const name = sessionName.toLowerCase();

  const match = sessions.find((s) => {
    if (String(s.meeting_key) !== meetingKey) return false;
    const sn = s.session_name.toLowerCase();
    if ((name.includes('race') || name.includes('grand prix')) && sn.includes('race') && !sn.includes('sprint')) return true;
    if (name.includes('sprint') && sn.includes('sprint')) return true;
    if (name.includes('qualif') && sn.includes('qualifying')) return true;
    if (name.includes('practice') && sn.includes('practice')) return true;
    return sn === name;
  });

  return match?.session_key;
}

/** Get telemetry snapshot at a specific replay timestamp */
export async function getReplayTelemetrySnapshot(
  options: ReplayTelemetryOptions,
): Promise<TelemetrySnapshot> {
  const { sessionKey, videoTimeSec, sessionStartDate } = options;
  const windowSec = 6;
  const session = await fetchOpenF1<OpenF1Session[]>(`sessions?session_key=${sessionKey}`)
    .then((rows) => rows[0])
    .catch(() => undefined);
  const sessionStartMs = session?.date_start
    ? new Date(session.date_start).getTime()
    : parseStartDate(sessionStartDate);
  const targetMs = Number.isFinite(sessionStartMs)
    ? sessionStartMs + videoTimeSec * 1000
    : Date.now();
  const posStart = new Date(targetMs - windowSec * 1000).toISOString();
  const posEnd = new Date(targetMs + windowSec * 1000).toISOString();

  const [positions, drivers, laps, intervals, rc] = await Promise.all([
    fetchOpenF1<Record<string, unknown>[]>(
      `location?session_key=${sessionKey}&date>=${encodeURIComponent(posStart)}&date<=${encodeURIComponent(posEnd)}`,
    ).catch(() => []),
    fetchOpenF1<Record<string, unknown>[]>(`drivers?session_key=${sessionKey}`).catch(() => []),
    fetchOpenF1<Record<string, unknown>[]>(`laps?session_key=${sessionKey}`).catch(() => []),
    fetchOpenF1<Record<string, unknown>[]>(
      `intervals?session_key=${sessionKey}&date>=${encodeURIComponent(posStart)}&date<=${encodeURIComponent(posEnd)}`,
    ).catch(() => []),
    fetchOpenF1<Record<string, unknown>[]>(
      `race_control?session_key=${sessionKey}`,
    ).catch(() => []),
  ]);

  const driverMap = new Map<number, Record<string, unknown>>();
  for (const d of drivers) {
    driverMap.set(Number(d.driver_number), d);
  }

  const posAtTime = filterNearest(positions, targetMs, windowSec * 1000);

  const timing = buildTimingFromLaps(laps, driverMap, targetMs);
  const fallbackTiming =
    timing.length > 0 ? timing : buildTimingFallback(posAtTime, intervals, driverMap, targetMs);

  return {
    sessionPath: String(sessionKey),
    positions: posAtTime.map((p) => ({
      racingNumber: p.driver_number as number,
      x: p.x as number,
      y: p.y as number,
      z: (p.z as number) ?? 0,
      timestamp: String(p.date),
    })),
    timing: fallbackTiming,
    raceControl: rc.slice(-20).map((m) => ({
      time: String(m.date ?? ''),
      message: String(m.message ?? ''),
      category: String(m.category ?? ''),
      flag: mapFlag(String(m.flag ?? '')),
    })),
    timestamp: targetMs,
  };
}

function buildTimingFallback(
  positions: Record<string, unknown>[],
  intervals: Record<string, unknown>[],
  drivers: Map<number, Record<string, unknown>>,
  targetMs: number,
): DriverTiming[] {
  const latestInterval = new Map<number, Record<string, unknown>>();
  for (const row of intervals) {
    const num = Number(row.driver_number);
    const t = new Date(String(row.date)).getTime();
    if (t > targetMs) continue;
    const prev = latestInterval.get(num);
    if (!prev || t > new Date(String(prev.date)).getTime()) latestInterval.set(num, row);
  }

  const nums = new Set<number>();
  for (const p of positions) nums.add(Number(p.driver_number));
  for (const num of drivers.keys()) nums.add(num);

  return Array.from(nums)
    .sort((a, b) => a - b)
    .map((num, index) => {
      const driver = drivers.get(num);
      const interval = latestInterval.get(num);
      return {
        racingNumber: num,
        position: Number(interval?.position ?? index + 1),
        gapToLeader: interval?.gap_to_leader == null ? undefined : String(interval.gap_to_leader),
        interval: interval?.interval == null ? undefined : String(interval.interval),
        name: String(driver?.full_name ?? `#${num}`),
        tla: String(driver?.name_acronym ?? `${num}`),
        teamColor: String(driver?.team_colour ?? 'ffffff'),
      };
    })
    .sort((a, b) => a.position - b.position);
}

async function fetchOpenF1<T>(path: string): Promise<T> {
  const cached = openF1Cache.get(path);
  if (cached && cached.expires > Date.now()) return cached.value as T;

  const pending = openF1Pending.get(path);
  if (pending) return pending as Promise<T>;

  const request = fetch(`${OPENF1_BASE}/${path}`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`OpenF1 ${path}: ${res.status}`);
      const value = await res.json() as T;
      openF1Cache.set(path, { value, expires: Date.now() + cacheTtlFor(path) });
      return value;
    })
    .catch((err) => {
      const stale = openF1Cache.get(path);
      if (stale) return stale.value as T;
      throw err;
    })
    .finally(() => {
      openF1Pending.delete(path);
    });

  openF1Pending.set(path, request);
  return request;
}

const openF1Cache = new Map<string, { value: unknown; expires: number }>();
const openF1Pending = new Map<string, Promise<unknown>>();

function cacheTtlFor(path: string): number {
  if (path.startsWith('sessions') || path.startsWith('drivers')) return 24 * 60 * 60 * 1000;
  if (path.startsWith('laps') || path.startsWith('race_control')) return 10 * 60 * 1000;
  return 30 * 1000;
}

function parseStartDate(value: string | number | undefined): number {
  if (value == null || value === '') return NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return new Date(value).getTime();
}

function filterNearest(
  rows: Record<string, unknown>[],
  targetMs: number,
  windowMs: number,
): Record<string, unknown>[] {
  const byDriver = new Map<number, Record<string, unknown>>();

  for (const row of rows) {
    const num = row.driver_number as number;
    const t = new Date(String(row.date)).getTime();
    if (Math.abs(t - targetMs) > windowMs) continue;

    const prev = byDriver.get(num);
    if (!prev || Math.abs(t - targetMs) < Math.abs(new Date(String(prev.date)).getTime() - targetMs)) {
      byDriver.set(num, row);
    }
  }

  return Array.from(byDriver.values());
}

function buildTimingFromLaps(
  laps: Record<string, unknown>[],
  drivers: Map<number, Record<string, unknown>>,
  targetMs: number,
): DriverTiming[] {
  const latestLap = new Map<number, Record<string, unknown>>();

  for (const lap of laps) {
    const num = Number(lap.driver_number);
    const t = new Date(String(lap.date_start ?? lap.date)).getTime();
    if (t > targetMs) continue;
    const prev = latestLap.get(num);
    if (!prev || t > new Date(String(prev.date_start ?? prev.date)).getTime()) {
      latestLap.set(num, lap);
    }
  }

  const sorted = Array.from(latestLap.entries())
    .map(([num, lap]) => ({
      num,
      lap,
      driver: drivers.get(num),
    }))
    .sort((a, b) => (a.lap.lap_number as number) - (b.lap.lap_number as number));

  return sorted.map((entry, i) => ({
    racingNumber: entry.num,
    position: i + 1,
    lastLapTime: entry.lap.lap_duration ? formatLap(entry.lap.lap_duration as number) : undefined,
    compound: String(entry.lap.compound ?? ''),
    name: String(entry.driver?.full_name ?? `#${entry.num}`),
    tla: String(entry.driver?.name_acronym ?? `${entry.num}`),
    teamColor: String(entry.driver?.team_colour ?? 'ffffff'),
  }));
}

function formatLap(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3);
  return `${m}:${s.padStart(6, '0')}`;
}

function mapFlag(flag: string): RaceControlMessage['flag'] | undefined {
  const f = flag.toUpperCase();
  if (f.includes('GREEN')) return 'GREEN';
  if (f.includes('YELLOW')) return 'YELLOW';
  if (f.includes('RED')) return 'RED';
  if (f.includes('VSC')) return 'VSC';
  if (f.includes('SC')) return 'SC';
  if (f.includes('CHEQUERED')) return 'CHEQUERED';
  return undefined;
}
