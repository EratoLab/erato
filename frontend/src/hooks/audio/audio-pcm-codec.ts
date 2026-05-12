/**
 * Pure helpers for the dictation audio path: WAV header generation,
 * Float32→PCM16 resampling, bar-level extraction from analyser
 * time-domain data, and MediaTrackSettings → diagnostics mapping. No
 * React, no DOM event listeners — directly unit-testable in isolation
 * and shared by `useAudioDictationRecorder` and any future consumer.
 */

export const CANONICAL_AUDIO_SAMPLE_RATE_HZ = 16_000;
export const CANONICAL_AUDIO_WAV_HEADER_BYTES = 44;
export const CANONICAL_AUDIO_BYTES_PER_SAMPLE = 2;

export const AUDIO_BARS_COUNT = 5;
const AUDIO_BAR_MIN_HEIGHT = 2;
const AUDIO_BAR_MAX_HEIGHT = 16;

export type AudioDictationDiagnostics = {
  channelCount?: number;
  sampleRate?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
};

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

/**
 * Wraps a chunk of canonical-rate 16-bit mono PCM in a WAV RIFF
 * header so the first chunk we ship is a complete playable WAV file.
 */
export function createCanonicalWavBytesFromPcm(
  pcmBytes: Uint8Array,
): Uint8Array {
  const wavBytes = new Uint8Array(
    CANONICAL_AUDIO_WAV_HEADER_BYTES + pcmBytes.length,
  );
  const view = new DataView(wavBytes.buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, CANONICAL_AUDIO_SAMPLE_RATE_HZ, true);
  view.setUint32(
    28,
    CANONICAL_AUDIO_SAMPLE_RATE_HZ * CANONICAL_AUDIO_BYTES_PER_SAMPLE,
    true,
  );
  view.setUint16(32, CANONICAL_AUDIO_BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcmBytes.length, true);
  wavBytes.set(pcmBytes, CANONICAL_AUDIO_WAV_HEADER_BYTES);

  return wavBytes;
}

/**
 * Linear-interpolated downsample from arbitrary AudioContext source
 * rate to the canonical 16 kHz target rate, packed as little-endian
 * 16-bit signed PCM.
 */
export function resampleMonoFloat32ToPcm16(
  samples: Float32Array,
  sourceSampleRate: number,
): Uint8Array {
  const targetSampleCount = Math.max(
    1,
    Math.round(
      (samples.length * CANONICAL_AUDIO_SAMPLE_RATE_HZ) / sourceSampleRate,
    ),
  );
  const pcmBytes = new Uint8Array(
    targetSampleCount * CANONICAL_AUDIO_BYTES_PER_SAMPLE,
  );
  const view = new DataView(pcmBytes.buffer);
  const rateRatio = sourceSampleRate / CANONICAL_AUDIO_SAMPLE_RATE_HZ;

  for (
    let targetSampleIndex = 0;
    targetSampleIndex < targetSampleCount;
    targetSampleIndex += 1
  ) {
    const sourcePosition = targetSampleIndex * rateRatio;
    const sourceIndex = Math.floor(sourcePosition);
    const nextSourceIndex = Math.min(sourceIndex + 1, samples.length - 1);
    const interpolation = sourcePosition - sourceIndex;
    const sample =
      samples[sourceIndex] * (1 - interpolation) +
      samples[nextSourceIndex] * interpolation;
    const clampedSample = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      targetSampleIndex * CANONICAL_AUDIO_BYTES_PER_SAMPLE,
      clampedSample < 0 ? clampedSample * 0x8000 : clampedSample * 0x7fff,
      true,
    );
  }

  return pcmBytes;
}

export function mediaTrackSettingsToDiagnostics(
  settings: MediaTrackSettings,
): AudioDictationDiagnostics {
  return {
    channelCount: settings.channelCount,
    sampleRate: settings.sampleRate,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
  };
}

/**
 * Reduces an AnalyserNode `getByteTimeDomainData` buffer to a 5-bar
 * height array suitable for the Waveform primitive. The amplification
 * factors (rms × 8, peak × 3.5) are tuned for typical mic input —
 * neither so low that quiet speech looks dead, nor so high that
 * ambient noise clips.
 */
export function getAudioLevelBarsFromTimeDomainData(
  audioLevelData: Uint8Array,
): number[] {
  const samplesPerBar = Math.max(
    1,
    Math.floor(audioLevelData.length / AUDIO_BARS_COUNT),
  );

  return Array.from({ length: AUDIO_BARS_COUNT }, (_, barIndex) => {
    const startSample = barIndex * samplesPerBar;
    const endSample =
      barIndex + 1 === AUDIO_BARS_COUNT
        ? audioLevelData.length
        : (barIndex + 1) * samplesPerBar;
    let squaredTotal = 0;
    let peak = 0;

    for (let index = startSample; index < endSample; index++) {
      const centeredSample = (audioLevelData[index] - 128) / 128;
      const absoluteSample = Math.abs(centeredSample);
      squaredTotal += centeredSample * centeredSample;
      peak = Math.max(peak, absoluteSample);
    }

    const sampleCount = Math.max(1, endSample - startSample);
    const rms = Math.sqrt(squaredTotal / sampleCount);
    const amplifiedLevel = Math.min(1, Math.max(rms * 8, peak * 3.5));

    return Math.max(
      AUDIO_BAR_MIN_HEIGHT,
      Math.round(
        AUDIO_BAR_MIN_HEIGHT +
          amplifiedLevel * (AUDIO_BAR_MAX_HEIGHT - AUDIO_BAR_MIN_HEIGHT),
      ),
    );
  });
}
