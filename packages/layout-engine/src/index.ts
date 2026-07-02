import type { LayoutPreset, PanelLayout, SpatialPanelLayout, StreamChannel } from '@pitwall/shared';
import { streamKey, TEAM_PRESETS } from '@pitwall/shared';

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createDefaultDesktopLayout(channels: StreamChannel[]): LayoutPreset {
  const main = channels.find((c) => c.identifier === 'INTERNATIONAL' || c.type === 'main') ?? channels[0];
  const data = channels.find((c) => c.identifier === 'DATA');
  const tracker = channels.find((c) => c.identifier === 'TRACKER');
  const obcs = channels.filter((c) => c.type === 'obc').slice(0, 2);

  const panels: PanelLayout[] = [];

  if (main) {
    panels.push({
      id: 'main',
      streamKey: streamKey(main),
      x: 0.15,
      y: 0.05,
      width: 0.7,
      height: 0.55,
      zIndex: 1,
      muted: false,
      volume: 1,
      targetLatencyOffset: 5,
    });
  }

  if (data) {
    panels.push({
      id: 'data',
      streamKey: streamKey(data),
      x: 0.02,
      y: 0.65,
      width: 0.35,
      height: 0.3,
      zIndex: 2,
      muted: true,
      volume: 0,
      targetLatencyOffset: 30,
    });
  }

  if (tracker) {
    panels.push({
      id: 'tracker',
      streamKey: streamKey(tracker),
      x: 0.63,
      y: 0.65,
      width: 0.35,
      height: 0.3,
      zIndex: 2,
      muted: true,
      volume: 0,
      targetLatencyOffset: 15,
    });
  }

  obcs.forEach((obc, i) => {
    panels.push({
      id: `obc-${obc.racingNumber ?? i}`,
      streamKey: streamKey(obc),
      x: i === 0 ? 0.02 : 0.82,
      y: 0.05,
      width: 0.13,
      height: 0.25,
      zIndex: 3,
      muted: true,
      volume: 0,
      targetLatencyOffset: 22,
    });
  });

  return {
    id: uid(),
    name: 'Default Pit Wall',
    mode: 'desktop',
    panels,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createTeamLayout(
  teamKey: string,
  channels: StreamChannel[],
): LayoutPreset | null {
  const team = TEAM_PRESETS[teamKey];
  if (!team) return null;

  const base = createDefaultDesktopLayout(channels);
  const driverChannels = team.drivers
    .map((num) => channels.find((c) => c.racingNumber === num))
    .filter(Boolean) as StreamChannel[];

  const panels = base.panels.filter((p) => !p.id.startsWith('obc-'));

  driverChannels.forEach((obc, i) => {
    panels.push({
      id: `obc-${obc.racingNumber}`,
      streamKey: streamKey(obc),
      x: i === 0 ? 0.02 : 0.82,
      y: 0.05,
      width: 0.13,
      height: 0.25,
      zIndex: 3,
      muted: true,
      volume: 0,
      targetLatencyOffset: 22,
      pinnedToDriver: obc.racingNumber,
    });
  });

  return {
    ...base,
    id: uid(),
    name: `${team.name} Wall`,
    panels,
    updatedAt: Date.now(),
  };
}

export function createSpatialVrLayout(channels: StreamChannel[]): LayoutPreset {
  const main = channels.find((c) => c.type === 'main') ?? channels[0];
  const obcs = channels.filter((c) => c.type === 'obc').slice(0, 2);
  const data = channels.find((c) => c.identifier === 'DATA');

  const panels: SpatialPanelLayout[] = [];

  if (main) {
    panels.push({
      id: 'main',
      streamKey: streamKey(main),
      x: 0, y: 0, width: 1.6, height: 0.9, zIndex: 1,
      position: [0, 1.5, -2.5],
      rotation: [0, 0, 0],
      scale: [1.6, 0.9, 1],
      muted: false,
      volume: 1,
      targetLatencyOffset: 5,
    });
  }

  obcs.forEach((obc, i) => {
    panels.push({
      id: `obc-${obc.racingNumber}`,
      streamKey: streamKey(obc),
      x: 0, y: 0, width: 0.5, height: 0.28, zIndex: 2,
      position: [i === 0 ? -1.8 : 1.8, 1.2, -2],
      rotation: [0, i === 0 ? 0.3 : -0.3, 0],
      scale: [0.5, 0.28, 1],
      muted: true,
      volume: 0,
      targetLatencyOffset: 22,
      pinnedToDriver: obc.racingNumber,
    });
  });

  if (data) {
    panels.push({
      id: 'data',
      streamKey: streamKey(data),
      x: 0, y: 0, width: 0.8, height: 0.45, zIndex: 2,
      position: [0, 2.0, -2.2],
      rotation: [0, 0, 0],
      scale: [0.8, 0.45, 1],
      muted: true,
      volume: 0,
      targetLatencyOffset: 30,
    });
  }

  return {
    id: uid(),
    name: 'VR Immersive',
    mode: 'vr',
    panels,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export class LayoutStore {
  private presets: LayoutPreset[] = [];

  constructor(initial: LayoutPreset[] = []) {
    this.presets = initial;
  }

  list(): LayoutPreset[] {
    return [...this.presets];
  }

  get(id: string): LayoutPreset | undefined {
    return this.presets.find((p) => p.id === id);
  }

  save(preset: LayoutPreset): LayoutPreset {
    const idx = this.presets.findIndex((p) => p.id === preset.id);
    const updated = { ...preset, updatedAt: Date.now() };
    if (idx >= 0) this.presets[idx] = updated;
    else this.presets.push(updated);
    return updated;
  }

  remove(id: string): void {
    this.presets = this.presets.filter((p) => p.id !== id);
  }

  toJSON(): string {
    return JSON.stringify(this.presets, null, 2);
  }

  static fromJSON(json: string): LayoutStore {
    return new LayoutStore(JSON.parse(json) as LayoutPreset[]);
  }
}
