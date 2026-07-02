import type { DriverPosition } from '@pitwall/shared';

export interface CircuitGeoJSON {
  type: 'FeatureCollection';
  name: string;
  features: {
    type: 'Feature';
    properties: {
      id: string;
      Name: string;
      Location: string;
      length: number;
    };
    geometry: {
      type: 'LineString';
      coordinates: [number, number][];
    };
  }[];
}

export interface TrackPoint3D {
  x: number;
  y: number;
  z: number;
  distance: number;
}

export interface TrackMeshData {
  id: string;
  name: string;
  points: TrackPoint3D[];
  length: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface InterpolatedCar {
  racingNumber: number;
  position: TrackPoint3D;
  progress: number;
  drs?: boolean;
  teamColor?: string;
}

const TABLE_SIZE = 2.0;

export function parseCircuitGeoJSON(geo: CircuitGeoJSON): TrackMeshData {
  const feature = geo.features[0];
  if (!feature) throw new Error('No circuit feature in GeoJSON');

  const coords = feature.geometry.coordinates;
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  const points: TrackPoint3D[] = [];
  let totalDist = 0;

  for (let i = 0; i < coords.length; i++) {
    const [lng, lat] = coords[i]!;
    const x = (lng - centerLng) * 111320 * Math.cos((centerLat * Math.PI) / 180);
    const z = -(lat - centerLat) * 110540;
    if (i > 0) {
      const prev = points[i - 1]!;
      totalDist += Math.hypot(x - prev.x, z - prev.z);
    }
    points.push({ x, y: 0, z, distance: totalDist });
  }

  const scale = TABLE_SIZE / Math.max(
    Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
    Math.max(...points.map((p) => p.z)) - Math.min(...points.map((p) => p.z)),
    0.001,
  );

  const scaled = points.map((p) => ({
    ...p,
    x: p.x * scale,
    z: p.z * scale,
  }));

  return {
    id: feature.properties.id,
    name: feature.properties.Name,
    points: scaled,
    length: totalDist * scale,
    bounds: {
      minX: Math.min(...scaled.map((p) => p.x)),
      maxX: Math.max(...scaled.map((p) => p.x)),
      minZ: Math.min(...scaled.map((p) => p.z)),
      maxZ: Math.max(...scaled.map((p) => p.z)),
    },
  };
}

/** Map F1 timing X/Y (approx meters) to track progress 0-1 */
export function f1PositionToProgress(
  track: TrackMeshData,
  x: number,
  y: number,
): number {
  let bestDist = Infinity;
  let bestProgress = 0;

  for (let i = 0; i < track.points.length - 1; i++) {
    const a = track.points[i]!;
    const b = track.points[i + 1]!;
    const t = closestPointOnSegment(x, y, a.x, a.z, b.x, b.z);
    const px = a.x + t * (b.x - a.x);
    const pz = a.z + t * (b.z - a.z);
    const d = Math.hypot(x - px, y - pz);
    if (d < bestDist) {
      bestDist = d;
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      bestProgress = (a.distance + t * segLen) / track.length;
    }
  }

  return bestProgress % 1;
}

function closestPointOnSegment(
  px: number, py: number,
  ax: number, az: number,
  bx: number, bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return 0;
  return Math.max(0, Math.min(1, ((px - ax) * dx + (py - az) * dz) / lenSq));
}

export function progressToPosition(track: TrackMeshData, progress: number): TrackPoint3D {
  const target = (progress % 1) * track.length;
  for (let i = 0; i < track.points.length - 1; i++) {
    const a = track.points[i]!;
    const b = track.points[i + 1]!;
    if (target >= a.distance && target <= b.distance) {
      const t = (target - a.distance) / (b.distance - a.distance || 1);
      return {
        x: a.x + t * (b.x - a.x),
        y: 0.02,
        z: a.z + t * (b.z - a.z),
        distance: target,
      };
    }
  }
  return track.points[0] ?? { x: 0, y: 0.02, z: 0, distance: 0 };
}

export class CarInterpolator {
  private states = new Map<number, { from: TrackPoint3D; to: TrackPoint3D; startTime: number; duration: number; drs?: boolean; color?: string }>();

  update(
    track: TrackMeshData,
    positions: DriverPosition[],
    teamColors: Map<number, string>,
  ): InterpolatedCar[] {
    const now = performance.now();
    const result: InterpolatedCar[] = [];

    for (const pos of positions) {
      const progress = f1PositionToProgress(track, pos.x, pos.y);
      const target = progressToPosition(track, progress);
      const prev = this.states.get(pos.racingNumber);

      if (!prev || Math.hypot(prev.to.x - target.x, prev.to.z - target.z) > 0.05) {
        this.states.set(pos.racingNumber, {
          from: prev?.to ?? target,
          to: target,
          startTime: now,
          duration: 500,
          color: teamColors.get(pos.racingNumber),
        });
      }

      const state = this.states.get(pos.racingNumber)!;
      const t = Math.min(1, (now - state.startTime) / state.duration);
      const eased = t * t * (3 - 2 * t);

      result.push({
        racingNumber: pos.racingNumber,
        progress,
        drs: false,
        teamColor: state.color,
        position: {
          x: state.from.x + eased * (state.to.x - state.from.x),
          y: 0.05,
          z: state.from.z + eased * (state.to.z - state.from.z),
          distance: state.to.distance,
        },
      });
    }

    return result;
  }
}

export function buildRibbonGeometry(
  track: TrackMeshData,
  width = 0.08,
): { positions: Float32Array; indices: Uint16Array } {
  const verts: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < track.points.length - 1; i++) {
    const a = track.points[i]!;
    const b = track.points[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);

    const base = verts.length / 3;
    verts.push(a.x + nx, 0.01, a.z + nz);
    verts.push(a.x - nx, 0.01, a.z - nz);
    verts.push(b.x + nx, 0.01, b.z + nz);
    verts.push(b.x - nx, 0.01, b.z - nz);

    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  return {
    positions: new Float32Array(verts),
    indices: new Uint16Array(indices),
  };
}
