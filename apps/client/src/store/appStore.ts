import { create } from 'zustand';
import type {
  AuthTokens,
  LayoutPreset,
  PanelLayout,
  RaceMeeting,
  RaceSessionSummary,
  SyncConfig,
  TelemetrySnapshot,
  ViewingSession,
} from '@pitwall/shared';
import { DEFAULT_SYNC, REPLAY_SYNC } from '@pitwall/shared';
import { createDefaultDesktopLayout } from '@pitwall/layout-engine';
import { clearStoredTokens, loadStoredTokens, saveStoredTokens } from '../lib/api';
import { defaultVRPanels, VR_SLOTS, type VRPanelState } from '../lib/vrSlots';
import type { ShakaStatus } from '../hooks/useShakaPlayer';

export type AppMode = 'desktop' | 'spatial' | 'vr';
export type SessionTab = 'live' | 'replay';
export type RailTab = 'timing' | 'strategy' | 'radio' | 'system';

export interface TrackTransform {
  position: [number, number, number];
  rotationY: number;
  scale: number;
}

interface AppState {
  railTab: RailTab;
  railCollapsed: boolean;
  feedRailCollapsed: boolean;
  commandPaletteOpen: boolean;
  focusMode: boolean;
  pinnedDriver: number | null;
  masterTime: number;
  showSyncWizard: boolean;
  compareDrivers: [number | null, number | null];
  vrPanels: Record<string, VRPanelState>;
  vrStreamStatuses: Record<string, ShakaStatus>;
  vrSelectorSlot: string | null;
  trackTransform: TrackTransform;
  trackDockVisible: boolean;

  authenticated: boolean;
  userId: string;
  tokens: AuthTokens | null;

  mode: AppMode;
  sessionTab: SessionTab;
  replaySeason: number;
  immersiveBg: boolean;

  liveSessions: RaceSessionSummary[];
  replayMeetings: RaceMeeting[];
  replaySessions: RaceSessionSummary[];
  activeSession: ViewingSession | null;
  isReplay: boolean;

  layout: LayoutPreset | null;
  savedLayouts: LayoutPreset[];

  syncConfig: SyncConfig;
  audioFocusPanelId: string;

  telemetry: TelemetrySnapshot | null;
  circuitGeoId: string | null;

  loading: boolean;
  error: string | null;

  setAuthenticated: (tokens: AuthTokens) => void;
  logout: () => void;
  setMode: (mode: AppMode) => void;
  setSessionTab: (tab: SessionTab) => void;
  setReplaySeason: (year: number) => void;
  setImmersiveBg: (v: boolean) => void;
  setActiveSession: (session: ViewingSession, isReplay: boolean) => void;
  setLayout: (layout: LayoutPreset) => void;
  updatePanel: (id: string, patch: Partial<PanelLayout>) => void;
  setSavedLayouts: (layouts: LayoutPreset[]) => void;
  setSyncConfig: (patch: Partial<SyncConfig>) => void;
  setAudioFocus: (panelId: string) => void;
  setTelemetry: (t: TelemetrySnapshot | null) => void;
  setCircuitGeoId: (id: string | null) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
  setLiveSessions: (s: RaceSessionSummary[]) => void;
  setReplayMeetings: (m: RaceMeeting[]) => void;
  setReplaySessions: (s: RaceSessionSummary[]) => void;
  setRailTab: (tab: RailTab) => void;
  setRailCollapsed: (v: boolean) => void;
  setFeedRailCollapsed: (v: boolean) => void;
  setCommandPaletteOpen: (v: boolean) => void;
  setFocusMode: (v: boolean) => void;
  setPinnedDriver: (num: number | null) => void;
  setMasterTime: (t: number) => void;
  setShowSyncWizard: (v: boolean) => void;
  setCompareDrivers: (d: [number | null, number | null]) => void;
  upsertVRPanel: (panel: VRPanelState) => void;
  removeVRPanel: (id: string) => void;
  assignVRSlot: (slotId: string, streamKey: string) => void;
  setVRStreamStatus: (streamKey: string, status: ShakaStatus) => void;
  setVRSelectorSlot: (slotId: string | null) => void;
  setTrackTransform: (patch: Partial<TrackTransform>) => void;
  setTrackDockVisible: (v: boolean) => void;
}

const bootTokens = loadStoredTokens();

export const useAppStore = create<AppState>((set, get) => ({
  railTab: 'timing',
  railCollapsed: true,
  feedRailCollapsed: false,
  commandPaletteOpen: false,
  focusMode: false,
  pinnedDriver: null,
  masterTime: 0,
  showSyncWizard: false,
  compareDrivers: [null, null],
  vrPanels: defaultVRPanels(),
  vrStreamStatuses: {},
  vrSelectorSlot: null,
  trackTransform: { position: [0, 0, 0], rotationY: 0, scale: 1 },
  trackDockVisible: false,
  authenticated: !!bootTokens,
  userId: 'default',
  tokens: bootTokens,
  mode: 'desktop',
  sessionTab: 'replay',
  replaySeason: 2025,
  immersiveBg: false,
  liveSessions: [],
  replayMeetings: [],
  replaySessions: [],
  activeSession: null,
  isReplay: true,
  layout: null,
  savedLayouts: [],
  syncConfig: { ...REPLAY_SYNC },
  audioFocusPanelId: 'main',
  telemetry: null,
  circuitGeoId: null,
  loading: false,
  error: null,

  setAuthenticated: (tokens) => {
    saveStoredTokens(tokens);
    set({ authenticated: true, tokens });
  },
  logout: () => {
    clearStoredTokens();
    set({
      authenticated: false,
      tokens: null,
      activeSession: null,
      layout: null,
    });
  },
  setMode: (mode) => set({ mode }),
  setSessionTab: (tab) => set({ sessionTab: tab }),
  setReplaySeason: (year) => set({ replaySeason: year }),
  setImmersiveBg: (v) => set({ immersiveBg: v }),
  setActiveSession: (session, isReplay) => {
    const layout = createDefaultDesktopLayout(session.channels);
    set({
      activeSession: session,
      isReplay,
      layout,
      syncConfig: isReplay ? { ...REPLAY_SYNC } : { ...DEFAULT_SYNC },
      audioFocusPanelId: 'main',
    });
  },
  setLayout: (layout) => {
    const currentMaster = get().syncConfig.masterPanelId;
    const nextMaster = layout.panels.some((p) => p.id === currentMaster)
      ? currentMaster
      : layout.panels[0]?.id ?? 'main';
    set({
      layout,
      audioFocusPanelId: nextMaster,
      syncConfig: { ...get().syncConfig, masterPanelId: nextMaster },
    });
  },
  updatePanel: (id, patch) => {
    const layout = get().layout;
    if (!layout) return;
    set({
      layout: {
        ...layout,
        panels: layout.panels.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      },
    });
  },
  setSavedLayouts: (layouts) => set({ savedLayouts: layouts }),
  setSyncConfig: (patch) => set({ syncConfig: { ...get().syncConfig, ...patch } }),
  setAudioFocus: (panelId) =>
    set({
      audioFocusPanelId: panelId,
      syncConfig: { ...get().syncConfig, masterPanelId: panelId },
    }),
  setTelemetry: (t) => set({ telemetry: t }),
  setCircuitGeoId: (id) => set({ circuitGeoId: id }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
  setLiveSessions: (s) => set({ liveSessions: s }),
  setReplayMeetings: (m) => set({ replayMeetings: m }),
  setReplaySessions: (s) => set({ replaySessions: s }),
  setRailTab: (tab) => set({ railTab: tab }),
  setRailCollapsed: (v) => set({ railCollapsed: v }),
  setFeedRailCollapsed: (v) => set({ feedRailCollapsed: v }),
  setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
  setFocusMode: (v) => set({ focusMode: v }),
  setPinnedDriver: (num) => set({ pinnedDriver: num }),
  setMasterTime: (t) => set({ masterTime: t }),
  setShowSyncWizard: (v) => set({ showSyncWizard: v }),
  setCompareDrivers: (d) => set({ compareDrivers: d }),
  upsertVRPanel: (panel) =>
    set({ vrPanels: { ...get().vrPanels, [panel.id]: panel } }),
  removeVRPanel: (id) => {
    const next = { ...get().vrPanels };
    delete next[id];
    set({ vrPanels: next });
  },
  assignVRSlot: (slotId, streamKey) => {
    const slot = VR_SLOTS.find((s) => s.id === slotId);
    if (!slot) return;
    const existing = Object.values(get().vrPanels).find((p) => p.slotId === slotId);
    const id = existing?.id ?? `vr-${slotId}-${Date.now()}`;
    set({
      vrPanels: {
        ...get().vrPanels,
        [id]: {
          id,
          streamKey,
          slotId,
          theta: slot.theta,
          height: slot.height,
          distance: slot.distance,
          scale: slot.scale,
        },
      },
      vrSelectorSlot: null,
    });
  },
  setVRStreamStatus: (streamKey, status) =>
    set({ vrStreamStatuses: { ...get().vrStreamStatuses, [streamKey]: status } }),
  setVRSelectorSlot: (slotId) => set({ vrSelectorSlot: slotId }),
  setTrackTransform: (patch) =>
    set({ trackTransform: { ...get().trackTransform, ...patch } }),
  setTrackDockVisible: (v) => set({ trackDockVisible: v }),
}));
