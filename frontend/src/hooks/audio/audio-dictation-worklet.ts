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

    // Always batch and post every render quantum — including the
    // zero-filled samples the MediaStream source emits during OS warm-up.
    // Server-side VAD needs that leading-silence calibration window to
    // detect speech onset cleanly; trimming it client-side (as we tried
    // previously) makes streaming STT engines drop the first word.
    // Non-zero detection for the UI "speak now" signal lives in the main
    // thread's `port.onmessage` handler instead.
    let sourceIndex = 0;
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
