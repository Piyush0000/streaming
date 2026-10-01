// Tiny Web Audio synth for short, original notification tones — never real
// Discord sound files or any other copyrighted audio. Everything here is
// generated on the fly from OscillatorNodes.

let audioCtx: AudioContext | null = null;
let userHasInteracted = false;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextCtor();
  }
  return audioCtx;
}

// Browsers block audio until the user has interacted with the page at least
// once. By the time someone has joined voice or is looking at a channel
// they've already clicked into the app, so this resolves itself in
// practice — but we still guard against a 'suspended' context defensively.
function markInteracted() {
  userHasInteracted = true;
  audioCtx?.resume().catch(() => {});
}

if (typeof window !== 'undefined') {
  const once = { once: true, passive: true } as const;
  window.addEventListener('pointerdown', markInteracted, once);
  window.addEventListener('keydown', markInteracted, once);
}

/** Plays a short sine-wave blip at `frequency` Hz for `durationMs` milliseconds. */
export function playTone(frequency: number, durationMs: number, options?: { type?: OscillatorType; gain?: number }) {
  const ctx = getContext();
  if (!ctx) return;
  if (!userHasInteracted && ctx.state === 'suspended') return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = options?.type ?? 'sine';
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

  const peakGain = options?.gain ?? 0.12;
  const durationSec = durationMs / 1000;
  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(peakGain, ctx.currentTime + 0.015);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationSec);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start();
  oscillator.stop(ctx.currentTime + durationSec + 0.02);
}

/** A peer joined the voice channel you're in — short rising tone. */
export function playJoinSound() {
  const ctx = getContext();
  if (!ctx) return;
  playTone(440, 90);
  setTimeout(() => playTone(660, 110), 70);
}

/** A peer left the voice channel you're in — short falling tone. */
export function playLeaveSound() {
  playTone(520, 90);
  setTimeout(() => playTone(340, 130), 70);
}

/** A new chat message arrived while you weren't looking at the bottom of that channel. */
export function playMessageSound() {
  playTone(600, 90, { type: 'sine', gain: 0.08 });
}
