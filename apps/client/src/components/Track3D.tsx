import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import { Rnd } from 'react-rnd';
import * as THREE from 'three';
import {
  parseCircuitGeoJSON,
  buildRibbonGeometry,
  CarInterpolator,
  type CircuitGeoJSON,
  type TrackMeshData,
  type InterpolatedCar,
} from '@pitwall/track-3d';
import type { DriverPosition, DriverTiming } from '@pitwall/shared';
import { useAppStore } from '../store/appStore';

const EMPTY_TIMING: DriverTiming[] = [];

const FLAG_COLORS: Record<string, string> = {
  YELLOW: '#ffd60a',
  RED: '#ff453a',
  SC: '#ffd60a',
  VSC: '#ffd60a',
  GREEN: '#30d158',
};

function TrackRibbon({ track, flag }: { track: TrackMeshData; flag?: string }) {
  const geom = useMemo(() => {
    const { positions, indices } = buildRibbonGeometry(track, 0.06);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    g.computeVertexNormals();
    return g;
  }, [track]);

  const edgePoints = useMemo(
    () => track.points.map((p) => new THREE.Vector3(p.x, 0.018, p.z)),
    [track],
  );

  const flagColor = flag ? FLAG_COLORS[flag] : undefined;

  return (
    <group>
      <mesh geometry={geom} receiveShadow>
        <meshStandardMaterial color="#26262e" roughness={0.65} metalness={0.35} />
      </mesh>
      {/* Racing-line edge glow */}
      <Line
        points={edgePoints}
        color={flagColor ?? '#ff375f'}
        lineWidth={1.4}
        transparent
        opacity={flagColor ? 0.9 : 0.55}
      />
      <StartFinishMarker track={track} />
    </group>
  );
}

function StartFinishMarker({ track }: { track: TrackMeshData }) {
  const p0 = track.points[0];
  const p1 = track.points[1] ?? p0;
  if (!p0) return null;
  const angle = Math.atan2(p1.z - p0.z, p1.x - p0.x);
  return (
    <group position={[p0.x, 0.021, p0.z]} rotation={[0, -angle, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.02, 0.1]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <Text position={[0, 0.09, 0]} fontSize={0.035} color="#ffffff" anchorX="center">
        S/F
      </Text>
    </group>
  );
}

function CarDot({
  car,
  timing,
  pinned,
  onHover,
}: {
  car: InterpolatedCar;
  timing?: DriverTiming;
  pinned: boolean;
  onHover: (car: InterpolatedCar | null) => void;
}) {
  const color = timing?.teamColor
    ? `#${timing.teamColor.replace('#', '')}`
    : '#8e8e93';
  const drs = timing?.drs === true;

  return (
    <group position={[car.position.x, car.position.y, car.position.z]}>
      {/* DRS glow trail */}
      {drs && (
        <mesh position={[0, 0, 0.05]}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshBasicMaterial color="#30d158" transparent opacity={0.35} />
        </mesh>
      )}
      <mesh
        castShadow
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(car);
        }}
        onPointerOut={() => onHover(null)}
      >
        <boxGeometry args={[0.035, 0.018, 0.07]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={pinned ? 0.9 : 0.35}
          roughness={0.4}
          metalness={0.5}
        />
      </mesh>
      <Text
        position={[0, 0.055, 0]}
        fontSize={0.032}
        color={pinned ? '#ffffff' : '#d0d0d8'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.002}
        outlineColor="#000000"
      >
        {timing?.tla ?? String(car.racingNumber)}
      </Text>
      {pinned && (
        <mesh position={[0, 0.1, 0]}>
          <coneGeometry args={[0.015, 0.03, 8]} />
          <meshBasicMaterial color="#ff375f" />
        </mesh>
      )}
    </group>
  );
}

function Cars({
  track,
  positions,
  timing,
  pinnedDriver,
  onHover,
}: {
  track: TrackMeshData;
  positions: DriverPosition[];
  timing: DriverTiming[];
  pinnedDriver: number | null;
  onHover: (car: InterpolatedCar | null) => void;
}) {
  const interpolator = useMemo(() => new CarInterpolator(), []);
  const [cars, setCars] = useState<InterpolatedCar[]>([]);
  const teamColors = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of timing) {
      if (t.teamColor) m.set(t.racingNumber, t.teamColor);
    }
    return m;
  }, [timing]);

  useFrame(() => {
    setCars(interpolator.update(track, positions, teamColors));
  });

  const timingOf = (num: number) => timing.find((t) => t.racingNumber === num);

  return (
    <>
      {cars.map((c) => (
        <CarDot
          key={c.racingNumber}
          car={c}
          timing={timingOf(c.racingNumber)}
          pinned={pinnedDriver === c.racingNumber}
          onHover={onHover}
        />
      ))}
    </>
  );
}

/** Camera chase for pinned driver */
function FollowCamera({
  track,
  positions,
  pinnedDriver,
}: {
  track: TrackMeshData;
  positions: DriverPosition[];
  pinnedDriver: number | null;
}) {
  const { camera } = useThree();
  const interpolator = useMemo(() => new CarInterpolator(), []);
  const target = useRef(new THREE.Vector3());

  useFrame(() => {
    if (pinnedDriver == null) return;
    const cars = interpolator.update(track, positions, new Map());
    const car = cars.find((c) => c.racingNumber === pinnedDriver);
    if (!car) return;
    target.current.set(car.position.x, car.position.y, car.position.z);
    const desired = new THREE.Vector3(
      car.position.x + 0.35,
      car.position.y + 0.3,
      car.position.z + 0.35,
    );
    camera.position.lerp(desired, 0.06);
    camera.lookAt(target.current);
  });

  return null;
}

export function TrackScene({
  geojson,
  positions,
  timing,
  pinnedDriver,
  flag,
  onHover,
  interactive = true,
}: {
  geojson: CircuitGeoJSON;
  positions: DriverPosition[];
  timing: DriverTiming[];
  pinnedDriver: number | null;
  flag?: string;
  onHover?: (car: InterpolatedCar | null) => void;
  interactive?: boolean;
}) {
  const track = useMemo(() => parseCircuitGeoJSON(geojson), [geojson]);
  const hover = onHover ?? (() => {});

  return (
    <>
      <fog attach="fog" args={['#0a0a0d', 3.5, 8]} />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[2, 4, 2]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[-2, 2, -2]} intensity={0.4} color="#5a5aff" />

      {/* Reflective dark floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#0c0c10" roughness={0.25} metalness={0.75} />
      </mesh>

      <TrackRibbon track={track} flag={flag} />
      <Cars
        track={track}
        positions={positions}
        timing={timing}
        pinnedDriver={pinnedDriver}
        onHover={hover}
      />
      {pinnedDriver != null && (
        <FollowCamera track={track} positions={positions} pinnedDriver={pinnedDriver} />
      )}
      {interactive && pinnedDriver == null && (
        <OrbitControls
          enablePan
          enableZoom
          minDistance={0.5}
          maxDistance={5}
          maxPolarAngle={Math.PI / 2.05}
          target={[0, 0, 0]}
        />
      )}
    </>
  );
}

export function Track3DView({
  geojson,
  positions,
}: {
  geojson: CircuitGeoJSON | null;
  positions: DriverPosition[];
}) {
  const timing = useAppStore((s) => s.telemetry?.timing ?? EMPTY_TIMING);
  const trackStatus = useAppStore((s) => s.telemetry?.trackStatus);
  const pinnedDriver = useAppStore((s) => s.pinnedDriver);
  const setPinnedDriver = useAppStore((s) => s.setPinnedDriver);
  const trackDockVisible = useAppStore((s) => s.trackDockVisible);
  const setTrackDockVisible = useAppStore((s) => s.setTrackDockVisible);
  const [hovered, setHovered] = useState<InterpolatedCar | null>(null);
  const [dock, setDock] = useState(() => ({
    x: Math.max(16, window.innerWidth - 720),
    y: Math.max(16, window.innerHeight - 500),
    w: 340,
    h: 340,
  }));

  if (!trackDockVisible) return null;
  if (!geojson) {
    return (
      <Rnd
        className="track-dock"
        position={{ x: dock.x, y: dock.y }}
        size={{ width: dock.w, height: 220 }}
        minWidth={260}
        minHeight={180}
        bounds="parent"
        dragHandleClassName="track-dock-header"
        onDragStop={(_e, d) => setDock((s) => ({ ...s, x: d.x, y: d.y }))}
        onResizeStop={(_e, _dir, ref, _delta, pos) =>
          setDock({ x: pos.x, y: pos.y, w: ref.offsetWidth, h: ref.offsetHeight })
        }
        style={{ zIndex: 400 }}
      >
        <div className="track-dock-inner track-dock-empty">
          <div className="track-dock-header">
            <span className="track-dock-title">Circuit</span>
            <button
              type="button"
              className="track-dock-btn"
              onClick={() => setTrackDockVisible(false)}
              title="Hide track (T)"
            >
              Close
            </button>
          </div>
          <div className="track-empty-state">
            <strong>Track map unavailable</strong>
            <span>OpenF1 telemetry or a matching circuit asset has not loaded for this session yet.</span>
          </div>
        </div>
      </Rnd>
    );
  }

  const flag = mapTrackStatusToFlag(trackStatus);
  const hoveredTiming = hovered
    ? timing.find((t) => t.racingNumber === hovered.racingNumber)
    : null;

  return (
    <Rnd
      className="track-dock"
      position={{ x: dock.x, y: dock.y }}
      size={{ width: dock.w, height: dock.h }}
      minWidth={240}
      minHeight={240}
      bounds="parent"
      dragHandleClassName="track-dock-header"
      onDragStop={(_e, d) => setDock((s) => ({ ...s, x: d.x, y: d.y }))}
      onResizeStop={(_e, _dir, ref, _delta, pos) =>
        setDock({ x: pos.x, y: pos.y, w: ref.offsetWidth, h: ref.offsetHeight })
      }
      style={{ zIndex: 400 }}
    >
      <div className="track-dock-inner">
        <div className="track-dock-header">
          <span className="track-dock-title">Circuit</span>
          {pinnedDriver != null && (
            <button type="button" className="track-dock-btn" onClick={() => setPinnedDriver(null)}>
              Unpin cam
            </button>
          )}
          <button
            type="button"
            className="track-dock-btn"
            onClick={() =>
              setDock((s) => ({ ...s, w: s.w > 400 ? 340 : 520, h: s.h > 400 ? 340 : 520 }))
            }
            title="Toggle size"
          >
            ⤢
          </button>
          <button
            type="button"
            className="track-dock-btn"
            onClick={() => setTrackDockVisible(false)}
            title="Hide track (T)"
          >
            Close
          </button>
        </div>
        <Canvas shadows camera={{ position: [0, 2.4, 2.4], fov: 42 }}>
          <TrackScene
            geojson={geojson}
            positions={positions}
            timing={timing}
            pinnedDriver={pinnedDriver}
            flag={flag}
            onHover={setHovered}
          />
        </Canvas>
        {hoveredTiming && (
          <div className="track-tooltip">
            <strong>
              P{hoveredTiming.position} {hoveredTiming.tla}
            </strong>
            <span>{hoveredTiming.gapToLeader || 'Leader'}</span>
            {hoveredTiming.lastLapTime && <span>Last {hoveredTiming.lastLapTime}</span>}
            {hoveredTiming.compound && <span>{hoveredTiming.compound}</span>}
          </div>
        )}
      </div>
    </Rnd>
  );
}

export function mapTrackStatusToFlag(status?: string): string | undefined {
  if (!status) return undefined;
  const map: Record<string, string> = {
    '1': 'GREEN',
    '2': 'YELLOW',
    '4': 'SC',
    '5': 'RED',
    '6': 'VSC',
    '7': 'VSC',
  };
  return map[status] ?? undefined;
}

export function useCircuitGeoJSON(circuitId: string | null) {
  const [geo, setGeo] = useState<CircuitGeoJSON | null>(null);

  useEffect(() => {
    if (!circuitId) {
      setGeo(null);
      return;
    }
    fetch(`/api/circuits/${circuitId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Circuit ${circuitId} not found`);
        return r.json() as Promise<CircuitGeoJSON>;
      })
      .then(setGeo)
      .catch(() => setGeo(null));
  }, [circuitId]);

  return geo;
}
