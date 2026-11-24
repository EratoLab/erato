import { reviveStandingClock } from "./useAudioContextInterruptionRecovery";

let context: AudioContext | undefined;
/** Resuming waits for it, or a voice right after unlocking stays silent. */
let revival: Promise<void> | undefined;
/** A suspend or resume that never settles must not hold every voice back. */
const REVIVAL_MAX_MS = 2000;
/**
 * The last revival left the clock standing, at this time. A revival right
 * after unlocking does not always take; the next voices try again, a few
 * times per return to the page.
 */
let standingSince: number | undefined;
const REVIVAL_RETRY_MS = 2000;
const REVIVAL_RETRIES = 5;
let retriesLeft = REVIVAL_RETRIES;
/** Until it settles, past the cap too: two revivals must not overlap. */
let reviving = false;

/**
 * The one AudioContext all speech playback shares. Browsers keep a context
 * suspended until it is resumed from a user gesture, so the first call has to
 * come from a click.
 */
export async function resumePlaybackContext(): Promise<AudioContext> {
  if (!context) {
    context = new AudioContext();
    reviveOnReturn(context);
  }
  retryIfStanding(context, 0);
  if (revival) await revival;
  await context.resume();
  return context;
}

/** A tap asks for the voice now; voices arriving on their own wait a gap. */
function retryIfStanding(playback: AudioContext, gapMs = REVIVAL_RETRY_MS) {
  if (
    reviving ||
    playback.state !== "running" ||
    standingSince === undefined ||
    Date.now() - standingSince < gapMs ||
    retriesLeft <= 0
  )
    return;
  retriesLeft -= 1;
  revive(playback);
}

function revive(playback: AudioContext) {
  if (reviving) return;
  reviving = true;
  const settled = reviveStandingClock(playback)
    .then((stands) => {
      standingSince = stands ? Date.now() : undefined;
    })
    .finally(() => {
      reviving = false;
    });
  const capped = Promise.race([
    settled,
    new Promise<void>((resolve) => setTimeout(resolve, REVIVAL_MAX_MS)),
  ]).finally(() => {
    if (revival === capped) revival = undefined;
  });
  revival = capped;
}

/**
 * After a phone lock the context can stay silent for good while it says
 * "running"; every voice, wait line and card plays on this one context.
 */
function reviveOnReturn(playback: AudioContext) {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    retriesLeft = REVIVAL_RETRIES;
    revive(playback);
  });
}

export function playbackContext(): AudioContext | undefined {
  return context;
}

/**
 * Whether audio queued on the context will be heard: it runs, or it is
 * suspended only for a moment while its clock is started again.
 */
export function playbackPlays(
  playback: AudioContext | undefined,
): playback is AudioContext {
  if (playback === undefined) return false;
  const plays =
    playback.state === "running" ||
    (revival !== undefined && playback === context);
  if (playback === context) retryIfStanding(playback);
  return plays;
}

/** About 10 dB down: still audible, clearly giving way. */
const LOWERED_VOICE_GAIN = 0.3;
let output: GainNode | undefined;

/** What the voice sends to the speakers, read as the microphone hears. */
let outputMeter: AnalyserNode | undefined;

/** Where every voice plays, so that talking over it can lower it. */
function voiceOutput(context: AudioContext): GainNode {
  if (output?.context !== context) {
    output = context.createGain();
    output.connect(context.destination);
    outputMeter = undefined;
    if (typeof context.createAnalyser === "function") {
      outputMeter = context.createAnalyser();
      // Twice as long as the microphone's audio arrives in at once.
      outputMeter.fftSize = 8192;
      output.connect(outputMeter);
    }
  }
  return output;
}

/** The voice's level as it reached the speakers, in 10 ms steps. */
let outputLevels: { at: number; level: number }[] = [];
const LEVEL_STEP_S = 0.01;
/** Older sound can no longer come back as echo. */
const LEVELS_KEPT_MS = 3000;

/**
 * Notes what the voice sent to the speakers just now, every voice and its
 * lowering included; called with the microphone's audio as it arrives.
 */
export function noteVoiceOutput() {
  const meter = outputMeter;
  if (!meter) return;
  const samples = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(samples);
  const rate = meter.context.sampleRate;
  const step = Math.round(rate * LEVEL_STEP_S);
  // The speakers play it this much later.
  const playedAt =
    globalThis.performance.now() +
    ((Number((meter.context as AudioContext).outputLatency) || 0) +
      (Number((meter.context as AudioContext).baseLatency) || 0)) *
      1000;
  const last = outputLevels.at(-1)?.at ?? -Infinity;
  const fresh: { at: number; level: number }[] = [];
  for (let end = samples.length; end >= step; end -= step) {
    const at = playedAt - ((samples.length - end) / rate) * 1000;
    if (at <= last) break;
    let sum = 0;
    for (let i = end - step; i < end; i += 1) sum += samples[i] * samples[i];
    fresh.push({ at, level: Math.sqrt(sum / step) });
  }
  outputLevels = [
    ...outputLevels.filter((entry) => entry.at > playedAt - LEVELS_KEPT_MS),
    ...fresh.reverse(),
  ];
}

/**
 * The loudest the voice was at the speakers between two moments of the page
 * clock (`performance.now()`); 0 when it was silent or nothing was noted.
 */
export function playedVoiceLevel(fromMs: number, toMs: number): number {
  let loudest = 0;
  for (const entry of outputLevels)
    if (entry.at >= fromMs && entry.at <= toMs)
      loudest = Math.max(loudest, entry.level);
  return loudest;
}

/** Lowers the voice while the user may be starting to talk over it. */
export function lowerVoice(lowered: boolean) {
  if (!output) return;
  output.gain.setTargetAtTime(
    lowered ? LOWERED_VOICE_GAIN : 1,
    output.context.currentTime,
    0.03,
  );
}

/**
 * A voice that starts from silence waits until this much audio is there.
 * The speech stream sends about 200 ms first, then nothing for 0.3 to 0.7 s:
 * played at once, the first syllable stands alone before a gap.
 */
export const DEFAULT_START_BUFFER_MS = 400;
/**
 * It waits at most this long, so the first sound is never much later than
 * before; whatever has come by then plays. A pause up to this long leaves no
 * gap, a longer one a gap shorter by this much.
 */
export const DEFAULT_START_WAIT_MS = 350;

const voiceStart = {
  bufferMs: DEFAULT_START_BUFFER_MS,
  maxWaitMs: DEFAULT_START_WAIT_MS,
};

/**
 * Sets the start buffer for every voice from here on: the deployment's
 * `voice_start_buffer_ms` and `voice_start_max_wait_ms`. A value outside 0 to
 * 2000 keeps the default.
 */
export function configureVoiceStart(settings: {
  bufferMs?: number;
  maxWaitMs?: number;
}) {
  const inRange = (value: number | undefined, fallback: number) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 2000
      ? value
      : fallback;
  voiceStart.bufferMs = inRange(settings.bufferMs, DEFAULT_START_BUFFER_MS);
  voiceStart.maxWaitMs = inRange(settings.maxWaitMs, DEFAULT_START_WAIT_MS);
}

export interface PcmQueue {
  /**
   * Schedules one chunk of base64 signed 16-bit little-endian mono PCM right
   * after the chunks already queued. Returns false for a chunk that is not
   * valid PCM, without scheduling it.
   */
  enqueue(
    context: AudioContext,
    audio: string,
    sampleRate: number,
    /** What the voice says from this chunk on, on a passage's first chunk. */
    text?: string,
  ): boolean;
  /** Plays what waits for the start buffer now: nothing more is coming. */
  flush(): void;
  /** Silences and forgets everything queued; `onDrained` is not called. */
  stop(): void;
  /**
   * Silences everything queued like `stop`, and returns the chunks that had
   * not played to their end, the one playing first, to be queued again.
   */
  pause(context: AudioContext): PcmChunk[];
  /** Whether a chunk is playing, scheduled, or waits for the start buffer. */
  readonly active: boolean;
}

export interface PcmChunk {
  audio: string;
  sampleRate: number;
  text?: string;
}

/**
 * `onScheduled` hears each chunk as it is scheduled: its text, on a
 * passage's first chunk, and the context times it plays from and to.
 */
export function createPcmQueue(
  onDrained: () => void,
  onScheduled?: (
    text: string | undefined,
    startsAt: number,
    endsAt: number,
  ) => void,
): PcmQueue {
  let nextTime = 0;
  const sources = new Map<
    AudioBufferSourceNode,
    PcmChunk & { endsAt: number }
  >();
  /** Audio held back until the start buffer is full, and its context. */
  let waiting: {
    context: AudioContext;
    chunks: (PcmChunk & { buffer: AudioBuffer })[];
  } | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Nothing has played since the queue was created or stopped: the next
   * audio starts a voice. A voice that only ran dry in the middle goes on at
   * once, as it would without the buffer.
   */
  let fresh = true;

  const schedule = (
    context: AudioContext,
    chunk: PcmChunk & { buffer: AudioBuffer },
  ) => {
    const source = context.createBufferSource();
    source.buffer = chunk.buffer;
    source.connect(voiceOutput(context));
    const start = Math.max(context.currentTime + 0.03, nextTime);
    nextTime = start + chunk.buffer.duration;
    sources.set(source, {
      audio: chunk.audio,
      sampleRate: chunk.sampleRate,
      text: chunk.text,
      endsAt: nextTime,
    });
    onScheduled?.(chunk.text, start, nextTime);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
      if (!sources.size && !waiting) onDrained();
    };
    source.start(start);
  };

  const release = () => {
    clearTimeout(waitTimer);
    waitTimer = undefined;
    const held = waiting;
    waiting = null;
    if (!held) return;
    fresh = false;
    for (const chunk of held.chunks) schedule(held.context, chunk);
  };

  const stop = () => {
    clearTimeout(waitTimer);
    waitTimer = undefined;
    waiting = null;
    fresh = true;
    for (const source of sources.keys()) {
      // A stopped source still fires `ended`; it must not report the queue
      // as drained to whatever started playing in the meantime.
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    sources.clear();
    nextTime = 0;
  };
  return {
    get active() {
      return sources.size > 0 || waiting !== null;
    },
    enqueue(context, audio, sampleRate, text) {
      const raw = globalThis.atob(audio);
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      if (
        !bytes.length ||
        bytes.length % 2 !== 0 ||
        sampleRate < 8000 ||
        sampleRate > 192000
      )
        return false;
      const view = new DataView(bytes.buffer);
      const buffer = context.createBuffer(1, bytes.length / 2, sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = view.getInt16(i * 2, true) / 32768;
      const chunk = { audio, sampleRate, text, buffer };
      // Playing on, or running dry in the middle: the chunk plays at once.
      if (!waiting && (sources.size > 0 || !fresh)) {
        schedule(context, chunk);
        return true;
      }
      // From silence: wait for enough audio, or until it has had time to come.
      if (!waiting) {
        waiting = { context, chunks: [] };
        waitTimer = setTimeout(release, voiceStart.maxWaitMs);
      }
      waiting.chunks.push(chunk);
      const buffered = waiting.chunks.reduce(
        (sum, held) => sum + held.buffer.duration,
        0,
      );
      if (buffered * 1000 >= voiceStart.bufferMs) release();
      return true;
    },
    flush: release,
    stop,
    pause(context) {
      const unplayed = [...sources.values()]
        .filter((chunk) => chunk.endsAt > context.currentTime)
        .sort((a, b) => a.endsAt - b.endsAt)
        .map(({ audio, sampleRate, text }) => ({ audio, sampleRate, text }));
      const held = (waiting?.chunks ?? []).map(
        ({ audio, sampleRate, text }) => ({ audio, sampleRate, text }),
      );
      stop();
      return [...unplayed, ...held];
    },
  };
}
