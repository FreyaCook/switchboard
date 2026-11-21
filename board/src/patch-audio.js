export function createPatchAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return () => {};

  let context;
  let clips;
  let resuming;
  let nextClickAt = 0;

  async function unlock(event) {
    if (!event.isTrusted || (event.type === 'pointerdown' && event.pointerType !== 'mouse')
        || context?.state === 'running') return;
    if (resuming) return resuming;
    try {
      context ??= new AudioContext();
      resuming = context.resume().catch(() => {});
      await resuming;
    } catch {
      // A later interaction can retry if the browser declines to resume audio.
    } finally {
      resuming = undefined;
    }
  }

  for (const event of ['pointerdown', 'pointerup', 'keydown']) {
    window.addEventListener(event, unlock, { capture: true, passive: true });
  }

  function playClick(kind) {
    if (context?.state !== 'running' || context.currentTime < nextClickAt || document.hidden) return;
    clips ??= { plug: makeClick(context, false), unplug: makeClick(context, true) };
    const source = context.createBufferSource();
    source.buffer = clips[kind];
    source.connect(context.destination);
    source.onended = () => source.disconnect();
    const now = context.currentTime;
    source.start(now);
    nextClickAt = now + source.buffer.duration + 0.025;
  }

  return playClick;
}

function makeClick(context, unplug) {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.round(rate * (unplug ? 0.048 : 0.065)), rate);
  const samples = buffer.getChannelData(0);
  const level = unplug ? 0.19 : 0.34;
  let noise = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const t = i / rate;
    noise += 0.28 * (Math.random() * 2 - 1 - noise);
    const attack = Math.min(1, t / 0.001);
    const impact = noise * Math.exp(-t * 330);
    const ring = (0.58 * Math.sin(t * 2 * Math.PI * (unplug ? 620 : 780))
      + 0.22 * Math.sin(t * 2 * Math.PI * (unplug ? 1400 : 1950))) * Math.exp(-t * 145);
    samples[i] = level * attack * (impact + ring);
  }
  return buffer;
}
