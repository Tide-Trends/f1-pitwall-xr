/**
 * F1 Live Timing SignalR client — relays to WebSocket clients.
 * Based on matteocelani/f1-telemetry patterns.
 */
import { inflateRawSync } from 'zlib';
import WebSocket from 'ws';

const F1_SERVER_URL = 'https://livetiming.formula1.com/signalr';
const HUB = 'Streaming';

const CHANNELS = [
  'CarData.z',
  'Position.z',
  'TimingData',
  'TimingDataF1',
  'TimingAppData',
  'TimingStats',
  'TrackStatus',
  'SessionInfo',
  'DriverList',
  'WeatherData',
  'RaceControlMessages',
  'ExtrapolatedClock',
  'LapCount',
  'SessionData',
  'Heartbeat',
];

type WsClient = WebSocket;

export class F1TelemetryService {
  private state: Record<string, unknown> = {};
  private ws: WebSocket | null = null;
  private clients = new Set<WsClient>();
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private pending: Record<string, unknown> = {};
  private connected = false;
  private connecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    this.batchTimer = setInterval(() => this.flush(), 50);
  }

  stop(): void {
    if (this.batchTimer) clearInterval(this.batchTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  addClient(ws: WsClient): void {
    this.clients.add(ws);
    ws.send(JSON.stringify({ type: 'snapshot', snapshot: true, updates: this.state }));
    if (!this.connected && !this.connecting) void this.connect();
  }

  removeClient(ws: WsClient): void {
    this.clients.delete(ws);
  }

  private async connect(): Promise<void> {
    if (this.clients.size === 0 || this.connecting || this.connected) return;
    this.connecting = true;
    try {
      const connectionData = encodeURIComponent(JSON.stringify([{ name: HUB }]));
      const neg = await fetch(
        `${F1_SERVER_URL}/negotiate?clientProtocol=1.5&connectionData=${connectionData}`,
        {
          headers: {
            Origin: 'https://www.formula1.com',
            Referer: 'https://www.formula1.com/',
            'User-Agent': 'BestHTTP',
          },
        },
      );
      const negText = await neg.text();
      if (!neg.ok || !negText.trim()) {
        throw new Error(`F1 negotiate unavailable (${neg.status})`);
      }
      const negData = JSON.parse(negText) as { ConnectionToken?: string };
      if (!negData.ConnectionToken) {
        throw new Error('F1 negotiate did not return a connection token');
      }
      const connectionToken = negData.ConnectionToken;
      const cookie = neg.headers.get('set-cookie')?.split(';')[0] ?? '';

      const wsUrl =
        `wss://livetiming.formula1.com/signalr/connect?clientProtocol=1.5` +
        `&transport=webSockets&connectionToken=${encodeURIComponent(connectionToken)}` +
        `&connectionData=${connectionData}&tid=1`;

      this.ws = new WebSocket(wsUrl, {
        headers: {
          Origin: 'https://www.formula1.com',
          Cookie: cookie,
        },
      });

      this.ws.on('open', async () => {
        this.connecting = false;
        await fetch(
          `${F1_SERVER_URL}/start?clientProtocol=1.5&connectionToken=${encodeURIComponent(connectionToken)}&connectionData=${connectionData}&_=${Date.now()}`,
          { headers: { Cookie: cookie, Origin: 'https://www.formula1.com' } },
        );

        this.ws?.send(
          JSON.stringify({
            H: HUB,
            M: 'Subscribe',
            A: [CHANNELS],
            I: 1,
          }),
        );
        this.connected = true;
        this.broadcast({ type: 'control', control: 'f1_connected' });
      });

      this.ws.on('message', (data) => {
        const raw = data.toString();
        if (raw === '{}') return;
        try {
          this.processFrame(JSON.parse(raw));
        } catch { /* ignore */ }
      });

      this.ws.on('close', () => {
        this.connecting = false;
        this.connected = false;
        this.broadcast({ type: 'control', control: 'f1_disconnected' });
        this.scheduleReconnect(15000);
      });
    } catch (err) {
      this.connecting = false;
      console.warn('F1 SignalR unavailable:', err instanceof Error ? err.message : String(err));
      this.scheduleReconnect(60000);
    }
  }

  private scheduleReconnect(ms: number): void {
    if (this.clients.size === 0 || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, ms);
  }

  private processFrame(frame: Record<string, unknown>): void {
    if (frame.R) {
      const snapshot = frame.R as Record<string, unknown>;
      for (const [key, val] of Object.entries(snapshot)) {
        this.state[key] = key.endsWith('.z') ? decodeZ(val as string) : val;
      }
      this.broadcast({ type: 'snapshot', snapshot: true, updates: this.state });
      return;
    }

    const messages = frame.M as { A: unknown[] }[] | undefined;
    if (!messages) return;

    for (const msg of messages) {
      const args = msg.A;
      if (!args?.length) continue;

      if (typeof args[0] === 'string' && args[0].startsWith('{')) {
        const bulk = JSON.parse(args[0] as string) as Record<string, unknown>;
        for (const [key, val] of Object.entries(bulk)) {
          this.mergeUpdate(key, val);
        }
      } else if (typeof args[0] === 'string') {
        this.mergeUpdate(args[0] as string, args[1]);
      }
    }
  }

  private mergeUpdate(key: string, val: unknown): void {
    const decoded = key.endsWith('.z') ? decodeZ(val as string) : val;
    this.state[key] = deepMerge(
      (this.state[key] as Record<string, unknown>) ?? {},
      decoded as Record<string, unknown>,
    );
    this.pending[key] = this.state[key];
  }

  private flush(): void {
    if (Object.keys(this.pending).length === 0) return;
    const updates = { ...this.pending };
    this.pending = {};
    this.broadcast({ type: 'telemetry', updates, timestamp: Date.now() });
  }

  private broadcast(payload: unknown): void {
    const json = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 65536) {
        client.send(json);
      }
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

function decodeZ(b64: string): unknown {
  try {
    const buf = inflateRawSync(Buffer.from(b64, 'base64'));
    return JSON.parse(buf.toString('utf-8'));
  } catch {
    return null;
  }
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
