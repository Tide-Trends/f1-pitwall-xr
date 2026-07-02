import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { XR, XRLayer, createXRStore, XROrigin } from '@react-three/xr';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Html, RoundedBox, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { PlaybackBundle, StreamChannel } from '@pitwall/shared';
import { streamKey as makeStreamKey } from '@pitwall/shared';
import { useAppStore } from '../store/appStore';
import { useCircuitGeoJSON, TrackScene, mapTrackStatusToFlag } from './Track3D';
import { useShakaPlayer, type ShakaStatus } from '../hooks/useShakaPlayer';
import { pitwallApi } from '../lib/api';
import { getVideo, subscribeVideos } from '../lib/videoRegistry';
import {
  VR_SLOTS,
  cylToWorld,
  cylRotation,
  findSnapSlot,
  type VRPanelState,
} from '../lib/vrSlots';

const xrStore = createXRStore({ foveation: 1, layers: true, handTracking: true });

function Text({
  position,
  fontSize = 0.05,
  color = '#f2f2f7',
  maxWidth,
  textAlign = 'left',
  onClick,
  children,
}: {
  position?: [number, number, number];
  fontSize?: number;
  color?: string;
  anchorX?: string;
  anchorY?: string;
  maxWidth?: number;
  textAlign?: 'left' | 'center' | 'right';
  onClick?: (e: { stopPropagation: () => void }) => void;
  children: ReactNode;
}) {
  return (
    <Html
      transform
      sprite
      position={position}
      distanceFactor={1}
      style={{
        color,
        fontSize: `${Math.max(10, fontSize * 190)}px`,
        lineHeight: 1.15,
        fontWeight: 700,
        maxWidth: maxWidth ? `${maxWidth * 190}px` : undefined,
        textAlign,
        whiteSpace: 'pre-line',
        pointerEvents: onClick ? 'auto' : 'none',
        userSelect: 'none',
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.({ stopPropagation: () => event.stopPropagation() });
      }}
    >
      {children}
    </Html>
  );
}

/* ---------- Hidden stream mounts: play video for VR panels ---------- */

function HiddenStreamMount({
  channel,
  onStatus,
}: {
  channel: StreamChannel;
  onStatus?: (key: string, status: ShakaStatus) => void;
}) {
  const [playback, setPlayback] = useState<PlaybackBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const key = makeStreamKey(channel);
  const masterTime = useAppStore((s) => s.masterTime);
  const startTimeRef = useRef(masterTime);
  const { videoRef, status } = useShakaPlayer(playback, undefined, undefined, key, startTimeRef.current);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    pitwallApi
      .getPlayback(channel.contentId, channel.channelId)
      .then(({ playback: pb }) => {
        if (!cancelled) setPlayback(pb);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  useEffect(() => {
    if (!onStatus) return;
    if (loadError) {
      onStatus(key, { state: 'error', error: loadError, drm: false });
      return;
    }
    onStatus(key, status);
  }, [key, loadError, onStatus, status]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{
        position: 'fixed',
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
        left: -10,
        top: -10,
      }}
    />
  );
}

/* ---------- Video surface ---------- */

function VideoSurface({
  streamKey,
  status,
  width,
  height,
}: {
  streamKey: string;
  status?: ShakaStatus;
  width: number;
  height: number;
}) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [, forceRefresh] = useState(0);

  useEffect(() => {
    let disposed = false;
    let metadataListener: (() => void) | null = null;

    const tryAttach = () => {
      const nextVideo = getVideo(streamKey);
      if (!nextVideo || disposed) return;
      setVideo((current) => (current === nextVideo ? current : nextVideo));
      const onMetadata = () => forceRefresh((value) => value + 1);
      nextVideo.addEventListener('loadedmetadata', onMetadata, { once: true });
      metadataListener = () => nextVideo.removeEventListener('loadedmetadata', onMetadata);
    };

    tryAttach();
    const unsub = subscribeVideos(tryAttach);
    return () => {
      disposed = true;
      unsub();
      metadataListener?.();
    };
  }, [streamKey]);

  return (
    <group>
      {video ? (
        <XRLayer
          src={video}
          shape="quad"
          quality="graphics-optimized"
          pixelWidth={Math.max(640, video.videoWidth || 1280)}
          pixelHeight={Math.max(360, video.videoHeight || 720)}
          scale={[width, height, 1]}
        />
      ) : (
        <mesh>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial color="#101014" />
        </mesh>
      )}
      {!video && (
        <Text
          position={[0, 0, 0.001]}
          fontSize={height * 0.08}
          color="#8e8e93"
          anchorX="center"
          anchorY="middle"
          maxWidth={width * 0.9}
          textAlign="center"
        >
          {status?.state === 'error'
            ? (status.error ?? 'Stream failed').slice(0, 120)
            : status?.state === 'buffering'
              ? 'Buffering stream...'
              : 'Connecting stream...'}
        </Text>
      )}
    </group>
  );
}

/* ---------- Draggable VR panel ---------- */

function VRPanel({
  panel,
  title,
  streamStatus,
  onOpenSelector,
}: {
  panel: VRPanelState;
  title: string;
  streamStatus?: ShakaStatus;
  onOpenSelector: () => void;
}) {
  const upsertVRPanel = useAppStore((s) => s.upsertVRPanel);
  const removeVRPanel = useAppStore((s) => s.removeVRPanel);
  const vrPanels = useAppStore((s) => s.vrPanels);
  const dragging = useRef(false);
  const [hoverSnap, setHoverSnap] = useState<string | null>(null);

  const w = panel.scale;
  const h = (panel.scale * 9) / 16;
  const pos = cylToWorld(panel);
  const rot = cylRotation(panel);

  const occupiedSlots = useMemo(() => {
    const s = new Set<string>();
    for (const p of Object.values(vrPanels)) {
      if (p.id !== panel.id && p.slotId) s.add(p.slotId);
    }
    return s;
  }, [vrPanels, panel.id]);

  const onDragMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      e.stopPropagation();
      const dir = e.ray.direction;
      const theta = Math.atan2(dir.x, -dir.z);
      const height = 1.55 + dir.y * panel.distance * 1.4;
      const next = { ...panel, theta, height: THREE.MathUtils.clamp(height, 0.7, 2.8), slotId: null };
      const snap = findSnapSlot(next, occupiedSlots);
      setHoverSnap(snap?.id ?? null);
      upsertVRPanel(next);
    },
    [panel, occupiedSlots, upsertVRPanel],
  );

  const onDragEnd = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging.current) return;
      dragging.current = false;
      e.stopPropagation();
      (e.target as HTMLElement | undefined)?.releasePointerCapture?.(e.pointerId);
      const snap = findSnapSlot(panel, occupiedSlots);
      setHoverSnap(null);
      if (snap) {
        upsertVRPanel({
          ...panel,
          slotId: snap.id,
          theta: snap.theta,
          height: snap.height,
          distance: snap.distance,
          scale: snap.scale,
        });
      }
    },
    [panel, occupiedSlots, upsertVRPanel],
  );

  return (
    <group position={pos} rotation={rot}>
      {/* Drag grip (title bar) */}
      <mesh
        position={[0, h / 2 + 0.05, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          dragging.current = true;
          (e.target as HTMLElement | undefined)?.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      >
        <planeGeometry args={[w, 0.09]} />
        <meshBasicMaterial color={hoverSnap ? '#ff375f' : '#1c1c22'} transparent opacity={0.92} />
      </mesh>
      <Text position={[-w / 2 + 0.04, h / 2 + 0.05, 0.001]} fontSize={0.045} color="#f2f2f7" anchorX="left">
        {title}
      </Text>
      {/* Close */}
      <Text
        position={[w / 2 - 0.05, h / 2 + 0.05, 0.001]}
        fontSize={0.05}
        color="#8e8e93"
        anchorX="center"
        onClick={(e) => {
          e.stopPropagation();
          if (panel.id === 'vr-main') {
            upsertVRPanel({ ...panel, streamKey: null });
          } else {
            removeVRPanel(panel.id);
          }
        }}
      >
        ✕
      </Text>
      {/* Scale handles */}
      <Text
        position={[w / 2 - 0.14, h / 2 + 0.05, 0.001]}
        fontSize={0.05}
        color="#8e8e93"
        anchorX="center"
        onClick={(e) => {
          e.stopPropagation();
          upsertVRPanel({ ...panel, scale: Math.min(3.4, panel.scale * 1.15) });
        }}
      >
        ＋
      </Text>
      <Text
        position={[w / 2 - 0.22, h / 2 + 0.05, 0.001]}
        fontSize={0.05}
        color="#8e8e93"
        anchorX="center"
        onClick={(e) => {
          e.stopPropagation();
          upsertVRPanel({ ...panel, scale: Math.max(0.6, panel.scale / 1.15) });
        }}
      >
        －
      </Text>

      {panel.streamKey ? (
        <VideoSurface streamKey={panel.streamKey} status={streamStatus} width={w} height={h} />
      ) : (
        <mesh onClick={(e) => { e.stopPropagation(); onOpenSelector(); }}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial color="#131318" transparent opacity={0.85} />
        </mesh>
      )}
      {!panel.streamKey && (
        <Text position={[0, 0, 0.001]} fontSize={0.07} color="#8e8e93" anchorX="center">
          ＋ Choose stream
        </Text>
      )}
      {/* Frame */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(w, h)]} />
        <lineBasicMaterial color={hoverSnap ? '#ff375f' : '#2c2c33'} />
      </lineSegments>
    </group>
  );
}

/* ---------- Empty slot ghosts ---------- */

function SlotGhosts({ onPick }: { onPick: (slotId: string) => void }) {
  const vrPanels = useAppStore((s) => s.vrPanels);
  const occupied = useMemo(
    () => new Set(Object.values(vrPanels).map((p) => p.slotId).filter(Boolean) as string[]),
    [vrPanels],
  );

  return (
    <>
      {VR_SLOTS.filter((s) => !occupied.has(s.id)).map((slot) => {
        const w = slot.scale;
        const h = (slot.scale * 9) / 16;
        return (
          <group key={slot.id} position={cylToWorld(slot)} rotation={cylRotation(slot)}>
            <mesh onClick={(e) => { e.stopPropagation(); onPick(slot.id); }}>
              <planeGeometry args={[w, h]} />
              <meshBasicMaterial color="#0e0e12" transparent opacity={0.45} />
            </mesh>
            <lineSegments>
              <edgesGeometry args={[new THREE.PlaneGeometry(w, h)]} />
              <lineBasicMaterial color="#3a3a44" />
            </lineSegments>
            <Text position={[0, 0, 0.001]} fontSize={0.07} color="#6e6e78" anchorX="center">
              ＋ {slot.label}
            </Text>
          </group>
        );
      })}
    </>
  );
}

/* ---------- In-VR stream selector ---------- */

function StreamSelector({
  slotId,
  channels,
  onClose,
}: {
  slotId: string;
  channels: StreamChannel[];
  onClose: () => void;
}) {
  const assignVRSlot = useAppStore((s) => s.assignVRSlot);
  const rows = channels.slice(0, 12);
  const panelH = 0.16 + rows.length * 0.11;

  return (
    <group position={[0, 1.5, -1.4]}>
      <RoundedBox args={[1.3, panelH, 0.02]} radius={0.04}>
        <meshBasicMaterial color="#141419" transparent opacity={0.96} />
      </RoundedBox>
      <Text position={[0, panelH / 2 - 0.08, 0.015]} fontSize={0.055} color="#f2f2f7" anchorX="center">
        Choose a stream
      </Text>
      <Text
        position={[0.56, panelH / 2 - 0.08, 0.015]}
        fontSize={0.05}
        color="#8e8e93"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        ✕
      </Text>
      {rows.map((c, i) => {
        const y = panelH / 2 - 0.2 - i * 0.11;
        return (
          <group key={makeStreamKey(c)} position={[0, y, 0.015]}>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                assignVRSlot(slotId, makeStreamKey(c));
              }}
            >
              <planeGeometry args={[1.18, 0.095]} />
              <meshBasicMaterial color="#1e1e26" />
            </mesh>
            <Text position={[-0.55, 0, 0.002]} fontSize={0.045} color="#f2f2f7" anchorX="left">
              {c.title.slice(0, 34)}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

/* ---------- Grabbable track diorama ---------- */

function TrackFallbackTable() {
  return (
    <group position={[0, 0.78, -1.35]} rotation={[-0.32, 0, 0]}>
      <mesh>
        <boxGeometry args={[1.15, 0.04, 0.62]} />
        <meshBasicMaterial color="#12131a" transparent opacity={0.9} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(1.15, 0.04, 0.62)]} />
        <lineBasicMaterial color="#3a3a44" />
      </lineSegments>
      <Text position={[0, 0.06, 0.01]} fontSize={0.055} color="#8e8e93" anchorX="center">
        Track loading
      </Text>
    </group>
  );
}

function TrackDiorama() {
  const circuitGeoId = useAppStore((s) => s.circuitGeoId);
  const geo = useCircuitGeoJSON(circuitGeoId);
  const positions = useAppStore((s) => s.telemetry?.positions ?? []);
  const timing = useAppStore((s) => s.telemetry?.timing ?? []);
  const trackStatus = useAppStore((s) => s.telemetry?.trackStatus);
  const pinnedDriver = useAppStore((s) => s.pinnedDriver);
  const trackTransform = useAppStore((s) => s.trackTransform);
  const setTrackTransform = useAppStore((s) => s.setTrackTransform);
  const dragging = useRef(false);

  if (!geo) return <TrackFallbackTable />;

  const [tx, ty, tz] = trackTransform.position;

  return (
    <group
      position={[tx, 0.78 + ty, -1.35 + tz]}
      rotation={[0, trackTransform.rotationY, 0]}
      scale={trackTransform.scale * 0.72}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.045, 0]}>
        <cylinderGeometry args={[1.25, 1.35, 0.04, 64]} />
        <meshBasicMaterial color="#101118" transparent opacity={0.92} />
      </mesh>
      <TrackScene
        geojson={geo}
        positions={positions}
        timing={timing}
        pinnedDriver={pinnedDriver}
        flag={mapTrackStatusToFlag(trackStatus)}
        interactive={false}
      />
      {/* Grab ring under the diorama: drag to move, buttons rotate/scale */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.03, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          dragging.current = true;
          (e.target as HTMLElement | undefined)?.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          e.stopPropagation();
          const dir = e.ray.direction;
          const dist = 1.4;
          setTrackTransform({
            position: [dir.x * dist, THREE.MathUtils.clamp(dir.y * dist + 0.6, -0.5, 1.2), -Math.abs(dir.z) * dist + 1.1 - 1.1],
          });
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          (e.target as HTMLElement | undefined)?.releasePointerCapture?.(e.pointerId);
        }}
      >
        <ringGeometry args={[1.15, 1.3, 48]} />
        <meshBasicMaterial color="#ff375f" transparent opacity={0.25} side={THREE.DoubleSide} />
      </mesh>
      <Text
        position={[1.5, 0.05, 0]}
        fontSize={0.12}
        color="#8e8e93"
        onClick={(e) => { e.stopPropagation(); setTrackTransform({ rotationY: trackTransform.rotationY + Math.PI / 8 }); }}
      >
        ⟳
      </Text>
      <Text
        position={[1.5, -0.15, 0]}
        fontSize={0.12}
        color="#8e8e93"
        onClick={(e) => { e.stopPropagation(); setTrackTransform({ scale: Math.min(2.5, trackTransform.scale * 1.15) }); }}
      >
        ＋
      </Text>
      <Text
        position={[1.5, -0.35, 0]}
        fontSize={0.12}
        color="#8e8e93"
        onClick={(e) => { e.stopPropagation(); setTrackTransform({ scale: Math.max(0.4, trackTransform.scale / 1.15) }); }}
      >
        －
      </Text>
    </group>
  );
}

/* ---------- Ambient dark void ---------- */

function VoidEnvironment({ passthrough, backgroundColor }: { passthrough: boolean; backgroundColor: string }) {
  if (passthrough) return null;
  return (
    <>
      <color attach="background" args={[backgroundColor]} />
      <fog attach="fog" args={[backgroundColor, 7, 16]} />
      <gridHelper args={[20, 40, '#252532', '#12121a']} position={[0, 0, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, -1.25]}>
        <ringGeometry args={[1.1, 1.12, 64]} />
        <meshBasicMaterial color="#ff375f" transparent opacity={0.35} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

/* ---------- Scene root ---------- */

function VRPreviewFallback({ passthrough, backgroundColor }: { passthrough: boolean; backgroundColor: string }) {
  return (
    <>
      <VoidEnvironment passthrough={passthrough} backgroundColor={backgroundColor} />
      {VR_SLOTS.slice(0, 5).map((slot) => {
        const w = slot.scale;
        const h = (slot.scale * 9) / 16;
        return (
          <group key={slot.id} position={cylToWorld(slot)} rotation={cylRotation(slot)}>
            <mesh>
              <planeGeometry args={[w, h]} />
              <meshBasicMaterial color={slot.main ? '#23141b' : '#12131a'} transparent opacity={0.92} />
            </mesh>
            <lineSegments>
              <edgesGeometry args={[new THREE.PlaneGeometry(w, h)]} />
              <lineBasicMaterial color={slot.main ? '#ff375f' : '#3a3a44'} />
            </lineSegments>
          </group>
        );
      })}
    </>
  );
}

function VRScene({ passthrough, backgroundColor }: { passthrough: boolean; backgroundColor: string }) {
  const vrPanels = useAppStore((s) => s.vrPanels);
  const vrStreamStatuses = useAppStore((s) => s.vrStreamStatuses);
  const vrSelectorSlot = useAppStore((s) => s.vrSelectorSlot);
  const setVRSelectorSlot = useAppStore((s) => s.setVRSelectorSlot);
  const activeSession = useAppStore((s) => s.activeSession);
  const channels = activeSession?.channels ?? [];

  const titleOf = (key: string | null) => {
    if (!key) return 'Empty';
    const c = channels.find((ch) => makeStreamKey(ch) === key);
    return c?.title ?? key;
  };

  return (
    <>
      <VoidEnvironment passthrough={passthrough} backgroundColor={backgroundColor} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 2]} intensity={0.9} />
      <XROrigin>
        {Object.values(vrPanels).map((p) => (
          <VRPanel
            key={p.id}
            panel={p}
            title={titleOf(p.streamKey)}
            streamStatus={p.streamKey ? vrStreamStatuses[p.streamKey] : undefined}
            onOpenSelector={() => setVRSelectorSlot(p.slotId ?? 'main')}
          />
        ))}
        <SlotGhosts onPick={(slotId) => setVRSelectorSlot(slotId)} />
        {vrSelectorSlot && (
          <StreamSelector
            slotId={vrSelectorSlot}
            channels={channels}
            onClose={() => setVRSelectorSlot(null)}
          />
        )}
        <TrackDiorama />
      </XROrigin>
    </>
  );
}

/* ---------- Component ---------- */

export function VRMode() {
  const setMode = useAppStore((s) => s.setMode);
  const vrPanels = useAppStore((s) => s.vrPanels);
  const activeSession = useAppStore((s) => s.activeSession);
  const assignVRSlot = useAppStore((s) => s.assignVRSlot);
  const setVRStreamStatus = useAppStore((s) => s.setVRStreamStatus);
  const [passthrough, setPassthrough] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState('#07080c');
  const [xrSupport, setXrSupport] = useState({ vr: false, ar: false });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      navigator.xr?.isSessionSupported('immersive-vr').catch(() => false) ?? Promise.resolve(false),
      navigator.xr?.isSessionSupported('immersive-ar').catch(() => false) ?? Promise.resolve(false),
    ]).then(([vr, ar]) => {
      if (!cancelled) setXrSupport({ vr, ar });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    const assigned = Object.values(vrPanels).filter((p) => p.streamKey).length;
    if (assigned > 0) return;

    const main = activeSession.channels.find((c) => c.type === 'main' || c.identifier === 'INTERNATIONAL');
    const data = activeSession.channels.find((c) => c.identifier === 'DATA');
    const tracker = activeSession.channels.find((c) => c.identifier === 'TRACKER');
    const obcs = activeSession.channels.filter((c) => c.type === 'obc').slice(0, 2);

    if (main) assignVRSlot('main', makeStreamKey(main));
    if (data) assignVRSlot('top-left', makeStreamKey(data));
    if (tracker) assignVRSlot('top-right', makeStreamKey(tracker));
    if (obcs[0]) assignVRSlot('left-1', makeStreamKey(obcs[0]));
    if (obcs[1]) assignVRSlot('right-1', makeStreamKey(obcs[1]));
  }, [activeSession, assignVRSlot, vrPanels]);

  // Streams that need hidden playback (assigned to a VR panel)
  const neededChannels = useMemo(() => {
    const keys = new Set(
      Object.values(vrPanels)
        .map((p) => p.streamKey)
        .filter(Boolean) as string[],
    );
    return (activeSession?.channels ?? []).filter((c) => keys.has(makeStreamKey(c)));
  }, [vrPanels, activeSession]);

  const canEnterHeadset = passthrough ? xrSupport.ar : xrSupport.vr;

  return (
    <div className={`vr-overlay${passthrough ? ' passthrough' : ''}`} style={{ background: passthrough ? 'transparent' : backgroundColor }}>
      <div className="vr-hud">
        <button type="button" className="btn btn-secondary" onClick={() => setMode('desktop')}>
          ← Desktop
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => (passthrough ? xrStore.enterAR() : xrStore.enterVR())}
          disabled={!canEnterHeadset}
          title={canEnterHeadset ? 'Put on your headset' : 'Headset mode unavailable — desktop spatial preview remains active'}
        >
          {canEnterHeadset ? (passthrough ? 'Enter passthrough' : 'Enter headset') : 'Spatial preview'}
        </button>
        <label className="vr-toggle">
          <input
            type="checkbox"
            checked={passthrough}
            onChange={(e) => setPassthrough(e.target.checked)}
          />
          Passthrough
        </label>
        <label className="vr-color">
          <span>Background</span>
          <input
            type="color"
            value={backgroundColor}
            disabled={passthrough}
            onChange={(e) => setBackgroundColor(e.target.value)}
          />
        </label>
        <span className="vr-hint">
          {Object.values(vrPanels).filter((p) => p.streamKey).length} panels · click slots to swap streams · track table follows OpenF1
        </span>
      </div>

      {neededChannels.map((c) => (
        <HiddenStreamMount key={makeStreamKey(c)} channel={c} onStatus={setVRStreamStatus} />
      ))}

      <Canvas camera={{ position: [0, 1.55, 0.15], fov: 68 }} gl={{ alpha: true }}>
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          target={[0, 1.55, -2.2]}
          minDistance={0.2}
          maxDistance={6}
        />
        <XR store={xrStore}>
          <Suspense fallback={<VRPreviewFallback passthrough={passthrough} backgroundColor={backgroundColor} />}>
            <VRScene passthrough={passthrough} backgroundColor={backgroundColor} />
          </Suspense>
        </XR>
      </Canvas>
    </div>
  );
}
