import { useAppStore, type RailTab } from '../store/appStore';
import { createTeamLayout } from '@pitwall/layout-engine';
import { TEAM_PRESETS } from '@pitwall/shared';
import { TimingTower } from './rail/TimingTower';
import { WeatherStrip } from './rail/WeatherStrip';
import { StrategyPanel } from './rail/StrategyPanel';
import { RadioPanel } from './rail/RadioPanel';
import { SystemPanel } from './rail/SystemPanel';

const TABS: { id: RailTab; label: string }[] = [
  { id: 'timing', label: 'Timing' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'radio', label: 'Radio' },
  { id: 'system', label: 'System' },
];

export function Sidebar() {
  const railTab = useAppStore((s) => s.railTab);
  const setRailTab = useAppStore((s) => s.setRailTab);
  const railCollapsed = useAppStore((s) => s.railCollapsed);
  const setRailCollapsed = useAppStore((s) => s.setRailCollapsed);
  const activeSession = useAppStore((s) => s.activeSession);
  const setLayout = useAppStore((s) => s.setLayout);
  const savedLayouts = useAppStore((s) => s.savedLayouts);

  const applyTeamPreset = (key: string) => {
    if (!activeSession) return;
    const preset = createTeamLayout(key, activeSession.channels);
    if (preset) setLayout(preset);
  };

  if (railCollapsed) {
    return (
      <aside className="sidebar collapsed">
        <button
          type="button"
          className="rail-collapse"
          onClick={() => setRailCollapsed(false)}
          title="Expand panel"
        >
          ‹
        </button>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rail-tab-mini${railTab === t.id ? ' active' : ''}`}
            onClick={() => {
              setRailTab(t.id);
              setRailCollapsed(false);
            }}
            title={t.label}
          >
            {t.label.slice(0, 1)}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <nav className="rail-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={railTab === t.id ? 'active' : ''}
            onClick={() => setRailTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="rail-collapse"
          onClick={() => setRailCollapsed(true)}
          title="Collapse panel"
        >
          ›
        </button>
      </nav>

      {railTab === 'timing' && <WeatherStrip />}

      <div className="rail-content">
        {railTab === 'timing' && <TimingTower />}
        {railTab === 'strategy' && <StrategyPanel />}
        {railTab === 'radio' && <RadioPanel />}
        {railTab === 'system' && <SystemPanel />}
      </div>

      {railTab === 'timing' && (
        <div className="rail-footer">
          <h4>Team walls</h4>
          <div className="team-chips">
            {Object.entries(TEAM_PRESETS).map(([key, team]) => (
              <button key={key} type="button" className="btn btn-secondary" onClick={() => applyTeamPreset(key)}>
                {team.name}
              </button>
            ))}
          </div>
          {savedLayouts.length > 0 && (
            <>
              <h4>Saved layouts</h4>
              <div className="team-chips">
                {savedLayouts.map((l) => (
                  <button key={l.id} type="button" className="btn btn-secondary" onClick={() => setLayout(l)}>
                    {l.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
