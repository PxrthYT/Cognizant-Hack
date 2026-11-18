import { useEffect, useState, type RefObject } from "react";

export interface Detection {
  kind: "debris" | "obstacle" | "object";
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SteeringAction = "LEFT" | "RIGHT" | "FORWARD" | "STOP" | "CLEAN" | "SCAN";
export type SteeringSector = "left" | "center" | "right";

interface DetectionFrame {
  detections: Detection[];
  inferenceMs: number;
  guidance?: { action: SteeringAction; reason: string; blockedSectors: SteeringSector[] };
}

type VisionState =
  | { status: "off" | "connecting" | "stale" }
  | { status: "live"; frame: DetectionFrame }
  | { status: "error"; detail: string };

export function useCameraDetections(videoRef: RefObject<HTMLVideoElement | null>, active: boolean, bridgeUrl: string) {
  const [state, setState] = useState<VisionState>({ status: "off" });

  useEffect(() => {
    if (!active) {
      setState({ status: "off" });
      return;
    }

    let endpoint: string;
    try {
      const url = new URL(bridgeUrl.trim());
      if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error("Expected a loopback address.");
      }
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/detect`;
      endpoint = url.href;
    } catch {
      setState({ status: "error", detail: "Set the vision bridge URL to a local address such as http://127.0.0.1:8765." });
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      setState({ status: "error", detail: "This browser cannot read webcam frames." });
      return;
    }

    let timer: number;
    let freshnessTimer: number;
    let lastVideoTime = -1;
    const maxFrameAge = 1500;
    setState({ status: "connecting" });

    async function detect() {
      if (signal.aborted) return;
      let delay = 180;
      try {
        const video = videoRef.current;
        if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return;
        if (video.currentTime === lastVideoTime) return;
        lastVideoTime = video.currentTime;
        const capturedAt = performance.now();

        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.round(video.videoWidth * scale);
        const height = Math.round(video.videoHeight * scale);
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        context!.drawImage(video, 0, 0, width, height);
        const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
        if (!image || signal.aborted) return;

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: image,
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(error?.error || `Vision bridge returned HTTP ${response.status}.`);
        }
        const frame = await response.json() as DetectionFrame;
        if (!Array.isArray(frame.detections) || !Number.isFinite(frame.inferenceMs)) {
          throw new Error("The vision bridge returned an invalid detection response.");
        }
        if (signal.aborted) return;
        const timeLeft = maxFrameAge - (performance.now() - capturedAt);
        window.clearTimeout(freshnessTimer);
        if (timeLeft <= 0) {
          setState({ status: "stale" });
          return;
        }
        setState({ status: "live", frame });
        freshnessTimer = window.setTimeout(() => setState({ status: "stale" }), timeLeft);
      } catch (error) {
        if (signal.aborted) return;
        delay = 1500;
        window.clearTimeout(freshnessTimer);
        const detail = error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")
          ? `Could not reach the detector at ${bridgeUrl}. Start tools/vision_bridge.py and check the bridge URL.`
          : error instanceof Error ? error.message : "Detection failed. Retrying…";
        setState({ status: "error", detail });
      } finally {
        if (!signal.aborted) timer = window.setTimeout(detect, delay);
      }
    }

    void detect();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(freshnessTimer);
    };
  }, [active, bridgeUrl, videoRef]);

  return state;
}
