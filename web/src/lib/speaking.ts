import { useEffect, useState } from 'react';

// Lightweight voice-activity detection for the "speaking" ring on stage tiles.
// One shared AudioContext; each watched MediaStream gets a small analyser that
// is polled a few times a second.

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  return sharedCtx;
}

const ON_THRESHOLD = 0.035;
const OFF_THRESHOLD = 0.018;

/** Calls `onChange(true|false)` as the stream's audio crosses the speaking threshold. Returns a stop fn. */
export function watchSpeaking(stream: MediaStream, onChange: (speaking: boolean) => void): () => void {
  const ctx = getCtx();
  if (!ctx || stream.getAudioTracks().length === 0) return () => {};

  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx.createMediaStreamSource(stream);
  } catch {
    return () => {};
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let speaking = false;

  const timer = window.setInterval(() => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    const next = speaking ? rms > OFF_THRESHOLD : rms > ON_THRESHOLD;
    if (next !== speaking) {
      speaking = next;
      onChange(speaking);
    }
  }, 150);

  return () => {
    window.clearInterval(timer);
    try {
      source.disconnect();
    } catch {
      /* already disconnected */
    }
    if (speaking) onChange(false);
  };
}

export function useSpeaking(stream: MediaStream | null | undefined): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    if (!stream) {
      setSpeaking(false);
      return;
    }
    return watchSpeaking(stream, setSpeaking);
  }, [stream]);
  return speaking;
}
