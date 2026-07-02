import { useEffect, useRef, useCallback, useState } from 'react';
import shaka from 'shaka-player/dist/shaka-player.ui.js';
import type { PlaybackBundle } from '@pitwall/shared';
import type { PlayerAdapter } from '@pitwall/sync-engine';
import { registerVideo, unregisterVideo } from '../lib/videoRegistry';

export interface ShakaStatus {
  state: 'idle' | 'loading' | 'buffering' | 'playing' | 'error';
  error: string | null;
  drm: boolean;
}

function describeShakaError(err: unknown): string {
  const e = err as { code?: number; message?: string; data?: unknown[] };
  const parts = [`Shaka ${e.code ?? 'error'}: ${e.message ?? String(err)}`];
  const data = e.data ?? [];
  const status = data.find((item) => typeof item === 'number');
  const uri = data.find((item) => typeof item === 'string' && item.startsWith('http'));
  if (status) parts.push(`HTTP ${status}`);
  if (uri) parts.push(String(uri).slice(0, 140));
  return parts.join(' · ');
}

function videoErrorMessage(video: HTMLVideoElement): string {
  const code = video.error?.code;
  if (code === MediaError.MEDIA_ERR_ABORTED) return 'Playback was interrupted.';
  if (code === MediaError.MEDIA_ERR_NETWORK) return 'Network error while loading video.';
  if (code === MediaError.MEDIA_ERR_DECODE) return 'Video decode failed. Try the desktop app or a lower-quality feed.';
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return 'This runtime cannot decode the selected F1 TV stream. Use the desktop app with Widevine/proprietary codec support.';
  }
  return 'Video element failed before media became playable.';
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

export function useShakaPlayer(
  playback: PlaybackBundle | null,
  onReady?: (adapter: PlayerAdapter) => void,
  panelId?: string,
  streamKey?: string,
  startTimeSec?: number,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<shaka.Player | null>(null);
  const offsetRef = useRef(0);
  const [status, setStatus] = useState<ShakaStatus>({ state: 'idle', error: null, drm: false });

  const destroy = useCallback(async () => {
    if (playerRef.current) {
      await playerRef.current.destroy().catch(() => {});
      playerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!playback || !videoRef.current) return;

    let disposed = false;
    let readinessTimer: number | null = null;
    const cleanups: Array<() => void> = [];

    shaka.polyfill.installAll();
    const player = new shaka.Player();
    playerRef.current = player;
    const video = videoRef.current;
    video.crossOrigin = 'anonymous';
    setStatus({ state: 'loading', error: null, drm: !!playback.licenseUrl });

    const updateState = (state: ShakaStatus) => {
      if (!disposed) setStatus(state);
    };

    const addVideoListener = (event: keyof HTMLMediaElementEventMap, listener: EventListener) => {
      video.addEventListener(event, listener);
      cleanups.push(() => video.removeEventListener(event, listener));
    };

    player.attach(video).then(async () => {
      try {
        video.muted = true;
        video.playsInline = true;

        const onPlayerError = (event: Event) => {
          const detail = (event as CustomEvent).detail as unknown;
          updateState({
            state: 'error',
            error: detail ? describeShakaError(detail) : 'Playback error',
            drm: !!playback.licenseUrl,
          });
        };
        player.addEventListener('error', onPlayerError);
        cleanups.push(() => player.removeEventListener('error', onPlayerError));

        addVideoListener('loadedmetadata', () => {
          updateState({ state: 'buffering', error: null, drm: !!playback.licenseUrl });
        });
        addVideoListener('canplay', () => {
          updateState({ state: 'playing', error: null, drm: !!playback.licenseUrl });
        });
        addVideoListener('playing', () => {
          updateState({ state: 'playing', error: null, drm: !!playback.licenseUrl });
        });
        addVideoListener('waiting', () => {
          updateState({ state: 'buffering', error: null, drm: !!playback.licenseUrl });
        });
        addVideoListener('error', () => {
          updateState({ state: 'error', error: videoErrorMessage(video), drm: !!playback.licenseUrl });
        });

        player.configure({
          preferredVideoCodecs: ['avc1'],
          preferredAudioCodecs: ['mp4a'],
          preferredAudioChannelCount: 2,
          streaming: {
            bufferingGoal: 30,
            rebufferingGoal: 2,
            ignoreTextStreamFailures: true,
            retryParameters: { maxAttempts: 3, baseDelay: 800, backoffFactor: 1.6, fuzzFactor: 0.3 },
          },
          manifest: {
            retryParameters: { maxAttempts: 3, baseDelay: 800, backoffFactor: 1.6, fuzzFactor: 0.3 },
          },
          ...(playback.licenseUrl
            ? {
                drm: {
                  servers: { 'com.widevine.alpha': playback.licenseUrl },
                  advanced: {
                    'com.widevine.alpha': {
                      videoRobustness: 'SW_SECURE_CRYPTO',
                      audioRobustness: 'SW_SECURE_CRYPTO',
                    },
                  },
                },
              }
            : {}),
        });

        const net = player.getNetworkingEngine();
        net?.registerRequestFilter((type, request) => {
          if (type === shaka.net.NetworkingEngine.RequestType.SEGMENT) {
            request.uris = request.uris.map((uri) =>
              uri.startsWith('https://') ? `/api/media-proxy?url=${encodeURIComponent(uri)}` : uri,
            );
          }
          if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
            request.allowCrossSiteCredentials = true;
            if (playback.licenseAscendonToken) {
              request.headers['ascendontoken'] = playback.licenseAscendonToken;
            }
            if (playback.licenseEntitlementToken) {
              request.headers['entitlementtoken'] = playback.licenseEntitlementToken;
            }
            request.headers['Content-Type'] = 'application/octet-stream';
          }
        });

        await withTimeout(
          player.load(playback.manifestUrl, startTimeSec),
          20000,
          'Stream did not become playable after 20 seconds. Retry the feed, or use the desktop app for F1 TV codec/DRM playback.',
        );
        updateState({ state: 'buffering', error: null, drm: !!playback.licenseUrl });

        readinessTimer = window.setTimeout(() => {
          if (video.readyState === HTMLMediaElement.HAVE_NOTHING) {
            updateState({
              state: 'error',
              error:
                'Stream loaded but no video frames were decoded. This usually means the current browser lacks the F1 TV codec support; use the desktop app or retry the feed.',
              drm: !!playback.licenseUrl,
            });
          }
        }, 12000);

        await video.play().catch(() => {});

        if (streamKey) registerVideo(streamKey, video);

        if (panelId && onReady) {
          onReady({
            id: panelId,
            getCurrentTime: () => video.currentTime,
            getBufferDepth: () =>
              video.buffered.length ? video.buffered.end(video.buffered.length - 1) - video.currentTime : 0,
            setPlaybackRate: (r) => {
              video.playbackRate = r;
            },
            seekTo: (t) => {
              video.currentTime = t;
            },
            getTargetLatencyOffset: () => offsetRef.current,
            setTargetLatencyOffset: (o) => {
              offsetRef.current = o;
            },
          });
        }
      } catch (err) {
        updateState({
          state: 'error',
          error: describeShakaError(err),
          drm: !!playback.licenseUrl,
        });
      }
    });

    return () => {
      disposed = true;
      if (readinessTimer) window.clearTimeout(readinessTimer);
      for (const cleanup of cleanups) cleanup();
      if (streamKey) unregisterVideo(streamKey);
      destroy();
    };
  }, [playback, panelId, streamKey, startTimeSec, onReady, destroy]);

  return { videoRef, status };
}
