import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, Camera, CameraOff, Octagon, Plug, ScanSearch, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Field, KV, Panel, Pill, Tag, inputCls } from "@/components/ui";
import { SUPPORTED_TRANSPORTS, WebSocketTransport, readPlateViaBridge, type LinkState } from "@/integrations/robotLink";
import { useCameraDetections, type Detection, type SteeringAction, type SteeringSector } from "@/integrations/useCameraDetections";
import { useEngine, useSim } from "@/store/sim";
import { toast } from "@/store/toast";
import { useUi } from "@/store/ui";
import { cn } from "@/lib/utils";

type CamState = "idle" | "requesting" | "live" | "denied" | "unavailable";
const PLATE_RE = /^[A-Z0-9]{2,3} ?[A-Z0-9]{3}$/;
const BOX_STYLES: Record<Detection["kind"], { border: string; label: string }> = {
  debris: { border: "border-ok", label: "bg-ok text-bg" },
  obstacle: { border: "border-warn", label: "bg-warn text-bg" },
  object: { border: "border-accent", label: "bg-accent text-accent-ink" },
};
const SECTORS: SteeringSector[] = ["left", "center", "right"];
const STEERING = {
  LEFT: { label: "Turn left", icon: ArrowLeft },
  RIGHT: { label: "Turn right", icon: ArrowRight },
  FORWARD: { label: "Go forward", icon: ArrowUp },
  STOP: { label: "Stop", icon: Octagon },
  CLEAN: { label: "Hold to collect", icon: ArrowDownToLine },
  SCAN: { label: "Hold and scan", icon: ScanSearch },
} satisfies Record<SteeringAction, { label: string; icon: typeof ArrowLeft }>;

export default function Hardware() {
  const sim = useEngine();
  const act = useSim((x) => x.act);
  const settings = useUi((x) => x.settings);
  const navigate = useUi((x) => x.navigate);
  const updateSettings = useUi((x) => x.updateSettings);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequest = useRef(0);
  const [cam, setCam] = useState<CamState>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [plate, setPlate] = useState("");
  const [segId, setSegId] = useState(sim.s.segmentOrder[0]);
  const [note, setNote] = useState("Test incident from prototype camera");
  const [detect, setDetect] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [link, setLink] = useState<{ state: LinkState; detail?: string }>({ state: "disconnected" });
  const transport = useRef<WebSocketTransport | null>(null);
  const [lastMsg, setLastMsg] = useState<string>("none");
  const [bridgeMsg, setBridgeMsg] = useState<string>("");
  const vision = useCameraDetections(videoRef, detect && cam === "live", settings.visionBridgeUrl);
  const boxes = detect && cam === "live" && vision.status === "live" ? vision.frame.detections : [];
  const debris = boxes.filter((box) => box.kind === "debris").length;
  const obstacles = boxes.filter((box) => box.kind === "obstacle").length;
  const guidance = detect && cam === "live" && vision.status === "live" ? vision.frame.guidance : undefined;
  const action = guidance && Object.hasOwn(STEERING, guidance.action) ? STEERING[guidance.action] : undefined;
  const SteeringIcon = action?.icon ?? Octagon;

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };
  const stop = () => {
    cameraRequest.current++;
    releaseStream();
    setCam("idle");
  };
  useEffect(() => () => {
    cameraRequest.current++;
    releaseStream();
    transport.current?.disconnect();
  }, []);

  const start = async (id?: string) => {
    if (!navigator.mediaDevices?.getUserMedia) return setCam("unavailable");
    const request = ++cameraRequest.current;
    releaseStream();
    setCam("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id }, width: 1280, height: 720 } : { width: 1280, height: 720 }, audio: false });
      if (request !== cameraRequest.current || !videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (request !== cameraRequest.current) return;
      if (videoRef.current.videoWidth && videoRef.current.videoHeight) {
        setAspectRatio(videoRef.current.videoWidth / videoRef.current.videoHeight);
      }
      setCam("live");
      const track = stream.getVideoTracks()[0];
      track?.addEventListener("ended", () => {
        if (request !== cameraRequest.current) return;
        releaseStream();
        setCam("unavailable");
      }, { once: true });
      setDeviceId(track?.getSettings().deviceId ?? "");
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (request === cameraRequest.current) setDevices(list.filter((d) => d.kind === "videoinput"));
    } catch (e) {
      if (request !== cameraRequest.current) return;
      releaseStream();
      setCam((e as DOMException).name === "NotAllowedError" ? "denied" : "unavailable");
    }
  };

  const snapshot = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || cam !== "live") return;
    c.width = v.videoWidth || 1280;
    c.height = v.videoHeight || 720;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    setShot(c.toDataURL("image/jpeg", 0.85));
    toast("Snapshot captured", "Real camera frame", "success");
  };

  const connectLink = () => {
    transport.current?.disconnect();
    const t = new WebSocketTransport(settings.robotLinkUrl);
    transport.current = t;
    t.connect((m) => setLastMsg(`${m.type} from ${m.robotId}`), (state, detail) => setLink({ state, detail }));
  };

  const plateOk = PLATE_RE.test(plate.trim().toUpperCase());
  const createIncident = () => {
    if (!shot) return toast("Take a snapshot first", "The test incident needs a camera frame as evidence.", "warning");
    const id = act((x) => x.manualIncident({ segmentId: segId, plate, image: shot, note, vehicleConfidence: 0.95 }));
    toast("Test incident created", `${id} · manual plate, camera evidence`, "success");
    const caseId = sim.s.incidents[id!]?.caseId;
    if (caseId) navigate("incidents", caseId);
  };
  const tryBridge = async () => {
    if (!shot) return setBridgeMsg("Take a snapshot first.");
    setBridgeMsg("Asking the local vision bridge…");
    const r = await readPlateViaBridge(settings.visionBridgeUrl, shot);
    if (r) { setPlate(r.plate.toUpperCase()); setBridgeMsg(`Bridge read ${r.plate} (${Math.round(r.confidence * 100)}%). Verify before use.`); }
    else setBridgeMsg(`Optional OCR is unavailable at ${settings.visionBridgeUrl}. You can enter a fictional plate manually.`);
  };

  const camLabel: Record<CamState, [string, string]> = {
    idle: ["Not connected", "#64748b"], requesting: ["Waiting for permission…", "#f59e0b"], live: ["Live", "#10b981"],
    denied: ["Permission denied", "#ef4444"], unavailable: ["No camera available", "#ef4444"],
  };

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-3 flex items-end gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Hardware Prototype</h1>
          <p className="text-[11.5px] text-ink-3">RC car + vacuum + webcam proof of concept. The city dashboard works the same with this page disconnected.</p>
        </div>
        <div className="ml-auto flex gap-1.5"><Tag tone="real">Real camera feed</Tag><Tag tone="sim">Simulated telemetry</Tag><Tag tone="manual">Manual demo events</Tag></div>
      </div>
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3">
        <div className="space-y-3">
          <Panel title="Camera" icon={<Video size={14} />} actions={<><Pill color={camLabel[cam][1]} pulse={cam === "live"}>{camLabel[cam][0]}</Pill><Tag tone="real">Real</Tag></>}>
            {cam === "live" && detect && (
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2.5">
                <SteeringIcon size={22} className={guidance?.action === "STOP" || !action ? "text-warn" : "text-accent"} />
                <div className="min-w-0 flex-1">
                  <div className="label">Steering guidance · Manual RC</div>
                  <div className="text-[16px] font-semibold" data-steering-action={action ? guidance?.action : "UNAVAILABLE"}>{action?.label ?? "Hold position"}</div>
                  <div className="text-[11.5px] text-ink-2">{action ? guidance?.reason : "Waiting for a fresh steering result."}</div>
                </div>
                {action && guidance && (
                  <div className="flex gap-1">
                    {SECTORS.map((sector) => {
                      const blocked = guidance.blockedSectors.includes(sector);
                      return <span key={sector} className={cn("rounded border px-1.5 py-1 text-[10.5px] capitalize", blocked ? "border-warn/40 text-warn" : "border-line text-ink-3")}>
                        {sector} · {blocked ? "Blocked" : "Open in view"}
                      </span>;
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="relative overflow-hidden bg-black" style={{ aspectRatio: cam === "live" ? aspectRatio : 16 / 9 }}>
              <video ref={videoRef} playsInline muted className={cn("h-full w-full object-contain", cam !== "live" && "hidden")}
                onResize={(event) => {
                  const { videoWidth, videoHeight } = event.currentTarget;
                  if (videoWidth && videoHeight) setAspectRatio(videoWidth / videoHeight);
                }} />
              {cam !== "live" && (
                <div className="grid h-full place-items-center p-6 text-center text-xs text-ink-3">
                  <div>
                    {cam === "denied" || cam === "unavailable" ? <CameraOff size={30} className="mx-auto mb-2" /> : <Camera size={30} className="mx-auto mb-2" />}
                    {cam === "denied" ? "Camera permission was denied. Allow it in the browser's site settings, then retry." : cam === "unavailable" ? "No camera was found (or this browser blocks it)." : "Connect the Logitech webcam to see the real feed. The browser asks for permission first."}
                  </div>
                </div>
              )}
              {boxes.map((b, i) => (
                <div key={i} data-detection-kind={b.kind} className={cn("pointer-events-none absolute rounded border-2", BOX_STYLES[b.kind].border)}
                  style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
                  <span className={cn("absolute whitespace-nowrap rounded px-1 text-[10px] font-semibold capitalize",
                    b.y < 0.06 ? "top-0" : "bottom-full", b.x > 0.75 ? "right-0" : "left-0", BOX_STYLES[b.kind].label)}>
                    {b.label} {Math.round(b.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
              {cam === "live" ? <Button onClick={stop}><CameraOff size={13} />Disconnect</Button> : <Button variant="primary" disabled={cam === "requesting"} onClick={() => void start()}><Camera size={13} />Connect camera</Button>}
              <Button disabled={cam !== "live"} onClick={snapshot}><Camera size={13} />Take snapshot</Button>
              <label className="flex items-center gap-1.5 text-[12px] text-ink-2"><input type="checkbox" className="accent-cyan-400" checked={detect} onChange={(e) => setDetect(e.target.checked)} />Live debris and object detection</label>
              {devices.length > 1 && <select className={cn(inputCls, "ml-auto w-56")} value={deviceId} onChange={(e) => void start(e.target.value)}>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select>}
            </div>
            {cam === "live" && detect && (
              <div className="flex min-h-9 flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-[11.5px] text-ink-2">
                {vision.status === "live" ? (
                  <>
                    <Pill color="#10b981">Local detection active</Pill>
                    {boxes.length ? (
                      <span><span className="text-ok">{debris} debris</span> · <span className="text-warn">{obstacles} obstacles</span> · <span className="text-accent">{boxes.length - debris - obstacles} other objects</span></span>
                    ) : <span>No objects detected in this frame</span>}
                    <span className="num ml-auto text-ink-3">{vision.frame.inferenceMs} ms inference</span>
                  </>
                ) : vision.status === "error" ? <span role="status" className="text-warn">{vision.detail}</span>
                  : <span role="status">{vision.status === "stale" ? "Waiting for a fresh camera frame…" : "Connecting to local detector…"}</span>}
              </div>
            )}
          </Panel>
          <Panel title="Test incident" sub="Creates a real case record in the shared simulation from a camera frame and a typed plate." actions={<Tag tone="manual">Manual event</Tag>}>
            <div className="grid grid-cols-[220px_1fr] gap-4 p-3.5">
              <div>
                <div className="label mb-1">Snapshot</div>
                <div className="grid aspect-video place-items-center overflow-hidden rounded-md border border-line bg-surface">
                  {shot ? <img src={shot} alt="Captured frame" className="h-full w-full object-cover" /> : <span className="text-[11px] text-ink-3">No snapshot</span>}
                </div>
                <canvas ref={canvasRef} className="hidden" />
              </div>
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Street where the car was seen">
                    <select className={inputCls} value={segId} onChange={(e) => setSegId(e.target.value)}>{sim.s.segmentOrder.map((i) => <option key={i} value={i}>{sim.s.segments[i].name} ({sim.s.segments[i].restriction.signed ? "restriction posted" : "no restriction"})</option>)}</select>
                  </Field>
                  <Field label="Plate (fictional only)" hint={plate && !plateOk ? "Format like TAB 123" : "Use a made-up plate, e.g. TXY 417"}>
                    <input className={cn(inputCls, "mono uppercase tracking-widest")} value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} maxLength={7} placeholder="TXY 417" />
                  </Field>
                </div>
                <Field label="Note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <div className="flex items-center gap-2">
                  <Button variant="primary" disabled={!shot || !plateOk} onClick={createIncident}>Create test incident</Button>
                  <Button onClick={() => void tryBridge()}><ScanSearch size={13} />Read plate with local vision bridge</Button>
                </div>
                {bridgeMsg && <div className="text-[11px] text-ink-3">{bridgeMsg}</div>}
                <p className="text-[10.5px] leading-snug text-ink-3">The case still needs the same restriction check and human review as any other. Do not photograph or enter real plates.</p>
              </div>
            </div>
          </Panel>
        </div>
        <div className="space-y-3">
          <Panel title="Prototype status">
            <div className="px-3.5 py-2">
              <KV k="Camera feed" v={<span className="inline-flex items-center gap-1.5">{camLabel[cam][0]} <Tag tone="real">Real</Tag></span>} />
              <KV k="GPS" v={<span className="inline-flex items-center gap-1.5">Not available <Tag tone="neutral">No hardware</Tag></span>} />
              <KV k="Battery telemetry" v={<span className="inline-flex items-center gap-1.5">Not available <Tag tone="neutral">No hardware</Tag></span>} />
              <KV k="Motor control" v={<span className="inline-flex items-center gap-1.5">Not programmable <Tag tone="neutral">Manual RC</Tag></span>} />
              <KV k="Fleet telemetry in dashboard" v={<Tag tone="sim">Simulated</Tag>} />
            </div>
          </Panel>
          <Panel title="Robot link" icon={<Plug size={14} />} sub="Future integration point for real robots" actions={<Pill color={{ connected: "#10b981", connecting: "#f59e0b", error: "#ef4444", disconnected: "#64748b" }[link.state]}>{link.state}</Pill>}>
            <div className="space-y-2.5 p-3.5">
              <Field label="WebSocket URL"><input className={inputCls} value={settings.robotLinkUrl} onChange={(e) => updateSettings({ robotLinkUrl: e.target.value })} /></Field>
              <div className="flex gap-2">
                <Button variant="primary" onClick={connectLink}>Connect</Button>
                <Button onClick={() => { transport.current?.disconnect(); setLink({ state: "disconnected" }); }}>Disconnect</Button>
              </div>
              {link.detail && <div className="text-[11.5px] text-[#fca5a5]">{link.detail}. The dashboard is unaffected and keeps using the simulation.</div>}
              <KV k="Last message" v={lastMsg} />
              <div className="rounded-md border border-line bg-panel-2 p-2.5 text-[11px] leading-snug text-ink-3">
                Expected messages (JSON): <span className="mono">{`{"type":"telemetry","robotId":"HW-1","battery":82}`}</span> and <span className="mono">{`{"type":"detection","kind":"vehicle","confidence":0.93,"plate":"TXY 417"}`}</span>.
                Transports: {SUPPORTED_TRANSPORTS.join(", ")}.
              </div>
              <Field label="Local vision bridge URL" hint="Webcam detection uses this address."><input className={inputCls} value={settings.visionBridgeUrl} onChange={(e) => updateSettings({ visionBridgeUrl: e.target.value })} /></Field>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
