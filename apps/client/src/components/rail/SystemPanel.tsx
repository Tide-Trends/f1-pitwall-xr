import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { getSyncEngine } from '../../hooks/useSyncEngine';
import type { StreamPanelState } from '@pitwall/shared';

export function SystemPanel() {
  const syncConfig = useAppStore((s) => s.syncConfig);
  const setSyncConfig = useAppStore((s) => s.setSyncConfig);
  const isReplay = useAppStore((s) => s.isReplay);
  const immersiveBg = useAppStore((s) => s.immersiveBg);
  const setImmersiveBg = useAppStore((s) => s.setImmersiveBg);
  const setShowSyncWizard = useAppStore((s) => s.setShowSyncWizard);
  const layout = useAppStore((s) => s.layout);
  const [states, setStates] = useState<StreamPanelState[]>([]);

  useEffect(() => {
    const id = setInterval(() => {
      setStates(getSyncEngine().getPanelStates());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const masterTime = states.find((s) => s.id === syncConfig.masterPanelId)?.currentTime ?? 0;
  const panelTitle = (id: string) =>
    layout?.panels.find((p) => p.id === id)?.streamKey.split(':')[1] ?? id;

  return (
    <div className="system-panel">
      <section className="sys-section">
        <h4>Sync {isReplay ? '· Replay' : '· Live'}</h4>
        <button type="button" className="btn btn-primary btn-block" onClick={() => setShowSyncWizard(true)}>
          Open sync wizard
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => {
            const engine = getSyncEngine();
            isReplay ? engine.syncReplayToMaster() : engine.syncAllToMaster();
          }}
        >
          Sync all to master now
        </button>
        {!isReplay && (
          <label className="sys-slider">
            <span>
              Broadcast delay <em>{Math.round(syncConfig.broadcastDelayMs / 1000)}s</em>
            </span>
            <input
              type="range"
              min={0}
              max={120}
              value={syncConfig.broadcastDelayMs / 1000}
              onChange={(e) => setSyncConfig({ broadcastDelayMs: Number(e.target.value) * 1000 })}
            />
          </label>
        )}
        <label className="sys-toggle">
          <input
            type="checkbox"
            checked={syncConfig.autoDriftCorrection}
            onChange={(e) => setSyncConfig({ autoDriftCorrection: e.target.checked })}
          />
          Auto drift correction
        </label>
        <label className="sys-toggle">
          <input
            type="checkbox"
            checked={immersiveBg}
            onChange={(e) => setImmersiveBg(e.target.checked)}
          />
          Dark void immersion
        </label>
      </section>

      <section className="sys-section">
        <h4>Stream health</h4>
        {states.length === 0 && <div className="rail-empty"><p>No active streams.</p></div>}
        {states.map((s) => {
          const drift = s.id === syncConfig.masterPanelId ? 0 : s.currentTime - masterTime;
          const healthy = s.bufferDepth > 4;
          const inSync = Math.abs(drift) < 0.5;
          return (
            <div key={s.id} className="health-row">
              <span className={`health-dot ${healthy ? 'ok' : 'warn'}`} />
              <span className="health-name">
                {s.id === syncConfig.masterPanelId ? '★ ' : ''}
                {panelTitle(s.id)}
              </span>
              <span className="health-buffer" title="Buffer depth">
                {s.bufferDepth.toFixed(1)}s
              </span>
              <span
                className={`health-drift ${inSync ? 'ok' : 'warn'}`}
                title="Drift vs master"
              >
                {s.id === syncConfig.masterPanelId ? 'master' : `${drift > 0 ? '+' : ''}${drift.toFixed(2)}s`}
              </span>
              <span className="health-nudge">
                <button type="button" onClick={() => getSyncEngine().nudgePanel(s.id, -0.5)} title="Nudge back 0.5s">−</button>
                <button type="button" onClick={() => getSyncEngine().nudgePanel(s.id, 0.5)} title="Nudge forward 0.5s">+</button>
              </span>
            </div>
          );
        })}
      </section>

      <section className="sys-section">
        <h4>Shortcuts</h4>
        <div className="shortcut-list">
          <span><kbd>1</kbd>–<kbd>4</kbd> Rail tabs</span>
          <span><kbd>S</kbd> Sync all</span>
          <span><kbd>T</kbd> Toggle track</span>
          <span><kbd>I</kbd> Immersion</span>
          <span><kbd>V</kbd> VR mode</span>
          <span><kbd>W</kbd> Sync wizard</span>
          <span><kbd>Esc</kbd> Back / close</span>
        </div>
      </section>
    </div>
  );
}
