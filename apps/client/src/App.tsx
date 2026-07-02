import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from './store/appStore';
import { LoginScreen } from './components/LoginScreen';
import { SessionPicker } from './components/SessionPicker';
import { PitWallGrid } from './components/PitWallGrid';
import { FeedRail } from './components/FeedRail';
import { Sidebar } from './components/Sidebar';
import { Track3DView, useCircuitGeoJSON, mapTrackStatusToFlag } from './components/Track3D';
import { VRMode } from './components/VRMode';
import { SyncWizard } from './components/SyncWizard';
import { CommandPalette } from './components/CommandPalette';
import { IntelStrip } from './components/IntelStrip';
import { BrandMark } from './components/BrandMark';
import { useTelemetryPolling } from './hooks/useTelemetry';
import { useSyncEngine, getSyncEngine } from './hooks/useSyncEngine';
import { useLaps, useSessionKey } from './hooks/useOpenF1';
import { pitwallApi, loadStoredTokens } from './lib/api';

function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function LapCounter() {
  const sessionKey = useSessionKey();
  const masterTime = useAppStore((s) => s.masterTime);
  const laps = useLaps(sessionKey);

  const currentLap = useMemo(() => {
    if (laps.length === 0) return null;
    const startMs = Math.min(
      ...laps.map((l) => new Date(l.date_start).getTime()).filter((t) => isFinite(t)),
    );
    const nowMs = startMs + masterTime * 1000;
    let max = 0;
    let total = 0;
    for (const l of laps) {
      total = Math.max(total, l.lap_number);
      if (new Date(l.date_start).getTime() <= nowMs) max = Math.max(max, l.lap_number);
    }
    return { current: max, total };
  }, [laps, masterTime]);

  if (!currentLap || currentLap.current === 0) return null;
  return (
    <span className="topbar-lap">
      Lap {currentLap.current}
      <em> / {currentLap.total}</em>
    </span>
  );
}

export default function App() {
  const authenticated = useAppStore((s) => s.authenticated);
  const activeSession = useAppStore((s) => s.activeSession);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const immersiveBg = useAppStore((s) => s.immersiveBg);
  const setImmersiveBg = useAppStore((s) => s.setImmersiveBg);
  const circuitGeoId = useAppStore((s) => s.circuitGeoId);
  const telemetry = useAppStore((s) => s.telemetry);
  const error = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const loading = useAppStore((s) => s.loading);
  const logout = useAppStore((s) => s.logout);
  const isReplay = useAppStore((s) => s.isReplay);
  const masterTime = useAppStore((s) => s.masterTime);
  const setMasterTime = useAppStore((s) => s.setMasterTime);
  const trackDockVisible = useAppStore((s) => s.trackDockVisible);
  const setTrackDockVisible = useAppStore((s) => s.setTrackDockVisible);
  const setShowSyncWizard = useAppStore((s) => s.setShowSyncWizard);
  const showSyncWizard = useAppStore((s) => s.showSyncWizard);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setRailCollapsed = useAppStore((s) => s.setRailCollapsed);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const tokens = loadStoredTokens();
    if (tokens) {
      pitwallApi
        .syncTokens(tokens)
        .then(() => useAppStore.setState({ authenticated: true, tokens }))
        .catch(() => useAppStore.setState({ authenticated: false, tokens: null }))
        .finally(() => setAuthReady(true));
      return;
    }
    pitwallApi
      .authStatus()
      .then((status) => {
        if (status.authenticated) {
          useAppStore.setState({ authenticated: true, tokens: null });
        }
      })
      .catch(() => {
        /* server offline — LoginScreen shows setup instructions */
      })
      .finally(() => setAuthReady(true));
  }, []);

  useSyncEngine();
  useTelemetryPolling(masterTime);
  const geo = useCircuitGeoJSON(circuitGeoId);

  useEffect(() => {
    if (!activeSession) return;
    const id = setInterval(() => {
      const master = getSyncEngine()
        .getPanelStates()
        .find((s) => s.audioFocused);
      const t = master?.currentTime ?? getSyncEngine().getPanelStates()[0]?.currentTime;
      if (t != null && isFinite(t)) setMasterTime(t);
    }, 1000);
    return () => clearInterval(id);
  }, [activeSession, setMasterTime]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const store = useAppStore.getState();
      switch (e.key.toLowerCase()) {
        case '1': store.setRailTab('timing'); store.setRailCollapsed(false); break;
        case '2': store.setRailTab('strategy'); store.setRailCollapsed(false); break;
        case '3': store.setRailTab('radio'); store.setRailCollapsed(false); break;
        case '4': store.setRailTab('system'); store.setRailCollapsed(false); break;
        case 's': {
          const engine = getSyncEngine();
          store.isReplay ? engine.syncReplayToMaster() : engine.syncAllToMaster();
          break;
        }
        case 't': store.setTrackDockVisible(!store.trackDockVisible); break;
        case 'i': store.setImmersiveBg(!store.immersiveBg); break;
        case 'v': store.setMode(store.mode === 'vr' ? 'desktop' : 'vr'); break;
        case 'w': store.setShowSyncWizard(!store.showSyncWizard); break;
        case 'escape':
          if (store.showSyncWizard) store.setShowSyncWizard(false);
          else if (store.commandPaletteOpen) store.setCommandPaletteOpen(false);
          else if (store.mode !== 'desktop') store.setMode('desktop');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!authReady) {
    return (
      <div className="auth-page">
        <p className="session-empty">Connecting…</p>
      </div>
    );
  }
  if (!authenticated) return <LoginScreen />;
  if (!activeSession) return <SessionPicker />;
  if (mode === 'vr' || mode === 'spatial') return <VRMode />;

  const flag = mapTrackStatusToFlag(telemetry?.trackStatus);
  const flagClass = flag === 'RED' ? ' flag-red' : flag === 'YELLOW' || flag === 'SC' || flag === 'VSC' ? ' flag-yellow' : '';

  return (
    <div className={`app-shell${flagClass}`}>
      <header className="topbar">
        <div className="topbar-primary">
          <BrandMark className="topbar-mark" />
          <div className="topbar-title-block">
            <h1>PitWall XR</h1>
            <span className="session-title">{activeSession.title}</span>
          </div>
        </div>

        <div className="topbar-status">
          <span className={`topbar-badge${isReplay ? '' : ' live'}`}>{isReplay ? 'Replay' : 'Live'}</span>
          {flag && flag !== 'GREEN' && (
            <span className={`topbar-flag ${flag.toLowerCase()}`}>
              {flag === 'SC' ? 'Safety car' : flag === 'VSC' ? 'Virtual SC' : `${flag} flag`}
            </span>
          )}
          <LapCounter />
          <span className="topbar-clock">{formatClock(masterTime)}</span>
        </div>

        <div className="spacer" />

        <div className="topbar-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCommandPaletteOpen(true)}>
            Command <kbd>⌘K</kbd>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode('vr')}>
            Spatial
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sm${trackDockVisible ? ' active' : ''}`}
            onClick={() => setTrackDockVisible(!trackDockVisible)}
          >
            Track
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowSyncWizard(true)}>
            Sync
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sm${immersiveBg ? ' active' : ''}`}
            onClick={() => setImmersiveBg(!immersiveBg)}
          >
            Dim
          </button>
        </div>

        <div className="topbar-nav">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => useAppStore.setState({ activeSession: null, layout: null })}
          >
            Library
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRailCollapsed(false)}>
            Data
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <IntelStrip />

      {error && (
        <div className="error-banner">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      {loading && <div className="loading-bar">Loading…</div>}

      <div className="workspace">
        <FeedRail />
        <div className={`pitwall-canvas${immersiveBg ? ' immersive' : ''}`}>
          <PitWallGrid />
          {immersiveBg && <div className="dim-overlay" />}
          <Track3DView geojson={geo} positions={telemetry?.positions ?? []} />
        </div>
        <Sidebar />
      </div>

      {showSyncWizard && <SyncWizard />}
      <CommandPalette />
    </div>
  );
}
