import type {
  AuthTokens,
  LiveSession,
  PlaybackBundle,
  RaceMeeting,
  RaceSessionSummary,
  StreamChannel,
  ViewingSession,
} from '@pitwall/shared';
import { isRaceSessionContent } from '@pitwall/shared';

const F1_API_KEY = 'fCUCjWrKPu9ylJwRAv8BpGLEgiAuThx7';
const F1_BASE = 'https://f1tv.formula1.com';
const AUTH_BASE = 'https://api.formula1.com';

export type Platform = 'WEB_DASH' | 'WEB_HLS' | 'BIG_SCREEN_DASH' | 'BIG_SCREEN_HLS';

export interface F1TVClientOptions {
  platform?: Platform;
  language?: string;
}

interface ApiResult<T> {
  resultCode: string;
  resultObj: T;
  systemTime: number;
}

interface ContainerItem {
  metadata: Record<string, unknown>;
  actions?: { uri?: string; href?: string }[];
  retrieveItems?: {
    resultObj?: {
      containers?: ContainerItem[];
    };
  };
}

export class F1TVClient {
  private subscriptionToken = '';
  private entitlementToken = '';
  private entitlement = 'F1_TV_Pro_Annual';
  private groupId = 2;
  private cookieHeader = '';
  private readonly platform: Platform;
  private readonly language: string;

  constructor(options: F1TVClientOptions = {}) {
    this.platform = options.platform ?? 'WEB_DASH';
    this.language = options.language ?? 'ENG';
  }

  get tokens(): AuthTokens | null {
    if (!this.entitlementToken) return null;
    return {
      subscriptionToken: this.subscriptionToken,
      entitlementToken: this.entitlementToken,
      entitlement: this.entitlement,
      groupId: this.groupId,
      cookieHeader: this.cookieHeader || undefined,
    };
  }

  /** After browser login — token captured from F1 TV web app (bypasses Imperva) */
  async loginFromBrowserSession(
    subscriptionToken: string,
    cookieHeader?: string,
  ): Promise<AuthTokens> {
    this.subscriptionToken = subscriptionToken;
    if (cookieHeader) this.cookieHeader = cookieHeader;
    await this.refreshEntitlement();
    await this.refreshLocation();
    return this.tokens!;
  }

  setTokens(tokens: AuthTokens): void {
    this.subscriptionToken = tokens.subscriptionToken;
    this.entitlementToken = tokens.entitlementToken;
    this.entitlement = tokens.entitlement;
    this.groupId = tokens.groupId;
    if (tokens.cookieHeader) this.cookieHeader = tokens.cookieHeader;
  }

  /** Direct password login — often blocked by Imperva; prefer browser login in Electron */
  async login(email: string, password: string): Promise<AuthTokens> {
    const res = await fetch(`${AUTH_BASE}/v2/account/subscriber/authenticate/by-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apiKey: F1_API_KEY,
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Origin: 'https://f1tv.formula1.com',
        Referer: 'https://f1tv.formula1.com/',
        ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {}),
      },
      body: JSON.stringify({ Login: email, Password: password }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Login failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      data?: { subscriptionToken?: string };
    };

    const token = data.data?.subscriptionToken;
    if (!token) throw new Error('No subscription token in login response');

    this.subscriptionToken = token;
    await this.refreshEntitlement();
    await this.refreshLocation();
    return this.tokens!;
  }

  async refreshEntitlement(): Promise<void> {
    const data = await this.get<ApiResult<{ entitlementToken: string }>>(
      `/2.0/R/${this.language}/${this.platform}/ALL/USER/ENTITLEMENT`,
      'ascendon',
    );
    this.entitlementToken = data.resultObj.entitlementToken;
  }

  async refreshLocation(): Promise<void> {
    const data = await this.get<
      ApiResult<{ userLocation: { entitlement: string; groupId: number }[] }>
    >(`/1.0/R/${this.language}/${this.platform}/ALL/USER/LOCATION`, true);

    const loc = data.resultObj.userLocation[0];
    if (loc) {
      this.entitlement = loc.entitlement;
      this.groupId = loc.groupId;
    }
  }

  async getLiveSessions(): Promise<LiveSession[]> {
    const data = await this.get<ApiResult<{ items: ContainerItem[] }>>(
      `/1.0/R/${this.language}/${this.platform}/ALL/EVENTS/LIVENOW/${this.entitlement}/${this.groupId}`,
      true,
    );

    const sessions: LiveSession[] = [];
    for (const item of data.resultObj.items ?? []) {
      const summary = parseSessionSummary(item, 'live');
      const channels = await this.getSessionChannels(summary.contentId);
      sessions.push({
        ...summary,
        state: summary.kind,
        isLive: summary.kind === 'live',
        channels,
      });
    }
    return sessions;
  }

  /** Browse replay archive by season (default: current year) */
  async searchReplayArchive(season?: number, meetingKey?: string): Promise<RaceSessionSummary[]> {
    const year = season ?? new Date().getFullYear();

    if (!this.entitlementToken) {
      throw new Error('Not authenticated with F1 TV. Sign in again from the login screen.');
    }

    const strategies: Array<() => Promise<RaceSessionSummary[]>> = [
      () => this.searchVod(year, meetingKey, { filter_objectSubtype: 'Meeting' }),
      () => this.searchVod(year, meetingKey, {}),
      () => this.searchViaArchivePage(year),
    ];

    let lastError: unknown;
    for (const run of strategies) {
      try {
        const sessions = await run();
        const filtered = dedupeSessions(sessions)
          .filter((s) => matchesReplaySeason(s, year))
          .filter(isRaceSessionContent);
        if (filtered.length > 0) return filtered;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) {
      console.warn('[F1TVClient] replay search failed:', lastError);
    }
    return [];
  }

  private async searchVod(
    year: number,
    meetingKey: string | undefined,
    extra: Record<string, string>,
  ): Promise<RaceSessionSummary[]> {
    const params = new URLSearchParams({
      filter_season: String(year),
      orderBy: 'meeting_End_Date',
      sortOrder: 'desc',
      ...extra,
    });
    if (meetingKey) params.set('filter_MeetingKey', meetingKey);

    const data = await this.get<ApiResult<{ containers: ContainerItem[] }>>(
      `/2.0/R/${this.language}/${this.platform}/ALL/PAGE/SEARCH/VOD/${this.entitlement}/${this.groupId}?${params}`,
      true,
    );

    const sessions: RaceSessionSummary[] = [];
    const meetingPageIds: number[] = [];

    for (const container of data.resultObj.containers ?? []) {
      const meta = container.metadata ?? {};
      const contentType = String(meta.contentType ?? '').toUpperCase();
      const contentSubtype = String(meta.contentSubtype ?? '').toUpperCase();

      // SEARCH/VOD returns meeting bundles without nested sessions — fetch each weekend page.
      if (contentType === 'BUNDLE' && contentSubtype === 'MEETING') {
        const pageId = resolvePageId(container);
        if (pageId) meetingPageIds.push(pageId);
        continue;
      }

      sessions.push(...extractSessionsFromContainer(container, 'replay'));
    }

    if (meetingPageIds.length > 0) {
      sessions.push(...(await this.fetchMeetingPages(meetingPageIds)));
    }

    return sessions;
  }

  /** Load session videos from F1 TV meeting detail pages (parallel, capped concurrency). */
  private async fetchMeetingPages(pageIds: number[]): Promise<RaceSessionSummary[]> {
    const unique = [...new Set(pageIds)];
    const sessions: RaceSessionSummary[] = [];
    const concurrency = 8;

    for (let i = 0; i < unique.length; i += concurrency) {
      const chunk = unique.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(async (pageId) => {
          try {
            const pageContainers = await this.getPage(pageId);
            const out: RaceSessionSummary[] = [];
            for (const c of pageContainers) {
              out.push(...extractSessionsFromContainer(c, 'replay'));
            }
            return out;
          } catch {
            return [] as RaceSessionSummary[];
          }
        }),
      );
      for (const result of chunkResults) sessions.push(...result);
    }

    return sessions;
  }

  /** Walk archive page bundles for a given season */
  private async searchViaArchivePage(year: number): Promise<RaceSessionSummary[]> {
    const archive = await this.getPage(493);
    const yearStr = String(year);
    const seasonPageIds: number[] = [];
    const meetingPageIds: number[] = [];

    for (const container of archive) {
      walkContainers(container, (item) => {
        const meta = item.metadata ?? {};
        const emf = (meta.emfAttributes ?? {}) as Record<string, unknown>;
        const contentType = String(meta.contentType ?? '').toUpperCase();
        const title = String(meta.title ?? meta.label ?? emf.MeetingName ?? '');

        if (contentType === 'LAUNCHER' && title.includes(`${yearStr} Season`)) {
          const pageId = resolvePageId(item);
          if (pageId) seasonPageIds.push(pageId);
          return;
        }

        if (contentType !== 'BUNDLE') return;

        const season = String(emf.Season ?? emf.season ?? emf.ChampionshipSeason ?? '');
        if (!season.includes(yearStr) && !title.includes(yearStr)) return;

        const pageId = resolvePageId(item);
        if (pageId) meetingPageIds.push(pageId);
      });
    }

    // Season launcher pages (e.g. "2025 Season" → page 10295) list each GP weekend.
    for (const seasonPageId of [...new Set(seasonPageIds)]) {
      try {
        const seasonContainers = await this.getPage(seasonPageId);
        for (const c of seasonContainers) {
          walkContainers(c, (item) => {
            const meta = item.metadata ?? {};
            if (String(meta.contentType ?? '').toUpperCase() !== 'BUNDLE') return;
            const pageId = resolvePageId(item);
            if (pageId) meetingPageIds.push(pageId);
          });
        }
      } catch {
        /* skip broken season page */
      }
    }

    return this.fetchMeetingPages(meetingPageIds);
  }

  private async getPage(pageId: number): Promise<ContainerItem[]> {
    const data = await this.get<ApiResult<{ containers: ContainerItem[] }>>(
      `/2.0/R/${this.language}/${this.platform}/ALL/PAGE/${pageId}/${this.entitlement}/${this.groupId}`,
      true,
    );
    return data.resultObj.containers ?? [];
  }

  /** Group replays by race weekend meeting */
  async getReplayMeetings(season?: number): Promise<RaceMeeting[]> {
    const sessions = await this.searchReplayArchive(season);
    const byMeeting = new Map<string, RaceMeeting>();

    for (const s of sessions) {
      if (!byMeeting.has(s.meetingKey)) {
        byMeeting.set(s.meetingKey, {
          meetingKey: s.meetingKey,
          meetingName: s.title.split(' - ')[0] ?? s.title,
          circuitShortName: s.circuitShortName,
          country: '',
          season: season ?? new Date().getFullYear(),
          sessions: [],
        });
      }
      byMeeting.get(s.meetingKey)!.sessions.push(s);
    }

    return Array.from(byMeeting.values()).sort((a, b) =>
      b.sessions[0]?.startDate ?? 0 - (a.sessions[0]?.startDate ?? 0),
    );
  }

  /** Full archive page.tsx with all stream channels — live or replay */
  async getViewingSession(contentId: number, kind: 'live' | 'replay' = 'replay'): Promise<ViewingSession> {
    const data = await this.get<ApiResult<{ containers: ContainerItem[] }>>(
      `/4.0/R/${this.language}/${this.platform}/ALL/CONTENT/VIDEO/${contentId}/${this.entitlement}/${this.groupId}`,
      true,
    );

    const container = data.resultObj.containers?.[0];
    if (!container) throw new Error(`Session ${contentId} not found`);

    const summary = parseSessionSummary(container, kind);
    const channels = await this.getSessionChannels(contentId);

    return {
      ...summary,
      isLive: kind === 'live',
      channels,
      openF1SessionKey: summary.sessionKey ? Number(summary.sessionKey) : undefined,
    };
  }

  async getSessionChannels(contentId: number): Promise<StreamChannel[]> {
    const data = await this.get<ApiResult<{ containers: { metadata: Record<string, unknown> }[] }>>(
      `/4.0/R/${this.language}/${this.platform}/ALL/CONTENT/VIDEO/${contentId}/${this.entitlement}/${this.groupId}`,
      true,
    );

    const container = data.resultObj.containers?.[0];
    const metadata = container?.metadata ?? {};
    const additionalStreams = (metadata.additionalStreams ?? []) as Record<string, unknown>[];

    const channels: StreamChannel[] = [
      {
        contentId,
        title: 'INTERNATIONAL',
        identifier: 'INTERNATIONAL',
        type: 'main',
      },
    ];

    for (const stream of additionalStreams) {
      channels.push({
        contentId,
        channelId: stream.channelId as number,
        title: String(stream.title ?? 'Unknown'),
        identifier: stream.identifier as StreamChannel['identifier'],
        type: stream.type as StreamChannel['type'],
        racingNumber: stream.racingNumber as number | undefined,
        driverFirstName: stream.driverFirstName as string | undefined,
        driverLastName: stream.driverLastName as string | undefined,
        teamName: stream.teamName as string | undefined,
        hex: stream.hex as string | undefined,
      });
    }

    return channels;
  }

  async getPlayback(contentId: number, channelId?: number): Promise<PlaybackBundle> {
    const params = new URLSearchParams({ contentId: String(contentId) });
    if (channelId) params.set('channelId', String(channelId));

    const platforms: Platform[] = [this.platform, 'BIG_SCREEN_DASH', 'WEB_HLS', 'BIG_SCREEN_HLS'];

    for (const platform of platforms) {
      try {
        const data = await this.get<
          ApiResult<{
            url: string;
            streamType: string;
            entitlementToken: string;
            laURL?: string;
          }>
        >(`/2.0/R/${this.language}/${platform}/ALL/CONTENT/PLAY?${params}`, true);

        const playToken = extractPlayToken(data.resultObj.url);
        const streamType = normalizeStreamType(data.resultObj.streamType);
        return {
          manifestUrl: data.resultObj.url,
          licenseUrl: data.resultObj.laURL,
          streamType,
          playToken,
          contentId,
          channelId,
          licenseAscendonToken: this.subscriptionToken,
          licenseEntitlementToken: data.resultObj.entitlementToken,
        };
      } catch {
        continue;
      }
    }

    throw new Error(`Playback unavailable for contentId=${contentId} channelId=${channelId}`);
  }

  private async get<T>(path: string, auth: boolean | 'ascendon' = true): Promise<T> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Origin: 'https://f1tv.formula1.com',
      Referer: 'https://f1tv.formula1.com/',
      Accept: 'application/json',
    };

    if (this.cookieHeader) {
      headers.Cookie = this.cookieHeader;
    }

    if ((auth === true || auth === 'ascendon') && this.subscriptionToken) {
      headers.ascendontoken = this.subscriptionToken;
    }
    if (auth === true && this.entitlementToken) {
      headers.entitlementtoken = this.entitlementToken;
    }

    const res = await fetch(`${F1_BASE}${path}`, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`F1TV API ${path} failed: ${res.status} ${body.slice(0, 120)}`);
    }
    return res.json() as Promise<T>;
  }
}

function parseSessionSummary(item: ContainerItem, kind: 'live' | 'replay' | 'upcoming'): RaceSessionSummary {
  const metadata = item.metadata;
  const emf = (metadata.emfAttributes ?? {}) as Record<string, unknown>;
  const pictureUrl = metadata.pictureUrl as string | undefined;

  return {
    contentId: metadata.contentId as number,
    title: String(metadata.title ?? metadata.label ?? 'Session'),
    meetingKey: String(emf.MeetingKey ?? ''),
    sessionKey: emf.SessionKey ? String(emf.SessionKey) : undefined,
    circuitShortName: String(emf.Circuit_Short_Name ?? emf.Meeting_Name ?? ''),
    series: String(emf.Series ?? 'FORMULA 1'),
    kind,
    sessionType: inferSessionType(String(metadata.title ?? '')),
    startDate: emf.sessionStartDate as number | undefined,
    duration: metadata.duration as number | undefined,
    thumbnailUrl: normalizePictureUrl(pictureUrl),
  };
}

function normalizePictureUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://f1tv.formula1.com/image-resizer/image/${value}?w=640&h=360`;
}

function walkContainers(container: ContainerItem, visit: (item: ContainerItem) => void): void {
  visit(container);
  for (const child of container.retrieveItems?.resultObj?.containers ?? []) {
    walkContainers(child, visit);
  }
  const meta = container.metadata ?? {};
  for (const child of ((meta as Record<string, unknown>).containers as ContainerItem[] | undefined) ?? []) {
    walkContainers(child, visit);
  }
}

function extractSessionsFromContainer(container: ContainerItem, kind: 'replay'): RaceSessionSummary[] {
  const sessions: RaceSessionSummary[] = [];

  for (const child of container.retrieveItems?.resultObj?.containers ?? []) {
    sessions.push(...extractSessionsFromContainer(child, kind));
  }

  const metadata = container.metadata ?? {};
  const subContainers = (metadata as Record<string, unknown>).containers as ContainerItem[] | undefined;
  if (subContainers?.length) {
    for (const c of subContainers) sessions.push(...extractSessionsFromContainer(c, kind));
  }

  const contentId = metadata.contentId as number | undefined;
  if (!contentId) return sessions;

  const contentType = String(metadata.contentType ?? metadata.type ?? '').toUpperCase();
  if (contentType === 'BUNDLE' || contentType === 'LAUNCHER') return sessions;

  const summary = parseSessionSummary(container, kind);
  if (kind === 'replay' && !isRaceSessionContent(summary)) return sessions;

  sessions.push(summary);
  return sessions;
}

function inferSessionType(title: string): RaceSessionSummary['sessionType'] {
  const t = title.toLowerCase();
  if (t.includes('sprint') && !t.includes('highlight')) return 'Sprint';
  if (/\bqualif/.test(t)) return 'Qualifying';
  if (/practice|fp1|fp2|fp3|free practice/.test(t)) return 'Practice';
  if (/\brace\b|grand prix$| grand prix /.test(t) && !t.includes('sprint')) return 'Race';
  return 'Other';
}

function resolvePageId(container: ContainerItem): number | null {
  const meta = container.metadata ?? {};
  const emf = (meta.emfAttributes ?? {}) as Record<string, unknown>;
  if (emf.PageID != null) return Number(emf.PageID);
  if (emf.pageId != null) return Number(emf.pageId);

  for (const action of container.actions ?? []) {
    const href = action.uri ?? action.href ?? '';
    const m = href.match(/\/PAGE\/(\d+)/i) ?? href.match(/\/page\/(\d+)/i);
    if (m) return Number(m[1]);
  }
  return null;
}

function normalizeStreamType(raw: string): PlaybackBundle['streamType'] {
  const t = raw.toUpperCase();
  if (t.includes('HLS')) return 'HLS';
  if (t.includes('WV') || t.includes('WIDEVINE')) return 'DASHWV';
  return 'DASH';
}

function dedupeSessions(sessions: RaceSessionSummary[]): RaceSessionSummary[] {
  const seen = new Set<number>();
  return sessions.filter((s) => {
    if (seen.has(s.contentId)) return false;
    seen.add(s.contentId);
    return true;
  });
}

function matchesReplaySeason(summary: RaceSessionSummary, year: number): boolean {
  const yearStr = String(year);
  if (summary.title.includes(yearStr)) return true;
  if (summary.startDate) {
    const sessionYear = new Date(summary.startDate).getFullYear();
    if (sessionYear === year) return true;
  }
  return false;
}

function extractPlayToken(manifestUrl: string): string | undefined {
  try {
    const match = manifestUrl.match(/token=([^&~]+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export { F1TVClient as default };

export {
  getOpenF1Sessions,
  matchOpenF1Session,
  getReplayTelemetrySnapshot,
} from './openf1-replay.js';
export type { OpenF1Session, ReplayTelemetryOptions } from './openf1-replay.js';
