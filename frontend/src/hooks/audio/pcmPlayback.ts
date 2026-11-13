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

export interface PcmQueue {
  /**
   * Schedules one chunk of base64 signed 16-bit little-endian mono PCM right
   * after the chunks already queued. Returns false for a chunk that is not
   * valid PCM, without scheduling it.
   */
  enqueue(context: AudioContext, audio: string, sampleRate: number): boolean;
  /** Silences and forgets everything queued; `onDrained` is not called. */
  stop(): void;
  /** Whether a chunk is playing or still scheduled. */
  readonly active: boolean;
}

export function createPcmQueue(onDrained: () => void): PcmQueue {
  let nextTime = 0;
  const sources = new Set<AudioBufferSourceNode>();
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
      source.connect(context.destination);
      const start = Math.max(context.currentTime + 0.03, nextTime);
      nextTime = start + buffer.duration;
      sources.add(source);
      source.onended = () => {
        sources.delete(source);
        source.disconnect();
        if (!sources.size) onDrained();
      };
      source.start(start);
      return true;
    },
    stop() {
      for (const source of sources) {
        // A stopped source still fires `ended`; it must not report the queue
        // as drained to whatever started playing in the meantime.
        source.onended = null;
        source.stop();
        source.disconnect();
      }
      sources.clear();
      nextTime = 0;
    },
  };
}
