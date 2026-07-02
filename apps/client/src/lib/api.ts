const API = import.meta.env.VITE_API_BASE?.replace(/\/$/, '') || '/api';
const TOKEN_KEY = 'pitwall.tokens';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`API returned invalid JSON for ${path}. The local server may still be restarting.`);
    }
  }
  const body = data as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return data as T;
}

export function loadStoredTokens(): import('@pitwall/shared').AuthTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const tokens = JSON.parse(raw) as import('@pitwall/shared').AuthTokens;
    return tokens?.entitlementToken ? tokens : null;
  } catch {
    return null;
  }
}

export function saveStoredTokens(tokens: import('@pitwall/shared').AuthTokens): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearStoredTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export const pitwallApi = {
  login: (email: string, password: string, userId = 'default') =>
    api<{ ok: boolean; tokens: import('@pitwall/shared').AuthTokens }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, userId }),
    }),

  syncTokens: (tokens: import('@pitwall/shared').AuthTokens, userId = 'default') =>
    api<{ ok: boolean }>('/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ tokens, userId }),
    }),

  authStatus: (userId = 'default') =>
    api<{ ok: boolean; authenticated: boolean; hasSubscriptionToken: boolean }>(
      `/auth/status?userId=${userId}`,
    ),

  liveSessions: (userId = 'default') =>
    api<{ sessions: import('@pitwall/shared').LiveSession[] }>(
      `/sessions/live?userId=${userId}`,
    ),

  seasonContext: () =>
    api<{ context: import('@pitwall/shared').SeasonContext }>('/season/context'),

  replaySessions: (season?: number, userId = 'default') =>
    api<{ sessions: import('@pitwall/shared').RaceSessionSummary[] }>(
      `/sessions/replay?season=${season ?? 2025}&userId=${userId}`,
    ),

  replayMeetings: (season?: number, userId = 'default') =>
    api<{ meetings: import('@pitwall/shared').RaceMeeting[] }>(
      `/sessions/replay/meetings?season=${season ?? 2025}&userId=${userId}`,
    ),

  getSession: (contentId: number, kind: 'live' | 'replay', userId = 'default') =>
    api<{ session: import('@pitwall/shared').ViewingSession }>(
      `/sessions/${contentId}?kind=${kind}&userId=${userId}`,
    ),

  getPlayback: (contentId: number, channelId?: number, userId = 'default') =>
    api<{ playback: import('@pitwall/shared').PlaybackBundle }>(
      `/playback/${contentId}?${channelId ? `channelId=${channelId}&` : ''}userId=${userId}`,
    ),

  replayTelemetry: (sessionKey: number, t: number) =>
    api<{ snapshot: import('@pitwall/shared').TelemetrySnapshot }>(
      `/replay/telemetry?sessionKey=${sessionKey}&t=${t}`,
    ),

  getCircuit: (id: string) => fetch(`${API}/circuits/${id}`).then((r) => r.json()),

  getLayouts: () => api<{ presets: import('@pitwall/shared').LayoutPreset[] }>('/layouts'),

  saveLayout: (preset: import('@pitwall/shared').LayoutPreset) =>
    api<{ preset: import('@pitwall/shared').LayoutPreset }>('/layouts', {
      method: 'POST',
      body: JSON.stringify(preset),
    }),

  openF1: <T = Record<string, unknown>[]>(resource: string, params: Record<string, string | number>) => {
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    return api<{ data: T }>(`/openf1/data/${resource}?${qs}`).then((r) => r.data);
  },

  transcribe: (url: string) =>
    api<{ text: string }>('/transcribe', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
};
