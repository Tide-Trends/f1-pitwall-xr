import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { pitwallApi } from '../lib/api';
import { isRaceSessionContent } from '@pitwall/shared';
import type { RaceSessionSummary, SeasonContext, SeasonEventSummary } from '@pitwall/shared';
import { BrandMark } from './BrandMark';

const SEASONS = [2025, 2024, 2023, 2022];
type SessionFilter = 'all' | 'Race' | 'Qualifying' | 'Sprint' | 'Practice';

function parseContentId(value: string): number | null {
  const trimmed = value.trim();
  if (/^\d{6,}$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/\/detail\/(\d+)\//) ?? trimmed.match(/[?&]contentId=(\d+)/);
  return match?.[1] ? Number(match[1]) : null;
}

function meetingName(s: RaceSessionSummary): string {
  const parts = s.title.split(' - ');
  if (parts.length > 1) return parts[0]!;
  return s.circuitShortName || s.title;
}

function artCode(s: RaceSessionSummary): string {
  const source = s.circuitShortName || s.meetingKey || s.title;
  return source
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function artTheme(s: RaceSessionSummary): string {
  const text = `${s.circuitShortName} ${s.title}`.toLowerCase();
  if (/monaco|miami|singapore|las vegas|jeddah|baku|montreal/.test(text)) return 'street';
  if (/silverstone|spa|suzuka|spielberg|monza|zandvoort|interlagos/.test(text)) return 'classic';
  if (/bahrain|qatar|lusail|abu dhabi|yas marina|austin|mexico/.test(text)) return 'night';
  return 'default';
}

function SessionArtwork({ session }: { session: RaceSessionSummary }) {
  const [failed, setFailed] = useState(false);
  const showImage = !!session.thumbnailUrl && !failed;

  if (showImage) {
    return (
      <img
        className="session-card-thumb"
        src={session.thumbnailUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={`session-card-thumb session-art ${artTheme(session)}`}>
      <div className="session-art-track" />
      <div className="session-art-meta">
        <strong>{artCode(session)}</strong>
        <span>{session.sessionType ?? 'Session'}</span>
      </div>
    </div>
  );
}

function formatEventTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function relativeEventTime(timestamp: number): string {
  const diff = timestamp - Date.now();
  if (diff <= 0) return 'Now';
  const hours = Math.round(diff / 36e5);
  if (hours < 36) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function LiveEmptyContext({
  context,
  loading,
}: {
  context: SeasonContext | null;
  loading: boolean;
}) {
  const next = context?.nextEvents[0];

  if (loading && !context) {
    return <div className="browse-empty">Checking live sessions and season context...</div>;
  }

  return (
    <div className="live-context">
      <section className="live-hero">
        <div>
          <span className="live-kicker">No live F1 TV session right now</span>
          <h2>{next ? next.raceName : 'Next race weekend'}</h2>
          <p>
            {next
              ? `${next.circuitName} · ${next.locality}, ${next.country}`
              : 'Upcoming Formula 1 schedule will appear here when available.'}
          </p>
        </div>
        {next && (
          <div className="live-countdown">
            <strong>{relativeEventTime(next.startTime)}</strong>
            <span>{formatEventTime(next.startTime)}</span>
          </div>
        )}
      </section>

      <div className="live-context-grid">
        <section className="live-panel">
          <header>
            <h3>Upcoming sessions</h3>
            <span>{context?.season ?? new Date().getFullYear()}</span>
          </header>
          {(next?.sessions ?? []).slice(0, 6).map((session) => (
            <div key={`${session.name}-${session.startTime}`} className="schedule-row">
              <strong>{session.name}</strong>
              <span>{formatEventTime(session.startTime)}</span>
            </div>
          ))}
          {!next && <p className="live-muted">No upcoming schedule returned yet.</p>}
        </section>

        <section className="live-panel">
          <header>
            <h3>WDC leaders</h3>
            <span>Top 6</span>
          </header>
          {(context?.driverStandings ?? []).map((driver) => (
            <div key={driver.code} className="standing-row">
              <span>{driver.position}</span>
              <strong>{driver.code}</strong>
              <em>{driver.constructorName}</em>
              <b>{driver.points}</b>
            </div>
          ))}
        </section>

        <section className="live-panel live-panel-wide">
          <header>
            <h3>Race context</h3>
            <span>{context ? `Updated ${formatEventTime(context.updatedAt)}` : 'Waiting'}</span>
          </header>
          {(context?.contextNotes ?? []).map((note) => (
            <p key={note} className="context-note">{note}</p>
          ))}
          {(context?.nextEvents ?? []).slice(1, 3).map((event: SeasonEventSummary) => (
            <div key={event.round} className="next-event-row">
              <strong>Round {event.round}</strong>
              <span>{event.raceName}</span>
              <em>{formatEventTime(event.startTime)}</em>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

export function SessionPicker() {
  const sessionTab = useAppStore((s) => s.sessionTab);
  const setSessionTab = useAppStore((s) => s.setSessionTab);
  const replaySeason = useAppStore((s) => s.replaySeason);
  const setReplaySeason = useAppStore((s) => s.setReplaySeason);
  const liveSessions = useAppStore((s) => s.liveSessions);
  const replaySessions = useAppStore((s) => s.replaySessions);
  const setLiveSessions = useAppStore((s) => s.setLiveSessions);
  const setReplaySessions = useAppStore((s) => s.setReplaySessions);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);
  const error = useAppStore((s) => s.error);
  const loading = useAppStore((s) => s.loading);
  const logout = useAppStore((s) => s.logout);
  const [search, setSearch] = useState('');
  const [directUrl, setDirectUrl] = useState('');
  const [typeFilter, setTypeFilter] = useState<SessionFilter>('all');
  const [loadHint, setLoadHint] = useState<string | null>(null);
  const [seasonContext, setSeasonContext] = useState<SeasonContext | null>(null);
  const [seasonContextLoading, setSeasonContextLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLoadHint(null);

    (async () => {
      try {
        if (sessionTab === 'live') {
          const { sessions } = await pitwallApi.liveSessions();
          if (!cancelled) setLiveSessions(sessions.filter(isRaceSessionContent));
          return;
        }

        const seasonsToTry = [replaySeason, ...SEASONS.filter((y) => y !== replaySeason)];
        for (const year of seasonsToTry) {
          const { sessions } = await pitwallApi.replaySessions(year);
          const filtered = sessions.filter(isRaceSessionContent);
          if (filtered.length > 0) {
            if (!cancelled) {
              setReplaySessions(filtered);
              if (year !== replaySeason) {
                setReplaySeason(year);
                setLoadHint(`Loaded ${year} season — change season in the toolbar.`);
              }
            }
            return;
          }
        }

        if (!cancelled) {
          setReplaySessions([]);
          setError('No race sessions found. Sign out and reconnect your F1 TV account.');
        }
      } catch (e) {
        const msg = String(e);
        if (!cancelled) {
          setError(
            msg.includes('401') || msg.includes('Sign in') || msg.includes('session')
              ? 'F1 TV session expired. Sign out and reconnect.'
              : msg.replace(/^Error: /, ''),
          );
          setReplaySessions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionTab, replaySeason, setLiveSessions, setReplaySessions, setLoading, setError, setReplaySeason]);

  useEffect(() => {
    if (sessionTab !== 'live') return;
    let cancelled = false;
    setSeasonContextLoading(true);
    pitwallApi
      .seasonContext()
      .then(({ context }) => {
        if (!cancelled) setSeasonContext(context);
      })
      .catch(() => {
        if (!cancelled) setSeasonContext(null);
      })
      .finally(() => {
        if (!cancelled) setSeasonContextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionTab]);

  const sessions = sessionTab === 'live' ? liveSessions : replaySessions;

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (typeFilter !== 'all' && s.sessionType !== typeFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        s.circuitShortName.toLowerCase().includes(q) ||
        (s.sessionType ?? '').toLowerCase().includes(q)
      );
    });
  }, [sessions, search, typeFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, RaceSessionSummary[]>();
    for (const s of filtered) {
      const key = meetingName(s);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const loadSession = async (s: RaceSessionSummary) => {
    setLoading(true);
    setError(null);
    try {
      const kind = sessionTab === 'live' ? 'live' : 'replay';
      const { session } = await pitwallApi.getSession(s.contentId, kind);
      setActiveSession(session, kind === 'replay');
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''));
    } finally {
      setLoading(false);
    }
  };

  const loadDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    const contentId = parseContentId(directUrl);
    if (!contentId) {
      setError('Paste an F1 TV detail URL or a numeric content ID.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const kind = sessionTab === 'live' ? 'live' : 'replay';
      const { session } = await pitwallApi.getSession(contentId, kind);
      setActiveSession(session, kind === 'replay');
    } catch (err) {
      setError(String(err).replace(/^Error: /, ''));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="browse-shell">
      <header className="browse-header">
        <div className="browse-brand">
          <BrandMark className="browse-mark" />
          <div>
            <strong>PitWall XR</strong>
            <span>F1 TV Pro · Multi-stream pit wall</span>
          </div>
        </div>

        <div className="browse-tabs">
          <button
            type="button"
            className={`browse-tab${sessionTab === 'live' ? ' active' : ''}`}
            onClick={() => setSessionTab('live')}
          >
            Live
          </button>
          <button
            type="button"
            className={`browse-tab${sessionTab === 'replay' ? ' active' : ''}`}
            onClick={() => setSessionTab('replay')}
          >
            Replay archive
          </button>
        </div>

        <div className="browse-toolbar">
          {sessionTab === 'replay' && (
            <select value={replaySeason} onChange={(e) => setReplaySeason(Number(e.target.value))}>
              {SEASONS.map((y) => (
                <option key={y} value={y}>
                  {y} season
                </option>
              ))}
            </select>
          )}
          <input
            className="browse-search"
            placeholder="Search circuit, GP, session…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <form className="direct-open" onSubmit={loadDirect}>
            <input
              aria-label="F1 TV URL or content ID"
              placeholder="Paste F1 TV URL or content ID"
              value={directUrl}
              onChange={(e) => setDirectUrl(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary" disabled={loading}>
              Open
            </button>
          </form>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <div className="browse-alert">
          {error}
          {(error.includes('Sign out') || error.includes('expired') || error.includes('reconnect')) && (
            <button type="button" className="btn btn-secondary" onClick={logout}>
              Sign out
            </button>
          )}
        </div>
      )}

      {loadHint && !error && <div className="browse-hint">{loadHint}</div>}

      <div className="browse-body">
        <aside className="browse-sidebar">
          <h3>Session type</h3>
          {(['all', 'Race', 'Qualifying', 'Sprint', 'Practice'] as SessionFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`browse-filter${typeFilter === f ? ' active' : ''}`}
              onClick={() => setTypeFilter(f)}
            >
              {f === 'all' ? 'All sessions' : f}
            </button>
          ))}
          <p className="browse-sidebar-note">
            {filtered.length} session{filtered.length === 1 ? '' : 's'}
            {loading ? ' · loading…' : ''}
          </p>
        </aside>

        <main className="browse-main">
          {loading && grouped.length === 0 && (
            <div className="browse-empty">
              Loading {sessionTab === 'replay' ? `${replaySeason} race weekends` : 'live sessions'} from F1 TV…
              {sessionTab === 'replay' && (
                <p className="browse-empty-sub">Fetching session lists for each Grand Prix — this can take a few seconds.</p>
              )}
            </div>
          )}

          {!loading && grouped.length === 0 && !error && (
            sessionTab === 'live' ? (
              <LiveEmptyContext context={seasonContext} loading={seasonContextLoading} />
            ) : (
              <div className="browse-empty">
                No sessions match your filters. Try another season or reset filters.
              </div>
            )
          )}

          {grouped.map(([meeting, items]) => (
            <section key={meeting} className="browse-meeting">
              <header className="browse-meeting-head">
                <h2>{meeting}</h2>
                <span>{items[0]?.circuitShortName}</span>
              </header>
              <div className="session-grid">
                {items.map((s) => (
                  <button
                    type="button"
                    key={s.contentId}
                    className="session-card"
                    onClick={() => loadSession(s)}
                  >
                    <SessionArtwork session={s} />
                    <div className="session-card-body">
                      <span className={`session-badge ${(s.sessionType ?? 'other').toLowerCase()}`}>
                        {s.sessionType ?? 'Session'}
                      </span>
                      <h3>{s.title.replace(`${meeting} - `, '').replace(`${meeting}: `, '')}</h3>
                      <p>{s.circuitShortName}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
