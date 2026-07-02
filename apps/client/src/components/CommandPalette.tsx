import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { getSyncEngine } from '../hooks/useSyncEngine';
import { pitwallApi } from '../lib/api';

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState('');

  const setMode = useAppStore((s) => s.setMode);
  const setTrackDockVisible = useAppStore((s) => s.setTrackDockVisible);
  const trackDockVisible = useAppStore((s) => s.trackDockVisible);
  const setShowSyncWizard = useAppStore((s) => s.setShowSyncWizard);
  const setImmersiveBg = useAppStore((s) => s.setImmersiveBg);
  const immersiveBg = useAppStore((s) => s.immersiveBg);
  const setFeedRailCollapsed = useAppStore((s) => s.setFeedRailCollapsed);
  const setRailCollapsed = useAppStore((s) => s.setRailCollapsed);
  const setFocusMode = useAppStore((s) => s.setFocusMode);
  const focusMode = useAppStore((s) => s.focusMode);
  const isReplay = useAppStore((s) => s.isReplay);
  const activeSession = useAppStore((s) => s.activeSession);
  const layout = useAppStore((s) => s.layout);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setError = useAppStore((s) => s.setError);

  const commands = useMemo<Command[]>(() => {
    const close = () => setOpen(false);
    return [
      {
        id: 'sync',
        label: 'Sync all feeds to master',
        hint: 'S',
        run: () => {
          const engine = getSyncEngine();
          isReplay ? engine.syncReplayToMaster() : engine.syncAllToMaster();
          close();
        },
      },
      {
        id: 'wizard',
        label: 'Open sync wizard',
        hint: 'W',
        run: () => {
          setShowSyncWizard(true);
          close();
        },
      },
      {
        id: 'focus',
        label: focusMode ? 'Exit focus mode' : 'Focus mode — main feed only',
        run: () => {
          setFocusMode(!focusMode);
          close();
        },
      },
      {
        id: 'track',
        label: trackDockVisible ? 'Hide 3D track' : 'Show 3D track',
        hint: 'T',
        run: () => {
          setTrackDockVisible(!trackDockVisible);
          close();
        },
      },
      {
        id: 'xr',
        label: 'Enter spatial / XR mode',
        hint: 'V',
        run: () => {
          setMode('vr');
          close();
        },
      },
      {
        id: 'feeds',
        label: 'Show feed library',
        run: () => {
          setFeedRailCollapsed(false);
          close();
        },
      },
      {
        id: 'rail',
        label: 'Show timing & data rail',
        run: () => {
          setRailCollapsed(false);
          close();
        },
      },
      {
        id: 'dim',
        label: immersiveBg ? 'Disable immersion dim' : 'Enable immersion dim',
        hint: 'I',
        run: () => {
          setImmersiveBg(!immersiveBg);
          close();
        },
      },
      {
        id: 'save',
        label: 'Save layout preset',
        run: async () => {
          if (!layout) return;
          try {
            await pitwallApi.saveLayout(layout);
            const { presets } = await pitwallApi.getLayouts();
            useAppStore.getState().setSavedLayouts(presets);
          } catch (e) {
            setError(String(e));
          }
          close();
        },
      },
      {
        id: 'reset',
        label: 'Reset panel layout',
        run: () => {
          if (activeSession) setActiveSession(activeSession, isReplay);
          close();
        },
      },
      {
        id: 'sessions',
        label: 'Back to session library',
        run: () => {
          useAppStore.setState({ activeSession: null, layout: null });
          close();
        },
      },
    ];
  }, [
    focusMode,
    trackDockVisible,
    immersiveBg,
    isReplay,
    activeSession,
    layout,
    setMode,
    setTrackDockVisible,
    setShowSyncWizard,
    setImmersiveBg,
    setFeedRailCollapsed,
    setRailCollapsed,
    setFocusMode,
    setActiveSession,
    setOpen,
    setError,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useAppStore.getState().commandPaletteOpen);
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={() => setOpen(false)}>
      <div className="cmd-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          className="cmd-input"
          autoFocus
          placeholder="Search commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="cmd-list">
          {filtered.map((cmd) => (
            <li key={cmd.id}>
              <button type="button" onClick={() => void cmd.run()}>
                <span>{cmd.label}</span>
                {cmd.hint && <kbd>{cmd.hint}</kbd>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="cmd-empty">No matching commands</li>}
        </ul>
        <footer className="cmd-foot">
          <span>↵ run</span>
          <span>esc dismiss</span>
        </footer>
      </div>
    </div>
  );
}
