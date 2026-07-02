import { useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { getSyncEngine } from '../hooks/useSyncEngine';
import { mapTrackStatusToFlag } from './Track3D';

export function IntelStrip() {
  const telemetry = useAppStore((s) => s.telemetry);
  const isReplay = useAppStore((s) => s.isReplay);
  const activeSession = useAppStore((s) => s.activeSession);
  const layout = useAppStore((s) => s.layout);
  const syncConfig = useAppStore((s) => s.syncConfig);

  const items = useMemo(() => {
    const out: { id: string; label: string; value: string; tone?: 'live' | 'warn' | 'neutral' }[] = [];

    if (activeSession) {
      out.push({
        id: 'session',
        label: 'Session',
        value: activeSession.sessionType ?? (isReplay ? 'Replay' : 'Live'),
        tone: isReplay ? 'neutral' : 'live',
      });
    }

    const flag = mapTrackStatusToFlag(telemetry?.trackStatus);
    if (flag && flag !== 'GREEN') {
      out.push({
        id: 'track',
        label: 'Track',
        value: flag === 'SC' ? 'Safety car' : flag === 'VSC' ? 'Virtual SC' : `${flag} flag`,
        tone: 'warn',
      });
    }

    const leader = telemetry?.timing?.[0];
    if (leader) {
      out.push({
        id: 'leader',
        label: 'Leader',
        value: `${leader.tla} · ${leader.gapToLeader || 'P1'}`,
      });
    }

    const panelStates = getSyncEngine().getPanelStates();
    const master = panelStates.find((p) => p.id === syncConfig.masterPanelId) ?? panelStates[0];
    if (master && panelStates.length > 1) {
      const maxDrift = Math.max(
        ...panelStates.map((p) => Math.abs(p.currentTime - master.currentTime)),
      );
      if (maxDrift > syncConfig.maxDriftThresholdSec) {
        out.push({
          id: 'sync',
          label: 'Sync',
          value: `${maxDrift.toFixed(1)}s drift — press S to align`,
          tone: 'warn',
        });
      } else if (panelStates.length > 1) {
        out.push({
          id: 'sync-ok',
          label: 'Sync',
          value: `${panelStates.length} feeds aligned`,
        });
      }
    }

    if (layout) {
      out.push({
        id: 'feeds',
        label: 'Wall',
        value: `${layout.panels.length} feed${layout.panels.length === 1 ? '' : 's'}`,
      });
    }

    return out.slice(0, 5);
  }, [telemetry, isReplay, activeSession, layout, syncConfig]);

  if (items.length === 0) return null;

  return (
    <div className="intel-strip" role="status" aria-live="polite">
      <span className="intel-strip-mark">Live context</span>
      <div className="intel-strip-items">
        {items.map((item) => (
          <div key={item.id} className={`intel-item${item.tone ? ` tone-${item.tone}` : ''}`}>
            <span className="intel-label">{item.label}</span>
            <span className="intel-value">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
