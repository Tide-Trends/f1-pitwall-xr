import { useEffect, useRef } from 'react';
import { SyncEngine } from '@pitwall/sync-engine';
import { useAppStore } from '../store/appStore';

let globalSync: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!globalSync) {
    globalSync = new SyncEngine();
    globalSync.startAutoCorrection(1000);
  }
  return globalSync;
}

export function useSyncEngine() {
  const isReplay = useAppStore((s) => s.isReplay);
  const syncConfig = useAppStore((s) => s.syncConfig);
  const engineRef = useRef(getSyncEngine());

  useEffect(() => {
    engineRef.current.setReplayMode(isReplay);
  }, [isReplay]);

  useEffect(() => {
    engineRef.current.updateConfig(syncConfig);
  }, [syncConfig]);

  return engineRef.current;
}
