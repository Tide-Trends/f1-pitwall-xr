/** Must load before any dependency that reads `process` (e.g. react-rnd). */
const g = globalThis as Record<string, unknown>;
if (typeof g.process === 'undefined') {
  g.process = { env: { NODE_ENV: import.meta.env.MODE } };
}
