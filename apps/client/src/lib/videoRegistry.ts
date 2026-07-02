/**
 * Global registry of live <video> elements keyed by streamKey.
 * Lets the VR/spatial scenes build THREE.VideoTexture from streams
 * that are already playing (grid panels or hidden VR-only mounts).
 */
type Listener = () => void;

const videos = new Map<string, HTMLVideoElement>();
const listeners = new Set<Listener>();

export function registerVideo(streamKey: string, el: HTMLVideoElement): void {
  videos.set(streamKey, el);
  listeners.forEach((l) => l());
}

export function unregisterVideo(streamKey: string): void {
  videos.delete(streamKey);
  listeners.forEach((l) => l());
}

export function getVideo(streamKey: string): HTMLVideoElement | undefined {
  return videos.get(streamKey);
}

export function subscribeVideos(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
