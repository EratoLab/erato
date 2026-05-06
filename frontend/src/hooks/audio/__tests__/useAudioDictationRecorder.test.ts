import { describe, expect, it } from "vitest";

import { getAudioLevelBarsFromTimeDomainData } from "../useAudioDictationRecorder";

describe("getAudioLevelBarsFromTimeDomainData", () => {
  it("keeps silent input at the minimum waveform height", () => {
    const silence = new Uint8Array(100).fill(128);

    expect(getAudioLevelBarsFromTimeDomainData(silence)).toEqual([
      2, 2, 2, 2, 2,
    ]);
  });

  it("raises bars for spoken waveform amplitude", () => {
    const speechLikeInput = new Uint8Array(
      Array.from({ length: 100 }, (_, index) =>
        index % 2 === 0 ? 136 : 120,
      ),
    );

    expect(
      getAudioLevelBarsFromTimeDomainData(speechLikeInput).some(
        (height) => height > 2,
      ),
    ).toBe(true);
  });
});
