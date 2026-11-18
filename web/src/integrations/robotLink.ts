// Adapter layer for connecting real robots later. The dashboard never talks to hardware
// directly: it consumes `RobotMessage`s from whichever transport is configured.
// Today only the simulator produces data; WebSocket and HTTP-bridge transports are stubs
// with a working connect/disconnect lifecycle so a real robot can be wired in without UI changes.

export type RobotMessage =
  | { type: "telemetry"; robotId: string; t: number; battery?: number; binFill?: number; motorTemp?: number; pos?: [number, number] }
  | { type: "detection"; robotId: string; t: number; kind: "vehicle"; confidence: number; plate?: string; ocrConfidence?: number; imageDataUrl?: string };

export type LinkState = "disconnected" | "connecting" | "connected" | "error";

export interface RobotTransport {
  readonly name: string;
  readonly state: LinkState;
  connect(onMessage: (m: RobotMessage) => void, onState: (s: LinkState, detail?: string) => void): void;
  disconnect(): void;
}

export class WebSocketTransport implements RobotTransport {
  readonly name = "WebSocket";
  state: LinkState = "disconnected";
  private ws: WebSocket | null = null;
  constructor(private url: string) {}
  connect(onMessage: (m: RobotMessage) => void, onState: (s: LinkState, detail?: string) => void) {
    try {
      this.state = "connecting";
      onState("connecting");
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => { this.state = "connected"; onState("connected"); };
      this.ws.onmessage = (e) => { try { onMessage(JSON.parse(String(e.data)) as RobotMessage); } catch { /* ignore malformed */ } };
      this.ws.onerror = () => { this.state = "error"; onState("error", `Could not reach ${this.url}`); };
      this.ws.onclose = () => { if (this.state !== "error") { this.state = "disconnected"; onState("disconnected"); } };
    } catch (err) {
      this.state = "error";
      onState("error", String(err));
    }
  }
  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.state = "disconnected";
  }
}

/** MQTT over WebSockets would implement the same interface (e.g. with mqtt.js). */
export const SUPPORTED_TRANSPORTS = ["WebSocket", "HTTP vision bridge", "MQTT over WebSocket (planned)"];

/** Optional local vision service (e.g. the Python detector in tools/) that returns plate text for a snapshot. */
export async function readPlateViaBridge(baseUrl: string, imageDataUrl: string): Promise<{ plate: string; confidence: number } | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/ocr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: imageDataUrl }), signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return (await res.json()) as { plate: string; confidence: number };
  } catch {
    return null;
  }
}
