import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { getSyncEngine } from '../hooks/useSyncEngine';
import type { StreamPanelState } from '@pitwall/shared';

type WizardStep = 'master' | 'align' | 'done';

export function SyncWizard() {
  const show = useAppStore((s) => s.showSyncWizard);
  const setShow = useAppStore((s) => s.setShowSyncWizard);
  const syncConfig = useAppStore((s) => s.syncConfig);
  const setSyncConfig = useAppStore((s) => s.setSyncConfig);
  const isReplay = useAppStore((s) => s.isReplay);
  const layout = useAppStore((s) => s.layout);
  const [step, setStep] = useState<WizardStep>('master');
  const [states, setStates] = useState<StreamPanelState[]>([]);
  const [aligned, setAligned] = useState(0);

  useEffect(() => {
    if (!show) {
      setStep('master');
      return;
    }
    const id = setInterval(() => setStates(getSyncEngine().getPanelStates()), 500);
    return () => clearInterval(id);
  }, [show]);

  if (!show) return null;

  const panelTitle = (id: string) =>
    layout?.panels.find((p) => p.id === id)?.streamKey.split(':')[1] ?? id;

  const runAlign = () => {
    const engine = getSyncEngine();
    if (isReplay) {
      engine.syncReplayToMaster();
    } else {
      // Apply per-stream latency defaults, then hard sync
      for (const p of layout?.panels ?? []) {
        engine.setDefaultLatencyForStream(p.id);
      }
      engine.syncAllToMaster();
    }
    setAligned(states.length);
    setStep('done');
  };

  return (
    <div className="modal-backdrop" onClick={() => setShow(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>Sync wizard</h3>
          <button type="button" className="modal-close" onClick={() => setShow(false)}>✕</button>
        </header>

        {step === 'master' && (
          <div className="modal-body">
            <p className="modal-lede">
              Pick your <strong>master feed</strong> — every other stream aligns to it.
              Use the main broadcast for the most natural experience.
            </p>
            <div className="wizard-panels">
              {states.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`wizard-panel${syncConfig.masterPanelId === s.id ? ' selected' : ''}`}
                  onClick={() => setSyncConfig({ masterPanelId: s.id })}
                >
                  <strong>{panelTitle(s.id)}</strong>
                  <span>{s.currentTime.toFixed(1)}s · buffer {s.bufferDepth.toFixed(1)}s</span>
                </button>
              ))}
              {states.length === 0 && <p className="rail-hint">No streams playing yet — start a session first.</p>}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={states.length === 0}
              onClick={() => setStep('align')}
            >
              Next — align streams
            </button>
          </div>
        )}

        {step === 'align' && (
          <div className="modal-body">
            <p className="modal-lede">
              {isReplay
                ? 'Replay mode: every panel seeks to the master timestamp. Instant and exact.'
                : 'Live mode: per-stream latency presets are applied (onboards lag the world feed by ~20s), then all panels align.'}
            </p>
            <div className="wizard-drift">
              {states.map((s) => {
                const master = states.find((m) => m.id === syncConfig.masterPanelId);
                const drift = master ? s.currentTime - master.currentTime : 0;
                return (
                  <div key={s.id} className="wizard-drift-row">
                    <span>{panelTitle(s.id)}</span>
                    <span className={Math.abs(drift) < 0.5 ? 'ok' : 'warn'}>
                      {s.id === syncConfig.masterPanelId ? 'master' : `${drift > 0 ? '+' : ''}${drift.toFixed(2)}s`}
                    </span>
                  </div>
                );
              })}
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={runAlign}>
              Align all now
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep('master')}>
              Back
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="modal-body wizard-done">
            <span className="wizard-check">✓</span>
            <p className="modal-lede">
              {aligned} stream{aligned === 1 ? '' : 's'} aligned. Auto drift correction keeps them locked —
              fine-tune with the nudge buttons in System.
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => setShow(false)}>
              Done
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep('align')}>
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
