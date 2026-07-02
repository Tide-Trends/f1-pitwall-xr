export type StreamIdentifier = 'PRES' | 'WIF' | 'TRACKER' | 'DATA' | 'OBC' | 'PITLANE' | 'INTERNATIONAL';

export interface StreamChannel {
  contentId: number;
  channelId?: number;
  title: string;
  identifier?: StreamIdentifier;
  type?: 'additional' | 'obc' | 'main';
  racingNumber?: number;
  driverFirstName?: string;
  driverLastName?: string;
  teamName?: string;
  hex?: string;
}

export type SessionKind = 'live' | 'replay' | 'upcoming';

export interface RaceMeeting {
  meetingKey: string;
  meetingName: string;
  circuitShortName: string;
  country: string;
  season: number;
  sessions: RaceSessionSummary[];
}

export interface RaceSessionSummary {
  contentId: number;
  title: string;
  meetingKey: string;
  sessionKey?: string;
  circuitShortName: string;
  series: string;
  kind: SessionKind;
  sessionType?: 'Race' | 'Qualifying' | 'Sprint' | 'Practice' | 'Other';
  startDate?: number;
  duration?: number;
  thumbnailUrl?: string;
}

export interface SeasonSessionTime {
  name: string;
  startTime: number;
}

export interface SeasonEventSummary {
  round: number;
  raceName: string;
  circuitName: string;
  locality: string;
  country: string;
  startTime: number;
  sessions: SeasonSessionTime[];
}

export interface SeasonStanding {
  position: number;
  code: string;
  driverName: string;
  constructorName: string;
  points: number;
  wins: number;
}

export interface SeasonContext {
  season: number;
  updatedAt: number;
  nextEvents: SeasonEventSummary[];
  driverStandings: SeasonStanding[];
  contextNotes: string[];
}

export interface LiveSession extends RaceSessionSummary {
  state: SessionKind;
  isLive: boolean;
  channels: StreamChannel[];
}

/** Active viewing session — live or replay */
export interface ViewingSession extends RaceSessionSummary {
  isLive: boolean;
  channels: StreamChannel[];
  /** OpenF1 session_key for replay telemetry sync */
  openF1SessionKey?: number;
}

export interface PlaybackBundle {
  manifestUrl: string;
  licenseUrl?: string;
  streamType: 'DASH' | 'DASHWV' | 'HLS';
  playToken?: string;
  contentId: number;
  channelId?: number;
  licenseAscendonToken: string;
  licenseEntitlementToken: string;
}

export interface AuthTokens {
  subscriptionToken: string;
  entitlementToken: string;
  entitlement: string;
  groupId: number;
  /** Imperva / session cookies from browser login */
  cookieHeader?: string;
}

export interface PanelLayout {
  id: string;
  streamKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  pinnedToDriver?: number;
  muted: boolean;
  volume: number;
  targetLatencyOffset: number;
  /** Lock 16:9 aspect ratio while resizing */
  aspectLock?: boolean;
}

export interface SpatialPanelLayout extends PanelLayout {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface LayoutPreset {
  id: string;
  name: string;
  mode: 'desktop' | 'spatial' | 'vr';
  panels: PanelLayout[] | SpatialPanelLayout[];
  createdAt: number;
  updatedAt: number;
}

export interface SyncConfig {
  masterPanelId: string;
  broadcastDelayMs: number;
  globalTargetLatency: number;
  autoDriftCorrection: boolean;
  maxDriftThresholdSec: number;
}

export interface DriverPosition {
  racingNumber: number;
  x: number;
  y: number;
  z: number;
  timestamp: string;
}

export interface DriverTiming {
  racingNumber: number;
  position: number;
  gapToLeader?: string;
  interval?: string;
  lastLapTime?: string;
  compound?: string;
  stintAge?: number;
  inPit?: boolean;
  drs?: boolean;
  teamColor?: string;
  name: string;
  tla: string;
}

export interface RaceControlMessage {
  time: string;
  message: string;
  category: string;
  flag?: 'GREEN' | 'YELLOW' | 'RED' | 'SC' | 'VSC' | 'CHEQUERED';
}

export interface TelemetrySnapshot {
  sessionPath?: string;
  circuitId?: string;
  trackStatus?: string;
  weather?: Record<string, unknown>;
  positions: DriverPosition[];
  timing: DriverTiming[];
  raceControl: RaceControlMessage[];
  timestamp: number;
}

export interface StreamPanelState {
  id: string;
  streamKey: string;
  title: string;
  isPlaying: boolean;
  currentTime: number;
  bufferDepth: number;
  latencyOffset: number;
  droppedFrames: number;
  audioFocused: boolean;
}

export const DEFAULT_SYNC: SyncConfig = {
  masterPanelId: 'main',
  broadcastDelayMs: 25000,
  globalTargetLatency: 5,
  autoDriftCorrection: true,
  maxDriftThresholdSec: 0.5,
};

/** Replay/VOD: no broadcast delay — all panels seek to master currentTime */
export const REPLAY_SYNC: SyncConfig = {
  masterPanelId: 'main',
  broadcastDelayMs: 0,
  globalTargetLatency: 0,
  autoDriftCorrection: true,
  maxDriftThresholdSec: 0.05,
};

export const STREAM_LATENCY_DEFAULTS: Record<string, number> = {
  INTERNATIONAL: 5,
  PRES: 5,
  WIF: 8,
  OBC: 22,
  DATA: 30,
  TRACKER: 15,
  PITLANE: 18,
};

export const TEAM_PRESETS: Record<string, { name: string; drivers: number[] }> = {
  mclaren: { name: 'McLaren', drivers: [4, 81] },
  mercedes: { name: 'Mercedes', drivers: [44, 63] },
  redbull: { name: 'Red Bull', drivers: [1, 22] },
  ferrari: { name: 'Ferrari', drivers: [16, 44] },
  williams: { name: 'Williams', drivers: [23, 55] },
  rb: { name: 'Racing Bulls', drivers: [30, 31] },
  aston: { name: 'Aston Martin', drivers: [14, 18] },
  haas: { name: 'Haas', drivers: [87, 31] },
  alpine: { name: 'Alpine', drivers: [10, 43] },
  sauber: { name: 'Sauber', drivers: [27, 5] },
};

export const CIRCUIT_NAME_MAP: Record<string, string> = {
  'Yas Marina': 'ae-2009',
  'Bahrain': 'bh-2002',
  'Sakhir': 'bh-2002',
  'Jeddah': 'sa-2021',
  'Melbourne': 'au-1953',
  'Albert Park': 'au-1953',
  'Shanghai': 'cn-2004',
  'Suzuka': 'jp-1962',
  'Miami': 'us-2022',
  'Imola': 'it-1953',
  'Monaco': 'mc-1929',
  'Montreal': 'ca-1978',
  'Barcelona': 'es-1991',
  'Catalunya': 'es-1991',
  'Spielberg': 'at-1969',
  'Red Bull Ring': 'at-1969',
  'Silverstone': 'gb-1948',
  'Spa': 'be-1925',
  'Spa-Francorchamps': 'be-1925',
  'Hungaroring': 'hu-1986',
  'Zandvoort': 'nl-1948',
  'Monza': 'it-1922',
  'Baku': 'az-2016',
  'Singapore': 'sg-2008',
  'Austin': 'us-2012',
  'COTA': 'us-2012',
  'Mexico City': 'mx-1962',
  'Interlagos': 'br-1940',
  'São Paulo': 'br-1940',
  'Las Vegas': 'us-2023',
  'Lusail': 'qa-2004',
  'Losail': 'qa-2004',
};

export function streamKey(channel: StreamChannel): string {
  return `${channel.contentId}:${channel.channelId ?? 'main'}`;
}

/** True for Race / Quali / Sprint / Practice replays — excludes press conferences, docs, etc. */
export function isRaceSessionContent(summary: Pick<RaceSessionSummary, 'title' | 'sessionType'>): boolean {
  const t = summary.title.toLowerCase();

  if (
    /press conference|press conf|debrief|highlights|highlight reel|documentary|preview show|f1 nation|tech talk|unlocked|paddock|interview|features|magazine|mini series|ceremony|extra|story|recap|review show|build-up|build up|post-race show|pre-race show|post-qualifying show|pre-qualifying show|weekend warm-up|drivers'? press|team principal|analysis|weekly|race in \d+|f1a |f1 kids|radio rewind|psc race|formula 2|formula 3|f2 |f3 /.test(
      t,
    )
  ) {
    return false;
  }

  if (summary.sessionType && summary.sessionType !== 'Other') return true;

  if (/^race\b| grand prix$| grand prix race|\brace\b/.test(t) && !/press|conference|highlight/.test(t)) return true;
  if (/qualif/.test(t)) return true;
  if (/sprint/.test(t) && !/highlight/.test(t)) return true;
  if (/practice|fp1|fp2|fp3|free practice/.test(t)) return true;

  return false;
}
