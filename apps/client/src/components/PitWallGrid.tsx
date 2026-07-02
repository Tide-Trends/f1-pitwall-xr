import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Rnd } from 'react-rnd';
import type { PanelLayout, PlaybackBundle, StreamChannel } from '@pitwall/shared';
import { streamKey } from '@pitwall/shared';
import { useShakaPlayer } from '../hooks/useShakaPlayer';
import { pitwallApi } from '../lib/api';
import { getSyncEngine } from '../hooks/useSyncEngine';
import { useAppStore } from '../store/appStore';

const SNAP_PX = 12;

interface SnapGuides {
  v: number[];
  h: number[];
}

function StreamPanelInner({
  panel,
  channel,
  focused,
  onFocus,
  onToggleMute,
  onAspectLock,
  onEnlarge,
  onClose,
  loadDelayMs,
}: {
  panel: PanelLayout;
  channel: StreamChannel | undefined;
  focused: boolean;
  onFocus: () => void;
  onToggleMute: () => void;
  onAspectLock: () => void;
  onEnlarge: () => void;
  onClose: () => void;
  loadDelayMs: number;
}) {
  const [playback, setPlayback] = useState<PlaybackBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const audioFocus = useAppStore((s) => s.audioFocusPanelId);
  const isMaster = useAppStore((s) => s.syncConfig.masterPanelId) === panel.id;

  const onReady = useCallback(
    (adapter: import('@pitwall/sync-engine').PlayerAdapter) => {
      getSyncEngine().registerPlayer(adapter);
    },
    [],
  );

  const key = channel ? streamKey(channel) : panel.streamKey;
  const activeSession = useAppStore((s) => s.activeSession);
  const startTimeSec = activeSession?.isLive ? undefined : 30;
  const { videoRef, status } = useShakaPlayer(playback, onReady, panel.id, key, startTimeSec);

  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setPlayback(null);
    setError(null);
    const load = () => {
      pitwallApi
        .getPlayback(channel.contentId, channel.channelId)
        .then(({ playback: pb }) => {
          if (!cancelled) setPlayback(pb);
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    };
    if (loadDelayMs > 0) timer = setTimeout(load, loadDelayMs);
    else load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      getSyncEngine().unregisterPlayer(panel.id);
    };
  }, [channel, panel.id, reloadKey, loadDelayMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = panel.id !== audioFocus || panel.muted;
    video.volume = panel.volume;
  }, [audioFocus, panel.muted, panel.volume, panel.id, videoRef]);

  const displayError = error ?? (status.state === 'error' ? status.error : null);

  return (
    <div
      className={`stream-panel${focused ? ' focused' : ''}`}
      onClick={onFocus}
      onDoubleClick={onEnlarge}
    >
      <div className="stream-panel-header">
        <span className={`dot ${status.state === 'playing' ? 'live' : status.state === 'error' ? 'err' : 'load'}`} />
        <span className="stream-panel-title">
          {isMaster && <em title="Master feed">★ </em>}
          {channel?.title ?? panel.streamKey}
        </span>
        <span className="stream-panel-actions">
          {displayError && (
            <button
              type="button"
              title="Retry playback"
              onClick={(e) => {
                e.stopPropagation();
                setReloadKey((v) => v + 1);
              }}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            title={panel.aspectLock ? 'Unlock aspect ratio' : 'Lock 16:9'}
            className={panel.aspectLock ? 'on' : ''}
            onClick={(e) => {
              e.stopPropagation();
              onAspectLock();
            }}
          >
            ▭
          </button>
          <button
            type="button"
            title={panel.muted ? 'Unmute' : 'Mute'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute();
            }}
          >
            {panel.muted ? 'Muted' : 'Audio'}
          </button>
          <button
            type="button"
            title="Close stream"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            Close
          </button>
        </span>
      </div>
      <div className="stream-panel-body">
        {displayError ? (
          <div className="stream-panel-error">
            {displayError.includes('DRM') || displayError.includes('403') || displayError.includes('6001')
              ? 'DRM playback needs the desktop app (Widevine).'
              : displayError.slice(0, 120)}
          </div>
        ) : (
          <>
            {status.state === 'loading' && <div className="stream-panel-loading" />}
            <video ref={videoRef} autoPlay muted playsInline />
          </>
        )}
      </div>
    </div>
  );
}

export function PitWallGrid() {
  const layout = useAppStore((s) => s.layout);
  const activeSession = useAppStore((s) => s.activeSession);
  const audioFocusPanelId = useAppStore((s) => s.audioFocusPanelId);
  const updatePanel = useAppStore((s) => s.updatePanel);
  const setAudioFocus = useAppStore((s) => s.setAudioFocus);
  const setLayout = useAppStore((s) => s.setLayout);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [guides, setGuides] = useState<SnapGuides>({ v: [], h: [] });
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const focusMode = useAppStore((s) => s.focusMode);
  const syncConfig = useAppStore((s) => s.syncConfig);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: node.clientWidth, h: node.clientHeight });
    });
    ro.observe(node);
    setSize({ w: node.clientWidth, h: node.clientHeight });
    return () => ro.disconnect();
  }, []);

  const channelMap = useMemo(
    () => new Map(activeSession?.channels.map((c) => [streamKey(c), c]) ?? []),
    [activeSession],
  );

  const snapEdges = useCallback(
    (excludeId: string): SnapGuides => {
      if (!layout) return { v: [], h: [] };
      const v: number[] = [0, size.w / 2, size.w];
      const h: number[] = [0, size.h / 2, size.h];
      for (const p of layout.panels) {
        if (p.id === excludeId) continue;
        v.push(p.x * size.w, (p.x + p.width) * size.w);
        h.push(p.y * size.h, (p.y + p.height) * size.h);
      }
      return { v, h };
    },
    [layout, size],
  );

  const snap = (value: number, targets: number[]): { value: number; hit: number | null } => {
    for (const t of targets) {
      if (Math.abs(value - t) < SNAP_PX) return { value: t, hit: t };
    }
    return { value, hit: null };
  };

  if (!layout || !activeSession) return null;

  const visiblePanels = focusMode
    ? layout.panels.filter((p) => p.id === syncConfig.masterPanelId).slice(0, 1)
    : layout.panels;

  const removePanel = (panelId: string) => {
    const nextPanels = layout.panels.filter((p) => p.id !== panelId);
    setLayout({
      ...layout,
      panels: nextPanels,
      updatedAt: Date.now(),
    });
    if (audioFocusPanelId === panelId && nextPanels[0]) {
      setAudioFocus(nextPanels[0].id);
    }
    if (enlarged === panelId) setEnlarged(null);
  };

  const makePanelForChannel = (channel: StreamChannel, index: number): PanelLayout => {
    const key = streamKey(channel);
    const idBase = channel.racingNumber ? `obc-${channel.racingNumber}` : (channel.identifier ?? 'feed').toLowerCase();
    return {
      id: `${idBase}-${Date.now()}`,
      streamKey: key,
      x: 0.04 + (index % 4) * 0.04,
      y: 0.1 + (index % 5) * 0.045,
      width: channel.type === 'obc' ? 0.22 : 0.42,
      height: channel.type === 'obc' ? 0.22 : 0.32,
      zIndex: Math.max(1, ...layout.panels.map((p) => p.zIndex)) + 1,
      muted: layout.panels.length > 0,
      volume: layout.panels.length > 0 ? 0 : 1,
      targetLatencyOffset: channel.type === 'obc' ? 22 : 5,
      pinnedToDriver: channel.racingNumber,
      aspectLock: true,
    };
  };

  const addChannel = (channel: StreamChannel) => {
    const panel = makePanelForChannel(channel, layout.panels.length);
    setLayout({
      ...layout,
      panels: [...layout.panels, panel],
      updatedAt: Date.now(),
    });
    setAudioFocus(panel.id);
  };

  return (
    <div ref={containerRef} className={`pitwall-grid${focusMode ? ' focus-mode' : ''}`}>
      {focusMode && (
        <div className="focus-mode-banner">
          Focus mode — <button type="button" onClick={() => useAppStore.getState().setFocusMode(false)}>Exit</button>
        </div>
      )}

      {layout.panels.length === 0 && (
        <div className="wall-empty-state">
          <strong>No feeds on the wall</strong>
          <span>Pick a feed from the library on the left, or use ⌘K to search commands.</span>
          <div>
            {activeSession.channels.slice(0, 4).map((channel) => (
              <button key={streamKey(channel)} type="button" className="btn btn-secondary" onClick={() => addChannel(channel)}>
                {channel.racingNumber ? `#${channel.racingNumber}` : channel.identifier ?? 'Feed'}
              </button>
            ))}
          </div>
        </div>
      )}

      {guides.v.map((x) => (
        <div key={`v${x}`} className="snap-guide v" style={{ left: x }} />
      ))}
      {guides.h.map((y) => (
        <div key={`h${y}`} className="snap-guide h" style={{ top: y }} />
      ))}

      {visiblePanels.map((panel, index) => {
        const channel = channelMap.get(panel.streamKey);
        const isEnlarged = enlarged === panel.id || focusMode;
        const x = isEnlarged && !focusMode ? size.w * 0.075 : focusMode ? 0 : panel.x * size.w;
        const y = isEnlarged && !focusMode ? size.h * 0.075 : focusMode ? 0 : panel.y * size.h;
        const w = focusMode ? size.w : isEnlarged ? size.w * 0.85 : panel.width * size.w;
        const h = focusMode ? size.h : isEnlarged ? size.h * 0.85 : panel.height * size.h;

        return (
          <Rnd
            key={panel.id}
            size={{ width: w, height: h }}
            position={{ x, y }}
            bounds="parent"
            minWidth={140}
            minHeight={90}
            lockAspectRatio={panel.aspectLock ? 16 / 9 : false}
            dragHandleClassName="stream-panel-header"
            disableDragging={isEnlarged || focusMode}
            enableResizing={!isEnlarged && !focusMode}
            onDrag={(_e, d) => {
              const edges = snapEdges(panel.id);
              const activeV: number[] = [];
              const activeH: number[] = [];
              for (const edge of [d.x, d.x + w]) {
                const s = snap(edge, edges.v);
                if (s.hit != null) activeV.push(s.hit);
              }
              for (const edge of [d.y, d.y + h]) {
                const s = snap(edge, edges.h);
                if (s.hit != null) activeH.push(s.hit);
              }
              setGuides({ v: activeV, h: activeH });
            }}
            onDragStop={(_e, d) => {
              setGuides({ v: [], h: [] });
              const edges = snapEdges(panel.id);
              let nx = snap(d.x, edges.v).value;
              const rightSnap = snap(d.x + w, edges.v);
              if (rightSnap.hit != null && nx === d.x) nx = rightSnap.value - w;
              let ny = snap(d.y, edges.h).value;
              const bottomSnap = snap(d.y + h, edges.h);
              if (bottomSnap.hit != null && ny === d.y) ny = bottomSnap.value - h;
              updatePanel(panel.id, { x: nx / size.w, y: ny / size.h });
            }}
            onResizeStop={(_e, _dir, ref, _delta, pos) => {
              setGuides({ v: [], h: [] });
              updatePanel(panel.id, {
                width: ref.offsetWidth / size.w,
                height: ref.offsetHeight / size.h,
                x: pos.x / size.w,
                y: pos.y / size.h,
              });
            }}
            style={{ zIndex: isEnlarged ? 500 : panel.zIndex }}
          >
            <StreamPanelInner
              panel={panel}
              channel={channel}
              focused={audioFocusPanelId === panel.id}
              onFocus={() => setAudioFocus(panel.id)}
              onToggleMute={() => updatePanel(panel.id, { muted: !panel.muted })}
              onAspectLock={() => updatePanel(panel.id, { aspectLock: !panel.aspectLock })}
              onEnlarge={() => setEnlarged(isEnlarged && !focusMode ? null : panel.id)}
              onClose={() => removePanel(panel.id)}
              loadDelayMs={index * 1800}
            />
          </Rnd>
        );
      })}

      {enlarged && !focusMode && <div className="enlarge-backdrop" onClick={() => setEnlarged(null)} />}
    </div>
  );
}
