import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { pitwallApi } from '../lib/api';
import { CIRCUIT_NAME_MAP } from '@pitwall/shared';

export function useTelemetryPolling(_masterVideoTime?: number) {
  const activeSession = useAppStore((s) => s.activeSession);
  const isReplay = useAppStore((s) => s.isReplay);
  const setTelemetry = useAppStore((s) => s.setTelemetry);
  const setCircuitGeoId = useAppStore((s) => s.setCircuitGeoId);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!activeSession) return;

    const circuitName = activeSession.circuitShortName;
    const geoId = Object.entries(CIRCUIT_NAME_MAP).find(([k]) =>
      circuitName.toLowerCase().includes(k.toLowerCase()) ||
      k.toLowerCase().includes(circuitName.toLowerCase()),
    )?.[1];
    if (geoId) setCircuitGeoId(geoId);

    if (isReplay && activeSession.openF1SessionKey) {
      const poll = () => {
        const t = useAppStore.getState().masterTime;
        pitwallApi
          .replayTelemetry(activeSession.openF1SessionKey!, t)
          .then(({ snapshot }) => setTelemetry(snapshot))
          .catch(() => {});
      };
      poll();
      const id = setInterval(poll, 1000);
      return () => clearInterval(id);
    }

    if (isReplay) return;

    // Live: WebSocket via Vite proxy → API server
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/telemetry`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'telemetry' || msg.updates) {
          const snapshot = msg.snapshot ?? parseLiveTelemetry(msg.updates);
          if (snapshot) setTelemetry(snapshot);
        }
      } catch { /* ignore */ }
    };

    return () => {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [activeSession, isReplay, setTelemetry, setCircuitGeoId]);
}

function parseLiveTelemetry(updates: Record<string, unknown>): import('@pitwall/shared').TelemetrySnapshot | null {
  if (!updates) return null;

  const positions: import('@pitwall/shared').DriverPosition[] = [];
  const posData = updates['Position.z'] as { Position?: { Entries?: Record<string, { X: number; Y: number; Z?: number }> }[] } | undefined;
  if (posData?.Position?.length) {
    const latest = posData.Position[posData.Position.length - 1];
    for (const [num, p] of Object.entries(latest?.Entries ?? {})) {
      positions.push({
        racingNumber: Number(num),
        x: p.X,
        y: p.Y,
        z: p.Z ?? 0,
        timestamp: new Date().toISOString(),
      });
    }
  }

  const timing: import('@pitwall/shared').DriverTiming[] = [];
  const timingData = updates['TimingData'] as { Lines?: Record<string, Record<string, unknown>> } | undefined;
  if (timingData?.Lines) {
    for (const [num, line] of Object.entries(timingData.Lines)) {
      timing.push({
        racingNumber: Number(num),
        position: Number(line.Position ?? 0),
        gapToLeader: String(line.GapToLeader ?? ''),
        interval: String(line.IntervalToPositionAhead ?? ''),
        lastLapTime: String((line.LastLapTime as Record<string, unknown> | undefined)?.LapTime ?? line.LastLapTime ?? ''),
        compound: String((line as Record<string, unknown>).Compound ?? ''),
        name: String(line.BroadcastName ?? num),
        tla: String(line.Tla ?? num),
        inPit: line.InPit === true,
      });
    }
    timing.sort((a, b) => a.position - b.position);
  }

  const rc: import('@pitwall/shared').RaceControlMessage[] = [];
  const rcData = updates['RaceControlMessages'] as { Messages?: Record<string, unknown>[] } | undefined;
  if (rcData?.Messages) {
    for (const m of rcData.Messages.slice(-10)) {
      rc.push({
        time: String(m.Time ?? ''),
        message: String(m.Message ?? ''),
        category: String(m.Category ?? ''),
      });
    }
  }

  return {
    positions,
    timing,
    raceControl: rc,
    trackStatus: String((updates['TrackStatus'] as { Status?: string })?.Status ?? ''),
    timestamp: Date.now(),
  };
}
