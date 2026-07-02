import express from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { F1TVClient } from '@pitwall/f1tv-client';
import {
  getOpenF1Sessions,
  matchOpenF1Session,
  getReplayTelemetrySnapshot,
} from '@pitwall/f1tv-client';
import { LayoutStore } from '@pitwall/layout-engine';
import type { AuthTokens, SeasonContext, SeasonEventSummary, SeasonStanding, TelemetrySnapshot } from '@pitwall/shared';
import { F1TelemetryService } from './f1-telemetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = path.join(__dirname, '../../data');
const CERT_DIR = path.join(__dirname, '../../../certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const USE_HTTPS = fs.existsSync(CERT_FILE);

const app = express();
app.use(cors());
app.use(express.json());

const clients = new Map<string, F1TVClient>();
const layoutStore = new LayoutStore();
const TOKENS_PATH = path.join(DATA_DIR, 'tokens.json');
const replayStartByOpenF1Session = new Map<number, string | number>();

interface JolpicaRace {
  round: string;
  raceName: string;
  date: string;
  time?: string;
  Circuit: {
    circuitName: string;
    Location: { locality: string; country: string };
  };
  FirstPractice?: { date: string; time?: string };
  SecondPractice?: { date: string; time?: string };
  ThirdPractice?: { date: string; time?: string };
  Qualifying?: { date: string; time?: string };
  Sprint?: { date: string; time?: string };
  SprintQualifying?: { date: string; time?: string };
}

interface JolpicaDriverStanding {
  position: string;
  points: string;
  wins: string;
  Driver: { code?: string; givenName: string; familyName: string };
  Constructors: { name: string }[];
}

function jolpicaTime(date: string, time?: string): number {
  return new Date(`${date}T${time ?? '00:00:00Z'}`).getTime();
}

function raceSessions(race: JolpicaRace): { name: string; startTime: number }[] {
  const sessions: Array<[string, { date: string; time?: string } | undefined]> = [
    ['Practice 1', race.FirstPractice],
    ['Practice 2', race.SecondPractice],
    ['Practice 3', race.ThirdPractice],
    ['Sprint Qualifying', race.SprintQualifying],
    ['Sprint', race.Sprint],
    ['Qualifying', race.Qualifying],
    ['Race', { date: race.date, time: race.time }],
  ];
  return sessions
    .filter((entry): entry is [string, { date: string; time?: string }] => !!entry[1])
    .map(([name, value]) => ({ name, startTime: jolpicaTime(value.date, value.time) }))
    .sort((a, b) => a.startTime - b.startTime);
}

async function fetchSeasonContext(): Promise<SeasonContext> {
  const [scheduleRes, standingsRes] = await Promise.all([
    fetch('https://api.jolpi.ca/ergast/f1/current.json'),
    fetch('https://api.jolpi.ca/ergast/f1/current/driverstandings.json'),
  ]);
  if (!scheduleRes.ok) throw new Error(`Jolpica schedule failed: ${scheduleRes.status}`);
  if (!standingsRes.ok) throw new Error(`Jolpica standings failed: ${standingsRes.status}`);

  const schedule = await scheduleRes.json() as {
    MRData: { RaceTable: { season: string; Races: JolpicaRace[] } };
  };
  const standings = await standingsRes.json() as {
    MRData: { StandingsTable: { StandingsLists: { DriverStandings: JolpicaDriverStanding[] }[] } };
  };

  const now = Date.now();
  const races = schedule.MRData.RaceTable.Races ?? [];
  const nextEvents: SeasonEventSummary[] = races
    .filter((race) => jolpicaTime(race.date, race.time) >= now - 3 * 60 * 60 * 1000)
    .slice(0, 3)
    .map((race) => ({
      round: Number(race.round),
      raceName: race.raceName,
      circuitName: race.Circuit.circuitName,
      locality: race.Circuit.Location.locality,
      country: race.Circuit.Location.country,
      startTime: jolpicaTime(race.date, race.time),
      sessions: raceSessions(race),
    }));

  const driverStandings: SeasonStanding[] =
    standings.MRData.StandingsTable.StandingsLists[0]?.DriverStandings.slice(0, 6).map((standing) => ({
      position: Number(standing.position),
      code: standing.Driver.code ?? standing.Driver.familyName.slice(0, 3).toUpperCase(),
      driverName: `${standing.Driver.givenName} ${standing.Driver.familyName}`,
      constructorName: standing.Constructors[0]?.name ?? '',
      points: Number(standing.points),
      wins: Number(standing.wins),
    })) ?? [];

  const leader = driverStandings[0];
  const second = driverStandings[1];
  const next = nextEvents[0];
  const contextNotes = [
    leader && second ? `${leader.code} leads ${second.code} by ${leader.points - second.points} points.` : null,
    next ? `Next up: ${next.raceName} at ${next.circuitName}.` : null,
    next?.sessions.some((session) => session.name === 'Sprint') ? 'Sprint weekend: extra competitive session in the live schedule.' : null,
  ].filter(Boolean) as string[];

  return {
    season: Number(schedule.MRData.RaceTable.season),
    updatedAt: Date.now(),
    nextEvents,
    driverStandings,
    contextNotes,
  };
}

function loadStoredTokens(): Record<string, AuthTokens> {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(TOKENS_PATH)) {
      return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8')) as Record<string, AuthTokens>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function saveStoredTokens(userId: string, tokens: AuthTokens): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const all = loadStoredTokens();
    all[userId] = tokens;
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(all, null, 2));
  } catch {
    /* ignore */
  }
}

function getClient(userId = 'default'): F1TVClient {
  if (!clients.has(userId)) {
    const client = new F1TVClient();
    const stored = loadStoredTokens()[userId];
    if (stored?.entitlementToken) client.setTokens(stored);
    clients.set(userId, client);
  }
  return clients.get(userId)!;
}

function layoutsPath(): string {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, 'layouts.json');
}

function loadLayouts(): void {
  try {
    const p = layoutsPath();
    if (fs.existsSync(p)) {
      const store = LayoutStore.fromJSON(fs.readFileSync(p, 'utf-8'));
      for (const preset of store.list()) layoutStore.save(preset);
    }
  } catch {
    /* ignore */
  }
}

function saveLayouts(): void {
  fs.writeFileSync(layoutsPath(), layoutStore.toJSON());
}

loadLayouts();

const telemetryService = new F1TelemetryService();
telemetryService.start();

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'pitwall-xr',
    f1Telemetry: telemetryService.isConnected(),
    wsClients: telemetryService.getClientCount(),
    timestamp: Date.now(),
  });
});

app.get('/api/season/context', async (_req, res) => {
  try {
    res.json({ context: await fetchSeasonContext() });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// --- Auth (per-user F1 TV credentials) ---
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, userId = 'default' } = req.body as {
      email: string;
      password: string;
      userId?: string;
    };
    const client = getClient(userId);
    const tokens = await client.login(email, password);
    saveStoredTokens(userId, tokens);
    res.json({ ok: true, tokens, userId });
  } catch (err) {
    res.status(401).json({
      ok: false,
      error: String(err),
      hint: 'Use "Sign in via F1 TV Browser" in the Electron app to bypass Imperva.',
    });
  }
});

/** Browser login from Electron — subscription token + Imperva cookies */
app.post('/api/auth/browser-session', async (req, res) => {
  try {
    const {
      subscriptionToken,
      cookies,
      entitlementToken,
      entitlement,
      groupId,
      userId = 'default',
    } = req.body as {
      subscriptionToken?: string;
      entitlementToken?: string;
      entitlement?: string;
      groupId?: number;
      cookies?: { cookieHeader?: string };
      userId?: string;
    };

    const client = getClient(userId);
    const cookieHeader = cookies?.cookieHeader ?? '';
    const sub =
      subscriptionToken && subscriptionToken !== 'session-cookie' ? subscriptionToken : '';

    if (entitlementToken) {
      client.setTokens({
        subscriptionToken: sub,
        entitlementToken,
        entitlement: entitlement || 'F1_TV_Pro_Annual',
        groupId: groupId ?? 2,
        cookieHeader,
      });
    } else if (sub) {
      await client.loginFromBrowserSession(sub, cookieHeader);
    } else if (cookieHeader) {
      client.setTokens({
        subscriptionToken: '',
        entitlementToken: '',
        entitlement: entitlement || 'F1_TV_Pro_Annual',
        groupId: groupId ?? 2,
        cookieHeader,
      });
      await client.refreshEntitlement();
      await client.refreshLocation();
    } else {
      return res.status(400).json({ ok: false, error: 'No session data received' });
    }

    const tokens = client.tokens;
    if (!tokens?.entitlementToken) {
      return res.status(401).json({
        ok: false,
        error: 'Could not establish F1 TV session. Sign in on F1 TV first.',
      });
    }

    saveStoredTokens(userId, tokens);
    res.json({ ok: true, tokens, userId });
  } catch (err) {
    res.status(401).json({ ok: false, error: String(err) });
  }
});

app.post('/api/auth/tokens', (req, res) => {
  const { tokens, userId = 'default' } = req.body as { tokens: AuthTokens; userId?: string };
  getClient(userId).setTokens(tokens);
  saveStoredTokens(userId, tokens);
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  const userId = String(req.query.userId ?? 'default');
  const client = getClient(userId);
  const tokens = client.tokens;
  res.json({
    ok: true,
    authenticated: !!tokens?.entitlementToken,
    hasSubscriptionToken: !!tokens?.subscriptionToken,
    entitlement: tokens?.entitlement ?? null,
  });
});

// --- Live sessions ---
app.get('/api/sessions/live', async (req, res) => {
  try {
    const userId = String(req.query.userId ?? 'default');
    const sessions = await getClient(userId).getLiveSessions();
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- Replay / archive ---
app.get('/api/sessions/replay', async (req, res) => {
  try {
    const userId = String(req.query.userId ?? 'default');
    const season = req.query.season ? Number(req.query.season) : undefined;
    const meetingKey = req.query.meetingKey ? String(req.query.meetingKey) : undefined;
    const client = getClient(userId);
    if (!client.tokens?.entitlementToken) {
      return res.status(401).json({
        error: 'F1 TV session expired. Sign in again from the login screen.',
        needsAuth: true,
      });
    }
    const sessions = await client.searchReplayArchive(season, meetingKey);
    res.json({ sessions, season: season ?? new Date().getFullYear() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/sessions/replay/meetings', async (req, res) => {
  try {
    const userId = String(req.query.userId ?? 'default');
    const season = req.query.season ? Number(req.query.season) : undefined;
    const meetings = await getClient(userId).getReplayMeetings(season);
    res.json({ meetings, season: season ?? new Date().getFullYear() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/sessions/:contentId', async (req, res) => {
  try {
    const userId = String(req.query.userId ?? 'default');
    const kind = req.query.kind === 'live' ? 'live' : 'replay';
    const contentId = Number(req.params.contentId);
    const session = await getClient(userId).getViewingSession(contentId, kind);

    // Try to match OpenF1 session for replay telemetry
    if (kind === 'replay' && session.meetingKey) {
      const startDateMs = session.startDate ? Number(session.startDate) : NaN;
      const sessionYear = Number.isFinite(startDateMs)
        ? new Date(startDateMs).getFullYear()
        : new Date().getFullYear();
      const openF1Key = await matchOpenF1Session(
        session.meetingKey,
        session.title,
        sessionYear,
      ).catch(() => undefined);
      if (openF1Key) session.openF1SessionKey = openF1Key;
      if (session.openF1SessionKey && session.startDate) {
        replayStartByOpenF1Session.set(session.openF1SessionKey, session.startDate);
      }
    }

    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/playback/:contentId', async (req, res) => {
  try {
    const userId = String(req.query.userId ?? 'default');
    const contentId = Number(req.params.contentId);
    const channelId = req.query.channelId ? Number(req.query.channelId) : undefined;
    const playback = await getClient(userId).getPlayback(contentId, channelId);
    res.json({ playback });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

function isAllowedMediaUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  return (
    url.hostname.endsWith('.formula1.com') ||
    url.hostname.endsWith('.akamaized.net') ||
    url.hostname.endsWith('.cloudfront.net')
  );
}

function proxiedMediaUrl(url: string): string {
  return `/api/media-proxy?url=${encodeURIComponent(url)}`;
}

function rewriteDashManifest(xml: string, manifestUrl: string): string {
  return xml.replace(
    /\b(media|initialization|sourceURL)="([^"]+)"/g,
    (_match, attr: string, value: string) => {
      const absolute = new URL(value, manifestUrl).toString();
      return `${attr}="${proxiedMediaUrl(absolute).replace(/&/g, '&amp;')}"`;
    },
  );
}

app.get('/api/media-proxy', async (req, res) => {
  try {
    const raw = String(req.query.url ?? '');
    if (!raw) return res.status(400).send('url required');
    const target = new URL(raw);
    if (!isAllowedMediaUrl(target)) return res.status(403).send('media host not allowed');

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Origin: 'https://f1tv.formula1.com',
      Referer: 'https://f1tv.formula1.com/',
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(target, { headers });
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const commonHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Accept-Ranges': upstream.headers.get('accept-ranges') ?? 'bytes',
      'Cache-Control': 'private, max-age=30',
      'Content-Type': contentType,
    };

    if (contentType.includes('application/dash+xml') || target.pathname.endsWith('.mpd')) {
      const rewritten = rewriteDashManifest(await upstream.text(), target.toString());
      res.status(upstream.ok ? 200 : upstream.status).set(commonHeaders).send(rewritten);
      return;
    }

    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    if (contentLength) commonHeaders['Content-Length'] = contentLength;
    if (contentRange) commonHeaders['Content-Range'] = contentRange;
    res.status(upstream.status).set(commonHeaders);
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body as unknown as import('stream/web').ReadableStream).pipe(res);
  } catch (err) {
    res.status(502).send(String(err));
  }
});

// --- Replay telemetry (OpenF1, synced to video currentTime) ---
app.get('/api/replay/telemetry', async (req, res) => {
  try {
    const sessionKey = Number(req.query.sessionKey);
    const videoTimeSec = Number(req.query.t ?? 0);
    if (!sessionKey) return res.status(400).json({ error: 'sessionKey required' });

    const snapshot = await getReplayTelemetrySnapshot({
      sessionKey,
      videoTimeSec,
      sessionStartDate: replayStartByOpenF1Session.get(sessionKey),
    });
    res.json({ snapshot });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/openf1/sessions', async (req, res) => {
  try {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const sessions = await getOpenF1Sessions(year);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- OpenF1 data proxy (weather, stints, pit, radio, laps, intervals, drivers) ---
const OPENF1_BASE = 'https://api.openf1.org/v1';
const OPENF1_RESOURCES = new Set([
  'weather',
  'stints',
  'pit',
  'team_radio',
  'laps',
  'intervals',
  'drivers',
  'position',
  'race_control',
  'car_data',
]);
const openF1Cache = new Map<string, { at: number; data: unknown }>();

app.get('/api/openf1/data/:resource', async (req, res) => {
  const resource = req.params.resource;
  if (!OPENF1_RESOURCES.has(resource)) {
    return res.status(400).json({ error: `Unknown resource: ${resource}` });
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') params.set(k, v);
  }
  const url = `${OPENF1_BASE}/${resource}?${params}`;
  const cacheTtl = resource === 'intervals' || resource === 'position' ? 3000 : 30000;
  const cached = openF1Cache.get(url);
  if (cached && Date.now() - cached.at < cacheTtl) {
    return res.json({ data: cached.data });
  }
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`OpenF1 ${resource}: ${r.status}`);
    const data = await r.json();
    openF1Cache.set(url, { at: Date.now(), data });
    if (openF1Cache.size > 200) {
      const oldest = openF1Cache.keys().next().value;
      if (oldest) openF1Cache.delete(oldest);
    }
    res.json({ data });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// --- Team radio transcription (local Whisper if installed) ---
function findWhisper(): string | null {
  const candidates = ['/opt/homebrew/bin/whisper-cli', '/opt/homebrew/bin/whisper-cpp', '/usr/local/bin/whisper-cli', '/opt/homebrew/bin/whisper'];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

app.post('/api/transcribe', async (req, res) => {
  try {
    const { url } = req.body as { url: string };
    if (!url || !url.startsWith('https://')) {
      return res.status(400).json({ error: 'Valid https audio url required' });
    }
    const whisper = findWhisper();
    if (!whisper) {
      return res.status(501).json({
        error: 'Whisper not installed. Run: brew install whisper-cpp',
        installable: true,
      });
    }
    const audioRes = await fetch(url);
    if (!audioRes.ok) throw new Error(`Audio fetch failed: ${audioRes.status}`);
    const buf = Buffer.from(await audioRes.arrayBuffer());
    const tmp = path.join(os.tmpdir(), `pitwall-radio-${Date.now()}.mp3`);
    fs.writeFileSync(tmp, buf);

    const text = await new Promise<string>((resolve, reject) => {
      execFile(whisper, ['-f', tmp, '-np', '-nt'], { timeout: 60000 }, (err, stdout) => {
        fs.unlinkSync(tmp);
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- Layout presets ---
app.get('/api/layouts', (_req, res) => {
  res.json({ presets: layoutStore.list() });
});

app.post('/api/layouts', (req, res) => {
  const preset = layoutStore.save(req.body);
  saveLayouts();
  res.json({ preset });
});

app.delete('/api/layouts/:id', (req, res) => {
  layoutStore.remove(req.params.id);
  saveLayouts();
  res.json({ ok: true });
});

// --- Circuit GeoJSON assets ---
app.get('/api/circuits/:id', (req, res) => {
  const circuitPath = path.join(
    __dirname,
    '../../../assets/f1-circuits/circuits',
    `${req.params.id}.geojson`,
  );
  if (!fs.existsSync(circuitPath)) {
    return res.status(404).json({ error: 'Circuit not found' });
  }
  res.sendFile(circuitPath);
});

app.get('/api/circuits', (_req, res) => {
  const dir = path.join(__dirname, '../../../assets/f1-circuits/circuits');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.geojson'));
  res.json({ circuits: files.map((f) => f.replace('.geojson', '')) });
});

const server = USE_HTTPS
  ? https.createServer(
      {
        key: fs.readFileSync(KEY_FILE),
        cert: fs.readFileSync(CERT_FILE),
      },
      app,
    )
  : http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/telemetry' });

wss.on('connection', (ws: WebSocket) => {
  telemetryService.addClient(ws);
  ws.send(JSON.stringify({ type: 'connected', mode: 'live-or-replay' }));

  ws.on('close', () => telemetryService.removeClient(ws));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as { type: string; sessionKey?: number; t?: number };
      if (msg.type === 'replay_poll' && msg.sessionKey != null && msg.t != null) {
        getReplayTelemetrySnapshot({ sessionKey: msg.sessionKey, videoTimeSec: msg.t })
          .then((snapshot: TelemetrySnapshot) => ws.send(JSON.stringify({ type: 'telemetry', snapshot })))
          .catch((err: unknown) => ws.send(JSON.stringify({ type: 'error', error: String(err) })));
      }
    } catch {
      /* ignore */
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const proto = USE_HTTPS ? 'https' : 'http';
  console.log(`PitWall XR server ${proto}://localhost:${PORT}`);
  if (USE_HTTPS) {
    try {
      const questUrl = fs.readFileSync(path.join(CERT_DIR, 'quest-url.txt'), 'utf-8').trim();
      console.log(`  Quest:   ${questUrl}`);
    } catch { /* ignore */ }
  }
  console.log(`  Live:    GET /api/sessions/live`);
  console.log(`  Replay:  GET /api/sessions/replay?season=2025`);
  console.log(`  Health:  GET /health`);
});
