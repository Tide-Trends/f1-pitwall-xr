import type { SyncConfig, StreamPanelState } from '@pitwall/shared';
import { DEFAULT_SYNC, REPLAY_SYNC, STREAM_LATENCY_DEFAULTS } from '@pitwall/shared';

export interface PlayerAdapter {
  id: string;
  getCurrentTime(): number;
  getBufferDepth(): number;
  setPlaybackRate(rate: number): void;
  seekTo(time: number): void;
  getTargetLatencyOffset(): number;
  setTargetLatencyOffset(offset: number): void;
}

export interface SyncEngineOptions {
  config?: Partial<SyncConfig>;
  onDriftCorrected?: (panelId: string, delta: number) => void;
}

export class SyncEngine {
  private config: SyncConfig;
  private players = new Map<string, PlayerAdapter>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onDriftCorrected?: (panelId: string, delta: number) => void;

  constructor(options: SyncEngineOptions = {}) {
    this.config = { ...DEFAULT_SYNC, ...options.config };
    this.onDriftCorrected = options.onDriftCorrected;
  }

  /** Switch between live broadcast delay and replay seek-sync */
  setReplayMode(enabled: boolean): void {
    this.config = enabled ? { ...REPLAY_SYNC } : { ...DEFAULT_SYNC };
    if (enabled) {
      for (const player of this.players.values()) {
        player.setTargetLatencyOffset(0);
      }
    }
  }

  /** Replay: hard-sync all panels to master video currentTime */
  syncReplayToMaster(): void {
    const master = this.players.get(this.config.masterPanelId);
    if (!master) return;
    const t = master.getCurrentTime();
    for (const [id, player] of this.players) {
      if (id === this.config.masterPanelId) continue;
      if (Math.abs(player.getCurrentTime() - t) > 0.25) {
        player.seekTo(t);
      }
    }
  }

  registerPlayer(player: PlayerAdapter): void {
    this.players.set(player.id, player);
    if (this.config.broadcastDelayMs === 0 && player.id !== this.config.masterPanelId) {
      const master = this.players.get(this.config.masterPanelId);
      if (master) {
        player.seekTo(master.getCurrentTime());
        player.setPlaybackRate(1);
      }
    }
  }

  unregisterPlayer(id: string): void {
    this.players.delete(id);
  }

  getConfig(): SyncConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<SyncConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  setDefaultLatencyForStream(panelId: string, identifier?: string): void {
    const player = this.players.get(panelId);
    if (!player) return;
    const key = identifier ?? 'INTERNATIONAL';
    const offset = STREAM_LATENCY_DEFAULTS[key] ?? this.config.globalTargetLatency;
    player.setTargetLatencyOffset(offset);
  }

  syncAllToMaster(): void {
    const master = this.players.get(this.config.masterPanelId);
    if (!master) return;

    const masterTime = master.getCurrentTime();
    for (const [id, player] of this.players) {
      if (id === this.config.masterPanelId) continue;
      const offset = player.getTargetLatencyOffset() - master.getTargetLatencyOffset();
      const target = masterTime - offset;
      const drift = Math.abs(player.getCurrentTime() - target);
      if (drift > this.config.maxDriftThresholdSec) {
        player.seekTo(target);
        this.onDriftCorrected?.(id, drift);
      }
    }
  }

  startAutoCorrection(intervalMs = 5000): void {
    this.stopAutoCorrection();
    this.intervalId = setInterval(() => {
      if (this.config.autoDriftCorrection) this.correctDrift();
    }, intervalMs);
  }

  stopAutoCorrection(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  correctDrift(): void {
    const master = this.players.get(this.config.masterPanelId);
    if (!master) return;

    const masterTime = master.getCurrentTime();
    for (const [id, player] of this.players) {
      if (id === this.config.masterPanelId) continue;
      const relativeOffset = player.getTargetLatencyOffset() - master.getTargetLatencyOffset();
      const expected = this.config.broadcastDelayMs === 0 ? masterTime : masterTime - relativeOffset;
      const drift = player.getCurrentTime() - expected;

      if (Math.abs(drift) <= this.config.maxDriftThresholdSec) {
        player.setPlaybackRate(1);
        continue;
      }

      if (this.config.broadcastDelayMs === 0) {
        if (Math.abs(drift) > 0.12) {
          player.seekTo(expected);
          this.onDriftCorrected?.(id, drift);
        } else {
          player.setPlaybackRate(drift > 0 ? 0.96 : 1.04);
        }
        continue;
      }

      if (Math.abs(drift) > 2) {
        player.seekTo(expected);
        this.onDriftCorrected?.(id, drift);
      } else {
        player.setPlaybackRate(drift > 0 ? 0.98 : 1.02);
      }
    }
  }

  nudgePanel(panelId: string, seconds: number): void {
    const player = this.players.get(panelId);
    if (!player) return;
    player.seekTo(player.getCurrentTime() + seconds);
  }

  getPanelStates(): StreamPanelState[] {
    return Array.from(this.players.values()).map((p) => ({
      id: p.id,
      streamKey: p.id,
      title: p.id,
      isPlaying: true,
      currentTime: p.getCurrentTime(),
      bufferDepth: p.getBufferDepth(),
      latencyOffset: p.getTargetLatencyOffset(),
      droppedFrames: 0,
      audioFocused: p.id === this.config.masterPanelId,
    }));
  }

  /** Apply broadcast delay to telemetry timestamps */
  delayTelemetryTimestamp(ts: number): number {
    return ts - this.config.broadcastDelayMs;
  }

  dispose(): void {
    this.stopAutoCorrection();
    this.players.clear();
  }
}

export class StreamDelayBuffer<T> {
  private buffer: { timestamp: number; payload: T }[] = [];
  private offsetMs = 0;

  setOffsetMs(ms: number): void {
    this.offsetMs = ms;
    if (ms === 0) this.buffer = [];
  }

  push(payload: T): T | null {
    if (this.offsetMs === 0) return payload;
    this.buffer.push({ timestamp: Date.now(), payload });
    return this.drain();
  }

  drain(): T | null {
    if (this.offsetMs === 0 || this.buffer.length === 0) return null;
    const cutoff = Date.now() - this.offsetMs;
    let released: T | null = null;
    while (this.buffer.length > 0 && this.buffer[0]!.timestamp <= cutoff) {
      released = this.buffer.shift()!.payload;
    }
    return released;
  }
}

export { DEFAULT_SYNC, REPLAY_SYNC, STREAM_LATENCY_DEFAULTS };
