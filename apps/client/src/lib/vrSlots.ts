/**
 * Cylindrical placement model for VR/spatial panels.
 * Panels live on a cylinder around the user: theta (radians, 0 = straight
 * ahead, negative = left), height (m), distance (m), scale (panel width, m).
 */
export interface CylPlacement {
  theta: number;
  height: number;
  distance: number;
  scale: number;
}

export interface VRPanelState extends CylPlacement {
  id: string;
  streamKey: string | null;
  slotId: string | null;
}

export interface VRSlotDef extends CylPlacement {
  id: string;
  label: string;
  main?: boolean;
}

/** Main broadcast front-and-center, six snap slots arcing around it */
export const VR_SLOTS: VRSlotDef[] = [
  { id: 'main', label: 'Main', theta: 0, height: 1.55, distance: 2.6, scale: 2.2, main: true },
  { id: 'left-1', label: 'Left 1', theta: -0.62, height: 1.55, distance: 2.5, scale: 1.15 },
  { id: 'left-2', label: 'Left 2', theta: -1.05, height: 1.55, distance: 2.4, scale: 1.0 },
  { id: 'right-1', label: 'Right 1', theta: 0.62, height: 1.55, distance: 2.5, scale: 1.15 },
  { id: 'right-2', label: 'Right 2', theta: 1.05, height: 1.55, distance: 2.4, scale: 1.0 },
  { id: 'top-left', label: 'Top L', theta: -0.34, height: 2.35, distance: 2.6, scale: 1.0 },
  { id: 'top-right', label: 'Top R', theta: 0.34, height: 2.35, distance: 2.6, scale: 1.0 },
];

export function cylToWorld(p: CylPlacement): [number, number, number] {
  return [Math.sin(p.theta) * p.distance, p.height, -Math.cos(p.theta) * p.distance];
}

/** Y-rotation so the panel faces the user at origin */
export function cylRotation(p: CylPlacement): [number, number, number] {
  return [0, -p.theta, 0];
}

const SNAP_THETA = 0.18;
const SNAP_HEIGHT = 0.3;

export function findSnapSlot(
  p: CylPlacement,
  occupied: Set<string>,
): VRSlotDef | null {
  let best: VRSlotDef | null = null;
  let bestDist = Infinity;
  for (const slot of VR_SLOTS) {
    if (occupied.has(slot.id)) continue;
    const dTheta = Math.abs(slot.theta - p.theta);
    const dH = Math.abs(slot.height - p.height);
    if (dTheta < SNAP_THETA && dH < SNAP_HEIGHT) {
      const d = dTheta + dH * 0.5;
      if (d < bestDist) {
        bestDist = d;
        best = slot;
      }
    }
  }
  return best;
}

export function defaultVRPanels(): Record<string, VRPanelState> {
  const main = VR_SLOTS[0];
  return {
    'vr-main': {
      id: 'vr-main',
      streamKey: null,
      slotId: 'main',
      theta: main.theta,
      height: main.height,
      distance: main.distance,
      scale: main.scale,
    },
  };
}
