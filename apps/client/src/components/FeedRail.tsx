import { useMemo } from 'react';
import type { StreamChannel } from '@pitwall/shared';
import { streamKey } from '@pitwall/shared';
import { useAppStore } from '../store/appStore';

function channelGroups(channels: StreamChannel[]) {
  return [
    {
      label: 'Broadcast',
      channels: channels.filter((c) => c.type !== 'obc' && c.identifier !== 'DATA' && c.identifier !== 'TRACKER'),
    },
    {
      label: 'Data',
      channels: channels.filter((c) => c.identifier === 'DATA' || c.identifier === 'TRACKER'),
    },
    {
      label: 'Onboards',
      channels: channels.filter((c) => c.type === 'obc'),
    },
  ].filter((g) => g.channels.length > 0);
}

export function FeedRail() {
  const activeSession = useAppStore((s) => s.activeSession);
  const layout = useAppStore((s) => s.layout);
  const feedRailCollapsed = useAppStore((s) => s.feedRailCollapsed);
  const setFeedRailCollapsed = useAppStore((s) => s.setFeedRailCollapsed);
  const setLayout = useAppStore((s) => s.setLayout);
  const setAudioFocus = useAppStore((s) => s.setAudioFocus);

  const groups = useMemo(
    () => channelGroups(activeSession?.channels ?? []),
    [activeSession?.channels],
  );

  if (!activeSession || !layout) return null;

  const activeStreamKeys = new Set(layout.panels.map((p) => p.streamKey));
  const availableCount = activeSession.channels.filter((c) => !activeStreamKeys.has(streamKey(c))).length;

  const makePanelForChannel = (channel: StreamChannel, index: number) => {
    const key = streamKey(channel);
    const idBase = channel.racingNumber ? `obc-${channel.racingNumber}` : (channel.identifier ?? 'feed').toLowerCase();
    return {
      id: `${idBase}-${Date.now()}-${index}`,
      streamKey: key,
      x: 0.04 + (index % 4) * 0.04,
      y: 0.1 + (index % 5) * 0.045,
      width: channel.type === 'obc' ? 0.22 : 0.42,
      height: channel.type === 'obc' ? 0.22 : 0.32,
      zIndex: Math.max(1, ...layout.panels.map((p) => p.zIndex)) + 1 + index,
      muted: layout.panels.length + index > 0,
      volume: layout.panels.length + index > 0 ? 0 : 1,
      targetLatencyOffset: channel.type === 'obc' ? 22 : 5,
      pinnedToDriver: channel.racingNumber,
      aspectLock: true,
    };
  };

  const addChannel = (channel: StreamChannel) => {
    const panel = makePanelForChannel(channel, 0);
    setLayout({
      ...layout,
      panels: [...layout.panels, panel],
      updatedAt: Date.now(),
    });
    setAudioFocus(panel.id);
  };

  const addAll = () => {
    const available = activeSession.channels.filter((c) => !activeStreamKeys.has(streamKey(c)));
    const next = available.map((channel, index) => makePanelForChannel(channel, index));
    if (next.length === 0) return;
    setLayout({
      ...layout,
      panels: [...layout.panels, ...next],
      updatedAt: Date.now(),
    });
    setAudioFocus(next[0]!.id);
  };

  if (feedRailCollapsed) {
    return (
      <aside className="feed-rail collapsed">
        <button type="button" className="feed-rail-toggle" onClick={() => setFeedRailCollapsed(false)} title="Show feeds">
          Feeds
        </button>
        <span className="feed-rail-count">{layout.panels.length}</span>
      </aside>
    );
  }

  return (
    <aside className="feed-rail">
      <header className="feed-rail-head">
        <div>
          <h2>Feeds</h2>
          <p>{layout.panels.length} open · {availableCount} available</p>
        </div>
        <button type="button" className="icon-btn" onClick={() => setFeedRailCollapsed(true)} title="Hide feeds">
          ‹
        </button>
      </header>

      <div className="feed-rail-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={addAll} disabled={availableCount === 0}>
          Add all
        </button>
      </div>

      <div className="feed-rail-scroll">
        {groups.map((group) => (
          <section key={group.label} className="feed-rail-group">
            <h3>{group.label}</h3>
            <ul>
              {group.channels.map((channel) => {
                const key = streamKey(channel);
                const active = activeStreamKeys.has(key);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={`feed-rail-item${active ? ' active' : ''}`}
                      disabled={active}
                      onClick={() => addChannel(channel)}
                    >
                      <span className="feed-rail-code">
                        {channel.racingNumber ? `#${channel.racingNumber}` : channel.identifier ?? 'FEED'}
                      </span>
                      <span className="feed-rail-label">{channel.title}</span>
                      {active && <span className="feed-rail-live">On wall</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
