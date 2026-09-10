import { describe, expect, it } from "vitest";

import { describeAudioTranscriptionFailure } from "./audioTranscriptionErrors";

describe("describeAudioTranscriptionFailure", () => {
  it("explains a provider content block with the passage position and a quotable code", () => {
    const message = describeAudioTranscriptionFailure(
      {
        error:
          "The AI provider's content filter blocked this passage (reason: SAFETY)",
        error_code: "provider_content_blocked",
      },
      { fallback: "Audio dictation failed.", passageStartMs: 90_000 },
    );

    expect(message).toContain("starting at 1:30");
    expect(message).toContain("content filter");
    expect(message).toContain("Error code: provider_content_blocked");
    expect(message).not.toContain("SAFETY");
  });

  it("omits the position when the caller has none", () => {
    const message = describeAudioTranscriptionFailure(
      { error_code: "provider_error" },
      { fallback: "Audio transcription failed." },
    );

    expect(message).toContain("could not transcribe a passage");
    expect(message).toContain("Error code: provider_error");
  });

  it("keeps the server text for unknown codes and falls back when it is empty", () => {
    expect(
      describeAudioTranscriptionFailure(
        {
          error: "Unexpected chunk index: got 1, expected 0",
          error_code: null,
        },
        { fallback: "Audio dictation failed." },
      ),
    ).toBe("Unexpected chunk index: got 1, expected 0");

    expect(
      describeAudioTranscriptionFailure(
        { error: "   " },
        { fallback: "Audio dictation failed." },
      ),
    ).toBe("Audio dictation failed.");
  });
});
