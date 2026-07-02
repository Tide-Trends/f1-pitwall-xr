import { useAppStore } from '../../store/appStore';

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: '#ff375f',
  MEDIUM: '#ffd60a',
  HARD: '#f2f2f7',
  INTERMEDIATE: '#30d158',
  WET: '#0a84ff',
};

export function TimingTower() {
  const telemetry = useAppStore((s) => s.telemetry);
  const pinnedDriver = useAppStore((s) => s.pinnedDriver);
  const setPinnedDriver = useAppStore((s) => s.setPinnedDriver);
  const timing = telemetry?.timing ?? [];

  if (timing.length === 0) {
    return (
      <div className="rail-empty">
        <span className="rail-empty-icon">◍</span>
        <p>Timing appears once telemetry syncs with the video.</p>
      </div>
    );
  }

  return (
    <div className="timing-tower">
      {timing.map((d) => {
        const compound = (d.compound ?? '').toUpperCase();
        const cColor = COMPOUND_COLORS[compound];
        const pinned = pinnedDriver === d.racingNumber;
        return (
          <button
            type="button"
            key={d.racingNumber}
            className={`tt-row${pinned ? ' pinned' : ''}`}
            onClick={() => setPinnedDriver(pinned ? null : d.racingNumber)}
            title={pinned ? 'Unpin camera' : `Pin track camera to ${d.tla}`}
          >
            <span className="tt-pos">{d.position}</span>
            <span
              className="tt-team-bar"
              style={{ background: d.teamColor ? `#${d.teamColor.replace('#', '')}` : '#666' }}
            />
            <span className="tt-tla">{d.tla}</span>
            <span className="tt-gap">{d.gapToLeader || d.interval || '—'}</span>
            <span className="tt-lap">{d.lastLapTime ?? ''}</span>
            <span className="tt-compound" style={cColor ? { color: cColor } : undefined}>
              {compound ? compound.slice(0, 1) : ''}
              {d.stintAge != null ? <em>{d.stintAge}</em> : null}
            </span>
            {d.drs && <span className="tt-drs">DRS</span>}
            {d.inPit && <span className="tt-pit">PIT</span>}
            {pinned && <span className="tt-pin">◉</span>}
          </button>
        );
      })}
      <p className="rail-hint">Click a driver to pin the 3D track camera to their car.</p>
    </div>
  );
}
