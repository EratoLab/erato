let context: AudioContext | undefined;

/**
 * The one AudioContext all speech playback shares. Browsers keep a context
 * suspended until it is resumed from a user gesture, so the first call has to
 * come from a click.
 */
export async function resumePlaybackContext(): Promise<AudioContext> {
  context ??= new AudioContext();
  await context.resume();
  return context;
}

export function playbackContext(): AudioContext | undefined {
  return context;
}

/** About 10 dB down: still audible, clearly giving way. */
const LOWERED_VOICE_GAIN = 0.3;
let output: GainNode | undefined;

/** Where every voice plays, so that talking over it can lower it. */
function voiceOutput(context: AudioContext): GainNode {
  if (output?.context !== context) {
    output = context.createGain();
    output.connect(context.destination);
  }
  return output;
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
export const START_BUFFER_MS = 400;
/**
 * It waits at most this long, so the first sound is never much later than
 * before; whatever has come by then plays. A pause up to this long leaves no
 * gap, a longer one a gap shorter by this much.
 */
export const START_WAIT_MS = 350;

export interface PcmQueue {
  /**
   * Schedules one chunk of base64 signed 16-bit little-endian mono PCM right
   * after the chunks already queued. Returns false for a chunk that is not
   * valid PCM, without scheduling it.
   */
  enqueue(context: AudioContext, audio: string, sampleRate: number): boolean;
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
}

export function createPcmQueue(onDrained: () => void): PcmQueue {
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
      endsAt: nextTime,
    });
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
    for (const chunk of held.chunks) schedule(held.context, chunk);
  };

  const stop = () => {
    clearTimeout(waitTimer);
    waitTimer = undefined;
    waiting = null;
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
    enqueue(context, audio, sampleRate) {
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
      const chunk = { audio, sampleRate, buffer };
      // Playing on: the next chunk follows directly.
      if (sources.size > 0 && !waiting) {
        schedule(context, chunk);
        return true;
      }
      // From silence: wait for enough audio, or until it has had time to come.
      if (!waiting) {
        waiting = { context, chunks: [] };
        waitTimer = setTimeout(release, START_WAIT_MS);
      }
      waiting.chunks.push(chunk);
      const buffered = waiting.chunks.reduce(
        (sum, held) => sum + held.buffer.duration,
        0,
      );
      if (buffered * 1000 >= START_BUFFER_MS) release();
      return true;
    },
    flush: release,
    stop,
    pause(context) {
      const unplayed = [...sources.values()]
        .filter((chunk) => chunk.endsAt > context.currentTime)
        .sort((a, b) => a.endsAt - b.endsAt)
        .map(({ audio, sampleRate }) => ({ audio, sampleRate }));
      const held = (waiting?.chunks ?? []).map(({ audio, sampleRate }) => ({
        audio,
        sampleRate,
      }));
      stop();
      return [...unplayed, ...held];
    },
  };
}
