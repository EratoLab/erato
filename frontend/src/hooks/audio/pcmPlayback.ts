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

export interface PcmQueue {
  /**
   * Schedules one chunk of base64 signed 16-bit little-endian mono PCM right
   * after the chunks already queued. Returns false for a chunk that is not
   * valid PCM, without scheduling it.
   */
  enqueue(context: AudioContext, audio: string, sampleRate: number): boolean;
  /** Silences and forgets everything queued; `onDrained` is not called. */
  stop(): void;
  /**
   * Silences everything queued like `stop`, and returns the chunks that had
   * not played to their end, the one playing first, to be queued again.
   */
  pause(context: AudioContext): PcmChunk[];
  /** Whether a chunk is playing or still scheduled. */
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
  const stop = () => {
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
      return sources.size > 0;
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
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(voiceOutput(context));
      const start = Math.max(context.currentTime + 0.03, nextTime);
      nextTime = start + buffer.duration;
      sources.set(source, { audio, sampleRate, endsAt: nextTime });
      source.onended = () => {
        sources.delete(source);
        source.disconnect();
        if (!sources.size) onDrained();
      };
      source.start(start);
      return true;
    },
    stop,
    pause(context) {
      const unplayed = [...sources.values()]
        .filter((chunk) => chunk.endsAt > context.currentTime)
        .sort((a, b) => a.endsAt - b.endsAt)
        .map(({ audio, sampleRate }) => ({ audio, sampleRate }));
      stop();
      return unplayed;
    },
  };
}
