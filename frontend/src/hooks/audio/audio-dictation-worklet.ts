// `AudioWorkletProcessor` and `registerProcessor` are part of the
// `AudioWorkletGlobalScope` runtime but absent from `lib.dom.d.ts`. Declare
// them locally so this module type-checks in the main TypeScript build.
// The worklet is bundled and loaded via `audioWorklet.addModule(url)`; it
// runs in a dedicated audio rendering thread and must not import anything
// outside its own scope.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

const FRAME_SIZE = 4096;

/**
 * Batches render-quantum audio samples (typically 128 per call) into
 * 4096-sample frames and posts each frame to the main thread via the
 * worklet's `MessagePort`. The cadence matches the legacy
 * `ScriptProcessorNode(4096)` so downstream PCM chunking and resampling
 * don't need to change.
 *
 * Running on the audio rendering thread (rather than the main thread, as
 * `ScriptProcessorNode` does) keeps the input stable when the React app is
 * busy — heavy renders, GC pauses, or long tasks no longer cause dropped
 * audio frames.
 */
class AudioDictationProcessor extends AudioWorkletProcessor {
  private readonly buffer = new Float32Array(FRAME_SIZE);
  private writeIndex = 0;
  /**
   * Stays `false` until the worklet receives a sample that isn't exactly
   * zero. The MediaStream source emits zero-filled render quanta during
   * OS / driver warm-up — empirically up to ~70 quanta on Firefox per
   * Mozilla bug 1629478, and 100+ ms on Bluetooth / Safari / external
   * mics. Posting those frames to the main thread would let the UI flip
   * to "ready" while no real audio is yet flowing, and the user's first
   * spoken words would land before the visual cue. The same pattern
   * gates audio in OpenAI's wavtools and underpins LiveKit's silence
   * detection — see https://github.com/keithwhor/wavtools/blob/main/lib/worklets/audio_processor.js
   */
  private foundAudio = false;

  process(inputs: Float32Array[][]): boolean {
    const channel: Float32Array | undefined = inputs[0]?.[0];
    // Defensive against `process()` firing in the brief window between
    // `new AudioWorkletNode(...)` and `source.connect(processor)` where no
    // input channels exist yet, and against the Firefox warm-up window
    // where `inputs[0]` is an empty sequence.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (channel === undefined || channel.length === 0) {
      return true;
    }

    let startIndex = 0;
    if (!this.foundAudio) {
      // Scan for the first non-zero sample. Pure digital silence is
      // exactly 0; once the OS audio device produces real samples, even
      // ambient noise is non-zero in floating point.
      startIndex = channel.length;
      for (let i = 0; i < channel.length; i += 1) {
        if (channel[i] !== 0) {
          startIndex = i;
          this.foundAudio = true;
          break;
        }
      }
      if (!this.foundAudio) {
        return true;
      }
    }

    let sourceIndex = startIndex;
    while (sourceIndex < channel.length) {
      const remaining = FRAME_SIZE - this.writeIndex;
      const copyCount = Math.min(remaining, channel.length - sourceIndex);
      this.buffer.set(
        channel.subarray(sourceIndex, sourceIndex + copyCount),
        this.writeIndex,
      );
      this.writeIndex += copyCount;
      sourceIndex += copyCount;
      if (this.writeIndex === FRAME_SIZE) {
        // `slice()` so the worklet can keep filling its internal buffer
        // without the consumer seeing it mutate.
        this.port.postMessage(this.buffer.slice());
        this.writeIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor("audio-dictation-processor", AudioDictationProcessor);
