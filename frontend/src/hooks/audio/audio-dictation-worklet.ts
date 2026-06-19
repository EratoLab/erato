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
  // Reused mono down-mix scratch; resized only when the render quantum
  // length changes (it's normally a stable 128).
  private monoScratch = new Float32Array(0);

  /**
   * Reduces the input channels to a single mono Float32 frame. Safari
   * returns a STEREO MediaStream when `echoCancellation: false` even with
   * `channelCount: { ideal: 1 }`, so reading channel 0 alone would drop
   * half the signal; mean-of-channels is correct everywhere. Guards
   * ragged/empty channels (Firefox warm-up can hand back zero-length or
   * unequal-length channel arrays) by using each channel's own length, so
   * a short channel never reads out of bounds. Returns `null` when there's
   * no audio to emit yet.
   */
  private downmixToMono(channels: Float32Array[]): Float32Array | null {
    let frameLength = 0;
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const length = channels[channelIndex]?.length ?? 0;
      if (length > frameLength) {
        frameLength = length;
      }
    }
    if (frameLength === 0) {
      return null;
    }
    // Single-channel fast path — no averaging, no allocation.
    if (channels.length === 1) {
      return channels[0];
    }
    if (this.monoScratch.length !== frameLength) {
      this.monoScratch = new Float32Array(frameLength);
    }
    const mono = this.monoScratch;
    for (let index = 0; index < frameLength; index++) {
      let sum = 0;
      let contributing = 0;
      for (
        let channelIndex = 0;
        channelIndex < channels.length;
        channelIndex++
      ) {
        const channel = channels[channelIndex];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (channel !== undefined && index < channel.length) {
          sum += channel[index];
          contributing += 1;
        }
      }
      mono[index] = contributing > 0 ? sum / contributing : 0;
    }
    return mono;
  }

  process(inputs: Float32Array[][]): boolean {
    const channels: Float32Array[] | undefined = inputs[0];
    // Defensive against `process()` firing in the brief window between
    // `new AudioWorkletNode(...)` and `source.connect(processor)` where no
    // input channels exist yet, and against the Firefox warm-up window
    // where `inputs[0]` is an empty sequence.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (channels === undefined || channels.length === 0) {
      return true;
    }
    const mono = this.downmixToMono(channels);
    if (mono === null) {
      return true;
    }

    // Always batch and post every render quantum — including the
    // zero-filled samples the MediaStream source emits during OS warm-up.
    // Server-side VAD needs that leading-silence calibration window to
    // detect speech onset cleanly; trimming it client-side (as we tried
    // previously) makes streaming STT engines drop the first word.
    // Speech-onset detection for the UI "speak now" signal lives in the
    // main thread's `port.onmessage` handler instead.
    let sourceIndex = 0;
    while (sourceIndex < mono.length) {
      const remaining = FRAME_SIZE - this.writeIndex;
      const copyCount = Math.min(remaining, mono.length - sourceIndex);
      this.buffer.set(
        mono.subarray(sourceIndex, sourceIndex + copyCount),
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
