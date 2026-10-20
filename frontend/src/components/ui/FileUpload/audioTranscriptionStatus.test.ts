import { describe, expect, it } from "vitest";

import {
  audioTranscriptionDuration,
  audioTranscriptionOutcomeText,
  audioTranscriptionPhase,
  audioTranscriptionTileStatus,
  getDisplayTranscript,
  isAudioTranscriptionComplete,
} from "./audioTranscriptionStatus";

const rec = (audio_transcription?: Record<string, unknown>) => ({
  filename: "audio-recording-20261020-1200.wav",
  ...(audio_transcription ? { audio_transcription } : {}),
});

const chunk = (status: string, endMs: number | null, transcript?: string) => ({
  status,
  end_ms: endMs,
  transcript,
});

describe("audioTranscriptionTileStatus", () => {
  it("is null for a file that is no recording", () => {
    expect(audioTranscriptionTileStatus(rec())).toBeNull();
  });

  it.each([
    ["recording", "recording", true, "Recording…"],
    ["uploading", "uploading", true, "Uploading…"],
    ["transcribing", "transcribing", true, "Transcribing…"],
    ["processing", "transcribing", true, "Transcribing…"],
    ["pending", "transcribing", true, "Transcribing…"],
    ["something-new", "transcribing", true, "Transcribing…"],
    ["COMPLETED", "completed", false, "Transcript ready"],
    ["failed", "failed", false, "Couldn't transcribe"],
    ["canceled", "canceled", false, "Transcription canceled"],
  ])("draws %s as %s", (status, phase, busy, meta) => {
    const result = audioTranscriptionTileStatus(rec({ status }));
    expect(result).toMatchObject({ phase, busy, metaLabel: meta });
    expect(result?.tone).toBe(phase === "failed" ? "error" : undefined);
  });

  it("adds the length the chunks reach, dropping the phase word's ellipsis", () => {
    const chunks = [chunk("completed", 20_000), chunk("pending", 42_300)];
    expect(
      audioTranscriptionTileStatus(rec({ status: "processing", chunks }))
        ?.metaLabel,
    ).toBe("Transcribing · 0:42");
    expect(
      audioTranscriptionTileStatus(rec({ status: "uploading", chunks }))
        ?.metaLabel,
    ).toBe("Uploading · 0:42");
    expect(
      audioTranscriptionTileStatus(rec({ status: "completed", chunks }))
        ?.metaLabel,
    ).toBe("Transcript ready · 0:42");
    // A failure states itself; the error is the title.
    expect(
      audioTranscriptionTileStatus(
        rec({ status: "failed", chunks, error: " Provider timed out. " }),
      ),
    ).toMatchObject({
      metaLabel: "Couldn't transcribe",
      title: "Provider timed out.",
    });
  });

  it("reads the phase from the chunks when the status is missing", () => {
    expect(
      audioTranscriptionPhase({ chunks: [chunk("completed", 1000)] }),
    ).toBe("completed");
    expect(
      audioTranscriptionPhase({
        chunks: [chunk("completed", 1000), chunk("transcribing", 2000)],
      }),
    ).toBe("transcribing");
    expect(audioTranscriptionPhase({})).toBe("transcribing");
  });

  it("offers a retry only for a failed recording the recorder holds", () => {
    const failed = rec({ status: "failed" });
    expect(
      audioTranscriptionTileStatus(failed, {
        retryable: false,
        retrying: false,
      })?.action,
    ).toBeUndefined();
    expect(
      audioTranscriptionTileStatus(rec({ status: "processing" }), {
        retryable: true,
        retrying: false,
      })?.action,
    ).toBeUndefined();
    expect(
      audioTranscriptionTileStatus(failed, { retryable: true, retrying: false })
        ?.action,
    ).toEqual({
      label: "Retry transcription",
      name: "Retry transcription: audio-recording-20261020-1200.wav",
      disabled: false,
    });
    expect(
      audioTranscriptionTileStatus(failed, { retryable: true, retrying: true })
        ?.action,
    ).toMatchObject({ label: "Retrying…", disabled: true });
    expect(
      audioTranscriptionTileStatus(failed, {
        retryable: true,
        retrying: false,
        locked: true,
      })?.action?.disabled,
    ).toBe(true);
  });
});

describe("audioTranscriptionDuration", () => {
  it.each([
    [[chunk("completed", 42_000)], "0:42"],
    [[chunk("completed", 300_000), chunk("pending", 725_400)], "12:05"],
    [[chunk("pending", null)], null],
    [[], null],
  ])("reads %j as %s", (chunks, expected) => {
    expect(audioTranscriptionDuration(chunks)).toBe(expected);
  });
});

describe("transcript and completion", () => {
  it("prefers the transcript, then the completed chunks in order", () => {
    expect(getDisplayTranscript("Whole text.", [])).toBe("Whole text.");
    expect(
      getDisplayTranscript("  ", [
        chunk("completed", 1000, "Hello"),
        chunk("pending", 2000, "ignored"),
        chunk("completed", 3000, "team."),
      ]),
    ).toBe("Hello team.");
    expect(getDisplayTranscript(null, [chunk("pending", 1)])).toBeUndefined();
  });

  it("is complete only once completed", () => {
    expect(isAudioTranscriptionComplete("completed")).toBe(true);
    expect(isAudioTranscriptionComplete("failed")).toBe(false);
    expect(isAudioTranscriptionComplete("canceled")).toBe(false);
    expect(
      isAudioTranscriptionComplete(undefined, [chunk("completed", 1)]),
    ).toBe(true);
    expect(isAudioTranscriptionComplete(undefined, [])).toBe(false);
  });

  it("says only the end states", () => {
    expect(audioTranscriptionOutcomeText("a.wav", "completed")).toBe(
      "a.wav: transcript ready.",
    );
    expect(audioTranscriptionOutcomeText("a.wav", "failed")).toBe(
      "a.wav: couldn't transcribe.",
    );
    expect(audioTranscriptionOutcomeText("a.wav", "canceled")).toBeNull();
  });
});
