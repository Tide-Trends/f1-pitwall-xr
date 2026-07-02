import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import {
  useSessionKey,
  useStints,
  usePitStops,
  useLaps,
  type OpenF1Lap,
} from '../../hooks/useOpenF1';

const COMPOUND_COLORS: Record<string, string> = {
  SOFT: '#ff375f',
  MEDIUM: '#ffd60a',
  HARD: '#f2f2f7',
  INTERMEDIATE: '#30d158',
  WET: '#0a84ff',
};

/** Time a pit stop costs vs staying out — undercut threat window */
const PIT_LOSS_SEC = 22;

export function StrategyPanel() {
  const sessionKey = useSessionKey();
  const telemetry = useAppStore((s) => s.telemetry);
  const stints = useStints(sessionKey);
  const pits = usePitStops(sessionKey);
  const laps = useLaps(sessionKey);
  const [section, setSection] = useState<'stints' | 'undercut' | 'quali'>('stints');

  if (!sessionKey) {
    return (
      <div className="rail-empty">
        <span className="rail-empty-icon">⟟</span>
        <p>Strategy data is available for replay sessions matched to OpenF1.</p>
      </div>
    );
  }

  return (
    <div className="strategy-panel">
      <div className="seg-control">
        {(['stints', 'undercut', 'quali'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={section === s ? 'active' : ''}
            onClick={() => setSection(s)}
          >
            {s === 'stints' ? 'Stints' : s === 'undercut' ? 'Undercut' : 'Quali'}
          </button>
        ))}
      </div>

      {section === 'stints' && <StintsChart stints={stints} pits={pits} timing={telemetry?.timing ?? []} />}
      {section === 'undercut' && <UndercutRadar timing={telemetry?.timing ?? []} laps={laps} />}
      {section === 'quali' && <QualiCompare laps={laps} timing={telemetry?.timing ?? []} />}
    </div>
  );
}

function StintsChart({
  stints,
  pits,
  timing,
}: {
  stints: ReturnType<typeof useStints>;
  pits: ReturnType<typeof usePitStops>;
  timing: import('@pitwall/shared').DriverTiming[];
}) {
  const byDriver = useMemo(() => {
    const m = new Map<number, typeof stints>();
    for (const s of stints) {
      if (!m.has(s.driver_number)) m.set(s.driver_number, []);
      m.get(s.driver_number)!.push(s);
    }
    return m;
  }, [stints]);

  const maxLap = useMemo(
    () => Math.max(1, ...stints.map((s) => s.lap_end || s.lap_start)),
    [stints],
  );

  const order = timing.length
    ? timing.map((t) => t.racingNumber)
    : Array.from(byDriver.keys());
  const tlaOf = (num: number) => timing.find((t) => t.racingNumber === num)?.tla ?? `#${num}`;

  if (stints.length === 0) {
    return <div className="rail-empty"><p>No stint data yet.</p></div>;
  }

  return (
    <div className="stints-chart">
      {order.map((num) => {
        const driverStints = byDriver.get(num);
        if (!driverStints?.length) return null;
        const driverPits = pits.filter((p) => p.driver_number === num);
        return (
          <div key={num} className="stint-row">
            <span className="stint-tla">{tlaOf(num)}</span>
            <div className="stint-bars">
              {driverStints.map((s) => {
                const compound = (s.compound ?? '').toUpperCase();
                const left = ((s.lap_start - 1) / maxLap) * 100;
                const width = Math.max(1.5, ((s.lap_end - s.lap_start + 1) / maxLap) * 100);
                return (
                  <span
                    key={s.stint_number}
                    className="stint-bar"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: COMPOUND_COLORS[compound] ?? '#8e8e93',
                    }}
                    title={`${compound} · L${s.lap_start}–L${s.lap_end} (age ${s.tyre_age_at_start})`}
                  />
                );
              })}
            </div>
            <span className="stint-pits">{driverPits.length ? `${driverPits.length}⛛` : ''}</span>
          </div>
        );
      })}
      <div className="stint-legend">
        {Object.entries(COMPOUND_COLORS).map(([name, color]) => (
          <span key={name}>
            <i style={{ background: color }} />
            {name.slice(0, 1)}
          </span>
        ))}
      </div>
    </div>
  );
}

function UndercutRadar({
  timing,
  laps,
}: {
  timing: import('@pitwall/shared').DriverTiming[];
  laps: OpenF1Lap[];
}) {
  const threats = useMemo(() => {
    const out: {
      attacker: string;
      defender: string;
      gap: number;
      severity: 'high' | 'medium';
    }[] = [];
    for (let i = 1; i < timing.length; i++) {
      const behind = timing[i];
      const ahead = timing[i - 1];
      const gapStr = behind.interval ?? behind.gapToLeader ?? '';
      const gap = parseFloat(String(gapStr).replace('+', ''));
      if (!isFinite(gap)) continue;
      if (gap < PIT_LOSS_SEC) {
        out.push({
          attacker: behind.tla,
          defender: ahead.tla,
          gap,
          severity: gap < PIT_LOSS_SEC * 0.5 ? 'high' : 'medium',
        });
      }
    }
    return out;
  }, [timing]);

  const paceDelta = useMemo(() => {
    // Last-3-lap average pace per driver — who is fastest right now
    const byDriver = new Map<number, number[]>();
    for (const lap of laps) {
      if (!lap.lap_duration || lap.is_pit_out_lap) continue;
      if (!byDriver.has(lap.driver_number)) byDriver.set(lap.driver_number, []);
      byDriver.get(lap.driver_number)!.push(lap.lap_duration);
    }
    const avg = new Map<number, number>();
    for (const [num, times] of byDriver) {
      const recent = times.slice(-3);
      avg.set(num, recent.reduce((a, b) => a + b, 0) / recent.length);
    }
    return avg;
  }, [laps]);

  if (timing.length === 0) {
    return <div className="rail-empty"><p>Undercut radar needs live timing.</p></div>;
  }

  return (
    <div className="undercut-radar">
      <p className="rail-hint">
        Cars within the ~{PIT_LOSS_SEC}s pit window of the car ahead — undercut threats.
      </p>
      {threats.length === 0 && <div className="rail-empty"><p>No undercut threats right now.</p></div>}
      {threats.map((t, i) => {
        const attackerNum = timing.find((d) => d.tla === t.attacker)?.racingNumber;
        const defenderNum = timing.find((d) => d.tla === t.defender)?.racingNumber;
        const aPace = attackerNum ? paceDelta.get(attackerNum) : undefined;
        const dPace = defenderNum ? paceDelta.get(defenderNum) : undefined;
        const paceEdge = aPace && dPace ? dPace - aPace : 0;
        return (
          <div key={i} className={`uc-threat ${t.severity}`}>
            <div className="uc-pair">
              <strong>{t.attacker}</strong>
              <span className="uc-arrow">→</span>
              <strong>{t.defender}</strong>
            </div>
            <div className="uc-meta">
              <span>{t.gap.toFixed(1)}s gap</span>
              {paceEdge !== 0 && (
                <span className={paceEdge > 0 ? 'uc-faster' : 'uc-slower'}>
                  {paceEdge > 0 ? '+' : ''}
                  {paceEdge.toFixed(2)}s/lap pace
                </span>
              )}
            </div>
            <div className="uc-window">
              <span style={{ width: `${Math.min(100, (1 - t.gap / PIT_LOSS_SEC) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QualiCompare({
  laps,
  timing,
}: {
  laps: OpenF1Lap[];
  timing: import('@pitwall/shared').DriverTiming[];
}) {
  const compareDrivers = useAppStore((s) => s.compareDrivers);
  const setCompareDrivers = useAppStore((s) => s.setCompareDrivers);

  const drivers = useMemo(() => {
    const nums = new Set(laps.map((l) => l.driver_number));
    return Array.from(nums).map((num) => ({
      num,
      tla: timing.find((t) => t.racingNumber === num)?.tla ?? `#${num}`,
    }));
  }, [laps, timing]);

  const best = (num: number | null) => {
    if (num == null) return null;
    let bestLap: OpenF1Lap | null = null;
    for (const lap of laps) {
      if (lap.driver_number !== num || !lap.lap_duration) continue;
      if (!bestLap || lap.lap_duration < (bestLap.lap_duration ?? Infinity)) bestLap = lap;
    }
    return bestLap;
  };

  const [a, b] = compareDrivers;
  const lapA = best(a);
  const lapB = best(b);

  const fmt = (s: number | null | undefined) => {
    if (s == null) return '—';
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}:${(s % 60).toFixed(3).padStart(6, '0')}` : s.toFixed(3);
  };

  const sectorDelta = (sA: number | null, sB: number | null) => {
    if (sA == null || sB == null) return null;
    return sA - sB;
  };

  return (
    <div className="quali-compare">
      <div className="qc-selectors">
        <select
          value={a ?? ''}
          onChange={(e) => setCompareDrivers([e.target.value ? Number(e.target.value) : null, b])}
        >
          <option value="">Driver A</option>
          {drivers.map((d) => (
            <option key={d.num} value={d.num}>{d.tla}</option>
          ))}
        </select>
        <span className="qc-vs">vs</span>
        <select
          value={b ?? ''}
          onChange={(e) => setCompareDrivers([a, e.target.value ? Number(e.target.value) : null])}
        >
          <option value="">Driver B</option>
          {drivers.map((d) => (
            <option key={d.num} value={d.num}>{d.tla}</option>
          ))}
        </select>
      </div>

      {lapA && lapB ? (
        <div className="qc-table">
          <div className="qc-row qc-head">
            <span />
            <span>{drivers.find((d) => d.num === a)?.tla}</span>
            <span>{drivers.find((d) => d.num === b)?.tla}</span>
            <span>Δ</span>
          </div>
          {([
            ['Lap', lapA.lap_duration, lapB.lap_duration],
            ['S1', lapA.duration_sector_1, lapB.duration_sector_1],
            ['S2', lapA.duration_sector_2, lapB.duration_sector_2],
            ['S3', lapA.duration_sector_3, lapB.duration_sector_3],
          ] as const).map(([label, tA, tB]) => {
            const delta = sectorDelta(tA, tB);
            return (
              <div key={label} className="qc-row">
                <span className="qc-label">{label}</span>
                <span className={delta != null && delta < 0 ? 'qc-best' : ''}>{fmt(tA)}</span>
                <span className={delta != null && delta > 0 ? 'qc-best' : ''}>{fmt(tB)}</span>
                <span className="qc-delta">
                  {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(3)}` : '—'}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rail-empty"><p>Pick two drivers to compare best laps and sectors.</p></div>
      )}
    </div>
  );
}
